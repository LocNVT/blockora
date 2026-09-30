import type { WorldGenerator } from '../WorldGenerator';
import { InProcessChunkGenerationService, type ChunkGenerationService } from './ChunkGenerationService';
import type { ChunkGenPort } from './WorkerChunkGenerationService';
import { WorkerChunkGenerationService } from './WorkerChunkGenerationService';
import type { ChunkGenResponse } from './chunkGenProtocol';

function workerPort(worker: Worker): ChunkGenPort {
  return {
    post: (message) => worker.postMessage(message),
    listen: (onMessage, onError) => {
      worker.onmessage = (event: MessageEvent<ChunkGenResponse>): void => onMessage(event.data);
      worker.onerror = (event: ErrorEvent): void => {
        event.preventDefault();
        onError(event.error ?? event.message);
      };
      worker.onmessageerror = (event: MessageEvent): void => onError(event);
    },
    terminate: () => worker.terminate(),
  };
}

/**
 * Browser entry point: one module Worker running WorldGenerator(generator.seed)
 * (one is enough — worker generation (~4 ms / chunk) outpaces the main
 * thread's per-frame accept budget), falling back to in-process generation
 * on the main thread when Workers are unavailable or fail to start.
 */
export function createChunkGenerationService(
  generator: WorldGenerator,
  onFallback?: (error: unknown) => void,
): ChunkGenerationService {
  const fallback = (): ChunkGenerationService => new InProcessChunkGenerationService(generator);
  if (typeof Worker === 'undefined') {
    onFallback?.(new Error('Web Workers are unavailable'));
    return fallback();
  }
  try {
    const worker = new Worker(new URL('./chunkGen.worker.ts', import.meta.url), {
      type: 'module',
      name: 'chunk-gen',
    });
    return new WorkerChunkGenerationService(workerPort(worker), generator.seed, fallback, onFallback);
  } catch (error) {
    console.warn('[chunks] generation worker unavailable; generating on the main thread', error);
    onFallback?.(error);
    return fallback();
  }
}
