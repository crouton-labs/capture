import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  looksSecretLikeValue,
  isSensitiveFieldIdentity,
  redactFieldValue,
  redactSecretSubstrings,
  capString,
  sanitizeString,
  sanitizeFilenameSlug,
  sanitizeDomHtml,
  looksLikeSensitiveInputValue,
  capArray,
  MAX_VALUE_LENGTH,
  MAX_FILENAME_SLUG_LENGTH,
} from '../src/cdp/measure/redaction.js';

// A Luhn-valid Visa test card number (passes the check-digit algorithm real
// PANs satisfy; not a real account).
const CARD_NUMBER_LIKE = '4111111111111111';
// A 16-digit run that fails Luhn — an ordinary long numeric ID, never a card.
const NON_CARD_DIGIT_RUN = '1234567890123456';
const EMAIL_LIKE = 'jane.doe@example.com';
const STREET_ADDRESS_LIKE = '123 Main Street';

// A JWT-shaped value: three dot-separated segments, each >=10 chars of
// `[A-Za-z0-9_-]`.
const JWT_LIKE = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const SK_LIKE = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
const GH_LIKE = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
// A github_pat_-shaped fine-grained PAT: prefix + 60 chars of [A-Za-z0-9_].
const GH_PAT_LIKE = 'github_pat_' + '11ABCDEFGHIJKLMNOPQR0123456789abcdefghijklmnopqrstuvwxyz_9Q';
const AWS_KEY_LIKE = 'AKIAIOSFODNN7EXAMPLE';
const BASE64_LIKE = Buffer.from('the quick brown fox jumps over the lazy dog').toString('base64');
const HEX_LIKE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

// ============================================================================
// looksSecretLikeValue
// ============================================================================

test('looksSecretLikeValue: recognizes a JWT-shaped value', () => {
  assert.equal(looksSecretLikeValue(JWT_LIKE), true);
});

test('looksSecretLikeValue: recognizes an sk- prefixed token', () => {
  assert.equal(looksSecretLikeValue(SK_LIKE), true);
});

test('looksSecretLikeValue: recognizes a gh[oprsu]_ prefixed token', () => {
  assert.equal(looksSecretLikeValue(GH_LIKE), true);
});

test('looksSecretLikeValue: recognizes a github_pat_ fine-grained PAT', () => {
  assert.equal(looksSecretLikeValue(GH_PAT_LIKE), true);
});

test('looksSecretLikeValue: recognizes an AWS-access-key-shaped value', () => {
  assert.equal(looksSecretLikeValue(AWS_KEY_LIKE), true);
});

test('looksSecretLikeValue: recognizes a long base64-ish blob', () => {
  assert.ok(BASE64_LIKE.length >= 32, 'fixture must be long enough to exercise the blob regex');
  assert.equal(looksSecretLikeValue(BASE64_LIKE), true);
});

test('looksSecretLikeValue: recognizes a long hex string', () => {
  assert.ok(HEX_LIKE.length >= 32);
  assert.equal(looksSecretLikeValue(HEX_LIKE), true);
});

test('looksSecretLikeValue: a short value is never flagged, even if shape-like', () => {
  assert.equal(looksSecretLikeValue('sk-abc'), false);
  assert.equal(looksSecretLikeValue('short'), false);
});

test('looksSecretLikeValue: ordinary prose is not flagged', () => {
  const prose = 'The quick brown fox jumps over the lazy dog';
  assert.ok(prose.trim().length >= 16);
  assert.equal(looksSecretLikeValue(prose), false);
});

test('looksSecretLikeValue: an ordinary long hyphenated identifier is not flagged', () => {
  const longClassList = 'my-super-long-descriptive-css-class-name-here';
  assert.ok(longClassList.length >= 16);
  assert.equal(looksSecretLikeValue(longClassList), false);
});

// ============================================================================
// isSensitiveFieldIdentity
// ============================================================================

test('isSensitiveFieldIdentity: type=password is sensitive', () => {
  assert.equal(isSensitiveFieldIdentity({ type: 'password' }), true);
});

test('isSensitiveFieldIdentity: name containing cc-number is sensitive', () => {
  assert.equal(isSensitiveFieldIdentity({ type: 'text', name: 'billing-cc-number' }), true);
});

test('isSensitiveFieldIdentity: id containing cvv is sensitive', () => {
  assert.equal(isSensitiveFieldIdentity({ type: 'text', id: 'card-cvv-input' }), true);
});

test('isSensitiveFieldIdentity: autocomplete containing ssn is sensitive', () => {
  assert.equal(isSensitiveFieldIdentity({ type: 'text', autocomplete: 'ssn' }), true);
});

test('isSensitiveFieldIdentity: token/otp/pin identity tokens are sensitive', () => {
  assert.equal(isSensitiveFieldIdentity({ type: 'text', name: 'api-token' }), true);
  assert.equal(isSensitiveFieldIdentity({ type: 'text', id: 'otp-code' }), true);
  assert.equal(isSensitiveFieldIdentity({ type: 'text', name: 'pin' }), true);
});

test('isSensitiveFieldIdentity: matching is case-insensitive', () => {
  assert.equal(isSensitiveFieldIdentity({ type: 'text', name: 'CC-Number' }), true);
});

test('isSensitiveFieldIdentity: an ordinary field identity is not sensitive', () => {
  assert.equal(
    isSensitiveFieldIdentity({ type: 'text', name: 'address', id: 'addr-field', autocomplete: 'street-address' }),
    false,
  );
});

// ============================================================================
// redactFieldValue — precedence order
// ============================================================================

test('redactFieldValue: an explicit password field is always redacted, even with an empty/ordinary value', () => {
  const empty = redactFieldValue({ value: '', isPassword: true });
  assert.equal(empty.redacted, true);
  assert.equal(empty.redactionReason, 'password-field');
  assert.equal(empty.value, undefined);
  assert.equal(empty.length, 0);

  const ordinary = redactFieldValue({ value: 'hi', isPassword: true });
  assert.equal(ordinary.redacted, true);
  assert.equal(ordinary.redactionReason, 'password-field');
  assert.equal(ordinary.value, undefined);
  assert.equal(ordinary.length, 2);
});

test('redactFieldValue: password beats sensitive-identity/autofill/secret-shape all at once', () => {
  const result = redactFieldValue({
    value: JWT_LIKE,
    isPassword: true,
    isAutofilled: true,
    fieldIdentity: { type: 'password', name: 'ssn' },
  });
  assert.equal(result.redactionReason, 'password-field');
});

test('redactFieldValue: sensitive field identity beats autofill', () => {
  const result = redactFieldValue({
    value: '123-45-6789',
    isPassword: false,
    isAutofilled: true,
    fieldIdentity: { type: 'text', name: 'ssn' },
  });
  assert.equal(result.redacted, true);
  assert.equal(result.redactionReason, 'sensitive-field-identity');
  assert.equal(result.value, undefined);
});

test('redactFieldValue: autofill redacts a non-sensitive, non-secret-shaped value', () => {
  const result = redactFieldValue({
    value: '123 Main Street',
    isAutofilled: true,
    fieldIdentity: { type: 'text', name: 'address', autocomplete: 'street-address' },
  });
  assert.equal(result.redacted, true);
  assert.equal(result.redactionReason, 'autofilled');
  assert.equal(result.value, undefined);
  assert.equal(result.length, '123 Main Street'.length);
});

test('redactFieldValue: autofill beats secret-shaped-value and contenteditable-token', () => {
  const result = redactFieldValue({ value: JWT_LIKE, isAutofilled: true, isContentEditable: true });
  assert.equal(result.redactionReason, 'autofilled');
});

test('redactFieldValue: a secret-shaped contenteditable value is reason contenteditable-token', () => {
  const result = redactFieldValue({ value: SK_LIKE, isContentEditable: true });
  assert.equal(result.redacted, true);
  assert.equal(result.redactionReason, 'contenteditable-token');
  assert.equal(result.value, undefined);
});

test('redactFieldValue: a secret-shaped value outside contenteditable is reason secret-shaped-value', () => {
  const result = redactFieldValue({ value: SK_LIKE, isContentEditable: false });
  assert.equal(result.redacted, true);
  assert.equal(result.redactionReason, 'secret-shaped-value');
  assert.equal(result.value, undefined);
});

test('redactFieldValue: a short/ordinary value clears every check and passes through raw', () => {
  const result = redactFieldValue({ value: 'Search' });
  assert.equal(result.redacted, false);
  assert.equal(result.redactionReason, undefined);
  assert.equal(result.value, 'Search');
  assert.equal(result.length, 6);
  assert.equal(result.capped, undefined);
});

test('redactFieldValue: a value over MAX_VALUE_LENGTH is capped, not redacted, with full length reported', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog. ';
  const longValue = sentence.repeat(50);
  assert.ok(longValue.length > MAX_VALUE_LENGTH, 'fixture must exceed the cap');
  const result = redactFieldValue({ value: longValue });
  assert.equal(result.redacted, false);
  assert.equal(result.redactionReason, undefined);
  assert.equal(result.capped, true);
  assert.equal(result.value?.length, MAX_VALUE_LENGTH);
  assert.equal(result.length, longValue.length);
});

// ============================================================================
// redactSecretSubstrings
// ============================================================================

test('redactSecretSubstrings: strips a JWT-shaped run out of a longer sentence', () => {
  const text = `Validation failed for token ${JWT_LIKE} — please retry.`;
  const sanitized = redactSecretSubstrings(text);
  assert.ok(!sanitized.includes(JWT_LIKE));
  assert.ok(sanitized.includes('[REDACTED]'));
  assert.ok(sanitized.includes('Validation failed for token'));
  assert.ok(sanitized.includes('please retry.'));
});

test('redactSecretSubstrings: strips an sk- token embedded mid-sentence', () => {
  const text = `Rejected credential ${SK_LIKE} rejected`;
  const sanitized = redactSecretSubstrings(text);
  assert.ok(!sanitized.includes(SK_LIKE));
  assert.ok(sanitized.includes('[REDACTED]'));
  assert.ok(sanitized.includes('rejected'));
});

test('redactSecretSubstrings: leaves ordinary words/sentences alone', () => {
  const text = 'Please enter a value between 1 and 100 for this field.';
  assert.equal(redactSecretSubstrings(text), text);
});

test('redactSecretSubstrings: strips a github_pat_ token embedded mid-sentence', () => {
  const text = `Rejected credential ${GH_PAT_LIKE} rejected`;
  const sanitized = redactSecretSubstrings(text);
  assert.ok(!sanitized.includes(GH_PAT_LIKE));
  assert.ok(sanitized.includes('[REDACTED]'));
  assert.ok(sanitized.includes('Rejected credential'));
  assert.ok(sanitized.includes('rejected'));
});

// ============================================================================
// redactSecretSubstrings — punctuation-adjacent tokens
// ============================================================================

test('redactSecretSubstrings: a comma-terminated sk- token is redacted, comma preserved', () => {
  const text = `Keys: ${SK_LIKE}, ${SK_LIKE}2 were leaked`;
  const sanitized = redactSecretSubstrings(text);
  assert.ok(!sanitized.includes(SK_LIKE), 'raw token must be gone');
  assert.ok(sanitized.includes('[REDACTED],'), 'the comma must survive right after the marker');
});

test('redactSecretSubstrings: a period-terminated JWT is redacted, period preserved', () => {
  const text = `Auth failed for ${JWT_LIKE}.`;
  const sanitized = redactSecretSubstrings(text);
  assert.ok(!sanitized.includes(JWT_LIKE));
  assert.ok(sanitized.endsWith('[REDACTED].'));
});

test('redactSecretSubstrings: a colon-terminated github_pat_ token is redacted, colon preserved', () => {
  const text = `credential value ${GH_PAT_LIKE}: invalid`;
  const sanitized = redactSecretSubstrings(text);
  assert.ok(!sanitized.includes(GH_PAT_LIKE));
  assert.ok(sanitized.includes('[REDACTED]:'));
});

test('redactSecretSubstrings: a parenthesis-wrapped sk- token is redacted, parens preserved', () => {
  const text = `Credential (${SK_LIKE}) was rejected`;
  const sanitized = redactSecretSubstrings(text);
  assert.ok(!sanitized.includes(SK_LIKE));
  assert.ok(sanitized.includes('([REDACTED])'));
});

test('redactSecretSubstrings: a quote-delimited sk- token is redacted (quotes already act as boundaries)', () => {
  const text = `Credential 'sk-abcdefghijklmnopqrstuvwxyz0123456789' was rejected`;
  const sanitized = redactSecretSubstrings(text);
  assert.ok(!sanitized.includes('sk-abcdefghijklmnopqrstuvwxyz0123456789'));
  assert.ok(sanitized.includes("'[REDACTED]'"));
});

test('redactSecretSubstrings: multiple trailing punctuation marks (");") are all preserved around the marker', () => {
  const text = `See token (${SK_LIKE});`;
  const sanitized = redactSecretSubstrings(text);
  assert.ok(!sanitized.includes(SK_LIKE));
  assert.ok(sanitized.includes('([REDACTED]);'));
});

test('redactSecretSubstrings: redacts distinctive tokens after internal delimiters', () => {
  const cases = [
    [`token=${SK_LIKE}`, 'token=[REDACTED]'],
    [`token:${SK_LIKE}`, 'token:[REDACTED]'],
    [`token(${SK_LIKE})`, 'token([REDACTED])'],
    [`key=${GH_PAT_LIKE}`, 'key=[REDACTED]'],
    [`?token=${JWT_LIKE}&x=1`, '?token=[REDACTED]&x=1'],
  ] as const;

  for (const [input, expected] of cases) {
    const sanitized = redactSecretSubstrings(input);
    assert.equal(sanitized, expected, input);
    assert.ok(!sanitized.includes(SK_LIKE));
    assert.ok(!sanitized.includes(GH_PAT_LIKE));
    assert.ok(!sanitized.includes(JWT_LIKE));
  }
});

// ============================================================================
// sanitizeString
// ============================================================================

test('sanitizeString: redacts an embedded secret run', () => {
  const text = `Bearer ${SK_LIKE},`;
  const sanitized = sanitizeString(text);
  assert.ok(!sanitized.includes(SK_LIKE));
  assert.ok(sanitized.includes('[REDACTED]'));
});

test('sanitizeString: redacts a token after an internal delimiter', () => {
  const text = `?token=${SK_LIKE}&x=1`;
  const sanitized = sanitizeString(text);
  assert.equal(sanitized, '?token=[REDACTED]&x=1');
  assert.ok(!sanitized.includes(SK_LIKE));
});

test('sanitizeString: caps an over-length ordinary string at MAX_VALUE_LENGTH', () => {
  // Spaced-out prose (not a contiguous long run) so this exercises the cap,
  // not the secret-shape redaction path (a long unbroken run of characters
  // would itself look base64/hex-blob-shaped and get redacted instead).
  const long = 'The quick brown fox jumps over the lazy dog. '.repeat(60);
  assert.ok(long.length > MAX_VALUE_LENGTH, 'fixture must exceed the cap');
  const sanitized = sanitizeString(long);
  assert.equal(sanitized.length, MAX_VALUE_LENGTH);
});

test('sanitizeString: leaves an ordinary short string untouched', () => {
  assert.equal(sanitizeString('hello world'), 'hello world');
});

test('sanitizeString: honors an explicit {max} cap on an ordinary over-length string', () => {
  // Spaced-out prose so this exercises the cap, not secret-shape redaction.
  const long = 'the quick brown fox '.repeat(20);
  assert.ok(long.length > 40, 'fixture must exceed the custom cap');
  assert.equal(sanitizeString(long, { max: 40 }).length, 40);
  // An omitted/empty opts falls back to the default MAX_VALUE_LENGTH bound.
  assert.equal(sanitizeString('short', {}), 'short');
});

test('sanitizeString: {max} redacts a boundary-straddling secret BEFORE capping (never slices it into a matchable partial)', () => {
  const prefix = 'prefix-'.repeat(3); // 21 ordinary chars
  const value = `${prefix}${SK_LIKE}`; // the sk- token begins at index 21
  const max = 33; // falls strictly INSIDE the sk- token run (21 < 33 < value.length)
  assert.ok(21 < max && max < value.length, 'the secret must straddle the cap boundary');

  // A naive cap-BEFORE-redact would slice the token here: value.slice(0, 33)
  // leaves a raw `sk-...` fragment too short (< 13 body chars) for the
  // embedded matcher to catch on a later pass — a genuine partial-secret leak.
  const naiveCapFirst = value.slice(0, max);
  assert.ok(naiveCapFirst.includes('sk-'), 'a cap-first order would expose an unmatchable sk- fragment');
  assert.equal(redactSecretSubstrings(naiveCapFirst), naiveCapFirst, 'that sliced fragment is too short to be re-redacted');

  // sanitizeString redacts FIRST, so the whole token becomes the fixed marker
  // before the cap runs — no fragment of the secret can survive the boundary.
  const sanitized = sanitizeString(value, { max });
  assert.ok(!sanitized.includes(SK_LIKE), 'the whole secret must be gone');
  assert.ok(!sanitized.includes('sk-'), 'no partial secret fragment may survive the cap boundary');
  assert.ok(sanitized.includes('[REDACTED]'), 'the token was redacted to the fixed marker before capping');
});

// ============================================================================
// redactFieldValue — detectEmbeddedSecrets
// ============================================================================

test('redactFieldValue: an embedded secret run only redacts the whole value when detectEmbeddedSecrets is set', () => {
  const withoutFlag = redactFieldValue({ value: `Bearer ${SK_LIKE}` });
  assert.equal(withoutFlag.redacted, false, 'default behavior only tests the WHOLE value, not embedded runs');

  const withFlag = redactFieldValue({ value: `Bearer ${SK_LIKE}`, detectEmbeddedSecrets: true });
  assert.equal(withFlag.redacted, true);
  assert.equal(withFlag.redactionReason, 'embedded-secret-value');
  assert.equal(withFlag.value, undefined);
});

test('redactFieldValue: detectEmbeddedSecrets catches internal-delimiter distinctive tokens', () => {
  const cases = [
    `token=${SK_LIKE}`,
    `token:${SK_LIKE}`,
    `token(${SK_LIKE})`,
    `key=${GH_PAT_LIKE}`,
    `?token=${JWT_LIKE}&x=1`,
  ] as const;

  for (const value of cases) {
    const withoutFlag = redactFieldValue({ value });
    assert.equal(withoutFlag.redacted, false, value);

    const withFlag = redactFieldValue({ value, detectEmbeddedSecrets: true });
    assert.equal(withFlag.redacted, true, value);
    assert.equal(withFlag.redactionReason, 'embedded-secret-value', value);
    assert.equal(withFlag.value, undefined, value);
  }
});

test('redactFieldValue: detectEmbeddedSecrets does not flag an ordinary value', () => {
  const result = redactFieldValue({ value: 'search term', detectEmbeddedSecrets: true });
  assert.equal(result.redacted, false);
  assert.equal(result.value, 'search term');
});

// ============================================================================
// capString / MAX_VALUE_LENGTH
// ============================================================================

test('MAX_VALUE_LENGTH is 2000', () => {
  assert.equal(MAX_VALUE_LENGTH, 2000);
});

test('capString: a value at or under the cap is returned unchanged, capped:false', () => {
  const short = 'hello';
  assert.deepEqual(capString(short), { value: short, capped: false });
  const exact = 'y'.repeat(MAX_VALUE_LENGTH);
  assert.deepEqual(capString(exact), { value: exact, capped: false });
});

test('capString: a value over the cap is truncated, capped:true', () => {
  const long = 'z'.repeat(MAX_VALUE_LENGTH + 10);
  const result = capString(long);
  assert.equal(result.capped, true);
  assert.equal(result.value.length, MAX_VALUE_LENGTH);
  assert.equal(result.value, long.slice(0, MAX_VALUE_LENGTH));
});

test('capString: honors a custom max', () => {
  const result = capString('abcdefghij', 5);
  assert.deepEqual(result, { value: 'abcde', capped: true });
});

// ============================================================================
// sanitizeFilenameSlug — filename-safe slugging that redacts secrets FIRST
// ============================================================================

test('MAX_FILENAME_SLUG_LENGTH is 80', () => {
  assert.equal(MAX_FILENAME_SLUG_LENGTH, 80);
});

test('sanitizeFilenameSlug: redacts an embedded secret run BEFORE slugging, keeping the safe words', () => {
  const slug = sanitizeFilenameSlug(`avatar ${SK_LIKE} icon`);
  assert.ok(!slug.includes(SK_LIKE), 'the raw token must not survive into a filename');
  assert.ok(!slug.toLowerCase().includes('sk-'), 'no fragment of the token slug survives');
  assert.equal(slug, 'avatar-REDACTED-icon');
});

test('sanitizeFilenameSlug: a whole github_pat_ token never reaches a filename', () => {
  const slug = sanitizeFilenameSlug(GH_PAT_LIKE);
  assert.ok(!slug.includes(GH_PAT_LIKE));
  assert.ok(!slug.toLowerCase().includes('github_pat'));
  assert.equal(slug, 'REDACTED');
});

test('sanitizeFilenameSlug: replaces filename-unsafe characters and collapses/trims dashes', () => {
  assert.equal(sanitizeFilenameSlug('foo/bar baz@qux.png'), 'foo-bar-baz-qux-png');
});

test('sanitizeFilenameSlug: returns an empty string when nothing filename-safe survives', () => {
  assert.equal(sanitizeFilenameSlug('/// @@@ ...'), '');
  assert.equal(sanitizeFilenameSlug(''), '');
});

test('sanitizeFilenameSlug: caps the slug at the requested max length', () => {
  const long = 'ab-'.repeat(70); // 210 chars, dash-broken so it is not secret-shaped
  assert.equal(sanitizeFilenameSlug(long).length, MAX_FILENAME_SLUG_LENGTH);
  assert.equal(sanitizeFilenameSlug(long, 10).length, 10);
});

// ============================================================================
// sanitizeDomHtml — the emitted `dom.html` document sanitizer
// ============================================================================

test('sanitizeDomHtml: redacts a github_pat_ token sitting in TEXT CONTENT (not an attribute, not JSON) — the Major 3 blocker', () => {
  const html = `<div class="card">${GH_PAT_LIKE}</div>`;
  const sanitized = sanitizeDomHtml(html);
  assert.ok(!sanitized.includes(GH_PAT_LIKE), 'raw PAT must not survive into the emitted artifact');
  assert.ok(sanitized.includes('[REDACTED]'), 'the marker must be present in its place');
  assert.equal(sanitized, '<div class="card">[REDACTED]</div>', 'surrounding tag/attribute syntax must stay intact');
});

test('sanitizeDomHtml: redacts a JWT-shaped token sitting in TEXT CONTENT', () => {
  const html = `<p>Session token: ${JWT_LIKE} expired</p>`;
  const sanitized = sanitizeDomHtml(html);
  assert.ok(!sanitized.includes(JWT_LIKE), 'raw JWT must not survive into the emitted artifact');
  assert.ok(sanitized.includes('[REDACTED]'));
  assert.equal(sanitized, '<p>Session token: [REDACTED] expired</p>');
});

test('sanitizeDomHtml: still redacts a password input value and an attribute-embedded secret (no regression)', () => {
  const html = `<input type="password" value="hunter2"><a href="https://x/?token=${SK_LIKE}">link</a>`;
  const sanitized = sanitizeDomHtml(html);
  assert.ok(!sanitized.includes('hunter2'));
  assert.ok(!sanitized.includes(SK_LIKE));
  assert.equal(sanitized, '<input type="password" value="[REDACTED]"><a href="https://x/?token=[REDACTED]">link</a>');
});

test('sanitizeDomHtml: redacts both an attribute secret AND a text-node secret in the same element without corrupting tag syntax', () => {
  const html = `<div data-tok="${GH_PAT_LIKE}">also here: ${GH_PAT_LIKE}</div>`;
  const sanitized = sanitizeDomHtml(html);
  assert.ok(!sanitized.includes(GH_PAT_LIKE));
  assert.equal(sanitized, '<div data-tok="[REDACTED]">also here: [REDACTED]</div>');
});

test('sanitizeDomHtml: ordinary tag/attribute structure and prose text survive untouched', () => {
  const html = '<ul class="list" data-x="y"><li id="a">Apples</li><li id="b">Bananas</li></ul>';
  assert.equal(sanitizeDomHtml(html), html);
});

test('sanitizeDomHtml: entity-escaped angle brackets in text content are not treated as tag delimiters', () => {
  const html = '<p>1 &lt; 2 and 2 &gt; 1</p>';
  assert.equal(sanitizeDomHtml(html), html);
});

// ============================================================================
// looksLikeSensitiveInputValue — the VALUE-shape half of dom.html's
// <input> redaction (card number / email / street address).
// ============================================================================

test('looksLikeSensitiveInputValue: recognizes a Luhn-valid card number, digits only', () => {
  assert.equal(looksLikeSensitiveInputValue(CARD_NUMBER_LIKE), true);
});

test('looksLikeSensitiveInputValue: recognizes a Luhn-valid card number with space/dash grouping', () => {
  assert.equal(looksLikeSensitiveInputValue('4111 1111 1111 1111'), true);
  assert.equal(looksLikeSensitiveInputValue('4111-1111-1111-1111'), true);
});

test('looksLikeSensitiveInputValue: a 16-digit run that fails Luhn is NOT flagged (an ordinary long numeric ID)', () => {
  assert.equal(looksLikeSensitiveInputValue(NON_CARD_DIGIT_RUN), false);
});

test('looksLikeSensitiveInputValue: recognizes an email address', () => {
  assert.equal(looksLikeSensitiveInputValue(EMAIL_LIKE), true);
});

test('looksLikeSensitiveInputValue: recognizes a US-style street address', () => {
  assert.equal(looksLikeSensitiveInputValue(STREET_ADDRESS_LIKE), true);
  assert.equal(looksLikeSensitiveInputValue('42 Sunset Blvd'), true);
});

test('looksLikeSensitiveInputValue: ordinary prose/labels are not flagged', () => {
  assert.equal(looksLikeSensitiveInputValue('Submit'), false);
  assert.equal(looksLikeSensitiveInputValue('search term'), false);
  assert.equal(looksLikeSensitiveInputValue('The quick brown fox'), false);
  assert.equal(looksLikeSensitiveInputValue(''), false);
});

// ============================================================================
// sanitizeDomHtml <input> value redaction — I-4 honesty/privacy: dom.html
// reuses the SHARED identity predicate forms.json/text apply (redact when a
// `type`/`name`/`id`/`autocomplete` token marks the field sensitive) AND
// adds a dom.html-ONLY PII value-shape check (card/email/street-address
// shape) that `redactFieldValue` does NOT run — so a raw `<input value="...">`
// carrying PII with NO identifying attribute is still withheld. Each test is
// the adversarial (RED-before/GREEN-after) proof: planting a card number,
// email, and street address in a raw HTML fixture with NO identity hint on
// the field, and asserting the serialized dom.html withholds them via that
// value-shape check. Reverting `sanitizeDomHtml`
// to call the old password-only `redactPasswordInputs` reproduces the RED
// state — these three assertions fail because the raw PII value survives
// verbatim in the returned string.
// ============================================================================

test('sanitizeDomHtml: redacts a card number planted in a plain <input value> with no identifying name/id/autocomplete', () => {
  const html = `<input type="text" id="field-1" value="${CARD_NUMBER_LIKE}">`;
  const sanitized = sanitizeDomHtml(html);
  assert.ok(!sanitized.includes(CARD_NUMBER_LIKE), 'the raw card number must not survive into dom.html');
  assert.equal(sanitized, '<input type="text" id="field-1" value="[REDACTED]">');
});

test('sanitizeDomHtml: redacts an email address planted in a plain <input value> with no identifying name/id/autocomplete', () => {
  const html = `<input type="text" id="field-2" value="${EMAIL_LIKE}">`;
  const sanitized = sanitizeDomHtml(html);
  assert.ok(!sanitized.includes(EMAIL_LIKE), 'the raw email must not survive into dom.html');
  assert.equal(sanitized, '<input type="text" id="field-2" value="[REDACTED]">');
});

test('sanitizeDomHtml: redacts a street address planted in a plain <input value> with no identifying name/id/autocomplete', () => {
  const html = `<input type="text" id="field-3" value="${STREET_ADDRESS_LIKE}">`;
  const sanitized = sanitizeDomHtml(html);
  assert.ok(!sanitized.includes(STREET_ADDRESS_LIKE), 'the raw street address must not survive into dom.html');
  assert.equal(sanitized, '<input type="text" id="field-3" value="[REDACTED]">');
});

test('sanitizeDomHtml: redacts a non-password input value via identity token alone (autocomplete="cc-number"), even when the value itself is not card-shaped', () => {
  const html = '<input type="text" autocomplete="cc-number" value="not-luhn-valid">';
  const sanitized = sanitizeDomHtml(html);
  assert.ok(!sanitized.includes('not-luhn-valid'));
  assert.equal(sanitized, '<input type="text" autocomplete="cc-number" value="[REDACTED]">');
});

test('sanitizeDomHtml: an ordinary <input value> with no sensitive identity or PII shape survives untouched', () => {
  const html = '<input type="text" id="search-box" name="q" value="search term">';
  assert.equal(sanitizeDomHtml(html), html);
});

// ============================================================================
// capArray — the authoritative array capper with a factual dropped-count
// ============================================================================

test('capArray: returns all items with truncated:0 when under the cap', () => {
  const r = capArray([1, 2, 3], 5);
  assert.deepEqual(r.items, [1, 2, 3]);
  assert.equal(r.truncated, 0);
});

test('capArray: exactly at the cap keeps everything, truncated:0', () => {
  const r = capArray([1, 2, 3], 3);
  assert.deepEqual(r.items, [1, 2, 3]);
  assert.equal(r.truncated, 0);
});

test('capArray: over the cap slices to `max` and reports the dropped count as a fact', () => {
  const r = capArray([1, 2, 3, 4, 5], 2);
  assert.deepEqual(r.items, [1, 2]);
  assert.equal(r.truncated, 3);
});

test('capArray: returns a fresh array — mutating the result never touches the input', () => {
  const input = [1, 2, 3];
  const r = capArray(input, 5);
  r.items.push(4);
  assert.deepEqual(input, [1, 2, 3], 'the source array is not aliased into the result');
});
