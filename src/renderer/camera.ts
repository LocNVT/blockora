import * as THREE from 'three';
import { PLAYER_CONFIG, RENDER_CONFIG } from '../config/constants';
import { computeCameraFar } from './backend';

/** Creates the main perspective camera using the shared player/render config. */
export function createCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    PLAYER_CONFIG.fov,
    aspect,
    RENDER_CONFIG.cameraNear,
    computeCameraFar()
  );
  return camera;
}

/** Updates a camera's aspect ratio after a viewport resize. */
export function resizeCamera(camera: THREE.PerspectiveCamera, aspect: number): void {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
