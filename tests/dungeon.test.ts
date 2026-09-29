import { describe, it, expect } from 'vitest';
import { WorldGenerator } from '../src/world/WorldGenerator';
import {
  StructurePlacer,
  type PlacedStructure,
  type TerrainQuery,
} from '../src/world/structure/StructurePlacer';
import { structureBlockWorldPosition, stampStructure } from '../src/world/structure/stampStructure';
import { DUNGEON_TEMPLATE, RUIN_TEMPLATE, STRUCTURE_TEMPLATES } from '../src/world/structure/templates';
import { ROTATIONS, rotateOffset } from '../src/world/structure/rotation';
import { TreePlacer } from '../src/world/biome/TreePlacer';
import { BiomeId, getBiomeDefinition, type BiomeDefinition } from '../src/world/biome/Biome';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import type { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import { LightEngine, getLightAt, skyLightOf, blockLightOf } from '../src/world/light';
import { effectiveLightLevel } from '../src/renderer/lightShading';
import { findHostileSpawnY } from '../src/entities/mobSpawning';
import { LOOT_TABLES, lootRng, rollLoot } from '../src/items/lootTables';
import { itemRegistry } from '../src/items/ItemRegistry';
import { ChestStore } from '../src/items/ChestStore';
import { openChestContainer } from '../src/gameplay/chestActions';
import { computeSpawnPosition } from '../src/player/spawn';
import {
  CHUNK_VOLUME,
  chunkKey,
  localIndex,
  worldToChunkCoord,
  worldToLocal,
} from '../src/world/chunkCoords';
import { MOB_CONFIG, STRUCTURE_CONFIG, WORLD_CONFIG, WORLD_GEN_CONFIG } from '../src/config/constants';

const SEED = WORLD_GEN_CONFIG.defaultSeed;
const { seaLevel } = WORLD_CONFIG;
const UNDERGROUND = STRUCTURE_CONFIG.underground;
const REGION_BLOCKS = STRUCTURE_CONFIG.regionSizeChunks * WORLD_CONFIG.chunkWidth;
const SEARCH_REGIONS = 10;
const TOP_LAYER = DUNGEON_TEMPLATE.size.height - 1 - DUNGEON_TEMPLATE.anchor.y;
const DAY = 1;

type Coord = { readonly cx: number; readonly cz: number };

function fakeTerrain(
  height: (x: number, z: number) => number,
  biome: (x: number, z: number) => BiomeId = () => BiomeId.Plains,
): TerrainQuery {
  return {
    biomeAt: (x: number, z: number): BiomeDefinition => getBiomeDefinition(biome(x, z)),
    surfaceHeight: (x: number, z: number): number => height(x, z),
  };
}

function allStructures(seed: number, regions: number = SEARCH_REGIONS): PlacedStructure[] {
  const placer = new StructurePlacer(seed, new WorldGenerator(seed));
  const r = regions * REGION_BLOCKS;
  return placer.structuresIntersecting(-r, -r, r - 1, r - 1);
}

function chunksCovering(s: PlacedStructure, pad: number = 0): Coord[] {
  const from = worldToChunkCoord(s.minX - pad, s.minZ - pad);
  const to = worldToChunkCoord(s.maxX + pad, s.maxZ + pad);
  const coords: Coord[] = [];
  for (let cx = from.cx; cx <= to.cx; cx += 1) {
    for (let cz = from.cz; cz <= to.cz; cz += 1) {
      coords.push({ cx, cz });
    }
  }
  return coords;
}

function generateAll(gen: WorldGenerator, coords: readonly Coord[]): Map<string, Chunk> {
  const map = new Map<string, Chunk>();
  for (const { cx, cz } of coords) {
    map.set(chunkKey(cx, cz), gen.generateChunk(cx, cz));
  }
  return map;
}

function blockAt(chunks: ReadonlyMap<string, Chunk>, x: number, y: number, z: number): number {
  const { cx, cz } = worldToChunkCoord(x, z);
  const chunk = chunks.get(chunkKey(cx, cz));
  if (!chunk) throw new Error(`chunk ${cx},${cz} not generated`);
  const local = worldToLocal(x, y, z);
  return chunk.getBlock(local.x, local.y, local.z);
}

/** Every cell of the dungeon's bounding box plus a 1-block shell of neighbours. */
function snapshot(chunks: ReadonlyMap<string, Chunk>, s: PlacedStructure): number[] {
  const out: number[] = [];
  for (let x = s.minX; x <= s.maxX; x += 1) {
    for (let z = s.minZ; z <= s.maxZ; z += 1) {
      for (let y = s.originY - 1; y <= s.originY + s.template.size.height; y += 1) {
        out.push(blockAt(chunks, x, y, z));
      }
    }
  }
  return out;
}

const chestBlocks = DUNGEON_TEMPLATE.blocks.filter((b) => b.lootTable !== undefined);
const structures = allStructures(SEED);
const dungeons = structures.filter((s) => s.template === DUNGEON_TEMPLATE);
const multiChunkDungeon =
  dungeons.find((s) => chunksCovering(s).length === 4) ?? dungeons.find((s) => chunksCovering(s).length > 1);

describe('dungeon template', () => {
  it('is registered, underground, allowed in every biome and fits its declared size', () => {
    expect(STRUCTURE_TEMPLATES).toContain(DUNGEON_TEMPLATE);
    expect(DUNGEON_TEMPLATE.placement).toBe('underground');
    expect(RUIN_TEMPLATE.placement).toBe('surface');
    expect([...DUNGEON_TEMPLATE.allowedBiomes].sort()).toEqual(
      Object.values(BiomeId).sort(),
    );
    const { width, height, depth } = DUNGEON_TEMPLATE.size;
    for (const b of DUNGEON_TEMPLATE.blocks) {
      expect(b.dx).toBeGreaterThanOrEqual(0);
      expect(b.dx).toBeLessThan(width);
      expect(b.dy).toBeGreaterThanOrEqual(0);
      expect(b.dy).toBeLessThan(height);
      expect(b.dz).toBeGreaterThanOrEqual(0);
      expect(b.dz).toBeLessThan(depth);
    }
  });

  it('uses only existing materials, emits no light and has 2 dungeon chests and pillars', () => {
    const allowed: BlockId[] = [BlockId.Air, BlockId.Cobblestone, BlockId.Stone, BlockId.Gravel, BlockId.Chest];
    for (const b of DUNGEON_TEMPLATE.blocks) {
      expect(allowed).toContain(b.blockId);
      expect(blockRegistry.get(b.blockId).lightLevel).toBe(0);
      expect(b.mode).toBe('force');
    }
    expect(chestBlocks.map((b) => b.lootTable)).toEqual(['dungeon_chest', 'dungeon_chest']);
    // Interior (1..7 on x/z, layers 1..3): pillar cells are solid, everything else air or chest.
    const interiorSolid = DUNGEON_TEMPLATE.blocks.filter(
      (b) =>
        b.dx > 0 && b.dx < 8 && b.dz > 0 && b.dz < 8 && b.dy > 0 && b.dy < 4 &&
        b.blockId !== BlockId.Air && b.blockId !== BlockId.Chest,
    );
    expect(interiorSolid.length).toBeGreaterThanOrEqual(4);
    expect(DUNGEON_TEMPLATE.foundationBlock).toBeUndefined();
  });

  it('seals the room except one 1x2 untouched wall gap', () => {
    const { width, height, depth } = DUNGEON_TEMPLATE.size;
    const present = new Set(DUNGEON_TEMPLATE.blocks.map((b) => `${b.dx},${b.dy},${b.dz}`));
    const missing: string[] = [];
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let z = 0; z < depth; z += 1) {
          if (!present.has(`${x},${y},${z}`)) missing.push(`${x},${y},${z}`);
        }
      }
    }
    expect(missing).toEqual(['4,1,8', '4,2,8']);
  });

  it('puts every chest against a solid wall on the interior floor', () => {
    const at = new Map(DUNGEON_TEMPLATE.blocks.map((b) => [`${b.dx},${b.dy},${b.dz}`, b.blockId]));
    for (const c of chestBlocks) {
      expect(c.dy).toBe(1);
      const neighbours = [
        [c.dx - 1, c.dz],
        [c.dx + 1, c.dz],
        [c.dx, c.dz - 1],
        [c.dx, c.dz + 1],
      ];
      const touchesWall = neighbours.some(([x, z]) => x === 0 || x === 8 || z === 0 || z === 8);
      expect(touchesWall).toBe(true);
      expect(at.get(`${c.dx},0,${c.dz}`)).not.toBe(BlockId.Air);
    }
  });
});

describe('placement kind selection', () => {
  it('is deterministic per seed and region, and picks both kinds', () => {
    const flat = fakeTerrain(() => seaLevel + 30);
    const a = new StructurePlacer(5, flat);
    const b = new StructurePlacer(5, flat);
    const kinds = new Set<string>();
    for (let rx = -8; rx < 8; rx += 1) {
      for (let rz = -8; rz < 8; rz += 1) {
        const sa = a.structureInRegion(rx, rz);
        expect(b.structureInRegion(rx, rz)).toEqual(sa);
        if (sa) kinds.add(sa.template.placement);
      }
    }
    expect([...kinds].sort()).toEqual(['surface', 'underground']);
  });

  it('places roughly one dungeon per few regions on the default seed', () => {
    const regions = (2 * SEARCH_REGIONS) ** 2;
    expect(dungeons.length).toBeGreaterThan(regions / 12);
    expect(dungeons.length).toBeLessThan(regions / 2);
  });
});

describe('underground site rules', () => {
  const origin = 20;

  it('buries the floor within the depth range under the lowest footprint column', () => {
    const lowest = seaLevel + 4;
    // Tilted terrain: lowest column at the footprint's -X edge.
    const terrain = fakeTerrain((x) => lowest + Math.max(0, x - (origin - 4)));
    const shallowest = lowest - UNDERGROUND.ceilingBelowSurface - TOP_LAYER;
    const floors = new Set<number>();
    for (let o = 0; o < 200; o += 1) {
      const placer = new StructurePlacer(o, terrain);
      const site = placer.evaluateSite(DUNGEON_TEMPLATE, origin, origin, 0);
      expect(site.ok).toBe(true);
      if (!site.ok) continue;
      expect(site.floorY).toBeLessThanOrEqual(shallowest);
      expect(site.floorY).toBeGreaterThanOrEqual(Math.max(UNDERGROUND.minFloorY, shallowest - UNDERGROUND.depthRange));
      floors.add(site.floorY);
    }
    expect(floors.size).toBeGreaterThan(UNDERGROUND.depthRange / 2);
  });

  it('fits even the lowest dry terrain above minFloorY (depth rejection needs a config change)', () => {
    const lowestDry = seaLevel + UNDERGROUND.minSurfaceAboveSeaLevel;
    expect(lowestDry - UNDERGROUND.ceilingBelowSurface - TOP_LAYER).toBeGreaterThanOrEqual(UNDERGROUND.minFloorY);
    for (let seed = 0; seed < 50; seed += 1) {
      const site = new StructurePlacer(seed, fakeTerrain(() => lowestDry)).evaluateSite(DUNGEON_TEMPLATE, origin, origin, 0);
      expect(site.ok).toBe(true);
      if (site.ok) expect(site.floorY).toBeGreaterThanOrEqual(UNDERGROUND.minFloorY);
    }
  });

  it('rejects sites with water above any footprint column', () => {
    const wet = fakeTerrain((x, z) =>
      x === origin && z === origin ? seaLevel + UNDERGROUND.minSurfaceAboveSeaLevel - 1 : seaLevel + 10,
    );
    expect(new StructurePlacer(1, wet).evaluateSite(DUNGEON_TEMPLATE, origin, origin, 2)).toEqual({
      ok: false,
      reason: 'water',
    });
  });

  it('accepts steep terrain in every biome (no slope rule underground)', () => {
    for (const biome of Object.values(BiomeId)) {
      const steep = fakeTerrain((x) => seaLevel + 30 + (x - origin) * 5, () => biome);
      const site = new StructurePlacer(3, steep).evaluateSite(DUNGEON_TEMPLATE, origin, origin, 1);
      expect(site.ok).toBe(true);
    }
  });

  it('keeps every generated dungeon (real terrain) in its depth band under every footprint column', () => {
    const gen = new WorldGenerator(SEED);
    expect(dungeons.length).toBeGreaterThan(20);
    for (const s of dungeons) {
      let lowest = Infinity;
      for (let x = s.minX; x <= s.maxX; x += 1) {
        for (let z = s.minZ; z <= s.maxZ; z += 1) {
          const surface = gen.surfaceHeight(x, z);
          expect(surface).toBeGreaterThanOrEqual(seaLevel + UNDERGROUND.minSurfaceAboveSeaLevel);
          expect(s.originY + TOP_LAYER).toBeLessThanOrEqual(surface - UNDERGROUND.ceilingBelowSurface);
          lowest = Math.min(lowest, surface);
        }
      }
      const shallowest = lowest - UNDERGROUND.ceilingBelowSurface - TOP_LAYER;
      expect(s.originY).toBeGreaterThanOrEqual(UNDERGROUND.minFloorY);
      expect(s.originY).toBeGreaterThanOrEqual(shallowest - UNDERGROUND.depthRange);
      expect(s.originY).toBeLessThanOrEqual(shallowest);
    }
  });
});

describe('ruin / dungeon separation', () => {
  it('never overlaps footprints: every structure stays inside its own region, one per region', () => {
    const regions = new Set<string>();
    for (const s of structures) {
      const key = `${s.regionX},${s.regionZ}`;
      expect(regions.has(key)).toBe(false);
      regions.add(key);
      expect(Math.floor(s.minX / REGION_BLOCKS)).toBe(s.regionX);
      expect(Math.floor(s.maxX / REGION_BLOCKS)).toBe(s.regionX);
      expect(Math.floor(s.minZ / REGION_BLOCKS)).toBe(s.regionZ);
      expect(Math.floor(s.maxZ / REGION_BLOCKS)).toBe(s.regionZ);
    }
    expect(structures.some((s) => s.template === RUIN_TEMPLATE)).toBe(true);
    for (let i = 0; i < structures.length; i += 1) {
      for (let j = i + 1; j < structures.length; j += 1) {
        const a = structures[i]!;
        const b = structures[j]!;
        const disjoint = a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ;
        expect(disjoint).toBe(true);
      }
    }
  });
});

describe('dungeon generation', () => {
  it('writes the whole shell and interior (caves cannot hollow it) and leaves the surface intact', () => {
    const gen = new WorldGenerator(SEED);
    for (const s of dungeons.slice(0, 6)) {
      const chunks = generateAll(gen, chunksCovering(s));
      for (const block of s.template.blocks) {
        const p = structureBlockWorldPosition(s, block);
        expect(blockAt(chunks, p.x, p.y, p.z)).toBe(block.blockId);
      }
      for (let x = s.minX; x <= s.maxX; x += 1) {
        for (let z = s.minZ; z <= s.maxZ; z += 1) {
          const surfaceY = gen.surfaceHeight(x, z);
          expect(blockAt(chunks, x, surfaceY, z)).not.toBe(BlockId.Air);
          expect(blockAt(chunks, x, surfaceY + 1, z)).not.toBe(BlockId.Cobblestone);
        }
      }
    }
  });

  it('does not suppress trees above a dungeon', () => {
    const gen = new WorldGenerator(SEED);
    const trees = new TreePlacer(SEED);
    let checked = 0;
    for (const s of dungeons) {
      for (let x = s.minX; x <= s.maxX && checked < 3; x += 1) {
        for (let z = s.minZ; z <= s.maxZ && checked < 3; z += 1) {
          const biome = gen.biomeAt(x, z);
          const groundY = gen.surfaceHeight(x, z, biome);
          if (!trees.isTreeSpawn(x, z, biome.id) || groundY <= seaLevel + 1) continue;
          const { cx, cz } = worldToChunkCoord(x, z);
          const local = worldToLocal(x, groundY + 1, z);
          expect(gen.generateChunk(cx, cz).getBlock(local.x, local.y, local.z)).toBe(BlockId.Wood);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('produces identical blocks for a multi-chunk dungeon in any generation order', () => {
    const s = multiChunkDungeon;
    expect(s).toBeDefined();
    if (!s) return;
    const coords = chunksCovering(s);
    expect(coords.length).toBeGreaterThan(1);

    const forward = generateAll(new WorldGenerator(SEED), coords);
    const reversed = generateAll(new WorldGenerator(SEED), [...coords].reverse());
    const isolated = new Map<string, Chunk>();
    for (const c of coords) {
      isolated.set(chunkKey(c.cx, c.cz), new WorldGenerator(SEED).generateChunk(c.cx, c.cz));
    }
    const expected = snapshot(forward, s);
    expect(snapshot(reversed, s)).toEqual(expected);
    expect(snapshot(isolated, s)).toEqual(expected);
    for (const c of coords) {
      const key = chunkKey(c.cx, c.cz);
      expect(isolated.get(key)!.blocks).toEqual(forward.get(key)!.blocks);
    }

    const owners = new Set(
      s.template.blocks.map((b) => {
        const p = structureBlockWorldPosition(s, b);
        const { cx, cz } = worldToChunkCoord(p.x, p.z);
        return chunkKey(cx, cz);
      }),
    );
    expect(owners.size).toBe(coords.length);
  });

  it('is dark inside at full daylight, so the hostile cave scan accepts its floor', () => {
    const s = dungeons[0]!;
    const store = new ChunkStore();
    const light = new LightEngine(store, blockRegistry);
    const gen = new WorldGenerator(SEED);
    const coords = chunksCovering(s, WORLD_CONFIG.chunkWidth);
    for (const { cx, cz } of coords) store.setChunk(gen.generateChunk(cx, cz));
    for (const { cx, cz } of coords) light.lightChunk(cx, cz);

    let spawnable = 0;
    for (const block of s.template.blocks) {
      if (block.blockId !== BlockId.Air) continue;
      const p = structureBlockWorldPosition(s, block);
      const packed = getLightAt(store, p.x, p.y, p.z);
      expect(effectiveLightLevel(skyLightOf(packed), blockLightOf(packed), DAY)).toBeLessThanOrEqual(
        MOB_CONFIG.hostileMaxSpawnLight,
      );
      if (block.dy === 1 && findHostileSpawnY(store, blockRegistry, p.x, p.z, DAY, p.y) === p.y) {
        spawnable += 1;
      }
    }
    expect(spawnable).toBeGreaterThan(0);
  });
});

describe('dungeon chests', () => {
  it('stamps both chests at their rotated positions for all 4 rotations', () => {
    const base = dungeons[0]!;
    for (const rotation of ROTATIONS) {
      const structure: PlacedStructure = {
        ...base,
        rotation,
        originX: 8,
        originZ: 8,
        originY: 20,
        minX: 4,
        maxX: 12,
        minZ: 4,
        maxZ: 12,
      };
      const blocks = new Uint8Array(CHUNK_VOLUME);
      stampStructure(structure, 0, 0, blocks);
      const expected = chestBlocks.map((b) => structureBlockWorldPosition(structure, b));
      for (const [i, p] of expected.entries()) {
        const block = chestBlocks[i]!;
        const { anchor } = DUNGEON_TEMPLATE;
        const offset = rotateOffset(block.dx - anchor.x, block.dz - anchor.z, rotation);
        expect(p).toEqual({ x: 8 + offset.x, y: 20 + block.dy - anchor.y, z: 8 + offset.z });
        expect(blocks[localIndex(p.x, p.y, p.z)]).toBe(BlockId.Chest);
      }
      expect(blocks.filter((b) => b === BlockId.Chest).length).toBe(2);
    }
  });

  it('lootTableAt answers dungeon_chest at the chests and null elsewhere', () => {
    const gen = new WorldGenerator(SEED);
    for (const s of dungeons.slice(0, 5)) {
      for (const block of chestBlocks) {
        const p = structureBlockWorldPosition(s, block);
        expect(gen.structureLootTableAt(p.x, p.y, p.z)).toBe('dungeon_chest');
        expect(gen.structureLootTableAt(p.x, p.y + 1, p.z)).toBeNull();
        expect(gen.structureLootTableAt(p.x, p.y - 1, p.z)).toBeNull();
      }
      expect(gen.structureLootTableAt(s.originX, s.originY + 1, s.originZ)).toBeNull();
    }
  });

  it('opens a generated dungeon chest with deterministic dungeon loot', () => {
    const gen = new WorldGenerator(SEED);
    const s = dungeons[0]!;
    const p = structureBlockWorldPosition(s, chestBlocks[0]!);
    const { cx, cz } = worldToChunkCoord(p.x, p.z);
    const local = worldToLocal(p.x, p.y, p.z);
    expect(gen.generateChunk(cx, cz).getBlock(local.x, local.y, local.z)).toBe(BlockId.Chest);

    const open = (): string => {
      const ctx = { chests: new ChestStore(), worldSeed: SEED, lootTableAt: gen.structureLootTableAt.bind(gen) };
      return JSON.stringify(openChestContainer(ctx, p.x, p.y, p.z).slots());
    };
    const first = open();
    expect(first).toBe(open());
    expect(JSON.parse(first).some((slot: unknown) => slot !== null)).toBe(true);
  });
});

describe('dungeon_chest loot table', () => {
  const table = LOOT_TABLES['dungeon_chest'];
  const ruin = LOOT_TABLES['ruin_chest'];
  if (table === undefined || ruin === undefined) throw new Error('loot table missing');

  it('uses registered items within stack limits and is richer than a ruin chest', () => {
    for (const entry of table.entries) {
      expect(itemRegistry.has(entry.itemId)).toBe(true);
      expect(entry.min).toBeGreaterThanOrEqual(1);
      expect(entry.max).toBeGreaterThanOrEqual(entry.min);
      expect(entry.max).toBeLessThanOrEqual(itemRegistry.maxStackSize(entry.itemId));
      expect(entry.weight).toBeGreaterThan(0);
    }
    expect(table.rolls.min).toBeGreaterThan(ruin.rolls.min);
    expect(table.rolls.max).toBeGreaterThan(ruin.rolls.max);
  });

  it('is deterministic per seed + position and stays within bounds', () => {
    expect(rollLoot(table, lootRng(SEED, 3, 20, -7))).toEqual(rollLoot(table, lootRng(SEED, 3, 20, -7)));
    expect(rollLoot(table, lootRng(SEED, 3, 20, -7))).not.toEqual(rollLoot(table, lootRng(SEED + 1, 3, 20, -7)));
    for (let i = 0; i < 500; i += 1) {
      const stacks = rollLoot(table, lootRng(SEED, i, 20, -i));
      expect(stacks.length).toBeGreaterThanOrEqual(table.rolls.min);
      expect(stacks.length).toBeLessThanOrEqual(table.rolls.max);
    }
  });
});

describe('default seed', () => {
  it('has a dungeon within 250 blocks of spawn', () => {
    const spawn = computeSpawnPosition(new WorldGenerator(SEED)).position;
    const distance = (s: PlacedStructure): number => Math.hypot(s.originX - spawn.x, s.originZ - spawn.z);
    const nearest = [...dungeons].sort((a, b) => distance(a) - distance(b))[0];
    expect(nearest).toBeDefined();
    expect(distance(nearest!)).toBeLessThanOrEqual(250);
  });
});
