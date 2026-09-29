import * as THREE from 'three';
import { PLAYER_CONFIG } from '../config/constants';
import type { PlayerState } from './PlayerState';

/**
 * Applies player simulation state to a Three.js camera: eye position
 * (feet + eye height, lower while crouching) and look rotation. Uses 'YXZ'
 * Euler order so yaw and pitch compose correctly for an FPS-style camera.
 */
export function applyStateToCamera(camera: THREE.PerspectiveCamera, state: PlayerState): void {
  const eyeHeight = state.crouching ? PLAYER_CONFIG.crouchEyeHeight : PLAYER_CONFIG.eyeHeight;

  camera.position.set(
    state.position.x,
    state.position.y + eyeHeight,
    state.position.z
  );

  camera.rotation.order = 'YXZ';
  camera.rotation.set(state.pitch, state.yaw, 0);
}
