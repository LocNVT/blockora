import { ItemId } from './items';
import { itemRegistry, type ItemRegistry } from './ItemRegistry';
import { createStack, type ItemStack } from './ItemStack';
import { latticeHash2D } from '../world/noise/valueNoise2D';
import { mulberry32 } from '../util/mulberry32';

/** One weighted possibility of a loot roll; count is uniform in [min, max]. */
export interface LootEntry {
  readonly itemId: ItemId;
  readonly weight: number;
  readonly min: number;
  readonly max: number;
}

export interface LootTable {
  /** Number of weighted picks per chest, uniform in [min, max]. */
  readonly rolls: { readonly min: number; readonly max: number };
  readonly entries: readonly LootEntry[];
}

/** Data-driven loot tables, keyed by the id a structure template names on its chest block. */
export const LOOT_TABLES: Readonly<Record<string, LootTable>> = {
  ruin_chest: {
    rolls: { min: 3, max: 5 },
    entries: [
      { itemId: ItemId.Apple, weight: 6, min: 1, max: 3 },
      { itemId: ItemId.RawPork, weight: 4, min: 1, max: 2 },
      { itemId: ItemId.Coal, weight: 6, min: 2, max: 5 },
      { itemId: ItemId.Torch, weight: 5, min: 2, max: 6 },
      { itemId: ItemId.Planks, weight: 5, min: 4, max: 10 },
      { itemId: ItemId.Stick, weight: 4, min: 2, max: 6 },
      { itemId: ItemId.IronOre, weight: 3, min: 1, max: 3 },
      { itemId: ItemId.WoodenPickaxe, weight: 2, min: 1, max: 1 },
      { itemId: ItemId.StoneAxe, weight: 1, min: 1, max: 1 },
      { itemId: ItemId.StonePickaxe, weight: 1, min: 1, max: 1 },
    ],
  },
  /** Buried dungeon rooms: more picks, more ore/coal/torches and stone tools than a ruin. */
  dungeon_chest: {
    rolls: { min: 4, max: 7 },
    entries: [
      { itemId: ItemId.IronOre, weight: 6, min: 2, max: 6 },
      { itemId: ItemId.Coal, weight: 6, min: 3, max: 8 },
      { itemId: ItemId.Torch, weight: 5, min: 4, max: 10 },
      { itemId: ItemId.GoldOre, weight: 2, min: 1, max: 3 },
      { itemId: ItemId.Apple, weight: 4, min: 2, max: 4 },
      { itemId: ItemId.RawPork, weight: 4, min: 1, max: 3 },
      { itemId: ItemId.StonePickaxe, weight: 3, min: 1, max: 1 },
      { itemId: ItemId.StoneAxe, weight: 2, min: 1, max: 1 },
      { itemId: ItemId.StoneShovel, weight: 2, min: 1, max: 1 },
    ],
  },
  /** Village houses: everyday supplies (food, building material, torches, basic tools); no ore. */
  village_chest: {
    rolls: { min: 3, max: 5 },
    entries: [
      { itemId: ItemId.Apple, weight: 7, min: 2, max: 5 },
      { itemId: ItemId.RawPork, weight: 5, min: 1, max: 3 },
      { itemId: ItemId.Planks, weight: 6, min: 4, max: 12 },
      { itemId: ItemId.Stick, weight: 5, min: 2, max: 8 },
      { itemId: ItemId.Torch, weight: 5, min: 2, max: 6 },
      { itemId: ItemId.Coal, weight: 4, min: 1, max: 4 },
      { itemId: ItemId.WoodenPickaxe, weight: 2, min: 1, max: 1 },
      { itemId: ItemId.WoodenAxe, weight: 2, min: 1, max: 1 },
      { itemId: ItemId.WoodenShovel, weight: 2, min: 1, max: 1 },
      { itemId: ItemId.StoneAxe, weight: 1, min: 1, max: 1 },
      { itemId: ItemId.StoneShovel, weight: 1, min: 1, max: 1 },
    ],
  },
};

/** Distinct from every other seed offset used by world gen / mobs. */
const LOOT_SEED_OFFSET = 700;
/** Spreads Y across the seed argument so vertically stacked chests roll differently. */
const LOOT_Y_SEED_STRIDE = 1009;

/** Deterministic PRNG for the chest at world block (x, y, z): same seed + position -> same sequence. */
export function lootRng(seed: number, x: number, y: number, z: number): () => number {
  const hash = latticeHash2D(seed + LOOT_SEED_OFFSET + y * LOOT_Y_SEED_STRIDE, x, z);
  return mulberry32(Math.floor(hash * 4294967296));
}

function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pickEntry(table: LootTable, totalWeight: number, rng: () => number): LootEntry {
  let roll = rng() * totalWeight;
  for (const entry of table.entries) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry;
    }
  }
  // Floating-point edge (roll rounded up to totalWeight): fall back to the last entry.
  const last = table.entries[table.entries.length - 1];
  if (last === undefined) {
    throw new RangeError('rollLoot: loot table has no entries.');
  }
  return last;
}

/** Rolls `table` with `rng`; returns one stack per pick (callers merge via Inventory.add). */
export function rollLoot(
  table: LootTable,
  rng: () => number,
  registry: ItemRegistry = itemRegistry,
): ItemStack[] {
  const totalWeight = table.entries.reduce((sum, entry) => sum + entry.weight, 0);
  const rolls = randomInt(rng, table.rolls.min, table.rolls.max);
  const stacks: ItemStack[] = [];
  for (let i = 0; i < rolls; i += 1) {
    const entry = pickEntry(table, totalWeight, rng);
    stacks.push(createStack(entry.itemId, randomInt(rng, entry.min, entry.max), registry));
  }
  return stacks;
}
