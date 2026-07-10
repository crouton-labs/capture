/**
 * Shared timing helpers for `measure`/`motion`. See the design's "Recorder timing model":
 * the authoritative clock for every reported timestamp is `performance.now()`, relative to
 * the recorder-armed marker (`t=0`). Screencast frames carry a wall-clock `metadata.timestamp`
 * and Tracing events carry a monotonic `ts` in their own domains; the recorder bridge (U13/U14)
 * converts both into the `performance.now()` domain by baseline-offset subtraction using the
 * baseline this module reads.
 */

import type { CDPClient } from './client.js';

export interface BracketedTiming<T> {
  result: T;
  /** `performance.now()` immediately before `fn` ran. */
  startPerformanceNow: number;
  /** `performance.now()` immediately after `fn` resolved. */
  endPerformanceNow: number;
}

/**
 * Runs `fn`, bracketed by two `performance.now()` reads taken in the page's document execution
 * context. Used to attribute a discrete action (e.g. an `Input.dispatch*` call) to a window in
 * the recorder's authoritative `performance.now()` clock domain. The action's landmark label
 * (`mark`, when the caller supplied one) is recorded host-side only — appended straight to
 * `events.jsonl` alongside these two bracket numbers (see `../recorder-bridge.ts`'s `handleCdp`)
 * — never written into the page's own PerformanceTimeline via `performance.mark()`: that page-
 * visible side channel was removed (a predictable, page-observable channel the injected
 * PerformanceObserver would otherwise re-observe as its own event, in violation of the
 * observational-collector invariant against page-side channels).
 */
export async function withDocumentPerformanceNow<T>(client: CDPClient, fn: () => Promise<T>): Promise<BracketedTiming<T>> {
  const startPerformanceNow = await readPerformanceNow(client);
  const result = await fn();
  const endPerformanceNow = await readPerformanceNow(client);
  return { result, startPerformanceNow, endPerformanceNow };
}

async function readPerformanceNow(client: CDPClient): Promise<number> {
  const evaluation = (await client.send('Runtime.evaluate', {
    expression: 'performance.now()',
    returnByValue: true,
  })) as { result: { value?: unknown }; exceptionDetails?: unknown };

  if (evaluation.exceptionDetails) {
    throw new Error(`Failed to read performance.now(): ${JSON.stringify(evaluation.exceptionDetails)}`);
  }
  if (typeof evaluation.result.value !== 'number') {
    throw new Error('performance.now() did not return a number');
  }
  return evaluation.result.value;
}

export interface TraceClockBaseline {
  /** `performance.now()` (document-relative ms) at the moment the baseline was captured. */
  performanceNowMs: number;
  /** `Date.now()` (wall-clock epoch ms) at the same moment. */
  wallClockMs: number;
}

/**
 * Reads one synchronized (`performance.now()`, wall-clock) pair from the page in a single
 * round trip. The recorder bridge reads this once when it arms (`rec-start`) as the anchor half
 * of the three-way `markers.json` baseline; the other two members — the first screencast frame's
 * `metadata.timestamp` (wall-clock seconds) and the first Tracing batch's earliest event `ts`
 * (trace-clock microseconds) — are captured separately by the recorder bridge itself as those
 * events arrive (not by this function, since neither exists yet at arm time). Post-processing
 * converts frame-time and trace-time into the `performance.now()` domain by subtracting this
 * baseline's wall-clock offset.
 */
export async function readTraceClockBaseline(client: CDPClient): Promise<TraceClockBaseline> {
  const evaluation = (await client.send('Runtime.evaluate', {
    expression: '({ performanceNowMs: performance.now(), wallClockMs: Date.now() })',
    returnByValue: true,
  })) as {
    result: { value?: { performanceNowMs?: unknown; wallClockMs?: unknown } };
    exceptionDetails?: unknown;
  };

  if (evaluation.exceptionDetails) {
    throw new Error(`Failed to read trace clock baseline: ${JSON.stringify(evaluation.exceptionDetails)}`);
  }
  const value = evaluation.result.value;
  if (!value || typeof value.performanceNowMs !== 'number' || typeof value.wallClockMs !== 'number') {
    throw new Error('Trace clock baseline evaluation did not return the expected {performanceNowMs, wallClockMs} shape');
  }
  return { performanceNowMs: value.performanceNowMs, wallClockMs: value.wallClockMs };
}
