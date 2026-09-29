import type { BlockRegistry } from './BlockRegistry';
import type { ChunkStore } from './ChunkStore';

/**
 * Answers whether the block at integer block coordinates (x, y, z) is solid.
 * The block at (bx, by, bz) occupies [bx, bx+1) x [by, by+1) x [bz, bz+1).
 * Decouples collision code from both storage (ChunkStore) and Three.js.
 */
export type SolidQuery = (x: number, y: number, z: number) => boolean;

/** Builds a SolidQuery backed by a ChunkStore and a BlockRegistry. */
export function createSolidQuery(store: ChunkStore, registry: BlockRegistry): SolidQuery {
  return (x: number, y: number, z: number): boolean => registry.isSolid(store.getBlock(x, y, z));
}
