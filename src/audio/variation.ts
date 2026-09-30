import type { EnvelopeSpec, FilterSpec, LayerSource, SoundRecipe } from './soundRecipes';

/** Source of uniform random numbers in [0, 1); injected so variation is deterministic under test. */
export type AudioRng = () => number;

/** A recipe layer with this playback's random variation applied. */
export interface ResolvedLayer {
  readonly source: LayerSource;
  readonly freq: number;
  readonly freqEnd: number | null;
  readonly filter: FilterSpec | null;
  readonly gain: number;
  readonly env: EnvelopeSpec;
  readonly delay: number;
  /** Start position inside the shared noise buffer, 0..1 (noise layers). */
  readonly noiseOffset: number;
}

function spread(rng: AudioRng, amount: number): number {
  return (rng() * 2 - 1) * amount;
}

/**
 * Applies per-playback variation: one pitch, one filter and one level draw
 * shared by every layer (so a sound stays coherent) plus a random noise start
 * per layer. Draw order is fixed, so a seeded RNG gives identical output.
 * Output stays within the recipe's variation bounds.
 */
export function resolveRecipe(recipe: SoundRecipe, rng: AudioRng): readonly ResolvedLayer[] {
  const { pitchCents, filter, gain } = recipe.variation;
  const pitch = 2 ** (spread(rng, pitchCents) / 1200);
  const filterScale = 1 + spread(rng, filter);
  const gainScale = 1 + spread(rng, gain);
  return recipe.layers.map((layer) => ({
    source: layer.source,
    freq: layer.freq * pitch,
    freqEnd: layer.freqEnd === undefined ? null : layer.freqEnd * pitch,
    filter: layer.filter === undefined ? null : { ...layer.filter, freq: layer.filter.freq * filterScale },
    gain: layer.gain * gainScale,
    env: layer.env,
    delay: layer.delay ?? 0,
    noiseOffset: rng(),
  }));
}
