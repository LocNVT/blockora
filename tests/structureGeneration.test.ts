import { describe, it, expect } from 'vitest';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { StructurePlacer, type PlacedStructure } from '../src/world/structure/StructurePlacer';
import { RUIN_TEMPLATE } from '../src/world/structure/templates';
import { structureBlockWorldPosition } from '../src/world/structure/stampStructure';
import { BlockId } from '../src/world/blocks';
import type { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import { blockRegistry } from '../src/world/BlockRegistry';
import { computeSpawnPosition, resolveSpawnHeight } from '../src/player/spawn';
import { chunkKey, worldToChunkCoord, worldToLocal } from '../src/world/chunkCoords';
import { STRUCTURE_CONFIG, WORLD_CONFIG, WORLD_GEN_CONFIG } from '../src/config/constants';

const SEED = WORLD_GEN_CONFIG.defaultSeed;
const REGION_BLOCKS = STRUCTURE_CONFIG.regionSizeChunks * WORLD_CONFIG.chunkWidth;
const SEARCH_REGIONS = 6;

/** Validated structures in a square of regions around the origin, in scan order. */
function placedStructures(seed: number): PlacedStructure[] {
  const placer = new StructurePlacer(seed, new WorldGenerator(seed));
  return placer.structuresIntersecting(
    -SEARCH_REGIONS * REGION_BLOCKS,
    -SEARCH_REGIONS * REGION_BLOCKS,
    SEARCH_REGIONS * REGION_BLOCKS - 1,
    SEARCH_REGIONS * REGION_BLOCKS - 1,
  );
}

interface ChunkSpan {
  readonly coords: readonly { readonly cx: number; readonly cz: number }[];
}

function chunksCovering(s: PlacedStructure): ChunkSpan {
  const from = worldToChunkCoord(s.minX, s.minZ);
  const to = worldToChunkCoord(s.maxX, s.maxZ);
  const coords: { cx: number; cz: number }[] = [];
  for (let cx = from.cx; cx <= to.cx; cx += 1) {
    for (let cz = from.cz; cz <= to.cz; cz += 1) {
      coords.push({ cx, cz });
    }
  }
  return { coords };
}

function blockAt(chunks: ReadonlyMap<string, Chunk>, x: number, y: number, z: number): number {
  const { cx, cz } = worldToChunkCoord(x, z);
  const chunk = chunks.get(chunkKey(cx, cz));
  if (!chunk) throw new Error(`chunk ${cx},${cz} not generated`);
  const local = worldToLocal(x, y, z);
  return chunk.getBlock(local.x, local.y, local.z);
}

function generateAll(
  gen: WorldGenerator,
  coords: readonly { readonly cx: number; readonly cz: number }[],
): Map<string, Chunk> {
  const map = new Map<string, Chunk>();
  for (const { cx, cz } of coords) {
    map.set(chunkKey(cx, cz), gen.generateChunk(cx, cz));
  }
  return map;
}

/** World-space snapshot of every cell in the structure's footprint box (+1 margin) from floor-depth to top. */
function snapshot(chunks: ReadonlyMap<string, Chunk>, s: PlacedStructure): number[] {
  const out: number[] = [];
  const bottom = s.originY - STRUCTURE_CONFIG.maxFoundationDepth - 1;
  const top = s.originY + s.template.size.height;
  for (let x = s.minX; x <= s.maxX; x += 1) {
    for (let z = s.minZ; z <= s.maxZ; z += 1) {
      for (let y = bottom; y <= top; y += 1) {
        out.push(blockAt(chunks, x, y, z));
      }
    }
  }
  return out;
}

// Ruin-specific fixtures: dungeons and village pieces share the region grid; see dungeon.test.ts / village.test.ts.
const structures = placedStructures(SEED).filter((s) => s.template === RUIN_TEMPLATE);
const fourChunkRuin = structures.find((s) => chunksCovering(s).coords.length === 4);

describe('structure generation', () => {
  it('finds ruins around the default seed, including one spanning 4 chunks', () => {
    expect(structures.length).toBeGreaterThan(0);
    expect(fourChunkRuin).toBeDefined();
  });

  it('has a ruin within ~200 blocks of the default-seed spawn', () => {
    const spawn = computeSpawnPosition(new WorldGenerator(SEED)).position;
    const nearest = Math.min(
      ...structures.map((s) => Math.hypot(s.originX - spawn.x, s.originZ - spawn.z)),
    );
    expect(nearest).toBeLessThanOrEqual(200);
  });

  it('writes the ruin blocks at the placed location in generated chunks', () => {
    const s = fourChunkRuin!;
    const chunks = generateAll(new WorldGenerator(SEED), chunksCovering(s).coords);
    for (const block of s.template.blocks) {
      const p = structureBlockWorldPosition(s, block);
      const actual = blockAt(chunks, p.x, p.y, p.z);
      if (block.mode === 'force') {
        expect(actual).toBe(block.blockId);
      } else {
        expect(actual).not.toBe(BlockId.Air);
      }
    }
  });

  it('supports every solid floor block with foundation down to the terrain (never floats)', () => {
    const gen = new WorldGenerator(SEED);
    for (const s of structures.slice(0, 4)) {
      const chunks = generateAll(gen, chunksCovering(s).coords);
      for (const block of s.template.blocks) {
        if (block.dy !== s.template.anchor.y || block.blockId === BlockId.Air) continue;
        const p = structureBlockWorldPosition(s, block);
        const surface = gen.surfaceHeight(p.x, p.z);
        expect(surface).toBeLessThan(p.y);
        for (let y = surface + 1; y < p.y; y += 1) {
          expect(blockAt(chunks, p.x, y, p.z)).toBe(s.template.foundationBlock);
        }
      }
    }
  });

  it('never alters terrain at or below any footprint column surface', () => {
    const gen = new WorldGenerator(SEED);
    const s = fourChunkRuin!;
    const chunks = generateAll(gen, chunksCovering(s).coords);
    for (let x = s.minX; x <= s.maxX; x += 1) {
      for (let z = s.minZ; z <= s.maxZ; z += 1) {
        const surfaceY = gen.surfaceHeight(x, z);
        const biome = gen.biomeAt(x, z);
        expect(blockAt(chunks, x, surfaceY, z)).toBe(biome.surfaceBlock);
      }
    }
  });

  it('suppresses trees whose canopy could reach into a ruin footprint', () => {
    const gen = new WorldGenerator(SEED);
    for (const s of structures) {
      const chunks = generateAll(gen, chunksCovering(s).coords);
      for (let x = s.minX; x <= s.maxX; x += 1) {
        for (let z = s.minZ; z <= s.maxZ; z += 1) {
          for (let y = 0; y < WORLD_CONFIG.chunkHeight; y += 1) {
            const id = blockAt(chunks, x, y, z);
            expect(id === BlockId.Wood || id === BlockId.Leaves).toBe(false);
          }
        }
      }
    }
  }, 20000);
});

describe('structure chunk-border safety', () => {
  it('produces identical world blocks for a 4-chunk ruin in any generation order', () => {
    const s = fourChunkRuin!;
    const { coords } = chunksCovering(s);
    expect(coords.length).toBe(4);

    const forward = generateAll(new WorldGenerator(SEED), coords);
    const reversed = generateAll(new WorldGenerator(SEED), [...coords].reverse());
    const interleaved = generateAll(new WorldGenerator(SEED), [
      coords[2]!,
      coords[0]!,
      coords[3]!,
      coords[1]!,
    ]);
    // Each chunk alone, from its own fresh generator (no shared history at all).
    const isolated = new Map<string, Chunk>();
    for (const c of coords) {
      isolated.set(chunkKey(c.cx, c.cz), new WorldGenerator(SEED).generateChunk(c.cx, c.cz));
    }

    const expected = snapshot(forward, s);
    expect(snapshot(reversed, s)).toEqual(expected);
    expect(snapshot(interleaved, s)).toEqual(expected);
    expect(snapshot(isolated, s)).toEqual(expected);
    for (const c of coords) {
      const key = chunkKey(c.cx, c.cz);
      expect(isolated.get(key)!.blocks).toEqual(forward.get(key)!.blocks);
    }

    // Every covered chunk actually received part of the ruin.
    const owners = new Set(
      s.template.blocks
        .filter((b) => b.blockId !== BlockId.Air)
        .map((b) => {
          const p = structureBlockWorldPosition(s, b);
          const { cx, cz } = worldToChunkCoord(p.x, p.z);
          return chunkKey(cx, cz);
        }),
    );
    expect(owners.size).toBe(4);
  });
});

describe('structure spawn safety', () => {
  it('resolveSpawnHeight lifts a player standing in a ruin wall into open air', () => {
    const s = fourChunkRuin!;
    const store = new ChunkStore();
    const gen = new WorldGenerator(SEED);
    for (const { cx, cz } of chunksCovering(s).coords) {
      store.setChunk(gen.generateChunk(cx, cz));
    }

    const wallCells = s.template.blocks.filter(
      (b) => b.dy > s.template.anchor.y && b.blockId !== BlockId.Air && b.mode === 'force',
    );
    expect(wallCells.length).toBeGreaterThan(0);
    for (const cell of wallCells) {
      const p = structureBlockWorldPosition(s, cell);
      // Same start height computeSpawnPosition would use for this column.
      const startY = Math.max(gen.surfaceHeight(p.x, p.z), WORLD_CONFIG.seaLevel) + 2;
      const y = resolveSpawnHeight(store, blockRegistry, { x: p.x + 0.5, y: startY, z: p.z + 0.5 });
      for (let i = 0; i < 2; i += 1) {
        const id = store.getBlock(p.x, y + i, p.z);
        expect(blockRegistry.isSolid(id) || blockRegistry.isFluid(id)).toBe(false);
      }
    }
  });
});
