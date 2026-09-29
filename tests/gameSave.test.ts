import { describe, it, expect, vi } from 'vitest';
import {
  applySave,
  captureSave,
  createWorldSaver,
  loadSave,
  WorldSaver,
  type GameSaveState,
  type SaveBackend,
} from '../src/save/gameSave';
import { SAVE_FORMAT_VERSION, SaveFormatError, decodeSave, type SaveSnapshot } from '../src/save/saveFormat';
import { GameTime } from '../src/world/GameTime';
import { BlockEditStore } from '../src/world/BlockEditStore';
import { createPlayerState } from '../src/player/PlayerState';
import { PlayerHealth } from '../src/player/PlayerHealth';
import { PlayerHunger } from '../src/player/PlayerHunger';
import { Inventory } from '../src/items/Inventory';
import { ChestStore, chestKey, chestPositionFromKey } from '../src/items/ChestStore';
import { openChestContainer } from '../src/gameplay/chestActions';
import { createStack } from '../src/items/ItemStack';
import { ItemId } from '../src/items/items';
import { BlockId } from '../src/world/blocks';
import { chunkKey } from '../src/world/chunkCoords';
import type { BlockChange } from '../src/world/blockEdit';
import { CHEST_CONFIG } from '../src/config/constants';

function freshState(seed = 7): GameSaveState {
  return {
    seed,
    gameTime: new GameTime(),
    player: createPlayerState({ x: 0, y: 50, z: 0 }),
    health: new PlayerHealth(),
    hunger: new PlayerHunger(),
    inventory: new Inventory(),
    chests: new ChestStore(),
  };
}

/** A played-for-a-while state touching every saved section. */
function playedState(): GameSaveState {
  const state = freshState(1234);
  state.gameTime.restore(3, 0.6);
  state.player.position.x = 12.5;
  state.player.position.y = 44;
  state.player.position.z = -30.25;
  state.player.yaw = 2.1;
  state.player.pitch = -0.4;
  state.health.damage(7, 'fall');
  state.hunger.addExhaustion(9.5);
  state.inventory.set(0, createStack(ItemId.Cobblestone, 40));
  state.inventory.set(4, createStack(ItemId.StonePickaxe, 1, undefined, 33));
  state.inventory.set(35, createStack(ItemId.Apple, 2));
  state.inventory.selectHotbar(4);
  state.chests.getOrCreate(-5, 43, 9).set(0, createStack(ItemId.Coal, 8));
  state.chests.getOrCreate(100, 20, -200).set(26, createStack(ItemId.WoodenAxe, 1, undefined, 3));
  state.chests.getOrCreate(1, 1, 1);
  state.chests.remove(1, 1, 1); // broken chest: position stays initialised
  return state;
}

function edit(cx: number, cz: number, lx: number, previous: number, next: number): BlockChange {
  return { wx: cx * 16 + lx, wy: 30, wz: cz * 16, cx, cz, lx, ly: 30, lz: 0, previous, next } as BlockChange;
}

/** In-memory backend mirroring the IndexedDB store layout and structured-clone semantics. */
class MemoryBackend implements SaveBackend {
  meta: unknown;
  player: unknown;
  chests: unknown;
  readonly chunks = new Map<string, unknown>();
  readonly writes: SaveSnapshot[] = [];
  failNext = false;

  load(): Promise<unknown> {
    if (this.meta === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      structuredClone({ meta: this.meta, player: this.player, chests: this.chests, chunks: [...this.chunks.values()] }),
    );
  }

  write(snapshot: SaveSnapshot): Promise<void> {
    this.writes.push(snapshot);
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('quota'));
    }
    this.meta = structuredClone(snapshot.meta);
    this.player = structuredClone(snapshot.player);
    this.chests = structuredClone(snapshot.chests);
    if (snapshot.replaceAllChunks) {
      this.chunks.clear();
    }
    for (const record of snapshot.chunkPuts) {
      this.chunks.set(chunkKey(record.cx, record.cz), structuredClone(record));
    }
    for (const { cx, cz } of snapshot.chunkDeletes) {
      this.chunks.delete(chunkKey(cx, cz));
    }
    return Promise.resolve();
  }
}

const silent = { warn: (): void => {} };

describe('chest key inverse', () => {
  it('chestPositionFromKey inverts chestKey, including negative coordinates', () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [-5, 43, 9],
      [1_048_575, 127, -1_048_575],
      [-1_048_575, 1, 1_048_575],
    ] as const) {
      expect(chestPositionFromKey(chestKey(x, y, z))).toEqual({ x, y, z });
    }
  });
});

describe('capture + apply round trip', () => {
  it('restores time, player position/look, health, hunger, inventory (incl. durability) and chests', () => {
    const source = playedState();
    const data = decodeSave(structuredClone(captureSave(source, new BlockEditStore(), 99)));
    const target = freshState(data.meta.seed);
    applySave(data, target);

    expect(data.meta).toMatchObject({ version: SAVE_FORMAT_VERSION, seed: 1234, dayCount: 3, savedAt: 99 });
    expect(target.gameTime.dayCount).toBe(3);
    expect(target.gameTime.timeOfDay).toBeCloseTo(0.6, 10);
    expect(target.player.position).toEqual(source.player.position);
    expect([target.player.yaw, target.player.pitch]).toEqual([2.1, -0.4]);
    expect(target.health.health).toBe(13);
    expect(target.health.isDead).toBe(false);
    expect(target.hunger.hunger).toBe(source.hunger.hunger);
    expect(target.hunger.exhaustion).toBeCloseTo(source.hunger.exhaustion, 10);
    expect(target.inventory.slots()).toEqual(source.inventory.slots());
    expect(target.inventory.getSlot(4)).toEqual({ itemId: ItemId.StonePickaxe, count: 1, damage: 33 });
    expect(target.inventory.selectedHotbarIndex).toBe(4);

    expect(target.chests.size).toBe(2);
    expect(target.chests.get(-5, 43, 9)?.slots()).toEqual(source.chests.get(-5, 43, 9)?.slots());
    expect(target.chests.get(100, 20, -200)?.getSlot(26)).toEqual({ itemId: ItemId.WoodenAxe, count: 1, damage: 3 });
    expect(target.chests.has(1, 1, 1)).toBe(false);
    expect(target.chests.wasInitialised(1, 1, 1)).toBe(true);
  });

  it('an initialised structure chest is not refilled with loot after loading', () => {
    const source = freshState();
    const ctx = { chests: source.chests, worldSeed: 1, lootTableAt: (): string => 'ruin_chest' };
    const looted = openChestContainer(ctx, 3, 40, 3);
    expect(looted.slots().some((s) => s !== null)).toBe(true);
    looted.clear(); // player emptied it
    openChestContainer(ctx, 6, 40, 6);
    source.chests.remove(6, 40, 6); // structure chest broken: container gone, position initialised
    const target = freshState();
    applySave(decodeSave(structuredClone(captureSave(source, new BlockEditStore(), 0))), target);
    const reopen = (x: number, z: number): boolean =>
      openChestContainer({ ...ctx, chests: target.chests }, x, 40, z).slots().every((s) => s === null);
    expect(reopen(3, 3)).toBe(true);
    expect(reopen(6, 6)).toBe(true);
    // Control: a never-opened position still rolls loot.
    expect(reopen(9, 9)).toBe(false);
  });

  it('restores the dead state when saved at 0 health', () => {
    const source = freshState();
    source.health.damage(100, 'void');
    const target = freshState();
    applySave(decodeSave(structuredClone(captureSave(source, new BlockEditStore(), 0))), target);
    expect(target.health.isDead).toBe(true);
  });

  it('chest contents are stored as one concatenated slot block', () => {
    const data = captureSave(playedState(), new BlockEditStore(), 0);
    expect(data.chests.positions.length).toBe(6);
    expect(data.chests.contents.itemIds.length).toBe(2 * CHEST_CONFIG.slots);
    expect(data.chests.initialised.length).toBe(9);
  });
});

describe('loadSave', () => {
  it('reports empty without a backend or when nothing is stored', async () => {
    expect(await loadSave(null, silent)).toEqual({ status: 'empty' });
    expect(await loadSave(new MemoryBackend(), silent)).toEqual({ status: 'empty' });
  });

  it('loads what WorldSaver wrote, including chunk edits', async () => {
    const backend = new MemoryBackend();
    const edits = new BlockEditStore();
    edits.record(edit(2, -3, 5, BlockId.Stone, BlockId.Air));
    await new WorldSaver(backend, playedState(), edits, { newWorld: true, now: () => 5 }).save();

    const result = await loadSave(backend, silent);
    if (result.status !== 'loaded') throw new Error(`expected loaded, got ${result.status}`);
    expect(result.data.meta.seed).toBe(1234);
    const restored = new BlockEditStore();
    restored.restore(result.data.chunks);
    expect(restored.editAt(2, -3, 5 + 16 * (0 + 16 * 30))).toBe(BlockId.Air);
  });

  it('warns and reports blocked for invalid, future-version or unreadable saves', async () => {
    const warn = vi.fn();
    const backend = new MemoryBackend();
    await new WorldSaver(backend, playedState(), new BlockEditStore(), { newWorld: true }).save();

    (backend.player as Record<string, unknown>).health = -3;
    const invalid = await loadSave(backend, { warn });
    expect(invalid.status).toBe('blocked');
    expect(warn.mock.calls[0]?.[1]).toBeInstanceOf(SaveFormatError);

    backend.meta = { ...(backend.meta as object), version: SAVE_FORMAT_VERSION + 1 };
    expect((await loadSave(backend, { warn })).status).toBe('blocked');

    const broken: SaveBackend = { load: () => Promise.reject(new Error('io')), write: () => Promise.resolve() };
    expect((await loadSave(broken, { warn })).status).toBe('blocked');
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

// Regression (Codex review): a save this build couldn't read (e.g. written by a
// newer version) fell back to a new world whose first save overwrote it.
describe('createWorldSaver', () => {
  it('never writes over a save from a newer format version', async () => {
    const backend = new MemoryBackend();
    await new WorldSaver(backend, playedState(), new BlockEditStore(), { newWorld: true }).save();
    backend.meta = { ...(backend.meta as object), version: SAVE_FORMAT_VERSION + 1 };
    const before = JSON.stringify(backend.meta);
    const write = vi.spyOn(backend, 'write');

    const result = await loadSave(backend, silent);
    const saver = createWorldSaver(backend, result, playedState(), new BlockEditStore());

    expect(saver).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(JSON.stringify(backend.meta)).toBe(before);
  });

  it('never writes when the save could not be read', async () => {
    const write = vi.fn(() => Promise.resolve());
    const broken: SaveBackend = { load: () => Promise.reject(new Error('io')), write };
    const result = await loadSave(broken, silent);
    expect(createWorldSaver(broken, result, playedState(), new BlockEditStore())).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it('saves normally for a new world and for a loaded world', async () => {
    const empty = new MemoryBackend();
    expect(createWorldSaver(empty, await loadSave(empty, silent), playedState(), new BlockEditStore())).not.toBeNull();

    const backend = new MemoryBackend();
    await new WorldSaver(backend, playedState(), new BlockEditStore(), { newWorld: true }).save();
    const loaded = await loadSave(backend, silent);
    expect(loaded.status).toBe('loaded');
    expect(createWorldSaver(backend, loaded, playedState(), new BlockEditStore())).not.toBeNull();
  });
});

describe('WorldSaver dirty tracking', () => {
  it('first save of a new world replaces all chunk records; later saves write only dirty chunks', async () => {
    const backend = new MemoryBackend();
    backend.chunks.set('9,9', { stale: true });
    const state = freshState();
    const edits = new BlockEditStore();
    edits.record(edit(0, 0, 1, BlockId.Stone, BlockId.Air));
    const saver = new WorldSaver(backend, state, edits, { newWorld: true });

    await saver.save();
    expect(backend.writes[0]?.replaceAllChunks).toBe(true);
    expect([...backend.chunks.keys()]).toEqual(['0,0']);

    edits.record(edit(1, 0, 2, BlockId.Stone, BlockId.Glass));
    await saver.save();
    const second = backend.writes[1];
    expect(second?.replaceAllChunks).toBe(false);
    expect(second?.chunkPuts.map((r) => chunkKey(r.cx, r.cz))).toEqual(['1,0']);
    expect([...backend.chunks.keys()].sort()).toEqual(['0,0', '1,0']);

    await saver.save();
    expect(backend.writes[2]?.chunkPuts).toEqual([]);
  });

  it('reverting every edit in a chunk deletes its stored record', async () => {
    const backend = new MemoryBackend();
    const edits = new BlockEditStore();
    const saver = new WorldSaver(backend, freshState(), edits, { newWorld: true });
    edits.record(edit(4, 4, 0, BlockId.Dirt, BlockId.Air));
    await saver.save();
    edits.record(edit(4, 4, 0, BlockId.Air, BlockId.Dirt));
    await saver.save();
    expect(backend.writes[1]?.chunkDeletes).toEqual([{ cx: 4, cz: 4 }]);
    expect(backend.chunks.size).toBe(0);
  });

  it('a failed write keeps its chunks dirty for the next save', async () => {
    const backend = new MemoryBackend();
    const edits = new BlockEditStore();
    const saver = new WorldSaver(backend, freshState(), edits, { newWorld: false });
    edits.record(edit(0, 1, 0, BlockId.Stone, BlockId.Air));
    backend.failNext = true;
    await expect(saver.save()).rejects.toThrow('quota');
    expect(saver.isDirty()).toBe(true);
    await saver.save();
    expect([...backend.chunks.keys()]).toEqual(['0,1']);
  });

  it('isDirty tracks player/inventory/chest changes but ignores time and exhaustion', async () => {
    const backend = new MemoryBackend();
    const state = freshState();
    const saver = new WorldSaver(backend, state, new BlockEditStore(), { newWorld: false });
    expect(saver.isDirty()).toBe(false);

    state.gameTime.advance(30);
    state.hunger.addExhaustion(0.1);
    expect(saver.isDirty()).toBe(false);

    state.player.position.x += 1;
    expect(saver.isDirty()).toBe(true);
    await saver.save();
    expect(saver.isDirty()).toBe(false);

    state.chests.getOrCreate(0, 10, 0).set(0, createStack(ItemId.Dirt, 1));
    expect(saver.isDirty()).toBe(true);
    await saver.save();

    state.inventory.set(8, createStack(ItemId.Sand, 3));
    expect(saver.isDirty()).toBe(true);
  });

  it('a new world is dirty until its first successful save', () => {
    const saver = new WorldSaver(new MemoryBackend(), freshState(), new BlockEditStore(), { newWorld: true });
    expect(saver.isDirty()).toBe(true);
  });
});
