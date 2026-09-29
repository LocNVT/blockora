import { describe, it, expect } from 'vitest';
import { EatProgress } from '../src/gameplay/eatProgress';
import { ItemId } from '../src/items/items';
import { SURVIVAL_CONFIG } from '../src/config/constants';

describe('EatProgress', () => {
  it('accumulates progress across frames toward eatDuration', () => {
    const progress = new EatProgress();
    const half = SURVIVAL_CONFIG.eatDuration / 2;
    expect(progress.update(ItemId.Apple, true, true, half)).toBe('eating');
    expect(progress.progress).toBeCloseTo(0.5, 6);
    expect(progress.update(ItemId.Apple, true, true, half)).toBe('eaten');
  });

  it('completes exactly once at eatDuration, then resets', () => {
    const progress = new EatProgress();
    progress.update(ItemId.Apple, true, true, SURVIVAL_CONFIG.eatDuration * 0.75);
    expect(progress.update(ItemId.Apple, true, true, SURVIVAL_CONFIG.eatDuration * 0.5)).toBe('eaten');
    expect(progress.progress).toBe(0);
    // Continuing to hold starts a fresh accumulation, not an immediate repeat.
    expect(progress.update(ItemId.Apple, true, true, 0)).toBe('eating');
    expect(progress.progress).toBe(0);
  });

  it('resets on release', () => {
    const progress = new EatProgress();
    progress.update(ItemId.Apple, true, true, SURVIVAL_CONFIG.eatDuration * 0.5);
    expect(progress.update(ItemId.Apple, true, false, 0)).toBe('idle');
    expect(progress.progress).toBe(0);
  });

  it('resets when the selected item changes', () => {
    const progress = new EatProgress();
    progress.update(ItemId.Apple, true, true, SURVIVAL_CONFIG.eatDuration * 0.75);
    expect(progress.progress).toBeCloseTo(0.75, 6);
    progress.update(ItemId.Stone as unknown as ItemId, true, true, 0);
    expect(progress.progress).toBe(0);
  });

  it('blocked (idle) when hunger is full (canEat false), even while held', () => {
    const progress = new EatProgress();
    expect(progress.update(ItemId.Apple, false, true, SURVIVAL_CONFIG.eatDuration)).toBe('idle');
    expect(progress.progress).toBe(0);
  });

  it('idle when itemId is null', () => {
    const progress = new EatProgress();
    expect(progress.update(null, true, true, SURVIVAL_CONFIG.eatDuration)).toBe('idle');
  });

  it('idle when not held, even with a valid food item', () => {
    const progress = new EatProgress();
    expect(progress.update(ItemId.Apple, true, false, 1)).toBe('idle');
  });

  it('clamps a negative dt to 0 rather than reducing progress', () => {
    const progress = new EatProgress();
    progress.update(ItemId.Apple, true, true, SURVIVAL_CONFIG.eatDuration * 0.5);
    expect(progress.update(ItemId.Apple, true, true, -5)).toBe('eating');
    expect(progress.progress).toBeCloseTo(0.5, 6);
  });

  it('is deterministic given the same sequence of calls', () => {
    const run = (): string[] => {
      const progress = new EatProgress();
      const step = SURVIVAL_CONFIG.eatDuration / 4;
      return [
        progress.update(ItemId.Apple, true, true, step),
        progress.update(ItemId.Apple, true, true, step),
        progress.update(ItemId.Apple, true, true, step),
        progress.update(ItemId.Apple, true, true, step),
      ];
    };
    expect(run()).toEqual(run());
  });
});
