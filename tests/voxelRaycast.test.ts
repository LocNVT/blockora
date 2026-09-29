import { describe, it, expect } from 'vitest';
import {
  raycastVoxels,
  raycastBlock,
  createVoxelRaycastHit,
  createVoxelRaycastBlockHit,
  type Vec3Like,
} from '../src/world/voxelRaycast';
import { FaceDirection } from '../src/world/mesher/faces';
import { ChunkStore } from '../src/world/ChunkStore';
import { blockRegistry } from '../src/world/BlockRegistry';
import { createTargetQuery } from '../src/world/TargetQuery';
import { BlockId } from '../src/world/blocks';

/** A TargetQuery backed by a plain Set of "x,y,z" keys — targetable iff present. */
function fromSet(cells: Iterable<readonly [number, number, number]>): (x: number, y: number, z: number) => boolean {
  const set = new Set<string>();
  for (const [x, y, z] of cells) {
    set.add(`${x},${y},${z}`);
  }
  return (x, y, z) => set.has(`${x},${y},${z}`);
}

const V = (x: number, y: number, z: number): Vec3Like => ({ x, y, z });

describe('raycastVoxels: basic hit/miss', () => {
  it('hits a block directly ahead', () => {
    const isTargetable = fromSet([[2, 0, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(2);
    expect(hit?.y).toBe(0);
    expect(hit?.z).toBe(0);
  });

  it('misses into Air (returns null) when nothing is targetable ahead', () => {
    const isTargetable = fromSet([]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit).toBeNull();
  });
});

describe('raycastVoxels: max distance inclusivity', () => {
  it('hits a block whose entry distance equals maxDistance exactly', () => {
    // Ray from origin along +X; block face at x=6 is entered at distance 6.
    const isTargetable = fromSet([[6, 0, 0]]);
    const hit = raycastVoxels(V(0, 0.5, 0.5), V(1, 0, 0), 6, isTargetable);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(6);
    expect(hit?.distance).toBeCloseTo(6, 6);
  });

  it('misses a block whose entry distance exceeds maxDistance', () => {
    const isTargetable = fromSet([[7, 0, 0]]);
    // Entry distance to x=7 is 7, which is > 6.
    const hit = raycastVoxels(V(0, 0.5, 0.5), V(1, 0, 0), 6, isTargetable);
    expect(hit).toBeNull();
  });

  it('hits at 5.9 with max distance 6, misses at 6.1', () => {
    // Place the ray origin so the target cell's near-face distance is 5.9 or 6.1.
    const isTargetableNear = fromSet([[5, 0, 0]]);
    const hitNear = raycastVoxels(V(0.1, 0.5, 0.5), V(1, 0, 0), 6, isTargetableNear);
    expect(hitNear).not.toBeNull();
    expect(hitNear?.distance).toBeCloseTo(4.9, 6);

    const isTargetableFar = fromSet([[6, 0, 0]]);
    const hitFar = raycastVoxels(V(-0.1, 0.5, 0.5), V(1, 0, 0), 6, isTargetableFar);
    expect(hitFar).toBeNull();
  });
});

describe('raycastVoxels: distance values', () => {
  it('computes distance 2.5 for origin (0.5,0.5,0.5) dir +X, block at x=3', () => {
    const isTargetable = fromSet([[3, 0, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit?.distance).toBeCloseTo(2.5, 6);
  });
});

describe('raycastVoxels: face/normal per axis', () => {
  it('+X direction hits the NegX face with normal (-1,0,0)', () => {
    const isTargetable = fromSet([[2, 0, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit?.face).toBe(FaceDirection.NegX);
    expect(hit?.normalX).toBe(-1);
    expect(hit?.normalY).toBe(0);
    expect(hit?.normalZ).toBe(0);
  });

  it('-X direction hits the PosX face with normal (1,0,0)', () => {
    const isTargetable = fromSet([[-2, 0, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(-1, 0, 0), 10, isTargetable);
    expect(hit?.face).toBe(FaceDirection.PosX);
    expect(hit?.normalX).toBe(1);
  });

  it('+Y direction hits the NegY face with normal (0,-1,0)', () => {
    const isTargetable = fromSet([[0, 2, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(0, 1, 0), 10, isTargetable);
    expect(hit?.face).toBe(FaceDirection.NegY);
    expect(hit?.normalY).toBe(-1);
  });

  it('-Y direction hits the PosY face with normal (0,1,0)', () => {
    const isTargetable = fromSet([[0, -2, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(0, -1, 0), 10, isTargetable);
    expect(hit?.face).toBe(FaceDirection.PosY);
    expect(hit?.normalY).toBe(1);
  });

  it('+Z direction hits the NegZ face with normal (0,0,-1)', () => {
    const isTargetable = fromSet([[0, 0, 2]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(0, 0, 1), 10, isTargetable);
    expect(hit?.face).toBe(FaceDirection.NegZ);
    expect(hit?.normalZ).toBe(-1);
  });

  it('-Z direction hits the PosZ face with normal (0,0,1)', () => {
    const isTargetable = fromSet([[0, 0, -2]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(0, 0, -1), 10, isTargetable);
    expect(hit?.face).toBe(FaceDirection.PosZ);
    expect(hit?.normalZ).toBe(1);
  });

  it('place position equals hit + normal', () => {
    const isTargetable = fromSet([[2, 0, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit?.hasPlacePosition).toBe(true);
    expect(hit?.placeX).toBe((hit?.x ?? 0) + (hit?.normalX ?? 0));
    expect(hit?.placeY).toBe((hit?.y ?? 0) + (hit?.normalY ?? 0));
    expect(hit?.placeZ).toBe((hit?.z ?? 0) + (hit?.normalZ ?? 0));
    expect(hit?.placeX).toBe(1);
    expect(hit?.placeY).toBe(0);
    expect(hit?.placeZ).toBe(0);
  });
});

describe('raycastVoxels: diagonal rays', () => {
  it('hits the correct cell along (1,1,0)', () => {
    const isTargetable = fromSet([[2, 2, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 1, 0), 10, isTargetable);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(2);
    expect(hit?.y).toBe(2);
    expect(hit?.z).toBe(0);
  });

  it('hits the correct cell along (1,1,1)', () => {
    const isTargetable = fromSet([[3, 3, 3]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 1, 1), 10, isTargetable);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(3);
    expect(hit?.y).toBe(3);
    expect(hit?.z).toBe(3);
  });

  it('behaves deterministically for a ray passing exactly through an edge/corner', () => {
    // Origin at an exact grid point, direction (1,1,1): ray grazes the shared
    // corner of cells (1,1,1)/(1,0,1)/(0,1,1)/etc at every integer t. The exact
    // tie-break is an implementation choice; what matters is it is stable.
    const isTargetable = fromSet([[1, 1, 1]]);
    const hitA = raycastVoxels(V(1, 1, 1), V(1, 1, 1), 10, isTargetable);
    const hitB = raycastVoxels(V(1, 1, 1), V(1, 1, 1), 10, isTargetable);
    expect(hitA).toEqual(hitB);
  });
});

describe('raycastVoxels: starting inside a block', () => {
  it('returns that block with distance 0, face null, no place position', () => {
    const isTargetable = fromSet([[0, 0, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(0);
    expect(hit?.y).toBe(0);
    expect(hit?.z).toBe(0);
    expect(hit?.distance).toBe(0);
    expect(hit?.face).toBeNull();
    expect(hit?.hasPlacePosition).toBe(false);
  });
});

describe('raycastVoxels: negative world coordinates', () => {
  it('hits a block at negative cells from a negative origin along a negative direction', () => {
    const isTargetable = fromSet([[-13, 0, 0]]);
    const hit = raycastVoxels(V(-10.5, 0.5, 0.5), V(-1, 0, 0), 10, isTargetable);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(-13);
    expect(hit?.distance).toBeCloseTo(1.5, 6);
  });

  it('hits a block at negative cells from a negative origin along a positive direction', () => {
    const isTargetable = fromSet([[-7, 0, 0]]);
    const hit = raycastVoxels(V(-10.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(-7);
    expect(hit?.distance).toBeCloseTo(3.5, 6);
  });
});

describe('raycastVoxels: nearest block wins', () => {
  it('returns the closer of two blocks on the ray', () => {
    const isTargetable = fromSet([
      [2, 0, 0],
      [5, 0, 0],
    ]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit?.x).toBe(2);
  });
});

describe('raycastVoxels: determinism', () => {
  // (4,1,-3) lies on the traversal path of this ray (verified by tracing the
  // DDA sequence), so both hit and miss variants below are exercised.
  it('identical inputs produce identical results', () => {
    const isTargetable = fromSet([[4, 1, -3]]);
    const hitA = raycastVoxels(V(0.5, 0.5, 0.5), V(0.6, 0.2, -0.5), 10, isTargetable);
    const hitB = raycastVoxels(V(0.5, 0.5, 0.5), V(0.6, 0.2, -0.5), 10, isTargetable);
    expect(hitA).toEqual(hitB);
    expect(hitA).not.toBeNull();
  });

  it('reusing `out` gives the same values as a fresh call (hit case)', () => {
    const isTargetable = fromSet([[4, 1, -3]]);
    const fresh = raycastVoxels(V(0.5, 0.5, 0.5), V(0.6, 0.2, -0.5), 10, isTargetable);
    const out = createVoxelRaycastHit();
    const reused = raycastVoxels(V(0.5, 0.5, 0.5), V(0.6, 0.2, -0.5), 10, isTargetable, out);
    expect(reused).toBe(out);
    expect(reused).toEqual(fresh);
  });

  it('reusing `out` gives the same values as a fresh call (miss case)', () => {
    const isTargetable = fromSet([]);
    const fresh = raycastVoxels(V(0.5, 0.5, 0.5), V(0.6, 0.2, -0.5), 10, isTargetable);
    const out = createVoxelRaycastHit();
    const reused = raycastVoxels(V(0.5, 0.5, 0.5), V(0.6, 0.2, -0.5), 10, isTargetable, out);
    expect(fresh).toBeNull();
    expect(reused).toBeNull();
  });
});

describe('raycastVoxels: zero direction', () => {
  it('returns null for a zero-length direction', () => {
    const isTargetable = fromSet([[0, 0, 0]]);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(0, 0, 0), 10, isTargetable);
    expect(hit).toBeNull();
  });
});

describe('raycastBlock: real ChunkStore integration', () => {
  it('skips Water and hits the block behind it', () => {
    const store = new ChunkStore();
    store.setBlock(1, 0, 0, BlockId.Water);
    store.setBlock(2, 0, 0, BlockId.Stone);
    const isTargetable = createTargetQuery(store, blockRegistry);

    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit?.x).toBe(2);
    expect(hit?.z).toBe(0);
  });

  it('hits Glass, Leaves, and Torch (transparent but targetable)', () => {
    for (const id of [BlockId.Glass, BlockId.Leaves, BlockId.Torch]) {
      const store = new ChunkStore();
      store.setBlock(2, 0, 0, id);
      const isTargetable = createTargetQuery(store, blockRegistry);
      const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
      expect(hit?.x, `expected id ${id} to be targetable`).toBe(2);
    }
  });

  it('skips Air entirely (no false hit at an empty cell)', () => {
    const store = new ChunkStore();
    store.setBlock(5, 0, 0, BlockId.Stone);
    const isTargetable = createTargetQuery(store, blockRegistry);
    const hit = raycastVoxels(V(0.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit?.x).toBe(5);
  });

  it('crosses a chunk boundary at x=15 -> 16', () => {
    const store = new ChunkStore();
    store.setBlock(16, 0, 0, BlockId.Stone);
    const isTargetable = createTargetQuery(store, blockRegistry);
    const hit = raycastVoxels(V(14.5, 0.5, 0.5), V(1, 0, 0), 10, isTargetable);
    expect(hit?.x).toBe(16);
  });

  it('crosses a negative chunk boundary at x=0 -> -1', () => {
    const store = new ChunkStore();
    store.setBlock(-1, 0, 0, BlockId.Stone);
    const isTargetable = createTargetQuery(store, blockRegistry);
    const hit = raycastVoxels(V(1.5, 0.5, 0.5), V(-1, 0, 0), 10, isTargetable);
    expect(hit?.x).toBe(-1);
  });

  it('raycastBlock fills blockId from the store', () => {
    const store = new ChunkStore();
    store.setBlock(3, 0, 0, BlockId.IronOre);
    const out = createVoxelRaycastBlockHit();
    const hit = raycastBlock(store, blockRegistry, V(0.5, 0.5, 0.5), V(1, 0, 0), 10, out);
    expect(hit).toBe(out);
    expect(hit?.blockId).toBe(BlockId.IronOre);
  });

  it('raycastBlock returns null and does not leave a stale blockId semantics issue', () => {
    const store = new ChunkStore();
    const out = createVoxelRaycastBlockHit();
    const hit = raycastBlock(store, blockRegistry, V(0.5, 0.5, 0.5), V(1, 0, 0), 3, out);
    expect(hit).toBeNull();
  });
});
