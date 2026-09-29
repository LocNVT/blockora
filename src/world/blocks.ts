/**
 * Block ids are persisted in saved worlds and chunk data.
 * Never renumber existing ids — only append new ones at the end.
 */
export const BlockId = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  Gravel: 5,
  Water: 6,
  Wood: 7,
  Leaves: 8,
  CoalOre: 9,
  IronOre: 10,
  GoldOre: 11,
  Glass: 12,
  Planks: 13,
  Cobblestone: 14,
  Torch: 15,
  CraftingTable: 16,
  Chest: 17,
} as const;

export type BlockId = (typeof BlockId)[keyof typeof BlockId];

export type ToolType = 'pickaxe' | 'axe' | 'shovel';

/** Per-face texture atlas keys. Use `all` as shorthand when every face is identical. */
export type BlockTexture =
  | { readonly all: string }
  | { readonly top: string; readonly side: string; readonly bottom: string };

export interface BlockDefinition {
  readonly id: BlockId;
  readonly name: string;
  readonly solid: boolean;
  readonly transparent: boolean;
  readonly hardness: number;
  readonly toolType?: ToolType;
  /**
   * When true, this block only drops an item when broken with a tool whose
   * `type` matches `toolType` (tier >= 1 for now). Breaking it by hand or with
   * the wrong tool still destroys the block (see `breakTime.ts`), just
   * without a drop.
   */
  readonly requiresTool?: boolean;
  /** Air has no visual representation and carries no texture. */
  readonly texture: BlockTexture | null;
  readonly lightLevel: number;
  readonly flammable: boolean;
  /**
   * Whether the block raycast (player look-at targeting) can select this
   * block. Defaults to true for any block with a texture (Air is never
   * targetable regardless of this flag). Water is the sole exception.
   */
  readonly targetable?: boolean;
  /**
   * Whether placing a block may overwrite this one (Air always can). Defaults to
   * false; fluids like Water set it so players can build in lakes and seas.
   */
  readonly replaceable?: boolean;
  /** Whether this block is a fluid (e.g. Water). Used for swim/no-fall-damage checks. */
  readonly fluid?: boolean;
  /**
   * Extra light lost (0..15) when light enters this block, on top of the normal
   * 1-per-step falloff (see src/world/light). Defaults to 0 for transparent
   * blocks and 15 (fully blocks light) for opaque ones; only set it on
   * transparent blocks that should dim light passing through (leaves, water).
   */
  readonly lightOpacity?: number;
}

export const BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  {
    id: BlockId.Air,
    name: 'air',
    solid: false,
    transparent: true,
    hardness: 0,
    texture: null,
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.Grass,
    name: 'grass',
    solid: true,
    transparent: false,
    hardness: 0.6,
    toolType: 'shovel',
    texture: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.Dirt,
    name: 'dirt',
    solid: true,
    transparent: false,
    hardness: 0.5,
    toolType: 'shovel',
    texture: { all: 'dirt' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.Stone,
    name: 'stone',
    solid: true,
    transparent: false,
    hardness: 1.5,
    toolType: 'pickaxe',
    requiresTool: true,
    texture: { all: 'stone' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.Sand,
    name: 'sand',
    solid: true,
    transparent: false,
    hardness: 0.5,
    toolType: 'shovel',
    texture: { all: 'sand' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.Gravel,
    name: 'gravel',
    solid: true,
    transparent: false,
    hardness: 0.6,
    toolType: 'shovel',
    texture: { all: 'gravel' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.Water,
    name: 'water',
    solid: false,
    transparent: true,
    hardness: 0,
    texture: { all: 'water' },
    lightLevel: 0,
    lightOpacity: 2,
    flammable: false,
    targetable: false,
    replaceable: true,
    fluid: true,
  },
  {
    id: BlockId.Wood,
    name: 'wood',
    solid: true,
    transparent: false,
    hardness: 2,
    toolType: 'axe',
    texture: { top: 'wood_top', side: 'wood_side', bottom: 'wood_top' },
    lightLevel: 0,
    flammable: true,
  },
  {
    id: BlockId.Leaves,
    name: 'leaves',
    solid: true,
    transparent: true,
    hardness: 0.2,
    texture: { all: 'leaves' },
    lightLevel: 0,
    lightOpacity: 1,
    flammable: true,
  },
  {
    id: BlockId.CoalOre,
    name: 'coal_ore',
    solid: true,
    transparent: false,
    hardness: 3,
    toolType: 'pickaxe',
    requiresTool: true,
    texture: { all: 'coal_ore' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.IronOre,
    name: 'iron_ore',
    solid: true,
    transparent: false,
    hardness: 3,
    toolType: 'pickaxe',
    requiresTool: true,
    texture: { all: 'iron_ore' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.GoldOre,
    name: 'gold_ore',
    solid: true,
    transparent: false,
    hardness: 3,
    toolType: 'pickaxe',
    requiresTool: true,
    texture: { all: 'gold_ore' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.Glass,
    name: 'glass',
    solid: true,
    transparent: true,
    hardness: 0.3,
    texture: { all: 'glass' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.Planks,
    name: 'planks',
    solid: true,
    transparent: false,
    hardness: 2,
    toolType: 'axe',
    texture: { all: 'planks' },
    lightLevel: 0,
    flammable: true,
  },
  {
    id: BlockId.Cobblestone,
    name: 'cobblestone',
    solid: true,
    transparent: false,
    hardness: 2,
    toolType: 'pickaxe',
    requiresTool: true,
    texture: { all: 'cobblestone' },
    lightLevel: 0,
    flammable: false,
  },
  {
    id: BlockId.Torch,
    name: 'torch',
    solid: false,
    transparent: true,
    hardness: 0,
    texture: { all: 'torch' },
    lightLevel: 14,
    flammable: false,
  },
  {
    id: BlockId.CraftingTable,
    name: 'crafting_table',
    solid: true,
    transparent: false,
    hardness: 2.5,
    toolType: 'axe',
    texture: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'planks' },
    lightLevel: 0,
    flammable: true,
  },
  {
    id: BlockId.Chest,
    name: 'chest',
    solid: true,
    transparent: false,
    hardness: 2.5,
    toolType: 'axe',
    texture: { top: 'chest_top', side: 'chest_side', bottom: 'chest_top' },
    lightLevel: 0,
    flammable: true,
  },
];
