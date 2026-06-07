/**
 * Outlook Auth: getContext
 *
 * Extract authentication context from the current browser session.
 * Supports explicit account selection for multi-account scenarios.
 */

import type {
  GetContextInput,
  GetContextOutput,
  SwitchAccountInput,
  SwitchAccountOutput,
} from './schemas';
import { mapIanaToWindows } from './helpers';
import { Validation, Unauthenticated, ContractDrift, UpstreamError } from '@vallum/_runtime';

interface MsalAccount {
  email: string;
  displayName: string;
  homeAccountId: string;
}

/**
 * Extract Outlook authentication context from the current browser session.
 * Reads MSAL v2 tokens from localStorage and matches token to account via homeAccountId.
 */
export async function getContext(
  params?: GetContextInput,
): Promise<GetContextOutput> {
  const hostname = window.location.hostname;
  if (
    !hostname.includes('outlook.live.com') &&
    !hostname.includes('outlook.office.com') &&
    !hostname.includes('outlook.cloud.microsoft')
  ) {
    throw new Validation(
      `getContext: Not on Outlook domain. Navigate to outlook.live.com or outlook.office.com. Current URL: ${window.location.href}`,
    );
  }

  // Try plaintext MSAL cache first, fall back to fetch interception for encrypted caches
  const msalResult = tryMsalLocalStorage(params?.account);
  if (msalResult) {
    return msalResult;
  }

  // MSAL cache is encrypted; use fetch interception + boot diagnostics
  return await getContextViaInterception(params?.account);
}

/**
 * Try reading auth from plaintext MSAL v2 localStorage cache.
 * Returns null if the cache is encrypted or unreadable.
 */
function tryMsalLocalStorage(
  requestedAccount?: string,
): GetContextOutput | null {
  const owaClientId = '9199bf20-a13f-4107-85dc-02114787ef48';

  const accountKeysRaw = localStorage.getItem('msal.2.account.keys');
  if (!accountKeysRaw) return null;

  const accountKeys = JSON.parse(accountKeysRaw) as string[];
  const allAccounts: MsalAccount[] = [];

  for (const key of accountKeys) {
    const acctRaw = localStorage.getItem(key);
    if (!acctRaw) continue;
    const acct = JSON.parse(acctRaw) as {
      name?: string;
      username?: string;
      homeAccountId?: string;
    };
    // Encrypted entries have {id, nonce, data} instead of {username, homeAccountId}
    if (!acct.username || !acct.homeAccountId) continue;
    allAccounts.push({
      email: acct.username,
      displayName: acct.name || '',
      homeAccountId: acct.homeAccountId,
    });
  }

  if (allAccounts.length === 0) return null;

  const tokenKeysRaw = localStorage.getItem(`msal.2.token.keys.${owaClientId}`);
  if (!tokenKeysRaw) return null;

  const tokenKeys = JSON.parse(tokenKeysRaw) as {
    accessToken: string[];
    idToken: string[];
    refreshToken: string[];
  };

  const tokenByHomeAccount = new Map<
    string,
    { key: string; isConsumer: boolean }
  >();

  for (const tk of tokenKeys.accessToken) {
    const tokenRaw = localStorage.getItem(tk);
    if (!tokenRaw) continue;
    const tokenData = JSON.parse(tokenRaw) as {
      homeAccountId?: string;
      secret?: string;
    };
    if (!tokenData.homeAccountId || !tokenData.secret) continue;

    const isConsumer = tk.includes('service::outlook.office.com::mbi_ssl');
    const isOrg = tk.includes('outlook.office.com/owa.accessasuser.all');
    if (!isConsumer && !isOrg) continue;

    tokenByHomeAccount.set(tokenData.homeAccountId, {
      key: tk,
      isConsumer,
    });
  }

  const accountsWithTokens = allAccounts.filter((a) =>
    tokenByHomeAccount.has(a.homeAccountId),
  );

  if (accountsWithTokens.length === 0) return null;

  let selectedAccount: MsalAccount;

  if (requestedAccount) {
    const target = requestedAccount.toLowerCase();
    const match = accountsWithTokens.find(
      (a) => a.email.toLowerCase() === target,
    );
    if (!match) return null;
    selectedAccount = match;
  } else if (accountsWithTokens.length === 1) {
    selectedAccount = accountsWithTokens[0];
  } else {
    const available = accountsWithTokens
      .map((a) => `${a.email} (${a.displayName})`)
      .join(', ');
    throw new Validation(
      `getContext: Multiple accounts signed in. Specify which account to use via the "account" parameter. Available accounts: ${available}`,
    );
  }

  const tokenInfo = tokenByHomeAccount.get(selectedAccount.homeAccountId)!;
  const tokenDataRaw = localStorage.getItem(tokenInfo.key);
  if (!tokenDataRaw) return null;

  const tokenData = JSON.parse(tokenDataRaw) as {
    secret: string;
    expiresOn: string;
  };

  if (!tokenData.secret) return null;

  // MSAL stores expiresOn as Unix epoch seconds (string).
  // If expired, return null to fall through to fetch interception
  // which grabs a fresh token from a live OWA request.
  const expiresAtMs = parseInt(tokenData.expiresOn, 10) * 1000;
  if (expiresAtMs && expiresAtMs < Date.now()) {
    return null;
  }

  const authorization = tokenInfo.isConsumer
    ? `MSAuth1.0 usertoken="${tokenData.secret}", type="MSACT"`
    : `Bearer ${tokenData.secret}`;

  const ianaZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezone = mapIanaToWindows(ianaZone);

  const anchorMailbox = `SMTP:${selectedAccount.email}`;

  const availableAccounts = allAccounts.map((a) => ({
    email: a.email,
    displayName: a.displayName,
  }));

  // Canary is sync-extractable from document.cookie (no await needed in this path)
  const canary = extractCanarySync();

  return {
    auth: {
      authorization,
      sessionId: crypto.randomUUID(),
      anchorMailbox,
      correlationId: crypto.randomUUID(),
      canary,
      timezone,
    },
    email: selectedAccount.email,
    displayName: selectedAccount.displayName,
    availableAccounts,
  };
}

/**
 * Get auth context by intercepting OWA's own fetch calls.
 * Used when MSAL cache is encrypted (common on outlook.cloud.microsoft).
 *
 * Strategy: monkey-patch fetch, trigger a lightweight OWA API call by
 * clicking a navigation element, capture the Bearer token from request headers.
 * Falls back to boot diagnostics for user identity.
 */
async function getContextViaInterception(
  requestedAccount?: string,
): Promise<GetContextOutput> {
  // Read user identity from boot diagnostics
  const bootRaw = localStorage.getItem('olk-BootDiagnostics');
  if (!bootRaw) {
    throw new Unauthenticated(
      'getContext: No boot diagnostics found. User may not be logged in. URL: ' +
        window.location.href,
    );
  }
  const boot = JSON.parse(bootRaw) as {
    puid?: string;
    tid?: string;
    upn?: string;
  };
  const currentEmail = boot.upn || '';
  if (!currentEmail) {
    throw new ContractDrift(
      'getContext: No user principal name in boot diagnostics. URL: ' +
        window.location.href,
    );
  }

  // Discover available accounts from olk- keys and signed-in account list
  const availableAccounts = discoverAccounts(currentEmail);

  // If a specific account was requested, verify it matches the current session
  if (requestedAccount) {
    const target = requestedAccount.toLowerCase();
    if (currentEmail.toLowerCase() !== target) {
      const available = availableAccounts.map((a) => a.email).join(', ');
      throw new Validation(
        `getContext: Requested account "${requestedAccount}" does not match active session "${currentEmail}". ` +
          `To switch accounts, sign in with the desired account in the browser first. Available: ${available}`,
      );
    }
  }

  // Intercept fetch to capture the Bearer token
  const authorization = await captureAuthorizationHeader();

  const ianaZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezone = mapIanaToWindows(ianaZone);
  const canary = await extractCanary();
  const anchorMailbox = `SMTP:${currentEmail}`;

  return {
    auth: {
      authorization,
      sessionId: crypto.randomUUID(),
      anchorMailbox,
      correlationId: crypto.randomUUID(),
      canary,
      timezone,
    },
    email: currentEmail,
    displayName: '', // Not available from boot diagnostics
    availableAccounts,
  };
}

/**
 * Discover available accounts from localStorage markers.
 */
function discoverAccounts(
  currentEmail: string,
): Array<{ email: string; displayName: string }> {
  const accounts: Array<{ email: string; displayName: string }> = [];
  const seen = new Set<string>();

  // Current account from boot diagnostics
  seen.add(currentEmail.toLowerCase());
  accounts.push({ email: currentEmail, displayName: '' });

  // Check olk-ReportDialogStringsInformation-* keys for other accounts
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const match = key.match(/^olk-ReportDialogStringsInformation-(.+@.+\..+)$/);
    if (match) {
      const email = match[1];
      if (!seen.has(email.toLowerCase())) {
        seen.add(email.toLowerCase());
        accounts.push({ email, displayName: '' });
      }
    }
  }

  return accounts;
}

/**
 * Capture the Authorization header from OWA's own fetch calls.
 * Monkey-patches fetch, triggers a lightweight navigation, waits for the token.
 */
async function captureAuthorizationHeader(): Promise<string> {
  const origFetch = window.fetch;
  let captured: string | null = null;

  window.fetch = function (...args: Parameters<typeof fetch>) {
    const [, opts] = args;
    if (opts && opts.headers) {
      const h = opts.headers;
      let auth: string | null = null;
      if (h instanceof Headers) {
        auth = h.get('Authorization') || h.get('authorization');
      } else if (typeof h === 'object' && !Array.isArray(h)) {
        auth =
          (h as Record<string, string>).Authorization ||
          (h as Record<string, string>).authorization;
      }
      if (auth && (auth.startsWith('Bearer ') || auth.startsWith('MSAuth'))) {
        captured = auth;
      }
    }
    return origFetch.apply(this, args);
  };

  try {
    // Trigger OWA to make a fresh API call by switching modules.
    // SPA caches data in memory, so we must navigate to a DIFFERENT module.
    const url = window.location.href;
    const onCalendar = url.includes('/calendar');
    const allButtons = Array.from(
      document.querySelectorAll('button, a, [role="tab"]'),
    );

    // If on Calendar, click Mail; if on Mail, click Calendar
    const targetLabel = onCalendar ? 'Mail' : 'Calendar';
    const navBtn = allButtons.find(
      (el) =>
        el.textContent?.trim() === targetLabel ||
        el.getAttribute('aria-label')?.includes(targetLabel),
    );
    if (navBtn) {
      (navBtn as HTMLElement).click();
    }

    // Wait for the token to be captured (up to 8 seconds)
    for (let i = 0; i < 80; i++) {
      if (captured) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Navigate back to Mail if we went to Calendar
    if (!onCalendar && captured) {
      const mailBtn = allButtons.find(
        (el) =>
          el.textContent?.trim() === 'Mail' ||
          el.getAttribute('aria-label')?.includes('Mail'),
      );
      if (mailBtn) {
        (mailBtn as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  } finally {
    window.fetch = origFetch;
  }

  if (!captured) {
    throw new UpstreamError(
      'getContext: Could not capture auth token from OWA requests. Try refreshing the page. URL: ' +
        window.location.href,
    );
  }

  return captured;
}

/**
 * Extract the X-OWA-CANARY token from browser cookies.
 *
 * On enterprise/Exchange accounts, the canary is stored in a server-suffixed
 * cookie (X-OWA-CANARY_{targetServer}) and a targetServer cookie exists.
 *
 * On personal/consumer accounts (outlook.live.com), there is no canary cookie.
 * OWA's own JavaScript uses the sentinel value "X-OWA-CANARY_cookie_is_null_or_empty"
 * and the server accepts it for all operations (reads and writes). This is the
 * designed behavior, not an error.
 */
async function extractCanary(): Promise<string> {
  // Try cookieStore API first (can read cookies with any path scope,
  // including /owa/0/ cookies that document.cookie cannot see from /mail/0/)
  if (typeof cookieStore !== 'undefined') {
    try {
      const allCookies = await cookieStore.getAll();
      // Server-suffixed canary (enterprise accounts)
      const suffixed = allCookies.find(
        (c) =>
          c.name?.startsWith('X-OWA-CANARY_') && (c.value?.length ?? 0) > 10,
      );
      if (suffixed) return suffixed.value!;
      // Unsuffixed canary (personal accounts, path-scoped)
      const unsuffixed = allCookies.find((c) => c.name === 'X-OWA-CANARY');
      if (unsuffixed) return unsuffixed.value!;
    } catch {
      // cookieStore not available in this context
    }
  }

  // Fallback to document.cookie parsing (works when cookies are on current path)
  const cookies = document.cookie;
  const targetServerMatch = cookies.match(/(?:^|; )targetServer=([^;]+)/);
  const targetServer = targetServerMatch ? targetServerMatch[1] : '';
  if (targetServer) {
    const suffix = targetServer.toLowerCase();
    const canaryRe = new RegExp(
      `(?:^|; )X-OWA-CANARY_${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]+)`,
    );
    const match = cookies.match(canaryRe);
    if (match) return match[1];
  }
  const unsuffixedMatch = cookies.match(/(?:^|; )X-OWA-CANARY=([^;]+)/);
  if (unsuffixedMatch) return unsuffixedMatch[1];

  // No canary cookie found. On personal/consumer accounts this is expected.
  // OWA's own JS uses this exact fallback value, and the server accepts it.
  return 'X-OWA-CANARY_cookie_is_null_or_empty';
}

/**
 * Synchronous canary extraction from document.cookie only.
 * Used by the plaintext MSAL path which doesn't need async.
 */
function extractCanarySync(): string {
  const cookies = document.cookie;
  const targetServerMatch = cookies.match(/(?:^|; )targetServer=([^;]+)/);
  const targetServer = targetServerMatch ? targetServerMatch[1] : '';
  if (targetServer) {
    const suffix = targetServer.toLowerCase();
    const canaryRe = new RegExp(
      `(?:^|; )X-OWA-CANARY_${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]+)`,
    );
    const match = cookies.match(canaryRe);
    if (match) return match[1];
  }
  const unsuffixedMatch = cookies.match(/(?:^|; )X-OWA-CANARY=([^;]+)/);
  if (unsuffixedMatch) return unsuffixedMatch[1];
  return 'X-OWA-CANARY_cookie_is_null_or_empty';
}

// ============================================================================
// switchAccount
// ============================================================================

const PERSONAL_DOMAINS = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'];

/**
 * Infer whether an email address belongs to a personal Microsoft account.
 */
function isPersonalEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return PERSONAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Switch the active Outlook account by navigating to the target account's
 * Outlook domain with a login_hint parameter. After navigation completes,
 * calls getContext() to obtain fresh auth for the new account.
 */
export async function switchAccount(
  params: SwitchAccountInput,
): Promise<SwitchAccountOutput> {
  const { email, accountType } = params;

  if (!email) {
    throw new Validation(
      'switchAccount: email is required. Provide the email of the account to switch to.',
    );
  }

  // Determine target domain
  const isPersonal =
    accountType === 'personal' ||
    (accountType == null && isPersonalEmail(email));
  const domain = isPersonal ? 'outlook.live.com' : 'outlook.cloud.microsoft';
  const targetUrl = `https://${domain}/mail/?login_hint=${encodeURIComponent(email)}`;

  // Navigate to the target account
  window.location.href = targetUrl;

  // Wait for the SPA to finish loading on the new domain.
  // Poll until hostname matches and the page has interactive content.
  const maxWaitMs = 15000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 500));
    // Check if we've landed on the target domain
    if (window.location.hostname.includes(domain.split('.')[0])) {
      // Check if the page has loaded enough; look for boot diagnostics or MSAL data
      const hasBootDiag = localStorage.getItem('olk-BootDiagnostics') !== null;
      const hasMsal = localStorage.getItem('msal.2.account.keys') !== null;
      if (hasBootDiag || hasMsal) {
        // Give the SPA a moment to finish initializing
        await new Promise((r) => setTimeout(r, 1500));
        break;
      }
    }
  }

  // Get fresh auth context for the new account
  const context = await getContext({ account: email });

  return {
    auth: context.auth,
    email: context.email,
    displayName: context.displayName,
    availableAccounts: context.availableAccounts,
    domain,
  };
}
