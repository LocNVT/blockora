import { BlockId } from '../world/blocks';
import { ItemId } from './items';
import type { ItemRegistry } from './ItemRegistry';
import type { ItemStack } from './ItemStack';
import { createStack } from './ItemStack';
import { SURVIVAL_CONFIG } from '../config/constants';

/**
 * Overrides the default "block's own item" drop for blocks that drop a
 * different item (e.g. Coal, which has no block) or nothing at all (`null`).
 * Blocks not listed fall back to `itemRegistry.itemForBlock(blockId)` x1.
 * Leaves is handled separately (see `dropForBlock`'s `random` param) since its
 * drop is chance-based (Apple) rather than fixed.
 */
const DROP_OVERRIDES: ReadonlyMap<BlockId, ItemId | null> = new Map<BlockId, ItemId | null>([
  [BlockId.Stone, ItemId.Cobblestone],
  [BlockId.Grass, ItemId.Dirt],
  [BlockId.CoalOre, ItemId.Coal],
  [BlockId.Glass, null],
]);

/**
 * Resolves the item (and count) a broken block should drop, or null for no
 * drop. Default: the block's own item (`itemRegistry.itemForBlock`) x1.
 * Air and Water never drop anything.
 *
 * Leaves is a special case: it has no item of its own, but drops an Apple
 * with probability `SURVIVAL_CONFIG.appleDropChance` (otherwise nothing).
 * `random` is injected (`() => number` in [0, 1)) so callers can pass a
 * deterministic source in tests; production code passes `Math.random`,
 * defaulted here so existing non-Leaves callers don't need to change.
 */
export function dropForBlock(
  blockId: number,
  itemRegistry: ItemRegistry,
  random: () => number = Math.random,
): ItemStack | null {
  if (blockId === BlockId.Air || blockId === BlockId.Water) {
    return null;
  }

  if (blockId === BlockId.Leaves) {
    return random() < SURVIVAL_CONFIG.appleDropChance ? createStack(ItemId.Apple, 1, itemRegistry) : null;
  }

  const override = DROP_OVERRIDES.get(blockId as BlockId);
  if (override !== undefined) {
    return override === null ? null : createStack(override, 1, itemRegistry);
  }

  const itemId = itemRegistry.itemForBlock(blockId);
  return itemId === undefined ? null : createStack(itemId, 1, itemRegistry);
}
