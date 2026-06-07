/**
 * Vamo Context
 *
 * Extract the active project ID from the current Vamo page URL.
 * Project ID is the only identifier required by Vamo's API endpoints —
 * authentication is cookie-based (HttpOnly) and sent automatically
 * via `credentials: 'include'`.
 */

import type { GetContextOutput } from './schemas';

const PROJECT_PATH_RE = /\/app\/project\/([0-9a-f-]{36})/i;

export async function getContext(): Promise<GetContextOutput> {
  const href = window.location.href;
  const match = href.match(PROJECT_PATH_RE);
  if (!match) {
    throw new Error(
      `getContext: not on a Vamo project page. Current URL: ${href}. ` +
        `Open https://vamotalent.com/app/chats, pick a project, and retry.`,
    );
  }
  return {
    projectId: match[1],
    baseUrl: `${window.location.protocol}//${window.location.host}`,
  };
}
