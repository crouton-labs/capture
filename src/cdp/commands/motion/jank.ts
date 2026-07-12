import { type ParsedArgs } from '../../types.js';
import { resolveRecRef } from '../../../output/artifact.js';
import { emitResult, fact, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';
import { readMotionJank, type ArtifactLossFact, type LayoutShiftFact, type LayoutShiftRectFact, type LongTaskFact } from '../../motion/jank.js';

const USAGE = `capture motion jank <rec> — dropped-frame, long-task-record, and layout-shift facts over a finalized recording

input:
  <rec>   recording id in the active session or an absolute recording path (required; the recording must be finalized)
output: <jank …> — dropped-frame, long-task-record, and layout-shift facts; observer and screencast timing is recorder-relative performance.now(), trace timing recorder-relative only when an explicit trace/performance baseline was retained; --json mirrors
effects: read-only — reads the finalized recording artifact, never drives the browser`;

export async function cmdMotionJank(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (parsed.positional.length !== 1 || !parsed.positional[0]) {
    return emitCommandError(parsed, 'invalid_target', 'motion jank requires exactly one recording id or absolute recording path.', 'Record one with `capture motion rec <url> --do <action>` .');
  }

  try {
    const ref = resolveRecRef(parsed.positional[0]);
    const { analysis, meta } = readMotionJank(ref);
    const state = typeof meta.state === 'string' ? meta.state : 'unknown';
    const sections: FactLine[] = [fact`${analysis.timingNote}`];

    if (analysis.droppedFrames.length) {
      sections.push(lineList(analysis.droppedFrames.map((drop, index) =>
        fact`${index + 1}. frames ${drop.beforeFrame}→${drop.afterFrame}: interval ${drop.intervalMs.toFixed(2)}ms, cadence ${analysis.cadenceMs?.toFixed(2) ?? 'unavailable'}ms, estimated dropped frames ${drop.estimatedDroppedFrames}, t=${drop.startMs.toFixed(2)}→${drop.endMs.toFixed(2)}ms (±frame)`,
      )));
    } else {
      sections.push(fact`Dropped-frame intervals: 0; ${analysis.frameCount} timestamped rect sample(s), cadence ${analysis.cadenceMs?.toFixed(2) ?? 'unavailable'}ms.`);
    }
    if (analysis.missingFrameSampleCount > 0) sections.push(fact`${analysis.missingFrameSampleCount} screencast frame(s) have no rect timestamp sample; dropped-frame count is incomplete.`);
    if (analysis.cadenceMs === null) sections.push(text`Fewer than two positive frame intervals were retained; nominal cadence is unavailable and the dropped-frame count is incomplete.`);

    if (analysis.longTasks.length) {
      sections.push(lineList(analysis.longTasks.map((task, index) => formatLongTask(task, index))));
    } else {
      sections.push(text`Long-task records: 0.`);
    }

    if (analysis.layoutShifts.length) {
      sections.push(...analysis.layoutShifts.map((shift, index) => formatLayoutShift(shift, index)));
    } else {
      sections.push(text`Layout-shift records: 0.`);
    }

    if (analysis.artifactLoss.length) {
      sections.push(lineList(analysis.artifactLoss.map(formatArtifactLoss)));
    }

    const result: RenderableResult = {
      tag: 'jank',
      attestation: {
        kind: 'recording',
        id: ref.id,
        path: ref.dir,
        note: fact`Recording state ${state}. ${analysis.timingNote}`,
      },
      attrs: {
        state,
        frames: analysis.frameCount,
        'dropped-frames': analysis.droppedFrameCount,
        'dropped-frames-incomplete': analysis.droppedFramesIncomplete,
        'long-task-records': analysis.longTasks.length,
        'long-task-records-incomplete': analysis.longTasksIncomplete,
        'layout-shift-records': analysis.layoutShifts.length,
        'layout-shift-records-incomplete': analysis.layoutShiftsIncomplete,
        'timestamp-uncertainty': analysis.frameTimestampUncertainty,
      },
      summary: fact`${analysis.droppedFrameCount} estimated dropped frame(s)${analysis.droppedFramesIncomplete ? ' (incomplete)' : ''}, ${analysis.longTasks.length} long-task record(s)${analysis.longTasksIncomplete ? ' (incomplete)' : ''}, ${analysis.layoutShifts.length} layout-shift record(s)${analysis.layoutShiftsIncomplete ? ' (incomplete)' : ''}.`,
      sections,
    };
    emitResult(result, { json: parsed.json });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitCommandError(parsed, 'artifact_unavailable', message, 'Pass a finalized recording id/path; `capture motion rec --stop` finalizes a composed recording.');
  }
}

function formatLongTask(task: LongTaskFact, index: number): FactLine {
  const timingText = task.timingDomain === 'recorder-performance'
    ? `t=${task.startMs!.toFixed(2)}→${task.endMs!.toFixed(2)}ms`
    : task.timingDomain === 'trace-relative-first-event'
      ? `t=${task.startMs!.toFixed(2)}→${task.endMs!.toFixed(2)}ms relative to first trace event`
      : 'timing unavailable after navigation gap';
  const overlapText = task.overlapsDroppedFrames === null
    ? task.timingDomain === 'unavailable'
      ? '; dropped-frame overlap unavailable after navigation gap'
      : '; dropped-frame overlap unavailable across trace-relative and recorder-relative timing domains'
    : task.overlapsDroppedFrames.length
      ? `, overlaps dropped-frame interval(s) ending at frame ${task.overlapsDroppedFrames.join(', ')}`
      : '';
  return fact`long-task record ${index + 1} (${task.source}): ${timingText}, duration ${task.durationMs.toFixed(2)}ms${overlapText}.`;
}

function formatLayoutShift(shift: LayoutShiftFact, index: number): FactLine {
  const attribution = shift.attribution === 'observer-sources'
    ? 'PerformanceObserver sources'
    : shift.attribution === 'frame-diff-inferred'
      ? `inferred from rect samples bracketing t=${shift.beforeFrameMs?.toFixed(2)}→${shift.afterFrameMs?.toFixed(2)}ms (±frame)`
      : 'unavailable';
  const timing = shift.tMs === null ? 'timing unavailable after navigation gap' : `t=${shift.tMs.toFixed(2)}ms`;
  const header = fact`layout shift ${index + 1}: ${timing}, value ${shift.value}${shift.hadRecentInput === undefined ? '' : `, had-recent-input ${shift.hadRecentInput}`}; attribution ${attribution}`;
  return shift.rects.length ? lineList([header, ...shift.rects.map(formatShiftRect)]) : lineList([header, text`no element-attributed rect record was retained for this layout-shift entry`]);
}

function formatShiftRect(item: LayoutShiftRectFact): FactLine {
  const current = item.rect ? `x=${item.rect.x} y=${item.rect.y} w=${item.rect.w} h=${item.rect.h}` : 'unavailable';
  const previous = item.previousRect ? `x=${item.previousRect.x} y=${item.previousRect.y} w=${item.previousRect.w} h=${item.previousRect.h}` : 'unavailable';
  const movement = item.delta ? `x=${item.delta.x} y=${item.delta.y} w=${item.delta.w} h=${item.delta.h}` : 'unavailable';
  return fact`   ${item.elementId === undefined ? 'element id unavailable' : `element ${item.elementId}`}: rect ${current}; previous rect ${previous}; delta ${movement}`;
}

function formatArtifactLoss(loss: ArtifactLossFact): FactLine {
  const details = loss.message ?? loss.reason ?? 'detail unavailable';
  const affected = loss.affectedCounts.length ? `${loss.affectedCounts.join(', ')} (incomplete)` : 'no jank count family';
  return fact`Artifact loss/recovery: ${loss.kind}; ${loss.count ?? 'unknown'} record(s); ${details}. Affected counts: ${affected}.`;
}

function emitCommandError(parsed: ParsedArgs, status: string, message: string, recovery: string): void {
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'motion jank', status },
    summary: fact`${message}`,
    followUp: fact`${recovery}`,
  };
  emitResult(result, { json: parsed.json });
  process.exitCode = 1;
}
