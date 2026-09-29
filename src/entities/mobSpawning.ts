import { BlockId } from '../world/blocks';
import type { ChunkStore } from '../world/ChunkStore';
import type { BlockRegistry } from '../world/BlockRegistry';
import { getSkyLight } from '../world/light/LightSampler';
import { worldToChunkCoord } from '../world/chunkCoords';
import { WORLD_CONFIG, MOB_CONFIG } from '../config/constants';
import { EntityStore, type MobEntity } from './EntityStore';
import { MOB_DEFINITIONS, MobType, mobDefinition } from './mobDefinitions';
import type { Rng } from './mobAI';

/** Small deterministic PRNG (mulberry32). Same seed -> same sequence, so mob spawning stays reproducible. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Total spawn-weight-normalized pick of a mob type using `rng`. */
function pickMobType(rng: Rng): MobType {
  const totalWeight = MOB_DEFINITIONS.reduce((sum, def) => sum + def.spawnWeight, 0);
  if (totalWeight <= 0) {
    return MobType.Pig;
  }
  let roll = rng() * totalWeight;
  for (const def of MOB_DEFINITIONS) {
    roll -= def.spawnWeight;
    if (roll <= 0) {
      return def.type;
    }
  }
  const last = MOB_DEFINITIONS[MOB_DEFINITIONS.length - 1];
  return last === undefined ? MobType.Pig : last.type;
}

/** Topmost non-air block's y in this column, scanning down from chunkHeight-1, or null if the column is empty/unloaded. */
function findSurfaceY(store: ChunkStore, wx: number, wz: number): number | null {
  const { cx, cz } = worldToChunkCoord(wx, wz);
  if (!store.hasChunk(cx, cz)) {
    return null;
  }
  for (let y = WORLD_CONFIG.chunkHeight - 1; y >= 0; y -= 1) {
    if (store.getBlock(wx, y, wz) !== BlockId.Air) {
      return y;
    }
  }
  return null;
}

/**
 * True when (wx, wz) is a valid passive-mob spawn column: grass-topped, dry
 * (surface block is not a fluid), has 2 free (non-solid) cells above the
 * surface for the mob to stand in, and sky light at the spawn cell meets
 * MOB_CONFIG.minSpawnSkyLight. Deterministic given the current world state.
 */
export function isValidSpawnColumn(
  store: ChunkStore,
  registry: BlockRegistry,
  wx: number,
  wz: number,
): boolean {
  const surfaceY = findSurfaceY(store, wx, wz);
  if (surfaceY === null || surfaceY + 2 >= WORLD_CONFIG.chunkHeight) {
    return false;
  }

  const surfaceBlock = store.getBlock(wx, surfaceY, wz);
  if (surfaceBlock !== BlockId.Grass) {
    return false;
  }

  const aboveFirst = store.getBlock(wx, surfaceY + 1, wz);
  const aboveSecond = store.getBlock(wx, surfaceY + 2, wz);
  if (registry.isSolid(aboveFirst) || registry.isSolid(aboveSecond)) {
    return false;
  }
  if (registry.isFluid(aboveFirst) || registry.isFluid(aboveSecond)) {
    return false;
  }

  const skyLight = getSkyLight(store, wx, surfaceY + 1, wz);
  return skyLight >= MOB_CONFIG.minSpawnSkyLight;
}

/** Squared horizontal distance from (px, pz) to (x, z) — avoids a sqrt for radius comparisons. */
function horizontalDistanceSq(px: number, pz: number, x: number, z: number): number {
  const dx = x - px;
  const dz = z - pz;
  return dx * dx + dz * dz;
}

/**
 * Attempts up to MOB_CONFIG.spawnAttemptsPerWave passive-mob spawns in a ring
 * around the player (between minSpawnDistance and maxSpawnDistance), each
 * picking a uniformly random column in the ring and requiring
 * `isValidSpawnColumn`. Respects MOB_CONFIG.maxPassiveMobs (global) and each
 * mob type's `maxPerArea` (also global for this single-area MVP slice).
 * Deterministic given the same `rng` call sequence and world state.
 */
export function attemptSpawns(
  store: ChunkStore,
  registry: BlockRegistry,
  entityStore: EntityStore,
  playerPosition: { x: number; z: number },
  rng: Rng,
): void {
  if (entityStore.count() >= MOB_CONFIG.maxPassiveMobs) {
    return;
  }

  const { minSpawnDistance, maxSpawnDistance, spawnAttemptsPerWave } = MOB_CONFIG;

  for (let attempt = 0; attempt < spawnAttemptsPerWave; attempt += 1) {
    if (entityStore.count() >= MOB_CONFIG.maxPassiveMobs) {
      return;
    }

    const angle = rng() * Math.PI * 2;
    const distance = minSpawnDistance + rng() * (maxSpawnDistance - minSpawnDistance);
    const wx = Math.floor(playerPosition.x + Math.cos(angle) * distance);
    const wz = Math.floor(playerPosition.z + Math.sin(angle) * distance);

    const type = pickMobType(rng);
    const def = mobDefinition(type);
    if (entityStore.count(type) >= def.maxPerArea) {
      continue;
    }

    if (!isValidSpawnColumn(store, registry, wx, wz)) {
      continue;
    }

    const surfaceY = findSurfaceY(store, wx, wz);
    if (surfaceY === null) {
      continue;
    }

    const initialYaw = rng() * Math.PI * 2 - Math.PI;
    entityStore.spawn(type, { x: wx + 0.5, y: surfaceY + 1, z: wz + 0.5 }, initialYaw);
  }
}

/**
 * Removes every mob farther than MOB_CONFIG.despawnDistance from the player
 * (horizontal distance) or whose column is no longer loaded. Deterministic,
 * no allocation beyond the ids collected for removal.
 */
export function despawnFarMobs(
  store: ChunkStore,
  entityStore: EntityStore,
  playerPosition: { x: number; z: number },
): void {
  const despawnDistanceSq = MOB_CONFIG.despawnDistance * MOB_CONFIG.despawnDistance;
  const toRemove: number[] = [];

  for (const mob of entityStore.all()) {
    const tooFar =
      horizontalDistanceSq(playerPosition.x, playerPosition.z, mob.position.x, mob.position.z) >
      despawnDistanceSq;
    const { cx, cz } = worldToChunkCoord(mob.position.x, mob.position.z);
    const unloaded = !store.hasChunk(cx, cz);

    if (tooFar || unloaded) {
      toRemove.push(mob.id);
    }
  }

  for (const id of toRemove) {
    entityStore.remove(id);
  }
}

export type { MobEntity };
