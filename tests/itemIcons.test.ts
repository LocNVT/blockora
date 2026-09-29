import { describe, it, expect } from 'vitest';
import { iconTileForItem } from '../src/items/itemIcons';
import { itemRegistry } from '../src/items/ItemRegistry';
import { blockRegistry } from '../src/world/BlockRegistry';
import { ItemId } from '../src/items/items';
import { TILE_NAMES } from '../src/world/texture/tiles';

describe('iconTileForItem', () => {
  it('grass -> grass_side', () => {
    expect(iconTileForItem(itemRegistry, blockRegistry, ItemId.Grass)).toBe('grass_side');
  });

  it('wood -> wood_side', () => {
    expect(iconTileForItem(itemRegistry, blockRegistry, ItemId.Wood)).toBe('wood_side');
  });

  it('stone -> stone', () => {
    expect(iconTileForItem(itemRegistry, blockRegistry, ItemId.Stone)).toBe('stone');
  });

  it('stick -> stick icon tile', () => {
    expect(iconTileForItem(itemRegistry, blockRegistry, ItemId.Stick)).toBe('stick');
  });

  it('coal -> coal icon tile', () => {
    expect(iconTileForItem(itemRegistry, blockRegistry, ItemId.Coal)).toBe('coal');
  });

  it('every block-placing item has an icon tile that exists in TILE_NAMES', () => {
    const known = new Set<string>(TILE_NAMES);
    for (let id = 1; id <= itemRegistry.size; id += 1) {
      const def = itemRegistry.get(id);
      if (def.placesBlock === undefined) {
        continue;
      }
      const tile = iconTileForItem(itemRegistry, blockRegistry, def.id);
      expect(tile).not.toBeNull();
      expect(known.has(tile as string)).toBe(true);
    }
  });

  it('every item has an icon tile present in TILE_NAMES', () => {
    const known = new Set<string>(TILE_NAMES);
    for (let id = 1; id <= itemRegistry.size; id += 1) {
      const def = itemRegistry.get(id);
      const tile = iconTileForItem(itemRegistry, blockRegistry, def.id);
      expect(tile, `item "${def.name}" has no icon tile`).not.toBeNull();
      expect(known.has(tile as string)).toBe(true);
    }
  });
});
