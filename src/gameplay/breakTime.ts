import type { BlockDefinition } from '../world/blocks';
import type { ToolProperties } from '../items/items';
import { BREAK_CONFIG } from '../config/constants';

/**
 * Whether `tool` can harvest `blockDef` (i.e. breaking it yields its drop).
 * A block with no `requiresTool` is always harvestable (hand or any tool).
 * A block with `requiresTool` needs a tool whose type matches the block's
 * `toolType` (tier is not checked yet — see `minTier` future work).
 */
export function canHarvest(blockDef: BlockDefinition, tool: ToolProperties | undefined): boolean {
  if (!blockDef.requiresTool) {
    return true;
  }
  return tool !== undefined && tool.type === blockDef.toolType;
}

/**
 * Seconds required to break `blockDef` with `tool` (undefined = bare hand).
 * Instant (0) for hardness 0. Otherwise: hardness * harvestMultiplier when
 * harvestable, else hardness * noHarvestMultiplier (still eventually breaks,
 * just slower and — for `requiresTool` blocks — without a drop). When the
 * held tool's type matches the block's `toolType`, the result is further
 * divided by the tool's `speed`.
 */
export function breakDuration(blockDef: BlockDefinition, tool: ToolProperties | undefined): number {
  if (blockDef.hardness <= 0) {
    return 0;
  }

  const harvestable = canHarvest(blockDef, tool);
  const multiplier = harvestable ? BREAK_CONFIG.harvestMultiplier : BREAK_CONFIG.noHarvestMultiplier;
  let duration = blockDef.hardness * multiplier;

  if (tool !== undefined && tool.type === blockDef.toolType) {
    duration /= tool.speed;
  }

  return duration;
}

/** Progress state a single ongoing break action can be in, returned by `BreakProgress.update`. */
export type BreakState = 'idle' | 'breaking' | 'broken';

interface BreakTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function sameTarget(a: BreakTarget | null, b: BreakTarget | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Pure per-frame accumulator for a single "hold to break" action. Call
 * `update` once per frame with the current raycast target, whether the break
 * button is held, the frame's dt, and the target block's `breakDuration`.
 * Resets whenever the target changes, is released, or becomes null.
 */
export class BreakProgress {
  private accumulated = 0;
  private target: BreakTarget | null = null;

  /** Fraction 0..1 of the current target's break duration accumulated so far. */
  get progress(): number {
    return this.lastDuration <= 0 ? 0 : Math.min(1, this.accumulated / this.lastDuration);
  }

  private lastDuration = 0;

  private reset(): void {
    this.accumulated = 0;
    this.target = null;
    this.lastDuration = 0;
  }

  update(target: BreakTarget | null, held: boolean, dt: number, duration: number): BreakState {
    const clampedDt = Math.max(0, dt);

    if (!held || target === null) {
      this.reset();
      return 'idle';
    }

    if (!sameTarget(this.target, target)) {
      this.accumulated = 0;
      this.target = target;
    }

    this.lastDuration = duration;
    this.accumulated += clampedDt;

    if (this.accumulated >= duration) {
      this.reset();
      return 'broken';
    }

    return 'breaking';
  }
}
