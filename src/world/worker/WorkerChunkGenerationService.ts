import { CHUNK_VOLUME, type ChunkCoord } from '../chunkCoords';
import type { ChunkGenerationService, GenerationLocation } from './ChunkGenerationService';
import type { ChunkGenRequest, ChunkGenResponse, GeneratedChunk } from './chunkGenProtocol';

/** The slice of a Worker this service uses (adapted in createChunkGenerationService; faked in tests). */
export interface ChunkGenPort {
  post(message: ChunkGenRequest): void;
  listen(onMessage: (response: ChunkGenResponse) => void, onError: (error: unknown) => void): void;
  terminate(): void;
}

/**
 * Main-thread side of the generation worker. Tracks outstanding request ids:
 * a result whose id was cancelled (or is unknown) is dropped on arrival, so
 * `poll` never hands out stale chunks. Finished results wait in a FIFO until
 * polled (ChunkManager bounds how many it accepts per frame).
 *
 * If the worker errors or reports a failed job, the service logs once,
 * terminates the worker and re-issues every outstanding request (and all
 * later ones) to a main-thread fallback, so no chunk is lost.
 */
export class WorkerChunkGenerationService implements ChunkGenerationService {
  private readonly outstanding = new Map<number, ChunkCoord>();
  private readonly completed: GeneratedChunk[] = [];
  private fallback: ChunkGenerationService | null = null;
  private disposed = false;

  constructor(
    private readonly port: ChunkGenPort,
    seed: number,
    private readonly createFallback: () => ChunkGenerationService,
    private readonly onFallback?: (error: unknown) => void,
  ) {
    port.listen(
      (response) => this.onResponse(response),
      (error) => this.fail(error),
    );
    port.post({ type: 'init', seed });
  }

  get location(): GenerationLocation {
    return this.fallback === null ? 'worker' : this.fallback.location;
  }

  request(id: number, cx: number, cz: number): void {
    if (this.disposed) {
      return;
    }
    if (this.fallback !== null) {
      this.fallback.request(id, cx, cz);
      return;
    }
    this.outstanding.set(id, { cx, cz });
    this.port.post({ type: 'generate', id, cx, cz });
  }

  poll(max: number): GeneratedChunk[] {
    const results = this.completed.splice(0, Math.max(0, max));
    if (this.fallback !== null && results.length < max) {
      results.push(...this.fallback.poll(max - results.length));
    }
    return results;
  }

  cancel(id: number): void {
    if (this.outstanding.delete(id)) {
      this.port.post({ type: 'cancel', id });
    }
    const index = this.completed.findIndex((result) => result.id === id);
    if (index >= 0) {
      this.completed.splice(index, 1);
    }
    this.fallback?.cancel(id);
  }

  dispose(): void {
    this.disposed = true;
    this.port.terminate();
    this.outstanding.clear();
    this.completed.length = 0;
    this.fallback?.dispose();
  }

  private onResponse(response: ChunkGenResponse): void {
    if (this.disposed) {
      return;
    }
    if (response.type === 'failed') {
      this.fail(new Error(response.message));
      return;
    }
    if (!this.outstanding.has(response.id)) {
      return; // cancelled while in flight
    }
    if (response.blocks.length !== CHUNK_VOLUME) {
      this.fail(new Error(`generated chunk has ${response.blocks.length} blocks, expected ${CHUNK_VOLUME}`));
      return;
    }
    this.outstanding.delete(response.id);
    const { id, cx, cz, blocks, genMs } = response;
    this.completed.push({ id, cx, cz, blocks, genMs });
  }

  private fail(error: unknown): void {
    if (this.fallback !== null || this.disposed) {
      return;
    }
    console.error('[chunks] generation worker failed; falling back to main-thread generation', error);
    this.port.terminate();
    const fallback = this.createFallback();
    this.fallback = fallback;
    this.onFallback?.(error);
    for (const [id, { cx, cz }] of this.outstanding) {
      fallback.request(id, cx, cz);
    }
    this.outstanding.clear();
  }
}
