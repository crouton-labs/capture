/**
 * Shared Seamless.AI fetch helpers.
 * All HTTP errors are surfaced via throwForStatus so callers get typed VallumErrors.
 */

import { throwForStatus } from '@vallum/_runtime';

export const API_BASE = 'https://api.seamless.ai/api';
export const CLIENT_HEADER =
  'eyJhcHAiOiJjbGllbnQiLCJ2ZXJzaW9uIjoidjEzLjQ2LjI3LXByb2QuMSJ9';

export async function seamlessGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Seamlessai-Client': CLIENT_HEADER,
    },
  });
  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }
  return res.json();
}

export async function seamlessPost(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Seamlessai-Client': CLIENT_HEADER,
      'Content-Type': 'application/json',
      Referer: 'https://login.seamless.ai/',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }
  return res.json();
}

export async function seamlessPut(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Seamlessai-Client': CLIENT_HEADER,
      'Content-Type': 'application/json',
      Referer: 'https://login.seamless.ai/',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }
  return res.json();
}

export async function seamlessDelete(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'Seamlessai-Client': CLIENT_HEADER,
      Referer: 'https://login.seamless.ai/',
    },
  });
  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }
  return res.json();
}
