import type { FaceDirection } from './mesher/faces';
import { FaceDirection as FaceDirectionValue } from './mesher/faces';
import type { TargetQuery } from './TargetQuery';
import { createTargetQuery } from './TargetQuery';
import type { BlockRegistry } from './BlockRegistry';
import type { ChunkStore } from './ChunkStore';
import { PLAYER_CONFIG } from '../config/constants';

/** Plain read-only 3D vector, storage/renderer agnostic (no Three.js dependency here). */
export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Result of a voxel raycast. Reusable/mutable so callers can pass an `out`
 * object to `raycastVoxels`/`raycastBlock` each frame without allocating.
 *
 * - `distance` is measured along the *normalized* ray direction, from the
 *   origin to the point where the ray enters the hit cell (0 when the ray
 *   starts inside a targetable block).
 * - `face` is the face of the hit block that the ray entered through (i.e.
 *   the direction opposite the last axis stepped during traversal). It is
 *   `null` only when the ray starts inside a targetable block (no boundary
 *   was crossed to get there).
 * - `normal` is the outward-pointing unit normal matching `face` (0,0,0)
 *   when `face` is null.
 * - `hasPlacePosition` is false exactly when `face` is null; otherwise
 *   `placeX/Y/Z` = hit block + normal (the adjacent empty-side cell a
 *   "place block" action would target).
 */
export interface VoxelRaycastHit {
  x: number;
  y: number;
  z: number;
  distance: number;
  face: FaceDirection | null;
  normalX: number;
  normalY: number;
  normalZ: number;
  hasPlacePosition: boolean;
  placeX: number;
  placeY: number;
  placeZ: number;
}

/** Creates a fresh, zeroed VoxelRaycastHit suitable for passing as `out`. */
export function createVoxelRaycastHit(): VoxelRaycastHit {
  return {
    x: 0,
    y: 0,
    z: 0,
    distance: 0,
    face: null,
    normalX: 0,
    normalY: 0,
    normalZ: 0,
    hasPlacePosition: false,
    placeX: 0,
    placeY: 0,
    placeZ: 0,
  };
}

/** Maps the axis stepped (+1/-1) on x/y/z to the FaceDirection the ray entered through. */
function faceForStep(axis: 0 | 1 | 2, step: number): FaceDirection {
  if (axis === 0) {
    return step > 0 ? FaceDirectionValue.NegX : FaceDirectionValue.PosX;
  }
  if (axis === 1) {
    return step > 0 ? FaceDirectionValue.NegY : FaceDirectionValue.PosY;
  }
  return step > 0 ? FaceDirectionValue.NegZ : FaceDirectionValue.PosZ;
}

/** Outward normal (into the ray's origin side) for the face the ray entered through. */
function normalForFace(face: FaceDirection): readonly [number, number, number] {
  switch (face) {
    case FaceDirectionValue.PosX:
      return [1, 0, 0];
    case FaceDirectionValue.NegX:
      return [-1, 0, 0];
    case FaceDirectionValue.PosY:
      return [0, 1, 0];
    case FaceDirectionValue.NegY:
      return [0, -1, 0];
    case FaceDirectionValue.PosZ:
      return [0, 0, 1];
    default:
      return [0, 0, -1];
  }
}

function fillMiss(out: VoxelRaycastHit): null {
  out.face = null;
  out.hasPlacePosition = false;
  return null;
}

/**
 * Casts a ray through voxel space using 3D DDA (Amanatides & Woo) and returns
 * the first targetable block it enters, or null if none is found within
 * `maxDistance`. Storage-agnostic (no Three.js, no ChunkStore) — callers
 * supply `isTargetable` to decide which blocks stop the ray.
 *
 * Conventions:
 * - `direction` is normalized internally; a zero-length direction returns null.
 * - A block whose entry distance exactly equals `maxDistance` counts as a
 *   hit (inclusive upper bound).
 * - If the origin is already inside a targetable block, that block is
 *   returned immediately with distance 0, face null, normal (0,0,0), and
 *   `hasPlacePosition = false` (there is no "entry face" to place against).
 */
export function raycastVoxels(
  origin: Vec3Like,
  direction: Vec3Like,
  maxDistance: number,
  isTargetable: TargetQuery,
  out: VoxelRaycastHit = createVoxelRaycastHit(),
): VoxelRaycastHit | null {
  const dirLengthSq =
    direction.x * direction.x + direction.y * direction.y + direction.z * direction.z;
  if (dirLengthSq === 0) {
    return fillMiss(out);
  }
  const invLength = 1 / Math.sqrt(dirLengthSq);
  const dx = direction.x * invLength;
  const dy = direction.y * invLength;
  const dz = direction.z * invLength;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  if (isTargetable(x, y, z)) {
    out.x = x;
    out.y = y;
    out.z = z;
    out.distance = 0;
    out.face = null;
    out.normalX = 0;
    out.normalY = 0;
    out.normalZ = 0;
    out.hasPlacePosition = false;
    out.placeX = x;
    out.placeY = y;
    out.placeZ = z;
    return out;
  }

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX: number;
  if (stepX === 0) {
    tMaxX = Infinity;
  } else {
    const boundaryX = stepX > 0 ? x + 1 : x;
    tMaxX = (boundaryX - origin.x) / dx;
  }

  let tMaxY: number;
  if (stepY === 0) {
    tMaxY = Infinity;
  } else {
    const boundaryY = stepY > 0 ? y + 1 : y;
    tMaxY = (boundaryY - origin.y) / dy;
  }

  let tMaxZ: number;
  if (stepZ === 0) {
    tMaxZ = Infinity;
  } else {
    const boundaryZ = stepZ > 0 ? z + 1 : z;
    tMaxZ = (boundaryZ - origin.z) / dz;
  }

  // Bound the loop generously; each iteration advances at least one axis by
  // one cell, so the ray cannot cross more than ~3*ceil(maxDistance)+3 cell
  // boundaries before exceeding maxDistance.
  const maxIterations = 3 * Math.ceil(Math.max(maxDistance, 0)) + 3;

  let lastAxis: 0 | 1 | 2 = 0;
  let lastStep = 0;

  for (let i = 0; i < maxIterations; i += 1) {
    let axis: 0 | 1 | 2;
    let tMax: number;
    let step: number;

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      axis = 0;
      tMax = tMaxX;
      step = stepX;
    } else if (tMaxY <= tMaxZ) {
      axis = 1;
      tMax = tMaxY;
      step = stepY;
    } else {
      axis = 2;
      tMax = tMaxZ;
      step = stepZ;
    }

    if (tMax > maxDistance || step === 0) {
      // Either we've exhausted the ray's range, or all remaining tMax are
      // Infinity (direction has no more non-zero components to advance on).
      return fillMiss(out);
    }

    if (axis === 0) {
      x += stepX;
      tMaxX += tDeltaX;
    } else if (axis === 1) {
      y += stepY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      tMaxZ += tDeltaZ;
    }
    lastAxis = axis;
    lastStep = step;

    if (isTargetable(x, y, z)) {
      const face = faceForStep(lastAxis, lastStep);
      const [nx, ny, nz] = normalForFace(face);

      out.x = x;
      out.y = y;
      out.z = z;
      out.distance = tMax;
      out.face = face;
      out.normalX = nx;
      out.normalY = ny;
      out.normalZ = nz;
      out.hasPlacePosition = true;
      out.placeX = x + nx;
      out.placeY = y + ny;
      out.placeZ = z + nz;
      return out;
    }
  }

  return fillMiss(out);
}

/**
 * Convenience wrapper around `raycastVoxels` that reads blocks from a
 * ChunkStore/BlockRegistry pair and fills `blockId` on the result.
 *
 * A fresh TargetQuery closure is created per call unless `targetQuery` is
 * supplied — callers on a hot path (e.g. once per frame) should build one
 * with `createTargetQuery(store, registry)` and pass it in to avoid
 * allocating a new closure every call.
 */
export interface VoxelRaycastBlockHit extends VoxelRaycastHit {
  blockId: number;
}

export function createVoxelRaycastBlockHit(): VoxelRaycastBlockHit {
  return { ...createVoxelRaycastHit(), blockId: 0 };
}

export function raycastBlock(
  store: ChunkStore,
  registry: BlockRegistry,
  origin: Vec3Like,
  direction: Vec3Like,
  maxDistance: number = PLAYER_CONFIG.interactionDistance,
  out: VoxelRaycastBlockHit = createVoxelRaycastBlockHit(),
  targetQuery?: TargetQuery,
): VoxelRaycastBlockHit | null {
  const isTargetable = targetQuery ?? createTargetQuery(store, registry);
  const hit = raycastVoxels(origin, direction, maxDistance, isTargetable, out);
  if (hit === null) {
    out.blockId = 0;
    return null;
  }
  out.blockId = store.getBlock(hit.x, hit.y, hit.z);
  return out;
}
