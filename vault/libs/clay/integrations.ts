/**
 * Integration and app account management operations
 */

import { ContractDrift, NotFound, Validation } from '@vallum/_runtime';
import { clayFetch as _clayFetch } from './shared';
import type {
  GetAppAccountTypesOutput,
  GetAppAccountTypeOutput,
  GetAppAccountsByTypeOutput,
  CreateAppAccountOutput,
  UpdateAppAccountOutput,
  DeleteAppAccountOutput,
} from './schemas';

/**
 * Get list of all available integration types/providers.
 * Returns available providers like anthropic, gpt-3, hubspot, salesforce, etc.
 */
export async function getAppAccountTypes(): Promise<GetAppAccountTypesOutput> {
  const data = await _clayFetch<
    Array<{
      id: string;
      authenticationType: string;
      displayMetadata: {
        name: string;
        providerName?: string;
      };
    }>
  >('/app-accounts/types');

  if (!Array.isArray(data)) {
    throw new ContractDrift(
      `getAppAccountTypes: expected array from /app-accounts/types, got ${typeof data}`,
    );
  }

  return {
    types: data.map((t) => ({
      id: t.id,
      name: t.displayMetadata?.name ?? t.id,
      category: t.authenticationType,
    })),
  };
}

/**
 * Get metadata and authentication configuration for a specific integration type.
 */
export async function getAppAccountType(opts: {
  type: string;
}): Promise<GetAppAccountTypeOutput> {
  const data = await _clayFetch<
    Array<{
      id: string;
      authenticationType: string;
      displayMetadata: {
        icon: string;
        name: string;
        defaultName: string;
        description: string;
        providerName?: string;
        providerUrl?: string;
      };
      typeSpecific: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
    }>
  >('/app-accounts/types');

  if (!Array.isArray(data)) {
    throw new ContractDrift(
      `getAppAccountType: expected array from /app-accounts/types, got ${typeof data}`,
    );
  }

  const match = data.find((t) => t.id === opts.type);
  if (!match) {
    throw new NotFound(
      `getAppAccountType: no integration type found for "${opts.type}"`,
    );
  }

  return match as unknown as GetAppAccountTypeOutput;
}

/**
 * Get all app accounts of a specific integration type in a workspace.
 */
export async function getAppAccountsByType(opts: {
  workspaceId: string | number;
  type: string;
}): Promise<GetAppAccountsByTypeOutput> {
  const data = await _clayFetch<
    Array<{
      id: string;
      name: string;
      appAccountTypeId: string;
      isSharedPublicKey: boolean;
      userOwnerId: number | string | null;
      workspaceOwnerId: number | string | null;
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
      useStaticIP: boolean;
      reauthInitiatedAt: string | null;
      reauthInitiatedByUserId: number | string | null;
      obfuscatedCredentials: Record<string, unknown> | null;
      abilities: { canUpdate: boolean; canDelete: boolean };
    }>
  >(`/app-accounts?workspaceId=${opts.workspaceId}`);

  if (!Array.isArray(data)) {
    throw new ContractDrift(
      `getAppAccountsByType: expected array from /app-accounts, got ${typeof data}`,
    );
  }

  return data.filter(
    (account) => account.appAccountTypeId === opts.type,
  ) as unknown as GetAppAccountsByTypeOutput;
}

/**
 * Create a new integration connection in a workspace.
 */
export async function createAppAccount(opts: {
  workspaceId: string | number;
  appAccountTypeId: string;
  name?: string;
  credentials?: Record<string, unknown>;
  useStaticIP?: boolean;
  setAsDefault?: boolean;
}): Promise<CreateAppAccountOutput> {
  const body: Record<string, unknown> = {
    appAccountTypeId: opts.appAccountTypeId,
    auth: opts.credentials ?? {},
  };
  if (opts.name != null) body.name = opts.name;
  if (opts.useStaticIP != null) body.useStaticIP = opts.useStaticIP;
  if (opts.setAsDefault != null) body.setAsDefault = opts.setAsDefault;

  const data = await _clayFetch<CreateAppAccountOutput>(
    `/workspaces/${opts.workspaceId}/app-accounts`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  return data;
}

/**
 * Update an existing integration connection.
 */
export async function updateAppAccount(opts: {
  workspaceId: string | number;
  accountId: string;
  name?: string;
  credentials?: Record<string, unknown>;
  useStaticIP?: boolean;
}): Promise<UpdateAppAccountOutput> {
  const body: Record<string, unknown> = {};
  if (opts.name != null) body.name = opts.name;
  if (opts.credentials != null) body.auth = opts.credentials;
  if (opts.useStaticIP != null) body.useStaticIP = opts.useStaticIP;

  const data = await _clayFetch<UpdateAppAccountOutput>(
    `/workspaces/${opts.workspaceId}/app-accounts/accounts/${opts.accountId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );

  return data;
}

/**
 * Delete/disconnect an integration connection from a workspace.
 */
export async function deleteAppAccount(opts: {
  workspaceId: string | number;
  accountId: string;
}): Promise<DeleteAppAccountOutput> {
  const { workspaceId, accountId } = opts;

  if (!workspaceId) {
    throw new Validation('deleteAppAccount: workspaceId is required');
  }
  if (!accountId) {
    throw new Validation('deleteAppAccount: accountId is required');
  }

  await _clayFetch(
    `/workspaces/${workspaceId}/app-accounts/accounts/${accountId}`,
    { method: 'DELETE' },
  );

  return { success: true };
}
