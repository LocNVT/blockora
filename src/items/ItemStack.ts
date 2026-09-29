import type { ItemId } from './items';
import { itemRegistry } from './ItemRegistry';

export interface ItemStack {
  readonly itemId: ItemId;
  readonly count: number;
  /** Uses accumulated toward the item's maxDurability (tools only). Omitted (undefined) means 0/new. */
  readonly damage?: number;
}

/** Normalizes an optional damage value to a concrete number (undefined -> 0). */
function normalizeDamage(damage: number | undefined): number {
  return damage ?? 0;
}

/**
 * Creates an ItemStack with validation.
 * @throws RangeError if the itemId is not registered, count is invalid, or damage is invalid
 */
export function createStack(
  itemId: ItemId,
  count: number,
  registry = itemRegistry,
  damage = 0,
): ItemStack {
  if (!registry.has(itemId)) {
    throw new RangeError(`ItemStack: unknown item id ${itemId}.`);
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`ItemStack: count must be a positive integer, got ${count}.`);
  }
  const maxStack = registry.maxStackSize(itemId);
  if (count > maxStack) {
    throw new RangeError(
      `ItemStack: count ${count} exceeds max stack size ${maxStack} for item ${itemId}.`,
    );
  }

  const normalizedDamage = normalizeDamage(damage);
  if (normalizedDamage !== 0) {
    const maxDurability = registry.maxDurability(itemId);
    if (maxDurability === undefined) {
      throw new RangeError(`ItemStack: item ${itemId} is not a tool and cannot have damage.`);
    }
    if (!Number.isInteger(normalizedDamage) || normalizedDamage < 0 || normalizedDamage >= maxDurability) {
      throw new RangeError(
        `ItemStack: damage must be an integer between 0 and ${maxDurability - 1} for item ${itemId}, got ${normalizedDamage}.`,
      );
    }
    return { itemId, count, damage: normalizedDamage };
  }

  return { itemId, count };
}

/**
 * Returns true if two stacks contain the same item and the same damage
 * (undefined normalised to 0). Tools stack to 1 anyway, but this keeps two
 * differently-worn tools from silently merging if stack sizes ever change.
 */
export function canStack(a: ItemStack, b: ItemStack): boolean {
  return a.itemId === b.itemId && normalizeDamage(a.damage) === normalizeDamage(b.damage);
}

/**
 * Merges source stack into target stack, moving as much as possible.
 * @throws Error if the stacks cannot stack (different itemIds or damage)
 * @returns { merged, remainder } — merged is the target after absorbing as much of source as fits;
 *          remainder is what's left over (null if source was fully absorbed)
 */
export function mergeStacks(
  target: ItemStack,
  source: ItemStack,
  registry = itemRegistry,
): { merged: ItemStack; remainder: ItemStack | null } {
  if (!canStack(target, source)) {
    throw new Error(
      `ItemStack: cannot merge stacks with different items or damage (${target.itemId}/${normalizeDamage(target.damage)} vs ${source.itemId}/${normalizeDamage(source.damage)}).`,
    );
  }

  const maxStack = registry.maxStackSize(target.itemId);
  const availableSpace = maxStack - target.count;

  if (availableSpace <= 0) {
    // Target is full, nothing moves
    return { merged: target, remainder: source };
  }

  const amountToMove = Math.min(availableSpace, source.count);
  const merged: ItemStack =
    target.damage !== undefined
      ? { itemId: target.itemId, count: target.count + amountToMove, damage: target.damage }
      : { itemId: target.itemId, count: target.count + amountToMove };

  const remainingCount = source.count - amountToMove;
  const remainder: ItemStack | null =
    remainingCount > 0
      ? source.damage !== undefined
        ? { itemId: source.itemId, count: remainingCount, damage: source.damage }
        : { itemId: source.itemId, count: remainingCount }
      : null;

  return { merged, remainder };
}

/**
 * Splits a stack into a taken portion and a rest.
 * @param amount integer 1..stack.count
 * @throws RangeError if amount is invalid
 * @returns { taken, rest } — rest is null if amount === count
 */
export function splitStack(
  stack: ItemStack,
  amount: number,
): { taken: ItemStack; rest: ItemStack | null } {
  if (!Number.isInteger(amount) || amount < 1 || amount > stack.count) {
    throw new RangeError(
      `ItemStack: split amount must be an integer between 1 and ${stack.count}, got ${amount}.`,
    );
  }

  const taken: ItemStack =
    stack.damage !== undefined
      ? { itemId: stack.itemId, count: amount, damage: stack.damage }
      : { itemId: stack.itemId, count: amount };

  const rest: ItemStack | null =
    amount === stack.count
      ? null
      : stack.damage !== undefined
        ? { itemId: stack.itemId, count: stack.count - amount, damage: stack.damage }
        : { itemId: stack.itemId, count: stack.count - amount };

  return { taken, rest };
}

/**
 * Splits a stack roughly in half.
 * @returns { taken, rest } — taken = ceil(count/2); rest is null if the stack had count 1
 */
export function splitHalf(
  stack: ItemStack,
): { taken: ItemStack; rest: ItemStack | null } {
  const takenAmount = Math.ceil(stack.count / 2);
  return splitStack(stack, takenAmount);
}

/**
 * Fraction of durability remaining (1 = undamaged, 0 = about to break), or
 * null if `stack`'s item is not a tool.
 */
export function durabilityFraction(stack: ItemStack, registry = itemRegistry): number | null {
  const maxDurability = registry.maxDurability(stack.itemId);
  if (maxDurability === undefined) {
    return null;
  }
  const damage = normalizeDamage(stack.damage);
  return Math.max(0, Math.min(1, (maxDurability - damage) / maxDurability));
}
