import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG } from '../src/config/constants';
import { ChunkStore } from '../src/world/ChunkStore';
import { BlockId } from '../src/world/blocks';

const { chunkWidth, chunkHeight } = WORLD_CONFIG;

describe('ChunkStore get/set', () => {
  it('round-trips a block through setBlock/getBlock', () => {
    const store = new ChunkStore();
    expect(store.setBlock(1, 2, 3, BlockId.Stone)).toBe(true);
    expect(store.getBlock(1, 2, 3)).toBe(BlockId.Stone);
  });

  it('getOrCreateChunk creates a chunk on first access and reuses it after', () => {
    const store = new ChunkStore();
    expect(store.getChunk(0, 0)).toBeUndefined();

    const created = store.getOrCreateChunk(0, 0);
    expect(store.getChunk(0, 0)).toBe(created);
    expect(store.getOrCreateChunk(0, 0)).toBe(created);
  });

  it('setChunk stores a chunk retrievable by getChunk', () => {
    const store = new ChunkStore();
    const chunk = store.getOrCreateChunk(3, -2);
    const otherStore = new ChunkStore();
    otherStore.setChunk(chunk);
    expect(otherStore.getChunk(3, -2)).toBe(chunk);
  });

  it('hasChunk reflects whether a chunk is currently loaded', () => {
    const store = new ChunkStore();
    expect(store.hasChunk(0, 0)).toBe(false);
    store.getOrCreateChunk(0, 0);
    expect(store.hasChunk(0, 0)).toBe(true);
  });

  it('removeChunk unloads a chunk and returns true; getChunk/hasChunk reflect the removal', () => {
    const store = new ChunkStore();
    store.getOrCreateChunk(5, 5);

    expect(store.removeChunk(5, 5)).toBe(true);
    expect(store.hasChunk(5, 5)).toBe(false);
    expect(store.getChunk(5, 5)).toBeUndefined();
  });

  it('removeChunk returns false for a chunk that was never loaded', () => {
    const store = new ChunkStore();
    expect(store.removeChunk(9, 9)).toBe(false);
  });

  it('getBlock reads Air again after the chunk holding that block is removed', () => {
    const store = new ChunkStore();
    store.setBlock(0, 0, 0, BlockId.Stone);
    expect(store.getBlock(0, 0, 0)).toBe(BlockId.Stone);

    store.removeChunk(0, 0);
    expect(store.getBlock(0, 0, 0)).toBe(BlockId.Air);
  });
});

describe('ChunkStore missing chunk', () => {
  it('getBlock returns Air for an unloaded chunk', () => {
    const store = new ChunkStore();
    expect(store.getBlock(100, 5, 100)).toBe(BlockId.Air);
  });
});

describe('ChunkStore y out of range', () => {
  it('getBlock returns Air below y=0 and at/above chunkHeight', () => {
    const store = new ChunkStore();
    store.setBlock(0, 0, 0, BlockId.Stone);
    expect(store.getBlock(0, -1, 0)).toBe(BlockId.Air);
    expect(store.getBlock(0, chunkHeight, 0)).toBe(BlockId.Air);
  });

  it('setBlock returns false and does not create a chunk for out-of-range y', () => {
    const store = new ChunkStore();
    expect(store.setBlock(0, -1, 0, BlockId.Stone)).toBe(false);
    expect(store.setBlock(0, chunkHeight, 0, BlockId.Stone)).toBe(false);
    expect(store.getChunk(0, 0)).toBeUndefined();
  });
});

describe('ChunkStore negative world coordinates', () => {
  it('places a block in the correct chunk/local coordinate for negative x/z', () => {
    const store = new ChunkStore();
    expect(store.setBlock(-1, 0, -1, BlockId.Grass)).toBe(true);
    expect(store.getBlock(-1, 0, -1)).toBe(BlockId.Grass);

    // -1 in world x/z lands in chunk (-1, -1) at local (chunkWidth-1, chunkWidth-1).
    const chunk = store.getChunk(-1, -1);
    expect(chunk).toBeDefined();
    expect(chunk?.getBlock(chunkWidth - 1, 0, chunkWidth - 1)).toBe(BlockId.Grass);
  });

  it('distinguishes blocks across a negative chunk boundary', () => {
    const store = new ChunkStore();
    store.setBlock(-1, 0, 0, BlockId.Stone);
    store.setBlock(0, 0, 0, BlockId.Sand);

    expect(store.getBlock(-1, 0, 0)).toBe(BlockId.Stone);
    expect(store.getBlock(0, 0, 0)).toBe(BlockId.Sand);
  });

  it('floors fractional world coordinates before indexing', () => {
    const store = new ChunkStore();
    store.setBlock(2, 3, 4, BlockId.IronOre);
    expect(store.getBlock(2.9, 3.9, 4.9)).toBe(BlockId.IronOre);
    expect(store.getBlock(-0.1, 0, 0)).toBe(store.getBlock(-1, 0, 0));
  });
});
