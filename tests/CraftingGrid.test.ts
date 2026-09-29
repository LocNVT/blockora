import { describe, it, expect } from 'vitest';
import { CraftingGrid } from '../src/crafting/CraftingGrid';
import { RecipeRegistry } from '../src/crafting/RecipeRegistry';
import { RECIPE_DEFINITIONS } from '../src/crafting/recipes';
import { createStack } from '../src/items/ItemStack';
import { ItemId } from '../src/items/items';

const registry = new RecipeRegistry(RECIPE_DEFINITIONS);

describe('CraftingGrid basic access', () => {
  it('get/set roundtrip', () => {
    const grid = new CraftingGrid(2, 2);
    expect(grid.get(0)).toBeNull();
    const stack = createStack(ItemId.Planks, 3);
    grid.set(0, stack);
    expect(grid.get(0)).toEqual(stack);
  });

  it('throws on out-of-range index', () => {
    const grid = new CraftingGrid(2, 2);
    expect(() => grid.get(4)).toThrow(RangeError);
    expect(() => grid.set(-1, null)).toThrow(RangeError);
  });

  it('view() reflects current contents', () => {
    const grid = new CraftingGrid(2, 2);
    grid.set(0, createStack(ItemId.Wood, 1));
    grid.set(3, createStack(ItemId.Stone, 5));
    const view = grid.view();
    expect(view.width).toBe(2);
    expect(view.height).toBe(2);
    expect(view.cells).toEqual([ItemId.Wood, 0, 0, ItemId.Stone]);
  });

  it('view() updates after mutation without needing a new call site allocation issue', () => {
    const grid = new CraftingGrid(2, 2);
    grid.set(0, createStack(ItemId.Wood, 1));
    const view1 = grid.view();
    expect(view1.cells[0]).toBe(ItemId.Wood);
    grid.set(0, null);
    const view2 = grid.view();
    expect(view2.cells[0]).toBe(0);
  });
});

describe('CraftingGrid.craft', () => {
  it('consumes one item from each used cell and returns the result', () => {
    const grid = new CraftingGrid(2, 2);
    grid.set(0, createStack(ItemId.Planks, 1));
    grid.set(2, createStack(ItemId.Planks, 1));

    const result = grid.craft(registry);

    expect(result).toEqual({ itemId: ItemId.Stick, count: 4 });
    expect(grid.get(0)).toBeNull();
    expect(grid.get(2)).toBeNull();
  });

  it('leaves remaining counts when stacks had more than 1', () => {
    const grid = new CraftingGrid(2, 2);
    grid.set(0, createStack(ItemId.Planks, 5));
    grid.set(2, createStack(ItemId.Planks, 3));

    const result = grid.craft(registry);

    expect(result).toEqual({ itemId: ItemId.Stick, count: 4 });
    expect(grid.get(0)).toEqual({ itemId: ItemId.Planks, count: 4 });
    expect(grid.get(2)).toEqual({ itemId: ItemId.Planks, count: 2 });
  });

  it('does not touch unused (empty) cells', () => {
    const grid = new CraftingGrid(3, 3);
    grid.set(0, createStack(ItemId.Wood, 2));
    // Wood in one cell -> planks-from-wood shapeless recipe; all other cells stay null.
    const result = grid.craft(registry);
    expect(result).toEqual({ itemId: ItemId.Planks, count: 4 });
    expect(grid.get(0)).toEqual({ itemId: ItemId.Wood, count: 1 });
    for (let i = 1; i < 9; i++) {
      expect(grid.get(i)).toBeNull();
    }
  });

  it('returns null and leaves the grid unchanged when there is no match', () => {
    const grid = new CraftingGrid(2, 2);
    grid.set(0, createStack(ItemId.Stone, 1));
    grid.set(3, createStack(ItemId.Dirt, 1));

    const before = grid.view().cells.slice();
    const result = grid.craft(registry);

    expect(result).toBeNull();
    expect(grid.view().cells).toEqual(before);
    expect(grid.get(0)).toEqual({ itemId: ItemId.Stone, count: 1 });
    expect(grid.get(3)).toEqual({ itemId: ItemId.Dirt, count: 1 });
  });

  it('returns null on an empty grid', () => {
    const grid = new CraftingGrid(2, 2);
    expect(grid.craft(registry)).toBeNull();
  });

  it('can craft repeatedly until ingredients run out', () => {
    const grid = new CraftingGrid(2, 2);
    grid.set(0, createStack(ItemId.Planks, 2));
    grid.set(2, createStack(ItemId.Planks, 2));

    const first = grid.craft(registry);
    expect(first).toEqual({ itemId: ItemId.Stick, count: 4 });
    expect(grid.get(0)).toEqual({ itemId: ItemId.Planks, count: 1 });
    expect(grid.get(2)).toEqual({ itemId: ItemId.Planks, count: 1 });

    const second = grid.craft(registry);
    expect(second).toEqual({ itemId: ItemId.Stick, count: 4 });
    expect(grid.get(0)).toBeNull();
    expect(grid.get(2)).toBeNull();

    const third = grid.craft(registry);
    expect(third).toBeNull();
  });
});

describe('CraftingGrid.clear', () => {
  it('returns contents and empties the grid', () => {
    const grid = new CraftingGrid(2, 2);
    const a = createStack(ItemId.Planks, 2);
    const b = createStack(ItemId.Stone, 1);
    grid.set(0, a);
    grid.set(3, b);

    const contents = grid.clear();

    expect(contents).toEqual([a, null, null, b]);
    expect(grid.get(0)).toBeNull();
    expect(grid.get(3)).toBeNull();
  });

  it('clearing an already-empty grid returns all nulls', () => {
    const grid = new CraftingGrid(3, 3);
    const contents = grid.clear();
    expect(contents).toEqual(new Array(9).fill(null));
  });
});
