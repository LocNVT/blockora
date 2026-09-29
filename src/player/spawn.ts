import { PLAYER_CONFIG, WORLD_CONFIG } from '../config/constants';
import type { BlockRegistry } from '../world/BlockRegistry';
import type { ChunkStore } from '../world/ChunkStore';
import type { WorldGenerator } from '../world/WorldGenerator';
import type { Vector3Like } from './PlayerState';

/** Search starts at the world origin column and spirals outward from it. */
const SPAWN_ORIGIN_X = 0;
const SPAWN_ORIGIN_Z = 0;
/** Largest ring (in columns) searched for dry land before falling back to the origin. */
const SPAWN_SEARCH_RADIUS = 256;
/** Extra clearance (blocks) kept above the computed surface so spawn never buries the player. */
const SPAWN_HEIGHT_CLEARANCE = 2;
/** Free cells (feet + head) required above a surface to stand in. */
const SPAWN_REQUIRED_FREE_CELLS = 2;
/** Offset to the centre of a block column, so the player AABB doesn't straddle 4 columns. */
const COLUMN_CENTRE = 0.5;

/** Deterministic world spawn: feet position and initial look pitch. */
export interface SpawnPosition {
  readonly position: Vector3Like;
  readonly pitch: number;
}

export interface SpawnColumn {
  readonly x: number;
  readonly z: number;
}

/**
 * A column is dry when its surface is at or above sea level: the generator
 * only fills water into air cells in (surfaceY, seaLevel].
 */
export function isDryColumn(worldGenerator: WorldGenerator, x: number, z: number): boolean {
  return worldGenerator.surfaceHeight(x, z) >= WORLD_CONFIG.seaLevel;
}

/**
 * Nearest dry-land column to the origin, scanning square rings of increasing
 * radius in a fixed order (deterministic per seed). Falls back to the origin
 * when no dry column exists within `maxRadius`.
 */
export function findSpawnColumn(
  worldGenerator: WorldGenerator,
  maxRadius: number = SPAWN_SEARCH_RADIUS,
): SpawnColumn {
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const onRing = Math.max(Math.abs(dx), Math.abs(dz)) === radius;
        const x = SPAWN_ORIGIN_X + dx;
        const z = SPAWN_ORIGIN_Z + dz;
        if (onRing && isDryColumn(worldGenerator, x, z)) {
          return { x, z };
        }
      }
    }
  }
  return { x: SPAWN_ORIGIN_X, z: SPAWN_ORIGIN_Z };
}

/**
 * Computes the world spawn feet position (nearest dry column's surface, clamped
 * to at least sea level, plus clearance) and initial look pitch. Pure given a
 * seeded `worldGenerator` — same seed always yields the same spawn. Used both
 * at startup and on respawn so the two never drift apart. Generated features
 * above the surface (trees) are handled by `resolveSpawnHeight` once the spawn
 * chunk is loaded.
 */
export function computeSpawnPosition(worldGenerator: WorldGenerator): SpawnPosition {
  const column = findSpawnColumn(worldGenerator);
  const spawnSurfaceY = Math.max(
    worldGenerator.surfaceHeight(column.x, column.z),
    WORLD_CONFIG.seaLevel,
  );

  return {
    position: {
      x: column.x + COLUMN_CENTRE,
      y: spawnSurfaceY + SPAWN_HEIGHT_CLEARANCE,
      z: column.z + COLUMN_CENTRE,
    },
    pitch: PLAYER_CONFIG.spawnPitch,
  };
}

/**
 * Lowest feet height at or above `startY` in the (loaded) column where the
 * player's feet and head cells are neither solid nor fluid, so a spawn inside
 * a generated tree or under an overhang moves up into open air. Returns
 * `startY` unchanged when no such gap exists below the world top.
 */
export function resolveSpawnHeight(
  store: ChunkStore,
  registry: BlockRegistry,
  position: Vector3Like,
): number {
  const x = Math.floor(position.x);
  const z = Math.floor(position.z);
  const top = WORLD_CONFIG.chunkHeight - SPAWN_REQUIRED_FREE_CELLS;

  for (let y = Math.floor(position.y); y <= top; y += 1) {
    if (isFreeGap(store, registry, x, y, z)) {
      return y;
    }
  }
  return position.y;
}

function isFreeGap(store: ChunkStore, registry: BlockRegistry, x: number, y: number, z: number): boolean {
  for (let i = 0; i < SPAWN_REQUIRED_FREE_CELLS; i += 1) {
    const id = store.getBlock(x, y + i, z);
    if (registry.isSolid(id) || registry.isFluid(id)) {
      return false;
    }
  }
  return true;
}
