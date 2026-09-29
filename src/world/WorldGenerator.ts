import { BlockId } from './blocks';
import { Chunk } from './Chunk';
import { CHUNK_VOLUME, isInsideChunk, localIndex } from './chunkCoords';
import { fractalNoise2D } from './noise/valueNoise2D';
import { BiomeSelector } from './biome/BiomeSelector';
import { TreePlacer, TREE_MAX_HORIZONTAL_REACH } from './biome/TreePlacer';
import type { BiomeDefinition } from './biome/Biome';
import { OrePlacer } from './ore/OrePlacer';
import { CavePlacer } from './cave/CavePlacer';
import { StructurePlacer, footprintContains, type PlacedStructure } from './structure/StructurePlacer';
import { stampStructure } from './structure/stampStructure';
import { WORLD_CONFIG, WORLD_GEN_CONFIG } from '../config/constants';

const { chunkWidth, chunkDepth, chunkHeight, seaLevel } = WORLD_CONFIG;

/** Distinct offsets keep the height and detail noise layers uncorrelated for a given seed. */
const HEIGHT_SEED_OFFSET = 0;
const DETAIL_SEED_OFFSET = 1;

/** Beach band: surface at or below this height (and at/above sea level) becomes sand. */
const BEACH_HEIGHT_MARGIN = 1;

/**
 * Structure lookup padding around a chunk: a tree rooted up to
 * TREE_MAX_HORIZONTAL_REACH outside the chunk is suppressed when its root is
 * within TREE_MAX_HORIZONTAL_REACH of a structure footprint, so structures
 * up to twice that reach away still matter to this chunk.
 */
const STRUCTURE_QUERY_PADDING = TREE_MAX_HORIZONTAL_REACH * 2;

/**
 * Deterministic terrain generator: `(seed, cx, cz)` always produces the same
 * chunk. A low-frequency biome noise (see BiomeSelector) picks Plains/Forest/
 * Desert/Taiga/Mountains/Swamp per column, which shifts terrain height/
 * roughness and surface/subsoil blocks; height noise then shapes the terrain
 * silhouette and detail noise adds small local variation on top. Columns are
 * filled surface/subsoil/stone (sand near sea level) down to y=0: deep stone
 * more than `caveSurfaceMargin` blocks below the surface is first carved into
 * cave air by CavePlacer, and any stone left over is thresholded into ore
 * veins by OrePlacer. Water then fills any air up to sea level (caves stay
 * dry since they're below the surface, not open to it), trees are
 * stamped on top (see stampTrees), and finally structures (ruins, see
 * src/world/structure) are stamped last. Trees whose canopy could touch a
 * structure footprint are skipped rather than overwritten, so ruins never
 * end up with half-cut trees in them.
 *
 * Runs on the main thread for now (Web Worker offload is Phase 8).
 */
export class WorldGenerator {
  private readonly seed: number;
  private readonly biomeSelector: BiomeSelector;
  private readonly treePlacer: TreePlacer;
  private readonly orePlacer: OrePlacer;
  private readonly cavePlacer: CavePlacer;
  private readonly structurePlacer: StructurePlacer;

  constructor(seed: number = WORLD_GEN_CONFIG.defaultSeed) {
    this.seed = seed;
    this.biomeSelector = new BiomeSelector(seed);
    this.treePlacer = new TreePlacer(seed);
    this.orePlacer = new OrePlacer(seed);
    this.cavePlacer = new CavePlacer(seed);
    this.structurePlacer = new StructurePlacer(seed, this);
  }

  /** Deterministic biome for a world column (temperature/moisture noise, spans many chunks). */
  biomeAt(worldX: number, worldZ: number): BiomeDefinition {
    return this.biomeSelector.biomeAt(worldX, worldZ);
  }

  /**
   * Deterministic terrain height (integer y of the topmost solid block) for a world
   * column. The biome shifts the height (heightOffset) and scales how rough the
   * terrain is (heightAmplitudeScale) on top of the shared height/detail noise.
   */
  surfaceHeight(worldX: number, worldZ: number, biome: BiomeDefinition = this.biomeAt(worldX, worldZ)): number {
    const { baseHeight, heightAmplitude, heightNoise, detailAmplitude, detailNoise } =
      WORLD_GEN_CONFIG;

    const height = fractalNoise2D(
      this.seed + HEIGHT_SEED_OFFSET,
      worldX,
      worldZ,
      heightNoise,
    );
    const detail = fractalNoise2D(
      this.seed + DETAIL_SEED_OFFSET,
      worldX,
      worldZ,
      detailNoise,
    );

    const scaledHeightAmplitude = heightAmplitude * biome.heightAmplitudeScale;
    const raw =
      baseHeight +
      biome.heightOffset +
      (height * 2 - 1) * scaledHeightAmplitude +
      (detail * 2 - 1) * detailAmplitude;

    return Math.max(0, Math.min(chunkHeight - 1, Math.round(raw)));
  }

  /** Generates a fully-populated chunk at (cx, cz), deterministic for (seed, cx, cz). */
  generateChunk(cx: number, cz: number): Chunk {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const { surfaceDepth, subsoilDepth } = WORLD_GEN_CONFIG;

    for (let lx = 0; lx < chunkWidth; lx += 1) {
      for (let lz = 0; lz < chunkDepth; lz += 1) {
        const worldX = cx * chunkWidth + lx;
        const worldZ = cz * chunkDepth + lz;
        const biome = this.biomeAt(worldX, worldZ);
        const surfaceY = this.surfaceHeight(worldX, worldZ, biome);
        const isBeach = surfaceY <= seaLevel + BEACH_HEIGHT_MARGIN;

        for (let y = 0; y <= surfaceY; y += 1) {
          const depthBelowSurface = surfaceY - y;
          let blockId: BlockId;

          if (depthBelowSurface < surfaceDepth) {
            blockId = isBeach ? BlockId.Sand : biome.surfaceBlock;
          } else if (depthBelowSurface < surfaceDepth + subsoilDepth) {
            blockId = isBeach ? BlockId.Sand : biome.subsurfaceBlock;
          } else if (this.cavePlacer.isCaveAt(worldX, y, worldZ, surfaceY)) {
            blockId = BlockId.Air;
          } else {
            blockId = this.orePlacer.oreAt(worldX, y, worldZ) ?? BlockId.Stone;
          }

          blocks[localIndex(lx, y, lz)] = blockId;
        }

        for (let y = surfaceY + 1; y <= seaLevel && y < chunkHeight; y += 1) {
          blocks[localIndex(lx, y, lz)] = BlockId.Water;
        }
      }
    }

    const structures = this.structuresNearChunk(cx, cz);
    this.stampTrees(cx, cz, blocks, structures);
    for (const structure of structures) {
      stampStructure(structure, cx, cz, blocks);
    }

    return new Chunk(cx, cz, blocks);
  }

  /** Loot table id of the structure chest at world block (x, y, z), or null (pure seed query; see StructurePlacer.lootTableAt). */
  structureLootTableAt(x: number, y: number, z: number): string | null {
    return this.structurePlacer.lootTableAt(x, y, z);
  }

  /** Structures whose footprint lies within STRUCTURE_QUERY_PADDING of chunk (cx, cz). */
  private structuresNearChunk(cx: number, cz: number): PlacedStructure[] {
    const minX = cx * chunkWidth - STRUCTURE_QUERY_PADDING;
    const minZ = cz * chunkDepth - STRUCTURE_QUERY_PADDING;
    const maxX = (cx + 1) * chunkWidth - 1 + STRUCTURE_QUERY_PADDING;
    const maxZ = (cz + 1) * chunkDepth - 1 + STRUCTURE_QUERY_PADDING;
    return this.structurePlacer.structuresIntersecting(minX, minZ, maxX, maxZ);
  }

  /**
   * Scans world columns in this chunk plus a canopy-reach margin (a tree
   * rooted just outside this chunk can still spill leaves/trunk into it) for
   * deterministic tree spawns, and stamps any of their blocks that land
   * inside this chunk. Skips beach/underwater columns (surface at or below
   * seaLevel + BEACH_HEIGHT_MARGIN, matching the beach-sand cutoff used
   * above) since a bare trunk in water/sand would look wrong, and trees
   * rooted within canopy reach of a structure footprint (the structure wins).
   */
  private stampTrees(
    cx: number,
    cz: number,
    blocks: Uint8Array,
    structures: readonly PlacedStructure[],
  ): void {
    const chunkMinX = cx * chunkWidth;
    const chunkMinZ = cz * chunkDepth;

    for (
      let worldX = chunkMinX - TREE_MAX_HORIZONTAL_REACH;
      worldX < chunkMinX + chunkWidth + TREE_MAX_HORIZONTAL_REACH;
      worldX += 1
    ) {
      for (
        let worldZ = chunkMinZ - TREE_MAX_HORIZONTAL_REACH;
        worldZ < chunkMinZ + chunkDepth + TREE_MAX_HORIZONTAL_REACH;
        worldZ += 1
      ) {
        const biome = this.biomeAt(worldX, worldZ);
        if (!this.treePlacer.isTreeSpawn(worldX, worldZ, biome.id)) {
          continue;
        }

        const groundY = this.surfaceHeight(worldX, worldZ, biome);
        const isBeach = groundY <= seaLevel + BEACH_HEIGHT_MARGIN;
        if (isBeach) {
          continue;
        }
        if (structures.some((s) => footprintContains(s, worldX, worldZ, TREE_MAX_HORIZONTAL_REACH))) {
          continue;
        }

        for (const { dx, dy, dz, blockId } of this.treePlacer.treeBlocks()) {
          const lx = worldX + dx - chunkMinX;
          const ly = groundY + dy;
          const lz = worldZ + dz - chunkMinZ;

          if (isInsideChunk(lx, ly, lz)) {
            blocks[localIndex(lx, ly, lz)] = blockId;
          }
        }
      }
    }
  }
}
