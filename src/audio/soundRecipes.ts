import { AUDIO_CONFIG } from '../config/constants';
import { MobType } from '../entities/mobDefinitions';
import type { GameEvent } from '../events/GameEvents';
import { soundMaterialOf, type SoundMaterial } from './soundMaterial';

/** Attack / decay / sustain / release envelope; times in seconds, sustain is a 0..1 level held for `hold`. */
export interface EnvelopeSpec {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly hold: number;
  readonly release: number;
}

export type LayerSource = 'noise' | 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface FilterSpec {
  readonly type: 'lowpass' | 'highpass' | 'bandpass';
  readonly freq: number;
  readonly q: number;
}

/** One oscillator or filtered-noise component of a sound. */
export interface LayerSpec {
  readonly source: LayerSource;
  /** Oscillator frequency (Hz); unused by noise. */
  readonly freq: number;
  /** Frequency the oscillator glides to over the layer (Hz); omitted = constant. */
  readonly freqEnd?: number;
  readonly filter?: FilterSpec;
  readonly gain: number;
  readonly env: EnvelopeSpec;
  /** Seconds after the sound starts before this layer starts. */
  readonly delay?: number;
}

/** Random variation ranges applied per playback. */
export interface VariationSpec {
  /** Pitch spread in cents (+-). */
  readonly pitchCents: number;
  /** Filter frequency spread as a fraction (+-). */
  readonly filter: number;
  /** Level spread as a fraction (+-). */
  readonly gain: number;
}

export interface SoundRecipe {
  readonly id: string;
  readonly layers: readonly LayerSpec[];
  readonly variation: VariationSpec;
}

/** Total seconds a layer sounds (its delay plus the whole envelope). */
export function layerDuration(layer: LayerSpec): number {
  const { attack, decay, hold, release } = layer.env;
  return (layer.delay ?? 0) + attack + decay + hold + release;
}

export function recipeDuration(recipe: SoundRecipe): number {
  return recipe.layers.reduce((longest, layer) => Math.max(longest, layerDuration(layer)), 0);
}

const env = (attack: number, decay: number, sustain: number, hold: number, release: number): EnvelopeSpec => ({
  attack,
  decay,
  sustain,
  hold,
  release,
});
const filt = (type: FilterSpec['type'], freq: number, q = 0.7): FilterSpec => ({ type, freq, q });
const noise = (gain: number, filter: FilterSpec, e: EnvelopeSpec, delay = 0): LayerSpec => ({
  source: 'noise',
  freq: 0,
  filter,
  gain,
  env: e,
  delay,
});
const tone = (
  source: Exclude<LayerSource, 'noise'>,
  freq: number,
  freqEnd: number | undefined,
  gain: number,
  e: EnvelopeSpec,
  filter?: FilterSpec,
  delay = 0,
): LayerSpec => ({
  source,
  freq,
  ...(freqEnd === undefined ? {} : { freqEnd }),
  gain,
  env: e,
  ...(filter === undefined ? {} : { filter }),
  delay,
});

const V_NORMAL: VariationSpec = { pitchCents: 120, filter: 0.15, gain: 0.12 };
const V_SOFT: VariationSpec = { pitchCents: 60, filter: 0.1, gain: 0.1 };

/** Break recipes (heavier) for each material. */
const BREAK_RECIPES: Readonly<Record<SoundMaterial, SoundRecipe>> = {
  stone: {
    id: 'break.stone',
    layers: [
      noise(0.9, filt('bandpass', 1800, 1.2), env(0.001, 0.06, 0.2, 0.01, 0.08)),
      tone('square', 320, 110, 0.35, env(0.001, 0.05, 0.1, 0, 0.06), filt('lowpass', 900)),
    ],
    variation: V_NORMAL,
  },
  wood: {
    id: 'break.wood',
    layers: [
      tone('triangle', 260, 140, 0.7, env(0.001, 0.07, 0.15, 0.01, 0.09), filt('lowpass', 1200)),
      noise(0.35, filt('bandpass', 900, 1), env(0.001, 0.04, 0.1, 0, 0.05)),
    ],
    variation: V_NORMAL,
  },
  dirt: {
    id: 'break.dirt',
    layers: [noise(0.85, filt('lowpass', 700), env(0.002, 0.08, 0.3, 0.03, 0.1))],
    variation: V_NORMAL,
  },
  grass: {
    id: 'break.grass',
    layers: [noise(0.7, filt('bandpass', 1400, 0.6), env(0.004, 0.09, 0.3, 0.04, 0.1))],
    variation: V_NORMAL,
  },
  sand: {
    id: 'break.sand',
    layers: [noise(0.7, filt('highpass', 1500), env(0.003, 0.1, 0.35, 0.06, 0.12))],
    variation: V_NORMAL,
  },
  gravel: {
    id: 'break.gravel',
    layers: [
      noise(0.85, filt('bandpass', 1100, 0.8), env(0.001, 0.06, 0.3, 0.05, 0.1)),
      noise(0.6, filt('bandpass', 2300, 1.5), env(0.001, 0.04, 0.2, 0.02, 0.06), 0.07),
    ],
    variation: V_NORMAL,
  },
  glass: {
    id: 'break.glass',
    layers: [
      tone('sine', 2600, 2200, 0.35, env(0.001, 0.05, 0.3, 0.03, 0.18)),
      tone('sine', 3900, 3400, 0.2, env(0.001, 0.04, 0.2, 0.02, 0.15), undefined, 0.02),
      noise(0.5, filt('highpass', 4000), env(0.001, 0.05, 0.15, 0.02, 0.1)),
    ],
    variation: { pitchCents: 200, filter: 0.12, gain: 0.12 },
  },
  leaves: {
    id: 'break.leaves',
    layers: [noise(0.55, filt('bandpass', 3000, 0.5), env(0.008, 0.08, 0.4, 0.05, 0.12))],
    variation: V_NORMAL,
  },
  water: {
    id: 'break.water',
    layers: [noise(0.2, filt('lowpass', 600), env(0.01, 0.05, 0.2, 0.02, 0.06))],
    variation: V_SOFT,
  },
};

/** Place recipes (lighter) for each material; footsteps reuse them at a lower level. */
const PLACE_RECIPES: Readonly<Record<SoundMaterial, SoundRecipe>> = {
  stone: {
    id: 'place.stone',
    layers: [
      tone('square', 240, 130, 0.4, env(0.001, 0.04, 0.1, 0, 0.05), filt('lowpass', 700)),
      noise(0.5, filt('bandpass', 1600, 1.2), env(0.001, 0.03, 0.1, 0, 0.04)),
    ],
    variation: V_NORMAL,
  },
  wood: {
    id: 'place.wood',
    layers: [tone('triangle', 200, 120, 0.7, env(0.001, 0.05, 0.1, 0.005, 0.07), filt('lowpass', 900))],
    variation: V_NORMAL,
  },
  dirt: {
    id: 'place.dirt',
    layers: [noise(0.6, filt('lowpass', 500), env(0.002, 0.05, 0.2, 0.01, 0.06))],
    variation: V_NORMAL,
  },
  grass: {
    id: 'place.grass',
    layers: [noise(0.5, filt('bandpass', 1200, 0.6), env(0.003, 0.05, 0.2, 0.015, 0.07))],
    variation: V_NORMAL,
  },
  sand: {
    id: 'place.sand',
    layers: [noise(0.5, filt('highpass', 1600), env(0.002, 0.06, 0.25, 0.03, 0.08))],
    variation: V_NORMAL,
  },
  gravel: {
    id: 'place.gravel',
    layers: [noise(0.65, filt('bandpass', 1200, 0.9), env(0.001, 0.05, 0.25, 0.03, 0.07))],
    variation: V_NORMAL,
  },
  glass: {
    id: 'place.glass',
    layers: [tone('sine', 3000, 2800, 0.3, env(0.001, 0.03, 0.25, 0.01, 0.1))],
    variation: { pitchCents: 200, filter: 0.1, gain: 0.1 },
  },
  leaves: {
    id: 'place.leaves',
    layers: [noise(0.4, filt('bandpass', 2800, 0.5), env(0.006, 0.05, 0.3, 0.03, 0.08))],
    variation: V_NORMAL,
  },
  water: {
    id: 'place.water',
    layers: [noise(0.15, filt('lowpass', 500), env(0.01, 0.04, 0.2, 0.01, 0.05))],
    variation: V_SOFT,
  },
};

/** Footstep level per material (multiplies the place recipe). */
const STEP_GAIN: Readonly<Record<SoundMaterial, number>> = {
  stone: 0.55,
  wood: 0.55,
  dirt: 0.5,
  grass: 0.5,
  sand: 0.45,
  gravel: 0.55,
  glass: 0.4,
  leaves: 0.4,
  water: 0.5,
};

const STEP_WATER: SoundRecipe = {
  id: 'step.water',
  layers: [noise(0.4, filt('bandpass', 500, 1), env(0.01, 0.08, 0.3, 0.04, 0.1))],
  variation: V_SOFT,
};

const JUMP: SoundRecipe = {
  id: 'jump',
  layers: [noise(0.35, filt('bandpass', 900, 0.7), env(0.01, 0.06, 0.2, 0.02, 0.08))],
  variation: V_SOFT,
};

const HURT: SoundRecipe = {
  id: 'player.hurt',
  layers: [
    tone('sawtooth', 240, 110, 0.55, env(0.005, 0.08, 0.5, 0.06, 0.12), filt('lowpass', 1100)),
    noise(0.25, filt('bandpass', 700, 0.8), env(0.005, 0.06, 0.3, 0.03, 0.08)),
  ],
  variation: { pitchCents: 150, filter: 0.1, gain: 0.08 },
};

const DEATH: SoundRecipe = {
  id: 'player.death',
  layers: [
    tone('sawtooth', 320, 55, 0.6, env(0.01, 0.15, 0.6, 0.35, 0.5), filt('lowpass', 900)),
    tone('square', 160, 40, 0.25, env(0.01, 0.15, 0.5, 0.3, 0.45), filt('lowpass', 500)),
    noise(0.2, filt('lowpass', 400), env(0.02, 0.2, 0.4, 0.3, 0.4)),
  ],
  variation: { pitchCents: 60, filter: 0.05, gain: 0.05 },
};

const EAT_BITE: SoundRecipe = {
  id: 'eat.bite',
  layers: [
    noise(0.85, filt('bandpass', 1500, 1.4), env(0.001, 0.035, 0.2, 0.01, 0.05)),
    noise(0.5, filt('bandpass', 2400, 1.6), env(0.001, 0.025, 0.15, 0, 0.04), 0.045),
  ],
  variation: { pitchCents: 200, filter: 0.2, gain: 0.15 },
};

const EAT_DONE: SoundRecipe = {
  id: 'eat.done',
  layers: [tone('sine', 180, 90, 0.7, env(0.01, 0.08, 0.4, 0.04, 0.1), filt('lowpass', 500))],
  variation: V_SOFT,
};

const PICKUP: SoundRecipe = {
  id: 'pickup',
  layers: [
    tone('sine', 700, 1100, 0.45, env(0.002, 0.03, 0.4, 0.02, 0.05)),
    tone('sine', 1400, 1900, 0.2, env(0.002, 0.03, 0.3, 0.01, 0.04)),
  ],
  variation: { pitchCents: 250, filter: 0.05, gain: 0.08 },
};

const CHEST_OPEN: SoundRecipe = {
  id: 'chest.open',
  layers: [
    tone('sawtooth', 110, 170, 0.4, env(0.02, 0.12, 0.4, 0.08, 0.1), filt('lowpass', 500)),
    noise(0.25, filt('bandpass', 1000, 1.5), env(0.005, 0.04, 0.2, 0.01, 0.05), 0.18),
    tone('triangle', 240, 160, 0.4, env(0.001, 0.05, 0.1, 0, 0.07), filt('lowpass', 800), 0.2),
  ],
  variation: V_SOFT,
};

const PIG_IDLE: SoundRecipe = {
  id: 'pig.idle',
  layers: [
    tone('sawtooth', 190, 150, 0.6, env(0.02, 0.06, 0.6, 0.06, 0.08), filt('bandpass', 700, 1.6)),
    tone('sawtooth', 150, 120, 0.5, env(0.02, 0.06, 0.6, 0.05, 0.1), filt('bandpass', 600, 1.6), 0.17),
  ],
  variation: { pitchCents: 200, filter: 0.12, gain: 0.1 },
};

const PIG_HURT: SoundRecipe = {
  id: 'pig.hurt',
  layers: [tone('sawtooth', 420, 260, 0.75, env(0.005, 0.05, 0.6, 0.1, 0.1), filt('bandpass', 1300, 1.2))],
  variation: { pitchCents: 250, filter: 0.12, gain: 0.1 },
};

const PIG_DEATH: SoundRecipe = {
  id: 'pig.death',
  layers: [tone('sawtooth', 330, 90, 0.75, env(0.005, 0.1, 0.6, 0.2, 0.25), filt('bandpass', 1000, 1.1))],
  variation: { pitchCents: 150, filter: 0.1, gain: 0.08 },
};

const SHAMBLER_IDLE: SoundRecipe = {
  id: 'shambler.idle',
  layers: [
    tone('sawtooth', 85, 60, 0.7, env(0.08, 0.15, 0.7, 0.35, 0.3), filt('lowpass', 420, 2)),
    noise(0.3, filt('bandpass', 300, 1.5), env(0.08, 0.15, 0.5, 0.3, 0.25)),
  ],
  variation: { pitchCents: 250, filter: 0.15, gain: 0.1 },
};

const SHAMBLER_HURT: SoundRecipe = {
  id: 'shambler.hurt',
  layers: [
    tone('sawtooth', 130, 70, 0.75, env(0.01, 0.08, 0.6, 0.12, 0.15), filt('lowpass', 500, 1.5)),
    noise(0.3, filt('bandpass', 400, 1.2), env(0.01, 0.08, 0.4, 0.08, 0.12)),
  ],
  variation: { pitchCents: 200, filter: 0.12, gain: 0.1 },
};

const SHAMBLER_DEATH: SoundRecipe = {
  id: 'shambler.death',
  layers: [
    tone('sawtooth', 110, 40, 0.75, env(0.02, 0.15, 0.6, 0.4, 0.4), filt('lowpass', 350, 1.5)),
    noise(0.25, filt('lowpass', 300), env(0.02, 0.2, 0.4, 0.3, 0.3)),
  ],
  variation: { pitchCents: 150, filter: 0.1, gain: 0.08 },
};

/** Cow: a long low "moo" that rises then sags, saw body plus a triangle an octave up for warmth. */
const COW_IDLE: SoundRecipe = {
  id: 'cow.idle',
  layers: [
    tone('sawtooth', 110, 150, 0.55, env(0.12, 0.15, 0.7, 0.35, 0.3), filt('lowpass', 520, 1.4)),
    tone('triangle', 220, 300, 0.35, env(0.12, 0.15, 0.7, 0.35, 0.3), filt('lowpass', 900)),
    tone('sawtooth', 150, 95, 0.4, env(0.02, 0.1, 0.6, 0.25, 0.3), filt('lowpass', 480, 1.4), 0.55),
  ],
  variation: { pitchCents: 220, filter: 0.12, gain: 0.1 },
};

const COW_HURT: SoundRecipe = {
  id: 'cow.hurt',
  layers: [
    tone('sawtooth', 190, 130, 0.65, env(0.02, 0.08, 0.6, 0.18, 0.2), filt('lowpass', 700, 1.3)),
    tone('triangle', 380, 260, 0.3, env(0.02, 0.08, 0.5, 0.15, 0.18), filt('lowpass', 1000)),
  ],
  variation: { pitchCents: 200, filter: 0.12, gain: 0.1 },
};

const COW_DEATH: SoundRecipe = {
  id: 'cow.death',
  layers: [
    tone('sawtooth', 170, 60, 0.7, env(0.03, 0.15, 0.6, 0.4, 0.45), filt('lowpass', 480, 1.3)),
    tone('triangle', 340, 120, 0.3, env(0.03, 0.15, 0.5, 0.3, 0.4), filt('lowpass', 700)),
  ],
  variation: { pitchCents: 150, filter: 0.1, gain: 0.08 },
};

/** Chicken: two or three short, high, clipped "cluck" blips. */
const CHICKEN_IDLE: SoundRecipe = {
  id: 'chicken.idle',
  layers: [
    tone('square', 760, 560, 0.3, env(0.003, 0.02, 0.5, 0.02, 0.03), filt('bandpass', 1500, 2)),
    tone('square', 820, 600, 0.28, env(0.003, 0.02, 0.5, 0.02, 0.03), filt('bandpass', 1600, 2), 0.13),
    tone('square', 700, 520, 0.26, env(0.003, 0.02, 0.5, 0.02, 0.04), filt('bandpass', 1400, 2), 0.27),
  ],
  variation: { pitchCents: 250, filter: 0.12, gain: 0.1 },
};

const CHICKEN_HURT: SoundRecipe = {
  id: 'chicken.hurt',
  layers: [
    tone('square', 1100, 700, 0.3, env(0.003, 0.03, 0.5, 0.06, 0.05), filt('bandpass', 1800, 1.5)),
    tone('triangle', 1400, 900, 0.3, env(0.003, 0.03, 0.4, 0.05, 0.05), filt('highpass', 900)),
  ],
  variation: { pitchCents: 300, filter: 0.12, gain: 0.1 },
};

const CHICKEN_DEATH: SoundRecipe = {
  id: 'chicken.death',
  layers: [tone('square', 900, 260, 0.32, env(0.003, 0.06, 0.5, 0.12, 0.12), filt('bandpass', 1200, 1.2))],
  variation: { pitchCents: 200, filter: 0.1, gain: 0.08 },
};

/** A recipe plus how loud it plays and where (if positional) it comes from. */
export interface SoundRequest {
  readonly recipe: SoundRecipe;
  /** Level multiplier 0..1 applied on top of the recipe's own layer gains. */
  readonly gain: number;
  /** World position for distance attenuation / pan; omitted = plays at the listener. */
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
}

function landGain(fallSpeed: number): number {
  const span = AUDIO_CONFIG.landFullSpeed - AUDIO_CONFIG.landMinSpeed;
  const t = Math.min(1, Math.max(0, (fallSpeed - AUDIO_CONFIG.landMinSpeed) / span));
  return 0.35 + 0.65 * t;
}

function mobRecipe(mobType: number, kind: 'idle' | 'hurt' | 'death'): SoundRecipe | null {
  if (mobType === MobType.Pig) {
    return kind === 'idle' ? PIG_IDLE : kind === 'hurt' ? PIG_HURT : PIG_DEATH;
  }
  if (mobType === MobType.Shambler) {
    return kind === 'idle' ? SHAMBLER_IDLE : kind === 'hurt' ? SHAMBLER_HURT : SHAMBLER_DEATH;
  }
  if (mobType === MobType.Cow) {
    return kind === 'idle' ? COW_IDLE : kind === 'hurt' ? COW_HURT : COW_DEATH;
  }
  if (mobType === MobType.Chicken) {
    return kind === 'idle' ? CHICKEN_IDLE : kind === 'hurt' ? CHICKEN_HURT : CHICKEN_DEATH;
  }
  return null;
}

/** Footstep recipe + base level for the block under the player, or null for air. */
function stepRecipe(blockId: number): { recipe: SoundRecipe; gain: number } | null {
  const material = soundMaterialOf(blockId);
  if (material === null) {
    return null;
  }
  if (material === 'water') {
    return { recipe: STEP_WATER, gain: STEP_GAIN.water };
  }
  return { recipe: PLACE_RECIPES[material], gain: STEP_GAIN[material] };
}

/** Picks the sound for a game event, or null when the event is silent. Pure. */
export function soundFor(event: GameEvent): SoundRequest | null {
  switch (event.type) {
    case 'blockBreak': {
      const material = soundMaterialOf(event.blockId);
      return material === null ? null : { recipe: BREAK_RECIPES[material], gain: 1, position: event.position };
    }
    case 'blockPlace': {
      const material = soundMaterialOf(event.blockId);
      return material === null ? null : { recipe: PLACE_RECIPES[material], gain: 0.9, position: event.position };
    }
    case 'footstep': {
      const step = stepRecipe(event.blockId);
      if (step === null) {
        return null;
      }
      const gait = event.crouching ? AUDIO_CONFIG.crouchStepGain : event.sprinting ? 1.15 : 1;
      return { recipe: step.recipe, gain: step.gain * gait };
    }
    case 'jump':
      return soundMaterialOf(event.blockId) === null ? null : { recipe: JUMP, gain: 0.6 };
    case 'land': {
      const material = soundMaterialOf(event.blockId);
      return material === null ? null : { recipe: BREAK_RECIPES[material], gain: landGain(event.fallSpeed) * 0.8 };
    }
    case 'playerHurt':
      return { recipe: HURT, gain: 1 };
    case 'playerDeath':
      return { recipe: DEATH, gain: 1 };
    case 'eatBite':
      return { recipe: EAT_BITE, gain: 0.7 };
    case 'eatDone':
      return { recipe: EAT_DONE, gain: 0.8 };
    case 'pickup':
      return { recipe: PICKUP, gain: 0.7 };
    case 'chestOpen':
      return { recipe: CHEST_OPEN, gain: 0.9 };
    case 'mobIdle':
    case 'mobHurt':
    case 'mobDeath': {
      const kind = event.type === 'mobIdle' ? 'idle' : event.type === 'mobHurt' ? 'hurt' : 'death';
      const recipe = mobRecipe(event.mobType, kind);
      return recipe === null ? null : { recipe, gain: 1, position: event.position };
    }
  }
}

/** Every recipe (used by tests to check the parameters are valid). */
export function allRecipes(): readonly SoundRecipe[] {
  return [
    ...Object.values(BREAK_RECIPES),
    ...Object.values(PLACE_RECIPES),
    STEP_WATER,
    JUMP,
    HURT,
    DEATH,
    EAT_BITE,
    EAT_DONE,
    PICKUP,
    CHEST_OPEN,
    PIG_IDLE,
    PIG_HURT,
    PIG_DEATH,
    SHAMBLER_IDLE,
    SHAMBLER_HURT,
    SHAMBLER_DEATH,
    COW_IDLE,
    COW_HURT,
    COW_DEATH,
    CHICKEN_IDLE,
    CHICKEN_HURT,
    CHICKEN_DEATH,
  ];
}
