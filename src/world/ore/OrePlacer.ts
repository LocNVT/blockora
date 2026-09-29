import { BlockId } from '../blocks';
import { fractalNoise3D } from '../noise/valueNoise2D';
import { ORE_VEIN_DEFINITIONS } from './OreVein';
import { WORLD_GEN_CONFIG } from '../../config/constants';

/** Distinct from every other noise/hash seed offset used elsewhere in world gen. */
const ORE_SEED_OFFSET = 300;

/**
 * Deterministic ore vein placement: given a Stone block's world position,
 * decides whether it becomes an ore instead (3D noise thresholding per ore
 * type, clumping into vein-like blobs rather than uniform salt-and-pepper).
 * Purely a function of (seed, world position) — no shared state, so it is
 * safe to call independently per-block during chunk generation.
 */
export class OrePlacer {
  private readonly seed: number;

  constructor(seed: number = WORLD_GEN_CONFIG.defaultSeed) {
    this.seed = seed;
  }

  /** Returns the ore BlockId that should replace Stone at this position, or null for plain Stone. */
  oreAt(worldX: number, worldY: number, worldZ: number): BlockId | null {
    for (let i = 0; i < ORE_VEIN_DEFINITIONS.length; i += 1) {
      const vein = ORE_VEIN_DEFINITIONS[i];
      if (!vein || worldY < vein.minY || worldY > vein.maxY) {
        continue;
      }

      const value = fractalNoise3D(
        this.seed + ORE_SEED_OFFSET + i,
        worldX,
        worldY,
        worldZ,
        vein.noise,
      );

      if (value >= vein.threshold) {
        return vein.blockId;
      }
    }

    return null;
  }
}
