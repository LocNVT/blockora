import { RECIPE_BOOK_CONFIG } from '../config/constants';
import type { SettingsStorage } from '../settings/settingsStorage';

/**
 * One-shot gate for the first-time "open the recipe book" hint. The first
 * `tryShow()` ever (per browser, remembered in storage) returns true; every
 * later call returns false, so the hint never nags. Without usable storage the
 * gate falls back to once per page session.
 */
export interface RecipeHintGate {
  /** True exactly once: when the hint should be displayed now. */
  tryShow(): boolean;
}

function readSeen(storage: SettingsStorage | null): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(RECIPE_BOOK_CONFIG.hintStorageKey) !== null;
  } catch {
    return false;
  }
}

function writeSeen(storage: SettingsStorage | null): void {
  if (storage === null) return;
  try {
    storage.setItem(RECIPE_BOOK_CONFIG.hintStorageKey, '1');
  } catch {
    // Storage refused: the in-memory flag still prevents a repeat this session.
  }
}

export function createRecipeHintGate(storage: SettingsStorage | null): RecipeHintGate {
  let shownThisSession = false;
  return {
    tryShow(): boolean {
      if (shownThisSession || readSeen(storage)) {
        shownThisSession = true;
        return false;
      }
      shownThisSession = true;
      writeSeen(storage);
      return true;
    },
  };
}
