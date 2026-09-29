import type { Inventory } from '../items/Inventory';
import type { ItemStack } from '../items/ItemStack';
import { durabilityFraction } from '../items/ItemStack';
import type { ItemRegistry } from '../items/ItemRegistry';
import type { BlockRegistry } from '../world/BlockRegistry';
import { iconTileForItem, durabilityBarColor } from '../items/itemIcons';
import { ItemIconCache } from './itemIconCache';

/** Layout/visual constants for the hotbar HUD (kept local instead of scattered magic numbers). */
const HOTBAR_STYLE = {
  slotSizePx: 48,
  slotGapPx: 4,
  bottomOffsetPx: 16,
  borderRadiusPx: 6,
  borderColor: 'rgba(255, 255, 255, 0.35)',
  selectedBorderColor: 'rgba(255, 255, 255, 0.95)',
  backgroundColor: 'rgba(20, 20, 24, 0.55)',
  countColor: '#ffffff',
  countFontPx: 12,
  labelColor: '#ffffff',
  labelFontPx: 11,
  iconPaddingPx: 4,
  durabilityBarHeightPx: 3,
  durabilityBarInsetPx: 3,
  durabilityBarBackground: 'rgba(0, 0, 0, 0.6)',
} as const;

const STYLE_ELEMENT_ID = 'hotbar-hud-style';

/** Per-slot last-rendered state, compared by reference so unchanged slots touch no DOM. */
interface RenderedSlotState {
  stack: ItemStack | null;
  selected: boolean;
}

/**
 * Bottom-centered row of hotbar slots showing each slot's item icon/count and
 * highlighting the selected slot. Created once; `update()` is cheap per frame
 * because it only touches DOM nodes for slots whose stack (by reference —
 * ItemStacks are immutable) or selected state actually changed since the last
 * call.
 */
export class HotbarHud {
  private readonly container: HTMLDivElement;
  private readonly slotElements: HTMLDivElement[] = [];
  private readonly iconElements: HTMLDivElement[] = [];
  private readonly countElements: HTMLSpanElement[] = [];
  private readonly durabilityElements: HTMLDivElement[] = [];
  private readonly durabilityFillElements: HTMLDivElement[] = [];
  private readonly lastRendered: RenderedSlotState[] = [];
  private readonly iconCache: ItemIconCache;

  constructor(
    parent: HTMLElement,
    private readonly itemRegistry: ItemRegistry,
    private readonly blockRegistry: BlockRegistry,
    iconCache: ItemIconCache = new ItemIconCache(),
  ) {
    this.iconCache = iconCache;
    HotbarHud.ensureStyleInjected(parent.ownerDocument ?? document);

    const container = document.createElement('div');
    container.className = 'hotbar-hud';
    parent.appendChild(container);
    this.container = container;
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.hotbar-hud {
  position: fixed;
  left: 50%;
  bottom: ${HOTBAR_STYLE.bottomOffsetPx}px;
  transform: translateX(-50%);
  display: flex;
  gap: ${HOTBAR_STYLE.slotGapPx}px;
  pointer-events: none;
  user-select: none;
}
.hotbar-hud__slot {
  position: relative;
  width: ${HOTBAR_STYLE.slotSizePx}px;
  height: ${HOTBAR_STYLE.slotSizePx}px;
  box-sizing: border-box;
  background: ${HOTBAR_STYLE.backgroundColor};
  border: 2px solid ${HOTBAR_STYLE.borderColor};
  border-radius: ${HOTBAR_STYLE.borderRadiusPx}px;
}
.hotbar-hud__slot--selected {
  border-color: ${HOTBAR_STYLE.selectedBorderColor};
}
.hotbar-hud__icon {
  position: absolute;
  inset: ${HOTBAR_STYLE.iconPaddingPx}px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  image-rendering: pixelated;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${HOTBAR_STYLE.labelColor};
  font-family: sans-serif;
  font-size: ${HOTBAR_STYLE.labelFontPx}px;
  text-transform: uppercase;
}
.hotbar-hud__count {
  position: absolute;
  right: 3px;
  bottom: 1px;
  color: ${HOTBAR_STYLE.countColor};
  font-family: sans-serif;
  font-size: ${HOTBAR_STYLE.countFontPx}px;
  font-weight: bold;
  text-shadow: 0 0 2px #000, 0 0 2px #000;
}
.hotbar-hud__durability {
  position: absolute;
  left: ${HOTBAR_STYLE.durabilityBarInsetPx}px;
  right: ${HOTBAR_STYLE.durabilityBarInsetPx}px;
  bottom: 2px;
  height: ${HOTBAR_STYLE.durabilityBarHeightPx}px;
  background: ${HOTBAR_STYLE.durabilityBarBackground};
  display: none;
}
.hotbar-hud__durability-fill {
  height: 100%;
  width: 0%;
}
`;
    doc.head.appendChild(style);
  }

  private buildSlot(index: number): void {
    const slot = document.createElement('div');
    slot.className = 'hotbar-hud__slot';

    const icon = document.createElement('div');
    icon.className = 'hotbar-hud__icon';
    slot.appendChild(icon);

    const count = document.createElement('span');
    count.className = 'hotbar-hud__count';
    count.style.display = 'none';
    slot.appendChild(count);

    const durability = document.createElement('div');
    durability.className = 'hotbar-hud__durability';
    const durabilityFill = document.createElement('div');
    durabilityFill.className = 'hotbar-hud__durability-fill';
    durability.appendChild(durabilityFill);
    slot.appendChild(durability);

    this.container.appendChild(slot);
    this.slotElements[index] = slot;
    this.iconElements[index] = icon;
    this.countElements[index] = count;
    this.durabilityElements[index] = durability;
    this.durabilityFillElements[index] = durabilityFill;
    this.lastRendered[index] = { stack: undefined as unknown as ItemStack | null, selected: false };
  }

  /**
   * Refreshes the HUD to match `inventory`. Cheap per frame: each slot is
   * compared against the last rendered stack (by reference) and selected
   * flag, and only slots that changed touch the DOM.
   */
  update(inventory: Inventory): void {
    const hotbarSize = inventory.hotbarSize;
    while (this.slotElements.length < hotbarSize) {
      this.buildSlot(this.slotElements.length);
    }

    const selectedIndex = inventory.selectedHotbarIndex;

    for (let i = 0; i < hotbarSize; i += 1) {
      const stack = inventory.getSlot(i);
      const selected = i === selectedIndex;
      const last = this.lastRendered[i];

      if (last !== undefined && last.stack === stack && last.selected === selected) {
        continue;
      }

      const slotElement = this.slotElements[i];
      const iconElement = this.iconElements[i];
      const countElement = this.countElements[i];
      const durabilityElement = this.durabilityElements[i];
      const durabilityFillElement = this.durabilityFillElements[i];
      if (
        slotElement === undefined ||
        iconElement === undefined ||
        countElement === undefined ||
        durabilityElement === undefined ||
        durabilityFillElement === undefined
      ) {
        continue;
      }

      if (last === undefined || last.selected !== selected) {
        slotElement.classList.toggle('hotbar-hud__slot--selected', selected);
      }

      if (last === undefined || last.stack !== stack) {
        this.renderIcon(iconElement, countElement, stack);
        this.renderDurability(durabilityElement, durabilityFillElement, stack);
      }

      this.lastRendered[i] = { stack, selected };
    }
  }

  private renderIcon(iconElement: HTMLDivElement, countElement: HTMLSpanElement, stack: ItemStack | null): void {
    if (stack === null) {
      iconElement.style.backgroundImage = '';
      iconElement.textContent = '';
      countElement.style.display = 'none';
      return;
    }

    const tileName = iconTileForItem(this.itemRegistry, this.blockRegistry, stack.itemId);
    if (tileName !== null) {
      iconElement.style.backgroundImage = `url(${this.iconCache.dataUrlForTile(tileName)})`;
      iconElement.textContent = '';
    } else {
      iconElement.style.backgroundImage = '';
      const def = this.itemRegistry.get(stack.itemId);
      iconElement.textContent = def.name.slice(0, 3);
    }

    if (stack.count > 1) {
      countElement.style.display = '';
      countElement.textContent = String(stack.count);
    } else {
      countElement.style.display = 'none';
    }
  }

  /** Shows a thin bottom bar (green -> red) for damaged tools; hidden for undamaged/non-tool stacks. */
  private renderDurability(
    barElement: HTMLDivElement,
    fillElement: HTMLDivElement,
    stack: ItemStack | null,
  ): void {
    const fraction = stack !== null ? durabilityFraction(stack, this.itemRegistry) : null;
    if (fraction === null || fraction >= 1) {
      barElement.style.display = 'none';
      return;
    }
    // Must be explicit: '' would fall back to the stylesheet's `display: none`.
    barElement.style.display = 'block';
    fillElement.style.width = `${fraction * 100}%`;
    fillElement.style.background = durabilityBarColor(fraction);
  }

  dispose(): void {
    this.container.remove();
  }
}
