import type { BlockDefinition } from '../world/blocks';
import type { BlockRegistry } from '../world/BlockRegistry';
import type { ChunkStore } from '../world/ChunkStore';
import type { BlockChange } from '../world/blockEdit';
import type { VoxelRaycastBlockHit } from '../world/voxelRaycast';
import type { Aabb } from '../player/voxelCollision';
import type { HotbarInput } from '../player/InputController';
import type { Inventory } from '../items/Inventory';
import { createStack } from '../items/ItemStack';
import { ItemId } from '../items/items';
import { itemRegistry as defaultItemRegistry, type ItemRegistry } from '../items/ItemRegistry';
import type { ToolProperties } from '../items/items';
import { dropForBlock } from '../items/blockDrops';
import type { ItemDropSystem, Vec3 } from '../items/ItemDrops';
import { ITEM_DROP_CONFIG } from '../config/constants';
import { canHarvest } from './breakTime';
import { tryBreakBlock, tryPlaceBlock } from './blockInteraction';
import { spillChest, type ChestContext } from './chestActions';
import { BlockId } from '../world/blocks';

/**
 * Applies one frame's hotbar select/scroll input to `inventory`. Select is
 * applied before scroll (a same-frame digit press + wheel event both land,
 * with the digit press taking effect first).
 */
export function applyHotbarInput(inventory: Inventory, input: HotbarInput): void {
  if (input.select !== null) {
    inventory.selectHotbar(input.select);
  }
  if (input.scroll !== 0) {
    inventory.scrollHotbar(input.scroll);
  }
}

/**
 * Places the block for the currently selected hotbar item at `hit`'s place
 * position. Returns null (no-op) when the selected slot is empty, the
 * selected item doesn't place a block, or the placement itself fails (out of
 * range, occupied cell, overlaps the player, etc). On success, consumes
 * exactly one item from the selected slot.
 */
export function placeSelectedItem(
  store: ChunkStore,
  blockRegistry: BlockRegistry,
  itemRegistry: ItemRegistry,
  inventory: Inventory,
  hit: VoxelRaycastBlockHit | null,
  playerBox: Aabb,
): BlockChange | null {
  const stack = inventory.selectedStack();
  if (stack === null) {
    return null;
  }

  const blockId = itemRegistry.blockForItem(stack.itemId);
  if (blockId === undefined) {
    return null;
  }

  const change = tryPlaceBlock(store, blockRegistry, hit, blockId, playerBox);
  if (change === null) {
    return null;
  }

  inventory.takeFromSelected(1);
  return change;
}

/**
 * Breaks the block at `hit` and, on success, spawns the block's drop (see
 * `dropForBlock`) as a physical item entity at the broken block's centre,
 * nudged by a small deterministic-seeded jitter so several blocks broken in
 * quick succession don't spawn perfectly overlapping drops. `random` is
 * injected so tests are deterministic; production code passes `Math.random`.
 *
 * `tool` is the held item's tool properties (undefined = bare hand). A block
 * with `requiresTool` set only drops its item when broken with a matching
 * tool (see `canHarvest`); otherwise the block is still destroyed but nothing
 * drops. When `chests` is given, breaking a chest also spills its contents.
 */
export function breakAndDrop(
  store: ChunkStore,
  blockRegistry: BlockRegistry,
  itemRegistry: ItemRegistry,
  drops: ItemDropSystem,
  hit: VoxelRaycastBlockHit | null,
  random: () => number,
  tool?: ToolProperties,
  chests?: ChestContext,
): BlockChange | null {
  const change = tryBreakBlock(store, blockRegistry, hit);
  if (change === null) {
    return null;
  }

  if (change.previous === BlockId.Chest && chests !== undefined) {
    spillChest(chests, drops, random, change.wx, change.wy, change.wz);
  }

  const blockDef = blockRegistry.get(change.previous);
  const stack = canHarvest(blockDef, tool) ? dropForBlock(change.previous, itemRegistry, random) : null;
  if (stack !== null) {
    const jitter = ITEM_DROP_CONFIG.spawnJitter;
    const position: Vec3 = {
      x: change.wx + 0.5 + (random() * 2 - 1) * jitter,
      y: change.wy + 0.5 + (random() * 2 - 1) * jitter,
      z: change.wz + 0.5 + (random() * 2 - 1) * jitter,
    };
    drops.spawn(stack, position);
  }

  return change;
}

/**
 * Wears the currently selected tool by one use when a block with hardness > 0
 * is broken while holding it. Instant (hardness 0) blocks — e.g. torches,
 * grass — don't wear tools. A no-op (returns 'none') when the selected item
 * isn't a tool, or when there's no tool and hardness is 0.
 */
export function applyToolWear(
  inventory: Inventory,
  blockDef: BlockDefinition,
  tool: ToolProperties | undefined,
  registry: ItemRegistry = defaultItemRegistry,
): 'none' | 'damaged' | 'broken' {
  if (tool === undefined || blockDef.hardness <= 0) {
    return 'none';
  }
  return inventory.damageSelected(1, registry);
}

/**
 * Consumes one item from the currently selected hotbar slot and spawns it as
 * a thrown drop at `eye`, launched along `lookDir` with a fixed throw speed
 * plus upward boost, and a longer pickup delay (so the thrower doesn't
 * instantly re-collect it). No-op when the selected slot is empty.
 */
export function throwSelectedItem(
  inventory: Inventory,
  drops: ItemDropSystem,
  eye: Vec3,
  lookDir: Vec3,
): void {
  const thrown = inventory.takeFromSelected(1);
  if (thrown === null) {
    return;
  }

  const { throwSpeed, throwUpSpeed, throwPickupDelay } = ITEM_DROP_CONFIG;
  const velocity: Vec3 = {
    x: lookDir.x * throwSpeed,
    y: lookDir.y * throwSpeed + throwUpSpeed,
    z: lookDir.z * throwSpeed,
  };

  drops.spawn(thrown, { ...eye }, velocity, throwPickupDelay);
}

/**
 * Temporary starting kit given to the player so hotbar/inventory/building can
 * be exercised before survival, crafting, and item pickup exist. Remove once
 * the player instead starts with an empty inventory and gathers items normally.
 */
export const STARTING_ITEMS: readonly { itemId: ItemId; count: number }[] = [
  { itemId: ItemId.Planks, count: 64 },
  { itemId: ItemId.Stone, count: 64 },
  { itemId: ItemId.Dirt, count: 32 },
  { itemId: ItemId.Glass, count: 16 },
  { itemId: ItemId.Torch, count: 16 },
  { itemId: ItemId.Wood, count: 16 },
  { itemId: ItemId.Cobblestone, count: 64 },
  { itemId: ItemId.Sand, count: 32 },
  { itemId: ItemId.CraftingTable, count: 1 },
  { itemId: ItemId.Apple, count: 5 },
];

/** Adds `STARTING_ITEMS` to `inventory`. Temporary for testing — see `STARTING_ITEMS` doc comment. */
export function giveStartingItems(inventory: Inventory, itemRegistry?: ItemRegistry): void {
  for (const { itemId, count } of STARTING_ITEMS) {
    inventory.add(createStack(itemId, count, itemRegistry));
  }
}
