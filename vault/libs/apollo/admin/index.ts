/**
 * Apollo Admin Module
 * Custom fields, users, and email account management.
 */

import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

import type {
  ListFieldsOutput,
  ListUsersOutput,
  ListEmailAccountsOutput,
  UpdateEmailAccountInput,
  UpdateEmailAccountOutput,
} from '../schemas';

/**
 * List all available fields for an object type.
 */
export async function listFields(
  opts: { modality?: 'contact' | 'account' | 'opportunity' } = {},
): Promise<ListFieldsOutput> {
  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/fields`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const { modality } = opts;

  if (modality) {
    return {
      fields: data.fields.filter(
        (f: { modality: string | null }) => f.modality === modality,
      ),
      field_groups: data.field_groups.filter(
        (g: { modality: string }) => g.modality === modality,
      ),
    };
  }

  return data;
}

/**
 * List users in the Apollo team.
 */
export async function listUsers(
  opts: {
    page?: number;
    perPage?: number;
  } = {},
): Promise<ListUsersOutput> {
  const { page = 1, perPage = 25 } = opts;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/users/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      page,
      per_page: perPage,
    }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * List email accounts connected to Apollo.
 */
export async function listEmailAccounts(): Promise<ListEmailAccountsOutput> {
  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/email_accounts`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  const text = await response.text();
  if (!text) {
    throw new ContractDrift(
      'listEmailAccounts: empty response from Apollo. User may need to refresh their session.',
    );
  }

  const data = JSON.parse(text);
  if (!data.email_accounts || data.email_accounts.length === 0) {
    throw new ContractDrift(
      'listEmailAccounts: no email accounts found. Connect an email account in Apollo Settings > Email Accounts.',
    );
  }

  return data;
}

/**
 * Update email account sending settings.
 * Controls account-level sending limits per connected mailbox.
 */
export async function updateEmailAccount(
  opts: UpdateEmailAccountInput,
): Promise<UpdateEmailAccountOutput> {
  const { id, ...fields } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/email_accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(fields),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}
