import { describe, it, expect } from 'vitest';
import { EntityStore } from '../src/entities/EntityStore';
import { MobType } from '../src/entities/mobDefinitions';

describe('EntityStore.spawn', () => {
  it('assigns deterministic, monotonically increasing ids', () => {
    const store = new EntityStore();
    const a = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    const b = store.spawn(MobType.Pig, { x: 1, y: 0, z: 0 });
    const c = store.spawn(MobType.Pig, { x: 2, y: 0, z: 0 });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(c.id).toBe(3);
  });

  it('defaults ai state to idle and copies the position (no shared reference)', () => {
    const store = new EntityStore();
    const position = { x: 5, y: 6, z: 7 };
    const mob = store.spawn(MobType.Pig, position);

    expect(mob.ai.state).toBe('idle');
    expect(mob.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(mob.position).toEqual(position);
    expect(mob.position).not.toBe(position);
  });
});

describe('EntityStore.remove', () => {
  it('removes the entity and updates count', () => {
    const store = new EntityStore();
    const a = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    store.spawn(MobType.Pig, { x: 1, y: 0, z: 0 });

    const removed = store.remove(a.id);

    expect(removed).toBe(true);
    expect(store.count()).toBe(1);
    expect(store.get(a.id)).toBeUndefined();
  });

  it('returns false for an id that does not exist', () => {
    const store = new EntityStore();
    expect(store.remove(999)).toBe(false);
  });

  it('swap-removal keeps every remaining entity reachable by id', () => {
    const store = new EntityStore();
    const a = store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    const b = store.spawn(MobType.Pig, { x: 1, y: 0, z: 0 });
    const c = store.spawn(MobType.Pig, { x: 2, y: 0, z: 0 });

    store.remove(a.id);

    expect(store.get(b.id)?.position.x).toBe(1);
    expect(store.get(c.id)?.position.x).toBe(2);
    expect(store.all()).toHaveLength(2);
  });
});

describe('EntityStore.count', () => {
  it('counts all entities or filtered by type', () => {
    const store = new EntityStore();
    store.spawn(MobType.Pig, { x: 0, y: 0, z: 0 });
    store.spawn(MobType.Pig, { x: 1, y: 0, z: 0 });

    expect(store.count()).toBe(2);
    expect(store.count(MobType.Pig)).toBe(2);
  });
});

describe('EntityStore: determinism', () => {
  it('same sequence of spawns/removals produces identical resulting state', () => {
    function run(): unknown {
      const store = new EntityStore();
      store.spawn(MobType.Pig, { x: 0, y: 1, z: 2 }, 0.5);
      const b = store.spawn(MobType.Pig, { x: 3, y: 4, z: 5 }, 1.2);
      store.remove(b.id);
      store.spawn(MobType.Pig, { x: 6, y: 7, z: 8 }, -0.3);
      return store.all();
    }

    expect(run()).toEqual(run());
  });
});
