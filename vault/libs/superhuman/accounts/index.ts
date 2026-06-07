/**
 * Superhuman Account Operations
 *
 * List and manage Superhuman accounts.
 */

import type {
  ListAccountsOutput,
  ListAliasesOutput,
  SuperhumanAliasEntry,
  SwitchAccountInput,
  SwitchAccountOutput,
} from '../schemas';
import { Unauthenticated, NotFound } from '@vallum/_runtime';

/**
 * List all Superhuman accounts available in the session.
 * Uses Account.accountList() to enumerate all signed-in accounts.
 */
export function listAccounts(): ListAccountsOutput {
  if (!window.Account) {
    return {
      accounts: [],
      total: 0,
    };
  }

  const account = window.Account;

  // accountList() returns an array of all signed-in email addresses
  const allEmails: string[] =
    typeof account.accountList === 'function'
      ? account.accountList()
      : [account.emailAddress];

  const currentEmail = account.emailAddress;
  const user = account.user;
  const currentName =
    user && user._name ? user._name : currentEmail.split('@')[0];

  // loginStore has provider info for all accounts, not just the active one
  const loginStore = account.accountStore?._loginStore;

  const accounts = allEmails.map((email: string) => {
    const isCurrent = email === currentEmail;

    // Get provider from loginStore (works for all accounts)
    let provider: string = 'unknown';
    if (isCurrent) {
      provider = account.credential?.provider ?? 'unknown';
    } else if (loginStore && typeof loginStore.getProvider === 'function') {
      try {
        provider = loginStore.getProvider(email) ?? 'unknown';
      } catch {
        provider = 'unknown';
      }
    }

    return {
      email,
      name: isCurrent ? currentName : email.split('@')[0],
      provider,
      isActive: isCurrent,
    };
  });

  return {
    accounts,
    total: accounts.length,
  };
}

/**
 * List available Gmail "Send As" aliases for the current account.
 */
export function listAliases(): ListAliasesOutput {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const aliasCache = account.settings?._cache?.aliases?.list;

  if (!aliasCache || !Array.isArray(aliasCache)) {
    return {
      account: email,
      aliases: [
        {
          email: email,
          name: account.user?._name || email.split('@')[0],
          isDefault: true,
          isPrimary: true,
        },
      ],
    };
  }

  const aliases = aliasCache.map((a: SuperhumanAliasEntry) => ({
    email: a.sendAs?.sendAsEmail || email,
    name: a.sendAs?.displayName || account.user?._name || email.split('@')[0],
    isDefault: a.sendAs?.isDefault || false,
    isPrimary: a.sendAs?.isPrimary || false,
  }));

  return { account: email, aliases };
}

/**
 * Switch to a different Superhuman account.
 * Triggers a full page reload; Account object goes null during transition.
 * If the target account needs re-authentication, returns requiresLogin: true.
 */
export async function switchAccount(
  params: SwitchAccountInput,
): Promise<SwitchAccountOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman.',
    );
  }

  const currentEmail = window.Account.emailAddress;
  if (currentEmail === params.email) {
    return {
      success: true,
      previousAccount: currentEmail,
      currentAccount: currentEmail,
      requiresLogin: false,
    };
  }

  // Verify account exists in the account list
  const allEmails: string[] =
    typeof window.Account.accountList === 'function'
      ? window.Account.accountList()
      : [currentEmail];

  if (!allEmails.includes(params.email)) {
    throw new NotFound(
      `Account "${params.email}" not found. Available accounts: ${allEmails.join(', ')}`,
    );
  }

  // Trigger switch; this reloads the page
  window.Account.switchAccount({ emailAddress: params.email });

  // Wait for Account to come back (page reloads, Account goes null then returns)
  const maxWait = 15000;
  const pollInterval = 500;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, pollInterval));

    if (window.Account && window.Account.emailAddress) {
      return {
        success: true,
        previousAccount: currentEmail,
        currentAccount: window.Account.emailAddress,
        requiresLogin: false,
      };
    }
  }

  // Account didn't come back; user likely needs to re-authenticate
  return {
    success: false,
    previousAccount: currentEmail,
    currentAccount: params.email,
    requiresLogin: true,
  };
}
