import { describe, it, expect } from 'vitest';
import { ChunkManager } from '../src/world/ChunkManager';
import { ChunkStore } from '../src/world/ChunkStore';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { BlockEditStore } from '../src/world/BlockEditStore';
import { LightEngine } from '../src/world/light/LightEngine';
import { blockRegistry } from '../src/world/BlockRegistry';
import { BlockId } from '../src/world/blocks';
import { chunkKey, localIndex, type ChunkCoord } from '../src/world/chunkCoords';
import type { ChunkMeshSink } from '../src/world/mesher/remesh';
import { applyLightAndCollectRemesh, setBlockAt } from '../src/world/blockEdit';
import { blockLightOf } from '../src/world/light/lightNibbles';
import type { PerfProbe } from '../src/debug/PerfStats';
import type { ChunkGenerationService, GeneratedChunk } from '../src/world/worker/ChunkGenerationService';
import { WORLD_CONFIG } from '../src/config/constants';

const SEED = 1;
const H = WORLD_CONFIG.chunkHeight;

interface Request {
  readonly id: number;
  readonly cx: number;
  readonly cz: number;
}

/** Asynchronous fake: results arrive only when delivered by the test. */
class FakeService implements ChunkGenerationService {
  readonly location = 'worker' as const;
  readonly requests: Request[] = [];
  private readonly cancelled = new Set<number>();
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
    this.ready = this.ready.filter((r) => r.id !== id);
  }
  dispose(): void {
    this.ready = [];
  }
  deliverAll(): void {
    for (const r of this.requests) {
      if (this.cancelled.has(r.id) || this.delivered.has(r.id)) continue;
      this.delivered.add(r.id);
      this.ready.push({ id: r.id, cx: r.cx, cz: r.cz, blocks: this.generator.generateChunk(r.cx, r.cz).blocks, genMs: 3 });
    }
  }
  requestedKeys(): string[] {
    return this.requests.map((r) => chunkKey(r.cx, r.cz));
  }
}

interface Setup {
  store: ChunkStore;
  service: FakeService;
  manager: ChunkManager;
  edits: BlockEditStore;
  light: LightEngine;
}

interface Options {
  readonly budget?: number;
  readonly cache?: number;
  readonly probe?: PerfProbe;
  readonly frameBudgetMs?: number;
}

function setup(radius: number, opts: Options = {}): Setup {
  const store = new ChunkStore();
  const service = new FakeService();
  const light = new LightEngine(store, blockRegistry);
  const edits = new BlockEditStore();
  const sink: ChunkMeshSink = { upsert: () => undefined, remove: () => undefined };
  const manager = new ChunkManager(
    store, new WorldGenerator(SEED), blockRegistry, sink, radius, opts.budget ?? 4, light, edits, opts.probe,
    { service, maxInFlight: 64, chunkCacheSize: opts.cache, frameBudgetMs: opts.frameBudgetMs },
  );
  return { store, service, manager, edits, light };
}

function streamAll(s: Setup, center: ChunkCoord, frames = 200): void {
  for (let i = 0; i < frames; i += 1) {
    s.manager.update(center);
    s.service.deliverAll();
  }
  s.manager.update(center);
}

function surfaceY(store: ChunkStore, x: number, z: number): number {
  let y = H - 1;
  while (y > 0 && store.getBlock(x, y, z) === BlockId.Air) y -= 1;
  return y;
}

const HOME = { cx: 0, cz: 0 };
const AWAY = { cx: 10, cz: 0 };

describe('ChunkManager chunk cache', () => {
  it('reloads unloaded chunks from the cache without any generation request', () => {
    const s = setup(1);
    streamAll(s, HOME);
    const firstRequests = s.service.requests.length;
    streamAll(s, AWAY);
    const awayRequests = s.service.requests.length;
    expect(awayRequests).toBe(firstRequests + 9);
    expect(s.manager.streaming.cache.size).toBe(9);

    streamAll(s, HOME);
    expect(s.service.requests.length).toBe(awayRequests);
    expect(s.store.size).toBe(9);
    expect(s.manager.streaming.cache).toMatchObject({ hits: 9, misses: 18, size: 9 });
  });

  it('restores identical blocks, including a player edit made before unloading', () => {
    const s = setup(1);
    streamAll(s, HOME);
    const y = surfaceY(s.store, 5, 5);
    const change = setBlockAt(s.store, blockRegistry, 5, y + 1, 5, BlockId.Planks);
    if (change === null) throw new Error('edit failed');
    s.edits.record(change);
    const before = s.store.getChunk(0, 0)?.blocks.slice();

    streamAll(s, AWAY);
    expect(s.store.hasChunk(0, 0)).toBe(false);
    streamAll(s, HOME);

    const chunk = s.store.getChunk(0, 0);
    expect(chunk?.blocks).toEqual(before);
    expect(chunk?.getBlock(5, y + 1, 5)).toBe(BlockId.Planks);
    // The diff store still holds the edit (a second applyTo would have dropped it).
    expect(s.edits.editAt(0, 0, localIndex(5, y + 1, 5))).toBe(BlockId.Planks);
    expect(s.edits.editCount).toBe(1);
  });

  it('transfers ownership: a reloaded chunk uses the array it unloaded with, and the cache no longer holds it', () => {
    const s = setup(1);
    streamAll(s, HOME);
    const original = s.store.getChunk(0, 0)?.blocks;
    streamAll(s, AWAY);
    streamAll(s, HOME);
    expect(s.store.getChunk(0, 0)?.blocks).toBe(original);
    const arrays = new Set(Array.from(s.store.chunks(), (c) => c.blocks));
    expect(arrays.size).toBe(9);
    // AWAY's nine chunks are the only cached ones; none of the live chunks is cached.
    expect(s.manager.streaming.cache.size).toBe(9);
  });

  it('recomputes light on a cache load (a neighbour edit made while away is reflected)', () => {
    const wx = 16; // chunk (1,0), local x = 0: borders chunk (0,0)
    const wz = 5;
    const s = setup(1);
    streamAll(s, HOME);
    streamAll(s, { cx: 2, cz: 0 }); // (1,0) stays loaded, (0,0) unloads into the cache
    expect(s.store.hasChunk(0, 0)).toBe(false);
    expect(s.store.hasChunk(1, 0)).toBe(true);
    const y = surfaceY(s.store, wx, wz) + 1;
    const change = setBlockAt(s.store, blockRegistry, wx, y, wz, BlockId.Torch);
    if (change === null) throw new Error('edit failed');
    applyLightAndCollectRemesh(change, s.light);
    s.edits.record(change);

    streamAll(s, HOME); // (0,0) returns from the cache
    const chunk = s.store.getChunk(0, 0);
    const borderIndex = localIndex(15, y, wz);
    expect(blockLightOf(chunk?.light[borderIndex] ?? 0)).toBeGreaterThan(0);

    // Reference: same edit, everything freshly generated.
    const ref = setup(1);
    ref.edits.record(change);
    streamAll(ref, HOME);
    expect(blockLightOf(ref.store.getChunk(0, 0)?.light[borderIndex] ?? 0)).toBeGreaterThan(0);
    expect(chunk?.light).toEqual(ref.store.getChunk(0, 0)?.light);
  });

  it('evicts least-recently-used chunks at capacity; an evicted chunk regenerates with its edit diff', () => {
    const s = setup(0, { cache: 2 });
    streamAll(s, HOME);
    const y = surfaceY(s.store, 3, 3);
    const change = setBlockAt(s.store, blockRegistry, 3, y + 1, 3, BlockId.Planks);
    if (change === null) throw new Error('edit failed');
    s.edits.record(change);

    for (const cx of [5, 6, 7]) {
      streamAll(s, { cx, cz: 0 });
    }
    // Unloaded in order (0,0), (5,0), (6,0): capacity 2 evicted (0,0).
    expect(s.manager.streaming.cache).toMatchObject({ size: 2, capacity: 2 });

    const requestsBefore = s.service.requests.length;
    streamAll(s, HOME);
    expect(s.service.requestedKeys().slice(requestsBefore)).toEqual(['0,0']);
    expect(s.store.getChunk(0, 0)?.getBlock(3, y + 1, 3)).toBe(BlockId.Planks);
  });

  it('when one unload overflows the cache, the chunks nearest the new center are kept', () => {
    const s = setup(2, { cache: 10 });
    streamAll(s, HOME);
    streamAll(s, { cx: 3, cz: 0 }); // unloads columns x = -2, -1, 0 (15 chunks)
    expect(s.manager.streaming.cache.size).toBe(10);
    const requests = s.service.requests.length;
    streamAll(s, HOME);
    // Only the farthest column (x = -2) has to be regenerated.
    const regenerated = s.service.requestedKeys().slice(requests).sort();
    expect(regenerated).toEqual(['-2,-2', '-2,-1', '-2,0', '-2,1', '-2,2'].sort());
  });

  it('respects the per-update accept cap with cache hits', () => {
    const s = setup(2, { budget: 3 });
    streamAll(s, HOME);
    streamAll(s, AWAY);
    const requests = s.service.requests.length;
    s.manager.update(HOME);
    expect(s.store.size).toBe(3);
    s.manager.update(HOME);
    expect(s.store.size).toBe(6);
    expect(s.service.requests.length).toBe(requests);
    expect(s.manager.streaming.pending).toBe(25 - 6);
  });

  it('respects the frame time budget with cache hits (one accept per update once it is spent)', () => {
    let t = 0;
    const probe: PerfProbe = {
      now: () => {
        t += 10; // every read spends more than the whole budget
        return t;
      },
      recordChunkGeneration: () => undefined,
      recordLight: () => undefined,
      recordMesh: () => undefined,
    };
    const s = setup(2, { budget: 25, probe, frameBudgetMs: 5 });
    streamAll(s, HOME);
    streamAll(s, AWAY);
    s.manager.update(HOME);
    expect(s.store.size).toBe(1);
    s.manager.update(HOME);
    expect(s.store.size).toBe(2);
  });

  it('setRadius shrink moves unloaded chunks into the cache and growing reloads them from it', () => {
    const s = setup(2);
    streamAll(s, HOME);
    expect(s.manager.streaming.cache.size).toBe(0);
    s.manager.setRadius(1);
    expect(s.store.size).toBe(9);
    expect(s.manager.streaming.cache.size).toBe(25 - 9);
    const requests = s.service.requests.length;
    s.manager.setRadius(2);
    streamAll(s, HOME);
    expect(s.store.size).toBe(25);
    expect(s.service.requests.length).toBe(requests);
  });

  it('warmUp loads cached chunks from the cache too', () => {
    const s = setup(1);
    s.manager.warmUp(HOME);
    streamAll(s, AWAY);
    const requests = s.service.requests.length;
    s.manager.warmUp(HOME);
    expect(s.store.hasChunk(0, 0)).toBe(true);
    expect(s.manager.streaming.cache.hits).toBe(9);
    expect(s.service.requests.length).toBe(requests);
  });

  it('the cache is per manager and dispose clears it', () => {
    const a = setup(0);
    streamAll(a, HOME);
    streamAll(a, AWAY);
    expect(a.manager.streaming.cache.size).toBe(1);
    const b = setup(0);
    streamAll(b, AWAY);
    expect(b.manager.streaming.cache.size).toBe(0);
    a.manager.dispose();
    expect(a.manager.streaming.cache.size).toBe(0);
  });

  it('a disabled cache (size 0) always requests', () => {
    const s = setup(0, { cache: 0 });
    streamAll(s, HOME);
    streamAll(s, AWAY);
    streamAll(s, HOME);
    expect(s.service.requestedKeys()).toEqual(['0,0', '10,0', '0,0']);
    expect(s.manager.streaming.cache).toMatchObject({ size: 0, hits: 0, misses: 3 });
  });
});
