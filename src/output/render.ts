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
  'session',
  'session-stopped',
  'sessions',
  'session-har',
  'log-tail',
  'clicked',
  'typed',
  'scrolled',
  'navigated',
  'exec-result',
  'elements',
  'screenshot',
  'tabs',
  'tab-opened',
  'tab-closed',
  'tab-reset',
  'network',
  'cdp-result',
  'libs',
  'lib',
  'ax-map',
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

// XML name-start characters this renderer treats as beginning a tag-like span.
// This is the FULL XML 1.0 NameStartChar production, including the astral
// #x10000-#xEFFFF plane: ASCII letters, `_`/`:`, the Unicode letter/name-start
// BMP ranges XML permits, and astral name-start code points. The `u` flag makes
// the class code-point-aware so an astral name-start char (a surrogate pair such
// as `𐀀`, U+10000) is matched as one code point, not a lone surrogate. So
// hostile, page-derived but XML-valid names — `<_hostile>`, `<évil>`, `<Ω>`,
// `<名>`, `<𐀀>` — are neutralized like any `<tag>` rather than slipping through
// because they aren't ASCII-letter-led or sit outside the BMP.
const TAG_NAME_START =
  /[:A-Z_a-z\u{C0}-\u{D6}\u{D8}-\u{F6}\u{F8}-\u{2FF}\u{370}-\u{37D}\u{37F}-\u{1FFF}\u{200C}\u{200D}\u{2070}-\u{218F}\u{2C00}-\u{2FEF}\u{3001}-\u{D7FF}\u{F900}-\u{FDCF}\u{FDF0}-\u{FFFD}\u{10000}-\u{EFFFF}]/u;

// The additional characters XML 1.0 NameChar permits BEYOND NameStartChar
// (used only to continue a name, never to begin one): `-`, `.`, ASCII digits,
// U+00B7 MIDDLE DOT, and the combining/connector ranges U+0300-U+036F and
// U+203F-U+2040. Combined with TAG_NAME_START this is the full NameChar set.
const TAG_NAME_CONT = /[-.0-9\u{B7}\u{0300}-\u{036F}\u{203F}-\u{2040}]/u;

/** True iff the code point may appear inside an XML tag name (NameStartChar or
 * the NameChar-only continuation set). Code-point-aware so astral name chars
 * are matched whole. */
function isTagNameChar(cp: number): boolean {
  const c = String.fromCodePoint(cp);
  return TAG_NAME_START.test(c) || TAG_NAME_CONT.test(c);
}

/** True iff the `<` at `ltIndex` opens a markup-like span — i.e. it is
 * immediately (after an optional `/`) followed by an XML 1.0 NameStartChar.
 * Code-point-aware: `codePointAt` reads a full astral char (a surrogate pair
 * such as `𐀀`, U+10000) so an XML-valid astral name is recognized as a real
 * tag opener rather than dismissed as an unmatched lone surrogate. */
function startsMarkupName(s: string, ltIndex: number): boolean {
  let j = ltIndex + 1;
  if (s[j] === '/') j++;
  if (j >= s.length) return false;
  const cp = s.codePointAt(j);
  if (cp === undefined) return false;
  return TAG_NAME_START.test(String.fromCodePoint(cp));
}

/** From a `<` at `start` (its name-start already confirmed by
 * `startsMarkupName`), return the index of the `>` that TRULY closes the
 * markup-like span, or -1 if `<start` is not genuine tag syntax. The scan is
 * CONTEXTUAL — `insideCssString` selects between two models, because the two
 * contexts genuinely tokenize the same bytes differently:
 *
 *  - Top level / prose (`insideCssString === false`) → `scanMarkupCloseHtml`,
 *    faithful HTML tag-token semantics. A tag name runs until whitespace, `/`,
 *    or `>` (HTML consumes any other byte — backslash, quote — INTO the name),
 *    and quotes suppress `>` only when they open a quoted attribute value after
 *    `=`. So HTML-tokenizable data whose real `>` an XML-name gate would miss
 *    (`<img\foo>`, `<img " >`, `<img alt=foo" >`) is fully neutralized.
 *  - Inside a CSS attribute-selector quoted string (`insideCssString === true`)
 *    → `scanMarkupCloseCss`, the strict XML-name gate. There backslash is a CSS
 *    string escape, so inert selector data like `<value\"` (name run ended by
 *    `\`, not whitespace/`/`/`>`) is NOT a tag and returns -1 — its `<` is
 *    still escaped, but a later child-combinator `>` stays raw/copy-pastable.
 *    A genuine buried tag (`<img alt="x">`, name ended by whitespace) is still
 *    recognized and its real `>` neutralized. Applying HTML name semantics
 *    here instead would let a run-on name swallow the `] > b` combinator. */
function scanMarkupClose(s: string, start: number, insideCssString: boolean): number {
  let k = start + 1;
  if (s[k] === '/') k++;
  return insideCssString ? scanMarkupCloseCss(s, k) : scanMarkupCloseHtml(s, k);
}

function isTagWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r';
}

/** Strict-XML markup close for a `<` nested inside a CSS attribute-selector
 * quoted string. `k` is the first name char (past any `/`). See
 * `scanMarkupClose`. */
function scanMarkupCloseCss(s: string, startName: number): number {
  let k = startName;
  // Gate 1 — walk the tag name (first char already confirmed a NameStartChar
  // by startsMarkupName) and require a valid tag-name terminator after it.
  let nameLen = 0;
  while (k < s.length) {
    const cp = s.codePointAt(k)!;
    if (!isTagNameChar(cp)) break;
    k += cp > 0xffff ? 2 : 1;
    nameLen++;
  }
  if (nameLen === 0) return -1;
  const boundary = s[k];
  if (boundary !== ' ' && boundary !== '\t' && boundary !== '/' && boundary !== '>') return -1;
  // Gate 2 — find the real `>` with XML attribute-quote semantics. Backslash is
  // a LITERAL attribute character (XML attrs do not backslash-escape), so
  // `<img alt="1 > 0\">` closes at the `>` right after the `\"`.
  let attrQuote: string | null = null;
  while (k < s.length) {
    const ck = s[k];
    if (attrQuote) {
      if (ck === attrQuote) attrQuote = null;
      k++;
      continue;
    }
    if (ck === '"' || ck === "'") {
      attrQuote = ck;
      k++;
      continue;
    }
    if (ck === '>') return k;
    if (ck === '<') return -1; // a new span opens before this one closed — abort
    k++;
  }
  return -1;
}

/** HTML tag-token close for a top-level / prose `<`. `k` is the first name
 * char (past any `/`). Implements enough of the HTML tokenizer's tag states to
 * find the real `>`: the name runs until whitespace/`/`/`>` (every other byte,
 * backslash and quote included, is part of the name), and a quote suppresses
 * `>` ONLY inside a quoted attribute value it opened after `=`. A malformed
 * quote that is not a value delimiter (a stray `"` in before-attribute-name, or
 * a `"` inside an unquoted value) does NOT hide the real close. See
 * `scanMarkupClose`. */
function scanMarkupCloseHtml(s: string, startName: number): number {
  const n = s.length;
  let k = startName;
  // Tag-name state: consume until a name terminator (HTML absorbs any other
  // byte, e.g. `\` or `"`, into the name).
  let nameLen = 0;
  while (k < n) {
    const ch = s[k];
    if (isTagWhitespace(ch) || ch === '/' || ch === '>') break;
    k++;
    nameLen++;
  }
  if (nameLen === 0) return -1;
  // Attribute states. `reconsume` re-reads the current char in the next state
  // without advancing (mirrors the HTML tokenizer's reconsume steps).
  type St = 'beforeName' | 'name' | 'afterName' | 'beforeValue' | 'valueDQ' | 'valueSQ' | 'valueUnquoted' | 'afterValueQuoted';
  let state: St = 'beforeName';
  while (k < n) {
    const ch = s[k];
    switch (state) {
      case 'beforeName':
        if (isTagWhitespace(ch) || ch === '/') { k++; break; }
        if (ch === '>') return k;
        state = 'name'; // reconsume ch as the start of an attribute name
        break;
      case 'name':
        if (isTagWhitespace(ch)) { state = 'afterName'; k++; break; }
        if (ch === '/') { state = 'afterName'; break; }
        if (ch === '>') return k;
        if (ch === '=') { state = 'beforeValue'; k++; break; }
        k++;
        break;
      case 'afterName':
        if (isTagWhitespace(ch) || ch === '/') { k++; break; }
        if (ch === '=') { state = 'beforeValue'; k++; break; }
        if (ch === '>') return k;
        state = 'name'; // reconsume as a new attribute name
        break;
      case 'beforeValue':
        if (isTagWhitespace(ch)) { k++; break; }
        if (ch === '"') { state = 'valueDQ'; k++; break; }
        if (ch === "'") { state = 'valueSQ'; k++; break; }
        if (ch === '>') return k; // attribute with a missing value
        state = 'valueUnquoted'; // reconsume ch as the first unquoted-value byte
        break;
      case 'valueDQ':
        if (ch === '"') state = 'afterValueQuoted';
        k++;
        break;
      case 'valueSQ':
        if (ch === "'") state = 'afterValueQuoted';
        k++;
        break;
      case 'valueUnquoted':
        if (isTagWhitespace(ch)) { state = 'beforeName'; k++; break; }
        if (ch === '>') return k;
        k++; // `"`/`'` here are ordinary unquoted-value bytes, not delimiters
        break;
      case 'afterValueQuoted':
        if (isTagWhitespace(ch)) { state = 'beforeName'; k++; break; }
        if (ch === '/') { k++; break; }
        if (ch === '>') return k;
        state = 'beforeName'; // reconsume as the next attribute name
        break;
    }
  }
  return -1;
}

/** True iff a CSS identifier character (an attribute-selector name body):
 * ASCII letters, digits, `-`, `_`, or any non-ASCII codepoint (CSS idents
 * allow those). Deliberately excludes `.`, `#`, `:`, `(`, `[`, whitespace.
 * Used only by `opensAttrSelectorString`'s walk-back over `[ident=`. */
function isCssIdentChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const cp = ch.codePointAt(0)!;
  if (cp > 127) return true;
  return /[A-Za-z0-9_-]/.test(ch);
}

/** True iff the quote at `quoteIndex` opens a CSS ATTRIBUTE-SELECTOR string —
 * the ONE syntactic shape that switches the scan out of its prose/HTML default
 * into XML-strict CSS-string context. It is anchored on exactly one form:
 *
 *   `[` ident (optional one of `~ | ^ $ *`) `=` `"`/`'`
 *
 * The quote must be preceded by `=` (optionally one operator char), then an
 * identifier (the attribute name), then an unclosed `[`. Nothing else opens CSS
 * context. A bare prose `=` (`x = "…"`, or `said, x="…"` with no bracket) does
 * NOT qualify — there is no enclosing `[`. Function-call notation (`url("…")`,
 * `foo("…")`) is DELIBERATELY not recognized: `fn("…")` is inherently ambiguous
 * between CSS functional notation and ordinary prose, so it stays prose and its
 * nested markup is neutralized with faithful HTML tokenization.
 *
 * Why anchoring here is closed-form, not another heuristic (the safety argument
 * is asymmetric):
 *  - `<` is escaped UNCONDITIONALLY in every context, so no output can ever
 *    carry a tag whose opener is live. This `>`-marking machinery exists only
 *    to avoid the half-escaped `&lt;tag …>` shape.
 *  - Misclassifying a real CSS string as prose (the only direction this shrunk
 *    recognizer can err for genuine selectors, e.g. `url("<value\"") > span`)
 *    at worst OVER-escapes a later combinator `>` — a copy-paste nit, never a
 *    security hole.
 *  - Misclassifying prose as CSS is now only possible when the prose LITERALLY
 *    contains `[ident="…"]` attribute-selector syntax. Inside that shape the
 *    behavior is the required copy-pastable-selector behavior: `<` is dead, an
 *    XML-tokenizable buried tag still gets its `>` escaped, and only a
 *    non-XML-tokenizable span (`<value\"`) stays inert.
 *
 * So the boundary is: prose ⇒ full HTML tokenization (escape-happy); a
 * syntactic `[ident="…"]` string ⇒ XML-strict (copy-paste-preserving). There is
 * no third context and no punctuation heuristic left to relitigate. */
function opensAttrSelectorString(s: string, quoteIndex: number): boolean {
  let j = quoteIndex - 1;
  while (j >= 0 && (s[j] === ' ' || s[j] === '\t')) j--;
  if (j < 0) return false;
  if (s[j] !== '=') return false;
  // Attribute selector `[name="v"]`: walk back over an optional operator char,
  // the attribute name, and require an unclosed `[`.
  let k = j - 1;
  if (k >= 0 && '~|^$*'.includes(s[k]!)) k--;
  while (k >= 0 && (s[k] === ' ' || s[k] === '\t')) k--;
  if (!isCssIdentChar(s[k])) return false; // no attribute name → prose `=`
  while (k >= 0 && isCssIdentChar(s[k])) k--;
  while (k >= 0 && (s[k] === ' ' || s[k] === '\t')) k--;
  return k >= 0 && s[k] === '[';
}

/** Scan over the ORIGINAL (pre-escape) text returning the set of `>` indices
 * that must be escaped. A `>` qualifies iff it is either:
 *  - the REAL closing delimiter of a markup-like span (found via
 *    `scanMarkupClose`, which skips a `>` inside a quoted attribute so only
 *    the tag's true terminator is marked); or
 *  - the `>` completing `]]>`, which XML forbids as literal character data.
 * Because the scan runs on the original text, a later `<` (still a literal `<`
 * here, not yet `&lt;`) correctly delimits spans.
 *
 * The scan tracks ONE piece of outer context: whether the cursor is inside a
 * CSS attribute-selector quoted string, decided by `opensAttrSelectorString`
 * from the one unambiguous syntactic shape `[ident="…"]` — NOT prose
 * punctuation and NOT function-call notation. That is the distinction the
 * security fix turns on — a `<` inside an attribute-selector string obeys the
 * strict-XML-name gate with CSS backslash semantics, a `<` anywhere else (the
 * prose/HTML default, including one nested inside an ordinary prose quote or a
 * `fn("…")` argument) obeys faithful HTML tag-token semantics (see
 * `scanMarkupClose`). The acceptance cases:
 *  - #1 `The function foo("<img\foo>payload") returned` — `foo("` is prose, not
 *    selector syntax, so `<img\foo>` is HTML-tokenized: the `\` is part of the
 *    name and the `>` is the real terminator, marked (fully neutralized).
 *  - #2 `foo("<img " >payload")` and #3 `foo("<img alt=foo" >payload")` — also
 *    prose; a quote that does not open a value after `=` never hides the real
 *    close, so the `>` is marked.
 *  - #4 `div[data-x="<value\""] > span` — the `"` sits inside `[data-x=…]`, so
 *    it IS an attribute-selector string, but `<value\"` is not real tag syntax:
 *    its name run ends on `\`, so the strict-XML name-boundary gate rejects it
 *    as inert CSS data. The `<` is still escaped, but the child-combinator `>`
 *    after `]` stays raw/copy-pastable.
 *  - #5 `a[data-x="<img alt="1 > 0\">"] > b` — also a real selector string, but
 *    here `<img …>` IS genuine tag syntax (name terminated by whitespace). The
 *    scan finds the real closing `>` (right after the literal `\"`, since XML
 *    attributes do not backslash-escape) and marks it, while the
 *    child-combinator `>` after `]` stays raw.
 *  - #8 `<img alt="1 > 0" onerror="x">` — top-level markup; the `>` inside a
 *    quoted attribute stays raw and only the true terminator is marked.
 *  - #10 `</response> matched main > section` — the tag close is marked; the
 *    `main > section` combinator stays raw.
 *  - #12 `x[a="<img alt=foo" >payload"]` — CSS context by design (it has
 *    `[a=`): under the XML gate the span is inert, `<` escaped, the `>` stays
 *    raw. The boundary carve-out, pinned so it is not rediscovered.
 *  - #13 `url("<value\"") > span` — prose (function-call notation is not
 *    recognized), so the trailing combinator `>` MAY be over-escaped; safe
 *    direction, no live markup survives.
 * Crucially, a genuine tag inside an attribute-selector string is still marked
 * — a hostile `<tag>` wrapped in a real selector string is neutralized rather
 * than swallowed by the quote and left half-escaped. */
function markupCloseIndices(s: string): ReadonlySet<number> {
  const marks = new Set<number>();
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if ((c === '"' || c === "'") && opensAttrSelectorString(s, i)) {
      // A CSS attribute-selector quoted string (CSS backslash semantics). A `<` buried
      // inside is markup only when it genuinely self-closes (its own attribute
      // quotes toggle and a top-level `>` is reached); otherwise it is inert
      // CSS data and any `>` outside stays raw.
      const delim = c;
      let k = i + 1;
      while (k < n) {
        const ck = s[k];
        if (ck === '\\') {
          k += 2;
          continue;
        }
        if (ck === delim) {
          k++;
          break;
        }
        if (ck === '<' && startsMarkupName(s, k)) {
          const close = scanMarkupClose(s, k, true);
          if (close >= 0) {
            marks.add(close);
            k = close + 1;
            continue;
          }
        }
        k++;
      }
      i = k;
      continue;
    }
    if (c === '<' && startsMarkupName(s, i)) {
      const close = scanMarkupClose(s, i, false);
      if (close >= 0) {
        marks.add(close);
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  for (let p = 0; p + 2 < n; p++) {
    if (s[p] === ']' && s[p + 1] === ']' && s[p + 2] === '>') marks.add(p + 2);
  }
  return marks;
}

/** Escape for use inside XML-ish element text/attribute content. `&` and `<`
 * are always escaped — `<` is what could open a forged tag and `&` what could
 * open an entity. `>` is escaped SELECTIVELY, resolving two competing needs:
 *  - A bare `>` cannot break out of text content and, left verbatim, keeps
 *    page-derived CSS selectors (`div#root > main`, even `div[data-x="<value"]
 *    > span`) copy-pastable straight out of the rendered prose instead of
 *    printing as `div#root &gt; main`. So an ordinary combinator `>` (one that
 *    does NOT close a markup-like tag span) is emitted raw.
 *  - The `>` that CLOSES a markup-like tag span (`</response>`, `<script>`,
 *    `<img alt="1 > 0" onerror="x">`, `<_hostile>`) — whose opening `<` is
 *    already `&lt;` — is escaped to `&gt;`, so hostile, page-derived markup can
 *    never render as a live tag or leave a half-escaped `&lt;tag>` that a
 *    lenient XML/HTML reader might still parse. The real closing delimiter is
 *    found by a quote-aware scan (`markupCloseIndices`), so a `>` inside a
 *    quoted attribute is left raw and only the tag's true terminator escapes.
 *  - The sequence `]]>`, which XML forbids as literal character data even
 *    outside CDATA, is neutralized to `]]&gt;` wherever it survives, so
 *    page-derived text carrying it cannot make an XML consumer reject the
 *    block.
 * The net rule: a `>` is escaped iff it terminates a `<…>` tag-like span or
 * completes `]]>`; every other `>` (the selector-combinator case) stays raw. */
function escapeXmlText(s: string): string {
  const marks = markupCloseIndices(s);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') out += '&amp;';
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += marks.has(i) ? '&gt;' : '>';
    else out += c;
  }
  return out;
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
