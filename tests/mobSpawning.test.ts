import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG, MOB_CONFIG } from '../src/config/constants';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import { localIndex } from '../src/world/chunkCoords';
import { LightEngine } from '../src/world/light';
import { EntityStore } from '../src/entities/EntityStore';
import { MobType } from '../src/entities/mobDefinitions';
import {
  isValidSpawnColumn,
  attemptSpawns,
  despawnFarMobs,
  mulberry32,
} from '../src/entities/mobSpawning';

const { chunkWidth: W, chunkDepth: D } = WORLD_CONFIG;

/** Builds a flat grass-topped world: stone up to `groundY - 1`, grass at `groundY`, air above. */
function buildFlatGrassWorld(groundY: number, coords: readonly { cx: number; cz: number }[]): {
  store: ChunkStore;
  light: LightEngine;
} {
  const store = new ChunkStore();
  const light = new LightEngine(store, blockRegistry);

  for (const { cx, cz } of coords) {
    const chunk = new Chunk(cx, cz);
    for (let x = 0; x < W; x += 1) {
      for (let z = 0; z < D; z += 1) {
        for (let y = 0; y < groundY; y += 1) {
          chunk.blocks[localIndex(x, y, z)] = BlockId.Stone;
        }
        chunk.blocks[localIndex(x, groundY, z)] = BlockId.Grass;
      }
    }
    store.setChunk(chunk);
    light.lightChunk(cx, cz);
  }

  return { store, light };
}

/** All chunk coords within `radius` (inclusive) of (0,0), used so a wide spawn ring has ground. */
function chunkGrid(radius: number): { cx: number; cz: number }[] {
  const coords: { cx: number; cz: number }[] = [];
  for (let cx = -radius; cx <= radius; cx += 1) {
    for (let cz = -radius; cz <= radius; cz += 1) {
      coords.push({ cx, cz });
    }
  }
  return coords;
}

describe('isValidSpawnColumn', () => {
  it('accepts a grass-topped column with sky light and 2 free cells above', () => {
    const { store } = buildFlatGrassWorld(10, chunkGrid(1));
    expect(isValidSpawnColumn(store, blockRegistry, 5, 5)).toBe(true);
  });

  it('rejects a column with no chunk loaded', () => {
    const store = new ChunkStore();
    expect(isValidSpawnColumn(store, blockRegistry, 5, 5)).toBe(false);
  });

  it('rejects a non-grass surface (e.g. bare stone)', () => {
    const { store } = buildFlatGrassWorld(10, chunkGrid(1));
    const chunk = store.getChunk(0, 0);
    if (chunk === undefined) throw new Error('missing chunk');
    chunk.blocks[localIndex(5, 10, 5)] = BlockId.Stone;
    expect(isValidSpawnColumn(store, blockRegistry, 5, 5)).toBe(false);
  });

  it('rejects a column blocked 1 cell above the surface', () => {
    const { store } = buildFlatGrassWorld(10, chunkGrid(1));
    const chunk = store.getChunk(0, 0);
    if (chunk === undefined) throw new Error('missing chunk');
    chunk.blocks[localIndex(5, 11, 5)] = BlockId.Stone;
    expect(isValidSpawnColumn(store, blockRegistry, 5, 5)).toBe(false);
  });

  it('rejects a column under dense cover (low sky light)', () => {
    const { store, light } = buildFlatGrassWorld(10, chunkGrid(1));
    const chunk = store.getChunk(0, 0);
    if (chunk === undefined) throw new Error('missing chunk');
    // Roof over the entire chunk well above the spawn cell blocks skylight from above.
    for (let x = 0; x < W; x += 1) {
      for (let z = 0; z < D; z += 1) {
        chunk.blocks[localIndex(x, 20, z)] = BlockId.Stone;
      }
    }
    light.lightChunk(0, 0);
    expect(isValidSpawnColumn(store, blockRegistry, 5, 5)).toBe(false);
  });
});

describe('attemptSpawns', () => {
  it('only spawns mobs within [minSpawnDistance, maxSpawnDistance] of the player', () => {
    const radius = Math.ceil(MOB_CONFIG.maxSpawnDistance / W) + 1;
    const { store } = buildFlatGrassWorld(10, chunkGrid(radius));
    const entityStore = new EntityStore();
    const rng = mulberry32(42);
    const player = { x: 0, z: 0 };

    for (let wave = 0; wave < 20; wave += 1) {
      attemptSpawns(store, blockRegistry, entityStore, player, rng);
    }

    expect(entityStore.count()).toBeGreaterThan(0);
    for (const mob of entityStore.all()) {
      const dist = Math.hypot(mob.position.x - player.x, mob.position.z - player.z);
      expect(dist).toBeGreaterThanOrEqual(MOB_CONFIG.minSpawnDistance - 1);
      expect(dist).toBeLessThanOrEqual(MOB_CONFIG.maxSpawnDistance + 1);
    }
  });

  it('respects the global maxPassiveMobs cap', () => {
    const radius = Math.ceil(MOB_CONFIG.maxSpawnDistance / W) + 1;
    const { store } = buildFlatGrassWorld(10, chunkGrid(radius));
    const entityStore = new EntityStore();
    const rng = mulberry32(7);
    const player = { x: 0, z: 0 };

    for (let wave = 0; wave < 100; wave += 1) {
      attemptSpawns(store, blockRegistry, entityStore, player, rng);
    }

    expect(entityStore.count()).toBeLessThanOrEqual(MOB_CONFIG.maxPassiveMobs);
  });

  it('spawns nothing when no column in range is valid', () => {
    const store = new ChunkStore(); // nothing loaded at all
    const entityStore = new EntityStore();
    const rng = mulberry32(1);

    attemptSpawns(store, blockRegistry, entityStore, { x: 0, z: 0 }, rng);

    expect(entityStore.count()).toBe(0);
  });

  it('is deterministic given the same rng seed and world state', () => {
    function run(): unknown {
      const radius = Math.ceil(MOB_CONFIG.maxSpawnDistance / W) + 1;
      const { store } = buildFlatGrassWorld(10, chunkGrid(radius));
      const entityStore = new EntityStore();
      const rng = mulberry32(123);
      for (let wave = 0; wave < 10; wave += 1) {
        attemptSpawns(store, blockRegistry, entityStore, { x: 0, z: 0 }, rng);
      }
      return entityStore.all().map((mob) => ({ type: mob.type, position: mob.position, yaw: mob.yaw }));
    }

    expect(run()).toEqual(run());
  });
});

describe('despawnFarMobs', () => {
  it('removes mobs farther than MOB_CONFIG.despawnDistance from the player', () => {
    const { store } = buildFlatGrassWorld(10, chunkGrid(1));
    const entityStore = new EntityStore();
    const near = entityStore.spawn(MobType.Pig, { x: 1, y: 11, z: 1 });
    const far = entityStore.spawn(MobType.Pig, { x: MOB_CONFIG.despawnDistance + 50, y: 11, z: 0 });

    despawnFarMobs(store, entityStore, { x: 0, z: 0 });

    expect(entityStore.get(near.id)).toBeDefined();
    expect(entityStore.get(far.id)).toBeUndefined();
  });

  it('removes mobs whose column is no longer loaded', () => {
    const store = new ChunkStore(); // nothing loaded
    const entityStore = new EntityStore();
    const mob = entityStore.spawn(MobType.Pig, { x: 1, y: 11, z: 1 });

    despawnFarMobs(store, entityStore, { x: 0, z: 0 });

    expect(entityStore.get(mob.id)).toBeUndefined();
  });
});
