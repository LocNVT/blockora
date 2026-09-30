export type LockRequestResult = 'requested' | 'unsupported' | 'failed';

export interface PointerLockTarget {
  readonly requestPointerLock?: () => unknown;
}

/**
 * Asks for pointer lock without ever throwing: a missing API (iOS Safari) is
 * `unsupported`, a synchronous throw is `failed`, and a rejected promise is
 * swallowed (the pause menu simply stays up).
 */
export function requestLockSafely(target: PointerLockTarget): LockRequestResult {
  if (typeof target.requestPointerLock !== 'function') {
    return 'unsupported';
  }
  try {
    const request = target.requestPointerLock();
    if (request instanceof Promise) {
      request.catch(() => undefined);
    }
    return 'requested';
  } catch {
    return 'failed';
  }
}
