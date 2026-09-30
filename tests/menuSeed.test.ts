import { describe, it, expect } from 'vitest';
import { SEED_RANGE, hashStringToSeed, normalizeSeed, parseSeedInput, randomSeed } from '../src/menu/seed';

const NO_RANDOM = (): number => {
  throw new Error('random must not be used');
};

describe('parseSeedInput', () => {
  it('uses whole numbers as-is', () => {
    expect(parseSeedInput('12345', NO_RANDOM)).toBe(12345);
    expect(parseSeedInput('  42 ', NO_RANDOM)).toBe(42);
    expect(parseSeedInput('0', NO_RANDOM)).toBe(0);
  });

  it('wraps numbers into the unsigned 32-bit range', () => {
    expect(parseSeedInput('-1', NO_RANDOM)).toBe(SEED_RANGE - 1);
    expect(parseSeedInput('4294967296', NO_RANDOM)).toBe(0);
    expect(parseSeedInput('4294967297', NO_RANDOM)).toBe(1);
  });

  it('hashes text, deterministically and within 32 bits', () => {
    const a = parseSeedInput('hello world', NO_RANDOM);
    expect(parseSeedInput('hello world', NO_RANDOM)).toBe(a);
    expect(parseSeedInput('Hello world', NO_RANDOM)).not.toBe(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(SEED_RANGE);
  });

  it('hashes decimals, unsafe integers and mixed text instead of parsing them', () => {
    expect(parseSeedInput('1.5', NO_RANDOM)).toBe(hashStringToSeed('1.5'));
    expect(parseSeedInput('12abc', NO_RANDOM)).toBe(hashStringToSeed('12abc'));
    expect(parseSeedInput('99999999999999999999', NO_RANDOM)).toBe(hashStringToSeed('99999999999999999999'));
  });

  it('uses the injected source for blank input', () => {
    expect(parseSeedInput('', () => 777)).toBe(777);
    expect(parseSeedInput('   ', () => 777)).toBe(777);
  });
});

describe('hashStringToSeed', () => {
  it('matches known FNV-1a 32-bit values', () => {
    expect(hashStringToSeed('')).toBe(0x811c9dc5);
    expect(hashStringToSeed('a')).toBe(0xe40c292c);
    expect(hashStringToSeed('foobar')).toBe(0xbf9cf968);
  });
});

describe('randomSeed / normalizeSeed', () => {
  it('always lands in [0, 2^32) as an integer', () => {
    for (const raw of [0, 1, 4294967295, 4294967296, 6e9, -3, 2.9]) {
      const seed = randomSeed(() => raw);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(SEED_RANGE);
    }
    expect(normalizeSeed(-1)).toBe(SEED_RANGE - 1);
  });
});
