import type { ResolveContactByEmailOutput } from '../schemas';
import { throwForStatus } from '@vallum/_runtime';

async function sha1hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function computeSapisidHash(cookieName: string, origin: string): Promise<string> {
  const cookies = document.cookie.split('; ');
  const cookie = cookies.find(c => c.startsWith(cookieName + '='));
  const value = cookie ? cookie.split('=')[1] : '';
  const ts = Math.floor(Date.now() / 1000);
  const hash = await sha1hex(`${ts} ${value} ${origin}`);
  return `${ts}_${hash}`;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function getNestedStr(root: unknown, ...path: number[]): string | null {
  let cur: unknown = root;
  for (const idx of path) {
    if (!Array.isArray(cur) || idx >= cur.length) return null;
    cur = cur[idx];
  }
  return strOrNull(cur);
}

export async function resolveContactByEmail(opts: {
  account: number;
  email: string;
}): Promise<ResolveContactByEmailOutput> {
  const origin = 'https://mail.google.com';
  const [sapisid, sapisid1, sapisid3] = await Promise.all([
    computeSapisidHash('SAPISID', origin),
    computeSapisidHash('__Secure-1PAPISID', origin),
    computeSapisidHash('__Secure-3PAPISID', origin),
  ]);

  const resp = await fetch(
    'https://peoplestack-pa.clients6.google.com/$rpc/peoplestack.PeopleStackAutocompleteService/Autocomplete',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'X-Goog-Api-Key': 'AIzaSyBm7aDMG9actsWSlx-MvrYsepwdnLgz69I',
        'X-Goog-AuthUser': String(opts.account),
        'X-User-Agent': 'grpc-web-javascript/0.1',
        'Authorization': `SAPISIDHASH ${sapisid} SAPISID1PHASH ${sapisid1} SAPISID3PHASH ${sapisid3}`,
      },
      body: JSON.stringify([134, opts.email, [1, 2], 8]),
    },
  );

  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  const data: unknown = await resp.json();
  const results: unknown[] = Array.isArray((data as unknown[][][][] | null)?.[0]?.[0]?.[0])
    ? ((data as unknown[][][][])[0][0][0] as unknown[])
    : [];

  for (const entry of results) {
    const emailField = Array.isArray(entry) ? entry[1] : null;
    const emailVal = Array.isArray(emailField) ? strOrNull(emailField[0]) : null;
    if (emailVal !== null && emailVal.toLowerCase() === opts.email.toLowerCase()) {
      const meta = Array.isArray(entry) ? entry[0] : null;
      const name = getNestedStr(meta, 1, 0);
      const givenName = getNestedStr(meta, 1, 1);
      const avatarUrl = getNestedStr(meta, 0, 0);
      return { email: opts.email, name, givenName, avatarUrl, found: name !== null };
    }
  }

  return { email: opts.email, name: null, givenName: null, avatarUrl: null, found: false };
}
