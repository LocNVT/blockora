import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG } from '../src/config/constants';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import { LightEngine, getLightAt, packLight, blockLightOf, skyLightOf } from '../src/world/light';
import {
  LIGHT_COMPONENTS,
  meshChunk,
  neighborhoodFromStore,
  remeshChunks,
  type ChunkMeshData,
  type MeshSectionData,
} from '../src/world/mesher';

const { chunkWidth: W, chunkDepth: D } = WORLD_CONFIG;

/** Finds the quad in `section` with normal `n` whose min corner is (x, y, z); returns its first vertex index. */
function findQuad(
  section: MeshSectionData,
  n: readonly [number, number, number],
  x: number,
  y: number,
  z: number,
): number {
  const vertexCount = section.positions.length / 3;
  for (let v = 0; v < vertexCount; v += 4) {
    if (
      section.normals[v * 3] !== n[0] ||
      section.normals[v * 3 + 1] !== n[1] ||
      section.normals[v * 3 + 2] !== n[2]
    ) {
      continue;
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    for (let i = 0; i < 4; i += 1) {
      minX = Math.min(minX, section.positions[(v + i) * 3] ?? Infinity);
      minY = Math.min(minY, section.positions[(v + i) * 3 + 1] ?? Infinity);
      minZ = Math.min(minZ, section.positions[(v + i) * 3 + 2] ?? Infinity);
    }
    if (minX === x && minY === y && minZ === z) {
      return v;
    }
  }
  throw new Error(`quad with normal ${n.join(',')} at (${x}, ${y}, ${z}) not found`);
}

/** [sky, block] of every vertex of the quad starting at vertex `v`; asserts they are all equal. */
function quadLight(section: MeshSectionData, v: number): [number, number] {
  const sky = section.light[v * LIGHT_COMPONENTS] ?? -1;
  const block = section.light[v * LIGHT_COMPONENTS + 1] ?? -1;
  for (let i = 1; i < 4; i += 1) {
    expect(section.light[(v + i) * LIGHT_COMPONENTS]).toBe(sky);
    expect(section.light[(v + i) * LIGHT_COMPONENTS + 1]).toBe(block);
  }
  return [sky, block];
}

function meshFromStore(store: ChunkStore, cx: number, cz: number): ChunkMeshData {
  let captured: ChunkMeshData | null = null;
  remeshChunks(store, blockRegistry, { upsert: (_x, _z, data) => (captured = data), remove: () => {} }, [
    { cx, cz },
  ]);
  if (captured === null) {
    throw new Error('no mesh produced');
  }
  return captured;
}

describe('mesher light attribute', () => {
  it('open-sky top face samples sky 15, block 0', () => {
    const store = new ChunkStore();
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    store.setChunk(chunk);
    new LightEngine(store, blockRegistry).lightChunk(0, 0);

    const data = meshFromStore(store, 0, 0);
    const top = findQuad(data.opaque, [0, 1, 0], 5, 6, 5);
    expect(quadLight(data.opaque, top)).toEqual([15, 0]);
  });

  it('face against a torch-lit enclosed cavity samples the expected block light', () => {
    const store = new ChunkStore();
    const chunk = new Chunk(0, 0);
    for (let y = 0; y <= 40; y += 1) {
      for (let z = 0; z < D; z += 1) {
        for (let x = 0; x < W; x += 1) {
          chunk.setBlock(x, y, z, BlockId.Stone);
        }
      }
    }
    for (let y = 20; y <= 22; y += 1) {
      for (let z = 7; z <= 9; z += 1) {
        for (let x = 7; x <= 9; x += 1) {
          chunk.setBlock(x, y, z, BlockId.Air);
        }
      }
    }
    chunk.setBlock(8, 21, 8, BlockId.Torch);
    store.setChunk(chunk);
    new LightEngine(store, blockRegistry).lightChunk(0, 0);

    const data = meshFromStore(store, 0, 0);
    // Stone at (6,21,8): its +X face (plane x=7) looks into air cell (7,21,8), 1 step from the torch.
    const face = findQuad(data.opaque, [1, 0, 0], 7, 21, 8);
    const packed = getLightAt(store, 7, 21, 8);
    const torchLevel = blockRegistry.get(BlockId.Torch).lightLevel;
    expect(quadLight(data.opaque, face)).toEqual([skyLightOf(packed), blockLightOf(packed)]);
    expect(quadLight(data.opaque, face)).toEqual([0, torchLevel - 1]);
  });

  it('face across a chunk border samples the neighbour chunk light', () => {
    const store = new ChunkStore();
    const center = new Chunk(0, 0);
    const posX = new Chunk(1, 0);
    center.setBlock(W - 1, 10, 4, BlockId.Stone);
    // Hand-authored light in the neighbour cell the +X face looks into.
    posX.light[0 + W * (4 + D * 10)] = packLight(3, 9);
    store.setChunk(center);
    store.setChunk(posX);

    const viaDefault = meshChunk(neighborhoodFromStore(store, 0, 0), blockRegistry);
    const viaStore = meshFromStore(store, 0, 0);
    for (const data of [viaDefault, viaStore]) {
      const face = findQuad(data.opaque, [1, 0, 0], W, 10, 4);
      expect(quadLight(data.opaque, face)).toEqual([3, 9]);
    }
  });

  it('light array holds 2 bytes per vertex in both sections', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    chunk.setBlock(9, 9, 9, BlockId.Water);
    const data = meshChunk({ center: chunk, posX: null, negX: null, posZ: null, negZ: null }, blockRegistry);
    for (const section of [data.opaque, data.transparent]) {
      expect(section.positions.length).toBeGreaterThan(0);
      expect(section.light).toBeInstanceOf(Uint8Array);
      expect(section.light.length).toBe((section.positions.length / 3) * 2);
    }
  });

  it('is deterministic for the same lit input', () => {
    const build = (): ChunkMeshData => {
      const store = new ChunkStore();
      const chunk = new Chunk(0, 0);
      for (let x = 0; x < W; x += 1) {
        chunk.setBlock(x, 3, x % D, BlockId.Stone);
        chunk.setBlock(x, 4, (x * 3) % D, BlockId.Glass);
      }
      chunk.setBlock(2, 5, 2, BlockId.Torch);
      store.setChunk(chunk);
      new LightEngine(store, blockRegistry).lightChunk(0, 0);
      return meshFromStore(store, 0, 0);
    };
    const a = build();
    const b = build();
    expect(Array.from(a.opaque.light)).toEqual(Array.from(b.opaque.light));
    expect(Array.from(a.transparent.light)).toEqual(Array.from(b.transparent.light));
  });
});
