import type { GameTime } from '../world/GameTime';
import type { BlockEditStore } from '../world/BlockEditStore';
import type { PlayerState } from '../player/PlayerState';
import type { PlayerHealth } from '../player/PlayerHealth';
import type { PlayerHunger } from '../player/PlayerHunger';
import type { Inventory } from '../items/Inventory';
import type { ChestStore } from '../items/ChestStore';
import type { ItemRegistry } from '../items/ItemRegistry';
import { itemRegistry as defaultItemRegistry } from '../items/ItemRegistry';
import type { ItemStack } from '../items/ItemStack';
import {
  SAVE_FORMAT_VERSION,
  decodeSave,
  decodeSlots,
  encodeSlots,
  type ChestsRecord,
  type PlayerRecord,
  type SaveData,
  type SaveSnapshot,
  type SlotsRecord,
  type WorldMetaRecord,
} from './saveFormat';
import { CHEST_CONFIG } from '../config/constants';

/** Live game objects a save is captured from and restored into. */
export interface GameSaveState {
  readonly seed: number;
  readonly gameTime: GameTime;
  readonly player: PlayerState;
  readonly health: PlayerHealth;
  readonly hunger: PlayerHunger;
  readonly inventory: Inventory;
  readonly chests: ChestStore;
}

/** Storage backend (IndexedDB in the browser; in-memory fakes in tests). */
export interface SaveBackend {
  /** Raw stored data (decoded by `decodeSave`), or null when nothing is stored. */
  load(): Promise<unknown>;
  write(snapshot: SaveSnapshot): Promise<void>;
}

export interface SaveLogger {
  warn(message: string, ...details: unknown[]): void;
}

export function captureMeta(state: GameSaveState, now: number): WorldMetaRecord {
  return {
    version: SAVE_FORMAT_VERSION,
    seed: state.seed,
    timeOfDay: state.gameTime.timeOfDay,
    dayCount: state.gameTime.dayCount,
    savedAt: now,
  };
}

export function capturePlayer(state: GameSaveState): PlayerRecord {
  const { position, yaw, pitch } = state.player;
  return {
    position: { x: position.x, y: position.y, z: position.z },
    yaw,
    pitch,
    health: state.health.health,
    hunger: state.hunger.hunger,
    exhaustion: state.hunger.exhaustion,
    selectedHotbar: state.inventory.selectedHotbarIndex,
    inventory: encodeSlots(state.inventory.slots()),
  };
}

export function captureChests(chests: ChestStore): ChestsRecord {
  const entries = chests.entries();
  const initialised = chests.initialisedPositions();
  const positions = new Int32Array(entries.length * 3);
  const slots: (ItemStack | null)[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === undefined) {
      continue;
    }
    positions.set([entry.x, entry.y, entry.z], i * 3);
    slots.push(...entry.container.slots());
  }
  const initialisedArray = new Int32Array(initialised.length * 3);
  initialised.forEach((p, i) => initialisedArray.set([p.x, p.y, p.z], i * 3));
  return {
    slotsPerChest: CHEST_CONFIG.slots,
    positions,
    contents: encodeSlots(slots),
    initialised: initialisedArray,
  };
}

/** Complete save of the current state including every chunk's edits (no dirty tracking). */
export function captureSave(state: GameSaveState, edits: BlockEditStore, now: number): SaveData {
  return {
    meta: captureMeta(state, now),
    player: capturePlayer(state),
    chests: captureChests(state.chests),
    chunks: edits.allRecords(),
  };
}

/**
 * Restores a decoded save into the live objects (chunk edits are restored
 * separately via `BlockEditStore.restore(data.chunks)` before chunks load).
 * The seed is not applied here: the world generator must be built with
 * `data.meta.seed` before anything is generated.
 */
export function applySave(data: SaveData, state: GameSaveState, items: ItemRegistry = defaultItemRegistry): void {
  const { meta, player } = data;
  state.gameTime.restore(meta.dayCount, meta.timeOfDay);

  state.player.position.x = player.position.x;
  state.player.position.y = player.position.y;
  state.player.position.z = player.position.z;
  state.player.velocity.x = 0;
  state.player.velocity.y = 0;
  state.player.velocity.z = 0;
  state.player.yaw = player.yaw;
  state.player.pitch = player.pitch;

  state.health.restore(player.health);
  state.hunger.restore(player.hunger, player.exhaustion);

  fillInventory(state.inventory, player.inventory, items);
  state.inventory.selectHotbar(player.selectedHotbar);

  restoreChests(state.chests, data.chests, items);
}

function fillInventory(inventory: Inventory, record: SlotsRecord, items: ItemRegistry, start = 0): void {
  const stacks = decodeSlots(record, items, start, inventory.size);
  inventory.clear();
  stacks.forEach((stack, slot) => inventory.set(slot, stack));
}

function restoreChests(chests: ChestStore, record: ChestsRecord, items: ItemRegistry): void {
  for (let i = 0; i < record.initialised.length; i += 3) {
    chests.markInitialised(record.initialised[i] as number, record.initialised[i + 1] as number, record.initialised[i + 2] as number);
  }
  for (let i = 0; i < record.positions.length / 3; i += 1) {
    const container = chests.getOrCreate(
      record.positions[i * 3] as number,
      record.positions[i * 3 + 1] as number,
      record.positions[i * 3 + 2] as number,
    );
    fillInventory(container, record.contents, items, i * record.slotsPerChest);
  }
}

/**
 * Outcome of `loadSave`. 'blocked' means a save exists (or may exist) that
 * this build could not read — a read error, invalid data, or a newer format
 * version. The game then starts a new world but must NOT write, so the
 * existing save is never overwritten (see `createWorldSaver`).
 */
export type LoadSaveResult =
  | { readonly status: 'loaded'; readonly data: SaveData }
  | { readonly status: 'empty' }
  | { readonly status: 'blocked'; readonly error: unknown };

const BLOCKED_WARNING = 'saving is disabled for this session so the existing save is not overwritten.';

/** Loads and decodes the stored save; logs a warning when the result is 'blocked'. */
export async function loadSave(backend: SaveBackend | null, logger: SaveLogger = console): Promise<LoadSaveResult> {
  if (backend === null) {
    return { status: 'empty' };
  }
  let raw: unknown;
  try {
    raw = await backend.load();
  } catch (error) {
    logger.warn(`[save] failed to read the saved world; starting a new world, ${BLOCKED_WARNING}`, error);
    return { status: 'blocked', error };
  }
  if (raw === null || raw === undefined) {
    return { status: 'empty' };
  }
  try {
    return { status: 'loaded', data: decodeSave(raw) };
  } catch (error) {
    logger.warn(`[save] saved world is invalid or from a newer version; starting a new world, ${BLOCKED_WARNING}`, error);
    return { status: 'blocked', error };
  }
}

/**
 * The saver for this session, or null when saving must stay off: no backend,
 * or the existing save could not be read ('blocked'). A new world (nothing
 * stored) replaces all chunk records on its first write.
 */
export function createWorldSaver(
  backend: SaveBackend | null,
  load: LoadSaveResult,
  state: GameSaveState,
  edits: BlockEditStore,
): WorldSaver | null {
  if (backend === null || load.status === 'blocked') {
    return null;
  }
  return new WorldSaver(backend, state, edits, { newWorld: load.status === 'empty' });
}

/**
 * Change detector for the player/chest part of a save. Exhaustion is left
 * out (it drains every frame) and so is time (always advancing); both are
 * still written with every save.
 */
function stateFingerprint(player: PlayerRecord, chests: ChestsRecord): string {
  const { position, yaw, pitch, health, hunger, selectedHotbar, inventory } = player;
  return [
    position.x,
    position.y,
    position.z,
    yaw,
    pitch,
    health,
    hunger,
    selectedHotbar,
    inventory.itemIds.join(),
    inventory.counts.join(),
    inventory.damage.join(),
    chests.positions.join(),
    chests.contents.itemIds.join(),
    chests.contents.counts.join(),
    chests.contents.damage.join(),
    chests.initialised.join(),
  ].join('|');
}

/**
 * Builds and writes save snapshots: every write carries meta, player and
 * chests; chunk edits are written only for chunks changed since the last
 * successful write (a failed write re-marks them dirty). A new world's first
 * write replaces all stored chunk records.
 */
export class WorldSaver {
  private readonly now: () => number;
  private needsFullChunkWrite: boolean;
  private lastFingerprint: string | null = null;

  constructor(
    private readonly backend: SaveBackend,
    private readonly state: GameSaveState,
    private readonly edits: BlockEditStore,
    options: { readonly newWorld: boolean; readonly now?: () => number },
  ) {
    this.needsFullChunkWrite = options.newWorld;
    this.now = options.now ?? Date.now;
    if (!options.newWorld) {
      this.lastFingerprint = stateFingerprint(capturePlayer(state), captureChests(state.chests));
    }
  }

  /** True when a write would persist something new (chunk edits, player or chest changes). */
  isDirty(): boolean {
    if (this.needsFullChunkWrite || this.edits.hasDirty()) {
      return true;
    }
    return stateFingerprint(capturePlayer(this.state), captureChests(this.state.chests)) !== this.lastFingerprint;
  }

  /** Captures a snapshot synchronously (so it can run inside `pagehide`) and writes it. */
  save(): Promise<void> {
    const full = this.needsFullChunkWrite;
    const dirty = this.edits.takeDirty();
    const player = capturePlayer(this.state);
    const chests = captureChests(this.state.chests);
    const snapshot: SaveSnapshot = {
      meta: captureMeta(this.state, this.now()),
      player,
      chests,
      chunkPuts: full ? this.edits.allRecords() : dirty.puts,
      chunkDeletes: full ? [] : dirty.deletes,
      replaceAllChunks: full,
    };
    const fingerprint = stateFingerprint(player, chests);
    return this.backend.write(snapshot).then(
      () => {
        this.lastFingerprint = fingerprint;
        if (full) {
          this.needsFullChunkWrite = false;
        }
      },
      (error: unknown) => {
        if (!full) {
          this.edits.markDirty([...dirty.puts, ...dirty.deletes]);
        }
        throw error;
      },
    );
  }
}
