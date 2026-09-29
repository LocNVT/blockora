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

/** Original green-grey shambler palette (procedural, no image assets). */
const SHAMBLER_SKIN_COLOR = new THREE.Color(0x6f8f6a);
const SHAMBLER_TORSO_COLOR = new THREE.Color(0x3f5f66);
const SHAMBLER_LEG_COLOR = new THREE.Color(0x484a63);

/** Shambler part boxes (blocks): 0.75 legs + 0.7 torso + 0.35 head = 1.8 tall. */
const SHAMBLER_LEG_SIZE = { x: 0.25, y: 0.75, z: 0.25 };
const SHAMBLER_TORSO_SIZE = { x: 0.55, y: 0.7, z: 0.3 };
const SHAMBLER_HEAD_SIZE = { x: 0.35, y: 0.35, z: 0.35 };
const SHAMBLER_ARM_SIZE = { x: 0.2, y: 0.7, z: 0.2 };
const SHAMBLER_HIP_Y = SHAMBLER_LEG_SIZE.y;
const SHAMBLER_LEG_X = 0.14;
const SHAMBLER_TORSO_Y = SHAMBLER_HIP_Y + SHAMBLER_TORSO_SIZE.y / 2;
const SHAMBLER_HEAD_Y = SHAMBLER_HIP_Y + SHAMBLER_TORSO_SIZE.y + SHAMBLER_HEAD_SIZE.y / 2;
const SHAMBLER_SHOULDER_Y = SHAMBLER_HIP_Y + SHAMBLER_TORSO_SIZE.y - 0.1;
const SHAMBLER_SHOULDER_X = SHAMBLER_TORSO_SIZE.x / 2 + SHAMBLER_ARM_SIZE.x / 2;
/** Arms are held straight forward (pitch +90 degrees about the shoulder) with a small sway. */
const SHAMBLER_ARM_FORWARD_PITCH = Math.PI / 2;
const SHAMBLER_ARM_SWAY = 0.2;
const SHAMBLER_LEG_SWING = 0.6;
const SHAMBLER_SWING_FREQUENCY = 1.6;

type PartKey = 'body' | 'head' | 'snout' | 'leg' | 'sTorso' | 'sHead' | 'sArm' | 'sLeg';

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
      sTorso: createBoxGeometry(SHAMBLER_TORSO_SIZE),
      sHead: createBoxGeometry(SHAMBLER_HEAD_SIZE),
      sArm: createBoxGeometry(SHAMBLER_ARM_SIZE),
      sLeg: createBoxGeometry(SHAMBLER_LEG_SIZE),
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
   * list. Pig and Shambler are implemented; any other mob type renders as
   * nothing rather than throwing.
   */
  update(mobs: readonly MobEntity[], dt: number): void {
    const frameDt = Math.max(0, dt);
    const pigs = mobs.filter((mob) => mob.type === MobType.Pig);
    const shamblers = mobs.filter((mob) => mob.type === MobType.Shambler);

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

    this.updateShamblers(shamblers, frameDt, liveIds);

    // Drop walked-distance tracking for mobs that no longer exist.
    for (const id of this.walkedDistanceById.keys()) {
      if (!liveIds.has(id)) {
        this.walkedDistanceById.delete(id);
      }
    }
  }

  /** Grows `part`'s bucket if needed and returns it (with count reset to `needed`). */
  private readyBucket(part: PartKey, needed: number): PartBucket {
    let bucket = this.bucketForPart(part);
    if (needed > bucket.capacity) {
      bucket = this.growBucket(part, bucket, needed);
    }
    bucket.mesh.count = needed;
    return bucket;
  }

  /**
   * Shambler model: torso, head, 2 forward-held arms, 2 legs; one shared
   * InstancedMesh per part type (4 draw calls total for every shambler).
   * Arms sway and legs swing with distance walked.
   */
  private updateShamblers(shamblers: readonly MobEntity[], frameDt: number, liveIds: Set<number>): void {
    const torsoBucket = this.readyBucket('sTorso', shamblers.length);
    const headBucket = this.readyBucket('sHead', shamblers.length);
    const armBucket = this.readyBucket('sArm', shamblers.length * 2);
    const legBucket = this.readyBucket('sLeg', shamblers.length * 2);

    for (let i = 0; i < shamblers.length; i += 1) {
      const mob = shamblers[i];
      if (mob === undefined) {
        continue;
      }
      liveIds.add(mob.id);

      const speed = Math.hypot(mob.velocity.x, mob.velocity.z);
      const distance = (this.walkedDistanceById.get(mob.id) ?? 0) + speed * frameDt;
      this.walkedDistanceById.set(mob.id, distance);

      const brightness = this.brightnessAt(mob.position.x, mob.position.y + SHAMBLER_TORSO_Y, mob.position.z);
      const hurt = mob.hurtFlashTimer > 0;
      const cosYaw = Math.cos(mob.yaw);
      const sinYaw = Math.sin(mob.yaw);
      const place = (lx: number, ly: number, lz: number, pitch: number): void => {
        dummyEuler.set(pitch, mob.yaw, 0, 'YXZ');
        dummyQuaternion.setFromEuler(dummyEuler);
        dummyPosition.set(
          mob.position.x + cosYaw * lx + sinYaw * lz,
          mob.position.y + ly,
          mob.position.z - sinYaw * lx + cosYaw * lz,
        );
        dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);
      };

      place(0, SHAMBLER_TORSO_Y, 0, 0);
      torsoBucket.mesh.setMatrixAt(i, dummyMatrix);
      torsoBucket.mesh.setColorAt(i, this.shadeInto(SHAMBLER_TORSO_COLOR, brightness, hurt));

      place(0, SHAMBLER_HEAD_Y, 0, 0);
      headBucket.mesh.setMatrixAt(i, dummyMatrix);
      headBucket.mesh.setColorAt(i, this.shadeInto(SHAMBLER_SKIN_COLOR, brightness, hurt));

      const phase = distance * SHAMBLER_SWING_FREQUENCY * Math.PI * 2 + mob.id;
      const moveScale = Math.min(1, speed);
      for (let side = 0; side < 2; side += 1) {
        const sign = side === 0 ? -1 : 1;
        // Limb pivots at its top; centre sits half a limb length along the rotated -Y axis.
        const armPitch = SHAMBLER_ARM_FORWARD_PITCH + Math.sin(phase * 0.5 + side * Math.PI) * SHAMBLER_ARM_SWAY;
        const armHalf = SHAMBLER_ARM_SIZE.y / 2;
        place(
          sign * SHAMBLER_SHOULDER_X,
          SHAMBLER_SHOULDER_Y - armHalf * Math.cos(armPitch),
          -armHalf * Math.sin(armPitch),
          armPitch,
        );
        armBucket.mesh.setMatrixAt(i * 2 + side, dummyMatrix);
        armBucket.mesh.setColorAt(i * 2 + side, this.shadeInto(SHAMBLER_SKIN_COLOR, brightness, hurt));

        const legPitch = Math.sin(phase + side * Math.PI) * SHAMBLER_LEG_SWING * moveScale;
        const legHalf = SHAMBLER_LEG_SIZE.y / 2;
        place(
          sign * SHAMBLER_LEG_X,
          SHAMBLER_HIP_Y - legHalf * Math.cos(legPitch),
          -legHalf * Math.sin(legPitch),
          legPitch,
        );
        legBucket.mesh.setMatrixAt(i * 2 + side, dummyMatrix);
        legBucket.mesh.setColorAt(i * 2 + side, this.shadeInto(SHAMBLER_LEG_COLOR, brightness, hurt));
      }
    }

    for (const bucket of [torsoBucket, headBucket, armBucket, legBucket]) {
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (bucket.mesh.instanceColor !== null) {
        bucket.mesh.instanceColor.needsUpdate = true;
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
