import { SURVIVAL_CONFIG } from '../config/constants';

const HEART_STYLE = {
  iconSizePx: 16,
  renderSizePx: 20,
  gapPx: 2,
  rowGapPx: 4,
  bottomOffsetPx: 72,
  fullColor: '#e0403a',
  emptyColor: 'rgba(255, 255, 255, 0.18)',
  outlineColor: 'rgba(0, 0, 0, 0.55)',
  /** Seconds the full-screen red damage flash takes to fade back out. */
  flashFadeSeconds: 0.35,
  flashColor: 'rgba(200, 0, 0, 0.35)',
} as const;

const STYLE_ELEMENT_ID = 'health-hud-style';
const HEARTS_PER_ROW = 10;

/** One heart's fill state: full (2 hp), half (1 hp), or empty (0 hp). */
type HeartState = 'full' | 'half' | 'empty';

function heartStateAt(index: number, health: number): HeartState {
  const pointsForThisHeart = health - index * 2;
  if (pointsForThisHeart >= 2) {
    return 'full';
  }
  if (pointsForThisHeart >= 1) {
    return 'half';
  }
  return 'empty';
}

/** Draws one heart icon (full/half/empty) into a small canvas, once, cached as a data URL. */
function drawHeart(state: HeartState): string {
  const size = HEART_STYLE.iconSizePx;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return '';
  }

  ctx.clearRect(0, 0, size, size);

  const path = new Path2D();
  // Simple pixel-friendly heart: two circles + a triangle, scaled to `size`.
  const lobeRadius = size * 0.27;
  path.arc(size * 0.3, size * 0.32, lobeRadius, 0, Math.PI * 2);
  path.arc(size * 0.7, size * 0.32, lobeRadius, 0, Math.PI * 2);
  path.moveTo(size * 0.06, size * 0.36);
  path.lineTo(size * 0.5, size * 0.94);
  path.lineTo(size * 0.94, size * 0.36);
  path.closePath();

  ctx.fillStyle = state === 'empty' ? HEART_STYLE.emptyColor : HEART_STYLE.fullColor;
  ctx.fill(path, 'nonzero');

  if (state === 'half') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(size * 0.5, 0, size * 0.5, size);
    ctx.clip();
    ctx.fillStyle = HEART_STYLE.emptyColor;
    ctx.fill(path, 'nonzero');
    ctx.restore();
  }

  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.strokeStyle = HEART_STYLE.outlineColor;
  ctx.stroke(path);

  return canvas.toDataURL();
}

/** Generated once (module-level, not per-instance) since the three heart sprites never change. */
const HEART_ICONS: Readonly<Record<HeartState, string>> = {
  full: typeof document !== 'undefined' ? drawHeart('full') : '',
  half: typeof document !== 'undefined' ? drawHeart('half') : '',
  empty: typeof document !== 'undefined' ? drawHeart('empty') : '',
};

/**
 * Ten-heart health display above the hotbar, plus a brief full-screen red
 * flash when damage is applied. Original canvas-drawn hearts (no image
 * assets). `update()` only touches the DOM for hearts whose state actually
 * changed since the last call.
 */
export class HealthHud {
  private readonly container: HTMLDivElement;
  private readonly heartElements: HTMLDivElement[] = [];
  private readonly lastRendered: (HeartState | undefined)[] = [];
  private readonly flashElement: HTMLDivElement;
  private lastHealth: number | null = null;

  constructor(parent: HTMLElement, maxHealth: number = SURVIVAL_CONFIG.maxHealth) {
    HealthHud.ensureStyleInjected(parent.ownerDocument ?? document);

    const container = document.createElement('div');
    container.className = 'health-hud';
    parent.appendChild(container);
    this.container = container;

    const heartCount = Math.ceil(maxHealth / 2);
    for (let i = 0; i < heartCount; i += 1) {
      const heart = document.createElement('div');
      heart.className = 'health-hud__heart';
      container.appendChild(heart);
      this.heartElements.push(heart);
      this.lastRendered.push(undefined);
    }

    const flash = document.createElement('div');
    flash.className = 'health-hud__flash';
    parent.appendChild(flash);
    this.flashElement = flash;
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.health-hud {
  position: fixed;
  left: 50%;
  bottom: ${HEART_STYLE.bottomOffsetPx}px;
  transform: translateX(-50%);
  display: grid;
  grid-template-columns: repeat(${HEARTS_PER_ROW}, ${HEART_STYLE.renderSizePx}px);
  gap: ${HEART_STYLE.rowGapPx}px ${HEART_STYLE.gapPx}px;
  pointer-events: none;
  user-select: none;
}
.health-hud__heart {
  width: ${HEART_STYLE.renderSizePx}px;
  height: ${HEART_STYLE.renderSizePx}px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  image-rendering: pixelated;
}
.health-hud__flash {
  position: fixed;
  inset: 0;
  background: ${HEART_STYLE.flashColor};
  opacity: 0;
  pointer-events: none;
  transition: opacity ${HEART_STYLE.flashFadeSeconds}s ease-out;
}
`;
    doc.head.appendChild(style);
  }

  /**
   * Refreshes hearts to match `health` (out of `maxHealth`) and triggers a
   * damage flash when health drops below the last rendered value. Hides the
   * whole HUD when `hidden` is true (e.g. while dead).
   */
  update(health: number, hidden = false): void {
    this.container.style.display = hidden ? 'none' : '';

    if (this.lastHealth !== null && health < this.lastHealth) {
      this.triggerFlash();
    }
    this.lastHealth = health;

    for (let i = 0; i < this.heartElements.length; i += 1) {
      const state = heartStateAt(i, health);
      if (this.lastRendered[i] === state) {
        continue;
      }
      this.lastRendered[i] = state;
      const heart = this.heartElements[i];
      if (heart !== undefined) {
        heart.style.backgroundImage = `url(${HEART_ICONS[state]})`;
      }
    }
  }

  private triggerFlash(): void {
    // Force reflow so re-triggering the flash while a previous one is still
    // fading restarts the CSS transition instead of no-op'ing.
    this.flashElement.style.transition = 'none';
    this.flashElement.style.opacity = '1';
    // Reading offsetHeight forces a reflow so the transition below restarts
    // even if a previous flash is already mid-fade.
    void this.flashElement.offsetHeight;
    this.flashElement.style.transition = `opacity ${HEART_STYLE.flashFadeSeconds}s ease-out`;
    this.flashElement.style.opacity = '0';
  }

  dispose(): void {
    this.container.remove();
    this.flashElement.remove();
  }
}
