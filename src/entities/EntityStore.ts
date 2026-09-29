import type { MobType } from './mobDefinitions';

/** Plain 3D vector (no Three.js dependency in simulation code). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type AiState = 'idle' | 'wander';

/** Small AI scratch state, mutated in place by mobAI.ts. */
export interface MobAiState {
  state: AiState;
  /** Seconds remaining in the current state. */
  timer: number;
  /** Yaw (radians) the mob is turning toward while wandering. */
  targetYaw: number;
}

/** A single passive/hostile mob entity: plain data, mutated in place by the mob systems. */
export interface MobEntity {
  readonly id: number;
  readonly type: MobType;
  readonly position: Vec3;
  readonly velocity: Vec3;
  yaw: number;
  onGround: boolean;
  readonly ai: MobAiState;
  /** Seconds this mob has existed; not currently used for despawn, but kept for future tuning/debug. */
  age: number;
}

/**
 * Owns every live mob entity: spawning, removal, and lookup. Plain data
 * store — no Three.js, no DOM, no AI/physics logic (see mobAI.ts/
 * mobPhysics.ts/mobSpawning.ts). Backed by an array + id-to-index map so
 * `all()` is allocation-free and removal is O(1) (swap-with-last).
 */
export class EntityStore {
  private readonly entities: MobEntity[] = [];
  private readonly indexById = new Map<number, number>();
  private nextId = 1;

  /** Creates and stores a new mob of `type` at `position`, deterministic monotonically increasing id. */
  spawn(type: MobType, position: Vec3, initialYaw = 0): MobEntity {
    const entity: MobEntity = {
      id: this.nextId,
      type,
      position: { ...position },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: initialYaw,
      onGround: false,
      ai: { state: 'idle', timer: 0, targetYaw: initialYaw },
      age: 0,
    };
    this.nextId += 1;
    this.indexById.set(entity.id, this.entities.length);
    this.entities.push(entity);
    return entity;
  }

  /** Removes the mob with `id`, if present. Returns whether an entity was actually removed. */
  remove(id: number): boolean {
    const index = this.indexById.get(id);
    if (index === undefined) {
      return false;
    }

    const lastIndex = this.entities.length - 1;
    const last = this.entities[lastIndex];
    if (last === undefined) {
      return false;
    }

    this.entities[index] = last;
    this.indexById.set(last.id, index);
    this.entities.pop();
    this.indexById.delete(id);
    return true;
  }

  get(id: number): MobEntity | undefined {
    const index = this.indexById.get(id);
    return index === undefined ? undefined : this.entities[index];
  }

  /** Read-only view of every live mob. Order is not guaranteed to be stable across removals. */
  all(): readonly MobEntity[] {
    return this.entities;
  }

  /** Number of live mobs, optionally filtered to a single `type`. */
  count(type?: MobType): number {
    if (type === undefined) {
      return this.entities.length;
    }
    let total = 0;
    for (const entity of this.entities) {
      if (entity.type === type) {
        total += 1;
      }
    }
    return total;
  }

  clear(): void {
    this.entities.length = 0;
    this.indexById.clear();
  }
}
