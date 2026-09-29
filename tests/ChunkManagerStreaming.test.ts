import { describe, it, expect } from 'vitest';
import { ChunkManager } from '../src/world/ChunkManager';
import { ChunkStore } from '../src/world/ChunkStore';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { BlockEditStore } from '../src/world/BlockEditStore';
import { LightEngine } from '../src/world/light/LightEngine';
import { blockRegistry } from '../src/world/BlockRegistry';
import { BlockId } from '../src/world/blocks';
import { chunkKey, localIndex, type ChunkCoord } from '../src/world/chunkCoords';
import { remeshChunks, type ChunkMeshSink } from '../src/world/mesher/remesh';
import { applyLightAndCollectRemesh, setBlockAt } from '../src/world/blockEdit';
import { MAX_LIGHT, skyLightOf } from '../src/world/light/lightNibbles';
import type { ChunkGenerationService, GeneratedChunk } from '../src/world/worker/ChunkGenerationService';
import { WORLD_CONFIG } from '../src/config/constants';

const SEED = 1;
const H = WORLD_CONFIG.chunkHeight;

interface Request {
  readonly id: number;
  readonly cx: number;
  readonly cz: number;
}

/** Asynchronous fake: requests are recorded; results arrive only when the test delivers them. */
class FakeService implements ChunkGenerationService {
  readonly location = 'worker' as const;
  readonly requests: Request[] = [];
  readonly cancelled = new Set<number>();
  private readonly delivered = new Set<number>();
  private ready: GeneratedChunk[] = [];
  private readonly generator = new WorldGenerator(SEED);

  request(id: number, cx: number, cz: number): void {
    this.requests.push({ id, cx, cz });
  }

  poll(max: number): GeneratedChunk[] {
    return this.ready.splice(0, max);
  }

  cancel(id: number): void {
    this.cancelled.add(id);
    this.ready = this.ready.filter((result) => result.id !== id);
  }

  dispose(): void {
    this.ready = [];
  }

  /** Requests neither cancelled nor delivered. */
  outstanding(): Request[] {
    return this.requests.filter((r) => !this.cancelled.has(r.id) && !this.delivered.has(r.id));
  }

  /** Completes an outstanding request (by coordinate, or the oldest). */
  deliver(coord?: ChunkCoord): Request {
    const request = this.outstanding().find((r) => coord === undefined || (r.cx === coord.cx && r.cz === coord.cz));
    if (request === undefined) {
      throw new Error(`no outstanding request for ${coord ? chunkKey(coord.cx, coord.cz) : 'any chunk'}`);
    }
    this.inject(request);
    return request;
  }

  deliverAll(): void {
    for (const request of this.outstanding()) {
      this.inject(request);
    }
  }

  /** Pushes a result regardless of cancellation (simulates a late / stale arrival). */
  inject(request: Request): void {
    this.delivered.add(request.id);
    const blocks = this.generator.generateChunk(request.cx, request.cz).blocks;
    this.ready.push({ id: request.id, cx: request.cx, cz: request.cz, blocks, genMs: 3 });
  }
}

class CountingSink implements ChunkMeshSink {
  readonly upserts: string[] = [];
  readonly removes: string[] = [];
  upsert(cx: number, cz: number): void {
    this.upserts.push(chunkKey(cx, cz));
  }
  remove(cx: number, cz: number): void {
    this.removes.push(chunkKey(cx, cz));
  }
  count(key: string): number {
    return this.upserts.filter((k) => k === key).length;
  }
}

interface Setup {
  store: ChunkStore;
  sink: CountingSink;
  service: FakeService;
  manager: ChunkManager;
  light: LightEngine;
  edits: BlockEditStore;
}

function setup(radius: number, budget = 4, maxInFlight = 8, sink: ChunkMeshSink = new CountingSink()): Setup {
  const store = new ChunkStore();
  const service = new FakeService();
  const light = new LightEngine(store, blockRegistry);
  const edits = new BlockEditStore();
  const manager = new ChunkManager(
    store,
    new WorldGenerator(SEED),
    blockRegistry,
    sink,
    radius,
    budget,
    light,
    edits,
    undefined,
    { service, maxInFlight },
  );
  return { store, sink: sink as CountingSink, service, manager, light, edits };
}

/** Streams until every desired chunk is loaded, delivering everything requested each frame. */
function streamAll(s: Setup, center: ChunkCoord, frames = 200): void {
  for (let i = 0; i < frames; i += 1) {
    s.manager.update(center);
    s.service.deliverAll();
  }
  s.manager.update(center);
}

function area(radius: number): number {
  return (radius * 2 + 1) ** 2;
}

describe('ChunkManager async generation: requests', () => {
  it('requests nearest-first, respects the in-flight cap, and never requests a chunk twice', () => {
    const s = setup(3, 4, 5);
    const center = { cx: 0, cz: 0 };
    s.manager.update(center);
    expect(s.service.outstanding()).toHaveLength(5);
    expect(s.service.requests[0]).toMatchObject({ cx: 0, cz: 0 });
    expect(s.manager.streaming).toMatchObject({ inFlight: 5, pending: area(3) - 5, generation: 'worker' });

    // Nothing delivered: repeated updates request nothing more.
    s.manager.update(center);
    s.manager.update(center);
    expect(s.service.requests).toHaveLength(5);

    streamAll(s, center);
    const keys = s.service.requests.map((r) => chunkKey(r.cx, r.cz));
    expect(new Set(keys).size).toBe(keys.length);
    expect(s.store.size).toBe(area(3));
    expect(s.manager.streaming).toMatchObject({ inFlight: 0, pending: 0 });
  });

  it('accepts at most maxLoadsPerUpdate results per update, keeping the rest for later frames', () => {
    const s = setup(2, 3, 25);
    const center = { cx: 0, cz: 0 };
    s.manager.update(center);
    s.service.deliverAll(); // 25 results ready at once
    s.manager.update(center);
    expect(s.store.size).toBe(3);
    s.manager.update(center);
    expect(s.store.size).toBe(6);
  });

  it('handles results arriving out of order', () => {
    const s = setup(1, 9, 9);
    const center = { cx: 0, cz: 0 };
    s.manager.update(center);
    const requested = [...s.service.outstanding()].reverse();
    for (const request of requested) {
      s.service.deliver(request);
    }
    s.manager.update(center);
    expect(s.store.size).toBe(9);
    const reference = new WorldGenerator(SEED);
    for (const chunk of s.store.chunks()) {
      expect(chunk.blocks).toEqual(reference.generateChunk(chunk.cx, chunk.cz).blocks);
      expect(s.light.isLit(chunk)).toBe(true);
    }
  });
});

describe('ChunkManager async generation: cancellation and staleness', () => {
  it('cancels in-flight requests that leave the desired area (unload while in flight)', () => {
    const s = setup(1, 4, 9);
    s.manager.update({ cx: 0, cz: 0 });
    const firstBatch = s.service.outstanding().map((r) => r.id);
    s.manager.update({ cx: 100, cz: 100 });
    for (const id of firstBatch) {
      expect(s.service.cancelled.has(id)).toBe(true);
    }
    expect(s.service.outstanding().every((r) => Math.abs(r.cx - 100) <= 1 && Math.abs(r.cz - 100) <= 1)).toBe(true);
  });

  it('drops a stale result that arrives after its request was cancelled', () => {
    const s = setup(1, 4, 9);
    s.manager.update({ cx: 0, cz: 0 });
    const stale = s.service.outstanding()[0] as Request;
    s.manager.update({ cx: 100, cz: 100 });
    s.service.inject(stale); // late arrival despite the cancel
    s.manager.update({ cx: 100, cz: 100 });
    expect(s.store.hasChunk(stale.cx, stale.cz)).toBe(false);
  });

  it('drops a superseded result and accepts only the current request for a chunk', () => {
    const s = setup(0, 4, 4);
    s.manager.update({ cx: 0, cz: 0 });
    const old = s.service.outstanding()[0] as Request;
    s.manager.update({ cx: 50, cz: 0 }); // cancels (0,0)
    s.manager.update({ cx: 0, cz: 0 }); // re-requests (0,0) with a new id
    const current = s.service.outstanding().find((r) => r.cx === 0 && r.cz === 0) as Request;
    expect(current.id).not.toBe(old.id);

    s.service.inject(old);
    s.manager.update({ cx: 0, cz: 0 });
    expect(s.store.hasChunk(0, 0)).toBe(false);
    expect(s.manager.streaming.inFlight).toBe(1);

    s.service.deliver({ cx: 0, cz: 0 });
    s.manager.update({ cx: 0, cz: 0 });
    expect(s.store.hasChunk(0, 0)).toBe(true);
    expect(s.manager.stats.chunksLoaded).toBe(1);
  });

  it('never double-inserts: a result for a chunk that got created meanwhile (block edit) is discarded', () => {
    const s = setup(0, 4, 4);
    s.manager.update({ cx: 0, cz: 0 });
    s.store.setBlock(1, 100, 1, BlockId.Stone); // creates chunk (0,0) while its request is in flight
    const created = s.store.getChunk(0, 0);
    s.service.deliver({ cx: 0, cz: 0 });
    s.manager.update({ cx: 0, cz: 0 });
    expect(s.store.getChunk(0, 0)).toBe(created);
    expect(s.manager.stats.chunksLoaded).toBe(0);
    expect(s.manager.streaming.inFlight).toBe(0);
  });

  it('warmUp supersedes in-flight requests: their late results are ignored', () => {
    const s = setup(1, 9, 9);
    s.manager.update({ cx: 0, cz: 0 });
    const requested = s.service.outstanding();
    s.manager.warmUp({ cx: 0, cz: 0 }); // loads center + ring synchronously, cancelling their requests
    const before = s.store.getChunk(0, 0);
    for (const request of requested) {
      s.service.inject(request);
    }
    s.manager.update({ cx: 0, cz: 0 });
    expect(s.store.getChunk(0, 0)).toBe(before);
    expect(s.manager.stats.chunksLoaded).toBe(9);
    expect(requested.every((r) => s.service.cancelled.has(r.id))).toBe(true);
  });
});

describe('ChunkManager async generation: edits, warm-up', () => {
  it('applies block-edit diffs to async-arrived chunks before lighting and meshing', () => {
    const probe = { x: 8, y: 0, z: 8 };
    let store: ChunkStore | null = null;
    const meshedBlocks: number[] = [];
    const sink: ChunkMeshSink = {
      upsert: (cx, cz) => {
        if (cx === 0 && cz === 0 && store !== null) {
          meshedBlocks.push(store.getBlock(probe.x, probe.y, probe.z));
        }
      },
      remove: () => undefined,
    };
    const s = setup(1, 9, 9, sink);
    store = s.store;
    const generated = new WorldGenerator(SEED).generateChunk(0, 0);
    let y = H - 1;
    while (y > 0 && generated.getBlock(8, y, 8) === BlockId.Air) {
      y -= 1;
    }
    probe.y = y;
    s.edits.record({
      wx: 8, wy: y, wz: 8, cx: 0, cz: 0, lx: 8, ly: y, lz: 8,
      previous: generated.getBlock(8, y, 8), next: BlockId.Air,
    });

    s.manager.update({ cx: 0, cz: 0 });
    s.service.deliverAll();
    s.manager.update({ cx: 0, cz: 0 });

    expect(meshedBlocks[0]).toBe(BlockId.Air);
    const chunk = s.store.getChunk(0, 0);
    expect(skyLightOf(chunk?.light[localIndex(8, y, 8)] ?? 0)).toBe(MAX_LIGHT);
  });

  it('warmUp loads the center and its ring synchronously and meshes the center immediately', () => {
    const s = setup(4);
    s.manager.warmUp({ cx: 3, cz: -2 });
    expect(s.store.size).toBe(9);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        expect(s.store.hasChunk(3 + dx, -2 + dz)).toBe(true);
      }
    }
    expect(s.sink.count(chunkKey(3, -2))).toBe(1);
    // The rest of the area was requested from the service.
    expect(s.service.outstanding().length).toBeGreaterThan(0);
    expect(s.service.outstanding().every((r) => Math.max(Math.abs(r.cx - 3), Math.abs(r.cz + 2)) > 1)).toBe(true);
  });

  it('warmUp at a far point (respawn) unloads the old area and loads the new center', () => {
    const s = setup(2);
    streamAll(s, { cx: 0, cz: 0 });
    s.manager.warmUp({ cx: 40, cz: 40 });
    expect(s.store.hasChunk(40, 40)).toBe(true);
    expect(s.store.hasChunk(0, 0)).toBe(false);
    s.manager.update({ cx: 40, cz: 40 }); // same center: no reset
    expect(s.store.hasChunk(40, 40)).toBe(true);
  });
});

describe('ChunkManager complete-neighbourhood meshing', () => {
  it('meshes each chunk exactly once while streaming a full area (edge chunks included)', () => {
    const s = setup(3);
    streamAll(s, { cx: 0, cz: 0 });
    expect(s.store.size).toBe(area(3));
    for (const chunk of s.store.chunks()) {
      expect(s.sink.count(chunkKey(chunk.cx, chunk.cz))).toBeGreaterThanOrEqual(1);
    }
    expect(s.sink.upserts.length).toBe(s.store.size);
  });

  it('does not mesh a chunk until its desired 3x3 neighbourhood is loaded', () => {
    const s = setup(2, 1, 25);
    const center = { cx: 0, cz: 0 };
    s.manager.update(center);
    s.service.deliver({ cx: 0, cz: 0 });
    s.manager.update(center);
    expect(s.store.hasChunk(0, 0)).toBe(true);
    expect(s.sink.count('0,0')).toBe(0);

    const neighbours = [
      { cx: -1, cz: 0 }, { cx: 1, cz: 0 }, { cx: 0, cz: -1 }, { cx: 0, cz: 1 },
      { cx: -1, cz: -1 }, { cx: 1, cz: -1 }, { cx: -1, cz: 1 },
    ];
    for (const n of neighbours) {
      s.service.deliver(n);
      s.manager.update(center);
    }
    expect(s.sink.count('0,0')).toBe(0);
    s.service.deliver({ cx: 1, cz: 1 });
    s.manager.update(center);
    expect(s.sink.count('0,0')).toBe(1);
  });

  it('meshes world-edge chunks whose missing neighbours are outside the desired radius', () => {
    const s = setup(1);
    streamAll(s, { cx: 0, cz: 0 });
    for (const key of ['1,1', '-1,-1', '1,0', '0,-1']) {
      expect(s.sink.count(key)).toBeGreaterThanOrEqual(1);
    }
  });

  it('remeshes an edge chunk when the center moves and its missing neighbour arrives', () => {
    const s = setup(1);
    streamAll(s, { cx: 0, cz: 0 });
    const edgeMeshes = s.sink.count('1,0');
    streamAll(s, { cx: 1, cz: 0 });
    expect(s.sink.count('1,0')).toBeGreaterThan(edgeMeshes);
    expect(s.sink.count('2,0')).toBeGreaterThanOrEqual(1);
  });

  it('meshes a chunk that became an edge chunk because the desired area moved away from its missing neighbour', () => {
    const s = setup(1, 9, 9);
    s.manager.update({ cx: 0, cz: 0 });
    // Only the x in {0, 1} columns arrive; x = 2 never does.
    const columns = [0, 1].flatMap((cx) => [-1, 0, 1].map((cz) => ({ cx, cz })));
    for (const coord of columns) {
      s.service.deliver(coord);
    }
    s.manager.update({ cx: 0, cz: 0 });
    expect(s.sink.count('1,0')).toBe(1); // (2,0) is outside radius 1 of (0,0)
    const s2 = setup(1, 9, 9);
    s2.manager.update({ cx: 1, cz: 0 }); // x = 2 desired
    for (const coord of columns) {
      s2.service.deliver(coord);
    }
    s2.manager.update({ cx: 1, cz: 0 });
    expect(s2.sink.count('1,0')).toBe(0); // waiting for x = 2
    s2.manager.update({ cx: 0, cz: 0 }); // x = 2 no longer desired -> (1,0) is complete
    expect(s2.sink.count('1,0')).toBe(1);
  });

  it('leaves no loaded chunk without a current mesh after the center wanders (reload, edges, jumps)', () => {
    const meshed = new Set<string>();
    const sink: ChunkMeshSink = {
      upsert: (cx, cz) => meshed.add(chunkKey(cx, cz)),
      remove: (cx, cz) => meshed.delete(chunkKey(cx, cz)),
    };
    const s = setup(2, 3, 6, sink);
    const path = [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }, { cx: 1, cz: 1 }, { cx: 0, cz: 3 }, { cx: 30, cz: -30 }, { cx: 0, cz: 0 }];
    for (const center of path) {
      streamAll(s, center);
      expect(s.store.size).toBe(area(2));
      for (const chunk of s.store.chunks()) {
        const key = chunkKey(chunk.cx, chunk.cz);
        expect(meshed.has(key), `chunk ${key} at center ${chunkKey(center.cx, center.cz)}`).toBe(true);
      }
      expect(meshed.size).toBe(area(2));
    }
  });

  it('block edits still remesh immediately, independently of streaming state', () => {
    const s = setup(2);
    streamAll(s, { cx: 0, cz: 0 });
    const before = s.sink.count('0,0');
    const chunk = s.store.getChunk(0, 0);
    let y = H - 1;
    while (y > 0 && chunk?.getBlock(4, y, 4) === BlockId.Air) {
      y -= 1;
    }
    const change = setBlockAt(s.store, blockRegistry, 4, y, 4, BlockId.Air);
    if (change === null) {
      throw new Error('edit failed');
    }
    remeshChunks(s.store, blockRegistry, s.sink, applyLightAndCollectRemesh(change, s.light));
    expect(s.sink.count('0,0')).toBe(before + 1);
    // The manager doesn't redo it on the next frame.
    const total = s.sink.upserts.length;
    s.manager.update({ cx: 0, cz: 0 });
    expect(s.sink.upserts.length).toBe(total);
  });
});
