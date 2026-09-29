import { describe, it, expect } from 'vitest';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { BlockId } from '../src/world/blocks';
import { BiomeId } from '../src/world/biome/Biome';
import { TreePlacer, TREE_MAX_HORIZONTAL_REACH } from '../src/world/biome/TreePlacer';
import { WORLD_CONFIG, WORLD_GEN_CONFIG } from '../src/config/constants';
import { CHUNK_VOLUME, localIndex, worldToChunkCoord, worldToLocal } from '../src/world/chunkCoords';

const { chunkWidth, chunkDepth, chunkHeight, seaLevel } = WORLD_CONFIG;

describe('WorldGenerator determinism', () => {
  it('produces identical block data for the same seed and chunk coordinate', () => {
    const genA = new WorldGenerator(1234);
    const genB = new WorldGenerator(1234);

    const chunkA = genA.generateChunk(2, -3);
    const chunkB = genB.generateChunk(2, -3);

    expect(chunkA.blocks).toEqual(chunkB.blocks);
  });

  it('produces different terrain for different seeds', () => {
    const genA = new WorldGenerator(1);
    const genB = new WorldGenerator(2);

    const chunkA = genA.generateChunk(0, 0);
    const chunkB = genB.generateChunk(0, 0);

    expect(chunkA.blocks).not.toEqual(chunkB.blocks);
  });

  it('produces different terrain for different chunk coordinates', () => {
    const gen = new WorldGenerator(1);

    const chunkA = gen.generateChunk(0, 0);
    const chunkB = gen.generateChunk(5, 5);

    expect(chunkA.blocks).not.toEqual(chunkB.blocks);
  });
});

describe('WorldGenerator chunk shape', () => {
  const gen = new WorldGenerator(1);

  it('generates a chunk with the correct id/coords and full block volume', () => {
    const chunk = gen.generateChunk(1, 2);
    expect(chunk.cx).toBe(1);
    expect(chunk.cz).toBe(2);
    expect(chunk.blocks.length).toBe(CHUNK_VOLUME);
  });

  it('every column has non-Air at y=0 unless a cave legitimately carves that deep', () => {
    // Caves (see "WorldGenerator caves" below) can carve Air all the way to
    // y=0, so an Air block there is only valid if that column's cave-eligible
    // zone (surfaceY - caveSurfaceMargin) actually reaches y=0.
    const chunk = gen.generateChunk(0, 0);
    const { caveSurfaceMargin } = WORLD_GEN_CONFIG;

    for (let lx = 0; lx < chunkWidth; lx += 1) {
      for (let lz = 0; lz < chunkDepth; lz += 1) {
        const worldX = lx;
        const worldZ = lz;
        const surfaceY = gen.surfaceHeight(worldX, worldZ);
        const id = chunk.getBlock(lx, 0, lz);
        if (id === BlockId.Air) {
          expect(surfaceY - caveSurfaceMargin).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('fills the top of every column (surface up to sea level) solidly, no gaps above the cave zone', () => {
    // Below the surface but above the cave-eligible zone (topsoil, subsoil, and
    // the shallow-stone buffer) must never contain Air; caves only start at
    // (surfaceY - caveSurfaceMargin) and below.
    const gen2 = new WorldGenerator(999);
    const chunk = gen2.generateChunk(3, 3);
    const { caveSurfaceMargin } = WORLD_GEN_CONFIG;

    for (let lx = 0; lx < chunkWidth; lx += 1) {
      for (let lz = 0; lz < chunkDepth; lz += 1) {
        const worldX = 3 * chunkWidth + lx;
        const worldZ = 3 * chunkDepth + lz;
        const surfaceY = gen2.surfaceHeight(worldX, worldZ);
        const shallowMinY = Math.max(0, surfaceY - caveSurfaceMargin + 1);

        for (let y = shallowMinY; y <= seaLevel && y < chunkHeight; y += 1) {
          const id = chunk.blocks[localIndex(lx, y, lz)] as BlockId;
          expect(id).not.toBe(BlockId.Air);
        }
      }
    }
  });

  it('clamps surface height within [0, chunkHeight - 1]', () => {
    const heights: number[] = [];
    for (let x = -50; x <= 50; x += 7) {
      for (let z = -50; z <= 50; z += 7) {
        heights.push(gen.surfaceHeight(x, z));
      }
    }

    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(chunkHeight);
    }
  });
});

describe('WorldGenerator biomes', () => {
  it('is deterministic: same seed + chunk coord yields the same biome per column', () => {
    const genA = new WorldGenerator(55);
    const genB = new WorldGenerator(55);

    for (let x = -100; x <= 100; x += 23) {
      for (let z = -100; z <= 100; z += 23) {
        expect(genA.biomeAt(x, z).id).toBe(genB.biomeAt(x, z).id);
      }
    }
  });

  it('surfaceHeight uses the passed-in biome instead of recomputing it', () => {
    const gen = new WorldGenerator(1);
    const mountains = { ...gen.biomeAt(0, 0), id: BiomeId.Mountains, heightOffset: 18, heightAmplitudeScale: 2 };
    const swamp = { ...gen.biomeAt(0, 0), id: BiomeId.Swamp, heightOffset: -6, heightAmplitudeScale: 0.3 };

    // Mountains and Swamp have very different heightOffset/amplitude (24 blocks
    // apart at minimum), so forcing one or the other in must change the height
    // at nearly every column; a run of columns agreeing on the rounded result
    // by coincidence would be exceedingly unlikely.
    const heightsDiffer = (): boolean => {
      for (let x = 0; x < 64; x += 1) {
        if (gen.surfaceHeight(x, 0, mountains) !== gen.surfaceHeight(x, 0, swamp)) {
          return true;
        }
      }
      return false;
    };
    expect(heightsDiffer()).toBe(true);
  });

  /** Finds a world column classified as `biomeId` for `gen`, scanning a large area. Fails the test if none is found. */
  function findColumnWithBiome(
    gen: WorldGenerator,
    biomeId: BiomeId,
  ): { worldX: number; worldZ: number } {
    const step = 8;
    const range = 4000;
    for (let x = -range; x <= range; x += step) {
      for (let z = -range; z <= range; z += step) {
        if (gen.biomeAt(x, z).id === biomeId) {
          return { worldX: x, worldZ: z };
        }
      }
    }
    throw new Error(`No column with biome ${biomeId} found within +/-${range}.`);
  }

  /**
   * Like `findColumnWithBiome`, but also requires that no tree (rooted at this
   * column or any neighbour within tree canopy reach) could touch this exact
   * column's surface block — so a direct surface-block assertion is safe.
   */
  function findTreeFreeColumnWithBiome(
    gen: WorldGenerator,
    treePlacer: TreePlacer,
    biomeId: BiomeId,
  ): { worldX: number; worldZ: number } {
    const step = 8;
    const range = 4000;
    outer: for (let x = -range; x <= range; x += step) {
      for (let z = -range; z <= range; z += step) {
        if (gen.biomeAt(x, z).id !== biomeId) {
          continue;
        }
        for (let dx = -TREE_MAX_HORIZONTAL_REACH; dx <= TREE_MAX_HORIZONTAL_REACH; dx += 1) {
          for (let dz = -TREE_MAX_HORIZONTAL_REACH; dz <= TREE_MAX_HORIZONTAL_REACH; dz += 1) {
            const neighborBiome = gen.biomeAt(x + dx, z + dz);
            if (treePlacer.isTreeSpawn(x + dx, z + dz, neighborBiome.id)) {
              continue outer;
            }
          }
        }
        return { worldX: x, worldZ: z };
      }
    }
    throw new Error(`No tree-free column with biome ${biomeId} found within +/-${range}.`);
  }

  it('fills Mountains columns with stone at the surface (above the beach band)', () => {
    const gen = new WorldGenerator(1);
    const { worldX, worldZ } = findColumnWithBiome(gen, BiomeId.Mountains);
    const { cx, cz } = worldToChunkCoord(worldX, worldZ);
    const local = worldToLocal(worldX, 0, worldZ);

    const surfaceY = gen.surfaceHeight(worldX, worldZ);
    expect(surfaceY).toBeGreaterThan(WORLD_CONFIG.seaLevel + 1);

    const chunk = gen.generateChunk(cx, cz);
    expect(chunk.getBlock(local.x, surfaceY, local.z)).toBe(BlockId.Stone);
  });

  it('fills non-beach Desert columns with sand at the surface', () => {
    const gen = new WorldGenerator(1);
    const { worldX, worldZ } = findColumnWithBiome(gen, BiomeId.Desert);
    const { cx, cz } = worldToChunkCoord(worldX, worldZ);
    const local = worldToLocal(worldX, 0, worldZ);

    const surfaceY = gen.surfaceHeight(worldX, worldZ);
    const chunk = gen.generateChunk(cx, cz);
    expect(chunk.getBlock(local.x, surfaceY, local.z)).toBe(BlockId.Sand);
  });

  it.each([
    [BiomeId.Plains, BlockId.Grass],
    [BiomeId.Forest, BlockId.Grass],
    [BiomeId.Taiga, BlockId.Grass],
    [BiomeId.Swamp, BlockId.Dirt],
  ])('fills non-beach %i columns with the biome surface block', (biomeId, expectedSurfaceBlock) => {
    const gen = new WorldGenerator(1);
    const treePlacer = new TreePlacer(1);
    const { worldX, worldZ } = findTreeFreeColumnWithBiome(gen, treePlacer, biomeId);
    const { cx, cz } = worldToChunkCoord(worldX, worldZ);
    const local = worldToLocal(worldX, 0, worldZ);

    const surfaceY = gen.surfaceHeight(worldX, worldZ);
    if (surfaceY <= WORLD_CONFIG.seaLevel + 1) {
      // Beach band overrides the biome surface block with sand; skip this sample.
      return;
    }

    const chunk = gen.generateChunk(cx, cz);
    expect(chunk.getBlock(local.x, surfaceY, local.z)).toBe(expectedSurfaceBlock);
  });
});

describe('WorldGenerator trees', () => {
  it('is deterministic: same seed + chunk coord yields identical tree blocks', () => {
    const genA = new WorldGenerator(5);
    const genB = new WorldGenerator(5);

    const chunkA = genA.generateChunk(0, 0);
    const chunkB = genB.generateChunk(0, 0);

    expect(chunkA.blocks).toEqual(chunkB.blocks);
  });

  it('places at least one Wood and Leaves block across a sample of Forest-heavy chunks', () => {
    const gen = new WorldGenerator(5);
    let sawWood = false;
    let sawLeaves = false;

    for (let cx = -6; cx <= 6 && !(sawWood && sawLeaves); cx += 1) {
      for (let cz = -6; cz <= 6 && !(sawWood && sawLeaves); cz += 1) {
        const chunk = gen.generateChunk(cx, cz);
        if (chunk.blocks.includes(BlockId.Wood)) sawWood = true;
        if (chunk.blocks.includes(BlockId.Leaves)) sawLeaves = true;
      }
    }

    expect(sawWood).toBe(true);
    expect(sawLeaves).toBe(true);
  });

  it('never places a tree trunk block underwater or below sea level', () => {
    const gen = new WorldGenerator(5);

    for (let cx = -3; cx <= 3; cx += 1) {
      for (let cz = -3; cz <= 3; cz += 1) {
        const chunk = gen.generateChunk(cx, cz);
        for (let lx = 0; lx < chunkWidth; lx += 1) {
          for (let lz = 0; lz < chunkDepth; lz += 1) {
            for (let y = 0; y <= seaLevel; y += 1) {
              const id = chunk.getBlock(lx, y, lz);
              expect(id).not.toBe(BlockId.Wood);
            }
          }
        }
      }
    }
  }, 20000);

  it('renders a tree spanning a chunk boundary identically regardless of generation order, with blocks landing on both sides', () => {
    // Trees near a chunk edge spill Wood/Leaves into the neighbour chunk; generating
    // chunks in either order (or just one side) must produce the same overlapping blocks.
    const seed = 5;
    const gen = new WorldGenerator(seed);
    const treePlacer = new TreePlacer(seed);
    const searchRange = 4000;

    // Cheap search (no chunk generation): find a tree spawn column sitting within
    // canopy reach of a chunk's X boundary (worldX % chunkWidth near 0 or chunkWidth-1),
    // with its canopy actually reaching past that boundary into the neighbour chunk.
    let rootColumn: { worldX: number; worldZ: number; neighborCx: number } | null = null;
    outer: for (let worldX = -searchRange; worldX <= searchRange; worldX += 1) {
      const localX = ((worldX % chunkWidth) + chunkWidth) % chunkWidth;
      const nearLeftEdge = localX < TREE_MAX_HORIZONTAL_REACH;
      const nearRightEdge = localX >= chunkWidth - TREE_MAX_HORIZONTAL_REACH;
      if (!nearLeftEdge && !nearRightEdge) {
        continue;
      }
      for (let worldZ = -50; worldZ <= 50; worldZ += 1) {
        const biome = gen.biomeAt(worldX, worldZ);
        if (!treePlacer.isTreeSpawn(worldX, worldZ, biome.id)) {
          continue;
        }
        const groundY = gen.surfaceHeight(worldX, worldZ, biome);
        if (groundY <= seaLevel + 1) {
          continue;
        }
        const { cx: rootCx } = worldToChunkCoord(worldX, worldZ);
        const neighborCx = nearLeftEdge ? rootCx - 1 : rootCx + 1;
        // Confirm at least one canopy block's world X actually falls in the neighbour chunk.
        const spillsOver = treePlacer
          .treeBlocks()
          .some((b) => worldToChunkCoord(worldX + b.dx, worldZ).cx === neighborCx);
        if (!spillsOver) {
          continue;
        }
        // Require no other tree spawns within double the canopy reach, so this tree's
        // blocks can't be overwritten by a second nearby tree (keeps the assertion exact).
        let hasNearbyTree = false;
        for (let ddx = -TREE_MAX_HORIZONTAL_REACH * 2; ddx <= TREE_MAX_HORIZONTAL_REACH * 2 && !hasNearbyTree; ddx += 1) {
          for (let ddz = -TREE_MAX_HORIZONTAL_REACH * 2; ddz <= TREE_MAX_HORIZONTAL_REACH * 2; ddz += 1) {
            if (ddx === 0 && ddz === 0) continue;
            const nx = worldX + ddx;
            const nz = worldZ + ddz;
            const nBiome = gen.biomeAt(nx, nz);
            if (treePlacer.isTreeSpawn(nx, nz, nBiome.id)) {
              hasNearbyTree = true;
              break;
            }
          }
        }
        if (hasNearbyTree) {
          continue;
        }

        rootColumn = { worldX, worldZ, neighborCx };
        break outer;
      }
    }

    expect(rootColumn).not.toBeNull();
    const { worldX, worldZ, neighborCx } = rootColumn!;
    const { cx: rootCx, cz } = worldToChunkCoord(worldX, worldZ);
    const groundY = gen.surfaceHeight(worldX, worldZ);
    const expectedBlocks = treePlacer.treeBlocks();

    /** Reads back every expected tree block's world position from whichever of the two chunks contains it. */
    function assertTreeBlocksPresent(rootChunk: ReturnType<WorldGenerator['generateChunk']>, neighborChunk: ReturnType<WorldGenerator['generateChunk']>): void {
      let sawSpillover = false;
      for (const { dx, dy, dz, blockId } of expectedBlocks) {
        const absX = worldX + dx;
        const absZ = worldZ + dz;
        const absY = groundY + dy;
        const { cx: ownerCx } = worldToChunkCoord(absX, absZ);
        const chunk = ownerCx === rootCx ? rootChunk : neighborChunk;
        expect(ownerCx === rootCx || ownerCx === neighborCx).toBe(true);
        const local = worldToLocal(absX, absY, absZ);
        expect(chunk.getBlock(local.x, local.y, local.z)).toBe(blockId);
        if (ownerCx === neighborCx) {
          sawSpillover = true;
        }
      }
      expect(sawSpillover).toBe(true);
    }

    // Regenerate independently (fresh generator instances) in both possible orders.
    const genOrderA = new WorldGenerator(seed);
    const chunkA1 = genOrderA.generateChunk(rootCx, cz);
    const chunkA2 = genOrderA.generateChunk(neighborCx, cz);

    const genOrderB = new WorldGenerator(seed);
    const chunkB2 = genOrderB.generateChunk(neighborCx, cz);
    const chunkB1 = genOrderB.generateChunk(rootCx, cz);

    expect(chunkA1.blocks).toEqual(chunkB1.blocks);
    expect(chunkA2.blocks).toEqual(chunkB2.blocks);
    assertTreeBlocksPresent(chunkA1, chunkA2);
  });
});

describe('WorldGenerator ores', () => {
  it('is deterministic: same seed + chunk coord yields identical ore placement', () => {
    const genA = new WorldGenerator(11);
    const genB = new WorldGenerator(11);

    const chunkA = genA.generateChunk(1, -1);
    const chunkB = genB.generateChunk(1, -1);

    expect(chunkA.blocks).toEqual(chunkB.blocks);
  });

  it('places at least one CoalOre block across a sample of chunks (deep stone exists)', () => {
    const gen = new WorldGenerator(11);
    let sawCoal = false;

    for (let cx = -4; cx <= 4 && !sawCoal; cx += 1) {
      for (let cz = -4; cz <= 4 && !sawCoal; cz += 1) {
        const chunk = gen.generateChunk(cx, cz);
        if (chunk.blocks.includes(BlockId.CoalOre)) {
          sawCoal = true;
        }
      }
    }

    expect(sawCoal).toBe(true);
  });

  it('never places ore blocks above their configured maxY', () => {
    const gen = new WorldGenerator(11);

    for (let cx = -3; cx <= 3; cx += 1) {
      for (let cz = -3; cz <= 3; cz += 1) {
        const chunk = gen.generateChunk(cx, cz);
        for (let lx = 0; lx < chunkWidth; lx += 1) {
          for (let lz = 0; lz < chunkDepth; lz += 1) {
            for (let y = 25; y < chunkHeight; y += 1) {
              // GoldOre's band tops out at y=24; above that it must never appear.
              expect(chunk.getBlock(lx, y, lz)).not.toBe(BlockId.GoldOre);
            }
          }
        }
      }
    }
  }, 20000);

  it('never places ore in the topsoil/subsoil layer, above the surface, or in water (only replaces deep stone)', () => {
    const gen = new WorldGenerator(11);
    const oreIds: BlockId[] = [BlockId.CoalOre, BlockId.IronOre, BlockId.GoldOre];
    // Blocks from (surfaceY - shallowDepthBelowSurface) to surfaceY inclusive are
    // topsoil/subsoil (see generateChunk), never deep stone/ore.
    const shallowDepthBelowSurface =
      WORLD_GEN_CONFIG.surfaceDepth + WORLD_GEN_CONFIG.subsoilDepth - 1;

    for (let cx = -3; cx <= 3; cx += 1) {
      for (let cz = -3; cz <= 3; cz += 1) {
        const chunk = gen.generateChunk(cx, cz);
        for (let lx = 0; lx < chunkWidth; lx += 1) {
          for (let lz = 0; lz < chunkDepth; lz += 1) {
            const worldX = cx * chunkWidth + lx;
            const worldZ = cz * chunkDepth + lz;
            const surfaceY = gen.surfaceHeight(worldX, worldZ);
            const shallowMinY = Math.max(0, surfaceY - shallowDepthBelowSurface);

            for (let y = shallowMinY; y < chunkHeight; y += 1) {
              const id = chunk.getBlock(lx, y, lz);
              expect(oreIds.includes(id as BlockId)).toBe(false);
            }
          }
        }
      }
    }
  }, 20000);
});

describe('WorldGenerator caves', () => {
  it('is deterministic: same seed + chunk coord yields identical cave carving', () => {
    const genA = new WorldGenerator(21);
    const genB = new WorldGenerator(21);

    const chunkA = genA.generateChunk(0, 0);
    const chunkB = genB.generateChunk(0, 0);

    expect(chunkA.blocks).toEqual(chunkB.blocks);
  });

  it('carves at least one Air block below the surface across a sample of chunks', () => {
    const gen = new WorldGenerator(21);
    let sawUndergroundAir = false;

    outer: for (let cx = -4; cx <= 4; cx += 1) {
      for (let cz = -4; cz <= 4; cz += 1) {
        const chunk = gen.generateChunk(cx, cz);
        for (let lx = 0; lx < chunkWidth; lx += 1) {
          for (let lz = 0; lz < chunkDepth; lz += 1) {
            const worldX = cx * chunkWidth + lx;
            const worldZ = cz * chunkDepth + lz;
            const surfaceY = gen.surfaceHeight(worldX, worldZ);
            const caveCeiling = surfaceY - WORLD_GEN_CONFIG.caveSurfaceMargin;

            for (let y = 0; y <= Math.min(caveCeiling, chunkHeight - 1); y += 1) {
              if (chunk.getBlock(lx, y, lz) === BlockId.Air) {
                sawUndergroundAir = true;
                break outer;
              }
            }
          }
        }
      }
    }

    expect(sawUndergroundAir).toBe(true);
  });

  it('never carves within caveSurfaceMargin blocks of a column\'s own surface', () => {
    const gen = new WorldGenerator(21);
    const { caveSurfaceMargin } = WORLD_GEN_CONFIG;

    for (let cx = -3; cx <= 3; cx += 1) {
      for (let cz = -3; cz <= 3; cz += 1) {
        const chunk = gen.generateChunk(cx, cz);
        for (let lx = 0; lx < chunkWidth; lx += 1) {
          for (let lz = 0; lz < chunkDepth; lz += 1) {
            const worldX = cx * chunkWidth + lx;
            const worldZ = cz * chunkDepth + lz;
            const surfaceY = gen.surfaceHeight(worldX, worldZ);
            const shallowMinY = Math.max(0, surfaceY - caveSurfaceMargin + 1);

            for (let y = shallowMinY; y <= surfaceY; y += 1) {
              expect(chunk.getBlock(lx, y, lz)).not.toBe(BlockId.Air);
            }
          }
        }
      }
    }
  }, 20000);
});
