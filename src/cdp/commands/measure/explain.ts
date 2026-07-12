import { type ParsedArgs } from '../../types.js';
import { explainSnapshot, type ExplainMissingSelector } from '../../measure/explain.js';
import { ArtifactResolutionError, resolveSnapRef } from '../../../output/artifact.js';
import { data, emitResult, fact, line, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const USAGE = `Usage: capture measure explain <snap> --selector <sel> [--size] [--text] [--form]

Per-element cascade/stacking/clipping explanation over one snapshot, plus
optional detail sections.

Options:
  --selector <sel>   Element selector (required); CSS, backend:<id>, axid:<id>, ax:<name>, or text:<text>
  --size             Include size/layout provenance (box/flex/grid/constraints)
  --text             Include text line/baseline/font/wrap metrics
  --form             Include form geometry/caret/selection/autofill facts (values withheld)

With no detail flag, returns the standard compact element explanation.`;

function attestation(ref: { id: string; dir: string }, meta: { settled?: boolean; settleMs?: number }) {
  return {
    kind: 'snapshot' as const,
    id: ref.id,
    path: ref.dir,
    note: meta.settled === false
      ? text`Snapshot was captured unsettled; each explanation fact intersecting an unstable region carries its own nondeterminism caveat.`
      : meta.settled === true
        ? fact`Snapshot settled${meta.settleMs === undefined ? '' : ` after ${meta.settleMs}ms`}.`
        : text`Snapshot settledness was not recorded.`,
  };
}

function caveatSuffix(caveats: readonly { regionId: string; selector?: string; reason?: string }[]): FactLine | undefined {
  if (!caveats.length) return undefined;
  const entries = caveats.map((caveat) => {
    const parts: FactLine[] = [data(caveat.regionId)];
    if (caveat.selector) parts.push(line(text` (`, data(caveat.selector), text`)`));
    if (caveat.reason) parts.push(line(text`: `, data(caveat.reason)));
    return line(...parts);
  });
  const joined: FactLine[] = [];
  entries.forEach((entry, index) => {
    if (index) joined.push(text`; `);
    joined.push(entry);
  });
  return line(text` — nondeterminism caveat: `, ...joined);
}

function recoverySections(missing: ExplainMissingSelector): FactLine[] {
  const { candidates, recordCount, kind } = missing.available;
  const label = kind === 'css' ? 'CSS selectors' : `${kind}: selector inputs`;
  const rows = candidates.length
    ? candidates.map((candidate, index) => fact`${index + 1}. ${candidate}`)
    : [fact`No recorded ${label} were available from geometry records.`];
  return [
    fact`Nearest recorded ${label}: ${candidates.length} shown from ${recordCount} geometry record(s), ranked by identifier similarity then string distance from the requested selector.`,
    lineList(rows),
    text`All recorded selector and identity facts remain in this snapshot's geometry.json, ax.json, and text.json artifacts.`,
  ];
}

function invalidInput(message: FactLine): RenderableResult {
  return {
    tag: 'error',
    attrs: { command: 'measure explain', status: 'invalid_input' },
    summary: message,
    followUp: text`Run capture measure explain <snap> --selector <CSS|backend:id|axid:id|ax:name|text:value>.`,
  };
}

export async function cmdMeasureExplain(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (rejectUnsupportedGate(parsed, 'measure explain')) return;
  if (parsed.positional.length !== 1) {
    emitResult(invalidInput(fact`Expected exactly one snapshot target; received ${parsed.positional.length}.`), { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (!parsed.selector) {
    emitResult(invalidInput(text`The --selector flag is required.`), { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  try {
    const ref = await resolveSnapRef(parsed.positional[0]!);
    const report = explainSnapshot(ref, parsed.selector, { size: parsed.size, text: parsed.text, form: parsed.form });
    if (report.kind === 'missing-selector') {
      emitResult({
        tag: 'error',
        attestation: attestation(report.ref, report.meta),
        attrs: { command: 'measure explain', status: 'missing_selector', selector: report.selector },
        summary: fact`No geometry element matched selector input ${report.selector}. Bounded recovery candidates from this snapshot follow.`,
        sections: recoverySections(report),
        followUp: text`The selector input also accepts CSS, backend:, axid:, ax:, and text: forms.`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
    }

    const sections = report.sections.map((section) => lineList(section.facts.map(({ fact: item, caveats }) => {
      const suffix = caveatSuffix(caveats);
      return suffix ? line(item.line, suffix) : item.line;
    })));
    const targetSelector = report.element.selector ?? report.element.id;
    const result: RenderableResult = {
      tag: 'explain',
      attestation: attestation(report.ref, report.meta),
      attrs: {
        selector: targetSelector,
        matches: report.matchCount,
        settled: report.meta.settled ?? 'unknown',
        size: Boolean(parsed.size),
        text: Boolean(parsed.text),
        form: Boolean(parsed.form),
      },
      summary: fact`Recorded cascade, stacking, clipping, focus, scroll, query, and state context for ${targetSelector}.`,
      sections,
      followUp: parsed.size || parsed.text || parsed.form
        ? text`Re-run against a new snapshot to compare the same recorded measurements after a page change.`
        : text`Add --size, --text, or --form to include only those optional detail sections.`,
    };
    emitResult(result, { json: parsed.json });
  } catch (error) {
    const detail = error instanceof ArtifactResolutionError || error instanceof Error ? error.message : String(error);
    emitResult({
      tag: 'error',
      attrs: { command: 'measure explain', status: 'artifact_unavailable' },
      summary: fact`The requested snapshot explanation could not be read: ${detail}`,
      followUp: text`Create a settled snapshot with capture measure snap, then pass its id or absolute artifact path.`,
    }, { json: parsed.json });
    process.exitCode = 1;
  }
}
