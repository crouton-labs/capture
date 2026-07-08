/**
 * Shared XML-ish prose renderer for `capture measure` and `capture motion`.
 *
 * Every value that could originate from the rendered page (DOM/AX names, CSS
 * source URLs, selectors the page influenced, action labels, text content,
 * etc.) is UNTRUSTED and must reach this module only through the `data()`/
 * `fact` constructors below, which escape and length-cap it. Plain JS
 * template literals or string concatenation must never be assigned directly
 * to a `RenderableResult` field — the `FactLine` nominal shape forces every
 * leaf command through the safe constructors, so this renderer never needs a
 * per-command switch to know what is safe to emit.
 *
 * Binding posture: this module renders measurements and provenance only. It
 * must never grow diagnosis/prescription/grading language of its own — that
 * is entirely the calling leaf's (and ultimately the agent's) job.
 */

// ---------------------------------------------------------------------------
// Trusted tag enum — the ONLY source of a rendered block's tag name. A tag is
// always one of these literals; it is never derived from page/DOM content.
// ---------------------------------------------------------------------------

export const RESULT_TAGS = [
  'snapshot',
  'checks',
  'diff',
  'census',
  'explain',
  'sweep',
  'focus-map',
  'scroll-map',
  'layer-map',
  'recording',
  'motion-mask',
  'timeline',
  'jank',
  'response',
  'error',
] as const;

export type ResultTag = (typeof RESULT_TAGS)[number];

const RESULT_TAG_SET: ReadonlySet<string> = new Set(RESULT_TAGS);

function assertTrustedTag(tag: string): asserts tag is ResultTag {
  if (!RESULT_TAG_SET.has(tag)) {
    throw new Error(
      `render.ts: refusing to render untrusted tag ${JSON.stringify(tag)} — tag must be one of ${RESULT_TAGS.join(', ')}`,
    );
  }
}

const ATTR_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]*$/;

// ---------------------------------------------------------------------------
// Sanitization primitives
// ---------------------------------------------------------------------------

const DEFAULT_DATA_MAX = 200;
const DEFAULT_ATTR_MAX = 200;

/** Strip control characters and collapse newlines/tabs so an untrusted value
 * can never fake a new output line (e.g. a forged `follow_up:` line) or embed
 * invisible/control content. */
function neutralizeControl(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/`/g, "'");
}

function capLength(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…[+${s.length - max} chars]`;
}

/** Escape for use inside XML-ish element text content. */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape for use inside a double-quoted XML-ish attribute value. */
function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;');
}

function sanitizeNumber(n: number): string {
  return Number.isFinite(n) ? String(n) : '0';
}

// ---------------------------------------------------------------------------
// FactLine — the only shape a leaf command may hand render.ts as body/attr
// content. Built exclusively via `text`, `data`, `fact`, and `line` below.
// `text` nodes are developer-authored (source-code string literals) and are
// emitted verbatim; `data` nodes are untrusted values and are always
// escaped + length-capped at render time, in both prose and --json output.
// ---------------------------------------------------------------------------

interface TextNode {
  readonly kind: 'text';
  readonly value: string;
}

interface DataNode {
  readonly kind: 'data';
  readonly value: string | number;
  readonly maxLength?: number;
}

type FactNode = TextNode | DataNode;

/** A safe, already-composed line/paragraph of output. The only way to obtain
 * one is `text()`, `data()`, `fact` tag, or `line()` — never a raw string. */
export type FactLine = readonly FactNode[];

/** Marks a value for embedding with a custom (non-default) length cap. Use
 * for long DOM/text/CSS-source values that need a bigger quoted-data cap. */
export interface Capped {
  readonly __capped: true;
  readonly value: string | number;
  readonly maxLength: number;
}

export function capped(value: string | number, maxLength: number): Capped {
  return { __capped: true, value, maxLength };
}

function isCapped(v: unknown): v is Capped {
  return typeof v === 'object' && v !== null && (v as Capped).__capped === true;
}

/** Static, developer-authored text — emitted verbatim (never treated as
 * page/DOM-derived). Never pass page content here; use `data()` instead. */
export function text(value: string): FactLine {
  return [{ kind: 'text', value }];
}

/** An untrusted value (selector, DOM/AX name, CSS source URL, action label,
 * text content, id, path, …). Always escaped and length-capped before it
 * reaches either the rendered prose or the --json output. */
export function data(value: string | number | Capped, maxLength?: number): FactLine {
  if (isCapped(value)) {
    return [{ kind: 'data', value: value.value, maxLength: value.maxLength }];
  }
  return [{ kind: 'data', value, maxLength }];
}

/** Concatenate FactLines (and/or trusted literal strings) into one FactLine,
 * optionally joined by a fixed, trusted separator. */
export function line(...parts: Array<FactLine | string>): FactLine {
  const out: FactNode[] = [];
  for (const p of parts) {
    if (typeof p === 'string') out.push({ kind: 'text', value: p });
    else out.push(...p);
  }
  return out;
}

function joinFactLines(lines: readonly FactLine[], sep: string): FactLine {
  const out: FactNode[] = [];
  lines.forEach((l, i) => {
    if (i > 0) out.push({ kind: 'text', value: sep });
    out.push(...l);
  });
  return out;
}

type FactValue = string | number | Capped;

/** Tagged-template builder for a FactLine. The static template segments
 * (`strings`) are trusted, developer-authored prose and are emitted as-is;
 * every interpolated `${value}` is treated as untrusted data and is escaped
 * + length-capped exactly like `data()`. This is the primary way leaf
 * commands compose readable measurement prose without hand-rolling escaping.
 *
 *   fact`\`${selector}\` right edge at x=${rect.x}, ${overflowPx}px past the viewport edge`
 */
export function fact(strings: TemplateStringsArray, ...values: FactValue[]): FactLine {
  const out: FactNode[] = [];
  strings.forEach((s, i) => {
    if (s) out.push({ kind: 'text', value: s });
    if (i < values.length) out.push(...data(values[i]));
  });
  return out;
}

function resolveDataNode(node: DataNode, mode: 'xml' | 'json'): string {
  if (typeof node.value === 'number') return sanitizeNumber(node.value);
  const cleaned = neutralizeControl(String(node.value));
  const capped = capLength(cleaned, node.maxLength ?? DEFAULT_DATA_MAX);
  return mode === 'xml' ? escapeXmlText(capped) : capped;
}

function resolveFactLine(fl: FactLine, mode: 'xml' | 'json'): string {
  let out = '';
  for (const node of fl) {
    out += node.kind === 'text' ? node.value : resolveDataNode(node, mode);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Attestation — snapshot/recording identity carried by (almost) every result.
// ---------------------------------------------------------------------------

export interface Attestation {
  readonly kind: 'snapshot' | 'recording';
  /** Snapshot or recording id, e.g. "snap-a3f2" / "rec-9f31". */
  readonly id: string;
  /** Absolute artifact directory path. */
  readonly path: string;
  /** Optional method/settledness/timing note rendered as the first body
   * line (e.g. "Settled after 410ms …", "Clock baselines in markers.json …"). */
  readonly note?: FactLine;
}

// ---------------------------------------------------------------------------
// RenderableResult — the envelope every measure/motion leaf builds and
// hands to renderResult()/emitResult().
// ---------------------------------------------------------------------------

export type ResultAttrs = Record<string, string | number | boolean | undefined>;

export interface RenderableResult {
  /** Trusted block tag — must be one of RESULT_TAGS. */
  readonly tag: ResultTag;
  /** Opening-tag attributes. Values are sanitized/escaped by this module —
   * leaf commands may pass raw strings here (including page-derived ones). */
  readonly attrs?: ResultAttrs;
  /** Snapshot/recording identity + optional method note. */
  readonly attestation?: Attestation;
  /** Lead sentence(s), rendered immediately after the opening tag. */
  readonly summary?: FactLine;
  /** Pre-formatted artifact listing (typically via formatArtifactList),
   * rendered directly under the summary with no blank line. */
  readonly artifacts?: FactLine;
  /** Additional body paragraphs/blocks, each separated by a blank line. A
   * single FactLine may itself contain internal `\n` (from `text()`) to
   * represent a multi-line paragraph that should NOT be blank-line split. */
  readonly sections?: readonly FactLine[];
  /** A single follow_up line, built only from trusted command templates via
   * `fact`/`text`/`data` — ids/paths are always embedded as escaped data,
   * never as literal instruction text. */
  readonly followUp?: FactLine;
}

function renderAttrValue(raw: string | number | boolean): string {
  if (typeof raw === 'number') return sanitizeNumber(raw);
  if (typeof raw === 'boolean') return String(raw);
  const cleaned = neutralizeControl(raw);
  return escapeXmlAttr(capLength(cleaned, DEFAULT_ATTR_MAX));
}

function jsonAttrValue(raw: string | number | boolean): string | number | boolean {
  if (typeof raw !== 'string') return raw;
  return capLength(neutralizeControl(raw), DEFAULT_ATTR_MAX);
}

function renderAttrs(attrs: ResultAttrs): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(attrs)) {
    if (raw === undefined) continue;
    if (!ATTR_KEY_PATTERN.test(key)) {
      throw new Error(`render.ts: invalid attribute key ${JSON.stringify(key)}`);
    }
    parts.push(` ${key}="${renderAttrValue(raw)}"`);
  }
  return parts.join('');
}

function assembleBody(result: RenderableResult): string {
  const header: string[] = [];
  if (result.attestation?.note) header.push(resolveFactLine(result.attestation.note, 'xml'));
  if (result.summary) header.push(resolveFactLine(result.summary, 'xml'));
  if (result.artifacts) header.push(resolveFactLine(result.artifacts, 'xml'));

  const sections = (result.sections ?? [])
    .map((s) => resolveFactLine(s, 'xml'))
    .filter((s) => s.length > 0);

  const blocks = [header.join('\n'), sections.join('\n\n')].filter((b) => b.length > 0);
  return blocks.join('\n\n');
}

/** Render the default (non-JSON) XML-ish prose block for a result. Pure
 * function — never writes to stdout. */
export function renderResult(result: RenderableResult): string {
  assertTrustedTag(result.tag);
  const attrsStr = renderAttrs(result.attrs ?? {});
  const body = assembleBody(result);
  const block = `<${result.tag}${attrsStr}>\n${body}\n</${result.tag}>`;
  if (!result.followUp) return block;
  return `${block}\nfollow_up: ${resolveFactLine(result.followUp, 'xml')}`;
}

/** Build the plain-object JSON mirror of a result, applying the same
 * length-cap / control-char redaction as the prose renderer (minus XML
 * entity escaping, which JSON.stringify already makes unnecessary). */
export function toJsonResult(result: RenderableResult): Record<string, unknown> {
  assertTrustedTag(result.tag);
  const attrs = Object.fromEntries(
    Object.entries(result.attrs ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, jsonAttrValue(v as string | number | boolean)]),
  );

  const out: Record<string, unknown> = { tag: result.tag, attrs };

  if (result.attestation) {
    out.attestation = {
      kind: result.attestation.kind,
      id: capLength(neutralizeControl(result.attestation.id), DEFAULT_ATTR_MAX),
      path: capLength(neutralizeControl(result.attestation.path), 400),
      note: result.attestation.note ? resolveFactLine(result.attestation.note, 'json') : undefined,
    };
  }
  if (result.summary) out.summary = resolveFactLine(result.summary, 'json');
  if (result.artifacts) out.artifacts = resolveFactLine(result.artifacts, 'json');
  if (result.sections?.length) out.sections = result.sections.map((s) => resolveFactLine(s, 'json'));
  if (result.followUp) out.followUp = resolveFactLine(result.followUp, 'json');

  return out;
}

/** Render + write a result to stdout: prose by default, pretty JSON mirror
 * under `--json`, both under the same redaction policy. Returns the emitted
 * string (for composability/tests) as well as writing it. */
export function emitResult(result: RenderableResult, opts: { json?: boolean } = {}): string {
  const output = opts.json ? JSON.stringify(toJsonResult(result), null, 2) : renderResult(result);
  process.stdout.write(`${output}\n`);
  return output;
}

// ---------------------------------------------------------------------------
// Shared formatting helpers
// ---------------------------------------------------------------------------

export interface CoordinateInput {
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
}

/** "x=360 y=712 w=44 h=44" (w/h omitted when not given, e.g. a bare point). */
export function formatCoordinate(c: CoordinateInput): FactLine {
  const parts: FactLine[] = [line(text('x='), data(c.x)), line(text('y='), data(c.y))];
  if (c.w !== undefined) parts.push(line(text('w='), data(c.w)));
  if (c.h !== undefined) parts.push(line(text('h='), data(c.h)));
  return joinFactLines(parts, ' ');
}

export interface ArtifactEntry {
  /** File/dir name or id-relative path, e.g. "geometry.json". */
  readonly name: string;
  /** Optional trailing description, e.g. "214 elements: rect + quads". */
  readonly note?: string;
}

/** "Artifacts: geometry.json (214 elements: …), styles.json (…), …" */
export function formatArtifactList(entries: readonly ArtifactEntry[]): FactLine {
  if (entries.length === 0) return text('Artifacts: (none)');
  const items = entries.map((e) =>
    e.note
      ? line(data(e.name, 200), text(' ('), data(e.note, 400), text(')'))
      : line(data(e.name, 200)),
  );
  return line(text('Artifacts: '), joinFactLines(items, ', '));
}

export interface ProvenanceInput {
  /** The selector/name identifying the element or property owner. */
  readonly selector: string;
  /** file:line or an equivalent source reference, when available. */
  readonly source?: string;
  /** CSS specificity or an equivalent ranking string, e.g. "0-2-0". */
  readonly specificity?: string;
  /** Extra trailing fact prose (already a FactLine — e.g. built via `fact`). */
  readonly extra?: FactLine;
}

/** "winning declaration for `<selector>` is `<source>` (specificity <n>)" */
export function formatProvenance(p: ProvenanceInput): FactLine {
  const parts: FactLine[] = [
    line(text('winning declaration for `'), data(p.selector, 300), text('`')),
  ];
  if (p.source) parts.push(line(text('is `'), data(p.source, 300), text('`')));
  if (p.specificity) parts.push(line(text('specificity '), data(p.specificity, 40)));
  let result = joinFactLines(parts, ' ');
  if (p.extra) result = joinFactLines([result, p.extra], ' — ');
  return result;
}

export interface FindingInput {
  /** Short category label from the leaf's own fixed vocabulary, e.g.
   * "offscreen", "overlap", "truncation". Still treated as untrusted data. */
  readonly kind: string;
  /** The finding's headline fact, e.g. built via `fact`. */
  readonly headline: FactLine;
  /** Additional indented detail lines. */
  readonly detail?: readonly FactLine[];
  /** Optional crop/finding artifact path, rendered as "crop: <path>". */
  readonly artifactPath?: string;
}

/** Numbered findings list, one blank-line-separated FactLine per finding —
 * assign the result directly to (or spread into) `sections`. */
export function formatFindings(findings: readonly FindingInput[]): FactLine[] {
  return findings.map((f, i) => {
    const headlineLine = line(text(`${i + 1}. `), data(f.kind, 60), text(' — '), f.headline);
    const detailLines = (f.detail ?? []).map((d) => line(text('   '), d));
    const cropLine = f.artifactPath ? [line(text('   crop: '), data(f.artifactPath, 400))] : [];
    return joinFactLines([headlineLine, ...detailLines, ...cropLine], '\n');
  });
}
