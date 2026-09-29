import { describe, it, expect } from 'vitest';
import { updateMobAi, type Rng } from '../src/entities/mobAI';
import { EntityStore } from '../src/entities/EntityStore';
import { MobType, mobDefinition } from '../src/entities/mobDefinitions';

/** Rng that returns a fixed scripted sequence, looping if exhausted. */
function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return (): number => {
    const value = values[i % values.length] ?? 0;
    i += 1;
    return value;
  };
}

const def = mobDefinition(MobType.Pig);

describe('updateMobAi: idle -> wander -> idle transitions', () => {
  it('starts idle and switches to wander once the idle timer elapses', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    // First roll (0.5) picks the wander duration when we transition; subsequent target-yaw roll uses 0.5 too.
    const rng = scriptedRng([0.5]);

    expect(mob.ai.state).toBe('idle');
    mob.ai.timer = 0.05;

    updateMobAi(mob, def, 0.1, rng);

    expect(mob.ai.state).toBe('wander');
    expect(mob.ai.timer).toBeGreaterThan(0);
  });

  it('switches from wander back to idle once the wander timer elapses', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    mob.ai.state = 'wander';
    mob.ai.timer = 0.05;
    const rng = scriptedRng([0.3]);

    updateMobAi(mob, def, 0.1, rng);

    expect(mob.ai.state).toBe('idle');
    expect(mob.ai.timer).toBeGreaterThan(0);
  });

  it('stays in the same state while its timer has not elapsed', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    mob.ai.state = 'idle';
    mob.ai.timer = 5;
    const rng = scriptedRng([0.1]);

    updateMobAi(mob, def, 0.1, rng);

    expect(mob.ai.state).toBe('idle');
    expect(mob.ai.timer).toBeCloseTo(4.9, 5);
  });
});

describe('updateMobAi: yaw turning', () => {
  it('turns yaw toward targetYaw without overshooting in a single small step', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    mob.ai.state = 'wander';
    mob.ai.timer = 10;
    mob.yaw = 0;
    mob.ai.targetYaw = 0.05; // smaller than one turn step at dt=0.1
    const rng = scriptedRng([0.5]);

    updateMobAi(mob, def, 0.1, rng);

    expect(mob.yaw).toBe(0.05);
  });

  it('turns yaw incrementally toward a far target, bounded by MOB_CONFIG.turnSpeed * dt', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    mob.ai.state = 'wander';
    mob.ai.timer = 10;
    mob.yaw = 0;
    mob.ai.targetYaw = Math.PI; // far target
    const rng = scriptedRng([0.5]);

    updateMobAi(mob, def, 0.1, rng);

    // Should have moved toward the target but not reached it in one small step.
    expect(Math.abs(mob.yaw)).toBeGreaterThan(0);
    expect(mob.yaw).not.toBe(Math.PI);
  });

  it('never turns further than MOB_CONFIG.turnSpeed * dt per tick', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    mob.ai.state = 'wander';
    mob.ai.timer = 10;
    mob.yaw = 0;
    mob.ai.targetYaw = Math.PI / 2;
    const rng = scriptedRng([0.5]);
    const dt = 0.1;

    const before = mob.yaw;
    updateMobAi(mob, def, dt, rng);
    const turned = Math.abs(mob.yaw - before);

    // MOB_CONFIG.turnSpeed is 3 rad/s in constants.ts.
    expect(turned).toBeLessThanOrEqual(3 * dt + 1e-9);
  });
});

describe('updateMobAi: flee state', () => {
  it('stays in flee (moving, via yaw held toward targetYaw) while its timer has not elapsed', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    mob.ai.state = 'flee';
    mob.ai.timer = 2;
    mob.ai.targetYaw = Math.PI;
    mob.yaw = 0;
    const rng = scriptedRng([0.5]); // jitter roll of 0 (midpoint of scripted range -> no net jitter direction bias tested elsewhere)

    updateMobAi(mob, def, 0.1, rng);

    expect(mob.ai.state).toBe('flee');
    expect(mob.ai.timer).toBeCloseTo(1.9, 5);
    // Yaw moved toward the target (away direction), same turn-speed bound as wander.
    expect(Math.abs(mob.yaw)).toBeGreaterThan(0);
  });

  it('returns to idle once the flee timer elapses', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    mob.ai.state = 'flee';
    mob.ai.timer = 0.05;
    const rng = scriptedRng([0.5]);

    updateMobAi(mob, def, 0.1, rng);

    expect(mob.ai.state).toBe('idle');
    expect(mob.ai.timer).toBeGreaterThan(0);
  });

  it('jitters targetYaw each tick using the injected rng (deterministic)', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    mob.ai.state = 'flee';
    mob.ai.timer = 5;
    mob.ai.targetYaw = 0;
    const rng = scriptedRng([1]); // max jitter roll each call

    const before = mob.ai.targetYaw;
    updateMobAi(mob, def, 0.1, rng);

    expect(mob.ai.targetYaw).not.toBe(before);
  });

  it('same rng sequence produces identical flee trajectory (determinism)', () => {
    function run(): unknown {
      const store = new EntityStore();
      const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
      mob.ai.state = 'flee';
      mob.ai.timer = 3;
      mob.ai.targetYaw = Math.PI / 2;
      const rng = scriptedRng([0.2, 0.8, 0.4, 0.6]);
      for (let i = 0; i < 20; i += 1) {
        updateMobAi(mob, def, 0.1, rng);
      }
      return { yaw: mob.yaw, ai: mob.ai };
    }

    expect(run()).toEqual(run());
  });
});

describe('updateMobAi: determinism', () => {
  it('same rng sequence produces identical resulting ai state', () => {
    function run(): unknown {
      const store = new EntityStore();
      const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
      const rng = scriptedRng([0.1, 0.9, 0.4, 0.6, 0.2]);
      for (let i = 0; i < 50; i += 1) {
        updateMobAi(mob, def, 0.1, rng);
      }
      return { yaw: mob.yaw, ai: mob.ai };
    }

    expect(run()).toEqual(run());
  });
});
