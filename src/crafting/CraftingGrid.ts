import type { ItemStack } from '../items/ItemStack';
import type { ItemId } from '../items/items';
import type { CraftingGridView, RecipeRegistry } from './RecipeRegistry';

/**
 * Small stateful crafting grid (2x2 player grid or 3x3 crafting table).
 * Holds ItemStack | null per cell. UI-independent: no rendering concerns.
 */
export class CraftingGrid {
  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private readonly cellStacks: (ItemStack | null)[];
  /** Reused scratch buffer for `view()` so repeated calls don't allocate. */
  private readonly viewCells: (ItemId | 0)[];

  constructor(width: 2 | 3, height: 2 | 3) {
    this.gridWidth = width;
    this.gridHeight = height;
    this.cellStacks = new Array<ItemStack | null>(width * height).fill(null);
    this.viewCells = new Array<ItemId | 0>(width * height).fill(0);
  }

  get width(): number {
    return this.gridWidth;
  }

  get height(): number {
    return this.gridHeight;
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.cellStacks.length) {
      throw new RangeError(
        `CraftingGrid: index ${index} out of range (0..${this.cellStacks.length - 1}).`,
      );
    }
  }

  get(index: number): ItemStack | null {
    this.assertIndex(index);
    return this.cellStacks[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    this.assertIndex(index);
    this.cellStacks[index] = stack;
  }

  /** Returns a view of the grid's current contents. Reuses an internal buffer — do not retain across mutations. */
  view(): CraftingGridView {
    for (let i = 0; i < this.cellStacks.length; i++) {
      const stack = this.cellStacks[i];
      this.viewCells[i] = stack ? stack.itemId : 0;
    }
    return { width: this.gridWidth, height: this.gridHeight, cells: this.viewCells };
  }

  /**
   * Attempts to craft using the given registry. On a match, consumes exactly
   * one item from each non-empty cell involved (stacks are immutable — a
   * depleted stack becomes null, otherwise a new stack with count-1 replaces
   * it) and returns the result stack. On no match, the grid is left unchanged
   * and null is returned.
   */
  craft(registry: RecipeRegistry): ItemStack | null {
    const match = registry.match(this.view());
    if (match === null) return null;

    for (let i = 0; i < this.cellStacks.length; i++) {
      const stack = this.cellStacks[i];
      if (stack === null || stack === undefined) continue;
      this.cellStacks[i] =
        stack.count > 1 ? { itemId: stack.itemId, count: stack.count - 1 } : null;
    }

    return match.result;
  }

  /** Removes and returns all contents, leaving the grid empty. */
  clear(): (ItemStack | null)[] {
    const contents = this.cellStacks.slice();
    this.cellStacks.fill(null);
    return contents;
  }
}
