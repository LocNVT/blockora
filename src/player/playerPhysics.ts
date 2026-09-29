import { PLAYER_CONFIG } from '../config/constants';
import type { SolidQuery } from '../world/SolidQuery';
import { resolveVoxelCollision, wouldStandingCollide } from './voxelCollision';
import type { PlayerState } from './PlayerState';

/** Per-frame movement/look input, sampled from InputController. */
export interface MovementInput {
  /** -1..1, forward(+)/backward(-) along look yaw. */
  forward: number;
  /** -1..1, right(+)/left(-) strafe relative to look yaw. */
  right: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  /** Accumulated pointer movement since the last step, in pixels. */
  lookDeltaX: number;
  lookDeltaY: number;
}

type PlayerConfig = typeof PLAYER_CONFIG;

const HALF_PI = Math.PI / 2;

function currentSpeed(input: MovementInput, config: PlayerConfig): number {
  if (input.crouch) {
    return config.crouchSpeed;
  }
  if (input.sprint) {
    return config.sprintSpeed;
  }
  return config.walkSpeed;
}

function clampPitch(pitch: number, config: PlayerConfig): number {
  const limit = HALF_PI - config.pitchEpsilon;
  return Math.min(limit, Math.max(-limit, pitch));
}

/**
 * Pure simulation step: advances look angles, horizontal movement, gravity,
 * and jumping, then resolves the resulting displacement against solid voxel
 * blocks via `isSolid`. Mutates and returns the same `state` object (callers
 * that want immutability should clone first).
 */
export function stepPlayer(
  state: PlayerState,
  input: MovementInput,
  dt: number,
  isSolid: SolidQuery,
  config: PlayerConfig = PLAYER_CONFIG
): PlayerState {
  // Clamp to [0, maxFrameDelta]: negative deltas (e.g. a first-frame rAF timestamp
  // earlier than the timer's start) would otherwise reverse gravity and movement.
  const clampedDt = Math.min(Math.max(dt, 0), config.maxFrameDelta);

  state.yaw -= input.lookDeltaX * config.mouseSensitivity;
  state.pitch = clampPitch(state.pitch - input.lookDeltaY * config.mouseSensitivity, config);

  const requestedCrouch = input.crouch;
  // Do not let uncrouching push the player's head into a ceiling: only
  // stand up if the standing AABB is clear.
  state.crouching = requestedCrouch || (state.crouching && wouldStandingCollide(state, isSolid, config));

  const speed = currentSpeed(input, config);
  let moveX = 0;
  let moveZ = 0;
  if (input.forward !== 0 || input.right !== 0) {
    const length = Math.hypot(input.forward, input.right) || 1;
    const normForward = input.forward / length;
    const normRight = input.right / length;

    const sinYaw = Math.sin(state.yaw);
    const cosYaw = Math.cos(state.yaw);
    // Forward is -Z at yaw 0; right is +X at yaw 0.
    moveX = (-sinYaw * normForward + cosYaw * normRight) * speed;
    moveZ = (-cosYaw * normForward - sinYaw * normRight) * speed;
  }

  if (input.jump && state.onGround) {
    state.velocity.y = config.jumpVelocity;
    state.onGround = false;
  }

  state.velocity.y = Math.max(state.velocity.y - config.gravity * clampedDt, -config.maxFallSpeed);

  const deltaX = moveX * clampedDt;
  const deltaY = state.velocity.y * clampedDt;
  const deltaZ = moveZ * clampedDt;

  const { onGround } = resolveVoxelCollision(state, deltaX, deltaY, deltaZ, isSolid, config);
  state.onGround = onGround;

  return state;
}
