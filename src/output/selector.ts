/**
 * Selector helpers — map a query leaf's `--selector`/`--element` input
 * string to the stored per-element records a snapshot's collector files
 * carry. Pure lookups over an already-read array; this module never reads
 * an artifact file itself (see `src/output/artifact.ts` for that).
 *
 * Contract this module fixes for upstream collector writers: any collector
 * file that indexes elements (`geometry.json` first and foremost — see the
 * contract note at the top of `artifact.ts`) should shape each element's
 * record to satisfy {@link ElementRecord} — a stable `id`, and whichever of
 * `selector`/`backendNodeId`/`axId`/`axName`/`text` it has facts for — so a
 * query leaf's selector lookup works the same way regardless of which
 * collector file it pulled the array from.
 */

// ============================================================================
// Element records
// ============================================================================

export interface ElementRecord {
  /** Stable per-snapshot element id (e.g. `el-14`) collectors key off of. */
  readonly id: string;
  /** The collector-computed CSS-ish selector string for this element
   * (e.g. `.message-card:nth-child(4)`), when known. */
  readonly selector?: string;
  readonly backendNodeId?: number;
  /** Accessibility node id, when the element has a non-ignored AX node. */
  readonly axId?: string;
  /** Accessibility computed name, when known. */
  readonly axName?: string;
  /** Text content associated with the element, when known. */
  readonly text?: string;
  readonly [key: string]: unknown;
}

// ============================================================================
// Direct lookups
// ============================================================================

/** Elements whose stored `selector` exactly equals `selector`. */
export function findBySelector(elements: readonly ElementRecord[], selector: string): ElementRecord[] {
  return elements.filter((e) => e.selector === selector);
}

/** The element with this `backendNodeId`, if any. */
export function findByBackendNodeId(elements: readonly ElementRecord[], backendNodeId: number): ElementRecord | undefined {
  return elements.find((e) => e.backendNodeId === backendNodeId);
}

/** The element with this exact `axId`, if any. */
export function findByAxId(elements: readonly ElementRecord[], axId: string): ElementRecord | undefined {
  return elements.find((e) => e.axId === axId);
}

/** Elements whose `axName` matches `name` — exact (case-insensitive) by
 * default, or a case-insensitive substring match with `{ exact: false }`. */
export function findByAxName(
  elements: readonly ElementRecord[],
  name: string,
  opts: { exact?: boolean } = {},
): ElementRecord[] {
  const exact = opts.exact ?? true;
  const needle = name.toLowerCase();
  return elements.filter((e) => {
    if (e.axName === undefined) return false;
    const hay = e.axName.toLowerCase();
    return exact ? hay === needle : hay.includes(needle);
  });
}

/** Elements whose `text` matches `needle` — case-insensitive substring by
 * default, or an exact (case-insensitive) match with `{ exact: true }`. */
export function findByText(
  elements: readonly ElementRecord[],
  needle: string,
  opts: { exact?: boolean } = {},
): ElementRecord[] {
  const exact = opts.exact ?? false;
  const target = needle.toLowerCase();
  return elements.filter((e) => {
    if (e.text === undefined) return false;
    const hay = e.text.toLowerCase();
    return exact ? hay === target : hay.includes(target);
  });
}

// ============================================================================
// Selector-input grammar
// ============================================================================

export type SelectorInputKind = 'backend' | 'axid' | 'ax' | 'text' | 'css';

export interface ParsedSelectorInput {
  readonly kind: SelectorInputKind;
  readonly value: string;
}

/**
 * Parses a `--selector`/`--element` input string into its lookup kind:
 *  - `backend:1234` — backend node id
 *  - `axid:<id>`    — accessibility node id
 *  - `ax:<name>`    — accessibility name (substring)
 *  - `text:<needle>`— text content (substring)
 *  - anything else  — a CSS-ish selector, matched exactly against the
 *    collector's stored `selector` string (the form every design sample
 *    uses, e.g. `--selector ".toast-container"`)
 */
export function parseSelectorInput(input: string): ParsedSelectorInput {
  const prefixes: Array<[string, SelectorInputKind]> = [
    ['backend:', 'backend'],
    ['axid:', 'axid'],
    ['ax:', 'ax'],
    ['text:', 'text'],
  ];
  for (const [prefix, kind] of prefixes) {
    if (input.startsWith(prefix)) {
      return { kind, value: input.slice(prefix.length) };
    }
  }
  return { kind: 'css', value: input };
}

/**
 * Resolves a `--selector`/`--element` input string to every matching
 * element record, dispatching on {@link parseSelectorInput}'s grammar. This
 * is the one entry point query leaves should call for user-supplied
 * selector input rather than picking a `findBy*` helper themselves.
 */
export function resolveSelectorInput(elements: readonly ElementRecord[], input: string): ElementRecord[] {
  const parsed = parseSelectorInput(input);
  switch (parsed.kind) {
    case 'backend': {
      const id = Number(parsed.value);
      if (!Number.isFinite(id)) return [];
      const found = findByBackendNodeId(elements, id);
      return found ? [found] : [];
    }
    case 'axid': {
      const found = findByAxId(elements, parsed.value);
      return found ? [found] : [];
    }
    case 'ax':
      return findByAxName(elements, parsed.value, { exact: false });
    case 'text':
      return findByText(elements, parsed.value, { exact: false });
    case 'css':
      return findBySelector(elements, parsed.value);
  }
}

// ============================================================================
// Recovery hints
// ============================================================================

export interface SelectorHints {
  readonly selectors: readonly string[];
  readonly axNames: readonly string[];
  readonly texts: readonly string[];
}

function uniqueTruncated(values: readonly (string | undefined)[], limit: number): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    if (v === undefined) continue;
    seen.add(v);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/**
 * Example selector/AX-name/text values present in `elements`, for a query
 * leaf to embed in a "missing selector" structured recovery error (per the
 * design: "missing selector returns a structured recovery error listing
 * available selector forms"). This module only gathers the raw examples —
 * the calling leaf renders them through `src/output/render.ts`'s `data()`
 * so untrusted DOM/AX/text content is escaped before it reaches output.
 */
export function selectorHints(elements: readonly ElementRecord[], limit = 10): SelectorHints {
  return {
    selectors: uniqueTruncated(elements.map((e) => e.selector), limit),
    axNames: uniqueTruncated(elements.map((e) => e.axName), limit),
    texts: uniqueTruncated(elements.map((e) => e.text), limit),
  };
}
