import { PIG_CONFIG } from '../config/constants';
import type { ItemId } from '../items/items';

/** Mob type ids. Append-only if ever persisted (not saved yet — Phase 5 slice). */
export const MobType = {
  Pig: 0,
} as const;

export type MobType = (typeof MobType)[keyof typeof MobType];

/** A single item-drop entry: on death, drops a random count in [min, max] (inclusive) of `itemId`. */
export interface MobDropDefinition {
  readonly itemId: ItemId;
  readonly min: number;
  readonly max: number;
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
};

/** Every registered passive mob definition, indexed by MobType. */
export const MOB_DEFINITIONS: readonly MobDefinition[] = [PIG_DEFINITION];

export function mobDefinition(type: MobType): MobDefinition {
  const def = MOB_DEFINITIONS[type];
  if (def === undefined) {
    throw new Error(`mobDefinition: unknown mob type ${type}.`);
  }
  return def;
}
