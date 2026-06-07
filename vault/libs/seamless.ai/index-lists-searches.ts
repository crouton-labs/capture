/**
 * Seamless.AI Library: Lists & Searches
 *
 * Functions for managing contact lists (tags) and saved searches.
 */

export type {
  DeleteContactListInput,
  DeleteContactListOutput,
  RemoveContactsFromListInput,
  RemoveContactsFromListOutput,
  AddCompaniesToListInput,
  AddCompaniesToListOutput,
  ListSavedSearchesInput,
  ListSavedSearchesOutput,
  DeleteSavedSearchInput,
  DeleteSavedSearchOutput,
  CreateSavedSearchInput,
  CreateSavedSearchOutput,
  ExportContactsInput,
  ExportContactsOutput,
  ListEnrichJobsInput,
  ListEnrichJobsOutput,
  SavedSearch,
  ExportJob,
  EnrichJob,
} from './schemas-lists-searches';

import type {
  DeleteContactListInput,
  DeleteContactListOutput,
  RemoveContactsFromListInput,
  RemoveContactsFromListOutput,
  AddCompaniesToListInput,
  AddCompaniesToListOutput,
  ListSavedSearchesInput,
  ListSavedSearchesOutput,
  DeleteSavedSearchInput,
  DeleteSavedSearchOutput,
  CreateSavedSearchInput,
  CreateSavedSearchOutput,
  ExportContactsInput,
  ExportContactsOutput,
  ListEnrichJobsInput,
  ListEnrichJobsOutput,
} from './schemas-lists-searches';

import { Validation, ContractDrift } from '@vallum/_runtime';
import { seamlessGet, seamlessPost, seamlessDelete } from './helpers';

// ============================================================================
// deleteContactList
// ============================================================================

export async function deleteContactList(
  params: DeleteContactListInput,
): Promise<DeleteContactListOutput> {
  const data = (await seamlessDelete(`/users/tags/${params.listId}`)) as Record<
    string,
    unknown
  >;
  return {
    success: (data.success as boolean) ?? true,
  };
}

// ============================================================================
// removeContactsFromList
// ============================================================================

export async function removeContactsFromList(
  params: RemoveContactsFromListInput,
): Promise<RemoveContactsFromListOutput> {
  // Step 1: Get all tags so we can map tag names to IDs
  const tagsData = (await seamlessGet('/users/tags')) as Record<
    string,
    unknown
  >;
  const allTags = (tagsData.data ?? []) as Array<Record<string, unknown>>;
  const tagNameToId = new Map<string, string>();
  for (const tag of allTags) {
    const id = String(tag.id ?? tag._id ?? '');
    const name = String(tag.name ?? '');
    if (id && name) tagNameToId.set(name, id);
  }

  // Step 2: Build updated tag assignments for each contact
  // Fetch contacts in batches to get their current tag names
  const contactUpdates: Array<{
    contactId: string;
    tagIds: string[];
  }> = [];

  // Fetch contacts page by page to find the target contacts' current tags
  const targetIds = new Set(params.contactIds);
  let page = 0;
  const limit = 100;
  let foundAll = false;

  while (!foundAll) {
    const contactsData = (await seamlessGet(
      `/users/contacts?page=${page}&limit=${limit}&sortColumn=researchedAt&sortOrder=desc`,
    )) as Record<string, unknown>;
    const contacts = (contactsData.contacts ?? []) as Array<
      Record<string, unknown>
    >;

    if (contacts.length === 0) break;

    for (const contact of contacts) {
      const contactId = String(contact.id ?? '');
      if (!targetIds.has(contactId)) continue;

      // Get current tag names for this contact
      const currentTagNames = (contact.tags as string[]) ?? [];
      // Map names to IDs, excluding the target list
      const remainingTagIds = currentTagNames
        .map((name) => tagNameToId.get(name))
        .filter((id): id is string => id !== undefined && id !== params.listId);

      contactUpdates.push({ contactId, tagIds: remainingTagIds });
      targetIds.delete(contactId);
    }

    if (targetIds.size === 0) {
      foundAll = true;
    }
    page++;

    // Safety limit: don't paginate forever
    if (page > 50) break;
  }

  // For any contacts we couldn't find in the list, send empty tagIds
  // (they may not have any tags, or they've been archived)
  for (const remainingId of targetIds) {
    contactUpdates.push({ contactId: remainingId, tagIds: [] });
  }

  // Step 3: POST the updated tag assignments using the replace format
  if (contactUpdates.length > 0) {
    await seamlessPost('/users/contacts/tags', {
      contacts: contactUpdates,
    });
  }

  return {
    success: true,
    removedCount: params.contactIds.length,
  };
}

// ============================================================================
// addCompaniesToList
// ============================================================================

export async function addCompaniesToList(
  params: AddCompaniesToListInput,
): Promise<AddCompaniesToListOutput> {
  const data = (await seamlessPost('/users/companies/tags', {
    tagIds: [params.listId],
    companyIds: params.companyIds,
  })) as Record<string, unknown>;

  return {
    success: (data.success as boolean) ?? true,
    addedCount: params.companyIds.length,
  };
}

// ============================================================================
// listSavedSearches
// ============================================================================

export async function listSavedSearches(
  params: ListSavedSearchesInput,
): Promise<ListSavedSearchesOutput> {
  const data = (await seamlessGet(
    `/users/savedSearch?type=${params.type}`,
  )) as Record<string, unknown>;

  const searches = (
    (data.savedSearches ?? []) as Array<Record<string, unknown>>
  ).map((s) => ({
    id: String(s.id ?? ''),
    name: String(s.name ?? ''),
    type: String(s.type ?? params.type),
    numResultsApproved: s.numResultsApproved
      ? Number(s.numResultsApproved)
      : undefined,
    sortColumn: (s.sortColumn as string | null) ?? null,
    sortOrder: (s.sortOrder as string | null) ?? null,
    createdAt: String(s.createdAt ?? ''),
    updatedAt: String(s.updatedAt ?? ''),
    values: (s.values as Record<string, unknown>) ?? {},
    savedSearchTags: ((s.savedSearchTags ?? []) as string[]) || undefined,
  }));

  return { savedSearches: searches };
}

// ============================================================================
// deleteSavedSearch
// ============================================================================

export async function deleteSavedSearch(
  params: DeleteSavedSearchInput,
): Promise<DeleteSavedSearchOutput> {
  const data = (await seamlessDelete(
    `/users/savedSearch/${params.savedSearchId}`,
  )) as Record<string, unknown>;

  return {
    success: (data.success as boolean) ?? true,
  };
}

// ============================================================================
// createSavedSearch
// ============================================================================

export async function createSavedSearch(
  params: CreateSavedSearchInput,
): Promise<CreateSavedSearchOutput> {
  await seamlessPost('/users/savedSearch', {
    name: params.name,
    type: params.type,
    values: params.values,
    sortColumn: params.sortColumn ?? null,
    sortOrder: params.sortOrder ?? null,
    lastPage: params.lastPage ?? 0,
    numResultsApproved: params.numResultsApproved ?? 0,
    tagIds: params.tagIds ?? [],
  });

  // The POST returns {success: true} with no ID. Fetch saved searches to find the new one.
  const listData = (await seamlessGet(
    `/users/savedSearch?type=${params.type}`,
  )) as Record<string, unknown>;

  const searches = (listData.savedSearches ?? []) as Array<
    Record<string, unknown>
  >;

  // Find the most recently created search matching our name
  const match = searches.find((s) => String(s.name ?? '') === params.name);

  if (!match) {
    throw new ContractDrift(
      `createSavedSearch: saved search "${params.name}" was created but could not be found in GET /api/users/savedSearch?type=${params.type}`,
    );
  }

  return {
    id: String(match.id ?? match._id ?? ''),
    name: String(match.name ?? params.name),
    type: String(match.type ?? params.type),
  };
}

// ============================================================================
// exportContacts
// ============================================================================

export async function exportContacts(
  params: ExportContactsInput,
): Promise<ExportContactsOutput> {
  const validFileVersions = ['cleaned', 'raw', 'custom'];
  if (params.fileVersion && !validFileVersions.includes(params.fileVersion)) {
    throw new Validation(
      `exportContacts: invalid fileVersion "${params.fileVersion}". Must be one of: ${validFileVersions.join(', ')}`,
    );
  }

  const validDateRanges = [
    'all',
    'today',
    'last7Days',
    'currentMonth',
    'priorMonth',
  ];
  if (params.dateRange && !validDateRanges.includes(params.dateRange)) {
    throw new Validation(
      `exportContacts: invalid dateRange "${params.dateRange}". Must be one of: ${validDateRanges.join(', ')}`,
    );
  }

  // Resolve downloadUserId: required by the API, auto-fetched if not provided
  let downloadUserId = params.downloadUserId;
  if (!downloadUserId) {
    const me = (await seamlessGet('/users/me')) as Record<string, unknown>;
    downloadUserId = String(me.id ?? '');
  }

  const qs = new URLSearchParams();
  qs.set('exportType', 'myContacts');
  qs.set('fileVersion', params.fileVersion ?? 'cleaned');
  qs.set('dateRange', params.dateRange ?? 'all');
  qs.set('downloadUserId', downloadUserId);
  qs.set('format', params.format ?? 'csv');
  if (params.fileName) {
    qs.set('fileName', params.fileName);
  }
  if (params.lists) {
    qs.set('lists', params.lists);
  }
  if (params.ownership) {
    qs.set('ownership', params.ownership);
  }
  if (params.emailAiFilterType) {
    qs.set('emailAiFilterType', params.emailAiFilterType);
  }
  if (params.phoneAiFilterType) {
    qs.set('phoneAiFilterType', params.phoneAiFilterType);
  }
  if (params.totalAiRange) {
    qs.set('totalAiRange', params.totalAiRange);
  }
  if (params.phoneTotalAiRange) {
    qs.set('phoneTotalAiRange', params.phoneTotalAiRange);
  }

  const data = (await seamlessPost(
    `/users/dataExports?${qs.toString()}`,
    {},
  )) as Record<string, unknown>;

  const inner = (data.data ?? data) as Record<string, unknown>;
  const jobId = inner.id ? String(inner.id) : undefined;

  if (!jobId) {
    throw new ContractDrift(
      `exportContacts: POST /api/users/dataExports did not return a job ID. Response: ${JSON.stringify(inner).substring(0, 300)}`,
    );
  }

  // Poll GET /users/dataExports to wait for completion.
  // Exports typically complete in 1-3 seconds.
  const maxAttempts = 10;
  const pollInterval = 2000;

  await new Promise((resolve) => setTimeout(resolve, 1500));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const listData = (await seamlessGet('/users/dataExports')) as Record<
      string,
      unknown
    >;
    const jobs = (listData.data ?? []) as Array<Record<string, unknown>>;
    const job = jobs.find((j) => String(j.id ?? '') === jobId);

    if (job) {
      const isFinished = job.isFinished as boolean;
      const erroredAt = job.erroredAt ? String(job.erroredAt) : null;
      const completedAt = job.completedAt ? String(job.completedAt) : null;
      const status =
        isFinished && completedAt
          ? 'completed'
          : erroredAt
            ? 'failed'
            : 'processing';

      if (status !== 'processing') {
        return {
          success: status === 'completed',
          jobId,
          status,
          fileName: job.fileName ? String(job.fileName) : undefined,
          startedAt: inner.startedAt ? String(inner.startedAt) : undefined,
          completedAt: completedAt ?? undefined,
          recordCount: job.recordCount ? Number(job.recordCount) : undefined,
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timed out; return processing status with what we have from the initial response
  return {
    success: true,
    jobId,
    status: 'processing',
    fileName: inner.fileName ? String(inner.fileName) : undefined,
    startedAt: inner.startedAt ? String(inner.startedAt) : undefined,
  };
}

// ============================================================================
// listEnrichJobs
// ============================================================================

export async function listEnrichJobs(
  params: ListEnrichJobsInput,
): Promise<ListEnrichJobsOutput> {
  const qs = new URLSearchParams();
  if (params.type) qs.set('type', params.type);
  if (params.page != null) qs.set('page', String(params.page));
  if (params.limit != null) qs.set('limit', String(params.limit));

  const data = (await seamlessGet(
    `/users/enrich${qs.toString() ? '?' + qs.toString() : ''}`,
  )) as Record<string, unknown>;

  // API returns {success: true, data: [...]} where data is the jobs array
  const jobsRaw = (
    Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.jobs)
        ? data.jobs
        : []
  ) as Array<Record<string, unknown>>;

  const jobs = jobsRaw.map((j) => ({
    id: String(j.id ?? j._id ?? ''),
    name: j.name ? String(j.name) : undefined,
    listName: j.listName ? String(j.listName) : undefined,
    type: j.type
      ? (String(j.type) as
          | 'contactList'
          | 'companyList'
          | 'jobChanges'
          | 'emailList'
          | 'cleanseList'
          | 'phoneList')
      : undefined,
    status: String(j.status ?? 'unknown'),
    isResearched: j.isResearched != null ? Boolean(j.isResearched) : undefined,
    hasError: j.hasError != null ? Boolean(j.hasError) : undefined,
    error: j.error ? String(j.error) : undefined,
    totalRecords: j.totalRecords != null ? Number(j.totalRecords) : undefined,
    numResearched:
      j.numResearched != null ? Number(j.numResearched) : undefined,
    numAlreadyResearched:
      j.numAlreadyResearched != null
        ? Number(j.numAlreadyResearched)
        : undefined,
    numResultsExpected:
      j.numResultsExpected != null ? Number(j.numResultsExpected) : undefined,
    totalBytes: j.totalBytes != null ? Number(j.totalBytes) : undefined,
    addToMyContacts:
      j.addToMyContacts != null ? Boolean(j.addToMyContacts) : undefined,
    addToMyCompanies:
      j.addToMyCompanies != null ? Boolean(j.addToMyCompanies) : undefined,
    // Older field names; API returns totalRecords and numResearched, not these names
    totalContacts: j.totalRecords != null ? Number(j.totalRecords) : undefined,
    completedContacts:
      j.numResearched != null ? Number(j.numResearched) : undefined,
    createdAt: j.createdAt ? String(j.createdAt) : undefined,
    updatedAt: j.updatedAt ? String(j.updatedAt) : undefined,
  }));

  return {
    jobs,
    totalCount: data.totalCount ? Number(data.totalCount) : undefined,
  };
}
