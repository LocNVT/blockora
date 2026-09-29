import { BlockId } from '../blocks';
import { BiomeId } from '../biome/Biome';
import { parseLayers, type LayerLegendEntry, type StructureTemplate } from './StructureTemplate';

/**
 * Shared layout legend. Upper-case = `force`; `r` = rubble that only fills
 * empty cells; `.` = carve to air; ' ' (LAYER_SKIP_CHAR) = untouched;
 * X / D = loot chests (ruin / dungeon loot table).
 */
const LEGEND: Readonly<Record<string, LayerLegendEntry>> = {
  C: { blockId: BlockId.Cobblestone, mode: 'force' },
  S: { blockId: BlockId.Stone, mode: 'force' },
  P: { blockId: BlockId.Planks, mode: 'force' },
  G: { blockId: BlockId.Gravel, mode: 'force' },
  r: { blockId: BlockId.Gravel, mode: 'ifAir' },
  '.': { blockId: BlockId.Air, mode: 'force' },
  X: { blockId: BlockId.Chest, mode: 'force', lootTable: 'ruin_chest' },
  D: { blockId: BlockId.Chest, mode: 'force', lootTable: 'dungeon_chest' },
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
  placement: 'surface',
  allowedBiomes: [BiomeId.Plains, BiomeId.Forest, BiomeId.Desert],
  foundationBlock: BlockId.Cobblestone,
};

const DUNGEON_SIZE = { width: 9, height: 5, depth: 9 } as const;

/**
 * Buried dungeon room: a sealed cobblestone shell (walls patched with stone
 * and gravel, gravel patches in the floor, solid ceiling) around a 7x3x7
 * air interior with two short pillars and two loot chests (D) against the
 * -Z and +X walls. No light sources, so the room stays dark for hostile
 * spawns. Every shell cell is `force`, so a cave crossing the room is walled
 * off and cannot hollow the shell; the one exception is a 1x2 gap in the
 * +Z wall (x = 4) left untouched (' '), which is stone unless a cave runs
 * past it, in which case the cave opens into the room. Layers bottom
 * (floor, the anchor layer) to top; rows z = 0..8, characters x = 0..8.
 */
const DUNGEON_LAYERS: readonly (readonly string[])[] = [
  [
    'CCCSCCCCC',
    'CCCCCGCCC',
    'CGGCCCCCC',
    'CCGCCCCSC',
    'SCCCCCCCC',
    'CCCCCCGGC',
    'CCCCCCCGC',
    'CSCCGCCCC',
    'CCCCCCSCC',
  ],
  [
    'CSCCCCGCC',
    'C...D...C',
    'C.....C.C',
    'S.......C',
    'C.......S',
    'C......DC',
    'C.C.....C',
    'C.......G',
    'CCCC CSCC',
  ],
  [
    'CCCSCCCCC',
    'C.......C',
    'S.....C.C',
    'C.......C',
    'G.......C',
    'C.......S',
    'C.C.....C',
    'C.......C',
    'CSCC CCCC',
  ],
  [
    'CCCCCCSCC',
    'C.......C',
    'C.......S',
    'C.......C',
    'C.......C',
    'S.......C',
    'C.......C',
    'C.......C',
    'CCSCCCCCG',
  ],
  [
    'CCCCCCCCC',
    'CCSCCCCCC',
    'CCCCCCCCC',
    'CCCCSCCCC',
    'CCCCCCCCC',
    'CCCCCCSCC',
    'CCCCCCCCC',
    'CSCCCCCCC',
    'CCCCCCCCC',
  ],
];

export const DUNGEON_TEMPLATE: StructureTemplate = {
  id: 'dungeon',
  size: DUNGEON_SIZE,
  anchor: { x: 4, y: 0, z: 4 },
  blocks: parseLayers(DUNGEON_SIZE, DUNGEON_LAYERS, LEGEND),
  placement: 'underground',
  allowedBiomes: [
    BiomeId.Plains,
    BiomeId.Forest,
    BiomeId.Desert,
    BiomeId.Taiga,
    BiomeId.Mountains,
    BiomeId.Swamp,
  ],
};

/**
 * Every template the StructurePlacer may pick from; one per region, chosen by
 * the region's template hash (so a region holds a ruin or a dungeon, never both).
 */
export const STRUCTURE_TEMPLATES: readonly StructureTemplate[] = [RUIN_TEMPLATE, DUNGEON_TEMPLATE];
