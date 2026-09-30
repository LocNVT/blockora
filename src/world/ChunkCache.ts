import { chunkKey } from './chunkCoords';

/**
 * Bounded least-recently-used cache of unloaded chunks' block arrays, so
 * walking back over ground that just streamed out does not regenerate it.
 *
 * Ownership: `put` takes ownership of the array (no copy). Callers hand over
 * the blocks of a chunk that was just removed from the ChunkStore, so nothing
 * else references the array; `take` transfers it back out (removing the entry),
 * so an array is never shared between the cache and a live chunk. `get` is a
 * read-only peek that refreshes recency and must not be used to build a live
 * chunk (use `take`).
 *
 * Blocks only: light is derived data and is recomputed on load. Memory-only,
 * never persisted. Recency is Map insertion order (oldest first).
 */
export class ChunkCache {
  private readonly entries = new Map<string, Uint8Array>();
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
  }

  get size(): number {
    return this.entries.size;
  }

  /** True when (cx, cz) is cached. Does not change recency. */
  has(cx: number, cz: number): boolean {
    return this.entries.has(chunkKey(cx, cz));
  }

  /** The cached blocks (marking them most recently used), or undefined. The entry stays cached. */
  get(cx: number, cz: number): Uint8Array | undefined {
    const key = chunkKey(cx, cz);
    const blocks = this.entries.get(key);
    if (blocks !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, blocks);
    }
    return blocks;
  }

  /** Removes and returns the cached blocks (ownership moves to the caller), or undefined. */
  take(cx: number, cz: number): Uint8Array | undefined {
    const key = chunkKey(cx, cz);
    const blocks = this.entries.get(key);
    if (blocks !== undefined) {
      this.entries.delete(key);
    }
    return blocks;
  }

  /** Stores `blocks` as the most recently used entry, evicting the least recently used beyond capacity. */
  put(cx: number, cz: number, blocks: Uint8Array): void {
    if (this.capacity === 0) {
      return;
    }
    const key = chunkKey(cx, cz);
    this.entries.delete(key);
    this.entries.set(key, blocks);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  delete(cx: number, cz: number): boolean {
    return this.entries.delete(chunkKey(cx, cz));
  }

  clear(): void {
    this.entries.clear();
  }
}
