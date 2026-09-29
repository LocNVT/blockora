import type { ChestStore } from '../items/ChestStore';
import type { Inventory } from '../items/Inventory';
import type { ItemDropSystem, Vec3 } from '../items/ItemDrops';
import { LOOT_TABLES, lootRng, rollLoot } from '../items/lootTables';
import { itemRegistry, type ItemRegistry } from '../items/ItemRegistry';
import { ITEM_DROP_CONFIG } from '../config/constants';

/** Everything chest interaction needs besides the position. */
export interface ChestContext {
  readonly chests: ChestStore;
  readonly worldSeed: number;
  /** Pure query: loot table id of the structure chest at (x, y, z), or null (player-placed / unknown). */
  readonly lootTableAt: (x: number, y: number, z: number) => string | null;
  readonly itemRegistry?: ItemRegistry;
}

/**
 * Returns the container for the chest at (x, y, z), creating it on first use.
 * A brand-new container at a position that has never held one is filled from
 * the structure's loot table (deterministic per seed + position) if the pure
 * structure query says a loot chest belongs there. Player-placed chests, and
 * positions that were opened or broken before, get no loot, so loot is rolled
 * at most once per position.
 */
export function openChestContainer(ctx: ChestContext, x: number, y: number, z: number): Inventory {
  const existing = ctx.chests.get(x, y, z);
  if (existing !== undefined) {
    return existing;
  }
  const fresh = !ctx.chests.wasInitialised(x, y, z);
  const container = ctx.chests.getOrCreate(x, y, z);
  if (fresh) {
    const tableId = ctx.lootTableAt(x, y, z);
    const table = tableId === null ? undefined : LOOT_TABLES[tableId];
    if (table !== undefined) {
      const registry = ctx.itemRegistry ?? itemRegistry;
      for (const stack of rollLoot(table, lootRng(ctx.worldSeed, x, y, z), registry)) {
        container.add(stack);
      }
    }
  }
  return container;
}

/**
 * Called when the chest block at (x, y, z) was broken: fills structure loot
 * if the chest was never opened, spills every stack as item drops at the
 * block (same jitter as block drops), and removes the container.
 */
export function spillChest(
  ctx: ChestContext,
  drops: ItemDropSystem,
  random: () => number,
  x: number,
  y: number,
  z: number,
): void {
  const container = openChestContainer(ctx, x, y, z);
  ctx.chests.remove(x, y, z);
  const jitter = ITEM_DROP_CONFIG.spawnJitter;
  for (let slot = 0; slot < container.size; slot += 1) {
    const stack = container.take(slot);
    if (stack === null) {
      continue;
    }
    const position: Vec3 = {
      x: x + 0.5 + (random() * 2 - 1) * jitter,
      y: y + 0.5 + (random() * 2 - 1) * jitter,
      z: z + 0.5 + (random() * 2 - 1) * jitter,
    };
    drops.spawn(stack, position);
  }
}
