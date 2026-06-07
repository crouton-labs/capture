/**
 * Field operations
 */

import { Validation, ContractDrift } from '@vallum/_runtime';
import { clayFetch, type TableData } from './shared';
import type {
  CreateFieldInput,
  CreateFieldOutput,
  UpdateFieldOutput,
  DeleteFieldOutput,
  StopFieldInput,
  StopFieldOutput,
  GetFieldRunStatusInput,
  GetFieldRunStatusOutput,
  GetFieldsRunStatusInput,
  GetFieldsRunStatusOutput,
  SetFieldRunConditionInput,
  SetFieldRunConditionOutput,
} from './schemas';

export async function createField(
  opts: CreateFieldInput,
): Promise<CreateFieldOutput> {
  const { tableId, name, type } = opts;

  if (!tableId) {
    throw new Validation('createField: tableId is required');
  }
  if (!name) {
    throw new Validation('createField: name is required');
  }
  if (!type) {
    throw new Validation('createField: type is required');
  }

  const data = await clayFetch<{ field: CreateFieldOutput }>(
    `/tables/${tableId}/fields`,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        type,
        typeSettings: { dataTypeSettings: { type } },
      }),
    },
  );

  return data.field;
}

/**
 * Update a field name.
 */

export async function updateField(opts: {
  tableId: string;
  fieldId: string;
  name?: string;
  type?: string;
}): Promise<UpdateFieldOutput> {
  const { tableId, fieldId, name, type } = opts;

  if (!tableId) {
    throw new Validation('updateField: tableId is required');
  }
  if (!fieldId) {
    throw new Validation('updateField: fieldId is required');
  }
  if (!name && !type) {
    throw new Validation('updateField: at least one of name or type is required');
  }

  const body: Record<string, unknown> = {};
  if (name) body.name = name;
  if (type) {
    body.type = type;
    body.typeSettings = { dataTypeSettings: { type } };
  }

  // PATCH returns field object directly (NOT wrapped in {field: ...})
  const data = await clayFetch<UpdateFieldOutput>(
    `/tables/${tableId}/fields/${fieldId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );

  return data;
}

/**
 * Delete a field from a table.
 */

export async function deleteField(opts: {
  tableId: string;
  fieldId: string;
}): Promise<DeleteFieldOutput> {
  const { tableId, fieldId } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!fieldId) {
    throw new Validation('fieldId is required');
  }

  await clayFetch(`/tables/${tableId}/fields/${fieldId}`, {
    method: 'DELETE',
  });

  return {
    success: true,
  };
}

// ============================================================================
// Run Conditions
// ============================================================================

/**
 * Set or clear a conditional run formula on an enrichment/action field.
 * For waterfall group fields, PATCHes the waterfall group config.
 * For standalone action fields, PATCHes the field's typeSettings.
 * Pass formulaText: null to remove the condition.
 */
export async function setFieldRunCondition(
  opts: SetFieldRunConditionInput,
): Promise<SetFieldRunConditionOutput> {
  const { tableId, fieldId, formulaText, formulaPrompt } = opts;

  if (!tableId) throw new Validation('setFieldRunCondition: tableId is required');
  if (!fieldId) throw new Validation('setFieldRunCondition: fieldId is required');

  // Read the table to get field info + fieldGroupMap
  const tableData = await clayFetch<{
    table: TableData & { fieldGroupMap?: Record<string, unknown> };
  }>(`/tables/${tableId}`);

  const field = tableData.table.fields?.find((f) => f.id === fieldId);
  if (!field) {
    throw new ContractDrift(
      `setFieldRunCondition: field ${fieldId} not found in table ${tableId}`,
    );
  }

  // Check if this field belongs to a waterfall group
  const groupId = (field as { groupId?: string }).groupId;
  const fieldGroupMap = tableData.table.fieldGroupMap as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (groupId && fieldGroupMap?.[groupId]) {
    // PATCH each action field in the waterfall group individually.
    // Do NOT use the waterfall/v2 group endpoint; it requires waterfallConfigs,
    // and sending waterfallConfigs causes Clay to rebuild all action fields with
    // new IDs, duplicating fields and corrupting the table.
    const groupFields = (tableData.table.fields ?? []).filter(
      (f) =>
        (f as { groupId?: string }).groupId === groupId && f.type === 'action',
    );

    await Promise.all(
      groupFields.map((gf) => {
        const existingSettings = gf.typeSettings ?? {};
        return clayFetch(`/tables/${tableId}/fields/${gf.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            typeSettings: {
              ...existingSettings,
              conditionalRunFormulaText: formulaText ?? null,
              conditionalRunFormulaPrompt: formulaPrompt ?? null,
            },
          }),
        });
      }),
    );
  } else {
    // Standalone action field; PATCH typeSettings
    // MUST include ALL existing typeSettings fields or they reset
    const existingSettings = field.typeSettings ?? {};
    await clayFetch(`/tables/${tableId}/fields/${fieldId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        typeSettings: {
          ...existingSettings,
          conditionalRunFormulaText: formulaText ?? null,
          conditionalRunFormulaPrompt: formulaPrompt ?? null,
        },
      }),
    });
  }

  return { success: true };
}

// ============================================================================
// View Management
// ============================================================================

export async function stopField(
  opts: StopFieldInput,
): Promise<StopFieldOutput> {
  const { tableId, fieldId } = opts;

  if (!tableId) {
    throw new Validation('stopField: tableId is required');
  }
  if (!fieldId) {
    throw new Validation('stopField: fieldId is required');
  }

  const data = await clayFetch<StopFieldOutput>(
    `/tables/${tableId}/cancelrun`,
    {
      method: 'POST',
      body: JSON.stringify({ fieldIds: [fieldId] }),
    },
  );

  return data;
}

export async function getFieldRunStatus(
  opts: GetFieldRunStatusInput,
): Promise<GetFieldRunStatusOutput> {
  const { tableId, fieldId } = opts;

  if (!tableId) {
    throw new Validation('getFieldRunStatus: tableId is required');
  }
  if (!fieldId) {
    throw new Validation('getFieldRunStatus: fieldId is required');
  }

  // Resolve viewId from the table
  const tableData = await clayFetch<{
    table: { firstViewId?: string; views?: Array<{ id: string }> };
  }>(`/tables/${tableId}`);
  const viewId = tableData.table.firstViewId ?? tableData.table.views?.[0]?.id;
  if (!viewId) {
    throw new ContractDrift(`getFieldRunStatus: no view found for table ${tableId}`);
  }

  const data = await clayFetch<{
    statusCounts: Array<{
      status: string | null;
      count: number;
      staleCount: number;
    }>;
  }>(`/tables/${tableId}/views/${viewId}/fields/${fieldId}/runstatus`);

  return {
    fieldId,
    statusCounts: data.statusCounts,
  };
}

export async function getFieldsRunStatus(
  opts: GetFieldsRunStatusInput,
): Promise<GetFieldsRunStatusOutput> {
  const { tableId } = opts;

  if (!tableId) {
    throw new Validation('getFieldsRunStatus: tableId is required');
  }

  // Get table to resolve viewId and discover action fields
  const tableData = await clayFetch<{
    table: {
      firstViewId?: string;
      views?: Array<{ id: string }>;
      fields?: Array<{ id: string; name: string; type: string }>;
    };
  }>(`/tables/${tableId}`);

  const viewId = tableData.table.firstViewId ?? tableData.table.views?.[0]?.id;
  if (!viewId) {
    throw new ContractDrift(`getFieldsRunStatus: no view found for table ${tableId}`);
  }

  const allFields = tableData.table.fields ?? [];
  const actionFields = allFields.filter((f) => f.type === 'action');

  // Fetch run status for each action field in parallel
  const results = await Promise.all(
    actionFields.map(async (field) => {
      const data = await clayFetch<{
        statusCounts: Array<{
          status: string | null;
          count: number;
          staleCount: number;
        }>;
      }>(`/tables/${tableId}/views/${viewId}/fields/${field.id}/runstatus`);
      return {
        fieldId: field.id,
        fieldName: field.name,
        statusCounts: data.statusCounts,
      };
    }),
  );

  return { fields: results };
}

// ============================================================================
// View Management
// ============================================================================

/**
 * Create a view on a table.
 */
