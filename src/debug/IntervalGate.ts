/** Rate limiter: `due(now)` is true at most once per interval (and on the first call). */
export class IntervalGate {
  private last: number | null = null;

  constructor(private readonly intervalMs: number) {}

  due(now: number): boolean {
    if (this.last !== null && now - this.last < this.intervalMs) {
      return false;
    }
    this.last = now;
    return true;
  }

  /** Makes the next `due` call return true (e.g. when the overlay is shown). */
  reset(): void {
    this.last = null;
  }
}
