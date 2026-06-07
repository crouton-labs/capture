import { Unauthenticated, throwForStatus } from '@vallum/_runtime';

export function getDsc(): string {
  const match = document.cookie.match(/dsc=([^;]+)/);
  if (!match) {
    throw new Unauthenticated(
      `Trello dsc CSRF token not found in document.cookie. URL: ${window.location.href}`,
    );
  }
  return match[1];
}

export function apiUrl(path: string): string {
  return `${window.location.origin}/1/${path}`;
}

export async function apiFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => undefined);
    throwForStatus(res.status, body);
  }
  return res;
}
