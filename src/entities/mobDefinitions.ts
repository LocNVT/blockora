import { PIG_CONFIG, SHAMBLER_CONFIG } from '../config/constants';
import type { ItemId } from '../items/items';

/** Mob type ids. Append-only if ever persisted (not saved yet — Phase 5 slice). */
export const MobType = {
  Pig: 0,
  Shambler: 1,
} as const;

export type MobType = (typeof MobType)[keyof typeof MobType];

/** A single item-drop entry: on death, drops a random count in [min, max] (inclusive) of `itemId`. */
export interface MobDropDefinition {
  readonly itemId: ItemId;
  readonly min: number;
  readonly max: number;
}

/** Combat tuning for hostile mobs; passive mobs have `hostile: null`. */
export interface HostileStats {
  readonly chaseSpeed: number;
  readonly chaseTurnSpeed: number;
  readonly attackDamage: number;
  /** Max horizontal centre-to-centre distance (blocks) from which the mob can hit the player. */
  readonly attackReach: number;
  /** Max |player feet y - mob feet y| (blocks) from which the mob can hit the player. */
  readonly attackVerticalReach: number;
  readonly attackCooldown: number;
  /** Seconds between getting into reach and the first strike. */
  readonly attackWindup: number;
  readonly detectionRange: number;
  readonly loseTargetRange: number;
}

/** Data-driven per-mob-type tuning; no magic numbers in AI/physics/spawning code. */
export interface MobDefinition {
  readonly type: MobType;
  readonly name: string;
  /** Horizontal collision half-extent (blocks), centered on the mob. */
  readonly halfWidth: number;
  /** Collision AABB height (blocks). */
  readonly height: number;
  readonly walkSpeed: number;
  readonly idleDurationMin: number;
  readonly idleDurationMax: number;
  readonly wanderDurationMin: number;
  readonly wanderDurationMax: number;
  /** Relative likelihood of this type spawning versus other passive mobs. */
  readonly spawnWeight: number;
  /** Max simultaneous mobs of this type allowed within the despawn radius. */
  readonly maxPerArea: number;
  /** Hit points; see `damageMob`. */
  readonly maxHealth: number;
  /** Speed (blocks/s) while fleeing an attacker (AI state 'flee'). */
  readonly fleeSpeed: number;
  /** Seconds spent in the 'flee' AI state after being hurt. */
  readonly fleeDuration: number;
  /** Items spawned (via ItemDropSystem) at this mob's position on death. */
  readonly drops: readonly MobDropDefinition[];
  /** Hostile combat stats, or null for passive mobs (which flee when hurt instead of chasing). */
  readonly hostile: HostileStats | null;
}

const PIG_DEFINITION: MobDefinition = {
  type: MobType.Pig,
  name: 'pig',
  halfWidth: PIG_CONFIG.halfWidth,
  height: PIG_CONFIG.height,
  walkSpeed: PIG_CONFIG.walkSpeed,
  idleDurationMin: PIG_CONFIG.idleDurationMin,
  idleDurationMax: PIG_CONFIG.idleDurationMax,
  wanderDurationMin: PIG_CONFIG.wanderDurationMin,
  wanderDurationMax: PIG_CONFIG.wanderDurationMax,
  spawnWeight: PIG_CONFIG.spawnWeight,
  maxPerArea: PIG_CONFIG.maxPerArea,
  maxHealth: PIG_CONFIG.maxHealth,
  fleeSpeed: PIG_CONFIG.fleeSpeed,
  fleeDuration: PIG_CONFIG.fleeDuration,
  drops: PIG_CONFIG.drops,
  hostile: null,
};

const SHAMBLER_DEFINITION: MobDefinition = {
  type: MobType.Shambler,
  name: 'shambler',
  halfWidth: SHAMBLER_CONFIG.halfWidth,
  height: SHAMBLER_CONFIG.height,
  walkSpeed: SHAMBLER_CONFIG.walkSpeed,
  idleDurationMin: SHAMBLER_CONFIG.idleDurationMin,
  idleDurationMax: SHAMBLER_CONFIG.idleDurationMax,
  wanderDurationMin: SHAMBLER_CONFIG.wanderDurationMin,
  wanderDurationMax: SHAMBLER_CONFIG.wanderDurationMax,
  spawnWeight: SHAMBLER_CONFIG.spawnWeight,
  maxPerArea: SHAMBLER_CONFIG.maxPerArea,
  maxHealth: SHAMBLER_CONFIG.maxHealth,
  fleeSpeed: SHAMBLER_CONFIG.fleeSpeed,
  fleeDuration: SHAMBLER_CONFIG.fleeDuration,
  drops: SHAMBLER_CONFIG.drops,
  hostile: {
    chaseSpeed: SHAMBLER_CONFIG.chaseSpeed,
    chaseTurnSpeed: SHAMBLER_CONFIG.chaseTurnSpeed,
    attackDamage: SHAMBLER_CONFIG.attackDamage,
    attackReach: SHAMBLER_CONFIG.attackReach,
    attackVerticalReach: SHAMBLER_CONFIG.attackVerticalReach,
    attackCooldown: SHAMBLER_CONFIG.attackCooldown,
    attackWindup: SHAMBLER_CONFIG.attackWindup,
    detectionRange: SHAMBLER_CONFIG.detectionRange,
    loseTargetRange: SHAMBLER_CONFIG.loseTargetRange,
  },
};

/** Every registered mob definition (passive and hostile), indexed by MobType. */
export const MOB_DEFINITIONS: readonly MobDefinition[] = [PIG_DEFINITION, SHAMBLER_DEFINITION];

export function mobDefinition(type: MobType): MobDefinition {
  const def = MOB_DEFINITIONS[type];
  if (def === undefined) {
    throw new Error(`mobDefinition: unknown mob type ${type}.`);
  }
  return def;
}
