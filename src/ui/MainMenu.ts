import type { MainMenuModel } from '../menu/menuModel';

const MAIN_MENU_STYLE = {
  overlayBackground: 'linear-gradient(180deg, #16324a 0%, #2b4a3a 100%)',
  panelBackground: 'rgba(20, 20, 24, 0.85)',
  panelBorder: 'rgba(255, 255, 255, 0.35)',
  titleFontPx: 48,
  buttonBackground: 'rgba(255, 255, 255, 0.15)',
  buttonBorder: 'rgba(255, 255, 255, 0.6)',
  buttonHoverBackground: 'rgba(255, 255, 255, 0.28)',
  buttonDisabledColor: 'rgba(255, 255, 255, 0.45)',
  buttonFontPx: 18,
  buttonWidthPx: 280,
  gapPx: 14,
  errorColor: '#ff9d9d',
  warnColor: '#ffd98a',
} as const;

const STYLE_ELEMENT_ID = 'main-menu-style';

export interface SavedWorldInfo {
  readonly seed: number;
  /** Epoch milliseconds of the last save. */
  readonly savedAt: number;
}

export interface MainMenuHandlers {
  readonly onContinue: () => void;
  /** Receives the raw text of the seed field (blank = use the suggested seed). */
  readonly onNewWorld: (seedText: string) => void;
  readonly onSettings: () => void;
  readonly onConfirmReplace: () => void;
  readonly onCancelReplace: () => void;
}

/**
 * The title screen: Continue / New world (with an optional seed field) /
 * Settings, plus the "This replaces your saved world" confirm view. It only
 * draws and reports clicks; the rules live in `MenuFlow` and `mainMenuModel`.
 */
export class MainMenu {
  private readonly overlay: HTMLDivElement;
  private readonly mainView: HTMLDivElement;
  private readonly confirmView: HTMLDivElement;
  private readonly buttons: readonly HTMLButtonElement[];
  private readonly continueButton: HTMLButtonElement;
  private readonly confirmSeed: HTMLDivElement;
  private readonly error: HTMLDivElement;
  private continueAllowed: boolean;

  constructor(
    parent: HTMLElement,
    model: MainMenuModel,
    suggestedSeed: number,
    saved: SavedWorldInfo | null,
    handlers: MainMenuHandlers,
  ) {
    MainMenu.ensureStyleInjected(parent.ownerDocument ?? document);

    const overlay = document.createElement('div');
    overlay.className = 'main-menu';
    const panel = document.createElement('div');
    panel.className = 'main-menu__panel';

    const title = document.createElement('div');
    title.className = 'main-menu__title';
    title.textContent = 'Blockora';
    panel.appendChild(title);

    const mainView = document.createElement('div');
    mainView.className = 'main-menu__view';

    const continueButton = MainMenu.button('main-menu__continue', 'Continue', handlers.onContinue);
    continueButton.disabled = !model.continueEnabled;
    mainView.appendChild(continueButton);
    if (model.continueEnabled && saved !== null) {
      const info = document.createElement('div');
      info.className = 'main-menu__info main-menu__saved';
      info.textContent = `Seed ${saved.seed} - saved ${new Date(saved.savedAt).toLocaleString()}`;
      mainView.appendChild(info);
    }

    const seedLabel = document.createElement('label');
    seedLabel.className = 'main-menu__seed';
    const seedText = document.createElement('span');
    seedText.textContent = 'Seed (optional: number or text)';
    const seedInput = document.createElement('input');
    seedInput.type = 'text';
    seedInput.className = 'main-menu__seed-input';
    seedInput.placeholder = String(suggestedSeed);
    seedInput.autocomplete = 'off';
    seedInput.spellcheck = false;
    seedLabel.append(seedText, seedInput);
    const seedHint = document.createElement('div');
    seedHint.className = 'main-menu__info main-menu__random-seed';
    seedHint.textContent = `Random seed: ${suggestedSeed}`;

    const newWorldButton = MainMenu.button('main-menu__new', 'New world', () => handlers.onNewWorld(seedInput.value));
    newWorldButton.disabled = !model.newWorldEnabled;
    const settingsButton = MainMenu.button('main-menu__settings', 'Settings', handlers.onSettings);
    mainView.append(seedLabel, seedHint, newWorldButton, settingsButton);

    const confirmView = document.createElement('div');
    confirmView.className = 'main-menu__view';
    confirmView.style.display = 'none';
    const warning = document.createElement('div');
    warning.className = 'main-menu__warning';
    warning.textContent = 'This replaces your saved world';
    const confirmSeed = document.createElement('div');
    confirmSeed.className = 'main-menu__info';
    const replaceButton = MainMenu.button('main-menu__replace', 'Replace', handlers.onConfirmReplace);
    const cancelButton = MainMenu.button('main-menu__cancel', 'Cancel', handlers.onCancelReplace);
    confirmView.append(warning, confirmSeed, replaceButton, cancelButton);

    const notice = document.createElement('div');
    notice.className = 'main-menu__notice';
    notice.textContent = model.notice ?? '';
    notice.style.display = model.notice === null ? 'none' : 'block';
    const error = document.createElement('div');
    error.className = 'main-menu__error';
    error.setAttribute('role', 'alert');

    panel.append(mainView, confirmView, notice, error);
    overlay.appendChild(panel);
    parent.appendChild(overlay);

    this.overlay = overlay;
    this.mainView = mainView;
    this.confirmView = confirmView;
    this.continueButton = continueButton;
    this.confirmSeed = confirmSeed;
    this.error = error;
    this.continueAllowed = model.continueEnabled;
    this.buttons = [continueButton, newWorldButton, settingsButton, replaceButton, cancelButton];
  }

  private static button(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `main-menu__button ${className}`;
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const s = MAIN_MENU_STYLE;
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.main-menu {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${s.overlayBackground};
  font-family: sans-serif;
  user-select: none;
  z-index: 25;
}
.main-menu__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${s.gapPx}px;
  padding: 28px 40px;
  max-width: calc(100vw - 32px);
  background: ${s.panelBackground};
  border: 2px solid ${s.panelBorder};
  border-radius: 8px;
}
.main-menu__view {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${s.gapPx}px;
}
.main-menu__title {
  color: #fff;
  font-size: ${s.titleFontPx}px;
  font-weight: bold;
}
.main-menu__button {
  width: ${s.buttonWidthPx}px;
  background: ${s.buttonBackground};
  border: 2px solid ${s.buttonBorder};
  color: #fff;
  font-size: ${s.buttonFontPx}px;
  padding: 10px 0;
  border-radius: 6px;
  cursor: pointer;
}
.main-menu__button:hover:not(:disabled) {
  background: ${s.buttonHoverBackground};
}
.main-menu__button:disabled {
  color: ${s.buttonDisabledColor};
  cursor: not-allowed;
}
.main-menu__seed {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: ${s.buttonWidthPx}px;
  color: #fff;
  font-size: 14px;
}
.main-menu__seed-input {
  font-size: 16px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 2px solid ${s.buttonBorder};
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  user-select: text;
}
.main-menu__info {
  max-width: ${s.buttonWidthPx + 40}px;
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
  text-align: center;
}
.main-menu__warning {
  color: ${s.warnColor};
  font-size: 20px;
  font-weight: bold;
  text-align: center;
}
.main-menu__notice {
  max-width: ${s.buttonWidthPx + 40}px;
  color: ${s.warnColor};
  font-size: 14px;
  text-align: center;
}
.main-menu__error {
  min-height: 1.3em;
  max-width: ${s.buttonWidthPx + 40}px;
  color: ${s.errorColor};
  font-size: 14px;
  text-align: center;
}
`;
    doc.head.appendChild(style);
  }

  /** Main buttons (Continue / New world / Settings). */
  showMain(): void {
    this.mainView.style.display = 'flex';
    this.confirmView.style.display = 'none';
  }

  /** The "This replaces your saved world" step for the world about to start with `seed`. */
  showConfirm(seed: number): void {
    this.confirmSeed.textContent = `The new world will use seed ${seed}.`;
    this.mainView.style.display = 'none';
    this.confirmView.style.display = 'flex';
  }

  setError(text: string): void {
    this.error.textContent = text;
  }

  /** Disables every button while an async step (clearing storage) runs. */
  setBusy(busy: boolean): void {
    for (const button of this.buttons) {
      button.disabled = busy;
    }
    if (!busy) {
      this.continueButton.disabled = !this.continueAllowed;
    }
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
