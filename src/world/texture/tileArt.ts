import type { AtlasLayout } from './atlasLayout';
import type { TileName } from './tiles';
import { mulberry32 } from '../../util/mulberry32';
import * as blocks from './tileArtBlocks';
import { jitter, offset, type Painter, type Rgba, type TileArt } from './tilePaint';

const RGBA_COMPONENTS = 4;

/** Readonly art-data palette (colors used by the painters below), not gameplay data. */
const PALETTE = {
  coal: { r: 40, g: 40, b: 42, a: 255 },
  planks: { r: 176, g: 139, b: 90, a: 255 },
  torchStick: { r: 96, g: 68, b: 40, a: 255 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  fallbackA: { r: 230, g: 30, b: 200, a: 255 },
  fallbackB: { r: 0, g: 0, b: 0, a: 255 },
  toolHandle: { r: 120, g: 84, b: 50, a: 255 },
  toolHeadWood: { r: 176, g: 139, b: 90, a: 255 },
  toolHeadStone: { r: 130, g: 130, b: 132, a: 255 },
  appleRed: { r: 196, g: 42, b: 42, a: 255 },
  appleRedDark: { r: 160, g: 30, b: 30, a: 255 },
  appleStem: { r: 96, g: 68, b: 40, a: 255 },
  appleLeaf: { r: 70, g: 130, b: 50, a: 255 },
  rawPork: { r: 224, g: 141, b: 145, a: 255 },
  rawPorkDark: { r: 196, g: 112, b: 118, a: 255 },
  rawPorkFat: { r: 240, g: 205, b: 200, a: 255 },
  rawBeef: { r: 165, g: 48, b: 52, a: 255 },
  rawBeefDark: { r: 128, g: 34, b: 40, a: 255 },
  rawBeefFat: { r: 232, g: 196, b: 186, a: 255 },
  rawChicken: { r: 232, g: 176, b: 158, a: 255 },
  rawChickenDark: { r: 208, g: 146, b: 130, a: 255 },
  rawChickenBone: { r: 238, g: 232, b: 218, a: 255 },
} as const satisfies Record<string, Rgba>;

/** Diagonal stick icon (a thin brown bar corner-to-corner), transparent elsewhere. */
function stickPainter(): Painter {
  return (x, y, size, rng): Rgba => {
    // Distance from (x,y) to the size's main diagonal line, in pixels.
    const dist = Math.abs(x - y) / Math.SQRT2;
    if (dist <= 1.1) {
      const nearEnd = x < size * 0.2 || x > size * 0.8;
      return jitter(nearEnd ? PALETTE.torchStick : PALETTE.planks, 10, rng);
    }
    return PALETTE.transparent;
  };
}

/** Small rounded coal-lump icon: dark speckled blob centered in the tile, transparent elsewhere. */
function coalPainter(): Painter {
  return (x, y, size, rng): Rgba => {
    const cx = size / 2;
    const cy = size / 2;
    const dist = Math.hypot(x - cx, y - cy);
    const radius = size * 0.32;
    if (dist <= radius) {
      return jitter(PALETTE.coal, 12, rng);
    }
    return PALETTE.transparent;
  };
}

/**
 * Diagonal stick "handle" shared by every tool icon: a thin brown bar from
 * the bottom-left corner toward the tile centre. `headTest` decides which
 * pixels belong to the tool's head (drawn in `headColor`); the handle fills
 * the rest of the diagonal band, everything else stays transparent.
 */
/** Max brightness offset (0..255) for tool head / handle pixels. */
const TOOL_HEAD_SHADE = 8;
const TOOL_HANDLE_SHADE = 6;

function toolPainter(headColor: Rgba, headTest: (x: number, y: number, size: number) => boolean): Painter {
  return (x, y, size, rng): Rgba => {
    // Brightness-only variation (same offset on every channel): per-channel
    // jitter reads as rainbow speckle on flat wood / stone tool heads.
    if (headTest(x, y, size)) {
      return offset(headColor, (rng() * 2 - 1) * TOOL_HEAD_SHADE);
    }
    const dist = Math.abs(x - y) / Math.SQRT2;
    if (dist <= 1.1 && x > size * 0.25 && x < size * 0.85) {
      return offset(PALETTE.toolHandle, (rng() * 2 - 1) * TOOL_HANDLE_SHADE);
    }
    return PALETTE.transparent;
  };
}

/** Pickaxe head: a wide horizontal bar near the top, angled like a pick. */
function pickaxeHeadTest(x: number, y: number, size: number): boolean {
  const headY = size * 0.22;
  return Math.abs(y - headY) <= size * 0.1 && x >= size * 0.15 && x <= size * 0.85;
}

/** Axe head: a wedge block on the upper-right side of the handle. */
function axeHeadTest(x: number, y: number, size: number): boolean {
  return y <= size * 0.42 && x >= size * 0.45 && x <= size * 0.92;
}

/** Shovel head: a small blade at the top of the handle. */
function shovelHeadTest(x: number, y: number, size: number): boolean {
  const headY = size * 0.2;
  return y <= headY + size * 0.12 && Math.abs(x - size * 0.72) <= size * 0.16;
}

/** Small round apple icon: red speckled body with a highlight notch, brown stem, tiny leaf; transparent elsewhere. */
function applePainter(): Painter {
  return (x, y, size, rng): Rgba => {
    const cx = size / 2;
    const cy = size * 0.58;
    const radius = size * 0.34;

    const stemTop = Math.round(size * 0.08);
    const stemBottom = Math.round(size * 0.28);
    if (y >= stemTop && y < stemBottom && Math.abs(x - cx) <= 1) {
      return jitter(PALETTE.appleStem, 6, rng);
    }

    const leafDist = Math.hypot(x - (cx + size * 0.12), y - size * 0.22);
    if (leafDist <= size * 0.12) {
      return jitter(PALETTE.appleLeaf, 8, rng);
    }

    const dist = Math.hypot(x - cx, y - cy);
    if (dist <= radius) {
      const useDark = rng() < 0.3;
      return jitter(useDark ? PALETTE.appleRedDark : PALETTE.appleRed, 10, rng);
    }
    return PALETTE.transparent;
  };
}

/** Small raw-pork icon: a rounded pinkish meat slab with a fat-marbling streak, transparent elsewhere. */
function rawPorkPainter(): Painter {
  return (x, y, size, rng): Rgba => {
    const cx = size / 2;
    const cy = size / 2;
    // Slightly wider than tall, like a cut slab rather than a round fruit.
    const dx = (x - cx) / (size * 0.4);
    const dy = (y - cy) / (size * 0.3);
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      return PALETTE.transparent;
    }

    const fatBand = Math.abs(x - y - size * 0.1) <= 1.2;
    if (fatBand) {
      return jitter(PALETTE.rawPorkFat, 6, rng);
    }

    const useDark = rng() < 0.3;
    return jitter(useDark ? PALETTE.rawPorkDark : PALETTE.rawPork, 10, rng);
  };
}

/** Raw-beef icon: a thick dark-red steak with a pale fat rim and two marbling flecks, transparent elsewhere. */
function rawBeefPainter(): Painter {
  return (x, y, size, rng): Rgba => {
    const cx = size / 2;
    const cy = size / 2;
    const dx = (x - cx) / (size * 0.42);
    const dy = (y - cy) / (size * 0.34);
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      return PALETTE.transparent;
    }
    if (dist > 0.82) {
      return jitter(PALETTE.rawBeefFat, 6, rng);
    }
    const fleck = Math.abs(x - cx - 2) + Math.abs(y - cy + 1) <= 1 || Math.abs(x - cx + 2) + Math.abs(y - cy - 2) <= 1;
    if (fleck) {
      return jitter(PALETTE.rawBeefFat, 6, rng);
    }
    return jitter(rng() < 0.3 ? PALETTE.rawBeefDark : PALETTE.rawBeef, 10, rng);
  };
}

/** Raw-chicken icon: a pale-pink drumstick (meat blob upper-left, bone shaft with knob toward lower-right), transparent elsewhere. */
function rawChickenPainter(): Painter {
  return (x, y, size, rng): Rgba => {
    const meatDist = Math.hypot((x - size * 0.4) / (size * 0.3), (y - size * 0.4) / (size * 0.27));
    if (meatDist <= 1) {
      return jitter(rng() < 0.3 ? PALETTE.rawChickenDark : PALETTE.rawChicken, 8, rng);
    }
    const along = Math.abs(x - y) / Math.SQRT2;
    const shaft = along <= 1.1 && x >= size * 0.5 && x <= size * 0.78;
    const knobDist = Math.hypot(x - size * 0.82, y - size * 0.82);
    if (shaft || knobDist <= size * 0.11) {
      return jitter(PALETTE.rawChickenBone, 6, rng);
    }
    return PALETTE.transparent;
  };
}

function fallbackPainter(): Painter {
  return (x, y, _size, _rng): Rgba => {
    const checker = (x + y) % 2 === 0;
    return checker ? PALETTE.fallbackA : PALETTE.fallbackB;
  };
}

/** Wraps a stateless per-pixel painter (item icons, drawn with the shared per-tile PRNG) as a tile art. */
function perPixel(painter: Painter): TileArt {
  return () => painter;
}

const TILE_ARTS: Partial<Record<TileName, TileArt>> = {
  grass_top: blocks.grassTopArt(),
  grass_side: blocks.grassSideArt(),
  dirt: blocks.dirtArt(),
  stone: blocks.stoneArt(),
  sand: blocks.sandArt(),
  gravel: blocks.gravelArt(),
  water: blocks.waterArt(),
  wood_top: blocks.woodTopArt(),
  wood_side: blocks.woodSideArt(),
  leaves: blocks.leavesArt(),
  coal_ore: blocks.coalOreArt(),
  iron_ore: blocks.ironOreArt(),
  gold_ore: blocks.goldOreArt(),
  glass: blocks.glassArt(),
  planks: blocks.planksArt(),
  cobblestone: blocks.cobblestoneArt(),
  torch: blocks.torchArt(),
  crafting_table_top: blocks.craftingTableTopArt(),
  crafting_table_side: blocks.craftingTableSideArt(),
  chest_top: blocks.chestTopArt(),
  chest_side: blocks.chestSideArt(),
  stick: perPixel(stickPainter()),
  coal: perPixel(coalPainter()),
  wooden_pickaxe: perPixel(toolPainter(PALETTE.toolHeadWood, pickaxeHeadTest)),
  wooden_axe: perPixel(toolPainter(PALETTE.toolHeadWood, axeHeadTest)),
  wooden_shovel: perPixel(toolPainter(PALETTE.toolHeadWood, shovelHeadTest)),
  stone_pickaxe: perPixel(toolPainter(PALETTE.toolHeadStone, pickaxeHeadTest)),
  stone_axe: perPixel(toolPainter(PALETTE.toolHeadStone, axeHeadTest)),
  stone_shovel: perPixel(toolPainter(PALETTE.toolHeadStone, shovelHeadTest)),
  apple: perPixel(applePainter()),
  raw_pork: perPixel(rawPorkPainter()),
  raw_beef: perPixel(rawBeefPainter()),
  raw_chicken: perPixel(rawChickenPainter()),
};

function artFor(name: string): TileArt {
  return TILE_ARTS[name as TileName] ?? perPixel(fallbackPainter());
}

/** Golden-ratio multiplier used to spread tile indices into well separated PRNG seeds. */
const TILE_SEED_STRIDE = 0x9e3779b1;

/**
 * Generates deterministic RGBA pixel data for the whole atlas: one tile art
 * per tile (each with its own PRNG derived from `seed` and the tile index), so the same (layout, tileNames, seed)
 * always produces byte-identical output. Row order matches `tileUvRect`:
 * tile row 0 occupies image rows [0, tileSize), top of the image, and within
 * a tile, painter-local y=0 is that tile's top row (painters are defined in
 * "reading" order; `AtlasLayout`/DataTexture flipping happens in the renderer).
 */
export function generateAtlasPixels(
  layout: AtlasLayout,
  tileNames: readonly string[],
  seed: number,
): Uint8ClampedArray {
  const { tileSize, columns, width, height } = layout;
  const pixels = new Uint8ClampedArray(width * height * RGBA_COMPONENTS);
  tileNames.forEach((name, tileIdx) => {
    // Each tile draws from its own PRNG so editing one tile never shifts another.
    const rng = mulberry32(seed + Math.imul(tileIdx + 1, TILE_SEED_STRIDE));
    const painter = artFor(name)(tileSize, rng);
    const col = tileIdx % columns;
    const row = Math.floor(tileIdx / columns);
    const originX = col * tileSize;
    const originY = row * tileSize;

    for (let ty = 0; ty < tileSize; ty += 1) {
      for (let tx = 0; tx < tileSize; tx += 1) {
        const color = painter(tx, ty, tileSize, rng);
        const px = originX + tx;
        const py = originY + ty;
        const offset = (py * width + px) * RGBA_COMPONENTS;
        pixels[offset] = color.r;
        pixels[offset + 1] = color.g;
        pixels[offset + 2] = color.b;
        pixels[offset + 3] = color.a;
      }
    }
  });

  return pixels;
}
