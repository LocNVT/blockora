import type { ItemStack } from '../items/ItemStack';

/** What the label logic last saw: the selected slot and the item in it (null = empty). */
export interface HotbarLabelState {
  readonly slot: number;
  readonly itemId: number | null;
}

export interface HotbarLabelResult {
  readonly state: HotbarLabelState;
  /** True when the name label should be (re)shown now. */
  readonly show: boolean;
}

/**
 * Decides whether to show the selected-item name label. Shows when the selected
 * slot changed or the item in it changed, and the slot is not empty. The first
 * observation (prev === null) only records a baseline so nothing flashes at
 * start-up. Count / durability changes of the same item do not re-show it.
 */
export function nextHotbarLabel(
  prev: HotbarLabelState | null,
  selectedIndex: number,
  stack: ItemStack | null,
): HotbarLabelResult {
  const state: HotbarLabelState = { slot: selectedIndex, itemId: stack === null ? null : stack.itemId };
  if (prev === null || state.itemId === null) {
    return { state, show: false };
  }
  return { state, show: prev.slot !== state.slot || prev.itemId !== state.itemId };
}
