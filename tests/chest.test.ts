import { describe, it, expect } from 'vitest';
import { ChestStore, chestKey } from '../src/items/ChestStore';
import { ContainerSession, type SlotRef } from '../src/items/ContainerSession';
import { Inventory } from '../src/items/Inventory';
import { CraftingGrid } from '../src/crafting/CraftingGrid';
import { createStack } from '../src/items/ItemStack';
import { ItemId } from '../src/items/items';
import { ItemDropSystem } from '../src/items/ItemDrops';
import { LOOT_TABLES, lootRng, rollLoot } from '../src/items/lootTables';
import { openChestContainer, spillChest, type ChestContext } from '../src/gameplay/chestActions';
import { breakAndDrop } from '../src/gameplay/hotbarActions';
import { blockRegistry } from '../src/world/BlockRegistry';
import { itemRegistry } from '../src/items/ItemRegistry';
import { BlockId } from '../src/world/blocks';
import { ChunkStore } from '../src/world/ChunkStore';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { StructurePlacer, type PlacedStructure } from '../src/world/structure/StructurePlacer';
import { structureBlockWorldPosition, stampStructure } from '../src/world/structure/stampStructure';
import { RUIN_TEMPLATE } from '../src/world/structure/templates';
import { ROTATIONS } from '../src/world/structure/rotation';
import { CHUNK_VOLUME, localIndex, worldToChunkCoord, worldToLocal } from '../src/world/chunkCoords';
import { CHEST_CONFIG, STRUCTURE_CONFIG, WORLD_CONFIG, WORLD_GEN_CONFIG } from '../src/config/constants';
import { blockUseAction } from '../src/gameplay/blockUse';
import { FaceDirection } from '../src/world/mesher/faces';
import type { VoxelRaycastBlockHit } from '../src/world/voxelRaycast';

const SEED = WORLD_GEN_CONFIG.defaultSeed;
const REGION_BLOCKS = STRUCTURE_CONFIG.regionSizeChunks * WORLD_CONFIG.chunkWidth;

function context(lootTableAt: ChestContext['lootTableAt'] = () => null): ChestContext {
  return { chests: new ChestStore(), worldSeed: SEED, lootTableAt };
}

function totalItems(inv: Inventory): number {
  let total = 0;
  for (const stack of inv.slots()) {
    total += stack?.count ?? 0;
  }
  return total;
}

describe('ChestStore', () => {
  it('creates 27-slot containers keyed per position', () => {
    const store = new ChestStore();
    const a = store.getOrCreate(1, 40, 2);
    expect(a.size).toBe(CHEST_CONFIG.slots);
    expect(store.getOrCreate(1, 40, 2)).toBe(a);
    expect(store.getOrCreate(2, 40, 1)).not.toBe(a);
    expect(store.size).toBe(2);
  });

  it('packs distinct positions (incl. negatives and bounds) into distinct keys', () => {
    const keys = new Set<number>();
    const edge = CHEST_CONFIG.maxHorizontalCoord - 1;
    for (const x of [-5, 0, 5, -edge, edge]) {
      for (const z of [-3, 0, 3]) {
        for (const y of [0, 1, 127]) {
          keys.add(chestKey(x, y, z));
        }
      }
    }
    expect(keys.size).toBe(5 * 3 * 3);
    expect(() => chestKey(CHEST_CONFIG.maxHorizontalCoord, 0, 0)).toThrow(RangeError);
    expect(() => chestKey(0, 128, 0)).toThrow(RangeError);
    expect(() => chestKey(0.5, 1, 0)).toThrow(RangeError);
  });

  it('stacks, removes and takes via the shared Inventory rules', () => {
    const store = new ChestStore();
    const chest = store.getOrCreate(0, 10, 0);
    chest.add(createStack(ItemId.Coal, 40));
    chest.add(createStack(ItemId.Coal, 40));
    expect(chest.getSlot(0)).toEqual({ itemId: ItemId.Coal, count: 64 });
    expect(chest.getSlot(1)).toEqual({ itemId: ItemId.Coal, count: 16 });
    expect(chest.take(0, 10)).toEqual({ itemId: ItemId.Coal, count: 10 });
    expect(chest.countItem(ItemId.Coal)).toBe(70);
  });

  it('keeps contents when the chunk under it is unloaded', () => {
    const chunks = new ChunkStore();
    chunks.setBlock(3, 10, 3, BlockId.Chest);
    const store = new ChestStore();
    store.getOrCreate(3, 10, 3).add(createStack(ItemId.Apple, 3));
    const { cx, cz } = worldToChunkCoord(3, 3);
    chunks.removeChunk(cx, cz);
    expect(store.get(3, 10, 3)?.countItem(ItemId.Apple)).toBe(3);
  });
});

describe('chest slot moves (ContainerSession)', () => {
  function chestSession(): { session: ContainerSession; inventory: Inventory; chest: Inventory } {
    const inventory = new Inventory();
    const chest = new ChestStore().getOrCreate(0, 5, 0);
    const session = new ContainerSession(inventory, new CraftingGrid(2, 2), undefined, undefined, chest);
    return { session, inventory, chest };
  }
  const chestRef = (index: number): SlotRef => ({ area: 'chest', index });
  const invRef = (index: number): SlotRef => ({ area: 'inventory', index });

  it('moves a stack from the chest into the inventory and back', () => {
    const { session, inventory, chest } = chestSession();
    chest.set(0, createStack(ItemId.Coal, 8));
    session.click(chestRef(0), 'primary');
    session.click(invRef(9), 'primary');
    expect(chest.getSlot(0)).toBeNull();
    expect(inventory.getSlot(9)).toEqual({ itemId: ItemId.Coal, count: 8 });
    session.click(invRef(9), 'primary');
    session.click(chestRef(26), 'primary');
    expect(chest.getSlot(26)).toEqual({ itemId: ItemId.Coal, count: 8 });
  });

  it('splits half with secondary click and reads chest slots through getSlot', () => {
    const { session, chest } = chestSession();
    chest.set(3, createStack(ItemId.Apple, 5));
    session.click(chestRef(3), 'secondary');
    expect(session.getCursor()).toEqual({ itemId: ItemId.Apple, count: 3 });
    expect(session.getSlot(chestRef(3))).toEqual({ itemId: ItemId.Apple, count: 2 });
  });

  it('close() returns the cursor to the player inventory', () => {
    const { session, inventory, chest } = chestSession();
    chest.set(0, createStack(ItemId.Apple, 2));
    session.click(chestRef(0), 'primary');
    session.close(() => {
      throw new Error('nothing should be dropped');
    });
    expect(inventory.countItem(ItemId.Apple)).toBe(2);
  });
});

describe('loot tables', () => {
  const table = LOOT_TABLES['ruin_chest'];
  if (table === undefined) throw new Error('ruin_chest missing');

  it('uses only registered items with counts inside stack limits', () => {
    for (const entry of table.entries) {
      expect(itemRegistry.has(entry.itemId)).toBe(true);
      expect(entry.min).toBeGreaterThanOrEqual(1);
      expect(entry.max).toBeGreaterThanOrEqual(entry.min);
      expect(entry.max).toBeLessThanOrEqual(itemRegistry.maxStackSize(entry.itemId));
      expect(entry.weight).toBeGreaterThan(0);
    }
  });

  it('is deterministic per seed + position and differs across positions', () => {
    const a = rollLoot(table, lootRng(SEED, 10, 40, 20));
    const b = rollLoot(table, lootRng(SEED, 10, 40, 20));
    expect(a).toEqual(b);
    const others = [
      rollLoot(table, lootRng(SEED, 11, 40, 20)),
      rollLoot(table, lootRng(SEED, 10, 41, 20)),
      rollLoot(table, lootRng(SEED, 10, 40, 21)),
      rollLoot(table, lootRng(SEED + 1, 10, 40, 20)),
    ];
    expect(others.some((o) => JSON.stringify(o) !== JSON.stringify(a))).toBe(true);
  });

  it('keeps roll count and item counts within bounds, and respects weights', () => {
    const tally = new Map<ItemId, number>();
    let picks = 0;
    for (let i = 0; i < 4000; i += 1) {
      const stacks = rollLoot(table, lootRng(SEED, i, 40, -i));
      expect(stacks.length).toBeGreaterThanOrEqual(table.rolls.min);
      expect(stacks.length).toBeLessThanOrEqual(table.rolls.max);
      for (const stack of stacks) {
        const entry = table.entries.find((e) => e.itemId === stack.itemId);
        expect(entry).toBeDefined();
        expect(stack.count).toBeGreaterThanOrEqual(entry?.min ?? 1);
        expect(stack.count).toBeLessThanOrEqual(entry?.max ?? 0);
        tally.set(stack.itemId, (tally.get(stack.itemId) ?? 0) + 1);
        picks += 1;
      }
    }
    const totalWeight = table.entries.reduce((sum, e) => sum + e.weight, 0);
    for (const entry of table.entries) {
      const observed = (tally.get(entry.itemId) ?? 0) / picks;
      expect(Math.abs(observed - entry.weight / totalWeight)).toBeLessThan(0.03);
    }
  });
});

describe('structure chest detection', () => {
  const generator = new WorldGenerator(SEED);
  const placer = new StructurePlacer(SEED, generator);
  const ruins: PlacedStructure[] = placer
    .structuresIntersecting(-6 * REGION_BLOCKS, -6 * REGION_BLOCKS, 6 * REGION_BLOCKS - 1, 6 * REGION_BLOCKS - 1)
    .filter((s) => s.template === RUIN_TEMPLATE);
  const ruin = ruins[0];
  if (ruin === undefined) throw new Error('no ruin found');
  const chestBlock = RUIN_TEMPLATE.blocks.find((b) => b.lootTable !== undefined);
  if (chestBlock === undefined) throw new Error('ruin has no loot chest');
  const pos = structureBlockWorldPosition(ruin, chestBlock);

  it('answers the ruin chest position from a pure query', () => {
    expect(generator.structureLootTableAt(pos.x, pos.y, pos.z)).toBe('ruin_chest');
    expect(generator.structureLootTableAt(pos.x + 1, pos.y, pos.z)).toBeNull();
    expect(generator.structureLootTableAt(pos.x, pos.y + 1, pos.z)).toBeNull();
    expect(generator.structureLootTableAt(pos.x + 500, pos.y, pos.z)).toBeNull();
  });

  it('the generated ruin has a chest block exactly there', () => {
    const { cx, cz } = worldToChunkCoord(pos.x, pos.z);
    const chunk = generator.generateChunk(cx, cz);
    const local = worldToLocal(pos.x, pos.y, pos.z);
    expect(chunk.getBlock(local.x, local.y, local.z)).toBe(BlockId.Chest);
  });

  it('stamps exactly one chest at the rotated position for all 4 rotations', () => {
    for (const rotation of ROTATIONS) {
      const structure: PlacedStructure = {
        ...ruin,
        rotation,
        originX: 8,
        originZ: 8,
        originY: 40,
        minX: 0,
        maxX: 16,
        minZ: 0,
        maxZ: 16,
      };
      const blocks = new Uint8Array(CHUNK_VOLUME);
      stampStructure(structure, 0, 0, blocks);
      const expected = structureBlockWorldPosition(structure, chestBlock);
      expect(blocks[localIndex(expected.x, expected.y, expected.z)]).toBe(BlockId.Chest);
      expect(blocks.filter((b) => b === BlockId.Chest).length).toBe(1);
    }
  });

  it('opening the ruin chest fills loot once; emptied chests never refill', () => {
    const ctx = context((x, y, z) => generator.structureLootTableAt(x, y, z));
    const container = openChestContainer(ctx, pos.x, pos.y, pos.z);
    expect(totalItems(container)).toBeGreaterThan(0);
    const before = container.slots();
    expect(openChestContainer(ctx, pos.x, pos.y, pos.z).slots()).toEqual(before);
    for (let slot = 0; slot < container.size; slot += 1) container.take(slot);
    expect(totalItems(openChestContainer(ctx, pos.x, pos.y, pos.z))).toBe(0);
  });

  it('a player-placed chest gets no loot', () => {
    const ctx = context((x, y, z) => generator.structureLootTableAt(x, y, z));
    const container = openChestContainer(ctx, pos.x + 1, pos.y, pos.z);
    expect(totalItems(container)).toBe(0);
  });
});

describe('breaking chests', () => {
  function hit(x: number, y: number, z: number): VoxelRaycastBlockHit {
    return {
      x,
      y,
      z,
      blockId: BlockId.Chest,
      face: FaceDirection.PosY,
      distance: 1,
      placeX: x,
      placeY: y + 1,
      placeZ: z,
    } as unknown as VoxelRaycastBlockHit;
  }

  it('spills every stack as drops and removes the container', () => {
    const ctx = context();
    const chest = ctx.chests.getOrCreate(4, 20, 4);
    chest.set(0, createStack(ItemId.Coal, 10));
    chest.set(13, createStack(ItemId.Apple, 2));
    const drops = new ItemDropSystem();
    spillChest(ctx, drops, () => 0.5, 4, 20, 4);
    expect(ctx.chests.has(4, 20, 4)).toBe(false);
    const dropped = drops
      .drops()
      .map((d) => `${d.stack.itemId}x${d.stack.count}`)
      .sort();
    expect(dropped).toEqual([`${ItemId.Apple}x2`, `${ItemId.Coal}x10`].sort());
  });

  it('breakAndDrop spills loot plus the chest item and never refills a regenerated structure chest', () => {
    const store = new ChunkStore();
    store.setBlock(4, 20, 4, BlockId.Chest);
    const ctx = context(() => 'ruin_chest');
    const drops = new ItemDropSystem();
    const change = breakAndDrop(store, blockRegistry, itemRegistry, drops, hit(4, 20, 4), () => 0.5, undefined, ctx);
    expect(change).not.toBeNull();
    expect(ctx.chests.has(4, 20, 4)).toBe(false);
    const ids = drops.drops().map((d) => d.stack.itemId);
    expect(ids).toContain(ItemId.Chest);
    expect(ids.length).toBeGreaterThan(1);
    expect(totalItems(openChestContainer(ctx, 4, 20, 4))).toBe(0);
  });

  it('breaking a chest without a chest context still works', () => {
    const store = new ChunkStore();
    store.setBlock(1, 20, 1, BlockId.Chest);
    const drops = new ItemDropSystem();
    expect(breakAndDrop(store, blockRegistry, itemRegistry, drops, hit(1, 20, 1), () => 0.5)).not.toBeNull();
  });
});

describe('blockUseAction for chests', () => {
  it('returns chest', () => {
    expect(blockUseAction(BlockId.Chest)).toBe('chest');
  });
});
