import { RECIPE_BOOK_CONFIG } from '../config/constants';
import type { ItemRegistry } from '../items/ItemRegistry';
import type { ItemId } from '../items/items';
import { iconTileForItem } from '../items/itemIcons';
import type { BlockRegistry } from '../world/BlockRegistry';
import {
  rankRecipes,
  type GridSize,
  type ItemCounts,
  type RankedRecipe,
  type RecipeBookEntry,
} from '../crafting/recipeBook';
import { ItemIconCache } from './itemIconCache';
import { describeItem, placeTooltip } from './itemTooltip';
import type { RecipeHintGate } from './recipeHint';

const STYLE_ELEMENT_ID = 'recipe-book-style';
const TOOLTIP_Z_INDEX = 30;

const HINT_TEXT = 'New? Press R or click Recipes to see what you can craft.';

export interface RecipeBookDeps {
  readonly entries: readonly RecipeBookEntry[];
  readonly itemRegistry: ItemRegistry;
  readonly blockRegistry: BlockRegistry;
  readonly iconCache: ItemIconCache;
  readonly hintGate: RecipeHintGate;
  /** Called whenever the book opens or closes (the inventory screen hides its panel on narrow viewports). */
  readonly onOpenChange?: (open: boolean) => void;
}

interface EntryElements {
  readonly root: HTMLDivElement;
  readonly tag: HTMLSpanElement;
  readonly status: HTMLDivElement;
}

/**
 * Recipe book side panel for the inventory / crafting screens. Shows every
 * recipe of the supplied entries with a mini pattern grid, result, grid tag,
 * ingredient summary and instruction; craftable-now entries come first and are
 * highlighted, the rest stay visible but dimmed. Entry DOM is built once;
 * `refresh()` only re-styles / re-orders when the craftable state changed.
 * Contains no recipe knowledge: all content comes from `RecipeBookEntry`.
 */
export class RecipeBook {
  /** "Recipes" toggle (>= 44px tall); the inventory screen places it. */
  readonly toggleButton: HTMLButtonElement;
  /** Dismissible first-time hint; hidden unless `screenOpened` decides to show it. */
  readonly hintElement: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly tooltipEl: HTMLDivElement;
  private readonly elements = new Map<string, EntryElements>();
  private availableGrid: GridSize = '2x2';
  private opened = false;
  private lastKey = '';
  private lastOrder: readonly string[] = [];
  private tooltipItem: ItemId | null = null;

  constructor(
    overlay: HTMLElement,
    private readonly deps: RecipeBookDeps,
  ) {
    RecipeBook.ensureStyleInjected(overlay.ownerDocument);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'recipe-book__toggle';
    toggle.textContent = 'Recipes (R)';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.onclick = () => this.setOpen(!this.opened);
    this.toggleButton = toggle;

    const hint = document.createElement('div');
    hint.className = 'recipe-book__hint';
    hint.style.display = 'none';
    const hintText = document.createElement('span');
    hintText.textContent = HINT_TEXT;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'recipe-book__hint-dismiss';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', 'Dismiss hint');
    dismiss.onclick = () => this.hideHint();
    hint.append(hintText, dismiss);
    this.hintElement = hint;

    const panel = document.createElement('div');
    panel.className = 'recipe-book';
    panel.style.display = 'none';
    const header = document.createElement('div');
    header.className = 'recipe-book__header';
    const title = document.createElement('div');
    title.className = 'recipe-book__title';
    title.textContent = 'Recipes';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'recipe-book__close';
    close.textContent = 'Close (R)';
    close.onclick = () => this.setOpen(false);
    header.append(title, close);
    const list = document.createElement('div');
    list.className = 'recipe-book__list';
    panel.append(header, list);
    overlay.appendChild(panel);
    this.panel = panel;
    this.list = list;

    const tooltip = document.createElement('div');
    tooltip.className = 'recipe-book__tooltip';
    overlay.appendChild(tooltip);
    this.tooltipEl = tooltip;
    panel.addEventListener('mouseleave', () => this.hideTooltip());
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** The screen opened in a crafting mode: remember the grid it offers, start closed, maybe show the one-time hint. */
  screenOpened(availableGrid: GridSize): void {
    this.availableGrid = availableGrid;
    this.setOpen(false);
    this.lastKey = '';
    if (this.deps.hintGate.tryShow()) {
      this.hintElement.style.display = 'flex';
    }
  }

  /** The screen closed (or switched to chest mode, which has no recipe book). */
  screenClosed(): void {
    this.setOpen(false);
    this.hideHint();
  }

  hideHint(): void {
    this.hintElement.style.display = 'none';
  }

  toggle(): void {
    this.setOpen(!this.opened);
  }

  setOpen(open: boolean): void {
    if (open === this.opened) return;
    this.opened = open;
    this.panel.style.display = open ? 'flex' : 'none';
    this.toggleButton.setAttribute('aria-expanded', String(open));
    if (open) {
      this.hideHint();
      this.ensureBuilt();
      this.lastKey = '';
      this.panel.scrollTop = 0;
    } else {
      this.hideTooltip();
    }
    this.deps.onOpenChange?.(open);
  }

  /** Re-ranks / re-styles the entries for the current inventory totals; a no-op when nothing relevant changed. */
  refresh(counts: ItemCounts): void {
    if (!this.opened) return;
    const ranked = rankRecipes(this.deps.entries, counts, this.availableGrid);
    const key = ranked
      .map((r) => `${r.entry.id}:${r.hasIngredients ? 1 : 0}${r.gridAvailable ? 1 : 0}`)
      .join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.applyRanking(ranked);
  }

  private applyRanking(ranked: readonly RankedRecipe[]): void {
    const order = ranked.map((r) => r.entry.id);
    for (const r of ranked) {
      const el = this.elements.get(r.entry.id);
      if (el === undefined) continue;
      el.root.classList.toggle('recipe-book__entry--ready', r.craftableNow);
      el.root.classList.toggle('recipe-book__entry--dim', !r.craftableNow);
      el.tag.textContent = this.tagText(r.entry);
      el.status.textContent = this.statusText(r);
    }
    if (order.join('|') !== this.lastOrder.join('|')) {
      for (const id of order) {
        const el = this.elements.get(id);
        if (el !== undefined) this.list.appendChild(el.root);
      }
      this.lastOrder = order;
    }
  }

  private tagText(entry: RecipeBookEntry): string {
    if (entry.grid === '3x3') {
      return this.availableGrid === '3x3' ? 'Crafting table' : 'Needs crafting table';
    }
    return '2×2 grid';
  }

  private statusText(r: RankedRecipe): string {
    if (r.craftableNow) return 'You can craft this now';
    if (!r.gridAvailable) return 'Use a crafting table';
    return 'Missing ingredients';
  }

  private ensureBuilt(): void {
    if (this.elements.size > 0) return;
    for (const entry of this.deps.entries) {
      const built = this.buildEntry(entry);
      this.elements.set(entry.id, built);
      this.list.appendChild(built.root);
    }
  }

  private buildEntry(entry: RecipeBookEntry): EntryElements {
    const root = document.createElement('div');
    root.className = 'recipe-book__entry';

    const row = document.createElement('div');
    row.className = 'recipe-book__row';

    const pattern = document.createElement('div');
    pattern.className = 'recipe-book__pattern';
    pattern.style.gridTemplateColumns = `repeat(${entry.displayGrid.width}, ${RECIPE_BOOK_CONFIG.miniSlotPx}px)`;
    for (const cell of entry.displayGrid.cells) {
      pattern.appendChild(this.buildCell(cell === 0 ? null : cell, null));
    }

    const arrow = document.createElement('div');
    arrow.className = 'recipe-book__arrow';
    arrow.textContent = '→';

    const result = this.buildCell(entry.result.itemId, entry.result.count);
    result.classList.add('recipe-book__cell--result');

    const meta = document.createElement('div');
    meta.className = 'recipe-book__meta';
    const name = document.createElement('div');
    name.className = 'recipe-book__name';
    name.textContent = entry.result.displayName;
    const tag = document.createElement('span');
    tag.className = 'recipe-book__tag';
    meta.append(name, tag);

    row.append(pattern, arrow, result, meta);

    const ingredients = document.createElement('div');
    ingredients.className = 'recipe-book__ingredients';
    ingredients.textContent = `Needs: ${entry.ingredientSummary}`;

    const instruction = document.createElement('div');
    instruction.className = 'recipe-book__instruction';
    instruction.textContent = entry.instruction;

    const status = document.createElement('div');
    status.className = 'recipe-book__status';

    root.append(row, ingredients, instruction, status);
    return { root, tag, status };
  }

  private buildCell(itemId: ItemId | null, count: number | null): HTMLDivElement {
    const cell = document.createElement('div');
    cell.className = 'recipe-book__cell';
    if (itemId === null) {
      cell.classList.add('recipe-book__cell--empty');
      return cell;
    }
    const icon = document.createElement('div');
    icon.className = 'recipe-book__icon';
    const tileName = iconTileForItem(this.deps.itemRegistry, this.deps.blockRegistry, itemId);
    if (tileName !== null) {
      icon.style.backgroundImage = `url(${this.deps.iconCache.dataUrlForTile(tileName)})`;
    } else {
      icon.textContent = this.deps.itemRegistry.get(itemId).name.slice(0, 3);
    }
    cell.appendChild(icon);
    if (count !== null && count > 1) {
      const badge = document.createElement('span');
      badge.className = 'recipe-book__count';
      badge.textContent = String(count);
      cell.appendChild(badge);
    }
    cell.onmouseenter = (event) => this.showTooltip(itemId, event);
    cell.onmousemove = (event) => this.moveTooltip(event);
    cell.onmouseleave = () => this.hideTooltip();
    return cell;
  }

  private showTooltip(itemId: ItemId, event: MouseEvent): void {
    if (this.tooltipItem !== itemId) {
      this.tooltipItem = itemId;
      this.tooltipEl.replaceChildren();
      describeItem({ itemId, count: 1 }, this.deps.itemRegistry).forEach((text, i) => {
        const line = document.createElement('div');
        line.className = i === 0 ? 'recipe-book__tooltip-name' : 'recipe-book__tooltip-line';
        line.textContent = text;
        this.tooltipEl.appendChild(line);
      });
    }
    this.tooltipEl.style.display = 'block';
    this.moveTooltip(event);
  }

  private moveTooltip(event: MouseEvent): void {
    const el = this.tooltipEl;
    if (el.style.display === 'none') return;
    const { left, top } = placeTooltip(
      event.clientX,
      event.clientY,
      el.offsetWidth,
      el.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    this.tooltipItem = null;
    this.tooltipEl.style.display = 'none';
  }

  dispose(): void {
    this.panel.remove();
    this.tooltipEl.remove();
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) return;
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    const narrow = RECIPE_BOOK_CONFIG.narrowMaxWidthPx;
    style.textContent = `
.recipe-book__toggle {
  min-height: ${RECIPE_BOOK_CONFIG.toggleButtonMinHeightPx}px;
  min-width: ${RECIPE_BOOK_CONFIG.toggleButtonMinHeightPx}px;
  padding: 0 14px;
  font: bold 14px sans-serif;
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 6px;
  cursor: pointer;
}
.recipe-book__toggle:hover { background: rgba(255, 255, 255, 0.24); }
.recipe-book__hint {
  flex: 1;
  align-items: center;
  gap: 6px;
  padding: 0 0 0 10px;
  color: #ffe9a8;
  background: rgba(255, 214, 90, 0.14);
  border: 1px solid rgba(255, 214, 90, 0.45);
  border-radius: 6px;
  font: 13px/1.3 sans-serif;
}
.recipe-book__hint span { flex: 1; padding: 4px 0; }
.recipe-book__hint-dismiss {
  min-width: 44px;
  min-height: 44px;
  color: #ffe9a8;
  background: none;
  border: 0;
  font: bold 20px sans-serif;
  cursor: pointer;
}
.recipe-book {
  flex-direction: column;
  box-sizing: border-box;
  width: ${RECIPE_BOOK_CONFIG.panelWidthPx}px;
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 12px;
  gap: 10px;
  background: rgba(20, 20, 24, 0.94);
  border-radius: 6px;
  color: #fff;
  font-family: sans-serif;
}
.recipe-book__header { display: flex; align-items: center; justify-content: space-between; }
.recipe-book__title { font-size: 16px; font-weight: bold; }
.recipe-book__close {
  min-height: 44px;
  padding: 0 14px;
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 6px;
  font: bold 14px sans-serif;
  cursor: pointer;
}
.recipe-book__list { display: flex; flex-direction: column; gap: 8px; }
.recipe-book__entry {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
}
.recipe-book__entry--ready {
  border-color: rgba(120, 220, 120, 0.8);
  background: rgba(90, 200, 90, 0.16);
}
.recipe-book__entry--dim { opacity: 0.6; }
.recipe-book__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.recipe-book__pattern { display: grid; gap: 2px; }
.recipe-book__arrow { font-size: 20px; color: rgba(255, 255, 255, 0.6); }
.recipe-book__cell {
  position: relative;
  box-sizing: border-box;
  width: ${RECIPE_BOOK_CONFIG.miniSlotPx}px;
  height: ${RECIPE_BOOK_CONFIG.miniSlotPx}px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 3px;
}
.recipe-book__cell--empty { opacity: 0.5; }
.recipe-book__cell--result { width: 36px; height: 36px; }
.recipe-book__icon {
  position: absolute;
  inset: 2px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  image-rendering: pixelated;
  color: #fff;
  font-size: 9px;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.recipe-book__count {
  position: absolute;
  right: 2px;
  bottom: 0;
  font: bold 11px sans-serif;
  text-shadow: 0 0 2px #000, 0 0 2px #000;
  pointer-events: none;
}
.recipe-book__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.recipe-book__name { font-weight: bold; font-size: 14px; }
.recipe-book__tag {
  align-self: flex-start;
  padding: 1px 6px;
  font-size: 11px;
  color: #cfe3ff;
  background: rgba(90, 140, 255, 0.22);
  border-radius: 8px;
}
.recipe-book__ingredients { font-size: 12px; color: rgba(255, 255, 255, 0.85); }
.recipe-book__instruction { font-size: 12px; line-height: 1.35; color: rgba(255, 255, 255, 0.7); }
.recipe-book__status { font-size: 11px; font-weight: bold; color: rgba(255, 255, 255, 0.55); }
.recipe-book__entry--ready .recipe-book__status { color: #9be89b; }
.recipe-book__tooltip {
  position: fixed;
  left: 0;
  top: 0;
  display: none;
  z-index: ${TOOLTIP_Z_INDEX};
  max-width: calc(100vw - 12px);
  box-sizing: border-box;
  padding: 5px 8px;
  border-radius: 4px;
  background: rgba(10, 10, 14, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff;
  font: 13px/1.35 sans-serif;
  white-space: nowrap;
  pointer-events: none;
}
.recipe-book__tooltip-name { font-weight: bold; }
.recipe-book__tooltip-line { color: rgba(255, 255, 255, 0.75); font-size: 12px; }
@media (max-width: ${narrow}px) {
  .recipe-book { width: calc(100vw - 16px); max-height: calc(100vh - 16px); max-height: calc(100dvh - 16px); }
}
`;
    doc.head.appendChild(style);
  }
}
