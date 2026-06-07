/**
 * Gmail Context & Account Operations
 *
 * Authentication context extraction and account management.
 */

import type {
  GmailGlobals,
  GmailContext,
  ListAccountsOutput,
  Account,
} from './schemas';

import {
  Validation,
  ContractDrift,
  Unauthenticated,
  throwForStatus,
} from '@vallum/_runtime';

/**
 * Extract Gmail authentication context from current session.
 * Call FIRST before any Gmail operations.
 */
export async function getContext(
  opts: {
    timeoutMs?: number;
  } = {},
): Promise<GmailContext> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const startTime = Date.now();

  // Wait for page to be on Gmail domain
  while (!window.location.hostname.includes('mail.google.com')) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Validation(
        `Not on Gmail domain. Navigate to mail.google.com. Current URL: ${window.location.href}`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Get account number from URL
  const accountMatch = window.location.pathname.match(/\/u\/(\d+)/);
  if (!accountMatch) {
    throw new Validation(
      'Account number not found in URL. Navigate to /mail/u/{N}/',
    );
  }
  const account = parseInt(accountMatch[1]);

  // Fetch Gmail page to extract auth from response text
  const response = await fetch(`/mail/u/${account}/`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throwForStatus(response.status);
  }

  const text = await response.text();

  // Extract XSRF token
  const xsrfMatch = text.match(/AK[a-zA-Z0-9_-]{20,}:[0-9]+/);
  if (!xsrfMatch) {
    throw new Unauthenticated('XSRF token not found. User may not be logged in.');
  }
  const xsrf = xsrfMatch[0];

  // Extract GLOBALS values
  // Format: GLOBALS=[null,null,g2,"g3","g4","g5","g6","g7",g8,"g9","g10",...]
  const globalsMatch = text.match(
    /GLOBALS=\[null,null,(\d+),"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)",(\d+),"([^"]+)","([^"]+)"/,
  );

  if (!globalsMatch) {
    throw new Unauthenticated(
      'GLOBALS not found in response. User may not be logged in.',
    );
  }

  const globals: GmailGlobals = {
    g2: parseInt(globalsMatch[1]),
    g3: globalsMatch[2],
    g9: globalsMatch[8],
    g10: globalsMatch[9],
  };

  return {
    xsrf,
    account,
    internalUserId: globals.g2,
    email: globals.g10,
    globals,
  };
}

/**
 * List all Gmail accounts in the current browser session.
 */
export async function listAccounts(): Promise<ListAccountsOutput> {
  // Get current account from URL
  const accountMatch = window.location.pathname.match(/\/u\/(\d+)/);
  const currentAccountNumber = accountMatch ? parseInt(accountMatch[1]) : 0;

  // Fetch accounts from Google
  const resp = await fetch(
    'https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1&origin=https://mail.google.com',
    { credentials: 'include' },
  );

  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  const html = await resp.text();

  // Parse postMessage response
  const match = html.match(/postMessage\('([^']+)'/);
  if (!match) {
    throw new ContractDrift('Could not parse ListAccounts response');
  }

  // Unescape JSON
  const escapedJson = match[1];
  const json = escapedJson
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\\//g, '/');

  const data = JSON.parse(json);
  const accountsArray = data[1];

  if (!Array.isArray(accountsArray)) {
    return { accounts: [], currentAccountNumber, totalAccounts: 0 };
  }

  const accounts: Account[] = accountsArray.map((acc: unknown[]) => ({
    name: acc[2] as string,
    email: acc[3] as string,
    accountNumber: acc[7] as number,
    userId: acc[10] as string,
    isCurrent: (acc[7] as number) === currentAccountNumber,
  }));

  accounts.sort((a, b) => (a.accountNumber ?? 0) - (b.accountNumber ?? 0));

  return {
    accounts,
    currentAccountNumber,
    totalAccounts: accounts.length,
  };
}
