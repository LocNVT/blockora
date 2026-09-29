import { BlockId } from '../blocks';
import { isInsideChunk, localIndex } from '../chunkCoords';
import { rotateOffset } from './rotation';
import type { PlacedStructure } from './StructurePlacer';
import type { StructureBlock } from './StructureTemplate';
import { STRUCTURE_CONFIG, WORLD_CONFIG } from '../../config/constants';

const { chunkWidth, chunkDepth } = WORLD_CONFIG;

/** World-space position of one template block for a placed (rotated) structure. */
export function structureBlockWorldPosition(
  structure: PlacedStructure,
  block: StructureBlock,
): { readonly x: number; readonly y: number; readonly z: number } {
  const { anchor } = structure.template;
  const offset = rotateOffset(block.dx - anchor.x, block.dz - anchor.z, structure.rotation);
  return {
    x: structure.originX + offset.x,
    y: structure.originY + block.dy - anchor.y,
    z: structure.originZ + offset.z,
  };
}

/**
 * Writes the parts of `structure` that fall inside chunk (cx, cz) into that
 * chunk's `blocks`; everything outside is skipped (the neighbour chunk stamps
 * its own share). Only this chunk's own cells are read (for `ifAir` and the
 * foundation fill), and those come from deterministic terrain generation, so
 * the result is independent of chunk generation order.
 */
export function stampStructure(
  structure: PlacedStructure,
  cx: number,
  cz: number,
  blocks: Uint8Array,
): void {
  const chunkMinX = cx * chunkWidth;
  const chunkMinZ = cz * chunkDepth;
  if (
    structure.maxX < chunkMinX ||
    structure.minX >= chunkMinX + chunkWidth ||
    structure.maxZ < chunkMinZ ||
    structure.minZ >= chunkMinZ + chunkDepth
  ) {
    return;
  }

  const { template } = structure;
  for (const block of template.blocks) {
    const world = structureBlockWorldPosition(structure, block);
    const lx = world.x - chunkMinX;
    const lz = world.z - chunkMinZ;
    if (!isInsideChunk(lx, world.y, lz)) {
      continue;
    }

    const index = localIndex(lx, world.y, lz);
    if (block.mode === 'force' || blocks[index] === BlockId.Air) {
      blocks[index] = block.blockId;
    }

    const supportsFloor = block.dy === template.anchor.y && block.blockId !== BlockId.Air;
    if (supportsFloor && template.foundationBlock !== undefined) {
      fillFoundation(blocks, lx, world.y, lz, template.foundationBlock);
    }
  }
}

/** Fills empty cells below a floor block downward until terrain is hit (bounded by maxFoundationDepth). */
function fillFoundation(
  blocks: Uint8Array,
  lx: number,
  floorY: number,
  lz: number,
  foundationBlock: BlockId,
): void {
  for (let depth = 1; depth <= STRUCTURE_CONFIG.maxFoundationDepth; depth += 1) {
    const y = floorY - depth;
    if (y < 0) {
      return;
    }
    const index = localIndex(lx, y, lz);
    if (blocks[index] !== BlockId.Air) {
      return;
    }
    blocks[index] = foundationBlock;
  }
}
