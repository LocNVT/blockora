import { PIG_CONFIG } from '../config/constants';

/** Mob type ids. Append-only if ever persisted (not saved yet — Phase 5 slice). */
export const MobType = {
  Pig: 0,
} as const;

export type MobType = (typeof MobType)[keyof typeof MobType];

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
