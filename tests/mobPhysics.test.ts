import { describe, it, expect } from 'vitest';
import { updateMobPhysics } from '../src/entities/mobPhysics';
import { EntityStore } from '../src/entities/EntityStore';
import { MobType, mobDefinition } from '../src/entities/mobDefinitions';
import type { SolidQuery } from '../src/world/SolidQuery';

const def = mobDefinition(MobType.Pig);
const noFluid: SolidQuery = () => false;

function stepMany(
  mob: ReturnType<EntityStore['spawn']>,
  count: number,
  dt: number,
  isSolid: SolidQuery,
  isFluid: SolidQuery = noFluid,
): void {
  for (let i = 0; i < count; i += 1) {
    updateMobPhysics(mob, def, dt, isSolid, isFluid);
  }
}

function stepManyTracking(
  mob: ReturnType<EntityStore['spawn']>,
  count: number,
  dt: number,
  isSolid: SolidQuery,
  onStep: (mob: ReturnType<EntityStore['spawn']>) => void,
): void {
  for (let i = 0; i < count; i += 1) {
    updateMobPhysics(mob, def, dt, isSolid, noFluid);
    onStep(mob);
  }
}

describe('updateMobPhysics: falling and landing', () => {
  it('falls and comes to rest on top of a solid floor', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0.5, y: 10, z: 0.5 });
    const flatFloor: SolidQuery = (_x, y, _z) => y === 0;

    stepMany(mob, 300, 1 / 60, flatFloor);

    expect(mob.position.y).toBeCloseTo(1, 3);
    expect(mob.velocity.y).toBe(0);
    expect(mob.onGround).toBe(true);
  });

  it('free-falls with no collision when nothing is solid', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 10, z: 0 });
    const noSolid: SolidQuery = () => false;

    stepMany(mob, 60, 1 / 60, noSolid);

    expect(mob.position.y).toBeLessThan(10);
    expect(mob.velocity.y).toBeLessThan(0);
    expect(mob.onGround).toBe(false);
  });

  it('works at negative world coordinates', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: -50.5, y: 10, z: -30.5 });
    const flatFloor: SolidQuery = (_x, y, _z) => y === 0;

    stepMany(mob, 300, 1 / 60, flatFloor);

    expect(mob.position.y).toBeCloseTo(1, 3);
    expect(mob.onGround).toBe(true);
  });
});

describe('updateMobPhysics: horizontal collision', () => {
  it('stops at a wall while wandering forward', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0.5, y: 1, z: 0.5 }, 0); // yaw 0 -> -Z movement
    mob.ai.state = 'wander';
    mob.ai.targetYaw = 0;
    mob.onGround = true;

    // Floor everywhere at y=0; solid wall at z <= -3 across all x/y (tall enough nothing can jump it).
    const isSolid: SolidQuery = (_x, y, z) => y === 0 || z <= -3;

    stepMany(mob, 600, 1 / 60, isSolid);

    // Should be halted well before z would go very negative, and not tunnel through.
    expect(mob.position.z).toBeGreaterThan(-3);
  });
});

describe('updateMobPhysics: auto-jump', () => {
  it('hops a 1-block step directly ahead while wandering on the ground', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0.5, y: 1, z: 5.5 }, 0); // yaw 0 -> -Z movement
    mob.ai.state = 'wander';
    mob.ai.targetYaw = 0;
    mob.onGround = true;

    // Floor at y=0 for z > 0; a 1-block step raises the floor to y=1 for z <= 0,
    // with free air above it (y=2, y=3 clear) so the pig can stand on the step.
    const isSolid: SolidQuery = (_x, y, z) => (z > 0 ? y === 0 : y === 0 || y === 1);

    let maxZReached = mob.position.z;
    let minZReached = mob.position.z;
    for (let i = 0; i < 600; i += 1) {
      updateMobPhysics(mob, def, 1 / 60, isSolid, noFluid);
      maxZReached = Math.max(maxZReached, mob.position.z);
      minZReached = Math.min(minZReached, mob.position.z);
    }

    // The pig should have made it up onto the step (z < 0 means it crossed
    // past the step's edge at z=0) and be resting at the step's height.
    expect(minZReached).toBeLessThan(0);
    expect(mob.position.y).toBeGreaterThan(1.9);
  });

  it('does not climb a 2-block wall', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0.5, y: 1, z: 5.5 }, 0);
    mob.ai.state = 'wander';
    mob.ai.targetYaw = 0;
    mob.onGround = true;

    // Floor at y=0 for z > 0; a 2-block wall for z <= 0.
    const isSolid: SolidQuery = (_x, y, z) => (z > 0 ? y === 0 : y === 0 || y === 1 || y === 2);

    let maxYReached = mob.position.y;
    stepManyTracking(mob, 600, 1 / 60, isSolid, (m) => {
      maxYReached = Math.max(maxYReached, m.position.y);
    });

    expect(mob.position.z).toBeGreaterThanOrEqual(0 - 1e-3);
    // Never clears the 2-block wall (would need to reach y >= 3 to stand on top).
    expect(maxYReached).toBeLessThan(3);
  });
});

describe('updateMobPhysics: hazard avoidance while wandering', () => {
  it('does not walk off a ledge deeper than MOB_CONFIG.maxSafeDropAhead', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0.5, y: 1, z: 5.5 }, 0); // yaw 0 -> -Z movement
    mob.ai.state = 'wander';
    mob.ai.targetYaw = 0;
    mob.onGround = true;

    // Floor at y=0 for z > 0; a deep pit (10 blocks) for z <= 0.
    const isSolid: SolidQuery = (_x, y, z) => z > 0 && y === 0;

    stepMany(mob, 600, 1 / 60, isSolid);

    expect(mob.position.z).toBeGreaterThanOrEqual(0);
  });

  it('does not walk into a fluid cell ahead', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0.5, y: 1, z: 5.5 }, 0);
    mob.ai.state = 'wander';
    mob.ai.targetYaw = 0;
    mob.onGround = true;

    const isSolid: SolidQuery = (_x, y, _z) => y === 0;
    const isFluid: SolidQuery = (_x, _y, z) => z <= 0;

    stepMany(mob, 600, 1 / 60, isSolid, isFluid);

    expect(mob.position.z).toBeGreaterThan(0);
  });
});

describe('updateMobPhysics: determinism', () => {
  it('same inputs produce identical resulting state', () => {
    function run(): unknown {
      const store = new EntityStore();
      const mob = store.spawn(MobType.Pig, { x: 0.5, y: 10, z: 0.5 }, 0.3);
      mob.ai.state = 'wander';
      mob.ai.targetYaw = 0.3;
      const flatFloor: SolidQuery = (_x, y, _z) => y === 0;
      stepMany(mob, 200, 1 / 60, flatFloor);
      return { position: mob.position, velocity: mob.velocity, onGround: mob.onGround };
    }

    expect(run()).toEqual(run());
  });
});
