import type { LoadSaveResult } from '../save/gameSave';
import { NEEDS_KEYBOARD_MOUSE_NOTICE, isPlayBlocked, type PlatformVerdict } from '../platform/capabilities';

/** What the title screen knows about storage: the load outcome, or that IndexedDB could not be opened. */
export type StorageStatus = 'loaded' | 'empty' | 'blocked' | 'unavailable';

export function storageStatusOf(storeOpened: boolean, load: LoadSaveResult): StorageStatus {
  return storeOpened ? load.status : 'unavailable';
}

export interface MainMenuModel {
  readonly continueEnabled: boolean;
  /** New world is offered unless the device cannot play (then "Try anyway" re-enables it). */
  readonly newWorldEnabled: boolean;
  /** The device lacks pointer lock / a fine pointer: buttons start disabled, "Try anyway" is shown. */
  readonly playBlocked: boolean;
  /** A stored world exists (readable or not), so New world must be confirmed before it is cleared. */
  readonly newWorldNeedsConfirm: boolean;
  /** Whether the world started from this menu will be saved. */
  readonly savingAvailable: boolean;
  /** Message shown on the title screen, or null. */
  readonly notice: string | null;
}

export const BLOCKED_NOTICE =
  'Your saved world could not be read (damaged, or saved by a newer version). ' +
  'Starting a new world replaces it.';
export const UNAVAILABLE_NOTICE = 'Saving unavailable in this browser';

export function mainMenuModel(status: StorageStatus, platform: PlatformVerdict = 'playable'): MainMenuModel {
  const base = storageModel(status);
  if (!isPlayBlocked(platform)) {
    return base;
  }
  return {
    ...base,
    continueEnabled: false,
    newWorldEnabled: false,
    playBlocked: true,
    notice: base.notice === null ? NEEDS_KEYBOARD_MOUSE_NOTICE : `${NEEDS_KEYBOARD_MOUSE_NOTICE} ${base.notice}`,
  };
}

/** Re-enables the buttons after "Try anyway" (storage rules unchanged). */
export function tryAnywayModel(status: StorageStatus): MainMenuModel {
  return storageModel(status);
}

function storageModel(status: StorageStatus): MainMenuModel {
  switch (status) {
    case 'loaded':
      return { continueEnabled: true, newWorldEnabled: true, playBlocked: false, newWorldNeedsConfirm: true, savingAvailable: true, notice: null };
    case 'empty':
      return { continueEnabled: false, newWorldEnabled: true, playBlocked: false, newWorldNeedsConfirm: false, savingAvailable: true, notice: null };
    case 'blocked':
      return {
        continueEnabled: false,
        newWorldEnabled: true,
        playBlocked: false,
        newWorldNeedsConfirm: true,
        savingAvailable: true,
        notice: BLOCKED_NOTICE,
      };
    case 'unavailable':
      return {
        continueEnabled: false,
        newWorldEnabled: true,
        playBlocked: false,
        newWorldNeedsConfirm: false,
        savingAvailable: false,
        notice: UNAVAILABLE_NOTICE,
      };
  }
}

/** Next step of the pause menu's "Save & quit to title" button. */
export type QuitStep = 'save-and-quit' | 'warn' | 'quit';

/**
 * With saving on: save then quit. Without saving: the first click warns that
 * progress is lost (`warned` = false), the second quits.
 */
export function nextQuitStep(savingEnabled: boolean, warned: boolean): QuitStep {
  if (savingEnabled) {
    return 'save-and-quit';
  }
  return warned ? 'quit' : 'warn';
}

/** Loading-screen stages in order; progress is the fraction of stages completed. */
export const LOADING_STAGES = [
  { id: 'terrain', label: 'Generating terrain…' },
  { id: 'shaders', label: 'Compiling shaders…' },
  { id: 'first-frame', label: 'Starting…' },
] as const;

export type LoadingStageId = (typeof LOADING_STAGES)[number]['id'];

/** Progress in [0, 1) while `id` is the running stage (0 for the first, 1 only when finished). */
export function loadingProgress(id: LoadingStageId): number {
  const index = LOADING_STAGES.findIndex((stage) => stage.id === id);
  return Math.max(0, index) / LOADING_STAGES.length;
}
