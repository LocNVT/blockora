/** Raw signals about the device; `null` means "could not be determined". */
export interface CapabilityInputs {
  readonly pointerLockSupported: boolean;
  /** `(pointer: fine)` matches: the primary pointer is a mouse / trackpad. */
  readonly pointerFine: boolean | null;
  /** `(any-pointer: fine)` matches: some attached pointer is a mouse / trackpad. */
  readonly anyPointerFine: boolean | null;
}

/**
 * playable: pointer lock plus a fine pointer.
 * needs-keyboard-mouse: pointer lock missing, or only coarse (touch) pointers.
 * unknown: pointer lock exists but pointer type cannot be determined (treated as playable).
 */
export type PlatformVerdict = 'playable' | 'needs-keyboard-mouse' | 'unknown';

export function classifyPlatform(inputs: CapabilityInputs): PlatformVerdict {
  if (!inputs.pointerLockSupported) {
    return 'needs-keyboard-mouse';
  }
  if (inputs.pointerFine === true || inputs.anyPointerFine === true) {
    return 'playable';
  }
  if (inputs.pointerFine === false || inputs.anyPointerFine === false) {
    return 'needs-keyboard-mouse';
  }
  return 'unknown';
}

/** Whether the title screen should discourage starting (unknown is not blocked). */
export function isPlayBlocked(verdict: PlatformVerdict): boolean {
  return verdict === 'needs-keyboard-mouse';
}

export const NEEDS_KEYBOARD_MOUSE_NOTICE =
  'Blockora currently needs a keyboard and mouse. Touch controls are planned.';
export const POINTER_LOCK_UNSUPPORTED_MESSAGE =
  'This browser cannot capture the mouse (Pointer Lock), so the game cannot be played here. ' +
  'Try a desktop browser with a keyboard and mouse.';

/** Shown when the browser refused a lock request it normally supports (e.g. right after Esc). */
export const POINTER_LOCK_FAILED_MESSAGE =
  'The browser did not capture the mouse. Wait a moment and click Play again.';

export interface CapabilityEnvironment {
  readonly document: { readonly documentElement: { readonly requestPointerLock?: unknown } };
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
}

function media(env: CapabilityEnvironment, query: string): boolean | null {
  try {
    return env.matchMedia === undefined ? null : env.matchMedia(query).matches;
  } catch {
    return null;
  }
}

/** Reads the signals from the browser (injectable for tests). */
export function readCapabilityInputs(env: CapabilityEnvironment): CapabilityInputs {
  return {
    pointerLockSupported: typeof env.document.documentElement.requestPointerLock === 'function',
    pointerFine: media(env, '(pointer: fine)'),
    anyPointerFine: media(env, '(any-pointer: fine)'),
  };
}
