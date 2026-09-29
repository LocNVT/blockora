import { fractalNoise3D } from '../noise/valueNoise2D';
import { WORLD_GEN_CONFIG } from '../../config/constants';

/** Distinct from every other noise/hash seed offset used elsewhere in world gen. */
const CAVE_SEED_OFFSET = 400;

/**
 * Deterministic cave carving: given a deep-stone block's world position and
 * the ground surface height of its column, decides whether it becomes open
 * air (a cave pocket) instead. 3D noise thresholding produces connected,
 * blob-like pockets rather than uniform salt-and-pepper holes. Purely a
 * function of (seed, position) — no shared state, so it is safe to call
 * independently per-block during chunk generation.
 */
export class CavePlacer {
  private readonly seed: number;

  constructor(seed: number = WORLD_GEN_CONFIG.defaultSeed) {
    this.seed = seed;
  }

  /** True when the deep-stone block at this position should be carved into cave air. */
  isCaveAt(worldX: number, worldY: number, worldZ: number, surfaceY: number): boolean {
    const { caveNoise, caveThreshold, caveSurfaceMargin } = WORLD_GEN_CONFIG;

    if (worldY > surfaceY - caveSurfaceMargin) {
      return false;
    }

    const value = fractalNoise3D(this.seed + CAVE_SEED_OFFSET, worldX, worldY, worldZ, caveNoise);
    return value >= caveThreshold;
  }
}
