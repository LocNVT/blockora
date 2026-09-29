import type { Aabb } from '../player/voxelCollision';
import { moveAabbThroughVoxels } from '../player/voxelCollision';
import type { SolidQuery } from '../world/SolidQuery';
import { ITEM_DROP_CONFIG, PLAYER_CONFIG, WORLD_CONFIG } from '../config/constants';
import type { ItemStack } from './ItemStack';
import type { Inventory } from './Inventory';

/** Plain 3D vector (no Three.js dependency in simulation code). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A single item entity lying in the world: not yet picked up. Plain data,
 * mutated in place by `ItemDropSystem.update` — no Three.js, no DOM.
 */
export interface ItemDrop {
  readonly id: number;
  stack: ItemStack;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Seconds this drop has existed; despawns at ITEM_DROP_CONFIG.lifetime. */
  age: number;
  /** Seconds remaining before this drop becomes collectible. */
  pickupDelay: number;
}

/** Returns whether the column (wx, wz) is currently loaded, so drops in unloaded chunks despawn. */
export type IsColumnLoaded = (wx: number, wz: number) => boolean;

function buildDropAabb(position: Vec3, halfSize: number): Aabb {
  return {
    minX: position.x - halfSize,
    maxX: position.x + halfSize,
    minY: position.y - halfSize,
    maxY: position.y + halfSize,
    minZ: position.z - halfSize,
    maxZ: position.z + halfSize,
  };
}

function aabbFromDrop(drop: ItemDrop, halfSize: number): Aabb {
  return buildDropAabb(drop.position, halfSize);
}

function aabbsIntersect(a: Aabb, b: Aabb): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minY < b.maxY &&
    a.maxY > b.minY &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}

function expandAabb(aabb: Aabb, amount: number): Aabb {
  return {
    minX: aabb.minX - amount,
    maxX: aabb.maxX + amount,
    minY: aabb.minY - amount,
    maxY: aabb.maxY + amount,
    minZ: aabb.minZ - amount,
    maxZ: aabb.maxZ + amount,
  };
}

/**
 * Owns every "item lying in the world" entity: spawning, physics (gravity,
 * ground friction, voxel collision via the shared player collision core),
 * lifetime despawn, unloaded-column despawn, and player pickup. Pure
 * simulation — no Three.js, no DOM; see ItemDropRenderer for visuals.
 */
export class ItemDropSystem {
  private readonly dropsById = new Map<number, ItemDrop>();
  private nextId = 1;

  /** Spawns a new drop at `position` with optional initial velocity and pickup delay. Deterministic ids. */
  spawn(
    stack: ItemStack,
    position: Vec3,
    velocity: Vec3 = { x: 0, y: 0, z: 0 },
    pickupDelay: number = ITEM_DROP_CONFIG.pickupDelay,
  ): ItemDrop {
    const drop: ItemDrop = {
      id: this.nextId,
      stack,
      position: { ...position },
      velocity: { ...velocity },
      age: 0,
      pickupDelay,
    };
    this.nextId += 1;
    this.dropsById.set(drop.id, drop);
    return drop;
  }

  /** Read-only view of every live drop, in ascending id order (deterministic). */
  drops(): readonly ItemDrop[] {
    return Array.from(this.dropsById.values()).sort((a, b) => a.id - b.id);
  }

  clear(): void {
    this.dropsById.clear();
  }

  /**
   * Advances every drop by `dt` seconds: gravity, ground friction, voxel
   * collision (small cube, half-size ITEM_DROP_CONFIG.halfSize, reusing the
   * player's collision core), and despawn (lifetime or unloaded column).
   * Nudges a drop upward if it starts embedded in a solid block (e.g. a
   * block was placed where it was resting).
   */
  update(dt: number, isSolid: SolidQuery, isLoaded: IsColumnLoaded): void {
    const clampedDt = Math.min(Math.max(dt, 0), PLAYER_CONFIG.maxFrameDelta);
    const { halfSize, gravity, groundFriction, lifetime } = ITEM_DROP_CONFIG;

    for (const drop of this.dropsById.values()) {
      drop.age += clampedDt;

      if (
        drop.age >= lifetime ||
        !isLoaded(Math.floor(drop.position.x), Math.floor(drop.position.z))
      ) {
        this.dropsById.delete(drop.id);
        continue;
      }

      if (drop.pickupDelay > 0) {
        drop.pickupDelay = Math.max(0, drop.pickupDelay - clampedDt);
      }

      this.unstuckIfEmbedded(drop, isSolid, halfSize);

      drop.velocity.y = Math.max(drop.velocity.y - gravity * clampedDt, -PLAYER_CONFIG.maxFallSpeed);

      const aabb = aabbFromDrop(drop, halfSize);
      const dx = drop.velocity.x * clampedDt;
      const dy = drop.velocity.y * clampedDt;
      const dz = drop.velocity.z * clampedDt;

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
        drop.velocity.x = 0;
      }
      if (collidedY) {
        drop.velocity.y = 0;
      }
      if (collidedZ) {
        drop.velocity.z = 0;
      }

      drop.position.x = aabb.minX + halfSize;
      drop.position.y = aabb.minY + halfSize;
      drop.position.z = aabb.minZ + halfSize;

      const onGround = collidedY && dy <= 0;
      if (onGround) {
        this.applyGroundFriction(drop, groundFriction, clampedDt);
      }
    }
  }

  /** Exponential-style horizontal damping while resting on the ground; snaps tiny residue to 0. */
  private applyGroundFriction(drop: ItemDrop, friction: number, dt: number): void {
    const damping = Math.max(0, 1 - friction * dt);
    drop.velocity.x *= damping;
    drop.velocity.z *= damping;
    const epsilon = 1e-4;
    if (Math.abs(drop.velocity.x) < epsilon) {
      drop.velocity.x = 0;
    }
    if (Math.abs(drop.velocity.z) < epsilon) {
      drop.velocity.z = 0;
    }
  }

  /** If `drop` starts inside a solid block, nudges it straight up to the nearest free cell. */
  private unstuckIfEmbedded(drop: ItemDrop, isSolid: SolidQuery, halfSize: number): void {
    const maxLift = WORLD_CONFIG.chunkHeight;
    let lift = 0;
    while (lift < maxLift && this.embeddedAt(drop.position, halfSize, isSolid)) {
      lift += 1;
      drop.position.y += 1;
    }
  }

  private embeddedAt(position: Vec3, halfSize: number, isSolid: SolidQuery): boolean {
    const aabb = buildDropAabb(position, halfSize);
    const bx0 = Math.floor(aabb.minX + PLAYER_CONFIG.collisionEpsilon);
    const bx1 = Math.ceil(aabb.maxX - PLAYER_CONFIG.collisionEpsilon) - 1;
    const by0 = Math.floor(aabb.minY + PLAYER_CONFIG.collisionEpsilon);
    const by1 = Math.ceil(aabb.maxY - PLAYER_CONFIG.collisionEpsilon) - 1;
    const bz0 = Math.floor(aabb.minZ + PLAYER_CONFIG.collisionEpsilon);
    const bz1 = Math.ceil(aabb.maxZ - PLAYER_CONFIG.collisionEpsilon) - 1;

    for (let by = by0; by <= by1; by += 1) {
      for (let bx = bx0; bx <= bx1; bx += 1) {
        for (let bz = bz0; bz <= bz1; bz += 1) {
          if (isSolid(bx, by, bz)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Collects every eligible drop (pickup delay elapsed, expanded AABB
   * intersects `playerBox`) into `inventory`, in ascending id order. Partial
   * pickups (inventory nearly full) leave the leftover as a smaller drop;
   * fully collected drops are removed. Returns the total item count picked up.
   */
  collect(playerBox: Aabb, inventory: Inventory): number {
    const { halfSize, pickupRadius } = ITEM_DROP_CONFIG;
    let totalCollected = 0;

    for (const drop of this.drops()) {
      if (drop.pickupDelay > 0) {
        continue;
      }

      const dropBox = expandAabb(aabbFromDrop(drop, halfSize), pickupRadius);
      if (!aabbsIntersect(dropBox, playerBox)) {
        continue;
      }

      const leftover = inventory.add(drop.stack);
      const collectedCount = drop.stack.count - (leftover?.count ?? 0);
      totalCollected += collectedCount;

      if (leftover === null) {
        this.dropsById.delete(drop.id);
      } else {
        drop.stack = leftover;
      }
    }

    return totalCollected;
  }
}
