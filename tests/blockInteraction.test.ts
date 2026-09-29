import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG, PLAYER_CONFIG } from '../src/config/constants';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import { ChunkStore } from '../src/world/ChunkStore';
import { createSolidQuery } from '../src/world/SolidQuery';
import { createTargetQuery } from '../src/world/TargetQuery';
import { raycastBlock } from '../src/world/voxelRaycast';
import { FaceDirection } from '../src/world/mesher/faces';
import type { VoxelRaycastBlockHit } from '../src/world/voxelRaycast';
import { tryBreakBlock, tryPlaceBlock, DEFAULT_PLACE_BLOCK } from '../src/gameplay/blockInteraction';
import { createPlayerState } from '../src/player/PlayerState';
import { stepPlayer, type MovementInput } from '../src/player/playerPhysics';
import { playerAabb } from '../src/player/voxelCollision';

const { chunkHeight } = WORLD_CONFIG;

/** Builds a synthetic hit at (x,y,z) with the given block id and distance; place position = +Y face. */
function hitAt(
  x: number,
  y: number,
  z: number,
  blockId: number,
  overrides: Partial<VoxelRaycastBlockHit> = {},
): VoxelRaycastBlockHit {
  return {
    x,
    y,
    z,
    distance: 1,
    face: FaceDirection.NegY,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    hasPlacePosition: true,
    placeX: x,
    placeY: y + 1,
    placeZ: z,
    blockId,
    ...overrides,
  };
}

describe('tryBreakBlock', () => {
  it('breaks a solid block (Stone -> Air)', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone);
    const change = tryBreakBlock(store, blockRegistry, hit);
    expect(change).not.toBeNull();
    expect(change?.next).toBe(BlockId.Air);
    expect(store.getBlock(1, 1, 1)).toBe(BlockId.Air);
  });

  it('breaks a targetable transparent block (Glass -> Air)', () => {
    const store = new ChunkStore();
    store.setBlock(2, 2, 2, BlockId.Glass);
    const hit = hitAt(2, 2, 2, BlockId.Glass);
    const change = tryBreakBlock(store, blockRegistry, hit);
    expect(change).not.toBeNull();
    expect(store.getBlock(2, 2, 2)).toBe(BlockId.Air);
  });

  it('cannot break Air (null hit)', () => {
    const store = new ChunkStore();
    const change = tryBreakBlock(store, blockRegistry, null);
    expect(change).toBeNull();
  });

  it('cannot break an Air cell even with a (stale) hit pointing at it', () => {
    const store = new ChunkStore();
    const hit = hitAt(3, 3, 3, BlockId.Stone); // stale: store has no block here
    const change = tryBreakBlock(store, blockRegistry, hit);
    expect(change).toBeNull();
  });

  it('cannot break Water (non-targetable)', () => {
    const store = new ChunkStore();
    store.setBlock(4, 4, 4, BlockId.Water);
    const hit = hitAt(4, 4, 4, BlockId.Water);
    const change = tryBreakBlock(store, blockRegistry, hit);
    expect(change).toBeNull();
    expect(store.getBlock(4, 4, 4)).toBe(BlockId.Water);
  });

  it('beyond max range returns null', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone, { distance: 100 });
    const change = tryBreakBlock(store, blockRegistry, hit, PLAYER_CONFIG.interactionDistance);
    expect(change).toBeNull();
  });

  it('outside height range returns null', () => {
    const store = new ChunkStore();
    const hit = hitAt(0, chunkHeight, 0, BlockId.Stone);
    const change = tryBreakBlock(store, blockRegistry, hit);
    expect(change).toBeNull();
  });

  it('negative coordinates work', () => {
    const store = new ChunkStore();
    store.setBlock(-5, 1, -5, BlockId.Stone);
    const hit = hitAt(-5, 1, -5, BlockId.Stone);
    const change = tryBreakBlock(store, blockRegistry, hit);
    expect(change).not.toBeNull();
    expect(store.getBlock(-5, 1, -5)).toBe(BlockId.Air);
  });
});

describe('tryPlaceBlock: basic placement', () => {
  it('places adjacent to the hit using placeX/Y/Z', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone); // place position: (1,2,1)
    const playerBox = playerAabb(createPlayerState({ x: 50, y: 50, z: 50 }));
    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change).not.toBeNull();
    expect(store.getBlock(1, 2, 1)).toBe(DEFAULT_PLACE_BLOCK);
  });

  it('cannot place into an occupied (non-Air) cell', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    store.setBlock(1, 2, 1, BlockId.Dirt); // target already occupied
    const hit = hitAt(1, 1, 1, BlockId.Stone);
    const playerBox = playerAabb(createPlayerState({ x: 50, y: 50, z: 50 }));
    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change).toBeNull();
    expect(store.getBlock(1, 2, 1)).toBe(BlockId.Dirt);
  });

  // Regression: with generated seas, "Air only" made building underwater impossible.
  it('places into a Water cell (Water is replaceable)', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    store.setBlock(1, 2, 1, BlockId.Water);
    const hit = hitAt(1, 1, 1, BlockId.Stone);
    const playerBox = playerAabb(createPlayerState({ x: 50, y: 50, z: 50 }));
    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change?.previous).toBe(BlockId.Water);
    expect(store.getBlock(1, 2, 1)).toBe(DEFAULT_PLACE_BLOCK);
  });

  it('cannot place outside height range (top face at chunkHeight-1)', () => {
    const store = new ChunkStore();
    store.setBlock(1, chunkHeight - 1, 1, BlockId.Stone);
    const hit = hitAt(1, chunkHeight - 1, 1, BlockId.Stone, {
      face: FaceDirection.NegY,
      normalY: 1,
      placeX: 1,
      placeY: chunkHeight,
      placeZ: 1,
    });
    const playerBox = playerAabb(createPlayerState({ x: 50, y: 50, z: 50 }));
    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change).toBeNull();
  });

  it('beyond max range returns null', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone, { distance: 100 });
    const playerBox = playerAabb(createPlayerState({ x: 50, y: 50, z: 50 }));
    const change = tryPlaceBlock(
      store,
      blockRegistry,
      hit,
      DEFAULT_PLACE_BLOCK,
      playerBox,
      PLAYER_CONFIG.interactionDistance,
    );
    expect(change).toBeNull();
  });

  it('hit without a place position (inside-block) returns null', () => {
    const store = new ChunkStore();
    store.setBlock(1, 1, 1, BlockId.Stone);
    const hit = hitAt(1, 1, 1, BlockId.Stone, { face: null, hasPlacePosition: false });
    const playerBox = playerAabb(createPlayerState({ x: 50, y: 50, z: 50 }));
    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change).toBeNull();
  });

  it('negative coordinates work', () => {
    const store = new ChunkStore();
    store.setBlock(-5, 1, -5, BlockId.Stone);
    const hit = hitAt(-5, 1, -5, BlockId.Stone); // place at (-5,2,-5)
    const playerBox = playerAabb(createPlayerState({ x: 50, y: 50, z: 50 }));
    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change).not.toBeNull();
    expect(store.getBlock(-5, 2, -5)).toBe(DEFAULT_PLACE_BLOCK);
  });
});

describe('tryPlaceBlock: player overlap', () => {
  it('cannot place a solid block overlapping the player box (feet cell)', () => {
    const store = new ChunkStore();
    // Player standing with feet at (0,0,0): AABB spans y in [0, height].
    const state = createPlayerState({ x: 0.5, y: 0, z: 0.5 });
    const playerBox = playerAabb(state);

    store.setBlock(0, -1, 0, BlockId.Stone); // a wall block below-adjacent to break from
    const hit = hitAt(0, -1, 0, BlockId.Stone, {
      face: FaceDirection.PosY,
      normalY: 1,
      placeX: 0,
      placeY: 0, // overlaps the player's feet cell
      placeZ: 0,
    });

    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change).toBeNull();
  });

  it('cannot place a solid block overlapping the player box (head cell, crouch respected)', () => {
    const store = new ChunkStore();
    const state = createPlayerState({ x: 0.5, y: 0, z: 0.5 });
    state.crouching = true;
    const playerBox = playerAabb(state); // crouchHeight, shorter than standing height

    // Standing height would overlap y=1 too, but with crouch the box top is
    // lower; pick a cell just above the crouch height to prove it's excluded.
    const cellY = Math.floor(playerBox.maxY) + 1;
    store.setBlock(0, cellY - 1, 0, BlockId.Stone);
    const hit = hitAt(0, cellY - 1, 0, BlockId.Stone, {
      face: FaceDirection.NegY,
      normalY: 1,
      placeX: 0,
      placeY: cellY,
      placeZ: 0,
    });

    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change).not.toBeNull(); // clear of the (shorter, crouched) player box
  });

  it('CAN place touching the player box (adjacent cell, faces only touch)', () => {
    const store = new ChunkStore();
    // Player width is 0.6, so centering at x=1 puts the box's -X face exactly
    // at x=0.7 — not on an integer boundary. Instead, pick a player x whose
    // box's minX lands exactly on an integer: half-width 0.3, so x=1.3 gives
    // minX=1.0 exactly.
    const state = createPlayerState({ x: 1.3, y: 0, z: 1.3 });
    const playerBox = playerAabb(state);
    expect(playerBox.minX).toBeCloseTo(1, 9);

    // Cell [0,1) x [0,height) x [0,1) touches the player box's -X face at
    // x=1 exactly (shares a boundary) but does not overlap it.
    store.setBlock(-2, 0, 1, BlockId.Stone); // block to break from, off to the side
    const hit = hitAt(-2, 0, 1, BlockId.Stone, {
      face: FaceDirection.PosX,
      normalX: 1,
      normalY: 0,
      placeX: 0,
      placeY: 0,
      placeZ: 1,
    });

    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change).not.toBeNull();
    expect(store.getBlock(0, 0, 1)).toBe(DEFAULT_PLACE_BLOCK);
  });
});

function baseInput(overrides: Partial<MovementInput> = {}): MovementInput {
  return {
    forward: 0,
    right: 0,
    jump: false,
    sprint: false,
    crouch: false,
    lookDeltaX: 0,
    lookDeltaY: 0,
    ...overrides,
  };
}

describe('regression: break/place interact live with collision and raycast', () => {
  it('breaking the block under a standing player makes them fall (onGround false after a step)', () => {
    const store = new ChunkStore();
    store.setBlock(0, 0, 0, BlockId.Stone);
    const isSolid = createSolidQuery(store, blockRegistry);

    const state = createPlayerState({ x: 0.5, y: 1, z: 0.5 });
    state.onGround = true;
    stepPlayer(state, baseInput(), 1 / 60, isSolid);
    expect(state.onGround).toBe(true); // still resting before the break

    const hit: VoxelRaycastBlockHit = hitAt(0, 0, 0, BlockId.Stone);
    const change = tryBreakBlock(store, blockRegistry, hit);
    expect(change).not.toBeNull();

    // Collision reads live from the store, so the very next step sees no
    // floor and the player is no longer resting.
    stepPlayer(state, baseInput(), 1 / 60, isSolid);
    expect(state.onGround).toBe(false);
  });

  it('placing a wall block blocks horizontal movement immediately', () => {
    const store = new ChunkStore();
    for (let x = -1; x <= 6; x += 1) {
      store.setBlock(x, 0, 0, BlockId.Stone); // floor strip the player walks along
    }
    store.setBlock(0, 0, 5, BlockId.Stone); // a separate block to break-target for the place hit
    const isSolid = createSolidQuery(store, blockRegistry);

    const state = createPlayerState({ x: 0.5, y: 1, z: 0.5 });
    state.onGround = true;

    const hit: VoxelRaycastBlockHit = hitAt(0, 0, 5, BlockId.Stone, {
      face: FaceDirection.NegY,
      normalY: 1,
      placeX: 3,
      placeY: 1,
      placeZ: 0,
    });
    const playerBox = playerAabb(state);
    const change = tryPlaceBlock(store, blockRegistry, hit, DEFAULT_PLACE_BLOCK, playerBox);
    expect(change).not.toBeNull();
    expect(store.getBlock(3, 1, 0)).toBe(DEFAULT_PLACE_BLOCK);

    // Walk toward +X; the newly placed block at x=3 should stop the player.
    state.yaw = -Math.PI / 2; // forward => +X
    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput({ forward: 1 }), 1 / 60, isSolid);
    }
    const expectedX = 3 - PLAYER_CONFIG.width / 2;
    expect(state.position.x).toBeCloseTo(expectedX, 3);
  });

  it('raycastBlock after a break returns the block behind, or null past it', () => {
    const store = new ChunkStore();
    store.setBlock(2, 0, 0, BlockId.Stone);
    store.setBlock(4, 0, 0, BlockId.Stone);
    const isTargetable = createTargetQuery(store, blockRegistry);

    const before = raycastBlock(store, blockRegistry, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10);
    expect(before?.x).toBe(2);

    const change = tryBreakBlock(store, blockRegistry, before);
    expect(change).not.toBeNull();

    const after = raycastBlock(store, blockRegistry, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10);
    expect(after?.x).toBe(4); // the block behind the broken one

    const changeBehind = tryBreakBlock(store, blockRegistry, after);
    expect(changeBehind).not.toBeNull();

    const finalHit = raycastBlock(store, blockRegistry, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10, undefined, isTargetable);
    expect(finalHit).toBeNull(); // nothing targetable left within range
  });
});
