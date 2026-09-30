import { mulberry32 } from '../../util/mulberry32';
import {
  TRANSPARENT,
  TileCanvas,
  bake,
  cellPartition,
  hash01,
  jitter,
  mixColors,
  offset,
  rgba,
  shade,
  valueNoise,
  type Rgba,
  type TileArt,
} from './tilePaint';

/**
 * Procedural art for the block-face tiles. Everything is original pixel art
 * built from small deterministic rules (value noise, cell partitions, hand
 * placed features) with a single light direction: light comes from the top
 * left, so lit edges sit up / left of a feature and shadow down / right.
 * Every painter takes its tile's own PRNG, so editing one tile never shifts
 * the pixels of another.
 */

/** Fixed seeds for tiles that are deliberately shared between painters (stone under ores, dirt under grass). */
const STONE_SEED = 0x51073;
const DIRT_SEED = 0xd1277;
const GRASS_SEED = 0x6a355;

const P = {
  stone: rgba(129, 129, 133),
  dirt: rgba(134, 96, 60),
  dirtPebble: rgba(168, 146, 116),
  dirtPebbleShadow: rgba(98, 68, 42),
  dirtSpeck: rgba(112, 78, 48),
  grass: rgba(98, 150, 62),
  grassBladeDark: rgba(72, 118, 46),
  grassBladeLight: rgba(126, 176, 82),
  sand: rgba(220, 204, 155),
  cobble: rgba(124, 124, 128),
  mortar: rgba(68, 68, 73),
  gravelGap: rgba(78, 75, 72),
  bark: rgba(110, 77, 48),
  barkGroove: rgba(70, 47, 29),
  barkFleck: rgba(90, 62, 39),
  ringLight: rgba(152, 114, 72),
  ringDark: rgba(128, 92, 58),
  pith: rgba(98, 68, 43),
  cutBark: rgba(78, 54, 34),
  planks: rgba(176, 139, 90),
  planksSeam: rgba(112, 80, 48),
  leavesLight: rgba(96, 162, 64),
  leavesMid: rgba(62, 126, 47),
  leavesDark: rgba(38, 92, 35),
  water: rgba(58, 108, 176, 180),
  waterLight: rgba(100, 152, 214, 180),
  waterDark: rgba(44, 88, 150, 180),
  glassFrameLit: rgba(234, 247, 252, 215),
  glassFrameShade: rgba(178, 206, 222, 215),
  glassPane: rgba(200, 228, 240, 40),
  glassStreak: rgba(244, 251, 255, 100),
  glassStreakSoft: rgba(244, 251, 255, 60),
  woodEdge: rgba(96, 66, 40),
  craftTop: rgba(168, 128, 82),
  craftLine: rgba(118, 84, 52),
  craftSide: rgba(142, 102, 64),
  steel: rgba(156, 158, 164),
  steelLight: rgba(196, 198, 204),
  chestTop: rgba(160, 114, 62),
  chestSide: rgba(130, 90, 48),
  chestEdge: rgba(80, 54, 29),
  latch: rgba(208, 192, 122),
  latchLight: rgba(238, 226, 164),
} as const satisfies Record<string, Rgba>;

/** Fills a canvas with `base` varied by low-frequency blotches plus a little per-pixel grain. */
function noisyFill(
  size: number,
  base: Rgba,
  rng: () => number,
  blotchAmp: number,
  grainAmp: number,
  cells = 4,
): TileCanvas {
  const canvas = new TileCanvas(size);
  const blotch = valueNoise(size, cells, rng);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const grain = (rng() * 2 - 1) * grainAmp;
      canvas.set(x, y, offset(base, (blotch[y * size + x] ?? 0) * blotchAmp + grain));
    }
  }
  return canvas;
}

/** Short wandering line of darker "crack" pixels, wrapping around the tile edges. */
function carveCrack(canvas: TileCanvas, rng: () => number, length: number, depth: number): void {
  let x = Math.floor(rng() * canvas.size);
  let y = Math.floor(rng() * canvas.size);
  const dirX = rng() < 0.5 ? 1 : -1;
  for (let step = 0; step < length; step += 1) {
    canvas.set(x, y, offset(canvas.get(x, y), -depth));
    // The lit lip sits just below-right of the groove (light from top-left).
    if (step % 2 === 0) {
      canvas.set(x + 1, y + 1, offset(canvas.get(x + 1, y + 1), depth * 0.3));
    }
    const roll = rng();
    x += roll < 0.7 ? dirX : 0;
    y += roll >= 0.35 && roll < 0.85 ? 1 : 0;
    x = (x + canvas.size) % canvas.size;
    y = (y + canvas.size) % canvas.size;
  }
}

function paintStone(size: number): TileCanvas {
  const rng = mulberry32(STONE_SEED);
  const canvas = noisyFill(size, P.stone, rng, 7, 2.5);
  carveCrack(canvas, rng, 8, 10);
  carveCrack(canvas, rng, 6, 9);
  return canvas;
}

export function stoneArt(): TileArt {
  return (size) => paintStone(size).toPainter();
}

interface OreStyle {
  readonly main: Rgba;
  readonly light: Rgba;
  readonly dark: Rgba;
  readonly clusters: number;
  readonly extraCells: number;
}

/** A compact blob: a 2x2 core at (cx, cy) plus `extra` 4-connected cells, kept off the tile border. */
function growCluster(size: number, cx: number, cy: number, extra: number, rng: () => number): Set<number> {
  const list = [cy * size + cx, cy * size + cx + 1, (cy + 1) * size + cx, (cy + 1) * size + cx + 1];
  const cells = new Set<number>(list);
  let guard = 0;
  while (list.length < 4 + extra && guard < 60) {
    guard += 1;
    const from = list[Math.floor(rng() * list.length)] ?? 0;
    const dir = Math.floor(rng() * 4);
    const nx = (from % size) + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
    const ny = Math.floor(from / size) + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
    const key = ny * size + nx;
    if (nx >= 1 && ny >= 1 && nx < size - 1 && ny < size - 1 && !cells.has(key)) {
      cells.add(key);
      list.push(key);
    }
  }
  return cells;
}

function pickClusterCentres(size: number, count: number, rng: () => number): { x: number; y: number }[] {
  const centres: { x: number; y: number }[] = [];
  for (let attempt = 0; attempt < 80 && centres.length < count; attempt += 1) {
    const x = 1 + Math.floor(rng() * (size - 4));
    const y = 1 + Math.floor(rng() * (size - 4));
    if (centres.every((c) => Math.hypot(c.x - x, c.y - y) >= 3.6)) {
      centres.push({ x, y });
    }
  }
  return centres;
}

/** Stone base (identical to the stone tile) with clustered ore flecks lit from the top left. */
function oreArt(style: OreStyle): TileArt {
  return (size, rng) => {
    const canvas = paintStone(size);
    const ore = new Set<number>();
    for (const c of pickClusterCentres(size, style.clusters, rng)) {
      const blob = growCluster(size, c.x, c.y, style.extraCells + Math.floor(rng() * 2), rng);
      blob.forEach((key) => ore.add(key));
    }
    const has = (x: number, y: number): boolean => ore.has(y * size + x);
    // Shadow the stone just below / right of each fleck first, then paint the flecks over it.
    ore.forEach((key) => {
      const x = key % size;
      const y = Math.floor(key / size);
      if (!has(x + 1, y + 1) && !has(x + 1, y) && !has(x, y + 1)) {
        canvas.set(x + 1, y + 1, shade(canvas.get(x + 1, y + 1), 0.82));
      }
    });
    ore.forEach((key) => {
      const x = key % size;
      const y = Math.floor(key / size);
      let color = style.main;
      if (!has(x, y - 1)) {
        color = style.light; // top edge catches the light
      } else if (!has(x, y + 1)) {
        color = style.dark; // bottom edge sits in shadow
      }
      canvas.set(x, y, jitter(color, 5, rng));
    });
    return canvas.toPainter();
  };
}

export const ORE_STYLES = {
  coal: { main: rgba(38, 38, 44), light: rgba(72, 72, 82), dark: rgba(22, 22, 26), clusters: 6, extraCells: 1 },
  iron: { main: rgba(214, 170, 130), light: rgba(240, 206, 170), dark: rgba(160, 112, 78), clusters: 6, extraCells: 1 },
  gold: { main: rgba(246, 204, 52), light: rgba(255, 240, 150), dark: rgba(184, 132, 18), clusters: 5, extraCells: 1 },
} as const satisfies Record<string, OreStyle>;

export const coalOreArt = (): TileArt => oreArt(ORE_STYLES.coal);
export const ironOreArt = (): TileArt => oreArt(ORE_STYLES.iron);
export const goldOreArt = (): TileArt => oreArt(ORE_STYLES.gold);

interface CellStyle {
  readonly cells: number;
  readonly jitter: number;
  readonly mortarEdge: number;
  readonly mortar: Rgba;
  readonly tones: readonly Rgba[];
  readonly bevel: number;
  readonly rimShade: number;
}

/** Rounded stones / pebbles separated by mortar or gaps; lit from the top left, darker near each rim. */
function cellArt(style: CellStyle): TileArt {
  return (size, rng) => {
    const sample = cellPartition(size, style.cells, style.jitter, rng);
    const step = size / style.cells;
    return bake(size, (canvas) => {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const s = sample(x, y);
          if (s.edge < style.mortarEdge) {
            canvas.set(x, y, jitter(style.mortar, 3, rng));
            continue;
          }
          const tone = style.tones[Math.floor(hash01(s.cell, 11) * style.tones.length)] ?? P.cobble;
          const lit = -(s.dx + s.dy) / step; // > 0 when the pixel is up / left of the stone centre
          let color = offset(tone, lit * style.bevel);
          if (s.edge < style.mortarEdge + 1.1) {
            color = shade(color, style.rimShade);
          }
          canvas.set(x, y, jitter(color, 2.5, rng));
        }
      }
    });
  };
}

export function cobblestoneArt(): TileArt {
  return cellArt({
    cells: 3,
    jitter: 1,
    mortarEdge: 0.9,
    mortar: P.mortar,
    tones: [P.cobble, offset(P.cobble, -10), offset(P.cobble, 9), rgba(120, 122, 118)],
    bevel: 16,
    rimShade: 0.93,
  });
}

export function gravelArt(): TileArt {
  return cellArt({
    cells: 4,
    jitter: 0.8,
    mortarEdge: 0.65,
    mortar: P.gravelGap,
    tones: [rgba(152, 146, 138), rgba(130, 124, 118), rgba(162, 152, 138), rgba(120, 120, 122)],
    bevel: 22,
    rimShade: 0.94,
  });
}

function paintDirt(size: number, rng: () => number): TileCanvas {
  const canvas = noisyFill(size, P.dirt, rng, 6, 3.5);
  for (let i = 0; i < 7; i += 1) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    canvas.set(x, y, jitter(P.dirtSpeck, 4, rng));
  }
  for (let i = 0; i < 3; i += 1) {
    const x = 1 + Math.floor(rng() * (size - 3));
    const y = 1 + Math.floor(rng() * (size - 3));
    const wide = rng() < 0.5;
    canvas.set(x, y, jitter(P.dirtPebble, 5, rng));
    if (wide) {
      canvas.set(x + 1, y, jitter(offset(P.dirtPebble, -8), 5, rng));
    }
    canvas.set(x + (wide ? 2 : 1), y + 1, P.dirtPebbleShadow);
    canvas.set(x, y + 1, P.dirtPebbleShadow);
  }
  return canvas;
}

export function dirtArt(): TileArt {
  return (size) => paintDirt(size, mulberry32(DIRT_SEED)).toPainter();
}

function paintGrass(size: number, rng: () => number): TileCanvas {
  const canvas = noisyFill(size, P.grass, rng, 7, 4);
  for (let i = 0; i < 12; i += 1) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * (size - 1));
    canvas.set(x, y, jitter(P.grassBladeDark, 4, rng));
    if (rng() < 0.5) {
      canvas.set(x, y + 1, jitter(P.grassBladeDark, 4, rng));
    }
  }
  for (let i = 0; i < 9; i += 1) {
    canvas.set(Math.floor(rng() * size), Math.floor(rng() * size), jitter(P.grassBladeLight, 4, rng));
  }
  return canvas;
}

export function grassTopArt(): TileArt {
  return (size, rng) => paintGrass(size, rng).toPainter();
}

/** Ragged per-column overhang depths (3..5 rows) that never jump more than one row between neighbours. */
function overhangDepths(size: number, rng: () => number): number[] {
  const depths: number[] = [];
  for (let x = 0; x < size; x += 1) {
    const raw = 3 + Math.floor(rng() * 3);
    const prev = depths[x - 1];
    depths.push(prev === undefined ? raw : Math.max(prev - 1, Math.min(prev + 1, raw)));
  }
  return depths;
}

export function grassSideArt(): TileArt {
  return (size, rng) => {
    const grass = paintGrass(size, mulberry32(GRASS_SEED));
    const dirt = paintDirt(size, mulberry32(DIRT_SEED));
    const depths = overhangDepths(size, rng);
    return bake(size, (canvas) => {
      for (let x = 0; x < size; x += 1) {
        const depth = depths[x] ?? 3;
        for (let y = 0; y < size; y += 1) {
          if (y < depth - 1) {
            canvas.set(x, y, grass.get(x, y));
          } else if (y === depth - 1) {
            canvas.set(x, y, shade(grass.get(x, y), 0.84)); // lower lip of the turf
          } else if (y === depth) {
            canvas.set(x, y, shade(dirt.get(x, y), 0.8)); // shadow cast under the turf
          } else {
            canvas.set(x, y, dirt.get(x, y));
          }
        }
      }
    });
  };
}

export function sandArt(): TileArt {
  return (size, rng) => {
    const canvas = noisyFill(size, P.sand, rng, 3, 4);
    for (let i = 0; i < Math.round(size * size * 0.1); i += 1) {
      const x = Math.floor(rng() * size);
      const y = Math.floor(rng() * size);
      canvas.set(x, y, offset(canvas.get(x, y), rng() < 0.5 ? -9 : 8));
    }
    return canvas.toPainter();
  };
}

export function woodSideArt(): TileArt {
  return (size, rng) => {
    const canvas = new TileCanvas(size);
    const tones = valueNoise(size, 8, rng);
    const grooves = new Set<number>();
    for (let attempt = 0; attempt < 30 && grooves.size < 4; attempt += 1) {
      const x = 1 + Math.floor(rng() * (size - 2));
      if (![x - 1, x, x + 1].some((n) => grooves.has(n))) {
        grooves.add(x);
      }
    }
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const columnTone = (tones[x] ?? 0) * 6;
        let color = offset(P.bark, columnTone + (rng() * 2 - 1) * 3);
        if (grooves.has(x) && rng() < 0.88) {
          color = jitter(P.barkGroove, 4, rng);
        } else if (grooves.has(x + 1)) {
          color = offset(color, 9); // ridge lit on the left of each groove
        }
        canvas.set(x, y, color);
      }
    }
    for (let i = 0; i < 9; i += 1) {
      const x = Math.floor(rng() * size);
      const y = Math.floor(rng() * size);
      if (!grooves.has(x)) {
        canvas.set(x, y, jitter(P.barkFleck, 4, rng));
      }
    }
    return canvas.toPainter();
  };
}

export function woodTopArt(): TileArt {
  return (size, rng) =>
    bake(size, (canvas) => {
      const c = (size - 1) / 2;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const box = Math.max(Math.abs(x - c), Math.abs(y - c));
          const dist = Math.hypot(x - c, y - c);
          let color: Rgba;
          if (box >= size / 2 - 0.5) {
            color = P.cutBark;
          } else if (box >= size / 2 - 1.5) {
            color = P.bark;
          } else if (dist < 1.7) {
            color = P.pith;
          } else {
            color = Math.floor(dist / 1.9) % 2 === 0 ? P.ringLight : P.ringDark;
          }
          canvas.set(x, y, jitter(color, 3, rng));
        }
      }
    });
}

const PLANK_BOARD_HEIGHT = 4;
const PLANK_JOINTS = [6, 13, 3, 10] as const;

export function planksArt(): TileArt {
  return (size, rng) =>
    bake(size, (canvas) => {
      const boards = Math.ceil(size / PLANK_BOARD_HEIGHT);
      for (let b = 0; b < boards; b += 1) {
        const tint = (hash01(b, 3) * 2 - 1) * 6;
        const joint = PLANK_JOINTS[b % PLANK_JOINTS.length] ?? 6;
        const grainStart = Math.floor(rng() * (size - 5));
        const grainRow = 1 + Math.floor(rng() * 2);
        for (let row = 0; row < PLANK_BOARD_HEIGHT; row += 1) {
          const y = b * PLANK_BOARD_HEIGHT + row;
          for (let x = 0; x < size; x += 1) {
            let color = offset(P.planks, tint + (rng() * 2 - 1) * 3);
            if (row === 0) {
              color = offset(color, 9);
            } else if (row === PLANK_BOARD_HEIGHT - 1) {
              color = mixColors(color, P.planksSeam, 0.85);
            } else if (row === grainRow && x >= grainStart && x < grainStart + 4 + (b % 2)) {
              color = shade(color, 0.9);
            }
            if (x === joint && row < PLANK_BOARD_HEIGHT - 1) {
              color = mixColors(color, P.planksSeam, 0.8);
            } else if (x === (joint + 1) % size && row < PLANK_BOARD_HEIGHT - 1) {
              color = offset(color, 6);
            }
            canvas.set(x, y, color);
          }
        }
      }
    });
}

export function leavesArt(): TileArt {
  return (size, rng) => {
    const broad = valueNoise(size, 4, rng);
    const clumps = valueNoise(size, 8, rng);
    const canvas = new TileCanvas(size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = y * size + x;
        const tone = (broad[i] ?? 0) * 0.5 + (clumps[i] ?? 0) * 0.5 + (rng() * 2 - 1) * 0.25;
        const base = tone > 0.3 ? P.leavesLight : tone < -0.25 ? P.leavesDark : P.leavesMid;
        canvas.set(x, y, jitter(base, 4, rng));
      }
    }
    // A few see-through gaps (the chunk materials alpha-test), each shading the leaf below it.
    const holes: number[] = [];
    for (let n = 0; n < 9; n += 1) {
      holes.push(Math.floor(rng() * size * size));
    }
    holes.forEach((i) => {
      const x = i % size;
      const y = Math.floor(i / size);
      canvas.set(x, y + 1, shade(canvas.get(x, y + 1), 0.8));
    });
    holes.forEach((i) => canvas.set(i % size, Math.floor(i / size), TRANSPARENT));
    return canvas.toPainter();
  };
}

export function waterArt(): TileArt {
  return (size, rng) => {
    const canvas = noisyFill(size, P.water, rng, 6, 2.5);
    const dash = (color: Rgba, count: number): void => {
      for (let n = 0; n < count; n += 1) {
        const y = Math.floor(rng() * size);
        const x = Math.floor(rng() * (size - 4));
        const length = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < length; k += 1) {
          canvas.set(x + k, y, mixColors(canvas.get(x + k, y), color, 0.7));
        }
      }
    };
    dash(P.waterLight, 5);
    dash(P.waterDark, 3);
    return canvas.toPainter();
  };
}

export function glassArt(): TileArt {
  return (size, rng) =>
    bake(size, (canvas) => {
      const last = size - 1;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (x === 0 || y === 0) {
            canvas.set(x, y, jitter(P.glassFrameLit, 4, rng));
          } else if (x === last || y === last) {
            canvas.set(x, y, jitter(P.glassFrameShade, 4, rng));
          } else if (x + y === 12 && x >= 3 && x <= 9) {
            canvas.set(x, y, P.glassStreak);
          } else if (x + y === 15 && x >= 7 && x <= 10) {
            canvas.set(x, y, P.glassStreakSoft);
          } else {
            canvas.set(x, y, jitter(P.glassPane, 4, rng));
          }
        }
      }
    });
}

/** Legend for the hand-placed torch pixel map; a dot is transparent. */
const TORCH_LEGEND: Readonly<Record<string, Rgba>> = {
  r: rgba(226, 84, 30),
  o: rgba(255, 150, 40),
  y: rgba(255, 214, 90),
  w: rgba(255, 246, 196),
  c: rgba(52, 38, 30),
  l: rgba(172, 126, 76),
  s: rgba(136, 96, 58),
  d: rgba(98, 68, 42),
};

const TORCH_ROWS: readonly string[] = [
  '................',
  '.......rr.......',
  '......roor......',
  '......oyyo......',
  '......owwo......',
  '......oyyo......',
  '......roor......',
  '.......cc.......',
  '.......ld.......',
  '.......ls.......',
  '.......ld.......',
  '.......ls.......',
  '.......ld.......',
  '.......ls.......',
  '.......ld.......',
  '.......ls.......',
];

export function torchArt(): TileArt {
  return (size) =>
    bake(size, (canvas) => {
      TORCH_ROWS.forEach((row, y) => {
        [...row].forEach((ch, x) => canvas.set(x, y, TORCH_LEGEND[ch] ?? TRANSPARENT));
      });
    });
}

/** Rectangle fill helper for the hand-placed furniture details. */
function fillRect(canvas: TileCanvas, x0: number, y0: number, w: number, h: number, color: Rgba): void {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      canvas.set(x, y, color);
    }
  }
}

/** One-pixel frame around the tile: lit (top / left) edge lighter than the shaded (bottom / right) one. */
function frame(canvas: TileCanvas, edge: Rgba): void {
  const last = canvas.size - 1;
  for (let i = 0; i <= last; i += 1) {
    canvas.set(i, 0, offset(edge, 8));
    canvas.set(0, i, offset(edge, 8));
    canvas.set(i, last, shade(edge, 0.85));
    canvas.set(last, i, shade(edge, 0.85));
  }
}

export function craftingTableTopArt(): TileArt {
  return (size, rng) =>
    bake(size, (canvas) => {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          canvas.set(x, y, offset(P.craftTop, (rng() * 2 - 1) * 4));
        }
      }
      for (const line of [5, 10]) {
        for (let i = 1; i < size - 1; i += 1) {
          canvas.set(line, i, jitter(P.craftLine, 3, rng));
          canvas.set(i, line, jitter(P.craftLine, 3, rng));
        }
      }
      for (const cx of [1, 6, 11]) {
        for (const cy of [1, 6, 11]) {
          canvas.set(cx, cy, offset(P.craftTop, 12)); // lit top-left corner of each grid cell
        }
      }
      frame(canvas, P.woodEdge);
    });
}

export function craftingTableSideArt(): TileArt {
  return (size, rng) =>
    bake(size, (canvas) => {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const column = x % 4 === 3 ? -7 : 0; // vertical board seams below the slab
          canvas.set(x, y, offset(P.craftSide, column + (rng() * 2 - 1) * 4));
        }
      }
      for (let x = 0; x < size; x += 1) {
        canvas.set(x, 0, offset(P.craftTop, 14));
        canvas.set(x, 1, jitter(P.craftTop, 3, rng));
        canvas.set(x, 2, jitter(P.craftTop, 3, rng));
        canvas.set(x, 3, shade(P.craftSide, 0.6));
      }
      // Hammer (left) and saw (right) hanging on the front.
      fillRect(canvas, 3, 6, 4, 2, P.steel);
      fillRect(canvas, 3, 6, 4, 1, P.steelLight);
      fillRect(canvas, 4, 8, 1, 5, P.woodEdge);
      fillRect(canvas, 9, 6, 4, 4, P.steel);
      fillRect(canvas, 9, 6, 4, 1, P.steelLight);
      for (let x = 9; x < 13; x += 2) {
        canvas.set(x, 10, P.steel);
      }
      fillRect(canvas, 12, 11, 1, 2, P.woodEdge);
      frame(canvas, P.woodEdge);
    });
}

export function chestTopArt(): TileArt {
  return (size, rng) =>
    bake(size, (canvas) => {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const seam = y === 5 || y === 10 ? -14 : 0;
          const lit = y === 6 || y === 11 ? 7 : 0;
          canvas.set(x, y, offset(P.chestTop, seam + lit + (rng() * 2 - 1) * 4));
        }
      }
      frame(canvas, P.chestEdge);
    });
}

export function chestSideArt(): TileArt {
  return (size, rng) =>
    bake(size, (canvas) => {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          let tone = (rng() * 2 - 1) * 4;
          if (y === 5) {
            tone -= 26; // lid seam
          } else if (y === 6) {
            tone -= 10; // shadow under the lid
          } else if (y === 9 || y === 12) {
            tone -= 9; // board lines
          }
          const strap = x === 2 || x === 13;
          canvas.set(x, y, offset(P.chestSide, strap ? tone - 14 : tone));
        }
      }
      for (let y = 0; y < size; y += 1) {
        canvas.set(3, y, offset(P.chestSide, 6)); // lit side of the left strap
      }
      fillRect(canvas, 6, 4, 4, 4, P.chestEdge);
      fillRect(canvas, 7, 5, 2, 2, P.latch);
      canvas.set(7, 5, P.latchLight);
      canvas.set(8, 6, P.chestEdge);
      frame(canvas, P.chestEdge);
    });
}
