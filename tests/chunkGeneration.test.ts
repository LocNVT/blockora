import { describe, it, expect, vi } from 'vitest';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { CHUNK_VOLUME } from '../src/world/chunkCoords';
import {
  generateChunkMessage,
  type ChunkGenRequest,
  type ChunkGenResponse,
} from '../src/world/worker/chunkGenProtocol';
import { InProcessChunkGenerationService } from '../src/world/worker/ChunkGenerationService';
import { ChunkGenWorkerCore } from '../src/world/worker/ChunkGenWorkerCore';
import {
  WorkerChunkGenerationService,
  type ChunkGenPort,
} from '../src/world/worker/WorkerChunkGenerationService';

const SEED = 1234;
const COORDS = [
  { cx: 0, cz: 0 },
  { cx: -3, cz: 2 },
  { cx: 7, cz: -11 },
];

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function fixedClock(): () => number {
  let t = 0;
  return () => (t += 1);
}

/** Worker core wired to a manual scheduler: `step()` runs one scheduled task. */
function manualCore(post: (response: ChunkGenResponse) => void): { core: ChunkGenWorkerCore; step: () => boolean } {
  const tasks: (() => void)[] = [];
  const core = new ChunkGenWorkerCore(post, (task) => tasks.push(task), fixedClock());
  return {
    core,
    step: () => {
      const task = tasks.shift();
      task?.();
      return task !== undefined;
    },
  };
}

/**
 * In-memory port: main -> worker messages are delivered to a real
 * ChunkGenWorkerCore; worker -> main responses are buffered until `flush()`
 * (so tests control arrival order relative to cancels).
 */
function linkedPort(): {
  port: ChunkGenPort;
  step: () => boolean;
  flush: () => void;
  fail: (error: unknown) => void;
  terminated: () => boolean;
} {
  const inbox: ChunkGenResponse[] = [];
  let onMessage: (response: ChunkGenResponse) => void = () => undefined;
  let onError: (error: unknown) => void = () => undefined;
  let terminated = false;
  const { core, step } = manualCore((response) => inbox.push(response));
  const port: ChunkGenPort = {
    post: (message: ChunkGenRequest) => core.handle(message),
    listen: (message, error) => {
      onMessage = message;
      onError = error;
    },
    terminate: () => {
      terminated = true;
    },
  };
  return {
    port,
    step,
    flush: () => {
      for (const response of inbox.splice(0)) {
        onMessage(response);
      }
    },
    fail: (error) => onError(error),
    terminated: () => terminated,
  };
}

describe('generateChunkMessage (shared by worker and in-process generation)', () => {
  it('produces byte-identical blocks to WorldGenerator.generateChunk for the same seed', () => {
    for (const { cx, cz } of COORDS) {
      const message = generateChunkMessage(new WorldGenerator(SEED), 5, cx, cz, fixedClock());
      const expected = new WorldGenerator(SEED).generateChunk(cx, cz).blocks;
      expect(message).toMatchObject({ type: 'generated', id: 5, cx, cz, genMs: 1 });
      expect(message.blocks.length).toBe(CHUNK_VOLUME);
      expect(sameBytes(message.blocks, expected)).toBe(true);
    }
  });
});

describe('ChunkGenWorkerCore', () => {
  it('generates queued jobs one per scheduled task, identical to the main-thread generator', () => {
    const posted: ChunkGenResponse[] = [];
    const { core, step } = manualCore((response) => posted.push(response));
    core.handle({ type: 'init', seed: SEED });
    COORDS.forEach(({ cx, cz }, i) => core.handle({ type: 'generate', id: i + 1, cx, cz }));

    expect(step()).toBe(true);
    expect(posted).toHaveLength(1);
    while (step()) {
      // drain
    }
    expect(posted.map((r) => r.id)).toEqual([1, 2, 3]);
    posted.forEach((response, i) => {
      const { cx, cz } = COORDS[i] ?? { cx: 0, cz: 0 };
      if (response.type !== 'generated') {
        throw new Error('expected a generated chunk');
      }
      const expected = new WorldGenerator(SEED).generateChunk(cx, cz).blocks;
      expect(sameBytes(response.blocks, expected)).toBe(true);
    });
  });

  it('drops a job cancelled before it runs', () => {
    const posted: ChunkGenResponse[] = [];
    const { core, step } = manualCore((response) => posted.push(response));
    core.handle({ type: 'init', seed: SEED });
    core.handle({ type: 'generate', id: 1, cx: 0, cz: 0 });
    core.handle({ type: 'generate', id: 2, cx: 1, cz: 0 });
    core.handle({ type: 'cancel', id: 1 });
    while (step()) {
      // drain
    }
    expect(posted.map((r) => r.id)).toEqual([2]);
    expect(core.queuedCount).toBe(0);
  });

  it('reports a failure for jobs received before init', () => {
    const posted: ChunkGenResponse[] = [];
    const { core, step } = manualCore((response) => posted.push(response));
    core.handle({ type: 'generate', id: 9, cx: 0, cz: 0 });
    step();
    expect(posted[0]).toMatchObject({ type: 'failed', id: 9 });
  });
});

describe('InProcessChunkGenerationService', () => {
  it('generates lazily in poll, oldest first, at most `max` per call; cancel removes queued requests', () => {
    const service = new InProcessChunkGenerationService(new WorldGenerator(SEED), fixedClock());
    service.request(1, 0, 0);
    service.request(2, 1, 0);
    service.request(3, 2, 0);
    service.cancel(2);
    expect(service.queuedCount).toBe(2);
    expect(service.poll(1).map((r) => r.id)).toEqual([1]);
    expect(service.poll(5).map((r) => r.id)).toEqual([3]);
    expect(service.poll(5)).toEqual([]);
  });
});

describe('WorkerChunkGenerationService (over an in-memory port to the worker core)', () => {
  function setup(): ReturnType<typeof linkedPort> & { service: WorkerChunkGenerationService } {
    const link = linkedPort();
    const service = new WorkerChunkGenerationService(
      link.port,
      SEED,
      () => new InProcessChunkGenerationService(new WorldGenerator(SEED), fixedClock()),
    );
    return { ...link, service };
  }

  it('delivers worker-generated chunks identical to in-process generation, bounded by poll(max)', () => {
    const { service, step, flush } = setup();
    COORDS.forEach(({ cx, cz }, i) => service.request(i + 1, cx, cz));
    while (step()) {
      // worker drains its queue
    }
    expect(service.poll(3)).toEqual([]); // nothing arrived on the main thread yet
    flush();
    const first = service.poll(2);
    const rest = service.poll(10);
    expect(first.map((r) => r.id)).toEqual([1, 2]);
    expect(rest.map((r) => r.id)).toEqual([3]);
    for (const result of [...first, ...rest]) {
      const expected = new WorldGenerator(SEED).generateChunk(result.cx, result.cz).blocks;
      expect(sameBytes(result.blocks, expected)).toBe(true);
    }
    expect(service.location).toBe('worker');
  });

  it('drops a result whose request was cancelled while it was in flight', () => {
    const { service, step, flush } = setup();
    service.request(1, 0, 0);
    service.request(2, 1, 0);
    step(); // worker finishes job 1 (response buffered, not yet received)
    service.cancel(1);
    while (step()) {
      // drain
    }
    flush();
    expect(service.poll(10).map((r) => r.id)).toEqual([2]);
  });

  it('cancel also removes a finished-but-unpolled result', () => {
    const { service, step, flush } = setup();
    service.request(1, 0, 0);
    step();
    flush();
    service.cancel(1);
    expect(service.poll(10)).toEqual([]);
  });

  it('falls back to main-thread generation for outstanding and later requests when the worker fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { service, fail, terminated } = setup();
    service.request(1, 0, 0);
    service.request(2, 1, 0);
    fail(new Error('boom'));
    service.request(3, 2, 0);
    expect(terminated()).toBe(true);
    expect(service.location).toBe('main');
    expect(service.poll(10).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
