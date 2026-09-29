import { describe, it, expect } from 'vitest';
import { chooseBackend, computeFogRange, computeCameraFar } from '../src/renderer/backend';
import { WORLD_CONFIG, RENDER_CONFIG } from '../src/config/constants';

describe('chooseBackend', () => {
  it('prefers webgpu when an adapter is available', () => {
    expect(chooseBackend(true)).toBe('webgpu');
  });

  it('falls back to webgl2 when no adapter is available', () => {
    expect(chooseBackend(false)).toBe('webgl2');
  });
});

describe('computeFogRange', () => {
  it('derives near/far from render distance and chunk width', () => {
    const viewDistance = WORLD_CONFIG.renderDistance * WORLD_CONFIG.chunkWidth;
    const { near, far } = computeFogRange();
    expect(near).toBe(viewDistance * RENDER_CONFIG.fogNearChunks);
    expect(far).toBe(viewDistance * RENDER_CONFIG.fogFarChunks);
    expect(near).toBeLessThan(far);
  });

  it('scales with custom render distance and chunk width', () => {
    const { near, far } = computeFogRange(4, 16);
    expect(near).toBe(4 * 16 * RENDER_CONFIG.fogNearChunks);
    expect(far).toBe(4 * 16 * RENDER_CONFIG.fogFarChunks);
  });
});

describe('computeCameraFar', () => {
  it('is at least as far as the fog far distance', () => {
    const { far: fogFar } = computeFogRange();
    const cameraFar = computeCameraFar();
    expect(cameraFar).toBeGreaterThanOrEqual(fogFar);
  });
});
