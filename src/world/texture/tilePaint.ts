/**
 * Small pixel-art helpers shared by the procedural tile painters: colour
 * maths, a per-tile drawing surface, wrapped value noise and a wrapped
 * cell (Voronoi) partition. Pure and deterministic given the PRNG passed in;
 * no Three.js, no DOM.
 */

const BYTE_MAX = 255;

/** RGBA color as bytes (0-255 each), the unit painters work in. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** A painter returns one pixel's color given its tile-local (x, y). */
export type Painter = (x: number, y: number, tileSize: number, rng: () => number) => Rgba;

/** Builds a painter for one tile: gets the tile size and that tile's own PRNG. */
export type TileArt = (tileSize: number, rng: () => number) => Painter;

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

export function clampByte(value: number): number {
  return Math.max(0, Math.min(BYTE_MAX, Math.round(value)));
}

/** Builds an opaque (or explicitly translucent) colour from channel values. */
export function rgba(r: number, g: number, b: number, a = BYTE_MAX): Rgba {
  return { r, g, b, a };
}

/** Nudges each channel of `base` by up to +-`amount` using `rng`. */
export function jitter(base: Rgba, amount: number, rng: () => number): Rgba {
  const delta = (): number => (rng() * 2 - 1) * amount;
  return rgba(clampByte(base.r + delta()), clampByte(base.g + delta()), clampByte(base.b + delta()), base.a);
}

/** Adds the same signed offset to every colour channel (a luminance nudge); alpha untouched. */
export function offset(base: Rgba, amount: number): Rgba {
  return rgba(clampByte(base.r + amount), clampByte(base.g + amount), clampByte(base.b + amount), base.a);
}

/** Multiplies rgb by `factor` (<1 darkens, >1 lightens); alpha untouched. */
export function shade(base: Rgba, factor: number): Rgba {
  return rgba(clampByte(base.r * factor), clampByte(base.g * factor), clampByte(base.b * factor), base.a);
}

/** Linear blend from `a` to `b` by `t` in [0, 1]; alpha follows `a`. */
export function mixColors(a: Rgba, b: Rgba, t: number): Rgba {
  return rgba(
    clampByte(a.r + (b.r - a.r) * t),
    clampByte(a.g + (b.g - a.g) * t),
    clampByte(a.b + (b.b - a.b) * t),
    a.a,
  );
}

/** Tile-sized drawing surface, initialised transparent. */
export class TileCanvas {
  private readonly pixels: Rgba[];

  constructor(readonly size: number) {
    this.pixels = new Array<Rgba>(size * size).fill(TRANSPARENT);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  set(x: number, y: number, color: Rgba): void {
    if (this.inside(x, y)) {
      this.pixels[y * this.size + x] = color;
    }
  }

  get(x: number, y: number): Rgba {
    return this.pixels[y * this.size + x] ?? TRANSPARENT;
  }

  /** Painter view over the finished canvas. */
  toPainter(): Painter {
    return (x, y): Rgba => this.get(x, y);
  }
}

/** Runs `draw` once against a fresh canvas and returns the result as a painter. */
export function bake(size: number, draw: (canvas: TileCanvas) => void): Painter {
  const canvas = new TileCanvas(size);
  draw(canvas);
  return canvas.toPainter();
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/**
 * Seamlessly wrapping value noise in [-1, 1], `cells` x `cells` lattice
 * bilinearly (smoothstep) interpolated to `size` x `size` samples.
 */
export function valueNoise(size: number, cells: number, rng: () => number): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) {
    lattice[i] = rng() * 2 - 1;
  }
  const field = new Float32Array(size * size);
  const at = (cx: number, cy: number): number => lattice[wrapIndex(cy, cells) * cells + wrapIndex(cx, cells)] ?? 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      field[y * size + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return field;
}

/** Result of a nearest-cell query: owning cell and the gap between the two nearest cell centres. */
export interface CellSample {
  readonly cell: number;
  /** Distance to the second-nearest centre minus distance to the nearest: small near cell borders. */
  readonly edge: number;
  /** Offset from the owning centre to the pixel (x right, y down), wrapped to the shortest way round. */
  readonly dx: number;
  readonly dy: number;
}

/** Wrapped jittered-grid cell partition (`cells` x `cells` centres), for stones / pebbles. */
export function cellPartition(
  size: number,
  cells: number,
  jitterAmount: number,
  rng: () => number,
): (x: number, y: number) => CellSample {
  const step = size / cells;
  const centres: { x: number; y: number }[] = [];
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      centres.push({
        x: (cx + 0.5) * step + (rng() * 2 - 1) * jitterAmount,
        y: (cy + 0.5) * step + (rng() * 2 - 1) * jitterAmount,
      });
    }
  }
  const wrapDelta = (d: number): number => {
    const half = size / 2;
    return d > half ? d - size : d < -half ? d + size : d;
  };
  return (x, y): CellSample => {
    const px = x + 0.5;
    const py = y + 0.5;
    let best = Infinity;
    let second = Infinity;
    let bestCell = 0;
    let bestDx = 0;
    let bestDy = 0;
    centres.forEach((c, index) => {
      const dx = wrapDelta(px - c.x);
      const dy = wrapDelta(py - c.y);
      const d = Math.hypot(dx, dy);
      if (d < best) {
        second = best;
        best = d;
        bestCell = index;
        bestDx = dx;
        bestDy = dy;
      } else if (d < second) {
        second = d;
      }
    });
    return { cell: bestCell, edge: second - best, dx: bestDx, dy: bestDy };
  };
}

/** Tiny deterministic integer hash to a float in [0, 1): stable per-cell values without touching the PRNG stream. */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 65536) / 65536;
}
