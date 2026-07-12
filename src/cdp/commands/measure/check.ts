import { type ParsedArgs } from '../../types.js';
import { resolveSnapRef, readMeta, type ArtifactResolutionError } from '../../../output/artifact.js';
import { emitResult, fact, line, text, formatFindings, type FindingInput, type RenderableResult } from '../../../output/render.js';
import { captureMeasureSnap } from './snap.js';
import { checkSnapshot, parseChecks, writeFindingCrop } from '../../measure/check.js';

const USAGE = `capture measure check [url|snap] — read threshold/fact measurements from a settled snapshot

input:
  [url|snap]      a URL creates one one-shot snapshot first; a snap id or absolute path is read without re-driving the browser
  --for <checks>  geometry|content|targetability|forms|animation|all, or comma-separated overlap,offscreen,overflow,tap-targets,contrast,hit-test,truncation,forms,media,animation
  --limit <n>     render at most n representative findings in prose (default: 20; --json retains all findings)
  --gate          exit 2 when the report contains findings (default: exit 0)
output: <checks result=… findings=…> — findings with coordinates and collection provenance; measurements, not a pass/fail judgment; --json mirrors
effects: read-only over an existing snapshot artifact; a URL target writes one one-shot snapshot first`;

const DEFAULT_FINDING_LIMIT = 20;

function representativeFindings<T extends { kind: string }>(findings: readonly T[], limit: number): T[] {
  const byKind = new Map<string, T[]>();
  for (const finding of findings) {
    const group = byKind.get(finding.kind) ?? [];
    group.push(finding);
    byKind.set(finding.kind, group);
  }
  const displayed: T[] = [];
  for (let index = 0; displayed.length < limit; index++) {
    let added = false;
    for (const group of byKind.values()) {
      const finding = group[index];
      if (!finding) continue;
      displayed.push(finding);
      added = true;
      if (displayed.length === limit) break;
    }
    if (!added) break;
  }
  return displayed;
}

function rollup(findings: readonly { kind: string }[]) {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.kind, (counts.get(finding.kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, count]) => fact`${kind}=${count}`).reduce<ReturnType<typeof fact> | undefined>((line, entry) => line ? [...line, ...text`, `, ...entry] : entry, undefined);
}

function caveatLine(caveats: readonly { regionId: string; selector?: string; reason?: string }[]) {
  if (!caveats.length) return undefined;
  return fact`Nondeterminism caveat: unstable region ${caveats.map((c) => `${c.regionId}${c.selector ? ` (${c.selector})` : ''}${c.reason ? `: ${c.reason}` : ''}`).join('; ')}.`;
}

export async function cmdMeasureCheck(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) { console.log(USAGE); return; }
  if (parsed.positional.length > 1) {
    emitResult({ tag: 'error', attrs: { command: 'measure check', status: 'invalid_input' }, summary: text`measure check accepts at most one URL or snapshot reference.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (parsed.limitRaw !== undefined && !/^[1-9]\d*$/.test(parsed.limitRaw)) {
    emitResult({ tag: 'error', attrs: { command: 'measure check', status: 'invalid_input' }, summary: text`--limit must be a positive integer.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  try {
    const target = parsed.positional[0];
    if (!target) throw new Error('missing snapshot target; pass a snapshot id/path or URL');
    const checks = parseChecks(parsed.for);
    const ref = await resolveSnapRef(target, { onUrl: async (url) => captureMeasureSnap({ ...parsed, positional: [url] }, url) });
    const report = checkSnapshot(ref, checks);
    const proseFindings = representativeFindings(report.findings, parsed.limit ?? DEFAULT_FINDING_LIMIT);
    const findingsForOutput = parsed.json ? report.findings : proseFindings;
    const withCrops = findingsForOutput.map((finding, index) => ({ ...finding, crop: writeFindingCrop(ref, finding, index) }));
    const meta = readMeta<{ settled: boolean; capturedAt?: string }> (ref);
    const findingSections: FindingInput[] = withCrops.map((finding) => ({
      kind: finding.kind,
      headline: fact`${finding.detail}`,
      detail: [
        ...(finding.provenance ? [fact`Provenance: ${finding.provenance}`] : []),
        ...(caveatLine(finding.caveats) ? [caveatLine(finding.caveats)!] : []),
      ],
      artifactPath: finding.crop,
    }));
    const result: RenderableResult = {
      tag: 'checks',
      attestation: {
        kind: 'snapshot', id: ref.id, path: ref.dir,
        note: meta.settled ? text`Measurements read from a settled snapshot.` : text`Measurements read from a queryable unsettled snapshot; affected facts carry per-region nondeterminism caveats.`,
      },
      attrs: { result: report.findings.length ? 'findings' : 'clean', checks: checks.join(','), elements: report.elementCount, findings: report.findings.length, displayed: withCrops.length, settled: report.settled },
      summary: report.findings.length
        ? fact`${report.findings.length} measured fact(s) matched the selected thresholds in viewport ${report.viewport.width}×${report.viewport.height}; ${withCrops.length} representative record(s) rendered.`
        : fact`No selected measurement threshold was crossed among ${report.elementCount} recorded elements in viewport ${report.viewport.width}×${report.viewport.height}.`,
      sections: [
        ...(report.findings.length ? [line(text`Finding counts: `, rollup(report.findings)!)] : []),
        ...formatFindings(findingSections),
      ],
      followUp: parsed.json
        ? fact`All ${report.findings.length} measured finding record(s) are included in this JSON result.`
        : fact`Use --json to read all ${report.findings.length} measured finding record(s) from this snapshot.`,
    };
    emitResult(result, { json: parsed.json });
    if (parsed.gate && report.findings.length) process.exitCode = 2;
  } catch (err) {
    const resolution = err as Partial<ArtifactResolutionError>;
    const detail = err instanceof Error ? err.message : 'unknown artifact read failure';
    emitResult({
      tag: 'error',
      attrs: { command: 'measure check', status: resolution.name === 'ArtifactResolutionError' ? 'artifact_unavailable' : 'check_failed' },
      summary: fact`Measure check could not read the requested artifact: ${detail}`,
      followUp: text`Create a settled snapshot with capture measure snap <url>, then pass its id or absolute path.`,
    }, { json: parsed.json });
    process.exitCode = 1;
  }
}
