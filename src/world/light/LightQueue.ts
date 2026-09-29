/** Int32 slots per queue entry: world x, y, z and a light level. */
const STRIDE = 4;
const DEFAULT_CAPACITY = 1 << 14;

/**
 * FIFO ring buffer of (x, y, z, level) Int32 tuples for light BFS. Backed by
 * one Int32Array reused across operations — no per-node allocation. Grows
 * (doubling, amortised) only if a single BFS ever exceeds the current
 * capacity, so steady-state use allocates nothing.
 */
export class LightQueue {
  private data: Int32Array;
  private capacity: number;
  private head = 0;
  private count = 0;

  constructor(initialCapacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, initialCapacity);
    this.data = new Int32Array(this.capacity * STRIDE);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  push(x: number, y: number, z: number, level: number): void {
    if (this.count === this.capacity) {
      this.grow();
    }
    const slot = ((this.head + this.count) % this.capacity) * STRIDE;
    this.data[slot] = x;
    this.data[slot + 1] = y;
    this.data[slot + 2] = z;
    this.data[slot + 3] = level;
    this.count += 1;
  }

  /**
   * Removes the oldest entry and returns the Int32Array offset where its four
   * values can be read (valid until the next push). Caller must check `size`.
   */
  shift(): number {
    const slot = this.head * STRIDE;
    this.head = (this.head + 1) % this.capacity;
    this.count -= 1;
    return slot;
  }

  /** Backing array; read popped entries at the offset returned by `shift`. */
  get buffer(): Int32Array {
    return this.data;
  }

  private grow(): void {
    const nextCapacity = this.capacity * 2;
    const next = new Int32Array(nextCapacity * STRIDE);
    for (let i = 0; i < this.count; i += 1) {
      const from = ((this.head + i) % this.capacity) * STRIDE;
      next.set(this.data.subarray(from, from + STRIDE), i * STRIDE);
    }
    this.data = next;
    this.capacity = nextCapacity;
    this.head = 0;
  }
}
