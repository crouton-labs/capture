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
  if (error instanceof AggregateError) return normalizeAggregateFailure(error);
  const message = error instanceof Error ? error.message : String(error);
  return captureError('internal', 'internal_error', message || 'Capture encountered an unknown internal failure.', error);
}

/**
 * A dual-failure envelope (primary + cleanup, e.g. a screenshot capture that
 * failed AND whose device-metrics restore failed) renders with the primary
 * sub-failure's kind/code and EVERY sub-failure's message, so both failures
 * stay distinguishable in the one rendered error an agent sees — the thrown
 * objects themselves never cross the process boundary. Producers put the
 * primary failure first (`new AggregateError([primary, cleanup], …)`).
 */
function normalizeAggregateFailure(error: AggregateError): CaptureError {
  const subs = error.errors.map((sub) => normalizeFailure(sub));
  const primary = subs[0];
  const message = [error.message, ...subs.map((sub, i) => `[${i + 1}] ${sub.descriptor.message}`)]
    .filter((part) => part.length > 0)
    .join(' ');
  if (primary === undefined) {
    return captureError('internal', 'internal_error', message || 'Capture encountered an empty aggregate failure.', error);
  }
  return captureError(primary.descriptor.kind, primary.descriptor.code, message, error);
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
