import { z } from 'zod';

// Inline shared params to avoid circular imports
const AccessTokenParam = z
  .string()
  .describe('Bearer access token from getContext()');

const WorkspaceIdParam = z
  .string()
  .describe('Workspace UUID from getContext()');

// Inline OpportunitySchema to avoid circular imports
export const OpportunitySchema = z
  .object({
    id: z
      .string()
      .describe(
        'Internal hex ID (no dashes, e.g. "6834982d94e7c4f2e7739140cbc6b82c"). NOT usable with updateOpportunity; use objectId instead.',
      ),
    objectId: z
      .string()
      .describe(
        'Opportunity UUID (with dashes, e.g. "19b74185-fd0c-4ee5-874a-266030403c11"). This is the ID to pass to updateOpportunity.',
      ),
    _title: z.string().describe('Opportunity/deal name'),
    _domain: z.string().optional().describe('Associated organization domain'),
    _stageId: z.string().optional().describe('Current stage reference string'),
    _position: z.number().optional().describe('Position within stage'),
    _ownerEmail: z.string().optional().describe('Deal owner email'),
    _ownerId: z.string().optional().describe('Deal owner user UUID'),
    _autoStageMovement: z
      .boolean()
      .optional()
      .describe('Whether AI auto-moves stages'),
    _isSuggested: z
      .boolean()
      .optional()
      .describe('Whether this was AI-suggested'),
    _roles: z
      .string()
      .optional()
      .describe(
        'Contact roles JSON: [{personEmail, roles: ["PRIMARY_CONTACT"|"ECONOMIC_BUYER"|...]}]',
      ),
    '@assignee': z
      .array(z.string())
      .optional()
      .describe('Assigned user reference'),
    '@related': z
      .array(z.string())
      .optional()
      .describe('Related contacts in format "native_contact : email"'),
    '@stage': z
      .array(z.string())
      .optional()
      .describe('Current stage reference "native_stage : uuid"'),
    '@subject': z
      .array(z.string())
      .optional()
      .describe('Subject organization "native_organization : domain"'),
    _modelUpdatedAt: z
      .string()
      .optional()
      .describe('ISO timestamp when AI model last analyzed this opportunity'),
    _recommendedStage: z
      .string()
      .optional()
      .describe(
        'AI stage recommendation JSON with reasoning, entrance criteria status, proof of payment, and expected close date',
      ),
    _exists: z
      .string()
      .optional()
      .describe('Internal existence flag (typically empty string)'),
    mzTimestamp: z
      .number()
      .optional()
      .describe('Materialize DB internal timestamp (milliseconds)'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z.string().describe('ISO timestamp when last updated'),
  })
  .passthrough();

// Inline StageOpportunitySchema: opportunity items from pipeline.getOpportunityIdsByStages
const StageOpportunitySchema = z.object({
  objectId: z.string().describe('Opportunity UUID'),
  title: z.string().optional().describe('Opportunity/deal name'),
  domain: z
    .string()
    .optional()
    .describe('Associated organization domain (e.g. "acme.com")'),
  stageId: z
    .string()
    .describe(
      'Stage reference in compound format: "workspaceId : native_stage : stageUuid"',
    ),
  position: z.number().describe('Position within stage (0-based)'),
  autoStageMovement: z
    .boolean()
    .optional()
    .describe('Whether AI auto-moves this opportunity between stages'),
  expectedCloseDate: z
    .string()
    .optional()
    .describe('Expected close date as ISO timestamp'),
  expectedRevenue: z
    .number()
    .optional()
    .describe('Expected deal value in dollars'),
  assignee: z
    .array(z.string())
    .optional()
    .describe('Assigned users in format ["native_user : uuid"]'),
  customProperties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Custom property values keyed by "_custom/{uuid}" (workspace-specific UUIDs)',
    ),
  createdAt: z.string().describe('ISO timestamp when created'),
  updatedAt: z.string().describe('ISO timestamp when last updated'),
});

// Inline StageSchema to avoid circular imports
const StageSchema = z.object({
  id: z.string().describe('Internal hex hash ID (no dashes)'),
  objectId: z.string().describe('Stage UUID'),
  _title: z.string().describe('Stage display name'),
  _type: z
    .string()
    .describe(
      'Stage type code: AWARENESS, CONNECTION, NEEDS_IDENTIFICATION, EVALUATION, PROPOSAL, CONSIDERATION_NEGOTIATION, CUSTOMER_SUCCESS, CLOSED_WON, CLOSED_LOST',
    ),
  _position: z.number().describe('Sort position (1-based)'),
  _likelihoodToClose: z.number().describe('Win probability (0-1)'),
  _entranceCriteria: z
    .string()
    .optional()
    .describe('Entrance criteria (JSON string array)'),
  _pipelineId: z.string().describe('Full pipeline reference string'),
  _exists: z.string().optional().describe('Internal existence flag'),
  '@pipeline': z
    .array(z.string())
    .optional()
    .describe('Pipeline reference in format "native_pipeline : uuid"'),
  '@opportunity': z
    .array(z.string())
    .optional()
    .describe('Opportunities in this stage'),
  mzTimestamp: z
    .number()
    .optional()
    .describe('Materialize DB internal timestamp (milliseconds)'),
  createdAt: z.string().describe('ISO timestamp when created'),
  updatedAt: z.string().describe('ISO timestamp when last updated'),
  opportunities: z
    .array(StageOpportunitySchema)
    .optional()
    .describe(
      'Opportunity details for this stage. Only present when includeOpportunities is true on getPipeline.',
    ),
});

// ============================================================================
// Entity Schemas
// ============================================================================

export const PipelineSchema = z.object({
  id: z.string().describe('Pipeline UUID'),
  title: z.string().describe('Pipeline display name'),
  stages: z.array(StageSchema).describe('Stages in this pipeline'),
});

// ============================================================================
// Function Schemas
// ============================================================================

export const getOpportunitySchema = {
  name: 'getOpportunity',
  description:
    'Get a single opportunity (deal) by its UUID. Uses direct lookup via object.getObjectRows for efficient retrieval. Returns full deal record including stage, owner, related contacts and organization, custom properties, and optionally relationships and timeline.',
  notes:
    'Uses object.getObjectRows for direct lookup instead of fetching all opportunities. The propertyNames param filters which property rows are returned from the API. Use listOpportunities for bulk access.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    opportunityId: z
      .string()
      .describe('Opportunity UUID (the objectId field from listOpportunities)'),
    propertyNames: z
      .array(z.string())
      .optional()
      .describe(
        'Optional list of property names to return. Filters the API response to only include these properties. Valid names: title, domain, stageId, position, ownerEmail, ownerId, autoStageMovement, isSuggested, roles, modelUpdatedAt, recommendedStage. Custom properties use "custom/{uuid}" format. Omit to return all properties.',
      ),
    includeRelationships: z
      .boolean()
      .optional()
      .describe(
        'Include structured relationship data (assignee, related contacts, stage, subject organization). Calls object.getObjectRelationshipsWithProperties endpoint.',
      ),
    includeTimeline: z
      .boolean()
      .optional()
      .describe(
        'Include recent activity timeline entries (property changes, relationship events). Calls timeline.getTimeline endpoint.',
      ),
    timelineSince: z
      .string()
      .optional()
      .describe(
        'ISO timestamp to filter timeline entries from. Only used when includeTimeline is true. Defaults to 7 days ago. Pass "1970-01-01T00:00:00.000Z" to get all timeline entries.',
      ),
    includeLineage: z
      .boolean()
      .optional()
      .describe(
        'Include property lineage (the source thread or object that contributed each property value). Calls lineage.getLineage with propertyVersionHashes from object.getObjectRows. Keyed by propertyVersionHash (opv_v1_* strings).',
      ),
  }),
  output: z.object({
    opportunity: OpportunitySchema.describe('Full opportunity record'),
    relationships: z
      .array(
        z.object({
          relationship: z
            .string()
            .describe(
              'Relationship type (e.g., "assignee", "related", "stage", "subject")',
            ),
          targetObjectTypeId: z
            .string()
            .describe(
              'Target object type (e.g., "native_user", "native_contact", "native_stage", "native_organization")',
            ),
          targetObjectId: z
            .string()
            .describe('Target object ID (e.g., email, domain, or UUID)'),
        }),
      )
      .optional()
      .describe('Structured relationships when includeRelationships is true'),
    timeline: z
      .array(
        z.object({
          type: z
            .string()
            .describe('Entry type: "propertyChange", "relationshipCreation"'),
          objectType: z.string().describe('Object type'),
          objectId: z.string().describe('Object ID'),
          updatedAt: z.string().describe('ISO timestamp'),
          propertyName: z
            .string()
            .optional()
            .describe(
              'Display name of the change (e.g., "is owned by", "involves person", "is in stage")',
            ),
          userId: z.string().optional().describe('User who made the change'),
          valueObjectType: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Object type of the value (if referencing another object)',
            ),
          valueObjectId: z
            .string()
            .nullable()
            .optional()
            .describe('Object ID of the value (if referencing another object)'),
        }),
      )
      .optional()
      .describe('Activity timeline entries when includeTimeline is true'),
    lineage: z
      .record(
        z.string(),
        z.array(
          z.object({
            type: z
              .string()
              .describe(
                'Source object type (e.g., "native_thread", "native_contact")',
              ),
            id: z.string().describe('Source object UUID'),
            properties: z
              .array(
                z.object({
                  userId: z
                    .string()
                    .describe('User associated with this source'),
                  name: z
                    .string()
                    .describe('Property name in the source object'),
                  version: z.number().describe('Property version number'),
                  source: z.string().describe('Source type identifier'),
                  citations: z
                    .array(z.unknown())
                    .describe('Citation references'),
                }),
              )
              .describe(
                'Properties from the source that contributed this value',
              ),
          }),
        ),
      )
      .optional()
      .describe(
        'Property lineage keyed by propertyVersionHash (opv_v1_* strings). Only present when includeLineage is true. Each entry lists the source objects (threads, contacts, etc.) that contributed to the property value.',
      ),
  }),
};

export const createOpportunitySchema = {
  name: 'createOpportunity',
  description:
    'Create a new opportunity (deal) in a pipeline. Returns the created opportunity with its assigned ID. accessToken and workspaceId are auto-injected from the Day.ai session if omitted.',
  notes:
    'Use listPipelines to get valid pipelineId and stageId before creating. An invalid stageId causes a 500 error from the API with no useful message; verify stageId with listPipelines first. The type enum is not enforced server-side: any string is accepted and stored as-is. Empty title causes a 500 API error; always provide a non-empty title. The returned id is UUID format (e.g. "c4974188-9ed4-4a54-8a5c-a96accf885f0"); listOpportunities returns hex format (e.g. "65633b8b5da4402769dd66d19bd5b975") for the same record; do not compare them directly.',
  input: z.object({
    accessToken: AccessTokenParam.optional().describe(
      'Bearer access token from getContext(). Auto-injected from Day.ai session if omitted.',
    ),
    workspaceId: WorkspaceIdParam.optional().describe(
      'Workspace UUID from getContext(). Auto-injected from Day.ai URL if omitted.',
    ),
    title: z
      .string()
      .describe(
        'Opportunity/deal name. Must be non-empty; blank title causes a 500 API error.',
      ),
    pipelineId: z
      .string()
      .optional()
      .describe(
        'Pipeline UUID to add the deal to. Optional at API level; omitting creates an orphaned opportunity with no pipeline.',
      ),
    stageId: z
      .string()
      .describe(
        'Stage UUID for the initial stage. Use listPipelines to get valid UUIDs. Required by the API; omitting causes a 400 error. Invalid stageId returns 500 with no helpful error.',
      ),
    ownerEmail: z
      .string()
      .optional()
      .describe(
        'Email of the deal owner. Optional; omitting sets ownerEmail to null.',
      ),
    type: z
      .enum(['New Business', 'Renewal', 'Expansion', 'Upsell'])
      .optional()
      .default('New Business')
      .describe(
        'Opportunity type. Defaults to "New Business". Note: the API does not enforce this enum; arbitrary strings are accepted without error.',
      ),
    domain: z
      .string()
      .optional()
      .describe(
        'Organization domain (e.g. "acme.com") to associate the deal with. Must be an existing organization domain in the workspace; passing an unknown domain causes a "Something went wrong" 200-error from the API.',
      ),
    primaryPersonEmail: z
      .string()
      .optional()
      .describe('Email of the primary contact for this deal'),
    expectedCloseDate: z
      .string()
      .optional()
      .describe(
        'Expected close date as ISO timestamp. Defaults to 60 days from now.',
      ),
    expectedRevenue: z
      .number()
      .optional()
      .describe('Expected deal value in dollars'),
    isSuggested: z
      .boolean()
      .optional()
      .describe(
        'Mark this opportunity as AI-suggested. Defaults to false. Affects how the deal is displayed in the UI.',
      ),
    position: z
      .number()
      .optional()
      .describe(
        'Sort position within the stage (0-based). Lower values appear first. Defaults to 0.',
      ),
  }),
  output: z.object({
    opportunity: z.object({
      id: z
        .string()
        .describe(
          'Created opportunity in UUID format (e.g. "c4974188-9ed4-4a54-8a5c-a96accf885f0"). Note: listOpportunities returns the same record with a hex objectId (e.g. "65633b8b5da4402769dd66d19bd5b975"); these are different representations of the same record and cannot be compared directly.',
        ),
      workspaceId: z.string(),
      pipelineId: z.string().nullable(),
      stageId: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Stage reference in format "workspaceId : native_stage : stageUuid"',
        ),
      title: z.string(),
      ownerEmail: z.string().nullable(),
      ownerId: z.string().nullable().optional(),
      domain: z.string().nullable(),
      status: z.string().nullable(),
      type: z.string().nullable().optional().describe('Opportunity type'),
      isSuggested: z
        .boolean()
        .nullable()
        .optional()
        .describe('Whether marked as AI-suggested'),
      expectedRevenue: z
        .number()
        .nullable()
        .optional()
        .describe('Expected deal value'),
      expectedCloseDate: z
        .string()
        .nullable()
        .optional()
        .describe('Expected close date as ISO timestamp'),
      position: z
        .number()
        .nullable()
        .optional()
        .describe('Sort position within stage'),
    }),
  }),
};

export const updateOpportunitySchema = {
  name: 'updateOpportunity',
  description:
    'Update an existing opportunity (deal). Provide only the fields you want to change. accessToken and workspaceId are auto-injected from the Day.ai session if omitted.',
  notes:
    'The id field is the opportunity UUID WITH dashes (e.g. "19b74185-fd0c-4ee5-874a-266030403c11"). Get it from the objectId field of listOpportunities; NOT the id field (which is hex without dashes and will fail with a GraphQL error). stageId must be in compound format: "workspaceId : native_stage : stageUuid"; use listPipelines/getPipeline to get stage UUIDs, then prepend workspaceId and "native_stage". expectedCloseDate and currentStatus are routed through UpdateObjectProperty using workspace-specific custom property definition UUIDs, fetched dynamically via objectPropertyDefinitions. These map to AI-managed custom properties ("Close Date" and "Status") that the UI renders; the standard OpportunityUpdateInput mutation accepts these fields but only updates internal rows the UI does not display.',
  input: z.object({
    accessToken: AccessTokenParam.optional().describe(
      'Bearer access token from getContext(). Auto-injected from Day.ai session if omitted.',
    ),
    workspaceId: WorkspaceIdParam.optional().describe(
      'Workspace UUID from getContext(). Auto-injected from Day.ai URL if omitted.',
    ),
    id: z
      .string()
      .describe(
        'Opportunity UUID WITH dashes to update (e.g. "19b74185-fd0c-4ee5-874a-266030403c11"). Use the objectId field from listOpportunities; NOT the id field (hex without dashes) which will fail.',
      ),
    title: z.string().optional().describe('New opportunity name'),
    ownerEmail: z.string().optional().describe('New owner email'),
    ownerId: z
      .string()
      .optional()
      .describe('Owner user UUID (alternative to ownerEmail)'),
    type: z
      .enum(['New Business', 'Renewal', 'Expansion', 'Upsell'])
      .optional()
      .describe(
        'Opportunity type. Note: the API does not enforce this enum; arbitrary strings are accepted and stored as-is without error.',
      ),
    expectedCloseDate: z
      .string()
      .optional()
      .describe(
        'Expected close date as ISO timestamp (e.g. "2026-12-31T00:00:00.000Z"). Updates the workspace "Close Date" AI-managed custom property visible in the UI.',
      ),
    expectedRevenue: z
      .number()
      .optional()
      .describe('Expected deal value in dollars'),
    stageId: z
      .string()
      .optional()
      .describe(
        'Stage reference in compound format: "workspaceId : native_stage : stageUuid". Use getPipeline to get stageUuid values, then construct: `${workspaceId} : native_stage : ${stageUuid}`.',
      ),
    pipelineId: z
      .string()
      .optional()
      .describe('Pipeline UUID to move the opportunity to'),
    position: z
      .number()
      .optional()
      .describe(
        'Sort position within the stage (0-based). Lower values appear first in the board view.',
      ),
    currentStatus: z
      .string()
      .optional()
      .describe(
        'Current deal status text (free-form string, e.g. "On track", "At risk"). Updates the workspace "Status" AI-managed custom property visible in the UI.',
      ),
    domain: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Organization domain to associate with this deal (e.g. "ironbark.co"). Must be an existing organization domain in the workspace. Pass null to remove the association.',
      ),
    primaryPerson: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Email of the primary contact for this deal. Pass null to remove the primary contact.',
      ),
    hasRevenue: z
      .boolean()
      .optional()
      .describe(
        'Whether this deal has a revenue value set. Pass false to clear the revenue indicator, true to mark revenue as set. Pairs with expectedRevenue; set hasRevenue: true when setting expectedRevenue.',
      ),
  }),
  output: z.object({
    id: z.string().describe('Updated opportunity UUID'),
  }),
};

export const deleteOpportunitySchema = {
  name: 'deleteOpportunity',
  description:
    'Delete an opportunity (deal) by UUID. This action is permanent. accessToken and workspaceId are auto-injected from the Day.ai session if omitted.',
  notes:
    'Use getOpportunity or listOpportunities to get the opportunity id (objectId field). pipelineId is optional but recommended. Passing an invalid id returns a GraphQL error; verify the opportunity exists first.',
  input: z.object({
    accessToken: AccessTokenParam.optional().describe(
      'Bearer access token from getContext(). Auto-injected from Day.ai session if omitted.',
    ),
    workspaceId: WorkspaceIdParam.optional().describe(
      'Workspace UUID from getContext(). Auto-injected from Day.ai URL if omitted.',
    ),
    id: z
      .string()
      .describe('Opportunity UUID to delete (objectId from listOpportunities)'),
    pipelineId: z
      .string()
      .optional()
      .describe('Pipeline UUID the opportunity belongs to'),
  }),
  output: z.object({
    id: z.string().describe('Deleted opportunity UUID'),
    objectType: z.string().describe('Always "native_opportunity"'),
  }),
};

export const getPipelineSchema = {
  name: 'getPipeline',
  description:
    'Get a single pipeline by UUID, including all its stages with title, position, type, and likelihood-to-close. Use this to map stage IDs to stage names for a specific pipeline. Always fetches the pipeline title.',
  notes:
    'The pipeline title is fetched via object.getObjectRows on native_pipeline. Stages are fetched via tables.getObjects with native_stage objectType, then filtered by pipelineId. When includeOpportunities is true, calls pipeline.getOpportunityIdsByStages to attach opportunity details to each stage.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    pipelineId: z.string().describe('Pipeline UUID'),
    includeOpportunities: z
      .boolean()
      .optional()
      .describe(
        'Include opportunity details for each stage. Calls pipeline.getOpportunityIdsByStages and attaches rich opportunity data (title, domain, assignee, expectedRevenue, expectedCloseDate, customProperties) to each stage in the response.',
      ),
  }),
  output: z.object({
    pipeline: PipelineSchema.describe('Pipeline with its stages'),
  }),
};

export const createPipelineSchema = {
  name: 'createPipeline',
  description:
    'Create a new pipeline. Returns the created pipeline ID. Use the Day.ai UI to configure stages after creation. accessToken and workspaceId are auto-injected from the Day.ai session if omitted.',
  notes:
    'PipelineCreateInput only accepts workspaceId, title, and type; description is NOT a valid input field (causes GraphQL validation error). To set a description, call updatePipeline after creation.',
  input: z.object({
    accessToken: AccessTokenParam.optional().describe(
      'Bearer access token from getContext(). Auto-injected from Day.ai session if omitted.',
    ),
    workspaceId: WorkspaceIdParam.optional().describe(
      'Workspace UUID from getContext(). Auto-injected from Day.ai URL if omitted.',
    ),
    title: z.string().describe('Pipeline display name'),
    type: z
      .enum([
        'NEW_CUSTOMER',
        'FINANCING_INVESTMENT',
        'EXISTING_CUSTOMER',
        'VENDOR_PROCUREMENT',
        'RECRUITING',
        'VENTURE_CAPITAL',
        'PARTNER',
        'NONE',
        'PERSONAL',
        'OTHER',
      ])
      .optional()
      .default('NEW_CUSTOMER')
      .describe(
        'Pipeline type. Defaults to NEW_CUSTOMER (Sales). The API enforces this enum; invalid values return a "Something went wrong" error. NEW_CUSTOMER=Sales pipeline, FINANCING_INVESTMENT=Fundraising, EXISTING_CUSTOMER=Upsell/Cross-sell, VENDOR_PROCUREMENT=Procurement, RECRUITING=Hiring, VENTURE_CAPITAL=Investing, PARTNER=Partnerships, OTHER=Custom pipeline, NONE/PERSONAL=special types.',
      ),
  }),
  output: z.object({
    id: z.string().describe('Created pipeline UUID'),
  }),
};

// PipelineIcpInput: Ideal Customer Profile sub-object for updatePipeline
export const PipelineIcpInputSchema = z.object({
  organization: z
    .string()
    .optional()
    .describe(
      'Description of the ideal organizations to target (e.g., "B2B SaaS companies with 50-500 employees")',
    ),
});

// StageUpdateInput: stage properties that can be updated via updatePipeline
export const StageUpdateInputSchema = z.object({
  id: z
    .string()
    .describe(
      'Stage objectId UUID to update (use the `objectId` field from getPipeline stage objects, e.g. "324142ed-3353-486b-9f48-90cf91387015"). Do NOT use the hex `id` field. The function converts this to the required internal compound format automatically.',
    ),
  title: z.string().optional().describe('Stage display name'),
  description: z
    .string()
    .optional()
    .describe(
      'Stage description text. Shown in the pipeline UI below the stage title.',
    ),
  type: z
    .enum([
      'AWARENESS',
      'CONNECTION',
      'NEEDS_IDENTIFICATION',
      'EVALUATION',
      'PROPOSAL',
      'CONSIDERATION_NEGOTIATION',
      'CUSTOMER_SUCCESS',
      'CLOSED_WON',
      'CLOSED_LOST',
    ])
    .optional()
    .describe(
      'Stage type code. EVALUATION and CUSTOMER_SUCCESS are valid but not shown in the default stage chooser UI.',
    ),
  position: z
    .number()
    .optional()
    .describe('Sort position within the pipeline (1-based)'),
  likelihoodToClose: z.number().optional().describe('Win probability (0–1)'),
  color: z
    .string()
    .optional()
    .describe(
      'Stage color (hex or CSS color string). The value is stored correctly, but the `updateStage` mutation response always returns null for this field; use getPipeline to verify the stored color.',
    ),
  entranceCriteria: z
    .array(z.string())
    .optional()
    .describe('Entrance criteria checklist items'),
  pipelineId: z
    .string()
    .optional()
    .describe(
      'Pipeline compound reference to move this stage to a different pipeline. Format: "workspaceId : native_pipeline : pipelineUuid". Use getPipeline to find valid pipeline IDs.',
    ),
  workspaceId: z
    .string()
    .optional()
    .describe('Workspace UUID context for the stage update.'),
});

export const updatePipelineSchema = {
  name: 'updatePipeline',
  description:
    'Update a pipeline name, description, type, automation settings, ICP, revenue tracking, reminder days, setup steps, or stages. Returns the updated pipeline with all settable fields. Use getPipeline to get stage objectIds before updating stages.',
  notes:
    'automationActive only accepts `true`; the API silently ignores `false` (updatedAt unchanged), so passing false throws an error. hasRevenue only accepts `true`; the API silently ignores `false` (updatedAt unchanged), so passing false throws an error. To disable automation or revenue tracking, use the Day.ai web UI. title must be non-empty; passing "" throws an error. Stage color IS stored when set but the `updateStage` response always returns null for color; use getPipeline to verify. An invalid pipelineId throws an error (does NOT silently create a new pipeline). Invalid stage IDs throw an error; the API would otherwise silently create ghost stages with null pipelineId/position. The pipeline `type` field is validated client-side; the API accepts invalid values but corrupts the stored type to null, so invalid values throw an error before the API is called. Stage updates are NOT atomic; each stage is updated in a separate `updateStage` mutation call, so if one fails, earlier stages are already committed and the pipeline is left in a partially-updated state. hasRevenue change does NOT update the pipeline updatedAt timestamp (API quirk). icp.metadata and icp.people are CONTEXT_ONLY fields set by the AI context engine; the GraphQL schema accepts them as input but they are silently ignored when written manually and always return null.',
  input: z.object({
    accessToken: AccessTokenParam.optional().describe(
      'Bearer access token from getContext(). Auto-injected from Day.ai session if omitted.',
    ),
    workspaceId: WorkspaceIdParam.optional().describe(
      'Workspace UUID from getContext(). Auto-injected from Day.ai URL if omitted.',
    ),
    pipelineId: z.string().describe('Pipeline UUID to update'),
    title: z
      .string()
      .min(
        1,
        'Pipeline title cannot be empty; the API silently ignores empty strings without error',
      )
      .optional()
      .describe(
        'New pipeline name. Must be non-empty; passing "" throws an error.',
      ),
    description: z.string().optional().describe('New pipeline description'),
    type: z
      .enum([
        'NEW_CUSTOMER',
        'FINANCING_INVESTMENT',
        'EXISTING_CUSTOMER',
        'VENDOR_PROCUREMENT',
        'RECRUITING',
        'VENTURE_CAPITAL',
        'PARTNER',
        'NONE',
        'PERSONAL',
        'OTHER',
      ])
      .optional()
      .describe(
        'Pipeline type. Invalid values are rejected client-side (the API would silently corrupt the stored type to null). NEW_CUSTOMER=Sales, FINANCING_INVESTMENT=Fundraising, EXISTING_CUSTOMER=Upsell/Cross-sell, VENDOR_PROCUREMENT=Procurement, RECRUITING=Hiring, VENTURE_CAPITAL=Investing, PARTNER=Partnerships, OTHER=Custom pipeline, NONE/PERSONAL=special types.',
      ),
    automationActive: z
      .literal(true)
      .optional()
      .describe(
        'Enable AI-driven automatic stage movement. Only `true` is accepted; the API silently ignores `false` (updatedAt unchanged). To disable automation, use the Day.ai web UI. Passing false throws an error.',
      ),
    hasRevenue: z
      .literal(true)
      .optional()
      .describe(
        'Enable revenue tracking for this pipeline. Only `true` is accepted; passing `false` throws an error because the API silently ignores it. To disable revenue tracking, use the Day.ai web UI. Note: changing this field does NOT update the pipeline updatedAt timestamp (API quirk).',
      ),
    reminderDays: z
      .number()
      .int()
      .optional()
      .describe(
        'Number of days between automatic reminders for stale opportunities in this pipeline.',
      ),
    setupSteps: z
      .string()
      .optional()
      .describe(
        'Setup steps or onboarding guidance text for this pipeline. Shown to users during pipeline configuration.',
      ),
    icp: PipelineIcpInputSchema.optional().describe(
      'Ideal Customer Profile for this pipeline. Describes who the pipeline is designed to target.',
    ),
    stages: z
      .array(StageUpdateInputSchema)
      .optional()
      .describe(
        'Update one or more pipeline stages. Only stages included in this array are updated; other stages are unaffected. Each stage requires `id` (the stage objectId UUID from getPipeline). Use getPipeline to get stage objectIds and current state before updating.',
      ),
  }),
  output: z.object({
    id: z.string().describe('Updated pipeline UUID'),
    title: z.string().nullable().describe('Current pipeline name'),
    description: z.string().nullable().describe('Current pipeline description'),
    type: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Pipeline type (e.g. NEW_CUSTOMER, RECRUITING). Not validated server-side; use getPipeline to confirm a type change was applied.',
      ),
    automationActive: z
      .boolean()
      .nullable()
      .describe('Whether AI-driven stage movement is enabled'),
    hasRevenue: z
      .boolean()
      .nullable()
      .optional()
      .describe('Whether this pipeline tracks deal revenue'),
    reminderDays: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe(
        'Number of days between automatic reminders for stale opportunities',
      ),
    setupSteps: z
      .string()
      .nullable()
      .optional()
      .describe('Setup steps or onboarding guidance text for this pipeline'),
    isGeneric: z
      .boolean()
      .nullable()
      .optional()
      .describe(
        'Whether this is a generic/template pipeline (read-only, server-managed)',
      ),
    icp: z
      .object({
        organization: z
          .string()
          .nullable()
          .describe('Ideal customer organization description'),
        metadata: z
          .unknown()
          .nullable()
          .optional()
          .describe(
            'ICP metadata set by the AI context engine (countries, employee count range, industry, selling motion B2B/B2C/B2G). Always null when queried via mutation; set by Day.ai AI only.',
          ),
        people: z
          .unknown()
          .nullable()
          .optional()
          .describe(
            'ICP people targeting profiles set by the AI context engine (job titles by department/track/level). Always null when queried via mutation; set by Day.ai AI only.',
          ),
      })
      .nullable()
      .describe('Ideal Customer Profile configuration'),
    workspaceId: z.string().describe('Workspace UUID'),
    createdAt: z
      .string()
      .optional()
      .describe('ISO timestamp when the pipeline was created'),
    updatedAt: z
      .string()
      .optional()
      .describe('ISO timestamp when the pipeline was last updated'),
    ownerEmails: z
      .array(z.string())
      .optional()
      .describe('Emails of users who own this pipeline (read-only)'),
    opportunityTypes: z
      .array(z.string())
      .optional()
      .describe(
        'Opportunity types configured for this pipeline (read-only, e.g. ["New Business", "Renewal"])',
      ),
    stages: z
      .array(
        z.object({
          id: z
            .string()
            .describe(
              'Stage identifier in compound format "workspaceId : native_stage : stageUuid"',
            ),
          title: z.string().describe('Stage display name'),
          description: z
            .string()
            .nullable()
            .optional()
            .describe('Stage description text'),
          workspaceId: z.string().describe('Workspace UUID'),
          pipelineId: z
            .string()
            .describe(
              'Pipeline reference in compound format "workspaceId : native_pipeline : pipelineUuid"',
            ),
          position: z.number().describe('Sort position (1-based)'),
          entranceCriteria: z
            .array(z.string())
            .describe('Entrance criteria checklist items'),
          likelihoodToClose: z.number().describe('Win probability (0–1)'),
          color: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Always null in the response even when color was successfully set (Day.ai API limitation). Use getPipeline stages._color to read the actual stored color.',
            ),
          type: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Stage type code (e.g. AWARENESS, CONNECTION, CLOSED_WON, CLOSED_LOST)',
            ),
        }),
      )
      .optional()
      .describe(
        'Updated stage data. Only present when `stages` was provided in the input. Each entry reflects the state after the individual stage update call.',
      ),
  }),
};

// ============================================================================
// Type Exports
// ============================================================================

export type Opportunity = z.infer<typeof OpportunitySchema>;
export type Pipeline = z.infer<typeof PipelineSchema>;

export type GetOpportunityInput = z.infer<typeof getOpportunitySchema.input>;
export type GetOpportunityOutput = z.infer<typeof getOpportunitySchema.output>;
export type CreateOpportunityInput = z.infer<
  typeof createOpportunitySchema.input
>;
export type CreateOpportunityOutput = z.infer<
  typeof createOpportunitySchema.output
>;
export type UpdateOpportunityInput = z.infer<
  typeof updateOpportunitySchema.input
>;
export type UpdateOpportunityOutput = z.infer<
  typeof updateOpportunitySchema.output
>;
export type DeleteOpportunityInput = z.infer<
  typeof deleteOpportunitySchema.input
>;
export type DeleteOpportunityOutput = z.infer<
  typeof deleteOpportunitySchema.output
>;
export type GetPipelineInput = z.infer<typeof getPipelineSchema.input>;
export type GetPipelineOutput = z.infer<typeof getPipelineSchema.output>;
export type CreatePipelineInput = z.infer<typeof createPipelineSchema.input>;
export type CreatePipelineOutput = z.infer<typeof createPipelineSchema.output>;
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema.input>;
export type UpdatePipelineOutput = z.infer<typeof updatePipelineSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allDealsSchemas = [
  getOpportunitySchema,
  createOpportunitySchema,
  updateOpportunitySchema,
  deleteOpportunitySchema,
  getPipelineSchema,
  createPipelineSchema,
  updatePipelineSchema,
];
