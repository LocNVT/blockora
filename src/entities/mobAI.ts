import type { MobEntity } from './EntityStore';
import type { MobDefinition } from './mobDefinitions';
import { MOB_CONFIG } from '../config/constants';

/** Injected seeded RNG: `() => number` in [0, 1), same shape as Math.random. Deterministic given a fixed sequence. */
export type Rng = () => number;

const TWO_PI = Math.PI * 2;

function randomRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Shortest signed angular difference from `from` to `to`, in (-PI, PI]. */
function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) {
    delta -= TWO_PI;
  } else if (delta < -Math.PI) {
    delta += TWO_PI;
  }
  return delta;
}

/** Turns `mob.yaw` toward `mob.ai.targetYaw` at MOB_CONFIG.turnSpeed, clamped so it never overshoots. */
function turnTowardTarget(mob: MobEntity, dt: number): void {
  const delta = shortestAngleDelta(mob.yaw, mob.ai.targetYaw);
  const maxStep = MOB_CONFIG.turnSpeed * dt;
  if (Math.abs(delta) <= maxStep) {
    mob.yaw = mob.ai.targetYaw;
  } else {
    mob.yaw += Math.sign(delta) * maxStep;
  }
}

/**
 * Advances one mob's Idle <-> Wander state machine by `dt` seconds using the
 * injected `rng`. Idle picks a random duration and waits; Wander picks a
 * random target yaw and a random duration, and smoothly turns `mob.yaw`
 * toward it every tick (actual movement happens in mobPhysics.ts, which
 * reads `mob.yaw`). Deterministic given the same rng call sequence.
 */
export function updateMobAi(mob: MobEntity, def: MobDefinition, dt: number, rng: Rng): void {
  mob.ai.timer -= dt;

  if (mob.ai.timer > 0) {
    if (mob.ai.state === 'wander') {
      turnTowardTarget(mob, dt);
    }
    return;
  }

  if (mob.ai.state === 'idle') {
    mob.ai.state = 'wander';
    mob.ai.timer = randomRange(rng, def.wanderDurationMin, def.wanderDurationMax);
    mob.ai.targetYaw = randomRange(rng, -Math.PI, Math.PI);
  } else {
    mob.ai.state = 'idle';
    mob.ai.timer = randomRange(rng, def.idleDurationMin, def.idleDurationMax);
  }
}
