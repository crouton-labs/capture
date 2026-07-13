/**
 * Pure, side-effect-free leaf grammar validators shared between the central
 * pre-dispatch validator (`validateCliInvocation` in `args.ts`) and the leaf
 * commands themselves. Every check here must run BEFORE session/endpoint
 * resolution and before any artifact allocation, so a malformed leaf argument
 * can never read/clean the active-session pointer or allocate a one-shot dir
 * before it is rejected. The leaves import the same functions so the two
 * layers never drift into divergent predicates.
 *
 * Keep this module dependency-light (only `errors.js`) — `args.ts` imports it,
 * so pulling in a heavy leaf module here would drag browser/recorder code into
 * the pure parse/validate path.
 */
import { invalidInput } from '../errors.js';

/** WHATWG-parseable URL check. */
export function isParseableUrl(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Rejects a non-parseable URL as an invocation error (never a leaf runtime error). */
export function assertParseableUrl(value: string, label: string): void {
  if (!isParseableUrl(value)) throw invalidInput(`Invalid ${label}: ${value}.`);
}

export const SWEEP_NUMERIC_AXES = ['width', 'dpr', 'zoom'] as const;
export const SWEEP_ENUM_AXES = ['color-scheme', 'reduced-motion'] as const;
export type SweepAxisName = (typeof SWEEP_NUMERIC_AXES)[number] | (typeof SWEEP_ENUM_AXES)[number];

/** Full unsigned/positive finite-number grammar for a sweep numeric bound. Returns
 * the fallback when the token is absent so callers share one predicate. */
export function parsePositiveNumber(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw invalidInput(`${flag} must be a positive number.`);
  return value;
}

const SWEEP_ENUM_VALUES: Record<(typeof SWEEP_ENUM_AXES)[number], readonly [string, string]> = {
  'color-scheme': ['light', 'dark'],
  'reduced-motion': ['no-preference', 'reduce'],
};

/** Validates `--from`/`--to` against the axis domain without allocating anything. */
export function assertSweepBounds(axis: SweepAxisName, from: string | undefined, to: string | undefined): void {
  if ((SWEEP_NUMERIC_AXES as readonly string[]).includes(axis)) {
    parsePositiveNumber(from, 1, '--from');
    parsePositiveNumber(to, 1, '--to');
    return;
  }
  const [a, b] = SWEEP_ENUM_VALUES[axis as (typeof SWEEP_ENUM_AXES)[number]];
  const fromValue = from ?? a;
  const toValue = to ?? b;
  if (![a, b].includes(fromValue) || ![a, b].includes(toValue) || fromValue === toValue) {
    throw invalidInput(`${axis} uses distinct --from/--to values from ${a},${b}.`);
  }
}

/** Shared `top|bottom|px` grammar for page and recorder scroll actions. */
export function isScrollDestination(value: string): boolean {
  return value === 'top' || value === 'bottom' || (value.trim() !== '' && Number.isFinite(Number(value)));
}

export function assertScrollDestination(value: string): void {
  if (!isScrollDestination(value)) throw invalidInput('Scroll destination must be top, bottom, or a pixel offset.');
}

export type DoAction =
  | { verb: 'click'; target: string }
  | { verb: 'scroll'; target: string; to: string };

/**
 * Parses the deliberately narrow one-shot `motion rec --do` action grammar
 * (targets use the unified driving-verb target grammar; `text:` is rejected
 * only later at live resolution, not here). Pure: throws an invocation error
 * on malformed grammar and never touches the filesystem.
 */
export function parseDoAction(action: string): DoAction {
  if (action.startsWith('click:')) {
    const target = action.slice('click:'.length);
    if (!target) throw invalidInput('Invalid --do action: click requires a target — a css selector, ax:<name>, axid:<id>, or backend:<id>.');
    return { verb: 'click', target };
  }
  if (action.startsWith('scroll:')) {
    const spec = action.slice('scroll:'.length);
    const comma = spec.lastIndexOf(',to=');
    if (comma <= 0) throw invalidInput('Invalid --do action: scroll requires `scroll:<target>,to=<top|bottom|px>`.');
    const to = spec.slice(comma + ',to='.length);
    if (!isScrollDestination(to)) throw invalidInput('Invalid --do action: scroll requires `scroll:<target>,to=<top|bottom|px>`.');
    return { verb: 'scroll', target: spec.slice(0, comma), to };
  }
  throw invalidInput('Unsupported --do action. Supported actions: click:<target>; scroll:<target>,to=<top|bottom|px> — target is a css selector, ax:<name>, axid:<id>, or backend:<id>.');
}
