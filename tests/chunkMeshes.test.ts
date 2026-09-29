import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { RENDER_CONFIG, WORLD_CONFIG } from '../src/config/constants';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import { Chunk } from '../src/world/Chunk';
import { meshChunk } from '../src/world/mesher';
import type { ChunkNeighborhood } from '../src/world/mesher';
import {
  CHUNK_LIGHT_ATTRIBUTE,
  ChunkMeshRenderer,
  chunkOpaqueMaterial,
  chunkTransparentMaterial,
  createChunkGeometryPool,
  getChunkDaylight,
  setChunkDaylight,
  voxelAtlasLayout,
} from '../src/renderer/chunkMeshes';
import type { ChunkMeshData } from '../src/world/mesher/MeshBuffers';
import { applyAtlasUvs } from '../src/world/texture/applyAtlasUvs';

function soloNeighborhood(chunk: Chunk): ChunkNeighborhood {
  return { center: chunk, posX: null, negX: null, posZ: null, negZ: null };
}

interface ChunkGeometries {
  readonly opaque: THREE.BufferGeometry | null;
  readonly transparent: THREE.BufferGeometry | null;
}

/** Upserts `data` into a fresh ChunkMeshRenderer; returns each section mesh's geometry (null when there is no mesh). */
function createChunkGeometries(data: ChunkMeshData): ChunkGeometries {
  const scene = new THREE.Scene();
  new ChunkMeshRenderer(scene).upsert(0, 0, data);
  const meshes = scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
  const byMaterial = (material: THREE.Material): THREE.BufferGeometry | null =>
    meshes.find((m) => m.material === material)?.geometry ?? null;
  const opaque = byMaterial(chunkOpaqueMaterial);
  const transparent = byMaterial(chunkTransparentMaterial);
  expect(meshes).toHaveLength(Number(opaque !== null) + Number(transparent !== null));
  return { opaque, transparent };
}

/** First `length` elements of an attribute's (capacity-sized, pooled) array. */
function prefixOf(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined,
  length: number,
): number[] {
  return Array.from(attribute?.array.subarray(0, length) ?? []);
}

describe('chunk section geometries', () => {
  it('creates no mesh / geometry for either section of an empty chunk', () => {
    const chunk = new Chunk(0, 0);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const geometries = createChunkGeometries(data);
    expect(geometries.opaque).toBeNull();
    expect(geometries.transparent).toBeNull();
  });

  it('builds only the opaque geometry when there is no transparent geometry', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const { opaque, transparent } = createChunkGeometries(data);

    expect(transparent).toBeNull();
    expect(opaque).not.toBeNull();
    // No material groups: one geometry, one draw, one material per mesh.
    expect(opaque?.groups.length).toBe(0);
    expect(opaque?.drawRange).toEqual({ start: 0, count: 36 });
  });

  // Regression: two groups on ONE geometry made three's WebGL backend issue
  // consecutive draws with the same cached VAO + index buffer, which fails with
  // "glDrawElements: Must have element array buffer bound" when an index buffer
  // was uploaded in between. Separate geometries can never repeat that pair.
  it('builds separate group-less geometries when both sections are present', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const { opaque, transparent } = createChunkGeometries(data);

    expect(opaque).not.toBeNull();
    expect(transparent).not.toBeNull();
    expect(opaque).not.toBe(transparent);
    expect(opaque?.groups).toHaveLength(0);
    expect(transparent?.groups).toHaveLength(0);
    expect(opaque?.getIndex()).not.toBe(transparent?.getIndex());
    expect(opaque?.drawRange.count).toBe(data.opaque.indices.length);
    expect(transparent?.drawRange.count).toBe(data.transparent.indices.length);
    // Indices are section-local (no vertex offset from concatenation).
    expect(prefixOf(transparent?.getIndex(), data.transparent.indices.length)).toEqual(
      Array.from(data.transparent.indices),
    );
  });

  it('never yields a geometry with an empty index buffer', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const { opaque, transparent } = createChunkGeometries(data);
    expect(opaque).toBeNull();
    expect(transparent?.drawRange.count).toBeGreaterThan(0);
  });

  it('attributes hold the section in their (equal-capacity) prefix, draw range = index count, no color attribute', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const geometry = createChunkGeometries(data).opaque;
    expect(geometry).not.toBeNull();

    const capacity = geometry?.getAttribute('position').count ?? 0;
    expect(capacity).toBeGreaterThanOrEqual(24);
    expect(geometry?.getAttribute('normal').count).toBe(capacity);
    expect(geometry?.getAttribute('uv').count).toBe(capacity);
    expect(geometry?.getAttribute('color')).toBeUndefined();
    expect(geometry?.getIndex()?.count).toBeGreaterThanOrEqual(36);
    expect(geometry?.drawRange).toEqual({ start: 0, count: 36 });
    expect(prefixOf(geometry?.getAttribute('position'), 72)).toEqual(Array.from(data.opaque.positions));
    expect(prefixOf(geometry?.getAttribute('normal'), 72)).toEqual(Array.from(data.opaque.normals));
  });

  it('uv attribute equals the atlas-mapped uvs computed directly from mesh data', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const { opaque, transparent } = createChunkGeometries(data);

    const expectedOpaqueUv = applyAtlasUvs(data.opaque.uvs, data.opaque.tiles, voxelAtlasLayout);
    const expectedTransparentUv = applyAtlasUvs(
      data.transparent.uvs,
      data.transparent.tiles,
      voxelAtlasLayout,
    );

    const opaqueUv = opaque?.getAttribute('uv').array as Float32Array;
    const transparentUv = transparent?.getAttribute('uv').array as Float32Array;
    expect(opaqueUv.length).toBeGreaterThanOrEqual(expectedOpaqueUv.length);
    expect(transparentUv.length).toBeGreaterThanOrEqual(expectedTransparentUv.length);
    for (let i = 0; i < expectedOpaqueUv.length; i += 1) {
      expect(opaqueUv[i]).toBeCloseTo(expectedOpaqueUv[i] as number, 6);
    }
    for (let i = 0; i < expectedTransparentUv.length; i += 1) {
      expect(transparentUv[i]).toBeCloseTo(expectedTransparentUv[i] as number, 6);
    }
  });
});

describe('chunk section geometries — large chunks', () => {
  // Regression: merging via Array.push(...typedArray) threw RangeError on large meshes.
  it('handles a worst-case checkerboard chunk without throwing', () => {
    const chunk = new Chunk(0, 0);
    const { chunkWidth, chunkDepth, chunkHeight } = WORLD_CONFIG;
    for (let y = 0; y < chunkHeight; y += 1) {
      for (let z = 0; z < chunkDepth; z += 1) {
        for (let x = 0; x < chunkWidth; x += 1) {
          if ((x + y + z) % 2 === 0) {
            chunk.setBlock(x, y, z, (x + z) % 4 === 0 ? BlockId.Glass : BlockId.Stone);
          }
        }
      }
    }
    const neighborhood: ChunkNeighborhood = { center: chunk, posX: null, negX: null, posZ: null, negZ: null };
    const data = meshChunk(neighborhood, blockRegistry);
    const { opaque, transparent } = createChunkGeometries(data);
    expect(opaque?.getAttribute('position').count).toBeGreaterThanOrEqual(data.opaque.positions.length / 3);
    expect(transparent?.getAttribute('position').count).toBeGreaterThanOrEqual(data.transparent.positions.length / 3);
    expect(opaque?.drawRange.count).toBe(data.opaque.indices.length);
    expect(transparent?.drawRange.count).toBe(data.transparent.indices.length);
    expect(prefixOf(opaque?.getIndex(), data.opaque.indices.length)).toEqual(Array.from(data.opaque.indices));
  });
});

describe('chunk light attribute and materials', () => {
  it('adds a normalized Uint8 light attribute (itemSize 2) per section geometry', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    // Distinct light per cell so opaque vs transparent data are distinguishable.
    for (let i = 0; i < chunk.light.length; i += 1) {
      chunk.light[i] = i & 0xff;
    }
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const { opaque, transparent } = createChunkGeometries(data);

    for (const [geometry, section] of [
      [opaque, data.opaque],
      [transparent, data.transparent],
    ] as const) {
      const light = geometry?.getAttribute(CHUNK_LIGHT_ATTRIBUTE);
      expect(light).toBeDefined();
      expect(light?.itemSize).toBe(2);
      expect(light?.normalized).toBe(true);
      expect(light?.array).toBeInstanceOf(Uint8Array);
      expect(light?.count).toBe(geometry?.getAttribute('position').count);
      expect(prefixOf(light, section.light.length)).toEqual(Array.from(section.light));
    }
  });

  it('uses shared unlit node materials with the transparency settings preserved', () => {
    expect(chunkOpaqueMaterial).toBeInstanceOf(MeshBasicNodeMaterial);
    expect(chunkTransparentMaterial).toBeInstanceOf(MeshBasicNodeMaterial);
    expect(chunkOpaqueMaterial.colorNode).not.toBeNull();
    expect(chunkTransparentMaterial.colorNode).not.toBeNull();
    expect(chunkOpaqueMaterial.alphaTest).toBe(RENDER_CONFIG.chunkAlphaTest);
    expect(chunkOpaqueMaterial.transparent).toBe(false);
    expect(chunkOpaqueMaterial.fog).toBe(true);
    expect(chunkTransparentMaterial.transparent).toBe(true);
    expect(chunkTransparentMaterial.opacity).toBe(RENDER_CONFIG.chunkTransparentOpacity);
    expect(chunkTransparentMaterial.depthWrite).toBe(false);
    expect(chunkTransparentMaterial.alphaTest).toBe(RENDER_CONFIG.chunkAlphaTest);
    expect(chunkTransparentMaterial.fog).toBe(true);

    const scene = new THREE.Scene();
    const renderer = new ChunkMeshRenderer(scene);
    const a = new Chunk(0, 0);
    a.setBlock(1, 1, 1, BlockId.Stone);
    const b = new Chunk(1, 0);
    b.setBlock(2, 2, 2, BlockId.Glass);
    renderer.upsert(0, 0, meshChunk(soloNeighborhood(a), blockRegistry));
    renderer.upsert(1, 0, meshChunk(soloNeighborhood(b), blockRegistry));
    const meshes = scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m) => m.material)).toEqual([chunkOpaqueMaterial, chunkTransparentMaterial]);
    renderer.dispose();
  });

  it('clamps the shared daylight uniform to [0, 1]', () => {
    setChunkDaylight(0.25);
    expect(getChunkDaylight()).toBe(0.25);
    setChunkDaylight(-2);
    expect(getChunkDaylight()).toBe(0);
    setChunkDaylight(5);
    expect(getChunkDaylight()).toBe(1);
  });
});

describe('ChunkMeshRenderer resource lifecycle', () => {
  function stoneAndGlass(cx: number): ReturnType<typeof meshChunk> {
    const chunk = new Chunk(cx, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    return meshChunk(soloNeighborhood(chunk), blockRegistry);
  }

  function meshesIn(scene: THREE.Scene): THREE.Mesh[] {
    return scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
  }

  /** Counts geometry disposals and Object3D 'dispose' events (which release the renderer's RenderObject). */
  function countDisposals(meshes: readonly THREE.Mesh[]): { count: number; objects: number } {
    const counter = { count: 0, objects: 0 };
    for (const mesh of meshes) {
      mesh.geometry.addEventListener('dispose', () => {
        counter.count += 1;
      });
      mesh.addEventListener('dispose', () => {
        counter.objects += 1;
      });
    }
    return counter;
  }

  it('adds one mesh per non-empty section and none for an empty chunk', () => {
    const scene = new THREE.Scene();
    const renderer = new ChunkMeshRenderer(scene);
    renderer.upsert(0, 0, stoneAndGlass(0));
    expect(meshesIn(scene)).toHaveLength(2);
    renderer.upsert(1, 0, meshChunk(soloNeighborhood(new Chunk(1, 0)), blockRegistry));
    expect(meshesIn(scene)).toHaveLength(2);
    renderer.dispose();
  });

  it('positions each mesh at the chunk world origin', () => {
    const scene = new THREE.Scene();
    const renderer = new ChunkMeshRenderer(scene);
    renderer.upsert(2, -1, stoneAndGlass(2));
    for (const mesh of meshesIn(scene)) {
      expect(mesh.position.x).toBe(2 * WORLD_CONFIG.chunkWidth);
      expect(mesh.position.z).toBe(-1 * WORLD_CONFIG.chunkDepth);
    }
    renderer.dispose();
  });

  it('upsert of an existing chunk disposes the old meshes and returns their geometries to the pool for reuse', () => {
    const scene = new THREE.Scene();
    const pool = createChunkGeometryPool();
    const renderer = new ChunkMeshRenderer(scene, pool);
    renderer.upsert(0, 0, stoneAndGlass(0));
    const old = meshesIn(scene);
    const oldGeometries = old.map((m) => m.geometry);
    const disposed = countDisposals(old);
    renderer.upsert(0, 0, stoneAndGlass(0));
    // Pooled geometries are never disposed on replace (each disposal leaks a VAO on WebGL2)...
    expect(disposed.count).toBe(0);
    // ...but the meshes are, so the renderer drops their RenderObjects.
    expect(disposed.objects).toBe(2);
    const current = meshesIn(scene);
    expect(current).toHaveLength(2);
    for (const mesh of current) {
      expect(old).not.toContain(mesh);
      expect(oldGeometries).toContain(mesh.geometry);
    }
    expect(pool.stats).toEqual({ inUse: 2, free: 0, created: 2, disposed: 0 });
    renderer.dispose();
  });

  it('upsert with empty data removes the previous meshes and releases their geometries', () => {
    const scene = new THREE.Scene();
    const pool = createChunkGeometryPool();
    const renderer = new ChunkMeshRenderer(scene, pool);
    renderer.upsert(0, 0, stoneAndGlass(0));
    const disposed = countDisposals(meshesIn(scene));
    renderer.upsert(0, 0, meshChunk(soloNeighborhood(new Chunk(0, 0)), blockRegistry));
    expect(disposed.count).toBe(0);
    expect(disposed.objects).toBe(2);
    expect(meshesIn(scene)).toHaveLength(0);
    expect(pool.stats).toMatchObject({ inUse: 0, free: 2 });
    renderer.dispose();
  });

  it('remove releases geometries and disposes + detaches meshes (no-op for unknown chunks); dispose() disposes the pool', () => {
    const scene = new THREE.Scene();
    const pool = createChunkGeometryPool();
    const renderer = new ChunkMeshRenderer(scene, pool);
    renderer.upsert(0, 0, stoneAndGlass(0));
    renderer.upsert(1, 0, stoneAndGlass(1));
    const disposed = countDisposals(meshesIn(scene));
    renderer.remove(9, 9);
    expect(disposed.objects).toBe(0);
    renderer.remove(0, 0);
    expect(disposed.count).toBe(0);
    expect(disposed.objects).toBe(2);
    expect(pool.stats).toMatchObject({ inUse: 2, free: 2 });
    expect(meshesIn(scene)).toHaveLength(2);
    renderer.remove(0, 0);
    expect(disposed.objects).toBe(2);
    renderer.dispose();
    expect(disposed.count).toBe(4);
    expect(disposed.objects).toBe(4);
    expect(meshesIn(scene)).toHaveLength(0);
    expect(pool.stats).toEqual({ inUse: 0, free: 0, created: 4, disposed: 4 });
  });

  it('streaming reuses geometries: remove + upsert of new chunks creates none once the pool is warm', () => {
    const scene = new THREE.Scene();
    const pool = createChunkGeometryPool();
    const renderer = new ChunkMeshRenderer(scene, pool);
    for (let cx = 0; cx < 4; cx += 1) {
      renderer.upsert(cx, 0, stoneAndGlass(cx));
    }
    for (let step = 0; step < 20; step += 1) {
      renderer.remove(step, 0);
      renderer.upsert(step + 4, 0, stoneAndGlass(step + 4));
    }
    expect(pool.stats).toEqual({ inUse: 8, free: 0, created: 8, disposed: 0 });
    expect(meshesIn(scene)).toHaveLength(8);
    renderer.dispose();
  });
});
