import { SURVIVAL_CONFIG } from '../config/constants';

/**
 * Where damage came from; `'void'` bypasses the invulnerability window (see
 * `damage`). `'starvation'` is applied by `tickSurvival`, which enforces its
 * own min-health floor (see `SURVIVAL_CONFIG.starvationMinHealth`) — this
 * class treats it like any other non-void source otherwise.
 */
export type DamageSource = 'fall' | 'void' | 'generic' | 'starvation';

/**
 * Pure player health tracker: integer health points (half-hearts = 1 point),
 * a brief invulnerability window after taking non-void damage, and death
 * state. Contains no rendering/DOM/UI — see `HealthHud` for the visual side.
 */
export class PlayerHealth {
  private _health: number;
  private _isDead = false;
  private invulnerabilityRemaining = 0;

  constructor(public readonly maxHealth: number = SURVIVAL_CONFIG.maxHealth) {
    this._health = maxHealth;
  }

  get health(): number {
    return this._health;
  }

  get isDead(): boolean {
    return this._isDead;
  }

  /** True while a non-void hit is still within its invulnerability window. */
  get isInvulnerable(): boolean {
    return this.invulnerabilityRemaining > 0;
  }

  /**
   * Applies damage, returning the amount actually applied (0 if ignored).
   * Ignored when `amount <= 0`, while already dead, or while invulnerable
   * (unless `source === 'void'`, which always applies). Clamps health at 0
   * and sets `isDead` when it reaches 0. Non-void damage restarts the
   * invulnerability window.
   */
  damage(amount: number, source: DamageSource): number {
    if (amount <= 0 || this._isDead) {
      return 0;
    }
    if (this.isInvulnerable && source !== 'void') {
      return 0;
    }

    const applied = Math.min(amount, this._health);
    this._health -= applied;

    if (source !== 'void') {
      this.invulnerabilityRemaining = SURVIVAL_CONFIG.damageInvulnerability;
    }

    if (this._health <= 0) {
      this._health = 0;
      this._isDead = true;
    }

    return applied;
  }

  /** Heals up to `maxHealth`; no-op while dead. */
  heal(amount: number): void {
    if (amount <= 0 || this._isDead) {
      return;
    }
    this._health = Math.min(this.maxHealth, this._health + amount);
  }

  /** Ticks the invulnerability timer down; `dt` clamped to >= 0. */
  update(dt: number): void {
    const clampedDt = Math.max(dt, 0);
    if (this.invulnerabilityRemaining > 0) {
      this.invulnerabilityRemaining = Math.max(0, this.invulnerabilityRemaining - clampedDt);
    }
  }

  /**
   * Sets health from a save (clamped to 0..maxHealth, rounded down to whole
   * points). Health 0 restores the dead state; invulnerability is cleared.
   */
  restore(health: number): void {
    this._health = Math.max(0, Math.min(this.maxHealth, Math.floor(health)));
    this._isDead = this._health <= 0;
    this.invulnerabilityRemaining = 0;
  }

  /** Restores full health and clears death/invulnerability state (respawn). */
  reset(): void {
    this._health = this.maxHealth;
    this._isDead = false;
    this.invulnerabilityRemaining = 0;
  }
}
