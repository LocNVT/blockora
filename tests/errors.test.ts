import { describe, expect, it, vi } from 'vitest';
import { classifyError } from '../src/errors/classifyError';
import {
  ErrorCoordinator,
  isBenignWindowMessage,
  type ErrorSinks,
  type FatalView,
} from '../src/errors/ErrorCoordinator';
import { describeError, formatReport, MAX_STACK_LINES, safeString, trimStack } from '../src/errors/errorReport';
import { RendererInitError, RendererUnavailableError } from '../src/errors/errorTypes';
import { guardFrame } from '../src/errors/frameGuard';

function makeCoordinator(): { coord: ErrorCoordinator; fatals: FatalView[]; banners: string[] } {
  const fatals: FatalView[] = [];
  const banners: string[] = [];
  const sinks: ErrorSinks = {
    showFatal: (view) => fatals.push(view),
    showBanner: (message) => banners.push(message),
    log: () => undefined,
  };
  return { coord: new ErrorCoordinator(sinks, { userAgent: 'UA/1.0', buildMode: 'test' }), fatals, banners };
}

describe('classifyError', () => {
  it('renderer unavailable -> WebGL2/WebGPU message with hardware acceleration hint', () => {
    const c = classifyError(new RendererUnavailableError(), 'renderer-init');
    expect(c.kind).toBe('renderer-unavailable');
    expect(c.headline).toContain('support WebGL2 or WebGPU');
    expect(c.explanation).toContain('hardware acceleration');
  });

  it('renderer init failure', () => {
    expect(classifyError(new RendererInitError('boom'), 'renderer-init').kind).toBe('renderer-init');
    expect(classifyError(new Error('x'), 'renderer-init').kind).toBe('renderer-init');
  });

  it('bootstrap, frame and runtime phases', () => {
    expect(classifyError(new Error('x'), 'bootstrap').kind).toBe('bootstrap');
    expect(classifyError(new Error('x'), 'frame').kind).toBe('frame');
    expect(classifyError(new Error('x'), 'runtime').kind).toBe('runtime');
  });

  it('handles errors without a stack and non-Error throwables', () => {
    const noStack = new Error('no stack');
    noStack.stack = undefined;
    for (const thrown of [noStack, 'a string', undefined, null, 42, { weird: true }, Symbol('s')]) {
      const c = classifyError(thrown, 'bootstrap');
      expect(c.kind).toBe('bootstrap');
      expect(c.headline.length).toBeGreaterThan(0);
    }
  });

  it('headline never contains the raw message or stack', () => {
    const err = new Error('SECRET_DETAIL at foo.ts:1');
    for (const phase of ['renderer-init', 'bootstrap', 'frame', 'runtime'] as const) {
      const c = classifyError(err, phase);
      expect(c.headline).not.toContain('SECRET_DETAIL');
      expect(c.explanation).not.toContain('SECRET_DETAIL');
    }
  });

  it('detects the renderer-unavailable error by name across realms', () => {
    const lookalike = Object.assign(new Error('x'), { name: 'RendererUnavailableError' });
    expect(classifyError(lookalike, 'bootstrap').kind).toBe('renderer-unavailable');
  });
});

describe('error report', () => {
  const context = { phase: 'frame', backend: 'webgl2', userAgent: 'UA/1.0', buildMode: 'production' } as const;

  it('contains all fields', () => {
    const report = formatReport(new TypeError('bad thing'), context);
    for (const part of ['TypeError', 'bad thing', 'Phase: frame', 'Backend: webgl2', 'UA/1.0', 'production', 'Stack:']) {
      expect(report).toContain(part);
    }
  });

  it('trims long stacks', () => {
    const err = new Error('deep');
    err.stack = Array.from({ length: 100 }, (_, i) => `at frame${i}`).join('\n');
    const details = describeError(err);
    expect(details.stack.split('\n').length).toBe(MAX_STACK_LINES + 1);
    expect(details.stack).toContain('more lines');
    expect(trimStack('a\nb', 5)).toBe('a\nb');
  });

  it('reports unknown backend and missing stack', () => {
    const noStack = new Error('x');
    noStack.stack = undefined;
    const report = formatReport(noStack, { ...context, backend: null });
    expect(report).toContain('Backend: unknown');
    expect(report).toContain('(no stack available)');
  });

  it('does not crash on circular or odd values', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    const hostile = {
      toString(): string {
        throw new Error('nope');
      },
    };
    for (const value of [circular, hostile, undefined, null, Symbol('s'), 10n, () => 1, { message: 5 }]) {
      expect(() => formatReport(value, context)).not.toThrow();
    }
    expect(safeString(circular)).toContain('[Circular]');
    expect(describeError({ name: 'Custom', message: 'm', stack: 's' })).toEqual({
      name: 'Custom',
      message: 'm',
      stack: 's',
    });
  });
});

describe('guardFrame', () => {
  it('reports the first failure once and stops calling the frame', () => {
    const frame = vi.fn(() => {
      throw new Error('frame boom');
    });
    const onFailure = vi.fn();
    const guarded = guardFrame(frame, onFailure);
    guarded(1);
    guarded(2);
    guarded(3);
    expect(frame).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('passes healthy frames through and never throws from the failure handler', () => {
    const frame = vi.fn();
    const guarded = guardFrame(frame, () => undefined);
    guarded(5);
    expect(frame).toHaveBeenCalledWith(5);

    const bad = guardFrame(
      () => {
        throw new Error('a');
      },
      () => {
        throw new Error('handler also broken');
      },
    );
    expect(() => bad(1)).not.toThrow();
  });
});

describe('ErrorCoordinator', () => {
  it('shows the fatal screen only once', () => {
    const { coord, fatals } = makeCoordinator();
    expect(coord.fatal(new Error('a'), 'frame')).toBe(true);
    expect(coord.fatal(new Error('b'), 'frame')).toBe(false);
    expect(fatals).toHaveLength(1);
    expect(fatals[0]?.classified.kind).toBe('frame');
    expect(fatals[0]?.report).toContain('Phase: frame');
  });

  it('frame-loop path: guard + coordinator yields exactly one fatal screen', () => {
    const { coord, fatals } = makeCoordinator();
    const guarded = guardFrame(
      () => {
        throw new Error('per-frame');
      },
      (error) => coord.fatal(error, 'frame'),
    );
    for (let i = 0; i < 10; i++) {
      guarded(i);
    }
    expect(fatals).toHaveLength(1);
  });

  it('late errors before the first frame are fatal', () => {
    const { coord, fatals, banners } = makeCoordinator();
    expect(coord.late(new Error('early'))).toBe('fatal');
    expect(fatals).toHaveLength(1);
    expect(banners).toHaveLength(0);
  });

  it('late errors after the first frame only show a banner', () => {
    const { coord, fatals, banners } = makeCoordinator();
    coord.markFirstFrame();
    expect(coord.late(new Error('optional feature'))).toBe('banner');
    expect(fatals).toHaveLength(0);
    expect(banners).toHaveLength(1);
  });

  it('late errors after a fatal are ignored (no spam)', () => {
    const { coord, fatals, banners } = makeCoordinator();
    coord.fatal(new Error('a'), 'bootstrap');
    expect(coord.late(new Error('b'))).toBe('ignored');
    expect(fatals).toHaveLength(1);
    expect(banners).toHaveLength(0);
  });

  it('de-duplicates banners by key', () => {
    const { coord, banners } = makeCoordinator();
    expect(coord.warn('save', 'Saving is unavailable')).toBe(true);
    expect(coord.warn('save', 'Saving is unavailable')).toBe(false);
    expect(coord.warn('worker', 'Fell back')).toBe(true);
    expect(banners).toEqual(['Saving is unavailable', 'Fell back']);
    coord.markFirstFrame();
    coord.late(new Error('1'));
    coord.late(new Error('2'));
    expect(banners.filter((b) => b.includes('background'))).toHaveLength(1);
  });

  it('never throws when sinks fail', () => {
    const broken = (): never => {
      throw new Error('gone');
    };
    const coord = new ErrorCoordinator(
      { showFatal: broken, showBanner: broken, log: broken },
      { userAgent: 'x', buildMode: 'test' },
    );
    expect(() => coord.fatal(new Error('a'), 'bootstrap')).not.toThrow();
    expect(() => coord.warn('k', 'm')).not.toThrow();
    expect(() => coord.late(undefined)).not.toThrow();
  });

  it('includes the backend once known', () => {
    const { coord, fatals } = makeCoordinator();
    coord.setBackend('webgl2');
    coord.fatal('string error', 'frame');
    expect(fatals[0]?.report).toContain('Backend: webgl2');
  });
});

describe('isBenignWindowMessage', () => {
  it('filters ResizeObserver notices only', () => {
    expect(isBenignWindowMessage('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isBenignWindowMessage('TypeError: x')).toBe(false);
    expect(isBenignWindowMessage(undefined)).toBe(false);
  });
});

// Regression (Codex review): the frame-failure text said the world was saved,
// but the flush is best-effort (skipped after a save failure, async otherwise).
describe('frame failure wording', () => {
  it('does not claim the world was saved', () => {
    const { explanation } = classifyError(new Error('boom'), 'frame');
    expect(explanation.toLowerCase()).not.toContain('was saved');
    expect(explanation).toContain('may be lost');
  });
});
