/**
 * Salesforce Pipeline & Stage Management
 *
 * Operations for opportunity stages, sales processes, forecast categories,
 * stage history, and Lightning Path via Aura framework API.
 */

import { NotFound, ContractDrift } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import type {
  ListOpportunityStagesInput,
  ListOpportunityStagesOutput,
  ListSalesProcessesInput,
  ListSalesProcessesOutput,
  GetSalesProcessInput,
  GetSalesProcessOutput,
  UpdateOpportunityStageInput,
  UpdateOpportunityStageOutput,
  GetOpportunityHistoryInput,
  GetOpportunityHistoryOutput,
  ListForecastCategoriesInput,
  ListForecastCategoriesOutput,
  GetOpportunityStagepathInput,
  GetOpportunityStagepathOutput,
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


// ---------------------------------------------------------------------------
// Picklist value types (returned by getPicklistValuesByRecordType)
// ---------------------------------------------------------------------------

interface PicklistAttribute {
  label: string;
  validFor: unknown[];
  value: string;
  attributes?: Record<string, unknown>;
}

interface PicklistFieldResult {
  controllerValues?: Record<string, number>;
  defaultValue: PicklistAttribute | null;
  url: string;
  values: PicklistAttribute[];
  eTag?: string;
}

interface PicklistByRecordTypeResult {
  picklistFieldValues: Record<string, PicklistFieldResult>;
  eTag?: string;
}

// ---------------------------------------------------------------------------
// RecordUi types
// ---------------------------------------------------------------------------

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
  childRelationships?: Record<
    string,
    {
      count: number;
      currentPageToken: string | null;
      nextPageToken: string | null;
      records: Array<{
        apiName: string;
        id: string;
        fields: Record<string, { displayValue: string | null; value: unknown }>;
      }>;
    }
  >;
}

interface ObjectInfoResult {
  apiName: string;
  recordTypeInfos: Record<
    string,
    {
      available: boolean;
      defaultRecordTypeMapping: boolean;
      master: boolean;
      name: string;
      recordTypeId: string;
    }
  >;
}

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

function extractStringField(
  fields: Record<string, { value: unknown }>,
  fieldName: string,
): string {
  const val = fields[fieldName]?.value;
  if (typeof val === 'string') return val;
  return '';
}

function extractNullableStringField(
  fields: Record<string, { value: unknown }>,
  fieldName: string,
): string | null {
  const val = fields[fieldName]?.value;
  if (typeof val === 'string') return val;
  return null;
}

function extractNullableNumberField(
  fields: Record<string, { value: unknown }>,
  fieldName: string,
): number | null {
  const val = fields[fieldName]?.value;
  if (typeof val === 'number') return val;
  return null;
}

function extractBooleanField(
  fields: Record<string, { value: unknown }>,
  fieldName: string,
): boolean {
  return fields[fieldName]?.value === true;
}

// ---------------------------------------------------------------------------
// listOpportunityStages
// ---------------------------------------------------------------------------

export async function listOpportunityStages(
  args: ListOpportunityStagesInput,
): Promise<ListOpportunityStagesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  // 012000000000000AAA is the universal Salesforce master record type ID
  const recordTypeId =
    typeof args.recordTypeId === 'string' && args.recordTypeId.length > 0
      ? args.recordTypeId
      : '012000000000000AAA';

  const result = (await auraAction(
    ctx,
    DESCRIPTORS.getPicklistValuesByRecordType,
    {
      objectApiName: 'Opportunity',
      recordTypeId,
    },
  )) as PicklistByRecordTypeResult;

  const stageField = result.picklistFieldValues?.StageName;
  if (!stageField) {
    throw new NotFound(
      'listOpportunityStages: StageName picklist not found in Opportunity object.',
    );
  }

  const forecastField = result.picklistFieldValues?.ForecastCategoryName;

  const stages = stageField.values.map((val, index) => {
    const attrs = val.attributes || {};

    return {
      label: val.label,
      apiName: val.value,
      sortOrder: index + 1,
      defaultProbability:
        typeof attrs.defaultProbability === 'number'
          ? attrs.defaultProbability
          : null,
      forecastCategoryName:
        typeof attrs.forecastCategoryName === 'string'
          ? attrs.forecastCategoryName
          : null,
      isClosed: attrs.closed === true || attrs.isClosed === true,
      isWon: attrs.won === true || attrs.isWon === true,
      isActive: true,
    };
  });

  const forecastCategories = forecastField
    ? forecastField.values.map((v) => v.value)
    : [];

  return {
    stages,
    forecastCategories,
    defaultStage: stageField.defaultValue
      ? stageField.defaultValue.value
      : null,
  };
}

// ---------------------------------------------------------------------------
// listSalesProcesses
// ---------------------------------------------------------------------------

export async function listSalesProcesses(
  args: ListSalesProcessesInput,
): Promise<ListSalesProcessesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  // Salesforce Sales Processes are mapped through Record Types on Opportunity.
  // Each record type corresponds to a sales process with its own allowed stages.
  // We use getObjectInfo to retrieve all record type info.
  const objectInfo = (await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
    objectApiName: 'Opportunity',
  })) as ObjectInfoResult;

  if (!objectInfo.recordTypeInfos) {
    throw new ContractDrift(
      'listSalesProcesses: No record type info found for Opportunity.',
    );
  }

  const allRecordTypes = Object.values(objectInfo.recordTypeInfos);
  const customTypes = allRecordTypes.filter((rt) => rt.available && !rt.master);

  // If custom record types exist, each maps to a distinct sales process.
  // If only the master exists, the org uses a single default sales process.
  const processes =
    customTypes.length > 0
      ? customTypes.map((rt) => ({
          id: rt.recordTypeId,
          name: rt.name,
          description: null as string | null,
          isActive: rt.available,
          isDefault: rt.defaultRecordTypeMapping,
        }))
      : allRecordTypes
          .filter((rt) => rt.master)
          .map((rt) => ({
            id: rt.recordTypeId,
            name: 'Default Sales Process',
            description: null as string | null,
            isActive: true,
            isDefault: true,
          }));

  return {
    salesProcesses: processes,
    totalCount: processes.length,
  };
}

// ---------------------------------------------------------------------------
// getSalesProcess
// ---------------------------------------------------------------------------

export async function getSalesProcess(
  args: GetSalesProcessInput,
): Promise<GetSalesProcessOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.processId, 'processId');

  const ctx = buildCtx(args);

  const objectInfo = (await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
    objectApiName: 'Opportunity',
  })) as ObjectInfoResult;

  const recordType = Object.values(objectInfo.recordTypeInfos).find(
    (rt) => rt.recordTypeId === args.processId,
  );

  if (!recordType) {
    throw new NotFound(
      `getSalesProcess: No record type found for ID ${args.processId}. Use listSalesProcesses() to find valid IDs.`,
    );
  }

  // Fetch the allowed stages for this record type/sales process
  const picklistResult = (await auraAction(
    ctx,
    DESCRIPTORS.getPicklistValuesByRecordType,
    {
      objectApiName: 'Opportunity',
      recordTypeId: args.processId,
    },
  )) as PicklistByRecordTypeResult;

  const stageField = picklistResult.picklistFieldValues?.StageName;
  if (!stageField) {
    throw new NotFound(
      `getSalesProcess: StageName picklist not found for record type ${args.processId}.`,
    );
  }

  const stages = stageField.values.map((val, index) => ({
    label: val.label,
    apiName: val.value,
    sortOrder: index + 1,
  }));

  return {
    processId: args.processId,
    name: recordType.name,
    isActive: recordType.available,
    isMaster: recordType.master,
    isDefault: recordType.defaultRecordTypeMapping,
    stages,
  };
}

// ---------------------------------------------------------------------------
// updateOpportunityStage
// ---------------------------------------------------------------------------

export async function updateOpportunityStage(
  args: UpdateOpportunityStageInput,
): Promise<UpdateOpportunityStageOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.opportunityId, 'opportunityId');
  validateString(args.stageName, 'stageName');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    StageName: args.stageName,
  };
  if (args.closeDate != null) fields.CloseDate = args.closeDate;
  if (args.amount != null) fields.Amount = args.amount;
  if (args.probability != null) fields.Probability = args.probability;
  if (args.forecastCategoryName != null)
    fields.ForecastCategoryName = args.forecastCategoryName;

  const raw = await auraAction(ctx, DESCRIPTORS.updateRecord, {
    recordId: args.opportunityId,
    recordInput: { fields },
  });

  const result = raw as RecordUiResult;

  // Flatten the response fields
  const record: { Id: string; [key: string]: unknown } = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = field.value;
  }

  return {
    id: result.id,
    stageName: extractStringField(result.fields, 'StageName'),
    record,
  };
}

// ---------------------------------------------------------------------------
// getOpportunityHistory
// ---------------------------------------------------------------------------

export async function getOpportunityHistory(
  args: GetOpportunityHistoryInput,
): Promise<GetOpportunityHistoryOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.opportunityId, 'opportunityId');

  const ctx = buildCtx(args);

  const pageSize =
    typeof args.pageSize === 'number' && args.pageSize > 0 ? args.pageSize : 50;

  const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
    recordId: args.opportunityId,
    fields: [
      'Opportunity.Id',
      'Opportunity.Name',
      'Opportunity.StageName',
      'Opportunity.CloseDate',
      'Opportunity.Amount',
    ],
    childRelationships: ['OpportunityHistories'],
    pageSize,
  });

  const result = raw as RecordUiResult;

  if (!result.id) {
    throw new NotFound(
      `getOpportunityHistory: Opportunity not found for ${args.opportunityId}`,
    );
  }

  const currentStage = extractStringField(result.fields, 'StageName');

  const historyData = result.childRelationships?.OpportunityHistories;
  const historyRecords: GetOpportunityHistoryOutput['history'] = [];

  if (historyData && historyData.records) {
    for (const rec of historyData.records) {
      historyRecords.push({
        id: rec.id,
        stageName: extractStringField(rec.fields, 'StageName'),
        amount: extractNullableNumberField(rec.fields, 'Amount'),
        probability: extractNullableNumberField(rec.fields, 'Probability'),
        closeDate: extractNullableStringField(rec.fields, 'CloseDate'),
        expectedRevenue: extractNullableNumberField(
          rec.fields,
          'ExpectedRevenue',
        ),
        createdDate: extractNullableStringField(rec.fields, 'CreatedDate'),
        createdById: extractNullableStringField(rec.fields, 'CreatedById'),
      });
    }
  }

  return {
    opportunityId: result.id,
    opportunityName: extractStringField(result.fields, 'Name'),
    currentStage,
    history: historyRecords,
    totalCount: historyData ? historyData.count : historyRecords.length,
    nextPageToken: historyData ? historyData.nextPageToken : null,
  };
}

// ---------------------------------------------------------------------------
// listForecastCategories
// ---------------------------------------------------------------------------

export async function listForecastCategories(
  args: ListForecastCategoriesInput,
): Promise<ListForecastCategoriesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const recordTypeId =
    typeof args.recordTypeId === 'string' && args.recordTypeId.length > 0
      ? args.recordTypeId
      : '012000000000000AAA';

  const result = (await auraAction(
    ctx,
    DESCRIPTORS.getPicklistValuesByRecordType,
    {
      objectApiName: 'Opportunity',
      recordTypeId,
    },
  )) as PicklistByRecordTypeResult;

  const forecastField = result.picklistFieldValues?.ForecastCategoryName;
  if (!forecastField) {
    throw new NotFound(
      'listForecastCategories: ForecastCategoryName picklist not found. The org may not have forecasting enabled.',
    );
  }

  const stageField = result.picklistFieldValues?.StageName;

  const categories = forecastField.values.map((val) => ({
    label: val.label,
    apiName: val.value,
    isDefault: forecastField.defaultValue
      ? forecastField.defaultValue.value === val.value
      : false,
  }));

  const stageMappings: ListForecastCategoriesOutput['stageMappings'] = [];

  if (stageField && stageField.values) {
    for (const stageVal of stageField.values) {
      const attrs = stageVal.attributes || {};
      if (typeof attrs.forecastCategoryName === 'string') {
        stageMappings.push({
          stageName: stageVal.value,
          forecastCategoryName: attrs.forecastCategoryName,
        });
      }
    }
  }

  return {
    categories,
    stageMappings,
  };
}

// ---------------------------------------------------------------------------
// getOpportunityStagePath
// ---------------------------------------------------------------------------

export async function getOpportunityStagePath(
  args: GetOpportunityStagepathInput,
): Promise<GetOpportunityStagepathOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.opportunityId, 'opportunityId');

  const ctx = buildCtx(args);

  // Get the opportunity to find its current stage and record type
  const oppRaw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
    recordId: args.opportunityId,
    fields: [
      'Opportunity.Id',
      'Opportunity.Name',
      'Opportunity.StageName',
      'Opportunity.IsClosed',
      'Opportunity.IsWon',
      'Opportunity.RecordTypeId',
      'Opportunity.Amount',
      'Opportunity.Probability',
      'Opportunity.CloseDate',
    ],
  });

  const oppResult = oppRaw as RecordUiResult;

  if (!oppResult.id) {
    throw new NotFound(
      `getOpportunityStagePath: Opportunity not found for ${args.opportunityId}`,
    );
  }

  const currentStage = extractStringField(oppResult.fields, 'StageName');
  const isClosed = extractBooleanField(oppResult.fields, 'IsClosed');
  const isWon = extractBooleanField(oppResult.fields, 'IsWon');
  // RecordTypeId is null when the org uses only the master record type.
  // 012000000000000AAA is Salesforce's universal master record type ID.
  const MASTER_RECORD_TYPE_ID = '012000000000000AAA';
  const rawRecordTypeId = extractNullableStringField(
    oppResult.fields,
    'RecordTypeId',
  );
  const recordTypeId =
    rawRecordTypeId !== null ? rawRecordTypeId : MASTER_RECORD_TYPE_ID;

  // Get the stages for this record type
  const picklistResult = (await auraAction(
    ctx,
    DESCRIPTORS.getPicklistValuesByRecordType,
    {
      objectApiName: 'Opportunity',
      recordTypeId,
    },
  )) as PicklistByRecordTypeResult;

  const stageField = picklistResult.picklistFieldValues?.StageName;
  if (!stageField) {
    throw new NotFound('getOpportunityStagePath: StageName picklist not found.');
  }

  // Build the path stages with completion status
  let currentStageFound = false;
  const pathStages = stageField.values.map((val, index) => {
    const isCurrentStage = val.value === currentStage;
    const attrs = val.attributes || {};
    const stageIsClosed = attrs.closed === true || attrs.isClosed === true;
    const stageIsWon = attrs.won === true || attrs.isWon === true;

    let status: 'complete' | 'current' | 'incomplete';
    if (isCurrentStage) {
      status = 'current';
      currentStageFound = true;
    } else if (!currentStageFound) {
      status = 'complete';
    } else {
      status = 'incomplete';
    }

    return {
      label: val.label,
      apiName: val.value,
      sortOrder: index + 1,
      status,
      isClosed: stageIsClosed === true,
      isWon: stageIsWon === true,
    };
  });

  return {
    opportunityId: oppResult.id,
    opportunityName: extractStringField(oppResult.fields, 'Name'),
    currentStage,
    isClosed,
    isWon,
    amount: extractNullableNumberField(oppResult.fields, 'Amount'),
    probability: extractNullableNumberField(oppResult.fields, 'Probability'),
    closeDate: extractNullableStringField(oppResult.fields, 'CloseDate'),
    pathStages,
  };
}
