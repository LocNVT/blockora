import type { ItemStack } from './ItemStack';
import { createStack, mergeStacks, splitStack, splitHalf } from './ItemStack';
import type { ItemId } from './items';
import { itemRegistry, type ItemRegistry } from './ItemRegistry';
import { INVENTORY_CONFIG } from '../config/constants';

/**
 * UI-independent inventory model: a fixed set of slots holding ItemStack | null.
 * Slots 0..hotbarSize-1 are the hotbar; the rest is the main inventory.
 * ItemStacks are immutable — every mutation replaces a slot's entry rather than
 * mutating a stack in place.
 */
export class Inventory {
  private readonly registry: ItemRegistry;
  private readonly slotStacks: (ItemStack | null)[];
  private readonly slotCount: number;
  private readonly hotbarSlotCount: number;
  private selectedHotbar = 0;

  constructor(
    registry: ItemRegistry = itemRegistry,
    slotCount: number = INVENTORY_CONFIG.inventorySlots,
    hotbarSize: number = INVENTORY_CONFIG.hotbarSlots,
  ) {
    if (hotbarSize > slotCount) {
      throw new RangeError(
        `Inventory: hotbarSize (${hotbarSize}) must be <= slotCount (${slotCount}).`,
      );
    }
    this.registry = registry;
    this.slotCount = slotCount;
    this.hotbarSlotCount = hotbarSize;
    this.slotStacks = new Array<ItemStack | null>(slotCount).fill(null);
  }

  get size(): number {
    return this.slotCount;
  }

  get hotbarSize(): number {
    return this.hotbarSlotCount;
  }

  private assertSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.slotCount) {
      throw new RangeError(`Inventory: slot index ${slot} out of range (0..${this.slotCount - 1}).`);
    }
  }

  getSlot(slot: number): ItemStack | null {
    this.assertSlot(slot);
    return this.slotStacks[slot] ?? null;
  }

  isEmpty(slot: number): boolean {
    return this.getSlot(slot) === null;
  }

  /** Returns a readonly copy of all slots (safe to inspect, not linked to internal state). */
  slots(): readonly (ItemStack | null)[] {
    return this.slotStacks.slice();
  }

  /**
   * Adds a stack to the inventory: first merges into existing same-item stacks
   * in slot order (hotbar first, then main inventory), then fills empty slots
   * in slot order. Returns the leftover stack that didn't fit (null if all of
   * it was added).
   */
  add(stack: ItemStack): ItemStack | null {
    let remaining: ItemStack | null = stack;

    for (let i = 0; i < this.slotCount && remaining !== null; i++) {
      const existing = this.slotStacks[i] ?? null;
      if (existing !== null && existing.itemId === remaining.itemId) {
        const { merged, remainder } = mergeStacks(existing, remaining, this.registry);
        this.slotStacks[i] = merged;
        remaining = remainder;
      }
    }

    const maxStack = this.registry.maxStackSize(stack.itemId);

    for (let i = 0; i < this.slotCount && remaining !== null; i++) {
      if (this.slotStacks[i] === null || this.slotStacks[i] === undefined) {
        if (remaining.count > maxStack) {
          const { taken, rest } = splitStack(remaining, maxStack);
          this.slotStacks[i] = taken;
          remaining = rest;
        } else {
          this.slotStacks[i] = remaining;
          remaining = null;
        }
      }
    }

    return remaining;
  }

  /** Returns whether the whole stack would fit via add(), without mutating anything. */
  canAdd(stack: ItemStack): boolean {
    let remaining = stack.count;
    const maxStack = this.registry.maxStackSize(stack.itemId);

    for (let i = 0; i < this.slotCount && remaining > 0; i++) {
      const existing = this.slotStacks[i] ?? null;
      if (existing !== null && existing.itemId === stack.itemId) {
        const space = maxStack - existing.count;
        if (space > 0) {
          remaining -= Math.min(space, remaining);
        }
      }
    }

    if (remaining <= 0) {
      return true;
    }

    for (let i = 0; i < this.slotCount && remaining > 0; i++) {
      if (this.slotStacks[i] === null || this.slotStacks[i] === undefined) {
        remaining -= Math.min(maxStack, remaining);
      }
    }

    return remaining <= 0;
  }

  /**
   * Removes `amount` (default: whole stack) from `slot` and returns the taken
   * stack, or null if the slot was empty. Throws RangeError for an invalid amount.
   */
  take(slot: number, amount?: number): ItemStack | null {
    this.assertSlot(slot);
    const existing = this.slotStacks[slot] ?? null;
    if (existing === null) {
      return null;
    }

    const takeAmount = amount ?? existing.count;
    const { taken, rest } = splitStack(existing, takeAmount);
    this.slotStacks[slot] = rest;
    return taken;
  }

  /** Removes roughly half of the stack in `slot` (ceil), returns the taken portion. */
  takeHalf(slot: number): ItemStack | null {
    this.assertSlot(slot);
    const existing = this.slotStacks[slot] ?? null;
    if (existing === null) {
      return null;
    }

    const { taken, rest } = splitHalf(existing);
    this.slotStacks[slot] = rest;
    return taken;
  }

  /**
   * Raw slot set (for load/UI). Validates the stack via createStack-level rules
   * (registered item id, count within max) by re-deriving it through the registry.
   */
  set(slot: number, stack: ItemStack | null): void {
    this.assertSlot(slot);
    if (stack === null) {
      this.slotStacks[slot] = null;
      return;
    }
    this.slotStacks[slot] = createStack(stack.itemId, stack.count, this.registry, stack.damage);
  }

  /**
   * Moves the contents of `from` into `to`.
   * - from empty: no-op.
   * - from === to: no-op.
   * - to empty: move the whole stack.
   * - same item: merge into `to`; leftover (if any) stays in `from`, else `from` becomes empty.
   * - different items: swap the two slots.
   */
  move(from: number, to: number): void {
    this.assertSlot(from);
    this.assertSlot(to);

    if (from === to) {
      return;
    }

    const source = this.slotStacks[from] ?? null;
    if (source === null) {
      return;
    }

    const target = this.slotStacks[to] ?? null;

    if (target === null) {
      this.slotStacks[to] = source;
      this.slotStacks[from] = null;
      return;
    }

    if (target.itemId === source.itemId) {
      const { merged, remainder } = mergeStacks(target, source, this.registry);
      this.slotStacks[to] = merged;
      this.slotStacks[from] = remainder;
      return;
    }

    this.slotStacks[to] = source;
    this.slotStacks[from] = target;
  }

  /** Total count of `itemId` held across all slots. */
  countItem(itemId: ItemId): number {
    let total = 0;
    for (const stack of this.slotStacks) {
      if (stack !== null && stack.itemId === itemId) {
        total += stack.count;
      }
    }
    return total;
  }

  /**
   * Removes up to `count` of `itemId` from the inventory, consuming stacks in
   * reverse slot order (last slot of main inventory first, hotbar slots last)
   * so hotbar stacks the player is actively using are preserved as long as
   * possible. Returns the number actually removed (may be less than `count`
   * if there wasn't enough).
   */
  removeItem(itemId: ItemId, count: number): number {
    let remaining = count;

    for (let i = this.slotCount - 1; i >= 0 && remaining > 0; i--) {
      const stack = this.slotStacks[i] ?? null;
      if (stack === null || stack.itemId !== itemId) {
        continue;
      }

      const toRemove = Math.min(stack.count, remaining);
      const { rest } = splitStack(stack, toRemove);
      this.slotStacks[i] = rest;
      remaining -= toRemove;
    }

    return count - remaining;
  }

  hasItem(itemId: ItemId, count: number): boolean {
    return this.countItem(itemId) >= count;
  }

  get selectedHotbarIndex(): number {
    return this.selectedHotbar;
  }

  selectHotbar(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.hotbarSlotCount) {
      throw new RangeError(
        `Inventory: hotbar index ${index} out of range (0..${this.hotbarSlotCount - 1}).`,
      );
    }
    this.selectedHotbar = index;
  }

  /** Moves the hotbar selection by `delta`, wrapping in both directions for any integer delta. */
  scrollHotbar(delta: number): void {
    const n = this.hotbarSlotCount;
    this.selectedHotbar = (((this.selectedHotbar + delta) % n) + n) % n;
  }

  selectedStack(): ItemStack | null {
    return this.getSlot(this.selectedHotbar);
  }

  /** Takes `amount` (default 1) from the currently selected hotbar slot. */
  takeFromSelected(amount = 1): ItemStack | null {
    return this.take(this.selectedHotbar, amount);
  }

  /**
   * Adds `amount` of wear to the currently selected slot's tool.
   * - Empty slot or non-tool item: no-op, returns 'none'.
   * - Tool whose new damage reaches its maxDurability: the slot becomes
   *   empty (the tool breaks), returns 'broken'.
   * - Otherwise: the slot holds a new stack with the added damage, returns 'damaged'.
   */
  damageSelected(amount: number, registry: ItemRegistry = this.registry): 'none' | 'damaged' | 'broken' {
    const stack = this.getSlot(this.selectedHotbar);
    if (stack === null) {
      return 'none';
    }
    const maxDurability = registry.maxDurability(stack.itemId);
    if (maxDurability === undefined) {
      return 'none';
    }

    const newDamage = (stack.damage ?? 0) + amount;
    if (newDamage >= maxDurability) {
      this.slotStacks[this.selectedHotbar] = null;
      return 'broken';
    }

    this.slotStacks[this.selectedHotbar] = createStack(stack.itemId, stack.count, registry, newDamage);
    return 'damaged';
  }

  clear(): void {
    this.slotStacks.fill(null);
  }
}
