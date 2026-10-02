import { itemRegistry, type ItemRegistry } from '../items/ItemRegistry';
import type { ItemStack } from '../items/ItemStack';
import type { ItemId } from '../items/items';
import { recipeRegistry, type RecipeRegistry } from './RecipeRegistry';
import type { RecipeDefinition } from './recipes';

/**
 * Pure model behind the in-game recipe book. Everything here is derived from
 * the RecipeRegistry (no recipe is written out by hand) so a new recipe shows
 * up in the book, with generated instructions, automatically.
 */

/** Smallest crafting grid a recipe fits in: '2x2' = the inventory grid, '3x3' = needs a crafting table. */
export type GridSize = '2x2' | '3x3';

export interface RecipeBookIngredient {
  readonly itemId: ItemId;
  readonly displayName: string;
  readonly count: number;
}

export interface RecipeDisplayGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major, length `width * height`; 0 = empty cell. */
  readonly cells: readonly (ItemId | 0)[];
}

export interface RecipeBookEntry {
  readonly id: string;
  readonly result: { readonly itemId: ItemId; readonly count: number; readonly displayName: string };
  readonly grid: GridSize;
  readonly displayGrid: RecipeDisplayGrid;
  /** Distinct ingredients with totals, in order of first appearance. */
  readonly ingredients: readonly RecipeBookIngredient[];
  /** e.g. "3 × Wooden Planks, 2 × Stick". */
  readonly ingredientSummary: string;
  /** One plain-language sentence telling the player how to arrange the ingredients. */
  readonly instruction: string;
}

/** Item counts keyed by item id (inventory totals). */
export type ItemCounts = ReadonlyMap<ItemId, number>;

export interface RecipeCraftability {
  /** Enough of every ingredient in the inventory. */
  readonly hasIngredients: boolean;
  /** The grid the recipe needs exists on the current screen. */
  readonly gridAvailable: boolean;
  /** hasIngredients && gridAvailable. */
  readonly craftableNow: boolean;
}

export interface RankedRecipe extends RecipeCraftability {
  readonly entry: RecipeBookEntry;
}

const MAX_2X2_SIDE = 2;
const MAX_2X2_SHAPELESS_INGREDIENTS = 4;

/** Columns x rows used to lay out `count` shapeless ingredients left to right. */
function shapelessLayout(count: number): { width: number; height: number } {
  const width = count <= 3 ? count : count === 4 ? 2 : 3;
  return { width, height: Math.ceil(count / width) };
}

function gridSizeFor(width: number, height: number): GridSize {
  return Math.max(width, height) <= MAX_2X2_SIDE ? '2x2' : '3x3';
}

function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const ROW_NAMES: Readonly<Record<number, readonly string[]>> = {
  2: ['top', 'bottom'],
  3: ['top', 'middle', 'bottom'],
};
const COLUMN_NAMES: Readonly<Record<number, readonly string[]>> = {
  2: ['left', 'right'],
  3: ['left', 'middle', 'right'],
};

function rowName(y: number, height: number): string {
  return ROW_NAMES[height]?.[y] ?? `row ${y + 1}`;
}

function columnName(x: number, width: number): string {
  return COLUMN_NAMES[width]?.[x] ?? `column ${x + 1}`;
}

/** Position name of a cell relative to the pattern: "top-left", "center", "bottom", ... */
function cellName(x: number, y: number, width: number, height: number): string {
  const row = height > 1 ? rowName(y, height) : null;
  const column = width > 1 ? columnName(x, width) : null;
  if (row !== null && column !== null) {
    return row === 'middle' && column === 'middle' ? 'center' : `${row}-${column}`;
  }
  return row ?? column ?? 'only';
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Where (inside the pattern) the cells of one ingredient go, as a phrase such as "across the top row". */
function describeCells(cells: readonly number[], width: number, height: number): string {
  const xs = (i: number): number => i % width;
  const ys = (i: number): number => Math.floor(i / width);
  const columns = unique(cells.map(xs));
  const rows = unique(cells.map(ys));

  if (width === 1) {
    const names = rows.map((y) => rowName(y, height));
    return `in the ${joinList(names)} ${names.length > 1 ? 'slots' : 'slot'}`;
  }
  if (height === 1) {
    const names = columns.map((x) => columnName(x, width));
    return `in the ${joinList(names)} ${names.length > 1 ? 'slots' : 'slot'}`;
  }
  if (cells.length === rows.length * width) {
    const names = rows.map((y) => rowName(y, height));
    return `across the ${joinList(names)} ${names.length > 1 ? 'rows' : 'row'}`;
  }
  if (cells.length === columns.length * height) {
    const names = columns.map((x) => columnName(x, width));
    return `down the ${joinList(names)} ${names.length > 1 ? 'columns' : 'column'}`;
  }
  if (columns.length === 1) {
    const names = rows.map((y) => rowName(y, height));
    return `in the ${columnName(columns[0] ?? 0, width)} column, ${joinList(names)} ${names.length > 1 ? 'rows' : 'row'}`;
  }
  if (rows.length === 1) {
    const names = columns.map((x) => columnName(x, width));
    return `in the ${rowName(rows[0] ?? 0, height)} row, ${joinList(names)} ${names.length > 1 ? 'columns' : 'column'}`;
  }
  const names = cells.map((i) => cellName(xs(i), ys(i), width, height));
  return `in the ${joinList(names)} slots`;
}

function ingredientText(ingredient: RecipeBookIngredient): string {
  return `${ingredient.count} × ${ingredient.displayName}`;
}

function describeShaped(grid: RecipeDisplayGrid, ingredients: readonly RecipeBookIngredient[]): string {
  const { width, height, cells } = grid;
  const cellsByItem = new Map<ItemId, number[]>();
  const emptyCells: number[] = [];
  cells.forEach((cell, index) => {
    if (cell === 0) {
      emptyCells.push(index);
      return;
    }
    const list = cellsByItem.get(cell);
    if (list === undefined) cellsByItem.set(cell, [index]);
    else list.push(index);
  });

  const only = ingredients.length === 1 ? ingredients[0] : undefined;
  if (only !== undefined) {
    const text = ingredientText(only);
    if (emptyCells.length > 0) {
      const gaps = joinList(emptyCells.map((i) => cellName(i % width, Math.floor(i / width), width, height)));
      return `put ${text} in a ${width}×${height} square, leaving the ${gaps} empty`;
    }
    if (width === 1) return `put ${text}, one above the other`;
    if (height === 1) return `put ${text} side by side in a row`;
    return `fill a ${width}×${height} square with ${text}`;
  }

  const parts = ingredients.map(
    (ingredient) =>
      `${ingredientText(ingredient)} ${describeCells(cellsByItem.get(ingredient.itemId) ?? [], width, height)}`,
  );
  const stacked =
    width === 1 ? ', stacked in one column' : height === 1 ? ', side by side in one row' : '';
  return `put ${joinList(parts)}${stacked}`;
}

function aggregateIngredients(ids: readonly ItemId[], registry: ItemRegistry): RecipeBookIngredient[] {
  const counts = new Map<ItemId, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([itemId, count]) => ({
    itemId,
    count,
    displayName: registry.get(itemId).displayName,
  }));
}

function buildDisplayGrid(definition: RecipeDefinition): RecipeDisplayGrid {
  if (definition.kind === 'shaped') {
    const height = definition.pattern.length;
    const width = definition.pattern[0]?.length ?? 0;
    const cells: (ItemId | 0)[] = [];
    for (const row of definition.pattern) {
      for (let x = 0; x < width; x += 1) {
        const ch = row[x] ?? ' ';
        cells.push(ch === ' ' ? 0 : (definition.key[ch] as ItemId));
      }
    }
    return { width, height, cells };
  }
  const { width, height } = shapelessLayout(definition.ingredients.length);
  const cells: (ItemId | 0)[] = new Array<ItemId | 0>(width * height).fill(0);
  definition.ingredients.forEach((id, index) => {
    cells[index] = id;
  });
  return { width, height, cells };
}

/** Builds the book entry for one recipe definition. */
export function buildRecipeBookEntry(
  definition: RecipeDefinition,
  registry: ItemRegistry = itemRegistry,
): RecipeBookEntry {
  const displayGrid = buildDisplayGrid(definition);
  const orderedIds =
    definition.kind === 'shaped'
      ? displayGrid.cells.filter((cell): cell is ItemId => cell !== 0)
      : definition.ingredients;
  const ingredients = aggregateIngredients(orderedIds, registry);

  const grid: GridSize =
    definition.kind === 'shaped'
      ? gridSizeFor(displayGrid.width, displayGrid.height)
      : definition.ingredients.length <= MAX_2X2_SHAPELESS_INGREDIENTS
        ? '2x2'
        : '3x3';

  const prefix = grid === '2x2' ? 'Inventory or crafting table' : 'Crafting table';
  const body =
    definition.kind === 'shaped'
      ? describeShaped(displayGrid, ingredients)
      : `put ${joinList(ingredients.map(ingredientText))} anywhere in the grid`;

  return {
    id: definition.id,
    result: {
      itemId: definition.result.itemId,
      count: definition.result.count,
      displayName: registry.get(definition.result.itemId).displayName,
    },
    grid,
    displayGrid,
    ingredients,
    ingredientSummary: ingredients.map(ingredientText).join(', '),
    instruction: `${prefix}: ${body}.`,
  };
}

/** Entries for every registered recipe, in registry order. */
export function buildRecipeBook(
  recipes: RecipeRegistry = recipeRegistry,
  registry: ItemRegistry = itemRegistry,
): RecipeBookEntry[] {
  return recipes.all().map((definition) => buildRecipeBookEntry(definition, registry));
}

/** Total count per item over the first `slotCount` slots read through `getSlot`. */
export function countItems(
  getSlot: (index: number) => ItemStack | null,
  slotCount: number,
): Map<ItemId, number> {
  const counts = new Map<ItemId, number>();
  for (let i = 0; i < slotCount; i += 1) {
    const stack = getSlot(i);
    if (stack !== null) counts.set(stack.itemId, (counts.get(stack.itemId) ?? 0) + stack.count);
  }
  return counts;
}

/**
 * Whether `entry` can be crafted right now: every ingredient is held in
 * sufficient quantity AND the screen offers a big enough grid (`availableGrid`
 * is '3x3' only at a crafting table; a 3x3 recipe is never craftable from the
 * plain inventory screen, a 2x2 recipe works at either).
 */
export function recipeCraftability(
  entry: RecipeBookEntry,
  counts: ItemCounts,
  availableGrid: GridSize,
): RecipeCraftability {
  const hasIngredients = entry.ingredients.every((ing) => (counts.get(ing.itemId) ?? 0) >= ing.count);
  const gridAvailable = entry.grid === '2x2' || availableGrid === '3x3';
  return { hasIngredients, gridAvailable, craftableNow: hasIngredients && gridAvailable };
}

export function canCraftNow(entry: RecipeBookEntry, counts: ItemCounts, availableGrid: GridSize): boolean {
  return recipeCraftability(entry, counts, availableGrid).craftableNow;
}

/** Craftable-now entries first, then the rest; each group keeps the given (registry) order. */
export function rankRecipes(
  entries: readonly RecipeBookEntry[],
  counts: ItemCounts,
  availableGrid: GridSize,
): RankedRecipe[] {
  const ranked = entries.map((entry) => ({ entry, ...recipeCraftability(entry, counts, availableGrid) }));
  return [...ranked.filter((r) => r.craftableNow), ...ranked.filter((r) => !r.craftableNow)];
}
