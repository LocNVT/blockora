import type { BlockRegistry } from './BlockRegistry';
import type { ChunkStore } from './ChunkStore';

/**
 * Answers whether the block at integer block coordinates (x, y, z) can be
 * targeted by a raycast (e.g. player look-at highlighting). Mirrors
 * SolidQuery's shape but reflects `BlockRegistry.isTargetable` instead of
 * `isSolid` — transparent-but-solid blocks (Glass, Leaves) and non-solid
 * decorations (Torch) are targetable; Water is not.
 */
export type TargetQuery = (x: number, y: number, z: number) => boolean;

/** Builds a TargetQuery backed by a ChunkStore and a BlockRegistry. */
export function createTargetQuery(store: ChunkStore, registry: BlockRegistry): TargetQuery {
  return (x: number, y: number, z: number): boolean =>
    registry.isTargetable(store.getBlock(x, y, z));
}
