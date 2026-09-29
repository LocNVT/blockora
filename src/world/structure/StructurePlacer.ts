import { latticeHash2D } from '../noise/valueNoise2D';
import type { BiomeDefinition } from '../biome/Biome';
import { STRUCTURE_TEMPLATES, VILLAGE_BIOMES } from './templates';
import { structureBlockWorldPosition } from './stampStructure';
import type { StructureTemplate } from './StructureTemplate';
import { horizontalReach, rotatedExtent, toRotation, type Rotation } from './rotation';
import { planVillage, villageReach, type FootprintBox, type VillagePlan } from './villageLayout';
import { mulberry32 } from '../../util/mulberry32';
import { STRUCTURE_CONFIG, WORLD_CONFIG } from '../../config/constants';

export type { FootprintBox } from './villageLayout';

/** Distinct from every other noise/hash seed offset used elsewhere in world gen (one per hashed decision). */
const STRUCTURE_ACCEPT_SEED_OFFSET = 500;
const STRUCTURE_POS_X_SEED_OFFSET = 501;
const STRUCTURE_POS_Z_SEED_OFFSET = 502;
const STRUCTURE_ROTATION_SEED_OFFSET = 503;
const STRUCTURE_TEMPLATE_SEED_OFFSET = 504;
const STRUCTURE_DEPTH_SEED_OFFSET = 505;
const VILLAGE_SHARE_SEED_OFFSET = 506;
const VILLAGE_LAYOUT_SEED_OFFSET = 507;
const UINT32_RANGE = 4294967296;

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

/** `depth`: terrain too low to bury an underground template at the required depth. */
export type SiteRejection = 'biome' | 'water' | 'slope' | 'depth';

export type SiteEvaluation =
  | { readonly ok: true; readonly floorY: number }
  | { readonly ok: false; readonly reason: SiteRejection };

/**
 * Everything one region contributes: no pieces, one ruin/dungeon, or a
 * village (centrepiece + houses, all `surface` pieces) with its path
 * segments (1-wide inclusive boxes whose columns get VILLAGE_PATH_BLOCK as
 * their top terrain block). Pieces never overlap each other or any path.
 */
export interface RegionLayout {
  readonly pieces: readonly PlacedStructure[];
  readonly paths: readonly FootprintBox[];
}

export type VillageEvaluation =
  | { readonly ok: true; readonly layout: RegionLayout }
  | { readonly ok: false; readonly reason: SiteRejection };

const EMPTY_LAYOUT: RegionLayout = { pieces: [], paths: [] };

type FootprintScan =
  | { readonly ok: true; readonly lowest: number; readonly highest: number }
  | { readonly ok: false; readonly reason: SiteRejection };

/**
 * Deterministic region-grid structure placement. The XZ plane is split into
 * square regions of STRUCTURE_CONFIG.regionSizeChunks chunks; each region
 * has at most one candidate, whose acceptance, template, position and
 * rotation are independent hashes of (seed, region coords). Candidates are
 * inset by the template's reach so a footprint never leaves its region
 * (structures never overlap, and a region only affects chunks it overlaps).
 * Surface (ruin) and underground (dungeon) templates share this one grid —
 * the template hash picks which one a region gets — so the same guarantee
 * keeps ruins and dungeons apart. A share of accepted regions first tries a
 * village (a composite of several pieces planned by planVillage, inset by
 * the whole village reach); if its site is rejected the region falls back
 * to its ruin/dungeon candidate.
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

  /** Whether the region's hashed structure roll accepts a candidate at all (spawnChance). */
  private regionAccepted(regionX: number, regionZ: number): boolean {
    return latticeHash2D(this.seed + STRUCTURE_ACCEPT_SEED_OFFSET, regionX, regionZ) < STRUCTURE_CONFIG.spawnChance;
  }

  /** World column picked by the region's position hashes, inset by `reach` so anything within it stays inside the region. */
  private regionPosition(regionX: number, regionZ: number, reach: number): { x: number; z: number } | null {
    const spanX = this.regionWidth - 2 * reach;
    const spanZ = this.regionDepth - 2 * reach;
    if (spanX <= 0 || spanZ <= 0) {
      return null;
    }
    const xRoll = latticeHash2D(this.seed + STRUCTURE_POS_X_SEED_OFFSET, regionX, regionZ);
    const zRoll = latticeHash2D(this.seed + STRUCTURE_POS_Z_SEED_OFFSET, regionX, regionZ);
    return {
      x: regionX * this.regionWidth + reach + Math.floor(xRoll * spanX),
      z: regionZ * this.regionDepth + reach + Math.floor(zRoll * spanZ),
    };
  }

  /** The region's hashed candidate, or null when the region rolls no structure. Ignores terrain. */
  candidateForRegion(regionX: number, regionZ: number): StructureCandidate | null {
    if (this.templates.length === 0) {
      return null;
    }
    if (!this.regionAccepted(regionX, regionZ)) {
      return null;
    }

    const templateRoll = latticeHash2D(this.seed + STRUCTURE_TEMPLATE_SEED_OFFSET, regionX, regionZ);
    const template = this.templates[Math.floor(templateRoll * this.templates.length)];
    if (!template) {
      return null;
    }

    const origin = this.regionPosition(regionX, regionZ, horizontalReach(template));
    if (!origin) {
      return null;
    }
    const rotationRoll = latticeHash2D(this.seed + STRUCTURE_ROTATION_SEED_OFFSET, regionX, regionZ);

    return {
      template,
      regionX,
      regionZ,
      originX: origin.x,
      originZ: origin.z,
      rotation: toRotation(Math.floor(rotationRoll * ROTATION_COUNT)),
    };
  }

  /**
   * The region's hashed village plan, or null when the region is not
   * accepted, does not roll a village (STRUCTURE_CONFIG.village.share) or
   * the plan fits too few houses. Ignores terrain.
   */
  villagePlanForRegion(regionX: number, regionZ: number): VillagePlan | null {
    if (!this.regionAccepted(regionX, regionZ)) {
      return null;
    }
    if (latticeHash2D(this.seed + VILLAGE_SHARE_SEED_OFFSET, regionX, regionZ) >= STRUCTURE_CONFIG.village.share) {
      return null;
    }
    const centre = this.regionPosition(regionX, regionZ, villageReach());
    if (!centre) {
      return null;
    }
    const layoutHash = latticeHash2D(this.seed + VILLAGE_LAYOUT_SEED_OFFSET, regionX, regionZ);
    return planVillage(mulberry32(Math.floor(layoutHash * UINT32_RANGE)), centre.x, centre.z);
  }

  /**
   * Site check for a whole village (pure terrain queries): every piece must
   * pass the surface rules with the stricter village.maxPieceSlope (floor
   * one above its own highest column), all piece footprints together must
   * span at most village.maxAreaSlope, and every path column must be in a
   * village biome and dry (surface >= seaLevel + minSurfaceAboveSeaLevel).
   * Pieces are checked centrepiece first, so most unsuitable terrain is
   * rejected after a few columns.
   */
  evaluateVillage(plan: VillagePlan, regionX: number, regionZ: number): VillageEvaluation {
    const { maxPieceSlope, maxAreaSlope } = STRUCTURE_CONFIG.village;
    const pieces: PlacedStructure[] = [];
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;

    for (const piece of plan.pieces) {
      const scan = this.scanFootprint(piece.template, piece.originX, piece.originZ, piece.rotation);
      if (!scan.ok) {
        return scan;
      }
      if (scan.highest - scan.lowest > maxPieceSlope) {
        return { ok: false, reason: 'slope' };
      }
      lowest = Math.min(lowest, scan.lowest);
      highest = Math.max(highest, scan.highest);
      pieces.push(placeCandidate({ ...piece, regionX, regionZ }, scan.highest + 1));
    }
    if (highest - lowest > maxAreaSlope) {
      return { ok: false, reason: 'slope' };
    }

    const minSurface = WORLD_CONFIG.seaLevel + STRUCTURE_CONFIG.minSurfaceAboveSeaLevel;
    for (const path of plan.paths) {
      for (let x = path.minX; x <= path.maxX; x += 1) {
        for (let z = path.minZ; z <= path.maxZ; z += 1) {
          const biome = this.terrain.biomeAt(x, z);
          if (!VILLAGE_BIOMES.includes(biome.id)) {
            return { ok: false, reason: 'biome' };
          }
          if (this.terrain.surfaceHeight(x, z, biome) < minSurface) {
            return { ok: false, reason: 'water' };
          }
        }
      }
    }
    return { ok: true, layout: { pieces, paths: plan.paths } };
  }

  /**
   * Checks a site against the terrain and picks its floor height. Every
   * footprint column must be in an allowed biome and dry enough (surface:
   * at least minSurfaceAboveSeaLevel above sea level; underground: no water
   * above, see STRUCTURE_CONFIG.underground). Surface templates also reject
   * a height range above maxSlope and sit one block above the highest
   * column, so they never cut into terrain. Underground templates are buried
   * below the lowest column (see undergroundFloor). Pure: terrain queries
   * and seed hashes only.
   */
  evaluateSite(
    template: StructureTemplate,
    originX: number,
    originZ: number,
    rotation: Rotation,
  ): SiteEvaluation {
    const scan = this.scanFootprint(template, originX, originZ, rotation);
    if (!scan.ok) {
      return scan;
    }
    if (template.placement === 'underground') {
      return this.undergroundFloor(template, originX, originZ, scan.lowest);
    }
    if (scan.highest - scan.lowest > STRUCTURE_CONFIG.maxSlope) {
      return { ok: false, reason: 'slope' };
    }
    return { ok: true, floorY: scan.highest + 1 };
  }

  /** Biome/water check of every footprint column, plus the footprint's surface height range. */
  private scanFootprint(
    template: StructureTemplate,
    originX: number,
    originZ: number,
    rotation: Rotation,
  ): FootprintScan {
    const extent = rotatedExtent(template, rotation);
    const minAboveSea =
      template.placement === 'underground'
        ? STRUCTURE_CONFIG.underground.minSurfaceAboveSeaLevel
        : STRUCTURE_CONFIG.minSurfaceAboveSeaLevel;
    const minSurface = WORLD_CONFIG.seaLevel + minAboveSea;
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
    return { ok: true, lowest, highest };
  }

  /**
   * Floor height for an underground template: the shallowest allowed floor
   * keeps the template's top layer ceilingBelowSurface blocks under the
   * lowest footprint surface; the floor is hashed (seed + origin) up to
   * depthRange blocks deeper, clamped at minFloorY. Rejects terrain too low
   * for even the shallowest floor.
   */
  private undergroundFloor(
    template: StructureTemplate,
    originX: number,
    originZ: number,
    lowestSurface: number,
  ): SiteEvaluation {
    const { ceilingBelowSurface, minFloorY, depthRange } = STRUCTURE_CONFIG.underground;
    const layersAboveFloor = template.size.height - 1 - template.anchor.y;
    const shallowest = lowestSurface - ceilingBelowSurface - layersAboveFloor;
    if (shallowest < minFloorY) {
      return { ok: false, reason: 'depth' };
    }
    const deepest = Math.max(minFloorY, shallowest - depthRange);
    const depthRoll = latticeHash2D(this.seed + STRUCTURE_DEPTH_SEED_OFFSET, originX, originZ);
    return { ok: true, floorY: shallowest - Math.floor(depthRoll * (shallowest - deepest + 1)) };
  }

  /**
   * Everything the region places: a valid village when it rolls one and the
   * site passes, else its validated ruin/dungeon (if any). Pure; costs at
   * most one village evaluation plus one single-template evaluation.
   */
  layoutForRegion(regionX: number, regionZ: number): RegionLayout {
    const plan = this.villagePlanForRegion(regionX, regionZ);
    if (plan) {
      const village = this.evaluateVillage(plan, regionX, regionZ);
      if (village.ok) {
        return village.layout;
      }
    }
    const candidate = this.candidateForRegion(regionX, regionZ);
    if (!candidate) {
      return EMPTY_LAYOUT;
    }
    const site = this.evaluateSite(
      candidate.template,
      candidate.originX,
      candidate.originZ,
      candidate.rotation,
    );
    if (!site.ok) {
      return EMPTY_LAYOUT;
    }
    return { pieces: [placeCandidate(candidate, site.floorY)], paths: [] };
  }

  /**
   * Pieces and path segments intersecting the inclusive world box
   * [minX, maxX] x [minZ, maxZ], in region scan order. Costs one region
   * layout per region overlapping the box (nothing ever leaves its region).
   */
  layoutIntersecting(minX: number, minZ: number, maxX: number, maxZ: number): RegionLayout {
    const box: FootprintBox = { minX, maxX, minZ, maxZ };
    const from = this.regionOf(minX, minZ);
    const to = this.regionOf(maxX, maxZ);
    const pieces: PlacedStructure[] = [];
    const paths: FootprintBox[] = [];

    for (let regionX = from.regionX; regionX <= to.regionX; regionX += 1) {
      for (let regionZ = from.regionZ; regionZ <= to.regionZ; regionZ += 1) {
        const layout = this.layoutForRegion(regionX, regionZ);
        pieces.push(...layout.pieces.filter((piece) => boxesIntersect(piece, box)));
        paths.push(...layout.paths.filter((path) => boxesIntersect(path, box)));
      }
    }
    return { pieces, paths };
  }

  /** Every placed piece (ruin, dungeon or village piece) whose footprint intersects the inclusive world box. */
  structuresIntersecting(minX: number, minZ: number, maxX: number, maxZ: number): PlacedStructure[] {
    return [...this.layoutIntersecting(minX, minZ, maxX, maxZ).pieces];
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

/** Validated candidate with its floor height and world footprint. */
function placeCandidate(candidate: StructureCandidate, floorY: number): PlacedStructure {
  const extent = rotatedExtent(candidate.template, candidate.rotation);
  return {
    ...candidate,
    originY: floorY,
    minX: candidate.originX + extent.minX,
    maxX: candidate.originX + extent.maxX,
    minZ: candidate.originZ + extent.minZ,
    maxZ: candidate.originZ + extent.maxZ,
  };
}

function boxesIntersect(a: FootprintBox, b: FootprintBox): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxZ >= b.minZ && a.minZ <= b.maxZ;
}

/** True when world column (x, z) lies within `box` (a footprint or path segment) grown by `margin` blocks. */
export function footprintContains(
  box: FootprintBox,
  worldX: number,
  worldZ: number,
  margin: number = 0,
): boolean {
  return (
    worldX >= box.minX - margin &&
    worldX <= box.maxX + margin &&
    worldZ >= box.minZ - margin &&
    worldZ <= box.maxZ + margin
  );
}
