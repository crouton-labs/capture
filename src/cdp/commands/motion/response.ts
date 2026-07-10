import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, line, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';
import { ArtifactResolutionError } from '../../../output/artifact.js';
import { sanitizeString } from '../../measure/redaction.js';
import { loadResponseTimeline, ResponseActionSelectionError, type ResponsePoint } from '../../motion/response.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const USAGE = `Usage: capture motion response <rec> [--action <action>]

Input-to-settled response timeline over a finalized recording:
input -> mutation -> layout -> paint -> network -> settle.

Options:
  --action <action>   Narrow to one recorded action`;

function formatPoint(point: ResponsePoint): FactLine {
  const uncertainty = point.precision === 'frame' ? text` (±1 frame)` : text``;
  return line(fact`${point.stage}: t=${point.timestampMs.toFixed(2)}ms, Δ=${point.deltaMs.toFixed(2)}ms — ${point.source}`, uncertainty);
}

function emitError(parsed: ParsedArgs, status: string, message: string, sections?: readonly FactLine[]): void {
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'motion response', status },
    summary: fact`${sanitizeString(message, { max: 500 })}`,
    sections,
  };
  emitResult(result, { json: parsed.json });
  process.exitCode = 1;
}

export async function cmdMotionResponse(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (rejectUnsupportedGate(parsed, 'motion response')) return;
  if (parsed.positional.length !== 1) {
    return emitError(parsed, 'invalid_input', 'motion response requires exactly one recording id or absolute recording path. Create one with `capture motion rec`.');
  }

  try {
    const loaded = loadResponseTimeline(parsed.positional[0], parsed.action);
    const { ref, timeline } = loaded;
    const result: RenderableResult = {
      tag: 'response',
      attestation: {
        kind: 'recording',
        id: ref.id,
        path: ref.dir,
        note: fact`${timeline.timingNote} Recording state: ${timeline.state}.`,
      },
      attrs: {
        action: timeline.action,
        state: timeline.state,
        'timing-domain': 'performance.now() relative to recorder arm',
        'frame-uncertainty': '±1 frame where marked',
      },
      summary: fact`Input dispatch bracket: t=${timeline.inputStartMs.toFixed(2)}ms to ${timeline.inputEndMs.toFixed(2)}ms. Response stages present: ${timeline.points.length - 1}. Unavailable stages: ${timeline.unavailableStages.length ? timeline.unavailableStages.join(', ') : 'none'}.`,
      sections: [
        lineList(timeline.points.map(formatPoint)),
        ...(timeline.caveats.length ? [lineList(timeline.caveats.map((caveat) => fact`caveat: ${caveat}`))] : []),
      ],
    };
    emitResult(result, { json: parsed.json });
  } catch (err) {
    if (err instanceof ResponseActionSelectionError) {
      const actions = err.actions.length
        ? lineList(err.actions.map((action) => fact`available action: ${action}`))
        : text`No input marks were recorded. Record a driven capture action with \`capture motion rec <url> --do <action>\` or drive an action during composed recording.`;
      return emitError(parsed, 'action_required', err.message, [actions]);
    }
    if (err instanceof ArtifactResolutionError) {
      return emitError(parsed, 'artifact_unavailable', err.message);
    }
    return emitError(parsed, 'response_unavailable', err instanceof Error ? err.message : String(err));
  }
}
