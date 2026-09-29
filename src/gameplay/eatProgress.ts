import { SURVIVAL_CONFIG } from '../config/constants';
import type { ItemId } from '../items/items';

/** Progress state a single ongoing eat action can be in, returned by `EatProgress.update`. */
export type EatState = 'idle' | 'eating' | 'eaten';

/**
 * Pure per-frame accumulator for a single "hold to eat" action, mirroring
 * `BreakProgress`. Call `update` once per frame with the currently selected
 * item id (or null/non-food), whether hunger has room (`canEat`), whether the
 * use button is held, and the frame's dt. Resets whenever the selected item
 * changes, hunger becomes full, or the button is released.
 */
export class EatProgress {
  private accumulated = 0;
  private target: ItemId | null = null;

  /** Fraction 0..1 of `SURVIVAL_CONFIG.eatDuration` accumulated so far. */
  get progress(): number {
    return Math.min(1, this.accumulated / SURVIVAL_CONFIG.eatDuration);
  }

  private reset(): void {
    this.accumulated = 0;
    this.target = null;
  }

  update(itemId: ItemId | null, canEat: boolean, held: boolean, dt: number): EatState {
    const clampedDt = Math.max(0, dt);

    if (!held || itemId === null || !canEat) {
      this.reset();
      return 'idle';
    }

    if (this.target !== itemId) {
      this.accumulated = 0;
      this.target = itemId;
    }

    this.accumulated += clampedDt;

    if (this.accumulated >= SURVIVAL_CONFIG.eatDuration) {
      this.reset();
      return 'eaten';
    }

    return 'eating';
  }
}
