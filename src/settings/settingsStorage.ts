import { SETTINGS_CONFIG } from '../config/constants';
import { DEFAULT_SETTINGS, validateSettings, type GameSettings } from './GameSettings';

/** The subset of the Web Storage API used for settings. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The browser's localStorage, or null when it is missing or access throws
 * (private mode, blocked site data). Small per-browser preferences only;
 * world data never goes through localStorage.
 */
export function resolveBrowserStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Loads the stored settings; anything missing, unreadable or invalid yields defaults (per field where possible). */
export function loadSettings(storage: SettingsStorage | null = resolveBrowserStorage()): GameSettings {
  if (storage === null) {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = storage.getItem(SETTINGS_CONFIG.storageKey);
    if (raw === null) {
      return DEFAULT_SETTINGS;
    }
    return validateSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Persists settings; returns false (settings stay in memory only) when storage is unavailable or throws. */
export function saveSettings(
  settings: GameSettings,
  storage: SettingsStorage | null = resolveBrowserStorage(),
): boolean {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(SETTINGS_CONFIG.storageKey, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
