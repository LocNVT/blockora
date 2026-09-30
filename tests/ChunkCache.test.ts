import { describe, it, expect } from 'vitest';
import { ChunkCache } from '../src/world/ChunkCache';

const blocks = (fill: number): Uint8Array => new Uint8Array(4).fill(fill);

describe('ChunkCache', () => {
  it('stores and returns the same array (ownership, no copy); take removes it', () => {
    const cache = new ChunkCache(4);
    const a = blocks(1);
    cache.put(0, 0, a);
    expect(cache.get(0, 0)).toBe(a);
    expect(cache.size).toBe(1);
    expect(cache.take(0, 0)).toBe(a);
    expect(cache.has(0, 0)).toBe(false);
    expect(cache.take(0, 0)).toBeUndefined();
  });

  it('evicts the least recently used entry beyond capacity', () => {
    const cache = new ChunkCache(3);
    cache.put(0, 0, blocks(0));
    cache.put(1, 0, blocks(1));
    cache.put(2, 0, blocks(2));
    cache.get(0, 0); // refresh: (1,0) is now the oldest
    cache.put(3, 0, blocks(3));
    expect(cache.size).toBe(3);
    expect(cache.has(1, 0)).toBe(false);
    expect([cache.has(0, 0), cache.has(2, 0), cache.has(3, 0)]).toEqual([true, true, true]);
  });

  it('re-putting a key replaces it and makes it most recent; has() does not refresh', () => {
    const cache = new ChunkCache(2);
    cache.put(0, 0, blocks(0));
    cache.put(1, 0, blocks(1));
    cache.has(0, 0);
    const replacement = blocks(9);
    cache.put(0, 0, replacement);
    cache.put(2, 0, blocks(2)); // evicts (1,0)
    expect(cache.get(0, 0)).toBe(replacement);
    expect(cache.has(1, 0)).toBe(false);
    expect(cache.size).toBe(2);
  });

  it('delete and clear remove entries; capacity 0 stores nothing', () => {
    const cache = new ChunkCache(2);
    cache.put(0, 0, blocks(0));
    cache.put(1, 1, blocks(1));
    expect(cache.delete(0, 0)).toBe(true);
    expect(cache.delete(0, 0)).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
    const off = new ChunkCache(0);
    off.put(0, 0, blocks(0));
    expect(off.size).toBe(0);
  });
});
