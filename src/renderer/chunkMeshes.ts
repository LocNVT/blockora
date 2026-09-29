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
import type { ChunkMeshData, MeshSectionData } from '../world/mesher/MeshBuffers';
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

/**
 * Builds a BufferGeometry from one mesh section (opaque or transparent), or
 * null when the section has no faces.
 *
 * Each section gets its OWN geometry (and therefore its own mesh) instead of
 * one geometry with two material groups: three r186's WebGL backend caches
 * the bound VAO + index buffer between draws, but uploading any new index
 * buffer mid-frame unbinds the element buffer from the currently bound VAO.
 * Two consecutive draws of the same geometry (its two groups) then skip the
 * rebind and hit "glDrawElements: Must have element array buffer bound".
 * One draw per geometry can never repeat the cached (VAO, index) pair.
 */
export function createSectionGeometry(section: MeshSectionData): THREE.BufferGeometry | null {
  if (isSectionEmpty(section)) {
    return null;
  }
  const atlasUv = applyAtlasUvs(section.uvs, section.tiles, voxelAtlasLayout);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(section.positions, POSITION_ITEM_SIZE));
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(section.normals, NORMAL_ITEM_SIZE, NORMALIZED_NORMALS),
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(atlasUv, UV_ITEM_SIZE));
  geometry.setAttribute(
    CHUNK_LIGHT_ATTRIBUTE,
    new THREE.BufferAttribute(section.light, LIGHT_COMPONENTS, true),
  );
  geometry.setIndex(new THREE.BufferAttribute(section.indices, 1));
  return geometry;
}

/** Per-section geometries of one chunk; a section with no faces is null (never an empty geometry). */
export interface ChunkGeometries {
  readonly opaque: THREE.BufferGeometry | null;
  readonly transparent: THREE.BufferGeometry | null;
}

/** Builds the opaque and transparent geometries of a chunk (either may be null). */
export function createChunkGeometries(data: ChunkMeshData): ChunkGeometries {
  return {
    opaque: createSectionGeometry(data.opaque),
    transparent: createSectionGeometry(data.transparent),
  };
}

/**
 * Owns up to two THREE.Mesh per chunk column (opaque + transparent, each with
 * its own geometry), keyed by chunk coordinate. Meshes are positioned at the
 * chunk's world origin (mesh data is chunk-local) and use the shared
 * module-level materials.
 */
export class ChunkMeshRenderer implements ChunkMeshSink {
  private readonly scene: THREE.Scene;
  private readonly meshes = new Map<string, THREE.Mesh[]>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Creates or replaces the meshes for chunk (cx, cz); removes them entirely when data is empty. */
  upsert(cx: number, cz: number, data: ChunkMeshData): void {
    const key = chunkKey(cx, cz);
    const { opaque, transparent } = createChunkGeometries(data);
    this.remove(cx, cz);

    const created: THREE.Mesh[] = [];
    if (opaque !== null) {
      created.push(this.createMesh(cx, cz, opaque, chunkOpaqueMaterial));
    }
    if (transparent !== null) {
      created.push(this.createMesh(cx, cz, transparent, chunkTransparentMaterial));
    }
    if (created.length > 0) {
      this.meshes.set(key, created);
    }
  }

  private createMesh(cx: number, cz: number, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx * WORLD_CONFIG.chunkWidth, 0, cz * WORLD_CONFIG.chunkDepth);
    this.scene.add(mesh);
    return mesh;
  }

  remove(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const existing = this.meshes.get(key);
    if (existing === undefined) {
      return;
    }
    this.disposeMeshes(existing);
    this.meshes.delete(key);
  }

  /** Disposes every chunk mesh's geometry and removes it from the scene. Shared materials survive. */
  dispose(): void {
    for (const meshes of this.meshes.values()) {
      this.disposeMeshes(meshes);
    }
    this.meshes.clear();
  }

  private disposeMeshes(meshes: readonly THREE.Mesh[]): void {
    for (const mesh of meshes) {
      this.scene.remove(mesh);
      // Object3D 'dispose' makes the renderer drop its per-mesh RenderObject.
      // Without it three r186 keeps every removed chunk mesh (geometry,
      // attribute arrays, pipeline/bindings) alive in RenderObjects forever.
      mesh.dispose();
      mesh.geometry.dispose();
    }
  }
}
