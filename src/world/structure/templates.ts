import { BlockId } from '../blocks';
import { BiomeId } from '../biome/Biome';
import { parseLayers, type LayerLegendEntry, type StructureTemplate } from './StructureTemplate';

/**
 * Shared layout legend. Upper-case = `force`; `r` = rubble that only fills
 * empty cells; `.` = carve to air; ' ' (LAYER_SKIP_CHAR) = untouched.
 */
const LEGEND: Readonly<Record<string, LayerLegendEntry>> = {
  C: { blockId: BlockId.Cobblestone, mode: 'force' },
  S: { blockId: BlockId.Stone, mode: 'force' },
  P: { blockId: BlockId.Planks, mode: 'force' },
  G: { blockId: BlockId.Gravel, mode: 'force' },
  r: { blockId: BlockId.Gravel, mode: 'ifAir' },
  '.': { blockId: BlockId.Air, mode: 'force' },
  X: { blockId: BlockId.Chest, mode: 'force', lootTable: 'ruin_chest' },
};

const RUIN_SIZE = { width: 7, height: 5, depth: 7 } as const;

/**
 * Small abandoned ruin: cobblestone/stone walls of uneven height (tallest at
 * the -X/-Z corner) with a doorway, a window gap and a collapsed +X/+Z corner
 * spilling gravel; a rotted plank floor with holes and one loot chest (X)
 * on the floor near the -X wall. Layers bottom (floor, the
 * anchor layer) to top; each layer lists rows z = 0..6, characters x = 0..6.
 */
const RUIN_LAYERS: readonly (readonly string[])[] = [
  ['CCCSCCC', 'CPPPPPC', 'SPP PPC', 'CPPPP C', 'CP PPPS', 'CPPPPGG', 'CCSCGG '],
  ['CCC.CCS', 'C.....C', 'S.....C', 'C.X...S', 'C....r.', 'C...rG ', 'SCC.G  '],
  ['CSC.CS ', 'C.....C', '......C', 'C......', 'S......', 'C..... ', 'CC ..  '],
  ['C CP C ', 'C.....C', 'S......', '.......', 'C......', '.......', 'C......'],
  ['C  S   ', 'C      ', '       ', '       ', '       ', '       ', 'C      '],
];

export const RUIN_TEMPLATE: StructureTemplate = {
  id: 'ruin',
  size: RUIN_SIZE,
  anchor: { x: 3, y: 0, z: 3 },
  blocks: parseLayers(RUIN_SIZE, RUIN_LAYERS, LEGEND),
  allowedBiomes: [BiomeId.Plains, BiomeId.Forest, BiomeId.Desert],
  foundationBlock: BlockId.Cobblestone,
};

/** Every template the StructurePlacer may pick from (hashed per region). */
export const STRUCTURE_TEMPLATES: readonly StructureTemplate[] = [RUIN_TEMPLATE];
