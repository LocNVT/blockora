import { describe, it, expect } from 'vitest';
import { ChunkManager } from '../src/world/ChunkManager';
import { ChunkStore } from '../src/world/ChunkStore';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { blockRegistry } from '../src/world/BlockRegistry';
import type { ChunkMeshSink } from '../src/world/mesher/remesh';
import type { ChunkMeshData } from '../src/world/mesher/MeshBuffers';
import { chunkKey } from '../src/world/chunkCoords';

/** Records every upsert/remove call by chunk key, for assertions (no real Three.js rendering). */
class RecordingSink implements ChunkMeshSink {
  readonly upserts: { cx: number; cz: number; data: ChunkMeshData }[] = [];
  readonly removes: { cx: number; cz: number }[] = [];

  upsert(cx: number, cz: number, data: ChunkMeshData): void {
    this.upserts.push({ cx, cz, data });
  }

  remove(cx: number, cz: number): void {
    this.removes.push({ cx, cz });
  }

  upsertedKeys(): Set<string> {
    return new Set(this.upserts.map((u) => chunkKey(u.cx, u.cz)));
  }
}

function squareArea(radius: number): number {
  return (radius * 2 + 1) ** 2;
}

describe('ChunkManager loading', () => {
  it('loads every chunk within radius of the center after loadAllPending, none outside it', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    const radius = 2;
    const manager = new ChunkManager(store, generator, blockRegistry, sink, radius);

    manager.update({ cx: 0, cz: 0 });
    manager.loadAllPending();

    const loaded = Array.from(store.chunks(), (c) => ({ cx: c.cx, cz: c.cz }));
    expect(loaded.length).toBe(squareArea(radius));

    for (const { cx, cz } of loaded) {
      expect(Math.max(Math.abs(cx), Math.abs(cz))).toBeLessThanOrEqual(radius);
    }
  });

  it('respects maxLoadsPerUpdate: a single update() call loads at most that many new chunks', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    const radius = 3;
    const maxLoadsPerUpdate = 5;
    const manager = new ChunkManager(store, generator, blockRegistry, sink, radius, maxLoadsPerUpdate);

    manager.update({ cx: 0, cz: 0 });

    const loadedCount = Array.from(store.chunks()).length;
    expect(loadedCount).toBeLessThanOrEqual(maxLoadsPerUpdate);
    expect(loadedCount).toBeGreaterThan(0);
  });

  it('always loads the center chunk first regardless of budget', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    const manager = new ChunkManager(store, generator, blockRegistry, sink, 5, 1);

    manager.update({ cx: 10, cz: -10 });

    expect(store.hasChunk(10, -10)).toBe(true);
  });

  it('eventually finishes loading the full radius across repeated update() calls with the same center', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    const radius = 2;
    const manager = new ChunkManager(store, generator, blockRegistry, sink, radius, 3);

    const center = { cx: 0, cz: 0 };
    for (let i = 0; i < 20 && Array.from(store.chunks()).length < squareArea(radius); i += 1) {
      manager.update(center);
    }

    expect(Array.from(store.chunks()).length).toBe(squareArea(radius));
  });

  it('is a no-op (no new loads) on repeated update() calls once fully loaded and center unchanged', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    const manager = new ChunkManager(store, generator, blockRegistry, sink, 1);

    const center = { cx: 0, cz: 0 };
    manager.update(center);
    manager.loadAllPending();
    const upsertCountAfterFullLoad = sink.upserts.length;

    manager.update(center);
    manager.update(center);

    expect(sink.upserts.length).toBe(upsertCountAfterFullLoad);
  });

  it('stays correct under rapid center oscillation between two adjacent chunks', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    const radius = 1;
    const manager = new ChunkManager(store, generator, blockRegistry, sink, radius);

    const a = { cx: 0, cz: 0 };
    const b = { cx: 1, cz: 0 };
    const oscillationSteps = 10;

    // Bounce back and forth every call, before either side ever fully loads
    // via loadAllPending — this exercises unload/reload churn on the chunks
    // that fall out of one radius and back into the other's every step.
    for (let i = 0; i < oscillationSteps; i += 1) {
      manager.update(i % 2 === 0 ? a : b);
    }

    const finalCenter = (oscillationSteps - 1) % 2 === 0 ? a : b;
    const loaded = Array.from(store.chunks(), (c) => ({ cx: c.cx, cz: c.cz }));

    // Whatever the final desired set is, every loaded chunk must be within
    // radius of the final center (no stale chunk left behind by the churn),
    // and the center chunk itself must always be present.
    for (const { cx, cz } of loaded) {
      expect(Math.max(Math.abs(cx - finalCenter.cx), Math.abs(cz - finalCenter.cz))).toBeLessThanOrEqual(radius);
    }
    expect(store.hasChunk(finalCenter.cx, finalCenter.cz)).toBe(true);
  });
});

describe('ChunkManager unloading', () => {
  it('unloads chunks that fall outside the new radius when the center moves far away', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    const radius = 1;
    const manager = new ChunkManager(store, generator, blockRegistry, sink, radius);

    manager.update({ cx: 0, cz: 0 });
    manager.loadAllPending();
    expect(Array.from(store.chunks()).length).toBe(squareArea(radius));

    // Far enough that none of the old area overlaps the new one.
    manager.update({ cx: 100, cz: 100 });

    for (const chunk of store.chunks()) {
      expect(Math.max(Math.abs(chunk.cx - 100), Math.abs(chunk.cz - 100))).toBeLessThanOrEqual(radius);
    }
    expect(store.hasChunk(0, 0)).toBe(false);
  });

  it('calls sink.remove for every chunk that gets unloaded', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    const manager = new ChunkManager(store, generator, blockRegistry, sink, 1);

    manager.update({ cx: 0, cz: 0 });
    manager.loadAllPending();
    const loadedBefore = Array.from(store.chunks(), (c) => ({ cx: c.cx, cz: c.cz }));

    manager.update({ cx: 50, cz: 50 });

    const removedKeys = new Set(sink.removes.map((r) => chunkKey(r.cx, r.cz)));
    for (const { cx, cz } of loadedBefore) {
      expect(removedKeys.has(chunkKey(cx, cz))).toBe(true);
    }
  });

  it('keeps a chunk loaded (no unload) when the new radius still overlaps it', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    const manager = new ChunkManager(store, generator, blockRegistry, sink, 2);

    manager.update({ cx: 0, cz: 0 });
    manager.loadAllPending();

    // Shift the center by 1 chunk; radius 2 still overlaps most of the old area.
    manager.update({ cx: 1, cz: 0 });
    manager.loadAllPending();

    expect(store.hasChunk(0, 0)).toBe(true);
  });
});

describe('ChunkManager neighbour remeshing', () => {
  it('remeshes an already-loaded neighbour when a new chunk loads next to it', () => {
    const store = new ChunkStore();
    const generator = new WorldGenerator(1);
    const sink = new RecordingSink();
    // Radius 2 around (0,0) covers cx in [-2, 2]; moving the center to (1, 0)
    // still covers cx in [-1, 3] — (2, 0) is in both sets (survives, already
    // loaded), while (3, 0) is genuinely new and sits right next to it.
    const manager = new ChunkManager(store, generator, blockRegistry, sink, 2, 1);

    manager.update({ cx: 0, cz: 0 });
    manager.loadAllPending();
    expect(store.hasChunk(2, 0)).toBe(true);
    sink.upserts.length = 0; // clear the initial upsert log

    manager.update({ cx: 1, cz: 0 });
    manager.loadAllPending();

    // (3,0) is a newly-loaded chunk; (2,0) is its already-loaded neighbour and
    // must have been remeshed too (its boundary previously sampled Air here).
    const keys = sink.upsertedKeys();
    expect(store.hasChunk(2, 0)).toBe(true);
    expect(keys.has(chunkKey(3, 0))).toBe(true);
    expect(keys.has(chunkKey(2, 0))).toBe(true);
  });
});
