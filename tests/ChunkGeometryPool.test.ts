import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import { Chunk } from '../src/world/Chunk';
import { meshChunk } from '../src/world/mesher';
import type { MeshSectionData } from '../src/world/mesher/MeshBuffers';
import { createAtlasLayout } from '../src/world/texture/atlasLayout';
import { applyAtlasUvs } from '../src/world/texture/applyAtlasUvs';
import {
  CHUNK_LIGHT_ATTRIBUTE,
  ChunkGeometryPool,
  poolCapacity,
  type ChunkGeometryPoolOptions,
} from '../src/renderer/ChunkGeometryPool';
import { CHUNK_GEOMETRY_POOL_CONFIG, SETTINGS_CONFIG } from '../src/config/constants';

const layout = createAtlasLayout(16);

/** Small power-of-two classes (ratio 2, quantum 1) keep capacities easy to predict: 4, 8, 16, 32, ... vertices. */
function makePool(overrides: { readonly maxFreeGeometries?: number } = {}): ChunkGeometryPool {
  const options: ChunkGeometryPoolOptions = {
    atlasLayout: layout,
    minVertexCapacity: 4,
    minIndexCapacity: 6,
    capacityGrowthRatio: 2,
    capacityQuantum: 1,
    maxFreeGeometries: overrides.maxFreeGeometries ?? 8,
  };
  return new ChunkGeometryPool(options);
}

/** Opaque section of a chunk holding one isolated stone block per given position (24 vertices / 36 indices each). */
function stoneSection(...blocks: readonly (readonly [number, number, number])[]): MeshSectionData {
  const chunk = new Chunk(0, 0);
  for (const [x, y, z] of blocks) {
    chunk.setBlock(x, y, z, BlockId.Stone);
  }
  return meshChunk({ center: chunk, posX: null, negX: null, posZ: null, negZ: null }, blockRegistry).opaque;
}

function prefix(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null, length: number): number[] {
  if (attribute === null) {
    throw new Error('missing attribute');
  }
  return Array.from(attribute.array.subarray(0, length));
}

function countDisposals(geometry: THREE.BufferGeometry): { count: number } {
  const counter = { count: 0 };
  geometry.addEventListener('dispose', () => {
    counter.count += 1;
  });
  return counter;
}

describe('poolCapacity', () => {
  it('rounds up to the next class (minimum × ratio^k), never below the minimum', () => {
    expect(poolCapacity(1, 4, 2, 1)).toBe(4);
    expect(poolCapacity(24, 4, 2, 1)).toBe(32);
    expect(poolCapacity(32, 4, 2, 1)).toBe(32);
    expect(poolCapacity(33, 4, 2, 1)).toBe(64);
    expect(poolCapacity(10, 1024, 2, 1)).toBe(1024);
    expect(poolCapacity(0, 0, 2, 1)).toBe(1);
  });

  it('rounds each class above the minimum up to the quantum (default config classes)', () => {
    const { minVertexCapacity, capacityGrowthRatio, capacityQuantum } = CHUNK_GEOMETRY_POOL_CONFIG;
    const cap = (count: number): number => poolCapacity(count, minVertexCapacity, capacityGrowthRatio, capacityQuantum);
    expect(cap(1)).toBe(1024);
    expect(cap(1024)).toBe(1024);
    expect(cap(1025)).toBe(1280);
    expect(cap(1281)).toBe(1600);
    expect(cap(1601)).toBe(2048); // ceil(2000 / 64) * 64
    for (const count of [3000, 7696, 50000]) {
      const capacity = cap(count);
      expect(capacity).toBeGreaterThanOrEqual(count);
      expect(capacity % capacityQuantum).toBe(0);
      expect(capacity).toBeLessThan(count * capacityGrowthRatio + capacityQuantum);
    }
  });

  it('rejects a growth ratio <= 1 or a quantum < 1 (would never grow)', () => {
    expect(() => poolCapacity(10, 4, 1, 1)).toThrow(RangeError);
    expect(() => poolCapacity(10, 4, 2, 0)).toThrow(RangeError);
    expect(
      () =>
        new ChunkGeometryPool({
          atlasLayout: layout,
          minVertexCapacity: 4,
          minIndexCapacity: 6,
          capacityGrowthRatio: 0.5,
          capacityQuantum: 1,
          maxFreeGeometries: 1,
        }),
    ).toThrow(RangeError);
  });

  it('keeps enough free geometries for a whole rendered area at the max render distance (2 sections per chunk)', () => {
    const rendered = (2 * SETTINGS_CONFIG.renderDistance.max + 1) ** 2;
    expect(CHUNK_GEOMETRY_POOL_CONFIG.maxFreeGeometries).toBe(rendered * 2);
  });
});

describe('ChunkGeometryPool acquire', () => {
  it('fills the capacity-sized attributes prefix, draw range and index from the section', () => {
    const pool = makePool();
    const section = stoneSection([5, 5, 5]);
    const geometry = pool.acquire(section);
    const vertexCount = section.positions.length / 3;
    expect(vertexCount).toBe(24);

    expect(geometry.getAttribute('position').count).toBe(32);
    expect(geometry.getIndex()?.count).toBe(48);
    expect(geometry.drawRange).toEqual({ start: 0, count: 36 });
    expect(geometry.groups).toHaveLength(0);
    expect(geometry.getAttribute('color')).toBeUndefined();

    expect(prefix(geometry.getAttribute('position'), section.positions.length)).toEqual(Array.from(section.positions));
    expect(prefix(geometry.getAttribute('normal'), section.normals.length)).toEqual(Array.from(section.normals));
    expect(prefix(geometry.getAttribute(CHUNK_LIGHT_ATTRIBUTE), section.light.length)).toEqual(
      Array.from(section.light),
    );
    expect(prefix(geometry.getIndex(), section.indices.length)).toEqual(Array.from(section.indices));
    const expectedUv = applyAtlasUvs(section.uvs, section.tiles, layout);
    expect(prefix(geometry.getAttribute('uv'), expectedUv.length)).toEqual(Array.from(expectedUv));
  });

  it('uses the same attribute types as the mesher (normalized Int8 normals / Uint8 light, Uint32 index)', () => {
    const geometry = makePool().acquire(stoneSection([1, 1, 1]));
    expect(geometry.getAttribute('position').array).toBeInstanceOf(Float32Array);
    expect(geometry.getAttribute('normal').array).toBeInstanceOf(Int8Array);
    expect(geometry.getAttribute('normal').normalized).toBe(true);
    expect(geometry.getAttribute('uv').array).toBeInstanceOf(Float32Array);
    const light = geometry.getAttribute(CHUNK_LIGHT_ATTRIBUTE);
    expect(light.array).toBeInstanceOf(Uint8Array);
    expect(light.itemSize).toBe(2);
    expect(light.normalized).toBe(true);
    expect(geometry.getIndex()?.array).toBeInstanceOf(Uint32Array);
  });

  it('flags only the used prefix for upload and bumps every attribute version', () => {
    const geometry = makePool().acquire(stoneSection([1, 1, 1]));
    const attributes = [
      geometry.getAttribute('position'),
      geometry.getAttribute('normal'),
      geometry.getAttribute('uv'),
      geometry.getAttribute(CHUNK_LIGHT_ATTRIBUTE),
      geometry.getIndex(),
    ] as THREE.BufferAttribute[];
    const expectedCounts = [24 * 3, 24 * 3, 24 * 2, 24 * 2, 36];
    attributes.forEach((attribute, i) => {
      expect(attribute.updateRanges).toEqual([{ start: 0, count: expectedCounts[i] }]);
      expect(attribute.version).toBeGreaterThan(0);
    });
  });

  it('throws for an empty section', () => {
    const empty = meshChunk(
      { center: new Chunk(0, 0), posX: null, negX: null, posZ: null, negZ: null },
      blockRegistry,
    ).opaque;
    expect(() => makePool().acquire(empty)).toThrow(/empty section/);
  });
});

describe('ChunkGeometryPool reuse', () => {
  it('reuses a released geometry (same attribute objects) and reflects the new contents', () => {
    const pool = makePool();
    const first = stoneSection([1, 1, 1], [9, 9, 9]);
    const geometry = pool.acquire(first);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = geometry.getIndex();
    const versionBefore = position.version;
    pool.release(geometry);

    const second = stoneSection([3, 40, 3]);
    const reused = pool.acquire(second);
    expect(reused).toBe(geometry);
    expect(reused.getAttribute('position')).toBe(position);
    expect(reused.getIndex()).toBe(index);
    expect(position.version).toBeGreaterThan(versionBefore);
    expect(reused.drawRange.count).toBe(second.indices.length);
    expect(prefix(reused.getAttribute('position'), second.positions.length)).toEqual(Array.from(second.positions));
    expect(prefix(reused.getIndex(), second.indices.length)).toEqual(Array.from(second.indices));
    // One range for the new fill only (a fill that was never uploaded doesn't accumulate ranges).
    expect(position.updateRanges).toEqual([{ start: 0, count: second.positions.length }]);
    expect(pool.stats).toEqual({ inUse: 1, free: 0, created: 1, disposed: 0 });
  });

  it('picks the best-fitting free geometry', () => {
    const pool = makePool();
    const small = pool.acquire(stoneSection([1, 1, 1])); // 24 vertices -> capacity 32
    const large = pool.acquire(stoneSection([1, 1, 1], [5, 5, 5], [9, 9, 9])); // 72 -> 128
    pool.release(large);
    pool.release(small);
    expect(pool.acquire(stoneSection([2, 2, 2]))).toBe(small);
    expect(pool.acquire(stoneSection([2, 2, 2]))).toBe(large);
    expect(pool.stats.created).toBe(2);
  });

  it('grows by replacing the largest free geometry when none fits', () => {
    const pool = makePool();
    const a = pool.acquire(stoneSection([1, 1, 1]));
    const b = pool.acquire(stoneSection([1, 1, 1], [5, 5, 5]));
    const aDisposed = countDisposals(a);
    const bDisposed = countDisposals(b);
    pool.release(a);
    pool.release(b);

    const big = stoneSection([1, 1, 1], [5, 5, 5], [9, 9, 9], [13, 13, 13], [1, 20, 1]); // 120 vertices
    const grown = pool.acquire(big);
    expect(grown).not.toBe(a);
    expect(grown).not.toBe(b);
    expect(bDisposed.count).toBe(1);
    expect(aDisposed.count).toBe(0);
    expect(grown.getAttribute('position').count).toBe(128);
    expect(grown.drawRange.count).toBe(big.indices.length);
    expect(pool.stats).toEqual({ inUse: 1, free: 1, created: 3, disposed: 1 });
  });

  it('bounds the free list: releases beyond maxFreeGeometries dispose the geometry', () => {
    const pool = makePool({ maxFreeGeometries: 2 });
    const geometries = [0, 1, 2].map((i) => pool.acquire(stoneSection([i, 1, 1])));
    const disposed = geometries.map(countDisposals);
    for (const geometry of geometries) {
      pool.release(geometry);
    }
    expect(disposed.map((d) => d.count)).toEqual([0, 0, 1]);
    expect(pool.stats).toEqual({ inUse: 0, free: 2, created: 3, disposed: 1 });
  });

  it('rejects releasing a foreign or already-released geometry', () => {
    const pool = makePool();
    expect(() => pool.release(new THREE.BufferGeometry())).toThrow(/not acquired/);
    const geometry = pool.acquire(stoneSection([1, 1, 1]));
    pool.release(geometry);
    expect(() => pool.release(geometry)).toThrow(/not acquired/);
    expect(pool.stats.free).toBe(1);
  });

  it('dispose() disposes free and acquired geometries', () => {
    const pool = makePool();
    const kept = pool.acquire(stoneSection([1, 1, 1]));
    const released = pool.acquire(stoneSection([2, 2, 2]));
    pool.release(released);
    const counters = [countDisposals(kept), countDisposals(released)];
    pool.dispose();
    expect(counters.map((c) => c.count)).toEqual([1, 1]);
    expect(pool.stats).toEqual({ inUse: 0, free: 0, created: 2, disposed: 2 });
  });
});

describe('ChunkGeometryPool bounds (frustum culling)', () => {
  function exactGeometry(section: MeshSectionData): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(section.positions, 3));
    return geometry;
  }

  it('matches three computeBoundingSphere / computeBoundingBox of an exact-size geometry', () => {
    const section = stoneSection([1, 1, 1], [14, 60, 3]);
    const pooled = makePool().acquire(section);
    const exact = exactGeometry(section);
    exact.computeBoundingSphere();
    exact.computeBoundingBox();
    expect(pooled.boundingSphere?.center.toArray()).toEqual(exact.boundingSphere?.center.toArray());
    expect(pooled.boundingSphere?.radius).toBeCloseTo(exact.boundingSphere?.radius ?? -1, 6);
    expect(pooled.boundingBox?.equals(exact.boundingBox ?? new THREE.Box3())).toBe(true);
  });

  it('recomputes bounds on reuse, ignoring stale vertices past the used prefix', () => {
    const pool = makePool();
    const geometry = pool.acquire(stoneSection([0, 0, 0], [15, 120, 15]));
    pool.release(geometry);
    const second = stoneSection([8, 64, 8]);
    expect(pool.acquire(second)).toBe(geometry);
    expect(geometry.boundingBox?.min.toArray()).toEqual([8, 64, 8]);
    expect(geometry.boundingBox?.max.toArray()).toEqual([9, 65, 9]);
    expect(geometry.boundingSphere?.center.toArray()).toEqual([8.5, 64.5, 8.5]);
    expect(geometry.boundingSphere?.radius).toBeCloseTo(Math.sqrt(3) / 2, 6);
  });

  it('culls a reused chunk mesh by its current contents, not its previous ones', () => {
    const pool = makePool();
    const geometry = pool.acquire(stoneSection([1, 1, 1]));
    pool.release(geometry);
    pool.acquire(stoneSection([1, 100, 1]));
    const mesh = new THREE.Mesh(geometry);
    mesh.updateMatrixWorld();

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    const frustum = new THREE.Frustum();
    const lookAt = (y: number): void => {
      camera.position.set(1.5, y, 20);
      camera.lookAt(1.5, y, 1.5);
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
    };
    lookAt(100.5);
    expect(frustum.intersectsObject(mesh)).toBe(true);
    lookAt(1.5);
    expect(frustum.intersectsObject(mesh)).toBe(false);
  });
});
