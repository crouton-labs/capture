/**
 * Salesforce Record Utilities (Sales Core Extensions)
 *
 * Related lists, merge candidates, and activity timeline operations
 * via Aura framework API.
 */

import { auraAction, DESCRIPTORS, type AuraContext } from '../aura';
import { PermissionDenied } from '@vallum/_runtime';
import type {
  GetRelatedListsInput,
  GetRelatedListsOutput,
  GetMergeCandidatesInput,
  GetMergeCandidatesOutput,
  GetActivitiesInput,
  GetActivitiesOutput,
} from '../schemas';

export async function getRelatedLists(
  args: GetRelatedListsInput,
): Promise<GetRelatedListsOutput> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  const raw = (await auraAction(ctx, DESCRIPTORS.getRelatedListInfoCollection, {
    parentObjectApiName: args.parentObjectApiName,
    recordTypeId: args.recordTypeId ?? '012000000000000AAA',
  })) as {
    eTag?: string;
    parentObjectApiName?: string;
    parentRecordTypeId?: string;
    relatedLists: Array<{
      label: string;
      objectApiName: string;
      relatedListId: string;
      fieldApiName: string;
      parentFieldApiName: string;
      entityLabel: string;
      entityPluralLabel: string;
      keyPrefix: string | null;
      relatedListInfoUrl: string | null;
      uiApiEnabledLayout: boolean;
      themeInfo?: { color: string; iconUrl: string };
      [k: string]: unknown;
    }>;
  };

  return {
    relatedLists: raw.relatedLists,
    eTag: raw.eTag,
    parentObjectApiName: raw.parentObjectApiName,
    parentRecordTypeId: raw.parentRecordTypeId,
  };
}

export async function getMergeCandidates(
  args: GetMergeCandidatesInput,
): Promise<GetMergeCandidatesOutput> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  // If no search term provided, fetch the record name first
  let term = args.term;
  if (!term) {
    const record = (await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.recordId,
      fields: [`${args.objectApiName}.Name`],
    })) as { fields: { Name?: { value?: string } } };
    term = record.fields?.Name?.value ?? '';
  }

  if (!term) {
    return { candidates: [] };
  }

  const searchContext: Record<string, unknown> = { FILTERS: {} };
  if (args.disableSpellCorrection != null)
    searchContext.disableSpellCorrection = args.disableSpellCorrection;
  if (args.disableIntentQuery != null)
    searchContext.disableIntentQuery = args.disableIntentQuery;
  if (args.searchSource != null) searchContext.searchSource = args.searchSource;

  const raw = (await auraAction(ctx, DESCRIPTORS.getSuggestions, {
    term,
    entityName: args.objectApiName,
    maxRecords: args.maxRecords ?? 50,
    maxQueries: args.maxQueries ?? 0,
    maxTips: args.maxTips ?? 0,
    maxListViews: args.maxListViews ?? 0,
    context: searchContext,
    configurationName: args.configurationName ?? 'MERGE_CANDIDATES',
  })) as {
    answers: Array<{
      type: string;
      data: {
        records?: Array<{
          record: { Id: string; [k: string]: unknown };
        }>;
        suggestions?: Array<{ query: string }>;
        listViews?: Array<{ id: string; name: string }>;
      };
    }>;
  };

  const recordAnswer = raw.answers.find((a) => a.type === 'RECORD_SUGGESTIONS');
  const queryAnswer = raw.answers.find((a) => a.type === 'QUERY_SUGGESTIONS');
  const listViewAnswer = raw.answers.find(
    (a) => a.type === 'LIST_VIEW_SUGGESTIONS',
  );

  // Exclude the source record from candidates
  const candidates = recordAnswer?.data?.records
    ? recordAnswer.data.records
        .map((item) => item.record)
        .filter((r) => r.Id !== args.recordId)
    : [];

  const result: GetMergeCandidatesOutput = { candidates };

  if (queryAnswer?.data?.suggestions?.length) {
    result.querySuggestions = queryAnswer.data.suggestions;
  }
  if (listViewAnswer?.data?.listViews?.length) {
    result.listViewSuggestions = listViewAnswer.data.listViews.map(
      (lv: { id: string; name: string }) => ({ id: lv.id, name: lv.name }),
    );
  }

  return result;
}

export async function getActivities(
  args: GetActivitiesInput,
): Promise<GetActivitiesOutput> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  // Use APPLY_ONLY when any filter is customized; INITIAL_LOAD ignores all
  // filter params and returns the server default. The Salesforce UI uses
  // INITIAL_LOAD on first page load (no filters), then APPLY_ONLY on every
  // subsequent "Apply" click in Timeline Settings.
  const hasCustomFilters =
    args.selectedEntityFilters != null ||
    args.selectedOwnerFilter != null ||
    args.selectedStartDateSeconds != null ||
    args.selectedEndDateSeconds != null;

  const raw = (await auraAction(ctx, DESCRIPTORS.getActivities, {
    parentId: args.recordId,
    loadType: 'INITIAL',
    pastActivitiesLimit: args.pastActivitiesLimit ?? 8,
    selectedEntityFilters: args.selectedEntityFilters ?? [
      'email',
      'event',
      'listEmail',
      'call',
      'task',
    ],
    selectedDateFilter: 'defaultDateOption',
    selectedStartDateSeconds: args.selectedStartDateSeconds ?? null,
    selectedEndDateSeconds: args.selectedEndDateSeconds ?? null,
    selectedOwnerFilter: args.selectedOwnerFilter ?? 'Everything',
    onlyInsights: args.onlyInsights ?? false,
    pageKey: args.pageKey ?? null,
    filtersLoadType: hasCustomFilters ? 'APPLY_ONLY' : 'INITIAL_LOAD',
    userFilterRecordId: null,
    showThreadedView: args.showThreadedView ?? true,
    showRelativeEmails: args.showRelativeEmails ?? false,
    externalAttendeeEmails: [],
    internalAttendeeEmails: [],
    initialOpenActivitiesLimit: -1,
    initialPastActivitiesLimit: -1,
    isMeetingPrepTimeline: false,
    reverseOAView: args.reverseOAView ?? false,
    onlySdrActivities: args.onlySdrActivities ?? false,
    emailThreadIdentifiers: [],
  })) as Record<string, unknown>;

  if (raw.noAccessError) {
    throw new PermissionDenied(
      `getActivities: No access to activity timeline for record ${args.recordId}. The current user lacks permission to view activities on this record.`,
    );
  }

  // Normalize sentinel pageKey to null. When no more pages exist, the API
  // returns "null;null;null;..." instead of actual null.
  let pageKey = raw.pageKey as string | null;
  if (typeof pageKey === 'string' && /^(null;)*null$/.test(pageKey)) {
    pageKey = null;
  }

  return {
    openActivities: raw.OpenActivities as Array<{
      Id: string;
      [k: string]: unknown;
    }>,
    activityHistories: raw.ActivityHistories as Array<{
      Id: string;
      [k: string]: unknown;
    }>,
    pageKey,
    canShowMoreOpenActivities: raw.canShowMoreOpenActivities as boolean,
    canShowMoreActivityHistories: raw.canShowMoreActivityHistories as boolean,
    selectedEntityFilters: raw.selectedEntityFilters as string[],
    selectedOwnerFilter: raw.selectedOwnerFilter as string,
  };
}

/**
 * Merge duplicate records into a master record.
 * The merge controller descriptor is based on the ui-merge-components-controller
 * discovered in the Salesforce site-map.
 */
export async function mergeRecords(args: {
  auraToken: string;
  auraContext: string;
  masterRecordId: string;
  duplicateRecordIds: string[];
  objectApiName: string;
}): Promise<{ success: boolean }> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  // Note: exact descriptor may vary by org/version. Pattern derived from
  // the ui-merge-components-controller discovered in the Salesforce site-map.
  await auraAction(
    ctx,
    'serviceComponent://ui.merge.components.controller.MergeController/ACTION$mergeRecords',
    {
      masterRecordId: args.masterRecordId,
      duplicateRecordIds: args.duplicateRecordIds,
      objectApiName: args.objectApiName,
    },
  );

  return { success: true };
}
