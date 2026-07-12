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
 * A missing, failed, or malformed consumed artifact (or an explicit
 * `available:false` collector report) renders the I-5 unavailability fact —
 * never an empty tree. No score, coverage grade, or gate (I-8). Captured AX
 * names and other browser evidence are preserved; page-derived strings cross
 * the renderer's structural escaping/control-neutralization boundary (I-9).
 */
import type { AxNodeRecord, AxRectUnavailableReason } from './collectors/ax.js';
import {
  annotateUnstableFacts,
  ArtifactResolutionError,
  readAx,
  readGeometry,
  readMeta,
  type Rect,
  type SnapRef,
  type UnstableCaveat,
  type UnstableRegion,
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

type ValidatedAxNode = Omit<AxNodeRecord, 'rectUnavailable' | 'rectUnavailableReason'> & (
  | { readonly rectUnavailable?: never; readonly rectUnavailableReason?: never }
  | { readonly rectUnavailable: true; readonly rectUnavailableReason: AxRectUnavailableReason }
);

interface ValidatedMeta {
  readonly settled: boolean;
  readonly viewport: string | null;
}

interface GeometryElement {
  readonly id: string;
  readonly selector?: string;
  readonly backendNodeId: number | null;
  readonly identityUnresolved?: true;
  readonly rect: CollectorRect;
  readonly visibility: { readonly visible: boolean };
}

interface ValidatedAxReportBase {
  readonly nodes: readonly ValidatedAxNode[];
  readonly truncated?: number;
  readonly rectLookupsTruncated?: number;
  readonly coverage: { readonly scope: 'top-document' };
}

type ValidatedAxReport = ValidatedAxReportBase & (
  | { readonly available: true; readonly unavailableReason?: never }
  | { readonly available: false; readonly unavailableReason: string }
);

interface ValidatedGeometryBase {
  readonly elements: readonly GeometryElement[];
  readonly elementsTruncated: number;
  readonly elementsTruncatedUnknown?: true;
  readonly unstableRegions?: readonly UnstableRegion[];
}

type ValidatedGeometry = ValidatedGeometryBase & (
  | { readonly available: true; readonly unavailableReason?: never }
  | { readonly available: false; readonly unavailableReason: string }
);

type RectPlacement = 'offscreen' | 'clipped' | 'zero-size';

class ArtifactShapeError extends Error {
  constructor(readonly location: string, expected: string) {
    super(`${location} ${expected}`);
    this.name = 'ArtifactShapeError';
  }
}

function fieldPath(parent: string, field: string): string {
  return parent.length === 0 ? field : `${parent}.${field}`;
}

function failShape(filename: string, field: string, expected: string): never {
  throw new ArtifactShapeError(`${filename}.${field}`, expected);
}

function expectRecord(value: unknown, filename: string, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    failShape(filename, field, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function required(record: Record<string, unknown>, key: string, filename: string, parent = ''): unknown {
  const field = fieldPath(parent, key);
  if (!Object.prototype.hasOwnProperty.call(record, key)) failShape(filename, field, 'is required');
  return record[key];
}

function expectBoolean(value: unknown, filename: string, field: string): boolean {
  if (typeof value !== 'boolean') failShape(filename, field, 'must be a boolean');
  return value;
}

function expectString(value: unknown, filename: string, field: string): string {
  if (typeof value !== 'string') failShape(filename, field, 'must be a string');
  return value;
}

function expectArray(value: unknown, filename: string, field: string): unknown[] {
  if (!Array.isArray(value)) failShape(filename, field, 'must be an array');
  return value;
}

function expectFiniteNumber(value: unknown, filename: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) failShape(filename, field, 'must be a finite number');
  return value;
}

function expectNonNegativeInteger(value: unknown, filename: string, field: string): number {
  const number = expectFiniteNumber(value, filename, field);
  if (!Number.isSafeInteger(number) || number < 0) failShape(filename, field, 'must be a nonnegative safe integer');
  return number;
}

function expectPositiveInteger(value: unknown, filename: string, field: string): number {
  const number = expectFiniteNumber(value, filename, field);
  if (!Number.isSafeInteger(number) || number <= 0) failShape(filename, field, 'must be a positive safe integer');
  return number;
}

function expectTrueIfPresent(record: Record<string, unknown>, key: string, filename: string, parent: string): true | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  if (record[key] !== true) failShape(filename, fieldPath(parent, key), 'must be true when present');
  return true;
}

function expectOptionalString(record: Record<string, unknown>, key: string, filename: string, parent: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  return expectString(record[key], filename, fieldPath(parent, key));
}

function validateRect(value: unknown, filename: string, field: string, dimensions: 'width-height' | 'w-h'): void {
  const rect = expectRecord(value, filename, field);
  expectFiniteNumber(required(rect, 'x', filename, field), filename, fieldPath(field, 'x'));
  expectFiniteNumber(required(rect, 'y', filename, field), filename, fieldPath(field, 'y'));
  const widthKey = dimensions === 'width-height' ? 'width' : 'w';
  const heightKey = dimensions === 'width-height' ? 'height' : 'h';
  const width = expectFiniteNumber(required(rect, widthKey, filename, field), filename, fieldPath(field, widthKey));
  const height = expectFiniteNumber(required(rect, heightKey, filename, field), filename, fieldPath(field, heightKey));
  if (width < 0) failShape(filename, fieldPath(field, widthKey), 'must be nonnegative');
  if (height < 0) failShape(filename, fieldPath(field, heightKey), 'must be nonnegative');
}

function validateMeta(value: unknown): ValidatedMeta {
  const filename = 'meta.json';
  const meta = expectRecord(value, filename, '$');
  const settled = expectBoolean(required(meta, 'settled', filename), filename, 'settled');
  const viewportValue = required(meta, 'viewport', filename);
  if (viewportValue !== null) {
    if (typeof viewportValue !== 'string') failShape(filename, 'viewport', 'must be a string or null');
    const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(viewportValue);
    if (
      !match
      || !Number.isSafeInteger(Number(match[1]))
      || !Number.isSafeInteger(Number(match[2]))
    ) {
      failShape(filename, 'viewport', 'must be null or an exact positive-safe <width>x<height> value');
    }
  }
  return { settled, viewport: viewportValue as string | null };
}

function validateAxNode(value: unknown, index: number): ValidatedAxNode {
  const filename = 'ax.json';
  const parent = `nodes[${index}]`;
  const node = expectRecord(value, filename, parent);
  expectString(required(node, 'id', filename, parent), filename, fieldPath(parent, 'id'));

  const role = required(node, 'role', filename, parent);
  if (
    role !== null
    && typeof role !== 'string'
    && typeof role !== 'boolean'
    && (typeof role !== 'number' || !Number.isFinite(role))
  ) {
    failShape(filename, fieldPath(parent, 'role'), 'must be a string, finite number, boolean, or null');
  }

  expectOptionalString(node, 'axName', filename, parent);
  expectBoolean(required(node, 'ignored', filename, parent), filename, fieldPath(parent, 'ignored'));

  const ignoredReasonsField = fieldPath(parent, 'ignoredReasons');
  const ignoredReasons = expectArray(required(node, 'ignoredReasons', filename, parent), filename, ignoredReasonsField);
  ignoredReasons.forEach((reason, reasonIndex) => expectString(reason, filename, `${ignoredReasonsField}[${reasonIndex}]`));

  if (Object.prototype.hasOwnProperty.call(node, 'backendNodeId')) {
    expectPositiveInteger(node.backendNodeId, filename, fieldPath(parent, 'backendNodeId'));
  }

  const statesField = fieldPath(parent, 'states');
  const states = expectRecord(required(node, 'states', filename, parent), filename, statesField);
  for (const [key, state] of Object.entries(states)) {
    if (
      state !== null
      && typeof state !== 'string'
      && typeof state !== 'boolean'
      && (typeof state !== 'number' || !Number.isFinite(state))
    ) {
      failShape(filename, `${statesField}[${JSON.stringify(key)}]`, 'must be a string, finite number, boolean, or null');
    }
  }

  const hasRect = Object.prototype.hasOwnProperty.call(node, 'rect');
  if (hasRect) validateRect(node.rect, filename, fieldPath(parent, 'rect'), 'width-height');

  const rectUnavailable = expectTrueIfPresent(node, 'rectUnavailable', filename, parent);
  const hasRectUnavailableReason = Object.prototype.hasOwnProperty.call(node, 'rectUnavailableReason');
  if (rectUnavailable) {
    if (hasRect) failShape(filename, fieldPath(parent, 'rect'), 'must be absent when rectUnavailable is true');
    const reason = expectString(required(node, 'rectUnavailableReason', filename, parent), filename, fieldPath(parent, 'rectUnavailableReason'));
    if (reason !== 'box-model-read-threw' && reason !== 'box-model-no-content') {
      failShape(filename, fieldPath(parent, 'rectUnavailableReason'), 'must name a supported rect-read failure');
    }
  } else if (hasRectUnavailableReason) {
    failShape(filename, fieldPath(parent, 'rectUnavailable'), 'must be true when rectUnavailableReason is present');
  }

  return node as unknown as ValidatedAxNode;
}

function validateAx(value: unknown): ValidatedAxReport {
  const filename = 'ax.json';
  const report = expectRecord(value, filename, '$');
  const nodes = expectArray(required(report, 'nodes', filename), filename, 'nodes').map(validateAxNode);
  const available = expectBoolean(required(report, 'available', filename), filename, 'available');

  const coverage = expectRecord(required(report, 'coverage', filename), filename, 'coverage');
  const scope = expectString(required(coverage, 'scope', filename, 'coverage'), filename, 'coverage.scope');
  if (scope !== 'top-document') failShape(filename, 'coverage.scope', 'must equal "top-document"');

  let truncated: number | undefined;
  if (Object.prototype.hasOwnProperty.call(report, 'truncated')) {
    truncated = expectPositiveInteger(report.truncated, filename, 'truncated');
  }
  let rectLookupsTruncated: number | undefined;
  if (Object.prototype.hasOwnProperty.call(report, 'rectLookupsTruncated')) {
    rectLookupsTruncated = expectPositiveInteger(report.rectLookupsTruncated, filename, 'rectLookupsTruncated');
  }

  const base: ValidatedAxReportBase = {
    nodes,
    coverage: { scope: 'top-document' },
    ...(truncated === undefined ? {} : { truncated }),
    ...(rectLookupsTruncated === undefined ? {} : { rectLookupsTruncated }),
  };
  if (!available) {
    if (nodes.length !== 0) failShape(filename, 'nodes', 'must be empty when available is false');
    if (truncated !== undefined) failShape(filename, 'truncated', 'must be absent when available is false');
    if (rectLookupsTruncated !== undefined) failShape(filename, 'rectLookupsTruncated', 'must be absent when available is false');
    const reason = expectString(required(report, 'unavailableReason', filename), filename, 'unavailableReason');
    if (reason !== 'axtree-unavailable' && reason !== 'axtree-returned-no-nodes') {
      failShape(filename, 'unavailableReason', 'must name a supported AX collection failure');
    }
    return { ...base, available: false, unavailableReason: reason };
  }
  if (Object.prototype.hasOwnProperty.call(report, 'unavailableReason')) {
    failShape(filename, 'unavailableReason', 'must be absent when available is true');
  }
  return { ...base, available: true };
}

function validateGeometryElement(value: unknown, index: number): GeometryElement {
  const filename = 'geometry.json';
  const parent = `elements[${index}]`;
  const element = expectRecord(value, filename, parent);
  expectString(required(element, 'id', filename, parent), filename, fieldPath(parent, 'id'));
  expectOptionalString(element, 'selector', filename, parent);

  const backendField = fieldPath(parent, 'backendNodeId');
  const backendNodeId = required(element, 'backendNodeId', filename, parent);
  const identityUnresolved = expectTrueIfPresent(element, 'identityUnresolved', filename, parent);
  if (backendNodeId === null) {
    if (identityUnresolved !== true) failShape(filename, fieldPath(parent, 'identityUnresolved'), 'must be true when backendNodeId is null');
  } else {
    expectPositiveInteger(backendNodeId, filename, backendField);
    if (identityUnresolved === true) failShape(filename, fieldPath(parent, 'identityUnresolved'), 'must be absent when backendNodeId is resolved');
  }

  validateRect(required(element, 'rect', filename, parent), filename, fieldPath(parent, 'rect'), 'width-height');
  const visibilityField = fieldPath(parent, 'visibility');
  const visibility = expectRecord(required(element, 'visibility', filename, parent), filename, visibilityField);
  expectBoolean(required(visibility, 'visible', filename, visibilityField), filename, fieldPath(visibilityField, 'visible'));

  return element as unknown as GeometryElement;
}

function validateUnstableRegion(value: unknown, index: number): UnstableRegion {
  const filename = 'geometry.json';
  const parent = `unstableRegions[${index}]`;
  const region = expectRecord(value, filename, parent);
  expectString(required(region, 'id', filename, parent), filename, fieldPath(parent, 'id'));
  expectOptionalString(region, 'selector', filename, parent);
  expectOptionalString(region, 'reason', filename, parent);
  if (Object.prototype.hasOwnProperty.call(region, 'rect')) {
    validateRect(region.rect, filename, fieldPath(parent, 'rect'), 'w-h');
  }
  if (Object.prototype.hasOwnProperty.call(region, 'elementIds')) {
    const elementIdsField = fieldPath(parent, 'elementIds');
    const elementIds = expectArray(region.elementIds, filename, elementIdsField);
    elementIds.forEach((elementId, elementIndex) => expectString(elementId, filename, `${elementIdsField}[${elementIndex}]`));
  }
  return region as unknown as UnstableRegion;
}

function validateGeometry(value: unknown): ValidatedGeometry {
  const filename = 'geometry.json';
  const geometry = expectRecord(value, filename, '$');
  const elements = expectArray(required(geometry, 'elements', filename), filename, 'elements').map(validateGeometryElement);
  const elementsTruncated = expectNonNegativeInteger(
    required(geometry, 'elementsTruncated', filename),
    filename,
    'elementsTruncated',
  );
  const elementsTruncatedUnknown = expectTrueIfPresent(geometry, 'elementsTruncatedUnknown', filename, '');
  const available = expectBoolean(required(geometry, 'available', filename), filename, 'available');

  let unstableRegions: readonly UnstableRegion[] | undefined;
  if (Object.prototype.hasOwnProperty.call(geometry, 'unstableRegions')) {
    unstableRegions = expectArray(geometry.unstableRegions, filename, 'unstableRegions').map(validateUnstableRegion);
  }

  if (elementsTruncatedUnknown && elementsTruncated !== 0) {
    failShape(filename, 'elementsTruncated', 'must be the zero placeholder when elementsTruncatedUnknown is true');
  }

  const base: ValidatedGeometryBase = {
    elements,
    elementsTruncated,
    ...(elementsTruncatedUnknown === undefined ? {} : { elementsTruncatedUnknown }),
    ...(unstableRegions === undefined ? {} : { unstableRegions }),
  };
  if (!available) {
    if (elements.length !== 0) failShape(filename, 'elements', 'must be empty when available is false');
    if (elementsTruncated !== 0) failShape(filename, 'elementsTruncated', 'must be zero when available is false');
    if (elementsTruncatedUnknown) failShape(filename, 'elementsTruncatedUnknown', 'must be absent when available is false');
    const reason = expectString(required(geometry, 'unavailableReason', filename), filename, 'unavailableReason');
    if (
      reason !== 'walk-evaluate-threw'
      && reason !== 'walk-evaluate-returned-no-object'
      && reason !== 'walk-facts-unavailable'
      && reason !== 'walk-meta-unavailable'
    ) {
      failShape(filename, 'unavailableReason', 'must name a supported geometry collection failure');
    }
    return { ...base, available: false, unavailableReason: reason };
  }
  if (Object.prototype.hasOwnProperty.call(geometry, 'unavailableReason')) {
    failShape(filename, 'unavailableReason', 'must be absent when available is true');
  }
  return { ...base, available: true };
}

function artifactFailureDetail(filename: string, error: unknown): string {
  if (error instanceof ArtifactShapeError) return error.message;
  if (error instanceof ArtifactResolutionError) return `${filename}.$ could not be read (${error.message})`;
  throw error;
}

function toRect(rect: CollectorRect | undefined): Rect | undefined {
  if (rect === undefined) return undefined;
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
}

function parseViewport(viewport: string | null): { w: number; h: number } | undefined {
  if (viewport === null) return undefined;
  const [width, height] = viewport.split('x');
  return { w: Number(width), h: Number(height) };
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
  return role === null ? '(none)' : String(role);
}

function identityParts(node: ValidatedAxNode): FactLine[] {
  const parts: FactLine[] = [text`role=`, data(roleString(node.role))];
  if (node.axName !== undefined) parts.push(line(text` name=`, data(node.axName)));
  parts.push(line(text` backend-node-id=`, data(node.backendNodeId === undefined ? '(unresolved)' : node.backendNodeId)));
  return parts;
}

function rectParts(node: ValidatedAxNode): FactLine[] {
  const rect = toRect(node.rect);
  if (rect) return [line(text` rect `, formatCoordinate(rect))];
  if (node.rectUnavailable) return [fact` rect unavailable (${node.rectUnavailableReason})`];
  return [text` rect not captured`];
}

function statesParts(node: ValidatedAxNode): FactLine[] {
  const entries = Object.entries(node.states);
  if (entries.length === 0) return [];
  return [line(text` states `, data(entries.map(([k, v]) => `${k}=${String(v)}`).join(',')))];
}

function nodeLine(node: ValidatedAxNode, caveats: readonly UnstableCaveat[]): FactLine {
  const parts: FactLine[] = [fact`ax node ${node.id}: `, ...identityParts(node), ...rectParts(node), ...statesParts(node)];
  const caveat = caveatSuffix(caveats);
  if (caveat) parts.push(caveat);
  return line(...parts);
}

function ignoredLine(node: ValidatedAxNode, caveats: readonly UnstableCaveat[]): FactLine {
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
    text`unmapped box: selector=`, data(element.selector ?? element.id),
    line(text` backend-node-id=`, data(element.backendNodeId ?? '(unresolved)')),
  ];
  const rect = toRect(element.rect);
  if (rect) parts.push(line(text` rect `, formatCoordinate(rect)));
  const caveat = caveatSuffix(caveats);
  if (caveat) parts.push(caveat);
  return line(...parts);
}

function placementLine(node: ValidatedAxNode, placement: RectPlacement, caveats: readonly UnstableCaveat[]): FactLine {
  const parts: FactLine[] = [fact`ax node ${node.id} rect ${placement}: `, ...identityParts(node), ...rectParts(node)];
  const caveat = caveatSuffix(caveats);
  if (caveat) parts.push(caveat);
  return line(...parts);
}

function attestationFor(ref: SnapRef, meta: ValidatedMeta): RenderableResult['attestation'] {
  return {
    kind: 'snapshot',
    id: ref.id,
    path: ref.dir,
    note: meta.settled === false
      ? text`Snapshot was captured with unsettled regions; only facts intersecting those regions carry nondeterminism caveats.`
      : text`Snapshot was settled before its AX facts were captured.`,
  };
}

function unavailableResult(ref: SnapRef, meta: ValidatedMeta, detail: string): RenderableResult {
  return {
    tag: 'ax-map',
    attestation: attestationFor(ref, meta),
    attrs: { available: false, settled: meta.settled },
    summary: line(
      text`AX facts are unavailable for this snapshot: `,
      data(detail),
      text`. No AX↔layout map can be computed — this is a collection gap, not an empty accessibility tree.`,
    ),
    followUp: fact`Re-capture the substrate with \`capture measure snap <url>\`, then run \`capture measure map ax <snap>\`.`,
  };
}

function artifactBoundaryFailureResult(detail: string): RenderableResult {
  return {
    tag: 'ax-map',
    attrs: { available: false },
    summary: line(
      text`AX facts are unavailable for this snapshot because a consumed artifact is malformed or unreadable: `,
      data(detail),
      text`. This is a collection gap, not an empty accessibility tree; no AX↔layout facts are attested.`,
    ),
    followUp: fact`Re-capture the substrate with \`capture measure snap <url>\`, then run \`capture measure map ax <snap>\`.`,
  };
}

/** Builds the read-only `measure map ax` report from an existing snapshot. */
export function buildMeasureMapAxResult(ref: SnapRef): RenderableResult {
  let meta: ValidatedMeta;
  try {
    meta = validateMeta(readMeta<unknown>(ref));
  } catch (error) {
    return artifactBoundaryFailureResult(artifactFailureDetail('meta.json', error));
  }

  let report: ValidatedAxReport;
  try {
    report = validateAx(readAx<unknown>(ref));
  } catch (error) {
    return artifactBoundaryFailureResult(artifactFailureDetail('ax.json', error));
  }
  if (!report.available) {
    return unavailableResult(ref, meta, `the ax collector reported available:false (${report.unavailableReason})`);
  }

  let geometry: ValidatedGeometry;
  try {
    geometry = validateGeometry(readGeometry<unknown>(ref));
  } catch (error) {
    return artifactBoundaryFailureResult(artifactFailureDetail('geometry.json', error));
  }
  if (!geometry.available) {
    return unavailableResult(ref, meta, `the geometry collector reported available:false (${geometry.unavailableReason})`);
  }

  const regions = geometry.unstableRegions === undefined ? [] : geometry.unstableRegions;
  const geometryByBackendNodeId = new Map<number, GeometryElement>();
  let identityUnresolvedCount = 0;
  for (const element of geometry.elements) {
    if (typeof element.backendNodeId === 'number') geometryByBackendNodeId.set(element.backendNodeId, element);
    else identityUnresolvedCount++;
  }

  const nodes = report.nodes;
  const nonIgnored = nodes.filter((n) => !n.ignored);
  const ignored = nodes.filter((n) => n.ignored);

  const elementIdFor = (node: AxNodeRecord): string | undefined => {
    if (typeof node.backendNodeId !== 'number') return undefined;
    return geometryByBackendNodeId.get(node.backendNodeId)?.id ?? String(node.backendNodeId);
  };
  const annotateNodes = (items: readonly ValidatedAxNode[]) => annotateUnstableFacts(
    items.map((node) => ({ elementId: elementIdFor(node), rect: toRect(node.rect) })),
    regions,
  );
  const annotatedNonIgnored = annotateNodes(nonIgnored);
  const annotatedIgnored = annotateNodes(ignored);

  const mappedBackendNodeIds = new Set<number>();
  for (const node of nonIgnored) {
    if (typeof node.backendNodeId === 'number') mappedBackendNodeIds.add(node.backendNodeId);
  }
  const unmappedBoxes = geometry.elements.filter((element) => {
    if (typeof element.backendNodeId !== 'number') return false;
    if (mappedBackendNodeIds.has(element.backendNodeId)) return false;
    const rect = element.rect;
    return element.visibility.visible && rect.width > 0 && rect.height > 0;
  });
  const annotatedUnmapped = annotateUnstableFacts(
    unmappedBoxes.map((element) => ({ elementId: element.id, rect: toRect(element.rect) })),
    regions,
  );

  const viewport = parseViewport(meta.viewport);
  const placed: Array<{ node: ValidatedAxNode; placement: RectPlacement; caveats: readonly UnstableCaveat[] }> = [];
  annotatedNonIgnored.forEach((entry, index) => {
    const node = nonIgnored[index]!;
    const rect = toRect(node.rect);
    if (!rect) return;
    const placement = classifyRect(rect, viewport);
    if (placement) placed.push({ node, placement, caveats: entry.caveats });
  });

  const sections: FactLine[] = [];
  sections.push(line(
    text`AX coverage scope: `,
    data(report.coverage.scope),
    text` (iframe AX nodes are outside Accessibility.getFullAXTree's scope).`,
  ));
  if (report.truncated !== undefined) sections.push(fact`AX tree recording cap reached: ${report.truncated} node(s) beyond the cap are not in ax.json.`);
  if (report.rectLookupsTruncated !== undefined) sections.push(fact`Rect lookup cap reached: ${report.rectLookupsTruncated} eligible node(s) have no rect because the lookup was skipped, not because they are unrendered.`);
  if (geometry.elementsTruncatedUnknown) sections.push(text`Geometry element cap count is unavailable: geometry.json records elementsTruncatedUnknown=true.`);
  else if (geometry.elementsTruncated > 0) sections.push(fact`Geometry element recording cap reached: ${geometry.elementsTruncated} element(s) beyond the cap are not in geometry.json.`);
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
      settled: meta.settled,
    },
    summary: fact`AX↔layout facts: ${nonIgnored.length} non-ignored AX node(s), ${ignored.length} ignored AX node(s), ${unmappedBoxes.length} DOM element(s) with rendered boxes but no non-ignored AX node, and ${placed.length} AX node(s) with offscreen, clipped, or zero-size rects.`,
    sections,
    followUp: fact`Read another snapshot map with \`capture measure map focus ${ref.id}\` or \`capture measure map layers ${ref.id}\`.`,
  };
}
