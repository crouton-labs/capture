/**
 * Salesforce Schema & Metadata Operations
 *
 * Object Manager operations for listing objects, fields, picklist values,
 * and validation rules via Aura framework API.
 */

import { auraAction, DESCRIPTORS, type AuraContext } from '../aura';
import { Validation } from '@vallum/_runtime';
import type {
  ListCustomObjectsInput,
  ListCustomObjectsOutput,
  GetObjectInfoInput,
  GetObjectInfoOutput,
  ListObjectFieldsInput,
  ListObjectFieldsOutput,
  GetPicklistValuesInput,
  GetPicklistValuesOutput,
  ListValidationRulesInput,
  ListValidationRulesOutput,
  GetObjectPropertiesInput,
  GetObjectPropertiesOutput,
} from '../schemas';

export async function listCustomObjects(
  args: ListCustomObjectsInput,
): Promise<ListCustomObjectsOutput> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  const pageSize = args.pageSize ?? 50;

  const result = (await auraAction(ctx, DESCRIPTORS.getObjectListRecords, {
    searchTerm: args.searchTerm ?? '',
    pageSize,
    offset: args.offset ?? 0,
    sortBy: args.sortBy ?? 'label',
  })) as {
    objects: Array<{
      entityDurableId: string;
      label: string;
      apiName: string;
      custom: boolean;
      deployed: boolean;
      entityType: string;
      queryable: boolean;
      dateFormat: string;
      actions: unknown[];
    }>;
    hasMoreResults: boolean;
  };

  // Aura returns up to pageSize+1 items for hasMoreResults detection; trim to requested size
  const trimmed = result.objects.slice(0, pageSize);

  return {
    hasMoreResults: result.hasMoreResults,
    objects: trimmed.map((obj) => ({
      entityDurableId: obj.entityDurableId,
      label: obj.label,
      apiName: obj.apiName,
      custom: obj.custom,
      deployed: obj.deployed,
      entityType: obj.entityType,
      queryable: obj.queryable,
      dateFormat: obj.dateFormat,
    })),
  };
}

export async function getObjectInfo(
  args: GetObjectInfoInput,
): Promise<GetObjectInfoOutput> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  const result = await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
    objectApiName: args.objectApiName,
  });

  return result as GetObjectInfoOutput;
}

export async function listObjectFields(
  args: ListObjectFieldsInput,
): Promise<ListObjectFieldsOutput> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  // Auto-paginate: Salesforce's queryDetails endpoint does not respect pageSize
  // reliably (compound fields consume extra internal slots), so we fetch in
  // large batches and concatenate until hasMoreObjects is false.
  const PAGE_SIZE = 200;
  const allRecords: Array<{
    entityLabel: string;
    label: string;
    apiName: string;
    developerName: string;
    dataType: string;
    indexed: boolean;
    fieldDurableId: string;
    isSalesforce: boolean;
    isEntityParticle: boolean;
  }> = [];

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
      allRecords.push({
        entityLabel: r.entityLabel,
        label: r.label,
        apiName: r.apiName,
        developerName: r.developerName,
        dataType: r.dataType,
        indexed: r.indexed,
        fieldDurableId: r.fieldDurableId,
        isSalesforce: r.isSalesforce,
        isEntityParticle: r.isEntityParticle,
      });
    }

    hasMore = result.hasMoreObjects;
    offset += result.records.length;

    // Safety: avoid infinite loops if API keeps returning hasMore with 0 records
    if (result.records.length === 0) break;
  }

  return {
    fields: allRecords,
  };
}

export async function getPicklistValues(
  args: GetPicklistValuesInput,
): Promise<GetPicklistValuesOutput> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  if (args.fieldApiName) {
    // Per-field variant: returns values for a single picklist field
    const result = (await auraAction(ctx, DESCRIPTORS.getPicklistValues, {
      objectApiName: args.objectApiName,
      recordTypeId: args.recordTypeId,
      fieldApiName: args.fieldApiName,
    })) as Record<string, unknown>;

    return {
      eTag: result.eTag as string | undefined,
      picklistFieldValues: {
        [args.fieldApiName]: result,
      },
    } as GetPicklistValuesOutput;
  }

  // All-fields variant: returns all picklist fields for the record type
  const result = (await auraAction(
    ctx,
    DESCRIPTORS.getPicklistValuesByRecordType,
    {
      objectApiName: args.objectApiName,
      recordTypeId: args.recordTypeId,
    },
  )) as GetPicklistValuesOutput;

  return result;
}

export async function getObjectProperties(
  args: GetObjectPropertiesInput,
): Promise<GetObjectPropertiesOutput> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  // Get full object metadata
  const objectInfo = (await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
    objectApiName: args.objectApiName,
  })) as {
    apiName: string;
    label: string;
    defaultRecordTypeId: string | null;
    fields: Record<
      string,
      {
        apiName: string;
        label: string;
        dataType: string;
        required: boolean;
        updateable: boolean;
        createable: boolean;
        custom: boolean;
        sortable: boolean;
        filterable: boolean;
        length: number;
        inlineHelpText: string | null;
        relationshipName: string | null;
        referenceToInfos?: Array<{ apiName: string }>;
      }
    >;
    childRelationships?: Array<{
      childObjectApiName: string;
      fieldName: string;
      relationshipName: string | null;
    }>;
  };

  // Fetch picklist values for the default record type
  const picklistMap: Record<
    string,
    Array<{ label: string; value: string }>
  > = {};
  if (objectInfo.defaultRecordTypeId) {
    try {
      const picklistResult = (await auraAction(
        ctx,
        DESCRIPTORS.getPicklistValuesByRecordType,
        {
          objectApiName: args.objectApiName,
          recordTypeId: objectInfo.defaultRecordTypeId,
        },
      )) as {
        picklistFieldValues?: Record<
          string,
          { values?: Array<{ label: string; value: string }> }
        >;
      };
      if (picklistResult.picklistFieldValues) {
        for (const [fieldName, fieldData] of Object.entries(
          picklistResult.picklistFieldValues,
        )) {
          if (fieldData.values && fieldData.values.length > 0) {
            picklistMap[fieldName] = fieldData.values.map((v) => ({
              label: v.label,
              value: v.value,
            }));
          }
        }
      }
    } catch {
      // Picklist fetch is best-effort; some objects don't support record types
    }
  }

  // Flatten fields into a scannable array
  const properties = Object.values(objectInfo.fields).map((field) => {
    const prop: GetObjectPropertiesOutput['properties'][number] = {
      name: field.apiName,
      label: field.label,
      type: field.dataType,
      required: field.required,
      updateable: field.updateable,
      createable: field.createable,
      custom: field.custom,
      sortable: field.sortable,
      filterable: field.filterable,
      relationshipName: field.relationshipName ?? null,
      referenceTo: field.referenceToInfos
        ? field.referenceToInfos.map((r) => r.apiName)
        : [],
      length: field.length || null,
      inlineHelpText: field.inlineHelpText ?? null,
    };

    const plValues = picklistMap[field.apiName];
    if (plValues) {
      prop.picklistValues = plValues;
    }

    return prop;
  });

  // Flatten child relationships (only those with a relationship name)
  const childRelationships = (objectInfo.childRelationships ?? [])
    .filter((cr) => cr.relationshipName != null)
    .map((cr) => ({
      childObject: cr.childObjectApiName,
      fieldName: cr.fieldName,
      relationshipName: cr.relationshipName!,
    }));

  return {
    objectApiName: objectInfo.apiName,
    objectLabel: objectInfo.label,
    properties,
    childRelationships,
  };
}

export async function listValidationRules(
  args: ListValidationRulesInput,
): Promise<ListValidationRulesOutput> {
  if (!args.objectApiName) {
    throw new Validation('listValidationRules: objectApiName is required');
  }
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  // Auto-paginate: fetch in large batches until hasMoreObjects is false.
  const PAGE_SIZE = 200;
  const allRecords: ListValidationRulesOutput['rules'] = [];

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const result = (await auraAction(
      ctx,
      DESCRIPTORS.queryValidationRuleDetails,
      {
        entityDurableId: args.objectApiName,
        entityDeveloperName: '',
        searchTerm: args.searchTerm ?? '',
        pageSize: PAGE_SIZE,
        offset,
        sortBy: args.sortBy ?? 'ValidationName',
        sortDirection: args.sortDirection ?? 'ascending',
      },
    )) as {
      records: Array<{
        id: string;
        name: string;
        errorLocation: string;
        errorMessage: string;
        active: boolean;
        lastModifiedById: string;
        lastModifiedByName: string;
        lastModifiedDate: string;
      }>;
      hasMoreObjects: boolean;
    };

    for (const r of result.records) {
      allRecords.push({
        id: r.id,
        name: r.name,
        errorLocation: r.errorLocation,
        errorMessage: r.errorMessage,
        active: r.active,
        lastModifiedById: r.lastModifiedById,
        lastModifiedByName: r.lastModifiedByName,
        lastModifiedDate: r.lastModifiedDate,
      });
    }

    hasMore = result.hasMoreObjects;
    offset += result.records.length;

    // Safety: avoid infinite loops if API keeps returning hasMore with 0 records
    if (result.records.length === 0) break;
  }

  return {
    rules: allRecords,
  };
}
