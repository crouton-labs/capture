/**
 * `measure map ax` query — the AX-tree ↔ layout map, a pure read over the
 * snap substrate's `ax.json` + `geometry.json` (D1's measurement half of
 * the old `a11y` split). Reports, as facts only:
 *
 *  - every non-ignored AX node: role, name, curated states, `backendNodeId`
 *    (the cross-artifact join key, I-3), and its top-viewport rect;
 *  - every ignored AX node with its ignored-reasons;
 *  - DOM elements with rendered boxes (from `geometry.json`) but no
 *    non-ignored AX node — the "unmapped boxes";
 *  - AX nodes whose rect is offscreen, clipped by the viewport edge, or
 *    zero-size.
 *
 * A missing/failed `ax.json` (or an `available:false` report inside it)
 * renders the explicit I-5 unavailability fact — never an empty tree. No
 * score, no coverage grade, no gate (I-8). All page-derived strings flow
 * through `data()`/`fact` (I-9); AX names were already redacted at collect
 * time (I-7).
 */
import type { AxNodeRecord, AxReport } from './collectors/ax.js';
import type { SnapMeta } from '../../session/artifacts.js';
import {
  annotateUnstableFacts,
  ArtifactResolutionError,
  readAx,
  readGeometry,
  readMeta,
  unstableRegionsFor,
  type Rect,
  type SnapRef,
  type UnstableCaveat,
} from '../../output/artifact.js';
import {
  data,
  fact,
  formatCoordinate,
  line,
  lineList,
  text,
  type FactLine,
  type RenderableResult,
} from '../../output/render.js';

/** Collector rect shape (`src/cdp/coordinates.ts`) as written to `ax.json`/`geometry.json`. */
interface CollectorRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface GeometryElement {
  readonly id?: string;
  readonly selector?: string;
  readonly backendNodeId?: number | null;
  readonly identityUnresolved?: boolean;
  readonly rect?: CollectorRect | null;
  readonly visibility?: { readonly visible?: boolean };
}

type RectPlacement = 'offscreen' | 'clipped' | 'zero-size';

function toRect(rect: CollectorRect | null | undefined): Rect | undefined {
  if (!rect) return undefined;
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return undefined;
  return { x, y, w: width, h: height };
}

function parseViewport(viewport: string | null | undefined): { w: number; h: number } | undefined {
  if (!viewport) return undefined;
  const match = /^(\d+)x(\d+)$/.exec(viewport);
  if (!match) return undefined;
  return { w: Number(match[1]), h: Number(match[2]) };
}

/** Viewport placement of a top-viewport rect. `undefined` = fully in-viewport
 * (no placement fact to report). Offscreen/clipped need a viewport size;
 * zero-size does not. */
function classifyRect(rect: Rect, viewport: { w: number; h: number } | undefined): RectPlacement | undefined {
  if (rect.w === 0 || rect.h === 0) return 'zero-size';
  if (!viewport) return undefined;
  if (rect.x + rect.w <= 0 || rect.y + rect.h <= 0 || rect.x >= viewport.w || rect.y >= viewport.h) return 'offscreen';
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > viewport.w || rect.y + rect.h > viewport.h) return 'clipped';
  return undefined;
}

function caveatSuffix(caveats: readonly UnstableCaveat[]): FactLine | undefined {
  if (caveats.length === 0) return undefined;
  return line(
    text` · nondeterminism caveat: `,
    data(caveats.map((c) => c.selector ?? c.regionId).join(', ')),
    text` is an unstable captured region`,
  );
}

function roleString(role: unknown): string {
  return role === null || role === undefined ? '(none)' : String(role);
}

function identityParts(node: AxNodeRecord): FactLine[] {
  const parts: FactLine[] = [text`role=`, data(roleString(node.role))];
  if (node.axName !== undefined) parts.push(line(text` name=`, data(node.axName)));
  parts.push(line(text` backend-node-id=`, data(node.backendNodeId === undefined ? '(unresolved)' : node.backendNodeId)));
  return parts;
}

function rectParts(node: AxNodeRecord): FactLine[] {
  const rect = toRect(node.rect);
  if (rect) return [line(text` rect `, formatCoordinate(rect))];
  if (node.rectUnavailable) return [fact` rect unavailable (${node.rectUnavailableReason ?? 'unreported reason'})`];
  return [text` rect not captured`];
}

function statesParts(node: AxNodeRecord): FactLine[] {
  const entries = Object.entries(node.states ?? {});
  if (entries.length === 0) return [];
  return [line(text` states `, data(entries.map(([k, v]) => `${k}=${String(v)}`).join(',')))];
}

function nodeLine(node: AxNodeRecord, caveats: readonly UnstableCaveat[]): FactLine {
  const parts: FactLine[] = [fact`ax node ${node.id}: `, ...identityParts(node), ...rectParts(node), ...statesParts(node)];
  const caveat = caveatSuffix(caveats);
  if (caveat) parts.push(caveat);
  return line(...parts);
}

function ignoredLine(node: AxNodeRecord, caveats: readonly UnstableCaveat[]): FactLine {
  const reasons = node.ignoredReasons.length ? node.ignoredReasons.join(',') : '(none recorded)';
  const parts: FactLine[] = [
    fact`ignored ax node ${node.id}: `,
    text`role=`, data(roleString(node.role)),
    line(text` ignored-reasons=`, data(reasons)),
  ];
  if (node.backendNodeId !== undefined) parts.push(line(text` backend-node-id=`, data(node.backendNodeId)));
  const caveat = caveatSuffix(caveats);
  if (caveat) parts.push(caveat);
  return line(...parts);
}

function unmappedBoxLine(element: GeometryElement, caveats: readonly UnstableCaveat[]): FactLine {
  const parts: FactLine[] = [
    text`unmapped box: selector=`, data(element.selector ?? element.id ?? '(unidentified element)'),
    line(text` backend-node-id=`, data(element.backendNodeId ?? '(unresolved)')),
  ];
  const rect = toRect(element.rect);
  if (rect) parts.push(line(text` rect `, formatCoordinate(rect)));
  const caveat = caveatSuffix(caveats);
  if (caveat) parts.push(caveat);
  return line(...parts);
}

function placementLine(node: AxNodeRecord, placement: RectPlacement, caveats: readonly UnstableCaveat[]): FactLine {
  const parts: FactLine[] = [fact`ax node ${node.id} rect ${placement}: `, ...identityParts(node), ...rectParts(node)];
  const caveat = caveatSuffix(caveats);
  if (caveat) parts.push(caveat);
  return line(...parts);
}

function attestationFor(ref: SnapRef, meta: SnapMeta): RenderableResult['attestation'] {
  return {
    kind: 'snapshot',
    id: ref.id,
    path: ref.dir,
    note: meta.settled === false
      ? text`Snapshot was captured with unsettled regions; only facts intersecting those regions carry nondeterminism caveats.`
      : text`Snapshot was settled before its AX facts were captured.`,
  };
}

function unavailableResult(ref: SnapRef, meta: SnapMeta, detail: string): RenderableResult {
  return {
    tag: 'ax-map',
    attestation: attestationFor(ref, meta),
    attrs: { available: false, settled: meta.settled ?? false },
    summary: fact`AX facts are unavailable for this snapshot: ${detail}. No AX↔layout map can be computed — this is a collection gap, not an empty accessibility tree.`,
    followUp: fact`Re-capture the substrate with \`capture measure snap <url>\`, then run \`capture measure map ax <snap>\`.`,
  };
}

/** Builds the read-only `measure map ax` report from an existing snapshot. */
export function buildMeasureMapAxResult(ref: SnapRef): RenderableResult {
  const meta = readMeta<SnapMeta>(ref);

  let report: AxReport;
  try {
    report = readAx<AxReport>(ref);
  } catch (err) {
    if (err instanceof ArtifactResolutionError) return unavailableResult(ref, meta, err.message);
    throw err;
  }
  if (report.available === false) {
    return unavailableResult(ref, meta, `the ax collector reported available:false (${report.unavailableReason ?? 'no reason recorded'})`);
  }

  const regions = unstableRegionsFor(ref);
  const geometry = readGeometry<{ elements?: readonly GeometryElement[] }>(ref);
  const geometryByBackendNodeId = new Map<number, GeometryElement>();
  let identityUnresolvedCount = 0;
  for (const element of geometry.elements ?? []) {
    if (typeof element.backendNodeId === 'number') geometryByBackendNodeId.set(element.backendNodeId, element);
    else identityUnresolvedCount++;
  }

  const nodes = report.nodes ?? [];
  const nonIgnored = nodes.filter((n) => !n.ignored);
  const ignored = nodes.filter((n) => n.ignored);

  const elementIdFor = (node: AxNodeRecord): string | undefined => {
    if (typeof node.backendNodeId !== 'number') return undefined;
    return geometryByBackendNodeId.get(node.backendNodeId)?.id ?? String(node.backendNodeId);
  };
  const annotateNodes = (items: readonly AxNodeRecord[]) => annotateUnstableFacts(
    items.map((node) => ({ elementId: elementIdFor(node), rect: toRect(node.rect) })),
    regions,
  );
  const annotatedNonIgnored = annotateNodes(nonIgnored);
  const annotatedIgnored = annotateNodes(ignored);

  const mappedBackendNodeIds = new Set<number>();
  for (const node of nonIgnored) {
    if (typeof node.backendNodeId === 'number') mappedBackendNodeIds.add(node.backendNodeId);
  }
  const unmappedBoxes = (geometry.elements ?? []).filter((element) => {
    if (typeof element.backendNodeId !== 'number') return false;
    if (mappedBackendNodeIds.has(element.backendNodeId)) return false;
    const rect = element.rect;
    return element.visibility?.visible !== false && !!rect && rect.width > 0 && rect.height > 0;
  });
  const annotatedUnmapped = annotateUnstableFacts(
    unmappedBoxes.map((element) => ({ elementId: element.id, rect: toRect(element.rect) })),
    regions,
  );

  const viewport = parseViewport(meta.viewport);
  const placed: Array<{ node: AxNodeRecord; placement: RectPlacement; caveats: readonly UnstableCaveat[] }> = [];
  annotatedNonIgnored.forEach((entry, index) => {
    const node = nonIgnored[index]!;
    const rect = toRect(node.rect);
    if (!rect) return;
    const placement = classifyRect(rect, viewport);
    if (placement) placed.push({ node, placement, caveats: entry.caveats });
  });

  const sections: FactLine[] = [];
  sections.push(text`AX coverage scope: top-document (iframe AX nodes are outside Accessibility.getFullAXTree's scope).`);
  if (report.truncated) sections.push(fact`AX tree recording cap reached: ${report.truncated} node(s) beyond the cap are not in ax.json.`);
  if (report.rectLookupsTruncated) sections.push(fact`Rect lookup cap reached: ${report.rectLookupsTruncated} eligible node(s) have no rect because the lookup was skipped, not because they are unrendered.`);
  if (!viewport) sections.push(text`Offscreen/clipped classification is unavailable: the snapshot records no parseable viewport size. Zero-size rects are still classified.`);
  if (identityUnresolvedCount > 0) sections.push(fact`${identityUnresolvedCount} geometry element(s) carry no resolved backendNodeId and could not be checked for AX coverage.`);
  if (annotatedNonIgnored.length) sections.push(lineList(annotatedNonIgnored.map((entry, index) => nodeLine(nonIgnored[index]!, entry.caveats))));
  if (annotatedIgnored.length) sections.push(lineList(annotatedIgnored.map((entry, index) => ignoredLine(ignored[index]!, entry.caveats))));
  if (annotatedUnmapped.length) sections.push(lineList(annotatedUnmapped.map((entry, index) => unmappedBoxLine(unmappedBoxes[index]!, entry.caveats))));
  if (placed.length) sections.push(lineList(placed.map(({ node, placement, caveats }) => placementLine(node, placement, caveats))));

  return {
    tag: 'ax-map',
    attestation: attestationFor(ref, meta),
    attrs: {
      nodes: nonIgnored.length,
      ignored: ignored.length,
      'unmapped-boxes': unmappedBoxes.length,
      settled: meta.settled ?? false,
    },
    summary: fact`AX↔layout facts: ${nonIgnored.length} non-ignored AX node(s), ${ignored.length} ignored AX node(s), ${unmappedBoxes.length} DOM element(s) with rendered boxes but no non-ignored AX node, and ${placed.length} AX node(s) with offscreen, clipped, or zero-size rects.`,
    sections,
    followUp: fact`Read another snapshot map with \`capture measure map focus ${ref.id}\` or \`capture measure map layers ${ref.id}\`.`,
  };
}
