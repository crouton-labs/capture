import * as fs from 'fs';
import * as path from 'path';

import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

import { diffPngs, type DiffPngsOutcome } from '../../output/diff.js';
import {
  artifactPath,
  annotateUnstableFacts,
  readForms,
  readGeometry,
  readMeta,
  readPixels,
  readStates,
  readStyles,
  readText,
  unstableRegionsFor,
  type Rect,
  type SnapRef,
  type UnstableCaveat,
} from '../../output/artifact.js';

interface ElementLike {
  readonly id?: string;
  readonly backendNodeId?: number | null;
  readonly selector?: string;
  readonly rect?: Rect;
  readonly [key: string]: unknown;
}

interface ElementsReport {
  readonly elements?: ElementLike[];
}

interface FormsReport {
  readonly controls?: ElementLike[];
}

interface SnapshotMeta {
  readonly settled?: boolean;
  readonly capturedAt?: string;
}

export interface PropertyDelta {
  readonly property: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly beforeProvenance?: unknown;
  readonly afterProvenance?: unknown;
}

export interface ProvenanceRecord {
  readonly property: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly beforeProvenance?: unknown;
  readonly afterProvenance?: unknown;
  readonly changed: boolean;
  /** The winning declaration changed even though the computed value may not have. */
  readonly declarationChanged: boolean;
}

export interface DiffCaveat extends UnstableCaveat {
  readonly snapshot: 'before' | 'after';
}

export interface ElementDiff {
  readonly key: string;
  readonly before?: ElementLike;
  readonly after?: ElementLike;
  readonly selector?: string;
  readonly geometryChanged: boolean;
  readonly textChanged: boolean;
  readonly formChanged: boolean;
  readonly mediaChanged: boolean;
  readonly styleDeltas: readonly PropertyDelta[];
  readonly provenance: readonly ProvenanceRecord[];
  readonly reflow: boolean;
  readonly caveats: readonly DiffCaveat[];
}

export interface StateDiff {
  readonly key: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly changed: boolean;
}

export interface RasterRegion {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly changedPixels: number;
  readonly explainedByGeometry: boolean;
}

export interface RasterDiff {
  readonly path: string;
  readonly outcome: DiffPngsOutcome;
  readonly regions: readonly RasterRegion[];
  readonly unexplainedRegions: number;
}

export interface MeasureDiffReport {
  readonly before: SnapRef;
  readonly after: SnapRef;
  readonly beforeMeta: SnapshotMeta;
  readonly afterMeta: SnapshotMeta;
  readonly changes: readonly ElementDiff[];
  readonly stateDeltas: readonly StateDiff[];
  readonly raster?: RasterDiff;
  readonly changed: boolean;
}

function readJson<T>(ref: SnapRef, filename: string): T {
  const file = artifactPath(ref, filename);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (error) {
    throw new Error(`could not read ${filename} for snapshot ${ref.id} at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface SnapshotFamily {
  readonly records: Map<string, ElementLike>;
  order: number;
  selector?: string;
}

type ArtifactCollection = Record<string, readonly ElementLike[]>;

const RECORD_IDENTITY_FIELDS = new Set(['id', 'backendNodeId', 'identityUnresolved', 'selector', 'axId', 'nodeId', 'objectId', 'markId']);

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, normalized(entry)]));
}

/** Removes only a collector record's own snapshot-local identity fields. */
function recordMeasurementPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized(value);
  return normalized(Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !RECORD_IDENTITY_FIELDS.has(key))));
}

/** sourceStyleSheetId is opaque per-CDP-session; declaration selector is provenance and must remain. */
function provenancePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(provenancePayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'sourceStyleSheetId')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, provenancePayload(entry)]));
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

function sameRecordValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(recordMeasurementPayload(a)) === JSON.stringify(recordMeasurementPayload(b));
}

function sameProvenance(a: unknown, b: unknown): boolean {
  return JSON.stringify(provenancePayload(a)) === JSON.stringify(provenancePayload(b));
}

/**
 * Within one snapshot, collectors are correlated by backendNodeId. Cross-snapshot
 * matching deliberately does not use that CDP-runtime id: it derives a stable page
 * identity from the selector plus its collision-safe occurrence ordinal instead.
 */
function assembleFamilies(collections: ArtifactCollection, recordKey: (collection: string, element: ElementLike) => string = (collection) => collection): Map<string, SnapshotFamily> {
  const byLocalId = new Map<string, SnapshotFamily>();
  let nextOrder = 0;
  for (const [collection, elements] of Object.entries(collections)) {
    elements.forEach((element, index) => {
      const localId = typeof element.backendNodeId === 'number'
        ? `backend:${element.backendNodeId}`
        : `${collection}:unresolved:${index}`;
      let family = byLocalId.get(localId);
      if (!family) {
        family = { records: new Map(), order: nextOrder++ };
        byLocalId.set(localId, family);
      }
      family.records.set(recordKey(collection, element), element);
      if (collection === 'geometry' || family.selector === undefined) family.selector = typeof element.selector === 'string' ? element.selector : family.selector;
    });
  }

  const selectorOrdinals = new Map<string, number>();
  const indexed = new Map<string, SnapshotFamily>();
  for (const family of [...byLocalId.values()].sort((a, b) => a.order - b.order)) {
    const base = family.selector === undefined ? 'unidentified' : `selector:${family.selector}`;
    const ordinal = selectorOrdinals.get(base) ?? 0;
    selectorOrdinals.set(base, ordinal + 1);
    indexed.set(`${base}#${ordinal}`, family);
  }
  return indexed;
}

function recordFrom(family: SnapshotFamily | undefined, collection: string): ElementLike | undefined {
  return family?.records.get(collection);
}

function rectChanged(before?: ElementLike, after?: ElementLike): boolean {
  return !sameValue(before?.rect, after?.rect);
}

function computed(element?: ElementLike): Record<string, unknown> {
  const value = element?.computed;
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function declarations(element?: ElementLike): readonly Record<string, unknown>[] {
  const value = element?.winningDeclarations;
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
}

function provenanceFor(element: ElementLike | undefined, property: string): unknown {
  return declarations(element).find((entry) => entry.property === property || entry.name === property);
}

function styleDeltas(before?: ElementLike, after?: ElementLike): PropertyDelta[] {
  const beforeComputed = computed(before);
  const afterComputed = computed(after);
  const properties = new Set([...Object.keys(beforeComputed), ...Object.keys(afterComputed)]);
  const deltas: PropertyDelta[] = [];
  for (const property of properties) {
    if (sameValue(beforeComputed[property], afterComputed[property])) continue;
    deltas.push({
      property,
      before: beforeComputed[property],
      after: afterComputed[property],
      beforeProvenance: provenanceFor(before, property),
      afterProvenance: provenanceFor(after, property),
    });
  }
  return deltas;
}


function styleProvenance(before: ElementLike | undefined, after: ElementLike | undefined, full: boolean): ProvenanceRecord[] {
  const beforeComputed = computed(before);
  const afterComputed = computed(after);
  const declarationProps = new Set([...declarations(before), ...declarations(after)].flatMap((entry) => [entry.property, entry.name]).filter((value): value is string => typeof value === 'string'));
  const properties = new Set([...Object.keys(beforeComputed), ...Object.keys(afterComputed), ...declarationProps]);
  const records: ProvenanceRecord[] = [];
  for (const property of properties) {
    const beforeProvenance = provenanceFor(before, property);
    const afterProvenance = provenanceFor(after, property);
    if (!beforeProvenance && !afterProvenance) continue;
    const changed = !sameValue(beforeComputed[property], afterComputed[property]);
    const declarationChanged = !sameProvenance(beforeProvenance, afterProvenance);
    // Default output keeps material cascade changes even when their computed
    // value is unchanged; --full additionally exposes unchanged declarations.
    if (!full && !changed && !declarationChanged) continue;
    records.push({ property, before: beforeComputed[property], after: afterComputed[property], beforeProvenance, afterProvenance, changed, declarationChanged });
  }
  return records;
}

function rectOf(element?: ElementLike): Rect | undefined {
  if (!element?.rect) return undefined;
  const raw = element.rect as Rect & { width?: number; height?: number };
  const w = typeof raw.w === 'number' ? raw.w : raw.width;
  const h = typeof raw.h === 'number' ? raw.h : raw.height;
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || typeof w !== 'number' || typeof h !== 'number') return undefined;
  return { ...raw, w, h };
}

function overlaps(a: Rect, b: RasterRegion): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function rasterRegions(beforePath: string, afterPath: string, geometryRecords: readonly ElementDiff[]): RasterRegion[] {
  const beforePng = PNG.sync.read(fs.readFileSync(beforePath));
  const afterPng = PNG.sync.read(fs.readFileSync(afterPath));
  if (beforePng.width !== afterPng.width || beforePng.height !== afterPng.height) return [];
  const { width, height } = beforePng;
  const diff = new PNG({ width, height });
  pixelmatch(beforePng.data, afterPng.data, diff.data, width, height, { threshold: 0.1, diffMask: true });
  const changed = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    if (diff.data[o] || diff.data[o + 1] || diff.data[o + 2]) changed[i] = 1;
  }
  const seen = new Uint8Array(width * height);
  const regions: RasterRegion[] = [];
  const geometryRects = geometryRecords.filter((record) => record.geometryChanged).flatMap((record) => [rectOf(record.before), rectOf(record.after)].filter((rect): rect is Rect => Boolean(rect)));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!changed[start] || seen[start]) continue;
      let minX = x, maxX = x, minY = y, maxY = y, count = 0;
      const queue = [start];
      seen[start] = 1;
      for (let q = 0; q < queue.length; q += 1) {
        const cur = queue[q];
        const cx = cur % width;
        const cy = Math.floor(cur / width);
        count += 1; minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (changed[ni] && !seen[ni]) { seen[ni] = 1; queue.push(ni); }
        }
      }
      const region = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, changedPixels: count, explainedByGeometry: false };
      regions.push({ ...region, explainedByGeometry: geometryRects.some((rect) => overlaps(rect, region)) });
    }
  }
  return regions;
}

/**
 * Producer selectors embed raw DOM ids/classes without CSS escaping. They are
 * display labels, not an identity grammar: parsing them can make distinct raw
 * values such as `card.one` and `card.two` share a fabricated `card` ID.
 * New snapshots carry mutation-target backend identities; legacy artifacts
 * without one fail closed unless their raw selector strings are exactly equal.
 */
function selectorsMatch(regionSelector: string | undefined, elementSelector: string | undefined): boolean {
  return regionSelector !== undefined && elementSelector !== undefined && regionSelector === elementSelector;
}

function joinCaveats(before: ElementLike | undefined, after: ElementLike | undefined, beforeRegions: ReturnType<typeof unstableRegionsFor>, afterRegions: ReturnType<typeof unstableRegionsFor>): DiffCaveat[] {
  const caveatsFor = (element: ElementLike | undefined, regions: ReturnType<typeof unstableRegionsFor>, snapshot: 'before' | 'after'): DiffCaveat[] => {
    if (!element) return [];
    const stableElementId = typeof element.backendNodeId === 'number' ? String(element.backendNodeId) : element.id;
    const matched = annotateUnstableFacts([{ elementId: stableElementId, rect: rectOf(element) }], regions)[0].caveats;
    // Legacy artifacts lack the backend identity now emitted by the churn
    // producer. Only those identity-unavailable rows can join raw selector
    // labels, and then only by exact equality.
    const selectorMatched = regions.filter((region) => !region.elementIds?.length && selectorsMatch(region.selector, element.selector))
      .map((region) => ({ regionId: region.id, selector: region.selector, reason: region.reason }));
    return [...matched, ...selectorMatched].map((caveat) => ({ ...caveat, snapshot }));
  };
  const seen = new Set<string>();
  return [...caveatsFor(before, beforeRegions, 'before'), ...caveatsFor(after, afterRegions, 'after')].filter((caveat) => {
    const key = `${caveat.snapshot}:${caveat.regionId}:${caveat.selector ?? ''}:${caveat.reason ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractElements(report: unknown, collection: 'elements' | 'controls' = 'elements'): ElementLike[] {
  if (!report || typeof report !== 'object') return [];
  const values = (report as Record<string, unknown>)[collection];
  return Array.isArray(values) ? values.filter((value): value is ElementLike => typeof value === 'object' && value !== null) : [];
}


/** Compare two completed snapshot artifacts without driving the browser. */
export function diffSnapshots(before: SnapRef, after: SnapRef, options: { full?: boolean; pixels?: boolean } = {}): MeasureDiffReport {
  const beforeGeometry = readGeometry<ElementsReport>(before);
  const afterGeometry = readGeometry<ElementsReport>(after);
  const beforeStyles = readStyles<ElementsReport>(before);
  const afterStyles = readStyles<ElementsReport>(after);
  const beforeText = readText<ElementsReport>(before);
  const afterText = readText<ElementsReport>(after);
  const beforeForms = readForms<FormsReport>(before);
  const afterForms = readForms<FormsReport>(after);
  // media.json is a required substrate file. U04 intentionally has no typed
  // reader for it, so keep its artifact-path validation in the shared API.
  const beforeMedia = readJson<ElementsReport>(before, 'media.json');
  const afterMedia = readJson<ElementsReport>(after, 'media.json');

  const beforeRegions = unstableRegionsFor(before);
  const afterRegions = unstableRegionsFor(after);
  const beforeFamilies = assembleFamilies({
    geometry: extractElements(beforeGeometry), styles: extractElements(beforeStyles), text: extractElements(beforeText), forms: extractElements(beforeForms, 'controls'), media: extractElements(beforeMedia),
  });
  const afterFamilies = assembleFamilies({
    geometry: extractElements(afterGeometry), styles: extractElements(afterStyles), text: extractElements(afterText), forms: extractElements(afterForms, 'controls'), media: extractElements(afterMedia),
  });

  const records: ElementDiff[] = [];
  for (const key of new Set([...beforeFamilies.keys(), ...afterFamilies.keys()])) {
    const beforeFamily = beforeFamilies.get(key);
    const afterFamily = afterFamilies.get(key);
    const geometryA = recordFrom(beforeFamily, 'geometry');
    const geometryB = recordFrom(afterFamily, 'geometry');
    const styleA = recordFrom(beforeFamily, 'styles');
    const styleB = recordFrom(afterFamily, 'styles');
    const textA = recordFrom(beforeFamily, 'text');
    const textB = recordFrom(afterFamily, 'text');
    const formA = recordFrom(beforeFamily, 'forms');
    const formB = recordFrom(afterFamily, 'forms');
    const mediaA = recordFrom(beforeFamily, 'media');
    const mediaB = recordFrom(afterFamily, 'media');
    const styles = styleDeltas(styleA, styleB);
    const provenance = styleProvenance(styleA, styleB, Boolean(options.full));
    const geometryChanged = rectChanged(geometryA, geometryB) || Boolean(geometryA) !== Boolean(geometryB);
    const textChanged = !sameRecordValue(textA, textB);
    const formChanged = !sameRecordValue(formA, formB);
    const mediaChanged = !sameRecordValue(mediaA, mediaB);
    const changed = geometryChanged || textChanged || formChanged || mediaChanged || styles.length > 0;
    // Cascade shifts are reportable provenance even when no rendered
    // measurement changed; they do not themselves make --gate fail.
    if (!options.full && !changed && !provenance.length) continue;
    const primaryBefore = geometryA ?? styleA ?? textA ?? formA ?? mediaA;
    const primaryAfter = geometryB ?? styleB ?? textB ?? formB ?? mediaB;
    records.push({
      key,
      before: primaryBefore,
      after: primaryAfter,
      selector: primaryAfter?.selector ?? primaryBefore?.selector,
      geometryChanged,
      textChanged,
      formChanged,
      mediaChanged,
      styleDeltas: styles,
      provenance,
      reflow: geometryChanged && (rectOf(geometryA)?.y !== rectOf(geometryB)?.y || rectOf(geometryA)?.x !== rectOf(geometryB)?.x || rectOf(geometryA)?.w !== rectOf(geometryB)?.w || rectOf(geometryA)?.h !== rectOf(geometryB)?.h),
      caveats: joinCaveats(primaryBefore, primaryAfter, beforeRegions, afterRegions),
    });
  }

  const stateDeltas: StateDiff[] = [];
  if (options.full) {
    const stateRecordKey = (collection: string, element: ElementLike): string => `${collection}:${typeof element.state === 'string' ? element.state : 'unknown'}`;
    const beforeStates = assembleFamilies({ states: extractElements(readStates(before)) }, stateRecordKey);
    const afterStates = assembleFamilies({ states: extractElements(readStates(after)) }, stateRecordKey);
    for (const key of new Set([...beforeStates.keys(), ...afterStates.keys()])) {
      const beforeFamily = beforeStates.get(key);
      const afterFamily = afterStates.get(key);
      const stateKeys = new Set([
        ...[...(beforeFamily?.records.keys() ?? [])].filter((recordKey) => recordKey.startsWith('states:')),
        ...[...(afterFamily?.records.keys() ?? [])].filter((recordKey) => recordKey.startsWith('states:')),
      ]);
      for (const stateKey of stateKeys) {
        const beforeState = beforeFamily?.records.get(stateKey);
        const afterState = afterFamily?.records.get(stateKey);
        const state = stateKey.slice('states:'.length);
        stateDeltas.push({ key: `${state}:${key}`, before: beforeState, after: afterState, changed: !sameRecordValue(beforeState, afterState) });
      }
    }
  }

  let raster: RasterDiff | undefined;
  if (options.pixels) {
    // Read pixels.json first: this is the explicit substrate contract for
    // raster analysis, even though the full screenshots are diffed below.
    readPixels(before);
    readPixels(after);
    const output = path.join(after.dir, 'diffs', 'raster-diff.png');
    const beforePng = artifactPath(before, 'screenshot.png');
    const afterPng = artifactPath(after, 'screenshot.png');
    const outcome = diffPngs(beforePng, afterPng, output);
    const regions = outcome.ok ? rasterRegions(beforePng, afterPng, records) : [];
    raster = { path: output, outcome, regions, unexplainedRegions: regions.filter((region) => !region.explainedByGeometry).length };
  }

  return {
    before,
    after,
    beforeMeta: readMeta<SnapshotMeta>(before),
    afterMeta: readMeta<SnapshotMeta>(after),
    changes: records,
    stateDeltas,
    raster,
    changed: records.some((record) => record.geometryChanged || record.textChanged || record.formChanged || record.mediaChanged || record.styleDeltas.length > 0) || stateDeltas.some((state) => state.changed) || Boolean(raster?.outcome.ok && raster.outcome.diffPixelCount > 0),
  };
}
