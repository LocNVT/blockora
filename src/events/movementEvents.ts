import { AUDIO_CONFIG } from '../config/constants';
import type { GameEventSink } from './GameEvents';

/** Player state sampled once per physics step, after collision resolution. */
export interface MovementSample {
  readonly x: number;
  readonly z: number;
  readonly onGround: boolean;
  readonly crouching: boolean;
  readonly sprinting: boolean;
  readonly inFluid: boolean;
  /** Vertical speed going into this step (negative = falling). */
  readonly velocityYBefore: number;
  readonly jumped: boolean;
  /** Block under the player's feet. */
  readonly surfaceBlockId: number;
}

/** A single-frame jump larger than this (blocks) is a teleport (respawn), not walking. */
const TELEPORT_DISTANCE = 4;

/**
 * Turns player movement into footstep / jump / land events. Footsteps are
 * stride based: one per `stride` blocks walked while grounded (not per frame,
 * none while airborne or swimming); the stride is shorter when crouching and
 * longer when sprinting.
 */
export class MovementEventTracker {
  private lastX: number | null = null;
  private lastZ = 0;
  private walked = 0;
  private wasOnGround = true;

  constructor(private readonly sink: GameEventSink) {}

  /** Forget position / stride state (respawn, teleport). */
  reset(): void {
    this.lastX = null;
    this.walked = 0;
    this.wasOnGround = true;
  }

  update(s: MovementSample): void {
    const moved = this.lastX === null ? 0 : Math.hypot(s.x - this.lastX, s.z - this.lastZ);
    this.lastX = s.x;
    this.lastZ = s.z;

    if (s.jumped && this.wasOnGround && !s.inFluid) {
      this.sink.emit({ type: 'jump', blockId: s.surfaceBlockId });
    }
    if (s.onGround && !this.wasOnGround && !s.inFluid) {
      const fallSpeed = -s.velocityYBefore;
      if (fallSpeed >= AUDIO_CONFIG.landMinSpeed) {
        this.sink.emit({ type: 'land', blockId: s.surfaceBlockId, fallSpeed });
      }
      this.walked = 0;
    }
    this.wasOnGround = s.onGround;

    if (!s.onGround || s.inFluid || moved > TELEPORT_DISTANCE) {
      return;
    }
    this.walked += moved;
    const stride = strideLength(s.sprinting, s.crouching);
    if (this.walked >= stride) {
      this.walked -= stride;
      this.sink.emit({ type: 'footstep', blockId: s.surfaceBlockId, sprinting: s.sprinting, crouching: s.crouching });
    }
  }
}

/** Blocks walked per footstep for the current gait. */
export function strideLength(sprinting: boolean, crouching: boolean): number {
  if (crouching) {
    return AUDIO_CONFIG.strideCrouch;
  }
  return sprinting ? AUDIO_CONFIG.strideSprint : AUDIO_CONFIG.strideWalk;
}
