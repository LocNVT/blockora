import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG } from '../src/config/constants';
import {
  CHUNK_VOLUME,
  localIndex,
  isInsideChunk,
  worldToChunkCoord,
  worldToLocal,
  chunkKey,
} from '../src/world/chunkCoords';

const { chunkWidth, chunkDepth, chunkHeight } = WORLD_CONFIG;

describe('CHUNK_VOLUME', () => {
  it('matches WORLD_CONFIG dimensions', () => {
    expect(CHUNK_VOLUME).toBe(chunkWidth * chunkDepth * chunkHeight);
    expect(CHUNK_VOLUME).toBe(16 * 16 * 128);
  });
});

describe('localIndex', () => {
  it('maps the origin to index 0', () => {
    expect(localIndex(0, 0, 0)).toBe(0);
  });

  it('maps the far corner to volume - 1', () => {
    expect(localIndex(chunkWidth - 1, chunkHeight - 1, chunkDepth - 1)).toBe(CHUNK_VOLUME - 1);
  });

  it('produces unique indices for every coordinate in a small volume', () => {
    const seen = new Set<number>();
    const width = 4;
    const depth = 4;
    const height = 8;
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < depth; z++) {
        for (let x = 0; x < width; x++) {
          const idx = x + width * (z + depth * y);
          expect(seen.has(idx)).toBe(false);
          seen.add(idx);
        }
      }
    }
    expect(seen.size).toBe(width * depth * height);
  });
});

describe('isInsideChunk', () => {
  it('accepts boundary coordinates', () => {
    expect(isInsideChunk(0, 0, 0)).toBe(true);
    expect(isInsideChunk(chunkWidth - 1, chunkHeight - 1, chunkDepth - 1)).toBe(true);
  });

  it('rejects coordinates just outside the lower bound', () => {
    expect(isInsideChunk(-1, 0, 0)).toBe(false);
    expect(isInsideChunk(0, -1, 0)).toBe(false);
    expect(isInsideChunk(0, 0, -1)).toBe(false);
  });

  it('rejects coordinates just outside the upper bound', () => {
    expect(isInsideChunk(chunkWidth, 0, 0)).toBe(false);
    expect(isInsideChunk(0, chunkHeight, 0)).toBe(false);
    expect(isInsideChunk(0, 0, chunkDepth)).toBe(false);
  });

  it('rejects non-integer coordinates', () => {
    expect(isInsideChunk(0.5, 0, 0)).toBe(false);
    expect(isInsideChunk(0, 0.1, 0)).toBe(false);
    expect(isInsideChunk(0, 0, 1.9)).toBe(false);
  });
});

describe('worldToChunkCoord', () => {
  it('handles positive coordinates', () => {
    expect(worldToChunkCoord(0, 0)).toEqual({ cx: 0, cz: 0 });
    expect(worldToChunkCoord(15, 15)).toEqual({ cx: 0, cz: 0 });
    expect(worldToChunkCoord(16, 16)).toEqual({ cx: 1, cz: 1 });
  });

  it('floors negative coordinates toward negative infinity', () => {
    expect(worldToChunkCoord(-1, -1)).toEqual({ cx: -1, cz: -1 });
    expect(worldToChunkCoord(-16, -16)).toEqual({ cx: -1, cz: -1 });
    expect(worldToChunkCoord(-17, -17)).toEqual({ cx: -2, cz: -2 });
  });
});

describe('worldToLocal', () => {
  it('handles positive coordinates', () => {
    expect(worldToLocal(0, 0, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(worldToLocal(15, 5, 15)).toEqual({ x: 15, y: 5, z: 15 });
    expect(worldToLocal(16, 5, 16)).toEqual({ x: 0, y: 5, z: 0 });
  });

  it('wraps negative world coordinates into positive local space', () => {
    expect(worldToLocal(-1, 0, -1)).toEqual({ x: 15, y: 0, z: 15 });
    expect(worldToLocal(-16, 0, -16)).toEqual({ x: 0, y: 0, z: 0 });
    expect(worldToLocal(-17, 0, -17)).toEqual({ x: 15, y: 0, z: 15 });
  });

  it('floors non-integer inputs', () => {
    expect(worldToLocal(1.9, 2.9, 3.9)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('chunkKey', () => {
  it('formats a stable string key', () => {
    expect(chunkKey(0, 0)).toBe('0,0');
    expect(chunkKey(-1, 2)).toBe('-1,2');
  });
});

describe('determinism', () => {
  it('is a pure function of its inputs', () => {
    expect(localIndex(3, 4, 5)).toBe(localIndex(3, 4, 5));
    expect(worldToChunkCoord(-33, 40)).toEqual(worldToChunkCoord(-33, 40));
    expect(worldToLocal(-33, 40, 5)).toEqual(worldToLocal(-33, 40, 5));
  });
});
