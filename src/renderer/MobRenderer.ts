import * as THREE from 'three';
import type { ChunkStore } from '../world/ChunkStore';
import { getLightAt } from '../world/light/LightSampler';
import { skyLightOf, blockLightOf } from '../world/light/lightNibbles';
import { effectiveLightLevel, lightCurve } from './lightShading';
import { getChunkDaylight } from './chunkMeshes';
import type { MobEntity } from '../entities/EntityStore';
import { MobType } from '../entities/mobDefinitions';

const INITIAL_INSTANCE_CAPACITY = 8;
const INSTANCE_GROWTH_FACTOR = 2;

/** Original, simple procedural pig palette (no image assets) — base color multiplied by per-instance voxel-light brightness. */
const PIG_BODY_COLOR = new THREE.Color(0xe8a6b0);
const PIG_SNOUT_COLOR = new THREE.Color(0xd68a96);
const PIG_LEG_COLOR = new THREE.Color(0xd08c98);

/** Tint multiplied into a mob's part colors while `hurtFlashTimer > 0` (see `MobEntity`). */
const HURT_FLASH_TINT = new THREE.Color(0xff3333);

/** Box half-extents (blocks) for each pig body part, an original blocky low-poly look. */
const PIG_BODY_SIZE = { x: 0.5, y: 0.45, z: 0.75 };
const PIG_HEAD_SIZE = { x: 0.4, y: 0.4, z: 0.4 };
const PIG_SNOUT_SIZE = { x: 0.2, y: 0.15, z: 0.12 };
const PIG_LEG_SIZE = { x: 0.15, y: 0.4, z: 0.15 };

/** Local offsets (blocks) from the mob's feet-position origin, before yaw rotation. */
const PIG_BODY_OFFSET = { x: 0, y: 0.45 + PIG_BODY_SIZE.y / 2, z: 0 };
const PIG_HEAD_OFFSET = { x: 0, y: 0.45 + PIG_BODY_SIZE.y - PIG_HEAD_SIZE.y / 2 + 0.05, z: -(PIG_BODY_SIZE.z / 2 + PIG_HEAD_SIZE.z / 2 - 0.05) };
const PIG_SNOUT_OFFSET = {
  x: 0,
  y: PIG_HEAD_OFFSET.y - 0.05,
  z: PIG_HEAD_OFFSET.z - (PIG_HEAD_SIZE.z / 2 + PIG_SNOUT_SIZE.z / 2 - 0.02),
};
const LEG_Y = PIG_LEG_SIZE.y / 2;
const LEG_X = PIG_BODY_SIZE.x / 2 - PIG_LEG_SIZE.x / 2 + 0.02;
const LEG_Z_FRONT = PIG_BODY_SIZE.z / 2 - PIG_LEG_SIZE.z / 2 - 0.05;
const LEG_Z_BACK = -(PIG_BODY_SIZE.z / 2 - PIG_LEG_SIZE.z / 2 - 0.05);

/** The 4 leg attachment points, front-left/front-right/back-left/back-right, before yaw rotation and swing. */
const LEG_OFFSETS: readonly { x: number; y: number; z: number; phaseSign: number }[] = [
  { x: -LEG_X, y: LEG_Y, z: LEG_Z_FRONT, phaseSign: 1 },
  { x: LEG_X, y: LEG_Y, z: LEG_Z_FRONT, phaseSign: -1 },
  { x: -LEG_X, y: LEG_Y, z: LEG_Z_BACK, phaseSign: -1 },
  { x: LEG_X, y: LEG_Y, z: LEG_Z_BACK, phaseSign: 1 },
];

/** Max swing angle (radians) legs rotate through while walking. */
const LEG_SWING_AMPLITUDE = 0.5;
/** Swing cycles per block walked. */
const LEG_SWING_FREQUENCY = 2.5;

type PartKey = 'body' | 'head' | 'snout' | 'leg';

interface PartBucket {
  mesh: THREE.InstancedMesh;
  capacity: number;
}

function createBoxGeometry(size: { x: number; y: number; z: number }): THREE.BoxGeometry {
  return new THREE.BoxGeometry(size.x, size.y, size.z);
}

const dummyMatrix = new THREE.Matrix4();
const dummyPosition = new THREE.Vector3();
const dummyQuaternion = new THREE.Quaternion();
const dummyEuler = new THREE.Euler();
const dummyScale = new THREE.Vector3(1, 1, 1);
const dummyColor = new THREE.Color();
const worldOffset = new THREE.Vector3();

/**
 * Renders every live mob as a small set of blocky boxes (body, head, snout,
 * 4 legs), each part type sharing ONE InstancedMesh across every mob of
 * every type — so draw calls stay fixed (4: body/head/snout/leg) regardless
 * of how many mobs are alive. Legs swing per-instance from a phase derived
 * from the mob's id and distance walked; per-instance color bakes in voxel
 * light (getLightAt) and daylight, matching chunk brightness. No per-mob
 * Mesh or Material is ever created.
 */
export class MobRenderer {
  private readonly scene: THREE.Scene;
  private readonly store: ChunkStore;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometryByPart: Record<PartKey, THREE.BoxGeometry>;
  private readonly bucketByPart = new Map<PartKey, PartBucket>();
  /** Per-mob accumulated horizontal distance walked, for leg swing phase (keyed by mob id). */
  private readonly walkedDistanceById = new Map<number, number>();

  constructor(scene: THREE.Scene, store: ChunkStore) {
    this.scene = scene;
    this.store = store;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true });
    this.geometryByPart = {
      body: createBoxGeometry(PIG_BODY_SIZE),
      head: createBoxGeometry(PIG_HEAD_SIZE),
      snout: createBoxGeometry(PIG_SNOUT_SIZE),
      leg: createBoxGeometry(PIG_LEG_SIZE),
    };
  }

  private bucketForPart(part: PartKey): PartBucket {
    const existing = this.bucketByPart.get(part);
    if (existing !== undefined) {
      return existing;
    }
    const mesh = new THREE.InstancedMesh(this.geometryByPart[part], this.material, INITIAL_INSTANCE_CAPACITY);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const bucket: PartBucket = { mesh, capacity: INITIAL_INSTANCE_CAPACITY };
    this.bucketByPart.set(part, bucket);
    return bucket;
  }

  private growBucket(part: PartKey, bucket: PartBucket, minCapacity: number): PartBucket {
    let newCapacity = bucket.capacity;
    while (newCapacity < minCapacity) {
      newCapacity *= INSTANCE_GROWTH_FACTOR;
    }
    const newMesh = new THREE.InstancedMesh(this.geometryByPart[part], this.material, newCapacity);
    newMesh.frustumCulled = false;
    newMesh.count = 0;
    this.scene.remove(bucket.mesh);
    bucket.mesh.dispose();
    this.scene.add(newMesh);
    const grown: PartBucket = { mesh: newMesh, capacity: newCapacity };
    this.bucketByPart.set(part, grown);
    return grown;
  }

  /** Brightness (0..1) at a mob's position: same voxel-light + daylight curve chunk meshes use. */
  private brightnessAt(x: number, y: number, z: number): number {
    const packed = getLightAt(this.store, x, y, z);
    const level = effectiveLightLevel(skyLightOf(packed), blockLightOf(packed), getChunkDaylight());
    return lightCurve(level);
  }

  /** `base` scaled by voxel-light `brightness`, further tinted red while `hurt` (hurtFlashTimer > 0). Writes into `dummyColor`. */
  private shadeInto(base: THREE.Color, brightness: number, hurt: boolean): THREE.Color {
    dummyColor.copy(base).multiplyScalar(brightness);
    if (hurt) {
      dummyColor.multiply(HURT_FLASH_TINT);
    }
    return dummyColor;
  }

  /**
   * Rebuilds every instanced mesh's transforms/colors from the current mob
   * list. Only Pig is implemented (Phase 5 first slice); other mob types are
   * skipped (rendered as nothing) rather than throwing, so future mob types
   * can be added to mobDefinitions without breaking rendering immediately.
   */
  update(mobs: readonly MobEntity[], dt: number): void {
    const frameDt = Math.max(0, dt);
    const pigs = mobs.filter((mob) => mob.type === MobType.Pig);

    let bodyBucket = this.bucketForPart('body');
    let headBucket = this.bucketForPart('head');
    let snoutBucket = this.bucketForPart('snout');
    let legBucket = this.bucketForPart('leg');

    if (pigs.length > bodyBucket.capacity) bodyBucket = this.growBucket('body', bodyBucket, pigs.length);
    if (pigs.length > headBucket.capacity) headBucket = this.growBucket('head', headBucket, pigs.length);
    if (pigs.length > snoutBucket.capacity) snoutBucket = this.growBucket('snout', snoutBucket, pigs.length);
    const legCapacityNeeded = pigs.length * LEG_OFFSETS.length;
    if (legCapacityNeeded > legBucket.capacity) legBucket = this.growBucket('leg', legBucket, legCapacityNeeded);

    const liveIds = new Set<number>();

    for (let i = 0; i < pigs.length; i += 1) {
      const pig = pigs[i];
      if (pig === undefined) {
        continue;
      }
      liveIds.add(pig.id);

      const speed = Math.hypot(pig.velocity.x, pig.velocity.z);
      const previousDistance = this.walkedDistanceById.get(pig.id) ?? 0;
      const distance = previousDistance + speed * frameDt;
      this.walkedDistanceById.set(pig.id, distance);

      const brightness = this.brightnessAt(pig.position.x, pig.position.y + PIG_BODY_OFFSET.y, pig.position.z);
      const hurt = pig.hurtFlashTimer > 0;

      const cosYaw = Math.cos(pig.yaw);
      const sinYaw = Math.sin(pig.yaw);
      const rotateAndPlace = (localX: number, localY: number, localZ: number): void => {
        worldOffset.set(cosYaw * localX + sinYaw * localZ, localY, -sinYaw * localX + cosYaw * localZ);
      };

      dummyEuler.set(0, pig.yaw, 0);
      dummyQuaternion.setFromEuler(dummyEuler);

      rotateAndPlace(PIG_BODY_OFFSET.x, PIG_BODY_OFFSET.y, PIG_BODY_OFFSET.z);
      dummyPosition.set(pig.position.x + worldOffset.x, pig.position.y + worldOffset.y, pig.position.z + worldOffset.z);
      dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);
      bodyBucket.mesh.setMatrixAt(i, dummyMatrix);
      bodyBucket.mesh.setColorAt(i, this.shadeInto(PIG_BODY_COLOR, brightness, hurt));

      rotateAndPlace(PIG_HEAD_OFFSET.x, PIG_HEAD_OFFSET.y, PIG_HEAD_OFFSET.z);
      dummyPosition.set(pig.position.x + worldOffset.x, pig.position.y + worldOffset.y, pig.position.z + worldOffset.z);
      dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);
      headBucket.mesh.setMatrixAt(i, dummyMatrix);
      headBucket.mesh.setColorAt(i, this.shadeInto(PIG_BODY_COLOR, brightness, hurt));

      rotateAndPlace(PIG_SNOUT_OFFSET.x, PIG_SNOUT_OFFSET.y, PIG_SNOUT_OFFSET.z);
      dummyPosition.set(pig.position.x + worldOffset.x, pig.position.y + worldOffset.y, pig.position.z + worldOffset.z);
      dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);
      snoutBucket.mesh.setMatrixAt(i, dummyMatrix);
      snoutBucket.mesh.setColorAt(i, this.shadeInto(PIG_SNOUT_COLOR, brightness, hurt));

      for (let legIndex = 0; legIndex < LEG_OFFSETS.length; legIndex += 1) {
        const leg = LEG_OFFSETS[legIndex];
        if (leg === undefined) {
          continue;
        }
        const phase = distance * LEG_SWING_FREQUENCY * Math.PI * 2 + pig.id;
        const swing = Math.sin(phase) * leg.phaseSign * LEG_SWING_AMPLITUDE * Math.min(1, speed);

        dummyEuler.set(swing, pig.yaw, 0);
        dummyQuaternion.setFromEuler(dummyEuler);
        rotateAndPlace(leg.x, leg.y, leg.z);
        dummyPosition.set(pig.position.x + worldOffset.x, pig.position.y + worldOffset.y, pig.position.z + worldOffset.z);
        dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);

        const legInstanceIndex = i * LEG_OFFSETS.length + legIndex;
        legBucket.mesh.setMatrixAt(legInstanceIndex, dummyMatrix);
        legBucket.mesh.setColorAt(legInstanceIndex, this.shadeInto(PIG_LEG_COLOR, brightness, hurt));
      }
    }

    bodyBucket.mesh.count = pigs.length;
    headBucket.mesh.count = pigs.length;
    snoutBucket.mesh.count = pigs.length;
    legBucket.mesh.count = pigs.length * LEG_OFFSETS.length;

    for (const bucket of [bodyBucket, headBucket, snoutBucket, legBucket]) {
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (bucket.mesh.instanceColor !== null) {
        bucket.mesh.instanceColor.needsUpdate = true;
      }
    }

    // Drop walked-distance tracking for mobs that no longer exist.
    for (const id of this.walkedDistanceById.keys()) {
      if (!liveIds.has(id)) {
        this.walkedDistanceById.delete(id);
      }
    }
  }

  dispose(): void {
    for (const bucket of this.bucketByPart.values()) {
      this.scene.remove(bucket.mesh);
      bucket.mesh.dispose();
    }
    this.bucketByPart.clear();
    for (const geometry of Object.values(this.geometryByPart)) {
      geometry.dispose();
    }
    this.material.dispose();
    this.walkedDistanceById.clear();
  }
}
