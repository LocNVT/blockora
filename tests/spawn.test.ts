import { describe, it, expect } from 'vitest';
import {
  computeSpawnPosition,
  findSpawnColumn,
  isDryColumn,
  resolveSpawnHeight,
} from '../src/player/spawn';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { ChunkStore } from '../src/world/ChunkStore';
import { blockRegistry } from '../src/world/BlockRegistry';
import { BlockId } from '../src/world/blocks';
import { PLAYER_CONFIG, WORLD_CONFIG } from '../src/config/constants';

const SEEDS = [1, 7, 42, 999, 123456];

describe('computeSpawnPosition', () => {
  it('is deterministic for a given seed', () => {
    expect(computeSpawnPosition(new WorldGenerator(42))).toEqual(
      computeSpawnPosition(new WorldGenerator(42)),
    );
  });

  // Regression: spawn was hard-coded to (0, 0), which is underwater for the default seed,
  // so a new game started on a dark seabed.
  it('spawns on a dry-land column for the default seed and several others', () => {
    for (const seed of SEEDS) {
      const gen = new WorldGenerator(seed);
      const spawn = computeSpawnPosition(gen);
      const column = { x: Math.floor(spawn.position.x), z: Math.floor(spawn.position.z) };

      expect(isDryColumn(gen, column.x, column.z)).toBe(true);
      expect(gen.surfaceHeight(column.x, column.z)).toBeGreaterThanOrEqual(WORLD_CONFIG.seaLevel);
      expect(spawn.position.y).toBeGreaterThan(gen.surfaceHeight(column.x, column.z));
      expect(spawn.pitch).toBe(PLAYER_CONFIG.spawnPitch);
    }
  });

  it('places the player at the centre of the spawn column', () => {
    const spawn = computeSpawnPosition(new WorldGenerator(1));
    expect(spawn.position.x - Math.floor(spawn.position.x)).toBeCloseTo(0.5);
    expect(spawn.position.z - Math.floor(spawn.position.z)).toBeCloseTo(0.5);
  });
});

describe('findSpawnColumn', () => {
  it('returns the origin when the origin itself is dry', () => {
    for (const seed of SEEDS) {
      const gen = new WorldGenerator(seed);
      if (isDryColumn(gen, 0, 0)) {
        expect(findSpawnColumn(gen)).toEqual({ x: 0, z: 0 });
      }
    }
  });

  it('returns a column no dry column is closer than (Chebyshev ring distance)', () => {
    const gen = new WorldGenerator(1);
    const found = findSpawnColumn(gen);
    const ring = Math.max(Math.abs(found.x), Math.abs(found.z));
    for (let dx = -(ring - 1); dx <= ring - 1; dx += 1) {
      for (let dz = -(ring - 1); dz <= ring - 1; dz += 1) {
        expect(isDryColumn(gen, dx, dz)).toBe(false);
      }
    }
  });

  it('falls back to the origin when nothing dry is within the search radius', () => {
    const gen = new WorldGenerator(1);
    if (!isDryColumn(gen, 0, 0)) {
      expect(findSpawnColumn(gen, 0)).toEqual({ x: 0, z: 0 });
    }
  });
});

describe('resolveSpawnHeight', () => {
  it('keeps the height when feet and head cells are open air', () => {
    const store = new ChunkStore();
    store.setBlock(0, 40, 0, BlockId.Grass);
    expect(resolveSpawnHeight(store, blockRegistry, { x: 0.5, y: 41, z: 0.5 })).toBe(41);
  });

  it('moves up out of a tree trunk and leaves to the first two free cells', () => {
    const store = new ChunkStore();
    store.setBlock(0, 40, 0, BlockId.Grass);
    for (let y = 41; y <= 44; y += 1) store.setBlock(0, y, 0, BlockId.Wood);
    store.setBlock(0, 45, 0, BlockId.Leaves);
    expect(resolveSpawnHeight(store, blockRegistry, { x: 0.5, y: 42, z: 0.5 })).toBe(46);
  });

  it('treats water as occupied', () => {
    const store = new ChunkStore();
    store.setBlock(0, 40, 0, BlockId.Water);
    store.setBlock(0, 41, 0, BlockId.Water);
    expect(resolveSpawnHeight(store, blockRegistry, { x: 0.5, y: 40, z: 0.5 })).toBe(42);
  });
});
