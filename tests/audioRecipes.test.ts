import { describe, it, expect } from 'vitest';
import { BlockId } from '../src/world/blocks';
import { MobType } from '../src/entities/mobDefinitions';
import { soundMaterialOf } from '../src/audio/soundMaterial';
import { allRecipes, recipeDuration, soundFor } from '../src/audio/soundRecipes';
import { resolveRecipe } from '../src/audio/variation';
import { mulberry32 } from '../src/util/mulberry32';
import { BLOCK_DEFINITIONS } from '../src/world/blocks';
import type { GameEvent } from '../src/events/GameEvents';

const POS = { x: 1, y: 2, z: 3 };

function idOf(event: GameEvent): string | null {
  return soundFor(event)?.recipe.id ?? null;
}

describe('sound material per block', () => {
  it('maps every block id to a material (air is silent)', () => {
    for (const def of BLOCK_DEFINITIONS) {
      if (def.id === BlockId.Air) {
        expect(soundMaterialOf(def.id)).toBeNull();
      } else {
        expect(soundMaterialOf(def.id)).not.toBeNull();
      }
    }
  });

  it('groups blocks by flavour', () => {
    expect(soundMaterialOf(BlockId.Stone)).toBe('stone');
    expect(soundMaterialOf(BlockId.CoalOre)).toBe('stone');
    expect(soundMaterialOf(BlockId.Cobblestone)).toBe('stone');
    expect(soundMaterialOf(BlockId.Planks)).toBe('wood');
    expect(soundMaterialOf(BlockId.Chest)).toBe('wood');
    expect(soundMaterialOf(BlockId.Sand)).toBe('sand');
    expect(soundMaterialOf(BlockId.Gravel)).toBe('gravel');
    expect(soundMaterialOf(BlockId.Glass)).toBe('glass');
    expect(soundMaterialOf(BlockId.Leaves)).toBe('leaves');
    expect(soundMaterialOf(BlockId.Dirt)).toBe('dirt');
    expect(soundMaterialOf(BlockId.Grass)).toBe('grass');
    expect(soundMaterialOf(9999)).toBe('stone');
  });
});

describe('recipe selection per event', () => {
  it('break and place pick the recipe of the block material', () => {
    expect(idOf({ type: 'blockBreak', blockId: BlockId.Stone, position: POS })).toBe('break.stone');
    expect(idOf({ type: 'blockBreak', blockId: BlockId.Glass, position: POS })).toBe('break.glass');
    expect(idOf({ type: 'blockBreak', blockId: BlockId.Leaves, position: POS })).toBe('break.leaves');
    expect(idOf({ type: 'blockPlace', blockId: BlockId.Planks, position: POS })).toBe('place.wood');
    expect(idOf({ type: 'blockPlace', blockId: BlockId.Sand, position: POS })).toBe('place.sand');
    expect(idOf({ type: 'blockBreak', blockId: BlockId.Air, position: POS })).toBeNull();
  });

  it('footsteps follow the surface material, quieter when crouching', () => {
    const walk = soundFor({ type: 'footstep', blockId: BlockId.Grass, sprinting: false, crouching: false });
    const sneak = soundFor({ type: 'footstep', blockId: BlockId.Grass, sprinting: false, crouching: true });
    expect(walk?.recipe.id).toBe('place.grass');
    expect(sneak?.gain).toBeLessThan(walk?.gain ?? 0);
    expect(soundFor({ type: 'footstep', blockId: BlockId.Air, sprinting: false, crouching: false })).toBeNull();
    expect(idOf({ type: 'footstep', blockId: BlockId.Water, sprinting: false, crouching: false })).toBe('step.water');
  });

  it('landing gets louder with fall speed', () => {
    const soft = soundFor({ type: 'land', blockId: BlockId.Stone, fallSpeed: 5 })?.gain ?? 0;
    const hard = soundFor({ type: 'land', blockId: BlockId.Stone, fallSpeed: 25 })?.gain ?? 0;
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(1);
  });

  it('player, item and UI events each have a recipe', () => {
    expect(idOf({ type: 'playerHurt' })).toBe('player.hurt');
    expect(idOf({ type: 'playerDeath' })).toBe('player.death');
    expect(idOf({ type: 'eatBite' })).toBe('eat.bite');
    expect(idOf({ type: 'eatDone' })).toBe('eat.done');
    expect(idOf({ type: 'pickup' })).toBe('pickup');
    expect(idOf({ type: 'chestOpen' })).toBe('chest.open');
    expect(idOf({ type: 'jump', blockId: BlockId.Dirt })).toBe('jump');
  });

  it('mob sounds pick the recipe by mob type and are positional', () => {
    expect(idOf({ type: 'mobIdle', mobType: MobType.Pig, position: POS })).toBe('pig.idle');
    expect(idOf({ type: 'mobHurt', mobType: MobType.Pig, position: POS })).toBe('pig.hurt');
    expect(idOf({ type: 'mobIdle', mobType: MobType.Shambler, position: POS })).toBe('shambler.idle');
    expect(idOf({ type: 'mobHurt', mobType: MobType.Shambler, position: POS })).toBe('shambler.hurt');
    expect(idOf({ type: 'mobDeath', mobType: MobType.Shambler, position: POS })).toBe('shambler.death');
    expect(soundFor({ type: 'mobHurt', mobType: MobType.Pig, position: POS })?.position).toEqual(POS);
    expect(idOf({ type: 'mobHurt', mobType: 99, position: POS })).toBeNull();
  });
});

describe('recipe data', () => {
  it('every recipe has sane, finite parameters', () => {
    for (const recipe of allRecipes()) {
      expect(recipe.layers.length).toBeGreaterThan(0);
      expect(recipeDuration(recipe)).toBeGreaterThan(0);
      expect(recipeDuration(recipe)).toBeLessThan(2);
      for (const layer of recipe.layers) {
        expect(layer.gain).toBeGreaterThan(0);
        expect(layer.gain).toBeLessThanOrEqual(1);
        expect(layer.env.sustain).toBeGreaterThanOrEqual(0);
        expect(layer.env.sustain).toBeLessThanOrEqual(1);
        if (layer.source !== 'noise') {
          expect(layer.freq).toBeGreaterThan(20);
        }
      }
    }
  });
});

describe('variation', () => {
  const recipe = allRecipes()[0];
  if (recipe === undefined) {
    throw new Error('no recipes');
  }

  it('is deterministic for a seeded RNG', () => {
    expect(resolveRecipe(recipe, mulberry32(7))).toEqual(resolveRecipe(recipe, mulberry32(7)));
  });

  it('differs between playbacks but stays within the recipe bounds', () => {
    const rng = mulberry32(42);
    const seen = new Set<number>();
    const { pitchCents, filter, gain } = recipe.variation;
    for (let i = 0; i < 200; i += 1) {
      const layers = resolveRecipe(recipe, rng);
      layers.forEach((resolved, index) => {
        const base = recipe.layers[index];
        if (base === undefined) {
          throw new Error('layer mismatch');
        }
        const gainRatio = resolved.gain / base.gain;
        expect(gainRatio).toBeGreaterThanOrEqual(1 - gain - 1e-9);
        expect(gainRatio).toBeLessThanOrEqual(1 + gain + 1e-9);
        if (base.source !== 'noise') {
          const cents = 1200 * Math.log2(resolved.freq / base.freq);
          expect(Math.abs(cents)).toBeLessThanOrEqual(pitchCents + 1e-6);
        }
        if (base.filter !== undefined && resolved.filter !== null) {
          const ratio = resolved.filter.freq / base.filter.freq;
          expect(ratio).toBeGreaterThanOrEqual(1 - filter - 1e-9);
          expect(ratio).toBeLessThanOrEqual(1 + filter + 1e-9);
        }
        expect(resolved.noiseOffset).toBeGreaterThanOrEqual(0);
        expect(resolved.noiseOffset).toBeLessThan(1);
      });
      seen.add(layers[0]?.gain ?? 0);
    }
    expect(seen.size).toBeGreaterThan(50);
  });
});
