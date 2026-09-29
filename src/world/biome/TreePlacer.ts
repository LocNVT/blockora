import { BlockId } from '../blocks';
import { latticeHash2D } from '../noise/valueNoise2D';
import { treeDensityFor } from './treeDensity';
import type { BiomeId } from './Biome';
import { WORLD_GEN_CONFIG } from '../../config/constants';

/** Distinct from every other noise/hash seed offset used elsewhere in world gen. */
const TREE_SPAWN_SEED_OFFSET = 200;

export interface TreeShape {
  /** Trunk height in blocks, not counting the ground block the trunk stands on. */
  readonly trunkHeight: number;
  /** Canopy radius (blocks) on the X/Z plane around the trunk, at each canopy layer. */
  readonly canopyRadius: number;
  /** How many of the topmost trunk blocks (inclusive of the very top) get a canopy layer. */
  readonly canopyLayers: number;
}

const TREE_SHAPE: TreeShape = {
  trunkHeight: 4,
  canopyRadius: 2,
  canopyLayers: 3,
};

/** Largest horizontal distance (blocks) a tree rooted at some column can affect — for chunk padding. */
export const TREE_MAX_HORIZONTAL_REACH = TREE_SHAPE.canopyRadius;

/**
 * Deterministic tree placement: whether a tree is rooted at a given world
 * column, and the trunk/canopy blocks it contributes (which may spill into
 * neighbouring chunks). Purely a function of (seed, biome, column) — no
 * shared/mutable state, so any chunk can independently recompute the trees
 * of its neighbours to stamp the overlapping canopy blocks.
 */
export class TreePlacer {
  private readonly seed: number;

  constructor(seed: number = WORLD_GEN_CONFIG.defaultSeed) {
    this.seed = seed;
  }

  /** True when a tree is rooted (trunk base) at this exact world column, for this biome. */
  isTreeSpawn(worldX: number, worldZ: number, biomeId: BiomeId): boolean {
    const density = treeDensityFor(biomeId);
    if (density <= 0) {
      return false;
    }
    const roll = latticeHash2D(this.seed + TREE_SPAWN_SEED_OFFSET, worldX, worldZ);
    return roll < density;
  }

  /**
   * Blocks a tree rooted at (worldX, groundY, worldZ) contributes, as world-space
   * offsets from the root column's surface block. `groundY` is the world Y of the
   * topmost solid ground block (the trunk starts at groundY + 1).
   */
  treeBlocks(): ReadonlyArray<{ dx: number; dy: number; dz: number; blockId: BlockId }> {
    const { trunkHeight, canopyRadius, canopyLayers } = TREE_SHAPE;
    const blocks: { dx: number; dy: number; dz: number; blockId: BlockId }[] = [];

    for (let dy = 1; dy <= trunkHeight; dy += 1) {
      blocks.push({ dx: 0, dy, dz: 0, blockId: BlockId.Wood });
    }

    const canopyBaseY = trunkHeight - canopyLayers + 1;
    for (let layer = 0; layer < canopyLayers; layer += 1) {
      const dy = canopyBaseY + layer;
      const isTopLayer = layer === canopyLayers - 1;
      const radius = isTopLayer ? Math.max(0, canopyRadius - 1) : canopyRadius;

      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (dx === 0 && dz === 0 && dy <= trunkHeight) {
            continue; // trunk already occupies this cell
          }
          blocks.push({ dx, dy, dz, blockId: BlockId.Leaves });
        }
      }
    }

    return blocks;
  }
}
