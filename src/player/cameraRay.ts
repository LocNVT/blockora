import type { PlayerState, Vector3Like } from './PlayerState';
import { PLAYER_CONFIG } from '../config/constants';

type PlayerConfig = typeof PLAYER_CONFIG;

/**
 * Computes the world-space eye (camera) position for a player state: feet
 * position plus eye height, using the crouching eye height while crouched.
 * Mirrors the offset `applyStateToCamera` (firstPersonCamera.ts) applies to
 * the Three.js camera, kept here as a pure/allocation-light helper so
 * non-rendering code (e.g. raycasting) can compute the same eye position
 * without touching Three.js.
 */
export function eyePosition(
  state: PlayerState,
  config: PlayerConfig = PLAYER_CONFIG,
  out: Vector3Like = { x: 0, y: 0, z: 0 },
): Vector3Like {
  const eyeHeight = state.crouching ? config.crouchEyeHeight : config.eyeHeight;
  out.x = state.position.x;
  out.y = state.position.y + eyeHeight;
  out.z = state.position.z;
  return out;
}

/**
 * Computes the (unnormalized, but unit-length) look direction for a given
 * yaw/pitch pair, matching the 'YXZ' Euler rotation order used by
 * `applyStateToCamera`: yaw 0 / pitch 0 looks down -Z, positive pitch looks
 * up, positive yaw turns... consistent with camera.rotation.set(pitch, yaw, 0)
 * in 'YXZ' order.
 */
export function lookDirection(
  yaw: number,
  pitch: number,
  out: Vector3Like = { x: 0, y: 0, z: 0 },
): Vector3Like {
  const cosPitch = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cosPitch;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cosPitch;
  return out;
}
