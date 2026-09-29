import { DEBUG_CONFIG } from '../config/constants';
import { RollingWindow } from './RollingWindow';

/** Monotonic millisecond clock; injected so timing is testable. */
export type Clock = () => number;

/**
 * The seam the world systems time themselves through. Implemented by
 * `PerfStats`; ChunkManager / remeshChunks only depend on this shape.
 */
export interface PerfProbe {
  now(): number;
  recordChunkGeneration(ms: number): void;
  recordLight(ms: number): void;
  recordMesh(ms: number): void;
}

/**
 * Counts events and exposes the total of the last *completed* period (default
 * one second). Rolls lazily on `add` / `lastPeriod`, so it needs no timer.
 */
export class PeriodCounter {
  private periodStart: number | null = null;
  private current = 0;
  private last = 0;

  constructor(private readonly periodMs: number) {}

  add(now: number, amount = 1): void {
    this.roll(now);
    this.current += amount;
  }

  /** Events counted in the most recently completed period (0 once it has been quiet for 2+ periods). */
  lastPeriod(now: number): number {
    this.roll(now);
    return this.last;
  }

  private roll(now: number): void {
    if (this.periodStart === null) {
      this.periodStart = now;
      return;
    }
    const elapsedPeriods = Math.floor((now - this.periodStart) / this.periodMs);
    if (elapsedPeriods < 1) {
      return;
    }
    this.last = elapsedPeriods === 1 ? this.current : 0;
    this.current = 0;
    this.periodStart += elapsedPeriods * this.periodMs;
  }
}

/** Point-in-time copy of the rolling statistics (built at overlay rate, not per frame). */
export interface PerfSnapshot {
  readonly fps: number;
  readonly frameAvgMs: number;
  readonly frameP95Ms: number;
  readonly frameMaxMs: number;
  /** Averages are null until at least one sample exists. */
  readonly chunkGenAvgMs: number | null;
  readonly lightAvgMs: number | null;
  readonly meshAvgMs: number | null;
  readonly chunksGeneratedPerSec: number;
  readonly meshesRebuiltPerSec: number;
}

/**
 * Rolling frame / chunk-generation / mesh timing plus per-second counters.
 * Pure (no DOM, no Three.js); every timestamp comes from the injected clock.
 */
export class PerfStats implements PerfProbe {
  private readonly frames: RollingWindow;
  private readonly chunkGen: RollingWindow;
  private readonly light: RollingWindow;
  private readonly mesh: RollingWindow;
  private readonly generatedPerSec: PeriodCounter;
  private readonly meshedPerSec: PeriodCounter;
  private lastFrameAt: number | null = null;

  constructor(
    private readonly clock: Clock = () => performance.now(),
    frameWindow: number = DEBUG_CONFIG.frameWindow,
    sampleWindow: number = DEBUG_CONFIG.sampleWindow,
    counterPeriodMs: number = DEBUG_CONFIG.counterPeriodMs,
  ) {
    this.frames = new RollingWindow(frameWindow);
    this.chunkGen = new RollingWindow(sampleWindow);
    this.light = new RollingWindow(sampleWindow);
    this.mesh = new RollingWindow(sampleWindow);
    this.generatedPerSec = new PeriodCounter(counterPeriodMs);
    this.meshedPerSec = new PeriodCounter(counterPeriodMs);
  }

  now(): number {
    return this.clock();
  }

  /** Call once at the start of every frame; records the time since the previous call. */
  markFrame(): void {
    const now = this.clock();
    if (this.lastFrameAt !== null) {
      this.frames.push(now - this.lastFrameAt);
    }
    this.lastFrameAt = now;
  }

  recordChunkGeneration(ms: number): void {
    this.chunkGen.push(ms);
    this.generatedPerSec.add(this.clock());
  }

  recordLight(ms: number): void {
    this.light.push(ms);
  }

  recordMesh(ms: number): void {
    this.mesh.push(ms);
    this.meshedPerSec.add(this.clock());
  }

  snapshot(): PerfSnapshot {
    const now = this.clock();
    const frameAvgMs = this.frames.average();
    return {
      fps: frameAvgMs > 0 ? 1000 / frameAvgMs : 0,
      frameAvgMs,
      frameP95Ms: this.frames.percentile(0.95),
      frameMaxMs: this.frames.max(),
      chunkGenAvgMs: this.chunkGen.count > 0 ? this.chunkGen.average() : null,
      lightAvgMs: this.light.count > 0 ? this.light.average() : null,
      meshAvgMs: this.mesh.count > 0 ? this.mesh.average() : null,
      chunksGeneratedPerSec: this.generatedPerSec.lastPeriod(now),
      meshesRebuiltPerSec: this.meshedPerSec.lastPeriod(now),
    };
  }
}
