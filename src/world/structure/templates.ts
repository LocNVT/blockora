import { BlockId } from '../blocks';
import { BiomeId } from '../biome/Biome';
import { parseLayers, type LayerLegendEntry, type StructureTemplate } from './StructureTemplate';

/**
 * Shared layout legend. Upper-case = `force`; `r` = rubble that only fills
 * empty cells; `.` = carve to air; ' ' (LAYER_SKIP_CHAR) = untouched;
 * X / D / V = loot chests (ruin / dungeon / village loot table); W = wood
 * post, L = glass window, T = torch, w = water.
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
  V: { blockId: BlockId.Chest, mode: 'force', lootTable: 'village_chest' },
  W: { blockId: BlockId.Wood, mode: 'force' },
  L: { blockId: BlockId.Glass, mode: 'force' },
  T: { blockId: BlockId.Torch, mode: 'force' },
  w: { blockId: BlockId.Water, mode: 'force' },
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
 * Single-piece templates the StructurePlacer may pick from; one per region,
 * chosen by the region's template hash (so a region holds a ruin or a
 * dungeon, never both). Villages are a separate per-region option (see
 * STRUCTURE_CONFIG.village and the VILLAGE_* templates below).
 */
export const STRUCTURE_TEMPLATES: readonly StructureTemplate[] = [RUIN_TEMPLATE, DUNGEON_TEMPLATE];

/** Biomes every village piece footprint and path column must belong to (flat, open land). */
export const VILLAGE_BIOMES: readonly BiomeId[] = [BiomeId.Plains, BiomeId.Desert];

/** Block that replaces the top terrain block on village path columns. */
export const VILLAGE_PATH_BLOCK: BlockId = BlockId.Gravel;

/** Every house has its doorway at local x = 2 of the z = 0 wall; the path starts one step outside. */
const HOUSE_ENTRANCE = { x: 2, z: -1 } as const;

const COTTAGE_SIZE = { width: 5, height: 5, depth: 5 } as const;

/**
 * Small village cottage: cobblestone floor slab (foundation below), plank
 * walls with wood corner posts, a 1x2 doorway in the middle of the z = 0
 * wall, glass windows in both side walls and the back wall, a flat plank
 * roof, and a 3x3x3 interior holding a torch (T, lights the whole room so
 * hostiles cannot spawn inside) and a village chest (V) in the back corners.
 * Layers bottom (floor, the anchor layer) to top; rows z = 0..4, characters x = 0..4.
 */
const COTTAGE_LAYERS: readonly (readonly string[])[] = [
  ['CCCCC', 'CCCCC', 'CCCCC', 'CCCCC', 'CCCCC'],
  ['WP.PW', 'P...P', 'P...P', 'PT.VP', 'WPPPW'],
  ['WP.PW', 'P...P', 'L...L', 'P...P', 'WPLPW'],
  ['WPPPW', 'P...P', 'P...P', 'P...P', 'WPPPW'],
  ['PPPPP', 'PPPPP', 'PPPPP', 'PPPPP', 'PPPPP'],
];

export const VILLAGE_COTTAGE_TEMPLATE: StructureTemplate = {
  id: 'village_cottage',
  size: COTTAGE_SIZE,
  anchor: { x: 2, y: 0, z: 2 },
  blocks: parseLayers(COTTAGE_SIZE, COTTAGE_LAYERS, LEGEND),
  placement: 'surface',
  allowedBiomes: VILLAGE_BIOMES,
  foundationBlock: BlockId.Cobblestone,
  entrance: HOUSE_ENTRANCE,
};

const LONGHOUSE_SIZE = { width: 5, height: 6, depth: 7 } as const;

/**
 * Longer village house: same construction as the cottage on a 5x7
 * footprint (3x5x3 interior), two windows per long wall and one in the back,
 * a torch on the middle of the -X wall and a village chest in the back
 * corner, under a stepped plank roof (full eaves layer + 3-wide ridge).
 * Layers bottom (floor, the anchor layer) to top; rows z = 0..6, characters x = 0..4.
 */
const LONGHOUSE_LAYERS: readonly (readonly string[])[] = [
  ['CCCCC', 'CCCCC', 'CCCCC', 'CCCCC', 'CCCCC', 'CCCCC', 'CCCCC'],
  ['WP.PW', 'P...P', 'P...P', 'PT..P', 'P...P', 'P..VP', 'WPPPW'],
  ['WP.PW', 'P...P', 'L...L', 'P...P', 'L...L', 'P...P', 'WPLPW'],
  ['WPPPW', 'P...P', 'P...P', 'P...P', 'P...P', 'P...P', 'WPPPW'],
  ['PPPPP', 'PPPPP', 'PPPPP', 'PPPPP', 'PPPPP', 'PPPPP', 'PPPPP'],
  [' PPP ', ' PPP ', ' PPP ', ' PPP ', ' PPP ', ' PPP ', ' PPP '],
];

export const VILLAGE_LONGHOUSE_TEMPLATE: StructureTemplate = {
  id: 'village_longhouse',
  size: LONGHOUSE_SIZE,
  anchor: { x: 2, y: 0, z: 3 },
  blocks: parseLayers(LONGHOUSE_SIZE, LONGHOUSE_LAYERS, LEGEND),
  placement: 'surface',
  allowedBiomes: VILLAGE_BIOMES,
  foundationBlock: BlockId.Cobblestone,
  entrance: HOUSE_ENTRANCE,
};

const WELL_SIZE = { width: 5, height: 5, depth: 5 } as const;

/**
 * Village centrepiece: a raised cobblestone well basin (solid base slab with
 * foundation below, a 1-high rim around a 3x3 pool of still water), wood
 * posts on the four corners and an open plank frame on top. Water is static
 * (no fluid simulation) and fully enclosed by the rim, so it never spills.
 * Layers bottom (floor, the anchor layer) to top; rows z = 0..4, characters x = 0..4.
 */
const WELL_LAYERS: readonly (readonly string[])[] = [
  ['CCCCC', 'CCCCC', 'CCCCC', 'CCCCC', 'CCCCC'],
  ['CCCCC', 'CwwwC', 'CwwwC', 'CwwwC', 'CCCCC'],
  ['W   W', '     ', '     ', '     ', 'W   W'],
  ['W   W', '     ', '     ', '     ', 'W   W'],
  ['PPPPP', 'P   P', 'P   P', 'P   P', 'PPPPP'],
];

export const VILLAGE_WELL_TEMPLATE: StructureTemplate = {
  id: 'village_well',
  size: WELL_SIZE,
  anchor: { x: 2, y: 0, z: 2 },
  blocks: parseLayers(WELL_SIZE, WELL_LAYERS, LEGEND),
  placement: 'surface',
  allowedBiomes: VILLAGE_BIOMES,
  foundationBlock: BlockId.Cobblestone,
};

/** House designs a village slot may get (picked per house by the village layout hash). */
export const VILLAGE_HOUSE_TEMPLATES: readonly StructureTemplate[] = [
  VILLAGE_COTTAGE_TEMPLATE,
  VILLAGE_LONGHOUSE_TEMPLATE,
];
