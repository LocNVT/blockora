import { describe, it, expect } from 'vitest';
import { createPlayerState } from '../src/player/PlayerState';
import { stepPlayer, type MovementInput } from '../src/player/playerPhysics';
import { PLAYER_CONFIG } from '../src/config/constants';
import { ChunkStore } from '../src/world/ChunkStore';
import { createSolidQuery } from '../src/world/SolidQuery';
import { blockRegistry } from '../src/world/BlockRegistry';
import { BlockId } from '../src/world/blocks';
import type { SolidQuery } from '../src/world/SolidQuery';

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

/** Infinite flat floor: solid at y=0 everywhere, nothing else. */
const flatFloor: SolidQuery = (_x, y, _z) => y === 0;

describe('standing on a block', () => {
  it('stays resting, onGround true over many frames, no jitter/sinking', () => {
    const state = createPlayerState({ x: 0, y: 1, z: 0 });
    state.onGround = true;

    const positions: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      stepPlayer(state, baseInput(), 1 / 60, flatFloor);
      positions.push(state.position.y);
      expect(state.onGround).toBe(true);
    }

    for (const y of positions) {
      expect(y).toBeCloseTo(1, 3);
    }
  });
});

describe('falling onto a block', () => {
  it('lands exactly on top from height, velocity.y zeroed', () => {
    const state = createPlayerState({ x: 0, y: 10, z: 0 });
    state.onGround = false;

    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput(), 1 / 60, flatFloor);
    }

    expect(state.position.y).toBeCloseTo(1, 3);
    expect(state.velocity.y).toBe(0);
    expect(state.onGround).toBe(true);
  });
});

describe('horizontal collision against a wall', () => {
  function wallAt(wallX: number): SolidQuery {
    return (x, y, _z) => y === 0 || x === wallX;
  }

  it('stops flush at the wall face on +X approach', () => {
    const isSolid = wallAt(5);
    const state = createPlayerState({ x: 0, y: 1, z: 0 });
    state.onGround = true;
    state.yaw = -Math.PI / 2; // forward => +X

    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput({ forward: 1 }), 1 / 60, isSolid);
    }

    // Half-width away from the wall's face at x=5 (block occupies [5,6)).
    const expectedX = 5 - PLAYER_CONFIG.width / 2;
    expect(state.position.x).toBeLessThanOrEqual(expectedX + 1e-6);
    expect(state.position.x).toBeCloseTo(expectedX, 3);
  });

  it('stops flush at the wall face on -X approach', () => {
    const isSolid = wallAt(-5);
    const state = createPlayerState({ x: 0, y: 1, z: 0 });
    state.onGround = true;
    state.yaw = Math.PI / 2; // forward => -X

    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput({ forward: 1 }), 1 / 60, isSolid);
    }

    // Block occupies [-5,-4); the far face the player hits is at x=-4.
    const expectedX = -4 + PLAYER_CONFIG.width / 2;
    expect(state.position.x).toBeGreaterThanOrEqual(expectedX - 1e-6);
    expect(state.position.x).toBeCloseTo(expectedX, 3);
  });

  it('stops flush at the wall face on +Z approach', () => {
    const isSolid: SolidQuery = (_x, y, z) => y === 0 || z === 5;
    const state = createPlayerState({ x: 0, y: 1, z: 0 });
    state.onGround = true;
    state.yaw = Math.PI; // forward => +Z

    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput({ forward: 1 }), 1 / 60, isSolid);
    }

    const expectedZ = 5 - PLAYER_CONFIG.width / 2;
    expect(state.position.z).toBeCloseTo(expectedZ, 3);
  });

  it('stops flush at the wall face on -Z approach', () => {
    const isSolid: SolidQuery = (_x, y, z) => y === 0 || z === -5;
    const state = createPlayerState({ x: 0, y: 1, z: 0 });
    state.onGround = true;

    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput({ forward: 1 }), 1 / 60, isSolid);
    }

    const expectedZ = -4 + PLAYER_CONFIG.width / 2;
    expect(state.position.z).toBeCloseTo(expectedZ, 3);
  });
});

describe('ceiling collision while jumping', () => {
  it('zeroes velocity.y and keeps the head below the ceiling', () => {
    // Ceiling clears the resting head height (1 + 1.8 = 2.8) so the player
    // starts un-collided and only hits it once the jump carries them up.
    const ceilingY = 3;
    const isSolid: SolidQuery = (_x, y, _z) => y === 0 || y === ceilingY;
    const state = createPlayerState({ x: 0, y: 1, z: 0 });
    state.onGround = true;

    let hitCeiling = false;
    for (let i = 0; i < 60; i += 1) {
      stepPlayer(state, baseInput({ jump: state.onGround }), 1 / 60, isSolid);
      const headY = state.position.y + PLAYER_CONFIG.height;
      expect(headY).toBeLessThanOrEqual(ceilingY + 1e-6);
      // Once the head is flush against the ceiling (within the collision
      // skin epsilon), the collision must have zeroed the upward velocity.
      if (headY > ceilingY - PLAYER_CONFIG.collisionEpsilon * 2) {
        hitCeiling = true;
        expect(state.velocity.y).toBe(0);
      }
    }

    expect(hitCeiling).toBe(true);
  });
});

describe('moving across block boundaries on a flat floor', () => {
  it('does not snag on seams; position progresses smoothly', () => {
    const state = createPlayerState({ x: 0, y: 1, z: 0 });
    state.onGround = true;
    state.yaw = -Math.PI / 2; // forward => +X, crossing integer block seams

    let lastX = state.position.x;
    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput({ forward: 1 }), 1 / 60, flatFloor);
      expect(state.position.x).toBeGreaterThanOrEqual(lastX - 1e-9);
      lastX = state.position.x;
    }

    expect(state.position.x).toBeGreaterThan(5);
    expect(state.onGround).toBe(true);
  });
});

describe('negative world coordinates', () => {
  it('floor at negative x/z supports the player', () => {
    const state = createPlayerState({ x: -50, y: 10, z: -50 });
    state.onGround = false;

    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput(), 1 / 60, flatFloor);
    }

    expect(state.position.y).toBeCloseTo(1, 3);
    expect(state.onGround).toBe(true);
  });

  it('a wall at negative x blocks horizontal movement', () => {
    const isSolid: SolidQuery = (x, y, _z) => y === 0 || x === -10;
    const state = createPlayerState({ x: -20, y: 1, z: 0 });
    state.onGround = true;
    state.yaw = -Math.PI / 2; // forward => +X, approaching the wall from -20

    for (let i = 0; i < 400; i += 1) {
      stepPlayer(state, baseInput({ forward: 1 }), 1 / 60, isSolid);
    }

    const expectedX = -10 - PLAYER_CONFIG.width / 2;
    expect(state.position.x).toBeCloseTo(expectedX, 3);
  });
});

describe('non-solid blocks', () => {
  it('Water/Air/Torch do not collide (real BlockRegistry + ChunkStore)', () => {
    const store = new ChunkStore();
    store.setBlock(0, 0, 0, BlockId.Stone); // solid floor directly under spawn
    store.setBlock(0, 1, 0, BlockId.Water);
    store.setBlock(0, 2, 0, BlockId.Torch);
    // (0,3,0) left as Air.
    const isSolid = createSolidQuery(store, blockRegistry);

    const state = createPlayerState({ x: 0.5, y: 10, z: 0.5 });
    state.onGround = false;

    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput(), 1 / 60, isSolid);
    }

    // Only the Stone at y=0 is solid, so the player rests at y=1, passing
    // freely through where Water/Torch/Air were on the way down.
    expect(state.position.y).toBeCloseTo(1, 3);
    expect(state.onGround).toBe(true);
  });
});

describe('ground detection', () => {
  it('is false while airborne and true once resting on a block', () => {
    const state = createPlayerState({ x: 0, y: 10, z: 0 });
    state.onGround = false;

    stepPlayer(state, baseInput(), 1 / 60, flatFloor);
    expect(state.onGround).toBe(false);

    for (let i = 0; i < 300; i += 1) {
      stepPlayer(state, baseInput(), 1 / 60, flatFloor);
    }
    expect(state.onGround).toBe(true);
  });
});

describe('empty space', () => {
  it('free-falls with no collision when nothing is solid', () => {
    const noSolid: SolidQuery = () => false;
    const state = createPlayerState({ x: 0, y: 10, z: 0 });
    state.onGround = false;

    for (let i = 0; i < 60; i += 1) {
      stepPlayer(state, baseInput(), 1 / 60, noSolid);
    }

    expect(state.position.y).toBeLessThan(10);
    expect(state.onGround).toBe(false);
    expect(state.velocity.y).toBeLessThan(0);
  });
});

describe('large dt clamp', () => {
  it('does not tunnel through a 1-block floor even with a huge raw dt', () => {
    // Without the maxFrameDelta clamp, a single dt=10 step would fall
    // ~1800 blocks (0.5*18*10^2) in one substep-free jump, tunneling through
    // any floor. stepPlayer clamps dt internally, so repeated huge-dt calls
    // (as if the tab stalled every frame) still land on top, never through.
    const state = createPlayerState({ x: 0, y: 50, z: 0 });
    state.onGround = false;

    let minYSeen = state.position.y;
    for (let i = 0; i < 50; i += 1) {
      stepPlayer(state, baseInput(), 10, flatFloor);
      minYSeen = Math.min(minYSeen, state.position.y);
      if (state.onGround) {
        break;
      }
    }

    // Never dipped below the floor's top surface (y=1): no tunneling.
    expect(minYSeen).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(state.position.y).toBeCloseTo(1, 3);
    expect(state.velocity.y).toBe(0);
    expect(state.onGround).toBe(true);
  });
});

describe('determinism', () => {
  it('same inputs produce identical resulting state', () => {
    const run = (): ReturnType<typeof createPlayerState> => {
      const state = createPlayerState({ x: 0, y: 5, z: 0 });
      state.onGround = false;
      for (let i = 0; i < 150; i += 1) {
        stepPlayer(state, baseInput({ forward: 1, sprint: i % 7 === 0 }), 1 / 60, flatFloor);
      }
      return state;
    };

    const a = run();
    const b = run();

    expect(a.position).toEqual(b.position);
    expect(a.velocity).toEqual(b.velocity);
    expect(a.onGround).toBe(b.onGround);
  });
});
