import * as THREE from 'three';
import type { MeshSectionData } from '../world/mesher/MeshBuffers';
import { LIGHT_COMPONENTS, isSectionEmpty } from '../world/mesher/MeshBuffers';
import type { AtlasLayout } from '../world/texture/atlasLayout';
import { applyAtlasUvs } from '../world/texture/applyAtlasUvs';

/** Geometry attribute holding MeshSectionData.light: Uint8 [sky, block] per vertex, normalized. */
export const CHUNK_LIGHT_ATTRIBUTE = 'voxelLight';

const POSITION_ITEM_SIZE = 3;
const NORMAL_ITEM_SIZE = 3;
const UV_ITEM_SIZE = 2;
/** Int8 normal components are normalized (-1/1 -> -1.0/1.0). */
const NORMALIZED_NORMALS = true;
const NORMALIZED_LIGHT = true;
const scratchPoint = new THREE.Vector3();

export interface ChunkGeometryPoolOptions {
  readonly atlasLayout: AtlasLayout;
  /** Smallest vertex capacity of a pooled geometry. */
  readonly minVertexCapacity: number;
  /** Smallest index capacity of a pooled geometry. */
  readonly minIndexCapacity: number;
  /** Capacity classes grow by this factor (> 1) from the minimum; see `poolCapacity`. */
  readonly capacityGrowthRatio: number;
  /** Every capacity class above the minimum is rounded up to a multiple of this (>= 1). */
  readonly capacityQuantum: number;
  /** Released geometries kept for reuse; any release beyond this disposes the geometry. */
  readonly maxFreeGeometries: number;
}

export interface ChunkGeometryPoolStats {
  /** Geometries currently acquired (owned by a chunk mesh). */
  readonly inUse: number;
  /** Released geometries waiting for reuse. */
  readonly free: number;
  /** Geometries ever created. */
  readonly created: number;
  /** Geometries ever disposed (growth replacements, free-list overflow, pool dispose). */
  readonly disposed: number;
}

/** A pooled geometry plus its fixed attribute objects and capacities. */
interface PoolEntry {
  readonly geometry: THREE.BufferGeometry;
  readonly position: THREE.BufferAttribute;
  readonly normal: THREE.BufferAttribute;
  readonly uv: THREE.BufferAttribute;
  readonly light: THREE.BufferAttribute;
  readonly index: THREE.BufferAttribute;
  readonly vertexCapacity: number;
  readonly indexCapacity: number;
}

/**
 * Smallest capacity class >= count. Classes start at `minimum` and each next
 * one is the previous × `growthRatio`, rounded up to a multiple of `quantum`
 * (strictly increasing for growthRatio > 1).
 */
export function poolCapacity(count: number, minimum: number, growthRatio: number, quantum: number): number {
  if (!(growthRatio > 1) || !(quantum >= 1)) {
    throw new RangeError('poolCapacity: growthRatio must be > 1 and quantum >= 1.');
  }
  let capacity = Math.max(1, minimum);
  while (capacity < count) {
    capacity = Math.ceil((capacity * growthRatio) / quantum) * quantum;
  }
  return capacity;
}

/**
 * Reuses chunk section geometries (BufferGeometry + BufferAttribute objects
 * and therefore their GPU buffers) across chunks instead of disposing them.
 *
 * Why: three r186's WebGL2 backend caches one VAO per attribute set
 * (`WebGLBackend.vaoCache`) and never deletes it, so every disposed geometry
 * leaks a VAO — and, because the VAO still references them, its deleted GL
 * buffers. Reusing geometries keeps the VAO count at the pool size.
 *
 * Each geometry has capacity-sized arrays; a fill copies the section into the
 * prefix, marks only that prefix for upload (`addUpdateRange`), sets the draw
 * range to the used index count and recomputes bounds from the used vertices
 * (frustum culling reads `boundingSphere`; stale data past the prefix is never
 * drawn nor counted). A section larger than every free geometry replaces the
 * largest free one with a bigger geometry (dispose + create), so each pool
 * slot's capacity only grows and growth events stay bounded.
 */
export class ChunkGeometryPool {
  private readonly options: ChunkGeometryPoolOptions;
  private readonly free: PoolEntry[] = [];
  private readonly inUse = new Map<THREE.BufferGeometry, PoolEntry>();
  private createdCount = 0;
  private disposedCount = 0;

  constructor(options: ChunkGeometryPoolOptions) {
    // Validates the capacity options up front (throws RangeError).
    poolCapacity(1, options.minVertexCapacity, options.capacityGrowthRatio, options.capacityQuantum);
    this.options = options;
  }

  get stats(): ChunkGeometryPoolStats {
    return { inUse: this.inUse.size, free: this.free.length, created: this.createdCount, disposed: this.disposedCount };
  }

  /** Returns a geometry holding `section` (must be non-empty); give it back with `release`. */
  acquire(section: MeshSectionData): THREE.BufferGeometry {
    if (isSectionEmpty(section)) {
      throw new Error('ChunkGeometryPool: cannot acquire a geometry for an empty section.');
    }
    const vertexCount = section.positions.length / POSITION_ITEM_SIZE;
    const indexCount = section.indices.length;
    const entry = this.takeFitting(vertexCount, indexCount) ?? this.replaceOrCreate(vertexCount, indexCount);
    fillEntry(entry, section, this.options.atlasLayout);
    this.inUse.set(entry.geometry, entry);
    return entry.geometry;
  }

  /** Returns an acquired geometry to the pool (never disposed unless the free list is full). */
  release(geometry: THREE.BufferGeometry): void {
    const entry = this.inUse.get(geometry);
    if (entry === undefined) {
      throw new Error('ChunkGeometryPool: released a geometry that is not acquired from this pool.');
    }
    this.inUse.delete(geometry);
    if (this.free.length >= this.options.maxFreeGeometries) {
      this.disposeEntry(entry);
      return;
    }
    this.free.push(entry);
  }

  /** Disposes every pooled geometry (free and still acquired). Call only at teardown. */
  dispose(): void {
    for (const entry of this.free) {
      this.disposeEntry(entry);
    }
    for (const entry of this.inUse.values()) {
      this.disposeEntry(entry);
    }
    this.free.length = 0;
    this.inUse.clear();
  }

  /** Best fit: the free geometry with the smallest vertex capacity that holds both counts. */
  private takeFitting(vertexCount: number, indexCount: number): PoolEntry | null {
    let best = -1;
    for (let i = 0; i < this.free.length; i += 1) {
      const entry = this.free[i];
      if (entry === undefined || entry.vertexCapacity < vertexCount || entry.indexCapacity < indexCount) {
        continue;
      }
      const bestEntry = this.free[best];
      if (bestEntry === undefined || entry.vertexCapacity < bestEntry.vertexCapacity) {
        best = i;
      }
    }
    return best < 0 ? null : this.removeFree(best);
  }

  /** No free geometry fits: grow (replace) the largest free one, or create a new one. */
  private replaceOrCreate(vertexCount: number, indexCount: number): PoolEntry {
    let largest = -1;
    for (let i = 0; i < this.free.length; i += 1) {
      const entry = this.free[i];
      const largestEntry = this.free[largest];
      if (entry !== undefined && (largestEntry === undefined || entry.vertexCapacity > largestEntry.vertexCapacity)) {
        largest = i;
      }
    }
    const { minVertexCapacity, minIndexCapacity, capacityGrowthRatio, capacityQuantum } = this.options;
    let vertexCapacity = poolCapacity(vertexCount, minVertexCapacity, capacityGrowthRatio, capacityQuantum);
    let indexCapacity = poolCapacity(indexCount, minIndexCapacity, capacityGrowthRatio, capacityQuantum);
    if (largest >= 0) {
      const replaced = this.removeFree(largest);
      vertexCapacity = Math.max(vertexCapacity, replaced.vertexCapacity);
      indexCapacity = Math.max(indexCapacity, replaced.indexCapacity);
      this.disposeEntry(replaced);
    }
    this.createdCount += 1;
    return createEntry(vertexCapacity, indexCapacity);
  }

  /** O(1) unordered removal from the free list. */
  private removeFree(i: number): PoolEntry {
    const entry = this.free[i];
    const last = this.free.pop();
    if (entry === undefined || last === undefined) {
      throw new Error('ChunkGeometryPool: free-list index out of range.');
    }
    if (last !== entry) {
      this.free[i] = last;
    }
    return entry;
  }

  private disposeEntry(entry: PoolEntry): void {
    entry.geometry.dispose();
    this.disposedCount += 1;
  }
}

function createEntry(vertexCapacity: number, indexCapacity: number): PoolEntry {
  const position = new THREE.BufferAttribute(new Float32Array(vertexCapacity * POSITION_ITEM_SIZE), POSITION_ITEM_SIZE);
  const normal = new THREE.BufferAttribute(
    new Int8Array(vertexCapacity * NORMAL_ITEM_SIZE),
    NORMAL_ITEM_SIZE,
    NORMALIZED_NORMALS,
  );
  const uv = new THREE.BufferAttribute(new Float32Array(vertexCapacity * UV_ITEM_SIZE), UV_ITEM_SIZE);
  const light = new THREE.BufferAttribute(
    new Uint8Array(vertexCapacity * LIGHT_COMPONENTS),
    LIGHT_COMPONENTS,
    NORMALIZED_LIGHT,
  );
  const index = new THREE.BufferAttribute(new Uint32Array(indexCapacity), 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  geometry.setAttribute('uv', uv);
  geometry.setAttribute(CHUNK_LIGHT_ATTRIBUTE, light);
  geometry.setIndex(index);
  geometry.boundingBox = new THREE.Box3();
  geometry.boundingSphere = new THREE.Sphere();
  return { geometry, position, normal, uv, light, index, vertexCapacity, indexCapacity };
}

/** Copies `section` into the entry's prefix, flags the prefix for upload, sets draw range + bounds. */
function fillEntry(entry: PoolEntry, section: MeshSectionData, atlasLayout: AtlasLayout): void {
  writePrefix(entry.position, section.positions);
  writePrefix(entry.normal, section.normals);
  writePrefix(entry.light, section.light);
  writePrefix(entry.index, section.indices);
  const uvArray = entry.uv.array;
  if (!(uvArray instanceof Float32Array)) {
    throw new Error('ChunkGeometryPool: uv attribute is not a Float32Array.');
  }
  applyAtlasUvs(section.uvs, section.tiles, atlasLayout, uvArray);
  markPrefix(entry.uv, section.tiles.length * UV_ITEM_SIZE);

  const vertexCount = section.positions.length / POSITION_ITEM_SIZE;
  entry.geometry.setDrawRange(0, section.indices.length);
  setPrefixBounds(entry.geometry, section.positions, vertexCount);
}

/** Copies `source` into the start of the attribute's (capacity-sized) array and flags that prefix. */
function writePrefix(attribute: THREE.BufferAttribute, source: Float32Array | Int8Array | Uint8Array | Uint32Array): void {
  const target = attribute.array;
  if (target.constructor !== source.constructor || target.length < source.length) {
    throw new Error('ChunkGeometryPool: attribute array type or capacity mismatch.');
  }
  target.set(source);
  markPrefix(attribute, source.length);
}

/**
 * Uploads only the first `count` components: replaces any range left from a
 * fill that was never rendered (e.g. frustum-culled), then bumps the version.
 */
function markPrefix(attribute: THREE.BufferAttribute, count: number): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
}

/**
 * Bounds of the used vertices only (the same box-centred sphere three's
 * `computeBoundingSphere` would build from an exact-size attribute), so
 * frustum culling matches unpooled geometries and ignores stale capacity.
 */
export function setPrefixBounds(geometry: THREE.BufferGeometry, positions: Float32Array, vertexCount: number): void {
  const box = geometry.boundingBox ?? new THREE.Box3();
  const sphere = geometry.boundingSphere ?? new THREE.Sphere();
  box.makeEmpty();
  const point = scratchPoint;
  for (let v = 0; v < vertexCount; v += 1) {
    point.fromArray(positions, v * POSITION_ITEM_SIZE);
    box.expandByPoint(point);
  }
  box.getCenter(sphere.center);
  let maxRadiusSq = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    point.fromArray(positions, v * POSITION_ITEM_SIZE);
    maxRadiusSq = Math.max(maxRadiusSq, sphere.center.distanceToSquared(point));
  }
  sphere.radius = Math.sqrt(maxRadiusSq);
  geometry.boundingBox = box;
  geometry.boundingSphere = sphere;
}
