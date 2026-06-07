/**
 * Apollo Companies (Account CRUD) Module
 *
 * Create, update, delete accounts and manage account stages.
 */

import { Validation, throwForStatus } from '@vallum/_runtime';

import type {
  CreateAccountInput,
  CreateAccountOutput,
  UpdateAccountInput,
  UpdateAccountOutput,
  DeleteAccountInput,
  DeleteAccountOutput,
  UpdateAccountStageInput,
  UpdateAccountStageOutput,
  ListAccountStagesOutput,
} from '../schemas';

/**
 * Create a new account in Apollo.
 */
export async function createAccount(
  opts: CreateAccountInput,
): Promise<CreateAccountOutput> {
  const { name } = opts;

  if (!name) throw new Validation('name is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(opts),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * Update an existing account in Apollo.
 */
export async function updateAccount(
  opts: UpdateAccountInput,
): Promise<UpdateAccountOutput> {
  const { id, ...fields } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(fields),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * Delete an account from Apollo.
 */
export async function deleteAccount(
  opts: DeleteAccountInput,
): Promise<DeleteAccountOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/accounts/bulk_destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ids: [id] }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return { success: true };
}

/**
 * Update an account's stage.
 */
export async function updateAccountStage(
  opts: UpdateAccountStageInput,
): Promise<UpdateAccountStageOutput> {
  const { id, account_stage_id } = opts;

  if (!id) throw new Validation('id is required');
  if (!account_stage_id) throw new Validation('account_stage_id is required');

  const response = await fetch(`/api/v1/accounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ account_stage_id }),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * List all account stages in Apollo.
 */
export async function listAccountStages(): Promise<ListAccountStagesOutput> {
  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/account_stages`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}
