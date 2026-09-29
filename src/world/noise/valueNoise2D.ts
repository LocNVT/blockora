const HASH_MASK = 0xffffffff;

/**
 * Deterministic integer hash (no external noise library, per project dependency
 * rules): same (seed, x, y) always maps to the same [0, 1) value, on any machine.
 */
function hash2D(seed: number, x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) & HASH_MASK;
  h = (h ^ (h >>> 13)) & HASH_MASK;
  h = Math.imul(h, 1274126177) & HASH_MASK;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * Deterministic per-integer-column uniform value in [0, 1), for discrete
 * yes/no decisions (e.g. "does a tree spawn at this exact column?"). Unlike
 * `valueNoise2D`, this is not smoothly interpolated between neighbours —
 * each integer (x, y) is an independent draw, which is what a placement
 * decision needs (a smooth field would cluster/exclude neighbours together).
 */
export function latticeHash2D(seed: number, x: number, y: number): number {
  return hash2D(seed, x, y);
}

/** Deterministic integer hash over 3 axes; same construction as `hash2D` with a third mixed-in coordinate. */
function hash3D(seed: number, x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2246822519 + seed * 2147483647) & HASH_MASK;
  h = (h ^ (h >>> 13)) & HASH_MASK;
  h = Math.imul(h, 1274126177) & HASH_MASK;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * Seeded 3D value noise, smoothly interpolated between integer lattice points
 * (trilinear). Same construction as `valueNoise2D`, extended to Y so it can
 * shape volumetric features (ore veins, caves) instead of only per-column
 * (2D) ones. Output range is [0, 1) and deterministic for a given (seed, x, y, z).
 */
export function valueNoise3D(seed: number, x: number, y: number, z: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;

  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const tz = smoothstep(z - z0);

  const v000 = hash3D(seed, x0, y0, z0);
  const v100 = hash3D(seed, x1, y0, z0);
  const v010 = hash3D(seed, x0, y1, z0);
  const v110 = hash3D(seed, x1, y1, z0);
  const v001 = hash3D(seed, x0, y0, z1);
  const v101 = hash3D(seed, x1, y0, z1);
  const v011 = hash3D(seed, x0, y1, z1);
  const v111 = hash3D(seed, x1, y1, z1);

  const x00 = lerp(v000, v100, tx);
  const x10 = lerp(v010, v110, tx);
  const x01 = lerp(v001, v101, tx);
  const x11 = lerp(v011, v111, tx);

  const y0Interp = lerp(x00, x10, ty);
  const y1Interp = lerp(x01, x11, ty);

  return lerp(y0Interp, y1Interp, tz);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Seeded 2D value noise, smoothly interpolated between integer lattice points.
 * Output range is [0, 1). Same seed + same (x, y) always produces the same
 * value, which is required for deterministic chunk generation.
 */
export function valueNoise2D(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);

  const v00 = hash2D(seed, x0, y0);
  const v10 = hash2D(seed, x1, y0);
  const v01 = hash2D(seed, x0, y1);
  const v11 = hash2D(seed, x1, y1);

  const top = lerp(v00, v10, tx);
  const bottom = lerp(v01, v11, tx);
  return lerp(top, bottom, ty);
}

export interface OctaveConfig {
  readonly octaves: number;
  readonly frequency: number;
  readonly amplitude: number;
  readonly lacunarity: number;
  readonly persistence: number;
}

/**
 * Fractal (fBm-style) sum of `valueNoise2D` octaves, normalized to [0, 1).
 * A distinct `seed` per call (rather than reusing one seed with different
 * layer indices) keeps unrelated noise layers (height vs detail) uncorrelated.
 */
export function fractalNoise2D(seed: number, x: number, y: number, config: OctaveConfig): number {
  const { octaves, frequency, amplitude, lacunarity, persistence } = config;

  let total = 0;
  let freq = frequency;
  let amp = amplitude;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i += 1) {
    total += valueNoise2D(seed, x * freq, y * freq) * amp;
    maxAmplitude += amp;
    freq *= lacunarity;
    amp *= persistence;
  }

  return maxAmplitude > 0 ? total / maxAmplitude : 0;
}

/** 3D counterpart of `fractalNoise2D`, summing `valueNoise3D` octaves, normalized to [0, 1). */
export function fractalNoise3D(
  seed: number,
  x: number,
  y: number,
  z: number,
  config: OctaveConfig,
): number {
  const { octaves, frequency, amplitude, lacunarity, persistence } = config;

  let total = 0;
  let freq = frequency;
  let amp = amplitude;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i += 1) {
    total += valueNoise3D(seed, x * freq, y * freq, z * freq) * amp;
    maxAmplitude += amp;
    freq *= lacunarity;
    amp *= persistence;
  }

  return maxAmplitude > 0 ? total / maxAmplitude : 0;
}
