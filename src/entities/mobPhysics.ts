import type { Aabb } from '../player/voxelCollision';
import { moveAabbThroughVoxels } from '../player/voxelCollision';
import type { SolidQuery } from '../world/SolidQuery';
import { PLAYER_CONFIG, MOB_CONFIG } from '../config/constants';
import type { MobEntity } from './EntityStore';
import type { MobDefinition } from './mobDefinitions';

function buildMobAabb(position: MobEntity['position'], halfWidth: number, height: number): Aabb {
  return {
    minX: position.x - halfWidth,
    maxX: position.x + halfWidth,
    minY: position.y,
    maxY: position.y + height,
    minZ: position.z - halfWidth,
    maxZ: position.z + halfWidth,
  };
}

/** True if any solid block occupies the single cell (bx, by, bz). */
function cellSolid(isSolid: SolidQuery, bx: number, by: number, bz: number): boolean {
  return isSolid(bx, by, bz);
}

/**
 * Look-ahead safety check while wandering on the ground: refuses to walk
 * forward when the next cell would be a drop deeper than
 * MOB_CONFIG.maxSafeDropAhead blocks (keeps mobs off ledges) or is a fluid
 * cell (keeps mobs out of water). Simple single-cell probe, deterministic.
 */
function aheadIsUnsafe(
  position: MobEntity['position'],
  yaw: number,
  isSolid: SolidQuery,
  isFluid: SolidQuery,
): boolean {
  const aheadX = position.x - Math.sin(yaw);
  const aheadZ = position.z - Math.cos(yaw);
  const feetY = Math.floor(position.y);
  const bx = Math.floor(aheadX);
  const bz = Math.floor(aheadZ);

  if (isFluid(bx, feetY, bz)) {
    return true;
  }

  if (cellSolid(isSolid, bx, feetY, bz)) {
    // Solid ground directly ahead: not a drop (may be a step, handled by auto-jump).
    return false;
  }

  for (let depth = 1; depth <= MOB_CONFIG.maxSafeDropAhead; depth += 1) {
    if (cellSolid(isSolid, bx, feetY - depth, bz)) {
      return false;
    }
  }
  return true;
}

/**
 * True when a 1-block step directly ahead is blocked but the cell above it
 * (at head height) is free — the auto-jump condition: a step-up the mob
 * should hop rather than get stuck against.
 */
function shouldAutoJump(
  position: MobEntity['position'],
  yaw: number,
  height: number,
  isSolid: SolidQuery,
): boolean {
  const aheadX = position.x - Math.sin(yaw);
  const aheadZ = position.z - Math.cos(yaw);
  const feetY = Math.floor(position.y);
  const bx = Math.floor(aheadX);
  const bz = Math.floor(aheadZ);

  const blockedAtFeet = cellSolid(isSolid, bx, feetY, bz);
  if (!blockedAtFeet) {
    return false;
  }
  // The cell one block above the obstacle, up to head height, must be free
  // for the mob to fit after hopping up.
  const topCell = Math.floor(position.y + height);
  for (let by = feetY + 1; by <= topCell; by += 1) {
    if (cellSolid(isSolid, bx, by, bz)) {
      return false;
    }
  }
  return true;
}

/** Exponential-style horizontal damping while resting on the ground; snaps tiny residue to 0. */
function applyGroundFriction(mob: MobEntity, dt: number): void {
  const damping = Math.max(0, 1 - MOB_CONFIG.groundFriction * dt);
  mob.velocity.x *= damping;
  mob.velocity.z *= damping;
  const epsilon = 1e-4;
  if (Math.abs(mob.velocity.x) < epsilon) {
    mob.velocity.x = 0;
  }
  if (Math.abs(mob.velocity.z) < epsilon) {
    mob.velocity.z = 0;
  }
}

/**
 * Advances one mob's physics by `dt` seconds: gravity, horizontal walk
 * velocity while wandering (with look-ahead water/ledge avoidance and
 * 1-block auto-jump), voxel collision (reusing the shared player collision
 * core, sized to this mob's AABB), and ground friction. Mutates `mob` in
 * place. Deterministic given the same inputs.
 */
export function updateMobPhysics(
  mob: MobEntity,
  def: MobDefinition,
  dt: number,
  isSolid: SolidQuery,
  isFluid: SolidQuery,
): void {
  const { halfWidth, height, walkSpeed, fleeSpeed } = def;

  let moveX = 0;
  let moveZ = 0;
  if (mob.ai.state === 'wander' || mob.ai.state === 'flee') {
    const speed = mob.ai.state === 'flee' ? fleeSpeed : walkSpeed;
    const blockedByHazard = mob.onGround && aheadIsUnsafe(mob.position, mob.yaw, isSolid, isFluid);
    if (!blockedByHazard) {
      moveX = -Math.sin(mob.yaw) * speed;
      moveZ = -Math.cos(mob.yaw) * speed;
    }
  }

  // While knocked back (airborne after a hit) the mob keeps the knockback
  // velocity instead of steering, so the horizontal push isn't overwritten.
  if (!mob.knockedBack) {
    if (
      mob.onGround &&
      (moveX !== 0 || moveZ !== 0) &&
      shouldAutoJump(mob.position, mob.yaw, height, isSolid)
    ) {
      mob.velocity.y = MOB_CONFIG.stepJumpVelocity;
    }

    mob.velocity.x = moveX;
    mob.velocity.z = moveZ;
  }
  mob.velocity.y = Math.max(mob.velocity.y - MOB_CONFIG.gravity * dt, -MOB_CONFIG.maxFallSpeed);

  const aabb = buildMobAabb(mob.position, halfWidth, height);
  const dx = mob.velocity.x * dt;
  const dy = mob.velocity.y * dt;
  const dz = mob.velocity.z * dt;

  const { collidedX, collidedY, collidedZ } = moveAabbThroughVoxels(
    aabb,
    dx,
    dy,
    dz,
    isSolid,
    PLAYER_CONFIG.collisionEpsilon,
    PLAYER_CONFIG.maxSubstepDistance,
  );

  if (collidedX) {
    mob.velocity.x = 0;
  }
  if (collidedY) {
    mob.velocity.y = 0;
  }
  if (collidedZ) {
    mob.velocity.z = 0;
  }

  mob.position.x = aabb.minX + halfWidth;
  mob.position.y = aabb.minY;
  mob.position.z = aabb.minZ + halfWidth;

  const movingDown = dy < 0;
  mob.onGround = collidedY && movingDown;
  if (mob.onGround) {
    mob.knockedBack = false;
  }

  if (mob.onGround) {
    applyGroundFriction(mob, dt);
  }
}
