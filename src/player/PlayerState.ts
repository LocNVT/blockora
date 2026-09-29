/** Mutable 3D vector of plain numbers (no Three.js dependency in simulation code). */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Plain-data player simulation state. Position is the feet position (not the
 * eye/camera position), so ground clamping and physics stay simple.
 */
export interface PlayerState {
  position: Vector3Like;
  velocity: Vector3Like;
  /** Horizontal look angle, radians. */
  yaw: number;
  /** Vertical look angle, radians, clamped to +-(PI/2 - epsilon). */
  pitch: number;
  onGround: boolean;
  crouching: boolean;
}

/** Creates a fresh player state at the given feet position and initial look pitch (radians). */
export function createPlayerState(position: Vector3Like, pitch = 0): PlayerState {
  return {
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch,
    onGround: false,
    crouching: false,
  };
}
