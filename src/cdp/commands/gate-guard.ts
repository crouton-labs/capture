/**
 * `--gate` (exit 2 on findings/changes) is scoped to exactly two leaves —
 * `measure check` and `measure diff` — per the observational-collector
 * posture invariant (no collector or query leaf grades/gates its own
 * output; see I-8). Every other measure/motion leaf must call this first,
 * before any leaf-specific logic, so a caller that supplies `--gate`
 * anywhere else gets a structured rejection instead of the flag being
 * silently accepted and ignored.
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
