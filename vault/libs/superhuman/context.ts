/**
 * Superhuman Context & Account Operations
 *
 * Authentication context and account management.
 */

import type { SuperhumanContext } from './schemas';

/**
 * Check if user is on Superhuman and authenticated.
 * Verifies presence of Account global object.
 */
export function getContext(): SuperhumanContext {
  const isSuperhuman =
    window.location.hostname === 'mail.superhuman.com' ||
    window.location.protocol === 'superhuman-app:';

  if (!isSuperhuman) {
    return {
      authenticated: false,
      email: null,
      provider: null,
      note: 'Not on Superhuman. For email operations, use the Gmail library at mail.google.com.',
    };
  }

  // Check for Account object
  if (!window.Account) {
    return {
      authenticated: false,
      email: null,
      provider: null,
      note: 'Account object not found. User may not be logged in. Use Gmail library for email operations.',
    };
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential?.provider;

  if (!email || !provider) {
    return {
      authenticated: false,
      email: null,
      provider: null,
      note: 'User not authenticated to Superhuman. Use Gmail library for email operations.',
    };
  }

  return {
    authenticated: true,
    email,
    provider,
    note: 'Superhuman session active. Use sendEmail, sendReply, scheduleSend for email operations.',
  };
}
