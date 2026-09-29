import { BiomeId } from './Biome';

/**
 * Probability (per eligible surface column) that a tree spawns there, keyed by
 * biome. Biomes without a listed entry (Desert, Mountains, Swamp) get no trees
 * in the MVP — no cactus/mangrove-style block exists yet, and stamping normal
 * trees on stone/sand would look wrong.
 */
export const TREE_DENSITY_BY_BIOME: Partial<Record<BiomeId, number>> = {
  [BiomeId.Plains]: 0.01,
  [BiomeId.Forest]: 0.08,
  [BiomeId.Taiga]: 0.05,
};

export function treeDensityFor(biomeId: BiomeId): number {
  return TREE_DENSITY_BY_BIOME[biomeId] ?? 0;
}
