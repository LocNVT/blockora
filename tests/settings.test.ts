import { describe, it, expect } from 'vitest';
import { PLAYER_CONFIG, SETTINGS_CONFIG, WORLD_CONFIG } from '../src/config/constants';
import {
  DEFAULT_SETTINGS,
  applyLookSensitivity,
  clampSettings,
  validateSettings,
} from '../src/settings/GameSettings';
import { loadSettings, saveSettings, type SettingsStorage } from '../src/settings/settingsStorage';

class MemoryStorage implements SettingsStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const throwingStorage: SettingsStorage = {
  getItem(): string | null {
    throw new Error('blocked');
  },
  setItem(): void {
    throw new Error('quota');
  },
};

describe('settings defaults and ranges', () => {
  it('defaults come from the game constants and lie inside the ranges', () => {
    expect(DEFAULT_SETTINGS.fov).toBe(PLAYER_CONFIG.fov);
    expect(DEFAULT_SETTINGS.renderDistance).toBe(WORLD_CONFIG.renderDistance);
    expect(DEFAULT_SETTINGS.mouseSensitivity).toBe(1);
    expect(DEFAULT_SETTINGS.showFpsCounter).toBe(false);
    expect(clampSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('the storage key is versioned', () => {
    expect(SETTINGS_CONFIG.storageKey).toMatch(/\.v\d+$/);
  });
});

describe('clampSettings', () => {
  it('clamps every field into its range and rounds FOV / render distance', () => {
    const low = clampSettings({ fov: 1, mouseSensitivity: 0, renderDistance: 0, showFpsCounter: true });
    expect(low).toEqual({
      fov: SETTINGS_CONFIG.fov.min,
      mouseSensitivity: SETTINGS_CONFIG.mouseSensitivity.min,
      renderDistance: SETTINGS_CONFIG.renderDistance.min,
      showFpsCounter: true,
    });
    const high = clampSettings({ fov: 999, mouseSensitivity: 99, renderDistance: 99, showFpsCounter: false });
    expect(high.fov).toBe(SETTINGS_CONFIG.fov.max);
    expect(high.mouseSensitivity).toBe(SETTINGS_CONFIG.mouseSensitivity.max);
    expect(high.renderDistance).toBe(SETTINGS_CONFIG.renderDistance.max);
    expect(clampSettings({ ...DEFAULT_SETTINGS, fov: 80.6, renderDistance: 5.4 })).toMatchObject({
      fov: 81,
      renderDistance: 5,
    });
  });
});

describe('validateSettings', () => {
  it('non-objects give the defaults', () => {
    for (const bad of [null, undefined, 5, 'x', true]) {
      expect(validateSettings(bad)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('missing or wrongly typed fields fall back per field, valid ones are kept', () => {
    expect(validateSettings({ fov: 90 })).toEqual({ ...DEFAULT_SETTINGS, fov: 90 });
    expect(validateSettings({ fov: '90', mouseSensitivity: NaN, renderDistance: Infinity, showFpsCounter: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('out-of-range numbers are clamped, not rejected', () => {
    expect(validateSettings({ fov: 500, renderDistance: -3, mouseSensitivity: 100 })).toMatchObject({
      fov: SETTINGS_CONFIG.fov.max,
      renderDistance: SETTINGS_CONFIG.renderDistance.min,
      mouseSensitivity: SETTINGS_CONFIG.mouseSensitivity.max,
    });
  });
});

describe('applyLookSensitivity', () => {
  it('scales look deltas by the multiplier and leaves 1 unchanged', () => {
    const input = { lookDeltaX: 10, lookDeltaY: -4 };
    applyLookSensitivity(input, { mouseSensitivity: 1 });
    expect(input).toEqual({ lookDeltaX: 10, lookDeltaY: -4 });
    applyLookSensitivity(input, { mouseSensitivity: 2 });
    expect(input).toEqual({ lookDeltaX: 20, lookDeltaY: -8 });
  });
});

describe('settings storage', () => {
  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    const settings = { fov: 100, mouseSensitivity: 1.5, renderDistance: 6, showFpsCounter: true };
    expect(saveSettings(settings, storage)).toBe(true);
    expect(storage.data.has(SETTINGS_CONFIG.storageKey)).toBe(true);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it('empty storage, corrupt JSON and a stale-key-only store give defaults', () => {
    const storage = new MemoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    storage.setItem(SETTINGS_CONFIG.storageKey, '{not json');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    storage.data.clear();
    storage.setItem('blockora.settings.v0', JSON.stringify({ fov: 100 }));
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('tampered values are validated on load', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_CONFIG.storageKey, JSON.stringify({ fov: 5000, renderDistance: 'far' }));
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, fov: SETTINGS_CONFIG.fov.max });
  });

  it('no storage or a throwing storage: defaults, and saving reports false instead of throwing', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(throwingStorage)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, null)).toBe(false);
    expect(saveSettings(DEFAULT_SETTINGS, throwingStorage)).toBe(false);
  });

  it('default storage resolution never throws where localStorage does not exist (node)', () => {
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
