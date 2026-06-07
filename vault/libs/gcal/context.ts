/**
 * Google Calendar Context & Account Operations
 *
 * Authentication context extraction and account management.
 */

import { Validation, ContractDrift, NotFound, Unauthenticated, throwForStatus } from '@vallum/_runtime';

import type {
  Account,
  ClientHeader,
  BootstrapSyncContextOutput,
  ListAccountsOutput,
  SwitchAccountOutput,
} from './schemas';

/**
 * Parse ListAccounts response from accounts.google.com.
 */
function parseListAccountsResponse(html: string): Account[] {
  const match = html.match(/postMessage\('([^']+)'/);
  if (!match) {
    throw new ContractDrift('Could not parse ListAccounts response');
  }

  const escapedJson = match[1];
  const json = escapedJson
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\\//g, '/');

  const data = JSON.parse(json);

  const accountsArray = data[1];
  if (!Array.isArray(accountsArray)) {
    return [];
  }

  const accounts = accountsArray.map((acc) => {
    return {
      name: acc[2],
      email: acc[3],
      photoUrl: acc[4],
      accountNumber: acc[7],
      userId: acc[10],
      isCurrent: false,
    };
  });

  return accounts;
}

/**
 * Get default client header.
 */
function getDefaultClientHeader(): ClientHeader {
  return [
    null,
    3,
    'calendar.web_20260119.05_p0',
    null,
    null,
    null,
    null,
    Math.floor(Math.random() * 1000000000),
    null,
    'WEB',
    'prod-04-us.web',
    1,
    null,
    null,
    null,
    0,
    null,
    '2025b',
    1,
    1,
    null,
    1,
    1,
  ] as ClientHeader;
}

/**
 * Extract sync token from a sync.sync response.
 * Token location: response[0][2][1][0]
 *
 * IMPORTANT: This function is exported for use by CDP-level code that captures
 * sync tokens during page navigation. Browser JS alone cannot bootstrap a token.
 */
function extractSyncToken(responseText: string): string | null {
  try {
    let jsonText = responseText;
    if (jsonText.startsWith(")]}'\n")) {
      jsonText = jsonText.substring(5);
    } else if (jsonText.startsWith(")]}'")) {
      jsonText = jsonText.substring(4);
    }

    const parsed = JSON.parse(jsonText);

    if (parsed?.[0]?.[2]?.[1]?.[0]) {
      return parsed[0][2][1][0];
    }

    return null;
  } catch (e) {
    throw new ContractDrift(`Failed to extract sync token: ${(e as Error).message}`);
  }
}

/**
 * Bootstrap a sync context with valid secid and token from browser JS.
 *
 * This function can obtain a working sync token WITHOUT CDP page reload by:
 * 1. Making a sync.sync request without secid (returns 403)
 * 2. Reading X-New-Security-Id header from the 403 response
 * 3. Making sync.sync request WITH that secid (returns 200 + fresh token)
 *
 * Use this before write operations (createEvent, editEvent, deleteEvent).
 *
 * @returns Context with valid syncToken, secid, and account info
 */
export async function bootstrapSyncContext(input: {
  account?: number;
}): Promise<BootstrapSyncContextOutput> {
  // Verify we're on calendar.google.com
  if (!window.location.hostname.includes('calendar.google.com')) {
    throw new Validation(
      'Not on calendar.google.com. Navigate to https://calendar.google.com/calendar/u/{N}/ first.',
    );
  }

  // Get account number from input or URL
  let account: number;
  if (input.account !== undefined) {
    account = input.account;
  } else {
    const accountMatch = window.location.pathname.match(/\/u\/(\d+)/);
    if (!accountMatch) {
      throw new Validation(
        'Account number not found in URL. Provide account parameter or navigate to calendar.google.com/calendar/u/{N}/',
      );
    }
    account = parseInt(accountMatch[1]);
  }

  // Get calendar ID (email) from ListAccounts
  const accountsResp = await fetch(
    'https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1&origin=https://calendar.google.com',
    { credentials: 'include' },
  );
  const accountsHtml = await accountsResp.text();
  const accounts = parseListAccountsResponse(accountsHtml);
  const currentAccount = accounts.find((a) => a.accountNumber === account);

  if (!currentAccount) {
    throw new NotFound(`Account ${account} not found in account list`);
  }

  const email = currentAccount.email;
  const calendarId = email;
  const clientHeader = getDefaultClientHeader();

  // Get token from WIZ_global_data (will be stale but we need something to send)
  let initialToken = '';
  if (
    typeof (window as unknown as { WIZ_global_data?: unknown })
      .WIZ_global_data !== 'undefined'
  ) {
    const wizStr = JSON.stringify(
      (window as unknown as { WIZ_global_data: unknown }).WIZ_global_data,
    );
    const tokenMatch = wizStr.match(/C[A-Za-z0-9+/=]{50,}/);
    if (tokenMatch) {
      initialToken = tokenMatch[0];
    }
  }

  const url = `https://calendar.google.com/calendar/u/${account}/sync.sync`;

  // STEP 1: Make request WITHOUT secid to get X-New-Security-Id header
  const payload1 = [
    [clientHeader, initialToken, null, null, [[1, null, null, [], null, 160]]],
    60000,
  ];
  const resp1 = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'f.req=' +
      encodeURIComponent(JSON.stringify(payload1)) +
      '&cwuik=10&hl=en',
  });

  // Get secid from X-New-Security-Id header (works even on 403)
  const secid = resp1.headers.get('X-New-Security-Id');
  if (!secid) {
    throw new Unauthenticated(
      'Failed to get X-New-Security-Id from response. User may not be properly authenticated.',
    );
  }

  // STEP 2: Make request WITH secid to get fresh token
  const payload2 = [
    [clientHeader, initialToken, null, null, [[1, null, null, [], null, 160]]],
    60000,
  ];
  const resp2 = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'f.req=' +
      encodeURIComponent(JSON.stringify(payload2)) +
      '&cwuik=10&hl=en&secid=' +
      secid,
  });

  if (!resp2.ok) {
    throwForStatus(resp2.status, 'Failed to get sync token');
  }

  const text = await resp2.text();
  const syncToken = extractSyncToken(text);

  if (!syncToken) {
    throw new ContractDrift('Failed to extract sync token from response');
  }

  return {
    syncToken,
    clientHeader,
    secid,
    account,
    email,
    calendarId,
  };
}

/**
 * List all Google accounts in current browser session.
 */
export async function listAccounts(): Promise<ListAccountsOutput> {
  // Get current account from URL
  const accountMatch = window.location.pathname.match(/\/u\/(\d+)/);
  const currentAccountNumber = accountMatch ? parseInt(accountMatch[1]) : 0;

  // Fetch accounts from Google
  const resp = await fetch(
    'https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1&origin=https://calendar.google.com',
    { credentials: 'include' },
  );
  const html = await resp.text();
  const accounts = parseListAccountsResponse(html);

  // Mark current account
  accounts.forEach((acc) => {
    acc.isCurrent = acc.accountNumber === currentAccountNumber;
  });

  // Sort by account number
  accounts.sort((a, b) => a.accountNumber - b.accountNumber);

  return {
    accounts,
    currentAccountNumber,
    totalAccounts: accounts.length,
  };
}

/**
 * Switch to a different Google account calendar.
 */
export async function switchAccount(input: {
  accountNumber: number;
}): Promise<SwitchAccountOutput> {
  const { accountNumber } = input;
  const url = `https://calendar.google.com/calendar/u/${accountNumber}/r`;
  window.location.href = url;

  // Wait for navigation
  await new Promise((r) => setTimeout(r, 2000));

  return {
    success: true,
    accountNumber,
    url,
  };
}
