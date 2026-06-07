/**
 * Salesforce Users Module
 *
 * List and retrieve Salesforce user records via Aura framework API.
 */

import { Validation, NotFound } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import type { GetUserInput, GetUserOutput } from '../schemas';

// ---------------------------------------------------------------------------
// Shared types (internal)
// ---------------------------------------------------------------------------

interface ListResult {
  result: Array<{ record: Record<string, unknown> & { Id: string } }>;
  totalCount: number;
}

interface GetRecordResult {
  record: Record<string, unknown> & { Id: string };
  onLoadErrorMessage?: string;
}

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
  childRelationships?: Record<string, unknown>;
  onLoadErrorMessage?: string;
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


function flattenRecordUiFields(
  result: RecordUiResult,
): Record<string, unknown> & { Id: string } {
  const record: Record<string, unknown> & { Id: string } = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = field.value;
  }
  return record;
}

// ---------------------------------------------------------------------------
// List Users
// ---------------------------------------------------------------------------

/**
 * List Salesforce users using getItems.
 * Returns paginated user records with optional page size and offset.
 */
export async function listUsers(args: {
  auraToken: string;
  auraContext: string;
  pageSize?: number;
  page?: number;
  sortBy?: string;
  filterName?: string;
  layoutType?: 'FULL' | 'COMPACT' | 'SEARCH';
}): Promise<{
  totalCount: number;
  users: Array<{ Id: string; [key: string]: unknown }>;
}> {
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

  const params: Record<string, unknown> = {
    entityNameOrId: 'User',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: args.page ?? 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
  };

  if (args.sortBy != null) {
    params.sortBy = args.sortBy;
  }

  if (args.filterName != null) {
    params.filterName = args.filterName;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    users: result.result.map((item) => item.record),
  };
}

// ---------------------------------------------------------------------------
// Get User
// ---------------------------------------------------------------------------

/**
 * Retrieve a single user record by ID.
 */
export async function getUser(args: GetUserInput): Promise<GetUserOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.userId, 'userId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.userId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
      ...(args.childRelationships
        ? { childRelationships: args.childRelationships }
        : {}),
      ...(args.recordTypeId ? { recordTypeId: args.recordTypeId } : {}),
      ...(args.pageSize != null ? { pageSize: args.pageSize } : {}),
      ...(args.pageToken ? { pageToken: args.pageToken } : {}),
      ...(args.layoutTypes ? { layoutTypes: args.layoutTypes } : {}),
      ...(args.modes ? { modes: args.modes } : {}),
      ...(args.updateMru !== undefined ? { updateMru: args.updateMru } : {}),
    });

    const result = raw as RecordUiResult;

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getUser: User not found (${args.userId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
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
    return record;
  }

  const params: Record<string, unknown> = {
    recordId: args.userId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  };

  if (args.recordTypeId !== undefined) {
    params.recordTypeId = args.recordTypeId;
  }

  if (args.updateMru !== undefined) {
    params.updateMru = args.updateMru;
  }

  if (args.defaultFieldValues !== undefined) {
    params.defaultFieldValues = args.defaultFieldValues;
  }

  if (args.navigationLocation !== undefined) {
    params.navigationLocation = args.navigationLocation;
  }

  if (args.inContextOfComponent !== undefined) {
    params.inContextOfComponent = args.inContextOfComponent;
  }

  if (args.entityApiNameOrKeyPrefix !== undefined) {
    params.entityApiNameOrKeyPrefix = args.entityApiNameOrKeyPrefix;
  }

  if (args.layoutOverride !== undefined) {
    params.layoutOverride = args.layoutOverride;
  }

  if (args.changeRecordType !== undefined) {
    params.changeRecordType = args.changeRecordType;
  }

  if (args.record !== undefined) {
    params.record = args.record;
  }

  if (args.offset !== undefined) {
    params.offset = args.offset;
  }

  if (args.stencilOverride !== undefined) {
    params.stencilOverride = args.stencilOverride;
  }

  if (args.isCreateOrClone !== undefined) {
    params.isCreateOrClone = args.isCreateOrClone;
  }

  if (args.isCloneWithRelated !== undefined) {
    params.isCloneWithRelated = args.isCloneWithRelated;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, params);

  const result = raw as GetRecordResult;

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getUser: User not found (${args.userId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}
