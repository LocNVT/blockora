import { ItemId } from '../items/items';

/**
 * Data-driven crafting recipe definitions.
 *
 * Shaped recipes describe a fixed grid pattern (rows of equal length, 1-3 cells
 * per side). ' ' (space) marks an empty cell. `key` maps every non-space
 * character used in `pattern` to an ItemId. Patterns must already be trimmed:
 * no fully-empty outer row or column (RecipeRegistry validates this so the
 * matcher never has to re-trim at match time).
 *
 * Shapeless recipes just need the given multiset of ingredients anywhere in
 * the grid, regardless of arrangement.
 */
export interface ShapedRecipe {
  readonly kind: 'shaped';
  readonly id: string;
  readonly pattern: readonly string[];
  readonly key: Readonly<Record<string, ItemId>>;
  readonly result: { readonly itemId: ItemId; readonly count: number };
  /** Whether the horizontally-mirrored pattern also matches. Defaults to true. */
  readonly mirrorable?: boolean;
}

export interface ShapelessRecipe {
  readonly kind: 'shapeless';
  readonly id: string;
  readonly ingredients: readonly ItemId[];
  readonly result: { readonly itemId: ItemId; readonly count: number };
}

export type RecipeDefinition = ShapedRecipe | ShapelessRecipe;

export const RECIPE_DEFINITIONS: readonly RecipeDefinition[] = [
  {
    kind: 'shapeless',
    id: 'planks-from-wood',
    ingredients: [ItemId.Wood],
    result: { itemId: ItemId.Planks, count: 4 },
  },
  {
    kind: 'shaped',
    id: 'sticks-from-planks',
    pattern: ['P', 'P'],
    key: { P: ItemId.Planks },
    result: { itemId: ItemId.Stick, count: 4 },
  },
  {
    kind: 'shaped',
    id: 'crafting-table',
    pattern: ['PP', 'PP'],
    key: { P: ItemId.Planks },
    result: { itemId: ItemId.CraftingTable, count: 1 },
  },
  {
    kind: 'shaped',
    id: 'torch',
    pattern: ['C', 'S'],
    key: { C: ItemId.Coal, S: ItemId.Stick },
    result: { itemId: ItemId.Torch, count: 4 },
  },
  {
    kind: 'shaped',
    id: 'chest',
    pattern: ['PPP', 'P P', 'PPP'],
    key: { P: ItemId.Planks },
    result: { itemId: ItemId.Chest, count: 1 },
  },
  {
    kind: 'shaped',
    id: 'wooden-pickaxe',
    pattern: ['MMM', ' S ', ' S '],
    key: { M: ItemId.Planks, S: ItemId.Stick },
    result: { itemId: ItemId.WoodenPickaxe, count: 1 },
  },
  {
    kind: 'shaped',
    id: 'stone-pickaxe',
    pattern: ['MMM', ' S ', ' S '],
    key: { M: ItemId.Cobblestone, S: ItemId.Stick },
    result: { itemId: ItemId.StonePickaxe, count: 1 },
  },
  {
    kind: 'shaped',
    id: 'wooden-axe',
    pattern: ['MM', 'MS', ' S'],
    key: { M: ItemId.Planks, S: ItemId.Stick },
    result: { itemId: ItemId.WoodenAxe, count: 1 },
  },
  {
    kind: 'shaped',
    id: 'stone-axe',
    pattern: ['MM', 'MS', ' S'],
    key: { M: ItemId.Cobblestone, S: ItemId.Stick },
    result: { itemId: ItemId.StoneAxe, count: 1 },
  },
  {
    kind: 'shaped',
    id: 'wooden-shovel',
    pattern: ['M', 'S', 'S'],
    key: { M: ItemId.Planks, S: ItemId.Stick },
    result: { itemId: ItemId.WoodenShovel, count: 1 },
  },
  {
    kind: 'shaped',
    id: 'stone-shovel',
    pattern: ['M', 'S', 'S'],
    key: { M: ItemId.Cobblestone, S: ItemId.Stick },
    result: { itemId: ItemId.StoneShovel, count: 1 },
  },
];
