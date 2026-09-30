import { describe, it, expect } from 'vitest';
import { ATLAS_CONFIG, CHICKEN_CONFIG, COW_CONFIG, MOB_CONFIG, PIG_CONFIG, WORLD_CONFIG } from '../src/config/constants';
import { EntityStore } from '../src/entities/EntityStore';
import { MOB_DEFINITIONS, MobType, mobDefinition } from '../src/entities/mobDefinitions';
import { damageMob, rollMobDrops } from '../src/entities/mobCombat';
import { updateMobPhysics } from '../src/entities/mobPhysics';
import { attemptPassiveSpawns, mulberry32 } from '../src/entities/mobSpawning';
import { raycastEntities } from '../src/entities/entityRaycast';
import { itemRegistry } from '../src/items/ItemRegistry';
import { iconTileForItem } from '../src/items/itemIcons';
import { ItemId } from '../src/items/items';
import { createStack } from '../src/items/ItemStack';
import { PlayerHunger } from '../src/player/PlayerHunger';
import { decodeSlots, encodeSlots } from '../src/save/saveFormat';
import { soundFor } from '../src/audio/soundRecipes';
import { blockRegistry } from '../src/world/BlockRegistry';
import { BlockId } from '../src/world/blocks';
import { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import { localIndex } from '../src/world/chunkCoords';
import { LightEngine } from '../src/world/light';
import { createAtlasLayout } from '../src/world/texture/atlasLayout';
import { generateAtlasPixels } from '../src/world/texture/tileArt';
import { TILE_NAMES, tileIndex } from '../src/world/texture/tiles';

const cow = mobDefinition(MobType.Cow);
const chicken = mobDefinition(MobType.Chicken);
const pig = mobDefinition(MobType.Pig);
const noSolid = (): boolean => false;
const POS = { x: 1, y: 2, z: 3 };

describe('cow / chicken definitions', () => {
  it('cow is large, slow, 10 HP and drops 1-3 raw beef', () => {
    expect(cow.halfWidth * 2).toBeCloseTo(0.9, 5);
    expect(cow.height).toBeCloseTo(1.3, 5);
    expect(cow.walkSpeed).toBeCloseTo(0.9, 5);
    expect(cow.walkSpeed).toBeLessThan(pig.walkSpeed);
    expect(cow.maxHealth).toBe(10);
    expect(cow.drops).toEqual([{ itemId: ItemId.RawBeef, min: 1, max: 3 }]);
    expect(cow.hostile).toBeNull();
    expect(cow.fleeSpeed).toBeGreaterThan(cow.walkSpeed);
  });

  it('chicken is small, quick, 4 HP and drops exactly 1 raw chicken', () => {
    expect(chicken.halfWidth * 2).toBeCloseTo(0.4, 5);
    expect(chicken.height).toBeCloseTo(0.7, 5);
    expect(chicken.walkSpeed).toBeGreaterThan(pig.walkSpeed);
    expect(chicken.wanderDurationMax).toBeLessThan(pig.wanderDurationMax);
    expect(chicken.maxHealth).toBe(4);
    expect(chicken.drops).toEqual([{ itemId: ItemId.RawChicken, min: 1, max: 1 }]);
    expect(chicken.hostile).toBeNull();
  });

  it('config drop ids match the item ids (numeric copies avoid an import cycle)', () => {
    expect(COW_CONFIG.drops[0].itemId).toBe(ItemId.RawBeef);
    expect(CHICKEN_CONFIG.drops[0].itemId).toBe(ItemId.RawChicken);
    expect(PIG_CONFIG.drops[0].itemId).toBe(ItemId.RawPork);
  });

  it('every passive type has weight 1 and a positive per-type cap; mob types index the definition table', () => {
    for (const def of [pig, cow, chicken]) {
      expect(def.spawnWeight).toBe(1);
      expect(def.maxPerArea).toBeGreaterThan(0);
    }
    MOB_DEFINITIONS.forEach((def, index) => expect(def.type).toBe(index));
  });
});

const { chunkWidth: W, chunkDepth: D } = WORLD_CONFIG;

function grassWorld(radius: number): ChunkStore {
  const store = new ChunkStore();
  const light = new LightEngine(store, blockRegistry);
  for (let cx = -radius; cx <= radius; cx += 1) {
    for (let cz = -radius; cz <= radius; cz += 1) {
      const chunk = new Chunk(cx, cz);
      for (let x = 0; x < W; x += 1) {
        for (let z = 0; z < D; z += 1) {
          for (let y = 0; y < 10; y += 1) {
            chunk.blocks[localIndex(x, y, z)] = BlockId.Stone;
          }
          chunk.blocks[localIndex(x, 10, z)] = BlockId.Grass;
        }
      }
      store.setChunk(chunk);
      light.lightChunk(cx, cz);
    }
  }
  return store;
}

describe('weighted passive spawning', () => {
  const radius = Math.ceil(MOB_CONFIG.maxSpawnDistance / W) + 1;
  const store = grassWorld(radius);
  const player = { x: 0, z: 0 };

  function runWaves(seed: number, waves: number, entities = new EntityStore()): EntityStore {
    const rng = mulberry32(seed);
    for (let wave = 0; wave < waves; wave += 1) {
      attemptPassiveSpawns(store, blockRegistry, entities, player, rng);
    }
    return entities;
  }

  const signature = (entities: EntityStore): string =>
    entities
      .all()
      .map((mob) => `${mob.type}@${mob.position.x},${mob.position.z}`)
      .join('|');

  it('is deterministic for the same seed', () => {
    expect(signature(runWaves(11, 30))).toBe(signature(runWaves(11, 30)));
  });

  it('spawns a mix of pigs, cows and chickens and never exceeds the shared passive cap', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const entities = runWaves(seed, 60);
      expect(entities.count()).toBeLessThanOrEqual(MOB_CONFIG.maxPassiveMobs);
      for (const def of [pig, cow, chicken]) {
        expect(entities.count(def.type)).toBeLessThanOrEqual(def.maxPerArea);
      }
      for (const mob of entities.all()) {
        seen.add(mob.type);
      }
    }
    expect(seen).toEqual(new Set([MobType.Pig, MobType.Cow, MobType.Chicken]));
  });

  it('a full type cap stops that type only; the shared cap still bounds the total', () => {
    const entities = new EntityStore();
    for (let i = 0; i < pig.maxPerArea; i += 1) {
      entities.spawn(MobType.Pig, { x: 500 + i, y: 11, z: 500 });
    }
    runWaves(3, 80, entities);
    expect(entities.count(MobType.Pig)).toBe(pig.maxPerArea);
    expect(entities.count()).toBeLessThanOrEqual(MOB_CONFIG.maxPassiveMobs);
    expect(entities.count(MobType.Cow) + entities.count(MobType.Chicken)).toBeGreaterThan(0);
  });
});

describe('chicken slow fall', () => {
  function fallFor(type: MobType, seconds: number): { vy: number; y: number } {
    const store = new EntityStore();
    const mob = store.spawn(type, { x: 0, y: 500, z: 0 });
    const def = mobDefinition(type);
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i += 1) {
      updateMobPhysics(mob, def, 1 / 60, noSolid, noSolid);
    }
    return { vy: mob.velocity.y, y: mob.position.y };
  }

  it('caps a chicken at its terminal fall speed', () => {
    const { vy, y } = fallFor(MobType.Chicken, 3);
    expect(vy).toBeCloseTo(-CHICKEN_CONFIG.maxFallSpeed, 5);
    // 3 s: brief acceleration then ~2.5 blocks/s -> about 7 blocks, far below free fall (~81).
    expect(500 - y).toBeLessThan(8);
    expect(500 - y).toBeGreaterThan(6);
  });

  it('leaves pigs and cows on the normal (much higher) terminal speed', () => {
    expect(pig.maxFallSpeed).toBe(MOB_CONFIG.maxFallSpeed);
    expect(cow.maxFallSpeed).toBe(MOB_CONFIG.maxFallSpeed);
    const pigFall = fallFor(MobType.Pig, 3);
    expect(pigFall.vy).toBeLessThan(-CHICKEN_CONFIG.maxFallSpeed * 5);
    expect(500 - pigFall.y).toBeGreaterThan(40);
  });

  it('mob health is untouched by falling and landing (no fall damage)', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0.5, y: 60, z: 0.5 });
    const floor = (_x: number, y: number): boolean => y === 0;
    for (let i = 0; i < 600; i += 1) {
      updateMobPhysics(mob, pig, 1 / 60, floor, noSolid);
    }
    expect(mob.onGround).toBe(true);
    expect(mob.health).toBe(pig.maxHealth);
  });
});

describe('cow / chicken combat and drops', () => {
  const attacker = { x: 0, y: 0, z: 5 };

  it('hitting either flees (does not chase)', () => {
    const store = new EntityStore();
    for (const def of [cow, chicken]) {
      const mob = store.spawn(def.type, { x: 0, y: 0, z: 0 });
      const result = damageMob(mob, 1, attacker, def);
      expect(result.applied).toBe(true);
      expect(mob.ai.state).toBe('flee');
      expect(mob.ai.timer).toBe(def.fleeDuration);
    }
  });

  it('a chicken dies to 4 damage in one hit, a cow needs 10', () => {
    const store = new EntityStore();
    const hen = store.spawn(MobType.Chicken, { x: 0, y: 0, z: 0 });
    expect(damageMob(hen, 4, attacker, chicken).killed).toBe(true);
    const bull = store.spawn(MobType.Cow, { x: 0, y: 0, z: 0 });
    expect(damageMob(bull, 4, attacker, cow).killed).toBe(false);
    expect(bull.health).toBe(6);
    bull.hurtTimer = 0;
    expect(damageMob(bull, 6, attacker, cow).killed).toBe(true);
  });

  it('cow drops 1-3 raw beef (all values reachable), chicken exactly 1 raw chicken', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) {
      const drops = rollMobDrops(cow, mulberry32(seed));
      expect(drops).toHaveLength(1);
      expect(drops[0]?.itemId).toBe(ItemId.RawBeef);
      counts.add(drops[0]?.count ?? 0);
      expect(rollMobDrops(chicken, mulberry32(seed))).toEqual([{ itemId: ItemId.RawChicken, count: 1 }]);
    }
    expect(counts).toEqual(new Set([1, 2, 3]));
  });
});

describe('raw beef / raw chicken items', () => {
  it('are food worth 4 and 2 hunger, stack to 64, with their own icon tiles', () => {
    expect(itemRegistry.foodFor(ItemId.RawBeef)).toEqual({ hunger: 4 });
    expect(itemRegistry.foodFor(ItemId.RawChicken)).toEqual({ hunger: 2 });
    expect(itemRegistry.get(ItemId.RawBeef).maxStackSize).toBe(64);
    expect(itemRegistry.get(ItemId.RawChicken).maxStackSize).toBe(64);
    expect(iconTileForItem(itemRegistry, blockRegistry, ItemId.RawBeef)).toBe('raw_beef');
    expect(iconTileForItem(itemRegistry, blockRegistry, ItemId.RawChicken)).toBe('raw_chicken');
  });

  it('eating restores the listed hunger points', () => {
    const hunger = new PlayerHunger();
    hunger.addExhaustion(1000);
    const empty = hunger.hunger;
    const beef = itemRegistry.foodFor(ItemId.RawBeef);
    hunger.eat(beef?.hunger ?? 0);
    expect(hunger.hunger).toBe(empty + 4);
    hunger.eat(itemRegistry.foodFor(ItemId.RawChicken)?.hunger ?? 0);
    expect(hunger.hunger).toBe(empty + 6);
  });

  it('the save format accepts and round-trips both ids', () => {
    const slots = [createStack(ItemId.RawBeef, 5), null, createStack(ItemId.RawChicken, 64)];
    const decoded = decodeSlots(encodeSlots(slots));
    expect(decoded[0]).toEqual(slots[0]);
    expect(decoded[1]).toBeNull();
    expect(decoded[2]).toEqual(slots[2]);
  });
});

describe('raw beef / raw chicken icon tiles', () => {
  const layout = createAtlasLayout(TILE_NAMES.length);
  const pixels = generateAtlasPixels(layout, TILE_NAMES, ATLAS_CONFIG.seed);

  function visible(name: 'raw_beef' | 'raw_chicken'): number {
    const index = tileIndex(name);
    const ox = (index % layout.columns) * layout.tileSize;
    const oy = Math.floor(index / layout.columns) * layout.tileSize;
    let total = 0;
    for (let y = 0; y < layout.tileSize; y += 1) {
      for (let x = 0; x < layout.tileSize; x += 1) {
        total += (pixels[((oy + y) * layout.width + ox + x) * 4 + 3] ?? 0) > 0 ? 1 : 0;
      }
    }
    return total;
  }

  it('are 16x16 with a visible but not full-tile shape, appended after existing tiles', () => {
    expect(layout.tileSize).toBe(16);
    for (const name of ['raw_beef', 'raw_chicken'] as const) {
      expect(visible(name)).toBeGreaterThan(40);
      expect(visible(name)).toBeLessThan(256);
    }
    expect(tileIndex('raw_pork')).toBe(30);
    expect(tileIndex('raw_beef')).toBe(31);
    expect(tileIndex('raw_chicken')).toBe(32);
  });
});

describe('entity raycast with cow / chicken AABBs', () => {
  const origin = { x: 0, y: 1.1, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };

  it('hits a cow at head-ish height that a pig (0.9 tall) would not reach', () => {
    const cows = new EntityStore();
    cows.spawn(MobType.Cow, { x: 0, y: 0, z: -3 });
    expect(raycastEntities(origin, forward, 6, cows.all(), mobDefinition)?.mobId).toBe(1);
    const pigs = new EntityStore();
    pigs.spawn(MobType.Pig, { x: 0, y: 0, z: -3 });
    expect(raycastEntities(origin, forward, 6, pigs.all(), mobDefinition)).toBeNull();
  });

  it('a chicken is narrow (misses at 0.3 blocks off-axis) while a cow of the same offset is hit', () => {
    const hens = new EntityStore();
    hens.spawn(MobType.Chicken, { x: 0.3, y: 0, z: -3 });
    const low = { x: 0, y: 0.4, z: 0 };
    expect(raycastEntities(low, forward, 6, hens.all(), mobDefinition)).toBeNull();
    const cows = new EntityStore();
    cows.spawn(MobType.Cow, { x: 0.3, y: 0, z: -3 });
    expect(raycastEntities(low, forward, 6, cows.all(), mobDefinition)).not.toBeNull();
  });

  it('hits a chicken dead ahead and reports the front-face distance', () => {
    const hens = new EntityStore();
    hens.spawn(MobType.Chicken, { x: 0, y: 0.5, z: -3 });
    const hit = raycastEntities({ x: 0, y: 0.8, z: 0 }, forward, 6, hens.all(), mobDefinition);
    expect(hit?.distance).toBeCloseTo(3 - chicken.halfWidth, 5);
  });
});

describe('cow / chicken sounds', () => {
  it('pick the recipe by mob type for idle, hurt and death, positionally', () => {
    const id = (type: 'mobIdle' | 'mobHurt' | 'mobDeath', mobType: number): string | undefined =>
      soundFor({ type, mobType, position: POS })?.recipe.id;
    expect(id('mobIdle', MobType.Cow)).toBe('cow.idle');
    expect(id('mobHurt', MobType.Cow)).toBe('cow.hurt');
    expect(id('mobDeath', MobType.Cow)).toBe('cow.death');
    expect(id('mobIdle', MobType.Chicken)).toBe('chicken.idle');
    expect(id('mobHurt', MobType.Chicken)).toBe('chicken.hurt');
    expect(id('mobDeath', MobType.Chicken)).toBe('chicken.death');
    expect(soundFor({ type: 'mobIdle', mobType: MobType.Cow, position: POS })?.position).toEqual(POS);
  });
});
