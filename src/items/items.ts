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
  RawPork: 26,
  RawBeef: 27,
  RawChicken: 28,
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
  /** Human-readable Title Case name shown in tooltips and the hotbar label. Unique per item. */
  readonly displayName: string;
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
    displayName: 'Grass Block',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Grass,
  },
  {
    id: ItemId.Dirt,
    name: 'dirt',
    displayName: 'Dirt',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Dirt,
  },
  {
    id: ItemId.Stone,
    name: 'stone',
    displayName: 'Stone',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Stone,
  },
  {
    id: ItemId.Sand,
    name: 'sand',
    displayName: 'Sand',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Sand,
  },
  {
    id: ItemId.Gravel,
    name: 'gravel',
    displayName: 'Gravel',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Gravel,
  },
  {
    id: ItemId.Wood,
    name: 'wood',
    displayName: 'Wood Log',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Wood,
  },
  {
    id: ItemId.Leaves,
    name: 'leaves',
    displayName: 'Leaves',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Leaves,
  },
  {
    id: ItemId.CoalOre,
    name: 'coal_ore',
    displayName: 'Coal Ore',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.CoalOre,
  },
  {
    id: ItemId.IronOre,
    name: 'iron_ore',
    displayName: 'Iron Ore',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.IronOre,
  },
  {
    id: ItemId.GoldOre,
    name: 'gold_ore',
    displayName: 'Gold Ore',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.GoldOre,
  },
  {
    id: ItemId.Glass,
    name: 'glass',
    displayName: 'Glass',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Glass,
  },
  {
    id: ItemId.Planks,
    name: 'planks',
    displayName: 'Wooden Planks',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Planks,
  },
  {
    id: ItemId.Cobblestone,
    name: 'cobblestone',
    displayName: 'Cobblestone',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Cobblestone,
  },
  {
    id: ItemId.Torch,
    name: 'torch',
    displayName: 'Torch',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Torch,
  },
  {
    id: ItemId.CraftingTable,
    name: 'crafting_table',
    displayName: 'Crafting Table',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.CraftingTable,
  },
  {
    id: ItemId.Chest,
    name: 'chest',
    displayName: 'Chest',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    placesBlock: BlockIdValues.Chest,
  },
  {
    id: ItemId.Stick,
    name: 'stick',
    displayName: 'Stick',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    icon: 'stick',
  },
  {
    id: ItemId.Coal,
    name: 'coal',
    displayName: 'Coal',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    icon: 'coal',
  },
  {
    id: ItemId.WoodenPickaxe,
    name: 'wooden_pickaxe',
    displayName: 'Wooden Pickaxe',
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
    displayName: 'Wooden Axe',
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
    displayName: 'Wooden Shovel',
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
    displayName: 'Stone Pickaxe',
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
    displayName: 'Stone Axe',
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
    displayName: 'Stone Shovel',
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
    displayName: 'Apple',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    icon: 'apple',
    food: { hunger: 4 },
  },
  {
    id: ItemId.RawPork,
    name: 'raw_pork',
    displayName: 'Raw Pork',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    icon: 'raw_pork',
    food: { hunger: 3 },
  },
  {
    id: ItemId.RawBeef,
    name: 'raw_beef',
    displayName: 'Raw Beef',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    icon: 'raw_beef',
    food: { hunger: 4 },
  },
  {
    id: ItemId.RawChicken,
    name: 'raw_chicken',
    displayName: 'Raw Chicken',
    maxStackSize: INVENTORY_CONFIG.maxStackSize,
    icon: 'raw_chicken',
    food: { hunger: 2 },
  },
];
