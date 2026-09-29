import type { ItemId } from '../items/items';
import { itemRegistry, type ItemRegistry } from '../items/ItemRegistry';
import { createStack, type ItemStack } from '../items/ItemStack';
import {
  RECIPE_DEFINITIONS,
  type RecipeDefinition,
  type ShapedRecipe,
  type ShapelessRecipe,
} from './recipes';

const MAX_GRID_SIDE = 3;

/**
 * A read-only view into a crafting grid's contents.
 * `cells` is row-major, length `width * height`; 0 means an empty cell.
 */
export interface CraftingGridView {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly (ItemId | 0)[];
}

export interface RecipeMatch {
  readonly recipe: RecipeDefinition;
  readonly result: ItemStack;
}

/** Precomputed, allocation-free-to-match representation of a shaped pattern. */
interface NormalizedShape {
  readonly width: number;
  readonly height: number;
  /** Row-major flattened cells, 0 = empty. */
  readonly cells: readonly (ItemId | 0)[];
}

interface NormalizedRecipe {
  readonly definition: RecipeDefinition;
  /** Present only for shaped recipes: the base shape and (if applicable) its mirror. */
  readonly shapes?: readonly NormalizedShape[];
  /** Present only for shapeless recipes: ingredient ids sorted ascending. */
  readonly sortedIngredients?: readonly ItemId[];
}

function flattenPattern(
  pattern: readonly string[],
  key: Readonly<Record<string, ItemId>>,
): NormalizedShape {
  const height = pattern.length;
  const width = pattern[0]?.length ?? 0;
  const cells: (ItemId | 0)[] = new Array(width * height).fill(0);

  for (let y = 0; y < height; y++) {
    const row = pattern[y] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ' ';
      if (ch === ' ') continue;
      cells[x + width * y] = key[ch] as ItemId;
    }
  }

  return { width, height, cells };
}

function mirrorShape(shape: NormalizedShape): NormalizedShape {
  const { width, height, cells } = shape;
  const mirrored: (ItemId | 0)[] = new Array(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      mirrored[width - 1 - x + width * y] = cells[x + width * y] as ItemId | 0;
    }
  }
  return { width, height, cells: mirrored };
}

function shapesEqual(a: NormalizedShape, b: NormalizedShape): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.cells.length; i++) {
    if (a.cells[i] !== b.cells[i]) return false;
  }
  return true;
}

function sortedMultiset(ids: readonly ItemId[]): ItemId[] {
  return [...ids].sort((a, b) => a - b);
}

function multisetsEqual(a: readonly ItemId[], b: readonly ItemId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Non-empty cells of a shape as a sorted multiset (for ambiguity checks against shapeless recipes). */
function shapeNonEmptyMultiset(shape: NormalizedShape): ItemId[] {
  const ids: ItemId[] = [];
  for (const cell of shape.cells) {
    if (cell !== 0) ids.push(cell);
  }
  return sortedMultiset(ids);
}

/**
 * Registry of crafting recipes: validates definitions at construction and
 * precomputes normalized forms so `match()` does no per-recipe allocation.
 *
 * Ambiguity check (kept intentionally simple and deterministic):
 * - Two shaped recipes are ambiguous if their normalized shapes are identical,
 *   including a mirrored variant (when `mirrorable` is not false).
 * - Two shapeless recipes are ambiguous if their sorted ingredient multisets
 *   are identical.
 * - A shapeless recipe is ambiguous with a shaped recipe if the shaped
 *   pattern's non-empty cells form the same multiset as the shapeless
 *   ingredients: a shapeless recipe accepts any arrangement, so the shaped
 *   pattern's own arrangement would match both.
 * Recipes are matched in registration order, so if ambiguity were not
 * rejected the first-registered recipe would silently shadow the rest —
 * validation catches this at construction instead.
 */
export class RecipeRegistry {
  private readonly normalized: readonly NormalizedRecipe[];

  constructor(
    definitions: readonly RecipeDefinition[] = RECIPE_DEFINITIONS,
    registry: ItemRegistry = itemRegistry,
  ) {
    RecipeRegistry.validate(definitions, registry);
    this.normalized = definitions.map((definition) => RecipeRegistry.normalize(definition));
  }

  private static normalize(definition: RecipeDefinition): NormalizedRecipe {
    if (definition.kind === 'shapeless') {
      return { definition, sortedIngredients: sortedMultiset(definition.ingredients) };
    }

    const base = flattenPattern(definition.pattern, definition.key);
    const mirrorable = definition.mirrorable ?? true;
    if (!mirrorable) {
      return { definition, shapes: [base] };
    }
    const mirrored = mirrorShape(base);
    const shapes = shapesEqual(base, mirrored) ? [base] : [base, mirrored];
    return { definition, shapes };
  }

  private static validate(
    definitions: readonly RecipeDefinition[],
    registry: ItemRegistry,
  ): void {
    const seenIds = new Set<string>();
    const normalizedShapes: { id: string; shapes: NormalizedShape[] }[] = [];
    const shapelessMultisets: { id: string; multiset: ItemId[] }[] = [];

    for (const def of definitions) {
      if (seenIds.has(def.id)) {
        throw new Error(`RecipeRegistry: duplicate recipe id "${def.id}".`);
      }
      seenIds.add(def.id);

      if (!registry.has(def.result.itemId)) {
        throw new Error(
          `RecipeRegistry: recipe "${def.id}" result item ${def.result.itemId} is not registered.`,
        );
      }
      if (!Number.isInteger(def.result.count) || def.result.count < 1) {
        throw new Error(
          `RecipeRegistry: recipe "${def.id}" result count must be a positive integer, got ${def.result.count}.`,
        );
      }
      const maxStack = registry.maxStackSize(def.result.itemId);
      if (def.result.count > maxStack) {
        throw new Error(
          `RecipeRegistry: recipe "${def.id}" result count ${def.result.count} exceeds max stack size ${maxStack}.`,
        );
      }

      if (def.kind === 'shaped') {
        RecipeRegistry.validateShaped(def, registry);
        const base = flattenPattern(def.pattern, def.key);
        const mirrorable = def.mirrorable ?? true;
        const mirrored = mirrorShape(base);
        const shapes =
          mirrorable && !shapesEqual(base, mirrored) ? [base, mirrored] : [base];

        for (const existing of normalizedShapes) {
          for (const shape of shapes) {
            for (const existingShape of existing.shapes) {
              if (shapesEqual(shape, existingShape)) {
                throw new Error(
                  `RecipeRegistry: recipe "${def.id}" is ambiguous with recipe "${existing.id}" (identical shape, possibly via mirroring).`,
                );
              }
            }
          }
        }

        // Ambiguity against shapeless recipes: same item multiset means the
        // shaped arrangement itself would also satisfy the shapeless recipe.
        const nonEmptyMultiset = shapeNonEmptyMultiset(base);
        for (const existing of shapelessMultisets) {
          if (multisetsEqual(nonEmptyMultiset, existing.multiset)) {
            throw new Error(
              `RecipeRegistry: recipe "${def.id}" is ambiguous with shapeless recipe "${existing.id}" (same ingredient multiset).`,
            );
          }
        }

        normalizedShapes.push({ id: def.id, shapes });
      } else {
        RecipeRegistry.validateShapeless(def, registry);
        const multiset = sortedMultiset(def.ingredients);

        for (const existing of shapelessMultisets) {
          if (multisetsEqual(multiset, existing.multiset)) {
            throw new Error(
              `RecipeRegistry: recipe "${def.id}" is ambiguous with shapeless recipe "${existing.id}" (identical ingredient multiset).`,
            );
          }
        }
        for (const existing of normalizedShapes) {
          // Mirroring never changes a shape's multiset, so the base shape suffices.
          const existingBase = existing.shapes[0];
          if (existingBase && multisetsEqual(multiset, shapeNonEmptyMultiset(existingBase))) {
            throw new Error(
              `RecipeRegistry: recipe "${def.id}" is ambiguous with shaped recipe "${existing.id}" (same ingredient multiset).`,
            );
          }
        }

        shapelessMultisets.push({ id: def.id, multiset });
      }
    }
  }

  private static validateShaped(def: ShapedRecipe, registry: ItemRegistry): void {
    const { pattern, key, id } = def;

    if (pattern.length < 1 || pattern.length > MAX_GRID_SIDE) {
      throw new Error(
        `RecipeRegistry: recipe "${id}" pattern must have 1-${MAX_GRID_SIDE} rows, got ${pattern.length}.`,
      );
    }

    const width = pattern[0]?.length ?? 0;
    if (width < 1 || width > MAX_GRID_SIDE) {
      throw new Error(
        `RecipeRegistry: recipe "${id}" pattern rows must be 1-${MAX_GRID_SIDE} chars wide, got ${width}.`,
      );
    }
    for (const row of pattern) {
      if (row.length !== width) {
        throw new Error(
          `RecipeRegistry: recipe "${id}" pattern rows must all have equal length (expected ${width}, got "${row}" with length ${row.length}).`,
        );
      }
    }

    const usedKeys = new Set<string>();
    let anyNonEmpty = false;
    for (const row of pattern) {
      for (const ch of row) {
        if (ch === ' ') continue;
        anyNonEmpty = true;
        usedKeys.add(ch);
        if (!(ch in key)) {
          throw new Error(
            `RecipeRegistry: recipe "${id}" pattern uses key "${ch}" which has no entry in \`key\`.`,
          );
        }
      }
    }
    if (!anyNonEmpty) {
      throw new Error(`RecipeRegistry: recipe "${id}" pattern must not be entirely empty.`);
    }

    for (const keyChar of Object.keys(key)) {
      if (!usedKeys.has(keyChar)) {
        throw new Error(
          `RecipeRegistry: recipe "${id}" key entry "${keyChar}" is never used in the pattern.`,
        );
      }
      const itemId = key[keyChar];
      if (itemId === undefined || !registry.has(itemId)) {
        throw new Error(
          `RecipeRegistry: recipe "${id}" key entry "${keyChar}" references unregistered item ${String(itemId)}.`,
        );
      }
    }

    // No fully-empty outer row or column (patterns must be pre-trimmed).
    const height = pattern.length;
    const isRowEmpty = (y: number): boolean =>
      [...(pattern[y] ?? '')].every((ch) => ch === ' ');
    const isColEmpty = (x: number): boolean =>
      pattern.every((row) => row[x] === ' ');

    if (height > 1 && (isRowEmpty(0) || isRowEmpty(height - 1))) {
      throw new Error(
        `RecipeRegistry: recipe "${id}" pattern has a fully-empty outer row; patterns must be pre-trimmed.`,
      );
    }
    if (width > 1 && (isColEmpty(0) || isColEmpty(width - 1))) {
      throw new Error(
        `RecipeRegistry: recipe "${id}" pattern has a fully-empty outer column; patterns must be pre-trimmed.`,
      );
    }
  }

  private static validateShapeless(def: ShapelessRecipe, registry: ItemRegistry): void {
    const { ingredients, id } = def;
    if (ingredients.length < 1 || ingredients.length > 9) {
      throw new Error(
        `RecipeRegistry: recipe "${id}" shapeless ingredients must have 1-9 entries, got ${ingredients.length}.`,
      );
    }
    for (const itemId of ingredients) {
      if (!registry.has(itemId)) {
        throw new Error(
          `RecipeRegistry: recipe "${id}" ingredient ${itemId} is not registered.`,
        );
      }
    }
  }

  /** Number of registered recipes. */
  get size(): number {
    return this.normalized.length;
  }

  private static validateGridView(view: CraftingGridView): void {
    if (
      !Number.isInteger(view.width) ||
      !Number.isInteger(view.height) ||
      view.width < 1 ||
      view.height < 1
    ) {
      throw new Error(
        `RecipeRegistry: invalid grid dimensions (${view.width}x${view.height}).`,
      );
    }
    if (view.cells.length !== view.width * view.height) {
      throw new Error(
        `RecipeRegistry: grid cells length ${view.cells.length} does not match width*height (${view.width * view.height}).`,
      );
    }
  }

  /**
   * Attempts to match a crafting grid against all registered recipes, in
   * registration order. Returns the first match, or null if nothing matches.
   */
  match(view: CraftingGridView): RecipeMatch | null {
    RecipeRegistry.validateGridView(view);

    const box = computeBoundingBox(view);
    if (box === null) return null;

    for (const entry of this.normalized) {
      if (entry.shapes !== undefined) {
        if (matchesAnyShape(entry.shapes, view, box)) {
          return {
            recipe: entry.definition,
            result: createStack(entry.definition.result.itemId, entry.definition.result.count),
          };
        }
      } else if (entry.sortedIngredients !== undefined) {
        if (matchesShapeless(entry.sortedIngredients, view, box)) {
          return {
            recipe: entry.definition,
            result: createStack(entry.definition.result.itemId, entry.definition.result.count),
          };
        }
      }
    }

    return null;
  }
}

interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

function computeBoundingBox(view: CraftingGridView): BoundingBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < view.height; y++) {
    for (let x = 0; x < view.width; x++) {
      const cell = view.cells[x + view.width * y];
      if (cell !== 0 && cell !== undefined) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX) return null; // empty grid

  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function matchesAnyShape(
  shapes: readonly NormalizedShape[],
  view: CraftingGridView,
  box: BoundingBox,
): boolean {
  for (const shape of shapes) {
    if (matchesShape(shape, view, box)) return true;
  }
  return false;
}

function matchesShape(shape: NormalizedShape, view: CraftingGridView, box: BoundingBox): boolean {
  if (shape.width !== box.width || shape.height !== box.height) return false;

  for (let y = 0; y < shape.height; y++) {
    for (let x = 0; x < shape.width; x++) {
      const expected = shape.cells[x + shape.width * y];
      const actual = view.cells[box.minX + x + view.width * (box.minY + y)];
      if (expected !== actual) return false;
    }
  }
  return true;
}

function matchesShapeless(
  sortedIngredients: readonly ItemId[],
  view: CraftingGridView,
  box: BoundingBox,
): boolean {
  const actual: ItemId[] = [];
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const cell = view.cells[box.minX + x + view.width * (box.minY + y)];
      if (cell !== 0 && cell !== undefined) actual.push(cell);
    }
  }
  return multisetsEqual(sortedMultiset(actual), sortedIngredients);
}

export const recipeRegistry = new RecipeRegistry(RECIPE_DEFINITIONS);
