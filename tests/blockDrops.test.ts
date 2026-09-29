import { describe, it, expect } from 'vitest';
import { dropForBlock } from '../src/items/blockDrops';
import { itemRegistry } from '../src/items/ItemRegistry';
import { blockRegistry } from '../src/world/BlockRegistry';
import { BlockId } from '../src/world/blocks';
import { ItemId } from '../src/items/items';
import { SURVIVAL_CONFIG } from '../src/config/constants';

describe('dropForBlock', () => {
  it('default: block drops its own item x1 (Dirt -> Dirt)', () => {
    expect(dropForBlock(BlockId.Dirt, itemRegistry)).toEqual({ itemId: ItemId.Dirt, count: 1 });
  });

  it('default: Planks -> Planks', () => {
    expect(dropForBlock(BlockId.Planks, itemRegistry)).toEqual({ itemId: ItemId.Planks, count: 1 });
  });

  it('override: Stone -> Cobblestone', () => {
    expect(dropForBlock(BlockId.Stone, itemRegistry)).toEqual({ itemId: ItemId.Cobblestone, count: 1 });
  });

  it('override: Grass -> Dirt', () => {
    expect(dropForBlock(BlockId.Grass, itemRegistry)).toEqual({ itemId: ItemId.Dirt, count: 1 });
  });

  it('override: CoalOre -> Coal', () => {
    expect(dropForBlock(BlockId.CoalOre, itemRegistry)).toEqual({ itemId: ItemId.Coal, count: 1 });
  });

  it('Leaves: below the apple drop chance yields an Apple', () => {
    const belowChance = (): number => SURVIVAL_CONFIG.appleDropChance / 2;
    expect(dropForBlock(BlockId.Leaves, itemRegistry, belowChance)).toEqual({
      itemId: ItemId.Apple,
      count: 1,
    });
  });

  it('Leaves: at/above the apple drop chance yields nothing', () => {
    const atChance = (): number => SURVIVAL_CONFIG.appleDropChance;
    expect(dropForBlock(BlockId.Leaves, itemRegistry, atChance)).toBeNull();

    const aboveChance = (): number => 0.99;
    expect(dropForBlock(BlockId.Leaves, itemRegistry, aboveChance)).toBeNull();
  });

  it('Leaves: defaults to Math.random when no random fn is passed (never throws)', () => {
    expect(() => dropForBlock(BlockId.Leaves, itemRegistry)).not.toThrow();
  });

  it('override: Glass -> none', () => {
    expect(dropForBlock(BlockId.Glass, itemRegistry)).toBeNull();
  });

  it('Water -> none', () => {
    expect(dropForBlock(BlockId.Water, itemRegistry)).toBeNull();
  });

  it('Air -> none', () => {
    expect(dropForBlock(BlockId.Air, itemRegistry)).toBeNull();
  });

  it('every targetable, non-Air/Water block resolves to either a valid stack or null without throwing', () => {
    for (let id = 0; id < blockRegistry.size; id += 1) {
      if (id === BlockId.Air || id === BlockId.Water) {
        continue;
      }
      if (!blockRegistry.isTargetable(id)) {
        continue;
      }
      let result: ReturnType<typeof dropForBlock>;
      expect(() => {
        result = dropForBlock(id, itemRegistry);
      }).not.toThrow();
      if (result! !== null) {
        expect(itemRegistry.has(result!.itemId)).toBe(true);
        expect(result!.count).toBeGreaterThan(0);
      }
    }
  });
});
