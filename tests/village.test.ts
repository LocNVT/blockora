import { describe, it, expect } from 'vitest';
import { WorldGenerator } from '../src/world/WorldGenerator';
import {
  StructurePlacer,
  type FootprintBox,
  type PlacedStructure,
  type RegionLayout,
  type TerrainQuery,
} from '../src/world/structure/StructurePlacer';
import { structureBlockWorldPosition } from '../src/world/structure/stampStructure';
import {
  DUNGEON_TEMPLATE,
  RUIN_TEMPLATE,
  STRUCTURE_TEMPLATES,
  VILLAGE_BIOMES,
  VILLAGE_COTTAGE_TEMPLATE,
  VILLAGE_HOUSE_TEMPLATES,
  VILLAGE_LONGHOUSE_TEMPLATE,
  VILLAGE_PATH_BLOCK,
  VILLAGE_WELL_TEMPLATE,
} from '../src/world/structure/templates';
import {
  entranceCell,
  entranceFacing,
  pieceFootprint,
  planVillage,
  villageReach,
  type VillagePlan,
} from '../src/world/structure/villageLayout';
import { rotateOffset } from '../src/world/structure/rotation';
import type { StructureTemplate } from '../src/world/structure/StructureTemplate';
import { TreePlacer, TREE_MAX_HORIZONTAL_REACH } from '../src/world/biome/TreePlacer';
import { BiomeId, getBiomeDefinition, type BiomeDefinition } from '../src/world/biome/Biome';
import { BlockId } from '../src/world/blocks';
import { blockRegistry } from '../src/world/BlockRegistry';
import type { Chunk } from '../src/world/Chunk';
import { ChunkStore } from '../src/world/ChunkStore';
import { LightEngine, getLightAt, skyLightOf, blockLightOf } from '../src/world/light';
import { effectiveLightLevel } from '../src/renderer/lightShading';
import { findHostileSpawnY } from '../src/entities/mobSpawning';
import { LOOT_TABLES, lootRng, rollLoot } from '../src/items/lootTables';
import { ItemId } from '../src/items/items';
import { itemRegistry } from '../src/items/ItemRegistry';
import { ChestStore } from '../src/items/ChestStore';
import { openChestContainer } from '../src/gameplay/chestActions';
import { computeSpawnPosition } from '../src/player/spawn';
import { chunkKey, worldToChunkCoord, worldToLocal } from '../src/world/chunkCoords';
import { mulberry32 } from '../src/util/mulberry32';
import { MOB_CONFIG, STRUCTURE_CONFIG, WORLD_CONFIG, WORLD_GEN_CONFIG } from '../src/config/constants';

const SEED = WORLD_GEN_CONFIG.defaultSeed;
const { seaLevel } = WORLD_CONFIG;
const VILLAGE = STRUCTURE_CONFIG.village;
const REGION_BLOCKS = STRUCTURE_CONFIG.regionSizeChunks * WORLD_CONFIG.chunkWidth;
const DRY = seaLevel + STRUCTURE_CONFIG.minSurfaceAboveSeaLevel + 5;
const NIGHT = 0;
const SEARCH_REGIONS = 10;

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

const isVillage = (layout: RegionLayout): boolean => layout.pieces[0]?.template === VILLAGE_WELL_TEMPLATE;
const houses = (layout: RegionLayout): PlacedStructure[] => layout.pieces.slice(1);

function villagesIn(placer: StructurePlacer, range: number): RegionLayout[] {
  const found: RegionLayout[] = [];
  for (let rx = -range; rx < range; rx += 1) {
    for (let rz = -range; rz < range; rz += 1) {
      const layout = placer.layoutForRegion(rx, rz);
      if (isVillage(layout)) found.push(layout);
    }
  }
  return found;
}

function* columns(box: FootprintBox): Generator<{ x: number; z: number }> {
  for (let x = box.minX; x <= box.maxX; x += 1) {
    for (let z = box.minZ; z <= box.maxZ; z += 1) {
      yield { x, z };
    }
  }
}

function contains(box: FootprintBox, x: number, z: number, margin = 0): boolean {
  return x >= box.minX - margin && x <= box.maxX + margin && z >= box.minZ - margin && z <= box.maxZ + margin;
}

function disjoint(a: FootprintBox, b: FootprintBox, gap = 0): boolean {
  return a.maxX + gap < b.minX || b.maxX + gap < a.minX || a.maxZ + gap < b.minZ || b.maxZ + gap < a.minZ;
}

function boundsOf(layout: RegionLayout): FootprintBox {
  const boxes: FootprintBox[] = [...layout.pieces, ...layout.paths];
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    minZ: Math.min(...boxes.map((b) => b.minZ)),
    maxZ: Math.max(...boxes.map((b) => b.maxZ)),
  };
}

function chunksCovering(box: FootprintBox, pad = 0): Coord[] {
  const from = worldToChunkCoord(box.minX - pad, box.minZ - pad);
  const to = worldToChunkCoord(box.maxX + pad, box.maxZ + pad);
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

/** Door direction of a placed house in world space. */
function doorFacing(piece: PlacedStructure): { x: number; z: number } {
  const base = entranceFacing(piece.template);
  return rotateOffset(base.x, base.z, piece.rotation);
}

function pathColumns(layout: RegionLayout): Set<string> {
  const set = new Set<string>();
  for (const path of layout.paths) {
    for (const { x, z } of columns(path)) set.add(`${x},${z}`);
  }
  return set;
}

function chestOf(template: StructureTemplate) {
  const chest = template.blocks.find((b) => b.lootTable !== undefined);
  if (!chest) throw new Error(`${template.id} has no chest`);
  return chest;
}

// Default-seed fixtures: every village within SEARCH_REGIONS regions, nearest to spawn first.
const generator = new WorldGenerator(SEED);
const placer = new StructurePlacer(SEED, generator);
const spawn = computeSpawnPosition(generator).position;
const centreDistance = (v: RegionLayout): number =>
  Math.hypot(v.pieces[0]!.originX - spawn.x, v.pieces[0]!.originZ - spawn.z);
const villages = villagesIn(placer, SEARCH_REGIONS).sort((a, b) => centreDistance(a) - centreDistance(b));
const nearest = villages[0];
if (nearest === undefined) throw new Error('no village around the default seed');

// Synthetic flat plains: every rolled village plan passes its site check.
const flatPlacer = new StructurePlacer(7, fakeTerrain(() => DRY));
const flatVillages = villagesIn(flatPlacer, 8);

function firstPlan(p: StructurePlacer): { plan: VillagePlan; regionX: number; regionZ: number } {
  for (let rx = 0; rx < 40; rx += 1) {
    const plan = p.villagePlanForRegion(rx, 0);
    if (plan) return { plan, regionX: rx, regionZ: 0 };
  }
  throw new Error('no village plan rolled');
}

describe('village templates', () => {
  const allowed: BlockId[] = [
    BlockId.Air,
    BlockId.Cobblestone,
    BlockId.Planks,
    BlockId.Wood,
    BlockId.Glass,
    BlockId.Torch,
    BlockId.Chest,
    BlockId.Water,
  ];

  it('are surface pieces for plains/desert with a cobblestone foundation, built from existing blocks', () => {
    for (const t of [VILLAGE_WELL_TEMPLATE, ...VILLAGE_HOUSE_TEMPLATES]) {
      expect(t.placement).toBe('surface');
      expect([...t.allowedBiomes].sort()).toEqual([BiomeId.Plains, BiomeId.Desert].sort());
      expect(t.foundationBlock).toBe(BlockId.Cobblestone);
      for (const b of t.blocks) {
        expect(allowed).toContain(b.blockId);
        expect(b.dx).toBeLessThan(t.size.width);
        expect(b.dz).toBeLessThan(t.size.depth);
        expect(b.dy).toBeLessThan(t.size.height);
      }
    }
    expect(VILLAGE_BIOMES).toEqual(VILLAGE_WELL_TEMPLATE.allowedBiomes);
    expect(STRUCTURE_TEMPLATES).toEqual([RUIN_TEMPLATE, DUNGEON_TEMPLATE]);
  });

  it('houses have a 1x2 doorway at the entrance, glass windows, one torch and one village chest inside', () => {
    expect(VILLAGE_HOUSE_TEMPLATES).toEqual([VILLAGE_COTTAGE_TEMPLATE, VILLAGE_LONGHOUSE_TEMPLATE]);
    for (const t of VILLAGE_HOUSE_TEMPLATES) {
      const at = new Map(t.blocks.map((b) => [`${b.dx},${b.dy},${b.dz}`, b]));
      const entrance = t.entrance!;
      expect(entranceFacing(t)).toEqual({ x: 0, z: -1 });
      // Door cell is the wall cell next to the entrance: open for 2 layers, lintel above, floor below.
      const door = { x: entrance.x, z: entrance.z + 1 };
      expect(at.get(`${door.x},0,${door.z}`)?.blockId).toBe(BlockId.Cobblestone);
      expect(at.get(`${door.x},1,${door.z}`)?.blockId).toBe(BlockId.Air);
      expect(at.get(`${door.x},2,${door.z}`)?.blockId).toBe(BlockId.Air);
      expect(at.get(`${door.x},3,${door.z}`)?.blockId).toBe(BlockId.Planks);
      expect(t.blocks.filter((b) => b.blockId === BlockId.Glass).length).toBeGreaterThanOrEqual(3);
      const torches = t.blocks.filter((b) => b.blockId === BlockId.Torch);
      expect(torches.length).toBe(1);
      expect(torches[0]!.dy).toBe(1);
      const chests = t.blocks.filter((b) => b.blockId === BlockId.Chest);
      expect(chests.map((c) => c.lootTable)).toEqual(['village_chest']);
      expect(chests[0]!.dy).toBe(1);
      // Full floor slab (foundation support everywhere) and a roof over the whole footprint.
      expect(t.blocks.filter((b) => b.dy === 0 && b.blockId === BlockId.Cobblestone).length).toBe(t.size.width * t.size.depth);
    }
  });

  it('the well holds a 3x3 pool of water fully enclosed by cobblestone', () => {
    const at = new Map(VILLAGE_WELL_TEMPLATE.blocks.map((b) => [`${b.dx},${b.dy},${b.dz}`, b.blockId]));
    const water = VILLAGE_WELL_TEMPLATE.blocks.filter((b) => b.blockId === BlockId.Water);
    expect(water.length).toBe(9);
    for (const w of water) {
      expect(at.get(`${w.dx},${w.dy - 1},${w.dz}`)).toBe(BlockId.Cobblestone);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const side = at.get(`${w.dx + dx},${w.dy},${w.dz + dz}`);
        expect(side === BlockId.Water || side === BlockId.Cobblestone).toBe(true);
      }
    }
    expect(VILLAGE_WELL_TEMPLATE.entrance).toBeUndefined();
  });
});

describe('village layout', () => {
  it('is deterministic: same seed and region give the same plan and pieces', () => {
    const a = new StructurePlacer(SEED, new WorldGenerator(SEED));
    const b = new StructurePlacer(SEED, new WorldGenerator(SEED));
    for (const v of villages.slice(0, 3)) {
      const { regionX, regionZ } = v.pieces[0]!;
      expect(a.villagePlanForRegion(regionX, regionZ)).toEqual(b.villagePlanForRegion(regionX, regionZ));
      expect(a.layoutForRegion(regionX, regionZ)).toEqual(v);
    }
    const rng = (): (() => number) => mulberry32(1234);
    expect(planVillage(rng(), 50, 60)).toEqual(planVillage(rng(), 50, 60));
  });

  it('differs between regions (piece count, designs, slots and rotations vary)', () => {
    expect(flatVillages.length).toBeGreaterThan(20);
    const signature = (v: RegionLayout): string => {
      const c = v.pieces[0]!;
      return v.pieces.map((p) => `${p.template.id}@${p.originX - c.originX},${p.originZ - c.originZ}r${p.rotation}`).sort().join('|');
    };
    const signatures = new Set(flatVillages.map(signature));
    expect(signatures.size).toBeGreaterThan(flatVillages.length / 2);
    const counts = new Set(flatVillages.map((v) => houses(v).length));
    expect([...counts].sort()).toEqual([3, 4, 5]);
    const designs = new Set(flatVillages.flatMap((v) => houses(v).map((h) => h.template.id)));
    expect(designs.size).toBe(2);
  });

  it('keeps every piece and path inside the region, pieces apart and paths off every footprint', () => {
    for (const v of [...flatVillages, ...villages]) {
      const { regionX, regionZ } = v.pieces[0]!;
      const region: FootprintBox = {
        minX: regionX * REGION_BLOCKS,
        maxX: (regionX + 1) * REGION_BLOCKS - 1,
        minZ: regionZ * REGION_BLOCKS,
        maxZ: (regionZ + 1) * REGION_BLOCKS - 1,
      };
      expect(houses(v).length).toBeGreaterThanOrEqual(VILLAGE.minHouses);
      expect(houses(v).length).toBeLessThanOrEqual(VILLAGE.maxHouses);
      for (const box of [...v.pieces, ...v.paths]) {
        expect(box.minX).toBeGreaterThanOrEqual(region.minX);
        expect(box.maxX).toBeLessThanOrEqual(region.maxX);
        expect(box.minZ).toBeGreaterThanOrEqual(region.minZ);
        expect(box.maxZ).toBeLessThanOrEqual(region.maxZ);
      }
      for (let i = 0; i < v.pieces.length; i += 1) {
        expect(v.pieces[i]!.regionX).toBe(regionX);
        for (let j = i + 1; j < v.pieces.length; j += 1) {
          expect(disjoint(v.pieces[i]!, v.pieces[j]!, 1)).toBe(true);
        }
        for (const path of v.paths) expect(disjoint(v.pieces[i]!, path)).toBe(true);
      }
      const centre = v.pieces[0]!;
      for (const box of [...v.pieces, ...v.paths]) {
        for (const edge of [box.minX - centre.originX, box.maxX - centre.originX, box.minZ - centre.originZ, box.maxZ - centre.originZ]) {
          expect(Math.abs(edge)).toBeLessThanOrEqual(villageReach());
        }
      }
    }
  });

  it('turns every door toward the centre, with its path starting at the entrance', () => {
    for (const v of [...flatVillages, ...villages]) {
      const centre = v.pieces[0]!;
      const pathSet = pathColumns(v);
      for (const house of houses(v)) {
        const facing = doorFacing(house);
        const toCentre = { x: centre.originX - house.originX, z: centre.originZ - house.originZ };
        expect(facing.x * toCentre.x + facing.z * toCentre.z).toBeGreaterThan(0);
        const entrance = entranceCell(house);
        expect(contains(house, entrance.x, entrance.z)).toBe(false);
        expect(contains(house, entrance.x - facing.x, entrance.z - facing.z)).toBe(true);
        expect(pathSet.has(`${entrance.x},${entrance.z}`)).toBe(true);
        expect(pieceFootprint(house)).toEqual({ minX: house.minX, maxX: house.maxX, minZ: house.minZ, maxZ: house.maxZ });
      }
    }
  });

  it('connects every house entrance to the well through path columns', () => {
    for (const v of [...flatVillages, ...villages]) {
      const well = v.pieces[0]!;
      const pathSet = pathColumns(v);
      const besideWell = (x: number, z: number): boolean => contains(well, x, z, 1) && !contains(well, x, z);
      for (const house of houses(v)) {
        const start = entranceCell(house);
        const seen = new Set([`${start.x},${start.z}`]);
        const queue = [start];
        let reached = false;
        while (queue.length > 0 && !reached) {
          const { x, z } = queue.shift()!;
          if (besideWell(x, z)) reached = true;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const key = `${x + dx},${z + dz}`;
            if (pathSet.has(key) && !seen.has(key)) {
              seen.add(key);
              queue.push({ x: x + dx, z: z + dz });
            }
          }
        }
        expect(reached).toBe(true);
      }
    }
  });
});

describe('village site rules', () => {
  const { plan, regionX, regionZ } = firstPlan(new StructurePlacer(3, fakeTerrain(() => DRY)));
  const house = plan.pieces[1]!;
  const houseBox = pieceFootprint(house);
  const wellBox = pieceFootprint(plan.pieces[0]!);
  const path = plan.paths[0]!;
  const evaluate = (terrain: TerrainQuery) => new StructurePlacer(3, terrain).evaluateVillage(plan, regionX, regionZ);

  it('accepts flat dry plains or desert and floors each piece one above its highest column', () => {
    const result = evaluate(fakeTerrain(() => DRY));
    expect(result.ok).toBe(true);
    const desert = evaluate(fakeTerrain((x) => DRY + (x % 2 === 0 ? 0 : 1), () => BiomeId.Desert));
    expect(desert.ok).toBe(true);
    if (desert.ok) {
      for (const piece of desert.layout.pieces) expect(piece.originY).toBe(DRY + 2);
    }
  });

  it('rejects a piece footprint steeper than maxPieceSlope (and accepts exactly maxPieceSlope)', () => {
    const bump = (rise: number) => fakeTerrain((x, z) => (x === houseBox.minX && z === houseBox.minZ ? DRY + rise : DRY));
    expect(evaluate(bump(VILLAGE.maxPieceSlope)).ok).toBe(true);
    expect(evaluate(bump(VILLAGE.maxPieceSlope + 1))).toEqual({ ok: false, reason: 'slope' });
    expect(VILLAGE.maxPieceSlope).toBeLessThan(STRUCTURE_CONFIG.maxSlope);
  });

  it('rejects villages whose pieces together span more than maxAreaSlope', () => {
    // Each piece is flat, but the house sits maxAreaSlope + 1 above the well.
    const terraced = (rise: number) => fakeTerrain((x, z) => (contains(houseBox, x, z, 1) ? DRY + rise : DRY));
    expect(evaluate(terraced(VILLAGE.maxAreaSlope)).ok).toBe(true);
    expect(evaluate(terraced(VILLAGE.maxAreaSlope + 1))).toEqual({ ok: false, reason: 'slope' });
  });

  it('rejects a wrong biome on any piece or path column', () => {
    for (const biome of [BiomeId.Forest, BiomeId.Taiga, BiomeId.Mountains, BiomeId.Swamp]) {
      const onWell = fakeTerrain(() => DRY, (x, z) => (contains(wellBox, x, z) ? biome : BiomeId.Plains));
      expect(evaluate(onWell)).toEqual({ ok: false, reason: 'biome' });
    }
    const onPath = fakeTerrain(() => DRY, (x, z) => (x === path.maxX && z === path.maxZ ? BiomeId.Forest : BiomeId.Plains));
    expect(evaluate(onPath)).toEqual({ ok: false, reason: 'biome' });
  });

  it('rejects water (surface below seaLevel + minSurfaceAboveSeaLevel) on any piece or path column', () => {
    const low = seaLevel + STRUCTURE_CONFIG.minSurfaceAboveSeaLevel - 1;
    const wetHouse = fakeTerrain((x, z) => (x === houseBox.maxX && z === houseBox.maxZ ? low : DRY));
    expect(evaluate(wetHouse)).toEqual({ ok: false, reason: 'water' });
    const wetPath = fakeTerrain((x, z) => (x === path.minX && z === path.minZ ? low : DRY));
    expect(evaluate(wetPath)).toEqual({ ok: false, reason: 'water' });
  });

  it('falls back to the region ruin/dungeon candidate when the village site is rejected', () => {
    const forest = new StructurePlacer(3, fakeTerrain(() => DRY + 30, () => BiomeId.Forest));
    let fallbacks = 0;
    for (let rx = -8; rx < 8; rx += 1) {
      for (let rz = -8; rz < 8; rz += 1) {
        if (!forest.villagePlanForRegion(rx, rz)) continue;
        const layout = forest.layoutForRegion(rx, rz);
        expect(isVillage(layout)).toBe(false);
        const candidate = forest.candidateForRegion(rx, rz);
        expect(layout.pieces.map((p) => p.template)).toEqual(candidate ? [candidate.template] : []);
        if (candidate) fallbacks += 1;
      }
    }
    expect(fallbacks).toBeGreaterThan(0);
  });

  it('only places default-seed villages whose pieces and paths pass every rule (real terrain)', () => {
    for (const v of villages) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const piece of v.pieces) {
        let pieceLo = Infinity;
        let pieceHi = -Infinity;
        for (const { x, z } of columns(piece)) {
          expect(VILLAGE_BIOMES).toContain(generator.biomeAt(x, z).id);
          const h = generator.surfaceHeight(x, z);
          expect(h).toBeGreaterThanOrEqual(seaLevel + STRUCTURE_CONFIG.minSurfaceAboveSeaLevel);
          pieceLo = Math.min(pieceLo, h);
          pieceHi = Math.max(pieceHi, h);
        }
        expect(pieceHi - pieceLo).toBeLessThanOrEqual(VILLAGE.maxPieceSlope);
        expect(piece.originY).toBe(pieceHi + 1);
        lo = Math.min(lo, pieceLo);
        hi = Math.max(hi, pieceHi);
      }
      expect(hi - lo).toBeLessThanOrEqual(VILLAGE.maxAreaSlope);
      for (const path of v.paths) {
        for (const { x, z } of columns(path)) {
          expect(VILLAGE_BIOMES).toContain(generator.biomeAt(x, z).id);
          expect(generator.surfaceHeight(x, z)).toBeGreaterThanOrEqual(seaLevel + STRUCTURE_CONFIG.minSurfaceAboveSeaLevel);
        }
      }
    }
  });
});

describe('village frequency (default seed, 20x20 regions)', () => {
  it('places ruins, dungeons and villages, none of them rare', () => {
    const counts = new Map<string, number>();
    for (let rx = -SEARCH_REGIONS; rx < SEARCH_REGIONS; rx += 1) {
      for (let rz = -SEARCH_REGIONS; rz < SEARCH_REGIONS; rz += 1) {
        const first = placer.layoutForRegion(rx, rz).pieces[0];
        if (first) counts.set(first.template.id, (counts.get(first.template.id) ?? 0) + 1);
      }
    }
    const regions = (2 * SEARCH_REGIONS) ** 2;
    expect(counts.get(VILLAGE_WELL_TEMPLATE.id)).toBe(villages.length);
    for (const id of [RUIN_TEMPLATE.id, DUNGEON_TEMPLATE.id, VILLAGE_WELL_TEMPLATE.id]) {
      expect(counts.get(id) ?? 0).toBeGreaterThan(regions / 40);
    }
    // Villages are the rarest option (strict site rules), so ruins/dungeons stay common.
    expect(villages.length).toBeLessThan(counts.get(RUIN_TEMPLATE.id)!);
    expect(villages.length).toBeLessThan(counts.get(DUNGEON_TEMPLATE.id)!);
  });

  it('has a village within 400 blocks of the default-seed spawn', () => {
    expect(centreDistance(nearest)).toBeLessThanOrEqual(400);
  });
});

describe('village generation (default seed)', () => {
  const bounds = boundsOf(nearest);
  const coords = chunksCovering(bounds);
  const chunks = generateAll(new WorldGenerator(SEED), coords);

  it('spans several chunks and writes every piece block at its placed position', () => {
    expect(coords.length).toBeGreaterThan(4);
    for (const piece of nearest.pieces) {
      for (const block of piece.template.blocks) {
        const p = structureBlockWorldPosition(piece, block);
        const actual = blockAt(chunks, p.x, p.y, p.z);
        if (block.mode === 'force') expect(actual).toBe(block.blockId);
      }
      // Foundation: every floor column is supported down to the terrain.
      for (const { x, z } of columns(piece)) {
        const surface = generator.surfaceHeight(x, z);
        for (let y = surface + 1; y < piece.originY; y += 1) {
          expect(blockAt(chunks, x, y, z)).toBe(BlockId.Cobblestone);
        }
      }
    }
  });

  it('lays gravel on the terrain surface of every path column, open above', () => {
    for (const path of nearest.paths) {
      for (const { x, z } of columns(path)) {
        const surface = generator.surfaceHeight(x, z);
        expect(blockAt(chunks, x, surface, z)).toBe(VILLAGE_PATH_BLOCK);
        expect(blockRegistry.isSolid(blockAt(chunks, x, surface + 1, z))).toBe(false);
      }
    }
  });

  it('opens every doorway toward its path', () => {
    for (const house of houses(nearest)) {
      const facing = doorFacing(house);
      const entrance = entranceCell(house);
      const door = { x: entrance.x - facing.x, z: entrance.z - facing.z };
      expect(blockAt(chunks, door.x, house.originY + 1, door.z)).toBe(BlockId.Air);
      expect(blockAt(chunks, door.x, house.originY + 2, door.z)).toBe(BlockId.Air);
      expect(blockAt(chunks, entrance.x, generator.surfaceHeight(entrance.x, entrance.z), entrance.z)).toBe(VILLAGE_PATH_BLOCK);
    }
  });

  it('suppresses trees near every piece and path (only template wood inside footprints)', () => {
    const trees = new TreePlacer(SEED);
    const reach = TREE_MAX_HORIZONTAL_REACH;
    let suppressed = 0;
    for (const v of villages.slice(0, 6)) {
      const box = boundsOf(v);
      const blockers: FootprintBox[] = [...v.pieces, ...v.paths];
      const all = generateAll(new WorldGenerator(SEED), chunksCovering(box, reach));
      const area = { minX: box.minX - reach, maxX: box.maxX + reach, minZ: box.minZ - reach, maxZ: box.maxZ + reach };
      for (const { x, z } of columns(area)) {
        const biome = generator.biomeAt(x, z);
        if (!trees.isTreeSpawn(x, z, biome.id)) continue;
        if (!blockers.some((b) => contains(b, x, z, reach))) continue;
        if (generator.surfaceHeight(x, z, biome) <= seaLevel + 1) continue;
        suppressed += 1;
        const groundY = generator.surfaceHeight(x, z, biome);
        if (!v.pieces.some((p) => contains(p, x, z))) expect(blockAt(all, x, groundY + 1, z)).not.toBe(BlockId.Wood);
      }
      const templateWood = new Set(
        v.pieces.flatMap((piece) =>
          piece.template.blocks
            .filter((b) => b.blockId === BlockId.Wood)
            .map((b) => {
              const p = structureBlockWorldPosition(piece, b);
              return `${p.x},${p.y},${p.z}`;
            }),
        ),
      );
      for (const blocker of blockers) {
        for (const { x, z } of columns(blocker)) {
          for (let y = generator.surfaceHeight(x, z); y < WORLD_CONFIG.chunkHeight; y += 1) {
            const id = blockAt(all, x, y, z);
            expect(id).not.toBe(BlockId.Leaves);
            if (id === BlockId.Wood) expect(templateWood.has(`${x},${y},${z}`)).toBe(true);
          }
        }
      }
    }
    // Some tree spawn near a village piece or path was actually suppressed.
    expect(suppressed).toBeGreaterThan(0);
  }, 60000);

  it('produces identical world blocks for the village in any chunk generation order', () => {
    const forward = chunks;
    const reversed = generateAll(new WorldGenerator(SEED), [...coords].reverse());
    const shuffledOrder = [...coords].sort((a, b) => ((a.cx * 7 + a.cz * 13) % 5) - ((b.cx * 7 + b.cz * 13) % 5));
    const shuffled = generateAll(new WorldGenerator(SEED), shuffledOrder);
    const isolated = new Map<string, Chunk>();
    for (const c of coords) {
      isolated.set(chunkKey(c.cx, c.cz), new WorldGenerator(SEED).generateChunk(c.cx, c.cz));
    }
    for (const c of coords) {
      const key = chunkKey(c.cx, c.cz);
      expect(reversed.get(key)!.blocks).toEqual(forward.get(key)!.blocks);
      expect(shuffled.get(key)!.blocks).toEqual(forward.get(key)!.blocks);
      expect(isolated.get(key)!.blocks).toEqual(forward.get(key)!.blocks);
    }
    // Several chunks actually received village blocks.
    const owners = new Set(
      nearest.pieces.flatMap((piece) =>
        piece.template.blocks.map((b) => {
          const p = structureBlockWorldPosition(piece, b);
          const { cx, cz } = worldToChunkCoord(p.x, p.z);
          return chunkKey(cx, cz);
        }),
      ),
    );
    expect(owners.size).toBeGreaterThan(2);
  });
});

describe('village chests and interiors', () => {
  it('lootTableAt answers village_chest at every house chest and null elsewhere', () => {
    for (const v of villages.slice(0, 5)) {
      for (const house of houses(v)) {
        const p = structureBlockWorldPosition(house, chestOf(house.template));
        expect(generator.structureLootTableAt(p.x, p.y, p.z)).toBe('village_chest');
        expect(generator.structureLootTableAt(p.x, p.y + 1, p.z)).toBeNull();
        expect(generator.structureLootTableAt(p.x, p.y - 1, p.z)).toBeNull();
      }
      const well = v.pieces[0]!;
      expect(generator.structureLootTableAt(well.originX, well.originY + 1, well.originZ)).toBeNull();
    }
  });

  it('opens a generated village chest with deterministic village loot', () => {
    const house = houses(nearest)[0]!;
    const p = structureBlockWorldPosition(house, chestOf(house.template));
    const { cx, cz } = worldToChunkCoord(p.x, p.z);
    const local = worldToLocal(p.x, p.y, p.z);
    expect(generator.generateChunk(cx, cz).getBlock(local.x, local.y, local.z)).toBe(BlockId.Chest);
    const open = (): string => {
      const ctx = { chests: new ChestStore(), worldSeed: SEED, lootTableAt: generator.structureLootTableAt.bind(generator) };
      return JSON.stringify(openChestContainer(ctx, p.x, p.y, p.z).slots());
    };
    const first = open();
    expect(first).toBe(open());
    expect(JSON.parse(first).some((slot: unknown) => slot !== null)).toBe(true);
  });

  it('keeps every house interior lit above the hostile spawn limit at night', () => {
    const store = new ChunkStore();
    const light = new LightEngine(store, blockRegistry);
    const coords = chunksCovering(boundsOf(nearest), WORLD_CONFIG.chunkWidth);
    for (const { cx, cz } of coords) store.setChunk(generator.generateChunk(cx, cz));
    for (const { cx, cz } of coords) light.lightChunk(cx, cz);

    let floorCells = 0;
    for (const house of houses(nearest)) {
      for (const block of house.template.blocks) {
        if (block.blockId !== BlockId.Air) continue;
        const p = structureBlockWorldPosition(house, block);
        const packed = getLightAt(store, p.x, p.y, p.z);
        expect(effectiveLightLevel(skyLightOf(packed), blockLightOf(packed), NIGHT)).toBeGreaterThan(
          MOB_CONFIG.hostileMaxSpawnLight,
        );
        if (block.dy === 1) {
          floorCells += 1;
          expect(findHostileSpawnY(store, blockRegistry, p.x, p.z, NIGHT, p.y)).not.toBe(p.y);
        }
      }
    }
    expect(floorCells).toBeGreaterThan(houses(nearest).length * 5);
  });
});

describe('village_chest loot table', () => {
  const table = LOOT_TABLES['village_chest'];
  if (table === undefined) throw new Error('village_chest loot table missing');

  it('uses registered everyday items within stack limits (no ore)', () => {
    const ores: number[] = [ItemId.IronOre, ItemId.GoldOre, ItemId.CoalOre];
    for (const entry of table.entries) {
      expect(itemRegistry.has(entry.itemId)).toBe(true);
      expect(ores).not.toContain(entry.itemId);
      expect(entry.min).toBeGreaterThanOrEqual(1);
      expect(entry.max).toBeGreaterThanOrEqual(entry.min);
      expect(entry.max).toBeLessThanOrEqual(itemRegistry.maxStackSize(entry.itemId));
      expect(entry.weight).toBeGreaterThan(0);
    }
    const ids = table.entries.map((e) => e.itemId);
    for (const needed of [ItemId.Apple, ItemId.Planks, ItemId.Stick, ItemId.Torch, ItemId.Coal, ItemId.WoodenPickaxe]) {
      expect(ids).toContain(needed);
    }
  });

  it('is deterministic per seed + position and stays within bounds', () => {
    expect(rollLoot(table, lootRng(SEED, 5, 40, 9))).toEqual(rollLoot(table, lootRng(SEED, 5, 40, 9)));
    for (let i = 0; i < 300; i += 1) {
      const stacks = rollLoot(table, lootRng(SEED, i, 40, -i));
      expect(stacks.length).toBeGreaterThanOrEqual(table.rolls.min);
      expect(stacks.length).toBeLessThanOrEqual(table.rolls.max);
    }
  });
});
