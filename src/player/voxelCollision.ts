import { PLAYER_CONFIG } from '../config/constants';
import type { SolidQuery } from '../world/SolidQuery';
import type { PlayerState } from './PlayerState';

/** Axis-aligned bounding box in world space. */
export interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

type Axis = 'x' | 'y' | 'z';
type PlayerConfig = typeof PLAYER_CONFIG;

/** Builds the player's collision AABB from its feet position and current height (incl. crouch). */
function buildAabb(position: PlayerState['position'], height: number, config: PlayerConfig): Aabb {
  const halfWidth = config.width / 2;
  return {
    minX: position.x - halfWidth,
    maxX: position.x + halfWidth,
    minY: position.y,
    maxY: position.y + height,
    minZ: position.z - halfWidth,
    maxZ: position.z + halfWidth,
  };
}

function currentHeight(state: PlayerState, config: PlayerConfig): number {
  return state.crouching ? config.crouchHeight : config.height;
}

function translateAxis(aabb: Aabb, axis: Axis, delta: number): Aabb {
  if (axis === 'x') {
    return { ...aabb, minX: aabb.minX + delta, maxX: aabb.maxX + delta };
  }
  if (axis === 'y') {
    return { ...aabb, minY: aabb.minY + delta, maxY: aabb.maxY + delta };
  }
  return { ...aabb, minZ: aabb.minZ + delta, maxZ: aabb.maxZ + delta };
}

function axisRange(aabb: Aabb, axis: Axis): { min: number; max: number } {
  if (axis === 'x') {
    return { min: aabb.minX, max: aabb.maxX };
  }
  if (axis === 'y') {
    return { min: aabb.minY, max: aabb.maxY };
  }
  return { min: aabb.minZ, max: aabb.maxZ };
}

/**
 * Inclusive integer block range covering [min, max) after nudging both
 * edges inward by epsilon, so a boundary that exactly touches a block edge
 * (e.g. min == 3.0) isn't treated as overlapping the block below/left of it.
 */
function blockRange(min: number, max: number, epsilon: number): { lo: number; hi: number } {
  return {
    lo: Math.floor(min + epsilon),
    hi: Math.ceil(max - epsilon) - 1,
  };
}

/** True if any solid block overlaps the given AABB. */
function aabbOverlapsSolid(aabb: Aabb, isSolid: SolidQuery, epsilon: number): boolean {
  const x = blockRange(aabb.minX, aabb.maxX, epsilon);
  const y = blockRange(aabb.minY, aabb.maxY, epsilon);
  const z = blockRange(aabb.minZ, aabb.maxZ, epsilon);

  for (let by = y.lo; by <= y.hi; by += 1) {
    for (let bx = x.lo; bx <= x.hi; bx += 1) {
      for (let bz = z.lo; bz <= z.hi; bz += 1) {
        if (isSolid(bx, by, bz)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Splits a signed delta into substeps each smaller than maxStep, preserving total distance. */
function splitIntoSubsteps(delta: number, maxStep: number): number[] {
  const distance = Math.abs(delta);
  if (distance === 0) {
    return [];
  }
  const count = Math.max(1, Math.ceil(distance / maxStep));
  const step = delta / count;
  return new Array(count).fill(step) as number[];
}

/**
 * Moves the AABB along a single world axis by `delta`, substepped so each
 * substep is smaller than `maxSubstepDistance`. On the substep where contact
 * occurs, clamps the leading edge to the touched block's face (minus a skin
 * epsilon) rather than stepping further, and stops advancing on this axis for
 * the remaining substeps.
 */
function moveAxis(
  aabb: Aabb,
  axis: Axis,
  delta: number,
  isSolid: SolidQuery,
  epsilon: number,
  maxSubstepDistance: number,
): boolean {
  const substeps = splitIntoSubsteps(delta, maxSubstepDistance);
  let collided = false;

  for (const step of substeps) {
    const testAabb = translateAxis(aabb, axis, step);
    if (!aabbOverlapsSolid(testAabb, isSolid, epsilon)) {
      Object.assign(aabb, testAabb);
      continue;
    }

    collided = true;
    const positive = step > 0;
    const { max: leadingEdge } = axisRange(aabb, axis);
    const { min: trailingMin } = axisRange(aabb, axis);
    const currentEdge = positive ? leadingEdge : trailingMin;

    // The leading edge, after the (rejected) full step, would land inside or
    // past a solid block. Since the block grid is integer-aligned and this
    // substep moves less than one block, the touched block face is simply
    // the integer boundary the leading edge crosses into.
    const testEdge = positive ? axisRange(testAabb, axis).max : axisRange(testAabb, axis).min;
    const face = positive ? Math.floor(testEdge - epsilon) : Math.ceil(testEdge + epsilon);
    const target = positive ? face - epsilon : face + epsilon;
    const resolvedDelta = target - currentEdge;

    const clamped = positive
      ? Math.min(Math.max(resolvedDelta, 0), step)
      : Math.max(Math.min(resolvedDelta, 0), step);

    Object.assign(aabb, translateAxis(aabb, axis, clamped));
    break;
  }

  return collided;
}

/** Per-axis collision flags returned by `moveAabbThroughVoxels`. */
export interface AabbMoveResult {
  readonly collidedX: boolean;
  readonly collidedY: boolean;
  readonly collidedZ: boolean;
}

/**
 * Size-parametric collision core shared by the player and any other
 * voxel-colliding AABB (e.g. item drops): mutates `aabb` in place, sweeping it
 * by (dx, dy, dz) against `isSolid`, axis order Y then X then Z, each axis
 * substepped so no single substep moves more than `maxSubstep` blocks. This is
 * the exact algorithm `resolveVoxelCollision` used inline before extraction —
 * moving it here changes no behaviour for the player.
 */
export function moveAabbThroughVoxels(
  aabb: Aabb,
  dx: number,
  dy: number,
  dz: number,
  isSolid: SolidQuery,
  epsilon: number,
  maxSubstep: number,
): AabbMoveResult {
  const collidedY = moveAxis(aabb, 'y', dy, isSolid, epsilon, maxSubstep);
  const collidedX = moveAxis(aabb, 'x', dx, isSolid, epsilon, maxSubstep);
  const collidedZ = moveAxis(aabb, 'z', dz, isSolid, epsilon, maxSubstep);
  return { collidedX, collidedY, collidedZ };
}

/** True if a solid block lies immediately beneath the AABB's feet (within the probe distance). */
function probeGround(aabb: Aabb, isSolid: SolidQuery, config: PlayerConfig): boolean {
  const probe: Aabb = {
    ...aabb,
    minY: aabb.minY - config.groundProbeDistance,
    maxY: aabb.minY,
  };
  return aabbOverlapsSolid(probe, isSolid, config.collisionEpsilon);
}

export interface CollisionResult {
  onGround: boolean;
}

/**
 * Resolves player movement for one physics step against solid voxel blocks.
 * Mutates `state.position` and zeroes colliding components of `state.velocity`.
 *
 * Axis order: Y first (so standing/landing is resolved before horizontal
 * sliding), then X, then Z. Each axis is substepped so no single substep
 * moves more than config.maxSubstepDistance on that axis, keeping the sweep
 * deterministic and tunnel-free regardless of frame rate (dt is already
 * clamped upstream by maxFrameDelta).
 */
export function resolveVoxelCollision(
  state: PlayerState,
  deltaX: number,
  deltaY: number,
  deltaZ: number,
  isSolid: SolidQuery,
  config: PlayerConfig = PLAYER_CONFIG
): CollisionResult {
  const height = currentHeight(state, config);
  const aabb = buildAabb(state.position, height, config);

  const { collidedX, collidedY, collidedZ } = moveAabbThroughVoxels(
    aabb,
    deltaX,
    deltaY,
    deltaZ,
    isSolid,
    config.collisionEpsilon,
    config.maxSubstepDistance,
  );

  if (collidedY) {
    state.velocity.y = 0;
  }
  if (collidedX) {
    state.velocity.x = 0;
  }
  if (collidedZ) {
    state.velocity.z = 0;
  }

  state.position.x = aabb.minX + config.width / 2;
  state.position.y = aabb.minY;
  state.position.z = aabb.minZ + config.width / 2;

  const movingDown = deltaY < 0;
  const landedThisStep = collidedY && movingDown;
  const onGround = landedThisStep || probeGround(aabb, isSolid, config);

  return { onGround };
}

/**
 * True if standing up from a crouch would collide with a ceiling — used to
 * keep the player crouched rather than pushing them into a block above.
 */
export function wouldStandingCollide(
  state: PlayerState,
  isSolid: SolidQuery,
  config: PlayerConfig = PLAYER_CONFIG
): boolean {
  const standingAabb = buildAabb(state.position, config.height, config);
  return aabbOverlapsSolid(standingAabb, isSolid, config.collisionEpsilon);
}

/** Builds the player's current collision AABB (respects crouch) — for gameplay code outside physics. */
export function playerAabb(state: PlayerState, config: PlayerConfig = PLAYER_CONFIG): Aabb {
  return buildAabb(state.position, currentHeight(state, config), config);
}
