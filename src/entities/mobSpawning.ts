import { BlockId } from '../world/blocks';
import type { ChunkStore } from '../world/ChunkStore';
import type { BlockRegistry } from '../world/BlockRegistry';
import { getSkyLight, getLightAt } from '../world/light/LightSampler';
import { skyLightOf, blockLightOf } from '../world/light/lightNibbles';
import { effectiveLightLevel } from '../renderer/lightShading';
import { worldToChunkCoord } from '../world/chunkCoords';
import { WORLD_CONFIG, MOB_CONFIG } from '../config/constants';
import { EntityStore, type MobEntity } from './EntityStore';
import { MOB_DEFINITIONS, MobType, mobDefinition } from './mobDefinitions';
import type { Rng } from './mobAI';
import { mulberry32 } from '../util/mulberry32';

// Shared PRNG lives in src/util; re-exported so existing importers keep working.
export { mulberry32 };

const PASSIVE_DEFINITIONS = MOB_DEFINITIONS.filter((def) => def.hostile === null);
const HOSTILE_DEFINITIONS = MOB_DEFINITIONS.filter((def) => def.hostile !== null);

/** Total spawn-weight-normalized pick of a passive mob type using `rng`. */
function pickMobType(rng: Rng): MobType {
  const totalWeight = PASSIVE_DEFINITIONS.reduce((sum, def) => sum + def.spawnWeight, 0);
  if (totalWeight <= 0) {
    return MobType.Pig;
  }
  let roll = rng() * totalWeight;
  for (const def of PASSIVE_DEFINITIONS) {
    roll -= def.spawnWeight;
    if (roll <= 0) {
      return def.type;
    }
  }
  const last = PASSIVE_DEFINITIONS[PASSIVE_DEFINITIONS.length - 1];
  return last === undefined ? MobType.Pig : last.type;
}

/** Number of live hostile mobs. */
export function countHostile(entityStore: EntityStore): number {
  let total = 0;
  for (const mob of entityStore.all()) {
    if (mobDefinition(mob.type).hostile !== null) {
      total += 1;
    }
  }
  return total;
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
export function attemptPassiveSpawns(
  store: ChunkStore,
  registry: BlockRegistry,
  entityStore: EntityStore,
  playerPosition: { x: number; z: number },
  rng: Rng,
): void {
  const passiveCount = (): number => entityStore.count() - countHostile(entityStore);
  if (passiveCount() >= MOB_CONFIG.maxPassiveMobs) {
    return;
  }

  const { minSpawnDistance, maxSpawnDistance, spawnAttemptsPerWave } = MOB_CONFIG;

  for (let attempt = 0; attempt < spawnAttemptsPerWave; attempt += 1) {
    if (passiveCount() >= MOB_CONFIG.maxPassiveMobs) {
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

/** True when the cell (wx, y, wz) and the one above are free (non-solid, non-fluid) above a solid, non-fluid floor at y - 1. */
function isStandable(store: ChunkStore, registry: BlockRegistry, wx: number, y: number, wz: number): boolean {
  if (y < 1 || y + 1 >= WORLD_CONFIG.chunkHeight) {
    return false;
  }
  const floor = store.getBlock(wx, y - 1, wz);
  if (!registry.isSolid(floor) || registry.isFluid(floor)) {
    return false;
  }
  for (let dy = 0; dy < 2; dy += 1) {
    const id = store.getBlock(wx, y + dy, wz);
    if (registry.isSolid(id) || registry.isFluid(id)) {
      return false;
    }
  }
  return true;
}

/** Effective light (0..15) at a cell: max(sky x daylight scale, block light), the same formula the renderer shades with. */
function effectiveLightAt(store: ChunkStore, wx: number, y: number, wz: number, daylight: number): number {
  const packed = getLightAt(store, wx, y, wz);
  return effectiveLightLevel(skyLightOf(packed), blockLightOf(packed), daylight);
}

/**
 * Finds a feet-level y for a hostile spawn in column (wx, wz), or null. Tries
 * the surface first (any solid non-fluid top block with 2 free cells above),
 * then a cave: scans down up to `hostileCaveScanDepth` cells from
 * `caveCandidateY` for the first dark floor. The spawn cell must be dark enough
 * (effective light <= MOB_CONFIG.hostileMaxSpawnLight), so surface spawns only
 * happen at night and caves work at any time.
 */
export function findHostileSpawnY(
  store: ChunkStore,
  registry: BlockRegistry,
  wx: number,
  wz: number,
  daylight: number,
  caveCandidateY: number,
): number | null {
  const { cx, cz } = worldToChunkCoord(wx, wz);
  if (!store.hasChunk(cx, cz)) {
    return null;
  }
  const isDark = (y: number): boolean =>
    effectiveLightAt(store, wx, y, wz, daylight) <= MOB_CONFIG.hostileMaxSpawnLight;

  const surfaceY = findSurfaceY(store, wx, wz);
  if (surfaceY !== null && isStandable(store, registry, wx, surfaceY + 1, wz) && isDark(surfaceY + 1)) {
    return surfaceY + 1;
  }

  const top = Math.min(Math.floor(caveCandidateY), WORLD_CONFIG.chunkHeight - 2);
  for (let y = top; y >= Math.max(1, top - MOB_CONFIG.hostileCaveScanDepth); y -= 1) {
    // Keep scanning past lit standable cells (e.g. the surface) to a dark cave below.
    if (isStandable(store, registry, wx, y, wz) && isDark(y)) {
      return y;
    }
  }
  return null;
}

/**
 * Attempts up to MOB_CONFIG.hostileSpawnAttemptsPerWave hostile spawns in the
 * same ring as passive spawns, capped separately at MOB_CONFIG.maxHostileMobs.
 * `daylight` is the 0..1 daylight factor (daylightFactor of GameTime).
 */
export function attemptHostileSpawns(
  store: ChunkStore,
  registry: BlockRegistry,
  entityStore: EntityStore,
  playerPosition: { x: number; y: number; z: number },
  rng: Rng,
  daylight: number,
): void {
  const { minSpawnDistance, maxSpawnDistance, hostileSpawnAttemptsPerWave, hostileCaveSearchRange } = MOB_CONFIG;
  const def = HOSTILE_DEFINITIONS[0];
  if (def === undefined) {
    return;
  }

  for (let attempt = 0; attempt < hostileSpawnAttemptsPerWave; attempt += 1) {
    if (countHostile(entityStore) >= MOB_CONFIG.maxHostileMobs || entityStore.count(def.type) >= def.maxPerArea) {
      return;
    }

    const angle = rng() * Math.PI * 2;
    const distance = minSpawnDistance + rng() * (maxSpawnDistance - minSpawnDistance);
    const caveY = playerPosition.y + (rng() * 2 - 1) * hostileCaveSearchRange;
    const initialYaw = rng() * Math.PI * 2 - Math.PI;
    const wx = Math.floor(playerPosition.x + Math.cos(angle) * distance);
    const wz = Math.floor(playerPosition.z + Math.sin(angle) * distance);

    const y = findHostileSpawnY(store, registry, wx, wz, daylight, caveY);
    if (y === null) {
      continue;
    }
    entityStore.spawn(def.type, { x: wx + 0.5, y, z: wz + 0.5 }, initialYaw);
  }
}

/** Runs one passive and one hostile spawn wave. `daylight` defaults to full day (no hostile surface spawns). */
export function attemptSpawns(
  store: ChunkStore,
  registry: BlockRegistry,
  entityStore: EntityStore,
  playerPosition: { x: number; y?: number; z: number },
  rng: Rng,
  daylight = 1,
): void {
  attemptPassiveSpawns(store, registry, entityStore, playerPosition, rng);
  attemptHostileSpawns(
    store,
    registry,
    entityStore,
    { x: playerPosition.x, y: playerPosition.y ?? 0, z: playerPosition.z },
    rng,
    daylight,
  );
}

/**
 * Gradually despawns exposed hostile mobs in daylight: while `daylight` >=
 * MOB_CONFIG.hostileDespawnDaylight, each hostile mob standing in sky light >=
 * hostileDespawnSkyLight is removed with probability
 * hostileDespawnChancePerSecond * dt per call (one rng draw per eligible mob).
 * Mobs in caves/shade are unaffected. No burning visuals.
 */
export function despawnHostilesInDaylight(
  store: ChunkStore,
  entityStore: EntityStore,
  daylight: number,
  dt: number,
  rng: Rng,
): void {
  if (daylight < MOB_CONFIG.hostileDespawnDaylight) {
    return;
  }
  const toRemove: number[] = [];
  for (const mob of entityStore.all()) {
    if (mobDefinition(mob.type).hostile === null) {
      continue;
    }
    const sky = skyLightOf(getLightAt(store, mob.position.x, mob.position.y + 1, mob.position.z));
    if (sky < MOB_CONFIG.hostileDespawnSkyLight) {
      continue;
    }
    if (rng() < MOB_CONFIG.hostileDespawnChancePerSecond * dt) {
      toRemove.push(mob.id);
    }
  }
  for (const id of toRemove) {
    entityStore.remove(id);
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
