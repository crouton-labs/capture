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
  /** The element's own captured HTML attributes, keyed by attribute name. */
  readonly attributes?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

// ============================================================================
// Direct lookups
// ============================================================================

interface AttributeMatcher {
  readonly name: string;
  readonly value?: string;
}

interface CompoundMatcher {
  readonly tag?: string;
  readonly id?: string;
  readonly classes: readonly string[];
  readonly attributes: readonly AttributeMatcher[];
  readonly nthOfType?: number;
}

type Combinator = 'child' | 'descendant';

interface CssMatcher {
  readonly compounds: readonly CompoundMatcher[];
  /** The relation between compound i and compound i + 1. */
  readonly combinators: readonly Combinator[];
}

function isNameStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_*]/.test(char);
}

function isNameChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_-]/.test(char);
}

function readName(value: string, start: number): { value: string; end: number } | undefined {
  if (!isNameStart(value[start])) return undefined;
  let end = start + 1;
  while (isNameChar(value[end])) end += 1;
  return { value: value.slice(start, end), end };
}

function unquoteCssValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return /\s/.test(trimmed) ? undefined : trimmed;
}

function parseAttribute(value: string): AttributeMatcher | undefined {
  const equals = value.indexOf('=');
  const name = (equals === -1 ? value : value.slice(0, equals)).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_:-]*$/.test(name)) return undefined;
  if (equals === -1) return { name: name.toLowerCase() };
  const attributeValue = unquoteCssValue(value.slice(equals + 1));
  return attributeValue === undefined ? undefined : { name: name.toLowerCase(), value: attributeValue };
}

function parseCompound(value: string): CompoundMatcher | undefined {
  let index = 0;
  let tag: string | undefined;
  const first = readName(value, index);
  if (first) {
    tag = first.value.toLowerCase();
    index = first.end;
  }
  const classes: string[] = [];
  const attributes: AttributeMatcher[] = [];
  let id: string | undefined;
  let nthOfType: number | undefined;
  while (index < value.length) {
    const marker = value[index]!;
    if (marker === '.' || marker === '#') {
      const name = readName(value, index + 1);
      if (!name) return undefined;
      if (marker === '.') classes.push(name.value);
      else if (id === undefined) id = name.value;
      else return undefined;
      index = name.end;
      continue;
    }
    if (marker === '[') {
      let end = index + 1;
      let quote: string | undefined;
      while (end < value.length) {
        const char = value[end]!;
        if (quote) {
          if (char === '\\') end += 2;
          else {
            if (char === quote) quote = undefined;
            end += 1;
          }
        } else if (char === '"' || char === "'") {
          quote = char;
          end += 1;
        } else if (char === ']') break;
        else end += 1;
      }
      if (quote || value[end] !== ']') return undefined;
      const attribute = parseAttribute(value.slice(index + 1, end));
      if (!attribute) return undefined;
      attributes.push(attribute);
      index = end + 1;
      continue;
    }
    if (value.startsWith(':nth-of-type(', index)) {
      const end = value.indexOf(')', index);
      const rawIndex = value.slice(index + ':nth-of-type('.length, end);
      if (end === -1 || !/^\d+$/.test(rawIndex) || nthOfType !== undefined) return undefined;
      nthOfType = Number(rawIndex);
      index = end + 1;
      continue;
    }
    return undefined;
  }
  return tag || id || classes.length || attributes.length || nthOfType !== undefined ? { tag, id, classes, attributes, nthOfType } : undefined;
}

function parseCssMatcher(rawInput: string): CssMatcher | undefined {
  const input = rawInput.trim();
  const compounds: CompoundMatcher[] = [];
  const combinators: Combinator[] = [];
  let index = 0;
  let pendingCombinator: Combinator | undefined;
  while (index < input.length) {
    let sawWhitespace = false;
    while (/\s/.test(input[index] ?? '')) {
      sawWhitespace = true;
      index += 1;
    }
    if (index >= input.length) return undefined;
    if (input[index] === '>') {
      if (!compounds.length || pendingCombinator) return undefined;
      pendingCombinator = 'child';
      index += 1;
      continue;
    }
    if (compounds.length && !pendingCombinator) pendingCombinator = sawWhitespace ? 'descendant' : undefined;
    if (compounds.length && !pendingCombinator) return undefined;
    const start = index;
    let bracketDepth = 0;
    let quote: string | undefined;
    while (index < input.length) {
      const char = input[index]!;
      if (quote) {
        if (char === '\\') index += 2;
        else {
          if (char === quote) quote = undefined;
          index += 1;
        }
      } else if (char === '"' || char === "'") {
        quote = char;
        index += 1;
      } else if (char === '[') {
        bracketDepth += 1;
        index += 1;
      } else if (char === ']') {
        bracketDepth -= 1;
        if (bracketDepth < 0) return undefined;
        index += 1;
      } else if (bracketDepth === 0 && (char === '>' || /\s/.test(char))) break;
      else index += 1;
    }
    if (quote || bracketDepth !== 0) return undefined;
    const compound = parseCompound(input.slice(start, index));
    if (!compound) return undefined;
    if (compounds.length) combinators.push(pendingCombinator!);
    compounds.push(compound);
    pendingCombinator = undefined;
  }
  return compounds.length && !pendingCombinator ? { compounds, combinators } : undefined;
}

function elementAttributes(element: ElementRecord): Readonly<Record<string, string>> {
  return element.attributes ?? {};
}

function terminalGeneratedCompound(element: ElementRecord): CompoundMatcher | undefined {
  const selector = element.selector;
  if (!selector) return undefined;
  const parts = parseCssMatcher(selector)?.compounds;
  return parts?.at(-1);
}

function matchesCompound(element: ElementRecord, compound: CompoundMatcher): boolean {
  const tag = element.tag;
  if (compound.tag && compound.tag !== '*' && (typeof tag !== 'string' || tag.toLowerCase() !== compound.tag)) return false;
  const attributes = elementAttributes(element);
  const generated = terminalGeneratedCompound(element);
  const actualId = attributes.id ?? generated?.id;
  if (compound.id && actualId !== compound.id) return false;
  const classNames = new Set((attributes.class ?? '').split(/\s+/).filter(Boolean));
  for (const className of generated?.classes ?? []) classNames.add(className);
  if (compound.classes.some((className) => !classNames.has(className))) return false;
  for (const attribute of compound.attributes) {
    const actual = Object.entries(attributes).find(([name]) => name.toLowerCase() === attribute.name)?.[1];
    if (actual === undefined || (attribute.value !== undefined && actual !== attribute.value)) return false;
  }
  if (compound.nthOfType !== undefined && generated?.nthOfType !== compound.nthOfType) return false;
  return true;
}

function pathSegments(element: ElementRecord): readonly string[] | undefined {
  const domPath = element.domPath;
  return typeof domPath === 'string' && domPath ? domPath.split('/') : undefined;
}

function treeScope(element: ElementRecord): string | undefined {
  const frame = element.frame;
  if (typeof frame !== 'object' || frame === null || typeof (frame as Record<string, unknown>).frameId !== 'string') return undefined;
  const shadow = element.shadow;
  if (typeof shadow !== 'object' || shadow === null || (shadow as Record<string, unknown>).inShadowDom !== true) return `${(frame as Record<string, unknown>).frameId}:light`;
  const values = shadow as Record<string, unknown>;
  return `${(frame as Record<string, unknown>).frameId}:shadow:${String(values.chainDepth)}:${String(values.hostSelector)}`;
}

function isAncestorOf(ancestor: ElementRecord, descendant: ElementRecord, direct: boolean): boolean {
  const ancestorPath = pathSegments(ancestor);
  const descendantPath = pathSegments(descendant);
  if (!ancestorPath || !descendantPath || ancestorPath.length >= descendantPath.length || treeScope(ancestor) !== treeScope(descendant)) return false;
  if (direct && ancestorPath.length !== descendantPath.length - 1) return false;
  return ancestorPath.every((segment, index) => descendantPath[index] === segment);
}

function matchesCssMatcher(elements: readonly ElementRecord[], target: ElementRecord, matcher: CssMatcher, index = matcher.compounds.length - 1): boolean {
  if (!matchesCompound(target, matcher.compounds[index]!)) return false;
  if (index === 0) return true;
  const direct = matcher.combinators[index - 1] === 'child';
  return elements.some((candidate) => isAncestorOf(candidate, target, direct) && matchesCssMatcher(elements, candidate, matcher, index - 1));
}

/** Elements matching the supported CSS subset against their recorded DOM facts.
 * A verbatim collector-generated selector remains an exact lookup. */
export function findBySelector(elements: readonly ElementRecord[], selector: string): ElementRecord[] {
  const exact = elements.filter((element) => element.selector === selector);
  if (exact.length) return exact;
  const matcher = parseCssMatcher(selector);
  return matcher ? elements.filter((element) => matchesCssMatcher(elements, element, matcher)) : [];
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
 *  - anything else  — a supported CSS selector: tag, `#id`, `.class`,
 *    `[attr]`, `[attr="value"]`, and descendant/child compound sequences,
 *    or a verbatim collector-generated selector path.
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
