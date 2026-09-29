import { describe, it, expect } from 'vitest';
import { FallTracker, type FallTrackerState } from '../src/player/fallDamage';

function state(y: number, onGround: boolean): FallTrackerState {
  return { position: { y }, onGround };
}

describe('FallTracker', () => {
  it('short fall (within safeFallDistance) causes no damage', () => {
    const tracker = new FallTracker();
    tracker.update(state(3, false), false); // airborne, peak = 3
    tracker.update(state(1, false), false); // still airborne, falling
    const damage = tracker.update(state(0, true), false); // lands after a 3-block fall
    expect(damage).toBe(0);
  });

  it('long fall applies exact damage: drop from 10 blocks with safe=3 -> 7 damage', () => {
    const tracker = new FallTracker();
    tracker.update(state(10, false), false); // peak = 10
    tracker.update(state(5, false), false);
    const damage = tracker.update(state(0, true), false); // lands at y=0: fallDistance=10
    expect(damage).toBe(7);
  });

  it('jumping on flat ground causes no damage', () => {
    const tracker = new FallTracker();
    // Grounded, then a jump arcs up and back down to the same height.
    tracker.update(state(0, true), false);
    tracker.update(state(0, false), false); // leaves ground
    tracker.update(state(1.5, false), false); // apex
    const damage = tracker.update(state(0, true), false); // lands back at same height
    expect(damage).toBe(0);
  });

  it('landing in water causes no damage', () => {
    const tracker = new FallTracker();
    tracker.update(state(20, false), false); // big fall begins
    tracker.update(state(10, false), false);
    // Entering water at y=0 (inFluid=true) instead of landing on solid ground.
    const damage = tracker.update(state(0, false), true);
    expect(damage).toBe(0);
  });

  it('fall then fluid then ground causes no damage', () => {
    const tracker = new FallTracker();
    tracker.update(state(20, false), false); // falling
    tracker.update(state(5, false), true); // enters water, resets peak
    tracker.update(state(3, false), true); // still in water
    const damage = tracker.update(state(0, true), false); // exits water onto ground
    expect(damage).toBe(0);
  });

  it('reset clears the tracked peak', () => {
    const tracker = new FallTracker();
    tracker.update(state(20, false), false); // big fall tracked
    tracker.reset();
    // If the peak had survived, this would register a huge fall; instead
    // there is no prior "was airborne" state, so it lands with no damage.
    const damage = tracker.update(state(0, true), false);
    expect(damage).toBe(0);
  });

  it('walking off a 1-block ledge causes no damage', () => {
    const tracker = new FallTracker();
    tracker.update(state(5, true), false); // standing on the ledge
    tracker.update(state(5, false), false); // steps off, still ~same height
    const damage = tracker.update(state(4, true), false); // lands 1 block down
    expect(damage).toBe(0);
  });
});
