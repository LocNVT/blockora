/**
 * Fixed-capacity ring buffer of numeric samples with avg / max / percentile
 * queries. `push` never allocates; the statistics are computed on demand
 * (the debug overlay reads them at a few Hz, not per frame).
 */
export class RollingWindow {
  private readonly samples: Float64Array;
  private readonly scratch: Float64Array;
  private next = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`RollingWindow capacity must be a positive integer, got ${capacity}`);
    }
    this.samples = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  /** Number of samples currently held (<= capacity). */
  get count(): number {
    return this.filled;
  }

  push(value: number): void {
    this.samples[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    if (this.filled < this.capacity) {
      this.filled += 1;
    }
  }

  /** Mean of the held samples, or 0 when empty. */
  average(): number {
    if (this.filled === 0) {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < this.filled; i += 1) {
      sum += this.samples[i] ?? 0;
    }
    return sum / this.filled;
  }

  /** Largest held sample, or 0 when empty. */
  max(): number {
    let best = 0;
    for (let i = 0; i < this.filled; i += 1) {
      const value = this.samples[i] ?? 0;
      if (i === 0 || value > best) {
        best = value;
      }
    }
    return best;
  }

  /** Nearest-rank percentile (`p` in 0..1) of the held samples, or 0 when empty. */
  percentile(p: number): number {
    if (this.filled === 0) {
      return 0;
    }
    this.scratch.set(this.samples.subarray(0, this.filled));
    const view = this.scratch.subarray(0, this.filled);
    view.sort();
    const rank = Math.min(this.filled, Math.max(1, Math.ceil(p * this.filled)));
    return view[rank - 1] ?? 0;
  }

  clear(): void {
    this.next = 0;
    this.filled = 0;
  }
}
