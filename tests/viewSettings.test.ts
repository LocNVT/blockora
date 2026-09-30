import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MOB_CONFIG, RENDER_CONFIG, SETTINGS_CONFIG, WORLD_CONFIG } from '../src/config/constants';
import { computeCameraFar, computeFogRange } from '../src/renderer/backend';
import { applyFov, applyRenderDistanceToView } from '../src/renderer/viewSettings';
import { mobDistancesFor } from '../src/entities/mobSpawning';

describe('applyFov', () => {
  it('updates the camera FOV and projection', () => {
    const camera = new THREE.PerspectiveCamera(75, 1.5, 0.1, 100);
    const before = camera.projectionMatrix.clone();
    applyFov(camera, 100);
    expect(camera.fov).toBe(100);
    expect(camera.projectionMatrix.equals(before)).toBe(false);
  });
});

describe('applyRenderDistanceToView', () => {
  it('re-derives fog near/far and the camera far plane from the render distance', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 1, 2);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 10);

    for (const rd of [SETTINGS_CONFIG.renderDistance.min, 5, SETTINGS_CONFIG.renderDistance.max]) {
      applyRenderDistanceToView(scene, camera, rd);
      const fog = scene.fog as THREE.Fog;
      const view = rd * WORLD_CONFIG.chunkWidth;
      expect(fog.near).toBe(view * RENDER_CONFIG.fogNearChunks);
      expect(fog.far).toBe(view * RENDER_CONFIG.fogFarChunks);
      expect(camera.far).toBe(computeCameraFar(rd));
      expect(camera.far).toBeGreaterThan(fog.far);
      expect({ near: fog.near, far: fog.far }).toEqual(computeFogRange(rd));
    }
  });

  it('tolerates a scene without fog', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    expect(() => applyRenderDistanceToView(scene, camera, 4)).not.toThrow();
    expect(camera.far).toBe(computeCameraFar(4));
  });
});

describe('mobDistancesFor', () => {
  it('equals the MOB_CONFIG values at the default render distance', () => {
    expect(mobDistancesFor(WORLD_CONFIG.renderDistance)).toEqual({
      minSpawn: MOB_CONFIG.minSpawnDistance,
      maxSpawn: MOB_CONFIG.maxSpawnDistance,
      despawn: MOB_CONFIG.despawnDistance,
    });
  });

  it('stays inside the rendered radius for every selectable render distance', () => {
    const w = WORLD_CONFIG.chunkWidth;
    const { min, max } = SETTINGS_CONFIG.renderDistance;
    for (let rd = min; rd <= max; rd += 1) {
      const d = mobDistancesFor(rd);
      // Player at the far edge of its chunk, spawning at max distance along an axis.
      expect(Math.floor((w - 1e-6 + d.maxSpawn) / w)).toBeLessThanOrEqual(rd);
      expect(d.despawn).toBeLessThanOrEqual(rd * w);
      expect(d.minSpawn).toBeGreaterThanOrEqual(0);
      expect(d.minSpawn).toBeLessThan(d.maxSpawn);
      expect(d.maxSpawn).toBeLessThan(d.despawn);
    }
  });
});
