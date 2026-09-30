import * as THREE from 'three';
import type { ChunkStore } from '../world/ChunkStore';
import { getLightAt } from '../world/light/LightSampler';
import { skyLightOf, blockLightOf } from '../world/light/lightNibbles';
import { effectiveLightLevel, faceShade, lightCurve } from './lightShading';
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

type PartKey =
  | 'body'
  | 'head'
  | 'snout'
  | 'leg'
  | 'sTorso'
  | 'sHead'
  | 'sArm'
  | 'sLeg'
  | 'cBody'
  | 'cPatch'
  | 'cHead'
  | 'cHorn'
  | 'cSnout'
  | 'cLeg'
  | 'kBody'
  | 'kHead'
  | 'kBeak'
  | 'kWattle'
  | 'kLeg'
  | 'kWing';

type Size3 = { x: number; y: number; z: number };

/** How one part instance moves: fixed, swinging about its top (leg), or flapping outward about its top (wing). */
type PartMotion = 'none' | 'leg' | 'wing';

/**
 * One box instance of a mob model. For 'none' `y` is the box centre; for limbs
 * (leg / wing) `y` is the pivot at the top of the box, which hangs down from it.
 * `sign` picks the side / phase of a limb.
 */
interface PartInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly motion: PartMotion;
  readonly sign: number;
}

/** All instances of one part type on one mob: they share a single InstancedMesh. */
interface ModelPart {
  readonly key: PartKey;
  readonly size: Size3;
  readonly color: THREE.Color;
  readonly instances: readonly PartInstance[];
}

interface MobModel {
  readonly mobType: MobType;
  /** Height above the feet at which voxel light is sampled for the whole mob. */
  readonly lightY: number;
  readonly parts: readonly ModelPart[];
  /** Max leg swing (radians) and swing cycles per block walked. */
  readonly legSwing: number;
  readonly swingFrequency: number;
}

const fixed = (x: number, y: number, z: number): PartInstance => ({ x, y, z, motion: 'none', sign: 1 });
const limb = (x: number, y: number, z: number, motion: PartMotion, sign: number): PartInstance => ({
  x,
  y,
  z,
  motion,
  sign,
});

/** Original cow: cream body with dark side patches, brown head with horns and a pink snout, 4 legs (1.3 tall with horns, 0.9 wide). */
const COW_LEG_SIZE: Size3 = { x: 0.16, y: 0.5, z: 0.16 };
const COW_LEG_X = 0.2;
const COW_LEG_Z = 0.36;
const COW_MODEL: MobModel = {
  mobType: MobType.Cow,
  lightY: 0.8,
  legSwing: 0.45,
  swingFrequency: 1.8,
  parts: [
    { key: 'cBody', size: { x: 0.7, y: 0.6, z: 1.0 }, color: new THREE.Color(0xeee9dc), instances: [fixed(0, 0.8, 0)] },
    {
      key: 'cPatch',
      size: { x: 0.2, y: 0.32, z: 0.34 },
      color: new THREE.Color(0x5a4034),
      instances: [fixed(0.26, 0.86, 0.16), fixed(-0.26, 0.9, -0.2)],
    },
    { key: 'cHead', size: { x: 0.4, y: 0.4, z: 0.35 }, color: new THREE.Color(0x9a6a44), instances: [fixed(0, 1.02, -0.62)] },
    {
      key: 'cHorn',
      size: { x: 0.06, y: 0.14, z: 0.06 },
      color: new THREE.Color(0xd9d2b0),
      instances: [fixed(-0.17, 1.29, -0.6), fixed(0.17, 1.29, -0.6)],
    },
    { key: 'cSnout', size: { x: 0.26, y: 0.16, z: 0.1 }, color: new THREE.Color(0xe0aaa0), instances: [fixed(0, 0.94, -0.85)] },
    {
      key: 'cLeg',
      size: COW_LEG_SIZE,
      color: new THREE.Color(0xcfc8b8),
      instances: [
        limb(-COW_LEG_X, COW_LEG_SIZE.y, -COW_LEG_Z, 'leg', 1),
        limb(COW_LEG_X, COW_LEG_SIZE.y, -COW_LEG_Z, 'leg', -1),
        limb(-COW_LEG_X, COW_LEG_SIZE.y, COW_LEG_Z, 'leg', -1),
        limb(COW_LEG_X, COW_LEG_SIZE.y, COW_LEG_Z, 'leg', 1),
      ],
    },
  ],
};

/** Original chicken: white body, head with yellow beak and red wattle, 2 legs, 2 wings that flap (0.4 wide, 0.7 tall). */
const CHICKEN_LEG_SIZE: Size3 = { x: 0.06, y: 0.25, z: 0.06 };
const CHICKEN_WING_SIZE: Size3 = { x: 0.04, y: 0.2, z: 0.26 };
const CHICKEN_MODEL: MobModel = {
  mobType: MobType.Chicken,
  lightY: 0.4,
  legSwing: 0.7,
  swingFrequency: 3,
  parts: [
    { key: 'kBody', size: { x: 0.3, y: 0.28, z: 0.4 }, color: new THREE.Color(0xf4f1ea), instances: [fixed(0, 0.39, 0)] },
    { key: 'kHead', size: { x: 0.16, y: 0.2, z: 0.16 }, color: new THREE.Color(0xf4f1ea), instances: [fixed(0, 0.6, -0.16)] },
    { key: 'kBeak', size: { x: 0.08, y: 0.05, z: 0.09 }, color: new THREE.Color(0xe8b030), instances: [fixed(0, 0.6, -0.27)] },
    { key: 'kWattle', size: { x: 0.04, y: 0.07, z: 0.04 }, color: new THREE.Color(0xc82828), instances: [fixed(0, 0.5, -0.23)] },
    {
      key: 'kLeg',
      size: CHICKEN_LEG_SIZE,
      color: new THREE.Color(0xe0a030),
      instances: [limb(-0.07, CHICKEN_LEG_SIZE.y, 0, 'leg', 1), limb(0.07, CHICKEN_LEG_SIZE.y, 0, 'leg', -1)],
    },
    {
      key: 'kWing',
      size: CHICKEN_WING_SIZE,
      color: new THREE.Color(0xe2ddd0),
      instances: [limb(-0.17, 0.52, 0.02, 'wing', -1), limb(0.17, 0.52, 0.02, 'wing', 1)],
    },
  ],
};

const MOB_MODELS: readonly MobModel[] = [COW_MODEL, CHICKEN_MODEL];

/** Airborne mobs with vertical speed below this (blocks/s, negative = falling) flap their wings hard. */
const FLAP_FALL_SPEED = -0.5;
/** Wing roll (radians) while falling: mean and amplitude; flap cycles per second. */
const FLAP_FALL_MEAN = 0.8;
const FLAP_FALL_AMPLITUDE = 0.4;
const FLAP_FALL_FREQUENCY = 8;
/** Wing roll while walking on the ground / resting; horizontal speed (blocks/s) above which walking flutter starts. */
const FLAP_WALK_MEAN = 0.15;
const FLAP_WALK_AMPLITUDE = 0.12;
const FLAP_WALK_FREQUENCY = 5;
const FLAP_REST_ROLL = 0.05;
const FLAP_WALK_MIN_SPEED = 0.3;

interface PartBucket {
  mesh: THREE.InstancedMesh;
  capacity: number;
}

/**
 * A part InstancedMesh with its per-instance colour attribute allocated up
 * front (white). The colour attribute must exist before the mesh is first
 * compiled/rendered: three caches the pipeline per material + object
 * signature, and a mesh first drawn with `instanceColor === null` (no mobs
 * alive yet) gets a pipeline without instance colours, so later `setColorAt`
 * calls would have no effect and every part renders in the base colour.
 */
export function createPartMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  capacity: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Box for one mob part with the chunk mesher's per-face shade (top / sides /
 * bottom) baked into vertex colours. Mobs use an unlit material like chunks,
 * so final colour = part colour x voxel-light brightness (instance colour) x
 * face shade, matching the terrain instead of picking up the scene's
 * hemisphere / sun light on top. Shade uses the part's local normals.
 */
export function createShadedBoxGeometry(size: { x: number; y: number; z: number }): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i += 1) {
    const shade = faceShade(normals.getX(i), normals.getY(i));
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const createBoxGeometry = createShadedBoxGeometry;

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
  private readonly material: THREE.MeshBasicMaterial;
  private readonly geometryByPart: Record<PartKey, THREE.BoxGeometry>;
  private readonly bucketByPart = new Map<PartKey, PartBucket>();
  /** Per-mob accumulated horizontal distance walked, for leg swing phase (keyed by mob id). */
  private readonly walkedDistanceById = new Map<number, number>();
  /** Seconds of accumulated render time; drives wing flapping. */
  private clock = 0;

  constructor(scene: THREE.Scene, store: ChunkStore) {
    this.scene = scene;
    this.store = store;
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.geometryByPart = {
      body: createBoxGeometry(PIG_BODY_SIZE),
      head: createBoxGeometry(PIG_HEAD_SIZE),
      snout: createBoxGeometry(PIG_SNOUT_SIZE),
      leg: createBoxGeometry(PIG_LEG_SIZE),
      sTorso: createBoxGeometry(SHAMBLER_TORSO_SIZE),
      sHead: createBoxGeometry(SHAMBLER_HEAD_SIZE),
      sArm: createBoxGeometry(SHAMBLER_ARM_SIZE),
      sLeg: createBoxGeometry(SHAMBLER_LEG_SIZE),
      ...Object.fromEntries(
        MOB_MODELS.flatMap((model) => model.parts.map((part) => [part.key, createBoxGeometry(part.size)] as const)),
      ),
    } as Record<PartKey, THREE.BoxGeometry>;
  }

  private bucketForPart(part: PartKey): PartBucket {
    const existing = this.bucketByPart.get(part);
    if (existing !== undefined) {
      return existing;
    }
    const mesh = createPartMesh(this.geometryByPart[part], this.material, INITIAL_INSTANCE_CAPACITY);
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
    const newMesh = createPartMesh(this.geometryByPart[part], this.material, newCapacity);
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
   * list. Pig, Shambler, Cow and Chicken are implemented; any other mob type
   * renders as nothing rather than throwing.
   */
  update(mobs: readonly MobEntity[], dt: number): void {
    const frameDt = Math.max(0, dt);
    this.clock += frameDt;
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
    for (const model of MOB_MODELS) {
      this.updateModel(model, mobs.filter((mob) => mob.type === model.mobType), frameDt, liveIds);
    }

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

  /**
   * Draws every mob of one data-driven model (cow, chicken): each part type has
   * ONE shared InstancedMesh. Legs swing with distance walked; wings flap
   * faster while airborne and falling.
   */
  private updateModel(model: MobModel, mobs: readonly MobEntity[], frameDt: number, liveIds: Set<number>): void {
    const buckets = model.parts.map((part) => this.readyBucket(part.key, mobs.length * part.instances.length));

    for (let i = 0; i < mobs.length; i += 1) {
      const mob = mobs[i];
      if (mob === undefined) {
        continue;
      }
      liveIds.add(mob.id);

      const speed = Math.hypot(mob.velocity.x, mob.velocity.z);
      const distance = (this.walkedDistanceById.get(mob.id) ?? 0) + speed * frameDt;
      this.walkedDistanceById.set(mob.id, distance);

      const brightness = this.brightnessAt(mob.position.x, mob.position.y + model.lightY, mob.position.z);
      const hurt = mob.hurtFlashTimer > 0;
      const cosYaw = Math.cos(mob.yaw);
      const sinYaw = Math.sin(mob.yaw);
      const swingPhase = distance * model.swingFrequency * Math.PI * 2 + mob.id;
      const legScale = Math.min(1, speed);
      const falling = !mob.onGround && mob.velocity.y < FLAP_FALL_SPEED;
      const flapPhase = this.clock * Math.PI * 2 + mob.id;
      const wingRoll = falling
        ? FLAP_FALL_MEAN + Math.sin(flapPhase * FLAP_FALL_FREQUENCY) * FLAP_FALL_AMPLITUDE
        : speed > FLAP_WALK_MIN_SPEED
          ? FLAP_WALK_MEAN + Math.sin(flapPhase * FLAP_WALK_FREQUENCY) * FLAP_WALK_AMPLITUDE
          : FLAP_REST_ROLL;

      model.parts.forEach((part, partIndex) => {
        const bucket = buckets[partIndex];
        if (bucket === undefined) {
          return;
        }
        const half = part.size.y / 2;
        part.instances.forEach((inst, instIndex) => {
          let pitch = 0;
          let roll = 0;
          let localX = inst.x;
          let localY = inst.y;
          let localZ = inst.z;
          if (inst.motion === 'leg') {
            pitch = Math.sin(swingPhase) * inst.sign * model.legSwing * legScale;
            localY = inst.y - half * Math.cos(pitch);
            localZ = inst.z - half * Math.sin(pitch);
          } else if (inst.motion === 'wing') {
            roll = inst.sign * wingRoll;
            localX = inst.x + half * Math.sin(roll);
            localY = inst.y - half * Math.cos(roll);
          }
          dummyEuler.set(pitch, mob.yaw, roll, 'YXZ');
          dummyQuaternion.setFromEuler(dummyEuler);
          dummyPosition.set(
            mob.position.x + cosYaw * localX + sinYaw * localZ,
            mob.position.y + localY,
            mob.position.z - sinYaw * localX + cosYaw * localZ,
          );
          dummyMatrix.compose(dummyPosition, dummyQuaternion, dummyScale);
          const slot = i * part.instances.length + instIndex;
          bucket.mesh.setMatrixAt(slot, dummyMatrix);
          bucket.mesh.setColorAt(slot, this.shadeInto(part.color, brightness, hurt));
        });
      });
    }

    for (const bucket of buckets) {
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
