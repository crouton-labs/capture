/**
 * `--gate` (exit 2 on findings/changes) is scoped to exactly two leaves —
 * `measure check` and `measure diff` — per the observational-collector
 * posture invariant (no collector or query leaf grades/gates its own
 * output; see I-8). The shared dispatch path (`src/cdp/dispatch.ts`)
 * invokes this guard ONCE per invocation, via `isGateLeaf`, for every
 * command on the whole surface, so a caller that supplies `--gate`
 * anywhere else gets a typed rejection (thrown here, rendered at the
 * `src/capture.ts` root boundary) before any branch main runs instead of
 * the flag being silently accepted and ignored. The dispatch guard is the
 * ONLY caller of `rejectUnsupportedGate`; no leaf calls it directly.
 */
import { type ParsedArgs } from '../types.js';
import { invalidInput } from '../../errors.js';

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

/**
 * Throws the typed `--gate` rejection for a leaf that doesn't support it;
 * returns normally when `parsed.gate` is unset. The throw crosses the shared
 * dispatch path unrendered — the root boundary in `src/capture.ts` is the one
 * place that renders it and sets the exit code.
 *
 * `command` is the leaf's own dotted usage name (e.g. `"measure snap"`,
 * `"motion jank"`), carried in the message so the rejection still names the
 * exact leaf.
 */
export function rejectUnsupportedGate(parsed: ParsedArgs, command: string): void {
  if (!parsed.gate) return;
  throw invalidInput(
    `\`--gate\` is not accepted on \`${command}\`. received: --gate; expected: no gate flag on this leaf. \`--gate\` (exit 2 on findings/changes) is accepted only by \`measure check\` and \`measure diff\`.`,
    'unsupported_flag',
  );
}
