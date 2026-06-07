import { z } from 'zod';

const SlugParam = z.string().describe('Workspace slug from getContext()');

export const DealSchema = z.object({
  id: z.string().describe('Deal UUID'),
  name: z.string().nullable().optional().describe('Deal name'),
  value: z
    .number()
    .nullable()
    .optional()
    .describe('Deal value in currency units'),
  stage: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Current pipeline stage name. Stage names are workspace-specific; use listObjects() to discover available stages for the deals object type.',
    ),
  owner_id: z.string().nullable().optional().describe('Owner user UUID'),
  created_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO creation timestamp'),
  closed_at: z.string().nullable().optional().describe('ISO close timestamp'),
});

export const listDealsSchema = {
  name: 'listDeals',
  description:
    'List all deal records in the workspace with stage and value details',
  notes:
    'Requires getContext() first to obtain dealEntityDefId. Look up entityDefinitions by the slug for your deals object (often "deals"; verify in workspace).',
  input: z.object({
    slug: SlugParam,
    dealEntityDefId: z
      .string()
      .describe('Deal entity definition UUID from getContext()'),
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Max deals to return (default: 100)'),
  }),
  output: z.object({
    total: z.number().describe('Total deal count in workspace'),
    deals: z.array(DealSchema).describe('Deal records'),
  }),
};

export const getDealSchema = {
  name: 'getDeal',
  description: 'Get full details for a single deal record by UUID',
  notes: 'Obtain dealId from listDeals() or searchRecords().',
  input: z.object({
    slug: SlugParam,
    dealId: z.string().describe('Deal UUID'),
  }),
  output: DealSchema,
};

export const createDealSchema = {
  name: 'createDeal',
  description: 'Create a new deal record in the workspace',
  notes:
    'Stage names are workspace-specific. Use listObjects() to discover valid stage names for the deals object before setting stage.',
  input: z.object({
    slug: SlugParam,
    name: z.string().describe('Deal name'),
    value: z.number().optional().describe('Deal value in currency units'),
    stage: z
      .string()
      .optional()
      .describe(
        'Initial pipeline stage name. Must match an existing stage in the workspace pipeline. Use listObjects() to discover valid values.',
      ),
  }),
  output: DealSchema,
};

export const updateDealSchema = {
  name: 'updateDeal',
  description:
    'Update attributes on an existing deal, including stage progression',
  notes:
    'Obtain dealId from listDeals() or searchRecords(). Stage names are workspace-specific; use listObjects() to discover valid values.',
  input: z.object({
    slug: SlugParam,
    dealId: z.string().describe('Deal UUID to update'),
    name: z.string().optional().describe('New deal name'),
    value: z.number().optional().describe('New deal value'),
    stage: z
      .string()
      .optional()
      .describe(
        'New pipeline stage name. Must match an existing stage in the workspace pipeline. Use listObjects() to discover valid values.',
      ),
  }),
  output: DealSchema,
};

export const deleteDealSchema = {
  name: 'deleteDeal',
  description: 'Permanently delete a deal record by UUID',
  notes:
    'Obtain dealId from listDeals() or searchRecords(). This operation is irreversible.',
  input: z.object({
    slug: SlugParam,
    dealId: z.string().describe('Deal UUID to delete'),
  }),
  output: z.object({
    deleted: z
      .boolean()
      .describe('True when the deal was successfully deleted'),
  }),
};

export type Deal = z.infer<typeof DealSchema>;
export type ListDealsOutput = z.infer<typeof listDealsSchema.output>;
export type GetDealOutput = z.infer<typeof getDealSchema.output>;
export type CreateDealOutput = z.infer<typeof createDealSchema.output>;
export type UpdateDealOutput = z.infer<typeof updateDealSchema.output>;
export type DeleteDealOutput = z.infer<typeof deleteDealSchema.output>;
