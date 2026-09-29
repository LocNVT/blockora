import { describe, it, expect } from 'vitest';
import { RecipeRegistry, recipeRegistry, type CraftingGridView } from '../src/crafting/RecipeRegistry';
import { RECIPE_DEFINITIONS, type RecipeDefinition } from '../src/crafting/recipes';
import { ItemId } from '../src/items/items';

function gridOf(width: number, height: number, cells: readonly (ItemId | 0)[]): CraftingGridView {
  return { width, height, cells };
}

/** Places a small pattern (row-major, list of {x,y,item}) into a width x height grid. */
function placeAt(
  width: number,
  height: number,
  entries: readonly { x: number; y: number; item: ItemId }[],
): CraftingGridView {
  const cells: (ItemId | 0)[] = new Array(width * height).fill(0);
  for (const { x, y, item } of entries) {
    cells[x + width * y] = item;
  }
  return { width, height, cells };
}

describe('RECIPE_DEFINITIONS', () => {
  it('constructs a RecipeRegistry from the built-in definitions without throwing', () => {
    expect(() => new RecipeRegistry(RECIPE_DEFINITIONS)).not.toThrow();
  });

  it('exports a ready-made recipeRegistry singleton', () => {
    expect(recipeRegistry.size).toBe(RECIPE_DEFINITIONS.length);
  });
});

describe('built-in recipe matching', () => {
  it('matches planks from wood in any single cell of a 2x2 grid', () => {
    for (let i = 0; i < 4; i++) {
      const cells: (ItemId | 0)[] = [0, 0, 0, 0];
      cells[i] = ItemId.Wood;
      const match = recipeRegistry.match(gridOf(2, 2, cells));
      expect(match?.recipe.id).toBe('planks-from-wood');
      expect(match?.result).toEqual({ itemId: ItemId.Planks, count: 4 });
    }
  });

  it('matches planks from wood in any single cell of a 3x3 grid', () => {
    const cells: (ItemId | 0)[] = new Array(9).fill(0);
    cells[8] = ItemId.Wood;
    const match = recipeRegistry.match(gridOf(3, 3, cells));
    expect(match?.recipe.id).toBe('planks-from-wood');
  });

  it('matches sticks in a 2x2 grid: left column', () => {
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 0, y: 1, item: ItemId.Planks },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('sticks-from-planks');
    expect(match?.result).toEqual({ itemId: ItemId.Stick, count: 4 });
  });

  it('matches sticks in a 2x2 grid: right column', () => {
    const grid = placeAt(2, 2, [
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 1, y: 1, item: ItemId.Planks },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('sticks-from-planks');
  });

  it('matches sticks in a 3x3 grid at the bottom-right corner', () => {
    const grid = placeAt(3, 3, [
      { x: 2, y: 1, item: ItemId.Planks },
      { x: 2, y: 2, item: ItemId.Planks },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('sticks-from-planks');
  });

  it('matches sticks in a 3x3 grid at an arbitrary offset (top-middle column)', () => {
    const grid = placeAt(3, 3, [
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 1, y: 1, item: ItemId.Planks },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('sticks-from-planks');
  });

  it('matches the crafting table in a 2x2 grid', () => {
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 0, y: 1, item: ItemId.Planks },
      { x: 1, y: 1, item: ItemId.Planks },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('crafting-table');
  });

  it('matches the crafting table in a 3x3 grid, top-left corner', () => {
    const grid = placeAt(3, 3, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 0, y: 1, item: ItemId.Planks },
      { x: 1, y: 1, item: ItemId.Planks },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('crafting-table');
  });

  it('matches the crafting table in a 3x3 grid, bottom-right corner', () => {
    const grid = placeAt(3, 3, [
      { x: 1, y: 1, item: ItemId.Planks },
      { x: 2, y: 1, item: ItemId.Planks },
      { x: 1, y: 2, item: ItemId.Planks },
      { x: 2, y: 2, item: ItemId.Planks },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('crafting-table');
  });

  it('matches the torch (coal over stick)', () => {
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Coal },
      { x: 0, y: 1, item: ItemId.Stick },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('torch');
    expect(match?.result).toEqual({ itemId: ItemId.Torch, count: 4 });
  });

  it('does not match the torch when stick is above coal (not mirror-symmetric on vertical axis, order matters)', () => {
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Stick },
      { x: 0, y: 1, item: ItemId.Coal },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match).toBeNull();
  });

  it('matches the chest only in a 3x3 grid', () => {
    const grid = placeAt(3, 3, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 2, y: 0, item: ItemId.Planks },
      { x: 0, y: 1, item: ItemId.Planks },
      { x: 2, y: 1, item: ItemId.Planks },
      { x: 0, y: 2, item: ItemId.Planks },
      { x: 1, y: 2, item: ItemId.Planks },
      { x: 2, y: 2, item: ItemId.Planks },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('chest');
  });

  it('does not match the chest in a 2x2 grid', () => {
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 0, y: 1, item: ItemId.Planks },
      { x: 1, y: 1, item: ItemId.Planks },
    ]);
    // This is actually the crafting table pattern, not chest — confirm it resolves to table, not chest.
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).not.toBe('chest');
  });
});

describe('tool recipes', () => {
  it('matches the wooden pickaxe in a 3x3 grid', () => {
    const grid = placeAt(3, 3, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 2, y: 0, item: ItemId.Planks },
      { x: 1, y: 1, item: ItemId.Stick },
      { x: 1, y: 2, item: ItemId.Stick },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('wooden-pickaxe');
    expect(match?.result).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1 });
  });

  it('matches the stone pickaxe (cobblestone heads) in a 3x3 grid', () => {
    const grid = placeAt(3, 3, [
      { x: 0, y: 0, item: ItemId.Cobblestone },
      { x: 1, y: 0, item: ItemId.Cobblestone },
      { x: 2, y: 0, item: ItemId.Cobblestone },
      { x: 1, y: 1, item: ItemId.Stick },
      { x: 1, y: 2, item: ItemId.Stick },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('stone-pickaxe');
    expect(match?.result).toEqual({ itemId: ItemId.StonePickaxe, count: 1 });
  });

  it('a pickaxe pattern (3 wide) does not fit a 2x2 grid', () => {
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 1, y: 0, item: ItemId.Planks },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).not.toBe('wooden-pickaxe');
  });

  it('matches the wooden axe, base orientation, in a 3x3 grid', () => {
    const grid = placeAt(3, 3, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 0, y: 1, item: ItemId.Planks },
      { x: 1, y: 1, item: ItemId.Stick },
      { x: 1, y: 2, item: ItemId.Stick },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('wooden-axe');
  });

  it('matches the wooden axe, mirrored orientation, in a 3x3 grid', () => {
    // Mirror of ['MM','MS',' S'] is ['MM','SM','S ']: heads on the left,
    // handle continuing down the left column.
    const grid = placeAt(3, 3, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 0, y: 1, item: ItemId.Stick },
      { x: 1, y: 1, item: ItemId.Planks },
      { x: 0, y: 2, item: ItemId.Stick },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('wooden-axe');
  });

  it('matches the stone axe (cobblestone heads) in a 3x3 grid', () => {
    const grid = placeAt(3, 3, [
      { x: 0, y: 0, item: ItemId.Cobblestone },
      { x: 1, y: 0, item: ItemId.Cobblestone },
      { x: 0, y: 1, item: ItemId.Cobblestone },
      { x: 1, y: 1, item: ItemId.Stick },
      { x: 1, y: 2, item: ItemId.Stick },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('stone-axe');
  });

  it('matches the wooden shovel (1x3, only fits a 3x3 grid) in a 3x3 grid', () => {
    const grid = placeAt(3, 3, [
      { x: 1, y: 0, item: ItemId.Planks },
      { x: 1, y: 1, item: ItemId.Stick },
      { x: 1, y: 2, item: ItemId.Stick },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('wooden-shovel');
    expect(match?.result).toEqual({ itemId: ItemId.WoodenShovel, count: 1 });
  });

  it('matches the stone shovel (cobblestone head) in a 3x3 grid', () => {
    const grid = placeAt(3, 3, [
      { x: 1, y: 0, item: ItemId.Cobblestone },
      { x: 1, y: 1, item: ItemId.Stick },
      { x: 1, y: 2, item: ItemId.Stick },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).toBe('stone-shovel');
  });

  it('the shovel pattern (3 tall) does not fit a 2x2 grid', () => {
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Planks },
      { x: 0, y: 1, item: ItemId.Stick },
    ]);
    const match = recipeRegistry.match(grid);
    expect(match?.recipe.id).not.toBe('wooden-shovel');
  });

  it('the full built-in recipe set (including tool recipes) constructs without ambiguity errors', () => {
    expect(() => new RecipeRegistry(RECIPE_DEFINITIONS)).not.toThrow();
  });
});

describe('grid edge cases', () => {
  it('returns null for an empty grid', () => {
    expect(recipeRegistry.match(gridOf(2, 2, [0, 0, 0, 0]))).toBeNull();
  });

  it('returns null for wrong items', () => {
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Stone },
      { x: 1, y: 1, item: ItemId.Dirt },
    ]);
    expect(recipeRegistry.match(grid)).toBeNull();
  });

  it('throws on mismatched cells length', () => {
    expect(() => recipeRegistry.match({ width: 2, height: 2, cells: [0, 0, 0] })).toThrow();
  });

  it('throws on invalid dimensions', () => {
    expect(() => recipeRegistry.match({ width: 0, height: 2, cells: [] })).toThrow();
  });
});

describe('mirroring', () => {
  const asymmetricRecipe: RecipeDefinition = {
    kind: 'shaped',
    id: 'test-asymmetric',
    pattern: ['AB', 'C '],
    key: { A: ItemId.Stone, B: ItemId.Dirt, C: ItemId.Sand },
    result: { itemId: ItemId.Gravel, count: 1 },
  };

  it('matches both the base orientation and its mirror when mirrorable (default true)', () => {
    const registry = new RecipeRegistry([asymmetricRecipe]);

    const base = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Stone },
      { x: 1, y: 0, item: ItemId.Dirt },
      { x: 0, y: 1, item: ItemId.Sand },
    ]);
    expect(registry.match(base)?.recipe.id).toBe('test-asymmetric');

    // Horizontal mirror: columns flipped -> "BA" / " C"
    const mirrored = placeAt(2, 2, [
      { x: 1, y: 0, item: ItemId.Stone },
      { x: 0, y: 0, item: ItemId.Dirt },
      { x: 1, y: 1, item: ItemId.Sand },
    ]);
    expect(registry.match(mirrored)?.recipe.id).toBe('test-asymmetric');
  });

  it('does not match the mirrored orientation when mirrorable: false', () => {
    const nonMirrorable: RecipeDefinition = { ...asymmetricRecipe, mirrorable: false };
    const registry = new RecipeRegistry([nonMirrorable]);

    const mirrored = placeAt(2, 2, [
      { x: 1, y: 0, item: ItemId.Stone },
      { x: 0, y: 0, item: ItemId.Dirt },
      { x: 1, y: 1, item: ItemId.Sand },
    ]);
    expect(registry.match(mirrored)).toBeNull();

    const base = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Stone },
      { x: 1, y: 0, item: ItemId.Dirt },
      { x: 0, y: 1, item: ItemId.Sand },
    ]);
    expect(registry.match(base)?.recipe.id).toBe('test-asymmetric');
  });
});

describe('shapeless matching', () => {
  const shapelessRecipe: RecipeDefinition = {
    kind: 'shapeless',
    id: 'test-shapeless',
    ingredients: [ItemId.Stone, ItemId.Stone, ItemId.Dirt],
    result: { itemId: ItemId.Gravel, count: 2 },
  };

  it('matches regardless of cell order/position', () => {
    const registry = new RecipeRegistry([shapelessRecipe]);
    const grid = placeAt(2, 2, [
      { x: 1, y: 0, item: ItemId.Dirt },
      { x: 0, y: 1, item: ItemId.Stone },
      { x: 1, y: 1, item: ItemId.Stone },
    ]);
    const match = registry.match(grid);
    expect(match?.recipe.id).toBe('test-shapeless');
    expect(match?.result).toEqual({ itemId: ItemId.Gravel, count: 2 });
  });

  it('requires the exact multiset — an extra item causes no match', () => {
    const registry = new RecipeRegistry([shapelessRecipe]);
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Stone },
      { x: 1, y: 0, item: ItemId.Stone },
      { x: 0, y: 1, item: ItemId.Dirt },
      { x: 1, y: 1, item: ItemId.Sand },
    ]);
    expect(registry.match(grid)).toBeNull();
  });

  it('requires the exact multiset — a missing item causes no match', () => {
    const registry = new RecipeRegistry([shapelessRecipe]);
    const grid = placeAt(2, 2, [
      { x: 0, y: 0, item: ItemId.Stone },
      { x: 1, y: 0, item: ItemId.Dirt },
    ]);
    expect(registry.match(grid)).toBeNull();
  });
});

describe('determinism', () => {
  it('returns the first-registered match when a grid could plausibly match multiple entries in different orders', () => {
    // Two shapeless recipes over disjoint ingredient sets: order of
    // registration determines which is checked first, but since sets are
    // disjoint here we just confirm each resolves to itself regardless of
    // registration order, proving matching isn't order-dependent on content.
    const a: RecipeDefinition = {
      kind: 'shapeless',
      id: 'order-a',
      ingredients: [ItemId.Stone],
      result: { itemId: ItemId.Gravel, count: 1 },
    };
    const b: RecipeDefinition = {
      kind: 'shapeless',
      id: 'order-b',
      ingredients: [ItemId.Dirt],
      result: { itemId: ItemId.Sand, count: 1 },
    };
    const registry1 = new RecipeRegistry([a, b]);
    const registry2 = new RecipeRegistry([b, a]);

    const stoneGrid = placeAt(2, 2, [{ x: 0, y: 0, item: ItemId.Stone }]);
    expect(registry1.match(stoneGrid)?.recipe.id).toBe('order-a');
    expect(registry2.match(stoneGrid)?.recipe.id).toBe('order-a');
  });
});

describe('validation errors', () => {
  const validResult = { itemId: ItemId.Gravel, count: 1 };

  it('throws on duplicate recipe id', () => {
    const a: RecipeDefinition = {
      kind: 'shapeless',
      id: 'dup',
      ingredients: [ItemId.Stone],
      result: validResult,
    };
    const b: RecipeDefinition = {
      kind: 'shapeless',
      id: 'dup',
      ingredients: [ItemId.Dirt],
      result: validResult,
    };
    expect(() => new RecipeRegistry([a, b])).toThrow(/duplicate recipe id/);
  });

  it('throws on unknown result item', () => {
    const def: RecipeDefinition = {
      kind: 'shapeless',
      id: 'bad-result',
      ingredients: [ItemId.Stone],
      result: { itemId: 9999 as ItemId, count: 1 },
    };
    expect(() => new RecipeRegistry([def])).toThrow(/not registered/);
  });

  it('throws on unknown key item in a shaped recipe', () => {
    const def: RecipeDefinition = {
      kind: 'shaped',
      id: 'bad-key-item',
      pattern: ['A'],
      key: { A: 9999 as ItemId },
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/unregistered item/);
  });

  it('throws on invalid result count (non-integer)', () => {
    const def: RecipeDefinition = {
      kind: 'shapeless',
      id: 'bad-count',
      ingredients: [ItemId.Stone],
      result: { itemId: ItemId.Gravel, count: 1.5 },
    };
    expect(() => new RecipeRegistry([def])).toThrow(/positive integer/);
  });

  it('throws on result count exceeding max stack size', () => {
    const def: RecipeDefinition = {
      kind: 'shapeless',
      id: 'over-stack',
      ingredients: [ItemId.Stone],
      result: { itemId: ItemId.Gravel, count: 9999 },
    };
    expect(() => new RecipeRegistry([def])).toThrow(/exceeds max stack size/);
  });

  it('throws on an untrimmed pattern (fully empty outer row)', () => {
    const def: RecipeDefinition = {
      kind: 'shaped',
      id: 'untrimmed-row',
      pattern: [' A ', '   '],
      key: { A: ItemId.Stone },
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/fully-empty outer row/);
  });

  it('throws on an untrimmed pattern (fully empty outer column)', () => {
    const def: RecipeDefinition = {
      kind: 'shaped',
      id: 'untrimmed-col',
      pattern: [' A', ' A'],
      key: { A: ItemId.Stone },
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/fully-empty outer column/);
  });

  it('throws on ragged rows', () => {
    const def: RecipeDefinition = {
      kind: 'shaped',
      id: 'ragged',
      pattern: ['AA', 'A'],
      key: { A: ItemId.Stone },
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/equal length/);
  });

  it('throws on unused key entry', () => {
    const def: RecipeDefinition = {
      kind: 'shaped',
      id: 'unused-key',
      pattern: ['A'],
      key: { A: ItemId.Stone, B: ItemId.Dirt },
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/never used/);
  });

  it('throws on missing key entry for a used pattern char', () => {
    const def: RecipeDefinition = {
      kind: 'shaped',
      id: 'missing-key',
      pattern: ['AB'],
      key: { A: ItemId.Stone },
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/no entry in `key`/);
  });

  it('throws on pattern larger than 3x3', () => {
    const def: RecipeDefinition = {
      kind: 'shaped',
      id: 'too-big',
      pattern: ['AAAA', 'AAAA'],
      key: { A: ItemId.Stone },
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/1-3 chars wide/);
  });

  it('throws on pattern with more than 3 rows', () => {
    const def: RecipeDefinition = {
      kind: 'shaped',
      id: 'too-tall',
      pattern: ['A', 'A', 'A', 'A'],
      key: { A: ItemId.Stone },
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/1-3 rows/);
  });

  it('throws on empty shapeless ingredients', () => {
    const def: RecipeDefinition = {
      kind: 'shapeless',
      id: 'empty-shapeless',
      ingredients: [],
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/1-9 entries/);
  });

  it('throws on entirely empty shaped pattern', () => {
    const def: RecipeDefinition = {
      kind: 'shaped',
      id: 'all-empty',
      pattern: [' '],
      key: {},
      result: validResult,
    };
    expect(() => new RecipeRegistry([def])).toThrow(/must not be entirely empty/);
  });

  it('throws on ambiguous duplicate shaped recipes (identical pattern)', () => {
    const a: RecipeDefinition = {
      kind: 'shaped',
      id: 'shape-a',
      pattern: ['A'],
      key: { A: ItemId.Stone },
      result: validResult,
    };
    const b: RecipeDefinition = {
      kind: 'shaped',
      id: 'shape-b',
      pattern: ['A'],
      key: { A: ItemId.Stone },
      result: { itemId: ItemId.Sand, count: 1 },
    };
    expect(() => new RecipeRegistry([a, b])).toThrow(/ambiguous/);
  });

  it('throws on ambiguous duplicate shapeless recipes (identical multiset)', () => {
    const a: RecipeDefinition = {
      kind: 'shapeless',
      id: 'multiset-a',
      ingredients: [ItemId.Stone, ItemId.Dirt],
      result: validResult,
    };
    const b: RecipeDefinition = {
      kind: 'shapeless',
      id: 'multiset-b',
      ingredients: [ItemId.Dirt, ItemId.Stone],
      result: { itemId: ItemId.Sand, count: 1 },
    };
    expect(() => new RecipeRegistry([a, b])).toThrow(/ambiguous/);
  });

  it('throws on shaped/shapeless ambiguity (single-cell shape matches 1-ingredient shapeless)', () => {
    const shaped: RecipeDefinition = {
      kind: 'shaped',
      id: 'single-cell',
      pattern: ['A'],
      key: { A: ItemId.Stone },
      result: validResult,
    };
    const shapeless: RecipeDefinition = {
      kind: 'shapeless',
      id: 'single-ingredient',
      ingredients: [ItemId.Stone],
      result: { itemId: ItemId.Sand, count: 1 },
    };
    expect(() => new RecipeRegistry([shaped, shapeless])).toThrow(/ambiguous/);
  });

  // Regression: only single-cell shapes were checked, so a multi-cell shaped recipe and a
  // shapeless recipe with the same ingredients could both match the same grid.
  it('throws on shaped/shapeless ambiguity for multi-cell shapes with the same multiset (either order)', () => {
    const shaped: RecipeDefinition = {
      kind: 'shaped',
      id: 'two-vertical',
      pattern: ['A', 'A'],
      key: { A: ItemId.Planks },
      result: validResult,
    };
    const shapeless: RecipeDefinition = {
      kind: 'shapeless',
      id: 'two-any',
      ingredients: [ItemId.Planks, ItemId.Planks],
      result: { itemId: ItemId.Sand, count: 1 },
    };
    expect(() => new RecipeRegistry([shaped, shapeless])).toThrow(/ambiguous/);
    expect(() => new RecipeRegistry([shapeless, shaped])).toThrow(/ambiguous/);
  });

  it('allows shaped and shapeless recipes with different multisets', () => {
    const shaped: RecipeDefinition = {
      kind: 'shaped',
      id: 'two-vertical',
      pattern: ['A', 'A'],
      key: { A: ItemId.Planks },
      result: validResult,
    };
    const shapeless: RecipeDefinition = {
      kind: 'shapeless',
      id: 'three-any',
      ingredients: [ItemId.Planks, ItemId.Planks, ItemId.Planks],
      result: { itemId: ItemId.Sand, count: 1 },
    };
    expect(() => new RecipeRegistry([shaped, shapeless])).not.toThrow();
  });
});
