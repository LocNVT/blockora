import { BlockId } from '../world/blocks';

/** The "use" screen a right-click on a block opens, instead of placing a block. */
export type BlockUseAction = 'crafting_table' | 'chest';

/** Data-driven map of blocks with a right-click "use" action (opens a screen instead of placing). */
const BLOCK_USE_ACTIONS: ReadonlyMap<BlockId, BlockUseAction> = new Map([
  [BlockId.CraftingTable, 'crafting_table'],
  [BlockId.Chest, 'chest'],
]);

/** Returns the use action for `blockId`, or null if right-clicking it should place a block instead. */
export function blockUseAction(blockId: number): BlockUseAction | null {
  return BLOCK_USE_ACTIONS.get(blockId as BlockId) ?? null;
}
