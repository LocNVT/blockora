import type { BlockRegistry } from '../world/BlockRegistry';
import { BlockId } from '../world/blocks';
import type { ChunkStore } from '../world/ChunkStore';
import { setBlockAt, type BlockChange } from '../world/blockEdit';
import type { VoxelRaycastBlockHit } from '../world/voxelRaycast';
import type { Aabb } from '../player/voxelCollision';
import { WORLD_CONFIG, PLAYER_CONFIG } from '../config/constants';

const { chunkHeight } = WORLD_CONFIG;

/** Block placed by a "place" action until inventory/hotbar selection exists. */
export const DEFAULT_PLACE_BLOCK: BlockId = BlockId.Planks;

/**
 * Breaks the block a raycast hit (turns it into Air), subject to range and
 * targetability. Re-reads the current block from the store rather than
 * trusting `hit.blockId`, since the hit may be stale by the time the action
 * is applied (e.g. sampled earlier in the frame).
 *
 * Returns null when: there is no hit, the hit is beyond `maxDistance`, the
 * current block at the hit cell is Air, or the block is not targetable
 * (matches raycast targetability rules — e.g. Water can never be "broken").
 */
export function tryBreakBlock(
  store: ChunkStore,
  registry: BlockRegistry,
  hit: VoxelRaycastBlockHit | null,
  maxDistance: number = PLAYER_CONFIG.interactionDistance,
): BlockChange | null {
  if (hit === null || hit.distance > maxDistance) {
    return null;
  }

  const currentId = store.getBlock(hit.x, hit.y, hit.z);
  if (currentId === BlockId.Air || !registry.isTargetable(currentId)) {
    return null;
  }

  return setBlockAt(store, registry, hit.x, hit.y, hit.z, BlockId.Air);
}

/**
 * Places `blockId` into the empty cell adjacent to a raycast hit (the face
 * the ray entered through), subject to range, occupancy, height bounds, and
 * player-overlap checks.
 *
 * Occupancy rule: the target cell must currently be Air. Any other
 * non-Air block — including Water — counts as occupied and blocks
 * placement; there is no "replace liquid" behaviour yet.
 *
 * Overlap rule: when `blockId` is solid, the target unit cell
 * [x,x+1) x [y,y+1) x [z,z+1) must not strictly overlap `playerBox`. Faces
 * that merely touch (share a boundary) are allowed — the same
 * `collisionEpsilon` skin used by player collision is applied so a cell
 * flush against the player's box doesn't get rejected by floating-point
 * noise. No pushback/teleport is performed; an overlapping placement is
 * simply rejected.
 */
export function tryPlaceBlock(
  store: ChunkStore,
  registry: BlockRegistry,
  hit: VoxelRaycastBlockHit | null,
  blockId: BlockId,
  playerBox: Aabb,
  maxDistance: number = PLAYER_CONFIG.interactionDistance,
): BlockChange | null {
  if (hit === null || !hit.hasPlacePosition || hit.distance > maxDistance) {
    return null;
  }

  const { placeX, placeY, placeZ } = hit;
  if (placeY < 0 || placeY >= chunkHeight) {
    return null;
  }

  const targetId = store.getBlock(placeX, placeY, placeZ);
  if (!registry.isReplaceable(targetId)) {
    return null;
  }

  if (registry.isSolid(blockId) && cellOverlapsPlayer(placeX, placeY, placeZ, playerBox)) {
    return null;
  }

  return setBlockAt(store, registry, placeX, placeY, placeZ, blockId);
}

/** True if the unit cell at (x, y, z) strictly overlaps `playerBox` (touching faces are allowed). */
function cellOverlapsPlayer(x: number, y: number, z: number, playerBox: Aabb): boolean {
  const epsilon = PLAYER_CONFIG.collisionEpsilon;
  const cellMinX = x;
  const cellMaxX = x + 1;
  const cellMinY = y;
  const cellMaxY = y + 1;
  const cellMinZ = z;
  const cellMaxZ = z + 1;

  const overlapsX = cellMaxX - epsilon > playerBox.minX && cellMinX + epsilon < playerBox.maxX;
  const overlapsY = cellMaxY - epsilon > playerBox.minY && cellMinY + epsilon < playerBox.maxY;
  const overlapsZ = cellMaxZ - epsilon > playerBox.minZ && cellMinZ + epsilon < playerBox.maxZ;

  return overlapsX && overlapsY && overlapsZ;
}
