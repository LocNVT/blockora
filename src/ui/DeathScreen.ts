const DEATH_SCREEN_STYLE = {
  overlayBackground: 'rgba(60, 0, 0, 0.55)',
  titleColor: '#ffffff',
  titleFontPx: 48,
  buttonBackground: 'rgba(255, 255, 255, 0.15)',
  buttonBorder: 'rgba(255, 255, 255, 0.6)',
  buttonHoverBackground: 'rgba(255, 255, 255, 0.28)',
  buttonColor: '#ffffff',
  buttonFontPx: 18,
  buttonPaddingPx: '10px 28px',
  gapPx: 24,
} as const;

const STYLE_ELEMENT_ID = 'death-screen-style';

/**
 * Full-screen "You died" overlay with a Respawn button. Hidden by default;
 * `show()`/`hide()` toggle visibility. The Respawn click handler is supplied
 * by the caller (main.ts) so this component has no gameplay logic of its own.
 */
export class DeathScreen {
  private readonly overlay: HTMLDivElement;
  private readonly respawnButton: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    DeathScreen.ensureStyleInjected(parent.ownerDocument ?? document);

    const overlay = document.createElement('div');
    overlay.className = 'death-screen';
    overlay.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'death-screen__title';
    title.textContent = 'You died';
    overlay.appendChild(title);

    const respawnButton = document.createElement('button');
    respawnButton.className = 'death-screen__respawn';
    respawnButton.type = 'button';
    respawnButton.textContent = 'Respawn';
    overlay.appendChild(respawnButton);

    parent.appendChild(overlay);
    this.overlay = overlay;
    this.respawnButton = respawnButton;
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.death-screen {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${DEATH_SCREEN_STYLE.gapPx}px;
  background: ${DEATH_SCREEN_STYLE.overlayBackground};
  font-family: sans-serif;
  user-select: none;
}
.death-screen__title {
  color: ${DEATH_SCREEN_STYLE.titleColor};
  font-size: ${DEATH_SCREEN_STYLE.titleFontPx}px;
  font-weight: bold;
}
.death-screen__respawn {
  background: ${DEATH_SCREEN_STYLE.buttonBackground};
  border: 2px solid ${DEATH_SCREEN_STYLE.buttonBorder};
  color: ${DEATH_SCREEN_STYLE.buttonColor};
  font-size: ${DEATH_SCREEN_STYLE.buttonFontPx}px;
  padding: ${DEATH_SCREEN_STYLE.buttonPaddingPx};
  border-radius: 6px;
  cursor: pointer;
}
.death-screen__respawn:hover {
  background: ${DEATH_SCREEN_STYLE.buttonHoverBackground};
}
`;
    doc.head.appendChild(style);
  }

  /** Registers the Respawn button click handler (call once; replaces any previous handler). */
  onRespawn(handler: () => void): void {
    this.respawnButton.onclick = handler;
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
