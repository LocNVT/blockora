import type * as THREE from 'three';
import { computeCameraFar, computeFogRange } from './backend';

/** Sets the camera's vertical FOV (degrees) and refreshes its projection. */
export function applyFov(camera: THREE.PerspectiveCamera, fovDegrees: number): void {
  camera.fov = fovDegrees;
  camera.updateProjectionMatrix();
}

/**
 * Re-derives everything view-distance dependent from the render distance:
 * camera far plane and (linear) fog near/far, so the world still fades out at
 * the edge of the rendered chunks.
 */
export function applyRenderDistanceToView(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderDistanceChunks: number,
): void {
  camera.far = computeCameraFar(renderDistanceChunks);
  camera.updateProjectionMatrix();
  const fog = scene.fog;
  if (fog !== null && 'near' in fog && 'far' in fog) {
    const range = computeFogRange(renderDistanceChunks);
    fog.near = range.near;
    fog.far = range.far;
  }
}
