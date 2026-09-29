import { BlockId } from '../blocks';
import type { OctaveConfig } from '../noise/valueNoise2D';

export interface OreVeinDefinition {
  readonly blockId: BlockId;
  readonly name: string;
  /** Inclusive world-Y band this ore can appear in (deeper = rarer/higher-value ore). */
  readonly minY: number;
  readonly maxY: number;
  /** 3D noise config shaping vein clumps; higher frequency = smaller/more frequent clumps. */
  readonly noise: OctaveConfig;
  /** Noise value must be >= this for the block to become ore; higher = rarer. */
  readonly threshold: number;
}

/**
 * Ore veins are carved out of Stone via 3D noise thresholding (clumpy blobs,
 * not single salt-and-pepper blocks): a Stone block becomes this ore only
 * when 3D value noise at its world position exceeds `threshold`, within its
 * Y band. Ordered common -> rare; first match wins if bands overlap.
 */
export const ORE_VEIN_DEFINITIONS: readonly OreVeinDefinition[] = [
  {
    blockId: BlockId.CoalOre,
    name: 'coal_ore',
    minY: 0,
    maxY: 90,
    noise: { octaves: 1, frequency: 1 / 8, amplitude: 1, lacunarity: 2, persistence: 0.5 },
    threshold: 0.82,
  },
  {
    blockId: BlockId.IronOre,
    name: 'iron_ore',
    minY: 0,
    maxY: 48,
    noise: { octaves: 1, frequency: 1 / 6, amplitude: 1, lacunarity: 2, persistence: 0.5 },
    threshold: 0.87,
  },
  {
    blockId: BlockId.GoldOre,
    name: 'gold_ore',
    minY: 0,
    maxY: 24,
    noise: { octaves: 1, frequency: 1 / 5, amplitude: 1, lacunarity: 2, persistence: 0.5 },
    threshold: 0.92,
  },
];
