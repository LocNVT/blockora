import { describe, it, expect } from 'vitest';
import {
  StructurePlacer,
  footprintContains,
  type PlacedStructure,
  type TerrainQuery,
} from '../src/world/structure/StructurePlacer';
import { RUIN_TEMPLATE } from '../src/world/structure/templates';
import { horizontalReach, type Rotation } from '../src/world/structure/rotation';
import { BiomeId, getBiomeDefinition, type BiomeDefinition } from '../src/world/biome/Biome';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { STRUCTURE_CONFIG, WORLD_CONFIG } from '../src/config/constants';

const { chunkWidth, chunkDepth, seaLevel } = WORLD_CONFIG;
const REGION_WIDTH = STRUCTURE_CONFIG.regionSizeChunks * chunkWidth;
const REGION_DEPTH = STRUCTURE_CONFIG.regionSizeChunks * chunkDepth;
const DRY = seaLevel + STRUCTURE_CONFIG.minSurfaceAboveSeaLevel + 5;

/** Synthetic terrain: height and biome from plain functions, counting biome lookups. */
function fakeTerrain(
  height: (x: number, z: number) => number,
  biome: (x: number, z: number) => BiomeId = () => BiomeId.Plains,
): TerrainQuery & { calls: number } {
  const terrain = {
    calls: 0,
    biomeAt(x: number, z: number): BiomeDefinition {
      terrain.calls += 1;
      return getBiomeDefinition(biome(x, z));
    },
    surfaceHeight(x: number, z: number): number {
      return height(x, z);
    },
  };
  return terrain;
}

function structuresInRange(placer: StructurePlacer, range: number): (PlacedStructure | null)[] {
  const list: (PlacedStructure | null)[] = [];
  for (let rx = -range; rx < range; rx += 1) {
    for (let rz = -range; rz < range; rz += 1) {
      list.push(placer.structureInRegion(rx, rz));
    }
  }
  return list;
}

describe('StructurePlacer determinism', () => {
  it('same seed yields the same structures (fresh instances)', () => {
    const a = new StructurePlacer(1, new WorldGenerator(1));
    const b = new StructurePlacer(1, new WorldGenerator(1));
    expect(structuresInRange(a, 6)).toEqual(structuresInRange(b, 6));
  });

  it('different seeds yield different structures', () => {
    const flat = fakeTerrain(() => DRY);
    const a = new StructurePlacer(1, flat);
    const b = new StructurePlacer(2, flat);
    expect(structuresInRange(a, 6)).not.toEqual(structuresInRange(b, 6));
  });

  it('places some but not all regions (spawnChance) on ideal terrain', () => {
    const placer = new StructurePlacer(3, fakeTerrain(() => DRY));
    const placed = structuresInRange(placer, 10).filter((s) => s !== null).length;
    expect(placed).toBeGreaterThan(0);
    expect(placed).toBeLessThan(400);
  });

  it('is region-independent: query order and query box do not change a region result', () => {
    const gen = new WorldGenerator(1);
    const forward = new StructurePlacer(1, gen);
    const backward = new StructurePlacer(1, gen);
    const fwd = structuresInRange(forward, 4);
    const back: (PlacedStructure | null)[] = [];
    for (let rx = 3; rx >= -4; rx -= 1) {
      for (let rz = 3; rz >= -4; rz -= 1) {
        back.unshift(backward.structureInRegion(rx, rz));
      }
    }
    expect(back).toEqual(fwd);

    // A big box query finds exactly the per-region results.
    const box = forward.structuresIntersecting(
      -4 * REGION_WIDTH,
      -4 * REGION_DEPTH,
      4 * REGION_WIDTH - 1,
      4 * REGION_DEPTH - 1,
    );
    expect(box).toEqual(fwd.filter((s) => s !== null));
  });

  it('keeps every footprint inside its own region (structures never overlap)', () => {
    const placer = new StructurePlacer(9, fakeTerrain(() => DRY));
    for (const s of structuresInRange(placer, 8)) {
      if (!s) continue;
      expect(Math.floor(s.minX / REGION_WIDTH)).toBe(s.regionX);
      expect(Math.floor(s.maxX / REGION_WIDTH)).toBe(s.regionX);
      expect(Math.floor(s.minZ / REGION_DEPTH)).toBe(s.regionZ);
      expect(Math.floor(s.maxZ / REGION_DEPTH)).toBe(s.regionZ);
    }
  });

  it('uses all four rotations across many regions', () => {
    const placer = new StructurePlacer(4, fakeTerrain(() => DRY));
    const rotations = new Set<Rotation>();
    for (const s of structuresInRange(placer, 10)) {
      if (s) rotations.add(s.rotation);
    }
    expect(rotations.size).toBe(4);
  });
});

describe('StructurePlacer site validity', () => {
  const reach = horizontalReach(RUIN_TEMPLATE);

  it('accepts flat dry allowed-biome terrain with the floor one above the highest column', () => {
    const placer = new StructurePlacer(1, fakeTerrain(() => DRY));
    expect(placer.evaluateSite(RUIN_TEMPLATE, 10, 10, 0)).toEqual({ ok: true, floorY: DRY + 1 });
  });

  it('rejects a site where any footprint column is at or near water', () => {
    const wet = fakeTerrain((x, z) => (x === 10 + reach && z === 10 ? seaLevel - 3 : DRY));
    const placer = new StructurePlacer(1, wet);
    expect(placer.evaluateSite(RUIN_TEMPLATE, 10, 10, 0)).toEqual({ ok: false, reason: 'water' });

    const beach = fakeTerrain(() => seaLevel + STRUCTURE_CONFIG.minSurfaceAboveSeaLevel - 1);
    expect(new StructurePlacer(1, beach).evaluateSite(RUIN_TEMPLATE, 10, 10, 0)).toEqual({
      ok: false,
      reason: 'water',
    });
  });

  it('rejects steep sites but accepts a height range of exactly maxSlope', () => {
    const { maxSlope } = STRUCTURE_CONFIG;
    const edge = fakeTerrain((x) => (x === 10 + reach ? DRY + maxSlope : DRY));
    expect(new StructurePlacer(1, edge).evaluateSite(RUIN_TEMPLATE, 10, 10, 0)).toEqual({
      ok: true,
      floorY: DRY + maxSlope + 1,
    });
    const steep = fakeTerrain((x) => (x === 10 + reach ? DRY + maxSlope + 1 : DRY));
    expect(new StructurePlacer(1, steep).evaluateSite(RUIN_TEMPLATE, 10, 10, 0)).toEqual({
      ok: false,
      reason: 'slope',
    });
  });

  it('rejects a site touching a disallowed biome', () => {
    for (const biomeId of [BiomeId.Mountains, BiomeId.Swamp, BiomeId.Taiga]) {
      const terrain = fakeTerrain(
        () => DRY,
        (x, z) => (x === 10 - reach && z === 10 + reach ? biomeId : BiomeId.Forest),
      );
      expect(new StructurePlacer(1, terrain).evaluateSite(RUIN_TEMPLATE, 10, 10, 1)).toEqual({
        ok: false,
        reason: 'biome',
      });
    }
  });

  it('only ever places structures whose whole footprint passes the checks (real terrain)', () => {
    const gen = new WorldGenerator(1);
    const placer = new StructurePlacer(1, gen);
    let checked = 0;
    for (const s of structuresInRange(placer, 5)) {
      if (!s) continue;
      checked += 1;
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = s.minX; x <= s.maxX; x += 1) {
        for (let z = s.minZ; z <= s.maxZ; z += 1) {
          expect(s.template.allowedBiomes).toContain(gen.biomeAt(x, z).id);
          const h = gen.surfaceHeight(x, z);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      expect(lo).toBeGreaterThanOrEqual(seaLevel + STRUCTURE_CONFIG.minSurfaceAboveSeaLevel);
      expect(hi - lo).toBeLessThanOrEqual(STRUCTURE_CONFIG.maxSlope);
      expect(s.originY).toBe(hi + 1);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('StructurePlacer lookup cost', () => {
  it('a chunk-sized query evaluates at most the 4 regions it can overlap', () => {
    const terrain = fakeTerrain(() => DRY);
    const placer = new StructurePlacer(1, terrain);
    const footprintColumns = RUIN_TEMPLATE.size.width * RUIN_TEMPLATE.size.depth;
    // Straddle a region corner so the box overlaps 4 regions.
    const minX = REGION_WIDTH - 8;
    const minZ = REGION_DEPTH - 8;
    placer.structuresIntersecting(minX, minZ, minX + chunkWidth - 1, minZ + chunkDepth - 1);
    expect(terrain.calls).toBeLessThanOrEqual(4 * footprintColumns);
  });
});

describe('footprintContains', () => {
  it('respects the margin on every side', () => {
    const s = new StructurePlacer(1, fakeTerrain(() => DRY));
    let placed: PlacedStructure | null = null;
    for (let rx = 0; rx < 20 && !placed; rx += 1) placed = s.structureInRegion(rx, 0);
    expect(placed).not.toBeNull();
    const p = placed!;
    expect(footprintContains(p, p.minX, p.minZ)).toBe(true);
    expect(footprintContains(p, p.minX - 1, p.minZ)).toBe(false);
    expect(footprintContains(p, p.minX - 2, p.maxZ + 2, 2)).toBe(true);
    expect(footprintContains(p, p.maxX + 3, p.minZ, 2)).toBe(false);
  });
});
