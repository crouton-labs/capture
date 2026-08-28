/**
 * Render-time credential redaction for HAR request URLs and header values —
 * the ONE narrow carve-out in Capture's otherwise no-redaction posture.
 *
 * Capture preserves browser evidence rather than redacting it, and the HAR
 * artifact on disk remains full fidelity: this module is applied only where a
 * URL or header is rendered into a `session har` block, never on collection,
 * never on the stored `har.json`/live NDJSON, and never on the value a
 * `--filter-url` pattern is matched against. Its whole job is to keep a
 * dashboard/API session token out of an agent's transcript and terminal
 * scrollback while leaving the request identifiable — names, ordering, and
 * every non-credential value survive untouched, so the row still joins to the
 * artifact record it came from.
 *
 * Matching is on the name only; no value is ever inspected, so this cannot
 * depend on the shape of any observed secret.
 */

/** Replacement text for a credential-like parameter value in rendered output. */
export const REDACTED_VALUE = 'REDACTED';

/**
 * Credential-bearing names. Compared after normalization (lowercased, every
 * non-alphanumeric character dropped), so `api_key`, `API-Key`, and `apiKey`
 * all reduce to `apikey`.
 */
const CREDENTIAL_NAMES: ReadonlySet<string> = new Set([
  'key',
  'apikey',
  'accesskey',
  'secretkey',
  'privatekey',
  'sig',
  'signature',
  'auth',
  'authorization',
  'credential',
  'credentials',
  'password',
  'passwd',
  'pwd',
  'token',
  'secret',
  'code',
  'authcode',
  'authorizationcode',
  'sessionid',
  'sessionkey',
]);

/**
 * Fragments that make ANY containing name credential-bearing —
 * `access_token`, `refresh-token`, `clientSecret`, `x-amz-signature`, and the
 * rest of the long tail no exact list keeps up with.
 */
const CREDENTIAL_NAME_FRAGMENTS: readonly string[] = [
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'apikey',
  'accesskey',
  'privatekey',
  'signature',
  'authorization',
  'sessionid',
  'loid',
];

function normalizeCredentialName(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    decoded = raw;
  }
  return decoded.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether a query parameter or header name names a credential. */
export function isCredentialName(raw: string): boolean {
  const name = normalizeCredentialName(raw);
  if (name === '') return false;
  if (CREDENTIAL_NAMES.has(name)) return true;
  return CREDENTIAL_NAME_FRAGMENTS.some((fragment) => name.includes(fragment));
}

/** Render a credential-valued header without exposing its value. */
export function redactHeaderCredential(name: string, value: string): string {
  return isCredentialName(name) ? `redacted · ${value.length} chars` : value;
}

/** Redacts credential values in one `a=1&b=2` parameter section. */
function redactParamSection(section: string): string {
  return section
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const name = pair.slice(0, eq);
      return isCredentialName(name) ? `${name}=${REDACTED_VALUE}` : pair;
    })
    .join('&');
}

/**
 * Returns the URL with credential-like query (and parameter-shaped fragment)
 * values replaced by `REDACTED`. Everything else — scheme, host, path, other
 * parameters, ordering — is returned verbatim; a URL carrying no credential
 * parameter comes back byte-identical. Operates on the raw string rather than
 * `new URL()` so a relative or malformed URL is never re-encoded or dropped.
 */
export function redactUrlCredentials(url: string): string {
  const hashIndex = url.indexOf('#');
  const base = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex < 0 ? null : url.slice(hashIndex + 1);

  const queryIndex = base.indexOf('?');
  const head = queryIndex < 0 ? base : base.slice(0, queryIndex);
  const query = queryIndex < 0 ? null : base.slice(queryIndex + 1);

  const renderedQuery = query === null ? '' : `?${redactParamSection(query)}`;
  // A fragment is only treated as parameters when it actually looks like them;
  // an ordinary `#section-2` anchor is left exactly as captured.
  const renderedFragment = fragment === null
    ? ''
    : `#${fragment.includes('=') ? redactParamSection(fragment) : fragment}`;

  return `${head}${renderedQuery}${renderedFragment}`;
}
