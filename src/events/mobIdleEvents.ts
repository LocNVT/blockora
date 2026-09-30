import { AUDIO_CONFIG } from '../config/constants';
import type { EventPosition, GameEventSink } from './GameEvents';

/** The bit of a mob the idle scheduler needs. */
export interface IdleCandidate {
  readonly type: number;
  readonly position: EventPosition;
}

/**
 * Occasionally makes one nearby mob voice an idle sound: a single shared
 * countdown (random between the configured min and max seconds) rather than a
 * timer per mob, so a crowd never chorus-calls.
 */
export class MobIdleEventTimer {
  private remaining: number;

  constructor(
    private readonly sink: GameEventSink,
    private readonly rng: () => number,
  ) {
    this.remaining = this.nextInterval();
  }

  private nextInterval(): number {
    const { mobIdleIntervalMin, mobIdleIntervalMax } = AUDIO_CONFIG;
    return mobIdleIntervalMin + this.rng() * (mobIdleIntervalMax - mobIdleIntervalMin);
  }

  update(dt: number, mobs: readonly IdleCandidate[], listener: EventPosition): void {
    this.remaining -= Math.max(0, dt);
    if (this.remaining > 0) {
      return;
    }
    this.remaining = this.nextInterval();
    const maxSq = AUDIO_CONFIG.maxHearingDistance ** 2;
    const audible = mobs.filter((mob) => {
      const dx = mob.position.x - listener.x;
      const dy = mob.position.y - listener.y;
      const dz = mob.position.z - listener.z;
      return dx * dx + dy * dy + dz * dz < maxSq;
    });
    const chosen = audible[Math.floor(this.rng() * audible.length)];
    if (chosen !== undefined) {
      this.sink.emit({ type: 'mobIdle', mobType: chosen.type, position: chosen.position });
    }
  }
}
