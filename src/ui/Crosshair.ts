const CROSSHAIR_SIZE_PX = 18;
const CROSSHAIR_THICKNESS_PX = 2;
const PROGRESS_WIDTH_PX = 24;
const PROGRESS_HEIGHT_PX = 3;
const PROGRESS_GAP_PX = 6;

const CONTAINER_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  width: `${CROSSHAIR_SIZE_PX}px`,
  height: `${CROSSHAIR_SIZE_PX}px`,
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
  userSelect: 'none',
};

const ARM_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  background: 'rgba(255, 255, 255, 0.85)',
  boxShadow: '0 0 1px rgba(0, 0, 0, 0.6)',
};

const PROGRESS_TRACK_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  left: '50%',
  top: `${CROSSHAIR_SIZE_PX + PROGRESS_GAP_PX}px`,
  width: `${PROGRESS_WIDTH_PX}px`,
  height: `${PROGRESS_HEIGHT_PX}px`,
  transform: 'translateX(-50%)',
  background: 'rgba(0, 0, 0, 0.4)',
  borderRadius: `${PROGRESS_HEIGHT_PX / 2}px`,
  overflow: 'hidden',
};

const PROGRESS_FILL_STYLE: Partial<CSSStyleDeclaration> = {
  height: '100%',
  width: '0%',
  background: 'rgba(255, 255, 255, 0.9)',
};

/**
 * Tiny centered crosshair overlay, purely visual (no pointer interaction).
 * Also renders a thin break-progress bar under the crosshair (see
 * `setProgress`), hidden while progress is 0.
 */
export class Crosshair {
  private readonly element: HTMLDivElement;
  private readonly progressTrack: HTMLDivElement;
  private readonly progressFill: HTMLDivElement;
  private lastPercent = -1;

  constructor(container: HTMLElement) {
    const element = document.createElement('div');
    Object.assign(element.style, CONTAINER_STYLE);

    const horizontal = document.createElement('div');
    Object.assign(horizontal.style, ARM_STYLE, {
      left: '0',
      top: `${(CROSSHAIR_SIZE_PX - CROSSHAIR_THICKNESS_PX) / 2}px`,
      width: `${CROSSHAIR_SIZE_PX}px`,
      height: `${CROSSHAIR_THICKNESS_PX}px`,
    } satisfies Partial<CSSStyleDeclaration>);

    const vertical = document.createElement('div');
    Object.assign(vertical.style, ARM_STYLE, {
      left: `${(CROSSHAIR_SIZE_PX - CROSSHAIR_THICKNESS_PX) / 2}px`,
      top: '0',
      width: `${CROSSHAIR_THICKNESS_PX}px`,
      height: `${CROSSHAIR_SIZE_PX}px`,
    } satisfies Partial<CSSStyleDeclaration>);

    const progressTrack = document.createElement('div');
    Object.assign(progressTrack.style, PROGRESS_TRACK_STYLE);
    progressTrack.style.display = 'none';

    const progressFill = document.createElement('div');
    Object.assign(progressFill.style, PROGRESS_FILL_STYLE);
    progressTrack.appendChild(progressFill);

    element.appendChild(horizontal);
    element.appendChild(vertical);
    element.appendChild(progressTrack);
    container.appendChild(element);
    this.element = element;
    this.progressTrack = progressTrack;
    this.progressFill = progressFill;
  }

  /**
   * Updates the break-progress bar. `value` is clamped to 0..1; the bar is
   * hidden entirely at 0. Compares the rounded percent against the last
   * rendered value so an unchanged progress touches no DOM.
   */
  setProgress(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    const percent = Math.round(clamped * 100);
    if (percent === this.lastPercent) {
      return;
    }
    this.lastPercent = percent;

    this.progressTrack.style.display = percent === 0 ? 'none' : '';
    this.progressFill.style.width = `${percent}%`;
  }

  dispose(): void {
    this.element.remove();
  }
}
