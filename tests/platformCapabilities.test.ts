import { describe, it, expect, vi } from 'vitest';
import {
  NEEDS_KEYBOARD_MOUSE_NOTICE,
  classifyPlatform,
  isPlayBlocked,
  readCapabilityInputs,
} from '../src/platform/capabilities';
import { requestLockSafely } from '../src/platform/pointerLock';
import { MenuFlow } from '../src/menu/MenuFlow';
import { BLOCKED_NOTICE, mainMenuModel } from '../src/menu/menuModel';
import { PauseController } from '../src/gameplay/pause';

describe('classifyPlatform', () => {
  it.each([
    [true, true, true, 'playable'],
    [true, true, null, 'playable'],
    [true, false, true, 'playable'], // touch primary, trackpad attached (iPad + trackpad)
    [true, false, false, 'needs-keyboard-mouse'],
    [true, false, null, 'needs-keyboard-mouse'],
    [true, null, null, 'unknown'],
    [false, true, true, 'needs-keyboard-mouse'],
    [false, null, null, 'needs-keyboard-mouse'],
  ] as const)('lock=%s fine=%s anyFine=%s -> %s', (lock, fine, anyFine, verdict) => {
    expect(classifyPlatform({ pointerLockSupported: lock, pointerFine: fine, anyPointerFine: anyFine })).toBe(verdict);
  });

  it('only needs-keyboard-mouse blocks play', () => {
    expect(isPlayBlocked('playable')).toBe(false);
    expect(isPlayBlocked('unknown')).toBe(false);
    expect(isPlayBlocked('needs-keyboard-mouse')).toBe(true);
  });
});

describe('readCapabilityInputs', () => {
  it('reads pointer lock and media queries', () => {
    const matchMedia = (q: string) => ({ matches: q === '(any-pointer: fine)' });
    expect(readCapabilityInputs({ document: { documentElement: { requestPointerLock: () => undefined } }, matchMedia })).toEqual({
      pointerLockSupported: true,
      pointerFine: false,
      anyPointerFine: true,
    });
  });

  it('missing API or matchMedia gives unsupported / null', () => {
    expect(readCapabilityInputs({ document: { documentElement: {} } })).toEqual({
      pointerLockSupported: false,
      pointerFine: null,
      anyPointerFine: null,
    });
    const throwing = () => {
      throw new Error('x');
    };
    expect(readCapabilityInputs({ document: { documentElement: {} }, matchMedia: throwing }).pointerFine).toBeNull();
  });
});

describe('menu gating', () => {
  it('a blocked device disables Continue / New world, shows the notice and Try anyway', () => {
    const model = mainMenuModel('loaded', 'needs-keyboard-mouse');
    expect(model).toMatchObject({ continueEnabled: false, newWorldEnabled: false, playBlocked: true });
    expect(model.notice).toContain(NEEDS_KEYBOARD_MOUSE_NOTICE);
    expect(mainMenuModel('blocked', 'needs-keyboard-mouse').notice).toContain(BLOCKED_NOTICE);
    expect(mainMenuModel('empty', 'playable').playBlocked).toBe(false);
    expect(mainMenuModel('empty', 'unknown').newWorldEnabled).toBe(true);
  });

  it('flow ignores actions until Try anyway, then restores the storage rules', () => {
    const flow = new MenuFlow({
      status: 'loaded',
      savedSeed: 7,
      clearSave: async () => undefined,
      random: () => 1,
      platform: 'needs-keyboard-mouse',
    });
    expect(flow.continueWorld().kind).toBe('pending');
    expect(flow.newWorld('').kind).toBe('pending');
    expect(flow.state).toBe('main');
    flow.tryAnyway();
    expect(flow.model.playBlocked).toBe(false);
    expect(flow.continueWorld()).toEqual({ kind: 'start', params: { seed: 7, newWorld: false } });
  });
});

describe('requestLockSafely', () => {
  it('reports unsupported when the API is missing', () => {
    expect(requestLockSafely({})).toBe('unsupported');
  });
  it('swallows a sync throw and a rejected promise', async () => {
    expect(
      requestLockSafely({
        requestPointerLock: () => {
          throw new Error('nope');
        },
      }),
    ).toBe('failed');
    const request = vi.fn(() => Promise.reject(new Error('refused')));
    expect(requestLockSafely({ requestPointerLock: request })).toBe('requested');
    await Promise.resolve();
  });
});

describe('pause without pointer lock', () => {
  it('stays paused on the start screen, never resumes, and the grace window expires', () => {
    const pause = new PauseController();
    pause.expectLock();
    let paused = true;
    for (let i = 0; i < 600; i++) {
      paused = pause.update(1 / 60, { locked: false, screenOpen: false, dead: false });
    }
    expect(paused).toBe(true);
    expect(pause.isStartScreen).toBe(true);
  });
});
