import { Inventory } from './Inventory';
import { itemRegistry, type ItemRegistry } from './ItemRegistry';
import { CHEST_CONFIG, WORLD_CONFIG } from '../config/constants';

const { maxHorizontalCoord } = CHEST_CONFIG;
const { chunkHeight } = WORLD_CONFIG;
/** Horizontal axis span after shifting coordinates to be non-negative. */
const HORIZONTAL_SPAN = maxHorizontalCoord * 2;

/**
 * Packs a world block position into one exact integer (no string allocation):
 * ((x + M) * 2M + (z + M)) * chunkHeight + y, with M = maxHorizontalCoord.
 * Valid for |x|, |z| < M (about 1.05M blocks) and 0 <= y < chunkHeight; the
 * largest key is ~2^49, inside the 2^53 exact-integer range.
 */
export function chestKey(x: number, y: number, z: number): number {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(z) ||
    Math.abs(x) >= maxHorizontalCoord ||
    Math.abs(z) >= maxHorizontalCoord ||
    y < 0 ||
    y >= chunkHeight
  ) {
    throw new RangeError(`chestKey: position (${x}, ${y}, ${z}) is outside the supported world bounds.`);
  }
  return ((x + maxHorizontalCoord) * HORIZONTAL_SPAN + (z + maxHorizontalCoord)) * chunkHeight + y;
}

/** Inverse of `chestKey`. */
export function chestPositionFromKey(key: number): { x: number; y: number; z: number } {
  const y = key % chunkHeight;
  const column = (key - y) / chunkHeight;
  const zShifted = column % HORIZONTAL_SPAN;
  const xShifted = (column - zShifted) / HORIZONTAL_SPAN;
  return { x: xShifted - maxHorizontalCoord, y, z: zShifted - maxHorizontalCoord };
}

/** One stored chest container and its world position. */
export interface ChestEntry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly container: Inventory;
}

/**
 * Block-entity storage for chests: world block position -> 27-slot container.
 * A container is an `Inventory` with no hotbar, so stacking/merge/split rules
 * are the single existing implementation. Data lives outside the chunk voxel
 * arrays and is NOT tied to chunk load state (unloading a chunk never drops
 * its chests' contents; src/save persists them).
 *
 * `initialised` remembers every position that has ever had a container, even
 * after the chest is broken, so lazily-filled loot can never be rolled twice
 * for the same position (e.g. if a broken structure chest is regenerated).
 */
export class ChestStore {
  private readonly containers = new Map<number, Inventory>();
  private readonly initialised = new Set<number>();

  constructor(private readonly registry: ItemRegistry = itemRegistry) {}

  get size(): number {
    return this.containers.size;
  }

  has(x: number, y: number, z: number): boolean {
    return this.containers.has(chestKey(x, y, z));
  }

  get(x: number, y: number, z: number): Inventory | undefined {
    return this.containers.get(chestKey(x, y, z));
  }

  /** True once a container has ever existed at this position (survives `remove`). */
  wasInitialised(x: number, y: number, z: number): boolean {
    return this.initialised.has(chestKey(x, y, z));
  }

  /** Returns the container at the position, creating an empty one if missing. */
  getOrCreate(x: number, y: number, z: number): Inventory {
    const key = chestKey(x, y, z);
    let container = this.containers.get(key);
    if (container === undefined) {
      container = new Inventory(this.registry, CHEST_CONFIG.slots, 0);
      this.containers.set(key, container);
      this.initialised.add(key);
    }
    return container;
  }

  /** Every stored container with its position (live containers, not copies). */
  entries(): ChestEntry[] {
    return Array.from(this.containers, ([key, container]) => ({ ...chestPositionFromKey(key), container }));
  }

  /** Every position that has ever held a container (see `wasInitialised`). */
  initialisedPositions(): { x: number; y: number; z: number }[] {
    return Array.from(this.initialised, chestPositionFromKey);
  }

  /** Marks a position initialised without creating a container (save restore). */
  markInitialised(x: number, y: number, z: number): void {
    this.initialised.add(chestKey(x, y, z));
  }

  /** Removes and returns the container (its position stays marked initialised). */
  remove(x: number, y: number, z: number): Inventory | undefined {
    const key = chestKey(x, y, z);
    const container = this.containers.get(key);
    this.containers.delete(key);
    return container;
  }
}
