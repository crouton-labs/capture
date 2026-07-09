/**
 * GoDaddy — portfolio folders (foldersApi, host domainsapi.godaddy.com).
 *
 * Folders group registered domains for organization and bulk management. All
 * calls are scoped to the signed-in customer (cookie context); the caller never
 * passes a customer id.
 */

import {
  dccFetch,
  getCustomerId,
  FOLDER_API,
  Validation,
  NotFound,
} from './_shared';
import type {
  Folder,
  ListFoldersOutput,
  CreateFolderOutput,
  UpdateFolderOutput,
  DeleteFolderOutput,
  AddDomainsToFolderOutput,
  RemoveDomainsFromFolderOutput,
} from './schemas-folders';

export type {
  Folder,
  ListFoldersOutput,
  CreateFolderOutput,
  UpdateFolderOutput,
  DeleteFolderOutput,
  AddDomainsToFolderOutput,
  RemoveDomainsFromFolderOutput,
} from './schemas-folders';

// ============================================================================
// Helpers
// ============================================================================

function foldersBase(): string {
  return `${FOLDER_API}/v1/customers/${getCustomerId()}/folders`;
}

function extractDomainNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .map((d) =>
      typeof d === 'string'
        ? d
        : ((d as { domainName?: string; name?: string })?.domainName ??
          (d as { name?: string })?.name),
    )
    .filter((n): n is string => typeof n === 'string');
  return names;
}

/** Project a raw folder record to the documented Folder shape, preserving extras. */
function toFolder(raw: Record<string, unknown>): Folder {
  const id = raw.folderId ?? raw.id;
  const domainCount = raw.domainCount ?? raw.count;
  const domains = extractDomainNames(raw.domains);
  return {
    ...raw,
    folderId: id != null ? String(id) : '',
    name: (raw.name as string) ?? (raw.folderName as string) ?? '',
    ...(domainCount != null ? { domainCount: Number(domainCount) } : {}),
    ...(domains ? { domains } : {}),
  } as Folder;
}

/** The folders list endpoint may return a bare array or an enveloped list. */
function extractFolderList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const candidate = obj.folders ?? obj.folderList ?? obj.results;
    if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
  }
  return [];
}

interface DomainFilterExtras {
  domainNameContains?: string;
  folderIds?: number[];
  profileIds?: number[];
  domainStates?: string[];
  registrationTypes?: string[];
  tlds?: string[];
  isAutoRenewEnabled?: boolean;
  isLocked?: boolean;
  privacyLevels?: string[];
  protectionPlans?: string[];
  nameserverFilter?: { names: string[]; type: 'INCLUDE' | 'EXCLUDE' };
  minimumExpirationDays?: number;
  maximumExpirationDays?: number;
  forwardingURL?: string;
}

async function updateFolderMembers(
  folderId: string,
  domainNames: string[],
  action: 'add' | 'remove',
  domainFilterType: 'INCLUDE' | 'EXCLUDE' = 'INCLUDE',
  extras: DomainFilterExtras = {},
): Promise<void> {
  const domainFilter: Record<string, unknown> = {
    domainNamesFilter: { names: domainNames, type: domainFilterType },
  };
  if (extras.domainNameContains != null)
    domainFilter.domainNameContains = extras.domainNameContains;
  if (extras.folderIds?.length) domainFilter.folderIds = extras.folderIds;
  if (extras.profileIds?.length) domainFilter.profileIds = extras.profileIds;
  if (extras.domainStates?.length)
    domainFilter.domainStates = extras.domainStates;
  if (extras.registrationTypes?.length)
    domainFilter.registrationTypes = extras.registrationTypes;
  if (extras.tlds?.length) domainFilter.tlds = extras.tlds;
  if (extras.isAutoRenewEnabled != null)
    domainFilter.isAutoRenewEnabled = extras.isAutoRenewEnabled;
  if (extras.isLocked != null) domainFilter.isLocked = extras.isLocked;
  if (extras.privacyLevels?.length)
    domainFilter.privacyLevels = extras.privacyLevels;
  if (extras.protectionPlans?.length)
    domainFilter.protectionPlans = extras.protectionPlans;
  if (extras.nameserverFilter)
    domainFilter.nameserverFilter = extras.nameserverFilter;
  if (extras.minimumExpirationDays != null)
    domainFilter.minimumExpirationDays = extras.minimumExpirationDays;
  if (extras.maximumExpirationDays != null)
    domainFilter.maximumExpirationDays = extras.maximumExpirationDays;
  if (extras.forwardingURL) domainFilter.forwardingURL = extras.forwardingURL;

  await dccFetch<void>(`${foldersBase()}/multiple/members/update`, {
    method: 'POST',
    body: JSON.stringify({
      domainFilter,
      folderActions: [{ folderId: Number(folderId), action }],
    }),
  });
}

// ============================================================================
// listFolders
// ============================================================================

export async function listFolders(
  args: { includeAllDomains?: boolean } = {},
): Promise<ListFoldersOutput> {
  const includeAll = args.includeAllDomains !== false;
  let data: unknown;
  try {
    data = await dccFetch<unknown>(
      `${foldersBase()}?includeAllDomains=${includeAll}`,
    );
  } catch (err) {
    if (err instanceof NotFound) return { folders: [], total: 0 };
    throw err;
  }
  const folders = extractFolderList(data).map(toFolder);
  return { folders, total: folders.length };
}

// ============================================================================
// createFolder
// ============================================================================

export async function createFolder(args: {
  name: string;
}): Promise<CreateFolderOutput> {
  if (!args.name?.trim())
    throw new Validation('createFolder requires a non-empty name.');
  const data = await dccFetch<Record<string, unknown>>(foldersBase(), {
    method: 'POST',
    body: JSON.stringify({ name: args.name, permissions: {} }),
  });
  return { folder: toFolder({ name: args.name, ...(data ?? {}) }) };
}

// ============================================================================
// updateFolder
// ============================================================================

export async function updateFolder(args: {
  folderId: string;
  name: string;
}): Promise<UpdateFolderOutput> {
  if (!args.folderId) throw new Validation('updateFolder requires folderId.');
  if (!args.name?.trim())
    throw new Validation('updateFolder requires a non-empty name.');
  const data = await dccFetch<Record<string, unknown>>(
    `${foldersBase()}/${encodeURIComponent(args.folderId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name: args.name, permissions: {} }),
    },
  );
  return {
    folder: toFolder({
      folderId: args.folderId,
      name: args.name,
      ...(data ?? {}),
    }),
  };
}

// ============================================================================
// deleteFolder
// ============================================================================

export async function deleteFolder(args: {
  folderId: string;
}): Promise<DeleteFolderOutput> {
  if (!args.folderId) throw new Validation('deleteFolder requires folderId.');
  await dccFetch<void>(
    `${foldersBase()}/${encodeURIComponent(args.folderId)}`,
    {
      method: 'DELETE',
    },
  );
  return { folderId: args.folderId, deleted: true };
}

// ============================================================================
// addDomainsToFolder
// ============================================================================

export async function addDomainsToFolder(args: {
  folderId: string;
  domainNames: string[];
  domainFilterType?: 'INCLUDE' | 'EXCLUDE';
}): Promise<AddDomainsToFolderOutput> {
  if (!args.folderId)
    throw new Validation('addDomainsToFolder requires folderId.');
  const filterType = args.domainFilterType ?? 'INCLUDE';
  if (filterType === 'INCLUDE' && !args.domainNames?.length) {
    throw new Validation(
      'addDomainsToFolder requires at least one domain name when using INCLUDE filter.',
    );
  }
  await updateFolderMembers(
    args.folderId,
    args.domainNames ?? [],
    'add',
    filterType,
  );
  return { folderId: args.folderId, added: args.domainNames ?? [] };
}

// ============================================================================
// removeDomainsFromFolder
// ============================================================================

export async function removeDomainsFromFolder(args: {
  folderId: string;
  domainNames: string[];
  domainFilterType?: 'INCLUDE' | 'EXCLUDE';
  domainNameContains?: string;
  folderIds?: string[];
  profileIds?: string[];
  domainStates?: string[];
  registrationTypes?: string[];
  tlds?: string[];
  isAutoRenewEnabled?: boolean;
  isLocked?: boolean;
  privacyLevels?: string[];
  protectionPlans?: string[];
  nameservers?: string[];
  nameserverFilterType?: 'INCLUDE' | 'EXCLUDE';
  minimumExpirationDays?: number;
  maximumExpirationDays?: number;
  forwardingURL?: string;
}): Promise<RemoveDomainsFromFolderOutput> {
  if (!args.folderId)
    throw new Validation('removeDomainsFromFolder requires folderId.');
  const filterType = args.domainFilterType ?? 'INCLUDE';
  if (filterType === 'INCLUDE' && !args.domainNames?.length) {
    throw new Validation(
      'removeDomainsFromFolder requires at least one domain name when using INCLUDE filter.',
    );
  }
  function toIntId(label: string, ids: string[]): number[] {
    return ids.map((id) => {
      const n = Number(id);
      if (!Number.isInteger(n)) {
        throw new Validation(
          `removeDomainsFromFolder: ${label} must be numeric integer strings (got "${id}").`,
        );
      }
      return n;
    });
  }
  const nameserverFilter = args.nameservers?.length
    ? {
        names: args.nameservers,
        type: args.nameserverFilterType ?? ('INCLUDE' as const),
      }
    : undefined;
  await updateFolderMembers(
    args.folderId,
    args.domainNames ?? [],
    'remove',
    filterType,
    {
      domainNameContains: args.domainNameContains,
      folderIds: args.folderIds?.length
        ? toIntId('folderIds', args.folderIds)
        : undefined,
      profileIds: args.profileIds?.length
        ? toIntId('profileIds', args.profileIds)
        : undefined,
      domainStates: args.domainStates,
      registrationTypes: args.registrationTypes,
      tlds: args.tlds,
      isAutoRenewEnabled: args.isAutoRenewEnabled,
      isLocked: args.isLocked,
      privacyLevels: args.privacyLevels,
      protectionPlans: args.protectionPlans,
      nameserverFilter,
      minimumExpirationDays: args.minimumExpirationDays,
      maximumExpirationDays: args.maximumExpirationDays,
      forwardingURL: args.forwardingURL,
    },
  );
  return { folderId: args.folderId, removed: args.domainNames ?? [] };
}
