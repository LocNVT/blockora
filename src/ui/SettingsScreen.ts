import { SETTINGS_CONFIG } from '../config/constants';
import type { GameSettings } from '../settings/GameSettings';

const STYLE_ELEMENT_ID = 'settings-screen-style';

const SETTINGS_SCREEN_STYLE = {
  overlayBackground: 'rgba(0, 0, 0, 0.55)',
  panelBackground: 'rgba(20, 20, 24, 0.9)',
  panelBorder: 'rgba(255, 255, 255, 0.35)',
  panelWidthPx: 420,
  buttonBackground: 'rgba(255, 255, 255, 0.15)',
  buttonBorder: 'rgba(255, 255, 255, 0.6)',
  buttonHoverBackground: 'rgba(255, 255, 255, 0.28)',
} as const;

/** Slider-backed numeric settings: key, label and how the live value is printed. */
interface SliderSpec {
  readonly key: 'fov' | 'mouseSensitivity' | 'renderDistance';
  readonly label: string;
  readonly range: { readonly min: number; readonly max: number; readonly step: number };
  readonly format: (value: number) => string;
  /**
   * Apply only when the slider is released ('change'), not while dragging
   * ('input'): render distance re-streams chunks, so live dragging would churn.
   * The label still updates while dragging.
   */
  readonly applyOnRelease?: boolean;
}

const SLIDERS: readonly SliderSpec[] = [
  { key: 'fov', label: 'Field of view', range: SETTINGS_CONFIG.fov, format: (v) => `${v}°` },
  {
    key: 'mouseSensitivity',
    label: 'Mouse sensitivity',
    range: SETTINGS_CONFIG.mouseSensitivity,
    format: (v) => `${v.toFixed(2)}x`,
  },
  {
    key: 'renderDistance',
    label: 'Render distance',
    range: SETTINGS_CONFIG.renderDistance,
    format: (v) => `${v} chunks`,
    applyOnRelease: true,
  },
];

interface SliderRow {
  readonly spec: SliderSpec;
  readonly input: HTMLInputElement;
  readonly value: HTMLSpanElement;
}

/**
 * Settings overlay opened from the pause menu: sliders for FOV, mouse
 * sensitivity and render distance (live value labels), an FPS-counter toggle
 * and a Back button. Every change is reported immediately through `onChange`;
 * applying and persisting is the caller's job.
 */
export class SettingsScreen {
  private readonly overlay: HTMLDivElement;
  private readonly rows: readonly SliderRow[];
  private readonly fpsCheckbox: HTMLInputElement;
  private shown = false;

  constructor(
    parent: HTMLElement,
    initial: GameSettings,
    private readonly onChange: (settings: GameSettings) => void,
    onBack: () => void,
  ) {
    SettingsScreen.ensureStyleInjected(parent.ownerDocument ?? document);

    const overlay = document.createElement('div');
    overlay.className = 'settings-screen';
    overlay.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'settings-screen__panel';

    const title = document.createElement('div');
    title.className = 'settings-screen__title';
    title.textContent = 'Settings';
    panel.appendChild(title);

    const rows: SliderRow[] = [];
    for (const spec of SLIDERS) {
      const row = document.createElement('label');
      row.className = 'settings-screen__row';
      const name = document.createElement('span');
      name.textContent = spec.label;
      const value = document.createElement('span');
      value.className = 'settings-screen__value';
      const input = document.createElement('input');
      input.type = 'range';
      input.className = `settings-screen__slider settings-screen__slider--${spec.key}`;
      input.min = String(spec.range.min);
      input.max = String(spec.range.max);
      input.step = String(spec.range.step);
      if (spec.applyOnRelease === true) {
        input.addEventListener('input', () => {
          value.textContent = spec.format(Number(input.value));
        });
        input.addEventListener('change', () => this.emitChange());
      } else {
        input.addEventListener('input', () => this.emitChange());
      }
      row.append(name, value, input);
      panel.appendChild(row);
      rows.push({ spec, input, value });
    }

    const fpsRow = document.createElement('label');
    fpsRow.className = 'settings-screen__row settings-screen__row--check';
    const fpsCheckbox = document.createElement('input');
    fpsCheckbox.type = 'checkbox';
    fpsCheckbox.className = 'settings-screen__fps';
    fpsCheckbox.addEventListener('change', () => this.emitChange());
    const fpsLabel = document.createElement('span');
    fpsLabel.textContent = 'Show FPS counter';
    fpsRow.append(fpsCheckbox, fpsLabel);
    panel.appendChild(fpsRow);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'settings-screen__back';
    back.textContent = 'Back';
    back.addEventListener('click', onBack);
    panel.appendChild(back);

    overlay.appendChild(panel);
    parent.appendChild(overlay);
    this.overlay = overlay;
    this.rows = rows;
    this.fpsCheckbox = fpsCheckbox;
    this.setValues(initial);
  }

  private static ensureStyleInjected(doc: Document): void {
    if (doc.getElementById(STYLE_ELEMENT_ID) !== null) {
      return;
    }
    const s = SETTINGS_SCREEN_STYLE;
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.settings-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${s.overlayBackground};
  font-family: sans-serif;
  user-select: none;
  z-index: 31;
}
.settings-screen__panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: ${s.panelWidthPx}px;
  max-width: calc(100vw - 32px);
  padding: 24px 32px;
  background: ${s.panelBackground};
  border: 2px solid ${s.panelBorder};
  border-radius: 8px;
  color: #fff;
}
.settings-screen__title {
  font-size: 28px;
  font-weight: bold;
  text-align: center;
}
.settings-screen__row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 12px;
  font-size: 16px;
}
.settings-screen__row .settings-screen__slider {
  grid-column: 1 / -1;
  width: 100%;
}
.settings-screen__row--check {
  display: flex;
  align-items: center;
  gap: 10px;
}
.settings-screen__value {
  font-variant-numeric: tabular-nums;
}
.settings-screen__back {
  background: ${s.buttonBackground};
  border: 2px solid ${s.buttonBorder};
  color: #fff;
  font-size: 18px;
  padding: 10px 0;
  border-radius: 6px;
  cursor: pointer;
}
.settings-screen__back:hover {
  background: ${s.buttonHoverBackground};
}
`;
    doc.head.appendChild(style);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Shows the current values in the controls and labels (does not call `onChange`). */
  setValues(settings: GameSettings): void {
    for (const { spec, input, value } of this.rows) {
      input.value = String(settings[spec.key]);
      value.textContent = spec.format(settings[spec.key]);
    }
    this.fpsCheckbox.checked = settings.showFpsCounter;
  }

  private read(): GameSettings {
    const numbers: Record<SliderSpec['key'], number> = { fov: 0, mouseSensitivity: 0, renderDistance: 0 };
    for (const { spec, input } of this.rows) {
      numbers[spec.key] = Number(input.value);
    }
    return { ...numbers, showFpsCounter: this.fpsCheckbox.checked };
  }

  private emitChange(): void {
    const settings = this.read();
    for (const { spec, value } of this.rows) {
      value.textContent = spec.format(settings[spec.key]);
    }
    this.onChange(settings);
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
