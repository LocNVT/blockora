import type { ChunkStore } from '../world/ChunkStore';
import type { BlockRegistry } from '../world/BlockRegistry';
import type { SolidQuery } from '../world/SolidQuery';
import { PLAYER_CONFIG, MOB_CONFIG } from '../config/constants';
import type { EntityStore } from './EntityStore';
import { mobDefinition } from './mobDefinitions';
import { updateMobAi, type HostileAiContext, type Rng } from './mobAI';
import { updateMobPhysics } from './mobPhysics';
import { attemptSpawns, despawnFarMobs, despawnHostilesInDaylight } from './mobSpawning';

/** Everything updateMobs needs from the outside world, gathered once per call. */
export interface UpdateMobsDeps {
  readonly store: ChunkStore;
  readonly registry: BlockRegistry;
  readonly isSolid: SolidQuery;
  readonly isFluid: SolidQuery;
  readonly rng: Rng;
  /** Player feet position. */
  readonly playerPosition: { x: number; y: number; z: number };
  /** False while the player is dead: hostile mobs drop their target. */
  readonly playerAlive: boolean;
  /** Daylight factor 0..1 (daylightFactor of GameTime): gates hostile spawning and daylight despawn. */
  readonly daylight: number;
  /** Applies damage a hostile mob dealt to the player (kept as a port so entities never import player code). */
  readonly onAttackPlayer: (damage: number) => void;
}

/** Mutable spawn-wave timer, owned by the caller (e.g. main.ts) and passed in each frame — avoids global state. */
export interface MobSpawnTimer {
  secondsUntilNextWave: number;
}

export function createMobSpawnTimer(): MobSpawnTimer {
  return { secondsUntilNextWave: MOB_CONFIG.spawnInterval };
}

/**
 * Orchestrates one frame of mob simulation: clamps dt, runs AI then physics
 * for every live mob, attempts a spawn wave every MOB_CONFIG.spawnInterval
 * seconds (tracked by the caller-owned `timer`), and despawns mobs that are
 * too far or in an unloaded column. Allocation-light: no per-mob objects are
 * created here (EntityStore/AI/physics all mutate existing records in place).
 */
export function updateMobs(store: EntityStore, dt: number, timer: MobSpawnTimer, deps: UpdateMobsDeps): void {
  const clampedDt = Math.min(Math.max(dt, 0), PLAYER_CONFIG.maxFrameDelta);

  const hostileCtx: HostileAiContext = {
    playerPosition: deps.playerPosition,
    playerAlive: deps.playerAlive,
    onAttackPlayer: deps.onAttackPlayer,
    isSolid: deps.isSolid,
  };

  for (const mob of store.all()) {
    const def = mobDefinition(mob.type);
    updateMobAi(mob, def, clampedDt, deps.rng, hostileCtx);
    updateMobPhysics(mob, def, clampedDt, deps.isSolid, deps.isFluid);
    mob.age += clampedDt;
    if (mob.hurtTimer > 0) {
      mob.hurtTimer = Math.max(0, mob.hurtTimer - clampedDt);
    }
    if (mob.hurtFlashTimer > 0) {
      mob.hurtFlashTimer = Math.max(0, mob.hurtFlashTimer - clampedDt);
    }
  }

  timer.secondsUntilNextWave -= clampedDt;
  if (timer.secondsUntilNextWave <= 0) {
    timer.secondsUntilNextWave += MOB_CONFIG.spawnInterval;
    attemptSpawns(deps.store, deps.registry, store, deps.playerPosition, deps.rng, deps.daylight);
  }

  despawnHostilesInDaylight(deps.store, store, deps.daylight, clampedDt, deps.rng);
  despawnFarMobs(deps.store, store, deps.playerPosition);
}
