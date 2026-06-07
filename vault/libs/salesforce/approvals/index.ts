/**
 * Salesforce Approval Process Operations
 *
 * Operations for listing, submitting, approving, and rejecting approval
 * process items via the Aura framework API.
 *
 * NOTE: submitForApproval and approveOrReject use speculative Aura descriptors
 * (ProcessApprovalController). These need CDP testing against a live Salesforce
 * org to verify the exact endpoint. RecordUiController does NOT support
 * ProcessInstance; it returns "Object is not supported in UI API".
 */

import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import { Validation } from '@vallum/_runtime';
import type {
  ListPendingApprovalsInput,
  ListPendingApprovalsOutput,
} from './schemas';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface ListItem {
  record: {
    Id: string;
    CreatedDate: string;
    SystemModstamp: string;
    sobjectType: string;
  };
}

interface ListResult {
  result: ListItem[];
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(creds: AuraCredentials): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


// ---------------------------------------------------------------------------
// List Pending Approvals
// ---------------------------------------------------------------------------

export async function listPendingApprovals(
  args: ListPendingApprovalsInput,
): Promise<ListPendingApprovalsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);
  const pageSize = args.pageSize ?? 25;
  const page = args.page ?? 0;

  const params: Record<string, unknown> = {
    entityNameOrId: 'ProcessInstanceWorkitem',
    layoutType: 'FULL',
    pageSize,
    currentPage: page,
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
    items: result.result.map((item: ListItem) => ({
      Id: item.record.Id,
      CreatedDate: item.record.CreatedDate,
      SystemModstamp: item.record.SystemModstamp,
      sobjectType: item.record.sobjectType,
    })),
  };
}

// ---------------------------------------------------------------------------
// Submit For Approval
//
// NOTE: This uses a speculative Aura descriptor. The Salesforce Lightning
// approval UI uses a dedicated ProcessApprovalController, but the exact
// descriptor path needs verification via CDP network capture. If this returns
// an error about unknown component/action, inspect the Aura network request
// made when clicking "Submit for Approval" in the Lightning UI.
// ---------------------------------------------------------------------------

export async function submitForApproval(
  args: AuraCredentials & {
    recordId: string;
    comments?: string;
    nextApproverIds?: string[];
    contextActorId?: string;
    processDefinitionNameOrId?: string;
    skipEntryCriteria?: boolean;
  },
): Promise<{ processInstanceId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.recordId, 'recordId');

  const ctx = buildCtx(args);

  // Speculative descriptor; requires CDP verification against a live org.
  // Trigger: submit a record for approval in the Salesforce Lightning UI and
  // inspect the POST to /aura to discover the real descriptor.
  const params: Record<string, unknown> = {
    recordId: args.recordId,
    comments: args.comments,
    nextApproverIds: args.nextApproverIds,
  };
  if (args.contextActorId) params.contextActorId = args.contextActorId;
  if (args.processDefinitionNameOrId)
    params.processDefinitionNameOrId = args.processDefinitionNameOrId;
  if (args.skipEntryCriteria !== undefined)
    params.skipEntryCriteria = args.skipEntryCriteria;

  const raw = await auraAction(
    ctx,
    'serviceComponent://ui.force.components.controllers.processApproval.ProcessApprovalController/ACTION$submitRecord',
    params,
  );

  const result = raw as { processInstanceId: string };

  return {
    processInstanceId: result.processInstanceId,
  };
}

// ---------------------------------------------------------------------------
// Approve or Reject
//
// NOTE: This uses a speculative Aura descriptor. The exact descriptor and
// params shape need verification via CDP capture. If this fails, inspect
// the Aura network request made when clicking Approve/Reject in the
// Salesforce Lightning approval UI.
// ---------------------------------------------------------------------------

export async function approveOrReject(
  args: AuraCredentials & {
    workItemId: string;
    action: 'Approve' | 'Reject';
    comments?: string;
    nextApproverIds?: string[];
    contextActorId?: string;
    processDefinitionNameOrId?: string;
    skipEntryCriteria?: boolean;
  },
): Promise<{
  success: boolean;
  workItemId: string;
  action: 'Approve' | 'Reject';
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.workItemId, 'workItemId');

  if (args.action !== 'Approve' && args.action !== 'Reject') {
    throw new Validation('action must be "Approve" or "Reject".');
  }

  const ctx = buildCtx(args);

  // Speculative descriptor; requires CDP verification against a live org.
  // Trigger: approve or reject a work item in the Salesforce Lightning
  // approval UI and inspect the POST to /aura to discover the real descriptor.
  const request: Record<string, unknown> = {
    workItemId: args.workItemId,
    actionType: args.action,
    comments: args.comments,
  };
  if (args.nextApproverIds) request.nextApproverIds = args.nextApproverIds;
  if (args.contextActorId) request.contextActorId = args.contextActorId;
  if (args.processDefinitionNameOrId)
    request.processDefinitionNameOrId = args.processDefinitionNameOrId;
  if (args.skipEntryCriteria !== undefined)
    request.skipEntryCriteria = args.skipEntryCriteria;

  await auraAction(
    ctx,
    'serviceComponent://ui.force.components.controllers.processApproval.ProcessApprovalController/ACTION$processApprovals',
    {
      requests: [request],
    },
  );

  return {
    success: true,
    workItemId: args.workItemId,
    action: args.action,
  };
}
