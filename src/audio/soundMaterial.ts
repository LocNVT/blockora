import { BlockId } from '../world/blocks';

/** Sound flavour of a block: which family of break / place / step recipes it uses. */
export type SoundMaterial = 'stone' | 'dirt' | 'grass' | 'sand' | 'gravel' | 'wood' | 'glass' | 'leaves' | 'water';

const MATERIAL_BY_BLOCK: Readonly<Record<number, SoundMaterial | null>> = {
  [BlockId.Air]: null,
  [BlockId.Grass]: 'grass',
  [BlockId.Dirt]: 'dirt',
  [BlockId.Stone]: 'stone',
  [BlockId.Sand]: 'sand',
  [BlockId.Gravel]: 'gravel',
  [BlockId.Water]: 'water',
  [BlockId.Wood]: 'wood',
  [BlockId.Leaves]: 'leaves',
  [BlockId.CoalOre]: 'stone',
  [BlockId.IronOre]: 'stone',
  [BlockId.GoldOre]: 'stone',
  [BlockId.Glass]: 'glass',
  [BlockId.Planks]: 'wood',
  [BlockId.Cobblestone]: 'stone',
  [BlockId.Torch]: 'wood',
  [BlockId.CraftingTable]: 'wood',
  [BlockId.Chest]: 'wood',
};

/** Sound material of a block id: null for air (silent), stone for an unknown id. */
export function soundMaterialOf(blockId: number): SoundMaterial | null {
  const material = MATERIAL_BY_BLOCK[blockId];
  return material === undefined ? 'stone' : material;
}
