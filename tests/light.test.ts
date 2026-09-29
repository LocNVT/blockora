import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG } from '../src/config/constants';
import { BlockId } from '../src/world/blocks';
import { BlockRegistry, blockRegistry } from '../src/world/BlockRegistry';
import { BLOCK_DEFINITIONS } from '../src/world/blocks';
import { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { ChunkManager } from '../src/world/ChunkManager';
import { chunkKey, localIndex, type ChunkCoord } from '../src/world/chunkCoords';
import { setBlockAt, applyLightAndCollectRemesh } from '../src/world/blockEdit';
import {
  LightEngine,
  LightQueue,
  LightChannel,
  blockLightOf,
  channelOf,
  createLightSampler,
  getBlockLight,
  getSkyLight,
  lightNeighborhoodFromStore,
  packLight,
  skyLightOf,
  withChannel,
  OPEN_SKY_LIGHT,
} from '../src/world/light';

const { chunkWidth: W, chunkDepth: D, chunkHeight: H } = WORLD_CONFIG;

type Fill = (wx: number, y: number, wz: number) => number;

const GROUND_TOP = 9;
const flatGround: Fill = (_x, y) => (y <= GROUND_TOP ? BlockId.Stone : BlockId.Air);

function makeChunk(cx: number, cz: number, fill: Fill): Chunk {
  const chunk = new Chunk(cx, cz);
  for (let y = 0; y < H; y += 1) {
    for (let z = 0; z < D; z += 1) {
      for (let x = 0; x < W; x += 1) {
        const id = fill(cx * W + x, y, cz * D + z);
        if (id !== BlockId.Air) {
          chunk.blocks[localIndex(x, y, z)] = id;
        }
      }
    }
  }
  return chunk;
}

/** Adds chunks to a fresh store and lights them in the given order. */
function buildWorld(coords: readonly ChunkCoord[], fill: Fill): { store: ChunkStore; light: LightEngine } {
  const store = new ChunkStore();
  const light = new LightEngine(store, blockRegistry);
  for (const { cx, cz } of coords) {
    store.setChunk(makeChunk(cx, cz, fill));
    light.lightChunk(cx, cz);
  }
  return { store, light };
}

/** Rebuilds every chunk of `store` from its blocks with a fresh engine, in `order`. */
function recomputeFromScratch(store: ChunkStore, order: readonly ChunkCoord[]): ChunkStore {
  const fresh = new ChunkStore();
  const light = new LightEngine(fresh, blockRegistry);
  for (const { cx, cz } of order) {
    const source = store.getChunk(cx, cz);
    if (source === undefined) throw new Error('missing chunk');
    fresh.setChunk(new Chunk(cx, cz, source.blocks.slice()));
    light.lightChunk(cx, cz);
  }
  return fresh;
}

function expectSameLight(actual: ChunkStore, expected: ChunkStore, context = ''): void {
  for (const chunk of expected.chunks()) {
    const other = actual.getChunk(chunk.cx, chunk.cz);
    expect(other, context).toBeDefined();
    const a = other?.light ?? new Uint8Array();
    const e = chunk.light;
    let firstDiff = -1;
    for (let i = 0; i < e.length; i += 1) {
      if (a[i] !== e[i]) {
        firstDiff = i;
        break;
      }
    }
    expect(firstDiff, `${context} chunk ${chunk.cx},${chunk.cz} first diff index`).toBe(-1);
  }
}

function edit(store: ChunkStore, light: LightEngine, wx: number, wy: number, wz: number, id: number): ChunkCoord[] {
  const change = setBlockAt(store, blockRegistry, wx, wy, wz, id);
  if (change === null) return [];
  return light.updateBlock(change.wx, change.wy, change.wz, change.previous, change.next);
}

function keys(coords: readonly ChunkCoord[]): string[] {
  return coords.map(({ cx, cz }) => chunkKey(cx, cz));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('light nibble packing', () => {
  it('packs sky in the high nibble and block in the low nibble', () => {
    const packed = packLight(13, 7);
    expect(packed).toBe(0xd7);
    expect(skyLightOf(packed)).toBe(13);
    expect(blockLightOf(packed)).toBe(7);
    expect(channelOf(packed, LightChannel.Sky)).toBe(13);
    expect(channelOf(packed, LightChannel.Block)).toBe(7);
  });

  it('withChannel replaces one channel without touching the other', () => {
    const packed = packLight(15, 3);
    expect(withChannel(packed, LightChannel.Block, 12)).toBe(packLight(15, 12));
    expect(withChannel(packed, LightChannel.Sky, 0)).toBe(packLight(0, 3));
    expect(withChannel(packLight(15, 15), LightChannel.Sky, 0)).toBe(packLight(0, 15));
  });
});

describe('LightQueue', () => {
  it('is FIFO and grows beyond its initial capacity without losing entries', () => {
    const queue = new LightQueue(2);
    for (let i = 0; i < 5; i += 1) queue.push(i, i + 1, i + 2, i + 3);
    const popped: number[] = [];
    while (queue.size > 0) {
      const offset = queue.shift();
      popped.push(queue.buffer[offset] ?? -1);
      if (popped.length === 2) queue.push(9, 0, 0, 0);
    }
    expect(popped).toEqual([0, 1, 2, 3, 4, 9]);
  });
});

describe('BlockRegistry light properties', () => {
  it('derives opacity from transparency, with explicit attenuation on leaves and water', () => {
    expect(blockRegistry.lightOpacity(BlockId.Air)).toBe(0);
    expect(blockRegistry.lightOpacity(BlockId.Glass)).toBe(0);
    expect(blockRegistry.lightOpacity(BlockId.Torch)).toBe(0);
    expect(blockRegistry.lightOpacity(BlockId.Leaves)).toBe(1);
    expect(blockRegistry.lightOpacity(BlockId.Water)).toBe(2);
    expect(blockRegistry.lightOpacity(BlockId.Stone)).toBe(15);
    expect(blockRegistry.lightEmission(BlockId.Torch)).toBe(14);
    expect(blockRegistry.lightEmission(BlockId.Stone)).toBe(0);
  });

  it('rejects out-of-range light values', () => {
    const air = BLOCK_DEFINITIONS[0];
    if (air === undefined) throw new Error('no air');
    expect(() => new BlockRegistry([{ ...air, lightLevel: 16 }])).toThrow(/lightLevel/);
    expect(() => new BlockRegistry([{ ...air, lightOpacity: -1 }])).toThrow(/lightOpacity/);
  });
});

describe('sky light: column fill', () => {
  it('open sky is 15 all the way down to the ground and 0 inside it', () => {
    const { store } = buildWorld([{ cx: 0, cz: 0 }], flatGround);
    for (let y = GROUND_TOP + 1; y < H; y += 1) {
      expect(getSkyLight(store, 5, y, 5)).toBe(15);
    }
    expect(getSkyLight(store, 5, GROUND_TOP, 5)).toBe(0);
    expect(getSkyLight(store, 5, 0, 5)).toBe(0);
  });

  it('a sealed air pocket gets no sky light', () => {
    const sealed: Fill = (x, y, z) =>
      y <= 30 && !(x >= 4 && x <= 8 && z >= 4 && z <= 8 && y >= 10 && y <= 14) ? BlockId.Stone : BlockId.Air;
    const { store } = buildWorld([{ cx: 0, cz: 0 }], sealed);
    expect(getSkyLight(store, 6, 12, 6)).toBe(0);
    expect(getSkyLight(store, 6, 31, 6)).toBe(15);
  });

  it('light under an overhang falls off by 1 per block from the open edge', () => {
    // Roof at y=20 over x in 0..7; x >= 8 is open sky.
    const overhang: Fill = (x, y) => (y <= GROUND_TOP || (y === 20 && x <= 7) ? BlockId.Stone : BlockId.Air);
    const { store } = buildWorld([{ cx: 0, cz: 0 }], overhang);
    expect(getSkyLight(store, 8, 15, 5)).toBe(15);
    for (let d = 1; d <= 8; d += 1) {
      expect(getSkyLight(store, 8 - d, 15, 5)).toBe(15 - d);
      expect(getSkyLight(store, 8 - d, GROUND_TOP + 1, 5)).toBe(15 - d);
    }
    expect(getSkyLight(store, 3, 20, 5)).toBe(0);
  });

  it('leaves and water attenuate a straight-down shaft', () => {
    // Solid stone chunk with a 1x1 air shaft at (8, *, 8) containing one leaf block and two water blocks.
    const shaft: Fill = (x, y, z) => {
      if (x !== 8 || z !== 8 || y < 10) return BlockId.Stone;
      if (y === 100) return BlockId.Leaves;
      if (y === 50 || y === 49) return BlockId.Water;
      return BlockId.Air;
    };
    const { store } = buildWorld([{ cx: 0, cz: 0 }], shaft);
    expect(getSkyLight(store, 8, 101, 8)).toBe(15);
    expect(getSkyLight(store, 8, 100, 8)).toBe(14); // leaves: -1
    expect(getSkyLight(store, 8, 99, 8)).toBe(13); // no longer full sky: -1 per step
    expect(getSkyLight(store, 8, 90, 8)).toBe(4);
    expect(getSkyLight(store, 8, 87, 8)).toBe(1);
    expect(getSkyLight(store, 8, 86, 8)).toBe(0);
  });
});

describe('block light: torch BFS', () => {
  const torchPos = { x: 8, y: GROUND_TOP + 1, z: 8 };

  it('decreases by 1 per Manhattan step through air', () => {
    const { store, light } = buildWorld([{ cx: 0, cz: 0 }], flatGround);
    edit(store, light, torchPos.x, torchPos.y, torchPos.z, BlockId.Torch);
    expect(getBlockLight(store, 8, torchPos.y, 8)).toBe(14);
    expect(getBlockLight(store, 12, torchPos.y, 8)).toBe(10);
    expect(getBlockLight(store, 10, torchPos.y + 1, 9)).toBe(10);
    expect(getBlockLight(store, 8, torchPos.y + 13, 8)).toBe(1);
    expect(getBlockLight(store, 8, torchPos.y + 14, 8)).toBe(0);
    expect(getBlockLight(store, 8, GROUND_TOP, 8)).toBe(0); // opaque cell itself
    // Sky channel is untouched.
    expect(getSkyLight(store, 12, torchPos.y, 8)).toBe(15);
  });

  it('is blocked by an opaque wall and reduced by an attenuating one', () => {
    const wall =
      (id: number): Fill =>
      (x, y) =>
        y <= GROUND_TOP || x === 10 ? (y <= GROUND_TOP ? BlockId.Stone : id) : BlockId.Air;
    const stoneWorld = buildWorld([{ cx: 0, cz: 0 }], wall(BlockId.Stone));
    edit(stoneWorld.store, stoneWorld.light, torchPos.x, torchPos.y, torchPos.z, BlockId.Torch);
    expect(getBlockLight(stoneWorld.store, 11, torchPos.y, 8)).toBe(0);

    const leafWorld = buildWorld([{ cx: 0, cz: 0 }], wall(BlockId.Leaves));
    edit(leafWorld.store, leafWorld.light, torchPos.x, torchPos.y, torchPos.z, BlockId.Torch);
    expect(getBlockLight(leafWorld.store, 10, torchPos.y, 8)).toBe(11); // 13 - (1 + 1)
    expect(getBlockLight(leafWorld.store, 11, torchPos.y, 8)).toBe(10);
  });

  it('removing the torch clears its light exactly', () => {
    const { store, light } = buildWorld([{ cx: 0, cz: 0 }], flatGround);
    const before = store.getChunk(0, 0)?.light.slice();
    edit(store, light, torchPos.x, torchPos.y, torchPos.z, BlockId.Torch);
    edit(store, light, torchPos.x, torchPos.y, torchPos.z, BlockId.Air);
    expect(store.getChunk(0, 0)?.light).toEqual(before);
  });
});

describe('cross-chunk propagation', () => {
  const pair: ChunkCoord[] = [
    { cx: 0, cz: 0 },
    { cx: 1, cz: 0 },
  ];

  it('a torch at local x=15 lights the +X neighbour from x=0 on, and reports it changed', () => {
    const { store, light } = buildWorld(pair, flatGround);
    const changed = edit(store, light, 15, GROUND_TOP + 1, 8, BlockId.Torch);
    expect(getBlockLight(store, 16, GROUND_TOP + 1, 8)).toBe(13);
    expect(getBlockLight(store, 20, GROUND_TOP + 1, 8)).toBe(9);
    expect(keys(changed)).toEqual(expect.arrayContaining(['0,0', '1,0']));
  });

  it('a torch in an already-loaded chunk spills into a neighbour when it loads later', () => {
    const store = new ChunkStore();
    const light = new LightEngine(store, blockRegistry);
    store.setChunk(makeChunk(0, 0, flatGround));
    light.lightChunk(0, 0);
    edit(store, light, 15, GROUND_TOP + 1, 8, BlockId.Torch);
    store.setChunk(makeChunk(1, 0, flatGround));
    const changed = light.lightChunk(1, 0);
    expect(getBlockLight(store, 16, GROUND_TOP + 1, 8)).toBe(13);
    expect(keys(changed)).toContain('1,0');
  });

  it('sky light under an overhang spanning a chunk border comes from the open side', () => {
    // Chunk (0,0) fully roofed at y=20; chunk (1,0) is open sky.
    const roofed: Fill = (x, y) => (y <= GROUND_TOP || (y === 20 && x < W) ? BlockId.Stone : BlockId.Air);
    const store = new ChunkStore();
    const light = new LightEngine(store, blockRegistry);
    store.setChunk(makeChunk(0, 0, roofed));
    light.lightChunk(0, 0);
    expect(getSkyLight(store, 15, 15, 5)).toBe(0);

    store.setChunk(makeChunk(1, 0, roofed));
    const changed = light.lightChunk(1, 0);
    expect(getSkyLight(store, 15, 15, 5)).toBe(14);
    expect(getSkyLight(store, 10, 15, 5)).toBe(9);
    expect(keys(changed)).toEqual(expect.arrayContaining(['0,0', '1,0']));
  });

  it('works across negative chunk coordinates', () => {
    const coords: ChunkCoord[] = [
      { cx: -1, cz: -1 },
      { cx: 0, cz: -1 },
    ];
    const { store, light } = buildWorld(coords, flatGround);
    const changed = edit(store, light, -1, GROUND_TOP + 1, -1, BlockId.Torch);
    expect(getBlockLight(store, -1, GROUND_TOP + 1, -1)).toBe(14);
    expect(getBlockLight(store, 0, GROUND_TOP + 1, -1)).toBe(13);
    expect(getBlockLight(store, -16, GROUND_TOP + 1, -1)).toBe(0);
    expect(keys(changed)).toEqual(['-1,-1', '0,-1']);
  });
});

describe('load order independence', () => {
  it('A then B equals B then A', () => {
    const overhang: Fill = (x, y) => (y <= GROUND_TOP || (y === 20 && x >= 4 && x <= 27) ? BlockId.Stone : BlockId.Air);
    const ab = buildWorld(
      [
        { cx: 0, cz: 0 },
        { cx: 1, cz: 0 },
      ],
      overhang,
    );
    const ba = buildWorld(
      [
        { cx: 1, cz: 0 },
        { cx: 0, cz: 0 },
      ],
      overhang,
    );
    expectSameLight(ab.store, ba.store);
  });

  it('generated 3x3 terrain lights identically in any load order', () => {
    const generator = new WorldGenerator(7);
    const coords: ChunkCoord[] = [];
    for (let cz = -1; cz <= 1; cz += 1) for (let cx = -1; cx <= 1; cx += 1) coords.push({ cx, cz });
    const generated = new Map(coords.map(({ cx, cz }) => [chunkKey(cx, cz), generator.generateChunk(cx, cz)]));

    const lightInOrder = (order: readonly ChunkCoord[]): ChunkStore => {
      const store = new ChunkStore();
      const light = new LightEngine(store, blockRegistry);
      for (const { cx, cz } of order) {
        const blocks = generated.get(chunkKey(cx, cz))?.blocks.slice();
        store.setChunk(new Chunk(cx, cz, blocks));
        light.lightChunk(cx, cz);
      }
      return store;
    };

    const reference = lightInOrder(coords);
    const rng = mulberry32(99);
    for (let trial = 0; trial < 3; trial += 1) {
      const shuffled = coords.slice().sort(() => rng() - 0.5);
      expectSameLight(lightInOrder(shuffled), reference, `trial ${trial}`);
    }
  });
});

describe('incremental updates', () => {
  it('placing an opaque block over a lit area darkens below it and breaking restores it', () => {
    const { store, light } = buildWorld([{ cx: 0, cz: 0 }], flatGround);
    const before = store.getChunk(0, 0)?.light.slice();
    // A 5x5 roof at y=15 around (8, 8).
    for (let x = 6; x <= 10; x += 1) for (let z = 6; z <= 10; z += 1) edit(store, light, x, 15, z, BlockId.Stone);
    expect(getSkyLight(store, 8, 12, 8)).toBe(12); // 3 steps from the open edge
    expect(getSkyLight(store, 8, 16, 8)).toBe(15);
    expectSameLight(store, recomputeFromScratch(store, [{ cx: 0, cz: 0 }]));

    for (let x = 6; x <= 10; x += 1) for (let z = 6; z <= 10; z += 1) edit(store, light, x, 15, z, BlockId.Air);
    expect(store.getChunk(0, 0)?.light).toEqual(before);
  });

  it('breaking into a sealed cave lets sky light flow in', () => {
    const cave: Fill = (x, y, z) =>
      y <= 30 && !(x >= 4 && x <= 8 && z >= 4 && z <= 8 && y >= 10 && y <= 14) ? BlockId.Stone : BlockId.Air;
    const { store, light } = buildWorld([{ cx: 0, cz: 0 }], cave);
    for (let y = 30; y >= 15; y -= 1) edit(store, light, 6, y, 6, BlockId.Air);
    expect(getSkyLight(store, 6, 14, 6)).toBe(15);
    expect(getSkyLight(store, 4, 14, 4)).toBe(11);
    expectSameLight(store, recomputeFromScratch(store, [{ cx: 0, cz: 0 }]));
  });

  it('matches a full recompute after random edit sequences across chunk borders (seeded fuzz)', () => {
    const coords: ChunkCoord[] = [
      { cx: -1, cz: -1 },
      { cx: 0, cz: -1 },
      { cx: -1, cz: 0 },
      { cx: 0, cz: 0 },
    ];
    const terrain: Fill = (x, y, z) => {
      if (y <= GROUND_TOP) return BlockId.Stone;
      if (y === 16 && x > -6 && x < 5 && z > -7 && z < 3) return BlockId.Stone; // overhang over the corner
      if (y === 14 && x === 2 && z === 2) return BlockId.Leaves;
      return BlockId.Air;
    };
    const { store, light } = buildWorld(coords, terrain);
    const palette = [
      BlockId.Air,
      BlockId.Air,
      BlockId.Stone,
      BlockId.Stone,
      BlockId.Torch,
      BlockId.Glass,
      BlockId.Leaves,
      BlockId.Water,
    ];
    const rng = mulberry32(12345);
    const pick = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

    for (let step = 0; step < 120; step += 1) {
      const id = palette[pick(0, palette.length - 1)] ?? BlockId.Air;
      edit(store, light, pick(-5, 4), pick(GROUND_TOP - 1, 18), pick(-5, 4), id);
      if (step % 10 === 9) {
        expectSameLight(store, recomputeFromScratch(store, coords), `step ${step}`);
      }
    }
    expectSameLight(store, recomputeFromScratch(store, coords), 'final');
  });
});

describe('changed-chunk sets', () => {
  it('are deduped and include every chunk touching a changed corner cell', () => {
    const coords: ChunkCoord[] = [
      { cx: 0, cz: 0 },
      { cx: 1, cz: 0 },
      { cx: 0, cz: 1 },
      { cx: 1, cz: 1 },
    ];
    const { store, light } = buildWorld(coords, flatGround);
    const changed = keys(edit(store, light, 15, GROUND_TOP + 1, 15, BlockId.Torch));
    expect(new Set(changed).size).toBe(changed.length);
    expect(changed.slice().sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('only includes loaded chunks, and the centre chunk comes first', () => {
    const { store, light } = buildWorld([{ cx: 0, cz: 0 }], flatGround);
    expect(keys(edit(store, light, 8, GROUND_TOP + 1, 8, BlockId.Torch))).toEqual(['0,0']);
    expect(keys(edit(store, light, 0, GROUND_TOP + 1, 3, BlockId.Torch))).toEqual(['0,0']);
  });

  it('is empty when the edit does not change light properties', () => {
    const { store, light } = buildWorld([{ cx: 0, cz: 0 }], flatGround);
    expect(edit(store, light, 8, 5, 8, BlockId.Dirt)).toEqual([]);
  });

  it('applyLightAndCollectRemesh unions affectedChunks with light-changed chunks', () => {
    const { store, light } = buildWorld(
      [
        { cx: 0, cz: 0 },
        { cx: 1, cz: 0 },
      ],
      flatGround,
    );
    // lx = 13: not on the border (affectedChunks = centre only), but the torch light reaches x = 16.
    const change = setBlockAt(store, blockRegistry, 13, GROUND_TOP + 1, 8, BlockId.Torch);
    if (change === null) throw new Error('edit failed');
    expect(keys(applyLightAndCollectRemesh(change, light))).toEqual(['0,0', '1,0']);
  });
});

describe('bounds', () => {
  it('ignores updates outside y range and handles the top layer', () => {
    const { store, light } = buildWorld([{ cx: 0, cz: 0 }], flatGround);
    expect(light.updateBlock(0, -1, 0, BlockId.Air, BlockId.Stone)).toEqual([]);
    expect(light.updateBlock(0, H, 0, BlockId.Air, BlockId.Stone)).toEqual([]);

    edit(store, light, 4, H - 1, 4, BlockId.Stone);
    expect(getSkyLight(store, 4, H - 2, 4)).toBe(14);
    expectSameLight(store, recomputeFromScratch(store, [{ cx: 0, cz: 0 }]));
    edit(store, light, 4, H - 1, 4, BlockId.Air);
    expect(getSkyLight(store, 4, H - 2, 4)).toBe(15);
    expect(getSkyLight(store, 4, H - 1, 4)).toBe(15);
  });

  it('queries above the world read as open sky and below as dark', () => {
    const { store } = buildWorld([{ cx: 0, cz: 0 }], flatGround);
    expect(getSkyLight(store, 0, H + 5, 0)).toBe(15);
    expect(getSkyLight(store, 0, -1, 0)).toBe(0);
    expect(getSkyLight(store, 999, 20, 999)).toBe(15); // unloaded
  });

  it('lights a chunk created by an edit in an unloaded region', () => {
    const store = new ChunkStore();
    const light = new LightEngine(store, blockRegistry);
    const changed = edit(store, light, 3, 20, 3, BlockId.Stone);
    expect(keys(changed)).toEqual(['0,0']);
    expect(getSkyLight(store, 3, 19, 3)).toBe(14);
    expect(getSkyLight(store, 3, 21, 3)).toBe(15);
  });
});

describe('LightSampler', () => {
  it('reads the centre, axis and diagonal neighbours, and open sky for missing ones', () => {
    const coords: ChunkCoord[] = [
      { cx: 0, cz: 0 },
      { cx: 1, cz: 0 },
      { cx: 1, cz: 1 },
    ];
    const { store, light } = buildWorld(coords, flatGround);
    edit(store, light, 16, GROUND_TOP + 1, 16, BlockId.Torch); // in chunk (1,1) at its corner
    const sample = createLightSampler(lightNeighborhoodFromStore(store, 0, 0));
    expect(blockLightOf(sample(W, GROUND_TOP + 1, D))).toBe(14); // diagonal (1,1)
    expect(blockLightOf(sample(W, GROUND_TOP + 1, D - 1))).toBe(13); // axis (1,0)
    expect(blockLightOf(sample(W - 1, GROUND_TOP + 1, D - 1))).toBe(12); // centre
    expect(sample(0, GROUND_TOP + 1, D)).toBe(OPEN_SKY_LIGHT); // (0,1) not loaded
    expect(sample(3, H, 3)).toBe(OPEN_SKY_LIGHT);
    expect(sample(3, -1, 3)).toBe(0);
    expect(skyLightOf(sample(3, GROUND_TOP, 3))).toBe(0);
  });
});

describe('light performance (informational)', () => {
  it('lights generated chunks and applies edits fast enough for main-thread streaming', () => {
    const generator = new WorldGenerator(3);
    const store = new ChunkStore();
    const light = new LightEngine(store, blockRegistry);
    const coords: ChunkCoord[] = [];
    for (let cz = -2; cz <= 2; cz += 1) for (let cx = -2; cx <= 2; cx += 1) coords.push({ cx, cz });
    const chunks = coords.map(({ cx, cz }) => generator.generateChunk(cx, cz));

    const start = performance.now();
    for (const chunk of chunks) {
      store.setChunk(chunk);
      light.lightChunk(chunk.cx, chunk.cz);
    }
    const perChunk = (performance.now() - start) / chunks.length;

    const editStart = performance.now();
    const edits = 50;
    for (let i = 0; i < edits; i += 1) {
      const x = (i % 10) - 5;
      const z = Math.floor(i / 10) - 3;
      let y = H - 1;
      while (y > 0 && store.getBlock(x, y, z) === BlockId.Air) y -= 1;
      edit(store, light, x, y + 1, z, i % 2 === 0 ? BlockId.Torch : BlockId.Stone);
      edit(store, light, x, y, z, BlockId.Air);
    }
    const perEdit = (performance.now() - editStart) / (edits * 2);

    console.info(`[light] initial ${perChunk.toFixed(2)} ms/chunk, edit ${perEdit.toFixed(3)} ms/edit`);
    expect(perChunk).toBeLessThan(50);
    expect(perEdit).toBeLessThan(20);
  });
});

describe('ChunkManager light integration', () => {
  it('lights every loaded chunk before meshing and reports light timing', () => {
    const store = new ChunkStore();
    const light = new LightEngine(store, blockRegistry);
    const sink = { upsert: (): void => undefined, remove: (): void => undefined };
    const manager = new ChunkManager(store, new WorldGenerator(1), blockRegistry, sink, 1, 4, light);
    manager.update({ cx: 0, cz: 0 });
    manager.loadAllPending();

    for (const chunk of store.chunks()) {
      expect(light.isLit(chunk)).toBe(true);
      expect(skyLightOf(chunk.light[localIndex(3, H - 1, 3)] ?? 0)).toBe(15);
    }
    expect(manager.stats.chunksLoaded).toBe(9);
    expect(manager.stats.lightMs).toBeGreaterThan(0);
  });
});
