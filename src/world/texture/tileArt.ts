import type { AtlasLayout } from './atlasLayout';
import type { TileName } from './tiles';
import { mulberry32 } from '../../util/mulberry32';

const RGBA_COMPONENTS = 4;
const BYTE_MAX = 255;

/** RGBA color as normalized bytes (0-255 each), the unit painters work in. */
interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(BYTE_MAX, Math.round(value)));
}

/** Nudges each channel of `base` by up to +-`amount` using `rng`, producing a speckled look. */
function jitter(base: Rgba, amount: number, rng: () => number): Rgba {
  const delta = (): number => (rng() * 2 - 1) * amount;
  return {
    r: clampByte(base.r + delta()),
    g: clampByte(base.g + delta()),
    b: clampByte(base.b + delta()),
    a: base.a,
  };
}

/** A painter fills one tile's pixels (tileSize x tileSize) given its local (x, y) and a PRNG. */
type Painter = (x: number, y: number, tileSize: number, rng: () => number) => Rgba;

/** Readonly art-data palette (colors used by the painters below), not gameplay data. */
const PALETTE = {
  grassGreen: { r: 91, g: 143, b: 60, a: 255 },
  grassGreenDark: { r: 70, g: 117, b: 46, a: 255 },
  dirt: { r: 134, g: 96, b: 60, a: 255 },
  dirtDark: { r: 110, g: 78, b: 48, a: 255 },
  stone: { r: 130, g: 130, b: 132, a: 255 },
  stoneDark: { r: 105, g: 105, b: 108, a: 255 },
  sand: { r: 219, g: 203, b: 154, a: 255 },
  sandDark: { r: 198, g: 181, b: 133, a: 255 },
  gravel: { r: 140, g: 136, b: 130, a: 255 },
  gravelDark: { r: 110, g: 106, b: 100, a: 255 },
  water: { r: 61, g: 111, b: 174, a: 180 },
  waterDark: { r: 45, g: 90, b: 150, a: 180 },
  wood: { r: 106, g: 74, b: 47, a: 255 },
  woodDark: { r: 82, g: 56, b: 34, a: 255 },
  woodRing: { r: 130, g: 96, b: 62, a: 255 },
  leaves: { r: 61, g: 122, b: 47, a: 255 },
  leavesDark: { r: 45, g: 100, b: 36, a: 255 },
  coal: { r: 40, g: 40, b: 42, a: 255 },
  iron: { r: 205, g: 178, b: 150, a: 255 },
  gold: { r: 230, g: 196, b: 74, a: 255 },
  glass: { r: 210, g: 235, b: 245, a: 40 },
  glassFrame: { r: 235, g: 245, b: 250, a: 210 },
  planks: { r: 176, g: 139, b: 90, a: 255 },
  planksDark: { r: 150, g: 115, b: 70, a: 255 },
  cobble: { r: 122, g: 122, b: 122, a: 255 },
  cobbleDark: { r: 95, g: 95, b: 97, a: 255 },
  torchStick: { r: 96, g: 68, b: 40, a: 255 },
  torchFlame: { r: 255, g: 190, b: 60, a: 255 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  craftTop: { r: 150, g: 108, b: 66, a: 255 },
  craftSide: { r: 128, g: 90, b: 56, a: 255 },
  chestTop: { r: 150, g: 108, b: 58, a: 255 },
  chestSide: { r: 122, g: 84, b: 44, a: 255 },
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
} as const satisfies Record<string, Rgba>;

function speckled(base: Rgba, dark: Rgba, jitterAmount: number): Painter {
  return (_x, _y, _size, rng): Rgba => {
    const useDark = rng() < 0.3;
    return jitter(useDark ? dark : base, jitterAmount, rng);
  };
}

function grassSidePainter(): Painter {
  return (_x, y, size, rng): Rgba => {
    const stripHeight = Math.max(2, Math.round(size * 0.22));
    if (y < stripHeight) {
      return jitter(PALETTE.grassGreen, 12, rng);
    }
    return jitter(PALETTE.dirt, 10, rng);
  };
}

function woodSidePainter(): Painter {
  return (x, _y, _size, rng): Rgba => {
    const stripe = Math.floor(x / 3) % 2 === 0;
    return jitter(stripe ? PALETTE.wood : PALETTE.woodDark, 8, rng);
  };
}

function woodTopPainter(): Painter {
  return (x, y, size, rng): Rgba => {
    const cx = size / 2;
    const cy = size / 2;
    const dist = Math.hypot(x - cx, y - cy);
    const ring = Math.floor(dist / 1.6) % 2 === 0;
    return jitter(ring ? PALETTE.woodRing : PALETTE.wood, 8, rng);
  };
}

function orePainter(oreColor: Rgba, density: number): Painter {
  return (_x, _y, _size, rng): Rgba => {
    if (rng() < density) {
      return jitter(oreColor, 10, rng);
    }
    return jitter(PALETTE.stone, 8, rng);
  };
}

function glassPainter(): Painter {
  return (x, y, size, rng): Rgba => {
    const border = 1;
    const onFrame = x < border || y < border || x >= size - border || y >= size - border;
    if (onFrame) {
      return jitter(PALETTE.glassFrame, 6, rng);
    }
    return jitter(PALETTE.glass, 6, rng);
  };
}

function leavesPainter(): Painter {
  return (_x, _y, _size, rng): Rgba => {
    if (rng() < 0.12) {
      return PALETTE.transparent;
    }
    const useDark = rng() < 0.35;
    return jitter(useDark ? PALETTE.leavesDark : PALETTE.leaves, 10, rng);
  };
}

function waterPainter(): Painter {
  return (_x, _y, _size, rng): Rgba => {
    const useDark = rng() < 0.3;
    return jitter(useDark ? PALETTE.waterDark : PALETTE.water, 8, rng);
  };
}

function planksPainter(): Painter {
  return (_x, y, size, rng): Rgba => {
    const boardHeight = Math.max(2, Math.round(size / 4));
    const board = Math.floor(y / boardHeight);
    const useDark = board % 2 === 0;
    return jitter(useDark ? PALETTE.planksDark : PALETTE.planks, 8, rng);
  };
}

function cobblestonePainter(): Painter {
  return (x, y, size, rng): Rgba => {
    const blobX = Math.floor(x / 4);
    const blobY = Math.floor(y / 4);
    const parity = (blobX * 928371 + blobY * 128371) % 2 === 0;
    void size;
    return jitter(parity ? PALETTE.cobble : PALETTE.cobbleDark, 10, rng);
  };
}

function torchPainter(): Painter {
  return (x, y, size, rng): Rgba => {
    const cx = size / 2;
    const flameTop = Math.round(size * 0.15);
    const flameBottom = Math.round(size * 0.5);
    const stickBottom = size - 1;

    if (y >= flameTop && y < flameBottom && Math.abs(x - cx) <= 2) {
      return jitter(PALETTE.torchFlame, 15, rng);
    }
    if (y >= flameBottom && y <= stickBottom && Math.abs(x - cx) <= 1) {
      return jitter(PALETTE.torchStick, 6, rng);
    }
    return PALETTE.transparent;
  };
}

function simpleFrontPainter(base: Rgba, dark: Rgba): Painter {
  return (x, y, size, rng): Rgba => {
    const border = x < 1 || y < 1 || x >= size - 1 || y >= size - 1;
    return jitter(border ? dark : base, 8, rng);
  };
}

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
function toolPainter(headColor: Rgba, headTest: (x: number, y: number, size: number) => boolean): Painter {
  return (x, y, size, rng): Rgba => {
    if (headTest(x, y, size)) {
      return jitter(headColor, 10, rng);
    }
    const dist = Math.abs(x - y) / Math.SQRT2;
    if (dist <= 1.1 && x > size * 0.25 && x < size * 0.85) {
      return jitter(PALETTE.toolHandle, 8, rng);
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

function fallbackPainter(): Painter {
  return (x, y, _size, _rng): Rgba => {
    const checker = (x + y) % 2 === 0;
    return checker ? PALETTE.fallbackA : PALETTE.fallbackB;
  };
}

const PAINTERS: Partial<Record<TileName, Painter>> = {
  grass_top: speckled(PALETTE.grassGreen, PALETTE.grassGreenDark, 10),
  grass_side: grassSidePainter(),
  dirt: speckled(PALETTE.dirt, PALETTE.dirtDark, 10),
  stone: speckled(PALETTE.stone, PALETTE.stoneDark, 8),
  sand: speckled(PALETTE.sand, PALETTE.sandDark, 8),
  gravel: speckled(PALETTE.gravel, PALETTE.gravelDark, 12),
  water: waterPainter(),
  wood_top: woodTopPainter(),
  wood_side: woodSidePainter(),
  leaves: leavesPainter(),
  coal_ore: orePainter(PALETTE.coal, 0.16),
  iron_ore: orePainter(PALETTE.iron, 0.14),
  gold_ore: orePainter(PALETTE.gold, 0.12),
  glass: glassPainter(),
  planks: planksPainter(),
  cobblestone: cobblestonePainter(),
  torch: torchPainter(),
  crafting_table_top: simpleFrontPainter(PALETTE.craftTop, PALETTE.woodDark),
  crafting_table_side: simpleFrontPainter(PALETTE.craftSide, PALETTE.woodDark),
  chest_top: simpleFrontPainter(PALETTE.chestTop, PALETTE.woodDark),
  chest_side: simpleFrontPainter(PALETTE.chestSide, PALETTE.woodDark),
  stick: stickPainter(),
  coal: coalPainter(),
  wooden_pickaxe: toolPainter(PALETTE.toolHeadWood, pickaxeHeadTest),
  wooden_axe: toolPainter(PALETTE.toolHeadWood, axeHeadTest),
  wooden_shovel: toolPainter(PALETTE.toolHeadWood, shovelHeadTest),
  stone_pickaxe: toolPainter(PALETTE.toolHeadStone, pickaxeHeadTest),
  stone_axe: toolPainter(PALETTE.toolHeadStone, axeHeadTest),
  stone_shovel: toolPainter(PALETTE.toolHeadStone, shovelHeadTest),
  apple: applePainter(),
  raw_pork: rawPorkPainter(),
};

function painterFor(name: string): Painter {
  return PAINTERS[name as TileName] ?? fallbackPainter();
}

/**
 * Generates deterministic RGBA pixel data for the whole atlas: one painter
 * call per pixel per tile, seeded so the same (layout, tileNames, seed)
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
  const rng = mulberry32(seed);

  tileNames.forEach((name, tileIdx) => {
    const painter = painterFor(name);
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
