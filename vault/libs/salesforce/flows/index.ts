/**
 * Salesforce Flow Operations
 *
 * List, activate, and deactivate automation flows via Aura framework API.
 */

import { auraAction, auraRequest, DESCRIPTORS } from '../aura';
import type { AuraContext, AuraAction } from '../aura';
import { UpstreamError } from '@vallum/_runtime';
import type {
  ListFlowsInput,
  ListFlowsOutput,
  ActivateFlowInput,
  ActivateFlowOutput,
  DeactivateFlowInput,
  DeactivateFlowOutput,
} from '../schemas';

function buildCtx(creds: {
  auraToken: string;
  auraContext: string;
}): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}

let flowActionCounter = 0;

/**
 * List flows via the ListViewDataManager controller.
 * FlowDefinitionView is a Setup entity not supported by the standard ListUi API,
 * so we use the ListViewDataManagerController which returns record IDs in the
 * returnValue and field data in the response context's $Record GVP.
 */
export async function listFlows(
  args: ListFlowsInput,
): Promise<ListFlowsOutput> {
  const ctx = buildCtx(args);

  const pageSize = args.pageSize ?? 25;
  const offset =
    args.offset ??
    (args.page != null && args.page > 0 ? args.page * pageSize : 0);

  const params: Record<string, unknown> = {
    filterName: args.listViewApiName ?? 'All_Flows',
    entityName: 'FlowDefinitionView',
    pageSize,
    layoutType: 'LIST',
    sortBy: args.sortBy ?? null,
    getCount: true,
    enableRowActions: false,
    offset,
  };

  const action: AuraAction = {
    id: `${++flowActionCounter};a`,
    descriptor: DESCRIPTORS.getListViewItems,
    callingDescriptor: 'UNKNOWN',
    params,
  };

  const response = await auraRequest(ctx, [action]);
  const result = response.actions[0];

  if (!result || result.state !== 'SUCCESS') {
    const msg =
      result?.error?.[0]?.message ?? `Aura action state: ${result?.state}`;
    throw new UpstreamError(`Salesforce error: ${msg}`);
  }

  const rv = result.returnValue as {
    totalCount?: number;
    offset: number;
    hasMoreData: boolean;
    recordIdActionsList?: Array<{ recordId: string }>;
    orderedByInfo?: Array<{ label: string; isAscending: boolean }>;
    filterTitle?: string;
    fields?: string[];
  };

  // Extract records from context.$Record GVP
  const gvps = (
    response as unknown as {
      context?: {
        globalValueProviders?: Array<{
          type: string;
          values?: {
            records?: Record<
              string,
              Record<
                string,
                {
                  record?: {
                    fields?: Record<
                      string,
                      { displayValue: string | null; value: unknown }
                    >;
                    id?: string;
                  };
                }
              >
            >;
          };
        }>;
      };
    }
  ).context?.globalValueProviders;

  let recordMap: Record<
    string,
    Record<
      string,
      {
        record?: {
          fields?: Record<
            string,
            { displayValue: string | null; value: unknown }
          >;
          id?: string;
        };
      }
    >
  > = {};
  if (gvps) {
    for (const gvp of gvps) {
      if (gvp.type === '$Record' && gvp.values?.records) {
        recordMap = gvp.values.records;
        break;
      }
    }
  }

  // Build flow records in order of recordIdActionsList
  const ids = (rv.recordIdActionsList ?? []).map((r) => r.recordId);
  const flows: Array<{ Id: string; [k: string]: unknown }> = [];

  for (const id of ids) {
    const entry = recordMap[id];
    const recData = entry?.FlowDefinitionView?.record;
    if (recData?.fields) {
      const flat: Record<string, unknown> = { Id: recData.id ?? id };
      for (const [key, field] of Object.entries(recData.fields)) {
        flat[key] = field.value;
      }
      flows.push(flat as { Id: string; [k: string]: unknown });
    } else {
      // Record data not in GVP; return just the ID
      flows.push({ Id: id });
    }
  }

  return {
    totalCount: rv.totalCount ?? flows.length,
    flows,
    hasMoreData: rv.hasMoreData,
    offset: rv.offset ?? offset,
  };
}

/**
 * Activate a flow version via FlowBuilderController.toggleFlowStatus.
 * The flow must be in Draft status to be activated.
 */
export async function activateFlow(
  args: ActivateFlowInput,
): Promise<ActivateFlowOutput> {
  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.toggleFlowStatus, {
    flowId: args.flowId,
  });

  return {
    activated: true,
    flowId: args.flowId,
  };
}

/**
 * Deactivate an active flow version via FlowBuilderController.toggleFlowStatus.
 * The flow must be in Active status to be deactivated.
 */
export async function deactivateFlow(
  args: DeactivateFlowInput,
): Promise<DeactivateFlowOutput> {
  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    flowId: args.flowId,
  };
  if (args.builderType !== undefined) params.builderType = args.builderType;
  if (args.cancelOnDeactivate !== undefined)
    params.cancelOnDeactivate = args.cancelOnDeactivate;

  await auraAction(ctx, DESCRIPTORS.toggleFlowStatus, params);

  return {
    deactivated: true,
    flowId: args.flowId,
  };
}
