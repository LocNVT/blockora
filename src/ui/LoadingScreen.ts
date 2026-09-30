const LOADING_STYLE = {
  overlayBackground: '#101820',
  barWidthPx: 320,
  barHeightPx: 10,
  barTrack: 'rgba(255, 255, 255, 0.2)',
  barFill: '#9be29b',
} as const;

const STYLE_ELEMENT_ID = 'loading-screen-style';

/** Full-screen "loading" overlay with a stage label and a progress bar; drawn only, driven by main.ts. */
export class LoadingScreen {
  private readonly overlay: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly fill: HTMLDivElement;

  constructor(parent: HTMLElement) {
    LoadingScreen.ensureStyleInjected(parent.ownerDocument ?? document);
    const overlay = document.createElement('div');
    overlay.className = 'loading-screen';
    overlay.style.display = 'none';

    const label = document.createElement('div');
    label.className = 'loading-screen__label';
    label.setAttribute('role', 'status');
    const bar = document.createElement('div');
    bar.className = 'loading-screen__bar';
    const fill = document.createElement('div');
    fill.className = 'loading-screen__fill';
    bar.appendChild(fill);

    overlay.append(label, bar);
    parent.appendChild(overlay);
    this.overlay = overlay;
    this.label = label;
    this.fill = fill;
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const s = LOADING_STYLE;
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.loading-screen {
  position: fixed;
  inset: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: ${s.overlayBackground};
  color: #fff;
  font-family: sans-serif;
  user-select: none;
  z-index: 28;
}
.loading-screen__label { font-size: 20px; }
.loading-screen__bar {
  width: ${s.barWidthPx}px;
  max-width: calc(100vw - 32px);
  height: ${s.barHeightPx}px;
  background: ${s.barTrack};
  border-radius: 5px;
  overflow: hidden;
}
.loading-screen__fill {
  width: 0;
  height: 100%;
  background: ${s.barFill};
}
`;
    doc.head.appendChild(style);
  }

  /** Shows `label` with progress `fraction` (clamped to 0..1). */
  setStage(label: string, fraction: number): void {
    this.label.textContent = label;
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  }

  show(): void {
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  dispose(): void {
    this.overlay.remove();
  }
}
