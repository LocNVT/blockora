const HINT_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  inset: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#ffffff',
  fontFamily: 'sans-serif',
  fontSize: '1.5rem',
  background: 'rgba(0, 0, 0, 0.35)',
  pointerEvents: 'none',
  userSelect: 'none',
};

/** Minimal "Click to play" overlay, hidden while the pointer is locked. */
export class PointerLockHint {
  private readonly element: HTMLDivElement;

  constructor(container: HTMLElement) {
    const element = document.createElement('div');
    element.textContent = 'Click to play';
    Object.assign(element.style, HINT_STYLE);
    container.appendChild(element);
    this.element = element;
  }

  setLocked(locked: boolean): void {
    this.element.style.display = locked ? 'none' : 'flex';
  }

  dispose(): void {
    this.element.remove();
  }
}
