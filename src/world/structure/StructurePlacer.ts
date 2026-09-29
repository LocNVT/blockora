import { latticeHash2D } from '../noise/valueNoise2D';
import type { BiomeDefinition } from '../biome/Biome';
import { STRUCTURE_TEMPLATES } from './templates';
import { structureBlockWorldPosition } from './stampStructure';
import type { StructureTemplate } from './StructureTemplate';
import { horizontalReach, rotatedExtent, toRotation, type Rotation } from './rotation';
import { STRUCTURE_CONFIG, WORLD_CONFIG } from '../../config/constants';

/** Distinct from every other noise/hash seed offset used elsewhere in world gen (one per hashed decision). */
const STRUCTURE_ACCEPT_SEED_OFFSET = 500;
const STRUCTURE_POS_X_SEED_OFFSET = 501;
const STRUCTURE_POS_Z_SEED_OFFSET = 502;
const STRUCTURE_ROTATION_SEED_OFFSET = 503;
const STRUCTURE_TEMPLATE_SEED_OFFSET = 504;

const ROTATION_COUNT = 4;

/** Pure terrain queries a site check may use (no neighbouring chunk data needed). WorldGenerator satisfies it. */
export interface TerrainQuery {
  biomeAt(worldX: number, worldZ: number): BiomeDefinition;
  surfaceHeight(worldX: number, worldZ: number, biome?: BiomeDefinition): number;
}

/** A region's hashed structure candidate before site validation. */
export interface StructureCandidate {
  readonly template: StructureTemplate;
  readonly regionX: number;
  readonly regionZ: number;
  /** World column the template anchor lands on. */
  readonly originX: number;
  readonly originZ: number;
  readonly rotation: Rotation;
}

/** A validated structure: candidate plus its floor height and world-space footprint (inclusive). */
export interface PlacedStructure extends StructureCandidate {
  /** World Y of the anchor (floor) layer. */
  readonly originY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export type SiteRejection = 'biome' | 'water' | 'slope';

export type SiteEvaluation =
  | { readonly ok: true; readonly floorY: number }
  | { readonly ok: false; readonly reason: SiteRejection };

/**
 * Deterministic region-grid structure placement. The XZ plane is split into
 * square regions of STRUCTURE_CONFIG.regionSizeChunks chunks; each region
 * has at most one candidate, whose acceptance, template, position and
 * rotation are independent hashes of (seed, region coords). Candidates are
 * inset by the template's reach so a footprint never leaves its region
 * (structures never overlap, and a region only affects chunks it overlaps).
 * Site validity uses only pure terrain queries, so any chunk can recompute
 * the structures around it in any generation order.
 */
export class StructurePlacer {
  private readonly seed: number;
  private readonly terrain: TerrainQuery;
  private readonly templates: readonly StructureTemplate[];
  private readonly regionWidth: number;
  private readonly regionDepth: number;

  constructor(
    seed: number,
    terrain: TerrainQuery,
    templates: readonly StructureTemplate[] = STRUCTURE_TEMPLATES,
  ) {
    this.seed = seed;
    this.terrain = terrain;
    this.templates = templates;
    this.regionWidth = STRUCTURE_CONFIG.regionSizeChunks * WORLD_CONFIG.chunkWidth;
    this.regionDepth = STRUCTURE_CONFIG.regionSizeChunks * WORLD_CONFIG.chunkDepth;
  }

  /** Region grid coordinate containing a world column. */
  regionOf(worldX: number, worldZ: number): { readonly regionX: number; readonly regionZ: number } {
    return {
      regionX: Math.floor(worldX / this.regionWidth),
      regionZ: Math.floor(worldZ / this.regionDepth),
    };
  }

  /** The region's hashed candidate, or null when the region rolls no structure. Ignores terrain. */
  candidateForRegion(regionX: number, regionZ: number): StructureCandidate | null {
    if (this.templates.length === 0) {
      return null;
    }
    const acceptRoll = latticeHash2D(this.seed + STRUCTURE_ACCEPT_SEED_OFFSET, regionX, regionZ);
    if (acceptRoll >= STRUCTURE_CONFIG.spawnChance) {
      return null;
    }

    const templateRoll = latticeHash2D(this.seed + STRUCTURE_TEMPLATE_SEED_OFFSET, regionX, regionZ);
    const template = this.templates[Math.floor(templateRoll * this.templates.length)];
    if (!template) {
      return null;
    }

    const reach = horizontalReach(template);
    const spanX = this.regionWidth - 2 * reach;
    const spanZ = this.regionDepth - 2 * reach;
    if (spanX <= 0 || spanZ <= 0) {
      return null;
    }

    const xRoll = latticeHash2D(this.seed + STRUCTURE_POS_X_SEED_OFFSET, regionX, regionZ);
    const zRoll = latticeHash2D(this.seed + STRUCTURE_POS_Z_SEED_OFFSET, regionX, regionZ);
    const rotationRoll = latticeHash2D(this.seed + STRUCTURE_ROTATION_SEED_OFFSET, regionX, regionZ);

    return {
      template,
      regionX,
      regionZ,
      originX: regionX * this.regionWidth + reach + Math.floor(xRoll * spanX),
      originZ: regionZ * this.regionDepth + reach + Math.floor(zRoll * spanZ),
      rotation: toRotation(Math.floor(rotationRoll * ROTATION_COUNT)),
    };
  }

  /**
   * Checks a site against the terrain: every footprint column must be in an
   * allowed biome, at least minSurfaceAboveSeaLevel above sea level, and the
   * footprint's height range must not exceed maxSlope. The floor sits one
   * block above the highest column, so the structure never cuts into terrain.
   */
  evaluateSite(
    template: StructureTemplate,
    originX: number,
    originZ: number,
    rotation: Rotation,
  ): SiteEvaluation {
    const extent = rotatedExtent(template, rotation);
    const minSurface = WORLD_CONFIG.seaLevel + STRUCTURE_CONFIG.minSurfaceAboveSeaLevel;
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;

    for (let x = originX + extent.minX; x <= originX + extent.maxX; x += 1) {
      for (let z = originZ + extent.minZ; z <= originZ + extent.maxZ; z += 1) {
        const biome = this.terrain.biomeAt(x, z);
        if (!template.allowedBiomes.includes(biome.id)) {
          return { ok: false, reason: 'biome' };
        }
        const surface = this.terrain.surfaceHeight(x, z, biome);
        if (surface < minSurface) {
          return { ok: false, reason: 'water' };
        }
        lowest = Math.min(lowest, surface);
        highest = Math.max(highest, surface);
      }
    }

    if (highest - lowest > STRUCTURE_CONFIG.maxSlope) {
      return { ok: false, reason: 'slope' };
    }
    return { ok: true, floorY: highest + 1 };
  }

  /** The region's validated structure, or null when it rolled none or its site is invalid. */
  structureInRegion(regionX: number, regionZ: number): PlacedStructure | null {
    const candidate = this.candidateForRegion(regionX, regionZ);
    if (!candidate) {
      return null;
    }
    const site = this.evaluateSite(
      candidate.template,
      candidate.originX,
      candidate.originZ,
      candidate.rotation,
    );
    if (!site.ok) {
      return null;
    }
    const extent = rotatedExtent(candidate.template, candidate.rotation);
    return {
      ...candidate,
      originY: site.floorY,
      minX: candidate.originX + extent.minX,
      maxX: candidate.originX + extent.maxX,
      minZ: candidate.originZ + extent.minZ,
      maxZ: candidate.originZ + extent.maxZ,
    };
  }

  /**
   * Every structure whose footprint intersects the inclusive world box
   * [minX, maxX] x [minZ, maxZ], in region scan order. Costs one candidate
   * check per region overlapping the box (footprints never leave their region).
   */
  structuresIntersecting(minX: number, minZ: number, maxX: number, maxZ: number): PlacedStructure[] {
    const from = this.regionOf(minX, minZ);
    const to = this.regionOf(maxX, maxZ);
    const found: PlacedStructure[] = [];

    for (let regionX = from.regionX; regionX <= to.regionX; regionX += 1) {
      for (let regionZ = from.regionZ; regionZ <= to.regionZ; regionZ += 1) {
        const structure = this.structureInRegion(regionX, regionZ);
        if (
          structure &&
          structure.maxX >= minX &&
          structure.minX <= maxX &&
          structure.maxZ >= minZ &&
          structure.minZ <= maxZ
        ) {
          found.push(structure);
        }
      }
    }
    return found;
  }

  /**
   * Loot table id of the structure chest at exactly (x, y, z), or null when no
   * structure places a loot container there. Pure seed query (no chunk data,
   * no generation-time state), so it answers the same however chunks loaded.
   */
  lootTableAt(x: number, y: number, z: number): string | null {
    for (const structure of this.structuresIntersecting(x, z, x, z)) {
      for (const block of structure.template.blocks) {
        if (block.lootTable === undefined) {
          continue;
        }
        const world = structureBlockWorldPosition(structure, block);
        if (world.x === x && world.y === y && world.z === z) {
          return block.lootTable;
        }
      }
    }
    return null;
  }
}

/** True when world column (x, z) lies within `structure`'s footprint grown by `margin` blocks. */
export function footprintContains(
  structure: PlacedStructure,
  worldX: number,
  worldZ: number,
  margin: number = 0,
): boolean {
  return (
    worldX >= structure.minX - margin &&
    worldX <= structure.maxX + margin &&
    worldZ >= structure.minZ - margin &&
    worldZ <= structure.maxZ + margin
  );
}
