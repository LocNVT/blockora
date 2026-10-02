import { describe, it, expect } from 'vitest';
import { ITEM_DEFINITIONS, ItemId } from '../src/items/items';
import { itemRegistry } from '../src/items/ItemRegistry';
import { createStack } from '../src/items/ItemStack';
import { describeItem, placeTooltip } from '../src/ui/itemTooltip';
import { nextHotbarLabel } from '../src/ui/hotbarLabel';
import { TOOL_CONFIG } from '../src/config/constants';

describe('item displayName', () => {
  it('every item has a non-empty, trimmed, unique displayName', () => {
    const seen = new Set<string>();
    for (const def of ITEM_DEFINITIONS) {
      expect(def.displayName.length, def.name).toBeGreaterThan(0);
      expect(def.displayName, def.name).toBe(def.displayName.trim());
      expect(seen.has(def.displayName), `duplicate ${def.displayName}`).toBe(false);
      seen.add(def.displayName);
    }
    expect(seen.size).toBe(ITEM_DEFINITIONS.length);
  });

  it('is Title Case (each word starts upper-case) and differs from the internal name', () => {
    for (const def of ITEM_DEFINITIONS) {
      for (const word of def.displayName.split(' ')) {
        expect(word.charAt(0), def.displayName).toBe(word.charAt(0).toUpperCase());
      }
      expect(def.displayName).not.toBe(def.name);
    }
  });
});

describe('describeItem', () => {
  it('returns [] for an empty slot', () => {
    expect(describeItem(null, itemRegistry)).toEqual([]);
  });

  it('block: only the name, even for a big stack', () => {
    expect(describeItem(createStack(ItemId.CoalOre, 30), itemRegistry)).toEqual(['Coal Ore']);
  });

  it('tool: fresh shows full durability', () => {
    const max = TOOL_CONFIG.durability.wood;
    expect(describeItem(createStack(ItemId.WoodenPickaxe, 1), itemRegistry)).toEqual([
      'Wooden Pickaxe',
      `Durability ${max} / ${max}`,
    ]);
  });

  it('tool: worn shows remaining uses', () => {
    const max = TOOL_CONFIG.durability.stone;
    const lines = describeItem(createStack(ItemId.StoneAxe, 1, itemRegistry, 10), itemRegistry);
    expect(lines).toEqual(['Stone Axe', `Durability ${max - 10} / ${max}`]);
  });

  it('food: shows hunger restored', () => {
    expect(describeItem(createStack(ItemId.RawPork, 5), itemRegistry)).toEqual([
      'Raw Pork',
      'Restores 3 hunger',
    ]);
  });
});

describe('nextHotbarLabel', () => {
  const stone = createStack(ItemId.Stone, 10);
  const dirt = createStack(ItemId.Dirt, 1);

  it('first observation only records a baseline', () => {
    const r = nextHotbarLabel(null, 0, stone);
    expect(r.show).toBe(false);
    expect(r.state).toEqual({ slot: 0, itemId: ItemId.Stone });
  });

  it('selection index change with an item shows', () => {
    const base = nextHotbarLabel(null, 0, stone).state;
    expect(nextHotbarLabel(base, 1, dirt).show).toBe(true);
  });

  it('same slot and same item does not re-show (count change included)', () => {
    const base = nextHotbarLabel(null, 2, stone).state;
    expect(nextHotbarLabel(base, 2, stone).show).toBe(false);
    expect(nextHotbarLabel(base, 2, createStack(ItemId.Stone, 9)).show).toBe(false);
  });

  it('empty slot never shows, but updates state', () => {
    const base = nextHotbarLabel(null, 0, stone).state;
    const r = nextHotbarLabel(base, 3, null);
    expect(r.show).toBe(false);
    expect(r.state).toEqual({ slot: 3, itemId: null });
  });

  it('different item in the same selected slot shows', () => {
    const base = nextHotbarLabel(null, 0, stone).state;
    expect(nextHotbarLabel(base, 0, dirt).show).toBe(true);
  });

  it('item appearing in a previously empty selected slot shows', () => {
    const base = nextHotbarLabel(null, 4, null).state;
    expect(nextHotbarLabel(base, 4, stone).show).toBe(true);
  });
});

describe('placeTooltip', () => {
  const W = 120;
  const H = 40;

  it('defaults to below-right of the cursor', () => {
    const p = placeTooltip(100, 100, W, H, 1000, 800, 14, 6);
    expect(p).toEqual({ left: 114, top: 114 });
  });

  it('flips left near the right edge', () => {
    const p = placeTooltip(980, 100, W, H, 1000, 800, 14, 6);
    expect(p.left).toBe(980 - 14 - W);
    expect(p.left + W).toBeLessThanOrEqual(1000);
  });

  it('flips up near the bottom edge', () => {
    const p = placeTooltip(100, 790, W, H, 1000, 800, 14, 6);
    expect(p.top).toBe(790 - 14 - H);
  });

  it('flips both at the bottom-right corner', () => {
    const p = placeTooltip(995, 795, W, H, 1000, 800, 14, 6);
    expect(p.left + W).toBeLessThanOrEqual(1000);
    expect(p.top + H).toBeLessThanOrEqual(800);
  });

  it('never leaves a small viewport (390 x 700) for any cursor position', () => {
    for (let x = 0; x <= 390; x += 13) {
      for (let y = 0; y <= 700; y += 17) {
        const p = placeTooltip(x, y, 200, 60, 390, 700, 14, 6);
        expect(p.left).toBeGreaterThanOrEqual(6);
        expect(p.top).toBeGreaterThanOrEqual(6);
        expect(p.left + 200).toBeLessThanOrEqual(390 - 6);
        expect(p.top + 60).toBeLessThanOrEqual(700 - 6);
      }
    }
  });

  it('pins a box wider than the viewport to the left margin', () => {
    expect(placeTooltip(50, 50, 500, 40, 390, 700, 14, 6).left).toBe(6);
  });
});
