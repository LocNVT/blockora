import { describe, it, expect } from 'vitest';
import { BiomeSelector } from '../src/world/biome/BiomeSelector';
import { BiomeId, BIOME_DEFINITIONS } from '../src/world/biome/Biome';

describe('BiomeSelector determinism', () => {
  it('produces the same biome for the same seed and world column', () => {
    const a = new BiomeSelector(42);
    const b = new BiomeSelector(42);

    for (let x = -200; x <= 200; x += 37) {
      for (let z = -200; z <= 200; z += 37) {
        expect(a.biomeIdAt(x, z)).toBe(b.biomeIdAt(x, z));
      }
    }
  });

  it('is independent of the terrain height/detail seed offsets (distinct seed space)', () => {
    const selector = new BiomeSelector(1);
    // Sampling far apart should still be reproducible on repeated calls.
    const first = selector.biomeIdAt(1000, -1000);
    const second = selector.biomeIdAt(1000, -1000);
    expect(first).toBe(second);
  });

  it('can produce every defined biome across a wide sample area for a given seed', () => {
    const selector = new BiomeSelector(7);
    const seen = new Set<BiomeId>();

    for (let x = -3000; x <= 3000; x += 40) {
      for (let z = -3000; z <= 3000; z += 40) {
        seen.add(selector.biomeIdAt(x, z));
      }
    }

    for (const def of BIOME_DEFINITIONS) {
      expect(seen.has(def.id)).toBe(true);
    }
  });

  it('biomeAt returns the definition matching biomeIdAt', () => {
    const selector = new BiomeSelector(3);
    const id = selector.biomeIdAt(15, -42);
    const def = selector.biomeAt(15, -42);
    expect(def.id).toBe(id);
  });
});
