import { describe, it, expect } from 'vitest';
import {
  createStack,
  canStack,
  mergeStacks,
  splitStack,
  splitHalf,
  durabilityFraction,
} from '../src/items/ItemStack';
import { ItemId } from '../src/items/items';
import { itemRegistry } from '../src/items/ItemRegistry';
import { TOOL_CONFIG } from '../src/config/constants';

describe('createStack', () => {
  it('creates a valid stack', () => {
    const stack = createStack(ItemId.Stone, 10);
    expect(stack.itemId).toBe(ItemId.Stone);
    expect(stack.count).toBe(10);
  });

  it('throws for ItemId.None (0)', () => {
    expect(() => createStack(ItemId.None as unknown as ItemId, 1)).toThrow(RangeError);
  });

  it('throws for an unknown item id', () => {
    expect(() => createStack(9999 as unknown as ItemId, 1)).toThrow(RangeError);
  });

  it('throws when count is not an integer', () => {
    expect(() => createStack(ItemId.Stone, 1.5)).toThrow(RangeError);
  });

  it('throws when count is 0', () => {
    expect(() => createStack(ItemId.Stone, 0)).toThrow(RangeError);
  });

  it('throws when count is negative', () => {
    expect(() => createStack(ItemId.Stone, -5)).toThrow(RangeError);
  });

  it('throws when count exceeds maxStackSize', () => {
    expect(() => createStack(ItemId.Stone, 65)).toThrow(RangeError);
  });

  it('creates a stack with maxStackSize', () => {
    const stack = createStack(ItemId.Stone, 64);
    expect(stack.count).toBe(64);
  });
});

describe('canStack', () => {
  it('returns true for identical items', () => {
    const a = createStack(ItemId.Stone, 10);
    const b = createStack(ItemId.Stone, 20);
    expect(canStack(a, b)).toBe(true);
  });

  it('returns false for different items', () => {
    const a = createStack(ItemId.Stone, 10);
    const b = createStack(ItemId.Dirt, 20);
    expect(canStack(a, b)).toBe(false);
  });

  it('returns true for the same tool item with equal damage (both undefined)', () => {
    const a = createStack(ItemId.WoodenPickaxe, 1);
    const b = createStack(ItemId.WoodenPickaxe, 1);
    expect(canStack(a, b)).toBe(true);
  });

  it('returns true when damage 0 (explicit) equals damage undefined', () => {
    const a = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 0);
    const b = createStack(ItemId.WoodenPickaxe, 1);
    expect(canStack(a, b)).toBe(true);
  });

  it('returns false for the same tool item with different damage (regression: no silent merge)', () => {
    const a = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 5);
    const b = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 10);
    expect(canStack(a, b)).toBe(false);
  });

  it('returns false for undamaged vs damaged of the same tool', () => {
    const a = createStack(ItemId.WoodenPickaxe, 1);
    const b = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 3);
    expect(canStack(a, b)).toBe(false);
  });
});

describe('createStack damage validation', () => {
  it('omits the damage key when damage is 0 (default)', () => {
    const stack = createStack(ItemId.WoodenPickaxe, 1);
    expect(stack.damage).toBeUndefined();
    expect('damage' in stack).toBe(false);
  });

  it('omits the damage key when damage is explicitly 0', () => {
    const stack = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 0);
    expect('damage' in stack).toBe(false);
  });

  it('stores a positive damage value for a tool', () => {
    const stack = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 10);
    expect(stack.damage).toBe(10);
  });

  it('throws when damage is set on a non-tool item', () => {
    expect(() => createStack(ItemId.Stone, 10, itemRegistry, 1)).toThrow(RangeError);
  });

  it('throws when damage is negative', () => {
    expect(() => createStack(ItemId.WoodenPickaxe, 1, itemRegistry, -1)).toThrow(RangeError);
  });

  it('throws when damage is not an integer', () => {
    expect(() => createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 1.5)).toThrow(RangeError);
  });

  it('throws when damage equals maxDurability (tool is already broken)', () => {
    const maxDurability = TOOL_CONFIG.durability.wood;
    expect(() => createStack(ItemId.WoodenPickaxe, 1, itemRegistry, maxDurability)).toThrow(RangeError);
  });

  it('throws when damage exceeds maxDurability', () => {
    const maxDurability = TOOL_CONFIG.durability.wood;
    expect(() => createStack(ItemId.WoodenPickaxe, 1, itemRegistry, maxDurability + 5)).toThrow(RangeError);
  });

  it('accepts damage at maxDurability - 1 (last usable state)', () => {
    const maxDurability = TOOL_CONFIG.durability.wood;
    const stack = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, maxDurability - 1);
    expect(stack.damage).toBe(maxDurability - 1);
  });
});

describe('durabilityFraction', () => {
  it('returns null for a non-tool item', () => {
    const stack = createStack(ItemId.Stone, 10);
    expect(durabilityFraction(stack)).toBeNull();
  });

  it('returns 1 for a fresh (undamaged) tool', () => {
    const stack = createStack(ItemId.WoodenPickaxe, 1);
    expect(durabilityFraction(stack)).toBe(1);
  });

  it('returns the remaining fraction for a damaged tool', () => {
    const maxDurability = TOOL_CONFIG.durability.wood;
    const stack = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, maxDurability / 2);
    expect(durabilityFraction(stack)).toBeCloseTo(0.5, 6);
  });
});

describe('mergeStacks', () => {
  it('partially absorbs source into target with space available', () => {
    const target = createStack(ItemId.Stone, 40);
    const source = createStack(ItemId.Stone, 40);
    const result = mergeStacks(target, source);

    expect(result.merged.count).toBe(64);
    expect(result.remainder?.count).toBe(16);
  });

  it('fully absorbs source into target', () => {
    const target = createStack(ItemId.Stone, 59);
    const source = createStack(ItemId.Stone, 5);
    const result = mergeStacks(target, source);

    expect(result.merged.count).toBe(64);
    expect(result.remainder).toBeNull();
  });

  it('leaves remainder null when source is fully absorbed', () => {
    const target = createStack(ItemId.Stone, 10);
    const source = createStack(ItemId.Stone, 5);
    const result = mergeStacks(target, source);

    expect(result.merged.count).toBe(15);
    expect(result.remainder).toBeNull();
  });

  it('does not move anything when target is full', () => {
    const target = createStack(ItemId.Stone, 64);
    const source = createStack(ItemId.Stone, 10);
    const result = mergeStacks(target, source);

    expect(result.merged).toBe(target);
    expect(result.remainder).toBe(source);
  });

  it('throws when items differ', () => {
    const target = createStack(ItemId.Stone, 10);
    const source = createStack(ItemId.Dirt, 10);
    expect(() => mergeStacks(target, source)).toThrow();
  });

  it('throws when the same item has different damage (tools never silently merge)', () => {
    const target = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 5);
    const source = createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 10);
    expect(() => mergeStacks(target, source)).toThrow();
  });

  it('tool merge is a no-op (maxStackSize 1): target unchanged, source is the remainder', () => {
    const target = createStack(ItemId.WoodenAxe, 1, itemRegistry, 4);
    const source = createStack(ItemId.WoodenAxe, 1, itemRegistry, 4);
    const result = mergeStacks(target, source);
    expect(result.merged).toBe(target);
    expect(result.merged.damage).toBe(4);
    expect(result.remainder).toBe(source);
  });

  it('carries a damage field through the merge arithmetic on target and remainder', () => {
    // mergeStacks itself is damage-agnostic arithmetic; construct stacks
    // directly (bypassing createStack's tool-only damage rule) to verify the
    // merged/remainder count math still preserves whatever damage was present.
    const target = { itemId: ItemId.Stone, count: 40, damage: 0 };
    const source = { itemId: ItemId.Stone, count: 40, damage: 0 };
    const result = mergeStacks(target, source);
    expect(result.merged).toEqual({ itemId: ItemId.Stone, count: 64, damage: 0 });
    expect(result.remainder).toEqual({ itemId: ItemId.Stone, count: 16, damage: 0 });
  });

  it('does not mutate inputs', () => {
    const target = Object.freeze(createStack(ItemId.Stone, 40));
    const source = Object.freeze(createStack(ItemId.Stone, 40));

    const result = mergeStacks(target, source);

    expect(target.count).toBe(40);
    expect(source.count).toBe(40);
    expect(result.merged.count).toBe(64);
  });
});

describe('splitStack', () => {
  it('splits stack by specific amount', () => {
    const stack = createStack(ItemId.Stone, 10);
    const result = splitStack(stack, 3);

    expect(result.taken.count).toBe(3);
    expect(result.rest?.count).toBe(7);
  });

  it('takes the entire stack when amount equals count', () => {
    const stack = createStack(ItemId.Stone, 10);
    const result = splitStack(stack, 10);

    expect(result.taken.count).toBe(10);
    expect(result.rest).toBeNull();
  });

  it('throws when amount is 0', () => {
    const stack = createStack(ItemId.Stone, 10);
    expect(() => splitStack(stack, 0)).toThrow(RangeError);
  });

  it('throws when amount exceeds stack count', () => {
    const stack = createStack(ItemId.Stone, 10);
    expect(() => splitStack(stack, 11)).toThrow(RangeError);
  });

  it('throws when amount is not an integer', () => {
    const stack = createStack(ItemId.Stone, 10);
    expect(() => splitStack(stack, 1.5)).toThrow(RangeError);
  });

  it('does not mutate inputs', () => {
    const stack = Object.freeze(createStack(ItemId.Stone, 10));
    const result = splitStack(stack, 3);

    expect(stack.count).toBe(10);
    expect(result.taken.count).toBe(3);
    expect(result.rest?.count).toBe(7);
  });

  it('carries the damage field through to both taken and rest', () => {
    const stack = { itemId: ItemId.Stone, count: 10, damage: 7 };
    const result = splitStack(stack, 3);
    expect(result.taken).toEqual({ itemId: ItemId.Stone, count: 3, damage: 7 });
    expect(result.rest).toEqual({ itemId: ItemId.Stone, count: 7, damage: 7 });
  });

  it('leaves the damage key omitted when the source stack has none', () => {
    const stack = createStack(ItemId.Stone, 10);
    const result = splitStack(stack, 4);
    expect(result.taken.damage).toBeUndefined();
    expect(result.rest?.damage).toBeUndefined();
  });
});

describe('splitHalf', () => {
  it('splits 10 into 5 and 5', () => {
    const stack = createStack(ItemId.Stone, 10);
    const result = splitHalf(stack);

    expect(result.taken.count).toBe(5);
    expect(result.rest?.count).toBe(5);
  });

  it('splits 7 into 4 and 3 (ceil behavior)', () => {
    const stack = createStack(ItemId.Stone, 7);
    const result = splitHalf(stack);

    expect(result.taken.count).toBe(4);
    expect(result.rest?.count).toBe(3);
  });

  it('moves all of a single-item stack', () => {
    const stack = createStack(ItemId.Stone, 1);
    const result = splitHalf(stack);

    expect(result.taken.count).toBe(1);
    expect(result.rest).toBeNull();
  });

  it('does not mutate inputs', () => {
    const stack = Object.freeze(createStack(ItemId.Stone, 10));
    const result = splitHalf(stack);

    expect(stack.count).toBe(10);
    expect(result.taken.count).toBe(5);
  });
});
