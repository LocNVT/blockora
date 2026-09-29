import { BlockId } from '../blocks';
import type { Chunk } from '../Chunk';
import type { ChunkStore } from '../ChunkStore';
import { WORLD_CONFIG } from '../../config/constants';

const { chunkWidth, chunkDepth, chunkHeight } = WORLD_CONFIG;

/**
 * Samples a block id at chunk-local coordinates that may extend one block
 * past this chunk's bounds in x or z (to see into neighbouring chunks) or
 * past 0/chunkHeight in y (always Air, matching ChunkStore's world rule).
 */
export type BlockSampler = (lx: number, ly: number, lz: number) => BlockId;

/**
 * Plain-data grouping of a center chunk and its 4 horizontal neighbours.
 * A missing neighbour (null) is treated as all-Air by `neighborhoodFromStore`
 * and `createBlockSampler`, so chunk-boundary faces toward an unloaded
 * neighbour ARE emitted. When that neighbour later loads, the center chunk
 * (and the neighbour's matching boundary) must be remeshed, since the faces
 * emitted here were based on the neighbour being empty.
 */
export interface ChunkNeighborhood {
  readonly center: Chunk;
  readonly posX: Chunk | null;
  readonly negX: Chunk | null;
  readonly posZ: Chunk | null;
  readonly negZ: Chunk | null;
}

/** Builds a ChunkNeighborhood for (cx, cz) from a ChunkStore; missing neighbours become null. */
export function neighborhoodFromStore(store: ChunkStore, cx: number, cz: number): ChunkNeighborhood {
  const center = store.getChunk(cx, cz);
  if (center === undefined) {
    throw new Error(`neighborhoodFromStore: no chunk loaded at (${cx}, ${cz}).`);
  }
  return {
    center,
    posX: store.getChunk(cx + 1, cz) ?? null,
    negX: store.getChunk(cx - 1, cz) ?? null,
    posZ: store.getChunk(cx, cz + 1) ?? null,
    negZ: store.getChunk(cx, cz - 1) ?? null,
  };
}

/**
 * Builds a BlockSampler over a ChunkNeighborhood. y out of [0, chunkHeight)
 * and any lookup into a missing (null) neighbour both resolve to Air.
 */
export function createBlockSampler(neighborhood: ChunkNeighborhood): BlockSampler {
  const { center, posX, negX, posZ, negZ } = neighborhood;

  return (lx: number, ly: number, lz: number): BlockId => {
    if (ly < 0 || ly >= chunkHeight) {
      return BlockId.Air;
    }

    if (lx >= chunkWidth) {
      return posX === null ? BlockId.Air : posX.getBlock(lx - chunkWidth, ly, lz);
    }
    if (lx < 0) {
      return negX === null ? BlockId.Air : negX.getBlock(lx + chunkWidth, ly, lz);
    }
    if (lz >= chunkDepth) {
      return posZ === null ? BlockId.Air : posZ.getBlock(lx, ly, lz - chunkDepth);
    }
    if (lz < 0) {
      return negZ === null ? BlockId.Air : negZ.getBlock(lx, ly, lz + chunkDepth);
    }

    return center.getBlock(lx, ly, lz);
  };
}
