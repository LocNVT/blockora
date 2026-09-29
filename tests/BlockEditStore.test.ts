import { describe, it, expect } from 'vitest';
import { BlockEditStore } from '../src/world/BlockEditStore';
import { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import { ChunkManager } from '../src/world/ChunkManager';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { LightEngine, MAX_LIGHT, skyLightOf } from '../src/world/light';
import { blockRegistry } from '../src/world/BlockRegistry';
import { BlockId } from '../src/world/blocks';
import { setBlockAt, type BlockChange } from '../src/world/blockEdit';
import { localIndex } from '../src/world/chunkCoords';
import type { ChunkMeshSink } from '../src/world/mesher/remesh';
import { WORLD_CONFIG } from '../src/config/constants';

function change(overrides: Partial<BlockChange>): BlockChange {
  return {
    wx: 1,
    wy: 10,
    wz: 2,
    cx: 0,
    cz: 0,
    lx: 1,
    ly: 10,
    lz: 2,
    previous: BlockId.Stone,
    next: BlockId.Air,
    ...overrides,
  };
}

class NullSink implements ChunkMeshSink {
  upsert(): void {}
  remove(): void {}
}

/** Highest non-Air block in the column at local (x, z), or -1. */
function surfaceY(chunk: Chunk, x: number, z: number): number {
  for (let y = WORLD_CONFIG.chunkHeight - 1; y >= 0; y -= 1) {
    if (chunk.getBlock(x, y, z) !== BlockId.Air) {
      return y;
    }
  }
  return -1;
}

describe('BlockEditStore record/apply', () => {
  it('records an edit and applies it to a regenerated chunk', () => {
    const edits = new BlockEditStore();
    edits.record(change({ previous: BlockId.Stone, next: BlockId.Planks }));
    expect(edits.editAt(0, 0, localIndex(1, 10, 2))).toBe(BlockId.Planks);

    const chunk = new Chunk(0, 0);
    chunk.blocks[localIndex(1, 10, 2)] = BlockId.Stone;
    expect(edits.applyTo(chunk)).toBe(1);
    expect(chunk.getBlock(1, 10, 2)).toBe(BlockId.Planks);
  });

  it('keeps only the latest block per position', () => {
    const edits = new BlockEditStore();
    edits.record(change({ previous: BlockId.Stone, next: BlockId.Air }));
    edits.record(change({ previous: BlockId.Air, next: BlockId.Glass }));
    expect(edits.editCount).toBe(1);
    expect(edits.editAt(0, 0, localIndex(1, 10, 2))).toBe(BlockId.Glass);
  });

  it('drops the entry (and the chunk) when a block is reverted to its generated value', () => {
    const edits = new BlockEditStore();
    edits.record(change({ previous: BlockId.Stone, next: BlockId.Air }));
    edits.record(change({ previous: BlockId.Air, next: BlockId.Stone }));
    expect(edits.editCount).toBe(0);
    expect(edits.chunkCount).toBe(0);
  });

  it('applyTo leaves chunks without edits untouched and learns originals for restored entries', () => {
    const edits = new BlockEditStore();
    edits.restore([{ cx: 0, cz: 0, indices: new Uint16Array([localIndex(1, 10, 2)]), blocks: new Uint8Array([BlockId.Air]) }]);
    const other = new Chunk(5, 5);
    expect(edits.applyTo(other)).toBe(0);

    const chunk = new Chunk(0, 0);
    chunk.blocks[localIndex(1, 10, 2)] = BlockId.Dirt;
    edits.applyTo(chunk);
    // The original (Dirt) is now known, so putting Dirt back drops the entry.
    edits.record(change({ previous: BlockId.Air, next: BlockId.Dirt }));
    expect(edits.chunkCount).toBe(0);
  });

  it('applyTo drops restored entries that already match the generated block', () => {
    const edits = new BlockEditStore();
    edits.restore([{ cx: 0, cz: 0, indices: new Uint16Array([7]), blocks: new Uint8Array([BlockId.Air]) }]);
    expect(edits.applyTo(new Chunk(0, 0))).toBe(0);
    expect(edits.chunkCount).toBe(0);
    expect(edits.takeDirty().deletes).toEqual([{ cx: 0, cz: 0 }]);
  });
});

describe('BlockEditStore dirty tracking', () => {
  it('restore is clean; record marks only the edited chunk dirty', () => {
    const edits = new BlockEditStore();
    edits.restore([{ cx: 3, cz: 3, indices: new Uint16Array([1]), blocks: new Uint8Array([BlockId.Stone]) }]);
    expect(edits.hasDirty()).toBe(false);

    edits.record(change({ cx: -1, cz: 2, next: BlockId.Glass }));
    const dirty = edits.takeDirty();
    expect(dirty.puts.map(({ cx, cz }) => [cx, cz])).toEqual([[-1, 2]]);
    expect(dirty.deletes).toEqual([]);
    expect(edits.hasDirty()).toBe(false);
  });

  it('encodes records as ascending Uint16 indices + Uint8 ids and snapshots are copies', () => {
    const edits = new BlockEditStore();
    edits.record(change({ lx: 5, next: BlockId.Glass }));
    edits.record(change({ lx: 0, next: BlockId.Planks }));
    const [record] = edits.takeDirty().puts;
    expect(record?.indices).toBeInstanceOf(Uint16Array);
    expect(record?.blocks).toBeInstanceOf(Uint8Array);
    expect(Array.from(record?.indices ?? [])).toEqual([localIndex(0, 10, 2), localIndex(5, 10, 2)]);
    expect(Array.from(record?.blocks ?? [])).toEqual([BlockId.Planks, BlockId.Glass]);

    edits.record(change({ lx: 0, previous: BlockId.Planks, next: BlockId.Dirt }));
    expect(Array.from(record?.blocks ?? [])).toEqual([BlockId.Planks, BlockId.Glass]);
  });

  it('a chunk whose edits were all reverted becomes a delete; markDirty re-queues chunks', () => {
    const edits = new BlockEditStore();
    edits.record(change({}));
    edits.takeDirty();
    edits.record(change({ previous: BlockId.Air, next: BlockId.Stone }));
    const dirty = edits.takeDirty();
    expect(dirty.puts).toEqual([]);
    expect(dirty.deletes).toEqual([{ cx: 0, cz: 0 }]);

    edits.markDirty(dirty.deletes);
    expect(edits.takeDirty().deletes).toEqual([{ cx: 0, cz: 0 }]);
  });
});

describe('BlockEditStore + ChunkManager (chunk reload keeps edits)', () => {
  function setup(): { store: ChunkStore; edits: BlockEditStore; manager: ChunkManager; light: LightEngine } {
    const store = new ChunkStore();
    const edits = new BlockEditStore();
    const light = new LightEngine(store, blockRegistry);
    const manager = new ChunkManager(store, new WorldGenerator(1), blockRegistry, new NullSink(), 1, 100, light, edits);
    return { store, edits, manager, light };
  }

  it('edits survive the chunk unloading and loading again', () => {
    const { store, edits, manager } = setup();
    manager.update({ cx: 0, cz: 0 });
    const chunk = store.getChunk(0, 0);
    if (chunk === undefined) {
      throw new Error('chunk not loaded');
    }
    const y = surfaceY(chunk, 4, 4);
    const broken = setBlockAt(store, blockRegistry, 4, y, 4, BlockId.Air);
    const placed = setBlockAt(store, blockRegistry, 5, y + 1, 5, BlockId.Glass);
    if (broken === null || placed === null) {
      throw new Error('edit failed');
    }
    edits.record(broken);
    edits.record(placed);

    manager.update({ cx: 100, cz: 100 });
    expect(store.hasChunk(0, 0)).toBe(false);
    manager.update({ cx: 0, cz: 0 });

    expect(store.getBlock(4, y, 4)).toBe(BlockId.Air);
    expect(store.getBlock(5, y + 1, 5)).toBe(BlockId.Glass);
  });

  it('applies the diff before lighting and meshing', () => {
    const store = new ChunkStore();
    const edits = new BlockEditStore();
    const light = new LightEngine(store, blockRegistry);
    const meshedBlocks: number[] = [];
    let probe = { x: 0, y: 0, z: 0 };
    const sink: ChunkMeshSink = {
      upsert: (cx, cz) => {
        if (cx === 0 && cz === 0) {
          meshedBlocks.push(store.getBlock(probe.x, probe.y, probe.z));
        }
      },
      remove: () => {},
    };
    const manager = new ChunkManager(store, new WorldGenerator(1), blockRegistry, sink, 1, 100, light, edits);
    manager.update({ cx: 0, cz: 0 });
    const chunk = store.getChunk(0, 0);
    if (chunk === undefined) {
      throw new Error('chunk not loaded');
    }
    const y = surfaceY(chunk, 8, 8);
    probe = { x: 8, y, z: 8 };
    const broken = setBlockAt(store, blockRegistry, 8, y, 8, BlockId.Air);
    if (broken === null) {
      throw new Error('edit failed');
    }
    edits.record(broken);

    manager.update({ cx: 100, cz: 100 });
    meshedBlocks.length = 0;
    manager.update({ cx: 0, cz: 0 });

    // The first mesh built after reload already sees the edited (Air) block...
    expect(meshedBlocks[0]).toBe(BlockId.Air);
    // ...and lighting ran on the edited data: the removed surface block is open to the sky.
    const reloaded = store.getChunk(0, 0);
    expect(skyLightOf(reloaded?.light[localIndex(8, y, 8)] ?? 0)).toBe(MAX_LIGHT);
  });
});
