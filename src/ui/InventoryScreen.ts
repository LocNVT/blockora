import type { ItemStack } from '../items/ItemStack';
import { durabilityFraction } from '../items/ItemStack';
import type { ItemRegistry } from '../items/ItemRegistry';
import type { BlockRegistry } from '../world/BlockRegistry';
import { iconTileForItem, durabilityBarColor } from '../items/itemIcons';
import type { ContainerSession, SlotRef } from '../items/ContainerSession';
import { ItemIconCache } from './itemIconCache';
import { describeItem, placeTooltip } from './itemTooltip';
import { INVENTORY_CONFIG, ITEM_LABEL_CONFIG, RECIPE_BOOK_CONFIG } from '../config/constants';
import { buildRecipeBook, countItems } from '../crafting/recipeBook';
import { resolveBrowserStorage, type SettingsStorage } from '../settings/settingsStorage';
import { RecipeBook } from './RecipeBook';
import { createRecipeHintGate } from './recipeHint';

/** '2x2' = player inventory crafting; '3x3' = crafting table; 'chest' = chest container above the inventory. */
export type InventoryScreenMode = '2x2' | '3x3' | 'chest';

/** Layout/visual constants for the inventory screen (kept local instead of scattered magic numbers). */
const SCREEN_STYLE = {
  slotSizePx: 44,
  slotGapPx: 4,
  panelPaddingPx: 16,
  borderRadiusPx: 6,
  panelBackground: 'rgba(20, 20, 24, 0.92)',
  slotBackground: 'rgba(255, 255, 255, 0.08)',
  slotBorder: 'rgba(255, 255, 255, 0.25)',
  countColor: '#ffffff',
  countFontPx: 12,
  labelFontPx: 10,
  arrowColor: 'rgba(255, 255, 255, 0.6)',
  arrowFontPx: 24,
  sectionGapPx: 14,
  cursorSizePx: 40,
  durabilityBarHeightPx: 3,
  durabilityBarInsetPx: 3,
  durabilityBarBackground: 'rgba(0, 0, 0, 0.6)',
} as const;

const STYLE_ELEMENT_ID = 'inventory-screen-style';
const HOTBAR_SLOT_COUNT = 9;
const MAIN_INVENTORY_SLOT_COUNT = 27;
const CHEST_SLOT_COUNT = 27;

interface SlotElements {
  readonly root: HTMLDivElement;
  readonly icon: HTMLDivElement;
  readonly count: HTMLSpanElement;
  readonly durability: HTMLDivElement;
  readonly durabilityFill: HTMLDivElement;
  ref: SlotRef;
}

function buildSlotElement(ref: SlotRef): SlotElements {
  const root = document.createElement('div');
  root.className = 'inventory-screen__slot';

  const icon = document.createElement('div');
  icon.className = 'inventory-screen__icon';
  root.appendChild(icon);

  const count = document.createElement('span');
  count.className = 'inventory-screen__count';
  count.style.display = 'none';
  root.appendChild(count);

  const durability = document.createElement('div');
  durability.className = 'inventory-screen__durability';
  const durabilityFill = document.createElement('div');
  durabilityFill.className = 'inventory-screen__durability-fill';
  durability.appendChild(durabilityFill);
  root.appendChild(durability);

  return { root, icon, count, durability, durabilityFill, ref };
}

/**
 * DOM overlay for the inventory/crafting screen: a 2x2 or 3x3 crafting grid
 * with a result slot, plus the 27 main inventory slots and 9 hotbar slots.
 * Contains no recipe/crafting logic — every click is delegated to a
 * `ContainerSession`, and the screen only re-renders whatever state comes
 * back out of it (`session.getSlot()`, `session.getCursor()`).
 *
 * Created once; `open()`/`close()` toggle visibility, and rendering only
 * touches slots whose stack reference changed since the last render.
 */
export class InventoryScreen {
  private readonly overlay: HTMLDivElement;
  private readonly gridContainer: HTMLDivElement;
  private readonly resultSlotEl: SlotElements;
  private readonly craftingRow: HTMLDivElement;
  private readonly chestSection: HTMLDivElement;
  private readonly chestSlots: SlotElements[] = [];
  private readonly mainSlots: SlotElements[] = [];
  private readonly hotbarSlots: SlotElements[] = [];
  private readonly cursorEl: HTMLDivElement;
  private readonly cursorIcon: HTMLDivElement;
  private readonly cursorCount: HTMLSpanElement;
  private readonly iconCache: ItemIconCache;
  private readonly tooltipEl: HTMLDivElement;
  private readonly overlayToolbar: HTMLDivElement;
  private readonly recipeBook: RecipeBook;
  private readonly onDocumentKeyDown: (event: KeyboardEvent) => void;

  /** Slot under the mouse (null when none) and the last mouse position, for the tooltip. */
  private hoveredSlot: SlotElements | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private tooltipStack: ItemStack | null | undefined = undefined;

  private gridSlots: SlotElements[] = [];
  private gridMode: '2x2' | '3x3' | null = null;
  /**
   * True while a chest is open. The crafting row is hidden and the chest
   * session uses its own 2×2 grid, so the grid / result slot elements (which
   * may still be the 3×3 set from an earlier crafting table) must not render.
   */
  private chestMode = false;

  private session: ContainerSession | null = null;
  private _isOpen = false;

  private lastRenderedByRoot = new Map<HTMLDivElement, ItemStack | null | undefined>();
  private lastCursorRendered: ItemStack | null | undefined = undefined;

  constructor(
    parent: HTMLElement,
    private readonly itemRegistry: ItemRegistry,
    private readonly blockRegistry: BlockRegistry,
    iconCache: ItemIconCache = new ItemIconCache(),
    hintStorage: SettingsStorage | null = resolveBrowserStorage(),
  ) {
    this.iconCache = iconCache;
    InventoryScreen.ensureStyleInjected(parent.ownerDocument ?? document);

    const overlay = document.createElement('div');
    overlay.className = 'inventory-screen';
    overlay.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'inventory-screen__panel';
    overlay.appendChild(panel);

    // Recipes toggle + first-time hint, above the crafting row (hidden in chest mode).
    const toolbar = document.createElement('div');
    toolbar.className = 'inventory-screen__toolbar';
    panel.appendChild(toolbar);
    this.overlayToolbar = toolbar;
    this.recipeBook = new RecipeBook(overlay, {
      entries: buildRecipeBook(),
      itemRegistry,
      blockRegistry,
      iconCache,
      hintGate: createRecipeHintGate(hintStorage),
      onOpenChange: (open) => {
        overlay.classList.toggle('inventory-screen--book-open', open);
        if (open) this.render(); // fill in craftable state straight away (button, R key, ...)
      },
    });
    toolbar.append(this.recipeBook.hintElement, this.recipeBook.toggleButton);

    const craftingRow = document.createElement('div');
    craftingRow.className = 'inventory-screen__crafting-row';
    panel.appendChild(craftingRow);
    this.craftingRow = craftingRow;

    const chestSection = document.createElement('div');
    chestSection.className = 'inventory-screen__chest';
    chestSection.style.display = 'none';
    const chestLabel = document.createElement('div');
    chestLabel.className = 'inventory-screen__label';
    chestLabel.textContent = 'Chest';
    chestSection.appendChild(chestLabel);
    const chestGrid = document.createElement('div');
    chestGrid.className = 'inventory-screen__main-grid';
    chestSection.appendChild(chestGrid);
    for (let i = 0; i < CHEST_SLOT_COUNT; i += 1) {
      const slot = buildSlotElement({ area: 'chest', index: i });
      this.attachSlotHandler(slot);
      chestGrid.appendChild(slot.root);
      this.chestSlots.push(slot);
    }
    panel.appendChild(chestSection);
    this.chestSection = chestSection;

    const gridContainer = document.createElement('div');
    gridContainer.className = 'inventory-screen__grid';
    craftingRow.appendChild(gridContainer);
    this.gridContainer = gridContainer;

    const arrow = document.createElement('div');
    arrow.className = 'inventory-screen__arrow';
    arrow.textContent = '→';
    craftingRow.appendChild(arrow);

    const resultSlotEl = buildSlotElement({ area: 'result' });
    resultSlotEl.root.classList.add('inventory-screen__slot--result');
    this.attachSlotHandler(resultSlotEl);
    craftingRow.appendChild(resultSlotEl.root);
    this.resultSlotEl = resultSlotEl;

    const mainGrid = document.createElement('div');
    mainGrid.className = 'inventory-screen__main-grid';
    panel.appendChild(mainGrid);
    for (let i = 0; i < MAIN_INVENTORY_SLOT_COUNT; i += 1) {
      // Main inventory slots are inventory indices 9..35 (0..8 is the hotbar).
      const slot = buildSlotElement({ area: 'inventory', index: i + HOTBAR_SLOT_COUNT });
      this.attachSlotHandler(slot);
      mainGrid.appendChild(slot.root);
      this.mainSlots.push(slot);
    }

    const hotbarGrid = document.createElement('div');
    hotbarGrid.className = 'inventory-screen__hotbar-grid';
    panel.appendChild(hotbarGrid);
    for (let i = 0; i < HOTBAR_SLOT_COUNT; i += 1) {
      const slot = buildSlotElement({ area: 'inventory', index: i });
      this.attachSlotHandler(slot);
      hotbarGrid.appendChild(slot.root);
      this.hotbarSlots.push(slot);
    }

    const cursorEl = document.createElement('div');
    cursorEl.className = 'inventory-screen__cursor';
    const cursorIcon = document.createElement('div');
    cursorIcon.className = 'inventory-screen__cursor-icon';
    cursorEl.appendChild(cursorIcon);
    const cursorCount = document.createElement('span');
    cursorCount.className = 'inventory-screen__cursor-count';
    cursorCount.style.display = 'none';
    cursorEl.appendChild(cursorCount);
    overlay.appendChild(cursorEl);
    this.cursorEl = cursorEl;
    this.cursorIcon = cursorIcon;
    this.cursorCount = cursorCount;

    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'inventory-screen__tooltip';
    overlay.appendChild(tooltipEl);
    this.tooltipEl = tooltipEl;

    overlay.addEventListener('contextmenu', (event) => event.preventDefault());
    overlay.addEventListener('mousemove', (event) => this.onMouseMove(event));

    parent.appendChild(overlay);
    this.overlay = overlay;

    // R toggles the recipe book while a crafting screen is open (no modifiers, so Ctrl+R still reloads).
    this.onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (
        event.code !== 'KeyR' ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !this._isOpen ||
        this.chestMode
      ) {
        return;
      }
      this.recipeBook.toggle();
    };
    (parent.ownerDocument ?? document).addEventListener('keydown', this.onDocumentKeyDown);
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.inventory-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.45);
  user-select: none;
  z-index: 10;
}
.inventory-screen__toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: ${SCREEN_STYLE.slotGapPx * 2}px;
}
@media (max-width: ${RECIPE_BOOK_CONFIG.narrowMaxWidthPx}px) {
  /* The recipe book takes the whole screen on narrow viewports instead of sitting beside the inventory. */
  .inventory-screen--book-open .inventory-screen__panel { display: none; }
  /* The inventory panel is wider than a phone screen, so pin the Recipes button / hint to the viewport top instead. */
  .inventory-screen__toolbar {
    position: fixed;
    top: 8px;
    left: 8px;
    right: 8px;
    z-index: 1;
  }
}
.inventory-screen__panel {
  background: ${SCREEN_STYLE.panelBackground};
  border-radius: ${SCREEN_STYLE.borderRadiusPx}px;
  padding: ${SCREEN_STYLE.panelPaddingPx}px;
  display: flex;
  flex-direction: column;
  gap: ${SCREEN_STYLE.sectionGapPx}px;
  font-family: sans-serif;
}
.inventory-screen__crafting-row {
  display: flex;
  align-items: center;
  gap: ${SCREEN_STYLE.slotGapPx * 2}px;
  align-self: center;
}
.inventory-screen__label {
  color: ${SCREEN_STYLE.arrowColor};
  font-size: ${SCREEN_STYLE.labelFontPx + 2}px;
  margin-bottom: ${SCREEN_STYLE.slotGapPx}px;
}
.inventory-screen__grid {
  display: grid;
  gap: ${SCREEN_STYLE.slotGapPx}px;
}
.inventory-screen__arrow {
  color: ${SCREEN_STYLE.arrowColor};
  font-size: ${SCREEN_STYLE.arrowFontPx}px;
}
.inventory-screen__main-grid, .inventory-screen__hotbar-grid {
  display: grid;
  grid-template-columns: repeat(9, ${SCREEN_STYLE.slotSizePx}px);
  gap: ${SCREEN_STYLE.slotGapPx}px;
}
.inventory-screen__slot {
  position: relative;
  width: ${SCREEN_STYLE.slotSizePx}px;
  height: ${SCREEN_STYLE.slotSizePx}px;
  box-sizing: border-box;
  background: ${SCREEN_STYLE.slotBackground};
  border: 1px solid ${SCREEN_STYLE.slotBorder};
  border-radius: 4px;
  cursor: pointer;
}
.inventory-screen__icon {
  position: absolute;
  inset: 4px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  image-rendering: pixelated;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: ${SCREEN_STYLE.labelFontPx}px;
  text-transform: uppercase;
  pointer-events: none;
}
.inventory-screen__count {
  position: absolute;
  right: 3px;
  bottom: 1px;
  color: ${SCREEN_STYLE.countColor};
  font-size: ${SCREEN_STYLE.countFontPx}px;
  font-weight: bold;
  text-shadow: 0 0 2px #000, 0 0 2px #000;
  pointer-events: none;
}
.inventory-screen__durability {
  position: absolute;
  left: ${SCREEN_STYLE.durabilityBarInsetPx}px;
  right: ${SCREEN_STYLE.durabilityBarInsetPx}px;
  bottom: 2px;
  height: ${SCREEN_STYLE.durabilityBarHeightPx}px;
  background: ${SCREEN_STYLE.durabilityBarBackground};
  display: none;
  pointer-events: none;
}
.inventory-screen__durability-fill {
  height: 100%;
  width: 0%;
}
.inventory-screen__cursor {
  position: fixed;
  width: ${SCREEN_STYLE.cursorSizePx}px;
  height: ${SCREEN_STYLE.cursorSizePx}px;
  pointer-events: none;
  transform: translate(-50%, -50%);
  display: none;
}
.inventory-screen__tooltip {
  position: fixed;
  left: 0;
  top: 0;
  display: none;
  z-index: ${ITEM_LABEL_CONFIG.tooltip.zIndex};
  max-width: calc(100vw - ${ITEM_LABEL_CONFIG.tooltip.viewportMarginPx * 2}px);
  font-family: sans-serif;
  box-sizing: border-box;
  padding: 5px 8px;
  border-radius: 4px;
  background: rgba(10, 10, 14, 0.95);
  border: 1px solid ${SCREEN_STYLE.slotBorder};
  color: #fff;
  font-size: 13px;
  line-height: 1.35;
  white-space: nowrap;
  pointer-events: none;
}
.inventory-screen__tooltip-name {
  font-weight: bold;
}
.inventory-screen__tooltip-line {
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
}
.inventory-screen__cursor-icon {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  image-rendering: pixelated;
}
.inventory-screen__cursor-count {
  position: absolute;
  right: 0;
  bottom: 0;
  color: ${SCREEN_STYLE.countColor};
  font-size: ${SCREEN_STYLE.countFontPx}px;
  font-weight: bold;
  text-shadow: 0 0 2px #000, 0 0 2px #000;
}
`;
    doc.head.appendChild(style);
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  private onMouseMove(event: MouseEvent): void {
    this.cursorEl.style.left = `${event.clientX}px`;
    this.cursorEl.style.top = `${event.clientY}px`;
    this.mouseX = event.clientX;
    this.mouseY = event.clientY;
    if (this.tooltipEl.style.display !== 'none') {
      this.positionTooltip();
    }
  }

  /**
   * Shows the tooltip for the hovered slot, or hides it when nothing is hovered,
   * the slot is empty, or the cursor is carrying a stack (the held stack follows
   * the mouse, so a tooltip next to it would only clutter). Rebuilds the text only
   * when the hovered stack reference changed.
   */
  private refreshTooltip(): void {
    const session = this.session;
    const slot = this.hoveredSlot;
    const stack = session !== null && slot !== null ? session.getSlot(slot.ref) : null;
    if (stack === null || session === null || session.getCursor() !== null) {
      this.tooltipStack = undefined;
      this.tooltipEl.style.display = 'none';
      return;
    }
    if (stack !== this.tooltipStack) {
      this.tooltipStack = stack;
      this.tooltipEl.replaceChildren();
      describeItem(stack, this.itemRegistry).forEach((text, i) => {
        const line = document.createElement('div');
        line.className = i === 0 ? 'inventory-screen__tooltip-name' : 'inventory-screen__tooltip-line';
        line.textContent = text;
        this.tooltipEl.appendChild(line);
      });
    }
    this.tooltipEl.style.display = 'block';
    this.positionTooltip();
  }

  private positionTooltip(): void {
    const el = this.tooltipEl;
    const { left, top } = placeTooltip(
      this.mouseX,
      this.mouseY,
      el.offsetWidth,
      el.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  private rebuildGrid(mode: '2x2' | '3x3'): void {
    for (const slot of this.gridSlots) {
      this.lastRenderedByRoot.delete(slot.root);
    }
    this.gridContainer.innerHTML = '';
    this.gridSlots = [];
    const side = mode === '2x2' ? 2 : 3;
    this.gridContainer.style.gridTemplateColumns = `repeat(${side}, ${SCREEN_STYLE.slotSizePx}px)`;

    const cellCount = side * side;
    for (let i = 0; i < cellCount; i += 1) {
      const slot = buildSlotElement({ area: 'grid', index: i });
      this.attachSlotHandler(slot);
      this.gridContainer.appendChild(slot.root);
      this.gridSlots.push(slot);
    }
    this.gridMode = mode;
  }

  private attachSlotHandler(slot: SlotElements): void {
    slot.root.onmouseenter = (event: MouseEvent) => {
      this.hoveredSlot = slot;
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
      this.refreshTooltip();
    };
    slot.root.onmouseleave = () => {
      if (this.hoveredSlot === slot) {
        this.hoveredSlot = null;
        this.refreshTooltip();
      }
    };
    slot.root.onmousedown = (event: MouseEvent) => {
      event.preventDefault();
      const session = this.session;
      if (session === null) {
        return;
      }
      if (event.button === 0) {
        session.click(slot.ref, 'primary');
      } else if (event.button === 2) {
        session.click(slot.ref, 'secondary');
      } else {
        return;
      }
      this.render();
    };
  }

  /** Opens the screen in `mode` with the given session; rebuilds the grid only if the mode changed. */
  open(mode: InventoryScreenMode, session: ContainerSession): void {
    this.session = session;
    this.hoveredSlot = null;

    const chestMode = mode === 'chest';
    this.chestMode = chestMode;
    this.craftingRow.style.display = chestMode ? 'none' : 'flex';
    this.overlayToolbar.style.display = chestMode ? 'none' : 'flex';
    if (chestMode) {
      this.recipeBook.screenClosed();
    } else {
      this.recipeBook.screenOpened(mode);
    }
    this.chestSection.style.display = chestMode ? 'block' : 'none';
    if (!chestMode && this.gridMode !== mode) {
      this.rebuildGrid(mode);
    }

    // Force every slot to redraw at least once for this session (stale
    // references from a previous session could otherwise coincidentally
    // compare equal and skip rendering).
    this.lastRenderedByRoot.clear();
    this.lastCursorRendered = undefined;

    this.overlay.style.display = 'flex';
    this._isOpen = true;
    this.render();
  }

  close(dropLeftover: (stack: ItemStack) => void): void {
    if (!this._isOpen) {
      return;
    }
    this.session?.close(dropLeftover);
    this.session = null;
    this.recipeBook.screenClosed();
    this.overlay.style.display = 'none';
    this.cursorEl.style.display = 'none';
    this.hoveredSlot = null;
    this.refreshTooltip();
    this._isOpen = false;
  }

  /** Re-renders every slot whose backing stack (by reference) changed since the last render. */
  render(): void {
    const session = this.session;
    if (session === null) {
      return;
    }

    if (!this.chestMode) {
      for (const slot of this.gridSlots) {
        this.renderSlotIfChanged(slot, session.getSlot(slot.ref));
      }
    }
    for (const slot of this.chestSlots) {
      this.renderSlotIfChanged(slot, session.getSlot(slot.ref));
    }
    for (const slot of this.mainSlots) {
      this.renderSlotIfChanged(slot, session.getSlot(slot.ref));
    }
    for (const slot of this.hotbarSlots) {
      this.renderSlotIfChanged(slot, session.getSlot(slot.ref));
    }
    if (!this.chestMode) {
      this.renderSlotIfChanged(this.resultSlotEl, session.getSlot(this.resultSlotEl.ref));
    }

    const cursor = session.getCursor();
    if (this.lastCursorRendered !== cursor) {
      this.renderCursor(cursor);
      this.lastCursorRendered = cursor;
    }

    this.refreshTooltip();

    if (this.recipeBook.isOpen && !this.chestMode) {
      this.recipeBook.refresh(
        countItems((index) => session.getSlot({ area: 'inventory', index }), INVENTORY_CONFIG.inventorySlots),
      );
    }
  }

  private renderSlotIfChanged(slot: SlotElements, stack: ItemStack | null): void {
    const last = this.lastRenderedByRoot.get(slot.root);
    if (last !== undefined && last === stack) {
      return;
    }
    this.renderSlot(slot, stack);
    this.lastRenderedByRoot.set(slot.root, stack);
  }

  private renderSlot(slot: SlotElements, stack: ItemStack | null): void {
    if (stack === null) {
      slot.icon.style.backgroundImage = '';
      slot.icon.textContent = '';
      slot.count.style.display = 'none';
      slot.durability.style.display = 'none';
      return;
    }

    const tileName = iconTileForItem(this.itemRegistry, this.blockRegistry, stack.itemId);
    if (tileName !== null) {
      slot.icon.style.backgroundImage = `url(${this.iconCache.dataUrlForTile(tileName)})`;
      slot.icon.textContent = '';
    } else {
      slot.icon.style.backgroundImage = '';
      const def = this.itemRegistry.get(stack.itemId);
      slot.icon.textContent = def.name.slice(0, 3);
    }

    if (stack.count > 1) {
      slot.count.style.display = '';
      slot.count.textContent = String(stack.count);
    } else {
      slot.count.style.display = 'none';
    }

    const fraction = durabilityFraction(stack, this.itemRegistry);
    if (fraction === null || fraction >= 1) {
      slot.durability.style.display = 'none';
    } else {
      // Must be explicit: '' would fall back to the stylesheet's `display: none`.
      slot.durability.style.display = 'block';
      slot.durabilityFill.style.width = `${fraction * 100}%`;
      slot.durabilityFill.style.background = durabilityBarColor(fraction);
    }
  }

  private renderCursor(stack: ItemStack | null): void {
    if (stack === null) {
      this.cursorEl.style.display = 'none';
      return;
    }

    this.cursorEl.style.display = 'block';
    const tileName = iconTileForItem(this.itemRegistry, this.blockRegistry, stack.itemId);
    if (tileName !== null) {
      this.cursorIcon.style.backgroundImage = `url(${this.iconCache.dataUrlForTile(tileName)})`;
      this.cursorIcon.textContent = '';
    } else {
      this.cursorIcon.style.backgroundImage = '';
      const def = this.itemRegistry.get(stack.itemId);
      this.cursorIcon.textContent = def.name.slice(0, 3);
    }

    if (stack.count > 1) {
      this.cursorCount.style.display = '';
      this.cursorCount.textContent = String(stack.count);
    } else {
      this.cursorCount.style.display = 'none';
    }
  }

  dispose(): void {
    (this.overlay.ownerDocument ?? document).removeEventListener('keydown', this.onDocumentKeyDown);
    this.recipeBook.dispose();
    this.overlay.remove();
  }
}
