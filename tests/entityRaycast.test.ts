import { describe, it, expect } from 'vitest';
import { raycastEntities, createEntityRaycastHit } from '../src/entities/entityRaycast';
import { EntityStore } from '../src/entities/EntityStore';
import { MobType, mobDefinition } from '../src/entities/mobDefinitions';

const definitionFor = mobDefinition;

describe('raycastEntities: basic hit/miss', () => {
  it('hits a mob directly ahead within reach', () => {
    const store = new EntityStore();
    store.spawn(MobType.Pig, { x: 0, y: 0, z: -3 });

    const hit = raycastEntities(
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: -1 },
      6,
      store.all(),
      definitionFor,
    );

    expect(hit).not.toBeNull();
    expect(hit?.mobId).toBe(1);
  });

  it('misses when beyond maxDistance', () => {
    const store = new EntityStore();
    store.spawn(MobType.Pig, { x: 0, y: 0, z: -10 });

    const hit = raycastEntities(
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: -1 },
      6,
      store.all(),
      definitionFor,
    );

    expect(hit).toBeNull();
  });

  it('misses when the ray passes beside the mob (not through its AABB)', () => {
    const store = new EntityStore();
    store.spawn(MobType.Pig, { x: 5, y: 0, z: -3 });

    const hit = raycastEntities(
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: -1 },
      6,
      store.all(),
      definitionFor,
    );

    expect(hit).toBeNull();
  });

  it('no mobs -> miss', () => {
    const store = new EntityStore();
    const hit = raycastEntities(
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: -1 },
      6,
      store.all(),
      definitionFor,
    );
    expect(hit).toBeNull();
  });
});

describe('raycastEntities: nearest of several', () => {
  it('returns the nearer of two mobs along the same ray', () => {
    const store = new EntityStore();
    const far = store.spawn(MobType.Pig, { x: 0, y: 0, z: -5 });
    const near = store.spawn(MobType.Pig, { x: 0, y: 0, z: -2 });
    void far;

    const hit = raycastEntities(
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: -1 },
      10,
      store.all(),
      definitionFor,
    );

    expect(hit).not.toBeNull();
    expect(hit?.mobId).toBe(near.id);
  });

  it('order of mobs in the array does not affect which is nearest', () => {
    const store = new EntityStore();
    const near = store.spawn(MobType.Pig, { x: 0, y: 0, z: -2 });
    const far = store.spawn(MobType.Pig, { x: 0, y: 0, z: -5 });
    void far;

    const hit = raycastEntities(
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: -1 },
      10,
      store.all(),
      definitionFor,
    );

    expect(hit?.mobId).toBe(near.id);
  });
});

describe('raycastEntities: edge cases', () => {
  it('a ray starting inside a mob AABB hits it at distance 0', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    const def = mobDefinition(MobType.Pig);

    const originInsideBox = { x: mob.position.x, y: mob.position.y + def.height / 2, z: mob.position.z };

    const hit = raycastEntities(
      originInsideBox,
      { x: 0, y: 0, z: -1 },
      6,
      store.all(),
      definitionFor,
    );

    expect(hit).not.toBeNull();
    expect(hit?.mobId).toBe(mob.id);
    expect(hit?.distance).toBe(0);
  });

  it('works correctly with negative world coordinates', () => {
    const store = new EntityStore();
    const mob = store.spawn(MobType.Pig, { x: -100, y: -50, z: -200 });

    const hit = raycastEntities(
      { x: -100, y: -49.5, z: -197 },
      { x: 0, y: 0, z: -1 },
      6,
      store.all(),
      definitionFor,
    );

    expect(hit).not.toBeNull();
    expect(hit?.mobId).toBe(mob.id);
  });

  it('a block-exactly-at-maxDistance boundary still counts as a hit (inclusive)', () => {
    const store = new EntityStore();
    const def = mobDefinition(MobType.Pig);
    // Place the mob's near face exactly at z = -6 from origin z = 0.
    store.spawn(MobType.Pig, { x: 0, y: 0, z: -6 - def.halfWidth });

    const hit = raycastEntities(
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: -1 },
      6,
      store.all(),
      definitionFor,
    );

    expect(hit).not.toBeNull();
  });
});

describe('raycastEntities: allocation-free API shape', () => {
  it('accepts a reusable `out` object and returns the same reference', () => {
    const store = new EntityStore();
    store.spawn(MobType.Pig, { x: 0, y: 0, z: -3 });

    const out = createEntityRaycastHit();
    const hit = raycastEntities(
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: -1 },
      6,
      store.all(),
      definitionFor,
      out,
    );

    expect(hit).toBe(out);
  });

  it('defaults to creating its own hit object when `out` is omitted', () => {
    const store = new EntityStore();
    store.spawn(MobType.Pig, { x: 0, y: 0, z: -3 });

    const hit = raycastEntities(
      { x: 0, y: 0.5, z: 0 },
      { x: 0, y: 0, z: -1 },
      6,
      store.all(),
      definitionFor,
    );

    expect(hit).not.toBeNull();
    expect(typeof hit?.mobId).toBe('number');
    expect(typeof hit?.distance).toBe('number');
  });
});
