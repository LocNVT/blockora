import type { ChunkStore } from '../world/ChunkStore';
import type { BlockRegistry } from '../world/BlockRegistry';
import type { SolidQuery } from '../world/SolidQuery';
import { PLAYER_CONFIG, MOB_CONFIG } from '../config/constants';
import type { EntityStore } from './EntityStore';
import { mobDefinition } from './mobDefinitions';
import { updateMobAi, type Rng } from './mobAI';
import { updateMobPhysics } from './mobPhysics';
import { attemptSpawns, despawnFarMobs } from './mobSpawning';

/** Everything updateMobs needs from the outside world, gathered once per call. */
export interface UpdateMobsDeps {
  readonly store: ChunkStore;
  readonly registry: BlockRegistry;
  readonly isSolid: SolidQuery;
  readonly isFluid: SolidQuery;
  readonly rng: Rng;
  readonly playerPosition: { x: number; z: number };
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

  for (const mob of store.all()) {
    const def = mobDefinition(mob.type);
    updateMobAi(mob, def, clampedDt, deps.rng);
    updateMobPhysics(mob, def, clampedDt, deps.isSolid, deps.isFluid);
    mob.age += clampedDt;
  }

  timer.secondsUntilNextWave -= clampedDt;
  if (timer.secondsUntilNextWave <= 0) {
    timer.secondsUntilNextWave += MOB_CONFIG.spawnInterval;
    attemptSpawns(deps.store, deps.registry, store, deps.playerPosition, deps.rng);
  }

  despawnFarMobs(deps.store, store, deps.playerPosition);
}
