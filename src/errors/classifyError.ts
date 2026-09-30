import { describeError } from './errorReport';
import type { ErrorPhase } from './errorTypes';

export type ErrorKind = 'renderer-unavailable' | 'renderer-init' | 'bootstrap' | 'frame' | 'runtime';

export interface ClassifiedError {
  readonly kind: ErrorKind;
  /** Plain-language title; never contains a stack or a raw exception message. */
  readonly headline: string;
  /** One-paragraph explanation for the player. */
  readonly explanation: string;
}

const MESSAGES: Record<ErrorKind, { headline: string; explanation: string }> = {
  'renderer-unavailable': {
    headline: "Your browser or GPU doesn't support WebGL2 or WebGPU",
    explanation:
      'Blockora needs WebGL2 or WebGPU to draw the world, but neither could be started. ' +
      'Make sure hardware acceleration is enabled in your browser settings, update your graphics drivers ' +
      'and browser, then reload the page.',
  },
  'renderer-init': {
    headline: "The graphics system couldn't start",
    explanation:
      'Your browser supports graphics, but starting the renderer failed. Try reloading the page, enabling ' +
      'hardware acceleration, or updating your browser and graphics drivers.',
  },
  bootstrap: {
    headline: "Blockora couldn't start",
    explanation:
      'Something went wrong while loading the game. Reloading the page usually fixes it; ' +
      'if it keeps happening, copy the details below when reporting the problem.',
  },
  frame: {
    headline: 'Blockora stopped unexpectedly',
    explanation:
      'The game hit an unexpected error and had to stop. Progress since the last autosave may be lost. ' +
      'Reload the page to continue.',
  },
  runtime: {
    headline: 'Something went wrong',
    explanation: 'An unexpected error occurred. Reload the page if the game misbehaves.',
  },
};

/** Maps an error thrown in `phase` to a player-facing classification. Pure; accepts any thrown value. */
export function classifyError(error: unknown, phase: ErrorPhase): ClassifiedError {
  const name = describeError(error).name;
  let kind: ErrorKind;
  if (name === 'RendererUnavailableError') {
    kind = 'renderer-unavailable';
  } else if (name === 'RendererInitError' || phase === 'renderer-init') {
    kind = 'renderer-init';
  } else if (phase === 'frame') {
    kind = 'frame';
  } else if (phase === 'bootstrap') {
    kind = 'bootstrap';
  } else {
    kind = 'runtime';
  }
  return { kind, ...MESSAGES[kind] };
}
