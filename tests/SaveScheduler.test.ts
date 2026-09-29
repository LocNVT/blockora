import { describe, it, expect } from 'vitest';
import { SaveScheduler } from '../src/save/SaveScheduler';

/** Save task whose promises the test resolves/rejects by hand. */
function controllableTask(): {
  task: () => Promise<void>;
  calls: number;
  resolve: () => void;
  reject: (e: unknown) => void;
} {
  const pending: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  const handle = {
    calls: 0,
    task: (): Promise<void> => {
      handle.calls += 1;
      return new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
    },
    resolve: (): void => pending.shift()?.resolve(),
    reject: (e: unknown): void => pending.shift()?.reject(e),
  };
  return handle;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('SaveScheduler', () => {
  it('saves once per interval, only when dirty', async () => {
    const t = controllableTask();
    let dirty = false;
    const s = new SaveScheduler(10, t.task, () => dirty, () => {});
    s.update(9.9);
    expect(t.calls).toBe(0);
    s.update(0.2);
    expect(t.calls).toBe(0); // interval reached but clean

    dirty = true;
    s.update(5);
    expect(t.calls).toBe(0); // interval restarted after the clean check
    s.update(5);
    expect(t.calls).toBe(1);
    t.resolve();
    await settle();
    s.update(9);
    expect(t.calls).toBe(1);
    s.update(1);
    expect(t.calls).toBe(2);
  });

  it('never overlaps saves: the interval check is deferred while one is in flight', async () => {
    const t = controllableTask();
    const s = new SaveScheduler(1, t.task, () => true, () => {});
    s.update(1);
    expect(s.saving).toBe(true);
    s.update(5);
    s.update(5);
    expect(t.calls).toBe(1);
    t.resolve();
    await settle();
    expect(s.saving).toBe(false);
    s.update(0);
    expect(t.calls).toBe(2);
  });

  it('flush saves immediately even when clean, and queues behind an in-flight save', async () => {
    const t = controllableTask();
    const s = new SaveScheduler(10, t.task, () => false, () => {});
    s.flush();
    expect(t.calls).toBe(1);
    s.flush();
    s.flush();
    expect(t.calls).toBe(1);
    t.resolve();
    await settle();
    expect(t.calls).toBe(2); // one queued flush, not two
    t.resolve();
    await settle();
    expect(t.calls).toBe(2);
  });

  it('reports failures (async and sync) via onError and keeps scheduling', async () => {
    const errors: unknown[] = [];
    const t = controllableTask();
    const s = new SaveScheduler(1, t.task, () => true, (e) => errors.push(e));
    s.update(1);
    t.reject(new Error('disk full'));
    await settle();
    expect(errors).toHaveLength(1);
    s.update(1);
    expect(t.calls).toBe(2);

    const throwing = new SaveScheduler(1, () => { throw new Error('sync'); }, () => true, (e) => errors.push(e));
    expect(() => throwing.flush()).not.toThrow();
    await settle();
    expect(errors).toHaveLength(2);
    expect(throwing.saving).toBe(false);
  });
});
