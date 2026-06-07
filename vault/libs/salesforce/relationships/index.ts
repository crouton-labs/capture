/**
 * Salesforce Relationship & Association Management
 *
 * Functions for managing record relationships: related records retrieval,
 * linking/unlinking records via lookup fields, relationship type discovery,
 * and account hierarchy traversal via Aura framework API.
 */

import { auraAction, DESCRIPTORS, type AuraContext, validateString } from '../aura';
import { ContractDrift, NotFound } from '@vallum/_runtime';
import type {
  GetRelatedRecordsInput,
  GetRelatedRecordsOutput,
  CreateRelationshipInput,
  CreateRelationshipOutput,
  RemoveRelationshipInput,
  RemoveRelationshipOutput,
  ListRelationshipTypesInput,
  ListRelationshipTypesOutput,
  GetAccountHierarchyInput,
  GetAccountHierarchyOutput,
  GetAssociatedRecordsInput,
  GetAssociatedRecordsOutput,
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


interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
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

function flattenRecordUiFields(result: RecordUiResult): {
  Id: string;
  [k: string]: unknown;
} {
  const record: { Id: string; [k: string]: unknown } = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = flattenAuraValue(field.value);
  }
  return record;
}

// ---------------------------------------------------------------------------
// getRelatedRecords
// ---------------------------------------------------------------------------

export async function getRelatedRecords(
  args: GetRelatedRecordsInput,
): Promise<GetRelatedRecordsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.parentRecordId, 'parentRecordId');
  validateString(args.relatedListId, 'relatedListId');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    parentRecordId: args.parentRecordId,
    relatedListId: args.relatedListId,
    fields: args.fields ?? [],
    optionalFields: args.optionalFields ?? [],
    pageSize: args.pageSize ?? 50,
    sortBy: args.sortBy ? [args.sortBy] : [],
  };

  if (args.pageToken) {
    params.pageToken = args.pageToken;
  }

  const raw = (await auraAction(
    ctx,
    DESCRIPTORS.postRelatedListRecords,
    params,
  )) as {
    count: number;
    currentPageToken: string | null;
    nextPageToken: string | null;
    previousPageToken: string | null;
    records: Array<{
      id: string;
      apiName: string;
      fields: Record<string, { displayValue: string | null; value: unknown }>;
    }>;
    listReference?: {
      relatedListId: string;
      parentObjectApiName: string;
      fieldApiName: string;
    };
  };

  const records = raw.records.map((rec) => {
    const flat: { Id: string; [k: string]: unknown } = { Id: rec.id };
    for (const [key, field] of Object.entries(rec.fields)) {
      flat[key] = flattenAuraValue(field.value);
    }
    return flat;
  });

  return {
    count: raw.count,
    records,
    nextPageToken: raw.nextPageToken ?? null,
    previousPageToken: raw.previousPageToken ?? null,
    currentPageToken: raw.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// createRelationship
// ---------------------------------------------------------------------------

export async function createRelationship(
  args: CreateRelationshipInput,
): Promise<CreateRelationshipOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.recordId, 'recordId');
  validateString(args.relationshipField, 'relationshipField');
  validateString(args.relatedRecordId, 'relatedRecordId');

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.updateRecord, {
    recordId: args.recordId,
    recordInput: {
      fields: {
        [args.relationshipField]: args.relatedRecordId,
      },
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}

// ---------------------------------------------------------------------------
// removeRelationship
// ---------------------------------------------------------------------------

export async function removeRelationship(
  args: RemoveRelationshipInput,
): Promise<RemoveRelationshipOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.recordId, 'recordId');
  validateString(args.relationshipField, 'relationshipField');

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.updateRecord, {
    recordId: args.recordId,
    recordInput: {
      fields: {
        [args.relationshipField]: null,
      },
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}

// ---------------------------------------------------------------------------
// listRelationshipTypes
// ---------------------------------------------------------------------------

export async function listRelationshipTypes(
  args: ListRelationshipTypesInput,
): Promise<ListRelationshipTypesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');

  const ctx = buildCtx(args);

  // Get object info which includes field metadata with relationship details
  const objectInfo = (await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
    objectApiName: args.objectApiName,
  })) as {
    apiName: string;
    label: string;
    labelPlural: string;
    fields: Record<
      string,
      {
        apiName: string;
        label: string;
        dataType: string;
        referenceToInfos?: Array<{
          apiName: string;
          nameFields?: string[];
        }>;
        relationshipName?: string;
        required: boolean;
        updateable: boolean;
        createable: boolean;
      }
    >;
    childRelationships?: Array<{
      childObjectApiName: string;
      fieldName: string;
      relationshipName: string;
      junctionIdListNames?: string[];
      junctionReferenceTo?: string[];
    }>;
  };

  // Extract lookup/master-detail fields (parent relationships)
  const lookupFields: ListRelationshipTypesOutput['lookupFields'] = [];
  for (const [, field] of Object.entries(objectInfo.fields)) {
    if (
      field.dataType === 'Reference' &&
      field.referenceToInfos &&
      field.referenceToInfos.length > 0
    ) {
      lookupFields.push({
        fieldApiName: field.apiName,
        label: field.label,
        referenceTo: field.referenceToInfos.map((ref) => ref.apiName),
        relationshipName: field.relationshipName ?? null,
        required: field.required,
        updateable: field.updateable,
        createable: field.createable,
      });
    }
  }

  // Extract child relationships
  const childRelationships: ListRelationshipTypesOutput['childRelationships'] =
    [];
  if (objectInfo.childRelationships) {
    for (const child of objectInfo.childRelationships) {
      childRelationships.push({
        childObjectApiName: child.childObjectApiName,
        fieldName: child.fieldName,
        relationshipName: child.relationshipName,
      });
    }
  }

  return {
    objectApiName: objectInfo.apiName,
    objectLabel: objectInfo.label,
    lookupFields,
    childRelationships,
  };
}

// ---------------------------------------------------------------------------
// getAssociatedRecords
// ---------------------------------------------------------------------------

export async function getAssociatedRecords(
  args: GetAssociatedRecordsInput,
): Promise<GetAssociatedRecordsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.parentRecordId, 'parentRecordId');
  validateString(args.childObjectApiName, 'childObjectApiName');

  const ctx = buildCtx(args);

  // Step 1: Resolve parent object type by fetching the record with layouts
  const recordUi = await auraAction(ctx, DESCRIPTORS.getRecordWithLayouts, {
    recordId: args.parentRecordId,
    layoutTypes: ['Full'],
    modes: ['View'],
  });

  const rawResult = recordUi as Record<string, unknown>;
  let parentObjectApiName: string;

  if (typeof rawResult.apiName === 'string') {
    // Direct record response
    parentObjectApiName = rawResult.apiName;
  } else if (rawResult.records && typeof rawResult.records === 'object') {
    // Batch response: { records: { [id]: { apiName, ... } } }
    const records = rawResult.records as Record<string, { apiName?: string }>;
    const record = records[args.parentRecordId] ?? Object.values(records)[0];
    if (!record?.apiName) {
      throw new ContractDrift(
        `Could not determine parent object type for record ${args.parentRecordId}`,
      );
    }
    parentObjectApiName = record.apiName;
  } else {
    throw new ContractDrift(
      `Could not determine parent object type for record ${args.parentRecordId}`,
    );
  }

  // Step 2: Get object info to discover child relationships
  const objectInfo = (await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
    objectApiName: parentObjectApiName,
  })) as {
    childRelationships?: Array<{
      childObjectApiName: string;
      fieldName: string;
      relationshipName: string | null;
    }>;
  };

  // Step 3: Find matching child relationship
  const childRel = (objectInfo.childRelationships ?? []).find(
    (cr) =>
      cr.childObjectApiName === args.childObjectApiName &&
      cr.relationshipName != null,
  );

  if (!childRel || !childRel.relationshipName) {
    throw new NotFound(
      `No child relationship found for "${args.childObjectApiName}" on ${parentObjectApiName}. Use listRelationshipTypes("${parentObjectApiName}") to discover valid child relationships.`,
    );
  }

  const relatedListId = childRel.relationshipName;

  // Step 4: Fetch related records
  const params: Record<string, unknown> = {
    parentRecordId: args.parentRecordId,
    relatedListId,
    fields: args.fields ?? [],
    optionalFields: [],
    pageSize: args.pageSize ?? 50,
    sortBy: args.sortBy ? [args.sortBy] : [],
  };

  if (args.pageToken) {
    params.pageToken = args.pageToken;
  }

  const raw = (await auraAction(
    ctx,
    DESCRIPTORS.postRelatedListRecords,
    params,
  )) as {
    count: number;
    nextPageToken: string | null;
    records: Array<{
      id: string;
      apiName: string;
      fields: Record<string, { displayValue: string | null; value: unknown }>;
    }>;
  };

  const records = raw.records.map((rec) => {
    const flat: { Id: string; [k: string]: unknown } = { Id: rec.id };
    for (const [key, field] of Object.entries(rec.fields)) {
      flat[key] = flattenAuraValue(field.value);
    }
    return flat;
  });

  return {
    total: raw.count,
    records,
    nextPageToken: raw.nextPageToken ?? null,
    parentObjectApiName,
    childObjectApiName: args.childObjectApiName,
    relationshipName: relatedListId,
  };
}

// ---------------------------------------------------------------------------
// getAccountHierarchy
// ---------------------------------------------------------------------------

export async function getAccountHierarchy(
  args: GetAccountHierarchyInput,
): Promise<GetAccountHierarchyOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.accountId, 'accountId');

  const ctx = buildCtx(args);
  const maxDepth = args.maxDepth ?? 5;

  // Step 1: Get the starting account with ParentId
  const startRecord = (await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
    recordId: args.accountId,
    fields: [
      'Account.Name',
      'Account.ParentId',
      'Account.Type',
      'Account.Industry',
    ],
    optionalFields: [
      'Account.OwnerId',
      'Account.Owner.Name',
      'Account.NumberOfEmployees',
    ],
  })) as RecordUiResult;

  const startAccount = flattenRecordUiFields(startRecord);

  // Step 2: Walk up to find the root (ultimate parent)
  let parentId = startAccount.ParentId as string | null;
  const ancestors: Array<{ Id: string; [k: string]: unknown }> = [];

  let depth = 0;
  while (parentId && depth < maxDepth) {
    const parentRecord = (await auraAction(
      ctx,
      DESCRIPTORS.getRecordWithFields,
      {
        recordId: parentId,
        fields: [
          'Account.Name',
          'Account.ParentId',
          'Account.Type',
          'Account.Industry',
        ],
        optionalFields: [
          'Account.OwnerId',
          'Account.Owner.Name',
          'Account.NumberOfEmployees',
        ],
      },
    )) as RecordUiResult;

    const parent = flattenRecordUiFields(parentRecord);
    ancestors.unshift(parent);
    parentId = parent.ParentId as string | null;
    depth++;
  }

  // Step 3: Get children of the target account using related list
  const children: Array<{ Id: string; [k: string]: unknown }> = [];
  if (args.includeChildren !== false) {
    try {
      const childResult = (await auraAction(
        ctx,
        DESCRIPTORS.postRelatedListRecords,
        {
          parentRecordId: args.accountId,
          relatedListId: 'ChildAccounts',
          fields: [
            'Account.Name',
            'Account.Type',
            'Account.Industry',
            'Account.ParentId',
          ],
          optionalFields: [
            'Account.OwnerId',
            'Account.Owner.Name',
            'Account.NumberOfEmployees',
          ],
          pageSize: 200,
          sortBy: [],
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

      for (const rec of childResult.records) {
        const flat: { Id: string; [k: string]: unknown } = { Id: rec.id };
        for (const [key, field] of Object.entries(rec.fields)) {
          flat[key] = flattenAuraValue(field.value);
        }
        children.push(flat);
      }
    } catch {
      // ChildAccounts related list may not exist in all orgs; non-fatal
    }
  }

  return {
    account: startAccount,
    ancestors,
    children,
    rootAccountId: ancestors.length > 0 ? ancestors[0].Id : args.accountId,
    hierarchyDepth: ancestors.length,
  };
}
