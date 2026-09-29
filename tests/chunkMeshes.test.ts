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
  chunkMaterials,
  chunkOpaqueMaterial,
  chunkTransparentMaterial,
  createChunkGeometry,
  getChunkDaylight,
  setChunkDaylight,
  voxelAtlasLayout,
} from '../src/renderer/chunkMeshes';
import { applyAtlasUvs } from '../src/world/texture/applyAtlasUvs';

function soloNeighborhood(chunk: Chunk): ChunkNeighborhood {
  return { center: chunk, posX: null, negX: null, posZ: null, negZ: null };
}

describe('createChunkGeometry', () => {
  it('returns null for an empty chunk', () => {
    const chunk = new Chunk(0, 0);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    expect(createChunkGeometry(data)).toBeNull();
  });

  it('sets an opaque-only group when there is no transparent geometry', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const geometry = createChunkGeometry(data);

    expect(geometry).not.toBeNull();
    const groups = geometry?.groups ?? [];
    expect(groups.length).toBe(1);
    expect(groups[0]?.materialIndex).toBe(0);
    expect(groups[0]?.start).toBe(0);
    expect(groups[0]?.count).toBe(36);
  });

  it('sets both opaque and transparent groups when both are present', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const geometry = createChunkGeometry(data);

    expect(geometry).not.toBeNull();
    const groups = geometry?.groups ?? [];
    expect(groups.length).toBe(2);

    const opaqueGroup = groups.find((g) => g.materialIndex === 0);
    const transparentGroup = groups.find((g) => g.materialIndex === 1);
    expect(opaqueGroup).toBeDefined();
    expect(transparentGroup).toBeDefined();
    expect(opaqueGroup?.start).toBe(0);
    expect(opaqueGroup?.count).toBe(data.opaque.indices.length);
    expect(transparentGroup?.start).toBe(data.opaque.indices.length);
    expect(transparentGroup?.count).toBe(data.transparent.indices.length);
  });

  it('attribute buffer lengths match position/index counts, with no color attribute', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const geometry = createChunkGeometry(data);
    expect(geometry).not.toBeNull();

    const position = geometry?.getAttribute('position');
    const normal = geometry?.getAttribute('normal');
    const color = geometry?.getAttribute('color');
    const uv = geometry?.getAttribute('uv');
    const index = geometry?.getIndex();

    expect(position?.count).toBe(24);
    expect(normal?.count).toBe(24);
    expect(color).toBeUndefined();
    expect(uv?.count).toBe(24);
    expect(index?.count).toBe(36);
  });

  it('uv attribute equals the atlas-mapped uvs computed directly from mesh data', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const geometry = createChunkGeometry(data);
    expect(geometry).not.toBeNull();

    const expectedOpaqueUv = applyAtlasUvs(data.opaque.uvs, data.opaque.tiles, voxelAtlasLayout);
    const expectedTransparentUv = applyAtlasUvs(
      data.transparent.uvs,
      data.transparent.tiles,
      voxelAtlasLayout,
    );

    const uv = geometry?.getAttribute('uv');
    expect(uv).toBeDefined();
    const uvArray = uv?.array as Float32Array;

    for (let i = 0; i < expectedOpaqueUv.length; i += 1) {
      expect(uvArray[i]).toBeCloseTo(expectedOpaqueUv[i] as number, 6);
    }
    const offset = expectedOpaqueUv.length;
    for (let i = 0; i < expectedTransparentUv.length; i += 1) {
      expect(uvArray[offset + i]).toBeCloseTo(expectedTransparentUv[i] as number, 6);
    }
  });
});

describe('createChunkGeometry — large chunks', () => {
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
    const geometry = createChunkGeometry(data);
    const expectedVertices = (data.opaque.positions.length + data.transparent.positions.length) / 3;
    expect(geometry?.getAttribute('position').count).toBe(expectedVertices);
    expect(geometry?.getIndex()?.count).toBe(data.opaque.indices.length + data.transparent.indices.length);
    expect(geometry?.groups).toHaveLength(2);
  });
});

describe('chunk light attribute and materials', () => {
  it('adds a normalized Uint8 light attribute (itemSize 2) concatenated in group order', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(5, 5, 5, BlockId.Stone);
    chunk.setBlock(6, 5, 5, BlockId.Glass);
    // Distinct light per cell so opaque vs transparent data are distinguishable.
    for (let i = 0; i < chunk.light.length; i += 1) {
      chunk.light[i] = i & 0xff;
    }
    const data = meshChunk(soloNeighborhood(chunk), blockRegistry);
    const geometry = createChunkGeometry(data);
    const light = geometry?.getAttribute(CHUNK_LIGHT_ATTRIBUTE);
    const position = geometry?.getAttribute('position');

    expect(light).toBeDefined();
    expect(light?.itemSize).toBe(2);
    expect(light?.normalized).toBe(true);
    expect(light?.array).toBeInstanceOf(Uint8Array);
    expect(light?.count).toBe(position?.count);
    const expected = [...Array.from(data.opaque.light), ...Array.from(data.transparent.light)];
    expect(Array.from(light?.array as Uint8Array)).toEqual(expected);
  });

  it('uses shared unlit node materials with the transparency settings preserved', () => {
    expect(chunkMaterials[0]).toBe(chunkOpaqueMaterial);
    expect(chunkMaterials[1]).toBe(chunkTransparentMaterial);
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
    for (const mesh of meshes) {
      const mats = mesh.material as THREE.Material[];
      expect(mats[0]).toBe(chunkOpaqueMaterial);
      expect(mats[1]).toBe(chunkTransparentMaterial);
    }
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
