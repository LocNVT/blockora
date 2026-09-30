/** World seeds are unsigned 32-bit integers. */
export const SEED_RANGE = 0x100000000;

/** Source of uniformly distributed unsigned 32-bit integers (crypto in the browser, fixed in tests). */
export type RandomUint32 = () => number;

/** FNV-1a 32-bit hash of a string (UTF-16 code units); deterministic on every machine. */
export function hashStringToSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/** Wraps any finite integer into the unsigned 32-bit seed range. */
export function normalizeSeed(value: number): number {
  return ((value % SEED_RANGE) + SEED_RANGE) % SEED_RANGE;
}

/** A fresh random seed from the injected source. */
export function randomSeed(random: RandomUint32): number {
  return normalizeSeed(Math.floor(random()));
}

const INTEGER_TEXT = /^[+-]?\d+$/;

/**
 * Turns the seed text field into a seed. Blank -> a random seed from
 * `random`; a whole number that is exactly representable -> that number
 * wrapped to 32 bits (so "12345" is seed 12345 and "-1" is 4294967295); any
 * other text -> its FNV-1a hash. Always an integer in [0, 2^32).
 */
export function parseSeedInput(text: string, random: RandomUint32): number {
  const trimmed = text.trim();
  if (trimmed === '') {
    return randomSeed(random);
  }
  if (INTEGER_TEXT.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isSafeInteger(value)) {
      return normalizeSeed(value);
    }
  }
  return hashStringToSeed(trimmed);
}
