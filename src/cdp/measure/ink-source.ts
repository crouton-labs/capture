import type { InkRect, InkStyles } from './ink.js';

/**
 * Selects which recorded rect + computed-style table an ink derivation runs over:
 * the base-state geometry record, or one element's post-force values under a
 * requested `--state`. Both callers of `deriveInkBox` over snapshot artifacts
 * (`measure explain` and `measure map paint`) resolve their input here so the
 * two leaves cannot disagree about what a forced-state ink box is derived from.
 */
export interface InkSource {
  readonly rect: InkRect;
  readonly styles: InkStyles;
  /** Factual description of where `rect` and `styles` were read from, for the caller to report. */
  readonly provenance: string;
}

export interface InkSourceUnavailable {
  /** Factual reason no rect/style pair was found, phrased for direct inclusion in output. */
  readonly unavailable: string;
}

export type InkSourceResult = InkSource | InkSourceUnavailable;

export function isInkSource(result: InkSourceResult): result is InkSource {
  return (result as InkSource).rect !== undefined;
}

export interface InkTargetIdentity {
  readonly selector?: string;
  readonly backendNodeId?: number | null;
}

interface GeometryLike extends InkTargetIdentity {
  readonly boxModel?: Record<string, unknown> | null;
  /** Ink-relevant computed styles recorded beside geometry; absent on snapshots taken before that collection existed. */
  readonly paint?: Record<string, string | null>;
}

/** Converts a CDP box-model quad (8 numbers) to its axis-aligned bounding rect. */
export function quadRect(value: unknown): InkRect | undefined {
  if (!Array.isArray(value) || value.length !== 8 || !value.every((entry) => Number.isFinite(entry))) return undefined;
  const xs = [value[0], value[2], value[4], value[6]] as number[];
  const ys = [value[1], value[3], value[5], value[7]] as number[];
  const left = Math.min(...xs), top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

export function baseInkSource(element: GeometryLike): InkSourceResult {
  const rect = quadRect((element.boxModel ?? {}).border);
  if (!rect) return { unavailable: `this target's border-box quad was not captured` };
  return { rect, styles: element.paint ?? {}, provenance: 'base-state geometry record' };
}

function rectFrom(value: unknown): InkRect | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const [x, y, width, height] = [raw.x, raw.y, raw.width ?? raw.w, raw.height ?? raw.h];
  if (![x, y, width, height].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return undefined;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function stylesFrom(value: unknown): InkStyles | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const after = (value as Record<string, unknown>).after;
  if (!after || typeof after !== 'object') return undefined;
  return after as InkStyles;
}

function identityMatches(row: InkTargetIdentity, target: InkTargetIdentity): boolean {
  if (typeof target.backendNodeId === 'number' && typeof row.backendNodeId === 'number') return row.backendNodeId === target.backendNodeId;
  return Boolean(target.selector && row.selector === target.selector);
}

interface StateRow extends InkTargetIdentity {
  readonly relation?: string;
  readonly geometry?: unknown;
  readonly style?: unknown;
}

/**
 * Resolves one element's post-force rect and computed styles from `states.json`.
 * The rect is that element's `getBoundingClientRect` AABB after the force was
 * applied — a border box, which is what `deriveInkBox` grows. Under a forced
 * state the paint change frequently lands on a descendant of the forced target
 * (a hover ring drawn on a child), so `affected.elements` rows are searched
 * alongside the forced target's own record.
 */
export function forcedStateInkSource(states: unknown, target: InkTargetIdentity, state: string): InkSourceResult {
  const elements = (states && typeof states === 'object' && Array.isArray((states as Record<string, unknown>).elements))
    ? (states as { elements: unknown[] }).elements.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : [];
  const forState = elements.filter((record) => String(record.state ?? '') === state);
  if (!forState.length) {
    const recorded = [...new Set(elements.map((record) => String(record.state ?? '')).filter(Boolean))];
    return { unavailable: `this snapshot recorded no "${state}" state${recorded.length ? `; it recorded ${recorded.join(', ')}` : ''}` };
  }
  const unsupported = forState.filter((record) => record.supported === false);
  for (const record of forState) {
    if (record.supported === false) continue;
    const affected = (record.affected && typeof record.affected === 'object' && Array.isArray((record.affected as Record<string, unknown>).elements))
      ? ((record.affected as { elements: unknown[] }).elements.filter((entry): entry is StateRow => Boolean(entry && typeof entry === 'object')))
      : [];
    const own: StateRow = { selector: record.selector as string | undefined, backendNodeId: record.backendNodeId as number | null | undefined, relation: 'target', geometry: record.geometry, style: record.style };
    for (const row of [own, ...affected]) {
      if (!identityMatches(row, target)) continue;
      const rect = rectFrom((row.geometry as Record<string, unknown> | undefined)?.after);
      const styles = stylesFrom(row.style);
      if (!rect) return { unavailable: `the "${state}" record for this target captured no post-force rect` };
      if (!styles) return { unavailable: `the "${state}" record for this target captured no post-force computed styles` };
      const id = String(record.id ?? state);
      return { rect, styles, provenance: `forced state "${state}" (states.json record ${id}, ${row.relation ?? 'affected'} row, post-force values)` };
    }
  }
  if (unsupported.length === forState.length) return { unavailable: `state "${state}" was recorded as unsupported on its forced target` };
  return { unavailable: `no "${state}" record matched this target; forced-state rows cover the forced target, its light-DOM descendants, and its following-sibling subtrees` };
}
