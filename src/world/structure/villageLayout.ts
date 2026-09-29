import type { StructureTemplate } from './StructureTemplate';
import {
  ROTATIONS,
  horizontalReach,
  rotateOffset,
  rotatedExtent,
  type HorizontalOffset,
  type Rotation,
} from './rotation';
import { VILLAGE_HOUSE_TEMPLATES, VILLAGE_WELL_TEMPLATE } from './templates';
import { STRUCTURE_CONFIG } from '../../config/constants';

/** Inclusive world-space X/Z box (a footprint, or a 1-wide path segment). */
export interface FootprintBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** One piece of a planned village, before site validation. */
export interface VillagePieceCandidate {
  readonly template: StructureTemplate;
  readonly originX: number;
  readonly originZ: number;
  readonly rotation: Rotation;
}

/**
 * A village's pure layout (no terrain involved): the centrepiece first, then
 * the houses, plus straight axis-aligned path segments joining each house
 * entrance to the centrepiece. Paths never enter a piece footprint and
 * pieces never touch (at least one free column between footprints).
 */
export interface VillagePlan {
  readonly centreX: number;
  readonly centreZ: number;
  readonly pieces: readonly VillagePieceCandidate[];
  readonly paths: readonly FootprintBox[];
}

interface Slot {
  /** House centre offset from the village centre. */
  readonly x: number;
  readonly z: number;
  /** Door directions (unit X/Z vectors pointing toward the centre) the house may face. */
  readonly facings: readonly HorizontalOffset[];
}

const { village } = STRUCTURE_CONFIG;

/** Four axis slots (door faces straight at the centre) and four diagonal slots (door faces the centre along X or Z). */
function villageSlots(): Slot[] {
  const r = village.axisSlotDistance;
  const q = village.diagonalSlotOffset;
  const slots: Slot[] = [
    { x: r, z: 0, facings: [{ x: -1, z: 0 }] },
    { x: -r, z: 0, facings: [{ x: 1, z: 0 }] },
    { x: 0, z: r, facings: [{ x: 0, z: -1 }] },
    { x: 0, z: -r, facings: [{ x: 0, z: 1 }] },
  ];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      slots.push({ x: sx * q, z: sz * q, facings: [{ x: -sx, z: 0 }, { x: 0, z: -sz }] });
    }
  }
  return slots;
}

const SLOTS: readonly Slot[] = villageSlots();

/** Largest horizontal distance (blocks, per axis) any village block can be from the village centre. */
export function villageReach(): number {
  const houseReach = Math.max(...VILLAGE_HOUSE_TEMPLATES.map(horizontalReach));
  const slotReach = Math.max(village.axisSlotDistance, village.diagonalSlotOffset);
  return Math.max(slotReach + houseReach, horizontalReach(VILLAGE_WELL_TEMPLATE));
}

/** Upper bound on the path columns of one village (each house path is at most two segments). */
export function villageMaxPathColumns(): number {
  const reach = villageReach();
  return village.maxHouses * 2 * (reach + 1);
}

/** Door direction of a house template at rotation 0, from its footprint toward its entrance cell. */
export function entranceFacing(template: StructureTemplate): HorizontalOffset {
  const entrance = template.entrance;
  if (!entrance) {
    throw new RangeError(`entranceFacing: template '${template.id}' has no entrance.`);
  }
  if (entrance.z < 0) return { x: 0, z: -1 };
  if (entrance.z >= template.size.depth) return { x: 0, z: 1 };
  if (entrance.x < 0) return { x: -1, z: 0 };
  return { x: 1, z: 0 };
}

/** Rotation that turns `template`'s door to face `facing`. */
export function rotationFacing(template: StructureTemplate, facing: HorizontalOffset): Rotation {
  const base = entranceFacing(template);
  for (const rotation of ROTATIONS) {
    const turned = rotateOffset(base.x, base.z, rotation);
    if (turned.x === facing.x && turned.z === facing.z) {
      return rotation;
    }
  }
  throw new RangeError('rotationFacing: facing must be a unit X/Z vector.');
}

/** World cell just outside a placed house's doorway (where its path starts). */
export function entranceCell(piece: VillagePieceCandidate): HorizontalOffset {
  const { template } = piece;
  const entrance = template.entrance;
  if (!entrance) {
    throw new RangeError(`entranceCell: template '${template.id}' has no entrance.`);
  }
  const offset = rotateOffset(entrance.x - template.anchor.x, entrance.z - template.anchor.z, piece.rotation);
  return { x: piece.originX + offset.x, z: piece.originZ + offset.z };
}

/** World footprint (inclusive) of a piece. */
export function pieceFootprint(piece: VillagePieceCandidate): FootprintBox {
  const extent = rotatedExtent(piece.template, piece.rotation);
  return {
    minX: piece.originX + extent.minX,
    maxX: piece.originX + extent.maxX,
    minZ: piece.originZ + extent.minZ,
    maxZ: piece.originZ + extent.maxZ,
  };
}

function segment(ax: number, az: number, bx: number, bz: number): FootprintBox {
  return { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
}

/**
 * Path from a house entrance to the column next to the centrepiece: one
 * straight segment when the entrance already lies on a centre axis, else
 * an L (along the door direction to the centre axis, then along that axis).
 */
function housePath(entrance: HorizontalOffset, facing: HorizontalOffset, centreX: number, centreZ: number): FootprintBox[] {
  const stop = horizontalReach(VILLAGE_WELL_TEMPLATE) + 1;
  if (facing.x !== 0) {
    if (entrance.z === centreZ) {
      return [segment(entrance.x, entrance.z, centreX + Math.sign(entrance.x - centreX) * stop, centreZ)];
    }
    const targetZ = centreZ + Math.sign(entrance.z - centreZ) * stop;
    return [segment(entrance.x, entrance.z, centreX, entrance.z), segment(centreX, entrance.z, centreX, targetZ)];
  }
  if (entrance.x === centreX) {
    return [segment(entrance.x, entrance.z, centreX, centreZ + Math.sign(entrance.z - centreZ) * stop)];
  }
  const targetX = centreX + Math.sign(entrance.x - centreX) * stop;
  return [segment(entrance.x, entrance.z, entrance.x, centreZ), segment(entrance.x, centreZ, targetX, centreZ)];
}

function overlaps(a: FootprintBox, b: FootprintBox, gap: number = 0): boolean {
  return a.maxX + gap >= b.minX && b.maxX + gap >= a.minX && a.maxZ + gap >= b.minZ && b.maxZ + gap >= a.minZ;
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

function pick<T>(items: readonly T[], rng: () => number): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) {
    throw new RangeError('pick: empty list.');
  }
  return item;
}

/**
 * Plans a village around (centreX, centreZ) from `rng` (a deterministic
 * per-region PRNG): house count in [minHouses, maxHouses], shuffled slots,
 * a house design and door direction (toward the centre) per slot, and a
 * path per house. A house whose footprint (plus a 1-column gap) or path
 * would collide with an already accepted piece or path is dropped, so the
 * no-overlap guarantee holds for any slot config; returns null when fewer
 * than minHouses fit. Pure: same inputs -> same plan.
 */
export function planVillage(rng: () => number, centreX: number, centreZ: number): VillagePlan | null {
  const houseCount = village.minHouses + Math.floor(rng() * (village.maxHouses - village.minHouses + 1));
  const well: VillagePieceCandidate = {
    template: VILLAGE_WELL_TEMPLATE,
    originX: centreX,
    originZ: centreZ,
    rotation: pick(ROTATIONS, rng),
  };
  const pieces: VillagePieceCandidate[] = [well];
  const footprints: FootprintBox[] = [pieceFootprint(well)];
  const paths: FootprintBox[] = [];

  for (const slot of shuffled(SLOTS, rng)) {
    if (pieces.length > houseCount) break;
    const template = pick(VILLAGE_HOUSE_TEMPLATES, rng);
    const facing = pick(slot.facings, rng);
    const house: VillagePieceCandidate = {
      template,
      originX: centreX + slot.x,
      originZ: centreZ + slot.z,
      rotation: rotationFacing(template, facing),
    };
    const footprint = pieceFootprint(house);
    const route = housePath(entranceCell(house), facing, centreX, centreZ);
    const blocked =
      footprints.some((f) => overlaps(f, footprint, 1)) ||
      paths.some((p) => overlaps(p, footprint)) ||
      route.some((p) => overlaps(p, footprint) || footprints.some((f) => overlaps(f, p)));
    if (blocked) continue;
    pieces.push(house);
    footprints.push(footprint);
    paths.push(...route);
  }

  if (pieces.length - 1 < village.minHouses) {
    return null;
  }
  return { centreX, centreZ, pieces, paths };
}
