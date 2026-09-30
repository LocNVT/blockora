import type { ErrorPhase } from './errorTypes';

/** Longest stack (in lines) kept in a copyable report. */
export const MAX_STACK_LINES = 12;
/** Longest single field kept in a report. */
const MAX_FIELD_CHARS = 2000;

export interface ErrorDetails {
  readonly name: string;
  readonly message: string;
  readonly stack: string;
}

export interface ReportContext {
  readonly phase: ErrorPhase;
  readonly backend: string | null;
  readonly userAgent: string;
  readonly buildMode: string;
}

/** Converts anything to a string without ever throwing (circular objects, throwing toString, symbols...). */
export function safeString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  try {
    if (typeof value === 'object') {
      const seen = new WeakSet<object>();
      const json = JSON.stringify(value, (_key, inner: unknown) => {
        if (typeof inner === 'object' && inner !== null) {
          if (seen.has(inner)) {
            return '[Circular]';
          }
          seen.add(inner);
        }
        return typeof inner === 'bigint' ? inner.toString() : inner;
      });
      return json ?? String(value);
    }
    return String(value);
  } catch {
    return '[unprintable value]';
  }
}

function clip(text: string): string {
  return text.length > MAX_FIELD_CHARS ? `${text.slice(0, MAX_FIELD_CHARS)}...` : text;
}

/** Keeps the first `maxLines` lines of a stack. */
export function trimStack(stack: string, maxLines: number = MAX_STACK_LINES): string {
  const lines = stack.split('\n');
  if (lines.length <= maxLines) {
    return stack;
  }
  return `${lines.slice(0, maxLines).join('\n')}\n... (${lines.length - maxLines} more lines)`;
}

/** Normalises any thrown value (Error, string, undefined, object) to name / message / stack. */
export function describeError(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    return {
      name: safeString(error.name),
      message: clip(safeString(error.message)),
      stack: typeof error.stack === 'string' ? trimStack(clip(error.stack)) : '',
    };
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof record.message === 'string') {
      return {
        name: typeof record.name === 'string' ? record.name : 'Error',
        message: clip(record.message),
        stack: typeof record.stack === 'string' ? trimStack(clip(record.stack)) : '',
      };
    }
  }
  return { name: 'Error', message: clip(safeString(error)), stack: '' };
}

/** Plain-text report the player can copy into a bug report. */
export function formatReport(error: unknown, context: ReportContext): string {
  const details = describeError(error);
  return [
    `Error: ${details.name}`,
    `Message: ${details.message || '(none)'}`,
    `Phase: ${context.phase}`,
    `Backend: ${context.backend ?? 'unknown'}`,
    `Build: ${context.buildMode}`,
    `User agent: ${context.userAgent}`,
    'Stack:',
    details.stack || '(no stack available)',
  ].join('\n');
}
