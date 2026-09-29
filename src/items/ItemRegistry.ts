import {
  ITEM_DEFINITIONS,
  type FoodProperties,
  type ItemDefinition,
  type ItemId as ItemIdType,
  type ToolProperties,
} from './items';
import { type BlockRegistry, blockRegistry } from '../world/BlockRegistry';
import { BlockId } from '../world/blocks';
import { INVENTORY_CONFIG, SURVIVAL_CONFIG } from '../config/constants';

const UINT16_MAX = 65535;

/**
 * Validates and indexes item definitions for fast lookup.
 * Definitions must be dense (id === array index + 1), starting at 1,
 * so ids can be used directly as array indices after subtracting 1.
 */
export class ItemRegistry {
  private readonly definitions: readonly ItemDefinition[];
  private readonly byName: ReadonlyMap<string, ItemDefinition>;
  private readonly blockToItem: Uint16Array;

  constructor(definitions: readonly ItemDefinition[], blockRegistry: BlockRegistry) {
    ItemRegistry.validate(definitions, blockRegistry);

    this.definitions = definitions;

    const byName = new Map<string, ItemDefinition>();
    const blockToItem = new Uint16Array(blockRegistry.size);

    for (const def of definitions) {
      byName.set(def.name, def);
      if (def.placesBlock !== undefined) {
        blockToItem[def.placesBlock] = def.id;
      }
    }

    this.byName = byName;
    this.blockToItem = blockToItem;
  }

  private static validate(
    definitions: readonly ItemDefinition[],
    blockRegistry: BlockRegistry,
  ): void {
    if (definitions.length === 0) {
      throw new Error('ItemRegistry: definitions must not be empty.');
    }

    const seenIds = new Set<number>();
    const seenNames = new Set<string>();
    const seenBlockPlacements = new Set<number>();

    definitions.forEach((def, index) => {
      const expectedId = index + 1;

      if (!Number.isInteger(def.id) || def.id < 1) {
        throw new Error(`ItemRegistry: item "${def.name}" has an invalid id (${def.id}).`);
      }
      if (def.id > UINT16_MAX) {
        throw new Error(
          `ItemRegistry: item "${def.name}" has id ${def.id}, which does not fit in a Uint16 (0-65535).`,
        );
      }
      if (def.id !== expectedId) {
        throw new Error(
          `ItemRegistry: item "${def.name}" has id ${def.id} but is at array index ${index}. ` +
            'Definitions must be contiguous and sorted by id starting from 1.',
        );
      }
      if (seenIds.has(def.id)) {
        throw new Error(`ItemRegistry: duplicate item id ${def.id}.`);
      }
      seenIds.add(def.id);

      if (seenNames.has(def.name)) {
        throw new Error(`ItemRegistry: duplicate item name "${def.name}".`);
      }
      seenNames.add(def.name);

      if (!Number.isInteger(def.maxStackSize) || def.maxStackSize < 1) {
        throw new Error(
          `ItemRegistry: item "${def.name}" has invalid maxStackSize ${def.maxStackSize}.`,
        );
      }
      if (def.maxStackSize > INVENTORY_CONFIG.maxStackSize) {
        throw new Error(
          `ItemRegistry: item "${def.name}" maxStackSize ${def.maxStackSize} exceeds INVENTORY_CONFIG.maxStackSize (${INVENTORY_CONFIG.maxStackSize}).`,
        );
      }

      if (def.placesBlock !== undefined) {
        if (!blockRegistry.has(def.placesBlock)) {
          throw new Error(
            `ItemRegistry: item "${def.name}" has placesBlock ${def.placesBlock}, which is not registered in blockRegistry.`,
          );
        }
        if (def.placesBlock === BlockId.Air) {
          throw new Error(
            `ItemRegistry: item "${def.name}" cannot place BlockId.Air (id 0).`,
          );
        }
        if (seenBlockPlacements.has(def.placesBlock)) {
          throw new Error(
            `ItemRegistry: multiple items place the same block (BlockId ${def.placesBlock}).`,
          );
        }
        seenBlockPlacements.add(def.placesBlock);
      }

      if (def.food !== undefined) {
        if (
          !Number.isInteger(def.food.hunger) ||
          def.food.hunger < 1 ||
          def.food.hunger > SURVIVAL_CONFIG.maxHunger
        ) {
          throw new Error(
            `ItemRegistry: food item "${def.name}" has invalid hunger ${def.food.hunger} (must be an integer between 1 and ${SURVIVAL_CONFIG.maxHunger}).`,
          );
        }
      }

      if (def.tool !== undefined) {
        if (def.maxStackSize !== 1) {
          throw new Error(
            `ItemRegistry: tool item "${def.name}" must have maxStackSize 1, got ${def.maxStackSize}.`,
          );
        }
        if (!Number.isFinite(def.tool.speed) || def.tool.speed <= 0) {
          throw new Error(
            `ItemRegistry: tool item "${def.name}" has invalid speed ${def.tool.speed} (must be > 0).`,
          );
        }
        if (!Number.isInteger(def.tool.tier) || def.tool.tier < 1) {
          throw new Error(
            `ItemRegistry: tool item "${def.name}" has invalid tier ${def.tool.tier} (must be an integer >= 1).`,
          );
        }
        if (!Number.isInteger(def.tool.maxDurability) || def.tool.maxDurability < 1) {
          throw new Error(
            `ItemRegistry: tool item "${def.name}" has invalid maxDurability ${def.tool.maxDurability} (must be an integer >= 1).`,
          );
        }
      }
    });
  }

  get size(): number {
    return this.definitions.length;
  }

  has(id: number): boolean {
    return Number.isInteger(id) && id >= 1 && id <= this.definitions.length;
  }

  get(id: number): ItemDefinition {
    const def = this.definitions[id - 1];
    if (def === undefined) {
      throw new Error(`ItemRegistry: unknown item id ${id}.`);
    }
    return def;
  }

  getByName(name: string): ItemDefinition | undefined {
    return this.byName.get(name);
  }

  maxStackSize(id: number): number {
    return this.get(id).maxStackSize;
  }

  itemForBlock(blockId: number): ItemIdType | undefined {
    const itemId = this.blockToItem[blockId];
    return itemId === 0 ? undefined : (itemId as ItemIdType);
  }

  blockForItem(itemId: number): BlockId | undefined {
    const def = this.definitions[itemId - 1];
    return def?.placesBlock;
  }

  /** Returns the tool properties for `itemId`, or undefined if it's not a tool (or unregistered). */
  toolFor(itemId: number): ToolProperties | undefined {
    const def = this.definitions[itemId - 1];
    return def?.tool;
  }

  /** Returns the max durability for `itemId`, or undefined if it's not a tool (or unregistered). */
  maxDurability(itemId: number): number | undefined {
    return this.definitions[itemId - 1]?.tool?.maxDurability;
  }

  /** Returns the food properties for `itemId`, or undefined if it's not edible (or unregistered). */
  foodFor(itemId: number): FoodProperties | undefined {
    return this.definitions[itemId - 1]?.food;
  }
}

export const itemRegistry = new ItemRegistry(ITEM_DEFINITIONS, blockRegistry);
