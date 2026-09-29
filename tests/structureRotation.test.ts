import { describe, it, expect } from 'vitest';
import {
  ROTATIONS,
  horizontalReach,
  inverseRotation,
  rotateOffset,
  rotatedExtent,
  toRotation,
  type Rotation,
} from '../src/world/structure/rotation';
import { parseLayers, type StructureTemplate } from '../src/world/structure/StructureTemplate';
import { RUIN_TEMPLATE, STRUCTURE_TEMPLATES } from '../src/world/structure/templates';
import { BlockId } from '../src/world/blocks';
import { BiomeId } from '../src/world/biome/Biome';

/** Asymmetric 3x2x2 template (anchor off-centre) so rotation bugs can't hide behind symmetry. */
const ASYMMETRIC: StructureTemplate = {
  id: 'test-asym',
  size: { width: 3, height: 2, depth: 2 },
  anchor: { x: 0, y: 0, z: 0 },
  blocks: parseLayers(
    { width: 3, height: 2, depth: 2 },
    [
      ['CC.', 'C  '],
      [' C ', '   '],
    ],
    {
      C: { blockId: BlockId.Cobblestone, mode: 'force' },
      '.': { blockId: BlockId.Air, mode: 'force' },
    },
  ),
  allowedBiomes: [BiomeId.Plains],
};

describe('rotateOffset', () => {
  it('maps (2, 1) through each quarter turn', () => {
    expect(rotateOffset(2, 1, 0)).toEqual({ x: 2, z: 1 });
    expect(rotateOffset(2, 1, 1)).toEqual({ x: -1, z: 2 });
    expect(rotateOffset(2, 1, 2)).toEqual({ x: -2, z: -1 });
    expect(rotateOffset(2, 1, 3)).toEqual({ x: 1, z: -2 });
  });

  it('keeps the anchor fixed and never produces -0', () => {
    for (const r of ROTATIONS) {
      const o = rotateOffset(0, 0, r);
      expect(Object.is(o.x, 0)).toBe(true);
      expect(Object.is(o.z, 0)).toBe(true);
    }
  });

  it('round-trips: rotation then its inverse, and four quarter turns, are the identity', () => {
    for (let x = -4; x <= 4; x += 1) {
      for (let z = -4; z <= 4; z += 1) {
        for (const r of ROTATIONS) {
          const turned = rotateOffset(x, z, r);
          const back = rotateOffset(turned.x, turned.z, inverseRotation(r));
          expect(back).toEqual({ x, z });
        }
        let p = { x, z };
        for (let i = 0; i < 4; i += 1) {
          p = rotateOffset(p.x, p.z, 1);
        }
        expect(p).toEqual({ x, z });
      }
    }
  });

  it('composes: two single turns equal one half turn', () => {
    const once = rotateOffset(3, -2, 1);
    expect(rotateOffset(once.x, once.z, 1)).toEqual(rotateOffset(3, -2, 2));
  });

  it('preserves distance from the anchor (rigid rotation)', () => {
    for (const r of ROTATIONS) {
      const o = rotateOffset(5, -3, r);
      expect(o.x * o.x + o.z * o.z).toBe(34);
    }
  });
});

describe('toRotation / inverseRotation', () => {
  it('normalises any integer turn count, including negatives', () => {
    expect(toRotation(0)).toBe(0);
    expect(toRotation(5)).toBe(1);
    expect(toRotation(-1)).toBe(3);
    expect(toRotation(8)).toBe(0);
  });

  it('inverse of each rotation sums to a full turn', () => {
    for (const r of ROTATIONS) {
      expect((r + inverseRotation(r)) % 4).toBe(0);
    }
  });
});

describe('rotatedExtent', () => {
  it('contains every rotated block offset and is tight (touched on all four sides)', () => {
    for (const template of [ASYMMETRIC, RUIN_TEMPLATE]) {
      for (const r of ROTATIONS) {
        const extent = rotatedExtent(template, r);
        const corners = [
          [0, 0],
          [template.size.width - 1, template.size.depth - 1],
        ].map(([x, z]) => rotateOffset(x! - template.anchor.x, z! - template.anchor.z, r));
        expect(Math.min(...corners.map((c) => c.x))).toBe(extent.minX);
        expect(Math.max(...corners.map((c) => c.x))).toBe(extent.maxX);
        expect(Math.min(...corners.map((c) => c.z))).toBe(extent.minZ);
        expect(Math.max(...corners.map((c) => c.z))).toBe(extent.maxZ);

        for (const b of template.blocks) {
          const o = rotateOffset(b.dx - template.anchor.x, b.dz - template.anchor.z, r);
          expect(o.x).toBeGreaterThanOrEqual(extent.minX);
          expect(o.x).toBeLessThanOrEqual(extent.maxX);
          expect(o.z).toBeGreaterThanOrEqual(extent.minZ);
          expect(o.z).toBeLessThanOrEqual(extent.maxZ);
        }
      }
    }
  });

  it('swaps width and depth for 90/270 degree rotations', () => {
    const size = (r: Rotation): { w: number; d: number } => {
      const e = rotatedExtent(ASYMMETRIC, r);
      return { w: e.maxX - e.minX + 1, d: e.maxZ - e.minZ + 1 };
    };
    expect(size(0)).toEqual({ w: 3, d: 2 });
    expect(size(1)).toEqual({ w: 2, d: 3 });
    expect(size(2)).toEqual({ w: 3, d: 2 });
    expect(size(3)).toEqual({ w: 2, d: 3 });
  });

  it('never rotates a block further than horizontalReach from the anchor', () => {
    const reach = horizontalReach(ASYMMETRIC);
    expect(reach).toBe(2);
    for (const r of ROTATIONS) {
      const e = rotatedExtent(ASYMMETRIC, r);
      expect(Math.max(-e.minX, e.maxX, -e.minZ, e.maxZ)).toBeLessThanOrEqual(reach);
    }
  });

  it('maps distinct template cells to distinct rotated cells (no collisions)', () => {
    for (const r of ROTATIONS) {
      const keys = new Set(
        ASYMMETRIC.blocks.map((b) => {
          const o = rotateOffset(b.dx, b.dz, r);
          return `${o.x},${b.dy},${o.z}`;
        }),
      );
      expect(keys.size).toBe(ASYMMETRIC.blocks.length);
    }
  });
});

describe('parseLayers', () => {
  const legend = { C: { blockId: BlockId.Cobblestone, mode: 'force' as const } };
  const size = { width: 2, height: 1, depth: 1 };

  it('skips spaces and records coordinates per character', () => {
    expect(parseLayers(size, [['C ']], legend)).toEqual([
      { dx: 0, dy: 0, dz: 0, blockId: BlockId.Cobblestone, mode: 'force' },
    ]);
  });

  it('rejects unknown characters and mismatched dimensions', () => {
    expect(() => parseLayers(size, [['CX']], legend)).toThrow(RangeError);
    expect(() => parseLayers(size, [['CCC']], legend)).toThrow(RangeError);
    expect(() => parseLayers(size, [['CC', 'CC']], legend)).toThrow(RangeError);
    expect(() => parseLayers(size, [], legend)).toThrow(RangeError);
  });
});

describe('ruin template', () => {
  it('is registered and every block lies within its declared size', () => {
    expect(STRUCTURE_TEMPLATES).toContain(RUIN_TEMPLATE);
    const { width, height, depth } = RUIN_TEMPLATE.size;
    for (const b of RUIN_TEMPLATE.blocks) {
      expect(b.dx).toBeGreaterThanOrEqual(0);
      expect(b.dx).toBeLessThan(width);
      expect(b.dy).toBeGreaterThanOrEqual(0);
      expect(b.dy).toBeLessThan(height);
      expect(b.dz).toBeGreaterThanOrEqual(0);
      expect(b.dz).toBeLessThan(depth);
    }
  });

  it('uses only existing ruin materials, carves an interior and has a foundation', () => {
    const allowed: BlockId[] = [
      BlockId.Air,
      BlockId.Cobblestone,
      BlockId.Stone,
      BlockId.Planks,
      BlockId.Gravel,
    ];
    for (const b of RUIN_TEMPLATE.blocks) {
      expect(allowed).toContain(b.blockId);
    }
    expect(RUIN_TEMPLATE.blocks.some((b) => b.blockId === BlockId.Air)).toBe(true);
    expect(RUIN_TEMPLATE.foundationBlock).toBe(BlockId.Cobblestone);
  });

  it('is a broken ruin: the floor layer has holes and the collapsed corner has no wall', () => {
    const { width, depth } = RUIN_TEMPLATE.size;
    const floor = RUIN_TEMPLATE.blocks.filter((b) => b.dy === RUIN_TEMPLATE.anchor.y);
    expect(floor.length).toBeLessThan(width * depth);
    const corner = RUIN_TEMPLATE.blocks.filter(
      (b) => b.dx === width - 1 && b.dz === depth - 1 && b.blockId !== BlockId.Air,
    );
    expect(corner).toEqual([]);
  });

  it('spawns only in plains, forest and desert', () => {
    expect([...RUIN_TEMPLATE.allowedBiomes].sort()).toEqual(
      [BiomeId.Plains, BiomeId.Forest, BiomeId.Desert].sort(),
    );
  });
});
