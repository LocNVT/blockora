import { GRAPHICS_CONFIG, SETTINGS_CONFIG } from '../config/constants';

/**
 * Effective renderer pixel ratio: the resolution scale (percent) of the
 * device pixel ratio capped at GRAPHICS_CONFIG.maxPixelRatio. A missing /
 * non-finite device ratio counts as 1; the result is kept inside
 * [minPixelRatio, maxPixelRatio].
 */
export function computePixelRatio(
  scalePercent: number,
  devicePixelRatio: number,
  maxPixelRatio: number = GRAPHICS_CONFIG.maxPixelRatio,
): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const scale = Number.isFinite(scalePercent) ? scalePercent : SETTINGS_CONFIG.defaultResolutionScale;
  const ratio = (scale / 100) * Math.min(dpr, maxPixelRatio);
  return Math.min(maxPixelRatio, Math.max(GRAPHICS_CONFIG.minPixelRatio, ratio));
}
