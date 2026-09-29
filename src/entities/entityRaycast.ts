import type { MobEntity } from './EntityStore';
import type { MobDefinition } from './mobDefinitions';

/** Plain read-only 3D vector, storage/renderer agnostic (no Three.js dependency here). */
export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Nearest mob a ray hit, reused across calls via `out` to stay allocation-free. */
export interface EntityRaycastHit {
  mobId: number;
  distance: number;
}

/** Creates a fresh EntityRaycastHit suitable for passing as `out`. */
export function createEntityRaycastHit(): EntityRaycastHit {
  return { mobId: -1, distance: 0 };
}

/**
 * Ray vs a single mob's collision AABB using the slab method. Returns the
 * entry distance along the (already normalized) ray direction, or null if the
 * ray misses the box or the box is entirely behind the ray / beyond
 * `maxDistance`. A ray starting inside the box returns distance 0.
 */
function intersectAabb(
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistance: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let tMin = 0;
  let tMax = maxDistance;

  // X slab
  if (dirX === 0) {
    if (originX < minX || originX > maxX) {
      return null;
    }
  } else {
    const invD = 1 / dirX;
    let t0 = (minX - originX) * invD;
    let t1 = (maxX - originX) * invD;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) {
      return null;
    }
  }

  // Y slab
  if (dirY === 0) {
    if (originY < minY || originY > maxY) {
      return null;
    }
  } else {
    const invD = 1 / dirY;
    let t0 = (minY - originY) * invD;
    let t1 = (maxY - originY) * invD;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) {
      return null;
    }
  }

  // Z slab
  if (dirZ === 0) {
    if (originZ < minZ || originZ > maxZ) {
      return null;
    }
  } else {
    const invD = 1 / dirZ;
    let t0 = (minZ - originZ) * invD;
    let t1 = (maxZ - originZ) * invD;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) {
      return null;
    }
  }

  return tMin;
}

/**
 * Casts a ray against every live mob's collision AABB (built from its
 * definition's halfWidth/height, matching mobPhysics's `buildMobAabb`) and
 * returns the nearest hit within `maxDistance`, or null if none is hit.
 * `direction` must already be normalized (callers use the same normalized
 * direction as `lookDirection`/raycastVoxels). Allocation-free: iterates
 * `mobs` directly and writes into `out` rather than building an array.
 */
export function raycastEntities(
  origin: Vec3Like,
  direction: Vec3Like,
  maxDistance: number,
  mobs: readonly MobEntity[],
  definitionFor: (type: MobEntity['type']) => MobDefinition,
  out: EntityRaycastHit = createEntityRaycastHit(),
): EntityRaycastHit | null {
  let nearestId = -1;
  let nearestDistance = Infinity;

  for (const mob of mobs) {
    const def = definitionFor(mob.type);
    const halfWidth = def.halfWidth;
    const minX = mob.position.x - halfWidth;
    const maxX = mob.position.x + halfWidth;
    const minY = mob.position.y;
    const maxY = mob.position.y + def.height;
    const minZ = mob.position.z - halfWidth;
    const maxZ = mob.position.z + halfWidth;

    const distance = intersectAabb(
      origin.x,
      origin.y,
      origin.z,
      direction.x,
      direction.y,
      direction.z,
      maxDistance,
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
    );

    if (distance !== null && distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = mob.id;
    }
  }

  if (nearestId === -1) {
    return null;
  }

  out.mobId = nearestId;
  out.distance = nearestDistance;
  return out;
}
