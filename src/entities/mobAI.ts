import type { MobEntity } from './EntityStore';
import type { HostileStats, MobDefinition } from './mobDefinitions';
import { MOB_CONFIG, COMBAT_CONFIG, PLAYER_CONFIG } from '../config/constants';
import type { SolidQuery } from '../world/SolidQuery';
import { createVoxelRaycastHit, raycastVoxels } from '../world/voxelRaycast';

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

/** Turns `mob.yaw` toward `mob.ai.targetYaw` at `turnSpeed` rad/s, clamped so it never overshoots. */
function turnTowardTarget(mob: MobEntity, dt: number, turnSpeed: number = MOB_CONFIG.turnSpeed): void {
  const delta = shortestAngleDelta(mob.yaw, mob.ai.targetYaw);
  const maxStep = turnSpeed * dt;
  if (Math.abs(delta) <= maxStep) {
    mob.yaw = mob.ai.targetYaw;
  } else {
    mob.yaw += Math.sign(delta) * maxStep;
  }
}

/** What a hostile mob needs to know about the player this tick; supplied by the caller (no player types imported). */
export interface HostileAiContext {
  readonly playerPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly playerAlive: boolean;
  /** Called with the damage amount when the mob lands a hit. The caller applies it (e.g. to PlayerHealth). */
  readonly onAttackPlayer: (damage: number) => void;
  /** Solid-block query: an attack only lands when no solid block lies between the mob and the player. */
  readonly isSolid: SolidQuery;
}

const reachOrigin = { x: 0, y: 0, z: 0 };
const reachDirection = { x: 0, y: 0, z: 0 };
const reachHit = createVoxelRaycastHit();

/**
 * True when the segment from the mob's chest to the player's chest crosses no
 * solid block, so a mob in reach can't hit through a wall or around a corner.
 */
function hasClearReach(mob: MobEntity, height: number, ctx: HostileAiContext): boolean {
  reachOrigin.x = mob.position.x;
  reachOrigin.y = mob.position.y + height / 2;
  reachOrigin.z = mob.position.z;
  reachDirection.x = ctx.playerPosition.x - reachOrigin.x;
  reachDirection.y = ctx.playerPosition.y + PLAYER_CONFIG.height / 2 - reachOrigin.y;
  reachDirection.z = ctx.playerPosition.z - reachOrigin.z;
  const length = Math.hypot(reachDirection.x, reachDirection.y, reachDirection.z);
  if (length === 0) {
    return true;
  }
  return raycastVoxels(reachOrigin, reachDirection, length, ctx.isSolid, reachHit) === null;
}

/** Yaw (radians) that makes a mob at (fromX, fromZ) walk (-sin, -cos) toward (toX, toZ). */
export function yawToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

/**
 * Hostile branch of the state machine. Returns true when it fully handled this
 * tick (mob is chasing or attacking), false when the mob should fall through
 * to the normal idle/wander logic. Acquisition uses `detectionRange`; once
 * engaged the mob keeps the target until `loseTargetRange` (hysteresis) or the
 * player dies. No pathfinding or line-of-sight: it steers straight at the player.
 */
function updateHostileAi(
  mob: MobEntity,
  def: MobDefinition,
  stats: HostileStats,
  dt: number,
  rng: Rng,
  ctx: HostileAiContext,
): boolean {
  mob.attackTimer = Math.max(0, mob.attackTimer - dt);

  const engaged = mob.ai.state === 'chase' || mob.ai.state === 'attack';
  const dx = ctx.playerPosition.x - mob.position.x;
  const dz = ctx.playerPosition.z - mob.position.z;
  const dist = Math.hypot(dx, dz);
  const range = engaged ? stats.loseTargetRange : stats.detectionRange;

  if (!ctx.playerAlive || dist > range) {
    if (engaged) {
      mob.ai.state = 'idle';
      mob.ai.timer = randomRange(rng, def.idleDurationMin, def.idleDurationMax);
      return true;
    }
    return false;
  }

  mob.ai.targetYaw = yawToward(mob.position.x, mob.position.z, ctx.playerPosition.x, ctx.playerPosition.z);
  turnTowardTarget(mob, dt, stats.chaseTurnSpeed);

  const dy = Math.abs(ctx.playerPosition.y - mob.position.y);
  const inReach =
    dist <= stats.attackReach && dy <= stats.attackVerticalReach && hasClearReach(mob, def.height, ctx);
  if (!inReach) {
    mob.ai.state = 'chase';
    return true;
  }

  if (mob.ai.state !== 'attack') {
    mob.ai.state = 'attack';
    mob.attackTimer = Math.max(mob.attackTimer, stats.attackWindup);
  }
  if (mob.attackTimer <= 0) {
    mob.attackTimer = stats.attackCooldown;
    ctx.onAttackPlayer(stats.attackDamage);
  }
  return true;
}

/**
 * Advances one mob's Idle <-> Wander <-> Flee state machine by `dt` seconds
 * using the injected `rng`. Idle picks a random duration and waits; Wander
 * picks a random target yaw and a random duration, and smoothly turns
 * `mob.yaw` toward it every tick (actual movement happens in mobPhysics.ts,
 * which reads `mob.yaw` and `mob.ai.state`). Flee is entered externally (see
 * `damageMob`) with `targetYaw` already pointing away from the attacker; each
 * tick here re-jitters that target slightly (COMBAT_CONFIG.fleeYawJitter) so
 * several hurt mobs don't flee in lockstep, and turns toward it the same way
 * wander does; once its timer elapses it returns to idle. Deterministic given
 * the same rng call sequence.
 */
export function updateMobAi(
  mob: MobEntity,
  def: MobDefinition,
  dt: number,
  rng: Rng,
  hostileCtx?: HostileAiContext,
): void {
  if (def.hostile !== null && hostileCtx !== undefined) {
    if (updateHostileAi(mob, def, def.hostile, dt, rng, hostileCtx)) {
      return;
    }
  } else if (mob.ai.state === 'chase' || mob.ai.state === 'attack') {
    // No player context (or a passive mob somehow chasing): drop back to idle.
    mob.ai.state = 'idle';
    mob.ai.timer = 0;
  }

  mob.ai.timer -= dt;

  if (mob.ai.timer > 0) {
    if (mob.ai.state === 'wander') {
      turnTowardTarget(mob, dt);
    } else if (mob.ai.state === 'flee') {
      mob.ai.targetYaw += randomRange(rng, -COMBAT_CONFIG.fleeYawJitter, COMBAT_CONFIG.fleeYawJitter) * dt;
      turnTowardTarget(mob, dt);
    }
    return;
  }

  if (mob.ai.state === 'idle') {
    mob.ai.state = 'wander';
    mob.ai.timer = randomRange(rng, def.wanderDurationMin, def.wanderDurationMax);
    mob.ai.targetYaw = randomRange(rng, -Math.PI, Math.PI);
  } else {
    // Both 'wander' and 'flee' return to idle once their timer elapses.
    mob.ai.state = 'idle';
    mob.ai.timer = randomRange(rng, def.idleDurationMin, def.idleDurationMax);
  }
}
