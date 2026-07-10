import { type ParsedArgs } from '../../types.js';
import { resolveSnapRef, readMeta, type ArtifactResolutionError } from '../../../output/artifact.js';
import { emitResult, fact, text, formatFindings, type FindingInput, type RenderableResult } from '../../../output/render.js';
import { captureMeasureSnap } from './snap.js';
import { checkSnapshot, parseChecks, writeFindingCrop } from '../../measure/check.js';

const USAGE = `Usage: capture measure check [url|snap] [--for <checks>] [--gate]

Read threshold/fact measurements from a settled snapshot. A URL target creates
one one-shot snapshot first; snap ids and absolute paths are read without
re-driving the browser.

Options:
  --for <checks>  geometry|content|targetability|forms|animation|all, or
                  comma-separated overlap,offscreen,overflow,tap-targets,
                  contrast,hit-test,truncation,forms,media,animation
  --gate          Exit 2 when the report contains findings (default: exit 0)

Findings report coordinates and collection provenance; they are measurements,
not a pass/fail judgment.`;

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
  try {
    const target = parsed.positional[0];
    if (!target) throw new Error('missing snapshot target; pass a snapshot id/path or URL');
    const checks = parseChecks(parsed.for);
    const ref = await resolveSnapRef(target, { onUrl: async (url) => captureMeasureSnap({ ...parsed, positional: [url] }, url) });
    const report = checkSnapshot(ref, checks);
    const withCrops = report.findings.map((finding, index) => ({ ...finding, crop: writeFindingCrop(ref, finding, index) }));
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
      attrs: { result: withCrops.length ? 'findings' : 'clean', checks: checks.join(','), elements: report.elementCount, findings: withCrops.length, settled: report.settled },
      summary: withCrops.length
        ? fact`${withCrops.length} measured fact(s) matched the selected thresholds in viewport ${report.viewport.width}×${report.viewport.height}.`
        : fact`No selected measurement threshold was crossed among ${report.elementCount} recorded elements in viewport ${report.viewport.width}×${report.viewport.height}.`,
      sections: formatFindings(findingSections),
      followUp: fact`Re-snap and run capture measure check ${ref.id} to measure the later artifact with the same checks.`,
    };
    emitResult(result, { json: parsed.json });
    if (parsed.gate && withCrops.length) process.exitCode = 2;
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
