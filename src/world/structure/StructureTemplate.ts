import type { BlockId } from '../blocks';
import type { BiomeId } from '../biome/Biome';

/**
 * How a structure block interacts with what terrain generation already put
 * in its cell: `force` always overwrites (including `Air`, which carves),
 * `ifAir` only fills empty cells (rubble, foundations).
 */
export type PlacementMode = 'force' | 'ifAir';

/** One block of a template, in template-local cell coordinates (0..size-1 on each axis). */
export interface StructureBlock {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly blockId: BlockId;
  readonly mode: PlacementMode;
}

export interface StructureSize {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

/**
 * Template-local cell that lands on the placement origin. Rotation pivots
 * around it on X/Z; `y` is the floor layer, which sits one block above the
 * highest terrain column of the footprint.
 */
export interface StructureAnchor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Plain-data structure definition (see templates.ts). */
export interface StructureTemplate {
  readonly id: string;
  readonly size: StructureSize;
  readonly anchor: StructureAnchor;
  readonly blocks: readonly StructureBlock[];
  /** Biomes every footprint column must belong to for a site to be valid. */
  readonly allowedBiomes: readonly BiomeId[];
  /**
   * When set, each solid floor-layer block is supported by a column of this
   * block filled (ifAir) downward until it meets terrain, up to
   * STRUCTURE_CONFIG.maxFoundationDepth, so the structure never floats.
   */
  readonly foundationBlock?: BlockId;
}

/** Legend entry for `parseLayers`: which block a layout character stands for. */
export interface LayerLegendEntry {
  readonly blockId: BlockId;
  readonly mode: PlacementMode;
}

/** Layout character meaning "leave the generated terrain untouched". */
export const LAYER_SKIP_CHAR = ' ';

/**
 * Builds a block list from an ASCII layout: `layers[dy][dz]` is a row string
 * whose character at index `dx` is looked up in `legend` (LAYER_SKIP_CHAR =
 * no block). Throws on unknown characters or rows that don't match `size`,
 * so a malformed template fails at module load rather than generating junk.
 */
export function parseLayers(
  size: StructureSize,
  layers: readonly (readonly string[])[],
  legend: Readonly<Record<string, LayerLegendEntry>>,
): StructureBlock[] {
  if (layers.length !== size.height) {
    throw new RangeError(`parseLayers: expected ${size.height} layers, got ${layers.length}.`);
  }
  const blocks: StructureBlock[] = [];
  layers.forEach((rows, dy) => {
    if (rows.length !== size.depth) {
      throw new RangeError(`parseLayers: layer ${dy} has ${rows.length} rows, expected ${size.depth}.`);
    }
    rows.forEach((row, dz) => {
      if (row.length !== size.width) {
        throw new RangeError(`parseLayers: layer ${dy} row ${dz} is ${row.length} wide, expected ${size.width}.`);
      }
      for (let dx = 0; dx < row.length; dx += 1) {
        const char = row.charAt(dx);
        if (char === LAYER_SKIP_CHAR) {
          continue;
        }
        const entry = legend[char];
        if (!entry) {
          throw new RangeError(`parseLayers: unknown layout character '${char}'.`);
        }
        blocks.push({ dx, dy, dz, blockId: entry.blockId, mode: entry.mode });
      }
    });
  });
  return blocks;
}
