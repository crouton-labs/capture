import { z } from 'zod';

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

// ============================================================================
// listOpportunityStages
// ============================================================================

export const listOpportunityStagesSchema = {
  name: 'listOpportunityStages',
  description:
    'List all opportunity stages with probability, forecast category, sort order, and closed/won status for a given record type',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Opportunity record type ID to get stages for. Defaults to master record type (012000000000000AAA). Use listSalesProcesses() to find record type IDs for different sales processes.',
      ),
  }),
  output: z.object({
    stages: z
      .array(
        z.object({
          label: z.string().describe('Display label of the stage'),
          apiName: z
            .string()
            .describe(
              'API value of the stage (use this for StageName field in create/update)',
            ),
          sortOrder: z
            .number()
            .describe('Position in the sales pipeline (1-based)'),
          defaultProbability: z
            .number()
            .nullable()
            .describe(
              'Default probability percentage (0-100) for this stage, or null if not available from picklist metadata',
            ),
          forecastCategoryName: z
            .string()
            .nullable()
            .describe(
              'Forecast category mapped to this stage (e.g. "Pipeline", "Best Case", "Commit", "Omitted", "Closed"), or null if not available from picklist metadata',
            ),
          isClosed: z
            .boolean()
            .describe('Whether this stage represents a closed opportunity'),
          isWon: z
            .boolean()
            .describe('Whether this stage represents a won opportunity'),
          isActive: z.boolean().describe('Whether this stage is active'),
        }),
      )
      .describe('Ordered list of opportunity stages'),
    forecastCategories: z
      .array(z.string())
      .describe(
        'Available forecast category values: typically "Omitted", "Pipeline", "Best Case", "Commit", "Closed"',
      ),
    defaultStage: z
      .string()
      .nullable()
      .describe('Default stage value for new opportunities, or null if none'),
  }),
  notes: '',
};

export type ListOpportunityStagesInput = z.infer<
  typeof listOpportunityStagesSchema.input
>;
export type ListOpportunityStagesOutput = z.infer<
  typeof listOpportunityStagesSchema.output
>;

// ============================================================================
// listSalesProcesses
// ============================================================================

export const listSalesProcessesSchema = {
  name: 'listSalesProcesses',
  description:
    'List all sales processes (pipelines) in the org. Each sales process maps to an Opportunity record type and defines which stages are available.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
  }),
  output: z.object({
    salesProcesses: z
      .array(
        z.object({
          id: z
            .string()
            .describe(
              'Record type ID (use as processId in getSalesProcess() or as recordTypeId in listOpportunityStages())',
            ),
          name: z.string().describe('Sales process name'),
          description: z
            .string()
            .nullable()
            .describe('Sales process description'),
          isActive: z
            .boolean()
            .describe('Whether this sales process is available'),
          isDefault: z
            .boolean()
            .describe(
              'Whether this is the default sales process for new opportunities',
            ),
        }),
      )
      .describe('List of sales processes'),
    totalCount: z.number().describe('Total number of sales processes'),
  }),
  notes:
    'Sales processes in Salesforce are mapped through Opportunity record types. Each record type defines a subset of allowed stages. Orgs with a single sales process will return the master record type.',
};

export type ListSalesProcessesInput = z.infer<
  typeof listSalesProcessesSchema.input
>;
export type ListSalesProcessesOutput = z.infer<
  typeof listSalesProcessesSchema.output
>;

// ============================================================================
// getSalesProcess
// ============================================================================

export const getSalesProcessSchema = {
  name: 'getSalesProcess',
  description:
    'Get details of a sales process including its allowed opportunity stages',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    processId: z
      .string()
      .describe(
        'Record type ID from listSalesProcesses(). Use "012000000000000AAA" for the master/default sales process.',
      ),
  }),
  output: z.object({
    processId: z.string().describe('Record type ID'),
    name: z.string().describe('Sales process name'),
    isActive: z.boolean().describe('Whether this sales process is available'),
    isMaster: z
      .boolean()
      .describe('Whether this is the master (default) record type'),
    isDefault: z
      .boolean()
      .describe(
        'Whether this is the default record type mapping for new opportunities',
      ),
    stages: z
      .array(
        z.object({
          label: z.string().describe('Display label of the stage'),
          apiName: z.string().describe('API value of the stage'),
          sortOrder: z
            .number()
            .describe('Position in the sales pipeline (1-based)'),
        }),
      )
      .describe(
        'Ordered list of stages allowed by this sales process. Only these stages can be used when creating/updating opportunities with this record type.',
      ),
  }),
  notes: '',
};

export type GetSalesProcessInput = z.infer<typeof getSalesProcessSchema.input>;
export type GetSalesProcessOutput = z.infer<
  typeof getSalesProcessSchema.output
>;

// ============================================================================
// updateOpportunityStage
// ============================================================================

export const updateOpportunityStageSchema = {
  name: 'updateOpportunityStage',
  description:
    'Move an opportunity to a different stage, optionally updating close date, amount, probability, and forecast category',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    opportunityId: z.string().describe('Salesforce Opportunity ID'),
    stageName: z
      .string()
      .describe(
        'New stage value (must be a valid stage from listOpportunityStages()). Common values: "Prospecting", "Qualification", "Needs Analysis", "Value Proposition", "Id. Decision Makers", "Perception Analysis", "Proposal/Price Quote", "Negotiation/Review", "Closed Won", "Closed Lost".',
      ),
    closeDate: z
      .string()
      .optional()
      .describe(
        'Updated close date in YYYY-MM-DD format. Required when moving to a Closed stage if not already set.',
      ),
    amount: z
      .number()
      .optional()
      .describe('Updated opportunity amount in the org currency'),
    probability: z
      .number()
      .optional()
      .describe(
        'Override probability percentage (0-100). If omitted, Salesforce uses the stage default probability.',
      ),
    forecastCategoryName: z
      .string()
      .optional()
      .describe(
        'Override forecast category. If omitted, Salesforce uses the stage default. Values: "Omitted", "Pipeline", "Best Case", "Commit", "Closed".',
      ),
  }),
  output: z.object({
    id: z.string().describe('Opportunity ID'),
    stageName: z.string().describe('New stage value after update'),
    record: z
      .object({ Id: z.string() })
      .passthrough()
      .describe(
        'Full opportunity record as returned by Salesforce after the update',
      ),
  }),
  notes:
    'Stage changes may trigger validation rules, workflow rules, or process builder flows. If the update fails with a validation error, check org-specific stage transition rules. Moving to "Closed Won" or "Closed Lost" typically requires a CloseDate.',
};

export type UpdateOpportunityStageInput = z.infer<
  typeof updateOpportunityStageSchema.input
>;
export type UpdateOpportunityStageOutput = z.infer<
  typeof updateOpportunityStageSchema.output
>;

// ============================================================================
// getOpportunityHistory
// ============================================================================

export const getOpportunityHistorySchema = {
  name: 'getOpportunityHistory',
  description:
    'Get the stage change history for an opportunity, showing each stage transition with timestamps, amounts, and probabilities',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    opportunityId: z.string().describe('Salesforce Opportunity ID'),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of history records to return (default 50). Salesforce retains opportunity history for 24 months.',
      ),
  }),
  output: z.object({
    opportunityId: z.string().describe('Opportunity ID'),
    opportunityName: z.string().describe('Opportunity name'),
    currentStage: z.string().describe('Current stage of the opportunity'),
    history: z
      .array(
        z.object({
          id: z.string().describe('History record ID'),
          stageName: z.string().describe('Stage value at this point in time'),
          amount: z.number().nullable().describe('Amount at this stage'),
          probability: z
            .number()
            .nullable()
            .describe('Probability percentage at this stage'),
          closeDate: z
            .string()
            .nullable()
            .describe('Expected close date at this stage'),
          expectedRevenue: z
            .number()
            .nullable()
            .describe('Expected revenue (amount * probability / 100)'),
          createdDate: z
            .string()
            .nullable()
            .describe('When this stage was entered (ISO datetime)'),
          createdById: z
            .string()
            .nullable()
            .describe('User ID who made the stage change'),
        }),
      )
      .describe('Stage history records, ordered by creation date'),
    totalCount: z
      .number()
      .describe('Total number of history records available'),
    nextPageToken: z
      .string()
      .nullable()
      .describe('Token for next page of history records, or null'),
  }),
  notes:
    'Uses the OpportunityHistories child relationship on the Opportunity record. Salesforce retains stage history for 24 months. The history records show the state of the opportunity at each stage transition, not the changes between transitions.',
};

export type GetOpportunityHistoryInput = z.infer<
  typeof getOpportunityHistorySchema.input
>;
export type GetOpportunityHistoryOutput = z.infer<
  typeof getOpportunityHistorySchema.output
>;

// ============================================================================
// listForecastCategories
// ============================================================================

export const listForecastCategoriesSchema = {
  name: 'listForecastCategories',
  description:
    'List forecast categories and their mappings to opportunity stages. Shows which forecast bucket each stage falls into.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Opportunity record type ID. Defaults to master record type (012000000000000AAA).',
      ),
  }),
  output: z.object({
    categories: z
      .array(
        z.object({
          label: z.string().describe('Display label of the forecast category'),
          apiName: z
            .string()
            .describe(
              'API value of the forecast category. Standard values: "Omitted", "Pipeline", "Best Case", "Commit", "Closed".',
            ),
          isDefault: z
            .boolean()
            .describe('Whether this is the default forecast category'),
        }),
      )
      .describe('Available forecast categories'),
    stageMappings: z
      .array(
        z.object({
          stageName: z.string().describe('Opportunity stage API name'),
          forecastCategoryName: z
            .string()
            .describe('Forecast category this stage maps to'),
        }),
      )
      .describe(
        'Mapping of stages to forecast categories. Only includes stages where the mapping is available from picklist metadata.',
      ),
  }),
  notes: '',
};

export type ListForecastCategoriesInput = z.infer<
  typeof listForecastCategoriesSchema.input
>;
export type ListForecastCategoriesOutput = z.infer<
  typeof listForecastCategoriesSchema.output
>;

// ============================================================================
// getOpportunityStagePath
// ============================================================================

export const getOpportunityStagepathSchema = {
  name: 'getOpportunityStagePath',
  description:
    'Get the Lightning Path (guided selling) stage progression for a specific opportunity, showing which stages are complete, current, and incomplete',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    opportunityId: z.string().describe('Salesforce Opportunity ID'),
  }),
  output: z.object({
    opportunityId: z.string().describe('Opportunity ID'),
    opportunityName: z.string().describe('Opportunity name'),
    currentStage: z.string().describe('Current stage API name'),
    isClosed: z.boolean().describe('Whether the opportunity is closed'),
    isWon: z.boolean().describe('Whether the opportunity is won'),
    amount: z.number().nullable().describe('Current opportunity amount'),
    probability: z
      .number()
      .nullable()
      .describe('Current probability percentage'),
    closeDate: z.string().nullable().describe('Expected close date'),
    pathStages: z
      .array(
        z.object({
          label: z.string().describe('Display label'),
          apiName: z.string().describe('API value'),
          sortOrder: z.number().describe('Position in the path (1-based)'),
          status: z
            .enum(['complete', 'current', 'incomplete'])
            .describe(
              'Stage status relative to current: "complete" = already passed, "current" = active stage, "incomplete" = not yet reached',
            ),
          isClosed: z
            .boolean()
            .describe('Whether this stage represents a closed state'),
          isWon: z
            .boolean()
            .describe('Whether this stage represents a won state'),
        }),
      )
      .describe(
        'Ordered list of stages with completion status, matching the Lightning Path visual component',
      ),
  }),
  notes: '',
};

export type GetOpportunityStagepathInput = z.infer<
  typeof getOpportunityStagepathSchema.input
>;
export type GetOpportunityStagepathOutput = z.infer<
  typeof getOpportunityStagepathSchema.output
>;

// ============================================================================
// Export all
// ============================================================================

export const pipelineSchemas = [
  listOpportunityStagesSchema,
  listSalesProcessesSchema,
  getSalesProcessSchema,
  updateOpportunityStageSchema,
  getOpportunityHistorySchema,
  listForecastCategoriesSchema,
  getOpportunityStagepathSchema,
];
