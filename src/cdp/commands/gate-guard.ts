/**
 * `--gate` (exit 2 on findings/changes) is scoped to exactly two leaves —
 * `measure check` and `measure diff` — per the observational-collector
 * posture invariant (no collector or query leaf grades/gates its own
 * output; see I-8). The shared dispatch path (`src/cdp/dispatch.ts`)
 * invokes this guard ONCE per invocation, via `isGateLeaf`, for every
 * command on the whole surface, so a caller that supplies `--gate`
 * anywhere else gets a structured rejection before any branch main runs
 * instead of the flag being silently accepted and ignored. (measure/motion
 * leaves additionally still call `rejectUnsupportedGate` directly; those
 * per-leaf calls are redundant with the dispatch-level guard.)
 */
import { type ParsedArgs } from '../types.js';
import { emitResult, fact, type RenderableResult } from '../../output/render.js';

/**
 * Returns `true` (having already emitted a structured error and called
 * `process.exit(1)`) when `parsed.gate` is set on a leaf that doesn't
 * support it. Returns `false` when the leaf should continue normally.
 *
 * `command` is the leaf's own dotted usage name (e.g. `"measure snap"`,
 * `"motion jank"`) — the same string every leaf already passes as
 * `attrs.command` on its own error results.
 */
/** True iff this invocation is one of the exactly two leaves that accept
 * `--gate`: `measure check` and `measure diff`. Leaf detection is
 * `parsed.command` plus the first positional (the branch-leaf token —
 * branch routers shift it off before their leaves run, but dispatch sees
 * it in place). */
export function isGateLeaf(parsed: ParsedArgs): boolean {
  if (parsed.command !== 'measure') return false;
  const leaf = parsed.positional[0];
  return leaf === 'check' || leaf === 'diff';
}

export function rejectUnsupportedGate(parsed: ParsedArgs, command: string): boolean {
  if (!parsed.gate) return false;

  const result: RenderableResult = {
    tag: 'error',
    attrs: { command, status: 'unsupported_flag' },
    summary: fact`\`--gate\` is not accepted on \`${command}\`. received: --gate; expected: no gate flag on this leaf.`,
    followUp: fact`\`--gate\` (exit 2 on findings/changes) is accepted only by \`measure check\` and \`measure diff\`. Re-run \`${command}\` without \`--gate\`.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
  return true;
}
