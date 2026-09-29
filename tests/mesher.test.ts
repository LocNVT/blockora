import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG } from '../src/config/constants';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import {
  MeshBuffers,
  meshChunk,
  neighborhoodFromStore,
  createBlockSampler,
  isFaceVisible,
  type ChunkNeighborhood,
} from '../src/world/mesher';
import { FaceDirection, FACES } from '../src/world/mesher/faces';
import { buildFaceTileTable, faceTileFromTable } from '../src/world/texture/blockFaceTiles';
import { tileIndex } from '../src/world/texture/tiles';
import { createAtlasLayout, tileUvRect } from '../src/world/texture/atlasLayout';
import { applyAtlasUvs } from '../src/world/texture/applyAtlasUvs';
import { TILE_NAMES } from '../src/world/texture/tiles';

const { chunkWidth, chunkDepth, chunkHeight } = WORLD_CONFIG;

function soloNeighborhood(chunk: Chunk): ChunkNeighborhood {
  return { center: chunk, posX: null, negX: null, posZ: null, negZ: null };
}

function crossProduct(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

describe('empty chunk', () => {
  it('meshes to empty opaque and transparent sections', () => {
    const chunk = new Chunk(0, 0);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    expect(data.opaque.indices.length).toBe(0);
    expect(data.opaque.positions.length).toBe(0);
    expect(data.transparent.indices.length).toBe(0);
    expect(data.transparent.positions.length).toBe(0);
  });
});

describe('single stone block', () => {
  it('emits exactly 6 faces (24 vertices, 36 indices)', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);

    expect(data.opaque.indices.length).toBe(36); // 6 faces * 6 indices
    expect(data.opaque.positions.length / 3).toBe(24); // 6 faces * 4 verts
    expect(data.transparent.indices.length).toBe(0);
  });

  it('every face normal points outward with CCW-from-outside winding', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);

    const { positions, normals, indices } = data.opaque;
    const triCount = indices.length / 3;

    for (let t = 0; t < triCount; t += 1) {
      const i0 = indices[t * 3];
      const i1 = indices[t * 3 + 1];
      const i2 = indices[t * 3 + 2];
      if (i0 === undefined || i1 === undefined || i2 === undefined) {
        throw new Error('unexpected missing index');
      }

      const p0: [number, number, number] = [
        positions[i0 * 3] as number,
        positions[i0 * 3 + 1] as number,
        positions[i0 * 3 + 2] as number,
      ];
      const p1: [number, number, number] = [
        positions[i1 * 3] as number,
        positions[i1 * 3 + 1] as number,
        positions[i1 * 3 + 2] as number,
      ];
      const p2: [number, number, number] = [
        positions[i2 * 3] as number,
        positions[i2 * 3 + 1] as number,
        positions[i2 * 3 + 2] as number,
      ];

      const e1: [number, number, number] = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const e2: [number, number, number] = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const cross = crossProduct(e1, e2);

      const n: [number, number, number] = [
        normals[i0 * 3] as number,
        normals[i0 * 3 + 1] as number,
        normals[i0 * 3 + 2] as number,
      ];

      // cross(e1, e2) should point the same direction as the stored normal.
      const dot = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
      expect(dot).toBeGreaterThan(0);
    }
  });
});

describe('adjacent blocks share a hidden face', () => {
  it('two blocks adjacent along X emit 10 faces total', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    expect(data.opaque.indices.length / 6).toBe(10);
  });

  it('two blocks adjacent along Y emit 10 faces total', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(5, 6, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    expect(data.opaque.indices.length / 6).toBe(10);
  });

  it('two blocks adjacent along Z emit 10 faces total', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(5, 5, 6, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    expect(data.opaque.indices.length / 6).toBe(10);
  });
});

describe('fully enclosed block', () => {
  it('a solid 3x3x3 cube only emits the outer surface (54 faces)', () => {
    const chunk = new Chunk(0, 0);
    for (let x = 4; x <= 6; x += 1) {
      for (let y = 4; y <= 6; y += 1) {
        for (let z = 4; z <= 6; z += 1) {
          chunk.setBlock(x, y, z, BlockId.Stone);
        }
      }
    }
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    // Surface area of a 3x3x3 cube of unit cubes = 6 * 3 * 3 = 54 faces.
    expect(data.opaque.indices.length / 6).toBe(54);
  });
});

describe('transparency rules', () => {
  it('stone next to glass: stone face toward glass visible, glass face toward stone hidden', () => {
    expect(isFaceVisible(BlockId.Stone, BlockId.Glass, blockRegistry)).toBe(true);
    expect(isFaceVisible(BlockId.Glass, BlockId.Stone, blockRegistry)).toBe(false);
  });

  it('glass next to glass: shared faces hidden', () => {
    expect(isFaceVisible(BlockId.Glass, BlockId.Glass, blockRegistry)).toBe(false);
  });

  it('water next to stone: water face hidden (occluded by opaque stone)', () => {
    expect(isFaceVisible(BlockId.Water, BlockId.Stone, blockRegistry)).toBe(false);
  });

  it('air never produces a visible face, regardless of neighbor', () => {
    expect(isFaceVisible(BlockId.Air, BlockId.Stone, blockRegistry)).toBe(false);
    expect(isFaceVisible(BlockId.Air, BlockId.Air, blockRegistry)).toBe(false);
    expect(isFaceVisible(BlockId.Air, BlockId.Glass, blockRegistry)).toBe(false);
  });

  it('transparent blocks are meshed into the transparent layer, opaque into opaque', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    expect(data.opaque.indices.length).toBe(0);
    expect(data.transparent.indices.length).toBe(36);
  });

  it('stone next to glass in a real mesh: 11 opaque + 11 transparent faces', () => {
    // stone at x=5 next to glass at x=6: stone hides its +X face? No: neighbor
    // is transparent+different id -> stone's +X face is visible; glass's -X
    // face (toward stone, opaque) is hidden. So stone keeps all 6, glass loses 1.
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    expect(data.opaque.indices.length / 6).toBe(6);
    expect(data.transparent.indices.length / 6).toBe(5);
  });
});

describe('chunk boundary faces', () => {
  it('a block at local x=15 with no posX neighbour emits its +X face', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(chunkWidth - 1, 5, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    expect(data.opaque.indices.length / 6).toBe(6); // no neighbour to occlude any face
  });

  it('a loaded posX neighbour with a solid block at x=0 hides both boundary faces', () => {
    const store = new ChunkStore();
    store.setBlock(chunkWidth - 1, 5, 5, BlockId.Stone); // chunk (0,0) local (15,5,5)
    store.setBlock(chunkWidth, 5, 5, BlockId.Stone); // chunk (1,0) local (0,5,5)

    const centerNeighborhood = neighborhoodFromStore(store, 0, 0);
    const centerData = meshChunk(centerNeighborhood, blockRegistry);
    expect(centerData.opaque.indices.length / 6).toBe(5); // +X face hidden

    const posXNeighborhood = neighborhoodFromStore(store, 1, 0);
    const posXData = meshChunk(posXNeighborhood, blockRegistry);
    expect(posXData.opaque.indices.length / 6).toBe(5); // -X face hidden
  });

  it('a loaded negX neighbour with a solid block hides both boundary faces', () => {
    const store = new ChunkStore();
    store.setBlock(0, 5, 5, BlockId.Stone); // chunk (0,0) local (0,5,5)
    store.setBlock(-1, 5, 5, BlockId.Stone); // chunk (-1,0) local (15,5,5)

    const centerData = meshChunk(neighborhoodFromStore(store, 0, 0), blockRegistry);
    expect(centerData.opaque.indices.length / 6).toBe(5);

    const negXData = meshChunk(neighborhoodFromStore(store, -1, 0), blockRegistry);
    expect(negXData.opaque.indices.length / 6).toBe(5);
  });

  it('a loaded posZ neighbour with a solid block hides both boundary faces', () => {
    const store = new ChunkStore();
    store.setBlock(5, 5, chunkDepth - 1, BlockId.Stone); // chunk (0,0) local (5,5,15)
    store.setBlock(5, 5, chunkDepth, BlockId.Stone); // chunk (0,1) local (5,5,0)

    const centerData = meshChunk(neighborhoodFromStore(store, 0, 0), blockRegistry);
    expect(centerData.opaque.indices.length / 6).toBe(5);

    const posZData = meshChunk(neighborhoodFromStore(store, 0, 1), blockRegistry);
    expect(posZData.opaque.indices.length / 6).toBe(5);
  });

  it('a loaded negZ neighbour with a solid block hides both boundary faces', () => {
    const store = new ChunkStore();
    store.setBlock(5, 5, 0, BlockId.Stone); // chunk (0,0) local (5,5,0)
    store.setBlock(5, 5, -1, BlockId.Stone); // chunk (0,-1) local (5,5,15)

    const centerData = meshChunk(neighborhoodFromStore(store, 0, 0), blockRegistry);
    expect(centerData.opaque.indices.length / 6).toBe(5);

    const negZData = meshChunk(neighborhoodFromStore(store, 0, -1), blockRegistry);
    expect(negZData.opaque.indices.length / 6).toBe(5);
  });

  it('works with negative chunk coordinates via neighborhoodFromStore', () => {
    const store = new ChunkStore();
    store.setBlock(-5, 5, -5, BlockId.Stone);
    const neighborhood = neighborhoodFromStore(store, -1, -1);
    const data = meshChunk(neighborhood, blockRegistry);
    expect(data.opaque.indices.length / 6).toBe(6);
  });

  it('top face at y=chunkHeight-1 and bottom face at y=0 are emitted', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, chunkHeight - 1, 5, BlockId.Stone);
    chunk.setBlock(6, 0, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    // Both blocks isolated from each other -> 6 faces each = 12 total.
    expect(data.opaque.indices.length / 6).toBe(12);
  });

  it('throws when meshing an unloaded chunk coordinate', () => {
    const store = new ChunkStore();
    expect(() => neighborhoodFromStore(store, 0, 0)).toThrow();
  });
});

describe('positions are chunk-local', () => {
  it('all emitted positions lie within [0,16] x [0,128] x [0,16]', () => {
    const chunk = new Chunk(2, -3); // chunk coord should not affect local positions
    chunk.setBlock(0, 0, 0, BlockId.Stone);
    chunk.setBlock(chunkWidth - 1, chunkHeight - 1, chunkDepth - 1, BlockId.Grass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);

    for (let i = 0; i < data.opaque.positions.length; i += 3) {
      const x = data.opaque.positions[i] as number;
      const y = data.opaque.positions[i + 1] as number;
      const z = data.opaque.positions[i + 2] as number;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(chunkWidth);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(chunkHeight);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(chunkDepth);
    }
  });
});

describe('determinism and buffer reuse', () => {
  it('meshing the same neighbourhood twice yields byte-identical arrays', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);

    const dataA = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const dataB = meshChunk(soloNeighborhood(chunk), blockRegistry);

    expect(dataA.opaque.positions).toEqual(dataB.opaque.positions);
    expect(dataA.opaque.indices).toEqual(dataB.opaque.indices);
    expect(dataA.transparent.positions).toEqual(dataB.transparent.positions);
    expect(dataA.transparent.indices).toEqual(dataB.transparent.indices);
  });

  it('a reused MeshBuffers does not leak data between calls', () => {
    const buffers = new MeshBuffers();

    const bigChunk = new Chunk(0, 0);
    for (let x = 4; x <= 6; x += 1) {
      for (let y = 4; y <= 6; y += 1) {
        for (let z = 4; z <= 6; z += 1) {
          bigChunk.setBlock(x, y, z, BlockId.Stone);
        }
      }
    }
    const bigData = meshChunk(soloNeighborhood(bigChunk), blockRegistry, buffers);
    expect(bigData.opaque.indices.length / 6).toBe(54);

    const smallChunk = new Chunk(0, 0);
    smallChunk.setBlock(5, 5, 5, BlockId.Stone);
    const smallData = meshChunk(soloNeighborhood(smallChunk), blockRegistry, buffers);
    expect(smallData.opaque.indices.length / 6).toBe(6);
    expect(smallData.opaque.positions.length / 3).toBe(24);
  });

  it('reused buffers still produce byte-identical results to a fresh MeshBuffers', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);

    const fresh = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const reused = meshChunk(soloNeighborhood(chunk), blockRegistry, new MeshBuffers(1));

    expect(fresh.opaque.positions).toEqual(reused.opaque.positions);
    expect(fresh.opaque.indices).toEqual(reused.opaque.indices);
  });
});

describe('array length consistency', () => {
  it('uvs/tiles/normals lengths are consistent with vertex count', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(5, 6, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);

    for (const section of [data.opaque, data.transparent]) {
      const vertexCount = section.positions.length / 3;
      expect(section.normals.length).toBe(vertexCount * 3);
      expect(section.tiles.length).toBe(vertexCount);
      expect(section.uvs.length).toBe(vertexCount * 2);
      expect(section.indices.length % 6).toBe(0);
    }
  });
});

describe('per-vertex tile indices', () => {
  it('every vertex of a grass block face carries the expected tile for that face', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Grass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const { normals, tiles } = data.opaque;

    const grassTopTile = tileIndex('grass_top');
    const grassSideTile = tileIndex('grass_side');
    const dirtTile = tileIndex('dirt');

    // Group by quad (4 verts/quad); each quad's 4 vertices share one normal
    // (and therefore one face direction), so check tile-per-quad rather than
    // tile-per-vertex-y (multiple faces share the same world y at a cube edge).
    const vertsPerQuad = 4;
    for (let base = 0; base < tiles.length; base += vertsPerQuad) {
      const ny = normals[base * 3 + 1] as number;
      const nx = normals[base * 3] as number;
      const nz = normals[base * 3 + 2] as number;
      const tile = tiles[base] as number;

      if (ny === 1) {
        expect(tile).toBe(grassTopTile); // +Y face -> grass_top
      } else if (ny === -1) {
        expect(tile).toBe(dirtTile); // -Y face -> dirt
      } else {
        expect(nx !== 0 || nz !== 0).toBe(true);
        expect(tile).toBe(grassSideTile); // side face -> grass_side
      }

      // All 4 vertices of the quad must agree on tile.
      for (let i = 1; i < vertsPerQuad; i += 1) {
        expect(tiles[base + i]).toBe(tile);
      }
    }
  });

  it('side-face local v increases with +Y (grass strip stays on top)', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Grass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const { positions, normals, uvs } = data.opaque;

    const vertexCount = positions.length / 3;
    for (let v = 0; v < vertexCount; v += 1) {
      const nx = normals[v * 3] as number;
      const ny = normals[v * 3 + 1] as number;
      const nz = normals[v * 3 + 2] as number;
      const isSideFace = ny === 0 && (nx !== 0 || nz !== 0);
      if (!isSideFace) {
        continue;
      }
      const y = positions[v * 3 + 1] as number;
      const localV = uvs[v * 2 + 1] as number;
      // Local y is either 5 (bottom, corner 0) or 6 (top, corner 1) for this
      // unit block; localV should track the same corner (0 at bottom, 1 at top).
      if (y === 5) {
        expect(localV).toBe(0);
      } else {
        expect(localV).toBe(1);
      }
    }
  });

  it('stone (all-faces) resolves every face to the stone tile', () => {
    const table = buildFaceTileTable(blockRegistry);
    const stoneTile = tileIndex('stone');
    for (let face = 0; face < 6; face += 1) {
      expect(faceTileFromTable(table, BlockId.Stone, face as FaceDirection)).toBe(stoneTile);
    }
  });

  it('wood resolves top/bottom to wood_top and sides to wood_side', () => {
    const table = buildFaceTileTable(blockRegistry);
    const woodTopTile = tileIndex('wood_top');
    const woodSideTile = tileIndex('wood_side');

    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.PosY)).toBe(woodTopTile);
    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.NegY)).toBe(woodTopTile);
    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.PosX)).toBe(woodSideTile);
    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.NegX)).toBe(woodSideTile);
    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.PosZ)).toBe(woodSideTile);
    expect(faceTileFromTable(table, BlockId.Wood, FaceDirection.NegZ)).toBe(woodSideTile);
  });
});

describe('applyAtlasUvs', () => {
  it('maps every vertex uv inside that vertex tile rect', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Grass);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const layout = createAtlasLayout(TILE_NAMES.length);

    const epsilon = 1e-6;
    for (const section of [data.opaque, data.transparent]) {
      const atlasUv = applyAtlasUvs(section.uvs, section.tiles, layout);
      const vertexCount = section.tiles.length;
      for (let v = 0; v < vertexCount; v += 1) {
        const tile = section.tiles[v] as number;
        const rect = tileUvRect(layout, tile);
        const u = atlasUv[v * 2] as number;
        const uvV = atlasUv[v * 2 + 1] as number;
        expect(u).toBeGreaterThanOrEqual(rect.u0 - epsilon);
        expect(u).toBeLessThanOrEqual(rect.u1 + epsilon);
        expect(uvV).toBeGreaterThanOrEqual(rect.v0 - epsilon);
        expect(uvV).toBeLessThanOrEqual(rect.v1 + epsilon);
      }
    }
  });

  it('is deterministic across repeated calls', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Grass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const layout = createAtlasLayout(TILE_NAMES.length);

    const a = applyAtlasUvs(data.opaque.uvs, data.opaque.tiles, layout);
    const b = applyAtlasUvs(data.opaque.uvs, data.opaque.tiles, layout);
    expect(a).toEqual(b);
  });

  it('writes into the prefix of a larger output array, leaving the rest untouched; rejects a too-small one', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Grass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const layout = createAtlasLayout(TILE_NAMES.length);
    const expected = applyAtlasUvs(data.opaque.uvs, data.opaque.tiles, layout);

    const out = new Float32Array(expected.length + 4).fill(-1);
    expect(applyAtlasUvs(data.opaque.uvs, data.opaque.tiles, layout, out)).toBe(out);
    expect(Array.from(out.subarray(0, expected.length))).toEqual(Array.from(expected));
    expect(Array.from(out.subarray(expected.length))).toEqual([-1, -1, -1, -1]);
    expect(() =>
      applyAtlasUvs(data.opaque.uvs, data.opaque.tiles, layout, new Float32Array(expected.length - 1)),
    ).toThrow(RangeError);
  });
});

describe('transparent blocks stay in the transparent section', () => {
  it('glass and water mesh into the transparent section, never opaque', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Glass);
    chunk.setBlock(5, 5, 7, BlockId.Water);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);

    expect(data.opaque.indices.length).toBe(0);
    expect(data.transparent.indices.length).toBeGreaterThan(0);
  });
});

describe('BlockSampler', () => {
  it('returns Air for y below 0 or at/above chunkHeight', () => {
    const chunk = new Chunk(0, 0);
    const sampler = createBlockSampler(soloNeighborhood(chunk));
    expect(sampler(0, -1, 0)).toBe(BlockId.Air);
    expect(sampler(0, chunkHeight, 0)).toBe(BlockId.Air);
  });

  it('returns Air when reaching into a missing neighbour', () => {
    const chunk = new Chunk(0, 0);
    const sampler = createBlockSampler(soloNeighborhood(chunk));
    expect(sampler(chunkWidth, 0, 0)).toBe(BlockId.Air);
    expect(sampler(-1, 0, 0)).toBe(BlockId.Air);
    expect(sampler(0, 0, chunkDepth)).toBe(BlockId.Air);
    expect(sampler(0, 0, -1)).toBe(BlockId.Air);
  });

  it('reads into a loaded neighbour chunk', () => {
    const center = new Chunk(0, 0);
    const posX = new Chunk(1, 0);
    posX.setBlock(0, 5, 5, BlockId.Stone);
    const sampler = createBlockSampler({ center, posX, negX: null, posZ: null, negZ: null });
    expect(sampler(chunkWidth, 5, 5)).toBe(BlockId.Stone);
  });
});

describe('face table sanity', () => {
  it('has exactly 6 directions with unit normals', () => {
    expect(FACES.length).toBe(6);
    for (const face of FACES) {
      const [x, y, z] = face.normal;
      expect(Math.abs(x) + Math.abs(y) + Math.abs(z)).toBe(1);
    }
  });

  it('FaceDirection values are 0..5', () => {
    const values = Object.values(FaceDirection);
    expect(values.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
