import { SURVIVAL_CONFIG } from '../config/constants';

const FOOD_STYLE = {
  iconSizePx: 16,
  renderSizePx: 20,
  gapPx: 2,
  rowGapPx: 4,
  bottomOffsetPx: 72,
  fullColor: '#c98a3d',
  emptyColor: 'rgba(255, 255, 255, 0.18)',
  outlineColor: 'rgba(0, 0, 0, 0.55)',
} as const;

const STYLE_ELEMENT_ID = 'hunger-hud-style';
const FOOD_PER_ROW = 10;

/** One drumstick icon's fill state: full (2 hunger), half (1 hunger), or empty (0 hunger). */
type FoodState = 'full' | 'half' | 'empty';

function foodStateAt(index: number, hunger: number): FoodState {
  const pointsForThisIcon = hunger - index * 2;
  if (pointsForThisIcon >= 2) {
    return 'full';
  }
  if (pointsForThisIcon >= 1) {
    return 'half';
  }
  return 'empty';
}

/** Draws one drumstick icon (full/half/empty) into a small canvas, once, cached as a data URL. */
function drawDrumstick(state: FoodState): string {
  const size = FOOD_STYLE.iconSizePx;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return '';
  }

  ctx.clearRect(0, 0, size, size);

  // Simple pixel-friendly drumstick: a rounded meat lobe (top-left) plus a
  // thin bone (bottom-right), scaled to `size`.
  const path = new Path2D();
  path.arc(size * 0.4, size * 0.38, size * 0.28, 0, Math.PI * 2);
  path.moveTo(size * 0.55, size * 0.55);
  path.lineTo(size * 0.9, size * 0.9);
  path.lineTo(size * 0.78, size * 0.98);
  path.lineTo(size * 0.45, size * 0.65);
  path.closePath();

  ctx.fillStyle = state === 'empty' ? FOOD_STYLE.emptyColor : FOOD_STYLE.fullColor;
  ctx.fill(path, 'nonzero');

  if (state === 'half') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(size * 0.5, 0, size * 0.5, size);
    ctx.clip();
    ctx.fillStyle = FOOD_STYLE.emptyColor;
    ctx.fill(path, 'nonzero');
    ctx.restore();
  }

  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.strokeStyle = FOOD_STYLE.outlineColor;
  ctx.stroke(path);

  return canvas.toDataURL();
}

/** Generated once (module-level, not per-instance) since the three drumstick sprites never change. */
const FOOD_ICONS: Readonly<Record<FoodState, string>> = {
  full: typeof document !== 'undefined' ? drawDrumstick('full') : '',
  half: typeof document !== 'undefined' ? drawDrumstick('half') : '',
  empty: typeof document !== 'undefined' ? drawDrumstick('empty') : '',
};

/**
 * Ten-drumstick hunger display above the hotbar, mirroring `HealthHud` but on
 * the right side. Original canvas-drawn icons (no image assets). `update()`
 * only touches the DOM for icons whose state actually changed since the last
 * call.
 */
export class HungerHud {
  private readonly container: HTMLDivElement;
  private readonly foodElements: HTMLDivElement[] = [];
  private readonly lastRendered: (FoodState | undefined)[] = [];

  constructor(parent: HTMLElement, maxHunger: number = SURVIVAL_CONFIG.maxHunger) {
    HungerHud.ensureStyleInjected(parent.ownerDocument ?? document);

    const container = document.createElement('div');
    container.className = 'hunger-hud';
    parent.appendChild(container);
    this.container = container;

    const iconCount = Math.ceil(maxHunger / 2);
    for (let i = 0; i < iconCount; i += 1) {
      const icon = document.createElement('div');
      icon.className = 'hunger-hud__icon';
      container.appendChild(icon);
      this.foodElements.push(icon);
      this.lastRendered.push(undefined);
    }
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.hunger-hud {
  position: fixed;
  left: 50%;
  bottom: ${FOOD_STYLE.bottomOffsetPx}px;
  /* Mirrors health-hud's centered placement but shifted to the right side
     of center (health owns the left side, symmetric offset). */
  transform: translateX(${FOOD_PER_ROW * FOOD_STYLE.renderSizePx / 2 + FOOD_STYLE.gapPx * 4}px);
  display: grid;
  grid-template-columns: repeat(${FOOD_PER_ROW}, ${FOOD_STYLE.renderSizePx}px);
  gap: ${FOOD_STYLE.rowGapPx}px ${FOOD_STYLE.gapPx}px;
  pointer-events: none;
  user-select: none;
}
.hunger-hud__icon {
  width: ${FOOD_STYLE.renderSizePx}px;
  height: ${FOOD_STYLE.renderSizePx}px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  image-rendering: pixelated;
}
`;
    doc.head.appendChild(style);
  }

  /**
   * Refreshes drumsticks to match `hunger` (out of `maxHunger`). Hides the
   * whole HUD when `hidden` is true (e.g. while dead).
   */
  update(hunger: number, hidden = false): void {
    this.container.style.display = hidden ? 'none' : '';

    for (let i = 0; i < this.foodElements.length; i += 1) {
      const state = foodStateAt(i, hunger);
      if (this.lastRendered[i] === state) {
        continue;
      }
      this.lastRendered[i] = state;
      const icon = this.foodElements[i];
      if (icon !== undefined) {
        icon.style.backgroundImage = `url(${FOOD_ICONS[state]})`;
      }
    }
  }

  dispose(): void {
    this.container.remove();
  }
}
