/**
 * Salesforce Duplicate Detection & Management
 *
 * Functions for finding duplicates using Salesforce's built-in duplicate rules
 * and listing configured duplicate/matching rules via Aura framework API.
 */

import { auraAction, DESCRIPTORS, type AuraContext, validateString } from '../aura';
import { Validation } from '@vallum/_runtime';
import type {
  FindDuplicatesInput,
  FindDuplicatesOutput,
  ListDuplicateRulesInput,
  ListDuplicateRulesOutput,
} from './schemas';

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

function buildCtx(creds: AuraCredentials): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


// ---------------------------------------------------------------------------
// findDuplicates
// ---------------------------------------------------------------------------

/**
 * Find duplicate records by searching for matches using identifying field values.
 *
 * Uses the MERGE_CANDIDATES suggestion endpoint, which is Salesforce's built-in
 * duplicate-finding mechanism used by the merge UI. This is the same proven
 * approach as getMergeCandidates but accepts field values instead of a record ID.
 */
export async function findDuplicates(
  args: FindDuplicatesInput,
): Promise<FindDuplicatesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');

  const ctx = buildCtx(args);
  const fields: Record<string, unknown> = { ...args.fields };

  // Build a search term from the provided fields
  let searchTerm = '';
  if (fields.Name) {
    searchTerm = String(fields.Name);
  } else if (fields.LastName) {
    searchTerm = [fields.FirstName, fields.LastName].filter(Boolean).join(' ');
  } else if (fields.Email) {
    searchTerm = String(fields.Email);
  } else if (fields.Phone) {
    searchTerm = String(fields.Phone);
  } else if (fields.Company) {
    searchTerm = String(fields.Company);
  }

  if (!searchTerm) {
    throw new Validation(
      'findDuplicates: at least one identifying field is required (Name, LastName, Email, Phone, or Company)',
    );
  }

  // Use the suggestions endpoint with MERGE_CANDIDATES config for best matching
  const raw = (await auraAction(ctx, DESCRIPTORS.getSuggestions, {
    term: searchTerm,
    entityName: args.objectApiName,
    maxRecords: args.maxResults ?? 25,
    maxQueries: 0,
    maxTips: 0,
    maxListViews: 0,
    context: { FILTERS: {} },
    configurationName: 'MERGE_CANDIDATES',
  })) as {
    answers: Array<{
      type: string;
      data: {
        records?: Array<{
          record: { Id: string; [k: string]: unknown };
        }>;
      };
    }>;
  };

  const recordAnswer = raw.answers.find((a) => a.type === 'RECORD_SUGGESTIONS');
  const matchRecords = recordAnswer?.data?.records
    ? recordAnswer.data.records.map((item) => item.record)
    : [];

  const duplicateResults: FindDuplicatesOutput['duplicateResults'] = [];
  if (matchRecords.length > 0) {
    duplicateResults.push({
      ruleName: 'Name Match Search',
      matchRecords,
    });
  }

  return {
    duplicateResults,
    totalMatches: matchRecords.length,
    searchTerm,
  };
}

// ---------------------------------------------------------------------------
// listDuplicateRules
// ---------------------------------------------------------------------------

/**
 * List active duplicate rules configured in the org.
 *
 * Uses the ListViewDataManager to query DuplicateRule records,
 * which are accessible from the Setup UI.
 */
export async function listDuplicateRules(
  args: ListDuplicateRulesInput,
): Promise<ListDuplicateRulesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  // DuplicateRule records are accessible via the ListViewDataManager
  // which is the same controller used for FlowDefinitionView
  const params: Record<string, unknown> = {
    entityNameOrId: 'DuplicateRule',
    layoutType: 'FULL',
    pageSize: args.pageSize ?? 50,
    currentPage: 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
  };

  try {
    const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

    const result = raw as {
      totalCount: number;
      result: Array<{
        record: {
          Id: string;
          Name?: string;
          DeveloperName?: string;
          SobjectType?: string;
          IsActive?: boolean;
          [k: string]: unknown;
        };
      }>;
    };

    const rules = result.result.map((item) => ({
      id: item.record.Id,
      name: item.record.Name ?? '',
      developerName: item.record.DeveloperName ?? '',
      objectType: item.record.SobjectType ?? '',
      isActive: item.record.IsActive ?? false,
    }));

    // Filter to active only if requested (default: all)
    const filteredRules = args.activeOnly
      ? rules.filter((r) => r.isActive)
      : rules;

    return {
      rules: filteredRules,
      totalCount: result.totalCount,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // DuplicateRule might not be accessible via getItems on all orgs
    // Fall back to listing via the ListUi controller
    if (errMsg.includes('not supported') || errMsg.includes('No response')) {
      // Try the postListRecordsByName approach
      try {
        const listResult = (await auraAction(
          ctx,
          DESCRIPTORS.postListRecordsByName,
          {
            objectApiName: 'DuplicateRule',
            listViewApiName: '__Recent',
            listRecordsQuery: {
              fields: [],
              optionalFields: [],
              pageSize: args.pageSize ?? 50,
              sortBy: [],
            },
          },
        )) as {
          count: number;
          records: Array<{
            id: string;
            apiName: string;
            fields: Record<
              string,
              { displayValue: string | null; value: unknown }
            >;
          }>;
        };

        const rules = listResult.records.map((rec) => {
          const fields = rec.fields;
          return {
            id: rec.id,
            name: (fields.Name?.value as string) ?? '',
            developerName: (fields.DeveloperName?.value as string) ?? '',
            objectType: (fields.SobjectType?.value as string) ?? '',
            isActive: (fields.IsActive?.value as boolean) ?? false,
          };
        });

        const filteredRules = args.activeOnly
          ? rules.filter((r) => r.isActive)
          : rules;

        return {
          rules: filteredRules,
          totalCount: listResult.count,
        };
      } catch {
        // Both approaches failed; return empty
        return {
          rules: [],
          totalCount: 0,
        };
      }
    }

    throw err;
  }
}
