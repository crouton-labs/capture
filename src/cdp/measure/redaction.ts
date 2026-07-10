/**
 * The ONE sanitizer/capper for every page-controlled artifact string in
 * `measure snap`. Every collector routes page-controlled strings
 * (selectors, DOM text, ARIA names, URLs, CSS/provenance strings, state
 * specs, …) through {@link sanitizeString}; form-control/text-node primary
 * VALUES go through {@link redactFieldValue}; crop/artifact filename
 * segments go through {@link sanitizeFilenameSlug}; and the serialized
 * `dom.html` document goes through {@link sanitizeDomHtml}. All four share
 * the same secret-shape detection below, so a token that is withheld in
 * one artifact cannot leak raw through another; `sanitizeDomHtml`
 * additionally redacts an `<input>`'s `value` via {@link isSensitiveFieldIdentity}
 * (the SAME identity check `redactFieldValue` uses) plus
 * {@link looksLikeSensitiveInputValue} (card-number/email/street-address
 * shape), since `dom.html` is a raw markup dump with no per-field autofill
 * signal to key off of the way `forms.json` does.
 *
 * Binding posture (builder brief / `taste/measuring-stick-not-coach`):
 * rendered AND JSON outputs never include raw password/token/autofill
 * values by default. Every entry point here returns a FACT (length,
 * whether it was redacted, why) in place of the raw string whenever a
 * value is judged secret-like, autofilled, or field-identity-sensitive —
 * never a truncated-but-still-revealing partial secret.
 */

/** Cap on any single raw page-controlled string this module lets through un-redacted (a length fact, not the secret, is stored beyond this). */
export const MAX_VALUE_LENGTH = 2000;

// ============================================================================
// Secret-shape detection — the single source of truth for every artifact
// surface (collector JSON strings, filename slugs, and the `dom.html`
// document): JWT/sk-/gh*_/`github_pat_`/AWS-key/base64/hex, intentionally
// narrower than "any long word" so ordinary long class lists, filenames,
// and prose survive.
// ============================================================================

const JWT_SHAPED_RE = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
const SK_TOKEN_RE = /^sk-[A-Za-z0-9_-]+$/;
const GH_TOKEN_RE = /^gh[oprsu]_[A-Za-z0-9]+$/;
/** GitHub fine-grained personal access token (`github_pat_<base62 id>_<base62 secret>`). Real tokens run ~82 chars past the prefix; `{20,}` is a floor, not the real length, so this stays a shape test rather than a strict format validator. */
const GH_PAT_RE = /^github_pat_[A-Za-z0-9_]{20,}$/;
const AWS_KEY_RE = /^AKIA[0-9A-Z]{16}$/;
const BASE64_BLOB_RE = /^[A-Za-z0-9+/]{32,}={0,2}$/;
const HEX_BLOB_RE = /^[0-9a-fA-F]{32,}$/;

/** Whole-value secret-shape test (JWT-shaped, `sk-`/`gh[oprsu]_`/`github_pat_`-prefixed, AWS-key-shaped, a long base64-ish blob, or a long hex string). Values under 16 chars are never flagged — too short to be any of these shapes and this is what keeps short ordinary field values ("Search", "42", a name) untouched. */
export function looksSecretLikeValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16) return false;
  return (
    JWT_SHAPED_RE.test(trimmed) ||
    SK_TOKEN_RE.test(trimmed) ||
    GH_TOKEN_RE.test(trimmed) ||
    GH_PAT_RE.test(trimmed) ||
    AWS_KEY_RE.test(trimmed) ||
    BASE64_BLOB_RE.test(trimmed) ||
    HEX_BLOB_RE.test(trimmed)
  );
}

// ============================================================================
// Field-identity sensitivity — a control can be sensitive by what it IS
// (type=password, an autocomplete/name/id token like "cc-number") even
// when its current value doesn't happen to look secret-shaped (a 4-digit
// CVC, a short PIN, an empty password field mid-entry).
// ============================================================================

const SENSITIVE_FIELD_TOKENS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apikey',
  'api-key',
  'api_key',
  'cc-number',
  'cc-csc',
  'cvv',
  'cvc',
  'card-number',
  'cardnumber',
  'ssn',
  'social-security',
  'otp',
  'one-time-code',
  'pin',
] as const;

const SENSITIVE_INPUT_TYPES = new Set(['password']);

export interface FieldIdentity {
  readonly type?: string | null;
  readonly name?: string | null;
  readonly id?: string | null;
  readonly autocomplete?: string | null;
}

/** Whether a control's identity (input `type`, `name`, `id`, or `autocomplete` token) marks it sensitive regardless of its current value's shape. */
export function isSensitiveFieldIdentity(identity: FieldIdentity): boolean {
  const type = (identity.type ?? '').toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;
  const haystacks = [identity.name, identity.id, identity.autocomplete]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.toLowerCase());
  return haystacks.some((h) => SENSITIVE_FIELD_TOKENS.some((token) => h.includes(token)));
}

// ============================================================================
// Distinctive embedded secret shapes — safe to search anywhere in free text.
// The generic base64/hex blob shapes stay run-boundary anchored below so long
// ordinary identifiers in prose are not redacted unless they actually match
// one of those whole-run shapes.
// ============================================================================

const JWT_EMBEDDED_RE = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
const SK_EMBEDDED_RE = /sk-[A-Za-z0-9_-]{13,}/;
const GH_TOKEN_EMBEDDED_RE = /gh[oprsu]_[A-Za-z0-9]{12,}/;
const GH_PAT_EMBEDDED_RE = /github_pat_[A-Za-z0-9_]{20,}/;
const AWS_KEY_EMBEDDED_RE = /AKIA[0-9A-Z]{16}/;

const EMBEDDED_SECRET_REPLACERS = [
  JWT_EMBEDDED_RE,
  SK_EMBEDDED_RE,
  GH_TOKEN_EMBEDDED_RE,
  GH_PAT_EMBEDDED_RE,
  AWS_KEY_EMBEDDED_RE,
] as const;

function containsEmbeddedSecretSubstring(value: string): boolean {
  return EMBEDDED_SECRET_REPLACERS.some((re) => new RegExp(re.source).test(value));
}

function redactEmbeddedSecretSubstrings(value: string): string {
  let redacted = value;
  for (const re of EMBEDDED_SECRET_REPLACERS) {
    redacted = redacted.replace(new RegExp(re.source, 'g'), '[REDACTED]');
  }
  return redacted;
}

// ============================================================================
// Value redaction
// ============================================================================

export type RedactionReason =
  | 'password-field'
  | 'sensitive-field-identity'
  | 'autofilled'
  | 'secret-shaped-value'
  | 'contenteditable-token'
  | 'embedded-secret-value';

export interface FieldRedactionInput {
  readonly value: string;
  readonly isPassword?: boolean;
  readonly isAutofilled?: boolean;
  readonly isContentEditable?: boolean;
  readonly fieldIdentity?: FieldIdentity;
  /**
   * When `true`, a distinctive embedded secret shape anywhere within
   * `value` (e.g. `Bearer sk-...`, `token=github_pat_...`, or a JWT-like
   * run inside a query string), not just an exact whole-value match, also
   * triggers full-value redaction — reason {@link RedactionReason}
   * `'embedded-secret-value'`. Form control values set this `true`: a
   * control's value is a single fact a caller may show in full (e.g.
   * `visibleSubstring.text`), so ANY embedded secret run inside it must
   * withhold the whole value. Free-flowing text-node/prose callers leave
   * this `false` (the default) and instead route the raw value through
   * {@link sanitizeString} themselves, which keeps the rest of the prose
   * readable while stripping just the token run.
   */
  readonly detectEmbeddedSecrets?: boolean;
}

export interface RedactedValue {
  /** Present ONLY when the value was judged safe to store raw (length-capped at {@link MAX_VALUE_LENGTH}). Absent whenever `redacted` is `true`. */
  readonly value?: string;
  /** The value's true length — a fact, not a secret, always reported even when `value` is withheld. */
  readonly length: number;
  readonly redacted: boolean;
  readonly redactionReason?: RedactionReason;
  /** `true` when `value` was present but truncated to fit {@link MAX_VALUE_LENGTH}. */
  readonly capped?: boolean;
}

/**
 * The one entry point `text.ts`/`forms.ts` route every page-controlled
 * value through. Order of precedence: an explicit `type="password"`
 * control is always redacted outright (regardless of value shape, even
 * empty); then field-identity sensitivity (name/id/autocomplete token);
 * then autofill (per the binding posture — an autofilled value is
 * withheld even when the field itself isn't password-typed, since
 * autofill can populate email/phone/card/address PII); then a
 * contenteditable region whose content looks secret-shaped; then any
 * OTHER value that independently looks secret-shaped; then, ONLY when the
 * caller opted in via `detectEmbeddedSecrets`, a value that merely
 * CONTAINS a secret-shaped run anywhere within it (reason
 * `'embedded-secret-value'`). A value that clears every check is returned
 * raw, capped to {@link MAX_VALUE_LENGTH}.
 */
export function redactFieldValue(input: FieldRedactionInput): RedactedValue {
  const raw = input.value ?? '';
  const length = raw.length;

  let reason: RedactionReason | undefined;
  if (input.isPassword) {
    reason = 'password-field';
  } else if (input.fieldIdentity && isSensitiveFieldIdentity(input.fieldIdentity)) {
    reason = 'sensitive-field-identity';
  } else if (input.isAutofilled) {
    reason = 'autofilled';
  } else if (input.isContentEditable && looksSecretLikeValue(raw)) {
    reason = 'contenteditable-token';
  } else if (looksSecretLikeValue(raw)) {
    reason = 'secret-shaped-value';
  } else if (input.detectEmbeddedSecrets && containsEmbeddedSecretSubstring(raw)) {
    reason = 'embedded-secret-value';
  }

  if (reason) {
    return { length, redacted: true, redactionReason: reason };
  }

  const { value, capped } = capString(raw);
  return capped ? { value, length, redacted: false, capped: true } : { value, length, redacted: false };
}

/**
 * Boundary punctuation that commonly delimits a token in prose (`sk-...,`,
 * `github_pat_....`, `(jwt...)`), a CSS selector (`#sk-...`), or a regex
 * `pattern` attribute (`^sk-...$`), but is never itself part of a
 * recognized secret shape. Stripped from a candidate run's edges before
 * shape-testing so a punctuation-adjacent token is still redacted —
 * without swallowing the punctuation itself into the `[REDACTED]`
 * replacement.
 */
const RUN_LEADING_PUNCT_RE = /^[,.;:!?()[\]{}#^$]+/;
const RUN_TRAILING_PUNCT_RE = /[,.;:!?()[\]{}#^$]+$/;

/**
 * Redacts secret-shaped substrings out of an otherwise-kept free-text
 * string (e.g. a native validity/`validationMessage` that could echo back
 * an entered value, or a label/placeholder string) without discarding the
 * whole message. First it replaces distinctive embedded secret shapes
 * anywhere in the text (`sk-...`, `github_pat_...`, JWT-like runs, AWS
 * keys, etc.), then it scans whitespace/quote/angle-bracket-delimited runs
 * for the generic base64/hex blob shapes, stripping leading/trailing
 * boundary punctuation from each run before testing it (so
 * `sk-...,`/`jwt.`/`github_pat_...:` still match), and finally replaces
 * only the token-shaped core — the stripped punctuation is kept in place
 * around the `[REDACTED]` marker.
 */
export function redactSecretSubstrings(text: string): string {
  const embeddedRedacted = containsEmbeddedSecretSubstring(text) ? redactEmbeddedSecretSubstrings(text) : text;
  return embeddedRedacted.replace(/[^\s"'<>]{16,}/g, (run) => {
    const leading = run.match(RUN_LEADING_PUNCT_RE)?.[0] ?? '';
    const core = run.slice(leading.length);
    const trailing = core.match(RUN_TRAILING_PUNCT_RE)?.[0] ?? '';
    const inner = trailing ? core.slice(0, core.length - trailing.length) : core;
    if (inner.length && looksSecretLikeValue(inner)) {
      return leading + '[REDACTED]' + trailing;
    }
    return looksSecretLikeValue(run) ? '[REDACTED]' : run;
  });
}

/** Length-caps a page-controlled string at `max` chars (default {@link MAX_VALUE_LENGTH}); returns whether it was truncated. Never itself redacts for secrecy — call {@link redactFieldValue}/{@link looksSecretLikeValue} first for that. */
export function capString(value: string, max: number = MAX_VALUE_LENGTH): { value: string; capped: boolean } {
  if (value.length <= max) return { value, capped: false };
  return { value: value.slice(0, max), capped: true };
}

/**
 * The one funnel every OTHER page-controlled string (a selector, a
 * placeholder/label/ARIA text, a computed CSS string, a `pattern`, a
 * validity message, …) must pass through before being written to
 * `text.json`/`forms.json`: strip secret-shaped substrings via
 * {@link redactSecretSubstrings}, THEN length-cap the result via
 * {@link capString}. Redact-before-cap matters — it means a token near the
 * {@link MAX_VALUE_LENGTH} boundary is replaced by the fixed-width
 * `[REDACTED]` marker before the cap is applied, rather than risking the
 * cap slicing a token in half and leaving an unrecognizable-but-still-
 * partial fragment sitting past the boundary. NOT the right tool for a
 * field's primary VALUE (a form control value, a text node's own text) —
 * those go through {@link redactFieldValue} first, which can withhold the
 * value outright (password/autofill/sensitive-identity/secret-shaped).
 *
 * `opts.max` overrides the length cap for callers that need a tighter
 * per-field bound (default {@link MAX_VALUE_LENGTH}). The cap is ALWAYS
 * applied AFTER redaction, so a lower `max` still can't slice a
 * boundary-straddling token into a non-matchable partial — the token is
 * already the fixed-width `[REDACTED]` marker by the time the cap runs.
 */
export function sanitizeString(value: string, opts?: { max?: number }): string {
  return capString(redactSecretSubstrings(value), opts?.max ?? MAX_VALUE_LENGTH).value;
}

/** Cap on a single filename slug segment produced by {@link sanitizeFilenameSlug}. */
export const MAX_FILENAME_SLUG_LENGTH = 80;

/**
 * Turns a page-controlled string into a filename-safe slug segment,
 * redacting secret-shaped substrings via {@link redactSecretSubstrings}
 * FIRST (so a token becomes the fixed `[REDACTED]` marker, which slugifies
 * to `redacted`, rather than surviving as a filename), THEN replacing any
 * remaining non-`[A-Za-z0-9_-]` run with `-`, collapsing/trimming dashes,
 * and capping at `max`. Returns `''` when nothing survives — callers that
 * need a non-empty segment compose it with a stable prefix (an index,
 * `backendNodeId`, or tag) they control, e.g. `${index}-${slug}`.
 */
export function sanitizeFilenameSlug(value: string, max: number = MAX_FILENAME_SLUG_LENGTH): string {
  const slug = redactSecretSubstrings(value)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > max ? slug.slice(0, max) : slug;
}

/**
 * The one authoritative array capper — caps a page-controlled list at
 * `max` entries and reports how many were dropped as a factual
 * `truncated` count (0 when nothing was dropped). Collectors that emit
 * page-sized lists (layer trees, grid tracks, line boxes) use this instead
 * of an ad-hoc `slice`, so the truncation is always recorded as a fact
 * rather than silently swallowed.
 */
export function capArray<T>(items: readonly T[], max: number): { items: T[]; truncated: number } {
  if (items.length <= max) return { items: [...items], truncated: 0 };
  return { items: items.slice(0, max), truncated: items.length - max };
}

// ============================================================================
// Whole-document `dom.html` sanitization — the serialized DOM artifact's
// attribute soup. Shares the secret-shape detection above so `github_pat_`
// and embedded secret substrings are redacted here exactly as they are in
// every collector JSON string.
// ============================================================================

// ----------------------------------------------------------------------------
// Sensitive `<input>` VALUE detection for `dom.html` — a SEPARATE funnel from
// `redactFieldValue`'s shared decision tree (`text.ts`/`forms.ts`), whose
// precedence order (password > sensitive-identity > autofill > secret-shaped)
// is pinned by their own tested contracts and depends on live page signals
// (autofill state) a serialized HTML string can never carry. This funnel
// reuses {@link isSensitiveFieldIdentity} UNCHANGED for the identity half of
// that policy (a `<input>`'s own `type`/`name`/`id`/`autocomplete`, read
// straight off the tag), and adds VALUE-shape recognition for the PII
// categories forms.json's autofill category protects (card number, email,
// street address) so a hard-coded/server-rendered default value carries the
// same protection in `dom.html` even when the field's own name/id/
// autocomplete gives no hint.
// ----------------------------------------------------------------------------

const EMAIL_SHAPED_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A common US-style street-address shape: a leading house number, 1–5 more words, ending in a recognized street-type suffix. Narrow on purpose (requires BOTH the digit prefix AND the suffix keyword) so ordinary prose/labels never match. */
const STREET_ADDRESS_SHAPED_RE =
  /^\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct|place|pl|circle|cir|terrace|ter|highway|hwy|parkway|pkwy)\.?$/i;

/** Standard Luhn checksum — `true` when `digits` (digits only, no separators) passes the check-digit algorithm every real payment-card PAN satisfies. Used to keep card-number-shape detection precise: an arbitrary 13–19 digit ID (an order number, a phone number) passes only by ~1-in-10 chance. */
function passesLuhnCheck(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function looksLikeCardNumberValue(value: string): boolean {
  const digits = value.replace(/[ -]/g, '');
  return /^\d{13,19}$/.test(digits) && passesLuhnCheck(digits);
}

/**
 * Whether a value's SHAPE ALONE (independent of the field's own name/id/
 * autocomplete identity) marks it as a card number, email address, or
 * street address — the PII categories `redactFieldValue`'s `autofilled`
 * reason protects in `forms.json` but that `dom.html`'s serialized-string
 * pass has no autofill signal to detect directly. Used only by
 * {@link sanitizeDomHtml}'s `<input>` value redaction.
 */
export function looksLikeSensitiveInputValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return EMAIL_SHAPED_RE.test(trimmed) || looksLikeCardNumberValue(trimmed) || STREET_ADDRESS_SHAPED_RE.test(trimmed);
}

/** Reads one `name="value"`/`name='value'` attribute out of a single already-matched tag string; `null` when the attribute is absent. */
function extractTagAttr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return match ? match[2] : null;
}

/**
 * Redacts an `<input>` tag's `value` attribute when EITHER predicate flags it:
 * {@link isSensitiveFieldIdentity} — the SHARED identity predicate also used
 * by `redactFieldValue` (forms/text) — on the tag's own
 * `type`/`name`/`id`/`autocomplete` (covers `type="password"` and every
 * identity token it recognizes: `cc-number`, `cvv`, `ssn`, `token`, …), OR
 * {@link looksLikeSensitiveInputValue} — a dom.html-ONLY PII value-shape
 * check NOT part of `redactFieldValue`'s policy — on the value text itself
 * (covers a card number/email/street address surviving in markup with no
 * identifying attribute at all). An `<input>` with neither is left
 * completely untouched.
 */
function redactSensitiveInputValues(html: string): string {
  return html.replace(/<input\b[^>]*>/gi, (tag) => {
    const identity: FieldIdentity = {
      type: extractTagAttr(tag, 'type'),
      name: extractTagAttr(tag, 'name'),
      id: extractTagAttr(tag, 'id'),
      autocomplete: extractTagAttr(tag, 'autocomplete'),
    };
    const valueAttr = extractTagAttr(tag, 'value');
    const sensitive = isSensitiveFieldIdentity(identity) || (valueAttr !== null && looksLikeSensitiveInputValue(valueAttr));
    if (!sensitive) return tag;
    return tag.replace(/(value\s*=\s*)(["'])(.*?)\2/i, (_full, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`);
  });
}

function redactAttributeSecrets(html: string): string {
  return html.replace(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(["'])([^"']*?)\2/g, (full, name: string, quote: string, value: string) => {
    const sanitized = redactSecretSubstrings(value);
    return sanitized === value ? full : `${name}=${quote}${sanitized}${quote}`;
  });
}

/**
 * Splits a serialized document into alternating tag (`<...>`) and text-node
 * segments, tagging each so callers never run tag-shaped regexes over text
 * content or vice versa. A segment is a tag iff it starts with `<` — the
 * split regex's capture group guarantees every tag delimiter is preserved
 * verbatim as its own array entry, interleaved with the (possibly empty)
 * text runs between them.
 */
function splitHtmlIntoTagsAndText(html: string): Array<{ isTag: boolean; text: string }> {
  return html.split(/(<[^>]*>)/g).map((part) => ({ isTag: part.startsWith('<'), text: part }));
}

/**
 * Redacts secret-shaped AND field-value-sensitive content out of a captured
 * `dom.html` document. Tokenizes the document into tag and text-node
 * segments ({@link splitHtmlIntoTagsAndText}) so each is sanitized with the
 * pass appropriate to it, and neither pass can mangle the other's syntax:
 * every `<input>`'s `value` is redacted per {@link redactSensitiveInputValues}
 * (the shared identity predicate — covering `type="password"` and the same
 * identity/autofill tokens `forms.json` protects — OR a dom.html-only PII
 * value-shape check that additionally catches a card-number/email/street-
 * address surviving in raw markup with no identifying attribute), every
 * OTHER `attr="value"` pair
 * goes through {@link redactSecretSubstrings} (so both a whole secret-shaped
 * attribute value AND a secret run embedded inside a larger value are
 * replaced by `[REDACTED]`), and every TEXT-NODE segment between tags —
 * where a page-controlled token like a leaked PAT can sit outside any
 * attribute — goes through the same {@link redactSecretSubstrings} pass.
 * Ordinary long class lists, filenames, paths, and prose survive untouched
 * in all three positions.
 */
export function sanitizeDomHtml(html: string): string {
  return splitHtmlIntoTagsAndText(html)
    .map(({ isTag, text }) => (isTag ? redactAttributeSecrets(redactSensitiveInputValues(text)) : redactSecretSubstrings(text)))
    .join('');
}
