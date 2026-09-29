import { describe, it, expect } from 'vitest';
import { ChunkManager } from '../src/world/ChunkManager';
import { ChunkStore } from '../src/world/ChunkStore';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { LightEngine } from '../src/world/light/LightEngine';
import { blockRegistry } from '../src/world/BlockRegistry';
import { chunkKey, type ChunkCoord } from '../src/world/chunkCoords';
import type { ChunkMeshSink } from '../src/world/mesher/remesh';
import type { PerfProbe } from '../src/debug/PerfStats';
import type { ChunkGenerationService, GeneratedChunk } from '../src/world/worker/ChunkGenerationService';
import { MOB_CONFIG, WORLD_CONFIG } from '../src/config/constants';

const SEED = 1;

/** Fake async service: a result is ready as soon as it is requested. */
class ReadyService implements ChunkGenerationService {
  readonly location = 'worker' as const;
  readonly requested: { id: number; cx: number; cz: number }[] = [];
  private ready: GeneratedChunk[] = [];
  private readonly generator = new WorldGenerator(SEED);

  request(id: number, cx: number, cz: number): void {
    this.requested.push({ id, cx, cz });
    this.ready.push({ id, cx, cz, blocks: this.generator.generateChunk(cx, cz).blocks, genMs: 1 });
  }
  poll(max: number): GeneratedChunk[] {
    return this.ready.splice(0, max);
  }
  cancel(id: number): void {
    this.ready = this.ready.filter((r) => r.id !== id);
  }
  dispose(): void {
    this.ready = [];
  }
  get readyCount(): number {
    return this.ready.length;
  }
}

/** Injected clock: only `recordLight` (once per accept) and `recordMesh` (once per mesh) advance time. */
class FakeProbe implements PerfProbe {
  t = 0;
  constructor(
    private readonly lightCost: number,
    private readonly meshCost: number,
  ) {}
  now(): number {
    return this.t;
  }
  recordChunkGeneration(): void {}
  recordLight(): void {
    this.t += this.lightCost;
  }
  recordMesh(): void {
    this.t += this.meshCost;
  }
}

class TrackingSink implements ChunkMeshSink {
  readonly upserts: string[] = [];
  readonly meshed = new Set<string>();
  upsert(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    this.upserts.push(key);
    this.meshed.add(key);
  }
  remove(cx: number, cz: number): void {
    this.meshed.delete(chunkKey(cx, cz));
  }
}

interface Options {
  radius: number;
  outerRing?: number;
  budgetMs?: number;
  lightCost?: number;
  meshCost?: number;
  maxLoads?: number;
  maxInFlight?: number;
}

function setup(o: Options) {
  const store = new ChunkStore();
  const service = new ReadyService();
  const sink = new TrackingSink();
  const probe = new FakeProbe(o.lightCost ?? 0, o.meshCost ?? 0);
  const manager = new ChunkManager(
    store,
    new WorldGenerator(SEED),
    blockRegistry,
    sink,
    o.radius,
    o.maxLoads ?? 1000,
    new LightEngine(store, blockRegistry),
    undefined,
    probe,
    {
      service,
      maxInFlight: o.maxInFlight ?? 1000,
      frameBudgetMs: o.budgetMs ?? Number.POSITIVE_INFINITY,
      outerRing: o.outerRing ?? 0,
    },
  );
  return { store, service, sink, probe, manager };
}

type Env = ReturnType<typeof setup>;

/** Updates until everything requested is loaded and no more meshes appear for a few updates. */
function settle(s: Env, center: ChunkCoord, maxFrames = 3000): void {
  let quiet = 0;
  let lastUpserts = -1;
  for (let i = 0; i < maxFrames; i += 1) {
    s.manager.update(center);
    const q = s.manager.streaming;
    const idle = q.pending === 0 && q.inFlight === 0 && s.service.readyCount === 0;
    quiet = idle && s.sink.upserts.length === lastUpserts ? quiet + 1 : 0;
    lastUpserts = s.sink.upserts.length;
    if (quiet >= 3) {
      return;
    }
  }
  throw new Error('did not settle');
}

const area = (r: number): number => (2 * r + 1) ** 2;
const cheb = (a: ChunkCoord, b: ChunkCoord): number => Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cz - b.cz));

describe('ChunkManager time budget', () => {
  it('stops accepting once the budget is used (injected clock)', () => {
    const s = setup({ radius: 3, budgetMs: 5, lightCost: 2 });
    s.manager.update({ cx: 0, cz: 0 });
    // accept 1 (t=2), 2 (t=4), 3 (t=6 >= 5) -> stop
    expect(s.store.size).toBe(3);
    s.manager.update({ cx: 0, cz: 0 });
    expect(s.store.size).toBe(6);
  });

  it('always makes progress: >= 1 accept per update even with a zero budget, and everything finishes', () => {
    const s = setup({ radius: 2, budgetMs: 0, lightCost: 10, meshCost: 10 });
    const center = { cx: 0, cz: 0 };
    let previous = 0;
    for (let i = 0; i < 6; i += 1) {
      s.manager.update(center);
      expect(s.store.size).toBe(previous + 1);
      previous = s.store.size;
    }
    settle(s, center);
    expect(s.store.size).toBe(area(2));
    expect(s.sink.meshed.size).toBe(area(2));
  });

  it('meshes at least one chunk per update with a zero budget, and no more than one', () => {
    const s = setup({ radius: 2, budgetMs: 0, meshCost: 10 });
    const center = { cx: 0, cz: 0 };
    let previous = 0;
    let meshingUpdates = 0;
    for (let i = 0; i < 60; i += 1) {
      s.manager.update(center);
      const delta = s.sink.upserts.length - previous;
      previous = s.sink.upserts.length;
      expect(delta).toBeLessThanOrEqual(1);
      meshingUpdates += delta;
    }
    expect(meshingUpdates).toBe(area(2));
  });

  it('carries unmeshed work over to the next update, nearest first', () => {
    const s = setup({ radius: 2, budgetMs: 10, meshCost: 4 });
    const center = { cx: 0, cz: 0 };
    s.manager.update(center); // accepts all 25 (free), then meshes 3 (t = 4, 8, 12)
    expect(s.store.size).toBe(area(2));
    expect(s.sink.upserts.length).toBe(3);
    let updates = 1;
    while (s.sink.upserts.length < area(2)) {
      const before = s.sink.upserts.length;
      s.manager.update(center);
      updates += 1;
      const batch = s.sink.upserts.length - before;
      expect(batch).toBeGreaterThanOrEqual(1);
      expect(batch).toBeLessThanOrEqual(3);
      expect(updates).toBeLessThan(50);
    }
    expect(new Set(s.sink.upserts).size).toBe(area(2)); // each exactly once
    const dist = s.sink.upserts.map((k) => {
      const [cx, cz] = k.split(',').map(Number) as [number, number];
      return cx * cx + cz * cz;
    });
    expect(dist).toEqual([...dist].sort((a, b) => a - b));
    expect(s.sink.upserts[0]).toBe('0,0');
  });

  it('keeps the count cap as an upper bound even with a huge time budget', () => {
    const s = setup({ radius: 3, maxLoads: 2, budgetMs: 1e9 });
    s.manager.update({ cx: 0, cz: 0 });
    expect(s.store.size).toBe(2);
  });
});

describe('ChunkManager outer ring', () => {
  it('loads the ring but meshes only the rendered radius', () => {
    const s = setup({ radius: 2, outerRing: 1 });
    const center = { cx: 0, cz: 0 };
    settle(s, center);
    expect(s.store.size).toBe(area(3));
    expect(s.sink.meshed.size).toBe(area(2));
    expect(s.manager.streaming.meshed).toBe(area(2));
    for (const chunk of s.store.chunks()) {
      expect(s.sink.meshed.has(chunkKey(chunk.cx, chunk.cz))).toBe(cheb(chunk, center) <= 2);
    }
    // Every rendered chunk meshed exactly once: edge chunks already have all their neighbours.
    expect(s.sink.upserts.length).toBe(area(2));
  });

  it('walking one chunk meshes only the newly visible row, once each', () => {
    const s = setup({ radius: 2, outerRing: 1 });
    settle(s, { cx: 0, cz: 0 });
    const before = s.sink.upserts.length;
    settle(s, { cx: 1, cz: 0 });
    const fresh = s.sink.upserts.slice(before).sort();
    expect(fresh).toEqual([-2, -1, 0, 1, 2].map((cz) => chunkKey(3, cz)).sort());
    expect(s.sink.meshed.size).toBe(area(2));
    expect(s.store.size).toBe(area(3));
    // The row that left the rendered radius is still loaded but no longer meshed.
    for (let cz = -2; cz <= 2; cz += 1) {
      expect(s.store.hasChunk(-2, cz)).toBe(true);
      expect(s.sink.meshed.has(chunkKey(-2, cz))).toBe(false);
    }
  });

  it('a long walk costs one mesh per newly visible chunk', () => {
    const s = setup({ radius: 3, outerRing: 1, budgetMs: 6, lightCost: 2, meshCost: 2, maxLoads: 4 });
    settle(s, { cx: 0, cz: 0 });
    const before = s.sink.upserts.length;
    const steps = 6;
    for (let x = 1; x <= steps; x += 1) {
      settle(s, { cx: x, cz: 0 });
    }
    expect(s.sink.upserts.length - before).toBe(steps * (2 * 3 + 1));
  });

  it('leaves no chunk inside the rendered radius unmeshed after settling, under a tight budget', () => {
    const s = setup({ radius: 2, outerRing: 1, budgetMs: 3, lightCost: 2, meshCost: 2, maxLoads: 3, maxInFlight: 6 });
    const path = [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }, { cx: 1, cz: 1 }, { cx: 0, cz: 3 }, { cx: 30, cz: -30 }, { cx: 0, cz: 0 }];
    for (const center of path) {
      settle(s, center);
      expect(s.store.size).toBe(area(3));
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dz = -2; dz <= 2; dz += 1) {
          expect(s.sink.meshed.has(chunkKey(center.cx + dx, center.cz + dz))).toBe(true);
        }
      }
      expect(s.sink.meshed.size).toBe(area(2));
    }
  });

  it('unloads beyond radius + ring and never requests beyond it', () => {
    const s = setup({ radius: 2, outerRing: 1 });
    settle(s, { cx: 0, cz: 0 });
    settle(s, { cx: 4, cz: 0 });
    for (const chunk of s.store.chunks()) {
      expect(cheb(chunk, { cx: 4, cz: 0 })).toBeLessThanOrEqual(3);
    }
    expect(s.store.hasChunk(0, 0)).toBe(false);
    expect(s.store.hasChunk(1, 0)).toBe(true); // 3 chunks from the center: still in the ring
    const origin = { cx: 0, cz: 0 };
    const far = { cx: 4, cz: 0 };
    expect(s.service.requested.every((r) => cheb(r, origin) <= 3 || cheb(r, far) <= 3)).toBe(true);
  });

  it('outerRing 0 keeps loaded == rendered', () => {
    const s = setup({ radius: 2 });
    settle(s, { cx: 0, cz: 0 });
    expect(s.store.size).toBe(area(2));
    expect(s.sink.meshed.size).toBe(area(2));
  });

  it('the ring adds 8 * (r + 1) chunks at the game render distance', () => {
    const r = WORLD_CONFIG.renderDistance;
    expect(area(r + 1) - area(r)).toBe(8 * r + 8);
  });
});

describe('rendered radius vs mob spawning', () => {
  it('spawn and despawn distances stay inside the rendered (meshed) chunks for any player position', () => {
    const r = WORLD_CONFIG.renderDistance;
    const w = WORLD_CONFIG.chunkWidth;
    // Player at the far edge of its chunk, spawning at max distance along an axis.
    const worstChunkOffset = Math.floor((w - 1e-6 + MOB_CONFIG.maxSpawnDistance) / w);
    expect(worstChunkOffset).toBeLessThanOrEqual(r);
    // Mobs beyond despawnDistance are removed, so none stays past the rendered edge (r * w blocks).
    expect(MOB_CONFIG.despawnDistance).toBeLessThanOrEqual(r * w);
    expect(MOB_CONFIG.maxSpawnDistance).toBeLessThan(MOB_CONFIG.despawnDistance);
  });
});
