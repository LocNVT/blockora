import type { BlockId, ToolType } from '../world/blocks';
import { BlockId as BlockIdValues } from '../world/blocks';
import { INVENTORY_CONFIG, TOOL_CONFIG } from '../config/constants';

/**
 * Item ids are persisted in saves.
 * Never renumber existing ids — only append new ones at the end.
 * 0 = None is reserved for "empty slot" and is NOT a registered item.
 */
export const ItemId = {
  None: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  Gravel: 5,
  Wood: 6,
  Leaves: 7,
  CoalOre: 8,
  IronOre: 9,
  GoldOre: 10,
  Glass: 11,
  Planks: 12,
  Cobblestone: 13,
  Torch: 14,
  CraftingTable: 15,
  Chest: 16,
  Stick: 17,
  Coal: 18,
  WoodenPickaxe: 19,
  WoodenAxe: 20,
  WoodenShovel: 21,
  StonePickaxe: 22,
  StoneAxe: 23,
  StoneShovel: 24,
  Apple: 25,
} as const;

export type ItemId = (typeof ItemId)[keyof typeof ItemId];

/** Numeric tool tiers; higher is strictly better. Sourced from TOOL_CONFIG.tiers. */
export const TOOL_TIERS = TOOL_CONFIG.tiers;

export interface ToolProperties {
  readonly type: ToolType;
  readonly tier: number;
  /** Break-speed multiplier applied when this tool matches the block's toolType. */
  readonly speed: number;
  /** Number of uses (block breaks that wear the tool) before it breaks. */
  readonly maxDurability: number;
}

/** Present for edible items. `hunger` is the hunger points restored by `PlayerHunger.eat`. */
export interface FoodProperties {
  readonly hunger: number;
}

export interface ItemDefinition {
  readonly id: ItemId;
  readonly name: string;
  readonly maxStackSize: number;
  readonly placesBlock?: BlockId;
  /** Atlas tile key for this item's hotbar/inventory icon (non-block items only need this). */
  readonly icon?: string;
  /** Present for tool items (pickaxe/axe/shovel). Tools stack to 1 and track wear via ItemStack.damage. */
  readonly tool?: ToolProperties;
  /** Present for edible items (see `FoodProperties`). */
  readonly food?: FoodProperties;
}

export const ITEM_DEFINITIONS: readonly ItemDefinition[] = [
  {
    id: ItemId.Grass,
    name: 'grass',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Grass,
  },
  {
    id: ItemId.Dirt,
    name: 'dirt',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Dirt,
  },
  {
    id: ItemId.Stone,
    name: 'stone',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Stone,
  },
  {
    id: ItemId.Sand,
    name: 'sand',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Sand,
  },
  {
    id: ItemId.Gravel,
    name: 'gravel',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Gravel,
  },
  {
    id: ItemId.Wood,
    name: 'wood',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Wood,
  },
  {
    id: ItemId.Leaves,
    name: 'leaves',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Leaves,
  },
  {
    id: ItemId.CoalOre,
    name: 'coal_ore',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.CoalOre,
  },
  {
    id: ItemId.IronOre,
    name: 'iron_ore',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.IronOre,
  },
  {
    id: ItemId.GoldOre,
    name: 'gold_ore',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.GoldOre,
  },
  {
    id: ItemId.Glass,
    name: 'glass',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Glass,
  },
  {
    id: ItemId.Planks,
    name: 'planks',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Planks,
  },
  {
    id: ItemId.Cobblestone,
    name: 'cobblestone',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Cobblestone,
  },
  {
    id: ItemId.Torch,
    name: 'torch',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Torch,
  },
  {
    id: ItemId.CraftingTable,
    name: 'crafting_table',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.CraftingTable,
  },
  {
    id: ItemId.Chest,
    name: 'chest',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Chest,
  },
  {
    id: ItemId.Stick,
    name: 'stick',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    icon: 'stick',
  },
  {
    id: ItemId.Coal,
    name: 'coal',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    icon: 'coal',
  },
  {
    id: ItemId.WoodenPickaxe,
    name: 'wooden_pickaxe',
    maxStackSize: 1,
    icon: 'wooden_pickaxe',
    tool: {
      type: 'pickaxe',
      tier: TOOL_TIERS.wood,
      speed: TOOL_CONFIG.speed.wood,
      maxDurability: TOOL_CONFIG.durability.wood,
    },
  },
  {
    id: ItemId.WoodenAxe,
    name: 'wooden_axe',
    maxStackSize: 1,
    icon: 'wooden_axe',
    tool: {
      type: 'axe',
      tier: TOOL_TIERS.wood,
      speed: TOOL_CONFIG.speed.wood,
      maxDurability: TOOL_CONFIG.durability.wood,
    },
  },
  {
    id: ItemId.WoodenShovel,
    name: 'wooden_shovel',
    maxStackSize: 1,
    icon: 'wooden_shovel',
    tool: {
      type: 'shovel',
      tier: TOOL_TIERS.wood,
      speed: TOOL_CONFIG.speed.wood,
      maxDurability: TOOL_CONFIG.durability.wood,
    },
  },
  {
    id: ItemId.StonePickaxe,
    name: 'stone_pickaxe',
    maxStackSize: 1,
    icon: 'stone_pickaxe',
    tool: {
      type: 'pickaxe',
      tier: TOOL_TIERS.stone,
      speed: TOOL_CONFIG.speed.stone,
      maxDurability: TOOL_CONFIG.durability.stone,
    },
  },
  {
    id: ItemId.StoneAxe,
    name: 'stone_axe',
    maxStackSize: 1,
    icon: 'stone_axe',
    tool: {
      type: 'axe',
      tier: TOOL_TIERS.stone,
      speed: TOOL_CONFIG.speed.stone,
      maxDurability: TOOL_CONFIG.durability.stone,
    },
  },
  {
    id: ItemId.StoneShovel,
    name: 'stone_shovel',
    maxStackSize: 1,
    icon: 'stone_shovel',
    tool: {
      type: 'shovel',
      tier: TOOL_TIERS.stone,
      speed: TOOL_CONFIG.speed.stone,
      maxDurability: TOOL_CONFIG.durability.stone,
    },
  },
  {
    id: ItemId.Apple,
    name: 'apple',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    icon: 'apple',
    food: { hunger: 4 },
  },
];
