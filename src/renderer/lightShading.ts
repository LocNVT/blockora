import { LIGHT_RENDER_CONFIG } from '../config/constants';
import { MAX_LIGHT } from '../world/light/lightNibbles';

/**
 * Pure reference implementation of the chunk light shading (no three.js).
 * `chunkMeshes.ts` builds the same math as a TSL node graph; these functions
 * define the intended curve and are what the unit tests pin down.
 */
export type LightRenderConfig = typeof LIGHT_RENDER_CONFIG;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Clamps a daylight factor to [0, 1] (NaN → 0). */
export function clampDaylight(daylight: number): number {
  return Number.isNaN(daylight) ? 0 : clamp01(daylight);
}

/** Sky light multiplier for a daylight factor: nightSkyScale at night, 1 at full day. */
export function skyScale(daylight: number, config: LightRenderConfig = LIGHT_RENDER_CONFIG): number {
  const d = clampDaylight(daylight);
  return config.nightSkyScale + (1 - config.nightSkyScale) * d;
}

/** Effective light level (0..15, continuous) = max(sky × skyScale(daylight), block). */
export function effectiveLightLevel(
  sky: number,
  block: number,
  daylight: number,
  config: LightRenderConfig = LIGHT_RENDER_CONFIG,
): number {
  return Math.max(sky * skyScale(daylight, config), block);
}

/**
 * Maps a light level (0..15, may be fractional) to brightness:
 * mix(minBrightness, 1, (level / 15) ^ gamma). Monotonic, minBrightness at 0,
 * exactly 1 at 15; out-of-range levels are clamped.
 */
export function lightCurve(level: number, config: LightRenderConfig = LIGHT_RENDER_CONFIG): number {
  const t = Math.pow(clamp01(level / MAX_LIGHT), config.gamma);
  return config.minBrightness + (1 - config.minBrightness) * t;
}

/** Directional face shade from an axis-aligned normal: top, ±X sides, ±Z sides, bottom. */
export function faceShade(
  nx: number,
  ny: number,
  config: LightRenderConfig = LIGHT_RENDER_CONFIG,
): number {
  if (ny > 0.5) {
    return config.faceShadeTop;
  }
  if (ny < -0.5) {
    return config.faceShadeBottom;
  }
  if (Math.abs(nx) > 0.5) {
    return config.faceShadeSideX;
  }
  return config.faceShadeSideZ;
}
