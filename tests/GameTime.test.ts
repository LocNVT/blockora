import { describe, it, expect } from 'vitest';
import { GameTime, dayFraction, daylightFactor, sunAngle, skyColor } from '../src/world/GameTime';
import { DAY_NIGHT_CONFIG } from '../src/config/constants';

// 15 min day / 5 min night, matching CLAUDE.md.
const config = DAY_NIGHT_CONFIG;
const DAY = dayFraction(config); // 0.75

describe('GameTime.advance', () => {
  it('advances elapsedSeconds and timeOfDay deterministically', () => {
    const t = new GameTime(config);
    t.setTimeOfDay(0);
    t.advance(100);
    expect(t.elapsedSeconds).toBe(100);
    expect(t.timeOfDay).toBeCloseTo(100 / 1200, 10);
  });

  it('clamps negative dt to 0 (no-op)', () => {
    const t = new GameTime(config);
    t.setTimeOfDay(0.2);
    const before = t.elapsedSeconds;
    t.advance(-50);
    expect(t.elapsedSeconds).toBe(before);
  });

  it('accumulates multiple advances identically to one large advance (determinism)', () => {
    const a = new GameTime(config);
    const b = new GameTime(config);
    a.setTimeOfDay(0);
    b.setTimeOfDay(0);
    for (let i = 0; i < 10; i++) a.advance(37.3);
    b.advance(373);
    expect(a.elapsedSeconds).toBeCloseTo(b.elapsedSeconds, 8);
    expect(a.timeOfDay).toBeCloseTo(b.timeOfDay, 8);
  });
});

describe('GameTime wrap and dayCount', () => {
  it('wraps timeOfDay into [0, 1) after a full cycle', () => {
    const t = new GameTime(config);
    t.setTimeOfDay(0);
    t.advance(1200 + 300); // one full cycle + 300s into the next
    expect(t.timeOfDay).toBeCloseTo(300 / 1200, 10);
  });

  it('increments dayCount exactly once per full cycle', () => {
    const t = new GameTime(config);
    t.setTimeOfDay(0);
    expect(t.dayCount).toBe(0);
    t.advance(1199);
    expect(t.dayCount).toBe(0);
    t.advance(2); // crosses 1200s total
    expect(t.dayCount).toBe(1);
    t.advance(1200);
    expect(t.dayCount).toBe(2);
  });

  it('isDay is true through the day segment and false through the night segment, with 15/5 split', () => {
    const t = new GameTime(config);
    t.setTimeOfDay(0);
    expect(t.isDay).toBe(true);
    t.setTimeOfDay(DAY - 0.001);
    expect(t.isDay).toBe(true);
    t.setTimeOfDay(DAY);
    expect(t.isDay).toBe(false);
    t.setTimeOfDay(DAY + 0.001);
    expect(t.isDay).toBe(false);
    t.setTimeOfDay(0.999);
    expect(t.isDay).toBe(false);
  });
});

describe('GameTime.setTimeOfDay', () => {
  it('sets timeOfDay directly and preserves dayCount progress', () => {
    const t = new GameTime(config);
    t.setTimeOfDay(0.5);
    expect(t.timeOfDay).toBeCloseTo(0.5, 10);
    expect(t.dayCount).toBe(0);
  });

  it('wraps out-of-range values into [0, 1)', () => {
    const t = new GameTime(config);
    t.setTimeOfDay(1.25);
    expect(t.timeOfDay).toBeCloseTo(0.25, 10);
    t.setTimeOfDay(-0.25);
    expect(t.timeOfDay).toBeCloseTo(0.75, 10);
  });

  it('starts at config.startTimeOfDay by default', () => {
    const t = new GameTime(config);
    expect(t.timeOfDay).toBeCloseTo(config.startTimeOfDay, 10);
  });
});

describe('daylightFactor', () => {
  it('is 1 at midday', () => {
    expect(daylightFactor(DAY / 2, config)).toBeCloseTo(1, 6);
  });

  it('is at its minimum at midnight', () => {
    const midnight = DAY + (1 - DAY) / 2;
    expect(daylightFactor(midnight, config)).toBeCloseTo(0, 6);
  });

  it('is monotonically non-decreasing through the dawn transition', () => {
    const w = config.transitionWidth;
    let prev = daylightFactor((1 - w + 1e-6) % 1, config);
    const samples = 20;
    for (let i = 1; i <= samples; i++) {
      const t = (-w + (2 * w * i) / samples + 1) % 1;
      const value = daylightFactor(t, config);
      expect(value).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = value;
    }
  });

  it('is continuous across the day/night boundary (dusk) and the wrap (dawn)', () => {
    const eps = 1e-5;
    // Dusk boundary at t = DAY.
    const beforeDusk = daylightFactor(DAY - eps, config);
    const afterDusk = daylightFactor(DAY + eps, config);
    expect(Math.abs(beforeDusk - afterDusk)).toBeLessThan(1e-3);

    // Wrap boundary at t = 0 / t = 1.
    const beforeWrap = daylightFactor(1 - eps, config);
    const afterWrap = daylightFactor(eps, config);
    expect(Math.abs(beforeWrap - afterWrap)).toBeLessThan(1e-3);
  });
});

describe('sunAngle', () => {
  it('is above the horizon (sin >= 0) throughout the day segment', () => {
    for (let i = 0; i <= 20; i++) {
      const t = (DAY * i) / 20;
      expect(Math.sin(sunAngle(t, config))).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('is below the horizon (sin <= 0) throughout the night segment', () => {
    for (let i = 0; i <= 20; i++) {
      const t = DAY + ((1 - DAY) * i) / 20;
      expect(Math.sin(sunAngle(t % 1, config))).toBeLessThanOrEqual(1e-9);
    }
  });

  it('is continuous at the sunrise (t=0), sunset (t=DAY), and wrap boundaries', () => {
    const eps = 1e-6;
    // At the sunrise/sunset boundaries sin(angle) should be ~0 on both sides.
    expect(Math.sin(sunAngle(eps, config))).toBeCloseTo(0, 3);
    expect(Math.sin(sunAngle(1 - eps, config))).toBeCloseTo(0, 3);
    expect(Math.sin(sunAngle(DAY - eps, config))).toBeCloseTo(0, 3);
    expect(Math.sin(sunAngle(DAY + eps, config))).toBeCloseTo(0, 3);
  });
});

describe('skyColor', () => {
  it('equals the day color at midday', () => {
    const rgb = skyColor(DAY / 2, config);
    const expected = hexToRgb(config.daySkyColor);
    expect(rgb.r).toBeCloseTo(expected.r, 3);
    expect(rgb.g).toBeCloseTo(expected.g, 3);
    expect(rgb.b).toBeCloseTo(expected.b, 3);
  });

  it('equals the night color at midnight', () => {
    const midnight = DAY + (1 - DAY) / 2;
    const rgb = skyColor(midnight, config);
    const expected = hexToRgb(config.nightSkyColor);
    expect(rgb.r).toBeCloseTo(expected.r, 3);
    expect(rgb.g).toBeCloseTo(expected.g, 3);
    expect(rgb.b).toBeCloseTo(expected.b, 3);
  });

  it('is deterministic for the same input', () => {
    const a = skyColor(0.3, config);
    const b = skyColor(0.3, config);
    expect(a).toEqual(b);
  });
});

function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  };
}
