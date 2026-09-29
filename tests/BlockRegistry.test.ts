import { describe, it, expect } from 'vitest';
import { BlockRegistry, blockRegistry } from '../src/world/BlockRegistry';
import { BLOCK_DEFINITIONS, BlockId, type BlockDefinition } from '../src/world/blocks';

describe('default blockRegistry instance', () => {
  it('has an entry for every BlockId value', () => {
    for (const id of Object.values(BlockId)) {
      expect(blockRegistry.has(id)).toBe(true);
      expect(blockRegistry.get(id).id).toBe(id);
    }
  });

  it('size matches the number of definitions', () => {
    expect(blockRegistry.size).toBe(BLOCK_DEFINITIONS.length);
  });

  it('get throws for an unknown id', () => {
    expect(() => blockRegistry.get(9999)).toThrow();
  });

  it('has returns false for an unknown id', () => {
    expect(blockRegistry.has(9999)).toBe(false);
    expect(blockRegistry.has(-1)).toBe(false);
  });

  it('getByName resolves known names and returns undefined for unknown ones', () => {
    expect(blockRegistry.getByName('stone')?.id).toBe(BlockId.Stone);
    expect(blockRegistry.getByName('does_not_exist')).toBeUndefined();
  });

  it('reports solid/transparent flags for representative blocks', () => {
    expect(blockRegistry.isSolid(BlockId.Stone)).toBe(true);
    expect(blockRegistry.isSolid(BlockId.Air)).toBe(false);
    expect(blockRegistry.isSolid(BlockId.Water)).toBe(false);

    expect(blockRegistry.isTransparent(BlockId.Air)).toBe(true);
    expect(blockRegistry.isTransparent(BlockId.Water)).toBe(true);
    expect(blockRegistry.isTransparent(BlockId.Glass)).toBe(true);
    expect(blockRegistry.isTransparent(BlockId.Stone)).toBe(false);
  });

  it('reports targetable flags: Air and Water are not targetable, everything else with a texture is', () => {
    expect(blockRegistry.isTargetable(BlockId.Air)).toBe(false);
    expect(blockRegistry.isTargetable(BlockId.Water)).toBe(false);

    expect(blockRegistry.isTargetable(BlockId.Stone)).toBe(true);
    expect(blockRegistry.isTargetable(BlockId.Glass)).toBe(true);
    expect(blockRegistry.isTargetable(BlockId.Leaves)).toBe(true);
    expect(blockRegistry.isTargetable(BlockId.Torch)).toBe(true);
  });

  it('reports replaceable flags: only Air and Water can be overwritten by placement', () => {
    expect(blockRegistry.isReplaceable(BlockId.Air)).toBe(true);
    expect(blockRegistry.isReplaceable(BlockId.Water)).toBe(true);

    expect(blockRegistry.isReplaceable(BlockId.Stone)).toBe(false);
    expect(blockRegistry.isReplaceable(BlockId.Glass)).toBe(false);
    expect(blockRegistry.isReplaceable(BlockId.Torch)).toBe(false);
    expect(blockRegistry.isReplaceable(999)).toBe(false);
  });

  it('reports fluid flags: only Water is a fluid', () => {
    expect(blockRegistry.isFluid(BlockId.Water)).toBe(true);

    expect(blockRegistry.isFluid(BlockId.Air)).toBe(false);
    expect(blockRegistry.isFluid(BlockId.Stone)).toBe(false);
    expect(blockRegistry.isFluid(BlockId.Grass)).toBe(false);
  });
});

describe('hardness / tool requirements', () => {
  it('every block has hardness >= 0', () => {
    for (const def of BLOCK_DEFINITIONS) {
      expect(def.hardness).toBeGreaterThanOrEqual(0);
    }
  });

  it('every requiresTool block declares a toolType', () => {
    for (const def of BLOCK_DEFINITIONS) {
      if (def.requiresTool) {
        expect(def.toolType).toBeDefined();
      }
    }
  });

  it('the ore/stone blocks require their expected tool', () => {
    const requiresPickaxe = [BlockId.Stone, BlockId.Cobblestone, BlockId.CoalOre, BlockId.IronOre, BlockId.GoldOre];
    for (const id of requiresPickaxe) {
      const def = blockRegistry.get(id);
      expect(def.requiresTool).toBe(true);
      expect(def.toolType).toBe('pickaxe');
    }
  });
});

describe('determinism', () => {
  it('building the registry twice from the same definitions yields identical ids', () => {
    const a = new BlockRegistry(BLOCK_DEFINITIONS);
    const b = new BlockRegistry(BLOCK_DEFINITIONS);

    for (const def of BLOCK_DEFINITIONS) {
      expect(a.get(def.id).id).toBe(b.get(def.id).id);
      expect(a.get(def.id).name).toBe(b.get(def.id).name);
    }
  });
});

interface RawBlockDefinition {
  readonly id: number;
  readonly name: string;
  readonly solid: boolean;
  readonly transparent: boolean;
  readonly hardness: number;
  readonly texture: BlockDefinition['texture'];
  readonly lightLevel: number;
  readonly flammable: boolean;
}

/**
 * Builds a definition for validation tests, deliberately allowing ids outside
 * the real BlockId union (e.g. gaps, duplicates, out-of-range) to exercise
 * BlockRegistry's runtime checks.
 */
function makeDef(
  overrides: Partial<RawBlockDefinition> & { id: number; name: string },
): BlockDefinition {
  const raw: RawBlockDefinition = {
    solid: true,
    transparent: false,
    hardness: 1,
    texture: { all: 'placeholder' },
    lightLevel: 0,
    flammable: false,
    ...overrides,
  };
  return raw as unknown as BlockDefinition;
}

describe('validation errors', () => {
  it('throws on a duplicate id', () => {
    const defs = [
      makeDef({ id: 0, name: 'air', solid: false, transparent: true, texture: null }),
      makeDef({ id: 1, name: 'a' }),
      makeDef({ id: 1, name: 'b' }),
    ];
    expect(() => new BlockRegistry(defs)).toThrow();
  });

  it('throws on a gap in ids', () => {
    const defs = [
      makeDef({ id: 0, name: 'air', solid: false, transparent: true, texture: null }),
      makeDef({ id: 2, name: 'a' }),
    ];
    expect(() => new BlockRegistry(defs)).toThrow();
  });

  it('throws when id 0 is not air', () => {
    const defs = [makeDef({ id: 0, name: 'stone' })];
    expect(() => new BlockRegistry(defs)).toThrow();
  });

  it('throws on a duplicate name', () => {
    const defs = [
      makeDef({ id: 0, name: 'air', solid: false, transparent: true, texture: null }),
      makeDef({ id: 1, name: 'dup' }),
      makeDef({ id: 2, name: 'dup' }),
    ];
    expect(() => new BlockRegistry(defs)).toThrow();
  });

  it('throws when an id does not fit in a Uint8', () => {
    const defs = [
      makeDef({ id: 0, name: 'air', solid: false, transparent: true, texture: null }),
      makeDef({ id: 256, name: 'too_big' }),
    ];
    expect(() => new BlockRegistry(defs)).toThrow();
  });

  it('throws on an empty definition list', () => {
    expect(() => new BlockRegistry([])).toThrow();
  });
});
