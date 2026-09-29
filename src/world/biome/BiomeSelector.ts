import { BiomeId, type BiomeDefinition, getBiomeDefinition } from './Biome';
import { fractalNoise2D } from '../noise/valueNoise2D';
import { WORLD_GEN_CONFIG } from '../../config/constants';

/** Distinct seed offsets keep temperature/moisture uncorrelated with each other and the terrain noise. */
const TEMPERATURE_SEED_OFFSET = 100;
const MOISTURE_SEED_OFFSET = 101;

/**
 * Deterministic biome classification from low-frequency temperature/moisture
 * noise (Whittaker-style thresholds), independent of the terrain height noise
 * so biome regions span many chunks. Same seed + world column always yields
 * the same biome.
 */
export class BiomeSelector {
  private readonly seed: number;

  constructor(seed: number = WORLD_GEN_CONFIG.defaultSeed) {
    this.seed = seed;
  }

  temperatureAt(worldX: number, worldZ: number): number {
    return fractalNoise2D(
      this.seed + TEMPERATURE_SEED_OFFSET,
      worldX,
      worldZ,
      WORLD_GEN_CONFIG.biomeNoise,
    );
  }

  moistureAt(worldX: number, worldZ: number): number {
    return fractalNoise2D(
      this.seed + MOISTURE_SEED_OFFSET,
      worldX,
      worldZ,
      WORLD_GEN_CONFIG.biomeNoise,
    );
  }

  biomeIdAt(worldX: number, worldZ: number): BiomeId {
    const temperature = this.temperatureAt(worldX, worldZ);
    const moisture = this.moistureAt(worldX, worldZ);
    const { coldThreshold, hotThreshold, wetThreshold } = WORLD_GEN_CONFIG.biomeThresholds;

    if (temperature < coldThreshold) {
      return moisture >= wetThreshold ? BiomeId.Taiga : BiomeId.Mountains;
    }
    if (temperature >= hotThreshold) {
      return moisture >= wetThreshold ? BiomeId.Swamp : BiomeId.Desert;
    }
    return moisture >= wetThreshold ? BiomeId.Forest : BiomeId.Plains;
  }

  biomeAt(worldX: number, worldZ: number): BiomeDefinition {
    return getBiomeDefinition(this.biomeIdAt(worldX, worldZ));
  }
}
