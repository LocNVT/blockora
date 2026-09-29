import { FaceDirection } from '../world/mesher/faces';
import { resolveFaceTile } from '../world/texture/blockFaceTiles';
import type { TileName } from '../world/texture/tiles';
import type { BlockRegistry } from '../world/BlockRegistry';
import type { ItemRegistry } from './ItemRegistry';
import type { ItemId } from './items';

/** Face used to derive a block item's icon: its side face, as seen "in hand"/in a slot. */
const ICON_FACE = FaceDirection.NegZ;

/**
 * Resolves the atlas tile name to use as `itemId`'s hotbar/inventory icon.
 * An explicit `icon` on the item definition always wins (e.g. Stick, Coal).
 * Otherwise, block-placing items use their block's side-face tile (matches
 * what the player sees when looking at a placed block). Items with neither
 * have no tile-based icon — callers should fall back to a text label. Pure
 * function: no DOM, no rendering.
 */
export function iconTileForItem(
  itemRegistry: ItemRegistry,
  blockRegistry: BlockRegistry,
  itemId: ItemId,
): TileName | null {
  const def = itemRegistry.get(itemId);
  if (def.icon !== undefined) {
    return def.icon as TileName;
  }

  const blockId = itemRegistry.blockForItem(itemId);
  if (blockId === undefined) {
    return null;
  }

  const blockDef = blockRegistry.get(blockId);
  if (blockDef.texture === null) {
    return null;
  }

  return resolveFaceTile(blockDef.texture, ICON_FACE) as TileName;
}

/**
 * Interpolates a durability-bar color from green (full) to red (empty) through
 * yellow at the midpoint, given a 0..1 remaining-durability fraction. Pure,
 * no DOM — shared by every UI surface that renders a tool's durability bar.
 */
export function durabilityBarColor(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  // 0 -> red (0deg), 0.5 -> yellow (60deg), 1 -> green (120deg)
  const hue = clamped * 120;
  return `hsl(${hue}, 85%, 45%)`;
}
