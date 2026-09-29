import type { Inventory } from './Inventory';
import type { CraftingGrid } from '../crafting/CraftingGrid';
import { recipeRegistry, type RecipeRegistry } from '../crafting/RecipeRegistry';
import { itemRegistry, type ItemRegistry } from './ItemRegistry';
import type { ItemStack } from './ItemStack';
import { mergeStacks, splitHalf } from './ItemStack';

/** Identifies one clickable slot across the inventory, crafting grid, and result preview. */
export type SlotRef =
  | { readonly area: 'inventory'; readonly index: number }
  | { readonly area: 'grid'; readonly index: number }
  | { readonly area: 'result' };

export type ClickButton = 'primary' | 'secondary';

/**
 * Pure interaction logic for an open inventory/crafting screen: mouse-driven
 * pick-up/place/merge/swap semantics plus crafting-result handling. No DOM,
 * no rendering — the UI layer only calls `click()`/`resultPreview()` and
 * renders whatever state results.
 */
export class ContainerSession {
  private heldCursor: ItemStack | null = null;

  constructor(
    private readonly inventory: Inventory,
    private readonly grid: CraftingGrid,
    private readonly recipes: RecipeRegistry = recipeRegistry,
    private readonly itemReg: ItemRegistry = itemRegistry,
  ) {}

  getCursor(): ItemStack | null {
    return this.heldCursor;
  }

  /** The crafting result the current grid contents would produce, or null. */
  resultPreview(): ItemStack | null {
    return this.recipes.match(this.grid.view())?.result ?? null;
  }

  /**
   * Reads the current contents of any slot (inventory, grid, or the crafting
   * result preview) without mutating anything. Lets the UI layer render
   * every slot through the session alone, with no direct reference to the
   * underlying Inventory/CraftingGrid.
   */
  getSlot(ref: SlotRef): ItemStack | null {
    if (ref.area === 'result') {
      return this.resultPreview();
    }
    return this.readSlot(ref);
  }

  click(ref: SlotRef, button: ClickButton): void {
    if (ref.area === 'result') {
      this.clickResult();
      return;
    }

    const slotValue = this.readSlot(ref);
    if (button === 'primary') {
      this.primaryClick(ref, slotValue);
    } else {
      this.secondaryClick(ref, slotValue);
    }
  }

  private readSlot(ref: Exclude<SlotRef, { area: 'result' }>): ItemStack | null {
    return ref.area === 'inventory' ? this.inventory.getSlot(ref.index) : this.grid.get(ref.index);
  }

  private setSlot(ref: Exclude<SlotRef, { area: 'result' }>, stack: ItemStack | null): void {
    if (ref.area === 'inventory') {
      this.inventory.set(ref.index, stack);
    } else {
      this.grid.set(ref.index, stack);
    }
  }

  private primaryClick(ref: Exclude<SlotRef, { area: 'result' }>, slot: ItemStack | null): void {
    const cursor = this.heldCursor;

    if (cursor === null) {
      // Pick up the whole slot.
      if (slot !== null) {
        this.heldCursor = slot;
        this.setSlot(ref, null);
      }
      return;
    }

    if (slot === null) {
      // Place the whole cursor.
      this.setSlot(ref, cursor);
      this.heldCursor = null;
      return;
    }

    if (slot.itemId === cursor.itemId) {
      // Merge cursor into slot; remainder (if any) stays on the cursor.
      const { merged, remainder } = mergeStacks(slot, cursor, this.itemReg);
      this.setSlot(ref, merged);
      this.heldCursor = remainder;
      return;
    }

    // Different items: swap.
    this.setSlot(ref, cursor);
    this.heldCursor = slot;
  }

  private secondaryClick(ref: Exclude<SlotRef, { area: 'result' }>, slot: ItemStack | null): void {
    const cursor = this.heldCursor;

    if (cursor === null) {
      // Pick up half (ceil) of the slot.
      if (slot !== null) {
        const { taken, rest } = splitHalf(slot);
        this.heldCursor = taken;
        this.setSlot(ref, rest);
      }
      return;
    }

    if (slot === null) {
      // Place exactly one.
      this.placeOne(ref, cursor);
      return;
    }

    if (slot.itemId === cursor.itemId) {
      const maxStack = this.itemReg.maxStackSize(slot.itemId);
      if (slot.count < maxStack) {
        this.placeOne(ref, cursor);
      }
      return;
    }

    // Different items: swap.
    this.setSlot(ref, cursor);
    this.heldCursor = slot;
  }

  /** Places exactly one unit of `cursor` into `ref`, whose slot is empty or holds the same item with room. */
  private placeOne(ref: Exclude<SlotRef, { area: 'result' }>, cursor: ItemStack): void {
    const existing = this.readSlot(ref);
    if (existing === null) {
      this.setSlot(
        ref,
        cursor.damage !== undefined
          ? { itemId: cursor.itemId, count: 1, damage: cursor.damage }
          : { itemId: cursor.itemId, count: 1 },
      );
    } else {
      this.setSlot(
        ref,
        existing.damage !== undefined
          ? { itemId: existing.itemId, count: existing.count + 1, damage: existing.damage }
          : { itemId: existing.itemId, count: existing.count + 1 },
      );
    }

    this.heldCursor =
      cursor.count > 1
        ? cursor.damage !== undefined
          ? { itemId: cursor.itemId, count: cursor.count - 1, damage: cursor.damage }
          : { itemId: cursor.itemId, count: cursor.count - 1 }
        : null;
  }

  private clickResult(): void {
    const preview = this.resultPreview();
    if (preview === null) {
      return;
    }

    const cursor = this.heldCursor;
    if (cursor !== null) {
      if (cursor.itemId !== preview.itemId) {
        return;
      }
      const maxStack = this.itemReg.maxStackSize(preview.itemId);
      if (cursor.count + preview.count > maxStack) {
        return;
      }
    }

    const crafted = this.grid.craft(this.recipes);
    if (crafted === null) {
      // Shouldn't happen given resultPreview() matched, but stay defensive/no-op.
      return;
    }

    if (cursor === null) {
      this.heldCursor = crafted;
    } else {
      const { merged, remainder } = mergeStacks(cursor, crafted, this.itemReg);
      // remainder is always null here: capacity was checked above.
      this.heldCursor = remainder ?? merged;
    }
  }

  /**
   * Closes the session: moves the cursor stack and all grid contents back
   * into the inventory (grid is cleared), in that order. Any stacks that
   * don't fit are passed to `dropLeftover`, one call per leftover stack, in a
   * deterministic order (cursor first, then grid cells in index order).
   */
  close(dropLeftover: (stack: ItemStack) => void): void {
    if (this.heldCursor !== null) {
      const leftover = this.inventory.add(this.heldCursor);
      if (leftover !== null) {
        dropLeftover(leftover);
      }
      this.heldCursor = null;
    }

    const gridContents = this.grid.clear();
    for (const stack of gridContents) {
      if (stack === null) {
        continue;
      }
      const leftover = this.inventory.add(stack);
      if (leftover !== null) {
        dropLeftover(leftover);
      }
    }
  }
}
