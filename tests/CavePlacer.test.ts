import { describe, it, expect } from 'vitest';
import { CavePlacer } from '../src/world/cave/CavePlacer';
import { WORLD_GEN_CONFIG } from '../src/config/constants';

describe('CavePlacer.isCaveAt', () => {
  const surfaceY = 60;

  it('is deterministic: same seed + position + surface always agrees', () => {
    const a = new CavePlacer(21);
    const b = new CavePlacer(21);

    for (let x = -30; x <= 30; x += 4) {
      for (let y = 0; y <= surfaceY; y += 4) {
        for (let z = -30; z <= 30; z += 4) {
          expect(a.isCaveAt(x, y, z, surfaceY)).toBe(b.isCaveAt(x, y, z, surfaceY));
        }
      }
    }
  });

  it('never carves within caveSurfaceMargin blocks of the surface', () => {
    const placer = new CavePlacer(21);
    const { caveSurfaceMargin } = WORLD_GEN_CONFIG;

    for (let x = -30; x <= 30; x += 2) {
      for (let z = -30; z <= 30; z += 2) {
        for (let y = surfaceY - caveSurfaceMargin + 1; y <= surfaceY; y += 1) {
          expect(placer.isCaveAt(x, y, z, surfaceY)).toBe(false);
        }
      }
    }
  });

  it('carves at least one cave block somewhere in the eligible deep zone (nonzero cave presence)', () => {
    const placer = new CavePlacer(21);
    const { caveSurfaceMargin } = WORLD_GEN_CONFIG;
    let found = false;

    for (let x = -60; x <= 60 && !found; x += 1) {
      for (let y = 0; y <= surfaceY - caveSurfaceMargin && !found; y += 1) {
        for (let z = -60; z <= 60 && !found; z += 1) {
          if (placer.isCaveAt(x, y, z, surfaceY)) {
            found = true;
          }
        }
      }
    }

    expect(found).toBe(true);
  });

  it('returns false far more often than true across the eligible zone (caves are sparse, not majority-air)', () => {
    const placer = new CavePlacer(21);
    const { caveSurfaceMargin } = WORLD_GEN_CONFIG;
    let caveCount = 0;
    let total = 0;

    for (let x = -40; x <= 40; x += 1) {
      for (let y = 0; y <= surfaceY - caveSurfaceMargin; y += 3) {
        for (let z = -40; z <= 40; z += 3) {
          total += 1;
          if (placer.isCaveAt(x, y, z, surfaceY)) {
            caveCount += 1;
          }
        }
      }
    }

    expect(caveCount).toBeLessThan(total * 0.5);
  });
});
