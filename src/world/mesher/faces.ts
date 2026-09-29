/**
 * The 6 axis-aligned face directions of a unit cube, zero-allocation lookup
 * table driving the mesher's inner loop. Kept free of Three.js so this module
 * can run in a Worker.
 */
export const FaceDirection = {
  PosX: 0,
  NegX: 1,
  PosY: 2,
  NegY: 3,
  PosZ: 4,
  NegZ: 5,
} as const;

export type FaceDirection = (typeof FaceDirection)[keyof typeof FaceDirection];

export interface FaceCorner {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type Axis = 'x' | 'y' | 'z';

export interface FaceDescriptor {
  readonly direction: FaceDirection;
  /** Outward-pointing unit normal. */
  readonly normal: readonly [number, number, number];
  /**
   * The 4 corners of the unit-cube face, in CCW order as viewed from outside
   * the cube (from along +normal looking back at the origin). Triangulated
   * as (0,1,2) and (0,2,3), this winding points outward.
   */
  readonly corners: readonly [FaceCorner, FaceCorner, FaceCorner, FaceCorner];
  /** Which local axis a quad's `width` argument extends along (in-plane, corner value 0/1). */
  readonly widthAxis: Axis;
  /** Which local axis a quad's `height` argument extends along (in-plane, corner value 0/1). */
  readonly heightAxis: Axis;
}

/**
 * Indexed by FaceDirection (0..5). Corner order was chosen so that, for a
 * unit cube occupying [0,1]^3, each face's two triangles wind
 * counter-clockwise when viewed from outside the cube along -normal.
 */
export const FACES: readonly FaceDescriptor[] = [
  {
    direction: FaceDirection.PosX,
    normal: [1, 0, 0],
    corners: [
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    widthAxis: 'z',
    heightAxis: 'y',
  },
  {
    direction: FaceDirection.NegX,
    normal: [-1, 0, 0],
    corners: [
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
    widthAxis: 'z',
    heightAxis: 'y',
  },
  {
    direction: FaceDirection.PosY,
    normal: [0, 1, 0],
    corners: [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 0 },
    ],
    widthAxis: 'x',
    heightAxis: 'z',
  },
  {
    direction: FaceDirection.NegY,
    normal: [0, -1, 0],
    corners: [
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ],
    widthAxis: 'x',
    heightAxis: 'z',
  },
  {
    direction: FaceDirection.PosZ,
    normal: [0, 0, 1],
    corners: [
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 1, z: 1 },
      { x: 0, y: 0, z: 1 },
    ],
    widthAxis: 'x',
    heightAxis: 'y',
  },
  {
    direction: FaceDirection.NegZ,
    normal: [0, 0, -1],
    corners: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    widthAxis: 'x',
    heightAxis: 'y',
  },
];

/** Neighbour offset (dx, dy, dz) for a face direction, used for visibility sampling. */
export const FACE_NORMAL_OFFSET: readonly (readonly [number, number, number])[] = FACES.map(
  (f) => f.normal,
);
