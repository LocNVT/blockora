import { describe, it, expect } from 'vitest';
import { RECIPE_DEFINITIONS, type RecipeDefinition } from '../src/crafting/recipes';
import { RecipeRegistry, recipeRegistry } from '../src/crafting/RecipeRegistry';
import {
  buildRecipeBook,
  buildRecipeBookEntry,
  canCraftNow,
  countItems,
  rankRecipes,
  recipeCraftability,
  type RecipeBookEntry,
} from '../src/crafting/recipeBook';
import { ItemId } from '../src/items/items';
import { itemRegistry } from '../src/items/ItemRegistry';
import { Inventory } from '../src/items/Inventory';
import { createStack } from '../src/items/ItemStack';
import { createRecipeHintGate } from '../src/ui/recipeHint';
import { RECIPE_BOOK_CONFIG } from '../src/config/constants';
import type { SettingsStorage } from '../src/settings/settingsStorage';

const name = (id: ItemId): string => itemRegistry.get(id).displayName;
const book = buildRecipeBook();
const entryFor = (id: string): RecipeBookEntry => {
  const found = book.find((e) => e.id === id);
  if (found === undefined) throw new Error(`no entry ${id}`);
  return found;
};
const counts = (pairs: [ItemId, number][]): Map<ItemId, number> => new Map(pairs);

/** Independent re-derivation of what a shaped recipe needs, straight from its pattern/key. */
function expectedShaped(def: Extract<RecipeDefinition, { kind: 'shaped' }>) {
  const totals = new Map<ItemId, number>();
  for (const row of def.pattern) {
    for (const ch of row) {
      if (ch === ' ') continue;
      const id = def.key[ch] as ItemId;
      totals.set(id, (totals.get(id) ?? 0) + 1);
    }
  }
  return totals;
}

describe('RecipeRegistry.all', () => {
  it('returns every definition in registration order', () => {
    expect(recipeRegistry.all()).toEqual(RECIPE_DEFINITIONS);
  });
});

describe('buildRecipeBook: every registered recipe', () => {
  it('has exactly one entry per recipe, in registry order', () => {
    expect(book.map((e) => e.id)).toEqual(RECIPE_DEFINITIONS.map((d) => d.id));
  });

  for (const def of RECIPE_DEFINITIONS) {
    describe(def.id, () => {
      const entry = entryFor(def.id);

      it('has the right result', () => {
        expect(entry.result).toEqual({
          itemId: def.result.itemId,
          count: def.result.count,
          displayName: name(def.result.itemId),
        });
      });

      it('computes the grid size from the pattern, not by hand', () => {
        if (def.kind === 'shaped') {
          const w = def.pattern[0]?.length ?? 0;
          expect(entry.grid).toBe(Math.max(w, def.pattern.length) <= 2 ? '2x2' : '3x3');
        } else {
          expect(entry.grid).toBe(def.ingredients.length <= 4 ? '2x2' : '3x3');
        }
      });

      it('display grid matches the pattern including empty cells', () => {
        const g = entry.displayGrid;
        expect(g.cells.length).toBe(g.width * g.height);
        if (def.kind === 'shaped') {
          expect(g.height).toBe(def.pattern.length);
          expect(g.width).toBe(def.pattern[0]?.length);
          def.pattern.forEach((row, y) => {
            [...row].forEach((ch, x) => {
              expect(g.cells[x + g.width * y]).toBe(ch === ' ' ? 0 : def.key[ch]);
            });
          });
        } else {
          expect(g.cells.filter((c) => c !== 0).sort()).toEqual([...def.ingredients].sort());
        }
      });

      it('ingredient totals and summary are correct', () => {
        const expected =
          def.kind === 'shaped'
            ? expectedShaped(def)
            : def.ingredients.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<ItemId, number>());
        expect(new Map(entry.ingredients.map((i) => [i.itemId, i.count]))).toEqual(expected);
        for (const ing of entry.ingredients) {
          expect(entry.ingredientSummary).toContain(`${ing.count} × ${ing.displayName}`);
          expect(entry.instruction).toContain(`${ing.count} × ${ing.displayName}`);
        }
      });

      it('instruction names the right place to craft and is one short sentence', () => {
        expect(entry.instruction.startsWith(entry.grid === '2x2' ? 'Inventory or crafting table:' : 'Crafting table:')).toBe(true);
        expect(entry.instruction.endsWith('.')).toBe(true);
        expect(entry.instruction.length).toBeLessThan(200);
      });
    });
  }
});

describe('generated instructions', () => {
  it('shapeless: anywhere in the grid', () => {
    expect(entryFor('planks-from-wood').instruction).toBe(
      'Inventory or crafting table: put 1 × Wood Log anywhere in the grid.',
    );
  });

  it('pattern shapes are described from the pattern', () => {
    expect(entryFor('crafting-table').instruction).toBe(
      'Inventory or crafting table: fill a 2×2 square with 4 × Wooden Planks.',
    );
    expect(entryFor('sticks-from-planks').instruction).toContain('2 × Wooden Planks, one above the other');
    expect(entryFor('chest').instruction).toBe(
      'Crafting table: put 8 × Wooden Planks in a 3×3 square, leaving the center empty.',
    );
    expect(entryFor('wooden-pickaxe').instruction).toBe(
      'Crafting table: put 3 × Wooden Planks across the top row and 2 × Stick in the middle column, middle and bottom rows.',
    );
    expect(entryFor('stone-shovel').instruction).toBe(
      'Crafting table: put 1 × Cobblestone in the top slot and 2 × Stick in the middle and bottom slots, stacked in one column.',
    );
    expect(entryFor('torch').instruction).toContain('1 × Coal in the top slot and 1 × Stick in the bottom slot');
  });
});

describe('synthetic recipes (generic handling)', () => {
  const build = (definition: RecipeDefinition): RecipeBookEntry => buildRecipeBookEntry(definition, itemRegistry);

  it('shapeless: <= 4 ingredients fit 2x2, laid out left to right, duplicates summed', () => {
    const e = build({
      kind: 'shapeless',
      id: 'x',
      ingredients: [ItemId.Coal, ItemId.Stick, ItemId.Coal],
      result: { itemId: ItemId.Torch, count: 1 },
    });
    expect(e.grid).toBe('2x2');
    expect(e.displayGrid).toEqual({ width: 3, height: 1, cells: [ItemId.Coal, ItemId.Stick, ItemId.Coal] });
    expect(e.ingredientSummary).toBe('2 × Coal, 1 × Stick');
    expect(e.instruction).toBe('Inventory or crafting table: put 2 × Coal and 1 × Stick anywhere in the grid.');
  });

  it('shapeless: 4 ingredients use a 2x2 layout, 5 need the crafting table', () => {
    const four = build({
      kind: 'shapeless',
      id: 'four',
      ingredients: [ItemId.Dirt, ItemId.Sand, ItemId.Gravel, ItemId.Stone],
      result: { itemId: ItemId.Glass, count: 1 },
    });
    expect(four.grid).toBe('2x2');
    expect(four.displayGrid.width).toBe(2);
    expect(four.displayGrid.height).toBe(2);
    const five = build({
      kind: 'shapeless',
      id: 'five',
      ingredients: [ItemId.Dirt, ItemId.Sand, ItemId.Gravel, ItemId.Stone, ItemId.Coal],
      result: { itemId: ItemId.Glass, count: 1 },
    });
    expect(five.grid).toBe('3x3');
    expect(five.displayGrid.cells.length).toBe(five.displayGrid.width * five.displayGrid.height);
    expect(five.displayGrid.cells.filter((c) => c === 0).length).toBe(1);
  });

  it('shaped: a 2-wide, 3-tall pattern needs the table; a 2x1 row fits 2x2', () => {
    const row = build({
      kind: 'shaped',
      id: 'row',
      pattern: ['CS'],
      key: { C: ItemId.Coal, S: ItemId.Stick },
      result: { itemId: ItemId.Torch, count: 1 },
    });
    expect(row.grid).toBe('2x2');
    expect(row.instruction).toBe(
      'Inventory or crafting table: put 1 × Coal in the left slot and 1 × Stick in the right slot, side by side in one row.',
    );
    const tall = build({
      kind: 'shaped',
      id: 'tall',
      pattern: ['C ', 'S ', 'SC'],
      key: { C: ItemId.Coal, S: ItemId.Stick },
      result: { itemId: ItemId.Torch, count: 1 },
    });
    expect(tall.grid).toBe('3x3');
    expect(tall.displayGrid.cells).toEqual([ItemId.Coal, 0, ItemId.Stick, 0, ItemId.Stick, ItemId.Coal]);
    expect(tall.instruction).toContain('2 × Coal in the top-left and bottom-right slots');
    expect(tall.instruction).toContain('2 × Stick in the left column, middle and bottom rows');
  });

  it('builds from a custom RecipeRegistry', () => {
    const custom = new RecipeRegistry(
      [{ kind: 'shapeless', id: 'only', ingredients: [ItemId.Wood], result: { itemId: ItemId.Planks, count: 4 } }],
      itemRegistry,
    );
    expect(buildRecipeBook(custom, itemRegistry).map((e) => e.id)).toEqual(['only']);
  });
});

describe('countItems', () => {
  it('sums across stacks and ignores empty slots', () => {
    const inv = new Inventory();
    inv.add(createStack(ItemId.Planks, 64));
    inv.add(createStack(ItemId.Planks, 10));
    inv.add(createStack(ItemId.Stick, 3));
    const c = countItems((i) => inv.getSlot(i), inv.size);
    expect(c.get(ItemId.Planks)).toBe(74);
    expect(c.get(ItemId.Stick)).toBe(3);
    expect(c.get(ItemId.Coal)).toBeUndefined();
    expect(c).toEqual(new Map([[ItemId.Planks, 74], [ItemId.Stick, 3]]));
  });
});

describe('canCraftNow', () => {
  it('2x2 recipe: needs ingredients only; works at either screen', () => {
    const e = entryFor('crafting-table');
    expect(canCraftNow(e, counts([[ItemId.Planks, 4]]), '2x2')).toBe(true);
    expect(canCraftNow(e, counts([[ItemId.Planks, 4]]), '3x3')).toBe(true);
    expect(canCraftNow(e, counts([[ItemId.Planks, 3]]), '2x2')).toBe(false);
    expect(canCraftNow(e, counts([]), '2x2')).toBe(false);
  });

  it('3x3 recipe: not craftable from the inventory even with ingredients, craftable at a table', () => {
    const e = entryFor('wooden-pickaxe');
    const have = counts([[ItemId.Planks, 3], [ItemId.Stick, 2]]);
    expect(canCraftNow(e, have, '2x2')).toBe(false);
    expect(recipeCraftability(e, have, '2x2')).toEqual({ hasIngredients: true, gridAvailable: false, craftableNow: false });
    expect(canCraftNow(e, have, '3x3')).toBe(true);
    expect(canCraftNow(e, counts([[ItemId.Planks, 3], [ItemId.Stick, 1]]), '3x3')).toBe(false);
    expect(recipeCraftability(e, counts([]), '3x3')).toEqual({ hasIngredients: false, gridAvailable: true, craftableNow: false });
  });

  it('needs every ingredient, summed (planks across stacks)', () => {
    const inv = new Inventory();
    inv.add(createStack(ItemId.Planks, 64));
    inv.add(createStack(ItemId.Stick, 2));
    const c = countItems((i) => inv.getSlot(i), inv.size);
    expect(c.get(ItemId.Planks)).toBe(64);
    expect(canCraftNow(entryFor('wooden-pickaxe'), c, '3x3')).toBe(true); // 64 >= 3 planks, 2 >= 2 sticks
    inv.removeItem(ItemId.Stick, 1);
    expect(canCraftNow(entryFor('wooden-pickaxe'), countItems((i) => inv.getSlot(i), inv.size), '3x3')).toBe(false);
  });
});

describe('rankRecipes ordering', () => {
  it('craftable-now first, rest after, each group in registry order', () => {
    const have = counts([
      [ItemId.Planks, 64],
      [ItemId.Stick, 10],
      [ItemId.Cobblestone, 64],
    ]);
    const atInventory = rankRecipes(book, have, '2x2');
    const ready = atInventory.filter((r) => r.craftableNow).map((r) => r.entry.id);
    const rest = atInventory.filter((r) => !r.craftableNow).map((r) => r.entry.id);
    expect(atInventory.map((r) => r.entry.id)).toEqual([...ready, ...rest]);
    expect(ready).toEqual(['sticks-from-planks', 'crafting-table']);
    expect(rest).toEqual(RECIPE_DEFINITIONS.map((d) => d.id).filter((id) => !ready.includes(id)));
    // Every recipe is still listed (dimmed, not hidden).
    expect(atInventory.length).toBe(RECIPE_DEFINITIONS.length);
  });

  it('at a crafting table the 3x3 recipes join the craftable group', () => {
    const have = counts([
      [ItemId.Planks, 64],
      [ItemId.Stick, 10],
      [ItemId.Cobblestone, 64],
    ]);
    const atTable = rankRecipes(book, have, '3x3');
    const ready = atTable.filter((r) => r.craftableNow).map((r) => r.entry.id);
    expect(ready).toEqual([
      'sticks-from-planks',
      'crafting-table',
      'chest',
      'wooden-pickaxe',
      'stone-pickaxe',
      'wooden-axe',
      'stone-axe',
      'wooden-shovel',
      'stone-shovel',
    ]);
    expect(atTable.slice(0, ready.length).every((r) => r.craftableNow)).toBe(true);
    expect(atTable.slice(ready.length).every((r) => !r.craftableNow)).toBe(true);
  });

  it('with an empty inventory nothing is craftable and registry order is kept', () => {
    const ranked = rankRecipes(book, counts([]), '3x3');
    expect(ranked.every((r) => !r.craftableNow)).toBe(true);
    expect(ranked.map((r) => r.entry.id)).toEqual(RECIPE_DEFINITIONS.map((d) => d.id));
  });
});

describe('createRecipeHintGate (shown once)', () => {
  function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
  }

  it('shows the first time, then never again (same gate)', () => {
    const gate = createRecipeHintGate(memoryStorage());
    expect(gate.tryShow()).toBe(true);
    expect(gate.tryShow()).toBe(false);
    expect(gate.tryShow()).toBe(false);
  });

  it('is remembered across page loads via storage', () => {
    const storage = memoryStorage();
    expect(createRecipeHintGate(storage).tryShow()).toBe(true);
    expect(storage.data.has(RECIPE_BOOK_CONFIG.hintStorageKey)).toBe(true);
    expect(createRecipeHintGate(storage).tryShow()).toBe(false);
  });

  it('falls back to once per session when storage is missing or throws', () => {
    const none = createRecipeHintGate(null);
    expect(none.tryShow()).toBe(true);
    expect(none.tryShow()).toBe(false);
    const broken: SettingsStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const gate = createRecipeHintGate(broken);
    expect(gate.tryShow()).toBe(true);
    expect(gate.tryShow()).toBe(false);
  });
});
