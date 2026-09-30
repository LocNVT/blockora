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
  /** Overall volume, percent 0..100. */
  readonly masterVolume: number;
  /** Sound effects volume, percent 0..100. */
  readonly effectsVolume: number;
  /** Ambient (wind) volume, percent 0..100. */
  readonly ambientVolume: number;
  /** Internal render resolution, percent of the native (capped) pixel ratio. */
  readonly resolutionScale: number;
  /** Distance fog (off shows the streaming edge of the world). */
  readonly fogEnabled: boolean;
  /** Frame-rate cap in fps; 0 = unlimited (vsync). One of SETTINGS_CONFIG.frameRateCaps. */
  readonly frameRateCap: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  fov: PLAYER_CONFIG.fov,
  mouseSensitivity: 1,
  renderDistance: WORLD_CONFIG.renderDistance,
  showFpsCounter: false,
  masterVolume: SETTINGS_CONFIG.defaultMasterVolume,
  effectsVolume: SETTINGS_CONFIG.defaultEffectsVolume,
  ambientVolume: SETTINGS_CONFIG.defaultAmbientVolume,
  resolutionScale: SETTINGS_CONFIG.defaultResolutionScale,
  fogEnabled: SETTINGS_CONFIG.defaultFogEnabled,
  frameRateCap: SETTINGS_CONFIG.defaultFrameRateCap,
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

/** A volume percent rounded to a whole number inside its range; non-finite / missing falls back. */
function volumeOr(value: unknown, fallback: number): number {
  return numberOr(value, fallback, SETTINGS_CONFIG.volume, true);
}

/** A frame cap must be one of the selectable options; anything else falls back (0 = unlimited is always valid). */
function frameCapOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && SETTINGS_CONFIG.frameRateCaps.includes(value) ? value : fallback;
}

/** Clamps every field into its SETTINGS_CONFIG range (FOV, render distance and volumes are rounded to integers). */
export function clampSettings(settings: GameSettings): GameSettings {
  return {
    fov: clampTo(Math.round(settings.fov), SETTINGS_CONFIG.fov),
    mouseSensitivity: clampTo(settings.mouseSensitivity, SETTINGS_CONFIG.mouseSensitivity),
    renderDistance: clampTo(Math.round(settings.renderDistance), SETTINGS_CONFIG.renderDistance),
    showFpsCounter: settings.showFpsCounter,
    masterVolume: volumeOr(settings.masterVolume, DEFAULT_SETTINGS.masterVolume),
    effectsVolume: volumeOr(settings.effectsVolume, DEFAULT_SETTINGS.effectsVolume),
    ambientVolume: volumeOr(settings.ambientVolume, DEFAULT_SETTINGS.ambientVolume),
    resolutionScale: numberOr(
      settings.resolutionScale,
      DEFAULT_SETTINGS.resolutionScale,
      SETTINGS_CONFIG.resolutionScale,
      true,
    ),
    fogEnabled: settings.fogEnabled,
    frameRateCap: frameCapOr(settings.frameRateCap, DEFAULT_SETTINGS.frameRateCap),
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
    masterVolume: volumeOr(data.masterVolume, DEFAULT_SETTINGS.masterVolume),
    effectsVolume: volumeOr(data.effectsVolume, DEFAULT_SETTINGS.effectsVolume),
    ambientVolume: volumeOr(data.ambientVolume, DEFAULT_SETTINGS.ambientVolume),
    resolutionScale: numberOr(
      data.resolutionScale,
      DEFAULT_SETTINGS.resolutionScale,
      SETTINGS_CONFIG.resolutionScale,
      true,
    ),
    fogEnabled: typeof data.fogEnabled === 'boolean' ? data.fogEnabled : DEFAULT_SETTINGS.fogEnabled,
    frameRateCap: frameCapOr(data.frameRateCap, DEFAULT_SETTINGS.frameRateCap),
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
