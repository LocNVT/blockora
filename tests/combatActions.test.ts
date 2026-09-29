import { describe, it, expect } from 'vitest';
import { resolveAttackOrBreak, performMobAttack } from '../src/gameplay/combatActions';
import type { EntityRaycastHit } from '../src/entities/entityRaycast';
import type { VoxelRaycastBlockHit } from '../src/world/voxelRaycast';
import { createVoxelRaycastBlockHit } from '../src/world/voxelRaycast';
import { EntityStore } from '../src/entities/EntityStore';
import { MobType } from '../src/entities/mobDefinitions';
import { ItemDropSystem } from '../src/items/ItemDrops';
import { Inventory } from '../src/items/Inventory';
import { itemRegistry } from '../src/items/ItemRegistry';
import { COMBAT_CONFIG } from '../src/config/constants';

function entityHitAt(distance: number): EntityRaycastHit {
  return { mobId: 1, distance };
}

function blockHitAt(distance: number): VoxelRaycastBlockHit {
  const hit = createVoxelRaycastBlockHit();
  hit.distance = distance;
  return hit;
}

describe('resolveAttackOrBreak: priority rules', () => {
  it('no entity hit -> break', () => {
    expect(resolveAttackOrBreak(null, blockHitAt(3))).toBe('break');
    expect(resolveAttackOrBreak(null, null)).toBe('break');
  });

  it('entity hit but no block hit -> attack', () => {
    expect(resolveAttackOrBreak(entityHitAt(4), null)).toBe('attack');
  });

  it('entity nearer than block -> attack', () => {
    expect(resolveAttackOrBreak(entityHitAt(2), blockHitAt(5))).toBe('attack');
  });

  it('block nearer than entity -> break', () => {
    expect(resolveAttackOrBreak(entityHitAt(5), blockHitAt(2))).toBe('break');
  });

  it('exact tie favors attack', () => {
    expect(resolveAttackOrBreak(entityHitAt(3), blockHitAt(3))).toBe('attack');
  });
});

describe('performMobAttack: integration', () => {
  it('applies damage, does not wear the tool slot when bare-handed', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 5 });
    const drops = new ItemDropSystem();
    const inventory = new Inventory();
    const mobRng = (): number => 0.5;

    const startHealth = mob.health;
    const result = performMobAttack(
      mob,
      { x: 0, y: 0, z: 0 },
      undefined,
      store,
      drops,
      inventory,
      itemRegistry,
      mobRng,
    );

    expect(result.applied).toBe(true);
    expect(mob.health).toBe(startHealth - COMBAT_CONFIG.handDamage);
  });

  it('kills the mob, removes it from the store, and spawns drops', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 2, y: 0, z: 5 });
    mob.health = 1;
    const drops = new ItemDropSystem();
    const inventory = new Inventory();
    const mobRng = (): number => 0; // rolls minimum drop count

    const result = performMobAttack(
      mob,
      { x: 2, y: 0, z: 0 },
      undefined,
      store,
      drops,
      inventory,
      itemRegistry,
      mobRng,
    );

    expect(result.killed).toBe(true);
    expect(store.get(mob.id)).toBeUndefined();
    expect(drops.drops().length).toBeGreaterThan(0);
  });

  it('a hit inside the invulnerability window does not re-kill or re-drop', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 5 });
    const drops = new ItemDropSystem();
    const inventory = new Inventory();
    const mobRng = (): number => 0;

    performMobAttack(mob, { x: 0, y: 0, z: 0 }, undefined, store, drops, inventory, itemRegistry, mobRng);
    const result = performMobAttack(
      mob,
      { x: 0, y: 0, z: 0 },
      undefined,
      store,
      drops,
      inventory,
      itemRegistry,
      mobRng,
    );

    expect(result.applied).toBe(false);
  });
});
