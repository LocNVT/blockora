/**
 * Decides when to save; the save itself is injected so this stays pure and
 * testable. Rules:
 * - `update(dt)` (every frame): once `intervalSeconds` have elapsed, saves if
 *   `isDirty()`; the check is deferred while a save is still in flight.
 * - `flush()` (tab hidden / page hide): saves now regardless of the dirty
 *   flag; while a save is in flight it is queued and runs right after.
 * - At most one save is in flight at a time; a failing save is reported via
 *   `onError` and never throws into the caller (the frame loop).
 */
export class SaveScheduler {
  private elapsed = 0;
  private inFlight = false;
  private flushQueued = false;

  constructor(
    private readonly intervalSeconds: number,
    private readonly task: () => Promise<void>,
    private readonly isDirty: () => boolean,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** True while a save is running. */
  get saving(): boolean {
    return this.inFlight;
  }

  update(dt: number): void {
    this.elapsed += Math.max(0, dt);
    if (this.elapsed < this.intervalSeconds || this.inFlight) {
      return;
    }
    this.elapsed = 0;
    if (this.isDirty()) {
      this.run();
    }
  }

  flush(): void {
    if (this.inFlight) {
      this.flushQueued = true;
      return;
    }
    this.elapsed = 0;
    this.run();
  }

  private run(): void {
    this.inFlight = true;
    let pending: Promise<void>;
    try {
      pending = this.task();
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending.catch(this.onError).finally(() => {
      this.inFlight = false;
      if (this.flushQueued) {
        this.flushQueued = false;
        this.flush();
      }
    });
  }
}
