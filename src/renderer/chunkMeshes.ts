import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  float,
  max,
  mix,
  normalGeometry,
  pow,
  select,
  texture,
  uniform,
  uv,
  vec4,
} from 'three/tsl';
import type { ChunkMeshData } from '../world/mesher/MeshBuffers';
import { isSectionEmpty } from '../world/mesher/MeshBuffers';
import type { ChunkMeshSink } from '../world/mesher/remesh';
import { LIGHT_COMPONENTS } from '../world/mesher/MeshBuffers';
import { MAX_LIGHT } from '../world/light/lightNibbles';
import { RENDER_CONFIG, WORLD_CONFIG, ATLAS_CONFIG, LIGHT_RENDER_CONFIG } from '../config/constants';
import { clampDaylight } from './lightShading';
import { chunkKey } from '../world/chunkCoords';
import { createAtlasLayout, type AtlasLayout } from '../world/texture/atlasLayout';
import { applyAtlasUvs } from '../world/texture/applyAtlasUvs';
import { generateAtlasPixels } from '../world/texture/tileArt';
import { TILE_NAMES } from '../world/texture/tiles';
import { createVoxelAtlasTexture } from './voxelAtlasTexture';

const OPAQUE_MATERIAL_INDEX = 0;
const TRANSPARENT_MATERIAL_INDEX = 1;

/** Shared atlas layout + texture, built once from the data-driven tile list. */
export const voxelAtlasLayout: AtlasLayout = createAtlasLayout(TILE_NAMES.length);
/** Shared atlas RGBA pixels backing `voxelAtlasTexture`; reused by UI (e.g. HotbarHud icons) to avoid regenerating them. */
export const voxelAtlasPixels = generateAtlasPixels(voxelAtlasLayout, TILE_NAMES, ATLAS_CONFIG.seed);
export const voxelAtlasTexture = createVoxelAtlasTexture(voxelAtlasLayout, voxelAtlasPixels);

/** Geometry attribute holding MeshSectionData.light: Uint8 [sky, block] per vertex, normalized. */
export const CHUNK_LIGHT_ATTRIBUTE = 'voxelLight';
/** Normalized Uint8 reads as byte / 255 on both backends (unorm8 / normalized UNSIGNED_BYTE). */
const LIGHT_BYTE_SCALE = 255;

/**
 * The single daylight uniform (0..1) shared by both chunk materials; scales
 * sky light. Updated once per frame via `setChunkDaylight` — never per chunk.
 */
const chunkDaylight = uniform(1);

/** Sets the shared chunk daylight factor (clamped to [0, 1]; NaN → 0). */
export function setChunkDaylight(daylight: number): void {
  chunkDaylight.value = clampDaylight(daylight);
}

/** Current shared chunk daylight factor (for tests/debug). */
export function getChunkDaylight(): number {
  return chunkDaylight.value;
}

/**
 * Unlit chunk colour: atlas albedo × lightCurve(max(sky × skyScale, block)) ×
 * faceShade(normal), alpha untouched so the material's opacity/alphaTest
 * still apply afterward (NodeMaterial.setupDiffuseColor). Mirrors
 * `lightShading.ts` (the pure, tested reference). Fog is applied by
 * NodeMaterial.setupOutput from scene.fog (material.fog defaults to true).
 */
function createChunkColorNode(): ReturnType<typeof vec4> {
  const cfg = LIGHT_RENDER_CONFIG;
  const albedo = texture(voxelAtlasTexture, uv());
  const light = attribute(CHUNK_LIGHT_ATTRIBUTE, 'vec2').mul(LIGHT_BYTE_SCALE);
  const skyScale = mix(float(cfg.nightSkyScale), float(1), chunkDaylight);
  const level = max(light.x.mul(skyScale), light.y);
  const curve = pow(level.div(MAX_LIGHT).clamp(0, 1), float(cfg.gamma));
  const brightness = mix(float(cfg.minBrightness), float(1), curve);
  const n = normalGeometry;
  const shade = select(
    n.y.greaterThan(0.5),
    float(cfg.faceShadeTop),
    select(
      n.y.lessThan(-0.5),
      float(cfg.faceShadeBottom),
      select(abs(n.x).greaterThan(0.5), float(cfg.faceShadeSideX), float(cfg.faceShadeSideZ)),
    ),
  );
  return vec4(albedo.rgb.mul(brightness.mul(shade)), albedo.a);
}

/** Shared opaque material for every chunk mesh: unlit, baked voxel light. */
export const chunkOpaqueMaterial = new MeshBasicNodeMaterial({
  alphaTest: RENDER_CONFIG.chunkAlphaTest,
});
chunkOpaqueMaterial.colorNode = createChunkColorNode();

/** Shared transparent material for every chunk mesh (glass, water, leaves): unlit, baked voxel light. */
export const chunkTransparentMaterial = new MeshBasicNodeMaterial({
  transparent: true,
  opacity: RENDER_CONFIG.chunkTransparentOpacity,
  depthWrite: false,
  alphaTest: RENDER_CONFIG.chunkAlphaTest,
});
chunkTransparentMaterial.colorNode = createChunkColorNode();

/** The fixed [opaque, transparent] material array every chunk mesh uses via geometry groups. */
export const chunkMaterials: readonly THREE.Material[] = [
  chunkOpaqueMaterial,
  chunkTransparentMaterial,
];

/** Disposes the shared atlas texture and materials. Call only at full teardown (e.g. HMR/tests). */
export function disposeSharedVoxelResources(): void {
  chunkOpaqueMaterial.dispose();
  chunkTransparentMaterial.dispose();
  voxelAtlasTexture.dispose();
}

const POSITION_ITEM_SIZE = 3;
const NORMAL_ITEM_SIZE = 3;
const UV_ITEM_SIZE = 2;
/** Int8 normal components are normalized (-1/1 -> -1.0/1.0) by `normalized: true` below. */
const NORMALIZED_NORMALS = true;

/** Concatenates two typed arrays of the same kind into a new one without intermediate JS arrays. */
function concatTyped<T extends Float32Array | Int8Array | Uint8Array | Uint32Array>(
  a: T,
  b: T,
  create: (length: number) => T,
): T {
  const out = create(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Concatenates index buffers, offsetting the second by `offset` vertices. */
function concatIndices(a: Uint32Array, b: Uint32Array, offset: number): Uint32Array {
  const out = new Uint32Array(a.length + b.length);
  out.set(a, 0);
  for (let i = 0; i < b.length; i += 1) {
    out[a.length + i] = (b[i] ?? 0) + offset;
  }
  return out;
}

/**
 * Builds one BufferGeometry per chunk by concatenating the opaque and
 * transparent sections into shared attribute buffers, with two geometry
 * groups pointing at material indices [0] (opaque) and [1] (transparent).
 * Returns null when the chunk produced no geometry at all.
 */
export function createChunkGeometry(data: ChunkMeshData): THREE.BufferGeometry | null {
  const opaqueEmpty = isSectionEmpty(data.opaque);
  const transparentEmpty = isSectionEmpty(data.transparent);
  if (opaqueEmpty && transparentEmpty) {
    return null;
  }

  const { opaque, transparent } = data;
  const opaqueVertexCount = opaque.positions.length / POSITION_ITEM_SIZE;
  const f32 = (length: number): Float32Array => new Float32Array(length);

  const opaqueAtlasUv = applyAtlasUvs(opaque.uvs, opaque.tiles, voxelAtlasLayout);
  const transparentAtlasUv = applyAtlasUvs(transparent.uvs, transparent.tiles, voxelAtlasLayout);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(concatTyped(opaque.positions, transparent.positions, f32), POSITION_ITEM_SIZE),
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(
      concatTyped(opaque.normals, transparent.normals, (length) => new Int8Array(length)),
      NORMAL_ITEM_SIZE,
      NORMALIZED_NORMALS,
    ),
  );
  geometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(concatTyped(opaqueAtlasUv, transparentAtlasUv, f32), UV_ITEM_SIZE),
  );
  geometry.setAttribute(
    CHUNK_LIGHT_ATTRIBUTE,
    new THREE.BufferAttribute(
      concatTyped(opaque.light, transparent.light, (length) => new Uint8Array(length)),
      LIGHT_COMPONENTS,
      true,
    ),
  );
  geometry.setIndex(
    new THREE.BufferAttribute(concatIndices(opaque.indices, transparent.indices, opaqueVertexCount), 1),
  );

  const opaqueIndexCount = data.opaque.indices.length;
  const transparentIndexCount = data.transparent.indices.length;

  if (!opaqueEmpty) {
    geometry.addGroup(0, opaqueIndexCount, OPAQUE_MATERIAL_INDEX);
  }
  if (!transparentEmpty) {
    geometry.addGroup(opaqueIndexCount, transparentIndexCount, TRANSPARENT_MATERIAL_INDEX);
  }

  return geometry;
}

/**
 * Owns one THREE.Mesh per chunk column, keyed by chunk coordinate. Meshes
 * are positioned at the chunk's world origin (mesh data is chunk-local) and
 * share the module-level [opaque, transparent] materials via geometry groups.
 */
export class ChunkMeshRenderer implements ChunkMeshSink {
  private readonly scene: THREE.Scene;
  private readonly meshes = new Map<string, THREE.Mesh>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Creates or replaces the mesh for chunk (cx, cz); removes it entirely when data is empty. */
  upsert(cx: number, cz: number, data: ChunkMeshData): void {
    const key = chunkKey(cx, cz);
    const geometry = createChunkGeometry(data);

    const existing = this.meshes.get(key);
    if (existing !== undefined) {
      existing.geometry.dispose();
      this.scene.remove(existing);
      this.meshes.delete(key);
    }

    if (geometry === null) {
      return;
    }

    const mesh = new THREE.Mesh(geometry, chunkMaterials as THREE.Material[]);
    mesh.position.set(cx * WORLD_CONFIG.chunkWidth, 0, cz * WORLD_CONFIG.chunkDepth);
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
  }

  remove(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const existing = this.meshes.get(key);
    if (existing === undefined) {
      return;
    }
    existing.geometry.dispose();
    this.scene.remove(existing);
    this.meshes.delete(key);
  }

  /** Disposes every chunk mesh's geometry and removes it from the scene. Shared materials survive. */
  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      this.scene.remove(mesh);
    }
    this.meshes.clear();
  }
}
