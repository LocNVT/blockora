import { SURVIVAL_CONFIG } from '../config/constants';

/** Minimal shape of player state `FallTracker` needs (avoids importing the full PlayerState). */
export interface FallTrackerState {
  position: { y: number };
  onGround: boolean;
}

/**
 * Tracks the player's peak height since they were last grounded or in a
 * fluid, and computes fall damage on the frame they land. Deterministic and
 * pure — no timers, no randomness.
 *
 * - While airborne (not on ground, not in fluid), `peakY` tracks the highest
 *   y reached since the last time the player was grounded/in-fluid.
 * - Entering a fluid resets `peakY` (no fall damage from landing in water).
 * - On the frame `onGround` transitions from false to true, damage is
 *   `max(0, floor(fallDistance - safeFallDistance)) * fallDamagePerBlock`,
 *   where `fallDistance = peakY - landingY`.
 */
export class FallTracker {
  private peakY: number | null = null;
  private wasOnGround = false;

  /**
   * Call once per physics step, after collision resolution has updated
   * `state.position`/`state.onGround`. Returns the fall damage to apply this
   * frame (0 most frames).
   */
  update(state: FallTrackerState, inFluid: boolean): number {
    const { position, onGround } = state;

    if (inFluid) {
      // Entering (or resting in) fluid clears the tracked peak: no damage
      // for landing in water, and no damage is carried past a water entry
      // (e.g. fall -> enter water -> later exit onto ground).
      this.peakY = null;
      this.wasOnGround = onGround;
      return 0;
    }

    if (onGround) {
      let damage = 0;
      // Only compute damage on the landing frame (was airborne, now
      // grounded) with a tracked peak — landing right after fluid (peakY
      // reset to null on entry) or on the very first frame yields 0.
      if (!this.wasOnGround && this.peakY !== null) {
        const fallDistance = this.peakY - position.y;
        const excess = Math.floor(fallDistance - SURVIVAL_CONFIG.safeFallDistance);
        damage = Math.max(0, excess) * SURVIVAL_CONFIG.fallDamagePerBlock;
      }

      // Grounded: reset tracking so the next airborne stretch starts fresh.
      this.peakY = null;
      this.wasOnGround = true;
      return damage;
    }

    // Airborne, not in fluid: track the peak height reached.
    if (this.peakY === null || position.y > this.peakY) {
      this.peakY = position.y;
    }
    this.wasOnGround = false;
    return 0;
  }

  /** Clears tracked peak/grounded state (call on respawn/teleport). */
  reset(): void {
    this.peakY = null;
    this.wasOnGround = false;
  }
}
