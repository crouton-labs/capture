/**
 * Shared XML-ish prose renderer for `capture measure` and `capture motion`.
 *
 * Every value that could originate from the rendered page (DOM/AX names, CSS
 * source URLs, selectors the page influenced, action labels, text content,
 * etc.) is UNTRUSTED and must reach this module only through the `data()`/
 * `fact` constructors below, which escape and length-cap it. Plain JS
 * template literals or string concatenation must never be assigned directly
 * to a `RenderableResult` field — every `FactLine` node is branded (an
 * unexported symbol only this module's own `text`/`data`/`fact`/`line`/
 * `lineList` constructors can attach) and every composition/emission path
 * runtime-rejects an unbranded node, so a leaf command cannot bypass the
 * safe constructors even by hand-constructing an object that structurally
 * matches a `FactLine` — this renderer never needs a per-command switch to
 * know what is safe to emit.
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
 * can never fake a new output line (e.g. a forged `follow_up:` line), smuggle
 * a raw ANSI/terminal escape, or embed invisible content. This strips:
 *  - the FULL control range — C0 (\u0000-\u001F) minus \r\n\t (normalized to
 *    a space below), DEL (\u007F), and C1 (\u0080-\u009F, which includes
 *    \u009B CSI and \u009D OSC — terminals interpret these as ANSI *without*
 *    a leading ESC byte, so stripping only C0/DEL is not sufficient);
 *  - \u2028/\u2029 (Unicode LINE SEPARATOR / PARAGRAPH SEPARATOR), which act
 *    as line breaks to many downstream readers despite not being C0/C1 —
 *    normalized to a space alongside \r\n\t rather than merely stripped, so
 *    word-adjacency is preserved the same way a real line break would be;
 *  - every Unicode *format* control character via the `\p{Cf}` Unicode
 *    property escape (requires the regex `u` flag) — this is a general,
 *    class-level rule rather than an enumerated codepoint list, so it
 *    covers every invisible/bidi-influencing format control in one pass:
 *    zero-width space/joiners, bidi embedding/override/isolate controls,
 *    U+061C ARABIC LETTER MARK, U+00AD SOFT HYPHEN, U+FEFF BOM/ZWNBSP, and
 *    any other current or future codepoint Unicode assigns category Cf.
 * No untrusted value can hide non-printing content or fake a line break. */
function neutralizeControl(s: string): string {
  return s
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\p{Cf}/gu, '')
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
// `text` nodes are developer-authored, STATIC source-code string literals —
// `text` is a no-substitution tagged template (`` text`Artifacts: ` ``), not
// an ordinary function, so there is no verbatim-dynamic-string call shape a
// leaf author could pass an untrusted runtime value through by mistake.
// `data` nodes are untrusted values and are always escaped + length-capped
// at render time, in both prose and --json output. `line()` only accepts
// already-safe FactLine values (never a raw string) for the same reason.
// ---------------------------------------------------------------------------

/** Unexported brand symbol. `TextNode`/`DataNode` are not exported — only
 * the opaque `FactLine` element type is — and every node this module's own
 * constructors produce carries this symbol key. Because the symbol value
 * itself is never exported, no code outside this module can name it, so no
 * outside object literal can carry this property — not even one that
 * otherwise matches `{kind:'text', value: string}` structurally. This is
 * what makes a hand-constructed `{kind:'text', value: untrusted}` object
 * REJECTED rather than merely "not the intended call shape": TypeScript's
 * structural typing can't be fooled into accepting it (the required brand
 * property is missing), and even a caller who bypasses the type system
 * entirely (`as any`/`as FactLine`) still fails the runtime brand check
 * every composition and emission path below performs before trusting a
 * node. There is no way to construct a validly-branded node without going
 * through `text()`/`data()`/`fact()`/`line()`/`lineList()`. */
const NODE_BRAND: unique symbol = Symbol('render.ts:factNode');

interface TextNode {
  readonly kind: 'text';
  readonly value: string;
  readonly [NODE_BRAND]: true;
}

interface DataNode {
  readonly kind: 'data';
  readonly value: string | number;
  readonly maxLength?: number;
  readonly [NODE_BRAND]: true;
}

type FactNode = TextNode | DataNode;

function mkTextNode(value: string): TextNode {
  return { kind: 'text', value, [NODE_BRAND]: true };
}

function mkDataNode(value: string | number, maxLength?: number): DataNode {
  return { kind: 'data', value, maxLength, [NODE_BRAND]: true };
}

function isFactNode(v: unknown): v is FactNode {
  if (typeof v !== 'object' || v === null) return false;
  const n = v as Record<string | symbol, unknown>;
  if (n[NODE_BRAND] !== true) return false;
  if (n.kind === 'text') return typeof n.value === 'string';
  if (n.kind === 'data') return typeof n.value === 'string' || typeof n.value === 'number';
  return false;
}

/** Runtime backstop for every place a leaf command hands render.ts a
 * FactLine — `summary`/`sections`/`followUp`/`attestation.note`, every
 * `line()`/`joinFactLines()` composition, and `lineList()`'s rows. A leaf
 * author (or any caller that bypasses the type system with `as`/`any`) can
 * still hand-construct a plain array of plain objects matching the
 * structural shape of a `FactLine`; this rejects any such value — and any
 * individual node within an otherwise-real `FactLine` that isn't branded —
 * by throwing, so an untrusted value can never reach output verbatim
 * through a structural bypass, regardless of which entry point it targets. */
function assertFactLine(fl: unknown, context: string): asserts fl is FactLine {
  if (!Array.isArray(fl)) {
    throw new Error(
      `render.ts: ${context} must be a FactLine built via text\`\`/data()/fact\`\`/line()/lineList() — not a raw value`,
    );
  }
  for (const node of fl) {
    if (!isFactNode(node)) {
      throw new Error(
        `render.ts: ${context} contains an unbranded/hand-constructed node — every FactLine node must come from this module's own text\`\`/data()/fact\`\`/line()/lineList() constructors, never a hand-built object literal`,
      );
    }
  }
}

/** A safe, already-composed line/paragraph of output. The only way to obtain
 * one is `text()`, `data()`, `fact` tag, or `line()` — never a raw string,
 * and never a hand-built object literal (see `assertFactLine` above). */
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
 * page/DOM-derived). Safe by construction: `text` is a no-substitution
 * tagged template literal (`` text`Artifacts: ` ``), not an ordinary
 * function, so a leaf author cannot pass a runtime/page-derived string
 * through it even by mistake — the call shape that would allow it doesn't
 * type-check, and is also rejected at runtime (see below) for callers that
 * bypass the type system. Never pass page content here; use `data()` (or
 * `fact` for prose with untrusted interpolation) instead. */
export function text(strings: TemplateStringsArray): FactLine {
  if (!Array.isArray(strings) || !('raw' in strings)) {
    throw new Error(
      'render.ts: text`` must be invoked as a tagged template literal, e.g. text`Artifacts: ` — not called with a runtime string',
    );
  }
  if (strings.length !== 1) {
    throw new Error('render.ts: text`` does not accept interpolation — use fact`` or data() for dynamic values');
  }
  return [mkTextNode(strings[0])];
}

/** An untrusted value (selector, DOM/AX name, CSS source URL, action label,
 * text content, id, path, …). Always escaped and length-capped before it
 * reaches either the rendered prose or the --json output. */
export function data(value: string | number | Capped, maxLength?: number): FactLine {
  if (isCapped(value)) {
    return [mkDataNode(value.value, value.maxLength)];
  }
  return [mkDataNode(value, maxLength)];
}

/** Concatenate already-safe FactLines into one FactLine. Only accepts
 * FactLine values built via `text`/`data`/`fact`/`line` itself — never a raw
 * string — so there is no call shape through which an unescaped runtime
 * value reaches output. A caller that bypasses the type system and passes a
 * raw string anyway is rejected at runtime rather than silently accepted. */
export function line(...parts: readonly FactLine[]): FactLine {
  const out: FactNode[] = [];
  for (const p of parts) {
    if (!Array.isArray(p)) {
      throw new Error('render.ts: line() only accepts FactLine values (from text``/data()/fact``/line()) — not raw strings');
    }
    assertFactLine(p, 'line() argument');
    out.push(...p);
  }
  return out;
}

function joinFactLines(lines: readonly FactLine[], sep: string): FactLine {
  const out: FactNode[] = [];
  lines.forEach((l, i) => {
    assertFactLine(l, 'joined FactLine');
    if (i > 0) out.push(mkTextNode(sep));
    out.push(...l);
  });
  return out;
}

/** Join multiple FactLines with a single newline (no blank line) — for
 * preformatted, row-oriented blocks like a motion timeline/response where
 * consecutive rows (e.g. `t=0.000s ...`, `t=3.81s ...`) must NOT be
 * blank-line separated. Assign the result to one `sections` entry (or to
 * `summary`) so `assembleBody`'s blank-line splitting between sections
 * treats the whole block as a single paragraph, matching the design
 * samples' exact layout. Still fully safe — it only concatenates FactLines
 * that were themselves built via `text`/`data`/`fact`. */
export function lineList(lines: readonly FactLine[]): FactLine {
  return joinFactLines(lines, '\n');
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
  if (!Array.isArray(strings) || !('raw' in strings)) {
    throw new Error('render.ts: fact`` must be invoked as a tagged template literal — not called with a runtime string');
  }
  const out: FactNode[] = [];
  strings.forEach((s, i) => {
    if (s) out.push(mkTextNode(s));
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
  assertFactLine(fl, 'rendered FactLine');
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
   * leaf commands may pass raw strings here (including page-derived ones).
   * If `attestation` is also set, its `path` and id (`snap`/`rec` by kind)
   * are the CANONICAL values for those keys and are always merged in —
   * leaves need not duplicate them manually. Supplying a matching value
   * here is a harmless no-op; supplying a DIFFERENT value for one of these
   * keys throws (attestation identity cannot be overridden or forged). */
  readonly attrs?: ResultAttrs;
  /** Snapshot/recording identity + optional method note. */
  readonly attestation?: Attestation;
  /** Lead sentence(s), rendered immediately after the opening tag. */
  readonly summary?: FactLine;
  /** Pre-formatted artifact listing (typically via formatArtifactList),
   * rendered directly under the summary with no blank line. */
  readonly artifacts?: FactLine;
  /** Additional body paragraphs/blocks, each separated by a blank line. A
   * single FactLine may itself contain internal `\n` (a static `text`
   * literal, or dynamic rows joined via `lineList()`) to represent a
   * multi-line paragraph/preformatted block that should NOT be blank-line
   * split — e.g. a motion timeline's consecutive `t=...` rows. */
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

/** Shared attribute-key validation — enforced identically by the prose
 * (`renderAttrs`) and --json (`toJsonResult`) paths, so an attribute key
 * the prose renderer would refuse can never sneak through as JSON only. */
function assertValidAttrKey(key: string): void {
  if (!ATTR_KEY_PATTERN.test(key)) {
    throw new Error(`render.ts: invalid attribute key ${JSON.stringify(key)}`);
  }
}

function renderAttrs(attrs: ResultAttrs): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(attrs)) {
    if (raw === undefined) continue;
    assertValidAttrKey(key);
    parts.push(` ${key}="${renderAttrValue(raw)}"`);
  }
  return parts.join('');
}

/** Merge attestation identity into the opening-tag attrs, matching the
 * design samples' shape (e.g. `<snapshot path="..." ...>`, `<focus-map
 * snap="snap-a3f2" ...>`, `<jank rec="rec-9f31" ...>`). Attestation is the
 * CANONICAL source for the identity keys (`path`, and `snap`/`rec` by
 * kind) — it always wins, so prose and JSON can never disagree at the
 * provenance boundary. A leaf need not duplicate `attestation.path`/`.id`
 * into `attrs` at all; if it does anyway, an identical duplicate is
 * accepted silently (no-op), but a DIFFERENT value is a REJECTED conflict
 * (throws) rather than a silent override — a leaf that could silently
 * suppress the real identity in prose while JSON kept the true one is
 * exactly the forgeable-identity bug this closes, so a mismatch here is
 * treated as a real bug that must surface loudly. Applied identically by
 * the prose and --json paths. */
function mergeAttestationAttrs(attrs: ResultAttrs, attestation?: Attestation): ResultAttrs {
  if (!attestation) return attrs;
  const idKey = attestation.kind === 'snapshot' ? 'snap' : 'rec';
  const canonical: ResultAttrs = { path: attestation.path, [idKey]: attestation.id };

  for (const [key, canonicalValue] of Object.entries(canonical)) {
    const existing = attrs[key];
    if (existing !== undefined && existing !== canonicalValue) {
      throw new Error(
        `render.ts: attrs.${key}=${JSON.stringify(existing)} conflicts with the attestation's canonical ${key}=${JSON.stringify(canonicalValue)} — attestation identity is canonical and a leaf must not supply a different value for ${key} (an identical duplicate is fine; omit it entirely and let attestation supply it)`,
      );
    }
  }

  // Canonical identity keys (path, then snap/rec) come first, matching the
  // design samples' attribute order (e.g. `<focus-map snap="..." stops=...>`);
  // remaining leaf-supplied attrs follow in their original order.
  const merged: ResultAttrs = { ...canonical };
  for (const [key, value] of Object.entries(attrs)) {
    if (key in canonical) continue;
    merged[key] = value;
  }
  return merged;
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
  const attrsStr = renderAttrs(mergeAttestationAttrs(result.attrs ?? {}, result.attestation));
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
  const mergedAttrs = mergeAttestationAttrs(result.attrs ?? {}, result.attestation);
  const attrs = Object.fromEntries(
    Object.entries(mergedAttrs)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        assertValidAttrKey(k);
        return [k, jsonAttrValue(v as string | number | boolean)];
      }),
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
  const parts: FactLine[] = [line(text`x=`, data(c.x)), line(text`y=`, data(c.y))];
  if (c.w !== undefined) parts.push(line(text`w=`, data(c.w)));
  if (c.h !== undefined) parts.push(line(text`h=`, data(c.h)));
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
  if (entries.length === 0) return text`Artifacts: (none)`;
  const items = entries.map((e) =>
    e.note
      ? line(data(e.name, 200), text` (`, data(e.note, 400), text`)`)
      : line(data(e.name, 200)),
  );
  return line(text`Artifacts: `, joinFactLines(items, ', '));
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
    line(text`winning declaration for \``, data(p.selector, 300), text`\``),
  ];
  if (p.source) parts.push(line(text`is \``, data(p.source, 300), text`\``));
  if (p.specificity) parts.push(line(text`specificity `, data(p.specificity, 40)));
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
    const headlineLine = line(fact`${i + 1}. `, data(f.kind, 60), text` — `, f.headline);
    const detailLines = (f.detail ?? []).map((d) => line(text`   `, d));
    const cropLine = f.artifactPath ? [line(text`   crop: `, data(f.artifactPath, 400))] : [];
    return joinFactLines([headlineLine, ...detailLines, ...cropLine], '\n');
  });
}
