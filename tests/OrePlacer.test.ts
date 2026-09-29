import { describe, it, expect } from 'vitest';
import { OrePlacer } from '../src/world/ore/OrePlacer';
import { ORE_VEIN_DEFINITIONS } from '../src/world/ore/OreVein';
import { BlockId } from '../src/world/blocks';

describe('OrePlacer.oreAt', () => {
  it('is deterministic: same seed + position always agrees', () => {
    const a = new OrePlacer(11);
    const b = new OrePlacer(11);

    for (let x = -30; x <= 30; x += 5) {
      for (let y = 0; y <= 90; y += 5) {
        for (let z = -30; z <= 30; z += 5) {
          expect(a.oreAt(x, y, z)).toBe(b.oreAt(x, y, z));
        }
      }
    }
  });

  it('never returns an ore above its defined maxY', () => {
    const placer = new OrePlacer(11);
    for (const vein of ORE_VEIN_DEFINITIONS) {
      for (let x = -50; x <= 50; x += 3) {
        for (let z = -50; z <= 50; z += 3) {
          const id = placer.oreAt(x, vein.maxY + 1, z);
          expect(id).not.toBe(vein.blockId);
        }
      }
    }
  });

  it('never returns an ore below its defined minY', () => {
    const placer = new OrePlacer(11);
    for (const vein of ORE_VEIN_DEFINITIONS) {
      if (vein.minY <= 0) {
        continue; // no world Y exists below 0 to sample
      }
      for (let x = -50; x <= 50; x += 3) {
        for (let z = -50; z <= 50; z += 3) {
          const id = placer.oreAt(x, vein.minY - 1, z);
          expect(id).not.toBe(vein.blockId);
        }
      }
    }
  });

  it('produces each ore type somewhere within its Y band across a wide sample', () => {
    const placer = new OrePlacer(11);

    for (const vein of ORE_VEIN_DEFINITIONS) {
      let found = false;
      for (let x = -80; x <= 80 && !found; x += 1) {
        for (let y = vein.minY; y <= vein.maxY && !found; y += 1) {
          for (let z = -80; z <= 80 && !found; z += 1) {
            if (placer.oreAt(x, y, z) === vein.blockId) {
              found = true;
            }
          }
        }
      }
      expect(found).toBe(true);
    }
  });

  it('returns null (plain stone) far more often than any single ore (rarity)', () => {
    const placer = new OrePlacer(11);
    let oreCount = 0;
    let total = 0;

    for (let x = -40; x <= 40; x += 1) {
      for (let y = 0; y <= 90; y += 4) {
        for (let z = -40; z <= 40; z += 4) {
          total += 1;
          if (placer.oreAt(x, y, z) !== null) {
            oreCount += 1;
          }
        }
      }
    }

    expect(oreCount).toBeLessThan(total * 0.5);
  });

  it('deeper/rarer ores (Gold) are strictly less common than shallower/common ones (Coal)', () => {
    const placer = new OrePlacer(11);
    let coalCount = 0;
    let goldCount = 0;

    for (let x = -60; x <= 60; x += 1) {
      for (let y = 0; y <= 24; y += 1) {
        for (let z = -60; z <= 60; z += 2) {
          const id = placer.oreAt(x, y, z);
          if (id === BlockId.CoalOre) coalCount += 1;
          if (id === BlockId.GoldOre) goldCount += 1;
        }
      }
    }

    expect(goldCount).toBeLessThan(coalCount);
  });
});
