import { AUDIO_CONFIG } from '../config/constants';

/** The volume settings the audio system follows (percent 0..100). */
export interface VolumeLevels {
  readonly master: number;
  readonly effects: number;
  readonly ambient: number;
}

/** Picks the volume fields out of the game settings. */
export function volumesFromSettings(settings: {
  readonly masterVolume: number;
  readonly effectsVolume: number;
  readonly ambientVolume: number;
}): VolumeLevels {
  return { master: settings.masterVolume, effects: settings.effectsVolume, ambient: settings.ambientVolume };
}

/** Percent (0..100) to a linear gain 0..1; non-finite input is silence. */
export function percentToGain(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent)) / 100;
}

/**
 * Target level of the ambient wind bed (0..1, before the ambient volume):
 * louder in daylight, and much quieter with no sky light (caves).
 * `skyLight` is 0..15 at the player's head.
 */
export function ambientTarget(daylight: number, skyLight: number): number {
  const day = Math.min(1, Math.max(0, daylight));
  const sky = Math.min(1, Math.max(0, skyLight / 15));
  const outdoors = AUDIO_CONFIG.ambientCaveFactor + (1 - AUDIO_CONFIG.ambientCaveFactor) * sky;
  return outdoors * (0.45 + 0.55 * day);
}
