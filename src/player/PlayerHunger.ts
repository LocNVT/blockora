import { SURVIVAL_CONFIG } from '../config/constants';
import type { PlayerHealth } from './PlayerHealth';

/**
 * Pure hunger tracker: integer hunger points (half-drumsticks = 1 point, like
 * health's half-hearts) plus an exhaustion accumulator that converts into
 * hunger loss (see `addExhaustion`). Contains no rendering/DOM/UI — see
 * `HungerHud` for the visual side, and `tickSurvival` for the time-based
 * drain/regen/starvation rules built on top of this class.
 */
export class PlayerHunger {
  private _hunger: number;
  private _exhaustion = 0;

  constructor(public readonly maxHunger: number = SURVIVAL_CONFIG.maxHunger) {
    this._hunger = maxHunger;
  }

  get hunger(): number {
    return this._hunger;
  }

  get exhaustion(): number {
    return this._exhaustion;
  }

  /**
   * Accumulates exhaustion; every `exhaustionPerHungerPoint` reached converts
   * into 1 lost hunger point (hunger clamped at 0), and the converted amount
   * is deducted from the accumulator so leftover exhaustion carries over.
   * No-op for non-positive amounts.
   */
  addExhaustion(amount: number): void {
    if (amount <= 0) {
      return;
    }
    this._exhaustion += amount;

    const perPoint = SURVIVAL_CONFIG.exhaustionPerHungerPoint;
    while (this._exhaustion >= perPoint && this._hunger > 0) {
      this._exhaustion -= perPoint;
      this._hunger -= 1;
    }
    // Once hunger has bottomed out, stop banking further exhaustion so it
    // can't build up an unbounded "debt" while starving.
    if (this._hunger <= 0) {
      this._hunger = 0;
      this._exhaustion = Math.min(this._exhaustion, perPoint);
    }
  }

  /** Eats `foodPoints` of hunger, clamped at `maxHunger`. No-op for non-positive values. */
  eat(foodPoints: number): void {
    if (foodPoints <= 0) {
      return;
    }
    this._hunger = Math.min(this.maxHunger, this._hunger + foodPoints);
  }

  /** True while hunger is below max (there's room to eat). */
  canEat(): boolean {
    return this._hunger < this.maxHunger;
  }

  /** True while hunger is above `SURVIVAL_CONFIG.sprintMinHunger`. */
  canSprint(): boolean {
    return this._hunger > SURVIVAL_CONFIG.sprintMinHunger;
  }

  /** Restores full hunger and clears the exhaustion accumulator (respawn). */
  reset(): void {
    this._hunger = this.maxHunger;
    this._exhaustion = 0;
  }
}

/** This frame's exhaustion-causing activity, sampled by the caller before `stepPlayer`/movement resolution. */
export interface SurvivalActivity {
  /** True if the player is sprinting and actually moving this frame. */
  readonly sprinting: boolean;
  /** True if the player jumped (left the ground via a jump) this frame. */
  readonly jumped: boolean;
}

/**
 * Deterministic per-frame ticker applying `SURVIVAL_CONFIG`'s hunger/health
 * interaction rules on top of a `PlayerHealth` + `PlayerHunger` pair:
 *
 * - Exhaustion: idle drain every frame, plus sprint drain and a fixed
 *   per-jump amount when `activity` says so.
 * - Regeneration: every `regenInterval` seconds, while hunger is at or above
 *   `regenHungerThreshold` and health is below max, heals 1 HP and charges
 *   `regenExhaustion`. Never regenerates at max health (the interval timer
 *   does not advance, so regen resumes immediately once health drops again).
 * - Starvation: every `starvationInterval` seconds, while hunger is exactly
 *   0, damages 1 HP via `PlayerHealth.damage(1, 'starvation')` — but never
 *   below `starvationMinHealth` (enforced here, not in `PlayerHealth`).
 *
 * All timers freeze while `health.isDead` (no effects while dead), and `dt`
 * is clamped to >= 0 so a stray negative delta can't run timers backwards.
 * Timers are real elapsed-seconds accumulators, so summing many small `dt`s
 * or a few large ones produces the same number of ticks (determinism).
 */
export class SurvivalTicker {
  private regenTimer = 0;
  private starvationTimer = 0;

  update(health: PlayerHealth, hunger: PlayerHunger, dt: number, activity: SurvivalActivity): void {
    if (health.isDead) {
      return;
    }
    const clampedDt = Math.max(0, dt);

    const idleExhaustion = SURVIVAL_CONFIG.idleExhaustionPerSecond * clampedDt;
    const sprintExhaustion = activity.sprinting
      ? SURVIVAL_CONFIG.sprintExhaustionPerSecond * clampedDt
      : 0;
    const jumpExhaustion = activity.jumped ? SURVIVAL_CONFIG.jumpExhaustion : 0;
    hunger.addExhaustion(idleExhaustion + sprintExhaustion + jumpExhaustion);

    const canRegen = hunger.hunger >= SURVIVAL_CONFIG.regenHungerThreshold && health.health < health.maxHealth;
    if (canRegen) {
      this.regenTimer += clampedDt;
      while (this.regenTimer >= SURVIVAL_CONFIG.regenInterval) {
        this.regenTimer -= SURVIVAL_CONFIG.regenInterval;
        if (health.health >= health.maxHealth) {
          // Topped up mid-loop (shouldn't normally happen for +1 heals, but
          // keeps this deterministic if maxHealth is ever tiny): stop ticking
          // further heals this frame instead of overshooting.
          break;
        }
        health.heal(1);
        hunger.addExhaustion(SURVIVAL_CONFIG.regenExhaustion);
      }
    } else {
      this.regenTimer = 0;
    }

    const starving = hunger.hunger <= 0;
    if (starving) {
      this.starvationTimer += clampedDt;
      while (this.starvationTimer >= SURVIVAL_CONFIG.starvationInterval) {
        this.starvationTimer -= SURVIVAL_CONFIG.starvationInterval;
        if (health.health <= SURVIVAL_CONFIG.starvationMinHealth) {
          break;
        }
        health.damage(1, 'starvation');
      }
    } else {
      this.starvationTimer = 0;
    }
  }

  /** Clears accumulated timers (call on respawn). */
  reset(): void {
    this.regenTimer = 0;
    this.starvationTimer = 0;
  }
}
