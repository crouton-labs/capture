import { fact, type RenderableResult } from './output/render.js';

export type CaptureFailureKind = 'invocation' | 'precondition' | 'world' | 'artifact' | 'cleanup' | 'internal';

export interface CaptureFailureDescriptor {
  readonly code: string;
  readonly message: string;
  readonly kind: CaptureFailureKind;
  readonly cause?: unknown;
}

/** A failure that crosses Capture's command boundary without rendering itself. */
export class CaptureError extends Error {
  readonly descriptor: CaptureFailureDescriptor;

  constructor(descriptor: CaptureFailureDescriptor) {
    super(descriptor.message, descriptor.cause === undefined ? undefined : { cause: descriptor.cause });
    this.name = 'CaptureError';
    this.descriptor = descriptor;
  }
}

export function captureError(kind: CaptureFailureKind, code: string, message: string, cause?: unknown): CaptureError {
  return new CaptureError({ kind, code, message, cause });
}

export function invalidInput(message: string, code = 'invalid_input'): CaptureError {
  return captureError('invocation', code, message);
}

export function worldFailure(message: string, cause?: unknown): CaptureError {
  return captureError('world', 'world_failure', message, cause);
}

/** Convert an arbitrary thrown value into Capture's single typed vocabulary. */
export function normalizeFailure(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return captureError('internal', 'internal_error', message || 'Capture encountered an unknown internal failure.', error);
}

/** The one renderer-compatible error envelope, emitted only by capture.ts. */
export function failureResult(error: unknown): RenderableResult {
  const { descriptor } = normalizeFailure(error);
  return {
    tag: 'error',
    attrs: { code: descriptor.code, kind: descriptor.kind },
    summary: fact`${descriptor.message}`,
  };
}
