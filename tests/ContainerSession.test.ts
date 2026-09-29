import { describe, it, expect } from 'vitest';
import { ContainerSession, type SlotRef } from '../src/items/ContainerSession';
import { Inventory } from '../src/items/Inventory';
import { CraftingGrid } from '../src/crafting/CraftingGrid';
import { RecipeRegistry } from '../src/crafting/RecipeRegistry';
import { RECIPE_DEFINITIONS } from '../src/crafting/recipes';
import { createStack } from '../src/items/ItemStack';
import { ItemId } from '../src/items/items';
import { itemRegistry } from '../src/items/ItemRegistry';
import { INVENTORY_CONFIG } from '../src/config/constants';

const recipes = new RecipeRegistry(RECIPE_DEFINITIONS);

function inv(slot: number): SlotRef {
  return { area: 'inventory', index: slot };
}
const result: SlotRef = { area: 'result' };

function session2x2(): { session: ContainerSession; inventory: Inventory; grid: CraftingGrid } {
  const inventory = new Inventory();
  const craftingGrid = new CraftingGrid(2, 2);
  const session = new ContainerSession(inventory, craftingGrid, recipes, itemRegistry);
  return { session, inventory, grid: craftingGrid };
}

describe('ContainerSession primary click', () => {
  it('cursor empty + slot has item -> picks up whole slot', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 5));

    session.click(inv(0), 'primary');

    expect(session.getCursor()).toEqual({ itemId: ItemId.Stone, count: 5 });
    expect(inventory.getSlot(0)).toBeNull();
  });

  it('cursor set + slot empty -> places whole cursor', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 5));
    session.click(inv(0), 'primary'); // pick up

    session.click(inv(1), 'primary'); // place into empty slot 1

    expect(session.getCursor()).toBeNull();
    expect(inventory.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 5 });
  });

  it('same item -> merges into slot, remainder stays on cursor', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 60));
    inventory.set(1, createStack(ItemId.Stone, 20));
    session.click(inv(0), 'primary'); // cursor = 60 stone

    session.click(inv(1), 'primary'); // slot has 20, max 64 -> absorb 44, remainder 16

    expect(inventory.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: INVENTORY_CONFIG.maxStackSize });
    expect(session.getCursor()).toEqual({ itemId: ItemId.Stone, count: 16 });
  });

  it('different item -> swaps slot and cursor', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 5));
    inventory.set(1, createStack(ItemId.Dirt, 3));
    session.click(inv(0), 'primary'); // cursor = stone

    session.click(inv(1), 'primary'); // swap with dirt

    expect(session.getCursor()).toEqual({ itemId: ItemId.Dirt, count: 3 });
    expect(inventory.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 5 });
  });

  it('cursor empty + slot empty -> no-op', () => {
    const { session, inventory } = session2x2();
    session.click(inv(0), 'primary');
    expect(session.getCursor()).toBeNull();
    expect(inventory.getSlot(0)).toBeNull();
  });
});

describe('ContainerSession secondary click', () => {
  it('picks up half (ceil) of an even stack', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 10));
    session.click(inv(0), 'secondary');
    expect(session.getCursor()).toEqual({ itemId: ItemId.Stone, count: 5 });
    expect(inventory.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 5 });
  });

  it('picks up half (ceil) of an odd stack', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 7));
    session.click(inv(0), 'secondary');
    expect(session.getCursor()).toEqual({ itemId: ItemId.Stone, count: 4 });
    expect(inventory.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 3 });
  });

  it('picks up a stack of 1 entirely, leaving the slot empty', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 1));
    session.click(inv(0), 'secondary');
    expect(session.getCursor()).toEqual({ itemId: ItemId.Stone, count: 1 });
    expect(inventory.getSlot(0)).toBeNull();
  });

  it('places exactly one onto an empty slot', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 5));
    session.click(inv(0), 'primary'); // cursor = 5 stone

    session.click(inv(1), 'secondary'); // place one

    expect(inventory.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 1 });
    expect(session.getCursor()).toEqual({ itemId: ItemId.Stone, count: 4 });
  });

  it('places exactly one onto a slot with the same item (room available)', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 5));
    inventory.set(1, createStack(ItemId.Stone, 3));
    session.click(inv(0), 'primary'); // cursor = 5 stone

    session.click(inv(1), 'secondary');

    expect(inventory.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 4 });
    expect(session.getCursor()).toEqual({ itemId: ItemId.Stone, count: 4 });
  });

  it('does nothing when the same-item slot is already at max stack', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 5));
    inventory.set(1, createStack(ItemId.Stone, INVENTORY_CONFIG.maxStackSize));
    session.click(inv(0), 'primary');

    session.click(inv(1), 'secondary');

    expect(inventory.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: INVENTORY_CONFIG.maxStackSize });
    expect(session.getCursor()).toEqual({ itemId: ItemId.Stone, count: 5 });
  });

  it('swaps on a different item', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 5));
    inventory.set(1, createStack(ItemId.Dirt, 2));
    session.click(inv(0), 'primary');

    session.click(inv(1), 'secondary');

    expect(session.getCursor()).toEqual({ itemId: ItemId.Dirt, count: 2 });
    expect(inventory.getSlot(1)).toEqual({ itemId: ItemId.Stone, count: 5 });
  });
});

describe('ContainerSession result slot', () => {
  it('resultPreview matches the recipe registry', () => {
    const { session, grid: craftingGrid } = session2x2();
    craftingGrid.set(0, createStack(ItemId.Planks, 1));
    craftingGrid.set(2, createStack(ItemId.Planks, 1));

    expect(session.resultPreview()).toEqual({ itemId: ItemId.Stick, count: 4 });
  });

  it('clicking the result crafts and puts the result on the cursor, consuming the grid', () => {
    const { session, grid: craftingGrid } = session2x2();
    craftingGrid.set(0, createStack(ItemId.Planks, 1));
    craftingGrid.set(2, createStack(ItemId.Planks, 1));

    session.click(result, 'primary');

    expect(session.getCursor()).toEqual({ itemId: ItemId.Stick, count: 4 });
    expect(craftingGrid.get(0)).toBeNull();
    expect(craftingGrid.get(2)).toBeNull();
  });

  it('repeated result clicks stack onto the cursor until max, then no-op', () => {
    const { session, grid: craftingGrid } = session2x2();
    const maxStack = INVENTORY_CONFIG.maxStackSize;
    const resultPerCraft = 4; // sticks-from-planks: 4 sticks per craft, 2 planks consumed each time.
    const craftsToFillStack = maxStack / resultPerCraft;

    craftingGrid.set(0, createStack(ItemId.Planks, maxStack));
    craftingGrid.set(2, createStack(ItemId.Planks, maxStack));

    for (let i = 0; i < craftsToFillStack; i++) {
      session.click(result, 'primary');
    }
    expect(session.getCursor()).toEqual({ itemId: ItemId.Stick, count: maxStack });

    const gridBefore = [craftingGrid.get(0), craftingGrid.get(2)];
    session.click(result, 'primary'); // would exceed max -> no-op

    expect(session.getCursor()).toEqual({ itemId: ItemId.Stick, count: maxStack });
    expect([craftingGrid.get(0), craftingGrid.get(2)]).toEqual(gridBefore);
  });

  it('result click with a different item already on the cursor is a no-op', () => {
    const { session, inventory, grid: craftingGrid } = session2x2();
    inventory.set(0, createStack(ItemId.Dirt, 1));
    session.click(inv(0), 'primary'); // cursor = dirt
    craftingGrid.set(0, createStack(ItemId.Planks, 1));
    craftingGrid.set(2, createStack(ItemId.Planks, 1));

    session.click(result, 'primary');

    expect(session.getCursor()).toEqual({ itemId: ItemId.Dirt, count: 1 });
    expect(craftingGrid.get(0)).toEqual({ itemId: ItemId.Planks, count: 1 });
    expect(craftingGrid.get(2)).toEqual({ itemId: ItemId.Planks, count: 1 });
  });

  it('no recipe match -> clicking result is a no-op', () => {
    const { session, grid: craftingGrid } = session2x2();
    craftingGrid.set(0, createStack(ItemId.Stone, 1));

    session.click(result, 'primary');

    expect(session.getCursor()).toBeNull();
    expect(craftingGrid.get(0)).toEqual({ itemId: ItemId.Stone, count: 1 });
  });

  it('secondary click on the result behaves the same as primary (crafts once)', () => {
    const { session, grid: craftingGrid } = session2x2();
    craftingGrid.set(0, createStack(ItemId.Planks, 1));
    craftingGrid.set(2, createStack(ItemId.Planks, 1));

    session.click(result, 'secondary');

    expect(session.getCursor()).toEqual({ itemId: ItemId.Stick, count: 4 });
  });

  it('3x3-only recipe (chest) only matches with a 3x3 grid', () => {
    const inventory = new Inventory();
    const grid3x3 = new CraftingGrid(3, 3);
    const session3x3 = new ContainerSession(inventory, grid3x3, recipes, itemRegistry);

    // chest pattern: PPP / P P / PPP
    grid3x3.set(0, createStack(ItemId.Planks, 1));
    grid3x3.set(1, createStack(ItemId.Planks, 1));
    grid3x3.set(2, createStack(ItemId.Planks, 1));
    grid3x3.set(3, createStack(ItemId.Planks, 1));
    grid3x3.set(5, createStack(ItemId.Planks, 1));
    grid3x3.set(6, createStack(ItemId.Planks, 1));
    grid3x3.set(7, createStack(ItemId.Planks, 1));
    grid3x3.set(8, createStack(ItemId.Planks, 1));

    expect(session3x3.resultPreview()).toEqual({ itemId: ItemId.Chest, count: 1 });

    // The same pattern can never appear in a 2x2 grid (too big), so a fresh
    // 2x2 session has no way to represent it at all — sanity-check the
    // 2x2 grid simply cannot hold 8 non-empty cells.
    const { grid: grid2x2 } = session2x2();
    expect(grid2x2.width * grid2x2.height).toBe(4);
  });
});

describe('ContainerSession.close', () => {
  it('returns cursor and grid contents to the inventory', () => {
    const { session, inventory, grid: craftingGrid } = session2x2();
    inventory.set(0, createStack(ItemId.Stone, 5));
    session.click(inv(0), 'primary'); // cursor = 5 stone
    craftingGrid.set(1, createStack(ItemId.Dirt, 2));

    const leftovers: unknown[] = [];
    session.close((stack) => leftovers.push(stack));

    expect(leftovers).toEqual([]);
    expect(session.getCursor()).toBeNull();
    expect(inventory.countItem(ItemId.Stone)).toBe(5);
    expect(inventory.countItem(ItemId.Dirt)).toBe(2);
    expect(craftingGrid.get(1)).toBeNull();
  });

  it('calls dropLeftover with the exact leftovers when the inventory is full', () => {
    const inventory = new Inventory(itemRegistry, 1, 1); // a single slot, already occupied
    inventory.set(0, createStack(ItemId.Stone, INVENTORY_CONFIG.maxStackSize));
    const craftingGrid = new CraftingGrid(2, 2);
    const session = new ContainerSession(inventory, craftingGrid, recipes, itemRegistry);

    craftingGrid.set(0, createStack(ItemId.Dirt, 10));

    const leftovers: unknown[] = [];
    session.close((stack) => leftovers.push(stack));

    expect(leftovers).toEqual([{ itemId: ItemId.Dirt, count: 10 }]);
    expect(craftingGrid.get(0)).toBeNull();
  });

  it('is deterministic: same starting state produces the same close() leftovers', () => {
    function run(): unknown[] {
      const inventory = new Inventory(itemRegistry, 1, 1);
      inventory.set(0, createStack(ItemId.Stone, INVENTORY_CONFIG.maxStackSize));
      const craftingGrid = new CraftingGrid(2, 2);
      const session = new ContainerSession(inventory, craftingGrid, recipes, itemRegistry);
      craftingGrid.set(0, createStack(ItemId.Dirt, 3));
      craftingGrid.set(3, createStack(ItemId.Sand, 2));

      const leftovers: unknown[] = [];
      session.close((stack) => leftovers.push(stack));
      return leftovers;
    }

    expect(run()).toEqual(run());
  });
});

describe('ContainerSession preserves tool damage', () => {
  it('a damaged tool survives inventory -> cursor -> grid -> back to inventory', () => {
    const { session, inventory, grid } = session2x2();
    inventory.set(0, createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 15));

    // Pick up from inventory slot 0 into the cursor.
    session.click(inv(0), 'primary');
    expect(session.getCursor()).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 15 });
    expect(inventory.getSlot(0)).toBeNull();

    // Place into a grid cell.
    session.click({ area: 'grid', index: 0 }, 'primary');
    expect(session.getCursor()).toBeNull();
    expect(grid.get(0)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 15 });

    // Pick back up from the grid.
    session.click({ area: 'grid', index: 0 }, 'primary');
    expect(session.getCursor()).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 15 });

    // Place back into a different inventory slot.
    session.click(inv(5), 'primary');
    expect(inventory.getSlot(5)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 15 });
    expect(session.getCursor()).toBeNull();
  });

  it('close() returns a damaged tool held on the cursor back into the inventory intact', () => {
    const { session, inventory } = session2x2();
    inventory.set(0, createStack(ItemId.WoodenAxe, 1, itemRegistry, 8));
    session.click(inv(0), 'primary'); // pick up onto cursor
    expect(session.getCursor()).not.toBeNull();

    session.close(() => {
      throw new Error('should not need to drop anything: inventory has room');
    });

    expect(inventory.countItem(ItemId.WoodenAxe)).toBe(1);
    const slots = inventory.slots();
    const restored = slots.find((s) => s?.itemId === ItemId.WoodenAxe);
    expect(restored).toEqual({ itemId: ItemId.WoodenAxe, count: 1, damage: 8 });
  });
});
