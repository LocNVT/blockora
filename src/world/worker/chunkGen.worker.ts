/// <reference lib="webworker" />
import { ChunkGenWorkerCore } from './ChunkGenWorkerCore';
import type { ChunkGenRequest, ChunkGenResponse } from './chunkGenProtocol';

/**
 * Chunk-generation Web Worker entry: a thin adapter over ChunkGenWorkerCore.
 * Generated block buffers are transferred (zero-copy) back to the main thread.
 * Jobs are scheduled through a MessageChannel rather than setTimeout(0), which
 * browsers clamp to >= 4 ms once nested.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;

const channel = new MessageChannel();
let scheduledTask: (() => void) | null = null;
channel.port1.onmessage = (): void => {
  const task = scheduledTask;
  scheduledTask = null;
  task?.();
};

function post(response: ChunkGenResponse): void {
  if (response.type === 'generated') {
    scope.postMessage(response, [response.blocks.buffer as ArrayBuffer]);
  } else {
    scope.postMessage(response);
  }
}

const core = new ChunkGenWorkerCore(
  post,
  (task) => {
    scheduledTask = task;
    channel.port2.postMessage(null);
  },
  () => performance.now(),
);

scope.onmessage = (event: MessageEvent<ChunkGenRequest>): void => {
  core.handle(event.data);
};
