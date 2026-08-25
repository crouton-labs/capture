import { type ParsedArgs } from '../../types.js';
import { ArtifactResolutionError, readGeometry, readLayers, readMeta, readStates, resolveSnapRef, type SnapRef } from '../../../output/artifact.js';
import { resolveSelectorInput, type ElementRecord } from '../../../output/selector.js';
import { deriveInkBox, type InkRect } from '../../measure/ink.js';
import { baseInkSource, forcedStateInkSource, isInkSource } from '../../measure/ink-source.js';
import { emitResult, fact, line, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';

const USAGE = `capture measure map paint <snap> --selector <target> [--state <name>] — recorded AABB coverage by elements painted above one target

input:
  <snap>              snapshot id in the active session or absolute artifact path (required)
  --selector <target> recorded element selector or backend:<id> (required)
  --state <name>      one forced state recorded in states.json; uses that target's post-force border box and computed paint styles
output: <paint-map …> — target border and ink boxes; visible non-subtree elements after the target in DOMSnapshot back-to-front paint order; each AABB intersection area and fraction of each target box; --json mirrors
limits: DOMSnapshot order ranks painted layout nodes, not pixel fragments. Coverage is axis-aligned border/ink-box intersection over recorded geometry, not a pixel-exact paint test.
effects: read-only — reads geometry.json, layers.json, and (with --state) states.json from an existing snapshot; never drives a browser or writes an artifact`;

interface GeometryElement extends ElementRecord {
  readonly tag?: string;
  readonly domPath?: string;
  readonly frame?: { readonly frameId?: string };
  readonly boxModel?: Record<string, unknown> | null;
  readonly paint?: Record<string, string | null>;
  readonly zIndex?: string;
  readonly visibility?: { readonly visible?: boolean; readonly opacity?: number };
}

interface PaintOrderReport {
  readonly paintOrder?: { readonly available?: boolean; readonly reason?: string; readonly backendNodeIds?: readonly number[]; readonly truncated?: number };
}

interface SourceBox {
  readonly border: InkRect;
  readonly ink: InkRect | null;
  readonly provenance: string;
  readonly inkUnavailable?: string;
}

interface Intersection {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly area: number;
}

interface Occluder {
  readonly element: GeometryElement;
  readonly rank: number;
  readonly border: Intersection;
  readonly ink: Intersection | null;
}

interface CoverageUnavailable {
  readonly element: GeometryElement;
  readonly rank: number;
  readonly reason: string;
}

function area(rect: InkRect): number {
  return rect.width * rect.height;
}

function intersection(a: InkRect, b: InkRect): Intersection | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height, area: width * height };
}

function relatedInTree(a: GeometryElement, b: GeometryElement): boolean {
  if (!a.domPath || !b.domPath) return false;
  if (a.frame?.frameId !== b.frame?.frameId) return false;
  return a.domPath.startsWith(`${b.domPath}/`) || b.domPath.startsWith(`${a.domPath}/`);
}

function paints(element: GeometryElement): boolean {
  return element.visibility?.visible === true && typeof element.visibility.opacity === 'number' && element.visibility.opacity > 0;
}

function formatBox(box: InkRect): string {
  return `x=${box.x}…${box.x + box.width} y=${box.y}…${box.y + box.height} (w=${box.width} h=${box.height} area=${area(box)}px²)`;
}

function formatIntersection(value: Intersection): string {
  return `x=${value.x}…${value.x + value.width} y=${value.y}…${value.y + value.height}; area=${value.area}px²`;
}

function percentage(covered: number, total: number): string {
  return total > 0 ? `${(covered / total * 100).toFixed(2)}%` : 'unavailable';
}

function targetBox(target: GeometryElement, state?: string, states?: unknown): SourceBox | { readonly unavailable: string } {
  const source = state === undefined
    ? baseInkSource(target)
    : forcedStateInkSource(states, target, state);
  if (!isInkSource(source)) return source;
  const ink = deriveInkBox(source.rect, source.styles);
  if (ink.inkBox) return { border: source.rect, ink: ink.inkBox, provenance: source.provenance };
  const inkUnavailable = ink.missingStyles.length
    ? `computed styles were not captured: ${ink.missingStyles.join(', ')}`
    : `paint extents could not be resolved: ${ink.unresolved.join(', ')}`;
  return { border: source.rect, ink: null, provenance: source.provenance, inkUnavailable };
}

function missingSelectorResult(ref: SnapRef, selector: string): RenderableResult {
  return {
    tag: 'error',
    attestation: { kind: 'snapshot', id: ref.id, path: ref.dir },
    attrs: { command: 'measure map paint', status: 'missing_selector', selector },
    summary: fact`No geometry record matched selector input ${selector}.`,
    followUp: text`Use a recorded selector or backend:<id> from geometry.json.`,
  };
}

export function buildMeasureMapPaintResult(ref: SnapRef, selector: string, state?: string): RenderableResult {
  const geometry = readGeometry<{ elements?: GeometryElement[] }>(ref).elements ?? [];
  const matches = resolveSelectorInput(geometry, selector) as GeometryElement[];
  if (!matches.length) return missingSelectorResult(ref, selector);

  const target = matches[0]!;
  const source = targetBox(target, state, state === undefined ? undefined : readStates(ref));
  const meta = readMeta<{ settled?: boolean }>(ref);
  const targetName = target.selector ?? target.id;
  if ('unavailable' in source) {
    return {
      tag: 'paint-map',
      attestation: { kind: 'snapshot', id: ref.id, path: ref.dir, note: meta.settled === false ? text`Snapshot was captured unsettled.` : text`Snapshot was settled before its geometry was captured.` },
      attrs: { selector: targetName, matches: matches.length, state: state ?? 'base', status: 'ink_source_unavailable' },
      summary: fact`Paint coverage could not use the target's ${state === undefined ? 'base-state' : `forced ${state} state`} border and ink source: ${source.unavailable}.`,
      followUp: text`Reacquire the snapshot with the target's border box and required paint styles recorded.`,
    };
  }

  const report = readLayers<PaintOrderReport>(ref);
  const paintOrder = report.paintOrder;
  const ids = paintOrder?.backendNodeIds ?? [];
  const rankByBackend = new Map<number, number>();
  ids.forEach((id, index) => rankByBackend.set(id, index));
  const targetRank = typeof target.backendNodeId === 'number' ? rankByBackend.get(target.backendNodeId) : undefined;
  const orderUnavailable = !paintOrder?.available
    ? `DOMSnapshot paint order was unavailable${paintOrder?.reason ? `: ${paintOrder.reason}` : ''}`
    : paintOrder.truncated && paintOrder.truncated > 0
      ? `DOMSnapshot paint order omitted ${paintOrder.truncated} backend node id(s) at the collector cap`
      : targetRank === undefined
        ? `the target's backend node id was not present in recorded DOMSnapshot paint order`
        : undefined;
  if (orderUnavailable) {
    return {
      tag: 'paint-map',
      attestation: { kind: 'snapshot', id: ref.id, path: ref.dir, note: meta.settled === false ? text`Snapshot was captured unsettled.` : text`Snapshot was settled before its geometry was captured.` },
      attrs: { selector: targetName, matches: matches.length, state: state ?? 'base', status: 'paint_order_unavailable' },
      summary: fact`Paint coverage is unavailable because ${orderUnavailable}.`,
      sections: [
        fact`Target border box from ${source.provenance}: ${formatBox(source.border)}.`,
        source.ink ? fact`Target ink box: ${formatBox(source.ink)}.` : fact`Target ink box was unavailable because ${source.inkUnavailable}.`,
        text`Criterion: DOMSnapshot backend-node paint order is required as the back-to-front stacking-order source; no z-index fallback is inferred.`,
      ],
      followUp: text`Reacquire a snapshot whose layers collector records DOMSnapshot paint order.`,
    };
  }

  const occluders: Occluder[] = [];
  const coverageUnavailable: CoverageUnavailable[] = [];
  for (const candidate of geometry) {
    if (candidate.id === target.id || typeof candidate.backendNodeId !== 'number' || !paints(candidate) || relatedInTree(candidate, target)) continue;
    const rank = rankByBackend.get(candidate.backendNodeId);
    if (rank === undefined || rank <= targetRank) continue;
    const candidateBox = baseInkSource(candidate);
    if (!isInkSource(candidateBox)) {
      coverageUnavailable.push({ element: candidate, rank, reason: candidateBox.unavailable });
      continue;
    }
    const border = intersection(source.border, candidateBox.rect);
    if (!border) continue;
    const ink = source.ink ? intersection(source.ink, candidateBox.rect) : null;
    occluders.push({ element: candidate, rank, border, ink });
  }
  occluders.sort((a, b) => a.rank - b.rank || a.element.id.localeCompare(b.element.id));
  coverageUnavailable.sort((a, b) => a.rank - b.rank || a.element.id.localeCompare(b.element.id));

  const sections: FactLine[] = [
    fact`Target ${targetName}${matches.length > 1 ? ` matched ${matches.length} geometry records; this report uses the first in snapshot order` : ''}.`,
    fact`Target border box from ${source.provenance}: ${formatBox(source.border)}.`,
    source.ink
      ? fact`Target ink box from ${source.provenance}: ${formatBox(source.ink)}.`
      : fact`Target ink box was unavailable because ${source.inkUnavailable}.`,
    text`Paint-order criterion: DOMSnapshot backend-node paint order is ascending back-to-front. Eligible occluders have a recorded rank after the target, visible=true, opacity>0, and are outside the target's DOM subtree and ancestor chain. Coverage is AABB intersection over recorded border/ink geometry, not a pixel-exact paint test.`,
  ];
  if (coverageUnavailable.length) {
    sections.push(lineList(coverageUnavailable.map((candidate, index) => {
      const name = candidate.element.selector ?? candidate.element.id;
      return fact`Coverage unavailable ${index + 1}. ${name}: DOMSnapshot paint rank ${candidate.rank}; ${candidate.reason}.`;
    })));
  }
  if (!occluders.length) {
    sections.push(coverageUnavailable.length
      ? text`No measured AABB intersection was available among candidates with captured border boxes; the occluder set is not exhaustive because coverage is unavailable for the recorded candidate(s) above.`
      : text`No eligible recorded elements painted above the target intersect either target box; the occluder set is empty.`);
  } else {
    const borderArea = area(source.border);
    const inkArea = source.ink ? area(source.ink) : 0;
    sections.push(lineList(occluders.map((occluder, index) => {
      const name = occluder.element.selector ?? occluder.element.id;
      const inkCoverage = source.ink
        ? occluder.ink
          ? `; ink-box intersection ${formatIntersection(occluder.ink)} (${percentage(occluder.ink.area, inkArea)} of target ink box)`
          : `; ink-box intersection none (0.00% of target ink box)`
        : `; ink-box coverage unavailable because the target ink box was unavailable`;
      return fact`${index + 1}. ${name}: DOMSnapshot paint rank ${occluder.rank} (target rank ${targetRank}); z-index=${occluder.element.zIndex ?? 'not recorded'}; border-box intersection ${formatIntersection(occluder.border)} (${percentage(occluder.border.area, borderArea)} of target border box)${inkCoverage}.`;
    })));
  }

  return {
    tag: 'paint-map',
    attestation: { kind: 'snapshot', id: ref.id, path: ref.dir, note: meta.settled === false ? text`Snapshot was captured unsettled.` : text`Snapshot was settled before its geometry was captured.` },
    attrs: { selector: targetName, matches: matches.length, state: state ?? 'base', occluders: occluders.length, 'coverage-unavailable': coverageUnavailable.length, 'paint-order': 'domsnapshot-back-to-front', settled: meta.settled ?? 'unknown' },
    summary: fact`Recorded elements painting above ${targetName} are measured against both its border box and its derived ink box.`,
    sections,
    followUp: text`Use capture measure explain <snap> --selector <selector> for the target's captured stacking and clipping provenance.`,
  };
}

function invalidInput(message: FactLine): RenderableResult {
  return {
    tag: 'error',
    attrs: { command: 'measure map paint', status: 'invalid_input' },
    summary: message,
    followUp: text`Run capture measure map paint <snap> --selector <target> [--state <name>].`,
  };
}

export async function cmdMeasureMapPaint(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (parsed.positional.length !== 1) {
    emitResult(invalidInput(fact`Expected exactly one snapshot target; received ${parsed.positional.length}.`), { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (!parsed.selector?.trim()) {
    emitResult(invalidInput(text`The --selector flag is required.`), { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if ((parsed.state?.length ?? 0) > 1) {
    emitResult(invalidInput(fact`Expected at most one --state value; received ${parsed.state!.length}.`), { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  try {
    const ref = await resolveSnapRef(parsed.positional[0]!);
    const result = buildMeasureMapPaintResult(ref, parsed.selector, parsed.state?.[0]);
    emitResult(result, { json: parsed.json });
    if (result.tag === 'error' || result.attrs?.status === 'ink_source_unavailable' || result.attrs?.status === 'paint_order_unavailable') process.exitCode = 1;
  } catch (error) {
    const detail = error instanceof ArtifactResolutionError || error instanceof Error ? error.message : String(error);
    emitResult({
      tag: 'error',
      attrs: { command: 'measure map paint', status: 'artifact_unavailable' },
      summary: fact`Paint-map facts could not be read: ${detail}`,
      followUp: text`Pass a snapshot id or absolute artifact path created by capture measure snap.`,
    }, { json: parsed.json });
    process.exitCode = 1;
  }
}
