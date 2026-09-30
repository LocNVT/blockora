import { PLAYER_CONFIG, SETTINGS_CONFIG, WORLD_CONFIG } from '../config/constants';

/** Player-adjustable preferences. */
export interface GameSettings {
  /** Vertical field of view in degrees. */
  readonly fov: number;
  /** Multiplier of PLAYER_CONFIG.mouseSensitivity (1 = base). */
  readonly mouseSensitivity: number;
  /** Rendered radius in chunks. */
  readonly renderDistance: number;
  /** Small always-on FPS readout. */
  readonly showFpsCounter: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  fov: PLAYER_CONFIG.fov,
  mouseSensitivity: 1,
  renderDistance: WORLD_CONFIG.renderDistance,
  showFpsCounter: false,
};

interface Range {
  readonly min: number;
  readonly max: number;
}

function clampTo(value: number, range: Range): number {
  return Math.min(range.max, Math.max(range.min, value));
}

function numberOr(value: unknown, fallback: number, range: Range, integer: boolean): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return clampTo(integer ? Math.round(value) : value, range);
}

/** Clamps every field into its SETTINGS_CONFIG range (FOV and render distance are rounded to integers). */
export function clampSettings(settings: GameSettings): GameSettings {
  return {
    fov: clampTo(Math.round(settings.fov), SETTINGS_CONFIG.fov),
    mouseSensitivity: clampTo(settings.mouseSensitivity, SETTINGS_CONFIG.mouseSensitivity),
    renderDistance: clampTo(Math.round(settings.renderDistance), SETTINGS_CONFIG.renderDistance),
    showFpsCounter: settings.showFpsCounter,
  };
}

/**
 * Builds valid settings from untrusted data (e.g. parsed storage): a
 * non-object yields the defaults; each missing / wrongly typed / non-finite
 * field falls back to its default, and numbers are clamped into range.
 */
export function validateSettings(raw: unknown): GameSettings {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_SETTINGS;
  }
  const data = raw as Record<string, unknown>;
  return {
    fov: numberOr(data.fov, DEFAULT_SETTINGS.fov, SETTINGS_CONFIG.fov, true),
    mouseSensitivity: numberOr(
      data.mouseSensitivity,
      DEFAULT_SETTINGS.mouseSensitivity,
      SETTINGS_CONFIG.mouseSensitivity,
      false,
    ),
    renderDistance: numberOr(data.renderDistance, DEFAULT_SETTINGS.renderDistance, SETTINGS_CONFIG.renderDistance, true),
    showFpsCounter: typeof data.showFpsCounter === 'boolean' ? data.showFpsCounter : DEFAULT_SETTINGS.showFpsCounter,
  };
}

/** Scales raw look deltas in place by the sensitivity multiplier (the base value lives in PLAYER_CONFIG). */
export function applyLookSensitivity(
  input: { lookDeltaX: number; lookDeltaY: number },
  settings: Pick<GameSettings, 'mouseSensitivity'>,
): void {
  input.lookDeltaX *= settings.mouseSensitivity;
  input.lookDeltaY *= settings.mouseSensitivity;
}
