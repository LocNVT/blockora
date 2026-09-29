import { describe, it, expect } from 'vitest';
import {
  valueNoise2D,
  fractalNoise2D,
  valueNoise3D,
  fractalNoise3D,
  latticeHash2D,
} from '../src/world/noise/valueNoise2D';

describe('valueNoise2D determinism', () => {
  it('returns the same value for the same seed and coordinates', () => {
    const a = valueNoise2D(42, 3.25, -7.5);
    const b = valueNoise2D(42, 3.25, -7.5);
    expect(a).toBe(b);
  });

  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 50; i += 1) {
      const v = valueNoise2D(1, i * 1.37, -i * 2.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs across seeds for the same coordinate (not a coincidence of the hash)', () => {
    const a = valueNoise2D(1, 10, 10);
    const b = valueNoise2D(2, 10, 10);
    expect(a).not.toBe(b);
  });

  it('is continuous across a chunk boundary (no seam between adjacent lattice cells)', () => {
    const seed = 7;
    // Sampling just below and just above an integer boundary should stay
    // close in value; a broken interpolation would show a large jump here.
    const justBelow = valueNoise2D(seed, 4.999, 5);
    const atBoundary = valueNoise2D(seed, 5, 5);
    const justAbove = valueNoise2D(seed, 5.001, 5);
    expect(Math.abs(atBoundary - justBelow)).toBeLessThan(0.01);
    expect(Math.abs(justAbove - atBoundary)).toBeLessThan(0.01);
  });
});

describe('fractalNoise2D', () => {
  const config = { octaves: 4, frequency: 0.05, amplitude: 1, lacunarity: 2, persistence: 0.5 };

  it('is deterministic for the same seed and coordinates', () => {
    const a = fractalNoise2D(9, 12.5, -3.25, config);
    const b = fractalNoise2D(9, 12.5, -3.25, config);
    expect(a).toBe(b);
  });

  it('stays within [0, 1) across many samples', () => {
    for (let i = 0; i < 100; i += 1) {
      const v = fractalNoise2D(5, i * 0.9, -i * 1.3, config);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('latticeHash2D', () => {
  it('is deterministic for the same seed and coordinates', () => {
    expect(latticeHash2D(3, 5, -9)).toBe(latticeHash2D(3, 5, -9));
  });

  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 50; i += 1) {
      const v = latticeHash2D(1, i, -i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is not smoothly interpolated: adjacent integers can differ sharply (unlike valueNoise2D)', () => {
    // Not a universal guarantee for every seed/coordinate, but true for enough
    // samples that a smoothly-interpolated implementation would fail this.
    let sawLargeJump = false;
    for (let x = 0; x < 200; x += 1) {
      const a = latticeHash2D(1, x, 0);
      const b = latticeHash2D(1, x + 1, 0);
      if (Math.abs(a - b) > 0.3) {
        sawLargeJump = true;
        break;
      }
    }
    expect(sawLargeJump).toBe(true);
  });
});

describe('valueNoise3D determinism', () => {
  it('returns the same value for the same seed and coordinates', () => {
    const a = valueNoise3D(42, 3.25, -7.5, 12.1);
    const b = valueNoise3D(42, 3.25, -7.5, 12.1);
    expect(a).toBe(b);
  });

  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 50; i += 1) {
      const v = valueNoise3D(1, i * 1.37, -i * 2.11, i * 0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs across seeds for the same coordinate', () => {
    const a = valueNoise3D(1, 10, 10, 10);
    const b = valueNoise3D(2, 10, 10, 10);
    expect(a).not.toBe(b);
  });

  it('is continuous across a lattice boundary on the Y axis (no seam)', () => {
    const seed = 7;
    const justBelow = valueNoise3D(seed, 4, 4.999, 4);
    const atBoundary = valueNoise3D(seed, 4, 5, 4);
    const justAbove = valueNoise3D(seed, 4, 5.001, 4);
    expect(Math.abs(atBoundary - justBelow)).toBeLessThan(0.01);
    expect(Math.abs(justAbove - atBoundary)).toBeLessThan(0.01);
  });

  it('varies with Y for fixed X/Z (a 2D-only noise reused across Y would be constant)', () => {
    const seed = 3;
    const values = new Set<number>();
    for (let y = 0; y < 20; y += 1) {
      values.add(Math.round(valueNoise3D(seed, 1, y, 1) * 1000));
    }
    expect(values.size).toBeGreaterThan(1);
  });
});

describe('fractalNoise3D', () => {
  const config = { octaves: 3, frequency: 0.1, amplitude: 1, lacunarity: 2, persistence: 0.5 };

  it('is deterministic for the same seed and coordinates', () => {
    const a = fractalNoise3D(9, 12.5, -3.25, 6.5, config);
    const b = fractalNoise3D(9, 12.5, -3.25, 6.5, config);
    expect(a).toBe(b);
  });

  it('stays within [0, 1) across many samples', () => {
    for (let i = 0; i < 100; i += 1) {
      const v = fractalNoise3D(5, i * 0.9, -i * 1.3, i * 0.7, config);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
