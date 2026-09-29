import { describe, it, expect } from 'vitest';
import { Inventory } from '../src/items/Inventory';
import { createStack } from '../src/items/ItemStack';
import { ItemId } from '../src/items/items';
import { itemRegistry } from '../src/items/ItemRegistry';
import { TOOL_CONFIG } from '../src/config/constants';

describe('Inventory construction', () => {
  it('starts empty with default 36 slots / 9 hotbar', () => {
    const inv = new Inventory();
    expect(inv.size).toBe(36);
    expect(inv.hotbarSize).toBe(9);
    for (let i = 0; i < inv.size; i++) {
      expect(inv.getSlot(i)).toBeNull();
      expect(inv.isEmpty(i)).toBe(true);
    }
  });

  it('throws RangeError when hotbarSize > slotCount', () => {
    expect(() => new Inventory(undefined, 5, 9)).toThrow(RangeError);
  });

  it('getSlot throws RangeError for invalid index', () => {
    const inv = new Inventory();
    expect(() => inv.getSlot(-1)).toThrow(RangeError);
    expect(() => inv.getSlot(36)).toThrow(RangeError);
    expect(() => inv.getSlot(1.5)).toThrow(RangeError);
  });
});

describe('Inventory.add', () => {
  it('fills slot 0 when adding to an empty inventory', () => {
    const inv = new Inventory();
    const leftover = inv.add(createStack(ItemId.Stone, 10));
    expect(leftover).toBeNull();
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 10 });
  });

  it('merges into an existing partial stack before using empty slots', () => {
    const inv = new Inventory();
    // Put a partial stack of stone into main inventory slot 9, leave hotbar slot 0 empty.
    inv.set(9, createStack(ItemId.Stone, 5));
    const leftover = inv.add(createStack(ItemId.Stone, 10));
    expect(leftover).toBeNull();
    expect(inv.getSlot(9)).toEqual({ itemId: ItemId.Stone, count: 15 });
    expect(inv.getSlot(0)).toBeNull();
  });

  it('overflows across multiple slots (100 stone -> 64 + 36)', () => {
    const inv = new Inventory();
    const leftover = inv.add({ itemId: ItemId.Stone, count: 100 });
    expect(leftover).toBeNull();
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 64 });
    expect(inv.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 36 });
  });

  it('returns leftover stack of a different item when inventory is full', () => {
    const inv = new Inventory();
    for (let i = 0; i < inv.size; i++) {
      inv.set(i, createStack(ItemId.Dirt, 64));
    }
    const leftover = inv.add(createStack(ItemId.Stone, 10));
    expect(leftover).toEqual({ itemId: ItemId.Stone, count: 10 });
  });

  it('returns leftover of the same item when inventory is full of maxed stacks', () => {
    const inv = new Inventory();
    for (let i = 0; i < inv.size; i++) {
      inv.set(i, createStack(ItemId.Dirt, 64));
    }
    const leftover = inv.add(createStack(ItemId.Dirt, 5));
    expect(leftover).toEqual({ itemId: ItemId.Dirt, count: 5 });
  });

  it('is deterministic: merge order is slot order (hotbar first)', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 60));
    inv.set(10, createStack(ItemId.Stone, 60));
    const leftover = inv.add(createStack(ItemId.Stone, 8));
    expect(leftover).toBeNull();
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 64 });
    expect(inv.getSlot(10)).toEqual({ itemId: ItemId.Stone, count: 64 });
  });
});

describe('Inventory.canAdd', () => {
  it('returns true when the stack fits, without mutating', () => {
    const inv = new Inventory();
    expect(inv.canAdd({ itemId: ItemId.Stone, count: 100 })).toBe(true);
    expect(inv.getSlot(0)).toBeNull();
  });

  it('returns false when the stack does not fit, without mutating', () => {
    const inv = new Inventory();
    for (let i = 0; i < inv.size; i++) {
      inv.set(i, createStack(ItemId.Dirt, 64));
    }
    expect(inv.canAdd(createStack(ItemId.Stone, 1))).toBe(false);
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Dirt, count: 64 });
  });

  it('accounts for existing partial stacks of the same item', () => {
    const inv = new Inventory();
    for (let i = 0; i < inv.size; i++) {
      inv.set(i, createStack(ItemId.Dirt, 63));
    }
    expect(inv.canAdd(createStack(ItemId.Dirt, inv.size))).toBe(true);
    expect(inv.canAdd(createStack(ItemId.Dirt, inv.size + 1))).toBe(false);
  });
});

describe('Inventory.take', () => {
  it('takes the whole stack by default', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    const taken = inv.take(0);
    expect(taken).toEqual({ itemId: ItemId.Stone, count: 10 });
    expect(inv.getSlot(0)).toBeNull();
  });

  it('takes a partial amount, leaving the rest', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    const taken = inv.take(0, 4);
    expect(taken).toEqual({ itemId: ItemId.Stone, count: 4 });
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 6 });
  });

  it('returns null when taking from an empty slot', () => {
    const inv = new Inventory();
    expect(inv.take(0)).toBeNull();
    expect(inv.take(0, 3)).toBeNull();
  });

  it('throws RangeError for an invalid amount', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    expect(() => inv.take(0, 0)).toThrow(RangeError);
    expect(() => inv.take(0, 11)).toThrow(RangeError);
    expect(() => inv.take(0, 1.5)).toThrow(RangeError);
  });
});

describe('Inventory.takeHalf', () => {
  it('splits an even stack evenly', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    const taken = inv.takeHalf(0);
    expect(taken).toEqual({ itemId: ItemId.Stone, count: 5 });
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 5 });
  });

  it('rounds up (ceil) for an odd stack', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 7));
    const taken = inv.takeHalf(0);
    expect(taken).toEqual({ itemId: ItemId.Stone, count: 4 });
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 3 });
  });

  it('takes the whole stack for a single-item stack, leaving slot empty', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 1));
    const taken = inv.takeHalf(0);
    expect(taken).toEqual({ itemId: ItemId.Stone, count: 1 });
    expect(inv.getSlot(0)).toBeNull();
  });

  it('returns null for an empty slot', () => {
    const inv = new Inventory();
    expect(inv.takeHalf(0)).toBeNull();
  });
});

describe('Inventory.set', () => {
  it('sets a valid stack', () => {
    const inv = new Inventory();
    inv.set(5, createStack(ItemId.Stone, 20));
    expect(inv.getSlot(5)).toEqual({ itemId: ItemId.Stone, count: 20 });
  });

  it('clears a slot when passed null', () => {
    const inv = new Inventory();
    inv.set(5, createStack(ItemId.Stone, 20));
    inv.set(5, null);
    expect(inv.getSlot(5)).toBeNull();
  });

  it('throws for an unregistered item id', () => {
    const inv = new Inventory();
    expect(() => inv.set(0, { itemId: 9999 as ItemId, count: 1 })).toThrow(RangeError);
  });

  it('throws for an invalid count', () => {
    const inv = new Inventory();
    expect(() => inv.set(0, { itemId: ItemId.Stone, count: 0 })).toThrow(RangeError);
    expect(() => inv.set(0, { itemId: ItemId.Stone, count: 65 })).toThrow(RangeError);
  });

  it('throws RangeError for an invalid slot index', () => {
    const inv = new Inventory();
    expect(() => inv.set(-1, null)).toThrow(RangeError);
    expect(() => inv.set(36, null)).toThrow(RangeError);
  });
});

describe('Inventory.move', () => {
  it('moves a stack into an empty slot', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    inv.move(0, 1);
    expect(inv.getSlot(0)).toBeNull();
    expect(inv.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 10 });
  });

  it('merges same-item stacks fully, emptying the source', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    inv.set(1, createStack(ItemId.Stone, 20));
    inv.move(0, 1);
    expect(inv.getSlot(0)).toBeNull();
    expect(inv.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 30 });
  });

  it('merges same-item stacks partially, leaving remainder in source', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 40));
    inv.set(1, createStack(ItemId.Stone, 40));
    inv.move(0, 1);
    expect(inv.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 64 });
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 16 });
  });

  it('swaps different items', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    inv.set(1, createStack(ItemId.Dirt, 5));
    inv.move(0, 1);
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Dirt, count: 5 });
    expect(inv.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 10 });
  });

  it('is a no-op when the source slot is empty', () => {
    const inv = new Inventory();
    inv.set(1, createStack(ItemId.Dirt, 5));
    inv.move(0, 1);
    expect(inv.getSlot(0)).toBeNull();
    expect(inv.getSlot(1)).toEqual({ itemId: ItemId.Dirt, count: 5 });
  });

  it('is a no-op when from === to', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    inv.move(0, 0);
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 10 });
  });

  it('throws RangeError for invalid indices', () => {
    const inv = new Inventory();
    expect(() => inv.move(-1, 0)).toThrow(RangeError);
    expect(() => inv.move(0, 36)).toThrow(RangeError);
  });
});

describe('Inventory item queries', () => {
  it('countItem sums across slots', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    inv.set(5, createStack(ItemId.Stone, 20));
    inv.set(1, createStack(ItemId.Dirt, 99 % 64));
    expect(inv.countItem(ItemId.Stone)).toBe(30);
  });

  it('removeItem removes partial amounts across multiple stacks in reverse slot order', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    inv.set(5, createStack(ItemId.Stone, 20));
    const removed = inv.removeItem(ItemId.Stone, 25);
    expect(removed).toBe(25);
    // Reverse order: slot 5 (count 20) consumed first, then 5 more from slot 0.
    expect(inv.getSlot(5)).toBeNull();
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 5 });
  });

  it('removeItem returns the actual amount removed when requesting more than available', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    const removed = inv.removeItem(ItemId.Stone, 100);
    expect(removed).toBe(10);
    expect(inv.getSlot(0)).toBeNull();
  });

  it('removeItem consumes main-inventory stacks before hotbar stacks (reverse slot order)', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10)); // hotbar slot
    inv.set(20, createStack(ItemId.Stone, 10)); // main inventory slot
    const removed = inv.removeItem(ItemId.Stone, 10);
    expect(removed).toBe(10);
    expect(inv.getSlot(20)).toBeNull();
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 10 });
  });

  it('hasItem reflects countItem threshold', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    expect(inv.hasItem(ItemId.Stone, 10)).toBe(true);
    expect(inv.hasItem(ItemId.Stone, 11)).toBe(false);
  });
});

describe('Inventory hotbar selection', () => {
  it('starts at index 0', () => {
    const inv = new Inventory();
    expect(inv.selectedHotbarIndex).toBe(0);
  });

  it('selectHotbar sets a valid index', () => {
    const inv = new Inventory();
    inv.selectHotbar(5);
    expect(inv.selectedHotbarIndex).toBe(5);
  });

  it('selectHotbar throws RangeError for an out-of-range index', () => {
    const inv = new Inventory();
    expect(() => inv.selectHotbar(9)).toThrow(RangeError);
    expect(() => inv.selectHotbar(-1)).toThrow(RangeError);
  });

  it('scrollHotbar wraps forward past the end', () => {
    const inv = new Inventory();
    inv.selectHotbar(8);
    inv.scrollHotbar(1);
    expect(inv.selectedHotbarIndex).toBe(0);
  });

  it('scrollHotbar wraps backward past the start', () => {
    const inv = new Inventory();
    inv.selectHotbar(0);
    inv.scrollHotbar(-1);
    expect(inv.selectedHotbarIndex).toBe(8);
  });

  it('scrollHotbar wraps correctly for large positive deltas', () => {
    const inv = new Inventory();
    inv.selectHotbar(0);
    inv.scrollHotbar(19); // 19 % 9 = 1
    expect(inv.selectedHotbarIndex).toBe(1);
  });

  it('scrollHotbar wraps correctly for large negative deltas', () => {
    const inv = new Inventory();
    inv.selectHotbar(0);
    inv.scrollHotbar(-10); // -10 mod 9 = 8
    expect(inv.selectedHotbarIndex).toBe(8);
  });

  it('selectedStack returns the stack in the selected hotbar slot', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    expect(inv.selectedStack()).toEqual({ itemId: ItemId.Stone, count: 10 });
    expect(inv.selectedStack()).not.toBeNull();
  });

  it('takeFromSelected decrements and empties the slot when exhausted', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 1));
    const taken = inv.takeFromSelected();
    expect(taken).toEqual({ itemId: ItemId.Stone, count: 1 });
    expect(inv.getSlot(0)).toBeNull();
  });

  it('takeFromSelected decrements a larger stack by the default amount of 1', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 5));
    const taken = inv.takeFromSelected();
    expect(taken).toEqual({ itemId: ItemId.Stone, count: 1 });
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 4 });
  });
});

describe('Inventory immutability', () => {
  it('add does not mutate a frozen input stack', () => {
    const inv = new Inventory();
    const input = Object.freeze(createStack(ItemId.Stone, 10));
    inv.add(input);
    expect(input.count).toBe(10);
  });

  it('stacks returned by take are not aliased to internal state after further mutation', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    const taken = inv.take(0, 4);
    // Mutate the inventory further; the previously taken stack must be unaffected.
    inv.add(createStack(ItemId.Stone, 50));
    expect(taken).toEqual({ itemId: ItemId.Stone, count: 4 });
  });
});

describe('Inventory determinism', () => {
  it('produces identical slots for the same sequence of operations on two inventories', () => {
    const a = new Inventory();
    const b = new Inventory();

    const ops = (inv: Inventory): void => {
      inv.add({ itemId: ItemId.Stone, count: 100 });
      inv.add(createStack(ItemId.Dirt, 40));
      inv.move(0, 2);
      inv.take(1, 10);
      inv.selectHotbar(3);
      inv.scrollHotbar(-2);
      inv.removeItem(ItemId.Stone, 15);
    };

    ops(a);
    ops(b);

    expect(a.slots()).toEqual(b.slots());
    expect(a.selectedHotbarIndex).toBe(b.selectedHotbarIndex);
  });
});

describe('Inventory.clear', () => {
  it('empties all slots', () => {
    const inv = new Inventory();
    inv.add({ itemId: ItemId.Stone, count: 100 });
    inv.clear();
    for (let i = 0; i < inv.size; i++) {
      expect(inv.getSlot(i)).toBeNull();
    }
  });
});

describe('Inventory.damageSelected', () => {
  it('returns "none" for an empty selected slot', () => {
    const inv = new Inventory();
    expect(inv.damageSelected(1)).toBe('none');
  });

  it('returns "none" for a non-tool selected item and leaves it unchanged', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 10));
    expect(inv.damageSelected(1)).toBe('none');
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 10 });
  });

  it('damages a selected tool, returns "damaged"', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1));
    expect(inv.damageSelected(1)).toBe('damaged');
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 1 });
  });

  it('accumulates damage across repeated calls', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1));
    inv.damageSelected(1);
    inv.damageSelected(1);
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 2 });
  });

  it('breaks the tool (empties the slot) once damage reaches maxDurability', () => {
    const inv = new Inventory();
    const maxDurability = TOOL_CONFIG.durability.wood;
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1, itemRegistry, maxDurability - 1));
    expect(inv.damageSelected(1)).toBe('broken');
    expect(inv.getSlot(0)).toBeNull();
  });

  it('follows the currently selected hotbar slot, not slot 0', () => {
    const inv = new Inventory();
    inv.set(3, createStack(ItemId.WoodenAxe, 1));
    inv.selectHotbar(3);
    expect(inv.damageSelected(1)).toBe('damaged');
    expect(inv.getSlot(3)).toEqual({ itemId: ItemId.WoodenAxe, count: 1, damage: 1 });
  });
});

describe('Inventory preserves tool damage across internal operations', () => {
  it('move: merging is a no-op for tools (maxStack 1), swap preserves damage on both sides', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 5));
    inv.set(1, createStack(ItemId.Stone, 10));
    inv.move(0, 1); // different items -> swap
    expect(inv.getSlot(1)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 5 });
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 10 });
  });

  it('take preserves damage on the taken stack', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 7));
    const taken = inv.take(0);
    expect(taken).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 7 });
    expect(inv.getSlot(0)).toBeNull();
  });

  it('takeFromSelected preserves damage', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 12));
    const taken = inv.takeFromSelected();
    expect(taken).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 12 });
  });

  it('set validates and preserves a damaged tool stack', () => {
    const inv = new Inventory();
    inv.set(0, { itemId: ItemId.WoodenPickaxe, count: 1, damage: 20 });
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 20 });
  });

  it('set throws for an invalid damage value', () => {
    const inv = new Inventory();
    const maxDurability = TOOL_CONFIG.durability.wood;
    expect(() => inv.set(0, { itemId: ItemId.WoodenPickaxe, count: 1, damage: maxDurability })).toThrow(
      RangeError,
    );
  });

  it('add preserves damage when placing a damaged tool into an empty slot', () => {
    const inv = new Inventory();
    const leftover = inv.add(createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 9));
    expect(leftover).toBeNull();
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 9 });
  });

  it('removeItem does not touch tool slots differently (count-based) and damage is irrelevant to removal amount', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 30));
    const removed = inv.removeItem(ItemId.WoodenPickaxe, 1);
    expect(removed).toBe(1);
    expect(inv.getSlot(0)).toBeNull();
  });
});
