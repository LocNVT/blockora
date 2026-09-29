import type { WorldGenerator } from '../WorldGenerator';
import { generateChunkMessage, type GeneratedChunk } from './chunkGenProtocol';

export type { GeneratedChunk } from './chunkGenProtocol';

/** Where chunk generation runs (shown next to the gen timing in the F3 overlay). */
export type GenerationLocation = 'worker' | 'main';

/**
 * Asynchronous chunk generation backend used by ChunkManager.
 *
 * - `request(id, cx, cz)`: start generating; `id` is unique per request (the
 *   caller never reuses one), so a result can be matched to its request.
 * - `poll(max)`: up to `max` finished results, oldest first; the rest stay
 *   queued for the next poll. Never returns a cancelled request.
 * - `cancel(id)`: forget a request (queued, running or finished-but-unpolled).
 * - `dispose()`: release resources (terminates a worker); no results after it.
 */
export interface ChunkGenerationService {
  readonly location: GenerationLocation;
  request(id: number, cx: number, cz: number): void;
  poll(max: number): GeneratedChunk[];
  cancel(id: number): void;
  dispose(): void;
}

interface QueuedRequest {
  readonly id: number;
  readonly cx: number;
  readonly cz: number;
}

/**
 * Synchronous in-process backend: requests are queued and generated lazily
 * inside `poll` (at most `max` per call), on the calling thread. Used by
 * tests, as the fallback when Workers are unavailable / fail, and it matches
 * the pre-worker behaviour (generation bounded by the per-update budget).
 */
export class InProcessChunkGenerationService implements ChunkGenerationService {
  readonly location: GenerationLocation = 'main';
  private readonly queue: QueuedRequest[] = [];

  constructor(
    private readonly generator: WorldGenerator,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Requests not yet generated. */
  get queuedCount(): number {
    return this.queue.length;
  }

  request(id: number, cx: number, cz: number): void {
    this.queue.push({ id, cx, cz });
  }

  poll(max: number): GeneratedChunk[] {
    const results: GeneratedChunk[] = [];
    while (results.length < max) {
      const next = this.queue.shift();
      if (next === undefined) {
        break;
      }
      results.push(generateChunkMessage(this.generator, next.id, next.cx, next.cz, this.now));
    }
    return results;
  }

  cancel(id: number): void {
    const index = this.queue.findIndex((queued) => queued.id === id);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  dispose(): void {
    this.queue.length = 0;
  }
}
