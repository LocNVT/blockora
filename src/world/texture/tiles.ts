/**
 * Data-driven list of every texture atlas tile. Tile index = array position,
 * so appending a new name is safe but reordering/removing shifts every index
 * baked into a face-tile lookup table — treat this list as append-only, like
 * BlockId in ../blocks.ts.
 */
export const TILE_NAMES = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'sand',
  'gravel',
  'water',
  'wood_top',
  'wood_side',
  'leaves',
  'coal_ore',
  'iron_ore',
  'gold_ore',
  'glass',
  'planks',
  'cobblestone',
  'torch',
  'crafting_table_top',
  'crafting_table_side',
  'chest_top',
  'chest_side',
  'stick',
  'coal',
  'wooden_pickaxe',
  'wooden_axe',
  'wooden_shovel',
  'stone_pickaxe',
  'stone_axe',
  'stone_shovel',
  'apple',
  'raw_pork',
] as const;

export type TileName = (typeof TILE_NAMES)[number];

const TILE_INDEX_BY_NAME: ReadonlyMap<string, number> = new Map(
  TILE_NAMES.map((name, index) => [name, index]),
);

/** Resolves a tile name to its atlas index. Throws on an unknown name (typo, missing tile). */
export function tileIndex(name: string): number {
  const index = TILE_INDEX_BY_NAME.get(name);
  if (index === undefined) {
    throw new Error(`tileIndex: unknown tile name "${name}".`);
  }
  return index;
}
