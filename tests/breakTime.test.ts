import { describe, it, expect } from 'vitest';
import { breakDuration, canHarvest, BreakProgress } from '../src/gameplay/breakTime';
import { blockRegistry } from '../src/world/BlockRegistry';
import { BlockId } from '../src/world/blocks';
import { itemRegistry } from '../src/items/ItemRegistry';
import { ItemId, type ToolProperties } from '../src/items/items';
import { BREAK_CONFIG } from '../src/config/constants';

const woodPickaxe = itemRegistry.toolFor(ItemId.WoodenPickaxe) as ToolProperties;
const stonePickaxe = itemRegistry.toolFor(ItemId.StonePickaxe) as ToolProperties;
const woodAxe = itemRegistry.toolFor(ItemId.WoodenAxe) as ToolProperties;
const woodShovel = itemRegistry.toolFor(ItemId.WoodenShovel) as ToolProperties;

describe('canHarvest', () => {
  it('true for a block with no requiresTool, regardless of tool', () => {
    const dirt = blockRegistry.get(BlockId.Dirt);
    expect(canHarvest(dirt, undefined)).toBe(true);
    expect(canHarvest(dirt, woodPickaxe)).toBe(true);
  });

  it('requiresTool block: false with no tool', () => {
    const stone = blockRegistry.get(BlockId.Stone);
    expect(canHarvest(stone, undefined)).toBe(false);
  });

  it('requiresTool block: false with a wrong-type tool', () => {
    const stone = blockRegistry.get(BlockId.Stone);
    expect(canHarvest(stone, woodAxe)).toBe(false);
  });

  it('requiresTool block: true with a matching tool type (any tier)', () => {
    const stone = blockRegistry.get(BlockId.Stone);
    expect(canHarvest(stone, woodPickaxe)).toBe(true);
    expect(canHarvest(stone, stonePickaxe)).toBe(true);
  });

  it('matrix over every requiresTool block and every tool type', () => {
    const requiresToolBlocks = [BlockId.Stone, BlockId.Cobblestone, BlockId.CoalOre, BlockId.IronOre, BlockId.GoldOre];
    const tools: Record<string, ToolProperties> = { pickaxe: woodPickaxe, axe: woodAxe, shovel: woodShovel };

    for (const blockId of requiresToolBlocks) {
      const def = blockRegistry.get(blockId);
      for (const [type, tool] of Object.entries(tools)) {
        expect(canHarvest(def, tool)).toBe(type === def.toolType);
      }
    }
  });
});

describe('breakDuration', () => {
  it('is instant (0) for hardness 0 blocks', () => {
    const torch = blockRegistry.get(BlockId.Torch);
    expect(torch.hardness).toBe(0);
    expect(breakDuration(torch, undefined)).toBe(0);
    expect(breakDuration(torch, woodPickaxe)).toBe(0);
  });

  it('no-harvest (wrong/no tool) is slower than harvest for a requiresTool block', () => {
    const stone = blockRegistry.get(BlockId.Stone);
    const noTool = breakDuration(stone, undefined);
    const withPickaxe = breakDuration(stone, woodPickaxe);
    expect(noTool).toBeGreaterThan(withPickaxe);
  });

  it('matches the documented formula for a harvestable block with a matching tool', () => {
    const stone = blockRegistry.get(BlockId.Stone);
    const expected = (stone.hardness * BREAK_CONFIG.harvestMultiplier) / woodPickaxe.speed;
    expect(breakDuration(stone, woodPickaxe)).toBeCloseTo(expected, 9);
  });

  it('matches the documented formula for a non-harvestable block (no divide by speed)', () => {
    const stone = blockRegistry.get(BlockId.Stone);
    const expected = stone.hardness * BREAK_CONFIG.noHarvestMultiplier;
    expect(breakDuration(stone, undefined)).toBeCloseTo(expected, 9);
  });

  it('a stone pickaxe breaks stone faster than a wooden pickaxe', () => {
    const stone = blockRegistry.get(BlockId.Stone);
    const wood = breakDuration(stone, woodPickaxe);
    const stoneTool = breakDuration(stone, stonePickaxe);
    expect(stoneTool).toBeLessThan(wood);
  });

  it('wrong tool type behaves like bare hand (no speed division) for a non-requiresTool block', () => {
    const dirtDef = blockRegistry.get(BlockId.Dirt); // toolType 'shovel', no requiresTool
    const withWrongTool = breakDuration(dirtDef, woodPickaxe);
    const withHand = breakDuration(dirtDef, undefined);
    expect(withWrongTool).toBe(withHand);
  });

  it('correct tool type divides duration by speed even without requiresTool', () => {
    const dirtDef = blockRegistry.get(BlockId.Dirt);
    const withShovel = breakDuration(dirtDef, woodShovel);
    const withHand = breakDuration(dirtDef, undefined);
    expect(withShovel).toBeCloseTo(withHand / woodShovel.speed, 9);
  });

  it('is deterministic (pure function of inputs)', () => {
    const stone = blockRegistry.get(BlockId.Stone);
    const a = breakDuration(stone, woodPickaxe);
    const b = breakDuration(stone, woodPickaxe);
    expect(a).toBe(b);
  });
});

describe('BreakProgress', () => {
  it('accumulates progress across frames toward duration', () => {
    const progress = new BreakProgress();
    const target = { x: 0, y: 0, z: 0 };
    expect(progress.update(target, true, 1, 4)).toBe('breaking');
    expect(progress.progress).toBeCloseTo(0.25, 6);
    expect(progress.update(target, true, 1, 4)).toBe('breaking');
    expect(progress.progress).toBeCloseTo(0.5, 6);
  });

  it('reaches "broken" exactly once at duration, then resets', () => {
    const progress = new BreakProgress();
    const target = { x: 0, y: 0, z: 0 };
    progress.update(target, true, 3, 4);
    expect(progress.update(target, true, 1, 4)).toBe('broken');
    expect(progress.progress).toBe(0);
    // Continuing to hold the same target starts a fresh accumulation, not an
    // immediate repeated 'broken'.
    expect(progress.update(target, true, 1, 4)).toBe('breaking');
  });

  it('resets when the button is released', () => {
    const progress = new BreakProgress();
    const target = { x: 0, y: 0, z: 0 };
    progress.update(target, true, 2, 4);
    expect(progress.update(target, false, 0, 4)).toBe('idle');
    expect(progress.progress).toBe(0);
    // Progress restarted from zero, not resumed.
    expect(progress.update(target, true, 1, 4)).toBe('breaking');
    expect(progress.progress).toBeCloseTo(0.25, 6);
  });

  it('resets when the target cell changes', () => {
    const progress = new BreakProgress();
    progress.update({ x: 0, y: 0, z: 0 }, true, 3, 4);
    expect(progress.progress).toBeCloseTo(0.75, 6);
    progress.update({ x: 1, y: 0, z: 0 }, true, 0, 4);
    expect(progress.progress).toBe(0);
  });

  it('resets when the target is null', () => {
    const progress = new BreakProgress();
    progress.update({ x: 0, y: 0, z: 0 }, true, 2, 4);
    expect(progress.update(null, true, 1, 4)).toBe('idle');
    expect(progress.progress).toBe(0);
  });

  it('instant duration (0) breaks on the first held frame', () => {
    const progress = new BreakProgress();
    const target = { x: 0, y: 0, z: 0 };
    expect(progress.update(target, true, 0, 0)).toBe('broken');
  });

  it('clamps a negative dt to 0 rather than reducing progress', () => {
    const progress = new BreakProgress();
    const target = { x: 0, y: 0, z: 0 };
    progress.update(target, true, 2, 4);
    expect(progress.update(target, true, -5, 4)).toBe('breaking');
    expect(progress.progress).toBeCloseTo(0.5, 6);
  });

  it('is deterministic given the same sequence of calls', () => {
    const target = { x: 0, y: 0, z: 0 };
    const run = (): string[] => {
      const progress = new BreakProgress();
      return [
        progress.update(target, true, 1, 4),
        progress.update(target, true, 1, 4),
        progress.update(target, true, 1, 4),
        progress.update(target, true, 1, 4),
      ];
    };
    expect(run()).toEqual(run());
  });

  it('idle when not held, even with a target', () => {
    const progress = new BreakProgress();
    expect(progress.update({ x: 0, y: 0, z: 0 }, false, 1, 4)).toBe('idle');
    expect(progress.progress).toBe(0);
  });
});
