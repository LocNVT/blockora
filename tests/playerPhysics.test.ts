import { describe, it, expect } from 'vitest';
import { createPlayerState } from '../src/player/PlayerState';
import { stepPlayer, type MovementInput } from '../src/player/playerPhysics';
import { PLAYER_CONFIG } from '../src/config/constants';

// Solid floor block spans y in [0, 1), so the resting surface (feet height) is y=1.
const GROUND_Y = 1;
/** Solid floor at y=0 (blocks occupy [0,1)); flat, infinite in x/z. */
const flatGround = (_x: number, y: number, _z: number): boolean => y === 0;

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

describe('stepPlayer', () => {
  it('walks forward at ~walkSpeed after 1s', () => {
    const state = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    state.onGround = true;
    const input = baseInput({ forward: 1 });

    // Step in small increments to keep dt under maxFrameDelta clamp.
    const steps = 20;
    const dtPerStep = 1 / steps;
    for (let i = 0; i < steps; i += 1) {
      stepPlayer(state, input, dtPerStep, flatGround);
    }

    const distance = Math.hypot(state.position.x, state.position.z);
    expect(distance).toBeCloseTo(PLAYER_CONFIG.walkSpeed, 1);
  });

  it('sprints faster than walking', () => {
    const walkState = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    walkState.onGround = true;
    const sprintState = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    sprintState.onGround = true;

    const dt = 0.05;
    for (let i = 0; i < 20; i += 1) {
      stepPlayer(walkState, baseInput({ forward: 1 }), dt, flatGround);
      stepPlayer(sprintState, baseInput({ forward: 1, sprint: true }), dt, flatGround);
    }

    const walkDist = Math.hypot(walkState.position.x, walkState.position.z);
    const sprintDist = Math.hypot(sprintState.position.x, sprintState.position.z);
    expect(sprintDist).toBeGreaterThan(walkDist);
  });

  it('crouches slower than walking', () => {
    const walkState = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    walkState.onGround = true;
    const crouchState = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    crouchState.onGround = true;

    const dt = 0.05;
    for (let i = 0; i < 20; i += 1) {
      stepPlayer(walkState, baseInput({ forward: 1 }), dt, flatGround);
      stepPlayer(crouchState, baseInput({ forward: 1, crouch: true }), dt, flatGround);
    }

    const walkDist = Math.hypot(walkState.position.x, walkState.position.z);
    const crouchDist = Math.hypot(crouchState.position.x, crouchState.position.z);
    expect(crouchDist).toBeLessThan(walkDist);
  });

  it('diagonal movement is not faster than straight movement', () => {
    const straightState = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    straightState.onGround = true;
    const diagonalState = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    diagonalState.onGround = true;

    const dt = 0.05;
    for (let i = 0; i < 20; i += 1) {
      stepPlayer(straightState, baseInput({ forward: 1 }), dt, flatGround);
      stepPlayer(diagonalState, baseInput({ forward: 1, right: 1 }), dt, flatGround);
    }

    const straightDist = Math.hypot(straightState.position.x, straightState.position.z);
    const diagonalDist = Math.hypot(diagonalState.position.x, diagonalState.position.z);
    expect(diagonalDist).toBeCloseTo(straightDist, 5);
  });

  it('gravity pulls the player down and lands on the ground, setting onGround', () => {
    const state = createPlayerState({ x: 0, y: GROUND_Y + 5, z: 0 });
    state.onGround = false;

    for (let i = 0; i < 200; i += 1) {
      stepPlayer(state, baseInput(), 1 / 60, flatGround);
    }

    // Collision resolution keeps a small skin epsilon (PLAYER_CONFIG.collisionEpsilon)
    // between the player and the block face, so allow that much tolerance.
    expect(state.position.y).toBeCloseTo(GROUND_Y, 3);
    expect(state.onGround).toBe(true);
    expect(state.velocity.y).toBe(0);
  });

  it('jumps only when grounded', () => {
    const airborneState = createPlayerState({ x: 0, y: GROUND_Y + 5, z: 0 });
    airborneState.onGround = false;
    stepPlayer(airborneState, baseInput({ jump: true }), 1 / 60, flatGround);
    // Velocity should reflect gravity only, not the jump impulse, since not grounded.
    expect(airborneState.velocity.y).toBeLessThan(PLAYER_CONFIG.jumpVelocity);
    expect(airborneState.velocity.y).toBeLessThan(0);

    const groundedState = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    groundedState.onGround = true;
    stepPlayer(groundedState, baseInput({ jump: true }), 1 / 60, flatGround);
    expect(groundedState.onGround).toBe(false);
    expect(groundedState.velocity.y).toBeGreaterThan(0);
  });

  // Regression: jumpVelocity=5/gravity=18 gave an apex of ~0.69 blocks, too low
  // to clear a 1-unit step — the player would bonk into it and never climb.
  it('jump apex clears a 1-unit step', () => {
    const state = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    state.onGround = true;
    stepPlayer(state, baseInput({ jump: true }), 1 / 60, flatGround);

    let apexY = state.position.y;
    for (let i = 0; i < 200; i += 1) {
      stepPlayer(state, baseInput(), 1 / 60, flatGround);
      apexY = Math.max(apexY, state.position.y);
    }

    expect(apexY - GROUND_Y).toBeGreaterThan(1);
  });

  it('clamps dt to avoid tunneling after large frame gaps', () => {
    const clampedState = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    clampedState.onGround = true;
    stepPlayer(clampedState, baseInput({ forward: 1 }), 10, flatGround);

    const unclampedEquivalent = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    unclampedEquivalent.onGround = true;
    stepPlayer(unclampedEquivalent, baseInput({ forward: 1 }), PLAYER_CONFIG.maxFrameDelta, flatGround);

    expect(clampedState.position.z).toBeCloseTo(unclampedEquivalent.position.z, 10);
  });

  // Regression: first-frame rAF timestamps can precede THREE.Timer's start, giving dt < 0,
  // which reversed gravity and pushed an airborne player upward.
  it('treats negative dt as zero (no reversed gravity or movement)', () => {
    const state = createPlayerState({ x: 0, y: GROUND_Y + 3, z: 0 });
    stepPlayer(state, baseInput({ forward: 1 }), -0.025, flatGround);

    expect(state.position.y).toBe(GROUND_Y + 3);
    expect(state.position.z).toBe(0);
    expect(state.velocity.y).toBeLessThanOrEqual(0);
  });

  it('yaw rotates the movement direction', () => {
    const state = createPlayerState({ x: 0, y: GROUND_Y, z: 0 });
    state.onGround = true;
    state.yaw = Math.PI / 2;

    stepPlayer(state, baseInput({ forward: 1 }), 0.1, flatGround);

    // At yaw = PI/2, "forward" should move along -X instead of -Z.
    expect(state.position.x).toBeLessThan(-0.1);
    expect(Math.abs(state.position.z)).toBeLessThan(0.01);
  });
});
