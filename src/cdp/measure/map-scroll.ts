import {
  readGeometry,
  readMeta,
  readScroll,
  unstableRegionsFor,
  annotateUnstableFacts,
  type Rect,
  type SnapRef,
  type UnstableCaveat,
  type UnstableRegion,
} from '../../output/artifact.js';
import { data, fact, line, lineList, text, type FactLine, type RenderableResult } from '../../output/render.js';

interface RectLike {
  readonly x?: unknown;
  readonly y?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly w?: unknown;
  readonly h?: unknown;
}

interface ScrollChild {
  readonly id?: unknown;
  readonly backendNodeId?: unknown;
  readonly selector?: unknown;
  readonly position?: unknown;
  readonly scrollSnapAlign?: unknown;
  readonly rect?: RectLike | null;
  readonly nestedAncestryUnavailable?: unknown;
}

interface ScrollSample {
  readonly offsetTop?: unknown;
  readonly visibleChildren?: readonly ScrollChild[];
  readonly visibleChildrenTruncated?: unknown;
}

interface ScrollContainer extends ScrollChild {
  readonly isRoot?: unknown;
  readonly scrollWidth?: unknown;
  readonly scrollHeight?: unknown;
  readonly clientWidth?: unknown;
  readonly clientHeight?: unknown;
  readonly scrollTop?: unknown;
  readonly scrollLeft?: unknown;
  readonly maxScrollTop?: unknown;
  readonly maxScrollLeft?: unknown;
  readonly overflowX?: unknown;
  readonly overflowY?: unknown;
  readonly scrollbarGutter?: unknown;
  readonly scrollSnapType?: unknown;
  readonly snapDescendants?: readonly ScrollChild[];
  readonly snapDescendantsTruncated?: unknown;
  readonly stickyFixedDescendants?: readonly ScrollChild[];
  readonly stickyFixedDescendantsTruncated?: unknown;
  readonly samples?: readonly ScrollSample[];
  readonly nestedAncestry?: readonly unknown[];
}

interface ScrollArtifact {
  readonly available?: unknown;
  readonly reason?: unknown;
  readonly containers?: readonly ScrollContainer[];
  readonly scrollContainersTotal?: unknown;
  readonly scrollContainersTruncated?: unknown;
  readonly scrollContainersCountUnavailable?: unknown;
  readonly documentScrollHeight?: unknown;
  readonly documentScrollWidth?: unknown;
  readonly visualViewport?: unknown;
  readonly visualViewportUnavailable?: unknown;
  readonly layoutViewport?: unknown;
  readonly layoutViewportUnavailable?: unknown;
  readonly scope?: { readonly root?: unknown; readonly shadowDom?: unknown; readonly iframesPresent?: unknown; readonly shadowHostsPresent?: unknown };
  readonly scopeCountsUnavailable?: unknown;
}

interface SnapMeta {
  readonly settled?: unknown;
  readonly viewport?: unknown;
}

interface GeometryElement {
  readonly id?: unknown;
  readonly backendNodeId?: unknown;
  readonly rect?: RectLike | null;
}

interface CaveatContext {
  readonly regions: readonly UnstableRegion[];
  readonly geometryByBackendNodeId: ReadonlyMap<number, { readonly id?: string; readonly rect?: Rect }>;
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberText(value: unknown): FactLine {
  const n = numeric(value);
  return n === undefined ? text`unavailable` : data(n);
}

function string(value: unknown, fallback = '(unavailable)'): string {
  return typeof value === 'string' ? value : fallback;
}

function rect(value: RectLike | null | undefined): Rect | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const x = numeric(value.x);
  const y = numeric(value.y);
  const w = numeric(value.w ?? value.width);
  const h = numeric(value.h ?? value.height);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h };
}

function formatRect(value: RectLike | null | undefined): FactLine {
  const measured = rect(value);
  return measured
    ? fact`x=${measured.x} y=${measured.y} w=${measured.w} h=${measured.h}`
    : text`rect unavailable`;
}

function formatDimension(width: unknown, height: unknown): FactLine {
  return line(numberText(width), text`×`, numberText(height));
}

function viewportFacts(label: string, value: unknown, unavailable: unknown): FactLine {
  if (unavailable === true) return fact`${label}: viewport metrics unavailable in Page.getLayoutMetrics.`;
  if (!value || typeof value !== 'object') return fact`${label}: unavailable`;
  const viewport = value as Record<string, unknown>;
  return line(
    data(label),
    text`: client `,
    formatDimension(viewport.clientWidth, viewport.clientHeight),
    text` at page x=`,
    numberText(viewport.pageX),
    text` y=`,
    numberText(viewport.pageY),
    text` scale=`,
    numberText(viewport.scale),
  );
}

function backendNodeId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function explicitElementId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Keeps only producer-supplied region identities. Settle's descriptive
 * `tag#id.classes` labels cannot safely be reconciled with geometry paths:
 * ids may contain punctuation and geometry intentionally caps class lists.
 * A selector-only legacy region therefore remains unjoined rather than
 * attributing its caveat to a potentially different measured element.
 */
function resolveRegions(regions: readonly UnstableRegion[]): readonly UnstableRegion[] {
  return regions;
}

function uniqueCaveats(caveats: readonly UnstableCaveat[]): UnstableCaveat[] {
  const seen = new Set<string>();
  return caveats.filter((caveat) => {
    const key = `${caveat.regionId}\u0000${caveat.selector ?? ''}\u0000${caveat.reason ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function caveatsFor(target: ScrollChild, context: CaveatContext): readonly UnstableCaveat[] {
  const backend = backendNodeId(target.backendNodeId);
  const geometry = backend === undefined ? undefined : context.geometryByBackendNodeId.get(backend);
  const ownRect = rect(target.rect) ?? geometry?.rect;
  const elementIds = [
    explicitElementId(target.id),
    geometry?.id,
    backend === undefined ? undefined : String(backend),
  ].filter((id): id is string => id !== undefined);

  const facts = elementIds.length
    ? elementIds.map((elementId) => ({ elementId, rect: ownRect }))
    : [{ rect: ownRect }];
  return uniqueCaveats(annotateUnstableFacts(facts, context.regions).flatMap((entry) => entry.caveats));
}

function caveatLines(caveats: readonly UnstableCaveat[]): FactLine[] {
  return caveats.map((caveat) => fact`   nondeterminism caveat: unstable region ${caveat.regionId}${caveat.selector ? ` (${caveat.selector})` : ''}${caveat.reason ? ` — ${caveat.reason}` : ''}`);
}

function availabilityLines(label: string, children: readonly ScrollChild[] | undefined, truncated: unknown, context: CaveatContext): FactLine[] {
  if (children === undefined) return [fact`   ${label} facts unavailable in scroll.json.`];
  if (children.length === 0) {
    const none = label === 'snap point' ? 'none recorded' : 'none recorded';
    return [fact`   ${label}: ${none}.`];
  }

  const rows: FactLine[] = [];
  for (const child of children) {
    const detail = child.position ?? child.scrollSnapAlign ?? '(unavailable)';
    rows.push(line(text`   `, data(label), text` `, data(string(child.selector)), text` — `, data(string(detail)), text` · `, formatRect(child.rect)));
    rows.push(...caveatLines(caveatsFor(child, context)));
  }
  if (truncated === true) rows.push(fact`   ${label} enumeration reached its capture cap.`);
  return rows;
}

function sampleLines(samples: readonly ScrollSample[] | undefined, context: CaveatContext): FactLine[] {
  if (samples === undefined) return [text`   reachable-content samples unavailable in scroll.json.`];
  if (samples.length === 0) return [text`   reachable-content samples: none recorded.`];

  const rows: FactLine[] = [];
  for (const sample of samples) {
    rows.push(line(text`   sample offset y=`, numberText(sample.offsetTop), text`: `));
    const children = sample.visibleChildren;
    if (children === undefined) {
      rows.push(text`      visible children unavailable in scroll.json.`);
    } else if (children.length === 0) {
      rows.push(text`      no visible child records at this sampled offset.`);
    } else {
      for (const child of children) {
        rows.push(line(text`      visible child `, data(string(child.selector)), text` · `, formatRect(child.rect)));
        rows.push(...caveatLines(caveatsFor(child, context)).map((caveat) => line(text`   `, caveat)));
      }
    }
    if (sample.visibleChildrenTruncated === true) rows.push(text`      visible-child enumeration reached its capture cap.`);
  }
  return rows;
}

function scopeCount(value: unknown, unavailable: unknown, topologyAvailable: boolean): FactLine {
  return !topologyAvailable || unavailable === true || numeric(value) === undefined ? text`unavailable` : numberText(value);
}

function buildCaveatContext(ref: SnapRef): CaveatContext {
  const geometry = readGeometry<{ elements?: readonly GeometryElement[] }>(ref);
  const elements = geometry.elements ?? [];
  const regions = resolveRegions(unstableRegionsFor(ref));
  const geometryByBackendNodeId = new Map<number, { id?: string; rect?: Rect }>();
  for (const element of elements) {
    const backend = backendNodeId(element.backendNodeId);
    if (backend !== undefined) geometryByBackendNodeId.set(backend, { id: explicitElementId(element.id), rect: rect(element.rect) });
  }
  return { regions, geometryByBackendNodeId };
}

/** Builds the read-only scroll topology report for a resolved snapshot. */
export function measureMapScroll(ref: SnapRef): RenderableResult {
  const scroll = readScroll<ScrollArtifact>(ref);
  const meta = readMeta<SnapMeta>(ref);
  const topologyAvailable = scroll.available !== false;
  const containersAvailable = topologyAvailable && Array.isArray(scroll.containers);
  const containers = containersAvailable ? scroll.containers : [];
  const caveatContext = buildCaveatContext(ref);

  const sections: FactLine[] = [];
  if (scroll.available === false) {
    sections.push(fact`scroll.json reports that topology collection was unavailable: ${string(scroll.reason)}.`);
  }

  for (const container of containers) {
    const selector = container.isRoot === true ? '(document)' : string(container.selector);
    const ancestry = container.nestedAncestryUnavailable === true
      ? 'unavailable'
      : container.nestedAncestry === undefined
        ? 'unavailable'
        : container.nestedAncestry.map((item) => string(item)).join(' → ') || '(top-level)';
    const containerCaveats = caveatsFor(container, caveatContext);
    const rows: FactLine[] = [
      line(fact`${selector} — `, formatRect(container.rect), text` · range `, formatDimension(container.scrollWidth, container.scrollHeight), text` · client `, formatDimension(container.clientWidth, container.clientHeight)),
      ...caveatLines(containerCaveats),
      line(text`   offsets current x=`, numberText(container.scrollLeft), text` y=`, numberText(container.scrollTop), text`; max x=`, numberText(container.maxScrollLeft), text` y=`, numberText(container.maxScrollTop), fact` · overflow ${string(container.overflowX)}/${string(container.overflowY)} · gutter ${string(container.scrollbarGutter)} · snap type ${string(container.scrollSnapType)}`),
      fact`   nested ancestry: ${ancestry}`,
      ...availabilityLines('sticky/fixed', container.stickyFixedDescendants, container.stickyFixedDescendantsTruncated, caveatContext),
      ...availabilityLines('snap point', container.snapDescendants, container.snapDescendantsTruncated, caveatContext),
      ...sampleLines(container.samples, caveatContext),
      ...(container.nestedAncestryUnavailable === true ? [text`   nested-ancestry measurement unavailable for this container.`] : []),
    ];
    sections.push(lineList(rows));
  }

  const settled = meta.settled === true;
  const totalAvailable = topologyAvailable && scroll.scrollContainersCountUnavailable !== true && numeric(scroll.scrollContainersTotal) !== undefined;
  const measuredCount = totalAvailable ? numberText(scroll.scrollContainersTotal) : text`unavailable`;
  const recordedCount = containersAvailable ? data(containers.length) : text`unavailable`;
  const documentWidth = topologyAvailable ? scroll.documentScrollWidth : undefined;
  const documentHeight = topologyAvailable ? scroll.documentScrollHeight : undefined;
  return {
    tag: 'scroll-map',
    attestation: {
      kind: 'snapshot',
      id: ref.id,
      path: ref.dir,
      note: settled ? text`Snapshot settled before topology collection.` : text`Snapshot was captured without settledness; facts intersecting marked unstable regions carry nondeterminism caveats.`,
    },
    attrs: {
      containers: containersAvailable ? containers.length : undefined,
      'scroll-containers': totalAvailable ? numeric(scroll.scrollContainersTotal) : undefined,
      settled,
      viewport: typeof meta.viewport === 'string' ? meta.viewport : undefined,
    },
    summary: line(measuredCount, text` measured scroll container(s) (`, recordedCount, text` recorded); document extent `, formatDimension(documentWidth, documentHeight), text`.`),
    sections: [
      viewportFacts('visual viewport', scroll.visualViewport, scroll.visualViewportUnavailable),
      viewportFacts('layout viewport', scroll.layoutViewport, scroll.layoutViewportUnavailable),
      line(text`scope: root `, data(string(scroll.scope?.root)), text`; shadow DOM `, data(string(scroll.scope?.shadowDom)), text`; iframes `, scopeCount(scroll.scope?.iframesPresent, scroll.scopeCountsUnavailable, topologyAvailable), text`; shadow hosts `, scopeCount(scroll.scope?.shadowHostsPresent, scroll.scopeCountsUnavailable, topologyAvailable), text`.`),
      ...(!containersAvailable ? [text`Scroll container records were unavailable in scroll.json; no container rows are rendered below.`] : []),
      ...(!totalAvailable && containersAvailable ? [text`Scroll-container total/truncation counts were unavailable in scroll.json; recorded container rows are still rendered below.`] : []),
      ...(scroll.scrollContainersTruncated === true ? [text`Scroll-container enumeration reached its capture cap; recorded containers are a prefix of the measured topology.`] : []),
      ...sections,
    ],
    followUp: line(fact`Read focus or layer facts from ${ref.id} with `, text`\`capture measure map focus `, data(ref.id), text`\` or \`capture measure map layers `, data(ref.id), text`\`.`),
  };
}
