import { PAUSE_CONFIG } from '../config/constants';

/** What the pause decision depends on, sampled once per frame. */
export interface PauseContext {
  /** Pointer lock is held by the game canvas. */
  readonly locked: boolean;
  /** Inventory / crafting / chest screen is open (it owns the unlocked cursor). */
  readonly screenOpen: boolean;
  /** Player is dead (the death screen owns the unlocked cursor). */
  readonly dead: boolean;
}

/**
 * Decides whether the game is paused. Paused means "unlocked with nothing
 * else owning the cursor": Esc (browser releases pointer lock), alt-tab, or a
 * refused lock request all land there, and only regaining the lock resumes.
 * `expectLock()` opens a short grace window after the game itself requests the
 * lock (closing a screen, respawning) so the async lock acquisition does not
 * flash the pause menu.
 */
export class PauseController {
  private grace = 0;
  private everLocked = false;
  private pausedNow = true;

  /** The game just asked for pointer lock; do not pause while it is being acquired. */
  expectLock(): void {
    this.grace = PAUSE_CONFIG.lockGraceSeconds;
  }

  get paused(): boolean {
    return this.pausedNow;
  }

  /** True until the pointer has been locked once: the menu then reads "Click to play". */
  get isStartScreen(): boolean {
    return !this.everLocked;
  }

  /** Re-evaluates the state for this frame; returns whether the game is paused. */
  update(dt: number, context: PauseContext): boolean {
    if (context.locked) {
      this.grace = 0;
      this.everLocked = true;
    } else if (!context.screenOpen && !context.dead) {
      this.grace = Math.max(0, this.grace - Math.max(0, dt));
    }
    this.pausedNow = !context.locked && !context.screenOpen && !context.dead && this.grace <= 0;
    return this.pausedNow;
  }
}

/** Simulation time step: zero while paused, so every timer / physics / survival step is a no-op. */
export function simulationDt(paused: boolean, dt: number): number {
  return paused ? 0 : dt;
}
