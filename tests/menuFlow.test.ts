import { describe, it, expect, vi } from 'vitest';
import { MenuFlow } from '../src/menu/MenuFlow';
import {
  BLOCKED_NOTICE,
  LOADING_STAGES,
  UNAVAILABLE_NOTICE,
  loadingProgress,
  mainMenuModel,
  nextQuitStep,
  storageStatusOf,
  type StorageStatus,
} from '../src/menu/menuModel';

function makeFlow(status: StorageStatus, savedSeed: number | null = null, clear = vi.fn(async () => undefined)) {
  const flow = new MenuFlow({ status, savedSeed, clearSave: clear, random: () => 4242 });
  return { flow, clear };
}

describe('mainMenuModel', () => {
  it('maps every storage status to its buttons and notice', () => {
    expect(mainMenuModel('loaded')).toMatchObject({ continueEnabled: true, newWorldNeedsConfirm: true, notice: null });
    expect(mainMenuModel('empty')).toMatchObject({ continueEnabled: false, newWorldNeedsConfirm: false, notice: null });
    expect(mainMenuModel('blocked')).toMatchObject({
      continueEnabled: false,
      newWorldNeedsConfirm: true,
      notice: BLOCKED_NOTICE,
    });
    expect(mainMenuModel('unavailable')).toMatchObject({
      continueEnabled: false,
      newWorldNeedsConfirm: false,
      savingAvailable: false,
      notice: UNAVAILABLE_NOTICE,
    });
    expect(UNAVAILABLE_NOTICE).toBe('Saving unavailable in this browser');
  });

  it('always offers New world', () => {
    for (const status of ['loaded', 'empty', 'blocked', 'unavailable'] as const) {
      expect(mainMenuModel(status).newWorldEnabled).toBe(true);
    }
  });

  it('treats a missing store as unavailable whatever the load result says', () => {
    expect(storageStatusOf(false, { status: 'empty' })).toBe('unavailable');
    expect(storageStatusOf(true, { status: 'blocked', error: new Error('x') })).toBe('blocked');
    expect(storageStatusOf(true, { status: 'empty' })).toBe('empty');
  });
});

describe('MenuFlow', () => {
  it('Continue starts the saved seed without a new world', () => {
    const { flow, clear } = makeFlow('loaded', 99);
    expect(flow.continueWorld()).toEqual({ kind: 'start', params: { seed: 99, newWorld: false } });
    expect(clear).not.toHaveBeenCalled();
  });

  it('Continue does nothing when disabled', () => {
    for (const status of ['empty', 'blocked', 'unavailable'] as const) {
      expect(makeFlow(status, 5).flow.continueWorld()).toEqual({ kind: 'pending' });
    }
  });

  it('suggests the injected random seed and uses it for a blank field', () => {
    const { flow } = makeFlow('empty');
    expect(flow.suggestedSeed).toBe(4242);
    expect(flow.newWorld('')).toEqual({ kind: 'start', params: { seed: 4242, newWorld: true } });
  });

  it('starts a typed seed immediately when nothing is stored, without clearing', () => {
    for (const status of ['empty', 'unavailable'] as const) {
      const { flow, clear } = makeFlow(status);
      expect(flow.newWorld('7')).toEqual({ kind: 'start', params: { seed: 7, newWorld: true } });
      expect(clear).not.toHaveBeenCalled();
    }
  });

  it('asks for confirmation before replacing a save and clears nothing until confirmed', () => {
    for (const status of ['loaded', 'blocked'] as const) {
      const { flow, clear } = makeFlow(status, 1);
      expect(flow.newWorld('abc')).toEqual({ kind: 'pending' });
      expect(flow.state).toBe('confirm-replace');
      expect(clear).not.toHaveBeenCalled();
    }
  });

  it('clears exactly once after confirm, then starts the chosen seed as a new world', async () => {
    const { flow, clear } = makeFlow('loaded', 1);
    flow.newWorld('31337');
    expect(flow.pendingNewSeed).toBe(31337);
    const result = await flow.confirmReplace();
    expect(result).toEqual({ kind: 'start', params: { seed: 31337, newWorld: true } });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(await flow.confirmReplace()).toEqual({ kind: 'pending' });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('cancel keeps the save: nothing cleared and Continue still works', async () => {
    const { flow, clear } = makeFlow('loaded', 12);
    flow.newWorld('5');
    flow.cancelReplace();
    expect(flow.state).toBe('main');
    expect(await flow.confirmReplace()).toEqual({ kind: 'pending' });
    expect(clear).not.toHaveBeenCalled();
    expect(flow.continueWorld()).toEqual({ kind: 'start', params: { seed: 12, newWorld: false } });
  });

  it('confirm without asking first does not clear', async () => {
    const { flow, clear } = makeFlow('loaded', 1);
    expect(await flow.confirmReplace()).toEqual({ kind: 'pending' });
    expect(clear).not.toHaveBeenCalled();
  });

  it('blocked save: New world after confirm clears and starts a new world', async () => {
    const { flow, clear } = makeFlow('blocked');
    flow.newWorld('');
    const result = await flow.confirmReplace();
    expect(result).toEqual({ kind: 'start', params: { seed: 4242, newWorld: true } });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('a failing clear reports an error, starts nothing and returns to the main view', async () => {
    const { flow } = makeFlow('loaded', 1, vi.fn(async () => Promise.reject(new Error('disk full'))));
    flow.newWorld('9');
    const result = await flow.confirmReplace();
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.message).toContain('disk full');
    expect(flow.state).toBe('main');
  });

  it('ignores New world while a confirm is pending', () => {
    const { flow } = makeFlow('loaded', 1);
    flow.newWorld('1');
    expect(flow.newWorld('2')).toEqual({ kind: 'pending' });
    expect(flow.pendingNewSeed).toBe(1);
  });
});

describe('nextQuitStep', () => {
  it('saves then quits when saving works', () => {
    expect(nextQuitStep(true, false)).toBe('save-and-quit');
    expect(nextQuitStep(true, true)).toBe('save-and-quit');
  });

  it('warns first and quits on the second click when saving is off', () => {
    expect(nextQuitStep(false, false)).toBe('warn');
    expect(nextQuitStep(false, true)).toBe('quit');
  });
});

describe('loading stages', () => {
  it('progress rises with each stage and stays below 1 while loading', () => {
    const values = LOADING_STAGES.map((stage) => loadingProgress(stage.id));
    expect(values[0]).toBe(0);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1] as number);
    }
    expect(values[values.length - 1]).toBeLessThan(1);
  });
});
