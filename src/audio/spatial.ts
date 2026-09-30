import { AUDIO_CONFIG } from '../config/constants';

/** Where the player hears from: feet / eye position and horizontal look angle (radians). */
export interface Listener {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface Spatial {
  /** Level multiplier 0..1 from distance (and a slight dip behind the listener). */
  readonly gain: number;
  /** Stereo pan -1 (left) .. 1 (right). */
  readonly pan: number;
}

/** Full level inside the reference distance, then a smooth (squared) fall to silence at the hearing limit. */
export function distanceGain(distance: number): number {
  const { referenceDistance, maxHearingDistance } = AUDIO_CONFIG;
  if (distance <= referenceDistance) {
    return 1;
  }
  if (distance >= maxHearingDistance) {
    return 0;
  }
  const t = 1 - (distance - referenceDistance) / (maxHearingDistance - referenceDistance);
  return t * t;
}

/** Below this horizontal distance the source is "on" the listener: centred, no directional dip. */
const CENTRE_DISTANCE = 0.5;

/**
 * Gain and pan of a source at (sx, sy, sz) for `listener`. The listener's
 * forward is (-sin yaw, -cos yaw) and right is (cos yaw, -sin yaw) (the same
 * convention as the camera). Returns null when the source is out of hearing
 * range. Sources directly behind pan to the centre and are slightly quieter.
 */
export function spatialize(listener: Listener, sx: number, sy: number, sz: number): Spatial | null {
  const dx = sx - listener.x;
  const dy = sy - listener.y;
  const dz = sz - listener.z;
  const gain = distanceGain(Math.hypot(dx, dy, dz));
  if (gain <= 0) {
    return null;
  }
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < CENTRE_DISTANCE) {
    return { gain, pan: 0 };
  }
  const nx = dx / horizontal;
  const nz = dz / horizontal;
  const sin = Math.sin(listener.yaw);
  const cos = Math.cos(listener.yaw);
  const right = nx * cos - nz * sin;
  const forward = nx * -sin + nz * -cos;
  const behind = Math.max(0, -forward);
  return {
    gain: gain * (1 - behind * (1 - AUDIO_CONFIG.behindGain)),
    pan: Math.max(-1, Math.min(1, right)),
  };
}
