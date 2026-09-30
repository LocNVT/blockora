import { describe, it, expect } from 'vitest';
import { ATLAS_CONFIG } from '../src/config/constants';
import { itemRegistry } from '../src/items/ItemRegistry';
import { iconTileForItem } from '../src/items/itemIcons';
import { blockRegistry } from '../src/world/BlockRegistry';
import { createAtlasLayout } from '../src/world/texture/atlasLayout';
import { generateAtlasPixels } from '../src/world/texture/tileArt';
import { TILE_NAMES, tileIndex, type TileName } from '../src/world/texture/tiles';

const LAYOUT = createAtlasLayout(TILE_NAMES.length);
const SIZE = LAYOUT.tileSize;
const ATLAS = generateAtlasPixels(LAYOUT, TILE_NAMES, ATLAS_CONFIG.seed);

interface Px {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  readonly x: number;
  readonly y: number;
  readonly lum: number;
}

/** Reads one tile out of an atlas as a flat list of pixels (row-major, y = 0 is the tile's top row). */
function tilePixels(name: TileName, pixels: Uint8ClampedArray = ATLAS, layout = LAYOUT): Px[] {
  const index = tileIndex(name);
  const originX = (index % layout.columns) * SIZE;
  const originY = Math.floor(index / layout.columns) * SIZE;
  const out: Px[] = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const o = ((originY + y) * layout.width + originX + x) * 4;
      const r = pixels[o] as number;
      const g = pixels[o + 1] as number;
      const b = pixels[o + 2] as number;
      out.push({ r, g, b, a: pixels[o + 3] as number, x, y, lum: 0.3 * r + 0.59 * g + 0.11 * b });
    }
  }
  return out;
}

const count = (px: readonly Px[], test: (p: Px) => boolean): number => px.filter(test).length;
const mean = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

function stdDev(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** FNV-1a over a tile's RGBA bytes, as a compact per-tile snapshot. */
function tileHash(name: TileName): string {
  let h = 0x811c9dc5;
  for (const p of tilePixels(name)) {
    for (const byte of [p.r, p.g, p.b, p.a]) {
      h = Math.imul(h ^ byte, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

// Deliberate snapshot: update these hashes only when the tile art is intentionally changed.
const EXPECTED_HASHES: Record<string, string> = {
  "apple": "76dee03e",
  "chest_side": "95486eb9",
  "chest_top": "c3c9915f",
  "coal": "e3e721ef",
  "coal_ore": "909f7232",
  "cobblestone": "9d51950c",
  "crafting_table_side": "b36200a2",
  "crafting_table_top": "980fedec",
  "dirt": "53cea58b",
  "glass": "9992752c",
  "gold_ore": "118909ef",
  "grass_side": "26c3cf6f",
  "grass_top": "50b7eefc",
  "gravel": "03dc6dbc",
  "iron_ore": "9b5eada2",
  "leaves": "c6afd965",
  "planks": "be735fcb",
  "raw_beef": "488da1f0",
  "raw_chicken": "8cacb0e6",
  "raw_pork": "8c7fa84c",
  "sand": "53248f6d",
  "stick": "7bfe5d3e",
  "stone": "07f6164a",
  "stone_axe": "962b65b7",
  "stone_pickaxe": "f69cf080",
  "stone_shovel": "58a9dff1",
  "torch": "93e84bf9",
  "water": "e2a5e819",
  "wood_side": "02cec5e4",
  "wood_top": "427fd8cd",
  "wooden_axe": "836e3796",
  "wooden_pickaxe": "78dcc65b",
  "wooden_shovel": "e9c79024",
};

describe('tile art layout', () => {
  it('keeps 16x16 tiles, the 33 tile names and the 8-column layout', () => {
    expect(SIZE).toBe(16);
    expect(TILE_NAMES.length).toBe(33);
    expect(LAYOUT.columns).toBe(8);
    expect(ATLAS.length).toBe(LAYOUT.width * LAYOUT.height * 4);
    expect(tileIndex('grass_top')).toBe(0);
    expect(tileIndex('stone')).toBe(3);
    expect(tileIndex('chest_side')).toBe(20);
    expect(tileIndex('raw_pork')).toBe(30);
    expect(tileIndex('raw_beef')).toBe(31);
    expect(tileIndex('raw_chicken')).toBe(32);
  });
});

describe('tile art determinism', () => {
  it('same seed gives identical pixels, another seed differs', () => {
    expect(generateAtlasPixels(LAYOUT, TILE_NAMES, ATLAS_CONFIG.seed)).toEqual(ATLAS);
    expect(generateAtlasPixels(LAYOUT, TILE_NAMES, ATLAS_CONFIG.seed + 1)).not.toEqual(ATLAS);
  });

  it('a tile depends only on the seed and its own index (a shorter list keeps earlier tiles identical)', () => {
    const shorter = TILE_NAMES.slice(0, 12);
    const shortLayout = createAtlasLayout(shorter.length);
    const partial = generateAtlasPixels(shortLayout, shorter, ATLAS_CONFIG.seed);
    for (const name of shorter) {
      const a = tilePixels(name);
      const b = tilePixels(name, partial, shortLayout);
      expect(b, name).toEqual(a);
    }
  });

  it('matches the per-tile pixel hash snapshot at the atlas seed', () => {
    const hashes = Object.fromEntries(TILE_NAMES.map((name) => [name, tileHash(name)]));
    expect(hashes).toEqual(EXPECTED_HASHES);
  });
});

describe('tile alpha rules', () => {
  const partial = new Set<string>(['glass', 'leaves', 'water', 'torch']);
  const icons = new Set<string>([
    'stick',
    'coal',
    'wooden_pickaxe',
    'wooden_axe',
    'wooden_shovel',
    'stone_pickaxe',
    'stone_axe',
    'stone_shovel',
    'apple',
    'raw_pork',
    'raw_beef',
    'raw_chicken',
  ]);

  it('every block tile except glass, leaves, water and torch is fully opaque', () => {
    for (const name of TILE_NAMES) {
      if (partial.has(name) || icons.has(name)) {
        continue;
      }
      expect(count(tilePixels(name), (p) => p.a !== 255), name).toBe(0);
    }
  });

  it('water is uniformly translucent', () => {
    expect(tilePixels('water').every((p) => p.a === 180)).toBe(true);
  });

  it('glass: solid-ish frame, faint pane with a few streaks, never fully opaque or fully clear', () => {
    const px = tilePixels('glass');
    const frame = px.filter((p) => p.x === 0 || p.y === 0 || p.x === SIZE - 1 || p.y === SIZE - 1);
    const pane = px.filter((p) => p.x > 0 && p.y > 0 && p.x < SIZE - 1 && p.y < SIZE - 1);
    expect(frame.every((p) => p.a >= 200 && p.a < 255)).toBe(true);
    expect(pane.every((p) => p.a > 0 && p.a <= 120)).toBe(true);
    expect(count(pane, (p) => p.a <= 45)).toBeGreaterThan(pane.length * 0.9);
    expect(count(pane, (p) => p.a > 45)).toBeGreaterThan(3);
  });

  it('leaves: a few fully transparent holes, everything else opaque', () => {
    const px = tilePixels('leaves');
    const holes = count(px, (p) => p.a === 0);
    expect(holes).toBeGreaterThanOrEqual(4);
    expect(holes).toBeLessThanOrEqual(30);
    expect(count(px, (p) => p.a !== 0 && p.a !== 255)).toBe(0);
  });

  it('torch: transparent background, opaque stick and flame', () => {
    const px = tilePixels('torch');
    expect(count(px, (p) => p.a !== 0 && p.a !== 255)).toBe(0);
    expect(count(px, (p) => p.a === 255)).toBeGreaterThanOrEqual(20);
    expect(px.find((p) => p.x === 0 && p.y === 0)?.a).toBe(0);
    expect(count(px, (p) => p.a === 255 && p.r > 200 && p.b < 130)).toBeGreaterThanOrEqual(8);
  });
});

describe('terrain readability', () => {
  const stone = tilePixels('stone');
  const stoneLum = mean(stone.map((p) => p.lum));

  it('stone is calm: almost no pixel far from the mean, low overall spread', () => {
    expect(count(stone, (p) => Math.abs(p.lum - stoneLum) > 20)).toBeLessThanOrEqual(stone.length * 0.03);
    expect(stdDev(stone.map((p) => p.lum))).toBeLessThan(9);
  });

  it('ores keep the stone base and add clustered flecks in their own colour family', () => {
    const cases = [
      { name: 'coal_ore', family: (p: Px) => p.lum < 85 },
      { name: 'iron_ore', family: (p: Px) => p.r - p.b > 45 && p.r > 150 },
      { name: 'gold_ore', family: (p: Px) => p.r > 170 && p.g > 120 && p.b < 130 && p.r - p.b > 90 },
    ] as const;
    for (const { name, family } of cases) {
      const px = tilePixels(name);
      expect(count(stone, family), `stone has no ${name} colour`).toBe(0);
      expect(count(px, family), name).toBeGreaterThanOrEqual(10);
      expect(count(px, family), name).toBeLessThanOrEqual(px.length * 0.25);
      const sameAsStone = count(px, (p) => {
        const s = stone[p.y * SIZE + p.x] as Px;
        return s.r === p.r && s.g === p.g && s.b === p.b;
      });
      expect(sameAsStone, `${name} base`).toBeGreaterThan(px.length * 0.6);
    }
  });

  it('ore flecks are clustered: most ore pixels touch another ore pixel', () => {
    const px = tilePixels('coal_ore');
    const ore = new Set(px.filter((p) => p.lum < 85).map((p) => p.y * SIZE + p.x));
    let touching = 0;
    ore.forEach((key) => {
      if ([key - 1, key + 1, key - SIZE, key + SIZE].some((n) => ore.has(n))) {
        touching += 1;
      }
    });
    expect(touching).toBeGreaterThan(ore.size * 0.7);
  });

  it('grass side: top rows are green turf, bottom rows are dirt, with a ragged edge', () => {
    const px = tilePixels('grass_side');
    const green = (p: Px): boolean => p.g > p.r && p.g > p.b;
    const dirt = (p: Px): boolean => p.r > p.g && p.g > p.b && p.r - p.b > 40;
    const top = px.filter((p) => p.y < 2);
    const bottom = px.filter((p) => p.y >= 8);
    expect(count(top, green)).toBeGreaterThanOrEqual(top.length * 0.95);
    expect(count(bottom, dirt)).toBeGreaterThanOrEqual(bottom.length * 0.95);
    const firstDirtRow = new Set<number>();
    for (let x = 0; x < SIZE; x += 1) {
      const col = px.filter((p) => p.x === x);
      firstDirtRow.add(col.find((p) => dirt(p) && !green(p))?.y ?? SIZE);
    }
    expect(firstDirtRow.size).toBeGreaterThanOrEqual(2);
    expect(Math.min(...firstDirtRow)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...firstDirtRow)).toBeLessThanOrEqual(7);
  });

  it('grass top is green and varied, dirt is brown with a few pale pebbles', () => {
    const grass = tilePixels('grass_top');
    expect(count(grass, (p) => p.g > p.r && p.g > p.b)).toBeGreaterThanOrEqual(grass.length * 0.98);
    expect(stdDev(grass.map((p) => p.lum))).toBeGreaterThan(3);
    const dirt = tilePixels('dirt');
    expect(count(dirt, (p) => p.r > p.g && p.g > p.b)).toBeGreaterThanOrEqual(dirt.length * 0.98);
    expect(count(dirt, (p) => p.lum > 130)).toBeGreaterThanOrEqual(2);
  });

  it('cobblestone has a dark mortar network around lighter stones', () => {
    const px = tilePixels('cobblestone');
    const mortar = px.filter((p) => p.lum < 85);
    expect(mortar.length).toBeGreaterThanOrEqual(px.length * 0.12);
    expect(mortar.length).toBeLessThanOrEqual(px.length * 0.4);
    const stones = px.filter((p) => p.lum >= 100);
    expect(stones.length).toBeGreaterThan(px.length * 0.45);
    expect(mean(stones.map((p) => p.lum)) - mean(mortar.map((p) => p.lum))).toBeGreaterThan(35);
  });

  it('sand is fine grain, gravel has distinct pebbles with dark gaps', () => {
    const sand = tilePixels('sand');
    const gravel = tilePixels('gravel');
    expect(stdDev(sand.map((p) => p.lum))).toBeLessThan(8);
    expect(stdDev(gravel.map((p) => p.lum))).toBeGreaterThan(stdDev(sand.map((p) => p.lum)) * 1.5);
    expect(count(gravel, (p) => p.lum < 90)).toBeGreaterThanOrEqual(gravel.length * 0.05);
  });
});

describe('wood, planks and furniture readability', () => {
  it('planks: each board ends in a darker seam row than its grain row', () => {
    const px = tilePixels('planks');
    const rowMean = (y: number): number => mean(px.filter((p) => p.y === y).map((p) => p.lum));
    for (const seamY of [3, 7, 11, 15]) {
      expect(rowMean(seamY)).toBeLessThan(rowMean(seamY - 2) - 15);
    }
  });

  it('log top has a dark bark rim and lighter rings inside; log side has dark grooves', () => {
    const top = tilePixels('wood_top');
    const rim = top.filter((p) => p.x === 0 || p.y === 0 || p.x === SIZE - 1 || p.y === SIZE - 1);
    const inner = top.filter((p) => p.x > 2 && p.y > 2 && p.x < SIZE - 3 && p.y < SIZE - 3);
    expect(mean(rim.map((p) => p.lum))).toBeLessThan(mean(inner.map((p) => p.lum)) - 20);
    const side = tilePixels('wood_side');
    expect(count(side, (p) => p.lum < 60)).toBeGreaterThanOrEqual(side.length * 0.08);
  });

  it('leaves use varied greens; crafting table and chest faces have a dark frame', () => {
    const leaves = tilePixels('leaves').filter((p) => p.a === 255);
    expect(leaves.every((p) => p.g > p.r && p.g > p.b)).toBe(true);
    expect(stdDev(leaves.map((p) => p.lum))).toBeGreaterThan(8);
    for (const name of ['crafting_table_top', 'crafting_table_side', 'chest_top', 'chest_side'] as const) {
      const px = tilePixels(name);
      const rim = px.filter((p) => p.x === 0 || p.y === 0 || p.x === SIZE - 1 || p.y === SIZE - 1);
      const inner = px.filter((p) => p.x > 1 && p.y > 1 && p.x < SIZE - 2 && p.y < SIZE - 2);
      expect(mean(rim.map((p) => p.lum)), name).toBeLessThan(mean(inner.map((p) => p.lum)));
    }
  });
});

describe('item icons derived from tiles', () => {
  it('every item icon tile shows a readable shape (enough visible pixels)', () => {
    for (let id = 1; id <= itemRegistry.size; id += 1) {
      const def = itemRegistry.get(id);
      const tile = iconTileForItem(itemRegistry, blockRegistry, def.id);
      expect(tile, def.name).not.toBeNull();
      expect(count(tilePixels(tile as TileName), (p) => p.a > 100), `${def.name} -> ${tile}`).toBeGreaterThanOrEqual(20);
    }
  });
});
