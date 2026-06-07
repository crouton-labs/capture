/**
 * HubSpot Context & Account Operations
 *
 * Authentication context extraction and account management.
 */

import type {
  GetAccountsOutput,
  GetContextInput,
  GetContextOutput,
} from './schemas';
import { NotFound, Unauthenticated, Validation, throwForStatus } from '@vallum/_runtime';

interface CrossHubletAccount {
  id: number;
  accountName: string;
  hublet: string;
  appDomain: string;
}

interface CrossHubletResponse {
  accounts: CrossHubletAccount[];
}

/**
 * Fetch all HubSpot accounts accessible to the current user.
 * Works from any HubSpot page where the user is authenticated.
 */
export async function getAccounts(): Promise<GetAccountsOutput> {
  const resp = await fetch(
    '/api/accounts/v1/accounts/cross-hublet?includePins=true&includeStats=false',
    { credentials: 'include' },
  );
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  const data: CrossHubletResponse = await resp.json();
  return data.accounts.map((a) => ({
    portalId: String(a.id),
    name: a.accountName,
    hublet: a.hublet,
    appDomain: a.appDomain,
  }));
}

/**
 * Get CSRF token and portal context for HubSpot API calls.
 * Call this FIRST before any other HubSpot operations.
 */
export async function getContext(
  opts: GetContextInput = {},
): Promise<GetContextOutput> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const startTime = Date.now();

  while (!window.location.hostname.includes('hubspot.com')) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Validation(`Not on HubSpot domain. URL: ${window.location.href}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const csrf = document.cookie
    .split('; ')
    .find((c) => c.startsWith('hubspotapi-csrf='))
    ?.split('=')[1];

  if (!csrf) {
    throw new Unauthenticated(
      `CSRF token not found. User may not be logged in. URL: ${window.location.href}`,
    );
  }

  const accounts = await getAccounts();
  if (accounts.length === 0) {
    throw new NotFound('No HubSpot accounts found for this user.');
  }

  let account = accounts[0];

  if (accounts.length > 1) {
    // Try to detect the current portal from the URL path (e.g., /contacts/243309418/...)
    const urlPortalMatch = window.location.pathname.match(
      /\/(?:contacts|companies|deals|crm)\/(\d+)\//,
    );
    if (urlPortalMatch) {
      const urlPortalId = urlPortalMatch[1];
      const matched = accounts.find((a) => a.portalId === urlPortalId);
      if (matched) {
        account = matched;
      } else {
        const accountList = accounts
          .map((a) => `  - ${a.name} (${a.portalId}, ${a.hublet})`)
          .join('\n');
        throw new Validation(
          `Multiple HubSpot accounts found and URL portal ${urlPortalId} does not match any account:\n${accountList}`,
        );
      }
    } else {
      const accountList = accounts
        .map((a) => `  - ${a.name} (${a.portalId}, ${a.hublet})`)
        .join('\n');
      throw new Validation(
        `Multiple HubSpot accounts found. Navigate to a specific portal:\n${accountList}\n\n` +
          `Example: ${accounts[0].appDomain}/contacts/${accounts[0].portalId}/objects/0-1/views/all/list`,
      );
    }
  }
  const currentOrigin = window.location.origin;
  const expectedOrigin = account.appDomain;

  if (currentOrigin !== expectedOrigin) {
    const redirectUrl = `${expectedOrigin}/contacts/${account.portalId}/objects/0-1/views/all/list`;
    window.location.href = redirectUrl;
    throw new Error(
      `NAVIGATING: Auto-redirecting to ${redirectUrl}. Call getContext() again after page loads.`,
    );
  }

  // Fetch user info from connected inboxes
  let userId = '';
  let userEmail = '';
  try {
    const inboxResp = await fetch(
      `/api/facsimile/v1/inboxes?portalId=${account.portalId}`,
      {
        credentials: 'include',
        headers: { 'x-hubspot-csrf-hubspotapi': csrf },
      },
    );
    if (inboxResp.ok) {
      const inboxData = await inboxResp.json();
      const inbox = inboxData.inboxes?.find(
        (i: { inbox_type: string }) => i.inbox_type !== 'HUBSPOT_HOSTED',
      );
      if (inbox) {
        userId = String(inbox.hub_spot_user_id);
        userEmail = inbox.email_address;
      }
    }
  } catch {
    // userId/userEmail will remain empty
  }

  return {
    csrf,
    portalId: account.portalId,
    hublet: account.hublet,
    appDomain: account.appDomain,
    userId,
    userEmail,
  };
}
