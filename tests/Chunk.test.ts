import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG } from '../src/config/constants';
import { Chunk } from '../src/world/Chunk';
import { BlockId } from '../src/world/blocks';
import { CHUNK_VOLUME } from '../src/world/chunkCoords';

const { chunkWidth, chunkDepth, chunkHeight } = WORLD_CONFIG;

describe('Chunk construction', () => {
  it('defaults to an all-Air, zero-filled block array of the correct length', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.blocks.length).toBe(CHUNK_VOLUME);
    expect(chunk.blocks.every((b) => b === BlockId.Air)).toBe(true);
  });

  it('accepts an existing Uint8Array of the correct length', () => {
    const backing = new Uint8Array(CHUNK_VOLUME);
    backing[0] = BlockId.Stone;
    const chunk = new Chunk(2, -3, backing);
    expect(chunk.blocks).toBe(backing);
    expect(chunk.getBlock(0, 0, 0)).toBe(BlockId.Stone);
  });

  it('throws when given a Uint8Array of the wrong length', () => {
    expect(() => new Chunk(0, 0, new Uint8Array(10))).toThrow();
  });

  it('stores chunk coordinates', () => {
    const chunk = new Chunk(5, -7);
    expect(chunk.cx).toBe(5);
    expect(chunk.cz).toBe(-7);
  });
});

describe('get/set roundtrip', () => {
  it('returns what was set at a given position', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.setBlock(1, 2, 3, BlockId.Stone)).toBe(true);
    expect(chunk.getBlock(1, 2, 3)).toBe(BlockId.Stone);
  });

  it('supports boundary coordinates', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.setBlock(0, 0, 0, BlockId.Dirt)).toBe(true);
    expect(chunk.getBlock(0, 0, 0)).toBe(BlockId.Dirt);

    expect(chunk.setBlock(chunkWidth - 1, chunkHeight - 1, chunkDepth - 1, BlockId.Grass)).toBe(
      true,
    );
    expect(chunk.getBlock(chunkWidth - 1, chunkHeight - 1, chunkDepth - 1)).toBe(BlockId.Grass);
  });
});

describe('out-of-bounds handling', () => {
  it('getBlock returns Air for out-of-bounds coordinates', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.getBlock(-1, 0, 0)).toBe(BlockId.Air);
    expect(chunk.getBlock(chunkWidth, 0, 0)).toBe(BlockId.Air);
    expect(chunk.getBlock(0, chunkHeight, 0)).toBe(BlockId.Air);
    expect(chunk.getBlock(0, 0, chunkDepth)).toBe(BlockId.Air);
  });

  it('setBlock returns false and does not throw for out-of-bounds coordinates', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.setBlock(-1, 0, 0, BlockId.Stone)).toBe(false);
    expect(chunk.setBlock(chunkWidth, 0, 0, BlockId.Stone)).toBe(false);
    expect(chunk.dirty).toBe(false);
  });
});

describe('dirty flag', () => {
  it('starts clean', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.dirty).toBe(false);
  });

  it('becomes dirty only when a block actually changes', () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.setBlock(0, 0, 0, BlockId.Air)).toBe(false); // no-op, already Air
    expect(chunk.dirty).toBe(false);

    expect(chunk.setBlock(0, 0, 0, BlockId.Stone)).toBe(true);
    expect(chunk.dirty).toBe(true);
  });

  it('markClean resets the flag', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BlockId.Stone);
    expect(chunk.dirty).toBe(true);
    chunk.markClean();
    expect(chunk.dirty).toBe(false);
  });

  it('setting the same id again does not re-dirty after markClean', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BlockId.Stone);
    chunk.markClean();
    expect(chunk.setBlock(0, 0, 0, BlockId.Stone)).toBe(false);
    expect(chunk.dirty).toBe(false);
  });
});

describe('invalid ids', () => {
  it('throws a RangeError for negative ids', () => {
    const chunk = new Chunk(0, 0);
    expect(() => chunk.setBlock(0, 0, 0, -1)).toThrow(RangeError);
  });

  it('throws a RangeError for ids above 255', () => {
    const chunk = new Chunk(0, 0);
    expect(() => chunk.setBlock(0, 0, 0, 256)).toThrow(RangeError);
  });

  it('throws a RangeError for non-integer ids', () => {
    const chunk = new Chunk(0, 0);
    expect(() => chunk.setBlock(0, 0, 0, 1.5)).toThrow(RangeError);
  });
});

describe('determinism', () => {
  it('identical writes on two chunks produce identical byte arrays', () => {
    const a = new Chunk(0, 0);
    const b = new Chunk(0, 0);

    const writes: Array<[number, number, number, number]> = [
      [0, 0, 0, BlockId.Stone],
      [5, 10, 3, BlockId.Grass],
      [15, 127, 15, BlockId.Water],
      [8, 64, 8, BlockId.IronOre],
    ];

    for (const [x, y, z, id] of writes) {
      a.setBlock(x, y, z, id);
      b.setBlock(x, y, z, id);
    }

    expect(a.blocks).toEqual(b.blocks);
  });
});
