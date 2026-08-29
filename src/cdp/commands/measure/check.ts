import { type ParsedArgs } from '../../types.js';
import { resolveSnapRef, readGeometry, readMeta, type ArtifactResolutionError } from '../../../output/artifact.js';
import { resolveSelectorInput } from '../../../output/selector.js';
import { emitResult, fact, line, text, formatCoordinate, formatFindings, type FindingInput, type RenderableResult } from '../../../output/render.js';
import { captureMeasureSnap } from './snap.js';
import { checkSnapshot, parseChecks, writeFindingCrop } from '../../measure/check.js';

const USAGE = `capture measure check [url|snap] — read threshold/fact measurements from a settled snapshot

input:
  [url|snap]      a URL creates one one-shot snapshot first; a snap id or absolute path is read without re-driving the browser
  --for <checks>  geometry|content|targetability|forms|animation|all, or comma-separated overlap,offscreen,overflow,tap-targets,contrast,hit-test,truncation,forms,media,animation
  --limit <n>     render at most n representative findings in prose (default: 20; --json retains all findings)
  --selector <s>  limit measurements to recorded CSS/text/AX selector input or backend:<id>
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
  try {
    const target = parsed.positional[0];
    if (!target) throw new Error('missing snapshot target; pass a snapshot id/path or URL');
    const checks = parseChecks(parsed.for);
    const ref = await resolveSnapRef(target, { onUrl: async (url) => captureMeasureSnap({ ...parsed, positional: [url] }, url) });
    const report = checkSnapshot(ref, checks);
    const scopedElements = parsed.selector
      ? resolveSelectorInput(readGeometry<{ elements?: Array<{ id: string; selector?: string; backendNodeId?: number | null }> }>(ref).elements ?? [], parsed.selector)
      : undefined;
    if (scopedElements && !scopedElements.length) {
      emitResult({
        tag: 'error',
        attrs: { command: 'measure check', status: 'missing_selector', selector: parsed.selector! },
        summary: fact`No geometry record matched selector input ${parsed.selector}.`,
        followUp: text`Use a recorded selector or backend:<id> from geometry.json.`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
    }
    const scopedIds = scopedElements ? new Set(scopedElements.map((element) => element.id)) : undefined;
    const scopedBackendNodeIds = scopedElements ? new Set(scopedElements.map((element) => element.backendNodeId).filter((backendNodeId): backendNodeId is number => backendNodeId !== null && backendNodeId !== undefined)) : undefined;
    const selectorCounts = new Map<string, number>();
    for (const element of readGeometry<{ elements?: Array<{ selector?: string }> }>(ref).elements ?? []) if (element.selector !== undefined) selectorCounts.set(element.selector, (selectorCounts.get(element.selector) ?? 0) + 1);
    const scopedSelectors = scopedElements ? new Set(scopedElements.map((element) => element.selector).filter((selector): selector is string => selector !== undefined && selectorCounts.get(selector) === 1)) : undefined;
    const findings = scopedIds ? report.findings.filter((finding) => (finding.elementId !== undefined && scopedIds.has(finding.elementId)) || (finding.backendNodeId !== undefined && scopedBackendNodeIds!.has(finding.backendNodeId)) || (finding.selector !== undefined && scopedSelectors!.has(finding.selector))) : report.findings;
    const proseFindings = representativeFindings(findings, parsed.limit ?? DEFAULT_FINDING_LIMIT);
    const findingsForOutput = parsed.json ? findings : proseFindings;
    const withCrops = findingsForOutput.map((finding, index) => ({ ...finding, crop: writeFindingCrop(ref, finding, index) }));
    const meta = readMeta<{ settled: boolean; capturedAt?: string }> (ref);
    const findingSections: FindingInput[] = withCrops.map((finding) => ({
      kind: finding.kind,
      headline: fact`${finding.detail}`,
      detail: [
        ...(finding.rect ? [line(text`Rect: `, formatCoordinate(finding.rect))] : []),
        ...(finding.backendNodeId !== undefined ? [fact`Selector input: backend:${finding.backendNodeId}`] : []),
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
      attrs: { result: findings.length ? 'findings' : 'clean', checks: checks.join(','), elements: scopedElements?.length ?? report.elementCount, findings: findings.length, displayed: withCrops.length, settled: report.settled, ...(parsed.selector ? { selector: parsed.selector } : {}) },
      summary: findings.length
        ? fact`${findings.length} measured fact(s) matched the selected thresholds in viewport ${report.viewport.width}×${report.viewport.height}; ${withCrops.length} representative record(s) rendered.`
        : fact`No selected measurement threshold was crossed among ${scopedElements?.length ?? report.elementCount} recorded elements in viewport ${report.viewport.width}×${report.viewport.height}.`,
      sections: [
        ...(findings.length ? [line(text`Finding counts: `, rollup(findings)!)] : []),
        ...formatFindings(findingSections),
      ],
      followUp: parsed.json
        ? fact`All ${findings.length} measured finding record(s) are included in this JSON result.`
        : fact`Use --json to read all ${findings.length} measured finding record(s) from this snapshot.`,
    };
    emitResult(result, { json: parsed.json });
    if (parsed.gate && findings.length) process.exitCode = 2;
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
