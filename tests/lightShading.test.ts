import { describe, it, expect } from 'vitest';
import { LIGHT_RENDER_CONFIG } from '../src/config/constants';
import {
  clampDaylight,
  effectiveLightLevel,
  faceShade,
  lightCurve,
  skyScale,
} from '../src/renderer/lightShading';

describe('lightCurve', () => {
  it('floors at minBrightness for level 0 and reaches exactly 1 at level 15', () => {
    expect(lightCurve(0)).toBeCloseTo(LIGHT_RENDER_CONFIG.minBrightness, 10);
    expect(lightCurve(0)).toBeGreaterThan(0);
    expect(lightCurve(15)).toBe(1);
  });

  it('is strictly monotonic over 0..15 and clamps outside that range', () => {
    for (let level = 1; level <= 15; level += 1) {
      expect(lightCurve(level)).toBeGreaterThan(lightCurve(level - 1));
    }
    expect(lightCurve(-3)).toBe(lightCurve(0));
    expect(lightCurve(20)).toBe(1);
  });
});

describe('faceShade', () => {
  it('maps top/sides/bottom normals to the configured shades', () => {
    expect(faceShade(0, 1)).toBe(LIGHT_RENDER_CONFIG.faceShadeTop);
    expect(faceShade(0, -1)).toBe(LIGHT_RENDER_CONFIG.faceShadeBottom);
    expect(faceShade(1, 0)).toBe(LIGHT_RENDER_CONFIG.faceShadeSideX);
    expect(faceShade(-1, 0)).toBe(LIGHT_RENDER_CONFIG.faceShadeSideX);
    expect(faceShade(0, 0)).toBe(LIGHT_RENDER_CONFIG.faceShadeSideZ);
  });

  it('keeps top brightest and bottom darkest', () => {
    const shades = [faceShade(0, 1), faceShade(1, 0), faceShade(0, 0), faceShade(0, -1)];
    expect(Math.max(...shades)).toBe(faceShade(0, 1));
    expect(Math.min(...shades)).toBe(faceShade(0, -1));
  });
});

describe('daylight scaling', () => {
  it('clamps daylight to [0, 1]', () => {
    expect(clampDaylight(-1)).toBe(0);
    expect(clampDaylight(2)).toBe(1);
    expect(clampDaylight(0.4)).toBe(0.4);
    expect(clampDaylight(Number.NaN)).toBe(0);
  });

  it('scales sky light from nightSkyScale to 1; block light is unaffected', () => {
    expect(skyScale(0)).toBeCloseTo(LIGHT_RENDER_CONFIG.nightSkyScale, 10);
    expect(skyScale(1)).toBe(1);
    expect(effectiveLightLevel(15, 0, 1)).toBe(15);
    expect(effectiveLightLevel(15, 0, 0)).toBeCloseTo(15 * LIGHT_RENDER_CONFIG.nightSkyScale, 10);
    expect(effectiveLightLevel(15, 14, 0)).toBe(14);
    expect(effectiveLightLevel(0, 7, 1)).toBe(7);
  });
});
