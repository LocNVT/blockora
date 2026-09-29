import { DEBUG_CONFIG } from '../config/constants';
import { IntervalGate } from '../debug/IntervalGate';
import { formatDebugLines, type DebugSnapshot } from '../debug/debugText';

const STYLE_ELEMENT_ID = 'debug-overlay-style';

/**
 * F3 debug panel: monospace text, top-left, hidden by default,
 * `pointer-events: none` so it never affects pointer lock or the inventory
 * screens. Text is rebuilt at `overlayUpdateHz`, and the snapshot provider is
 * only invoked when the panel is visible and an update is due.
 */
export class DebugOverlay {
  private readonly element: HTMLPreElement;
  private readonly gate = new IntervalGate(1000 / DEBUG_CONFIG.overlayUpdateHz);
  private shown = false;

  constructor(parent: HTMLElement) {
    DebugOverlay.ensureStyleInjected(parent.ownerDocument ?? document);
    const element = document.createElement('pre');
    element.className = 'debug-overlay';
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
.debug-overlay {
  position: fixed;
  top: 8px;
  left: 8px;
  margin: 0;
  padding: 6px 8px;
  font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  white-space: pre;
  pointer-events: none;
  user-select: none;
  z-index: 20;
}
`;
    doc.head.appendChild(style);
  }

  get visible(): boolean {
    return this.shown;
  }

  toggle(): void {
    this.shown = !this.shown;
    this.element.style.display = this.shown ? '' : 'none';
    this.gate.reset();
  }

  /** Call every frame with a timestamp in ms; cheap unless visible and due. */
  update(nowMs: number, getSnapshot: () => DebugSnapshot): void {
    if (!this.shown || !this.gate.due(nowMs)) {
      return;
    }
    this.element.textContent = formatDebugLines(getSnapshot()).join('\n');
  }

  dispose(): void {
    this.element.remove();
  }
}
