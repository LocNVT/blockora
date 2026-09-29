import { BlockId } from '../blocks';

/**
 * Biome ids are used only for in-memory generation decisions (not persisted
 * in chunk data), so free ordering/renumbering is safe.
 */
export const BiomeId = {
  Plains: 0,
  Forest: 1,
  Desert: 2,
  Taiga: 3,
  Mountains: 4,
  Swamp: 5,
} as const;

export type BiomeId = (typeof BiomeId)[keyof typeof BiomeId];

export interface BiomeDefinition {
  readonly id: BiomeId;
  readonly name: string;
  /** Topsoil block (replaces Grass) for columns in this biome. */
  readonly surfaceBlock: BlockId;
  /** Subsoil block (replaces Dirt) for columns in this biome. */
  readonly subsurfaceBlock: BlockId;
  /** Added to WORLD_GEN_CONFIG.baseHeight before height noise is applied. */
  readonly heightOffset: number;
  /** Multiplies WORLD_GEN_CONFIG.heightAmplitude (>1 = rougher terrain, <1 = flatter). */
  readonly heightAmplitudeScale: number;
}

export const BIOME_DEFINITIONS: readonly BiomeDefinition[] = [
  {
    id: BiomeId.Plains,
    name: 'plains',
    surfaceBlock: BlockId.Grass,
    subsurfaceBlock: BlockId.Dirt,
    heightOffset: 0,
    heightAmplitudeScale: 0.5,
  },
  {
    id: BiomeId.Forest,
    name: 'forest',
    surfaceBlock: BlockId.Grass,
    subsurfaceBlock: BlockId.Dirt,
    heightOffset: 2,
    heightAmplitudeScale: 0.8,
  },
  {
    id: BiomeId.Desert,
    name: 'desert',
    surfaceBlock: BlockId.Sand,
    subsurfaceBlock: BlockId.Sand,
    heightOffset: -2,
    heightAmplitudeScale: 0.6,
  },
  {
    id: BiomeId.Taiga,
    name: 'taiga',
    surfaceBlock: BlockId.Grass,
    subsurfaceBlock: BlockId.Dirt,
    heightOffset: 4,
    heightAmplitudeScale: 0.9,
  },
  {
    id: BiomeId.Mountains,
    name: 'mountains',
    surfaceBlock: BlockId.Stone,
    subsurfaceBlock: BlockId.Stone,
    heightOffset: 18,
    heightAmplitudeScale: 2,
  },
  {
    id: BiomeId.Swamp,
    name: 'swamp',
    surfaceBlock: BlockId.Dirt,
    subsurfaceBlock: BlockId.Gravel,
    heightOffset: -6,
    heightAmplitudeScale: 0.3,
  },
];

const BIOME_BY_ID: readonly BiomeDefinition[] = (() => {
  const table: BiomeDefinition[] = [];
  for (const def of BIOME_DEFINITIONS) {
    table[def.id] = def;
  }
  return table;
})();

export function getBiomeDefinition(id: BiomeId): BiomeDefinition {
  const def = BIOME_BY_ID[id];
  if (!def) {
    throw new RangeError(`getBiomeDefinition: unknown biome id ${id}.`);
  }
  return def;
}
