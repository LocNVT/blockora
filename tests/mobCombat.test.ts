import { describe, it, expect } from 'vitest';
import { damageMob, meleeDamage, rollMobDrops } from '../src/entities/mobCombat';
import { EntityStore } from '../src/entities/EntityStore';
import { MobType, mobDefinition } from '../src/entities/mobDefinitions';
import { COMBAT_CONFIG } from '../src/config/constants';
import type { Rng } from '../src/entities/mobAI';
import type { ToolProperties } from '../src/items/items';
import { ItemId } from '../src/items/items';

const def = mobDefinition(MobType.Pig);

/** Rng that returns a fixed scripted sequence, looping if exhausted. */
function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return (): number => {
    const value = values[i % values.length] ?? 0;
    i += 1;
    return value;
  };
}

describe('meleeDamage', () => {
  it('bare hand deals COMBAT_CONFIG.handDamage', () => {
    expect(meleeDamage(undefined)).toBe(COMBAT_CONFIG.handDamage);
  });

  it('axe adds its tool bonus on top of hand damage', () => {
    const axe: ToolProperties = { type: 'axe', tier: 1, speed: 2, maxDurability: 64 };
    expect(meleeDamage(axe)).toBe(COMBAT_CONFIG.handDamage + COMBAT_CONFIG.toolDamageBonus.axe);
  });

  it('pickaxe adds its (smaller) tool bonus', () => {
    const pickaxe: ToolProperties = { type: 'pickaxe', tier: 1, speed: 2, maxDurability: 64 };
    expect(meleeDamage(pickaxe)).toBe(COMBAT_CONFIG.handDamage + COMBAT_CONFIG.toolDamageBonus.pickaxe);
  });

  it('shovel bonus is 0 (deals the same as bare hand)', () => {
    const shovel: ToolProperties = { type: 'shovel', tier: 1, speed: 2, maxDurability: 64 };
    expect(meleeDamage(shovel)).toBe(COMBAT_CONFIG.handDamage + COMBAT_CONFIG.toolDamageBonus.shovel);
    expect(meleeDamage(shovel)).toBe(meleeDamage(undefined));
  });
});

describe('damageMob: applying damage', () => {
  it('subtracts the amount from health and reports applied: true', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    const startHealth = mob.health;

    const result = damageMob(mob, 3, { x: 0, y: 0, z: 1 }, def);

    expect(result.applied).toBe(true);
    expect(result.killed).toBe(false);
    expect(mob.health).toBe(startHealth - 3);
  });

  it('clamps health at 0 and reports killed: true when damage meets or exceeds current health', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    const result = damageMob(mob, mob.health + 999, { x: 0, y: 0, z: 1 }, def);

    expect(result.killed).toBe(true);
    expect(mob.health).toBe(0);
  });

  it('killed exactly at 0 remaining health (not negative)', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    const result = damageMob(mob, mob.health, { x: 0, y: 0, z: 1 }, def);

    expect(result.killed).toBe(true);
    expect(mob.health).toBe(0);
  });

  it('non-positive damage is a no-op', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    const startHealth = mob.health;

    const result = damageMob(mob, 0, { x: 0, y: 0, z: 1 }, def);

    expect(result.applied).toBe(false);
    expect(mob.health).toBe(startHealth);
  });
});

describe('damageMob: hurt invulnerability window', () => {
  it('a second hit during the invulnerability window is ignored', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    const first = damageMob(mob, 2, { x: 0, y: 0, z: 1 }, def);
    const healthAfterFirst = mob.health;
    const second = damageMob(mob, 2, { x: 0, y: 0, z: 1 }, def);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(mob.health).toBe(healthAfterFirst);
  });

  it('sets hurtTimer to COMBAT_CONFIG.hurtInvulnerability and hurtFlashTimer to COMBAT_CONFIG.hurtFlashDuration', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    damageMob(mob, 1, { x: 0, y: 0, z: 1 }, def);

    expect(mob.hurtTimer).toBe(COMBAT_CONFIG.hurtInvulnerability);
    expect(mob.hurtFlashTimer).toBe(COMBAT_CONFIG.hurtFlashDuration);
  });

  it('a hit after hurtTimer has elapsed is applied again', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    damageMob(mob, 1, { x: 0, y: 0, z: 1 }, def);
    mob.hurtTimer = 0;

    const second = damageMob(mob, 1, { x: 0, y: 0, z: 1 }, def);
    expect(second.applied).toBe(true);
  });
});

describe('damageMob: knockback direction', () => {
  it('knocks back away from the source position (source behind on +Z -> mob pushed toward -Z)', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    damageMob(mob, 1, { x: 0, y: 0, z: 5 }, def);

    expect(mob.velocity.z).toBeLessThan(0);
    expect(mob.velocity.x).toBeCloseTo(0, 5);
    expect(mob.velocity.y).toBe(COMBAT_CONFIG.knockbackVerticalSpeed);
  });

  it('knocks back away from the source position (source to the +X side -> mob pushed toward -X)', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    damageMob(mob, 1, { x: 5, y: 0, z: 0 }, def);

    expect(mob.velocity.x).toBeLessThan(0);
    expect(mob.velocity.z).toBeCloseTo(0, 5);
  });

  it('knockback horizontal speed matches COMBAT_CONFIG.knockbackHorizontalSpeed (unit direction scaled)', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    damageMob(mob, 1, { x: 0, y: 0, z: 3 }, def);

    const horizontalSpeed = Math.hypot(mob.velocity.x, mob.velocity.z);
    expect(horizontalSpeed).toBeCloseTo(COMBAT_CONFIG.knockbackHorizontalSpeed, 5);
  });

  it('falls back to a well-defined direction when the source is exactly at the mob position', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 2, y: 0, z: 3 }, 0);

    damageMob(mob, 1, { x: 2, y: 0, z: 3 }, def);

    const horizontalSpeed = Math.hypot(mob.velocity.x, mob.velocity.z);
    expect(horizontalSpeed).toBeCloseTo(COMBAT_CONFIG.knockbackHorizontalSpeed, 5);
    expect(Number.isFinite(mob.velocity.x)).toBe(true);
    expect(Number.isFinite(mob.velocity.z)).toBe(true);
  });
});

describe('damageMob: flee state', () => {
  it('switches ai.state to flee and starts the flee timer when the mob survives', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    const result = damageMob(mob, 1, { x: 0, y: 0, z: 5 }, def);

    expect(result.killed).toBe(false);
    expect(mob.ai.state).toBe('flee');
    expect(mob.ai.timer).toBe(def.fleeDuration);
  });

  it('sets targetYaw facing away from the attacker', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });

    // Attacker at +Z; away direction is -Z, i.e. yaw = PI (since
    // -sin(yaw)=0, -cos(yaw)=-1 at yaw=PI matches moving toward -Z).
    damageMob(mob, 1, { x: 0, y: 0, z: 5 }, def);

    const awayX = -Math.sin(mob.ai.targetYaw);
    const awayZ = -Math.cos(mob.ai.targetYaw);
    expect(awayZ).toBeLessThan(0);
    expect(awayX).toBeCloseTo(0, 5);
  });

  it('does not switch to flee when the hit kills the mob', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    mob.ai.state = 'idle';

    const result = damageMob(mob, mob.health, { x: 0, y: 0, z: 5 }, def);

    expect(result.killed).toBe(true);
    expect(mob.ai.state).toBe('idle');
  });
});

describe('rollMobDrops', () => {
  it('rolls a count within [min, max] for each drop entry', () => {
    const rng = scriptedRng([0, 0.5, 0.999]);
    const rolled = rollMobDrops(def, rng);

    expect(rolled).toHaveLength(def.drops.length);
    rolled.forEach((drop, i) => {
      const spec = def.drops[i];
      expect(spec).toBeDefined();
      if (spec === undefined) return;
      expect(drop.itemId).toBe(spec.itemId);
      expect(drop.count).toBeGreaterThanOrEqual(spec.min);
      expect(drop.count).toBeLessThanOrEqual(spec.max);
    });
  });

  it('is deterministic given the same rng sequence', () => {
    const run = (): unknown => rollMobDrops(def, scriptedRng([0.1, 0.9, 0.4]));
    expect(run()).toEqual(run());
  });

  it('rng() = 0 rolls the minimum count', () => {
    const rng = scriptedRng([0]);
    const rolled = rollMobDrops(def, rng);
    const spec = def.drops[0];
    expect(spec).toBeDefined();
    if (spec === undefined) return;
    expect(rolled[0]?.count).toBe(spec.min);
  });
});

describe('pig drop definition', () => {
  // PIG_CONFIG keeps the item id numeric to avoid an import cycle; pin it here.
  it('drops raw pork', () => {
    const drops = mobDefinition(MobType.Pig).drops;
    expect(drops.map((d) => d.itemId)).toEqual([ItemId.RawPork]);
  });
});
