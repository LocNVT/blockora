import { describe, it, expect } from 'vitest';
import { WORLD_CONFIG, PLAYER_CONFIG } from '../src/config/constants';

describe('smoke tests', () => {
  it('WORLD_CONFIG has correct chunk dimensions', () => {
    expect(WORLD_CONFIG.chunkWidth).toBe(16);
    expect(WORLD_CONFIG.chunkDepth).toBe(16);
    expect(WORLD_CONFIG.chunkHeight).toBe(128);
  });

  it('PLAYER_CONFIG fov is 75', () => {
    expect(PLAYER_CONFIG.fov).toBe(75);
  });
});
