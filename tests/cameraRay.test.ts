import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eyePosition, lookDirection } from '../src/player/cameraRay';
import { createPlayerState } from '../src/player/PlayerState';
import { PLAYER_CONFIG } from '../src/config/constants';

describe('eyePosition', () => {
  it('adds eyeHeight to feet position while standing', () => {
    const state = createPlayerState({ x: 1, y: 2, z: 3 });
    const eye = eyePosition(state);
    expect(eye.x).toBe(1);
    expect(eye.y).toBeCloseTo(2 + PLAYER_CONFIG.eyeHeight, 6);
    expect(eye.z).toBe(3);
  });

  it('uses crouchEyeHeight while crouching', () => {
    const state = createPlayerState({ x: 0, y: 0, z: 0 });
    state.crouching = true;
    const eye = eyePosition(state);
    expect(eye.y).toBeCloseTo(PLAYER_CONFIG.crouchEyeHeight, 6);
  });

  it('writes into a reused `out` object without allocating a new one', () => {
    const state = createPlayerState({ x: 5, y: 5, z: 5 });
    const out = { x: 0, y: 0, z: 0 };
    const result = eyePosition(state, PLAYER_CONFIG, out);
    expect(result).toBe(out);
  });
});

describe('lookDirection matches THREE camera.getWorldDirection', () => {
  const cases: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [Math.PI / 4, 0.3],
    [-1.2, -0.5],
    [2.5, 0.7],
    [0, -0.5],
    [Math.PI, 0],
    [-Math.PI / 2, 0.4],
  ];

  for (const [yaw, pitch] of cases) {
    it(`yaw=${yaw.toFixed(3)} pitch=${pitch.toFixed(3)}`, () => {
      const camera = new THREE.PerspectiveCamera();
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
      const expected = new THREE.Vector3();
      camera.getWorldDirection(expected);

      const dir = lookDirection(yaw, pitch);
      expect(dir.x).toBeCloseTo(expected.x, 6);
      expect(dir.y).toBeCloseTo(expected.y, 6);
      expect(dir.z).toBeCloseTo(expected.z, 6);
    });
  }

  it('writes into a reused `out` object without allocating a new one', () => {
    const out = { x: 0, y: 0, z: 0 };
    const result = lookDirection(0.1, 0.2, out);
    expect(result).toBe(out);
  });

  it('yaw 0 / pitch 0 looks down -Z', () => {
    const dir = lookDirection(0, 0);
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.y).toBeCloseTo(0, 6);
    expect(dir.z).toBeCloseTo(-1, 6);
  });

  it('positive pitch looks up (+Y)', () => {
    const dir = lookDirection(0, 0.5);
    expect(dir.y).toBeGreaterThan(0);
  });
});
