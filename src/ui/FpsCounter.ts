import { DEBUG_CONFIG } from '../config/constants';
import { IntervalGate } from '../debug/IntervalGate';

const STYLE_ELEMENT_ID = 'fps-counter-style';

/** Small always-on "NN FPS" readout (top-right), toggled from the settings screen. */
export class FpsCounter {
  private readonly element: HTMLDivElement;
  private readonly gate = new IntervalGate(1000 / DEBUG_CONFIG.overlayUpdateHz);
  private shown = false;

  constructor(parent: HTMLElement) {
    FpsCounter.ensureStyleInjected(parent.ownerDocument ?? document);
    const element = document.createElement('div');
    element.className = 'fps-counter';
    element.style.display = 'none';
    parent.appendChild(element);
    this.element = element;
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.fps-counter {
  position: fixed;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
  user-select: none;
  z-index: 20;
}
`;
    doc.head.appendChild(style);
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.element.style.display = visible ? '' : 'none';
    this.gate.reset();
  }

  /** Call every frame; the text is rebuilt at the overlay rate, and `getFps` only runs when due. */
  update(nowMs: number, getFps: () => number): void {
    if (!this.shown || !this.gate.due(nowMs)) {
      return;
    }
    this.element.textContent = `${Math.round(getFps())} FPS`;
  }

  dispose(): void {
    this.element.remove();
  }
}
