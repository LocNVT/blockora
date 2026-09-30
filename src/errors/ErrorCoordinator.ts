import { classifyError, type ClassifiedError } from './classifyError';
import { formatReport } from './errorReport';
import type { ErrorPhase } from './errorTypes';

export interface FatalView {
  readonly classified: ClassifiedError;
  readonly report: string;
}

export interface ErrorSinks {
  showFatal(view: FatalView): void;
  showBanner(message: string): void;
  log(message: string, error?: unknown): void;
}

export interface ErrorEnvironment {
  readonly userAgent: string;
  readonly buildMode: string;
}

/** Browser-generated noise that says nothing about the game's health (e.g. ResizeObserver loop notices). */
export function isBenignWindowMessage(message: unknown): boolean {
  return typeof message === 'string' && message.includes('ResizeObserver loop');
}

/**
 * Decides what each error means for the player and forwards it to the UI sinks.
 *
 * Rules:
 * - Fatal: errors thrown by bootstrap / renderer init, exceptions inside the
 *   frame callback, and any uncaught error or unhandled rejection that occurs
 *   before the first frame has been rendered (the game cannot be trusted to
 *   be in a usable state yet). The fatal screen is shown at most once.
 * - Non-fatal: an uncaught error or unhandled rejection after the first
 *   frame (typically an optional feature failing) only shows a banner and is
 *   logged; a running game is not killed over it.
 * - Degrade notices (`warn`) show a banner once per key per session.
 */
export class ErrorCoordinator {
  private fatalShown = false;
  private firstFrameDone = false;
  private backend: string | null = null;
  private readonly bannerKeys = new Set<string>();

  constructor(
    private readonly sinks: ErrorSinks,
    private readonly env: ErrorEnvironment,
  ) {}

  get hasFatal(): boolean {
    return this.fatalShown;
  }

  get frameStarted(): boolean {
    return this.firstFrameDone;
  }

  setBackend(backend: string): void {
    this.backend = backend;
  }

  /** Call once the first frame has been rendered. */
  markFirstFrame(): void {
    this.firstFrameDone = true;
  }

  /** Shows the fatal screen (once). Returns true when this call showed it. Never throws. */
  fatal(error: unknown, phase: ErrorPhase): boolean {
    this.safeLog(`[fatal:${phase}]`, error);
    if (this.fatalShown) {
      return false;
    }
    this.fatalShown = true;
    try {
      this.sinks.showFatal({
        classified: classifyError(error, phase),
        report: formatReport(error, {
          phase,
          backend: this.backend,
          userAgent: this.env.userAgent,
          buildMode: this.env.buildMode,
        }),
      });
    } catch (sinkError) {
      this.safeLog('[errors] could not show the error screen', sinkError);
    }
    return true;
  }

  /** Uncaught error / unhandled rejection from the window: fatal before the first frame, banner after. */
  late(error: unknown): 'fatal' | 'banner' | 'ignored' {
    if (this.fatalShown) {
      this.safeLog('[late error after fatal]', error);
      return 'ignored';
    }
    if (!this.firstFrameDone) {
      this.fatal(error, 'bootstrap');
      return 'fatal';
    }
    this.safeLog('[late error]', error);
    this.warn('late-error', 'Something went wrong in the background. The game is still running.');
    return 'banner';
  }

  /** Non-fatal notice shown at most once per `key` per session. Returns true when shown. */
  warn(key: string, message: string): boolean {
    if (this.bannerKeys.has(key)) {
      return false;
    }
    this.bannerKeys.add(key);
    try {
      this.sinks.showBanner(message);
    } catch (error) {
      this.safeLog('[errors] could not show the banner', error);
    }
    return true;
  }

  private safeLog(message: string, error?: unknown): void {
    try {
      this.sinks.log(message, error);
    } catch {
      // Logging must never throw.
    }
  }
}
