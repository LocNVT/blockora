const PAUSE_MENU_STYLE = {
  overlayBackground: 'rgba(0, 0, 0, 0.55)',
  panelBackground: 'rgba(20, 20, 24, 0.85)',
  panelBorder: 'rgba(255, 255, 255, 0.35)',
  titleFontPx: 36,
  buttonBackground: 'rgba(255, 255, 255, 0.15)',
  buttonBorder: 'rgba(255, 255, 255, 0.6)',
  buttonHoverBackground: 'rgba(255, 255, 255, 0.28)',
  buttonDisabledColor: 'rgba(255, 255, 255, 0.45)',
  buttonFontPx: 18,
  buttonWidthPx: 240,
  gapPx: 14,
  okColor: '#9be29b',
  errorColor: '#ff9d9d',
} as const;

const STYLE_ELEMENT_ID = 'pause-menu-style';

export type PauseMenuMode = 'start' | 'paused';
export type PauseStatusKind = 'ok' | 'error' | 'info';

export interface PauseMenuHandlers {
  readonly onResume: () => void;
  readonly onSettings: () => void;
  readonly onSave: () => void;
  readonly onQuit: () => void;
}

/**
 * The single full-screen overlay shown whenever the game is not receiving
 * input and no other screen owns the cursor: "Click to play" before the first
 * pointer lock, "Paused" afterwards. Buttons: Resume/Play, Settings, Save.
 * Clicking the dimmed backdrop also resumes. It only draws and reports clicks;
 * pause logic lives in `PauseController` and main.ts.
 */
export class PauseMenu {
  private readonly overlay: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly quitButton: HTMLButtonElement;
  private readonly status: HTMLDivElement;
  private shown = false;

  constructor(parent: HTMLElement, handlers: PauseMenuHandlers) {
    PauseMenu.ensureStyleInjected(parent.ownerDocument ?? document);

    const overlay = document.createElement('div');
    overlay.className = 'pause-menu';
    overlay.style.display = 'none';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        handlers.onResume();
      }
    });

    const panel = document.createElement('div');
    panel.className = 'pause-menu__panel';

    const title = document.createElement('div');
    title.className = 'pause-menu__title';
    panel.appendChild(title);

    const resumeButton = PauseMenu.button('pause-menu__resume', handlers.onResume);
    const settingsButton = PauseMenu.button('pause-menu__settings', handlers.onSettings);
    settingsButton.textContent = 'Settings';
    const saveButton = PauseMenu.button('pause-menu__save', handlers.onSave);
    saveButton.textContent = 'Save';
    const quitButton = PauseMenu.button('pause-menu__quit', handlers.onQuit);
    quitButton.textContent = 'Save & quit to title';
    panel.append(resumeButton, settingsButton, saveButton, quitButton);

    const status = document.createElement('div');
    status.className = 'pause-menu__status';
    status.setAttribute('role', 'status');
    panel.appendChild(status);

    overlay.appendChild(panel);
    parent.appendChild(overlay);
    this.overlay = overlay;
    this.title = title;
    this.resumeButton = resumeButton;
    this.saveButton = saveButton;
    this.quitButton = quitButton;
    this.status = status;
    this.setMode('paused');
  }

  private static button(className: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `pause-menu__button ${className}`;
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const s = PAUSE_MENU_STYLE;
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.pause-menu {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${s.overlayBackground};
  font-family: sans-serif;
  user-select: none;
  z-index: 30;
  overflow-y: auto;
}
.pause-menu__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${s.gapPx}px;
  padding: 28px 40px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  background: ${s.panelBackground};
  border: 2px solid ${s.panelBorder};
  border-radius: 8px;
}
.pause-menu__title {
  color: #fff;
  font-size: ${s.titleFontPx}px;
  font-weight: bold;
}
.pause-menu__button {
  width: ${s.buttonWidthPx}px;
  background: ${s.buttonBackground};
  border: 2px solid ${s.buttonBorder};
  color: #fff;
  font-size: ${s.buttonFontPx}px;
  padding: 10px 0;
  min-height: 44px;
  border-radius: 6px;
  cursor: pointer;
}
.pause-menu__button:hover:not(:disabled) {
  background: ${s.buttonHoverBackground};
}
.pause-menu__button:disabled {
  color: ${s.buttonDisabledColor};
  cursor: not-allowed;
}
.pause-menu__status {
  min-height: 1.3em;
  max-width: min(${s.buttonWidthPx + 40}px, calc(100vw - 64px));
  color: #fff;
  font-size: 14px;
  text-align: center;
}
.pause-menu__status[data-kind='ok'] { color: ${s.okColor}; }
.pause-menu__status[data-kind='error'] { color: ${s.errorColor}; }
`;
    doc.head.appendChild(style);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** 'start' (before the first pointer lock) reads "Click to play"; 'paused' reads "Paused" / "Resume". */
  setMode(mode: PauseMenuMode): void {
    this.title.textContent = mode === 'start' ? 'Click to play' : 'Paused';
    this.resumeButton.textContent = mode === 'start' ? 'Play' : 'Resume';
  }

  /** Enables the Save button, or disables it and explains why (saving is off for this session). */
  setSaveAvailability(disabledReason: string | null): void {
    this.saveButton.disabled = disabledReason !== null;
    this.saveButton.title = disabledReason ?? '';
    if (disabledReason !== null) {
      this.setStatus(disabledReason, 'error');
    }
  }

  /** Disables Save and Quit while a save (or the save before quitting) is running. */
  setSaveBusy(busy: boolean): void {
    this.saveButton.disabled = busy;
    this.quitButton.disabled = busy;
  }

  setStatus(text: string, kind: PauseStatusKind = 'info'): void {
    this.status.textContent = text;
    this.status.dataset.kind = kind;
  }

  show(): void {
    this.shown = true;
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.shown = false;
    this.overlay.style.display = 'none';
  }

  dispose(): void {
    this.overlay.remove();
  }
}
