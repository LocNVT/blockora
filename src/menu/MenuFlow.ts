import { parseSeedInput, randomSeed, type RandomUint32 } from './seed';
import { mainMenuModel, type MainMenuModel, type StorageStatus } from './menuModel';

/** What the world is built from, chosen by the menu. */
export interface WorldStartParams {
  readonly seed: number;
  /** True: start empty and replace whatever is stored; false: resume the saved world. */
  readonly newWorld: boolean;
}

export type MenuFlowState = 'main' | 'confirm-replace' | 'clearing';

export type MenuFlowResult =
  | { readonly kind: 'start'; readonly params: WorldStartParams }
  /** Nothing started: see `state` (confirm prompt shown, or the action was ignored). */
  | { readonly kind: 'pending' }
  | { readonly kind: 'error'; readonly message: string };

export interface MenuFlowDeps {
  readonly status: StorageStatus;
  /** Seed of the saved world (required for Continue). */
  readonly savedSeed: number | null;
  /** Deletes the stored world; only called after the user confirmed the replacement. */
  readonly clearSave: () => Promise<void>;
  readonly random: RandomUint32;
}

/**
 * Title-screen logic without any DOM: which world starts, and the
 * confirm-before-replace rule (a stored world is cleared only after an
 * explicit `confirmReplace()`, and cancelling keeps it untouched).
 */
export class MenuFlow {
  readonly model: MainMenuModel;
  /** Random seed offered for a new world; used when the seed field is blank. */
  readonly suggestedSeed: number;
  private currentState: MenuFlowState = 'main';
  private pendingSeed = 0;

  constructor(private readonly deps: MenuFlowDeps) {
    this.model = mainMenuModel(deps.status);
    this.suggestedSeed = randomSeed(deps.random);
  }

  /** Seed the world will use once the replacement is confirmed. */
  get pendingNewSeed(): number {
    return this.pendingSeed;
  }

  get state(): MenuFlowState {
    return this.currentState;
  }

  /** Continue the saved world (only when the model enables it). */
  continueWorld(): MenuFlowResult {
    if (this.currentState !== 'main' || !this.model.continueEnabled || this.deps.savedSeed === null) {
      return { kind: 'pending' };
    }
    return { kind: 'start', params: { seed: this.deps.savedSeed, newWorld: false } };
  }

  /** New world from the seed field; asks for confirmation first when a save exists. */
  newWorld(seedText: string): MenuFlowResult {
    if (this.currentState !== 'main') {
      return { kind: 'pending' };
    }
    const seed = parseSeedInput(seedText, () => this.suggestedSeed);
    if (this.model.newWorldNeedsConfirm) {
      this.pendingSeed = seed;
      this.currentState = 'confirm-replace';
      return { kind: 'pending' };
    }
    return { kind: 'start', params: { seed, newWorld: true } };
  }

  /** The user confirmed replacing the save: clear it once, then start. */
  async confirmReplace(): Promise<MenuFlowResult> {
    if (this.currentState !== 'confirm-replace') {
      return { kind: 'pending' };
    }
    this.currentState = 'clearing';
    try {
      await this.deps.clearSave();
    } catch (error) {
      this.currentState = 'main';
      const detail = error instanceof Error ? error.message : String(error);
      return { kind: 'error', message: `Could not replace the saved world: ${detail}` };
    }
    this.currentState = 'main';
    return { kind: 'start', params: { seed: this.pendingSeed, newWorld: true } };
  }

  /** Back out of the confirm step; the save is left alone. */
  cancelReplace(): void {
    if (this.currentState === 'confirm-replace') {
      this.currentState = 'main';
    }
  }
}
