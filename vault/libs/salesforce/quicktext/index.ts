/**
 * Salesforce Quick Text Operations
 *
 * CRUD operations for Quick Text snippets via Aura framework API.
 */

import { ContractDrift, Validation, NotFound, UpstreamError } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import type {
  ListQuickTextInput,
  ListQuickTextOutput,
  GetQuickTextInput,
  GetQuickTextOutput,
  CreateQuickTextInput,
  CreateQuickTextOutput,
  UpdateQuickTextInput,
  UpdateQuickTextOutput,
  DeleteQuickTextInput,
  DeleteQuickTextOutput,
} from '../schemas';

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface ListResult {
  result: Array<{ record: Record<string, unknown> }>;
  totalCount: number;
}

interface ChildRelationshipPage {
  count: number;
  currentPageToken: string | null;
  currentPageUrl: string | null;
  nextPageToken: string | null;
  nextPageUrl: string | null;
  previousPageToken: string | null;
  previousPageUrl: string | null;
  records: Array<{
    apiName: string;
    fields: Record<string, { displayValue: string | null; value: unknown }>;
    id: string;
  }>;
}

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
  childRelationships?: Record<string, ChildRelationshipPage>;
}

function buildCtx(creds: AuraCredentials): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


function flattenRecordUiFields(
  result: RecordUiResult,
): Record<string, unknown> {
  const record: Record<string, unknown> = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = field.value;
  }

  // Surface child relationship data when present
  if (
    result.childRelationships &&
    Object.keys(result.childRelationships).length > 0
  ) {
    const childRelationships: Record<string, unknown> = {};
    for (const [relName, relPage] of Object.entries(
      result.childRelationships,
    )) {
      childRelationships[relName] = {
        count: relPage.count,
        currentPageToken: relPage.currentPageToken,
        nextPageToken: relPage.nextPageToken,
        previousPageToken: relPage.previousPageToken,
        records: relPage.records.map((childRec) => {
          const flat: Record<string, unknown> = { Id: childRec.id };
          for (const [key, field] of Object.entries(childRec.fields)) {
            flat[key] = field.value;
          }
          return flat;
        }),
      };
    }
    record.childRelationships = childRelationships;
  }

  return record;
}

export async function listQuickText(
  args: ListQuickTextInput,
): Promise<ListQuickTextOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const pageSize = args.pageSize ?? 25;
  const page = args.page ?? 0;

  if (!Number.isInteger(pageSize)) {
    throw new Validation(
      'listQuickText: pageSize must be an integer, got ' + pageSize,
    );
  }
  if (pageSize < 1 || pageSize > 2000) {
    throw new Validation(
      'listQuickText: pageSize must be between 1 and 2000, got ' + pageSize,
    );
  }
  if (!Number.isInteger(page)) {
    throw new Validation('listQuickText: page must be an integer, got ' + page);
  }
  if (page < 0) {
    throw new Validation('listQuickText: page must be >= 0, got ' + page);
  }

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, {
    entityNameOrId: 'QuickText',
    layoutType: 'FULL',
    pageSize,
    currentPage: page + 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
  });

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    quickTexts: result.result.map(
      (item) => item.record,
    ) as ListQuickTextOutput['quickTexts'],
  };
}

export async function getQuickText(
  args: GetQuickTextInput,
): Promise<GetQuickTextOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.quickTextId, 'quickTextId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.quickTextId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
      ...(args.layoutTypes ? { layoutTypes: args.layoutTypes } : {}),
      ...(args.modes ? { modes: args.modes } : {}),
      ...(args.childRelationships
        ? { childRelationships: args.childRelationships }
        : {}),
      ...(args.pageSize !== undefined ? { pageSize: args.pageSize } : {}),
      ...(args.pageToken ? { pageToken: args.pageToken } : {}),
    });

    const result = raw as RecordUiResult & { onLoadErrorMessage?: string };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getQuickText: Quick Text not found (${args.quickTextId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    return flattenRecordUiFields(result) as GetQuickTextOutput;
  }

  const params: Record<string, unknown> = {
    recordId: args.quickTextId,
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

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, params);

  const result = raw as {
    record?: Record<string, unknown>;
    onLoadErrorMessage?: string;
  };

  if (result.onLoadErrorMessage) {
    throw new UpstreamError(`getQuickText: ${result.onLoadErrorMessage.trim()}`);
  }

  if (!result.record) {
    throw new ContractDrift(
      `getQuickText: no record returned for ID ${args.quickTextId}`,
    );
  }

  const record = result.record as Record<string, unknown>;
  if (record.sobjectType !== 'QuickText') {
    throw new ContractDrift(
      `getQuickText: expected QuickText record but got ${record.sobjectType} for ID ${args.quickTextId}`,
    );
  }

  return record as GetQuickTextOutput;
}

export async function createQuickText(
  args: CreateQuickTextInput,
): Promise<CreateQuickTextOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.name, 'name');
  validateString(args.message, 'message');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ...args.fields,
    Name: args.name,
    Message: args.message,
  };

  if (args.category !== undefined) {
    fields.Category = args.category;
  }
  if (args.channel !== undefined) {
    fields.Channel = args.channel;
  }
  if (args.isInsertable !== undefined) {
    fields.IsInsertable = args.isInsertable;
  }
  if (args.folderId !== undefined) {
    fields.FolderId = args.folderId;
  }
  if (args.ownerId !== undefined) {
    fields.OwnerId = args.ownerId;
  }
  if (args.sourceType !== undefined) {
    fields.SourceType = args.sourceType;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'QuickText',
      fields,
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result) as CreateQuickTextOutput['record'],
  };
}

export async function updateQuickText(
  args: UpdateQuickTextInput,
): Promise<UpdateQuickTextOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.quickTextId, 'quickTextId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.updateRecord, {
    recordId: args.quickTextId,
    recordInput: {
      fields: { ...args.fields },
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result) as UpdateQuickTextOutput['record'],
  };
}

export async function deleteQuickText(
  args: DeleteQuickTextInput,
): Promise<DeleteQuickTextOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.quickTextId, 'quickTextId');

  const ctx = buildCtx(args);

  // Verify the record is actually a QuickText before deleting.
  // RecordUiController.deleteRecord accepts ANY record ID, so without this
  // check the function could delete Accounts, Contacts, etc.
  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.quickTextId,
    layoutType: 'FULL',
    mode: 'VIEW',
  });

  const result = raw as {
    record?: Record<string, unknown>;
    onLoadErrorMessage?: string;
  };

  if (result.onLoadErrorMessage) {
    throw new UpstreamError(`deleteQuickText: ${result.onLoadErrorMessage.trim()}`);
  }

  if (!result.record) {
    throw new ContractDrift(
      `deleteQuickText: no record found for ID ${args.quickTextId}`,
    );
  }

  if (result.record.sobjectType !== 'QuickText') {
    throw new ContractDrift(
      `deleteQuickText: expected QuickText record but got ${result.record.sobjectType} for ID ${args.quickTextId}. Refusing to delete.`,
    );
  }

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.quickTextId,
  });

  return {
    deleted: true,
    recordId: args.quickTextId,
  };
}
