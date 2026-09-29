import { describe, it, expect } from 'vitest';
import { SHAMBLER_CONFIG, MOB_CONFIG, COMBAT_CONFIG, WORLD_CONFIG } from '../src/config/constants';
import { EntityStore } from '../src/entities/EntityStore';
import { MobType, mobDefinition } from '../src/entities/mobDefinitions';
import { updateMobAi, type HostileAiContext, type Rng } from '../src/entities/mobAI';
import { updateMobPhysics } from '../src/entities/mobPhysics';
import { damageMob } from '../src/entities/mobCombat';
import { updateMobs, createMobSpawnTimer } from '../src/entities/updateMobs';
import { raycastEntities } from '../src/entities/entityRaycast';
import {
  attemptSpawns,
  attemptHostileSpawns,
  countHostile,
  despawnHostilesInDaylight,
  findHostileSpawnY,
  mulberry32,
} from '../src/entities/mobSpawning';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import { localIndex } from '../src/world/chunkCoords';
import { LightEngine } from '../src/world/light';
import type { SolidQuery } from '../src/world/SolidQuery';

const shamblerDef = mobDefinition(MobType.Shambler);
const pigDef = mobDefinition(MobType.Pig);
const rng: Rng = () => 0.5;
const noFluid: SolidQuery = () => false;
const floorAtZero: SolidQuery = (_x, y) => y < 0;

interface Harness {
  ctx: HostileAiContext;
  hits: number[];
  player: { x: number; y: number; z: number };
  setAlive(alive: boolean): void;
}

function harness(player = { x: 0, y: 0, z: 0 }, isSolid: SolidQuery = floorAtZero): Harness {
  const hits: number[] = [];
  let alive = true;
  const ctx: HostileAiContext = {
    playerPosition: player,
    get playerAlive(): boolean {
      return alive;
    },
    onAttackPlayer: (damage: number): void => {
      hits.push(damage);
    },
    isSolid,
  };
  return {
    ctx,
    hits,
    player,
    setAlive: (a: boolean): void => {
      alive = a;
    },
  };
}

function spawnShambler(x: number, z: number): ReturnType<EntityStore['spawn']> {
  const mob = new EntityStore().spawn(MobType.Shambler, { x, y: 0, z });
  mob.ai.state = 'wander';
  mob.ai.timer = 100;
  return mob;
}

describe('shambler definition', () => {
  it('is hostile with the configured stats; pig stays passive', () => {
    expect(shamblerDef.hostile).not.toBeNull();
    expect(shamblerDef.maxHealth).toBe(SHAMBLER_CONFIG.maxHealth);
    expect(shamblerDef.hostile?.attackDamage).toBe(SHAMBLER_CONFIG.attackDamage);
    expect(shamblerDef.drops).toEqual([]);
    expect(pigDef.hostile).toBeNull();
  });
});

describe('hostile AI transitions', () => {
  it('wander -> chase when the player is within detectionRange', () => {
    const mob = spawnShambler(10, 0);
    const h = harness();
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    expect(mob.ai.state).toBe('chase');
  });

  it('idle -> chase as well', () => {
    const mob = spawnShambler(10, 0);
    mob.ai.state = 'idle';
    const h = harness();
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    expect(mob.ai.state).toBe('chase');
  });

  it('stays wandering when the player is beyond detectionRange', () => {
    const mob = spawnShambler(SHAMBLER_CONFIG.detectionRange + 2, 0);
    const h = harness();
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    expect(mob.ai.state).toBe('wander');
  });

  it('chase -> attack once within attackReach; the first strike waits for the windup', () => {
    const mob = spawnShambler(1, 0);
    mob.ai.state = 'chase';
    const h = harness();
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    expect(mob.ai.state).toBe('attack');
    expect(h.hits).toEqual([]);
    updateMobAi(mob, shamblerDef, SHAMBLER_CONFIG.attackWindup, rng, h.ctx);
    expect(h.hits).toEqual([SHAMBLER_CONFIG.attackDamage]);
  });

  it('attack deals damage only once per cooldown', () => {
    const mob = spawnShambler(1, 0);
    const h = harness();
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    updateMobAi(mob, shamblerDef, SHAMBLER_CONFIG.attackWindup, rng, h.ctx);
    expect(h.hits.length).toBe(1);
    for (let i = 0; i < 9; i += 1) {
      updateMobAi(mob, shamblerDef, SHAMBLER_CONFIG.attackCooldown / 10, rng, h.ctx);
    }
    expect(h.hits.length).toBe(1);
    updateMobAi(mob, shamblerDef, SHAMBLER_CONFIG.attackCooldown / 10 + 0.001, rng, h.ctx);
    expect(h.hits.length).toBe(2);
  });

  it('does not attack when the player is at a very different height', () => {
    const mob = spawnShambler(1, 0);
    const h = harness({ x: 0, y: 5, z: 0 });
    updateMobAi(mob, shamblerDef, 1, rng, h.ctx);
    expect(mob.ai.state).toBe('chase');
    expect(h.hits).toEqual([]);
  });

  it('attack -> chase when the player steps out of reach', () => {
    const mob = spawnShambler(1, 0);
    const h = harness();
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    expect(mob.ai.state).toBe('attack');
    h.player.x = -5;
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    expect(mob.ai.state).toBe('chase');
  });

  it('keeps chasing past detectionRange but gives up beyond loseTargetRange', () => {
    const mob = spawnShambler(20, 0);
    mob.ai.state = 'chase';
    const h = harness();
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    expect(mob.ai.state).toBe('chase');
    h.player.x = -(SHAMBLER_CONFIG.loseTargetRange + 1);
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    expect(mob.ai.state).toBe('idle');
    expect(mob.ai.timer).toBeGreaterThan(0);
  });

  it('drops the target and never strikes when the player is dead', () => {
    const mob = spawnShambler(1, 0);
    const h = harness();
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    h.setAlive(false);
    updateMobAi(mob, shamblerDef, 5, rng, h.ctx);
    expect(mob.ai.state).toBe('idle');
    expect(h.hits).toEqual([]);
    // A dead player is not re-acquired.
    mob.ai.state = 'wander';
    mob.ai.timer = 100;
    updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    expect(mob.ai.state).toBe('wander');
  });

  it('turns to face the player while chasing', () => {
    const mob = spawnShambler(0, -10);
    const h = harness();
    // Player is at +z of the mob; yaw 0 walks toward -z, so it must turn around (yaw PI).
    for (let i = 0; i < 40; i += 1) {
      updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
    }
    expect(Math.cos(mob.yaw)).toBeLessThan(-0.99);
  });
});

// Regression (Codex review): attacks checked distance only, so a shambler could
// hit the player through blocks, e.g. around the corner of a pillar.
describe('hostile attack obstruction', () => {
  // Pillar occupying cell x 0, z 0 (all heights); mob and player sit on either
  // side of its corner, 1.13 blocks apart (inside attackReach).
  const pillar: SolidQuery = (x, y, z) => y < 0 || (x === 0 && z === 0);
  const mobPos = { x: 0.5, z: -0.3 };
  const playerPos = { x: 1.3, y: 0, z: 0.5 };

  function runAttack(isSolid: SolidQuery): number[] {
    const h = harness({ ...playerPos }, isSolid);
    const mob = spawnShambler(mobPos.x, mobPos.z);
    for (let i = 0; i < 60; i += 1) {
      updateMobAi(mob, shamblerDef, 0.1, rng, h.ctx);
    }
    return h.hits;
  }

  it('does not damage the player through a block corner', () => {
    expect(Math.hypot(playerPos.x - mobPos.x, playerPos.z - mobPos.z)).toBeLessThanOrEqual(
      SHAMBLER_CONFIG.attackReach,
    );
    expect(runAttack(pillar)).toEqual([]);
  });

  it('damages the player from the same spot when nothing is in the way', () => {
    expect(runAttack(floorAtZero).length).toBeGreaterThan(0);
  });
});

describe('hostile vs passive when hit', () => {
  it('a hurt shambler chases the attacker instead of fleeing; a pig still flees', () => {
    const store = new EntityStore();
    const shambler = store.spawn(MobType.Shambler, { x: 3, y: 0, z: 0 });
    const pig = store.spawn(MobType.Pig, { x: 3, y: 0, z: 0 });
    const source = { x: 0, y: 1, z: 0 };

    damageMob(shambler, 1, source, shamblerDef);
    damageMob(pig, 1, source, pigDef);

    expect(shambler.ai.state).toBe('chase');
    // Toward the attacker (-x) means -sin(yaw) = -1.
    expect(Math.sin(shambler.ai.targetYaw)).toBeGreaterThan(0.99);
    expect(pig.ai.state).toBe('flee');
  });
});

describe('chase physics', () => {
  it('closes distance toward the player on flat ground', () => {
    const mob = spawnShambler(10, 0);
    const h = harness();
    const start = Math.hypot(mob.position.x, mob.position.z);
    for (let i = 0; i < 100; i += 1) {
      updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
      updateMobPhysics(mob, shamblerDef, 0.05, floorAtZero, noFluid);
    }
    const end = Math.hypot(mob.position.x, mob.position.z);
    expect(end).toBeLessThan(start - 3);
  });

  it('stands still while attacking', () => {
    const mob = spawnShambler(1, 0);
    const h = harness();
    for (let i = 0; i < 20; i += 1) {
      updateMobAi(mob, shamblerDef, 0.05, rng, h.ctx);
      updateMobPhysics(mob, shamblerDef, 0.05, floorAtZero, noFluid);
    }
    expect(mob.ai.state).toBe('attack');
    expect(Math.hypot(mob.velocity.x, mob.velocity.z)).toBe(0);
  });
});

describe('combat against shamblers', () => {
  it('is hit by the entity raycast and dies after enough damage', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Shambler, { x: 0, y: 0, z: -3 });
    const hit = raycastEntities({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 6, store.all(), mobDefinition);
    expect(hit?.mobId).toBe(mob.id);

    let killed = false;
    for (let i = 0; i < SHAMBLER_CONFIG.maxHealth && !killed; i += 1) {
      mob.hurtTimer = 0;
      killed = damageMob(mob, COMBAT_CONFIG.handDamage, { x: 0, y: 1, z: 0 }, shamblerDef).killed;
    }
    expect(killed).toBe(true);
    expect(mob.health).toBe(0);
  });
});

// ---------- spawning ----------

const { chunkWidth: W, chunkDepth: D } = WORLD_CONFIG;

function chunkGrid(radius: number): { cx: number; cz: number }[] {
  const coords: { cx: number; cz: number }[] = [];
  for (let cx = -radius; cx <= radius; cx += 1) {
    for (let cz = -radius; cz <= radius; cz += 1) {
      coords.push({ cx, cz });
    }
  }
  return coords;
}

function buildWorld(groundY: number, top: BlockId, radius: number): { store: ChunkStore; light: LightEngine } {
  const store = new ChunkStore();
  const light = new LightEngine(store, blockRegistry);
  for (const { cx, cz } of chunkGrid(radius)) {
    const chunk = new Chunk(cx, cz);
    for (let x = 0; x < W; x += 1) {
      for (let z = 0; z < D; z += 1) {
        for (let y = 0; y < groundY; y += 1) {
          chunk.blocks[localIndex(x, y, z)] = BlockId.Stone;
        }
        chunk.blocks[localIndex(x, groundY, z)] = top;
      }
    }
    store.setChunk(chunk);
    light.lightChunk(cx, cz);
  }
  return { store, light };
}

function hollowCave(store: ChunkStore, light: LightEngine): void {
  const chunk = store.getChunk(0, 0);
  if (chunk === undefined) throw new Error('missing chunk');
  // 3-high cave at y 4..6 under solid stone, sealed from the sky.
  for (let y = 4; y <= 6; y += 1) {
    chunk.blocks[localIndex(5, y, 5)] = BlockId.Air;
  }
  light.lightChunk(0, 0);
}

const SPAWN_RADIUS = Math.ceil(MOB_CONFIG.maxSpawnDistance / W) + 1;
const NIGHT = 0;
const DAY = 1;

describe('hostile spawning', () => {
  it('rejects a lit surface at full daylight and accepts it at night (any solid top block)', () => {
    const { store } = buildWorld(10, BlockId.Sand, 1);
    expect(findHostileSpawnY(store, blockRegistry, 5, 5, DAY, 100)).toBeNull();
    expect(findHostileSpawnY(store, blockRegistry, 5, 5, NIGHT, 100)).toBe(11);
  });

  it('rejects a water surface', () => {
    const { store } = buildWorld(10, BlockId.Water, 1);
    expect(findHostileSpawnY(store, blockRegistry, 5, 5, NIGHT, 100)).toBeNull();
  });

  it('accepts a dark cave at full daylight', () => {
    const { store, light } = buildWorld(10, BlockId.Grass, 1);
    hollowCave(store, light);
    expect(findHostileSpawnY(store, blockRegistry, 5, 5, DAY, 6)).toBe(4);
  });

  // Regression (Codex review): the cave scan returned null at the first standable
  // cell (the lit surface) instead of continuing down to the dark cave below.
  it('scans past a lit surface to a sealed dark cave below it', () => {
    const { store, light } = buildWorld(10, BlockId.Grass, 1);
    hollowCave(store, light);
    expect(findHostileSpawnY(store, blockRegistry, 5, 5, DAY, 12)).toBe(4);
  });

  it('spawns nothing at day on an open surface; at night it stops at the separate hostile cap', () => {
    const { store } = buildWorld(10, BlockId.Grass, SPAWN_RADIUS);
    const day = new EntityStore();
    const dayRng = mulberry32(3);
    for (let wave = 0; wave < 50; wave += 1) {
      attemptHostileSpawns(store, blockRegistry, day, { x: 0, y: 11, z: 0 }, dayRng, DAY);
    }
    expect(countHostile(day)).toBe(0);

    const night = new EntityStore();
    const nightRng = mulberry32(3);
    for (let wave = 0; wave < 200; wave += 1) {
      attemptHostileSpawns(store, blockRegistry, night, { x: 0, y: 11, z: 0 }, nightRng, NIGHT);
    }
    expect(countHostile(night)).toBe(MOB_CONFIG.maxHostileMobs);
    for (const mob of night.all()) {
      const dist = Math.hypot(mob.position.x, mob.position.z);
      expect(dist).toBeGreaterThanOrEqual(MOB_CONFIG.minSpawnDistance - 1);
    }
  });

  it('hostile and passive caps are independent', () => {
    const { store } = buildWorld(10, BlockId.Grass, SPAWN_RADIUS);
    const entities = new EntityStore();
    const r = mulberry32(11);
    for (let wave = 0; wave < 200; wave += 1) {
      attemptSpawns(store, blockRegistry, entities, { x: 0, y: 11, z: 0 }, r, NIGHT);
    }
    expect(countHostile(entities)).toBe(MOB_CONFIG.maxHostileMobs);
    expect(entities.count(MobType.Pig)).toBeGreaterThan(0);
    expect(entities.count(MobType.Pig)).toBeLessThanOrEqual(MOB_CONFIG.maxPassiveMobs);
  });

  it('is deterministic for the same seed', () => {
    function run(): unknown {
      const { store } = buildWorld(10, BlockId.Grass, SPAWN_RADIUS);
      const entities = new EntityStore();
      const r = mulberry32(99);
      for (let wave = 0; wave < 30; wave += 1) {
        attemptHostileSpawns(store, blockRegistry, entities, { x: 0, y: 11, z: 0 }, r, NIGHT);
      }
      return entities.all().map((m) => ({ ...m.position, yaw: m.yaw }));
    }
    expect(run()).toEqual(run());
  });
});

describe('hostile daylight despawn', () => {
  it('removes exposed hostiles in daylight with a seeded chance; never pigs; nothing at night', () => {
    const { store } = buildWorld(10, BlockId.Grass, 1);
    const entities = new EntityStore();
    const shambler = entities.spawn(MobType.Shambler, { x: 5.5, y: 11, z: 5.5 });
    const pig = entities.spawn(MobType.Pig, { x: 6.5, y: 11, z: 6.5 });

    despawnHostilesInDaylight(store, entities, NIGHT, 1, () => 0);
    expect(entities.get(shambler.id)).toBeDefined();

    // rng above the per-call chance: survives.
    despawnHostilesInDaylight(store, entities, DAY, 1, () => 0.99);
    expect(entities.get(shambler.id)).toBeDefined();

    despawnHostilesInDaylight(store, entities, DAY, 1, () => 0);
    expect(entities.get(shambler.id)).toBeUndefined();
    expect(entities.get(pig.id)).toBeDefined();
  });

  it('leaves hostiles in sealed dark spaces alone', () => {
    const { store, light } = buildWorld(10, BlockId.Grass, 1);
    hollowCave(store, light);
    const entities = new EntityStore();
    const mob = entities.spawn(MobType.Shambler, { x: 5.5, y: 4, z: 5.5 });
    despawnHostilesInDaylight(store, entities, DAY, 1, () => 0);
    expect(entities.get(mob.id)).toBeDefined();
  });
});

describe('updateMobs with a hostile', () => {
  it('routes attacks to onAttackPlayer and stops when the player is dead', () => {
    const { store } = buildWorld(10, BlockId.Grass, 1);
    const entities = new EntityStore();
    entities.spawn(MobType.Shambler, { x: 8.5, y: 11, z: 5.5 });
    const hits: number[] = [];
    let alive = true;
    const isSolid: SolidQuery = (x, y, z) => y <= 10 && store.getBlock(x, y, z) !== BlockId.Air;
    const deps = {
      store,
      registry: blockRegistry,
      isSolid,
      isFluid: noFluid,
      rng: (): number => 0.5,
      playerPosition: { x: 5.5, y: 11, z: 5.5 },
      get playerAlive(): boolean {
        return alive;
      },
      daylight: NIGHT,
      onAttackPlayer: (d: number): void => {
        hits.push(d);
      },
    };
    const timer = createMobSpawnTimer();
    for (let i = 0; i < 60; i += 1) {
      updateMobs(entities, 0.05, timer, deps);
    }
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.every((d) => d === SHAMBLER_CONFIG.attackDamage)).toBe(true);

    alive = false;
    const before = hits.length;
    for (let i = 0; i < 60; i += 1) {
      updateMobs(entities, 0.05, timer, deps);
    }
    expect(hits.length).toBe(before);
  });
});
