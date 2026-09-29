import type { MobEntity, Vec3 } from './EntityStore';
import type { MobDefinition } from './mobDefinitions';
import type { ToolProperties } from '../items/items';
import { COMBAT_CONFIG } from '../config/constants';
import type { Rng } from './mobAI';

/**
 * Damage a hand or held tool deals in one melee attack. Bare hand (no tool)
 * deals `COMBAT_CONFIG.handDamage`; a tool adds its type's entry in
 * `COMBAT_CONFIG.toolDamageBonus` on top of the hand damage (0 for an
 * unrecognised/untyped tool). Pure, allocation-free.
 */
export function meleeDamage(tool: ToolProperties | undefined): number {
  if (tool === undefined) {
    return COMBAT_CONFIG.handDamage;
  }
  const bonus = COMBAT_CONFIG.toolDamageBonus[tool.type] ?? 0;
  return COMBAT_CONFIG.handDamage + bonus;
}

/** Result of a `damageMob` call. */
export interface DamageMobResult {
  /** True if the damage was actually applied (false when the mob was still in its hurt-invulnerability window). */
  applied: boolean;
  /** True if this hit brought the mob's health to 0 (mob should be removed and its drops spawned). */
  killed: boolean;
}

/**
 * Applies `amount` damage to `mob` from an attack originating at `sourcePos`.
 * Ignored (no-op, `applied: false`) while `mob.hurtTimer > 0` (post-hit
 * invulnerability window) or when `amount <= 0`. On a successful hit:
 * - subtracts from `mob.health` (clamped at 0)
 * - starts `hurtTimer` (COMBAT_CONFIG.hurtInvulnerability) and `hurtFlashTimer`
 *   (COMBAT_CONFIG.hurtFlashDuration)
 * - applies horizontal + vertical knockback to `mob.velocity`, directed
 *   away from `sourcePos` (falls back to the mob's current -yaw direction if
 *   `sourcePos` is exactly at the mob's position, so knockback is never zero)
 * - if not killed, switches AI to 'flee' for `def.fleeDuration` seconds, with
 *   `targetYaw` set to face away from `sourcePos`
 * Pure aside from mutating `mob` in place; deterministic given the same inputs.
 */
export function damageMob(
  mob: MobEntity,
  amount: number,
  sourcePos: Vec3,
  def: MobDefinition,
): DamageMobResult {
  if (amount <= 0 || mob.hurtTimer > 0) {
    return { applied: false, killed: false };
  }

  const appliedAmount = Math.min(amount, mob.health);
  mob.health -= appliedAmount;
  const killed = mob.health <= 0;
  if (killed) {
    mob.health = 0;
  }

  mob.hurtTimer = COMBAT_CONFIG.hurtInvulnerability;
  mob.hurtFlashTimer = COMBAT_CONFIG.hurtFlashDuration;

  let dx = mob.position.x - sourcePos.x;
  let dz = mob.position.z - sourcePos.z;
  const horizontalDistSq = dx * dx + dz * dz;
  if (horizontalDistSq < 1e-8) {
    // Attacker is exactly on top of the mob: push away along the mob's
    // current facing so knockback direction is still well-defined.
    dx = -Math.sin(mob.yaw);
    dz = -Math.cos(mob.yaw);
  } else {
    const invLen = 1 / Math.sqrt(horizontalDistSq);
    dx *= invLen;
    dz *= invLen;
  }

  mob.velocity.x = dx * COMBAT_CONFIG.knockbackHorizontalSpeed;
  mob.velocity.z = dz * COMBAT_CONFIG.knockbackHorizontalSpeed;
  mob.velocity.y = COMBAT_CONFIG.knockbackVerticalSpeed;
  // Launched off the ground: physics keeps this velocity (no steering) until landing.
  mob.knockedBack = true;
  mob.onGround = false;

  if (!killed) {
    mob.ai.state = 'flee';
    mob.ai.timer = def.fleeDuration;
    // Away-facing yaw: mobPhysics moves along -sin(yaw)/-cos(yaw), matching
    // the away direction (dx, dz) computed above.
    mob.ai.targetYaw = Math.atan2(-dx, -dz);
  }

  return { applied: true, killed };
}

/** Rolls a random integer count in [min, max] (inclusive) using `rng`. */
function randomCount(rng: Rng, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return min + Math.floor(rng() * (max - min + 1));
}

/** Rolls every drop for `def` using `rng` (the mob's own seeded RNG), in definition order. */
export function rollMobDrops(
  def: MobDefinition,
  rng: Rng,
): readonly { itemId: number; count: number }[] {
  return def.drops.map((drop) => ({
    itemId: drop.itemId,
    count: randomCount(rng, drop.min, drop.max),
  }));
}
