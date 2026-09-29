import { WORLD_CONFIG } from '../config/constants';

const { chunkWidth, chunkDepth, chunkHeight } = WORLD_CONFIG;

export const CHUNK_VOLUME = chunkWidth * chunkDepth * chunkHeight;

export interface ChunkCoord {
  readonly cx: number;
  readonly cz: number;
}

export interface LocalCoord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Deterministic flat index for a local block position within a chunk. */
export function localIndex(x: number, y: number, z: number): number {
  return x + chunkWidth * (z + chunkDepth * y);
}

/** True when (x, y, z) are integers within this chunk's bounds. */
export function isInsideChunk(x: number, y: number, z: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    Number.isInteger(z) &&
    x >= 0 &&
    x < chunkWidth &&
    y >= 0 &&
    y < chunkHeight &&
    z >= 0 &&
    z < chunkDepth
  );
}

/** Maps world-space x/z to the chunk column that contains them (floor division, negative-safe). */
export function worldToChunkCoord(worldX: number, worldZ: number): ChunkCoord {
  return {
    cx: Math.floor(worldX / chunkWidth),
    cz: Math.floor(worldZ / chunkDepth),
  };
}

/** Maps world-space coordinates to local in-chunk coordinates (positive modulo, negative-safe). */
export function worldToLocal(worldX: number, worldY: number, worldZ: number): LocalCoord {
  const x = Math.floor(worldX) - Math.floor(worldX / chunkWidth) * chunkWidth;
  const z = Math.floor(worldZ) - Math.floor(worldZ / chunkDepth) * chunkDepth;
  const y = Math.floor(worldY);
  return { x, y, z };
}

/** Stable string key for a chunk column, suitable for use as a Map key. */
export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}
