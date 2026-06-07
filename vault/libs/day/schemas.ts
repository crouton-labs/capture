import { z } from 'zod';
import { OpportunitySchema } from './schemas-deals';

export const libraryDescription =
  'Day.ai AI-native CRM: contacts, organizations, opportunities, pipelines';
export const libraryIcon = '/icons/libs/day.ico';
export const loginUrl = 'https://day.ai/login';

export const libraryNotes = `
## Workflow
1. Navigate to https://day.ai/view (must be logged in)
2. Call getContext() to extract auth token and workspace ID
3. Pass accessToken and workspaceId to all subsequent functions

## Key Concepts
- **Object types**: native_contact, native_organization, native_opportunity, native_stage, native_pipeline
- **Contact IDs**: Email addresses (e.g., "jane@example.com")
- **Organization IDs**: Domain names (e.g., "example.com")
- **Opportunity/Pipeline/Stage IDs**: UUIDs
- **Relationships**: Fields prefixed with @ link to other objects (e.g., @organization, @stage, @related)
- **Custom properties**: Fields prefixed with _custom/ followed by a UUID are user-defined custom properties

## Pagination
Offset-based using ISO timestamp strings (createdAt >= offset). Pass offset='1970-01-01T00:00:00.000Z' for the first page. The last item's createdAt can be used as the next offset. Results are ordered by createdAt ascending. Max limit is 10000; omitting limit returns all records.
`;

// ============================================================================
// Shared Parameters
// ============================================================================

export const AccessTokenParam = z
  .string()
  .describe('Bearer access token from getContext()');

export const WorkspaceIdParam = z
  .string()
  .describe('Workspace UUID from getContext()');

// ============================================================================
// Entity Schemas
// ============================================================================

export const ContactSchema = z
  .object({
    id: z.string().describe('Internal hash ID'),
    objectId: z.string().describe('Contact ID: email address'),
    _firstName: z.string().optional().describe('First name'),
    _lastName: z.string().optional().describe('Last name'),
    _email: z
      .string()
      .optional()
      .describe('Email address (may differ from objectId)'),
    _currentJobTitle: z.string().optional().describe('Current job title'),
    _currentCompanyName: z.string().optional().describe('Current company name'),
    _currentJobStartDate: z
      .string()
      .optional()
      .describe('Current job start date (ISO timestamp)'),
    _headline: z.string().optional().describe('Professional headline'),
    _description: z.string().optional().describe('Bio or description'),
    _careerSummary: z.string().optional().describe('Career summary'),
    _linkedInUrl: z.string().optional().describe('LinkedIn profile URL'),
    _socialLinkedIn: z.string().optional().describe('LinkedIn handle'),
    _socialTwitter: z.string().optional().describe('Twitter/X handle'),
    _photoUrl: z.string().nullable().optional().describe('Profile photo URL'),
    _phoneNumbers: z
      .string()
      .optional()
      .describe('Phone numbers (JSON string)'),
    _city: z.string().optional().describe('City'),
    _state: z.string().optional().describe('State or region'),
    _country: z.string().optional().describe('Country'),
    _postalCode: z.string().optional().describe('Postal code'),
    _location: z.string().optional().describe('Full location string'),
    _timezone: z
      .string()
      .optional()
      .describe('Timezone (e.g., America/Los_Angeles)'),
    _workExperience: z
      .string()
      .optional()
      .describe('Work experience history (JSON string array)'),
    _education: z
      .string()
      .optional()
      .describe('Education history (JSON string array)'),
    _skills: z.string().optional().describe('Skills list (JSON string array)'),
    _languages: z.string().optional().describe('Languages (JSON string array)'),
    _exists: z.string().optional().describe('Internal existence flag'),
    _id: z.string().optional().describe('Internal ID (system-generated)'),
    '@organization': z
      .array(z.string())
      .optional()
      .describe(
        'Related organizations in format "native_organization : domain.com"',
      ),
    '@related': z
      .array(z.string())
      .optional()
      .describe('Related objects (opportunities, etc.)'),
    '@isInFocusFor': z
      .array(z.string())
      .optional()
      .describe('Thread messages where this contact is in focus'),
    mzTimestamp: z
      .number()
      .optional()
      .describe('Materialize DB internal timestamp'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z.string().describe('ISO timestamp when last updated'),
  })
  .passthrough();

export const OrganizationSchema = z.object({
  id: z.string().describe('Internal hash ID'),
  objectId: z.string().describe('Organization ID: domain name'),
  _name: z.string().optional().describe('Organization display name'),
  _domain: z.string().optional().describe('Primary domain'),
  _description: z.string().optional().describe('Organization description'),
  _industry: z.string().optional().describe('Industry'),
  _city: z.string().optional().describe('City'),
  _state: z.string().optional().describe('State or region'),
  _country: z.string().optional().describe('Country'),
  _employeeCount: z.number().optional().describe('Number of employees'),
  _logoUrl: z.string().nullable().optional().describe('Logo URL'),
  _socialLinkedIn: z.string().optional().describe('LinkedIn company URL'),
  _resolvedUrl: z.string().optional().describe('Website URL'),
  '@related': z
    .array(z.string())
    .optional()
    .describe('Related objects (contacts, opportunities)'),
  createdAt: z.string().describe('ISO timestamp when created'),
  updatedAt: z.string().describe('ISO timestamp when last updated'),
});

export const StageSchema = z.object({
  id: z.string().describe('Internal hash ID'),
  objectId: z.string().describe('Stage UUID'),
  _title: z.string().describe('Stage display name'),
  _type: z
    .string()
    .describe(
      'Stage type code: CONNECTION, NEEDS_IDENTIFICATION, PROPOSAL, CONSIDERATION_NEGOTIATION, CLOSED_WON, CLOSED_LOST',
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
    .describe('Materialize DB internal timestamp'),
  createdAt: z.string().describe('ISO timestamp when created'),
  updatedAt: z.string().describe('ISO timestamp when last updated'),
});

// ============================================================================
// Function Schemas
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract authentication token and workspace ID from the current Day.ai session. Call this first before any other Day.ai function.',
  notes: 'Must be on day.ai domain and logged in. Token expires after 1 hour.',
  input: z.object({}),
  output: z.object({
    accessToken: z.string().describe('Bearer JWT for API calls'),
    workspaceId: z.string().describe('Current workspace UUID'),
    userId: z.string().describe('Authenticated user UUID'),
    email: z.string().describe('Authenticated user email'),
  }),
};

export const listContactsSchema = {
  name: 'listContacts',
  description:
    'List all contacts (people) in the workspace. Returns enriched contact records with name, title, company, location, LinkedIn, and relationship data.',
  notes:
    'Most contacts only have a subset of fields populated. Un-enriched contacts typically only have objectId, _email, _firstName, _lastName, createdAt, and updatedAt. Enriched contacts may additionally include _headline, _careerSummary, _workExperience, _education, _skills, _languages, _socialLinkedIn, and other profile fields. All optional fields may be absent on any given contact.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    limit: z
      .number()
      .optional()
      .default(100)
      .describe(
        'Max contacts to return (1–10000, default 100). Values outside this range (e.g. 0) fall back to the server default.',
      ),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe(
        'Pagination offset as ISO timestamp (createdAt >= offset). Use createdAt from last item for next page. Results ordered by createdAt ascending.',
      ),
  }),
  output: z.object({
    contacts: z.array(ContactSchema).describe('Array of contact records'),
  }),
};

export const getContactSchema = {
  name: 'getContact',
  description:
    'Get detailed information about a single contact by email address. Uses a direct lookup endpoint for efficient single-contact retrieval. Returns full enriched profile including work experience, education, skills, and relationships.',
  notes:
    'Uses object.getObjectRows for direct lookup instead of fetching all contacts. The propertyNames param filters which property rows are returned from the API.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    email: z
      .string()
      .describe(
        'Contact email address (this is the contact ID in Day.ai). Must be non-empty.',
      ),
    propertyNames: z
      .array(z.string())
      .optional()
      .describe(
        'Optional list of property names to return. Filters the API response to only include these properties. Valid names: firstName, lastName, email, currentJobTitle, linkedInUrl, phoneNumbers, city, state, country, postalCode, location, timezone, careerSummary, description, socialTwitter, photoUrl. Omit to return all properties. Invalid names are silently ignored; the contact is still returned with metadata (id, objectId, createdAt, updatedAt) but no property fields.',
      ),
    includeRelationships: z
      .boolean()
      .optional()
      .describe(
        'Include structured relationship data (linked organizations, opportunities, threads). Calls object.getObjectRelationshipsWithProperties endpoint.',
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
        'ISO timestamp to filter timeline entries from. Only used when includeTimeline is true. Defaults to 7 days ago.',
      ),
  }),
  output: z.object({
    contact: ContactSchema.describe('Full contact record'),
    relationships: z
      .array(
        z.object({
          relationship: z
            .string()
            .describe(
              'Relationship type (e.g., "organization", "isInFocusFor")',
            ),
          targetObjectTypeId: z
            .string()
            .describe(
              'Target object type (e.g., "native_organization", "native_threadmessage")',
            ),
          targetObjectId: z
            .string()
            .describe('Target object ID (e.g., domain or UUID)'),
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
          label: z
            .string()
            .optional()
            .describe('Human-readable description of the change'),
          userId: z.string().optional().describe('User who made the change'),
          propertyId: z
            .string()
            .optional()
            .describe('Internal property identifier (e.g., "firstName")'),
          propertyName: z
            .string()
            .optional()
            .describe(
              'Display name of the changed property (e.g., "First Name")',
            ),
          reasoning: z
            .string()
            .optional()
            .describe('Source description for the change'),
          value: z.string().optional().describe('New value after the change'),
          valueLabel: z
            .string()
            .optional()
            .describe('Display label for the new value'),
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
  }),
};

export const listOpportunitiesSchema = {
  name: 'listOpportunities',
  description:
    'List all opportunities (deals) in the workspace. Returns deal name, stage, owner, related contacts and organization, and custom properties.',
  notes:
    'Custom properties appear as _custom/{uuid} fields. Use listPipelines to map stage IDs to stage names. IMPORTANT: To update an opportunity, use the objectId field (UUID with dashes, e.g. "19b74185-fd0c-4ee5-874a-266030403c11"), NOT the id field (hex without dashes) which will fail with a GraphQL error.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Max opportunities to return (1–10000, default 100)'),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe(
        'Pagination offset as ISO timestamp (createdAt >= offset). Use createdAt from last item for next page.',
      ),
  }),
  output: z.object({
    opportunities: z
      .array(OpportunitySchema)
      .describe('Array of opportunity records'),
  }),
};

export const listPipelinesSchema = {
  name: 'listPipelines',
  description:
    'List all pipeline stages. Returns a flat list of stages across all pipelines. Each stage includes title, type, position, likelihood to close, entrance criteria, and a pipeline reference. Use this to map stage IDs from opportunity records to stage names.',
  notes:
    'Returns stages (not pipelines). Each stage has a _pipelineId and @pipeline reference to its parent pipeline. Group stages by _pipelineId or @pipeline to reconstruct pipeline-to-stages mapping. Stages are ordered by createdAt ascending. PAGINATION: The offset uses >= (greater-than-or-equal) semantics, so the last item from page N will appear again as the first item on page N+1. Deduplicate by objectId when paginating. Most workspaces have fewer than 100 stages, so pagination is rarely needed.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    limit: z
      .number()
      .optional()
      .default(100)
      .describe(
        'Max stages to return (1–10000, default 100). Must be a positive integer; values outside 1–10000 will throw an error.',
      ),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe(
        'Pagination offset as ISO timestamp (createdAt >= offset). Because offset uses >= semantics, the last item from the previous page will repeat as the first item on the next page; deduplicate by objectId. Results ordered by createdAt ascending.',
      ),
  }),
  output: z.object({
    stages: z
      .array(StageSchema)
      .describe('All pipeline stages across all pipelines'),
  }),
};

// ============================================================================
// Type Exports
// ============================================================================

export type Contact = z.infer<typeof ContactSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type Opportunity = z.infer<typeof OpportunitySchema>;

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type ListContactsInput = z.infer<typeof listContactsSchema.input>;
export type ListContactsOutput = z.infer<typeof listContactsSchema.output>;
export type GetContactInput = z.infer<typeof getContactSchema.input>;
export type GetContactOutput = z.infer<typeof getContactSchema.output>;
export type ListOpportunitiesInput = z.infer<
  typeof listOpportunitiesSchema.input
>;
export type ListOpportunitiesOutput = z.infer<
  typeof listOpportunitiesSchema.output
>;
export type ListPipelinesInput = z.infer<typeof listPipelinesSchema.input>;
export type ListPipelinesOutput = z.infer<typeof listPipelinesSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

import {
  listPagesSchema,
  getPageSchema,
  createPageSchema,
  updatePageSchema,
  deletePageSchema,
  listDraftsSchema,
  getDraftSchema,
  sendEmailSchema,
  PageSchema,
  PageDetailSchema,
  DraftSchema,
  DraftEmailPropertiesSchema,
  DraftDetailSchema,
  WorkspaceUserContextSchema,
} from './schemas-pages';

export {
  listPagesSchema,
  getPageSchema,
  createPageSchema,
  updatePageSchema,
  deletePageSchema,
  listDraftsSchema,
  getDraftSchema,
  sendEmailSchema,
  PageSchema,
  PageDetailSchema,
  DraftSchema,
  DraftEmailPropertiesSchema,
  DraftDetailSchema,
  WorkspaceUserContextSchema,
};

export type {
  ListPagesInput,
  ListPagesOutput,
  GetPageInput,
  GetPageOutput,
  CreatePageInput,
  CreatePageOutput,
  UpdatePageInput,
  UpdatePageOutput,
  DeletePageInput,
  DeletePageOutput,
  ListDraftsInput,
  ListDraftsOutput,
  GetDraftInput,
  GetDraftOutput,
  SendEmailInput,
  SendEmailOutput,
  DraftEmailProperties,
  DraftDetail,
  WorkspaceUserContext,
} from './schemas-pages';

import { allDealsSchemas } from './schemas-deals';
export {
  OpportunitySchema,
  PipelineSchema,
  PipelineIcpInputSchema,
  StageUpdateInputSchema,
  getOpportunitySchema,
  createOpportunitySchema,
  updateOpportunitySchema,
  deleteOpportunitySchema,
  getPipelineSchema,
  createPipelineSchema,
  updatePipelineSchema,
} from './schemas-deals';
export type {
  Pipeline,
  GetOpportunityInput,
  GetOpportunityOutput,
  CreateOpportunityInput,
  CreateOpportunityOutput,
  UpdateOpportunityInput,
  UpdateOpportunityOutput,
  DeleteOpportunityInput,
  DeleteOpportunityOutput,
  GetPipelineInput,
  GetPipelineOutput,
  CreatePipelineInput,
  CreatePipelineOutput,
  UpdatePipelineInput,
  UpdatePipelineOutput,
} from './schemas-deals';

import { allSchemasWorkspace } from './schemas-workspace';
import { allActionsSchemas } from './schemas-actions';
import { allContactsOrgsSchemas } from './schemas-contacts-orgs';

export const allSchemas = [
  getContextSchema,
  listContactsSchema,
  getContactSchema,
  listOpportunitiesSchema,
  listPipelinesSchema,
  listPagesSchema,
  getPageSchema,
  createPageSchema,
  updatePageSchema,
  deletePageSchema,
  listDraftsSchema,
  getDraftSchema,
  sendEmailSchema,
  ...allDealsSchemas,
  ...allSchemasWorkspace,
  ...allActionsSchemas,
  ...allContactsOrgsSchemas,
];
