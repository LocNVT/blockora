import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GRAPHICS_CONFIG, SETTINGS_CONFIG } from '../src/config/constants';
import { DEFAULT_SETTINGS, clampSettings, validateSettings } from '../src/settings/GameSettings';
import { loadSettings, type SettingsStorage } from '../src/settings/settingsStorage';
import { computePixelRatio } from '../src/renderer/resolution';
import { FrameLimiter } from '../src/renderer/frameLimiter';
import { setFogEnabled } from '../src/renderer/viewSettings';
import { createScene } from '../src/renderer/scene';
import { DayNightLighting } from '../src/renderer/DayNightLighting';
import { computeFogRange } from '../src/renderer/backend';
import { formatDebugLines, type DebugSnapshot } from '../src/debug/debugText';
import { PerfStats } from '../src/debug/PerfStats';

describe('graphics settings model', () => {
  it('defaults: full resolution, fog on, unlimited frame rate', () => {
    expect(DEFAULT_SETTINGS.resolutionScale).toBe(100);
    expect(DEFAULT_SETTINGS.fogEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.frameRateCap).toBe(0);
    expect(clampSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('an old record without the new fields loads their defaults and keeps its own values', () => {
    const storage: SettingsStorage = {
      getItem: () =>
        JSON.stringify({ fov: 90, mouseSensitivity: 1.5, renderDistance: 6, showFpsCounter: true, masterVolume: 30 }),
      setItem: () => undefined,
    };
    expect(loadSettings(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      fov: 90,
      mouseSensitivity: 1.5,
      renderDistance: 6,
      showFpsCounter: true,
      masterVolume: 30,
    });
  });

  it('resolution scale is clamped and rounded; bad types fall back', () => {
    expect(validateSettings({ resolutionScale: 10 }).resolutionScale).toBe(SETTINGS_CONFIG.resolutionScale.min);
    expect(validateSettings({ resolutionScale: 400 }).resolutionScale).toBe(SETTINGS_CONFIG.resolutionScale.max);
    expect(validateSettings({ resolutionScale: 74.6 }).resolutionScale).toBe(75);
    expect(validateSettings({ resolutionScale: '50' }).resolutionScale).toBe(100);
    expect(validateSettings({ resolutionScale: NaN }).resolutionScale).toBe(100);
    expect(clampSettings({ ...DEFAULT_SETTINGS, resolutionScale: 1 }).resolutionScale).toBe(
      SETTINGS_CONFIG.resolutionScale.min,
    );
  });

  it('frame cap must be a listed option, otherwise the default (unlimited)', () => {
    for (const cap of SETTINGS_CONFIG.frameRateCaps) {
      expect(validateSettings({ frameRateCap: cap }).frameRateCap).toBe(cap);
    }
    for (const bad of [45, -30, 144, '60', null, NaN, true]) {
      expect(validateSettings({ frameRateCap: bad }).frameRateCap).toBe(0);
    }
    expect(clampSettings({ ...DEFAULT_SETTINGS, frameRateCap: 45 }).frameRateCap).toBe(0);
  });

  it('fogEnabled keeps booleans and rejects other types', () => {
    expect(validateSettings({ fogEnabled: false }).fogEnabled).toBe(false);
    expect(validateSettings({ fogEnabled: 0 }).fogEnabled).toBe(true);
    expect(validateSettings({}).fogEnabled).toBe(true);
  });
});

describe('computePixelRatio', () => {
  it('scales the device ratio capped at maxPixelRatio', () => {
    expect(computePixelRatio(100, 1)).toBe(1);
    expect(computePixelRatio(50, 1)).toBe(0.5);
    expect(computePixelRatio(100, 2)).toBe(2);
    expect(computePixelRatio(75, 2)).toBe(1.5);
    expect(computePixelRatio(100, 3)).toBe(GRAPHICS_CONFIG.maxPixelRatio);
    expect(computePixelRatio(50, 3)).toBe(1);
  });

  it('stays within bounds and survives bad inputs', () => {
    expect(computePixelRatio(0, 1)).toBe(GRAPHICS_CONFIG.minPixelRatio);
    expect(computePixelRatio(1000, 4)).toBe(GRAPHICS_CONFIG.maxPixelRatio);
    expect(computePixelRatio(100, NaN)).toBe(1);
    expect(computePixelRatio(100, 0)).toBe(1);
    expect(computePixelRatio(NaN, 2)).toBe(2);
  });

  it('every selectable scale gives a ratio inside the bounds', () => {
    const { min, max, step } = SETTINGS_CONFIG.resolutionScale;
    for (let pct = min; pct <= max; pct += step) {
      for (const dpr of [1, 1.25, 1.5, 2, 3]) {
        const r = computePixelRatio(pct, dpr);
        expect(r).toBeGreaterThanOrEqual(GRAPHICS_CONFIG.minPixelRatio);
        expect(r).toBeLessThanOrEqual(GRAPHICS_CONFIG.maxPixelRatio);
      }
    }
  });
});

/** Feeds `frames` callbacks `periodS` apart; returns the per-callback steps. */
function run(limiter: FrameLimiter, cap: number, frames: number, periodS: number) {
  return Array.from({ length: frames }, () => limiter.step(periodS, cap));
}

describe('FrameLimiter', () => {
  it('unlimited renders every callback with its own delta', () => {
    const limiter = new FrameLimiter();
    for (const dt of [0.001, 0.016, 0.5]) {
      expect(limiter.step(dt, 0)).toEqual({ render: true, dt });
    }
  });

  it('60 fps cap on a 60 Hz display renders every frame despite jitter', () => {
    const limiter = new FrameLimiter();
    const steps = [0.0165, 0.0168, 0.0166, 0.0167, 0.0164, 0.017].map((d) => limiter.step(d, 60));
    expect(steps.every((s) => s.render)).toBe(true);
  });

  it('30 fps cap on a 60 Hz display renders every second frame with dt of two frames', () => {
    const limiter = new FrameLimiter();
    const rendered = run(limiter, 30, 20, 1 / 60).filter((s) => s.render);
    expect(rendered.length).toBe(10);
    for (const s of rendered) {
      expect(s.dt).toBeCloseTo(2 / 60, 9);
    }
  });

  it('dt of rendered frames plus the pending remainder equals the real elapsed time', () => {
    const limiter = new FrameLimiter();
    const steps = run(limiter, 30, 240, 1 / 240);
    const total = steps.reduce((sum, s) => sum + s.dt, 0);
    const trailing = 240 - steps.map((s) => s.render).lastIndexOf(true) - 1;
    expect(total + trailing / 240).toBeCloseTo(1, 9);
    for (const s of steps) {
      expect(s.render || s.dt === 0).toBe(true);
    }
  });

  it('long-run rate equals the cap even when the refresh rate is not a multiple (144 Hz, cap 60)', () => {
    const limiter = new FrameLimiter();
    const seconds = 20;
    const rendered = run(limiter, 60, 144 * seconds, 1 / 144).filter((s) => s.render).length;
    expect(rendered / seconds).toBeGreaterThan(59);
    expect(rendered / seconds).toBeLessThan(61);
  });

  it('a long pause renders one frame carrying the whole gap, with no catch-up burst', () => {
    const limiter = new FrameLimiter();
    run(limiter, 30, 10, 1 / 60);
    const gap = limiter.step(10, 30);
    expect(gap.render).toBe(true);
    expect(gap.dt).toBeGreaterThan(9.9);
    const flags = run(limiter, 30, 6, 1 / 60).map((s) => s.render);
    for (let i = 1; i < flags.length; i++) {
      expect(flags[i] === true && flags[i - 1] === true).toBe(false);
    }
    expect(flags.filter(Boolean).length).toBeLessThanOrEqual(3);
  });

  it('switching the cap at runtime takes effect immediately and keeps dt whole', () => {
    const limiter = new FrameLimiter();
    expect(limiter.step(1 / 60, 30).render).toBe(false);
    const s = limiter.step(1 / 60, 0);
    expect(s.render).toBe(true);
    expect(s.dt).toBeCloseTo(2 / 60, 9);
  });

  it('ignores non-finite / negative deltas', () => {
    const limiter = new FrameLimiter();
    expect(limiter.step(NaN, 30)).toEqual({ render: false, dt: 0 });
    expect(limiter.step(-1, 0)).toEqual({ render: true, dt: 0 });
  });
});

describe('fog toggle', () => {
  it('off removes scene.fog and day/night keeps it removed; on restores the same instance with a current range', () => {
    const sceneWithLights = createScene();
    const { scene, fog } = sceneWithLights;
    const lighting = new DayNightLighting(sceneWithLights);
    expect(scene.fog).toBe(fog);

    setFogEnabled(scene, fog, false, 8);
    expect(scene.fog).toBeNull();
    const colorBefore = fog.color.getHex();
    for (const t of [0, 0.25, 0.5, 0.75, 0.9]) {
      lighting.apply(t);
      expect(scene.fog).toBeNull();
    }
    expect(fog.color.getHex()).toBe(colorBefore);

    setFogEnabled(scene, fog, true, 4);
    expect(scene.fog).toBe(fog);
    expect({ near: fog.near, far: fog.far }).toEqual(computeFogRange(4));
    lighting.apply(0.5);
    expect(fog.color.getHex()).toBe((scene.background as THREE.Color).getHex());
  });
});

describe('debug overlay resolution line', () => {
  const snapshot = (resolution?: DebugSnapshot['resolution']): DebugSnapshot => ({
    backend: 'webgl2',
    perf: new PerfStats().snapshot(),
    renderer: { drawCalls: 0, triangles: 0, geometries: 0, textures: 0 },
    jsHeapMb: null,
    chunksLoaded: 0,
    mobCount: 0,
    position: { x: 0, y: 0, z: 0 },
    chunk: { cx: 0, cz: 0 },
    renderDistance: 8,
    ...(resolution === undefined ? {} : { resolution }),
  });

  it('shows the internal resolution when provided and omits it otherwise', () => {
    const line = formatDebugLines(snapshot({ width: 1600, height: 1000, pixelRatio: 2, scalePercent: 100 })).find((l) =>
      l.startsWith('Resolution'),
    );
    expect(line).toBe('Resolution 1,600x1,000  ratio 2.00 (100%)');
    expect(formatDebugLines(snapshot()).some((l) => l.startsWith('Resolution'))).toBe(false);
  });
});
