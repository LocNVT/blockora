import type { StructureTemplate } from './StructureTemplate';

/** Quarter turns around +Y: 0 = 0°, 1 = 90°, 2 = 180°, 3 = 270°. */
export type Rotation = 0 | 1 | 2 | 3;

export const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

export interface HorizontalOffset {
  readonly x: number;
  readonly z: number;
}

/** Horizontal bounds (inclusive) of a rotated template, relative to its anchor. */
export interface HorizontalExtent {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** `0 - v` rather than `-v`, so rotating a 0 offset never yields -0. */
function negate(v: number): number {
  return 0 - v;
}

/**
 * Rotates an anchor-relative X/Z offset by `rotation` quarter turns
 * ((x, z) -> (-z, x) per turn). Pure; four turns are the identity.
 */
export function rotateOffset(x: number, z: number, rotation: Rotation): HorizontalOffset {
  switch (rotation) {
    case 0:
      return { x, z };
    case 1:
      return { x: negate(z), z: x };
    case 2:
      return { x: negate(x), z: negate(z) };
    case 3:
      return { x: z, z: negate(x) };
  }
}

/** Rotation that undoes `rotation`. */
export function inverseRotation(rotation: Rotation): Rotation {
  return ((4 - rotation) % 4) as Rotation;
}

/** Normalises any integer quarter-turn count into a Rotation. */
export function toRotation(quarterTurns: number): Rotation {
  return ((((Math.floor(quarterTurns) % 4) + 4) % 4) as Rotation);
}

/** Anchor-relative horizontal bounds of `template` after rotation (a rotated rectangle stays a rectangle). */
export function rotatedExtent(template: StructureTemplate, rotation: Rotation): HorizontalExtent {
  const { size, anchor } = template;
  const a = rotateOffset(0 - anchor.x, 0 - anchor.z, rotation);
  const b = rotateOffset(size.width - 1 - anchor.x, size.depth - 1 - anchor.z, rotation);
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
  };
}

/** Largest horizontal distance (blocks, per axis) any block of `template` can be from its anchor, over all rotations. */
export function horizontalReach(template: StructureTemplate): number {
  const { size, anchor } = template;
  return Math.max(anchor.x, size.width - 1 - anchor.x, anchor.z, size.depth - 1 - anchor.z);
}
