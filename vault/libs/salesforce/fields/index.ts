/**
 * Salesforce Custom Field Inspection
 *
 * Read-only operations for custom field metadata via Aura framework.
 * Field CRUD (create/update/delete) and picklist value management require
 * the Tooling API which is blocked by LWS cross-origin restrictions.
 */

import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
;
import type {
  ListCustomFieldsInput,
  ListCustomFieldsOutput,
  GetFieldDependenciesInput,
  GetFieldDependenciesOutput,
} from './schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(creds: {
  auraToken: string;
  auraContext: string;
}): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


// ===========================================================================
// Exported Functions
// ===========================================================================

// ---------------------------------------------------------------------------
// listCustomFields
// ---------------------------------------------------------------------------

export async function listCustomFields(
  args: ListCustomFieldsInput,
): Promise<ListCustomFieldsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');

  const ctx = buildCtx(args);

  // Auto-paginate using the same pattern as listObjectFields
  const PAGE_SIZE = 200;
  const allRecords: ListCustomFieldsOutput['fields'] = [];

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const result = (await auraAction(ctx, DESCRIPTORS.queryFieldDetails, {
      entityDurableId: args.objectApiName,
      entityDeveloperName: '',
      searchTerm: args.searchTerm ?? '',
      pageSize: PAGE_SIZE,
      offset,
      sortBy: args.sortBy ?? 'Label',
      sortDirection: args.sortDirection ?? 'ascending',
    })) as {
      records: Array<{
        entityLabel: string;
        label: string;
        apiName: string;
        developerName: string;
        dataType: string;
        indexed: boolean;
        fieldDurableId: string;
        isSalesforce: boolean;
        isEntityParticle: boolean;
        actions: unknown[];
      }>;
      hasMoreObjects: boolean;
    };

    for (const r of result.records) {
      // Filter to custom fields only: apiName ends with __c
      if (!r.apiName.endsWith('__c')) continue;

      allRecords.push({
        label: r.label,
        apiName: r.apiName,
        developerName: r.developerName,
        dataType: r.dataType,
        indexed: r.indexed,
        fieldDurableId: r.fieldDurableId,
        entityLabel: r.entityLabel,
      });
    }

    hasMore = result.hasMoreObjects;
    offset += result.records.length;

    if (result.records.length === 0) break;
  }

  return { fields: allRecords };
}

// ---------------------------------------------------------------------------
// getFieldDependencies
// ---------------------------------------------------------------------------

interface ObjectInfoField {
  apiName: string;
  dataType: string;
}

interface ObjectInfoResult {
  dependentFields: Record<string, Record<string, unknown>>;
  fields: Record<string, ObjectInfoField>;
  defaultRecordTypeId: string | null;
}

interface PicklistFieldValue {
  controllerValues: Record<string, number>;
  values: Array<{
    label: string;
    value: string;
    validFor: number[];
  }>;
}

interface PicklistValuesResult {
  picklistFieldValues: Record<string, PicklistFieldValue>;
}

export async function getFieldDependencies(
  args: GetFieldDependenciesInput,
): Promise<GetFieldDependenciesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');

  const ctx = buildCtx(args);

  // Step 1: Get object info to find dependency relationships
  const objectInfo = (await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
    objectApiName: args.objectApiName,
  })) as ObjectInfoResult;

  const dependentFieldsMap = objectInfo.dependentFields || {};

  // If no dependencies, return empty array
  if (Object.keys(dependentFieldsMap).length === 0) {
    return { dependencies: [] };
  }

  // Step 2: Get picklist values for the master record type to get controlling/dependent mappings
  const recordTypeId = objectInfo.defaultRecordTypeId ?? '012000000000000AAA';

  const picklistData = (await auraAction(
    ctx,
    DESCRIPTORS.getPicklistValuesByRecordType,
    {
      objectApiName: args.objectApiName,
      recordTypeId,
    },
  )) as PicklistValuesResult;

  const dependencies: GetFieldDependenciesOutput['dependencies'] = [];

  // Build dependency list from the dependentFields map
  // dependentFields format: { "ControllingField": { "DependentField": {} } }
  for (const [controllingField, dependents] of Object.entries(
    dependentFieldsMap,
  )) {
    for (const dependentField of Object.keys(
      dependents as Record<string, unknown>,
    )) {
      const picklistInfo = picklistData.picklistFieldValues?.[dependentField];
      if (!picklistInfo) continue;

      dependencies.push({
        controllingField,
        dependentField,
        controllingValues: picklistInfo.controllerValues || {},
        dependentValues: (picklistInfo.values || []).map((v) => ({
          label: v.label,
          value: v.value,
          validFor: v.validFor || [],
        })),
      });
    }
  }

  return { dependencies };
}
