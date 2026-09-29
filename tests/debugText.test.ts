import { describe, it, expect } from 'vitest';
import {
  formatDebugLines,
  formatInt,
  readJsHeapMb,
  readRendererStats,
  type DebugSnapshot,
} from '../src/debug/debugText';
import { PerfStats } from '../src/debug/PerfStats';
import { ChunkManager } from '../src/world/ChunkManager';
import { ChunkStore } from '../src/world/ChunkStore';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { blockRegistry } from '../src/world/BlockRegistry';
import { remeshChunks } from '../src/world/mesher/remesh';
import type { ChunkMeshSink } from '../src/world/mesher/remesh';

const noopSink: ChunkMeshSink = { upsert: () => undefined, remove: () => undefined };

function snapshot(overrides: Partial<DebugSnapshot> = {}): DebugSnapshot {
  return {
    backend: 'webgl2',
    perf: {
      fps: 59.94,
      frameAvgMs: 16.68,
      frameP95Ms: 20.04,
      frameMaxMs: 33.3,
      chunkGenAvgMs: 4.256,
      lightAvgMs: 1.5,
      meshAvgMs: null,
      chunksGeneratedPerSec: 3,
      meshesRebuiltPerSec: 0,
    },
    renderer: { drawCalls: 1234, triangles: 1234567, geometries: 12, textures: 3 },
    jsHeapMb: 123.456,
    chunksLoaded: 289,
    mobCount: 4,
    position: { x: 1.25, y: 64, z: -3.5 },
    chunk: { cx: 0, cz: -1 },
    renderDistance: 8,
    ...overrides,
  };
}

describe('formatInt', () => {
  it('adds thousands separators and rounds', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1234567.4)).toBe('1,234,567');
    expect(formatInt(Number.NaN)).toBe('n/a');
  });
});

describe('formatDebugLines', () => {
  it('formats every field', () => {
    const lines = formatDebugLines(snapshot());
    expect(lines).toEqual([
      'Blockora  [WebGL2]',
      'FPS 59.9',
      'Frame ms  avg 16.7  p95 20.0  max 33.3',
      'Draw calls 1,234',
      'Triangles 1,234,567',
      'Geometries 12  Textures 3',
      'JS heap 123.5 MB',
      'Chunks loaded 289  gen 3/s  mesh 0/s',
      'Chunk ms  gen 4.26  light 1.50  mesh n/a',
      'Mobs 4',
      `Pos ${(1.25).toFixed(1)} 64.0 -3.5  chunk (0, -1)`,
      'Render distance 8 chunks',
    ]);
  });

  it('shows n/a when the JS heap is unavailable and labels WebGPU', () => {
    const lines = formatDebugLines(snapshot({ jsHeapMb: null, backend: 'webgpu' }));
    expect(lines[0]).toBe('Blockora  [WebGPU]');
    expect(lines).toContain('JS heap n/a');
  });
});

describe('readers', () => {
  it('reads the r186 renderer.info shape', () => {
    const stats = readRendererStats({
      render: { drawCalls: 7, triangles: 90, calls: 1000 },
      memory: { geometries: 5, textures: 2 },
    });
    expect(stats).toEqual({ drawCalls: 7, triangles: 90, geometries: 5, textures: 2 });
  });

  it('falls back to the classic render.calls shape and missing fields', () => {
    expect(readRendererStats({ render: { calls: 9 }, memory: {} })).toEqual({
      drawCalls: 9,
      triangles: 0,
      geometries: 0,
      textures: 0,
    });
  });

  it('reads performance.memory only where present', () => {
    expect(readJsHeapMb({ memory: { usedJSHeapSize: 2 * 1024 * 1024 } })).toBe(2);
    expect(readJsHeapMb({})).toBeNull();
    expect(readJsHeapMb(undefined)).toBeNull();
    expect(readJsHeapMb({ memory: { usedJSHeapSize: 'x' } })).toBeNull();
  });
});

describe('instrumentation seam (injected clock)', () => {
  function tickingStats(stepMs: number): PerfStats {
    let t = 0;
    return new PerfStats(() => {
      t += stepMs;
      return t;
    });
  }

  it('ChunkManager records one generation and one light sample per generated chunk', () => {
    const stats = tickingStats(2);
    const store = new ChunkStore();
    const manager = new ChunkManager(
      store,
      new WorldGenerator(1),
      blockRegistry,
      noopSink,
      1,
      4,
      undefined,
      undefined,
      stats,
    );
    manager.update({ cx: 0, cz: 0 });
    manager.loadAllPending();
    const snap = stats.snapshot();
    // Each timed span is bounded by two consecutive clock reads => one step.
    expect(snap.chunkGenAvgMs).toBe(2);
    expect(snap.lightAvgMs).toBe(2);
    expect(snap.meshAvgMs).not.toBeNull();
    expect(store.size).toBe(9);
    expect(manager.stats.chunksLoaded).toBe(9);
    expect(manager.stats.generationMs).toBeCloseTo(18);
  });

  it('remeshChunks records one mesh sample per meshed chunk and skips unloaded ones', () => {
    const stats = tickingStats(3);
    const store = new ChunkStore();
    const manager = new ChunkManager(store, new WorldGenerator(1), blockRegistry, noopSink, 0);
    manager.update({ cx: 0, cz: 0 });
    manager.loadAllPending();
    remeshChunks(
      store,
      blockRegistry,
      noopSink,
      [
        { cx: 0, cz: 0 },
        { cx: 0, cz: 0 },
        { cx: 50, cz: 50 },
      ],
      undefined,
      stats,
    );
    expect(stats.snapshot().meshAvgMs).toBe(3);
  });

  it('works without a probe (default clock path)', () => {
    const store = new ChunkStore();
    const manager = new ChunkManager(store, new WorldGenerator(1), blockRegistry, noopSink, 0);
    manager.update({ cx: 0, cz: 0 });
    manager.loadAllPending();
    expect(manager.stats.chunksLoaded).toBe(1);
  });
});
