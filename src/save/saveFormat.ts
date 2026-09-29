import type { BlockRegistry } from '../world/BlockRegistry';
import { blockRegistry as defaultBlockRegistry } from '../world/BlockRegistry';
import type { ChunkEditsRecord } from '../world/BlockEditStore';
import { CHUNK_VOLUME, type ChunkCoord } from '../world/chunkCoords';
import type { ItemRegistry } from '../items/ItemRegistry';
import { itemRegistry as defaultItemRegistry } from '../items/ItemRegistry';
import { createStack, type ItemStack } from '../items/ItemStack';
import { ItemId } from '../items/items';
import { CHEST_CONFIG, INVENTORY_CONFIG, SURVIVAL_CONFIG, WORLD_CONFIG } from '../config/constants';

/**
 * Save format version written by this build. Bump it when the persisted
 * shape changes and add a migration from the previous version to `MIGRATIONS`.
 */
export const SAVE_FORMAT_VERSION = 1;

/** Save data is malformed (wrong types, out-of-range values, unknown ids...). */
export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

/** Save was written by a newer (unknown) format version than this build supports. */
export class SaveVersionError extends SaveFormatError {
  constructor(readonly version: number) {
    super(`Save format version ${version} is newer than supported version ${SAVE_FORMAT_VERSION}.`);
    this.name = 'SaveVersionError';
  }
}

export interface WorldMetaRecord {
  readonly version: number;
  readonly seed: number;
  /** Fraction of the day/night cycle in [0, 1). */
  readonly timeOfDay: number;
  readonly dayCount: number;
  /** Epoch milliseconds when the save was written. */
  readonly savedAt: number;
}

/**
 * Container slots as parallel TypedArrays (one entry per slot): item id
 * (ItemId.None = empty slot), count (0 when empty) and tool damage (0 = new).
 */
export interface SlotsRecord {
  readonly itemIds: Uint16Array;
  readonly counts: Uint8Array;
  readonly damage: Uint16Array;
}

export interface PlayerRecord {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
  readonly pitch: number;
  readonly health: number;
  readonly hunger: number;
  readonly exhaustion: number;
  readonly selectedHotbar: number;
  readonly inventory: SlotsRecord;
}

/**
 * Chest block entities. `positions` holds x,y,z triples (one per container);
 * `contents` is every container's slots concatenated (`slotsPerChest` each,
 * same order as `positions`). `initialised` holds x,y,z triples of every
 * position that ever had a container, so structure loot is never re-rolled.
 */
export interface ChestsRecord {
  readonly slotsPerChest: number;
  readonly positions: Int32Array;
  readonly contents: SlotsRecord;
  readonly initialised: Int32Array;
}

/** A complete decoded save (also the shape assembled from storage before decoding). */
export interface SaveData {
  readonly meta: WorldMetaRecord;
  readonly player: PlayerRecord;
  readonly chests: ChestsRecord;
  readonly chunks: readonly ChunkEditsRecord[];
}

/**
 * One write: the always-rewritten small records plus the chunk-edit changes.
 * `replaceAllChunks` clears every stored chunk record before writing `chunkPuts`
 * (first save of a new world, so stale records from an old/invalid save vanish).
 */
export interface SaveSnapshot {
  readonly meta: WorldMetaRecord;
  readonly player: PlayerRecord;
  readonly chests: ChestsRecord;
  readonly chunkPuts: readonly ChunkEditsRecord[];
  readonly chunkDeletes: readonly ChunkCoord[];
  readonly replaceAllChunks: boolean;
}

export interface SaveRegistries {
  readonly blocks: BlockRegistry;
  readonly items: ItemRegistry;
}

const DEFAULT_REGISTRIES: SaveRegistries = { blocks: defaultBlockRegistry, items: defaultItemRegistry };

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Upgrade steps keyed by the version they upgrade FROM (v1 -> v2 goes at key
 * 1). Empty while only v1 exists.
 */
const MIGRATIONS: Readonly<Partial<Record<number, Migration>>> = {};

// ---------------------------------------------------------------------------
// Encoding (game data -> records)

/** Encodes container slots into a `SlotsRecord`. */
export function encodeSlots(slots: readonly (ItemStack | null)[]): SlotsRecord {
  const itemIds = new Uint16Array(slots.length);
  const counts = new Uint8Array(slots.length);
  const damage = new Uint16Array(slots.length);
  slots.forEach((stack, i) => {
    if (stack !== null) {
      itemIds[i] = stack.itemId;
      counts[i] = stack.count;
      damage[i] = stack.damage ?? 0;
    }
  });
  return { itemIds, counts, damage };
}

/**
 * Decodes slots `[start, start + length)` of a `SlotsRecord` into validated
 * stacks. Throws SaveFormatError for unknown items, bad counts or damage.
 */
export function decodeSlots(
  record: SlotsRecord,
  registry: ItemRegistry = defaultItemRegistry,
  start = 0,
  length = record.itemIds.length,
): (ItemStack | null)[] {
  const stacks: (ItemStack | null)[] = [];
  for (let i = start; i < start + length; i += 1) {
    const itemId = record.itemIds[i] ?? ItemId.None;
    const count = record.counts[i] ?? 0;
    const damage = record.damage[i] ?? 0;
    if (itemId === ItemId.None) {
      if (count !== 0 || damage !== 0) {
        throw new SaveFormatError(`slot ${i}: empty slot has count ${count} / damage ${damage}.`);
      }
      stacks.push(null);
      continue;
    }
    try {
      stacks.push(createStack(itemId as ItemId, count, registry, damage));
    } catch (error) {
      throw new SaveFormatError(`slot ${i}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return stacks;
}

// ---------------------------------------------------------------------------
// Versioning

/**
 * Brings raw stored data up to `SAVE_FORMAT_VERSION` (identity for v1).
 * Throws SaveVersionError for a newer version, SaveFormatError when the
 * version is missing/invalid or no migration path exists.
 */
export function migrate(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw) || !isRecord(raw.meta)) {
    throw new SaveFormatError('save is not an object with a meta record.');
  }
  const version = raw.meta.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SaveFormatError(`invalid save format version ${String(version)}.`);
  }
  if (version > SAVE_FORMAT_VERSION) {
    throw new SaveVersionError(version);
  }
  let data = raw;
  for (let from = version; from < SAVE_FORMAT_VERSION; from += 1) {
    const step = MIGRATIONS[from];
    if (step === undefined) {
      throw new SaveFormatError(`no migration from save format version ${from}.`);
    }
    data = step(data);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Decoding / validation (unknown -> SaveData)

/** Migrates and fully validates raw stored data. Throws SaveFormatError (or SaveVersionError). */
export function decodeSave(raw: unknown, registries: SaveRegistries = DEFAULT_REGISTRIES): SaveData {
  const data = migrate(raw);
  const chunks = data.chunks;
  if (!Array.isArray(chunks)) {
    throw new SaveFormatError('chunks: expected an array.');
  }
  return {
    meta: decodeMeta(data.meta),
    player: decodePlayer(data.player, registries.items),
    chests: decodeChests(data.chests, registries.items),
    chunks: chunks.map((chunk, i) => decodeChunk(chunk, i, registries.blocks)),
  };
}

function decodeMeta(value: unknown): WorldMetaRecord {
  const meta = expectRecord(value, 'meta');
  const timeOfDay = expectNumber(meta.timeOfDay, 'meta.timeOfDay');
  if (timeOfDay < 0 || timeOfDay >= 1) {
    throw new SaveFormatError(`meta.timeOfDay ${timeOfDay} outside [0, 1).`);
  }
  return {
    version: expectInt(meta.version, 'meta.version', 1, SAVE_FORMAT_VERSION),
    seed: expectNumber(meta.seed, 'meta.seed'),
    timeOfDay,
    dayCount: expectInt(meta.dayCount, 'meta.dayCount', 0, Number.MAX_SAFE_INTEGER),
    savedAt: expectNumber(meta.savedAt, 'meta.savedAt'),
  };
}

function decodePlayer(value: unknown, items: ItemRegistry): PlayerRecord {
  const player = expectRecord(value, 'player');
  const position = expectRecord(player.position, 'player.position');
  const inventory = decodeSlotsRecord(player.inventory, 'player.inventory', INVENTORY_CONFIG.inventorySlots);
  decodeSlots(inventory, items);
  return {
    position: {
      x: expectNumber(position.x, 'player.position.x'),
      y: expectNumber(position.y, 'player.position.y'),
      z: expectNumber(position.z, 'player.position.z'),
    },
    yaw: expectNumber(player.yaw, 'player.yaw'),
    pitch: expectNumber(player.pitch, 'player.pitch'),
    health: expectInt(player.health, 'player.health', 0, SURVIVAL_CONFIG.maxHealth),
    hunger: expectInt(player.hunger, 'player.hunger', 0, SURVIVAL_CONFIG.maxHunger),
    exhaustion: expectNumber(player.exhaustion, 'player.exhaustion', 0),
    selectedHotbar: expectInt(player.selectedHotbar, 'player.selectedHotbar', 0, INVENTORY_CONFIG.hotbarSlots - 1),
    inventory,
  };
}

function decodeChests(value: unknown, items: ItemRegistry): ChestsRecord {
  const chests = expectRecord(value, 'chests');
  const slotsPerChest = expectInt(chests.slotsPerChest, 'chests.slotsPerChest', CHEST_CONFIG.slots, CHEST_CONFIG.slots);
  const positions = expectPositions(chests.positions, 'chests.positions');
  const initialised = expectPositions(chests.initialised, 'chests.initialised');
  const contents = decodeSlotsRecord(chests.contents, 'chests.contents', (positions.length / 3) * slotsPerChest);
  decodeSlots(contents, items);
  return { slotsPerChest, positions, contents, initialised };
}

function decodeChunk(value: unknown, i: number, blocks: BlockRegistry): ChunkEditsRecord {
  const label = `chunks[${i}]`;
  const chunk = expectRecord(value, label);
  const cx = expectInt(chunk.cx, `${label}.cx`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const cz = expectInt(chunk.cz, `${label}.cz`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const indices = chunk.indices;
  const ids = chunk.blocks;
  if (!(indices instanceof Uint16Array) || !(ids instanceof Uint8Array) || indices.length !== ids.length) {
    throw new SaveFormatError(`${label}: expected Uint16Array indices and Uint8Array blocks of equal length.`);
  }
  for (let k = 0; k < indices.length; k += 1) {
    const index = indices[k] as number;
    if (index >= CHUNK_VOLUME || (k > 0 && index <= (indices[k - 1] as number))) {
      throw new SaveFormatError(`${label}: indices must be ascending, unique and < ${CHUNK_VOLUME}.`);
    }
    if (!blocks.has(ids[k] as number)) {
      throw new SaveFormatError(`${label}: unknown block id ${ids[k]}.`);
    }
  }
  return { cx, cz, indices, blocks: ids };
}

function decodeSlotsRecord(value: unknown, label: string, expectedLength: number): SlotsRecord {
  const record = expectRecord(value, label);
  const { itemIds, counts, damage } = record;
  if (!(itemIds instanceof Uint16Array) || !(counts instanceof Uint8Array) || !(damage instanceof Uint16Array)) {
    throw new SaveFormatError(`${label}: expected Uint16Array itemIds, Uint8Array counts, Uint16Array damage.`);
  }
  if (itemIds.length !== expectedLength || counts.length !== expectedLength || damage.length !== expectedLength) {
    throw new SaveFormatError(`${label}: expected ${expectedLength} slots.`);
  }
  return { itemIds, counts, damage };
}

function expectPositions(value: unknown, label: string): Int32Array {
  if (!(value instanceof Int32Array) || value.length % 3 !== 0) {
    throw new SaveFormatError(`${label}: expected an Int32Array of x,y,z triples.`);
  }
  for (let i = 0; i < value.length; i += 3) {
    const y = value[i + 1] as number;
    if (
      y < 0 ||
      y >= WORLD_CONFIG.chunkHeight ||
      Math.abs(value[i] as number) >= CHEST_CONFIG.maxHorizontalCoord ||
      Math.abs(value[i + 2] as number) >= CHEST_CONFIG.maxHorizontalCoord
    ) {
      throw new SaveFormatError(`${label}: position ${i / 3} is outside the world bounds.`);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SaveFormatError(`${label}: expected an object.`);
  }
  return value;
}

function expectNumber(value: unknown, label: string, min = Number.NEGATIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new SaveFormatError(`${label}: expected a finite number >= ${min}, got ${String(value)}.`);
  }
  return value;
}

function expectInt(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new SaveFormatError(`${label}: expected an integer in ${min}..${max}, got ${String(value)}.`);
  }
  return value;
}
