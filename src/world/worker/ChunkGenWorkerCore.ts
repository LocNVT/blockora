import { WorldGenerator } from '../WorldGenerator';
import { generateChunkMessage, type ChunkGenRequest, type ChunkGenResponse } from './chunkGenProtocol';

interface Job {
  readonly id: number;
  readonly cx: number;
  readonly cz: number;
}

/**
 * The chunk-generation worker's logic, free of worker globals so it runs in
 * node tests. Requests are queued and generated one per scheduled task, so
 * `cancel` messages that arrive between jobs drop queued work.
 */
export class ChunkGenWorkerCore {
  private generator: WorldGenerator | null = null;
  private readonly queue: Job[] = [];
  private scheduled = false;

  constructor(
    private readonly post: (response: ChunkGenResponse) => void,
    private readonly schedule: (task: () => void) => void,
    private readonly now: () => number,
  ) {}

  /** Jobs waiting to run. */
  get queuedCount(): number {
    return this.queue.length;
  }

  handle(message: ChunkGenRequest): void {
    switch (message.type) {
      case 'init':
        this.generator = new WorldGenerator(message.seed);
        break;
      case 'generate':
        this.queue.push({ id: message.id, cx: message.cx, cz: message.cz });
        this.ensureScheduled();
        break;
      case 'cancel': {
        const index = this.queue.findIndex((job) => job.id === message.id);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        break;
      }
    }
  }

  /** Generates and posts the oldest queued job; false when the queue is empty. */
  runNext(): boolean {
    const job = this.queue.shift();
    if (job === undefined) {
      return false;
    }
    if (this.generator === null) {
      this.post({ type: 'failed', id: job.id, message: 'chunk generation worker used before init' });
      return true;
    }
    try {
      this.post(generateChunkMessage(this.generator, job.id, job.cx, job.cz, this.now));
    } catch (error) {
      this.post({ type: 'failed', id: job.id, message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  private ensureScheduled(): void {
    if (this.scheduled || this.queue.length === 0) {
      return;
    }
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      this.runNext();
      this.ensureScheduled();
    });
  }
}
