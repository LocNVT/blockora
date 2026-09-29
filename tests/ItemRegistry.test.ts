import { describe, it, expect } from 'vitest';
import { ItemRegistry, itemRegistry } from '../src/items/ItemRegistry';
import { blockRegistry } from '../src/world/BlockRegistry';
import { ITEM_DEFINITIONS, ItemId, type ItemDefinition } from '../src/items/items';
import { BlockId } from '../src/world/blocks';
import { INVENTORY_CONFIG, SURVIVAL_CONFIG, TOOL_CONFIG } from '../src/config/constants';

describe('default itemRegistry instance', () => {
  it('has an entry for every ItemId except None', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    for (const id of Object.values(ItemId)) {
      if (id === 0) {
        // None is reserved, should not be in registry
        expect(registry.has(id)).toBe(false);
      } else {
        expect(registry.has(id)).toBe(true);
        expect(registry.get(id).id).toBe(id);
      }
    }
  });

  it('ids are dense from 1 and sorted', () => {
    for (let i = 0; i < ITEM_DEFINITIONS.length; i++) {
      const def = ITEM_DEFINITIONS[i];
      expect(def).toBeDefined();
      expect(def!.id).toBe(i + 1);
    }
  });

  it('has returns false for None (0)', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    expect(registry.has(0)).toBe(false);
  });

  it('get throws for None (0)', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    expect(() => registry.get(0)).toThrow();
  });

  it('size matches the number of definitions', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    expect(registry.size).toBe(ITEM_DEFINITIONS.length);
  });

  it('get throws for an unknown id', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    expect(() => registry.get(9999)).toThrow();
  });

  it('has returns false for an unknown id', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    expect(registry.has(9999)).toBe(false);
    expect(registry.has(-1)).toBe(false);
  });

  it('getByName resolves known names and returns undefined for unknown ones', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    expect(registry.getByName('stone')?.id).toBe(ItemId.Stone);
    expect(registry.getByName('stick')?.id).toBe(ItemId.Stick);
    expect(registry.getByName('coal')?.id).toBe(ItemId.Coal);
    expect(registry.getByName('does_not_exist')).toBeUndefined();
  });

  it('names are unique', () => {
    const names = ITEM_DEFINITIONS.map((d) => d.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('every placesBlock item places a registered non-Air block', () => {
    for (const def of ITEM_DEFINITIONS) {
      if (def.placesBlock !== undefined) {
        expect(blockRegistry.has(def.placesBlock)).toBe(true);
        expect(def.placesBlock).not.toBe(BlockId.Air);
      }
    }
  });

  it('itemForBlock returns the correct item for block items', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    expect(registry.itemForBlock(BlockId.Stone)).toBe(ItemId.Stone);
    expect(registry.itemForBlock(BlockId.Grass)).toBe(ItemId.Grass);
    expect(registry.itemForBlock(BlockId.Dirt)).toBe(ItemId.Dirt);
    expect(registry.itemForBlock(BlockId.CraftingTable)).toBe(ItemId.CraftingTable);
    expect(registry.itemForBlock(BlockId.Chest)).toBe(ItemId.Chest);
  });

  it('blockForItem round-trips with itemForBlock for all block items', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    for (const def of ITEM_DEFINITIONS) {
      if (def.placesBlock !== undefined) {
        expect(registry.blockForItem(def.id)).toBe(def.placesBlock);
        expect(registry.itemForBlock(def.placesBlock)).toBe(def.id);
      }
    }
  });

  it('itemForBlock returns undefined for Air and Water (non-block items)', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    expect(registry.itemForBlock(BlockId.Air)).toBeUndefined();
    expect(registry.itemForBlock(BlockId.Water)).toBeUndefined();
  });

  it('blockForItem returns undefined for non-block items (Stick, Coal)', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    expect(registry.blockForItem(ItemId.Stick)).toBeUndefined();
    expect(registry.blockForItem(ItemId.Coal)).toBeUndefined();
  });

  it('maxStackSize returns INVENTORY_CONFIG.maxStackSize for all non-tool items, and 1 for tools', () => {
    const registry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    for (const def of ITEM_DEFINITIONS) {
      const expected = def.tool !== undefined ? 1 : INVENTORY_CONFIG.maxStackSize;
      expect(registry.maxStackSize(def.id)).toBe(expected);
    }
  });
});

describe('tool items', () => {
  const toolIds = [
    ItemId.WoodenPickaxe,
    ItemId.WoodenAxe,
    ItemId.WoodenShovel,
    ItemId.StonePickaxe,
    ItemId.StoneAxe,
    ItemId.StoneShovel,
  ];

  it('every tool item exists and stacks to 1', () => {
    for (const id of toolIds) {
      expect(itemRegistry.has(id)).toBe(true);
      expect(itemRegistry.maxStackSize(id)).toBe(1);
    }
  });

  it('toolFor returns the right type/tier/speed/maxDurability for each tool, and undefined for non-tools', () => {
    const wood = TOOL_CONFIG.durability.wood;
    const stone = TOOL_CONFIG.durability.stone;
    expect(itemRegistry.toolFor(ItemId.WoodenPickaxe)).toEqual({ type: 'pickaxe', tier: 1, speed: 2, maxDurability: wood });
    expect(itemRegistry.toolFor(ItemId.WoodenAxe)).toEqual({ type: 'axe', tier: 1, speed: 2, maxDurability: wood });
    expect(itemRegistry.toolFor(ItemId.WoodenShovel)).toEqual({ type: 'shovel', tier: 1, speed: 2, maxDurability: wood });
    expect(itemRegistry.toolFor(ItemId.StonePickaxe)).toEqual({ type: 'pickaxe', tier: 2, speed: 4, maxDurability: stone });
    expect(itemRegistry.toolFor(ItemId.StoneAxe)).toEqual({ type: 'axe', tier: 2, speed: 4, maxDurability: stone });
    expect(itemRegistry.toolFor(ItemId.StoneShovel)).toEqual({ type: 'shovel', tier: 2, speed: 4, maxDurability: stone });

    expect(itemRegistry.toolFor(ItemId.Stone)).toBeUndefined();
    expect(itemRegistry.toolFor(ItemId.Stick)).toBeUndefined();
  });

  it('stone tier is strictly higher than wood', () => {
    const wood = itemRegistry.toolFor(ItemId.WoodenPickaxe)!;
    const stone = itemRegistry.toolFor(ItemId.StonePickaxe)!;
    expect(stone.tier).toBeGreaterThan(wood.tier);
    expect(stone.speed).toBeGreaterThan(wood.speed);
  });

  it('throws when a tool item has maxStackSize > 1', () => {
    const defs = [makeToolDef({ id: 1, name: 'bad-tool', maxStackSize: 64 })];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow(/maxStackSize 1/);
  });

  it('throws when a tool item has speed <= 0', () => {
    const defs = [
      makeToolDef({ id: 1, name: 'bad-tool', tool: { type: 'pickaxe', tier: 1, speed: 0, maxDurability: 64 } }),
    ];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow(/speed/);
  });

  it('throws when a tool item has tier < 1', () => {
    const defs = [
      makeToolDef({ id: 1, name: 'bad-tool', tool: { type: 'pickaxe', tier: 0, speed: 2, maxDurability: 64 } }),
    ];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow(/tier/);
  });

  it('maxDurability returns the configured value for each tool tier', () => {
    expect(itemRegistry.maxDurability(ItemId.WoodenPickaxe)).toBe(TOOL_CONFIG.durability.wood);
    expect(itemRegistry.maxDurability(ItemId.WoodenAxe)).toBe(TOOL_CONFIG.durability.wood);
    expect(itemRegistry.maxDurability(ItemId.WoodenShovel)).toBe(TOOL_CONFIG.durability.wood);
    expect(itemRegistry.maxDurability(ItemId.StonePickaxe)).toBe(TOOL_CONFIG.durability.stone);
    expect(itemRegistry.maxDurability(ItemId.StoneAxe)).toBe(TOOL_CONFIG.durability.stone);
    expect(itemRegistry.maxDurability(ItemId.StoneShovel)).toBe(TOOL_CONFIG.durability.stone);
  });

  it('maxDurability returns undefined for non-tool items', () => {
    expect(itemRegistry.maxDurability(ItemId.Stone)).toBeUndefined();
    expect(itemRegistry.maxDurability(ItemId.Stick)).toBeUndefined();
  });

  it('throws when a tool item has maxDurability < 1', () => {
    const defs = [
      makeToolDef({ id: 1, name: 'bad-tool', tool: { type: 'pickaxe', tier: 1, speed: 2, maxDurability: 0 } }),
    ];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow(/maxDurability/);
  });

  it('throws when a tool item has a non-integer maxDurability', () => {
    const defs = [
      makeToolDef({ id: 1, name: 'bad-tool', tool: { type: 'pickaxe', tier: 1, speed: 2, maxDurability: 1.5 } }),
    ];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow(/maxDurability/);
  });
});

describe('food items', () => {
  it('Apple exists, is edible, and foodFor returns its hunger points', () => {
    expect(itemRegistry.has(ItemId.Apple)).toBe(true);
    expect(itemRegistry.foodFor(ItemId.Apple)).toEqual({ hunger: 4 });
  });

  it('foodFor returns undefined for non-food items', () => {
    expect(itemRegistry.foodFor(ItemId.Stone)).toBeUndefined();
    expect(itemRegistry.foodFor(ItemId.Stick)).toBeUndefined();
  });

  it('throws when a food item has hunger < 1', () => {
    const defs = [makeDef({ id: 1, name: 'bad-food', food: { hunger: 0 } })];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow(/hunger/);
  });

  it('throws when a food item has hunger > maxHunger', () => {
    const defs = [makeDef({ id: 1, name: 'bad-food', food: { hunger: SURVIVAL_CONFIG.maxHunger + 1 } })];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow(/hunger/);
  });

  it('throws when a food item has a non-integer hunger', () => {
    const defs = [makeDef({ id: 1, name: 'bad-food', food: { hunger: 1.5 } })];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow(/hunger/);
  });

  it('accepts a food item with hunger exactly at maxHunger', () => {
    const defs = [makeDef({ id: 1, name: 'ok-food', food: { hunger: SURVIVAL_CONFIG.maxHunger } })];
    expect(() => new ItemRegistry(defs, blockRegistry)).not.toThrow();
  });
});

describe('determinism', () => {
  it('building the registry twice from the same definitions yields identical ids', () => {
    const registryA = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
    const registryB = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);

    for (const def of ITEM_DEFINITIONS) {
      expect(registryA.get(def.id).id).toBe(registryB.get(def.id).id);
      expect(registryA.get(def.id).name).toBe(registryB.get(def.id).name);
    }
  });
});

interface RawItemDefinition {
  readonly id: number;
  readonly name: string;
  readonly maxStackSize: number;
  readonly placesBlock?: number;
  readonly food?: { readonly hunger: number };
}

/**
 * Builds a definition for validation tests, deliberately allowing ids outside
 * the real ItemId union (e.g. gaps, duplicates, out-of-range) to exercise
 * ItemRegistry's runtime checks.
 */
function makeDef(
  overrides: Partial<RawItemDefinition> & { id: number; name: string },
): ItemDefinition {
  const raw: RawItemDefinition = {
    maxStackSize: 64,
    ...overrides,
  };
  return raw as unknown as ItemDefinition;
}

/** Builds a tool-item definition for validation tests, with a valid tool by default (overridable). */
function makeToolDef(
  overrides: Partial<Pick<ItemDefinition, 'id' | 'name' | 'maxStackSize' | 'tool'>> & {
    id: number;
    name: string;
  },
): ItemDefinition {
  return {
    maxStackSize: 1,
    tool: { type: 'pickaxe', tier: 1, speed: 2, maxDurability: 64 },
    ...overrides,
  } as ItemDefinition;
}

describe('validation errors', () => {
  it('throws on an empty definition list', () => {
    expect(() => new ItemRegistry([], blockRegistry)).toThrow();
  });

  it('throws on a gap in ids (unsorted or missing id)', () => {
    const defs = [
      makeDef({ id: 1, name: 'a' }),
      makeDef({ id: 3, name: 'b' }),
    ];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });

  it('throws on a duplicate id', () => {
    const defs = [
      makeDef({ id: 1, name: 'a' }),
      makeDef({ id: 1, name: 'b' }),
    ];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });

  it('throws on a duplicate name', () => {
    const defs = [
      makeDef({ id: 1, name: 'dup' }),
      makeDef({ id: 2, name: 'dup' }),
    ];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });

  it('throws when an id does not fit in a Uint16', () => {
    const defs = [
      makeDef({ id: 1, name: 'a' }),
      makeDef({ id: 65536, name: 'too_big' }),
    ];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });

  it('throws when maxStackSize is 0', () => {
    const defs = [makeDef({ id: 1, name: 'a', maxStackSize: 0 })];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });

  it('throws when maxStackSize exceeds INVENTORY_CONFIG.maxStackSize', () => {
    const defs = [makeDef({ id: 1, name: 'a', maxStackSize: INVENTORY_CONFIG.maxStackSize + 1 })];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });

  it('throws when maxStackSize is not an integer', () => {
    const defs = [makeDef({ id: 1, name: 'a', maxStackSize: 1.5 })];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });

  it('throws when placesBlock is BlockId.Air', () => {
    const defs = [makeDef({ id: 1, name: 'a', placesBlock: BlockId.Air })];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });

  it('throws when placesBlock is an unregistered block id', () => {
    const defs = [makeDef({ id: 1, name: 'a', placesBlock: 200 })];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });

  it('throws when two items place the same block', () => {
    const defs = [
      makeDef({ id: 1, name: 'a', placesBlock: BlockId.Stone }),
      makeDef({ id: 2, name: 'b', placesBlock: BlockId.Stone }),
    ];
    expect(() => new ItemRegistry(defs, blockRegistry)).toThrow();
  });
});
