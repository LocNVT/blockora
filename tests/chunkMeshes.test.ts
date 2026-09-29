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
  createChunkGeometries,
  createSectionGeometry,
  getChunkDaylight,
  setChunkDaylight,
  voxelAtlasLayout,
} from '../src/renderer/chunkMeshes';
import { applyAtlasUvs } from '../src/world/texture/applyAtlasUvs';

function soloNeighborhood(chunk: Chunk): ChunkNeighborhood {
  return { center: chunk, posX: null, negX: null, posZ: null, negZ: null };
}

describe('createChunkGeometries', () => {
  it('returns null for both sections of an empty chunk', () => {
    const chunk = new Chunk(0, 0);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const geometries = createChunkGeometries(data);
    expect(geometries.opaque).toBeNull();
    expect(geometries.transparent).toBeNull();
    expect(createSectionGeometry(data.opaque)).toBeNull();
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
    expect(opaque?.getIndex()?.count).toBe(36);
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
    expect(opaque?.getIndex()?.count).toBe(data.opaque.indices.length);
    expect(transparent?.getIndex()?.count).toBe(data.transparent.indices.length);
    // Indices are section-local (no vertex offset from concatenation).
    expect(Array.from(transparent?.getIndex()?.array ?? [])).toEqual(Array.from(data.transparent.indices));
  });

  it('never yields a geometry with an empty index buffer', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const { opaque, transparent } = createChunkGeometries(data);
    expect(opaque).toBeNull();
    expect(transparent?.getIndex()?.count).toBeGreaterThan(0);
  });

  it('attribute buffer lengths match position/index counts, with no color attribute', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const geometry = createChunkGeometries(data).opaque;
    expect(geometry).not.toBeNull();

    expect(geometry?.getAttribute('position').count).toBe(24);
    expect(geometry?.getAttribute('normal').count).toBe(24);
    expect(geometry?.getAttribute('color')).toBeUndefined();
    expect(geometry?.getAttribute('uv').count).toBe(24);
    expect(geometry?.getIndex()?.count).toBe(36);
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
    for (let i = 0; i < expectedOpaqueUv.length; i += 1) {
      expect(opaqueUv[i]).toBeCloseTo(expectedOpaqueUv[i] as number, 6);
    }
    for (let i = 0; i < expectedTransparentUv.length; i += 1) {
      expect(transparentUv[i]).toBeCloseTo(expectedTransparentUv[i] as number, 6);
    }
  });
});

describe('createChunkGeometries — large chunks', () => {
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
    expect(opaque?.getAttribute('position').count).toBe(data.opaque.positions.length / 3);
    expect(transparent?.getAttribute('position').count).toBe(data.transparent.positions.length / 3);
    expect(opaque?.getIndex()?.count).toBe(data.opaque.indices.length);
    expect(transparent?.getIndex()?.count).toBe(data.transparent.indices.length);
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
      expect(Array.from(light?.array as Uint8Array)).toEqual(Array.from(section.light));
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

  it('upsert of an existing chunk disposes the old geometries and replaces the meshes', () => {
    const scene = new THREE.Scene();
    const renderer = new ChunkMeshRenderer(scene);
    renderer.upsert(0, 0, stoneAndGlass(0));
    const old = meshesIn(scene);
    const disposed = countDisposals(old);
    renderer.upsert(0, 0, stoneAndGlass(0));
    expect(disposed.count).toBe(2);
    expect(disposed.objects).toBe(2);
    const current = meshesIn(scene);
    expect(current).toHaveLength(2);
    for (const mesh of current) {
      expect(old).not.toContain(mesh);
    }
    renderer.dispose();
  });

  it('upsert with empty data disposes and removes the previous meshes', () => {
    const scene = new THREE.Scene();
    const renderer = new ChunkMeshRenderer(scene);
    renderer.upsert(0, 0, stoneAndGlass(0));
    const disposed = countDisposals(meshesIn(scene));
    renderer.upsert(0, 0, meshChunk(soloNeighborhood(new Chunk(0, 0)), blockRegistry));
    expect(disposed.count).toBe(2);
    expect(meshesIn(scene)).toHaveLength(0);
    renderer.dispose();
  });

  it('remove disposes geometries, detaches meshes, and is a no-op for unknown chunks', () => {
    const scene = new THREE.Scene();
    const renderer = new ChunkMeshRenderer(scene);
    renderer.upsert(0, 0, stoneAndGlass(0));
    renderer.upsert(1, 0, stoneAndGlass(1));
    const disposed = countDisposals(meshesIn(scene));
    renderer.remove(9, 9);
    expect(disposed.count).toBe(0);
    renderer.remove(0, 0);
    expect(disposed.count).toBe(2);
    expect(disposed.objects).toBe(2);
    expect(meshesIn(scene)).toHaveLength(2);
    renderer.remove(0, 0);
    expect(disposed.count).toBe(2);
    renderer.dispose();
    expect(disposed.count).toBe(4);
    expect(disposed.objects).toBe(4);
    expect(meshesIn(scene)).toHaveLength(0);
  });
});
