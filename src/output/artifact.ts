/**
 * Artifact resolver + reader + caveat propagation — the shared read-only API
 * every `measure`/`motion` query leaf uses to turn a `[url|snap]`/`<rec>`
 * argument into a validated on-disk artifact, read its collector files, and
 * attach per-region nondeterminism caveats. No query leaf reads a snapshot
 * or recording file directly — everything routes through here so path
 * safety (via U03's `assertUnderCaptureRoot`), missing-artifact recovery
 * messaging, and caveat attachment stay in one place.
 *
 * Contract this module fixes for upstream writers:
 *  - `geometry.json` is a JSON object shaped `{ elements: [...],
 *    unstableRegions?: UnstableRegion[] }`. `unstableRegions` is present
 *    only on a `--capture-unsettled` snapshot; `unstableRegionsFor()` reads
 *    it from here — nowhere else.
 *  - every per-element record collectors write (in `geometry.json` and
 *    elsewhere) should carry the identifying fields in `ElementRecord`
 *    (`src/output/selector.ts`) so selector lookups work uniformly across
 *    collector files.
 *  - `meta.json` always exists for any snapshot/recording directory this
 *    resolver is asked to resolve — including an unsettled, evidence-only
 *    `measure snap` capture — because it is what `session stop` reads to
 *    build the bundle manifest (U03) and what this resolver treats as the
 *    marker that a ref actually names something.
 */

import * as fs from 'fs';
import * as path from 'path';

import { assertUnderCaptureRoot, type SnapMeta, type RecMeta } from '../session/artifacts.js';
import { getActiveSession } from '../session-context.js';

// ============================================================================
// Refs
// ============================================================================

export interface SnapRef {
  readonly kind: 'snap';
  readonly id: string;
  /** Absolute path to `measure/snaps/{id}` (or the oneshot equivalent). */
  readonly dir: string;
}

export interface RecRef {
  readonly kind: 'rec';
  readonly id: string;
  /** Absolute path to `motion/recs/{id}` (or the oneshot equivalent). */
  readonly dir: string;
}

export type ArtifactRef = SnapRef | RecRef;

/** What a pluggable URL-snap callback must return. */
export interface SnapUrlResult {
  readonly id: string;
  readonly dir: string;
}

/**
 * Invoked by {@link resolveSnapRef} when the ref is a URL. Query leaves that
 * accept a URL target (per the design's `[url|snap]` contract) pass their
 * own `measure snap` invocation wrapped as this callback; leaves that don't
 * accept URL targets simply omit `onUrl`, and a URL ref throws. This
 * indirection exists so this module never imports the `measure snap`
 * command leaf directly — that would create `output/artifact.ts` ->
 * `cdp/commands/measure/snap.ts` -> ... -> `output/artifact.ts` cycles once
 * later units land.
 */
export type SnapUrlCallback = (url: string) => Promise<SnapUrlResult>;

export interface ResolveSnapOptions {
  readonly onUrl?: SnapUrlCallback;
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Every resolution or read failure in this module throws this. The message
 * (and the structured fields) always say three things: what ref was
 * received, where this module looked for it, and — when the answer is
 * "nothing is there yet" — what command creates it.
 */
export class ArtifactResolutionError extends Error {
  readonly ref: string;
  readonly searched: readonly string[];
  readonly creatingCommand?: string;

  constructor(ref: string, searched: readonly string[], detail: string, creatingCommand?: string) {
    const parts = [`could not resolve ref ${JSON.stringify(ref)}: ${detail}`];
    if (searched.length) parts.push(`looked at: ${searched.join(', ')}`);
    if (creatingCommand) parts.push(`create it with: ${creatingCommand}`);
    super(parts.join(' — '));
    this.name = 'ArtifactResolutionError';
    this.ref = ref;
    this.searched = searched;
    this.creatingCommand = creatingCommand;
  }
}

// ============================================================================
// Ref resolution
// ============================================================================

export function isUrlRef(ref: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(ref);
}

interface RefKindConfig {
  readonly kind: 'snap' | 'rec';
  /** Path segments under a session dir an id resolves through, e.g.
   * `['measure', 'snaps']`. */
  readonly idSegments: readonly [string, string];
  readonly creatingCommand: string;
  readonly label: 'snapshot' | 'recording';
}

const SNAP_CONFIG: RefKindConfig = {
  kind: 'snap',
  idSegments: ['measure', 'snaps'],
  creatingCommand: 'capture measure snap',
  label: 'snapshot',
};

const REC_CONFIG: RefKindConfig = {
  kind: 'rec',
  idSegments: ['motion', 'recs'],
  creatingCommand: 'capture motion rec',
  label: 'recording',
};

function stripTrailingSep(p: string): string {
  return p.length > 1 && (p.endsWith('/') || p.endsWith(path.sep)) ? p.slice(0, -1) : p;
}

function resolveRefFromPath(ref: string, config: RefKindConfig): ArtifactRef {
  const resolved = assertUnderCaptureRoot(stripTrailingSep(ref));
  const metaPath = path.join(resolved, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    throw new ArtifactResolutionError(
      ref,
      [resolved],
      `no ${config.label} found at this path (missing meta.json)`,
      config.creatingCommand,
    );
  }
  return { kind: config.kind, id: path.basename(resolved), dir: resolved } as ArtifactRef;
}

function resolveRefFromId(ref: string, config: RefKindConfig): ArtifactRef {
  const active = getActiveSession();
  if (!active) {
    throw new ArtifactResolutionError(
      ref,
      [],
      `no active capture session — a bare id resolves against the active session's ${config.idSegments.join('/')} directory`,
      `capture session start (then re-run), or pass the absolute ${config.label} path printed by ${config.creatingCommand}`,
    );
  }
  const dir = path.join(active.dir, ...config.idSegments, ref);
  const resolved = assertUnderCaptureRoot(dir);
  const metaPath = path.join(resolved, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    throw new ArtifactResolutionError(
      ref,
      [resolved],
      `no ${config.label} named ${JSON.stringify(ref)} found in the active session (${active.sessionId})`,
      config.creatingCommand,
    );
  }
  return { kind: config.kind, id: ref, dir: resolved } as ArtifactRef;
}

function rejectRelativePath(ref: string): void {
  if (!path.isAbsolute(ref) && (ref.includes('/') || ref.includes(path.sep))) {
    throw new ArtifactResolutionError(
      ref,
      [],
      'relative paths are not accepted — pass an absolute artifact path (as printed by the capturing command) or a bare id',
    );
  }
}

/**
 * Resolves a `measure` leaf's `[url|snap]` target into a {@link SnapRef}:
 *  - a URL (`onUrl` must be supplied, or this throws — see
 *    {@link SnapUrlCallback});
 *  - an absolute path to a snapshot dir (validated under the capture root,
 *    must contain `meta.json`);
 *  - a bare id (`snap-a3f2`), resolved against the active session's
 *    `measure/snaps/` directory.
 */
export async function resolveSnapRef(ref: string, options: ResolveSnapOptions = {}): Promise<SnapRef> {
  if (isUrlRef(ref)) {
    if (!options.onUrl) {
      throw new ArtifactResolutionError(ref, [], 'this command does not accept a URL target — pass a snapshot id or path instead');
    }
    const result = await options.onUrl(ref);
    return { kind: 'snap', id: result.id, dir: assertUnderCaptureRoot(result.dir) };
  }
  if (path.isAbsolute(ref)) return resolveRefFromPath(ref, SNAP_CONFIG) as SnapRef;
  rejectRelativePath(ref);
  return resolveRefFromId(ref, SNAP_CONFIG) as SnapRef;
}

/**
 * Resolves a `motion` leaf's `<rec>` target into a {@link RecRef}: an
 * absolute path to a recording dir, or a bare id (`rec-9f31`) resolved
 * against the active session's `motion/recs/` directory. Recordings are
 * never created from a URL ref directly (`motion rec <url> --do ...` is the
 * capture leaf, not a query resolver), so a URL ref always throws.
 */
export function resolveRecRef(ref: string): RecRef {
  if (isUrlRef(ref)) {
    throw new ArtifactResolutionError(
      ref,
      [],
      'a recording ref cannot be a URL — record one first with `capture motion rec <url> --do <action>` or `--start`/`--stop`',
    );
  }
  if (path.isAbsolute(ref)) return resolveRefFromPath(ref, REC_CONFIG) as RecRef;
  rejectRelativePath(ref);
  return resolveRefFromId(ref, REC_CONFIG) as RecRef;
}

// ============================================================================
// Readers
// ============================================================================

const CREATING_COMMAND_BY_FILE: Record<string, string> = {
  'geometry.json': 'capture measure snap',
  'styles.json': 'capture measure snap',
  'hittest.json': 'capture measure snap',
  'text.json': 'capture measure snap',
  'forms.json': 'capture measure snap',
  'animation.json': 'capture measure snap',
  'ax.json': 'capture measure snap',
  'media.json': 'capture measure snap',
  'queries.json': 'capture measure snap',
  'focus.json': 'capture measure snap',
  'scroll.json': 'capture measure snap',
  'layers.json': 'capture measure snap',
  'states.json': 'capture measure snap --state <state>',
  'churn.json': 'capture measure snap (written only when the page did not settle)',
  'pixels.json': 'capture measure snap --pixels',
  'dom.html': 'capture measure snap',
  'screenshot.png': 'capture measure snap',
  'meta.json': 'capture measure snap (or capture motion rec for a recording)',
  'rects.jsonl': 'capture motion rec',
  'events.jsonl': 'capture motion rec',
  'markers.json': 'capture motion rec',
};

function creatingCommandFor(filename: string): string | undefined {
  return CREATING_COMMAND_BY_FILE[filename];
}

/**
 * Resolves (and, by default, verifies existence of) one artifact file's
 * absolute path within `ref`'s directory. Every reader below is built on
 * this — a query leaf that needs a raw artifact path (a screenshot, a crop
 * source) rather than parsed content can call this directly.
 */
export function artifactPath(ref: ArtifactRef, filename: string, opts: { mustExist?: boolean } = {}): string {
  const filePath = assertUnderCaptureRoot(path.join(ref.dir, filename));
  const mustExist = opts.mustExist ?? true;
  if (mustExist && !fs.existsSync(filePath)) {
    throw new ArtifactResolutionError(
      ref.id,
      [filePath],
      `${filename} is not present in ${ref.kind === 'snap' ? 'snapshot' : 'recording'} ${ref.id}`,
      creatingCommandFor(filename),
    );
  }
  return filePath;
}

export function artifactExists(ref: ArtifactRef, filename: string): boolean {
  return fs.existsSync(assertUnderCaptureRoot(path.join(ref.dir, filename)));
}

function readJsonArtifactFile<T>(ref: ArtifactRef, filename: string): T {
  const filePath = artifactPath(ref, filename);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new ArtifactResolutionError(
      ref.id,
      [filePath],
      `could not read ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      creatingCommandFor(filename),
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new ArtifactResolutionError(
      ref.id,
      [filePath],
      `${filename} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      creatingCommandFor(filename),
    );
  }
}

function readNdjsonArtifactFile<T>(ref: ArtifactRef, filename: string): T[] {
  const filePath = artifactPath(ref, filename);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new ArtifactResolutionError(
      ref.id,
      [filePath],
      `could not read ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      creatingCommandFor(filename),
    );
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    try {
      return JSON.parse(line) as T;
    } catch (err) {
      throw new ArtifactResolutionError(
        ref.id,
        [filePath],
        `${filename} line ${i + 1} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        creatingCommandFor(filename),
      );
    }
  });
}

function assertKind(ref: ArtifactRef, kind: 'snap' | 'rec', fnName: string): void {
  if (ref.kind !== kind) {
    throw new TypeError(`${fnName} expects a ${kind} ref, got a ${ref.kind} ref (${ref.id})`);
  }
}

/** `meta.json` — the one file common to both a snapshot and a recording. */
export function readMeta<T = SnapMeta | RecMeta>(ref: ArtifactRef): T {
  return readJsonArtifactFile<T>(ref, 'meta.json');
}

export function readGeometry<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readGeometry');
  return readJsonArtifactFile<T>(ref, 'geometry.json');
}

export function readStyles<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readStyles');
  return readJsonArtifactFile<T>(ref, 'styles.json');
}

export function readHittest<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readHittest');
  return readJsonArtifactFile<T>(ref, 'hittest.json');
}

export function readText<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readText');
  return readJsonArtifactFile<T>(ref, 'text.json');
}

export function readForms<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readForms');
  return readJsonArtifactFile<T>(ref, 'forms.json');
}

export function readAnimation<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readAnimation');
  return readJsonArtifactFile<T>(ref, 'animation.json');
}

export function readAx<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readAx');
  return readJsonArtifactFile<T>(ref, 'ax.json');
}

export function readQueries<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readQueries');
  return readJsonArtifactFile<T>(ref, 'queries.json');
}

export function readFocus<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readFocus');
  return readJsonArtifactFile<T>(ref, 'focus.json');
}

export function readScroll<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readScroll');
  return readJsonArtifactFile<T>(ref, 'scroll.json');
}

export function readLayers<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readLayers');
  return readJsonArtifactFile<T>(ref, 'layers.json');
}

export function readStates<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readStates');
  return readJsonArtifactFile<T>(ref, 'states.json');
}

export function readChurn<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readChurn');
  return readJsonArtifactFile<T>(ref, 'churn.json');
}

export function readPixels<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readPixels');
  return readJsonArtifactFile<T>(ref, 'pixels.json');
}

export function readMedia<T = unknown>(ref: SnapRef): T {
  assertKind(ref, 'snap', 'readMedia');
  return readJsonArtifactFile<T>(ref, 'media.json');
}

export function readRects<T = unknown>(ref: RecRef): T[] {
  assertKind(ref, 'rec', 'readRects');
  return readNdjsonArtifactFile<T>(ref, 'rects.jsonl');
}

export function readEvents<T = unknown>(ref: RecRef): T[] {
  assertKind(ref, 'rec', 'readEvents');
  return readNdjsonArtifactFile<T>(ref, 'events.jsonl');
}

export function readMarkers<T = unknown>(ref: RecRef): T {
  assertKind(ref, 'rec', 'readMarkers');
  return readJsonArtifactFile<T>(ref, 'markers.json');
}

// ============================================================================
// Unstable-region caveats — the only sanctioned path to a nondeterminism
// caveat on a query fact.
// ============================================================================

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface UnstableRegion {
  /** Stable id for the region within this snapshot, e.g. matches the
   * `regionId` a collector stamps onto affected `geometry.json` elements. */
  readonly id: string;
  /** Selector/description identifying the region, when known. */
  readonly selector?: string;
  /** Axis-aligned bounding rect in top-viewport space, when known. */
  readonly rect?: Rect;
  /** Element ids (geometry.json `ElementRecord.id`s) known to be inside
   * this region, when known. */
  readonly elementIds?: readonly string[];
  /** Free-text evidence, e.g. "autoplay repaint every 3.2s". */
  readonly reason?: string;
}

/**
 * Reads the unstable regions marked on a `--capture-unsettled` snapshot's
 * `geometry.json` (`{ unstableRegions: UnstableRegion[] }`). Returns `[]`
 * for a fully-settled snapshot (no unstable regions were marked). Throws
 * the normal reader failure if `geometry.json` itself is absent — which
 * only happens for a snapshot that never got a queryable substrate at all
 * (unsettled without `--capture-unsettled`), a state no query leaf should
 * be reading facts from in the first place.
 */
export function unstableRegionsFor(ref: SnapRef): UnstableRegion[] {
  const geometry = readGeometry<{ unstableRegions?: UnstableRegion[] }>(ref);
  return geometry.unstableRegions ?? [];
}

export interface UnstableMatchable {
  /** The element/backend-node id this fact is about, if any. Matched
   * against a region's `elementIds`. */
  readonly elementId?: string;
  /** The fact's own rect in top-viewport space, if any. Matched against a
   * region's `rect` by axis-aligned overlap. */
  readonly rect?: Rect;
}

export interface UnstableCaveat {
  readonly regionId: string;
  readonly selector?: string;
  readonly reason?: string;
}

export interface AnnotatedFact<T> {
  readonly fact: T;
  /** Zero or more caveats — empty when the fact touches no unstable
   * region. A fact spanning multiple regions carries one caveat per
   * region. */
  readonly caveats: readonly UnstableCaveat[];
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Attaches a per-region nondeterminism caveat to every fact whose
 * `elementId` or `rect` falls inside an unstable region. This — together
 * with {@link unstableRegionsFor} — is the only sanctioned way a query leaf
 * marks a fact as derived from an unstable region; leaves must not
 * hand-roll their own "unsettled" warning text.
 */
export function annotateUnstableFacts<T extends UnstableMatchable>(
  facts: readonly T[],
  regions: readonly UnstableRegion[],
): AnnotatedFact<T>[] {
  return facts.map((fact) => {
    const caveats: UnstableCaveat[] = [];
    for (const region of regions) {
      const byElement = fact.elementId !== undefined && (region.elementIds?.includes(fact.elementId) ?? false);
      const byRect = fact.rect !== undefined && region.rect !== undefined && rectsOverlap(fact.rect, region.rect);
      if (byElement || byRect) {
        caveats.push({ regionId: region.id, selector: region.selector, reason: region.reason });
      }
    }
    return { fact, caveats };
  });
}
