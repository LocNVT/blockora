import { describe, it, expect } from 'vitest';
import { TreePlacer, TREE_MAX_HORIZONTAL_REACH } from '../src/world/biome/TreePlacer';
import { BiomeId } from '../src/world/biome/Biome';
import { BlockId } from '../src/world/blocks';

describe('TreePlacer.isTreeSpawn', () => {
  it('never spawns in biomes with zero tree density', () => {
    const placer = new TreePlacer(1);
    for (let x = -200; x <= 200; x += 3) {
      for (const biomeId of [BiomeId.Desert, BiomeId.Mountains, BiomeId.Swamp]) {
        expect(placer.isTreeSpawn(x, 0, biomeId)).toBe(false);
      }
    }
  });

  it('is deterministic: same seed + column + biome always agrees', () => {
    const a = new TreePlacer(9);
    const b = new TreePlacer(9);

    for (let x = -100; x <= 100; x += 7) {
      for (let z = -100; z <= 100; z += 7) {
        expect(a.isTreeSpawn(x, z, BiomeId.Forest)).toBe(b.isTreeSpawn(x, z, BiomeId.Forest));
      }
    }
  });

  it('spawns at least one tree in Forest across a wide sample (density is nonzero)', () => {
    const placer = new TreePlacer(5);
    let spawnCount = 0;

    for (let x = -300; x <= 300; x += 1) {
      if (placer.isTreeSpawn(x, 0, BiomeId.Forest)) {
        spawnCount += 1;
      }
    }

    expect(spawnCount).toBeGreaterThan(0);
  });

  it('a denser biome spawns at least as many trees as a sparser one over a large sample', () => {
    const placer = new TreePlacer(5);
    let forestCount = 0;
    let plainsCount = 0;

    for (let x = -500; x <= 500; x += 1) {
      if (placer.isTreeSpawn(x, 1, BiomeId.Forest)) forestCount += 1;
      if (placer.isTreeSpawn(x, 1, BiomeId.Plains)) plainsCount += 1;
    }

    expect(forestCount).toBeGreaterThan(plainsCount);
  });
});

describe('TreePlacer.treeBlocks', () => {
  it('produces a trunk column of Wood and never places Wood off-center', () => {
    const placer = new TreePlacer(1);
    const blocks = placer.treeBlocks();

    const trunkBlocks = blocks.filter((b) => b.blockId === BlockId.Wood);
    expect(trunkBlocks.length).toBeGreaterThan(0);
    for (const b of trunkBlocks) {
      expect(b.dx).toBe(0);
      expect(b.dz).toBe(0);
      expect(b.dy).toBeGreaterThan(0);
    }
  });

  it('produces Leaves blocks surrounding the top of the trunk within the max horizontal reach', () => {
    const placer = new TreePlacer(1);
    const blocks = placer.treeBlocks();
    const leafBlocks = blocks.filter((b) => b.blockId === BlockId.Leaves);

    expect(leafBlocks.length).toBeGreaterThan(0);
    for (const b of leafBlocks) {
      expect(Math.abs(b.dx)).toBeLessThanOrEqual(TREE_MAX_HORIZONTAL_REACH);
      expect(Math.abs(b.dz)).toBeLessThanOrEqual(TREE_MAX_HORIZONTAL_REACH);
    }
  });

  it('never emits duplicate offsets (trunk/canopy do not collide)', () => {
    const placer = new TreePlacer(1);
    const blocks = placer.treeBlocks();
    const seen = new Set<string>();

    for (const b of blocks) {
      const key = `${b.dx},${b.dy},${b.dz}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
