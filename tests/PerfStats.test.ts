import { describe, it, expect } from 'vitest';
import { RollingWindow } from '../src/debug/RollingWindow';
import { PerfStats, PeriodCounter } from '../src/debug/PerfStats';
import { IntervalGate } from '../src/debug/IntervalGate';

describe('RollingWindow', () => {
  it('is empty-safe', () => {
    const w = new RollingWindow(4);
    expect(w.count).toBe(0);
    expect(w.average()).toBe(0);
    expect(w.max()).toBe(0);
    expect(w.percentile(0.95)).toBe(0);
  });

  it('computes avg / max / nearest-rank p95', () => {
    const w = new RollingWindow(100);
    for (let i = 1; i <= 100; i += 1) w.push(i);
    expect(w.average()).toBe(50.5);
    expect(w.max()).toBe(100);
    expect(w.percentile(0.95)).toBe(95);
    expect(w.percentile(0.5)).toBe(50);
    expect(w.percentile(1)).toBe(100);
  });

  it('p95 of a small window picks the top sample and does not reorder history', () => {
    const w = new RollingWindow(10);
    [30, 10, 20].forEach((v) => w.push(v));
    expect(w.percentile(0.95)).toBe(30);
    w.push(5);
    expect(w.average()).toBe(16.25);
  });

  it('wraps: only the last capacity samples count, and size never grows', () => {
    const w = new RollingWindow(3);
    [100, 1, 2, 3, 4].forEach((v) => w.push(v));
    expect(w.count).toBe(3);
    expect(w.capacity).toBe(3);
    expect(w.max()).toBe(4);
    expect(w.average()).toBe(3);
    for (let i = 0; i < 1000; i += 1) w.push(i);
    expect(w.count).toBe(3);
  });

  it('rejects invalid capacity', () => {
    expect(() => new RollingWindow(0)).toThrow();
    expect(() => new RollingWindow(1.5)).toThrow();
  });
});

describe('PeriodCounter', () => {
  it('reports the last completed period and rolls over', () => {
    const c = new PeriodCounter(1000);
    c.add(0);
    c.add(400);
    c.add(900);
    expect(c.lastPeriod(950)).toBe(0);
    c.add(1000);
    expect(c.lastPeriod(1100)).toBe(3);
    c.add(1500);
    expect(c.lastPeriod(1999)).toBe(3);
    expect(c.lastPeriod(2000)).toBe(2);
  });

  it('goes back to 0 after a fully quiet period', () => {
    const c = new PeriodCounter(1000);
    c.add(0, 5);
    expect(c.lastPeriod(1000)).toBe(5);
    expect(c.lastPeriod(2000)).toBe(0);
    expect(c.lastPeriod(9000)).toBe(0);
  });
});

describe('PerfStats', () => {
  function makeStats(): { stats: PerfStats; setNow: (t: number) => void } {
    let t = 0;
    return { stats: new PerfStats(() => t, 4, 4, 1000), setNow: (v) => (t = v) };
  }

  it('derives fps and frame-time stats from frame deltas (first frame has no delta)', () => {
    const { stats, setNow } = makeStats();
    for (const t of [0, 10, 30, 40, 100]) {
      setNow(t);
      stats.markFrame();
    }
    const s = stats.snapshot();
    // deltas 10, 20, 10, 60
    expect(s.frameAvgMs).toBe(25);
    expect(s.frameMaxMs).toBe(60);
    expect(s.frameP95Ms).toBe(60);
    expect(s.fps).toBe(40);
  });

  it('keeps only the last window of frames', () => {
    const { stats, setNow } = makeStats();
    let t = 0;
    for (let i = 0; i < 20; i += 1) {
      setNow(t);
      stats.markFrame();
      t += i < 10 ? 100 : 10;
    }
    expect(stats.snapshot().frameMaxMs).toBe(10);
  });

  it('reports null averages until samples exist, then rolling means', () => {
    const { stats } = makeStats();
    expect(stats.snapshot().chunkGenAvgMs).toBeNull();
    expect(stats.snapshot().meshAvgMs).toBeNull();
    expect(stats.snapshot().lightAvgMs).toBeNull();
    stats.recordChunkGeneration(2);
    stats.recordChunkGeneration(4);
    stats.recordMesh(1);
    stats.recordLight(3);
    const s = stats.snapshot();
    expect(s.chunkGenAvgMs).toBe(3);
    expect(s.meshAvgMs).toBe(1);
    expect(s.lightAvgMs).toBe(3);
  });

  it('per-second counters roll over with the injected clock', () => {
    const { stats, setNow } = makeStats();
    setNow(0);
    stats.recordChunkGeneration(1);
    setNow(500);
    stats.recordChunkGeneration(1);
    stats.recordMesh(1);
    setNow(1000);
    let s = stats.snapshot();
    expect(s.chunksGeneratedPerSec).toBe(2);
    // The mesh counter's first period began at its first event (t=500).
    expect(s.meshesRebuiltPerSec).toBe(0);
    setNow(1500);
    s = stats.snapshot();
    expect(s.meshesRebuiltPerSec).toBe(1);
    setNow(2500);
    s = stats.snapshot();
    expect(s.chunksGeneratedPerSec).toBe(0);
    expect(s.meshesRebuiltPerSec).toBe(0);
  });
});

describe('IntervalGate', () => {
  it('fires once per interval and again after reset', () => {
    const g = new IntervalGate(250);
    expect(g.due(0)).toBe(true);
    expect(g.due(100)).toBe(false);
    expect(g.due(249)).toBe(false);
    expect(g.due(250)).toBe(true);
    expect(g.due(300)).toBe(false);
    g.reset();
    expect(g.due(301)).toBe(true);
  });
});
