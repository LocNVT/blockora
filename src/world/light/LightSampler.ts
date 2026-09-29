import type { Chunk } from '../Chunk';
import type { ChunkStore } from '../ChunkStore';
import { WORLD_CONFIG } from '../../config/constants';
import { MAX_LIGHT, blockLightOf, packLight, skyLightOf } from './lightNibbles';

const { chunkWidth: W, chunkDepth: D, chunkHeight: H } = WORLD_CONFIG;

/** Packed light reported above the world and for unloaded chunks: open sky, no block light. */
export const OPEN_SKY_LIGHT = packLight(MAX_LIGHT, 0);
/** Packed light reported below the world (y < 0). */
export const BELOW_WORLD_LIGHT = packLight(0, 0);

/**
 * Samples packed light (see lightNibbles) at chunk-local coordinates that may
 * extend up to one chunk past the center in x and/or z (including diagonals,
 * for smooth vertex lighting), or outside 0..chunkHeight-1 in y.
 */
export type LightSampler = (lx: number, ly: number, lz: number) => number;

/** 3x3 chunks around a center, row-major by (dz + 1) * 3 + (dx + 1); missing chunks are null. */
export interface LightNeighborhood {
  readonly cx: number;
  readonly cz: number;
  readonly chunks: readonly (Chunk | null)[];
}

export function lightNeighborhoodFromStore(store: ChunkStore, cx: number, cz: number): LightNeighborhood {
  const chunks: (Chunk | null)[] = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      chunks.push(store.getChunk(cx + dx, cz + dz) ?? null);
    }
  }
  return { cx, cz, chunks };
}

/**
 * Builds a LightSampler over a LightNeighborhood. y >= chunkHeight and missing
 * chunks read as OPEN_SKY_LIGHT; y < 0 reads as BELOW_WORLD_LIGHT. Samples more
 * than one chunk away from the center also read as OPEN_SKY_LIGHT.
 */
export function createLightSampler(neighborhood: LightNeighborhood): LightSampler {
  const { chunks } = neighborhood;
  return (lx: number, ly: number, lz: number): number => {
    if (ly >= H) {
      return OPEN_SKY_LIGHT;
    }
    if (ly < 0) {
      return BELOW_WORLD_LIGHT;
    }
    const dx = lx < 0 ? -1 : lx >= W ? 1 : 0;
    const dz = lz < 0 ? -1 : lz >= D ? 1 : 0;
    const x = lx - dx * W;
    const z = lz - dz * D;
    if (x < 0 || x >= W || z < 0 || z >= D) {
      return OPEN_SKY_LIGHT;
    }
    const chunk = chunks[(dz + 1) * 3 + (dx + 1)] ?? null;
    if (chunk === null) {
      return OPEN_SKY_LIGHT;
    }
    return chunk.light[x + W * (z + D * ly)] ?? 0;
  };
}

/** Packed light at integer world coordinates, with the same out-of-range rules as the sampler. */
export function getLightAt(store: ChunkStore, wx: number, wy: number, wz: number): number {
  const y = Math.floor(wy);
  if (y >= H) {
    return OPEN_SKY_LIGHT;
  }
  if (y < 0) {
    return BELOW_WORLD_LIGHT;
  }
  const x = Math.floor(wx);
  const z = Math.floor(wz);
  const cx = Math.floor(x / W);
  const cz = Math.floor(z / D);
  const chunk = store.getChunk(cx, cz);
  if (chunk === undefined) {
    return OPEN_SKY_LIGHT;
  }
  return chunk.light[x - cx * W + W * (z - cz * D + D * y)] ?? 0;
}

export function getSkyLight(store: ChunkStore, wx: number, wy: number, wz: number): number {
  return skyLightOf(getLightAt(store, wx, wy, wz));
}

export function getBlockLight(store: ChunkStore, wx: number, wy: number, wz: number): number {
  return blockLightOf(getLightAt(store, wx, wy, wz));
}
