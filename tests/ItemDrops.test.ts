import { describe, it, expect } from 'vitest';
import { ItemDropSystem } from '../src/items/ItemDrops';
import type { IsColumnLoaded } from '../src/items/ItemDrops';
import { createStack } from '../src/items/ItemStack';
import { ItemId } from '../src/items/items';
import { itemRegistry } from '../src/items/ItemRegistry';
import { Inventory } from '../src/items/Inventory';
import { playerAabb } from '../src/player/voxelCollision';
import { createPlayerState } from '../src/player/PlayerState';
import type { SolidQuery } from '../src/world/SolidQuery';
import { ITEM_DROP_CONFIG, PLAYER_CONFIG } from '../src/config/constants';

const alwaysLoaded: IsColumnLoaded = () => true;
const neverLoaded: IsColumnLoaded = () => false;

/** Infinite flat floor: solid at y=0 everywhere, nothing else. */
const flatFloor: SolidQuery = (_x, y, _z) => y === 0;
const noSolid: SolidQuery = () => false;

function stepMany(
  system: ItemDropSystem,
  count: number,
  dt: number,
  isSolid: SolidQuery,
  isLoaded: IsColumnLoaded = alwaysLoaded,
): void {
  for (let i = 0; i < count; i += 1) {
    system.update(dt, isSolid, isLoaded);
  }
}

describe('ItemDropSystem.spawn', () => {
  it('assigns deterministic, monotonically increasing ids', () => {
    const system = new ItemDropSystem();
    const a = system.spawn(createStack(ItemId.Stone, 1), { x: 0, y: 0, z: 0 });
    const b = system.spawn(createStack(ItemId.Stone, 1), { x: 1, y: 0, z: 0 });
    const c = system.spawn(createStack(ItemId.Stone, 1), { x: 2, y: 0, z: 0 });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(c.id).toBe(3);
  });

  it('defaults to ITEM_DROP_CONFIG.pickupDelay and zero velocity', () => {
    const system = new ItemDropSystem();
    const drop = system.spawn(createStack(ItemId.Stone, 1), { x: 0, y: 5, z: 0 });
    expect(drop.pickupDelay).toBe(ITEM_DROP_CONFIG.pickupDelay);
    expect(drop.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(drop.age).toBe(0);
  });
});

describe('ItemDropSystem.update: falling and landing', () => {
  it('falls and comes to rest on top of a solid floor, velocity.y settles to 0', () => {
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 1), { x: 0.5, y: 10, z: 0.5 });

    stepMany(system, 300, 1 / 60, flatFloor);

    const drop = system.drops()[0]!;
    const expectedY = 1 + ITEM_DROP_CONFIG.halfSize;
    expect(drop.position.y).toBeCloseTo(expectedY, 3);
    expect(drop.velocity.y).toBe(0);
  });

  it('does not tunnel through the floor even with a large dt', () => {
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 1), { x: 0.5, y: 50, z: 0.5 });

    let minY = Infinity;
    for (let i = 0; i < 50; i += 1) {
      system.update(10, flatFloor, alwaysLoaded);
      const drop = system.drops()[0];
      if (drop !== undefined) {
        minY = Math.min(minY, drop.position.y);
      }
    }

    const floorTop = 1;
    expect(minY).toBeGreaterThanOrEqual(floorTop - 1e-6);
  });

  it('free-falls with no collision when nothing is solid', () => {
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 1), { x: 0, y: 10, z: 0 });

    stepMany(system, 60, 1 / 60, noSolid);

    const drop = system.drops()[0]!;
    expect(drop.position.y).toBeLessThan(10);
    expect(drop.velocity.y).toBeLessThan(0);
  });
});

describe('ItemDropSystem.update: ground friction', () => {
  it('horizontal velocity decays to zero while resting on the ground', () => {
    const system = new ItemDropSystem();
    const drop = system.spawn(createStack(ItemId.Stone, 1), { x: 0, y: 1 + ITEM_DROP_CONFIG.halfSize, z: 0 });
    drop.velocity.x = 5;

    stepMany(system, 300, 1 / 60, flatFloor);

    const settled = system.drops()[0]!;
    expect(settled.velocity.x).toBe(0);
  });
});

describe('ItemDropSystem.update: despawn', () => {
  it('despawns once age reaches ITEM_DROP_CONFIG.lifetime', () => {
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 1), { x: 0, y: 1 + ITEM_DROP_CONFIG.halfSize, z: 0 });

    // update() clamps dt to PLAYER_CONFIG.maxFrameDelta per call, so age only
    // advances by that much each step regardless of the dt passed in.
    const dt = PLAYER_CONFIG.maxFrameDelta;
    const steps = Math.ceil(ITEM_DROP_CONFIG.lifetime / dt) + 1;
    stepMany(system, steps, dt, flatFloor);

    expect(system.drops()).toHaveLength(0);
  });

  it('despawns immediately when its column is not loaded', () => {
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 1), { x: 0, y: 5, z: 0 });

    system.update(1 / 60, flatFloor, neverLoaded);

    expect(system.drops()).toHaveLength(0);
  });
});

describe('ItemDropSystem.update: unstuck nudge', () => {
  it('nudges a drop spawned inside a solid block upward to a free cell', () => {
    // Solid everywhere from y=0..2 inclusive; free at y=3 and above.
    const isSolid: SolidQuery = (_x, y, _z) => y >= 0 && y <= 2;
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 1), { x: 0.5, y: 1.5, z: 0.5 });

    system.update(1 / 60, isSolid, alwaysLoaded);

    const drop = system.drops()[0]!;
    expect(drop.position.y).toBeGreaterThanOrEqual(3);
  });
});

describe('ItemDropSystem.collect', () => {
  function playerBoxAt(x: number, y: number, z: number) {
    return playerAabb(createPlayerState({ x, y, z }));
  }

  it('respects pickupDelay: not collected until it elapses', () => {
    // Floor at y=-1 so the drop (spawned resting at y=0) stays put — the
    // delay, not physics, is what's under test here.
    const floorBelow: SolidQuery = (_x, y, _z) => y === -1;
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 1), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1);
    const inv = new Inventory();

    const collectedBefore = system.collect(playerBoxAt(0, 0, 0), inv);
    expect(collectedBefore).toBe(0);
    expect(system.drops()).toHaveLength(1);

    // update() clamps dt to PLAYER_CONFIG.maxFrameDelta per call; step enough
    // times to exceed the 1s pickup delay.
    stepMany(system, Math.ceil(1 / PLAYER_CONFIG.maxFrameDelta) + 1, PLAYER_CONFIG.maxFrameDelta, floorBelow);
    const collectedAfter = system.collect(playerBoxAt(0, 0, 0), inv);
    expect(collectedAfter).toBe(1);
    expect(system.drops()).toHaveLength(0);
  });

  it('within pickup radius adds to inventory and removes the drop', () => {
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 3), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    const inv = new Inventory();

    const collected = system.collect(playerBoxAt(0, 0, 0), inv);

    expect(collected).toBe(3);
    expect(inv.countItem(ItemId.Stone)).toBe(3);
    expect(system.drops()).toHaveLength(0);
  });

  it('out of radius is not collected', () => {
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 1), { x: 100, y: 0, z: 100 }, { x: 0, y: 0, z: 0 }, 0);
    const inv = new Inventory();

    const collected = system.collect(playerBoxAt(0, 0, 0), inv);

    expect(collected).toBe(0);
    expect(system.drops()).toHaveLength(1);
    expect(inv.countItem(ItemId.Stone)).toBe(0);
  });

  it('partial collect leaves the remainder as a smaller drop when inventory is nearly full', () => {
    const system = new ItemDropSystem();
    const maxStack = itemRegistry.maxStackSize(ItemId.Stone);
    system.spawn(createStack(ItemId.Stone, 10), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    const inv = new Inventory();

    // Fill every slot except one with a full stack of Stone, and leave the
    // last slot with (maxStack - 4) Stone, so only 4 more can fit anywhere.
    for (let i = 0; i < inv.size - 1; i += 1) {
      inv.set(i, createStack(ItemId.Stone, maxStack));
    }
    inv.set(inv.size - 1, createStack(ItemId.Stone, maxStack - 4));

    const collected = system.collect(playerBoxAt(0, 0, 0), inv);

    expect(collected).toBe(4);
    const remaining = system.drops();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.stack).toEqual({ itemId: ItemId.Stone, count: 6 });
  });

  it('collects multiple eligible drops in deterministic id order', () => {
    const system = new ItemDropSystem();
    system.spawn(createStack(ItemId.Stone, 1), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    system.spawn(createStack(ItemId.Coal, 2), { x: 0.1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    const inv = new Inventory();

    const collected = system.collect(playerBoxAt(0, 0, 0), inv);

    expect(collected).toBe(3);
    expect(inv.countItem(ItemId.Stone)).toBe(1);
    expect(inv.countItem(ItemId.Coal)).toBe(2);
    expect(system.drops()).toHaveLength(0);
  });
});

describe('ItemDropSystem: determinism', () => {
  it('same inputs produce identical resulting drop states', () => {
    function run(): ReturnType<ItemDropSystem['drops']> {
      const system = new ItemDropSystem();
      system.spawn(createStack(ItemId.Stone, 1), { x: 0.5, y: 10, z: 0.5 }, { x: 1, y: 0, z: 0.5 });
      system.spawn(createStack(ItemId.Coal, 2), { x: 3.5, y: 5, z: -2.5 });
      stepMany(system, 200, 1 / 60, flatFloor);
      return system.drops();
    }

    const a = run();
    const b = run();

    expect(a).toEqual(b);
  });
});

describe('moveAabbThroughVoxels (extracted collision core) with a non-player size', () => {
  it('resolves a small cube resting on a floor, independent of player dimensions', async () => {
    const { moveAabbThroughVoxels } = await import('../src/player/voxelCollision');
    const half = ITEM_DROP_CONFIG.halfSize;
    const aabb = {
      minX: -half,
      maxX: half,
      minY: 5 - half,
      maxY: 5 + half,
      minZ: -half,
      maxZ: half,
    };

    // Fall a large distance in substeps, as ItemDropSystem.update would.
    let y = 5;
    for (let i = 0; i < 300; i += 1) {
      const dy = -0.2;
      Object.assign(aabb, {
        minY: y - half,
        maxY: y + half,
      });
      const result = moveAabbThroughVoxels(
        aabb,
        0,
        dy,
        0,
        flatFloor,
        PLAYER_CONFIG.collisionEpsilon,
        PLAYER_CONFIG.maxSubstepDistance,
      );
      y = aabb.minY + half;
      if (result.collidedY) {
        break;
      }
    }

    expect(y).toBeCloseTo(1 + half, 3);
  });
});
