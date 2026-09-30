/**
 * Wraps an animation-frame callback: the first exception is passed to
 * `onFailure` (exactly once) and every later call is a no-op, so a broken
 * frame cannot spam errors. `onFailure` is itself protected: it never throws
 * out of the guard.
 */
export function guardFrame(
  frame: (timestamp: number) => void,
  onFailure: (error: unknown) => void,
): (timestamp: number) => void {
  let failed = false;
  return (timestamp: number): void => {
    if (failed) {
      return;
    }
    try {
      frame(timestamp);
    } catch (error) {
      failed = true;
      try {
        onFailure(error);
      } catch {
        // The error path must never throw.
      }
    }
  };
}
