import { WORLD_CONFIG, RENDER_CONFIG } from '../config/constants';

export type RendererBackend = 'webgpu' | 'webgl2';

/**
 * Pure decision function: which backend to use given WebGPU adapter support.
 * Kept separate from createRenderer.ts so it can be unit-tested in a plain
 * node environment without importing three/webgpu.
 */
export function chooseBackend(hasWebGPUAdapter: boolean): RendererBackend {
  return hasWebGPUAdapter ? 'webgpu' : 'webgl2';
}

export interface FogRange {
  near: number;
  far: number;
}

/**
 * Derives fog near/far distances from the configured render distance and
 * chunk width, so the world fades out near the edge of loaded chunks
 * instead of using a magic-number distance.
 */
export function computeFogRange(
  renderDistanceChunks: number = WORLD_CONFIG.renderDistance,
  chunkWidth: number = WORLD_CONFIG.chunkWidth
): FogRange {
  const viewDistance = renderDistanceChunks * chunkWidth;
  return {
    near: viewDistance * RENDER_CONFIG.fogNearChunks,
    far: viewDistance * RENDER_CONFIG.fogFarChunks,
  };
}

/**
 * Derives the camera far plane from render distance so distant chunks are
 * never clipped before they are culled/unloaded.
 */
export function computeCameraFar(
  renderDistanceChunks: number = WORLD_CONFIG.renderDistance,
  chunkWidth: number = WORLD_CONFIG.chunkWidth
): number {
  return renderDistanceChunks * chunkWidth * RENDER_CONFIG.cameraFarChunks;
}
