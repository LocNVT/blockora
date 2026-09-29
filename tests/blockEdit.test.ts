import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG } from '../src/config/constants';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import { ChunkStore } from '../src/world/ChunkStore';
import { setBlockAt, affectedChunks, type BlockChange } from '../src/world/blockEdit';

const { chunkWidth, chunkDepth, chunkHeight } = WORLD_CONFIG;

describe('setBlockAt: changed', () => {
  it('writes a new block and returns a BlockChange with previous/next ids', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, 1, 2, 3, BlockId.Stone);
    expect(change).not.toBeNull();
    expect(change?.previous).toBe(BlockId.Air);
    expect(change?.next).toBe(BlockId.Stone);
    expect(store.getBlock(1, 2, 3)).toBe(BlockId.Stone);
  });

  it('breaking a block (writing Air over a solid block) returns a BlockChange', () => {
    const store = new ChunkStore();
    store.setBlock(1, 2, 3, BlockId.Stone);
    const change = setBlockAt(store, blockRegistry, 1, 2, 3, BlockId.Air);
    expect(change).not.toBeNull();
    expect(change?.previous).toBe(BlockId.Stone);
    expect(change?.next).toBe(BlockId.Air);
    expect(store.getBlock(1, 2, 3)).toBe(BlockId.Air);
  });
});

describe('setBlockAt: unchanged', () => {
  it('returns null when writing the same id already present', () => {
    const store = new ChunkStore();
    store.setBlock(1, 2, 3, BlockId.Stone);
    const change = setBlockAt(store, blockRegistry, 1, 2, 3, BlockId.Stone);
    expect(change).toBeNull();
  });
});

describe('setBlockAt: y out of range', () => {
  it('returns null for y = -1', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, 0, -1, 0, BlockId.Stone);
    expect(change).toBeNull();
  });

  it('returns null for y = chunkHeight', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, 0, chunkHeight, 0, BlockId.Stone);
    expect(change).toBeNull();
  });
});

describe('setBlockAt: non-integer coords', () => {
  it('returns null for fractional coordinates', () => {
    const store = new ChunkStore();
    expect(setBlockAt(store, blockRegistry, 1.5, 0, 0, BlockId.Stone)).toBeNull();
    expect(setBlockAt(store, blockRegistry, 0, 0.5, 0, BlockId.Stone)).toBeNull();
    expect(setBlockAt(store, blockRegistry, 0, 0, 1.5, BlockId.Stone)).toBeNull();
  });
});

describe('setBlockAt: invalid id', () => {
  it('throws a RangeError for an unregistered block id', () => {
    const store = new ChunkStore();
    expect(() => setBlockAt(store, blockRegistry, 0, 0, 0, 9999)).toThrow(RangeError);
  });
});

describe('setBlockAt: negative coordinates', () => {
  it('maps to the correct chunk/local coordinate', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, -1, 0, -1, BlockId.Grass);
    expect(change).not.toBeNull();
    expect(change?.cx).toBe(-1);
    expect(change?.cz).toBe(-1);
    expect(change?.lx).toBe(chunkWidth - 1);
    expect(change?.lz).toBe(chunkDepth - 1);
    expect(store.getBlock(-1, 0, -1)).toBe(BlockId.Grass);
  });
});

describe('setBlockAt: Air into a missing chunk', () => {
  it('returns null and does not create a chunk', () => {
    const store = new ChunkStore();
    expect(store.getChunk(5, 5)).toBeUndefined();
    const change = setBlockAt(store, blockRegistry, 5 * chunkWidth, 0, 5 * chunkDepth, BlockId.Air);
    expect(change).toBeNull();
    expect(store.getChunk(5, 5)).toBeUndefined();
  });
});

describe('affectedChunks: interior block', () => {
  it('returns exactly the block\'s own chunk', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, 5, 5, 5, BlockId.Stone) as BlockChange;
    const coords = affectedChunks(change);
    expect(coords).toEqual([{ cx: 0, cz: 0 }]);
  });
});

describe('affectedChunks: -X boundary (lx = 0)', () => {
  it('includes the -X neighbour', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, 0, 5, 5, BlockId.Stone) as BlockChange;
    const coords = affectedChunks(change);
    expect(coords).toEqual([
      { cx: 0, cz: 0 },
      { cx: -1, cz: 0 },
    ]);
  });
});

describe('affectedChunks: +X boundary (lx = chunkWidth-1)', () => {
  it('includes the +X neighbour', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, chunkWidth - 1, 5, 5, BlockId.Stone) as BlockChange;
    const coords = affectedChunks(change);
    expect(coords).toEqual([
      { cx: 0, cz: 0 },
      { cx: 1, cz: 0 },
    ]);
  });
});

describe('affectedChunks: -Z/+Z boundaries', () => {
  it('lz = 0 includes the -Z neighbour', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, 5, 5, 0, BlockId.Stone) as BlockChange;
    const coords = affectedChunks(change);
    expect(coords).toEqual([
      { cx: 0, cz: 0 },
      { cx: 0, cz: -1 },
    ]);
  });

  it('lz = chunkDepth-1 includes the +Z neighbour', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, 5, 5, chunkDepth - 1, BlockId.Stone) as BlockChange;
    const coords = affectedChunks(change);
    expect(coords).toEqual([
      { cx: 0, cz: 0 },
      { cx: 0, cz: 1 },
    ]);
  });
});

describe('affectedChunks: corner', () => {
  it('lx=0, lz=0 yields exactly 3 unique chunks', () => {
    const store = new ChunkStore();
    const change = setBlockAt(store, blockRegistry, 0, 5, 0, BlockId.Stone) as BlockChange;
    const coords = affectedChunks(change);
    expect(coords).toEqual([
      { cx: 0, cz: 0 },
      { cx: -1, cz: 0 },
      { cx: 0, cz: -1 },
    ]);
    const keys = new Set(coords.map((c) => `${c.cx},${c.cz}`));
    expect(keys.size).toBe(3);
  });

  it('lx=chunkWidth-1, lz=chunkDepth-1 yields exactly 3 unique chunks', () => {
    const store = new ChunkStore();
    const change = setBlockAt(
      store,
      blockRegistry,
      chunkWidth - 1,
      5,
      chunkDepth - 1,
      BlockId.Stone,
    ) as BlockChange;
    const coords = affectedChunks(change);
    expect(coords).toEqual([
      { cx: 0, cz: 0 },
      { cx: 1, cz: 0 },
      { cx: 0, cz: 1 },
    ]);
    const keys = new Set(coords.map((c) => `${c.cx},${c.cz}`));
    expect(keys.size).toBe(3);
  });
});

describe('affectedChunks: negative chunk coordinates', () => {
  it('resolves boundary neighbours correctly across negative chunk columns', () => {
    const store = new ChunkStore();
    // World x = -16 is local x=0 of chunk cx=-1.
    const change = setBlockAt(store, blockRegistry, -chunkWidth, 5, -5, BlockId.Stone) as BlockChange;
    expect(change.cx).toBe(-1);
    const coords = affectedChunks(change);
    expect(coords).toEqual([
      { cx: -1, cz: -1 },
      { cx: -2, cz: -1 },
    ]);
  });
});
