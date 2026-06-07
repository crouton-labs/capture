import { z } from 'zod';

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

export const listPendingApprovalsSchema = {
  name: 'listPendingApprovals',
  description:
    'List pending approval work items (ProcessInstanceWorkitem). Returns all approval items across the org. Each item has an Id that can be used with approveOrReject.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z
      .number()
      .min(1)
      .optional()
      .describe('Results per page (default 25, min 1)'),
    page: z
      .number()
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort by (e.g. "CreatedDate"). Prefix with "-" for descending (e.g. "-CreatedDate")',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view API name to filter by. Omit to return all approval items. Use "ItemsToApprove" for items assigned to the current user.',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe('Total number of approval items matching the filter'),
    items: z
      .array(
        z.object({
          Id: z
            .string()
            .describe('ProcessInstanceWorkitem record ID (prefix 04i)'),
          CreatedDate: z
            .string()
            .describe('ISO 8601 timestamp when the work item was created'),
          SystemModstamp: z
            .string()
            .describe('ISO 8601 timestamp of the last system modification'),
          sobjectType: z
            .string()
            .describe('SObject type name, always "ProcessInstanceWorkitem"'),
        }),
      )
      .describe(
        'Array of ProcessInstanceWorkitem records. Use the Id to approve or reject via approveOrReject.',
      ),
  }),
  notes:
    'Uses SelectableListDataProviderController which returns all approval items. The returned fields are limited to Id, CreatedDate, SystemModstamp, and sobjectType. For full details on a specific work item, use getRecord with the work item Id.',
};

export type ListPendingApprovalsInput = z.infer<
  typeof listPendingApprovalsSchema.input
>;
export type ListPendingApprovalsOutput = z.infer<
  typeof listPendingApprovalsSchema.output
>;

export const submitForApprovalSchema = {
  name: 'submitForApproval',
  description: 'Submit a record to an approval process',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    recordId: z.string().describe('ID of the record to submit for approval'),
    comments: z.string().optional().describe('Submission comments'),
    nextApproverIds: z
      .array(z.string())
      .optional()
      .describe(
        'User IDs to route the approval to (if the process requires manual routing)',
      ),
    contextActorId: z
      .string()
      .optional()
      .describe(
        'User ID to submit on behalf of (admin override). Defaults to the current user.',
      ),
    processDefinitionNameOrId: z
      .string()
      .optional()
      .describe(
        'Developer name or ID of a specific approval process to target. If omitted, Salesforce evaluates all active processes.',
      ),
    skipEntryCriteria: z
      .boolean()
      .optional()
      .describe(
        'When true, skips entry criteria evaluation for the approval process. Typically used with processDefinitionNameOrId.',
      ),
  }),
  output: z.object({
    processInstanceId: z.string().describe('ID of the created ProcessInstance'),
  }),
  notes:
    'Uses speculative Aura descriptor (ProcessApprovalController). Verify via CDP by inspecting the POST to /aura when clicking "Submit for Approval" in the Lightning UI.',
};

export type SubmitForApprovalInput = z.infer<
  typeof submitForApprovalSchema.input
>;
export type SubmitForApprovalOutput = z.infer<
  typeof submitForApprovalSchema.output
>;

export const approveOrRejectSchema = {
  name: 'approveOrReject',
  description: 'Approve or reject a pending approval work item',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    workItemId: z
      .string()
      .describe('ProcessInstanceWorkitem ID from listPendingApprovals'),
    action: z.enum(['Approve', 'Reject']).describe('"Approve" or "Reject"'),
    comments: z.string().optional().describe('Decision comments'),
    nextApproverIds: z
      .array(z.string())
      .optional()
      .describe('User IDs for next approvers in multi-step approval processes'),
    contextActorId: z
      .string()
      .optional()
      .describe(
        'User ID to act on behalf of (admin override). Defaults to the current user.',
      ),
    processDefinitionNameOrId: z
      .string()
      .optional()
      .describe(
        'Developer name or ID of a specific approval process to target. If omitted, Salesforce evaluates all active processes.',
      ),
    skipEntryCriteria: z
      .boolean()
      .optional()
      .describe(
        'When true, skips entry criteria evaluation for the approval process.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the action succeeded'),
    workItemId: z.string().describe('ID of the processed work item'),
    action: z.enum(['Approve', 'Reject']).describe('The action that was taken'),
  }),
  notes:
    'Uses speculative Aura descriptor (ProcessApprovalController). Verify via CDP by inspecting the POST to /aura when clicking Approve/Reject in the Lightning UI.',
};

export type ApproveOrRejectInput = z.infer<typeof approveOrRejectSchema.input>;
export type ApproveOrRejectOutput = z.infer<
  typeof approveOrRejectSchema.output
>;

export const approvalSchemas = [
  listPendingApprovalsSchema,
  submitForApprovalSchema,
  approveOrRejectSchema,
];
