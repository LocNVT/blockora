import { FACES, type Axis, type FaceCorner, type FaceDirection } from './faces';
import { NO_TILE, faceTileFromTable } from '../texture/blockFaceTiles';
import type { BlockId } from '../blocks';
import { blockLightOf, skyLightOf } from '../light/lightNibbles';

/** One renderable section of a chunk mesh: opaque or transparent blocks. */
export interface MeshSectionData {
  readonly positions: Float32Array;
  /** Packed as signed unit components; Int8 is enough precision for axis-aligned face normals. */
  readonly normals: Int8Array;
  /** Local UV in [0, width] x [0, height] per quad; atlas mapping applied separately. */
  readonly uvs: Float32Array;
  /** Per-vertex atlas tile index (same value across a quad's 4 vertices). */
  readonly tiles: Uint16Array;
  /**
   * Per-vertex light, 2 bytes per vertex: [sky, block], each 0..15, sampled
   * from the cell the face looks into (flat per-face lighting, identical for
   * a quad's 4 vertices).
   */
  readonly light: Uint8Array;
  readonly indices: Uint32Array;
}

export interface ChunkMeshData {
  readonly opaque: MeshSectionData;
  readonly transparent: MeshSectionData;
}

const VERTS_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;
const POSITION_COMPONENTS = 3;
const NORMAL_COMPONENTS = 3;
const UV_COMPONENTS = 2;
const TILE_COMPONENTS = 1;
/** Components of MeshSectionData.light per vertex: sky, block. */
export const LIGHT_COMPONENTS = 2;
const INITIAL_QUAD_CAPACITY = 256;
const GROWTH_FACTOR = 2;

/** A single growable section (opaque or transparent) backing a MeshBuffers instance. */
class GrowableSection {
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  tiles: Uint16Array;
  light: Uint8Array;
  indices: Uint32Array;
  quadCount = 0;
  private capacityQuads: number;

  constructor(initialQuadCapacity: number) {
    this.capacityQuads = Math.max(1, initialQuadCapacity);
    this.positions = new Float32Array(this.capacityQuads * VERTS_PER_QUAD * POSITION_COMPONENTS);
    this.normals = new Int8Array(this.capacityQuads * VERTS_PER_QUAD * NORMAL_COMPONENTS);
    this.uvs = new Float32Array(this.capacityQuads * VERTS_PER_QUAD * UV_COMPONENTS);
    this.tiles = new Uint16Array(this.capacityQuads * VERTS_PER_QUAD * TILE_COMPONENTS);
    this.light = new Uint8Array(this.capacityQuads * VERTS_PER_QUAD * LIGHT_COMPONENTS);
    this.indices = new Uint32Array(this.capacityQuads * INDICES_PER_QUAD);
  }

  reset(): void {
    this.quadCount = 0;
  }

  private ensureCapacity(nextQuadCount: number): void {
    if (nextQuadCount <= this.capacityQuads) {
      return;
    }
    let newCapacity = this.capacityQuads;
    while (newCapacity < nextQuadCount) {
      newCapacity *= GROWTH_FACTOR;
    }
    this.positions = growFloat32(this.positions, newCapacity * VERTS_PER_QUAD * POSITION_COMPONENTS);
    this.normals = growInt8(this.normals, newCapacity * VERTS_PER_QUAD * NORMAL_COMPONENTS);
    this.uvs = growFloat32(this.uvs, newCapacity * VERTS_PER_QUAD * UV_COMPONENTS);
    this.tiles = growUint16(this.tiles, newCapacity * VERTS_PER_QUAD * TILE_COMPONENTS);
    this.light = growUint8(this.light, newCapacity * VERTS_PER_QUAD * LIGHT_COMPONENTS);
    this.indices = growUint32(this.indices, newCapacity * INDICES_PER_QUAD);
    this.capacityQuads = newCapacity;
  }

  pushQuad(
    face: FaceDirection,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    blockId: BlockId,
    faceTileTable: Uint16Array,
    packedLight: number,
  ): void {
    this.ensureCapacity(this.quadCount + 1);

    const descriptor = FACES[face];
    if (descriptor === undefined) {
      throw new Error(`MeshBuffers: invalid face direction ${String(face)}.`);
    }

    const vertexBase = this.quadCount * VERTS_PER_QUAD;
    const posBase = vertexBase * POSITION_COMPONENTS;
    const normBase = vertexBase * NORMAL_COMPONENTS;
    const uvBase = vertexBase * UV_COMPONENTS;
    const [nx, ny, nz] = descriptor.normal;
    const tile = faceTileFromTable(faceTileTable, blockId, face) ?? NO_TILE;
    const { widthAxis, heightAxis } = descriptor;
    const skyLight = skyLightOf(packedLight);
    const blockLight = blockLightOf(packedLight);
    const lightBase = vertexBase * LIGHT_COMPONENTS;

    // Corners are unit-cube-relative (0 or 1). The face's widthAxis/heightAxis
    // (the two in-plane axes) are scaled by the quad's width/height so a
    // future greedy-meshed quad emitted through this same call stretches
    // correctly; the normal axis is never scaled (it's a flat face).
    for (let i = 0; i < VERTS_PER_QUAD; i += 1) {
      const corner = descriptor.corners[i];
      if (corner === undefined) {
        continue;
      }
      const pi = posBase + i * POSITION_COMPONENTS;
      this.positions[pi] = x + corner.x * axisScale('x', widthAxis, heightAxis, width, height);
      this.positions[pi + 1] = y + corner.y * axisScale('y', widthAxis, heightAxis, width, height);
      this.positions[pi + 2] = z + corner.z * axisScale('z', widthAxis, heightAxis, width, height);

      const ni = normBase + i * NORMAL_COMPONENTS;
      this.normals[ni] = nx;
      this.normals[ni + 1] = ny;
      this.normals[ni + 2] = nz;

      // Local uv: u along widthAxis, v along heightAxis. For side faces,
      // heightAxis is always 'y' (see faces.ts), and corner.y matches the
      // cube's actual +Y direction, so v increases with +Y — this keeps
      // e.g. the grass-side strip on top regardless of which side face.
      const uvi = uvBase + i * UV_COMPONENTS;
      const uCorner = axisOf(corner, widthAxis);
      const vCorner = axisOf(corner, heightAxis);
      this.uvs[uvi] = uCorner * width;
      this.uvs[uvi + 1] = vCorner * height;

      this.tiles[vertexBase + i] = tile;

      const li = lightBase + i * LIGHT_COMPONENTS;
      this.light[li] = skyLight;
      this.light[li + 1] = blockLight;
    }

    const indexBase = this.quadCount * INDICES_PER_QUAD;
    this.indices[indexBase] = vertexBase;
    this.indices[indexBase + 1] = vertexBase + 1;
    this.indices[indexBase + 2] = vertexBase + 2;
    this.indices[indexBase + 3] = vertexBase;
    this.indices[indexBase + 4] = vertexBase + 2;
    this.indices[indexBase + 5] = vertexBase + 3;

    this.quadCount += 1;
  }

  toSectionData(): MeshSectionData {
    const vertexCount = this.quadCount * VERTS_PER_QUAD;
    const indexCount = this.quadCount * INDICES_PER_QUAD;
    return {
      positions: this.positions.slice(0, vertexCount * POSITION_COMPONENTS),
      normals: this.normals.slice(0, vertexCount * NORMAL_COMPONENTS),
      uvs: this.uvs.slice(0, vertexCount * UV_COMPONENTS),
      tiles: this.tiles.slice(0, vertexCount * TILE_COMPONENTS),
      light: this.light.slice(0, vertexCount * LIGHT_COMPONENTS),
      indices: this.indices.slice(0, indexCount),
    };
  }
}

function growFloat32(source: Float32Array, minLength: number): Float32Array {
  const next = new Float32Array(minLength);
  next.set(source);
  return next;
}

function growInt8(source: Int8Array, minLength: number): Int8Array {
  const next = new Int8Array(minLength);
  next.set(source);
  return next;
}

function growUint8(source: Uint8Array, minLength: number): Uint8Array {
  const next = new Uint8Array(minLength);
  next.set(source);
  return next;
}

function growUint32(source: Uint32Array, minLength: number): Uint32Array {
  const next = new Uint32Array(minLength);
  next.set(source);
  return next;
}

function growUint16(source: Uint16Array, minLength: number): Uint16Array {
  const next = new Uint16Array(minLength);
  next.set(source);
  return next;
}

/** Reads the named axis component off a unit corner offset (0 or 1). */
function axisOf(corner: FaceCorner, axis: Axis): number {
  return corner[axis];
}

/**
 * A corner's local offset along `axis` is 0 or 1. Scaling that unit offset by
 * the quad's width (if `axis` is the face's widthAxis), height (if it's the
 * heightAxis), or 1 (the normal axis, never scaled) gives the vertex's actual
 * extent along that axis — this is what lets a future greedy-meshed quad
 * (width/height > 1) stretch correctly through the same pushQuad call.
 */
function axisScale(axis: Axis, widthAxis: Axis, heightAxis: Axis, width: number, height: number): number {
  if (axis === widthAxis) {
    return width;
  }
  if (axis === heightAxis) {
    return height;
  }
  return 1;
}

const EMPTY_SECTION: MeshSectionData = {
  positions: new Float32Array(0),
  normals: new Int8Array(0),
  uvs: new Float32Array(0),
  tiles: new Uint16Array(0),
  light: new Uint8Array(0),
  indices: new Uint32Array(0),
};

/**
 * Growable, reusable typed-array builder for chunk mesh geometry. Call
 * `reset()` before each `meshChunk` call, `pushQuad` per emitted face, and
 * `toMeshData()` once to get trimmed, independent copies (safe to keep after
 * the next `reset()`/`pushQuad()` calls reuse this builder's backing storage).
 */
export class MeshBuffers {
  private readonly opaque: GrowableSection;
  private readonly transparent: GrowableSection;

  constructor(initialQuadCapacity: number = INITIAL_QUAD_CAPACITY) {
    this.opaque = new GrowableSection(initialQuadCapacity);
    this.transparent = new GrowableSection(initialQuadCapacity);
  }

  reset(): void {
    this.opaque.reset();
    this.transparent.reset();
  }

  pushQuad(
    face: FaceDirection,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    blockId: BlockId,
    layer: 'opaque' | 'transparent',
    faceTileTable: Uint16Array,
    packedLight: number,
  ): void {
    const section = layer === 'opaque' ? this.opaque : this.transparent;
    section.pushQuad(face, x, y, z, width, height, blockId, faceTileTable, packedLight);
  }

  get isEmpty(): boolean {
    return this.opaque.quadCount === 0 && this.transparent.quadCount === 0;
  }

  get vertexCount(): number {
    return (this.opaque.quadCount + this.transparent.quadCount) * VERTS_PER_QUAD;
  }

  get indexCount(): number {
    return (this.opaque.quadCount + this.transparent.quadCount) * INDICES_PER_QUAD;
  }

  /** Returns trimmed, independent typed-array copies; safe to reuse this builder afterward. */
  toMeshData(): ChunkMeshData {
    return {
      opaque: this.opaque.quadCount === 0 ? EMPTY_SECTION : this.opaque.toSectionData(),
      transparent: this.transparent.quadCount === 0 ? EMPTY_SECTION : this.transparent.toSectionData(),
    };
  }
}

export function isSectionEmpty(section: MeshSectionData): boolean {
  return section.indices.length === 0;
}

export function isMeshEmpty(data: ChunkMeshData): boolean {
  return isSectionEmpty(data.opaque) && isSectionEmpty(data.transparent);
}
