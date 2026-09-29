import type { BlockRegistry } from './BlockRegistry';
import { BlockId } from './blocks';
import type { ChunkStore } from './ChunkStore';
import { WORLD_CONFIG } from '../config/constants';
import { chunkKey, worldToChunkCoord, worldToLocal, type ChunkCoord } from './chunkCoords';
import type { LightEngine } from './light/LightEngine';

const { chunkWidth, chunkDepth, chunkHeight } = WORLD_CONFIG;

/**
 * Records one committed block edit: the world/chunk/local coordinates it
 * happened at, and the block id before and after. Used to figure out which
 * chunk meshes need to be rebuilt (see `affectedChunks`).
 */
export interface BlockChange {
  readonly wx: number;
  readonly wy: number;
  readonly wz: number;
  readonly cx: number;
  readonly cz: number;
  readonly lx: number;
  readonly ly: number;
  readonly lz: number;
  readonly previous: BlockId;
  readonly next: BlockId;
}

/**
 * Writes a block into the world at integer block coordinates (wx, wy, wz).
 *
 * Returns null (no-op) when:
 * - any of wx/wy/wz is not an integer,
 * - wy is outside [0, chunkHeight),
 * - the write would create a chunk only to fill it with Air (writing Air
 *   into an unloaded chunk region is meaningless — there is nothing to
 *   clear), or
 * - the resolved block id is unchanged from what's already there.
 *
 * Throws a RangeError if `id` is not a registered block id — this is a
 * programmer error (e.g. a typo'd constant), never a normal runtime outcome,
 * so it is not folded into the null/no-op path.
 *
 * Writing any non-Air block creates the target chunk if it doesn't exist yet
 * (mirrors `ChunkStore.setBlock`).
 */
export function setBlockAt(
  store: ChunkStore,
  registry: BlockRegistry,
  wx: number,
  wy: number,
  wz: number,
  id: number,
): BlockChange | null {
  if (!registry.has(id)) {
    throw new RangeError(`setBlockAt: block id ${id} is not registered.`);
  }
  if (!Number.isInteger(wx) || !Number.isInteger(wy) || !Number.isInteger(wz)) {
    return null;
  }
  if (wy < 0 || wy >= chunkHeight) {
    return null;
  }

  const { cx, cz } = worldToChunkCoord(wx, wz);
  const local = worldToLocal(wx, wy, wz);

  const existingChunk = store.getChunk(cx, cz);
  if (existingChunk === undefined && id === BlockId.Air) {
    // Nothing to clear: an unloaded region already reads as Air.
    return null;
  }

  const previous = store.getBlock(wx, wy, wz);
  if (previous === id) {
    return null;
  }

  const changed = store.setBlock(wx, wy, wz, id);
  if (!changed) {
    return null;
  }

  return {
    wx,
    wy,
    wz,
    cx,
    cz,
    lx: local.x,
    ly: local.y,
    lz: local.z,
    previous,
    next: id as BlockId,
  };
}

/**
 * Chunk coordinates whose mesh may need to be rebuilt after `change`.
 *
 * Always includes the changed block's own chunk. When the edit sits on a
 * chunk-width/depth boundary (lx/lz at 0 or the max index), the neighbouring
 * chunk across that face is also included, since face culling samples one
 * block into the adjacent chunk (see BlockSampler) and that neighbour's
 * boundary faces may now need to appear/disappear.
 *
 * Only axis-aligned neighbours are considered — face culling never samples
 * diagonally, so a corner edit (e.g. lx=0 and lz=0) affects exactly 3 chunks
 * (center + one on each of the two touched axes), never a diagonal 4th.
 *
 * Order is deterministic: center, then -X/+X, then -Z/+Z.
 */
export function affectedChunks(change: BlockChange): ChunkCoord[] {
  const { cx, cz, lx, lz } = change;
  const coords: ChunkCoord[] = [{ cx, cz }];

  if (lx === 0) {
    coords.push({ cx: cx - 1, cz });
  } else if (lx === chunkWidth - 1) {
    coords.push({ cx: cx + 1, cz });
  }

  if (lz === 0) {
    coords.push({ cx, cz: cz - 1 });
  } else if (lz === chunkDepth - 1) {
    coords.push({ cx, cz: cz + 1 });
  }

  return coords;
}

/**
 * Runs the light update for a committed `change` and returns every chunk
 * whose mesh should be rebuilt: `affectedChunks(change)` first, then any
 * chunks whose light changed (deduped, deterministic order).
 */
export function applyLightAndCollectRemesh(change: BlockChange, light: LightEngine): ChunkCoord[] {
  const lightChanged = light.updateBlock(change.wx, change.wy, change.wz, change.previous, change.next);
  const coords = affectedChunks(change);
  const seen = new Set(coords.map(({ cx, cz }) => chunkKey(cx, cz)));
  for (const coord of lightChanged) {
    const key = chunkKey(coord.cx, coord.cz);
    if (!seen.has(key)) {
      seen.add(key);
      coords.push(coord);
    }
  }
  return coords;
}
