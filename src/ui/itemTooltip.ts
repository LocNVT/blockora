import type { ItemStack } from '../items/ItemStack';
import type { ItemRegistry } from '../items/ItemRegistry';
import { ITEM_LABEL_CONFIG } from '../config/constants';

/**
 * Text lines describing `stack`: the display name first, then "Durability n / max"
 * for tools (n = uses left) and "Restores n hunger" for food (n in hunger points;
 * the hunger bar shows 2 points per drumstick). The stack count is not repeated
 * because it is already drawn on the slot. Returns [] for an empty slot.
 */
export function describeItem(stack: ItemStack | null, registry: ItemRegistry): string[] {
  if (stack === null) {
    return [];
  }
  const def = registry.get(stack.itemId);
  const lines = [def.displayName];

  const maxDurability = registry.maxDurability(stack.itemId);
  if (maxDurability !== undefined) {
    const remaining = Math.max(0, maxDurability - (stack.damage ?? 0));
    lines.push(`Durability ${remaining} / ${maxDurability}`);
  }

  const food = registry.foodFor(stack.itemId);
  if (food !== undefined) {
    lines.push(`Restores ${food.hunger} hunger`);
  }
  return lines;
}

export interface TooltipPlacement {
  readonly left: number;
  readonly top: number;
}

/**
 * Top-left position for a tooltip of size width x height near the cursor.
 * Defaults to below-right of the cursor; flips to the left / above when it would
 * overflow the right / bottom edge, then clamps so it never leaves the viewport
 * (a box larger than the viewport is pinned to the top-left margin).
 */
export function placeTooltip(
  cursorX: number,
  cursorY: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  offset: number = ITEM_LABEL_CONFIG.tooltip.cursorOffsetPx,
  margin: number = ITEM_LABEL_CONFIG.tooltip.viewportMarginPx,
): TooltipPlacement {
  let left = cursorX + offset;
  if (left + width + margin > viewportWidth) {
    left = cursorX - offset - width;
  }
  let top = cursorY + offset;
  if (top + height + margin > viewportHeight) {
    top = cursorY - offset - height;
  }
  return { left: clampToViewport(left, width, viewportWidth, margin), top: clampToViewport(top, height, viewportHeight, margin) };
}

function clampToViewport(position: number, size: number, viewport: number, margin: number): number {
  const max = viewport - size - margin;
  return Math.max(margin, Math.min(position, max));
}
