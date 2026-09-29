import * as THREE from 'three';
import { FACES, type FaceDirection } from '../world/mesher/faces';
import { resolveFaceTile } from '../world/texture/blockFaceTiles';
import { mapToAtlasUv } from '../world/texture/atlasLayout';
import { tileIndex } from '../world/texture/tiles';
import type { BlockRegistry } from '../world/BlockRegistry';
import type { ItemRegistry } from '../items/ItemRegistry';
import type { ItemDrop } from '../items/ItemDrops';
import { ITEM_DROP_CONFIG, RENDER_CONFIG } from '../config/constants';
import { voxelAtlasLayout, voxelAtlasTexture } from './chunkMeshes';

const FACE_COUNT = 6;
const VERTS_PER_QUAD = 4;
const POSITION_COMPONENTS = 3;
const UV_COMPONENTS = 2;
const INITIAL_INSTANCE_CAPACITY = 16;
const INSTANCE_GROWTH_FACTOR = 2;

/**
 * Shared material for every item-drop instanced mesh: same atlas texture as
 * chunk meshes. Still lit by the scene lights (DayNightLighting), not by baked
 * voxel light, so drops in dark caves stay bright (known limitation).
 */
function createDropMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: voxelAtlasTexture,
    alphaTest: RENDER_CONFIG.chunkAlphaTest,
    transparent: false,
  });
}

/** Builds a small cube BufferGeometry (size = 2*halfSize) with per-face UVs mapped into the atlas. */
function buildCubeGeometry(
  halfSize: number,
  tileForFace: (face: FaceDirection) => number,
): THREE.BufferGeometry {
  const positions = new Float32Array(FACE_COUNT * VERTS_PER_QUAD * POSITION_COMPONENTS);
  const normals = new Float32Array(FACE_COUNT * VERTS_PER_QUAD * POSITION_COMPONENTS);
  const uvs = new Float32Array(FACE_COUNT * VERTS_PER_QUAD * UV_COMPONENTS);
  const indices = new Uint16Array(FACE_COUNT * 6);

  const size = halfSize * 2;

  for (let face = 0; face < FACE_COUNT; face += 1) {
    const descriptor = FACES[face];
    if (descriptor === undefined) {
      continue;
    }
    const tile = tileForFace(face as FaceDirection);
    const [nx, ny, nz] = descriptor.normal;
    const vertexBase = face * VERTS_PER_QUAD;

    for (let i = 0; i < VERTS_PER_QUAD; i += 1) {
      const corner = descriptor.corners[i];
      if (corner === undefined) {
        continue;
      }
      const pi = (vertexBase + i) * POSITION_COMPONENTS;
      // Corners are unit-cube-relative (0/1); center the cube on the origin.
      positions[pi] = (corner.x - 0.5) * size;
      positions[pi + 1] = (corner.y - 0.5) * size;
      positions[pi + 2] = (corner.z - 0.5) * size;

      normals[pi] = nx;
      normals[pi + 1] = ny;
      normals[pi + 2] = nz;

      // The face's in-plane axes (widthAxis/heightAxis) tell us which unit
      // corner components (0/1) to use as local u/v — mirrors how the chunk
      // mesher derives local UV from the same FaceDescriptor corners.
      const localU = cornerAxisValue(corner, descriptor.widthAxis);
      const localV = cornerAxisValue(corner, descriptor.heightAxis);
      const [mu, mv] = mapToAtlasUv(localU, localV, tile, voxelAtlasLayout);
      const uvi = (vertexBase + i) * UV_COMPONENTS;
      uvs[uvi] = mu;
      uvs[uvi + 1] = mv;
    }

    const indexBase = face * 6;
    indices[indexBase] = vertexBase;
    indices[indexBase + 1] = vertexBase + 1;
    indices[indexBase + 2] = vertexBase + 2;
    indices[indexBase + 3] = vertexBase;
    indices[indexBase + 4] = vertexBase + 2;
    indices[indexBase + 5] = vertexBase + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, POSITION_COMPONENTS));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, POSITION_COMPONENTS));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, UV_COMPONENTS));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function cornerAxisValue(corner: { x: number; y: number; z: number }, axis: 'x' | 'y' | 'z'): number {
  return corner[axis];
}

/** Per item-type instanced-mesh bucket: geometry cached, capacity grows x2, count set per frame. */
interface DropBucket {
  mesh: THREE.InstancedMesh;
  capacity: number;
}

const dummyMatrix = new THREE.Matrix4();
const dummyPosition = new THREE.Vector3();
const dummyQuaternion = new THREE.Quaternion();
const dummyScale = new THREE.Vector3(1, 1, 1);
const dummyEuler = new THREE.Euler();

/**
 * Renders every live item drop as one InstancedMesh per distinct item type
 * currently present (created lazily, capacity doubles on overflow, geometry
 * cached per item id), all sharing one material bound to the existing voxel
 * atlas texture. No per-drop Mesh/material is ever created.
 */
export class ItemDropRenderer {
  private readonly scene: THREE.Scene;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometryByItem = new Map<number, THREE.BufferGeometry>();
  private readonly bucketByItem = new Map<number, DropBucket>();

  constructor(
    scene: THREE.Scene,
    private readonly itemRegistry: ItemRegistry,
    private readonly blockRegistry: BlockRegistry,
  ) {
    this.scene = scene;
    this.material = createDropMaterial();
  }

  private geometryForItem(itemId: number): THREE.BufferGeometry {
    const cached = this.geometryByItem.get(itemId);
    if (cached !== undefined) {
      return cached;
    }

    const def = this.itemRegistry.get(itemId);
    const halfSize = ITEM_DROP_CONFIG.halfSize;

    let tileForFace: (face: FaceDirection) => number;
    if (def.icon !== undefined) {
      const tile = tileIndex(def.icon);
      tileForFace = () => tile;
    } else {
      const blockId = this.itemRegistry.blockForItem(itemId);
      if (blockId === undefined) {
        // No icon and no block: fall back to tile 0 rather than throwing in
        // a render path (shouldn't happen — every item has an icon or a block).
        tileForFace = () => 0;
      } else {
        const blockDef = this.blockRegistry.get(blockId);
        const texture = blockDef.texture;
        tileForFace = (face) => (texture === null ? 0 : tileIndex(resolveFaceTile(texture, face)));
      }
    }

    const geometry = buildCubeGeometry(halfSize, tileForFace);
    this.geometryByItem.set(itemId, geometry);
    return geometry;
  }

  private bucketForItem(itemId: number): DropBucket {
    const existing = this.bucketByItem.get(itemId);
    if (existing !== undefined) {
      return existing;
    }

    const geometry = this.geometryForItem(itemId);
    const capacity = INITIAL_INSTANCE_CAPACITY;
    const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    const bucket: DropBucket = { mesh, capacity };
    this.bucketByItem.set(itemId, bucket);
    return bucket;
  }

  private growBucket(itemId: number, bucket: DropBucket, minCapacity: number): DropBucket {
    let newCapacity = bucket.capacity;
    while (newCapacity < minCapacity) {
      newCapacity *= INSTANCE_GROWTH_FACTOR;
    }

    const geometry = this.geometryForItem(itemId);
    const newMesh = new THREE.InstancedMesh(geometry, this.material, newCapacity);
    newMesh.frustumCulled = false;
    newMesh.count = 0;

    this.scene.remove(bucket.mesh);
    bucket.mesh.dispose();
    this.scene.add(newMesh);

    const grown: DropBucket = { mesh: newMesh, capacity: newCapacity };
    this.bucketByItem.set(itemId, grown);
    return grown;
  }

  /**
   * Rebuilds every instanced mesh's transforms from the current drop list.
   * Groups drops by item type, growing/hiding bucket capacity as needed; a
   * slow spin + small vertical bob (deterministic from each drop's id + age)
   * is applied so resting drops read as "alive" without any per-drop object.
   */
  update(drops: readonly ItemDrop[]): void {
    const byItem = new Map<number, ItemDrop[]>();
    for (const drop of drops) {
      const list = byItem.get(drop.stack.itemId);
      if (list === undefined) {
        byItem.set(drop.stack.itemId, [drop]);
      } else {
        list.push(drop);
      }
    }

    for (const [itemId, list] of byItem) {
      let bucket = this.bucketByItem.get(itemId) ?? this.bucketForItem(itemId);
      if (list.length > bucket.capacity) {
        bucket = this.growBucket(itemId, bucket, list.length);
      }

      for (let i = 0; i < list.length; i += 1) {
        const drop = list[i];
        if (drop === undefined) {
          continue;
        }
        const spin = drop.id * 0.6180339887 + drop.age * ITEM_DROP_CONFIG.spinSpeed;
        const bob = Math.sin(drop.age * ITEM_DROP_CONFIG.bobSpeed + drop.id) * ITEM_DROP_CONFIG.bobAmplitude;

        dummyPosition.set(drop.position.x, drop.position.y + bob, drop.position.z);
        dummyEuler.set(0, spin, 0);
        dummyQuaternion.setFromEuler(dummyEuler);
        dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);
        bucket.mesh.setMatrixAt(i, dummyMatrix);
      }

      bucket.mesh.count = list.length;
      bucket.mesh.instanceMatrix.needsUpdate = true;
    }

    // Hide buckets for item types that no longer have any live drops.
    for (const [itemId, bucket] of this.bucketByItem) {
      if (!byItem.has(itemId)) {
        bucket.mesh.count = 0;
      }
    }
  }

  dispose(): void {
    for (const bucket of this.bucketByItem.values()) {
      this.scene.remove(bucket.mesh);
      bucket.mesh.dispose();
    }
    this.bucketByItem.clear();
    for (const geometry of this.geometryByItem.values()) {
      geometry.dispose();
    }
    this.geometryByItem.clear();
    this.material.dispose();
  }
}
