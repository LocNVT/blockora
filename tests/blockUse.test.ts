import { describe, it, expect } from 'vitest';
import { blockUseAction } from '../src/gameplay/blockUse';
import { BlockId } from '../src/world/blocks';

describe('blockUseAction', () => {
  it('CraftingTable opens the crafting_table screen', () => {
    expect(blockUseAction(BlockId.CraftingTable)).toBe('crafting_table');
  });

  it('Chest opens the chest screen', () => {
    expect(blockUseAction(BlockId.Chest)).toBe('chest');
  });

  it('ordinary blocks have no use action', () => {
    expect(blockUseAction(BlockId.Stone)).toBeNull();
    expect(blockUseAction(BlockId.Dirt)).toBeNull();
    expect(blockUseAction(BlockId.Air)).toBeNull();
  });
});
