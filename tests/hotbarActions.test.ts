import { describe, it, expect } from 'vitest';
import {
  applyHotbarInput,
  applyToolWear,
  placeSelectedItem,
  breakAndDrop,
  throwSelectedItem,
  giveStartingItems,
  STARTING_ITEMS,
} from '../src/gameplay/hotbarActions';
import type { HotbarInput } from '../src/player/InputController';
import { Inventory } from '../src/items/Inventory';
import { createStack } from '../src/items/ItemStack';
import { ItemId } from '../src/items/items';
import { itemRegistry } from '../src/items/ItemRegistry';
import { ItemDropSystem } from '../src/items/ItemDrops';
import { blockRegistry } from '../src/world/BlockRegistry';
import { BlockId } from '../src/world/blocks';
import { ChunkStore } from '../src/world/ChunkStore';
import { FaceDirection } from '../src/world/mesher/faces';
import type { VoxelRaycastBlockHit } from '../src/world/voxelRaycast';
import { createPlayerState } from '../src/player/PlayerState';
import { playerAabb } from '../src/player/voxelCollision';
import { ITEM_DROP_CONFIG } from '../src/config/constants';

/** Fixed non-random sequence for deterministic jitter in tests. */
function fixedRandom(value = 0.5): () => number {
  return () => value;
}

function hotbarInput(overrides: Partial<HotbarInput> = {}): HotbarInput {
  return { select: null, scroll: 0, ...overrides };
}

function hitAt(
  x: number,
  y: number,
  z: number,
  blockId: number,
  overrides: Partial<VoxelRaycastBlockHit> = {},
): VoxelRaycastBlockHit {
  return {
    x,
    y,
    z,
    distance: 1,
    face: FaceDirection.NegY,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    hasPlacePosition: true,
    placeX: x,
    placeY: y + 1,
    placeZ: z,
    blockId,
    ...overrides,
  };
}

function farPlayerBox() {
  return playerAabb(createPlayerState({ x: 50, y: 50, z: 50 }));
}

describe('applyHotbarInput', () => {
  it('applies select', () => {
    const inv = new Inventory();
    applyHotbarInput(inv, hotbarInput({ select: 4 }));
    expect(inv.selectedHotbarIndex).toBe(4);
  });

  it('applies scroll', () => {
    const inv = new Inventory();
    applyHotbarInput(inv, hotbarInput({ scroll: 2 }));
    expect(inv.selectedHotbarIndex).toBe(2);
  });

  it('wraps scroll forward past the last slot', () => {
    const inv = new Inventory();
    inv.selectHotbar(8);
    applyHotbarInput(inv, hotbarInput({ scroll: 1 }));
    expect(inv.selectedHotbarIndex).toBe(0);
  });

  it('wraps scroll backward past the first slot', () => {
    const inv = new Inventory();
    applyHotbarInput(inv, hotbarInput({ scroll: -1 }));
    expect(inv.selectedHotbarIndex).toBe(8);
  });

  it('applies select then scroll in the same call', () => {
    const inv = new Inventory();
    applyHotbarInput(inv, hotbarInput({ select: 0, scroll: 3 }));
    expect(inv.selectedHotbarIndex).toBe(3);
  });

  it('no-op when select is null and scroll is 0', () => {
    const inv = new Inventory();
    inv.selectHotbar(5);
    applyHotbarInput(inv, hotbarInput());
    expect(inv.selectedHotbarIndex).toBe(5);
  });
});

describe('placeSelectedItem', () => {
  it('places the correct block and consumes exactly one item', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone); // place at (1,2,1)

    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Planks, 5));

    const change = placeSelectedItem(store, blockRegistry, itemRegistry, inv, hit, farPlayerBox());

    expect(change).not.toBeNull();
    expect(store.getBlock(1, 2, 1)).toBe(BlockId.Planks);
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Planks, count: 4 });
  });

  it('last item consumed empties the slot', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone);

    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Planks, 1));

    const change = placeSelectedItem(store, blockRegistry, itemRegistry, inv, hit, farPlayerBox());

    expect(change).not.toBeNull();
    expect(inv.getSlot(0)).toBeNull();
  });

  it('empty selected slot returns null and inventory is unchanged', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone);

    const inv = new Inventory();
    const change = placeSelectedItem(store, blockRegistry, itemRegistry, inv, hit, farPlayerBox());

    expect(change).toBeNull();
    expect(inv.getSlot(0)).toBeNull();
  });

  it('non-block item (Stick) returns null and inventory is unchanged', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone);

    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stick, 3));

    const change = placeSelectedItem(store, blockRegistry, itemRegistry, inv, hit, farPlayerBox());

    expect(change).toBeNull();
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stick, count: 3 });
  });

  it('placement failure (occupied cell) leaves inventory unchanged', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    store.setBlock(1, 2, 1, BlockId.Dirt); // target already occupied
    const hit = hitAt(1, 1, 1, BlockId.Stone);

    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Planks, 5));

    const change = placeSelectedItem(store, blockRegistry, itemRegistry, inv, hit, farPlayerBox());

    expect(change).toBeNull();
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Planks, count: 5 });
  });

  it('placement failure (overlapping player) leaves inventory unchanged', () => {
    const store = new ChunkStore();
    const state = createPlayerState({ x: 0.5, y: 0, z: 0.5 });
    const playerBox = playerAabb(state);

    store.setBlock(0, -1, 0, BlockId.Stone);
    const hit = hitAt(0, -1, 0, BlockId.Stone, {
      face: FaceDirection.PosY,
      normalY: 1,
      placeX: 0,
      placeY: 0, // overlaps the player's feet cell
      placeZ: 0,
    });

    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Planks, 5));

    const change = placeSelectedItem(store, blockRegistry, itemRegistry, inv, hit, playerBox);

    expect(change).toBeNull();
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Planks, count: 5 });
  });
});

describe('breakAndDrop', () => {
  it('stone with a wooden pickaxe -> spawns a cobblestone drop at the block centre (jittered)', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone);

    const drops = new ItemDropSystem();
    const tool = itemRegistry.toolFor(ItemId.WoodenPickaxe);
    const change = breakAndDrop(store, blockRegistry, itemRegistry, drops, hit, fixedRandom(1), tool);

    expect(change).not.toBeNull();
    expect(store.getBlock(1, 1, 1)).toBe(BlockId.Air);

    const spawned = drops.drops();
    expect(spawned).toHaveLength(1);
    const drop = spawned[0]!;
    expect(drop.stack).toEqual({ itemId: ItemId.Cobblestone, count: 1 });

    const jitter = ITEM_DROP_CONFIG.spawnJitter;
    expect(drop.position.x).toBeCloseTo(1.5 + jitter, 6);
    expect(drop.position.y).toBeCloseTo(1.5 + jitter, 6);
    expect(drop.position.z).toBeCloseTo(1.5 + jitter, 6);
  });

  it('stone with no tool -> block breaks but no drop spawns (requiresTool)', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone);

    const drops = new ItemDropSystem();
    const change = breakAndDrop(store, blockRegistry, itemRegistry, drops, hit, fixedRandom());

    expect(change).not.toBeNull();
    expect(store.getBlock(1, 1, 1)).toBe(BlockId.Air);
    expect(drops.drops()).toHaveLength(0);
  });

  it('dirt by hand -> spawns a dirt drop (no tool required)', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Dirt);
    const hit = hitAt(1, 1, 1, BlockId.Dirt);

    const drops = new ItemDropSystem();
    const change = breakAndDrop(store, blockRegistry, itemRegistry, drops, hit, fixedRandom());

    expect(change).not.toBeNull();
    const spawned = drops.drops();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.stack).toEqual({ itemId: ItemId.Dirt, count: 1 });
  });

  it('leaves -> breaks the block but spawns no drop', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Leaves);
    const hit = hitAt(1, 1, 1, BlockId.Leaves);

    const drops = new ItemDropSystem();
    const change = breakAndDrop(store, blockRegistry, itemRegistry, drops, hit, fixedRandom());

    expect(change).not.toBeNull();
    expect(store.getBlock(1, 1, 1)).toBe(BlockId.Air);
    expect(drops.drops()).toHaveLength(0);
  });

  it('non-targetable/no hit returns null and spawns nothing', () => {
    const store = new ChunkStore();
    const drops = new ItemDropSystem();

    const change = breakAndDrop(store, blockRegistry, itemRegistry, drops, null, fixedRandom());

    expect(change).toBeNull();
    expect(drops.drops()).toHaveLength(0);
  });

  it('breaking Water (non-targetable) returns null and spawns nothing', () => {
    const store = new ChunkStore();
    store.setBlock(4, 4, 4, BlockId.Water);
    const hit = hitAt(4, 4, 4, BlockId.Water);
    const drops = new ItemDropSystem();

    const change = breakAndDrop(store, blockRegistry, itemRegistry, drops, hit, fixedRandom());

    expect(change).toBeNull();
    expect(drops.drops()).toHaveLength(0);
  });
});

describe('throwSelectedItem', () => {
  it('consumes one item and spawns it with the throw pickup delay', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 5));
    const drops = new ItemDropSystem();

    throwSelectedItem(inv, drops, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -1 });

    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 4 });
    const spawned = drops.drops();
    expect(spawned).toHaveLength(1);
    const drop = spawned[0]!;
    expect(drop.stack).toEqual({ itemId: ItemId.Stone, count: 1 });
    expect(drop.pickupDelay).toBe(ITEM_DROP_CONFIG.throwPickupDelay);
    expect(drop.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(drop.velocity.z).toBeCloseTo(-ITEM_DROP_CONFIG.throwSpeed, 6);
    expect(drop.velocity.y).toBeCloseTo(ITEM_DROP_CONFIG.throwUpSpeed, 6);
  });

  it('empty selected slot is a no-op', () => {
    const inv = new Inventory();
    const drops = new ItemDropSystem();

    throwSelectedItem(inv, drops, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });

    expect(drops.drops()).toHaveLength(0);
  });

  it('a damaged tool survives throw -> drop -> pickup intact', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1, itemRegistry, 22));
    const drops = new ItemDropSystem();

    throwSelectedItem(inv, drops, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -1 });

    const spawned = drops.drops();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.stack).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 22 });

    // Pickup delay elapsed; a fresh inventory (the "picker-upper") collects it.
    const pickerInventory = new Inventory();
    const playerBox = {
      minX: 0,
      maxX: 2,
      minY: 1,
      maxY: 3,
      minZ: 2,
      maxZ: 4,
    };
    // Force the drop collectible immediately for this test.
    spawned[0]!.pickupDelay = 0;
    const collected = drops.collect(playerBox, pickerInventory);

    expect(collected).toBe(1);
    expect(pickerInventory.getSlot(0)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 22 });
  });
});

describe('applyToolWear', () => {
  it('no-op (hardness 0 block) even when holding a tool', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1));
    const torch = blockRegistry.get(BlockId.Torch);
    expect(torch.hardness).toBe(0);
    const tool = itemRegistry.toolFor(ItemId.WoodenPickaxe);

    const result = applyToolWear(inv, torch, tool, itemRegistry);

    expect(result).toBe('none');
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1 });
  });

  it('wears the tool by 1 when breaking a hardness > 0 block', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.WoodenPickaxe, 1));
    const stone = blockRegistry.get(BlockId.Stone);
    expect(stone.hardness).toBeGreaterThan(0);
    const tool = itemRegistry.toolFor(ItemId.WoodenPickaxe);

    const result = applyToolWear(inv, stone, tool, itemRegistry);

    expect(result).toBe('damaged');
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.WoodenPickaxe, count: 1, damage: 1 });
  });

  it('no-op when no tool is held (bare hand), even for a hardness > 0 block', () => {
    const inv = new Inventory();
    inv.set(0, createStack(ItemId.Stone, 5));
    const stone = blockRegistry.get(BlockId.Stone);

    const result = applyToolWear(inv, stone, undefined, itemRegistry);

    expect(result).toBe('none');
    expect(inv.getSlot(0)).toEqual({ itemId: ItemId.Stone, count: 5 });
  });
});

describe('giveStartingItems', () => {
  it('is deterministic and matches STARTING_ITEMS', () => {
    const inv = new Inventory();
    giveStartingItems(inv);

    for (const { itemId, count } of STARTING_ITEMS) {
      expect(inv.countItem(itemId)).toBe(count);
    }
  });

  it('gives the same result across independent inventories', () => {
    const invA = new Inventory();
    const invB = new Inventory();
    giveStartingItems(invA);
    giveStartingItems(invB);

    expect(invA.slots()).toEqual(invB.slots());
  });
});
