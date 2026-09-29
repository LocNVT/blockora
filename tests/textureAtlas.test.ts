import { describe, it, expect } from 'vitest';
import { blockRegistry, BlockRegistry } from '../src/world/BlockRegistry';
import { BlockId, type BlockDefinition } from '../src/world/blocks';
import { FaceDirection } from '../src/world/mesher/faces';
import { TILE_NAMES, tileIndex } from '../src/world/texture/tiles';
import {
  resolveFaceTile,
  buildFaceTileTable,
  faceTileFromTable,
  validateBlockTextures,
  NO_TILE,
} from '../src/world/texture/blockFaceTiles';
import { createAtlasLayout, tileUvRect, mapToAtlasUv } from '../src/world/texture/atlasLayout';
import { generateAtlasPixels } from '../src/world/texture/tileArt';
import { itemRegistry } from '../src/items/ItemRegistry';

const ALL_FACES = [
  FaceDirection.PosX,
  FaceDirection.NegX,
  FaceDirection.PosY,
  FaceDirection.NegY,
  FaceDirection.PosZ,
  FaceDirection.NegZ,
];

describe('TILE_NAMES', () => {
  it('contains only unique names', () => {
    expect(new Set(TILE_NAMES).size).toBe(TILE_NAMES.length);
  });

  it('tileIndex resolves known names and throws on unknown ones', () => {
    expect(tileIndex('stone')).toBe(TILE_NAMES.indexOf('stone'));
    expect(() => tileIndex('not_a_real_tile')).toThrow();
  });
});

describe('resolveFaceTile', () => {
  it('resolves the same key for every face when using "all"', () => {
    const texture = { all: 'stone' };
    for (const face of ALL_FACES) {
      expect(resolveFaceTile(texture, face)).toBe('stone');
    }
  });

  it('resolves top/side/bottom per face for grass', () => {
    const texture = { top: 'grass_top', side: 'grass_side', bottom: 'dirt' };
    expect(resolveFaceTile(texture, FaceDirection.PosY)).toBe('grass_top');
    expect(resolveFaceTile(texture, FaceDirection.NegY)).toBe('dirt');
    expect(resolveFaceTile(texture, FaceDirection.PosX)).toBe('grass_side');
    expect(resolveFaceTile(texture, FaceDirection.NegX)).toBe('grass_side');
    expect(resolveFaceTile(texture, FaceDirection.PosZ)).toBe('grass_side');
    expect(resolveFaceTile(texture, FaceDirection.NegZ)).toBe('grass_side');
  });
});

describe('every renderable block resolves all 6 faces to a known tile', () => {
  it('buildFaceTileTable never leaves a renderable block at NO_TILE', () => {
    const table = buildFaceTileTable(blockRegistry);
    for (let id = 0; id < blockRegistry.size; id += 1) {
      const def = blockRegistry.get(id);
      for (const face of ALL_FACES) {
        const tile = faceTileFromTable(table, id, face);
        if (def.texture === null) {
          expect(tile).toBe(NO_TILE);
        } else {
          expect(tile).not.toBe(NO_TILE);
          expect(tile).toBeGreaterThanOrEqual(0);
          expect(tile).toBeLessThan(TILE_NAMES.length);
        }
      }
    }
  });

  it('grass: PosY -> grass_top, NegY -> dirt, sides -> grass_side', () => {
    const table = buildFaceTileTable(blockRegistry);
    expect(faceTileFromTable(table, BlockId.Grass, FaceDirection.PosY)).toBe(tileIndex('grass_top'));
    expect(faceTileFromTable(table, BlockId.Grass, FaceDirection.NegY)).toBe(tileIndex('dirt'));
    expect(faceTileFromTable(table, BlockId.Grass, FaceDirection.PosX)).toBe(tileIndex('grass_side'));
    expect(faceTileFromTable(table, BlockId.Grass, FaceDirection.NegX)).toBe(tileIndex('grass_side'));
    expect(faceTileFromTable(table, BlockId.Grass, FaceDirection.PosZ)).toBe(tileIndex('grass_side'));
    expect(faceTileFromTable(table, BlockId.Grass, FaceDirection.NegZ)).toBe(tileIndex('grass_side'));
  });

  it('stone: all faces -> stone', () => {
    const table = buildFaceTileTable(blockRegistry);
    for (const face of ALL_FACES) {
      expect(faceTileFromTable(table, BlockId.Stone, face)).toBe(tileIndex('stone'));
    }
  });

  it('wood: top/bottom -> wood_top, sides -> wood_side', () => {
    const table = buildFaceTileTable(blockRegistry);
    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.PosY)).toBe(tileIndex('wood_top'));
    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.NegY)).toBe(tileIndex('wood_top'));
    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.PosX)).toBe(tileIndex('wood_side'));
    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.NegX)).toBe(tileIndex('wood_side'));
  });
});

describe('validateBlockTextures', () => {
  it('does not throw for the real block registry with the real tile list', () => {
    expect(() => validateBlockTextures(blockRegistry, TILE_NAMES)).not.toThrow();
  });

  it('throws a descriptive error listing every block referencing an unknown key', () => {
    const definitions: readonly BlockDefinition[] = [
      {
        id: 0,
        name: 'air',
        solid: false,
        transparent: true,
        hardness: 0,
        texture: null,
        lightLevel: 0,
        flammable: false,
      },
      {
        id: 1,
        name: 'mystery_block',
        solid: true,
        transparent: false,
        hardness: 1,
        texture: { all: 'totally_unknown_tile' },
        lightLevel: 0,
        flammable: false,
      },
      {
        id: 2,
        name: 'partial_mystery',
        solid: true,
        transparent: false,
        hardness: 1,
        texture: { top: 'stone', side: 'also_unknown', bottom: 'stone' },
        lightLevel: 0,
        flammable: false,
      },
    ];
    const fixtureRegistry = new BlockRegistry(definitions);

    expect(() => validateBlockTextures(fixtureRegistry, TILE_NAMES)).toThrow(/mystery_block/);
    try {
      validateBlockTextures(fixtureRegistry, TILE_NAMES);
      throw new Error('expected validateBlockTextures to throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('mystery_block');
      expect(message).toContain('totally_unknown_tile');
      expect(message).toContain('partial_mystery');
      expect(message).toContain('also_unknown');
    }
  });
});

describe('AtlasLayout', () => {
  it('fits every tile (columns * rows >= tile count)', () => {
    const layout = createAtlasLayout(TILE_NAMES.length);
    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(TILE_NAMES.length);
    expect(layout.width).toBe(layout.columns * layout.tileSize);
    expect(layout.height).toBe(layout.rows * layout.tileSize);
  });

  it('tileUvRect stays within [0,1] and applies a nonzero inset', () => {
    const layout = createAtlasLayout(TILE_NAMES.length);
    for (let i = 0; i < TILE_NAMES.length; i += 1) {
      const rect = tileUvRect(layout, i);
      expect(rect.u0).toBeGreaterThanOrEqual(0);
      expect(rect.v0).toBeGreaterThanOrEqual(0);
      expect(rect.u1).toBeLessThanOrEqual(1);
      expect(rect.v1).toBeLessThanOrEqual(1);
      expect(rect.u1).toBeGreaterThan(rect.u0);
      expect(rect.v1).toBeGreaterThan(rect.v0);

      const fullTileWidth = 1 / layout.columns;
      // Inset must shrink the rect below the tile's full un-inset width.
      expect(rect.u1 - rect.u0).toBeLessThan(fullTileWidth);
    }
  });

  it('distinct tiles occupy non-overlapping uv rects', () => {
    const layout = createAtlasLayout(TILE_NAMES.length);
    const rects = TILE_NAMES.map((_, i) => tileUvRect(layout, i));
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a === undefined || b === undefined) {
          continue;
        }
        const overlapsU = a.u0 < b.u1 && b.u0 < a.u1;
        const overlapsV = a.v0 < b.v1 && b.v0 < a.v1;
        expect(overlapsU && overlapsV).toBe(false);
      }
    }
  });

  it('mapToAtlasUv of unit-quad corners stays inside the tile rect', () => {
    const layout = createAtlasLayout(TILE_NAMES.length);
    const tile = tileIndex('stone');
    const rect = tileUvRect(layout, tile);
    for (const u of [0, 1]) {
      for (const v of [0, 1]) {
        const [mu, mv] = mapToAtlasUv(u, v, tile, layout);
        expect(mu).toBeGreaterThanOrEqual(rect.u0);
        expect(mu).toBeLessThanOrEqual(rect.u1);
        expect(mv).toBeGreaterThanOrEqual(rect.v0);
        expect(mv).toBeLessThanOrEqual(rect.v1);
      }
    }
  });
});

describe('every tile is referenced', () => {
  it('each TILE_NAMES entry is used by a block texture or an item icon', () => {
    const referenced = new Set<string>();

    for (let id = 0; id < blockRegistry.size; id += 1) {
      const def = blockRegistry.get(id);
      if (def.texture === null) {
        continue;
      }
      const keys = 'all' in def.texture
        ? [def.texture.all]
        : [def.texture.top, def.texture.side, def.texture.bottom];
      for (const key of keys) {
        referenced.add(key);
      }
    }

    for (let id = 1; id <= itemRegistry.size; id += 1) {
      const def = itemRegistry.get(id);
      if (def.icon !== undefined) {
        referenced.add(def.icon);
      }
    }

    for (const name of TILE_NAMES) {
      expect(referenced.has(name), `tile "${name}" is unreferenced`).toBe(true);
    }
  });
});

describe('tool icon tiles', () => {
  it('every tool tile is a referenced item icon and paints non-transparent pixels somewhere', () => {
    const layout = createAtlasLayout(TILE_NAMES.length);
    const pixels = generateAtlasPixels(layout, TILE_NAMES, 1);

    const toolTiles = [
      'wooden_pickaxe',
      'wooden_axe',
      'wooden_shovel',
      'stone_pickaxe',
      'stone_axe',
      'stone_shovel',
    ] as const;

    for (const name of toolTiles) {
      const tile = tileIndex(name);
      const col = tile % layout.columns;
      const row = Math.floor(tile / layout.columns);
      let sawOpaquePixel = false;

      for (let ty = 0; ty < layout.tileSize && !sawOpaquePixel; ty += 1) {
        for (let tx = 0; tx < layout.tileSize; tx += 1) {
          const px = col * layout.tileSize + tx;
          const py = row * layout.tileSize + ty;
          const offset = (py * layout.width + px) * 4;
          const alpha = pixels[offset + 3] as number;
          if (alpha > 0) {
            sawOpaquePixel = true;
            break;
          }
        }
      }
      expect(sawOpaquePixel, `tile "${name}" painted nothing`).toBe(true);
    }
  });
});

describe('generateAtlasPixels', () => {
  it('is deterministic for a fixed seed', () => {
    const layout = createAtlasLayout(TILE_NAMES.length);
    const a = generateAtlasPixels(layout, TILE_NAMES, 42);
    const b = generateAtlasPixels(layout, TILE_NAMES, 42);
    expect(a).toEqual(b);
  });

  it('differs for a different seed', () => {
    const layout = createAtlasLayout(TILE_NAMES.length);
    const a = generateAtlasPixels(layout, TILE_NAMES, 42);
    const b = generateAtlasPixels(layout, TILE_NAMES, 43);
    expect(a).not.toEqual(b);
  });

  it('has the correct byte length (width * height * 4)', () => {
    const layout = createAtlasLayout(TILE_NAMES.length);
    const pixels = generateAtlasPixels(layout, TILE_NAMES, 1);
    expect(pixels.length).toBe(layout.width * layout.height * 4);
  });

  it('glass and leaves tiles contain at least one alpha value below 255', () => {
    const layout = createAtlasLayout(TILE_NAMES.length);
    const pixels = generateAtlasPixels(layout, TILE_NAMES, 1);

    for (const name of ['glass', 'leaves']) {
      const tile = tileIndex(name);
      const col = tile % layout.columns;
      const row = Math.floor(tile / layout.columns);
      let sawTransparency = false;

      for (let ty = 0; ty < layout.tileSize && !sawTransparency; ty += 1) {
        for (let tx = 0; tx < layout.tileSize; tx += 1) {
          const px = col * layout.tileSize + tx;
          const py = row * layout.tileSize + ty;
          const offset = (py * layout.width + px) * 4;
          const alpha = pixels[offset + 3] as number;
          if (alpha < 255) {
            sawTransparency = true;
            break;
          }
        }
      }
      expect(sawTransparency).toBe(true);
    }
  });
});
