import { describe, it, expect } from 'vitest';
import {
  SAVE_FORMAT_VERSION,
  SaveFormatError,
  SaveVersionError,
  decodeSave,
  decodeSlots,
  encodeSlots,
  migrate,
  type SaveData,
} from '../src/save/saveFormat';
import { createStack } from '../src/items/ItemStack';
import { ItemId } from '../src/items/items';
import { BlockId } from '../src/world/blocks';
import { CHEST_CONFIG, INVENTORY_CONFIG } from '../src/config/constants';

function emptySlots(n: number): ReturnType<typeof encodeSlots> {
  return encodeSlots(new Array(n).fill(null));
}

function validSave(): SaveData {
  const inventory = new Array(INVENTORY_CONFIG.inventorySlots).fill(null);
  inventory[0] = createStack(ItemId.Stone, 12);
  inventory[3] = createStack(ItemId.StonePickaxe, 1, undefined, 17);
  const chestSlots = new Array(CHEST_CONFIG.slots).fill(null);
  chestSlots[2] = createStack(ItemId.Apple, 3);
  return {
    meta: { version: SAVE_FORMAT_VERSION, seed: 42, timeOfDay: 0.25, dayCount: 2, savedAt: 1_700_000_000_000 },
    player: {
      position: { x: 1.5, y: 40, z: -7.25 },
      yaw: 1.2,
      pitch: -0.3,
      health: 14,
      hunger: 9,
      exhaustion: 1.75,
      selectedHotbar: 3,
      inventory: encodeSlots(inventory),
    },
    chests: {
      slotsPerChest: CHEST_CONFIG.slots,
      positions: new Int32Array([-10, 43, 5]),
      contents: encodeSlots(chestSlots),
      initialised: new Int32Array([-10, 43, 5, 81, 43, -42]),
    },
    chunks: [
      { cx: -1, cz: 2, indices: new Uint16Array([3, 900, 32767]), blocks: new Uint8Array([BlockId.Air, BlockId.Glass, BlockId.Torch]) },
    ],
  };
}

/** What IndexedDB would hand back (structured clone keeps TypedArrays). */
function stored(data: unknown): Record<string, unknown> {
  return structuredClone(data) as Record<string, unknown>;
}

function expectFormatError(fn: () => unknown): void {
  expect(fn).toThrow(SaveFormatError);
}

describe('slot encoding', () => {
  it('round-trips stacks, empty slots and tool damage', () => {
    const slots = [createStack(ItemId.Dirt, 64), null, createStack(ItemId.WoodenAxe, 1, undefined, 5), createStack(ItemId.StoneShovel, 1)];
    const record = encodeSlots(slots);
    expect(record.itemIds).toBeInstanceOf(Uint16Array);
    expect(record.counts).toBeInstanceOf(Uint8Array);
    expect(record.damage).toBeInstanceOf(Uint16Array);
    expect(decodeSlots(record)).toEqual(slots);
  });

  it('rejects unknown items, bad counts, damage on non-tools and junk in empty slots', () => {
    const bad = (itemId: number, count: number, damage: number): void =>
      expectFormatError(() =>
        decodeSlots({ itemIds: new Uint16Array([itemId]), counts: new Uint8Array([count]), damage: new Uint16Array([damage]) }),
      );
    bad(999, 1, 0);
    bad(ItemId.Stone, 0, 0);
    bad(ItemId.Stone, 65, 0);
    bad(ItemId.Stone, 1, 3);
    bad(ItemId.WoodenAxe, 1, 64);
    bad(ItemId.None, 2, 0);
  });
});

describe('decodeSave', () => {
  it('round-trips every section through structured clone', () => {
    const data = validSave();
    expect(decodeSave(stored(data))).toEqual(data);
  });

  it('accepts a save with no chests or chunk edits', () => {
    const data = {
      ...validSave(),
      chests: { slotsPerChest: CHEST_CONFIG.slots, positions: new Int32Array(0), contents: emptySlots(0), initialised: new Int32Array(0) },
      chunks: [],
    };
    expect(decodeSave(stored(data)).chunks).toEqual([]);
  });

  it('rejects garbage with a typed SaveFormatError', () => {
    for (const garbage of [null, 42, 'save', [], {}, { meta: 'x' }, { meta: {} }]) {
      expectFormatError(() => decodeSave(garbage));
    }
  });

  it('rejects out-of-range or mistyped fields', () => {
    const cases: ((d: Record<string, unknown>) => void)[] = [
      (d) => ((d.meta as Record<string, unknown>).timeOfDay = 1),
      (d) => ((d.meta as Record<string, unknown>).seed = Number.NaN),
      (d) => ((d.player as Record<string, unknown>).health = 21),
      (d) => ((d.player as Record<string, unknown>).hunger = 2.5),
      (d) => ((d.player as Record<string, unknown>).selectedHotbar = 9),
      (d) => ((d.player as Record<string, unknown>).inventory = emptySlots(10)),
      (d) => ((d.player as Record<string, unknown>).position = { x: 0, y: 'up', z: 0 }),
      (d) => ((d.chests as Record<string, unknown>).positions = new Int32Array([0, 200, 0])),
      (d) => ((d.chests as Record<string, unknown>).positions = [0, 40, 0]),
      (d) => ((d.chests as Record<string, unknown>).contents = emptySlots(5)),
      (d) => (d.chunks = {}),
      (d) => (d.chunks = [{ cx: 0, cz: 0, indices: [1], blocks: new Uint8Array([1]) }]),
      (d) => (d.chunks = [{ cx: 0, cz: 0, indices: new Uint16Array([5, 5]), blocks: new Uint8Array([1, 1]) }]),
      (d) => (d.chunks = [{ cx: 0, cz: 0, indices: new Uint16Array([32768 - 1]), blocks: new Uint8Array([250]) }]),
      (d) => (d.chunks = [{ cx: 0.5, cz: 0, indices: new Uint16Array(0), blocks: new Uint8Array(0) }]),
    ];
    for (const mutate of cases) {
      const data = stored(validSave());
      mutate(data);
      expectFormatError(() => decodeSave(data));
    }
  });
});

describe('versioning', () => {
  it('v1 migrates as identity', () => {
    const data = stored(validSave());
    expect(migrate(data)).toBe(data);
  });

  it('rejects a future version with SaveVersionError (also a SaveFormatError)', () => {
    const data = stored(validSave());
    (data.meta as Record<string, unknown>).version = SAVE_FORMAT_VERSION + 1;
    expect(() => decodeSave(data)).toThrow(SaveVersionError);
    expectFormatError(() => decodeSave(data));
  });

  it('rejects a missing or invalid version', () => {
    for (const version of [undefined, 0, -1, 1.5, '1']) {
      const data = stored(validSave());
      (data.meta as Record<string, unknown>).version = version;
      expectFormatError(() => migrate(data));
    }
  });
});
