/**
 * Salesforce Email Templates Module
 *
 * List and retrieve Salesforce email template records via Aura framework API.
 */

import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import { Validation, NotFound } from '@vallum/_runtime';
import type {
  ListEmailTemplatesInput,
  ListEmailTemplatesOutput,
  GetEmailTemplateInput,
  GetEmailTemplateOutput,
} from './schemas';

// ---------------------------------------------------------------------------
// Internal types for raw Aura responses
// ---------------------------------------------------------------------------

interface FolderRecordsResult {
  result: Array<Record<string, unknown> & { Id: string }>;
  totalCount: number;
}

interface GetRecordResult {
  record: Record<string, unknown> & { Id: string };
}

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(creds: {
  auraToken: string;
  auraContext: string;
}): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


function isAuraRecord(val: unknown): val is {
  apiName: string;
  id: string;
  fields: Record<string, { value: unknown }>;
} {
  return (
    val != null &&
    typeof val === 'object' &&
    'apiName' in val &&
    'id' in val &&
    'fields' in val
  );
}

function flattenAuraValue(val: unknown): unknown {
  if (!isAuraRecord(val)) return val;
  const flat: Record<string, unknown> = { Id: val.id };
  for (const [key, field] of Object.entries(val.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat;
}

function flattenRecordUiFields(
  result: RecordUiResult,
): Record<string, unknown> {
  const record: Record<string, unknown> = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = flattenAuraValue(field.value);
  }
  return record;
}

// ---------------------------------------------------------------------------
// List Email Templates
// ---------------------------------------------------------------------------

/**
 * List Salesforce email templates using FolderHomeController/getRecords.
 * Returns paginated email template records.
 */
export async function listEmailTemplates(
  args: ListEmailTemplatesInput,
): Promise<ListEmailTemplatesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' || args.pageSize < 1)
  ) {
    throw new Validation('pageSize must be a positive number.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' || args.page < 1)
  ) {
    throw new Validation('page must be a positive number (1-indexed).');
  }

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.getFolderRecords, {
    entityApiName: 'EmailTemplate',
    navScope: args.scope ?? 'everything',
    orderBy: args.sortBy ?? null,
    pageNum: args.page ?? 1,
    pageSize: args.pageSize ?? 25,
    listViewId: Date.now(),
    includeWritableFoldersOnly: false,
    userIsEntityCreator: false,
    targetRecordId: null,
  });

  const result = raw as Partial<FolderRecordsResult>;

  return {
    totalCount: result.totalCount ?? 0,
    emailTemplates: result.result ?? [],
  };
}

// ---------------------------------------------------------------------------
// Get Email Template
// ---------------------------------------------------------------------------

/**
 * Retrieve a single email template record by ID.
 */
export async function getEmailTemplate(
  args: GetEmailTemplateInput,
): Promise<GetEmailTemplateOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.templateId, 'templateId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.templateId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
      ...(args.childRelationships
        ? { childRelationships: args.childRelationships }
        : {}),
    });

    const result = raw as RecordUiResult & {
      onLoadErrorMessage?: string;
      childRelationships?: Record<string, unknown>;
    };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getEmailTemplate: record not found for ${args.templateId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result);
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      (record as Record<string, unknown>).childRelationships =
        result.childRelationships;
    }
    return record as GetEmailTemplateOutput;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.templateId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getEmailTemplate: record not found for ${args.templateId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}
