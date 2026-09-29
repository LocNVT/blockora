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
import { MAX_LIGHT } from '../world/light/lightNibbles';
import {
  RENDER_CONFIG,
  WORLD_CONFIG,
  ATLAS_CONFIG,
  LIGHT_RENDER_CONFIG,
  CHUNK_GEOMETRY_POOL_CONFIG,
} from '../config/constants';
import { clampDaylight } from './lightShading';
import { chunkKey } from '../world/chunkCoords';
import { createAtlasLayout, type AtlasLayout } from '../world/texture/atlasLayout';
import { generateAtlasPixels } from '../world/texture/tileArt';
import { TILE_NAMES } from '../world/texture/tiles';
import { createVoxelAtlasTexture } from './voxelAtlasTexture';
import { CHUNK_LIGHT_ATTRIBUTE, ChunkGeometryPool } from './ChunkGeometryPool';

export { CHUNK_LIGHT_ATTRIBUTE } from './ChunkGeometryPool';

/** Shared atlas layout + texture, built once from the data-driven tile list. */
export const voxelAtlasLayout: AtlasLayout = createAtlasLayout(TILE_NAMES.length);
/** Shared atlas RGBA pixels backing `voxelAtlasTexture`; reused by UI (e.g. HotbarHud icons) to avoid regenerating them. */
export const voxelAtlasPixels = generateAtlasPixels(voxelAtlasLayout, TILE_NAMES, ATLAS_CONFIG.seed);
export const voxelAtlasTexture = createVoxelAtlasTexture(voxelAtlasLayout, voxelAtlasPixels);

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

/** A pool with the shared atlas layout and CHUNK_GEOMETRY_POOL_CONFIG capacities. */
export function createChunkGeometryPool(): ChunkGeometryPool {
  return new ChunkGeometryPool({ atlasLayout: voxelAtlasLayout, ...CHUNK_GEOMETRY_POOL_CONFIG });
}

/**
 * Owns up to two THREE.Mesh per chunk column (opaque + transparent), keyed by
 * chunk coordinate. Each non-empty section gets its OWN geometry and mesh — no
 * material groups: three r186's WebGL backend caches the bound VAO + index
 * buffer between draws, and two consecutive draws of one geometry (two groups)
 * around an index-buffer upload hit "glDrawElements: Must have element array
 * buffer bound". Meshes sit at the chunk's world origin (mesh data is
 * chunk-local) and use the shared module-level materials.
 *
 * Geometries come from a ChunkGeometryPool and go back to it on remove /
 * replace (never disposed here): on the WebGL2 fallback every disposed
 * geometry would leak a VAO (see ChunkGeometryPool). Meshes ARE disposed, so
 * the renderer still drops their RenderObjects. The pool is owned by this
 * renderer and disposed by `dispose()`.
 */
export class ChunkMeshRenderer implements ChunkMeshSink {
  private readonly scene: THREE.Scene;
  private readonly pool: ChunkGeometryPool;
  private readonly meshes = new Map<string, THREE.Mesh[]>();

  constructor(scene: THREE.Scene, pool: ChunkGeometryPool = createChunkGeometryPool()) {
    this.scene = scene;
    this.pool = pool;
  }

  /** Creates or replaces the meshes for chunk (cx, cz); removes them entirely when data is empty. */
  upsert(cx: number, cz: number, data: ChunkMeshData): void {
    // Release first so a remesh can reuse the chunk's own geometries.
    this.remove(cx, cz);

    const created: THREE.Mesh[] = [];
    if (!isSectionEmpty(data.opaque)) {
      created.push(this.createMesh(cx, cz, this.pool.acquire(data.opaque), chunkOpaqueMaterial));
    }
    if (!isSectionEmpty(data.transparent)) {
      created.push(this.createMesh(cx, cz, this.pool.acquire(data.transparent), chunkTransparentMaterial));
    }
    if (created.length > 0) {
      this.meshes.set(chunkKey(cx, cz), created);
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
    this.releaseMeshes(existing);
    this.meshes.delete(key);
  }

  /** Removes every chunk mesh and disposes the pool (all its geometries). Shared materials survive. */
  dispose(): void {
    for (const meshes of this.meshes.values()) {
      this.releaseMeshes(meshes);
    }
    this.meshes.clear();
    this.pool.dispose();
  }

  private releaseMeshes(meshes: readonly THREE.Mesh[]): void {
    for (const mesh of meshes) {
      this.scene.remove(mesh);
      // Object3D 'dispose' makes the renderer drop its per-mesh RenderObject.
      // Without it three r186 keeps every removed chunk mesh (geometry,
      // attribute arrays, pipeline/bindings) alive in RenderObjects forever.
      mesh.dispose();
      this.pool.release(mesh.geometry);
    }
  }
}
