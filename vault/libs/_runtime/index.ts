export type ErrorClass =
  | 'Unauthenticated'
  | 'RateLimited'
  | 'PermissionDenied'
  | 'NotFound'
  | 'Validation'
  | 'UpstreamError'
  | 'ContractDrift'
  | 'Unknown';

export class VallumError extends Error {
  readonly errorClass: ErrorClass = 'Unknown';
  constructor(message?: string) {
    super(message);
    // Cross-realm-safe name; "VallumError" is matched by classify().
    this.name = 'VallumError';
  }
}

export class Unauthenticated extends VallumError {
  readonly errorClass: ErrorClass = 'Unauthenticated';
  constructor(message?: string) {
    super(message);
    this.name = 'Unauthenticated';
  }
}

export class RateLimited extends VallumError {
  readonly errorClass: ErrorClass = 'RateLimited';
  constructor(message?: string) {
    super(message);
    this.name = 'RateLimited';
  }
}

export class PermissionDenied extends VallumError {
  readonly errorClass: ErrorClass = 'PermissionDenied';
  constructor(message?: string) {
    super(message);
    this.name = 'PermissionDenied';
  }
}

export class NotFound extends VallumError {
  readonly errorClass: ErrorClass = 'NotFound';
  constructor(message?: string) {
    super(message);
    this.name = 'NotFound';
  }
}

export class Validation extends VallumError {
  readonly errorClass: ErrorClass = 'Validation';
  constructor(message?: string) {
    super(message);
    this.name = 'Validation';
  }
}

export class UpstreamError extends VallumError {
  readonly errorClass: ErrorClass = 'UpstreamError';
  constructor(message?: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class ContractDrift extends VallumError {
  readonly errorClass: ErrorClass = 'ContractDrift';
  constructor(message?: string) {
    super(message);
    this.name = 'ContractDrift';
  }
}

// ContractDrift is excluded: a hostile page-script could forge { errorClass: 'ContractDrift' } and drive BROKEN-state transitions downstream.
const DUCK_TYPEABLE_CLASSES: ReadonlySet<ErrorClass> = new Set([
  'Unauthenticated',
  'RateLimited',
  'PermissionDenied',
  'NotFound',
  'Validation',
  'UpstreamError',
  'Unknown',
]);

export function classify(err: unknown): ErrorClass {
  if (err instanceof VallumError) return err.errorClass;
  // Defensive duck-typing for the cross-realm case (see plan-build-pipeline-runtime.md
  // §"Single-realm class identity"). Smoke test keeps this as a guard, not primary path.
  if (
    err &&
    typeof err === 'object' &&
    'errorClass' in err &&
    typeof (err as { errorClass: unknown }).errorClass === 'string'
  ) {
    const c = (err as { errorClass: string }).errorClass;
    if (DUCK_TYPEABLE_CLASSES.has(c as ErrorClass)) return c as ErrorClass;
  }
  return 'Unknown';
}

/**
 * Status-aware throw helper. Shared across all libs so each one collapses
 * `if (!response.ok) throw new Error(...)` into `throwForStatus(status, body)`.
 *
 * Privacy note (signed off 2026-05-12): the `body` argument is captured
 * verbatim into the thrown VallumError's message and propagated into
 * FunctionInvocation.errorMessage by `__vallumWrap` (up to 1 KB). Upstream
 * response bodies commonly echo CSRF tokens, partial session identifiers,
 * request IDs tied to the user, and email addresses. This is accepted as-is
 * — diagnostic value > PII risk for this internal telemetry. If that
 * tradeoff changes, redact at the `__vallumWrap` catch site (single chokepoint)
 * rather than asking 50 lib call-sites to scrub.
 */
export function throwForStatus(status: number, body?: string): never {
  if (status === 401) throw new Unauthenticated(body ?? 'unauthenticated');
  if (status === 403) throw new PermissionDenied(body ?? 'permission denied');
  if (status === 404) throw new NotFound(body ?? 'not found');
  if (status === 429) throw new RateLimited(body ?? 'rate limited by upstream');
  throw new UpstreamError(body ?? `API returned ${status}`);
}

export interface InvocationRecord {
  service: string;
  fn: string;
  success: boolean;
  durationMs: number;
  errorClass?: ErrorClass;
  errorMessage?: string;
  argsHash?: string;
  logicalArgs?: Record<string, unknown>;
  borgServed?: boolean;
  crmArgs?: Record<string, unknown>;
  crmResult?: unknown;
}

export interface CrmSpec {
  argFields?: readonly string[];
  resultFields?: readonly string[];
}

// Drift guard lives in northlight-core (which depends on @north-light/types).
// Vault has no types dep — keep this file build-clean and rely on core's check.

// ─── Closure-scoped buffer (H-1) ──────────────────────────────────────────
// The buffer is module-private. The CDP-evaluated bundle shares `globalThis`
// with the visited page (LinkedIn, Gmail, …), so a globalThis buffer would be
// writable by page scripts — see plan-build-pipeline-runtime.md §"Buffer
// location" for the full threat model. Module-private + closure-returned
// reference makes the buffer page-unreachable.
let _activeBuffer: InvocationRecord[] = [];

// Per-bundle latch of function keys ("service::fn") that have tripped their
// rate-limit cap during the current executeJS call. Reset alongside the buffer
// in __vallumStartCall. Once latched, every later call to that function fans
// out to Borg directly (see __vallumWrap): rl.check() counts only COMMITTED
// FunctionInvocation rows, which aren't written until the bundle returns, so a
// fresh check can't see this bundle's own calls — the latch carries the trip
// forward for the life of the bundle (which is far shorter than any cap window).
let _rateLimitedKeys = new Set<string>();

// Per-bundle latch of "service::fn" keys whose Borg reroute hit a STABLE
// exhaustion state (cap/breaker/no-donor). Unlike a transient donor error,
// these persist for the bundle's lifetime, so once latched we throw RateLimited
// inline instead of paying another browser→core reroute round-trip. Reset
// alongside the buffer in __vallumStartCall.
let _borgExhaustedKeys = new Set<string>();

// Reasons returned by core's /borg/reroute (status:'no-donor') that won't clear
// within a bundle's lifetime, so latching them is safe. 'all-attempts-failed'
// is deliberately excluded — donor errors may be transient, so we keep probing
// (the breaker will surface 'breaker-open' soon enough). A missing reason (IPC
// fault) is never latched, preserving fail-open semantics.
const BORG_TERMINAL_REASONS = new Set<string>([
  'cap-exceeded',
  'breaker-open',
  'outbound-capped',
  'flag-off',
  'not-registered',
  'malformed-template',
  'no-eligible-donor',
]);

// Per-bundle in-flight counter keyed by "service::fn". Incremented when a call
// is admitted (passes the gate), decremented when it settles. The gate adds
// this to the committed+local-success count so CONCURRENT calls in one bundle
// (Promise.all) see each other: without it, parallel calls all check before any
// has completed, so every one reads a stale count and is admitted. Reset per
// bundle in __vallumStartCall.
let _inFlightByKey = new Map<string, number>();

// Per-bundle memo of the in-flight rate-limit check per "service::fn".
// rl.check() returns the static cap (`limit`) and the COMMITTED used count;
// both are invariant for the life of a bundle (this bundle's own rows aren't
// committed until it returns). So a single check per function-key suffices —
// the first call fetches it, every later call reuses the result and layers the
// local `localUsed + _inFlightByKey` counters on top (same arithmetic as
// before). Storing the in-flight Promise (not the resolved value) also collapses
// a concurrent burst (Promise.all) into one roundtrip. Reset per bundle in
// __vallumStartCall; a rejected check evicts itself so the next call retries,
// preserving the fail-open-then-retry behavior of the gate's catch.
let _rateLimitCheckByKey = new Map<string, ReturnType<RateLimitApi['check']>>();

/**
 * Allocates a fresh buffer for the current executeJS call and returns the
 * reference. The bundle prelude in `bundle-agent-code.ts` calls this exactly
 * once per IIFE; the returned array is captured and merged into the
 * success/error envelope.
 */
export function __vallumStartCall(): InvocationRecord[] {
  _activeBuffer = [];
  _rateLimitedKeys = new Set();
  _borgExhaustedKeys = new Set();
  _inFlightByKey = new Map();
  _rateLimitCheckByKey = new Map();
  return _activeBuffer;
}

interface RateLimitApi {
  check(
    service: string,
    fn: string,
  ): Promise<{
    allowed: boolean;
    message?: string | null;
    limit?: number | null;
    used?: number;
    window?: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY' | null;
    retryAfterMs?: number;
  }>;
  describe(service: string, fn: string): Promise<{ message: string } | null>;
  // Capture an over-limit call's durable args into the server-side queue so the
  // background drainer can replay it later. Round-trips through the same per-tab
  // CDP transport as `check` (POST /v1/internal/rate-limit/enqueue). Resolves
  // `{ queued: false }` when the deferred-queue feature is not enabled for the
  // caller; the gate then falls back to its normal over-limit behavior.
  enqueue(
    service: string,
    fn: string,
    args: unknown[],
  ): Promise<{ queued: boolean }>;
}

/**
 * Senders that are NEVER executed inline by an agent call. Instead the call is
 * captured into the server-side deferred-call queue (return `{ queued: true }`)
 * and replayed later by the background drainer, which is the single,
 * rate-limit-paced sender (see `__vallumWrap`). Routing these through the queue
 * unconditionally — rather than sending inline and gating per-call — makes
 * account safety structural: it no longer depends on the rate-limit runtime
 * being injected into this executor, on which tab runs the send, or on the agent
 * cooperating. The drainer's own replay bypasses this via `isDeferredReplay()`.
 */
const QUEUEABLE_SENDERS: Readonly<Record<string, ReadonlySet<string>>> = {
  linkedin: new Set(['sendConnectionRequest', 'sendMessage']),
};

function isQueueable(service: string, fn: string): boolean {
  const fns = QUEUEABLE_SENDERS[service];
  return fns !== undefined && fns.has(fn);
}

/**
 * True when running inside the deferred-call drainer's replay. The core
 * linkedin-send adapter sets `globalThis.__vallumDeferredReplay` around the
 * replayed send; in that mode a queueable sender bypasses the always-queue
 * branch and performs the real send. The drainer is the single, rate-limit-paced
 * sender and has already consulted the limiter, so re-queueing its own replay
 * would loop forever.
 */
function isDeferredReplay(): boolean {
  return (
    (globalThis as { __vallumDeferredReplay?: unknown })
      .__vallumDeferredReplay === true
  );
}

/**
 * Human-facing note returned to the agent when a queueable send is captured into
 * the queue. The send is NOT a failure: the background deferred-call drainer
 * (northlight-core/src/deferred-call) sends it in the background, paced to stay
 * under LinkedIn's limits. Worded so the agent reports "queued, will send" to the
 * user rather than surfacing an error.
 */
function queuedMessageFor(fn: string): string {
  const noun =
    fn === 'sendConnectionRequest'
      ? 'Connection request'
      : fn === 'sendMessage'
        ? 'Message'
        : 'Request';
  return `${noun} queued — it will be sent automatically in the background, paced to stay under LinkedIn's rate limits.`;
}

// Light human-pacing delay applied to an UNDER-limit (inline) queueable send so
// a burst of inline sends doesn't fire instantly. Only the over-limit overflow
// is paced by the background drainer (~108s); this keeps the inline portion from
// looking robotic. Scoped to queueable senders (LinkedIn sends) only.
const INLINE_SEND_DELAY_MIN_MS = 6_000;
const INLINE_SEND_DELAY_MAX_MS = 10_000;

function inlineSendDelayMs(): number {
  return (
    INLINE_SEND_DELAY_MIN_MS +
    Math.floor(
      Math.random() * (INLINE_SEND_DELAY_MAX_MS - INLINE_SEND_DELAY_MIN_MS + 1),
    )
  );
}

interface BorgApi {
  reroute(
    service: string,
    fn: string,
    logicalArgs: Record<string, unknown>,
  ): Promise<
    | { status: 'ok'; result: unknown }
    | { status: 'no-donor'; reason: string }
  >;
}

export function __vallumWrap<
  T extends (...args: unknown[]) => Promise<unknown>,
>(service: string, fn: string, impl: T, borgExcludeKeys?: readonly string[], crmSpec?: CrmSpec): T {
  const callImpl = impl as unknown as (...args: unknown[]) => unknown;

  const wrapped = async function (this: unknown, ...args: unknown[]) {
    const start = nowMs();
    const buffer = _activeBuffer;

    async function tryBorgReroute(): Promise<{ served: true; result: unknown } | { served: false; reason?: string }> {
      const borgEnabled = (globalThis as { __vallumBorgEnabled?: boolean }).__vallumBorgEnabled === true;
      const borg = (globalThis as { vallum?: { borg?: BorgApi } }).vallum?.borg;
      if (!borgEnabled || !borg || !logicalArgs) return { served: false };
      try {
        const resp = await borg.reroute(service, fn, logicalArgs);
        if (resp && resp.status === 'ok') return { served: true, result: resp.result };
        return { served: false, reason: resp?.reason };
      } catch { /* IPC fault — no reason, never latched (fail-open) */ }
      return { served: false };
    }

    let argsHashPromise: Promise<string | undefined> | undefined;
    const getArgsHash = (): Promise<string | undefined> => {
      argsHashPromise ??= sha256Safe(args);
      return argsHashPromise;
    };

    let logicalArgs: Record<string, unknown> | undefined;
    if (borgExcludeKeys) {
      const first = args[0];
      if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
        logicalArgs = { ...(first as Record<string, unknown>) };
        for (const key of borgExcludeKeys) {
          delete logicalArgs[key];
        }
      }
    }

    function buildCrmArgs(): Record<string, unknown> | undefined {
      if (!crmSpec?.argFields || crmSpec.argFields.length === 0) return undefined;
      const first = args[0];
      if (first === null || typeof first !== 'object' || Array.isArray(first)) return undefined;
      const src = first as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of crmSpec.argFields) {
        if (key in src) out[key] = src[key];
      }
      try {
        if (JSON.stringify(out).length > 8192) return undefined;
      } catch { return undefined; }
      return out;
    }

    function buildCrmResult(result: unknown): unknown | undefined {
      if (!crmSpec?.resultFields || crmSpec.resultFields.length === 0) return undefined;
      if (result === null || typeof result !== 'object' || Array.isArray(result)) return undefined;
      const src = result as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of crmSpec.resultFields) {
        if (key in src) out[key] = src[key];
      }
      try {
        if (JSON.stringify(out).length > 16384) return undefined;
      } catch { return undefined; }
      return out;
    }

    // Drain replay bypasses the gate entirely — the deferred-call drainer is the
    // single rate-limit-paced sender and has already consulted the limiter, so it
    // sends directly: no re-check, no re-queue (which would loop forever), and no
    // inline jitter (the drainer already paces). Set via globalThis by the core
    // linkedin-send adapter around each replayed send.
    const isReplay = isDeferredReplay();

    // Rate-limit gate — transport is injected per-tab by the agent's
    // setupRateLimitRuntime (northlight-agent/agent/connector/executor.js):
    // it registers the `__cdp_ratelimit_send` CDP binding and runs
    // `ratelimit-runtime.js` via Page.addScriptToEvaluateOnNewDocument, which
    // exposes `window.vallum.rateLimit.{check,describe}`.
    // Fail-open when `rateLimit` is undefined — this can only happen if the
    // bundle ran in a context where setupRateLimitRuntime has not yet executed
    // (e.g. injection raced the navigation). Only `RateLimited` propagates;
    // IPC faults fall through to impl.
    const rl = (globalThis as { vallum?: { rateLimit?: RateLimitApi } }).vallum
      ?.rateLimit;
    const rlKey = `${service}::${fn}`;

    // Reroute-or-throw: shared by the sticky fast-path and the over-limit branch.
    // On a served reroute, record the borgServed marker (billed to the donor,
    // excluded from this requester's quota) and return the donor's result;
    // otherwise record a RateLimited row and throw.
    const rerouteOrThrow = async (msg: string): Promise<unknown> => {
      // Borg already reported terminal exhaustion for this key earlier in the
      // bundle (cap/breaker/no-donor) — those states persist for the bundle's
      // lifetime, so skip the reroute round-trip and throw RateLimited inline.
      if (!_borgExhaustedKeys.has(rlKey)) {
        const b = await tryBorgReroute();
        if (b.served) {
          buffer.push({
            service,
            fn,
            success: false,
            errorClass: undefined,
            borgServed: true,
            durationMs: Math.round(nowMs() - start),
            logicalArgs,
            argsHash: await getArgsHash(),
          });
          return b.result;
        }
        if (b.reason && BORG_TERMINAL_REASONS.has(b.reason)) {
          _borgExhaustedKeys.add(rlKey);
        }
      }
      buffer.push({
        service,
        fn,
        success: false,
        errorClass: 'RateLimited',
        durationMs: 0,
        errorMessage: msg,
        argsHash: await getArgsHash(),
        logicalArgs,
      });
      throw new RateLimited(msg);
    };

    // Sticky fast-path: this function already tripped its cap earlier in the
    // bundle — skip the (now-stale) check entirely and fan out to Borg. Skipped
    // on replay (the drainer is the single paced sender; it must actually send).
    if (!isReplay && rl && _rateLimitedKeys.has(rlKey)) {
      return await rerouteOrThrow('Rate limit exceeded');
    }

    // ── Rate-limit gate (normal agent calls) ─────────────────────────────────
    // Under the limit → send inline (queueable senders get a short human-pacing
    // delay below). Over the limit → two escape hatches before we ever throw:
    //   1. queueable LinkedIn senders are captured into the background deferred-
    //      call drainer and return { queued: true };
    //   2. anything else (or a queueable send the drainer declines) falls to
    //      Borg requester-side reroute, and only then throws RateLimited.
    // Fail-open on transport faults so a hiccup never blocks a send.
    if (!isReplay && rl) {
      try {
        // One check per function-key per bundle: reuse the in-flight/resolved
        // decision; only the first call pays the browser→core roundtrip.
        let checkPromise = _rateLimitCheckByKey.get(rlKey);
        if (!checkPromise) {
          checkPromise = rl.check(service, fn);
          _rateLimitCheckByKey.set(rlKey, checkPromise);
          // Evict on failure so a later call can retry (fail-open semantics).
          void checkPromise.catch(() => _rateLimitCheckByKey.delete(rlKey));
        }
        const decision = await checkPromise;

        // Burst correction: the server `used` count comes from committed
        // FunctionInvocation rows, but this batch's invocations flush only AFTER
        // the executeJS call returns — so within one burst every check sees the
        // same pre-batch count. Add this bundle's local successes (excluding
        // borg-served calls, billed to donors) plus OTHER in-flight calls to the
        // same function so the cap holds mid-burst and a concurrent (Promise.all)
        // burst trips it instead of every call admitting on a stale count.
        let localUsed = 0;
        for (const r of buffer) {
          if (
            r.service === service &&
            r.fn === fn &&
            r.success === true &&
            r.borgServed !== true
          ) {
            localUsed++;
          }
        }
        localUsed += _inFlightByKey.get(rlKey) ?? 0;
        const serverUsed =
          typeof decision.used === 'number' ? decision.used : 0;
        const overLimit =
          !decision.allowed ||
          (decision.limit != null && serverUsed + localUsed >= decision.limit);

        if (overLimit) {
          const msg =
            typeof decision.message === 'string' && decision.message.length > 0
              ? decision.message
              : 'Rate limit exceeded';
          _rateLimitedKeys.add(rlKey);
          // Escape hatch 1 — queueable LinkedIn senders: capture the over-limit
          // call into the background drainer instead of throwing, so a batch send
          // loop keeps going and the whole overflow is captured; the drainer
          // replays each later, paced.
          //   - enqueue resolves { queued: false } when the deferred-queue
          //     feature is off for this user → fall through to the Borg reroute.
          //   - if enqueue throws (transport missing / IPC fault) the catch below
          //     fails OPEN: the call goes out inline rather than blocking.
          if (isQueueable(service, fn)) {
            const captured = await rl.enqueue(service, fn, args);
            if (captured && captured.queued) {
              buffer.push({
                service,
                fn,
                success: false,
                errorClass: 'RateLimited',
                durationMs: Math.round(nowMs() - start),
                errorMessage: 'queued: routed to background drainer',
                argsHash: await getArgsHash(),
                logicalArgs,
              });
              return { queued: true, message: queuedMessageFor(fn) };
            }
          }
          // Escape hatch 2 — Borg requester-side reroute, else throw RateLimited.
          return await rerouteOrThrow(msg);
        }
      } catch (e) {
        if (e instanceof RateLimited) throw e;
        // IPC fault or missing enqueue transport — fail OPEN so a transport
        // hiccup never blocks a normal send. Recorded under __ratelimit: so it
        // cannot resolve to a real registry row (spec corrections §1).
        buffer.push({
          service,
          fn: `__ratelimit:${fn}`,
          success: false,
          errorClass: 'UpstreamError',
          durationMs: Math.round(nowMs() - start),
          errorMessage: String((e as Error)?.message ?? e).slice(0, 1000),
          argsHash: await getArgsHash(),
        });
      }
    }

    // Inline pacing: an under-limit (or fail-open) queueable send is about to go
    // out now — space consecutive inline sends ~6–10s apart so a burst doesn't
    // fire instantly. Skipped on replay (the drainer already paces).
    if (!isReplay && isQueueable(service, fn)) {
      await new Promise((resolve) => setTimeout(resolve, inlineSendDelayMs()));
    }

    // Admitted (passed the gate): count this call as in-flight for the life of
    // impl so concurrent siblings see it. Rerouted/throttled calls return above
    // and never reach here.
    if (rl) {
      _inFlightByKey.set(rlKey, (_inFlightByKey.get(rlKey) ?? 0) + 1);
    }

    try {
      const result = await callImpl.apply(this, args);
      const crmArgsVal = crmSpec ? buildCrmArgs() : undefined;
      const crmResultVal = crmSpec ? buildCrmResult(result) : undefined;
      buffer.push({
        service,
        fn,
        success: true,
        durationMs: Math.round(nowMs() - start),
        argsHash: await getArgsHash(),
        logicalArgs,
        ...(crmArgsVal !== undefined ? { crmArgs: crmArgsVal } : {}),
        ...(crmResultVal !== undefined ? { crmResult: crmResultVal } : {}),
      });
      return result;
    } catch (err) {
      const errorClass = classify(err);
      if (errorClass === 'RateLimited') {
        const b = await tryBorgReroute();
        if (b.served) {
          buffer.push({
            service,
            fn,
            success: false,
            errorClass: undefined,
            borgServed: true,
            durationMs: Math.round(nowMs() - start),
            logicalArgs,
            argsHash: await getArgsHash(),
          });
          return b.result;
        }
      }
      buffer.push({
        service,
        fn,
        success: false,
        errorClass,
        errorMessage: String((err as Error)?.message ?? err).slice(0, 1000),
        durationMs: Math.round(nowMs() - start),
        argsHash: await getArgsHash(),
        logicalArgs,
      });
      throw err;
    } finally {
      if (rl) {
        const n = (_inFlightByKey.get(rlKey) ?? 1) - 1;
        if (n > 0) _inFlightByKey.set(rlKey, n);
        else _inFlightByKey.delete(rlKey);
      }
    }
  };
  return wrapped as unknown as T;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

async function sha256Safe(args: unknown): Promise<string | undefined> {
  try {
    const json = JSON.stringify(args ?? null);
    if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
      const buf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(json),
      );
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    /* swallow */
  }
  return undefined;
}
