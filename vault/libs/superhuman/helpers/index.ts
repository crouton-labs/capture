/**
 * Superhuman Internal Helpers
 *
 * Shared utilities for Superhuman operations.
 */

import { Unauthenticated } from '@vallum/_runtime';

/**
 * Get authorization headers for Superhuman backend API calls.
 * Uses the Account credential's ID token.
 */
export async function getBackendHeaders(): Promise<Record<string, string>> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman.',
    );
  }

  const credential = window.Account.backend._credential;
  if (!credential || typeof credential.getIDTokenAsync !== 'function') {
    throw new Unauthenticated(
      'Cannot access Superhuman credentials. Backend API unavailable.',
    );
  }

  const idToken = await credential.getIDTokenAsync();
  return {
    'Content-Type': 'text/plain;charset=UTF-8',
    Authorization: `Bearer ${idToken}`,
  };
}
