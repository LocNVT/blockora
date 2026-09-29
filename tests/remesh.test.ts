import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG } from '../src/config/constants';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import { ChunkStore } from '../src/world/ChunkStore';
import { setBlockAt, affectedChunks } from '../src/world/blockEdit';
import { remeshChunks, type ChunkMeshSink } from '../src/world/mesher/remesh';
import type { ChunkMeshData } from '../src/world/mesher/MeshBuffers';
import { chunkKey } from '../src/world/chunkCoords';

const { chunkWidth, chunkDepth } = WORLD_CONFIG;

/** Records every upsert call by chunk key, for assertions. */
class RecordingSink implements ChunkMeshSink {
  readonly calls: { cx: number; cz: number; data: ChunkMeshData }[] = [];

  upsert(cx: number, cz: number, data: ChunkMeshData): void {
    this.calls.push({ cx, cz, data });
  }

  remove(_cx: number, _cz: number): void {
    // Not exercised by these tests (see ChunkManager.test.ts for unload behavior).
  }

  keys(): string[] {
    return this.calls.map((c) => chunkKey(c.cx, c.cz));
  }

  latestFor(cx: number, cz: number): ChunkMeshData | undefined {
    const key = chunkKey(cx, cz);
    for (let i = this.calls.length - 1; i >= 0; i -= 1) {
      const call = this.calls[i];
      if (call !== undefined && chunkKey(call.cx, call.cz) === key) {
        return call.data;
      }
    }
    return undefined;
  }
}

describe('remeshChunks: changed chunk', () => {
  it('remeshes the chunk containing the change', () => {
    const store = new ChunkStore();
    const sink = new RecordingSink();
    store.setBlock(5, 5, 5, BlockId.Stone);
    remeshChunks(store, blockRegistry, sink, [{ cx: 0, cz: 0 }]);
    expect(sink.keys()).toEqual(['0,0']);
  });
});

describe('remeshChunks: unrelated loaded chunk not remeshed', () => {
  it('only remeshes the coords passed in', () => {
    const store = new ChunkStore();
    store.setBlock(5, 5, 5, BlockId.Stone); // chunk (0,0)
    store.setBlock(100, 5, 5, BlockId.Stone); // far-away chunk, also loaded
    const sink = new RecordingSink();
    remeshChunks(store, blockRegistry, sink, [{ cx: 0, cz: 0 }]);
    expect(sink.keys()).toEqual(['0,0']);
  });
});

describe('remeshChunks: boundary changes remesh neighbours', () => {
  it('breaking a boundary block remeshes center + neighbour, in that order', () => {
    const store = new ChunkStore();
    store.setBlock(chunkWidth - 1, 5, 5, BlockId.Stone); // chunk (0,0), lx=15
    store.getOrCreateChunk(1, 0); // ensure the +X neighbour chunk exists
    const change = setBlockAt(store, blockRegistry, chunkWidth - 1, 5, 5, BlockId.Air);
    expect(change).not.toBeNull();

    const sink = new RecordingSink();
    const coords = change ? affectedChunks(change) : [];
    const remeshed = remeshChunks(store, blockRegistry, sink, coords);
    expect(remeshed).toEqual(['0,0', '1,0']);
    expect(sink.keys()).toEqual(['0,0', '1,0']);
  });

  it('-X boundary remeshes center + -X neighbour', () => {
    const store = new ChunkStore();
    store.setBlock(0, 5, 5, BlockId.Stone); // chunk (0,0), lx=0
    store.getOrCreateChunk(-1, 0);
    const change = setBlockAt(store, blockRegistry, 0, 5, 5, BlockId.Air);
    expect(change).not.toBeNull();
    const sink = new RecordingSink();
    const remeshed = remeshChunks(store, blockRegistry, sink, change ? affectedChunks(change) : []);
    expect(remeshed.sort()).toEqual(['-1,0', '0,0']);
  });

  it('+Z/-Z boundaries remesh the corresponding neighbour', () => {
    const store = new ChunkStore();
    store.setBlock(5, 5, chunkDepth - 1, BlockId.Stone); // lz = 15
    store.getOrCreateChunk(0, 1);
    const change = setBlockAt(store, blockRegistry, 5, 5, chunkDepth - 1, BlockId.Air);
    expect(change).not.toBeNull();
    const sink = new RecordingSink();
    const remeshed = remeshChunks(store, blockRegistry, sink, change ? affectedChunks(change) : []);
    expect(remeshed.sort()).toEqual(['0,0', '0,1']);
  });
});

describe('remeshChunks: corner change', () => {
  it('remeshes exactly 3 unique chunks, each once', () => {
    const store = new ChunkStore();
    store.setBlock(0, 5, 0, BlockId.Stone); // lx=0, lz=0 -> corner
    store.getOrCreateChunk(-1, 0);
    store.getOrCreateChunk(0, -1);
    const change = setBlockAt(store, blockRegistry, 0, 5, 0, BlockId.Air);
    expect(change).not.toBeNull();

    const sink = new RecordingSink();
    const remeshed = remeshChunks(store, blockRegistry, sink, change ? affectedChunks(change) : []);
    expect(remeshed.length).toBe(3);
    expect(new Set(remeshed).size).toBe(3);
    expect(new Set(remeshed)).toEqual(new Set(['0,0', '-1,0', '0,-1']));
    // Each remeshed exactly once.
    expect(sink.calls.length).toBe(3);
  });
});

describe('remeshChunks: missing neighbour skipped', () => {
  it('does not call upsert for a coordinate with no loaded chunk', () => {
    const store = new ChunkStore();
    store.setBlock(0, 5, 5, BlockId.Stone); // lx = 0, but -X neighbour never loaded
    const change = setBlockAt(store, blockRegistry, 0, 5, 5, BlockId.Air);
    expect(change).not.toBeNull();
    expect(store.getChunk(-1, 0)).toBeUndefined();

    const sink = new RecordingSink();
    const remeshed = remeshChunks(store, blockRegistry, sink, change ? affectedChunks(change) : []);
    expect(remeshed).toEqual(['0,0']);
  });
});

describe('remeshChunks: neighbour mesh reflects a newly exposed seam face', () => {
  it('breaking a boundary block exposes a new face in the neighbour mesh', () => {
    const store = new ChunkStore();
    // Solid wall spanning the seam: chunk (0,0) local x=15 and chunk (1,0) local x=0.
    store.setBlock(chunkWidth - 1, 5, 5, BlockId.Stone);
    store.setBlock(chunkWidth, 5, 5, BlockId.Stone);

    const beforeSink = new RecordingSink();
    remeshChunks(store, blockRegistry, beforeSink, [
      { cx: 0, cz: 0 },
      { cx: 1, cz: 0 },
    ]);
    const neighbourBefore = beforeSink.latestFor(1, 0);
    expect(neighbourBefore).toBeDefined();
    const facesBefore = (neighbourBefore?.opaque.indices.length ?? 0) / 6;

    // Break the block on the (0,0) side of the seam: the neighbour's -X face
    // (previously hidden against the now-gone block) becomes visible.
    const change = setBlockAt(store, blockRegistry, chunkWidth - 1, 5, 5, BlockId.Air);
    expect(change).not.toBeNull();

    const afterSink = new RecordingSink();
    remeshChunks(store, blockRegistry, afterSink, change ? affectedChunks(change) : []);
    const neighbourAfter = afterSink.latestFor(1, 0);
    expect(neighbourAfter).toBeDefined();
    const facesAfter = (neighbourAfter?.opaque.indices.length ?? 0) / 6;

    // The neighbour gained exactly one visible face (its -X face, now exposed).
    expect(facesAfter).toBe(facesBefore + 1);

    // Confirm the newly exposed quad's normal is -X (normalized Int8 -1).
    const normals = neighbourAfter?.opaque.normals ?? new Int8Array(0);
    let foundNegX = false;
    for (let i = 0; i < normals.length; i += 3) {
      if (normals[i] === -1 && normals[i + 1] === 0 && normals[i + 2] === 0) {
        foundNegX = true;
        break;
      }
    }
    expect(foundNegX).toBe(true);
  });
});

describe('remeshChunks: mesh before/after a break differs', () => {
  it('face/index count changes as expected after breaking the block', () => {
    const store = new ChunkStore();
    store.setBlock(5, 5, 5, BlockId.Stone);

    const beforeSink = new RecordingSink();
    remeshChunks(store, blockRegistry, beforeSink, [{ cx: 0, cz: 0 }]);
    const before = beforeSink.latestFor(0, 0);
    expect(before?.opaque.indices.length).toBe(36); // 6 faces

    const change = setBlockAt(store, blockRegistry, 5, 5, 5, BlockId.Air);
    expect(change).not.toBeNull();

    const afterSink = new RecordingSink();
    remeshChunks(store, blockRegistry, afterSink, change ? affectedChunks(change) : []);
    const after = afterSink.latestFor(0, 0);
    expect(after?.opaque.indices.length).toBe(0);
  });
});
