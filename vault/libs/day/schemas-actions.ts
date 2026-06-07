import { z } from 'zod';

// Inline shared params to avoid circular imports
const AccessTokenParam = z
  .string()
  .describe('Bearer access token from getContext()');

const WorkspaceIdParam = z
  .string()
  .describe('Workspace UUID from getContext()');

// ============================================================================
// Entity Schemas
// ============================================================================

export const ActionSchema = z
  .object({
    id: z.string().describe('Internal hash ID'),
    objectId: z.string().describe('Action UUID (primary key)'),
    _title: z.string().optional().describe('Action title'),
    _description: z.string().optional().describe('Action description'),
    _descriptionPoints: z
      .string()
      .optional()
      .describe('Bullet-point breakdown of the action (JSON string array)'),
    _status: z
      .string()
      .optional()
      .describe(
        'Status: UNREAD (open/todo), READ, SNOOZED, DISMISSED, REDUNDANT, COMPLETED',
      ),
    _priority: z
      .string()
      .optional()
      .describe('Priority: HIGH, MEDIUM, LOW, URGENT'),
    _type: z
      .string()
      .optional()
      .describe(
        'Type: FOLLOWUP, SUPPORT, MEETINGPREP, FEATURE_REQUEST, MEETING_RECORDING_FOLLOWUP, EMAIL_RESPONSE, SCHEDULE_MEETING, NUDGE, OTHER',
      ),
    _ownerEmail: z.string().optional().describe('Assignee email address'),
    _ownerId: z.string().optional().describe('Assignee user UUID'),
    _assignedAt: z
      .string()
      .optional()
      .describe('ISO timestamp when action was assigned'),
    _people: z
      .string()
      .optional()
      .describe('Related people emails (JSON string array)'),
    _domains: z
      .string()
      .optional()
      .describe('Related organization domains (JSON string array)'),
    _opportunityIds: z
      .string()
      .optional()
      .describe('Related opportunity IDs (JSON string array)'),
    _sourceType: z
      .string()
      .optional()
      .describe(
        'Source type: MANUAL, GMAIL_THREAD, or other AI-generated source type',
      ),
    _sourceId: z
      .string()
      .optional()
      .describe('Source entity UUID (e.g., email thread ID for GMAIL_THREAD)'),
    _sourceLabel: z
      .string()
      .optional()
      .describe(
        'Human-readable description of the source event that created the action',
      ),
    _reasoning: z
      .string()
      .optional()
      .describe('AI reasoning for why this action was created or its status'),
    _statusUpdatedAt: z
      .string()
      .optional()
      .describe('ISO timestamp of last status change'),
    _timeframeStart: z
      .string()
      .optional()
      .describe('Suggested start date for the action (ISO timestamp)'),
    _timeframeEnd: z
      .string()
      .optional()
      .describe('Due date / timeframe end for the action (ISO timestamp)'),
    _channelType: z
      .string()
      .optional()
      .describe('Communication channel type: GMAIL, SLACK, etc.'),
    _channelId: z
      .string()
      .optional()
      .describe('Channel entity UUID (e.g., Gmail thread UUID)'),
    _channelLabel: z
      .string()
      .optional()
      .describe('Channel display label (e.g., email subject line)'),
    _channelAccountId: z
      .string()
      .optional()
      .describe(
        'Account email used for the channel (e.g., sender email for GMAIL)',
      ),
    _draftPrompts: z
      .string()
      .optional()
      .describe('AI-suggested draft prompts (JSON string array)'),
    _exists: z.string().optional().describe('Internal existence flag'),
    '@assignee': z
      .array(z.string())
      .optional()
      .describe('Assignee reference "native_user : uuid"'),
    '@related': z
      .array(z.string())
      .optional()
      .describe(
        'Related objects (contacts, organizations) in format "native_type : id"',
      ),
    sharedWithUsers: z
      .array(z.string())
      .optional()
      .describe('User UUIDs this action is shared with'),
    sharedWithWorkspace: z
      .boolean()
      .optional()
      .describe('Whether the action is shared with the entire workspace'),
    mzTimestamp: z
      .number()
      .optional()
      .describe('Materialize DB internal timestamp'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z
      .string()
      .optional()
      .describe('ISO timestamp when last updated'),
  })
  .passthrough();

export const RecordingSchema = z
  .object({
    id: z.string().describe('Internal hash ID'),
    objectId: z.string().describe('Recording UUID (primary key)'),
    _title: z.string().optional().describe('Meeting recording title'),
    _description: z
      .string()
      .optional()
      .describe('AI-generated description of the meeting'),
    _topic: z.string().optional().describe('Meeting topic'),
    _summaryShort: z
      .string()
      .optional()
      .describe(
        'Short AI-generated summary. Only present when recording has a processed transcript (_status/latest/code=READY and transcript was captured). Absent on recordings with no audio.',
      ),
    _summaryLong: z
      .string()
      .optional()
      .describe(
        'Long AI-generated summary. Only present when recording has a processed transcript. Absent on recordings without transcript.',
      ),
    _notes: z
      .string()
      .optional()
      .describe(
        'AI-generated meeting notes (JSON blob). Only present when recording has a processed transcript. For the full structured notes blob, use getRecording with includeNotes=true.',
      ),
    '_status/latest/code': z
      .string()
      .optional()
      .describe(
        'Processing status code: READY, CALL_ENDED_WITHOUT_RECORDING, etc.',
      ),
    '_status/latest/reason': z
      .string()
      .optional()
      .describe(
        'Reason for the status (e.g., TIMEOUT_EXCEEDED_RECORDING_PERMISSION_DENIED, BOT_KICKED_FROM_WAITING_ROOM)',
      ),
    '_videoAsset/id': z
      .string()
      .optional()
      .describe('Video asset ID for recordings that have processed video'),
    _platform: z
      .enum(['GOOGLE_MEET', 'ZOOM'])
      .optional()
      .describe('Meeting platform used for the recording'),
    _storedAt: z
      .string()
      .optional()
      .describe('ISO timestamp when the recording was stored'),
    _type: z
      .string()
      .optional()
      .describe(
        'Recording type: INSUFFICIENT_DATA when no transcript was available',
      ),
    _descriptionBullets: z
      .array(z.string())
      .optional()
      .describe('AI-generated description as bullet points'),
    _descriptionLong: z
      .array(z.string())
      .optional()
      .describe('AI-generated long description as an array of paragraphs'),
    '@attendee': z
      .array(z.string())
      .optional()
      .describe(
        'Meeting attendees as relationship strings "native_type : id" (contacts and organizations)',
      ),
    '@recordedBy': z
      .array(z.string())
      .optional()
      .describe(
        'User who triggered the recording as "native_user : uuid" reference',
      ),
    '@related': z
      .array(z.string())
      .optional()
      .describe('Related contacts and opportunities'),
    _exists: z.string().optional().describe('Internal existence flag'),
    sharedWithUsers: z
      .array(z.string())
      .optional()
      .describe('User UUIDs this recording is shared with'),
    sharedWithWorkspace: z
      .boolean()
      .optional()
      .describe('Whether the recording is shared with the entire workspace'),
    mzTimestamp: z
      .number()
      .optional()
      .describe('Materialize DB internal timestamp'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z
      .string()
      .optional()
      .describe('ISO timestamp when last updated'),
  })
  .passthrough();

// ============================================================================
// Function Schemas
// ============================================================================

export const listActionsSchema = {
  name: 'listActions',
  description:
    'List action items (tasks) in the workspace. Returns actions with title, status, priority, assignee, and related people/organizations. Use the status filter on the UI default view (UNREAD, READ) to see open items.',
  notes:
    'The default view filters by assignee and status. listActions returns all actions regardless of filter. Status values: UNREAD=open/todo, READ=seen, SNOOZED=deferred, DISMISSED=closed, COMPLETED=done.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Max actions to return (default 100)'),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe('Pagination offset as ISO timestamp'),
  }),
  output: z.object({
    actions: z
      .array(ActionSchema)
      .describe(
        'Array of action records. objectId is the UUID to use for getAction, updateAction, deleteAction.',
      ),
  }),
};

export const getActionSchema = {
  name: 'getAction',
  description:
    'Get a single action item by its UUID. Uses direct lookup via object.getObjectRows for efficient retrieval. Returns full action details including title, status, priority, description, assignee, and related people/organizations.',
  notes:
    'Uses object.getObjectRows for direct lookup instead of fetching all actions. The propertyNames param filters which property rows are returned. Valid property names: title, description, descriptionPoints, status, priority, type, ownerEmail, ownerId, assignedAt, people, domains, opportunityIds, sourceType, sourceId, sourceLabel, reasoning, statusUpdatedAt, timeframeStart, timeframeEnd, channelType, channelId, channelLabel, channelAccountId, draftPrompts.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    actionId: z
      .string()
      .describe('Action UUID from listActions objectId field'),
    propertyNames: z
      .array(z.string())
      .optional()
      .describe(
        'Optional list of property names to return. Filters the API response to only include these properties. Valid names: title, description, descriptionPoints, status, priority, type, ownerEmail, ownerId, assignedAt, people, domains, opportunityIds, sourceType, sourceId, sourceLabel, reasoning, statusUpdatedAt, timeframeStart, timeframeEnd, channelType, channelId, channelLabel, channelAccountId, draftPrompts. Omit to return all properties.',
      ),
    includeRelationships: z
      .boolean()
      .optional()
      .describe(
        'Include structured relationship data (assignees, related contacts, organizations). Calls object.getObjectRelationshipsWithProperties endpoint.',
      ),
    includeTimeline: z
      .boolean()
      .optional()
      .describe(
        'Include recent activity timeline entries (status changes, relationship events). Calls timeline.getTimeline endpoint.',
      ),
    timelineSince: z
      .string()
      .optional()
      .describe(
        'ISO timestamp to filter timeline entries from. Only used when includeTimeline is true. Defaults to 7 days ago.',
      ),
    includeLineage: z
      .boolean()
      .optional()
      .describe(
        'Include provenance/lineage data for each property, showing which source (thread, email, etc.) contributed each value. Calls lineage.getLineage with propertyVersionHashes from object.getObjectRows. Returns empty for manually-created actions with no AI-enriched properties.',
      ),
  }),
  output: z.object({
    action: ActionSchema.describe('Full action record'),
    relationships: z
      .array(
        z.object({
          relationship: z
            .string()
            .describe('Relationship type (e.g., "assignee", "related")'),
          targetObjectTypeId: z
            .string()
            .describe(
              'Target object type (e.g., "native_user", "native_contact", "native_organization")',
            ),
          targetObjectId: z
            .string()
            .describe('Target object ID (e.g., user UUID, email, or domain)'),
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
          userId: z.string().optional().describe('User who made the change'),
          propertyId: z
            .string()
            .optional()
            .describe('Internal property identifier (e.g., "status", "title")'),
          propertyName: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Human-readable property label (e.g., "Status", "Title") or relationship description (e.g., "is assigned to user")',
            ),
          value: z.string().optional().describe('New value after the change'),
          valueLabel: z
            .string()
            .optional()
            .describe('Human-readable label for the new value'),
          label: z
            .string()
            .optional()
            .describe('Human-readable description of the change event'),
          reasoning: z
            .string()
            .nullable()
            .optional()
            .describe(
              'AI-generated reasoning or system description of why the change occurred',
            ),
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
            id: z.string().describe('Source object ID'),
            properties: z
              .array(
                z.object({
                  userId: z.string().optional(),
                  name: z.string().optional(),
                  version: z.number().optional(),
                  source: z.string().optional(),
                  citations: z.array(z.unknown()).optional(),
                }),
              )
              .optional()
              .describe('Property version details for this source'),
          }),
        ),
      )
      .optional()
      .describe(
        'Provenance map keyed by propertyVersionHash. Each entry lists the source objects that contributed to that property value. Present when includeLineage is true.',
      ),
  }),
};

export const createActionSchema = {
  name: 'createAction',
  description:
    'Create a new action item (task) in the workspace. Requires a title, type, and owner. Optionally link to related contacts, organizations, or opportunities.',
  notes:
    'ownerEmail is the reliable assignment field; provide it to assign to a specific member. If omitted, the server assigns to the current authenticated user. ownerId is not validated by the server; pass ownerEmail to control ownership. type defaults to FOLLOWUP. priority defaults to MEDIUM. dueDate is an ISO datetime string. sourceType/sourceId/sourceLabel describe the origin (e.g., GMAIL_THREAD). channelType/channelId/channelLabel/channelAccountId link to a communication channel. descriptionPoints are bullet-point summaries. For MANUAL sourceType, the backend may override sourceId and sourceLabel with the current user info.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    title: z.string().describe('Action title (required)'),
    ownerEmail: z
      .string()
      .optional()
      .describe(
        'Email of the workspace member to assign this action to. If omitted, the server assigns to the currently authenticated user. Recommended over ownerId; ownerEmail is the reliable assignment field.',
      ),
    ownerId: z
      .string()
      .optional()
      .describe(
        'User UUID of the assignee. Optional and not validated by the server; incorrect UUIDs are accepted without error. Use ownerEmail to control ownership reliably.',
      ),
    type: z
      .enum([
        'FOLLOWUP',
        'SUPPORT',
        'MEETINGPREP',
        'FEATURE_REQUEST',
        'MEETING_RECORDING_FOLLOWUP',
        'EMAIL_RESPONSE',
        'SCHEDULE_MEETING',
        'NUDGE',
        'OTHER',
      ])
      .optional()
      .default('FOLLOWUP')
      .describe('Action type'),
    priority: z
      .enum(['HIGH', 'MEDIUM', 'LOW', 'URGENT'])
      .optional()
      .default('MEDIUM')
      .describe('Action priority'),
    description: z.string().optional().describe('Action description'),
    people: z
      .array(z.string())
      .optional()
      .default([])
      .describe('Email addresses of related contacts'),
    domains: z
      .array(z.string())
      .optional()
      .default([])
      .describe('Domain names of related organizations'),
    opportunityIds: z
      .array(z.string())
      .optional()
      .default([])
      .describe('UUIDs of related opportunities'),
    dueDate: z
      .string()
      .optional()
      .describe('Due date as ISO datetime string (timeframeEnd)'),
    status: z
      .enum([
        'UNREAD',
        'READ',
        'SNOOZED',
        'DISMISSED',
        'REDUNDANT',
        'COMPLETED',
      ])
      .optional()
      .describe('Initial action status. Defaults to UNREAD if not specified.'),
    timeframeStart: z
      .string()
      .optional()
      .describe(
        'Displayed as "Snooze Date" in the UI. ISO datetime string. Used to indicate when the action should be revisited.',
      ),
    sourceType: z
      .enum([
        'MANUAL',
        'GMAIL_THREAD',
        'AI_GENERATED',
        'MEETING_RECORDING',
        'SLACK_CHANNEL',
        'NOTE',
        'OPPORTUNITY',
        'ZAPIER',
        'API',
      ])
      .optional()
      .describe(
        'Source type indicating how the action was created. MANUAL for user-created, GMAIL_THREAD for email-generated, AI_GENERATED for AI-created, MEETING_RECORDING for meeting follow-ups, SLACK_CHANNEL for Slack-sourced, NOTE/OPPORTUNITY/ZAPIER/API for other integrations.',
      ),
    sourceId: z
      .string()
      .optional()
      .describe(
        'Source entity UUID (e.g., email thread ID). Backend may override for MANUAL sourceType.',
      ),
    sourceLabel: z
      .string()
      .optional()
      .describe(
        'Human-readable description of the source event. Backend may override for MANUAL sourceType.',
      ),
    reasoning: z
      .string()
      .optional()
      .describe('AI reasoning for why this action was created or recommended.'),
    channelType: z
      .enum(['GMAIL', 'SLACK', 'EMAIL'])
      .optional()
      .describe('Communication channel type for this action.'),
    channelId: z
      .string()
      .optional()
      .describe('Channel entity UUID (e.g., Gmail thread UUID).'),
    channelLabel: z
      .string()
      .optional()
      .describe('Channel display label (e.g., email subject line).'),
    channelAccountId: z
      .string()
      .optional()
      .describe(
        'Account email used for the channel (e.g., sender email for GMAIL).',
      ),
    descriptionPoints: z
      .array(z.string())
      .optional()
      .describe(
        'Bullet-point breakdown of the action. Stored as JSON string array.',
      ),
    id: z
      .string()
      .optional()
      .describe(
        'Custom UUID to use as the action ID. If not provided, the server generates one. Confirmed accepted by CreateActionInput.',
      ),
    userId: z
      .string()
      .optional()
      .describe(
        'User UUID of the assignee (alternative to ownerId). Matches the userId field in updateAction. Accepted alongside or instead of ownerEmail/ownerId.',
      ),
    sources: z
      .array(z.string())
      .optional()
      .describe(
        'Source references as an array of strings. Equivalent to the separate sourceType/sourceId/sourceLabel fields but in array form. The server may override for user-created (MANUAL) actions. Confirmed accepted by CreateActionInput.',
      ),
    draftPrompts: z
      .array(
        z.object({
          channelType: z
            .string()
            .optional()
            .describe(
              'Communication channel type for this draft prompt (e.g. "GMAIL"). Tags the prompt with context about what channel a draft response should be sent via.',
            ),
        }),
      )
      .optional()
      .describe(
        'AI-suggested draft prompts for this action. Each prompt is an ActionPrompt object with an optional channelType field. Stored as JSON in the _draftPrompts property.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the action was created successfully'),
  }),
};

export const updateActionSchema = {
  name: 'updateAction',
  description:
    'Update an action item. Can change title, status, priority, description, due date, related people/organizations, assignee, type, channel, and more. Use status=COMPLETED to complete, status=DISMISSED to dismiss.',
  notes:
    'Only pass fields you want to change. Status values: UNREAD, READ, SNOOZED, DISMISSED, REDUNDANT, COMPLETED. Priority values: HIGH, MEDIUM, LOW, URGENT. userId is the assignee user UUID (use workspace members list). ownerEmail is the assignee email address. Both userId and ownerEmail can be provided together for reassignment. people must be email addresses of contacts that already exist in the Day.ai workspace; passing an unrecognized email will result in a generic server error.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    actionId: z.string().describe('Action UUID to update'),
    title: z.string().optional().describe('New title'),
    status: z
      .enum([
        'UNREAD',
        'READ',
        'SNOOZED',
        'DISMISSED',
        'REDUNDANT',
        'COMPLETED',
      ])
      .optional()
      .describe('New status'),
    priority: z
      .enum(['HIGH', 'MEDIUM', 'LOW', 'URGENT'])
      .optional()
      .describe('New priority'),
    description: z.string().optional().describe('New description'),
    dueDate: z
      .string()
      .optional()
      .describe('New due date as ISO datetime string (timeframeEnd)'),
    timeframeStart: z
      .string()
      .optional()
      .describe('New suggested start date as ISO datetime string'),
    people: z
      .array(z.string())
      .optional()
      .describe(
        'New list of related contact email addresses. Each email must belong to a contact that already exists in the Day.ai workspace; passing an unrecognized email will cause a server error.',
      ),
    domains: z
      .array(z.string())
      .optional()
      .describe('New list of related organization domains'),
    opportunityIds: z
      .array(z.string())
      .optional()
      .describe('New list of related opportunity UUIDs'),
    type: z
      .enum([
        'FOLLOWUP',
        'SUPPORT',
        'MEETINGPREP',
        'FEATURE_REQUEST',
        'MEETING_RECORDING_FOLLOWUP',
        'EMAIL_RESPONSE',
        'SCHEDULE_MEETING',
        'NUDGE',
        'OTHER',
      ])
      .optional()
      .describe('New action type'),
    ownerEmail: z.string().optional().describe('New assignee email address'),
    userId: z
      .string()
      .optional()
      .describe(
        'New assignee user UUID (workspace member UUID; note: field is userId, not ownerId)',
      ),
    reasoning: z
      .string()
      .optional()
      .describe('Updated AI reasoning or rationale for this action'),
    channelType: z
      .enum(['GMAIL', 'SLACK'])
      .optional()
      .describe('Communication channel type'),
    channelId: z
      .string()
      .optional()
      .describe('Channel entity UUID (e.g., Gmail thread UUID)'),
    channelLabel: z
      .string()
      .optional()
      .describe('Channel display label (e.g., email subject line)'),
    channelAccountId: z
      .string()
      .optional()
      .describe('Account email used for the channel'),
    descriptionPoints: z
      .array(z.string())
      .optional()
      .describe(
        'Bullet-point breakdown of the action (stored as JSON string array)',
      ),
    statusUpdatedAt: z
      .string()
      .optional()
      .describe('ISO timestamp to record when the status was changed'),
    sources: z
      .array(z.string())
      .optional()
      .describe(
        "Source references for this action as an array of strings. This is the UpdateActionInput equivalent of createAction's separate sourceType/sourceId/sourceLabel fields. The server accepts any string format; format may encode type, ID, and label. Confirmed valid via API probing.",
      ),
    draftPrompts: z
      .array(
        z.object({
          channelType: z
            .string()
            .optional()
            .describe(
              'Communication channel type for this draft prompt (e.g. "GMAIL"). Tags the prompt with context about what channel a draft response should be sent via.',
            ),
        }),
      )
      .optional()
      .describe(
        'AI-suggested draft prompts for this action. Each prompt is an ActionPrompt object with an optional channelType field. Stored as JSON in the _draftPrompts property. Pass an empty array to clear draft prompts.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the action was updated successfully'),
  }),
};

export const deleteActionSchema = {
  name: 'deleteAction',
  description:
    'Dismiss (soft-delete) an action item. The action is not permanently destroyed; it remains in the system with _status set to "DISMISSED" and an audit trail stamped into _reasoning. The action will no longer appear in the default active view but can still be retrieved via listActions or getAction.',
  notes:
    'Day.ai does not expose hard-delete for actions. deleteAction calls the deleteAction GraphQL mutation, which internally sets _status=DISMISSED and writes a "Deleted on <timestamp> by user <id>" audit entry to _reasoning. The action record persists and is still retrievable. This is equivalent to calling updateAction with status=DISMISSED, with the addition of the audit trail entry.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    actionId: z.string().describe('Action UUID to dismiss'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the dismiss operation completed successfully'),
  }),
};

export const listRecordingsSchema = {
  name: 'listRecordings',
  description:
    'List meeting recordings in the workspace. Returns recordings with title, AI-generated description, summary, topic, and processing status.',
  notes:
    'PAGINATION: offset uses >= (greater-than-or-equal) semantics on createdAt. The last item from page N will appear again as the first item on page N+1; deduplicate by objectId when paginating. LIMIT: must be 1–10000; passing 0 or negative values throws an error. Most workspaces have fewer than 100 recordings.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    limit: z
      .number()
      .optional()
      .default(100)
      .describe(
        'Max recordings to return (1–10000, default 100). Values outside this range throw an error.',
      ),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe(
        'Pagination offset as ISO timestamp (createdAt >= offset). Use createdAt from last item for next page. Because offset uses >= semantics, the last item from page N will reappear as the first item on page N+1; deduplicate by objectId. Results ordered by createdAt ascending.',
      ),
  }),
  output: z.object({
    recordings: z
      .array(RecordingSchema)
      .describe(
        'Array of recording records. objectId is the UUID to use for getRecording.',
      ),
  }),
};

export const getRecordingSchema = {
  name: 'getRecording',
  description:
    'Get a single meeting recording by its UUID. Returns full recording details including AI-generated title, description, summary, topic, and notes. Supports optional enrichment: relationships, timeline, lineage, notes blob, video asset, and calendar event.',
  notes:
    'includeNotes fetches the full structured meeting notes blob via object.getBlob (propertyName="notes"). includeVideoAsset fetches playback URLs and tokens via GetVideoAssetForObject GraphQL query; only returns data when _videoAsset/id is present. includeCalendarEvent fetches the linked Google Calendar event with attendees and timing via GetMeetingRecordingCalendarEvent GraphQL query.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    recordingId: z
      .string()
      .describe('Recording UUID from listRecordings objectId field'),
    includeRelationships: z
      .boolean()
      .optional()
      .describe(
        'Include structured relationship data (attendees, related contacts, organizations). Calls object.getObjectRelationshipsWithProperties endpoint.',
      ),
    includeTimeline: z
      .boolean()
      .optional()
      .describe(
        'Include recent activity timeline entries (status changes, relationship events). Calls timeline.getTimeline endpoint.',
      ),
    timelineSince: z
      .string()
      .optional()
      .describe(
        'ISO timestamp to filter timeline entries from. Only used when includeTimeline is true. Defaults to 7 days ago.',
      ),
    includeLineage: z
      .boolean()
      .optional()
      .describe(
        'Include provenance/lineage data for each property, showing which source contributed each value. Calls object.getObjectRows then lineage.getLineage.',
      ),
    includeNotes: z
      .boolean()
      .optional()
      .describe(
        'Fetch full structured meeting notes blob via object.getBlob with propertyName="notes". Returns JSON string with AI-generated notes content.',
      ),
    includeVideoAsset: z
      .boolean()
      .optional()
      .describe(
        'Fetch video playback URLs, tokens, and thumbnail data. Calls GetVideoAssetForObject GraphQL query using _videoAsset/id from the recording. Only returns data when _videoAsset/id is present.',
      ),
    includeCalendarEvent: z
      .boolean()
      .optional()
      .describe(
        'Fetch linked Google Calendar event with attendees, start/end times, and description. Calls GetMeetingRecordingCalendarEvent GraphQL query.',
      ),
  }),
  output: z.object({
    recording: RecordingSchema.describe('Full recording record'),
    relationships: z
      .array(
        z.object({
          relationship: z
            .string()
            .describe('Relationship type (e.g., "attendee", "recordedBy")'),
          targetObjectTypeId: z
            .string()
            .describe(
              'Target object type (e.g., "native_user", "native_contact", "native_organization")',
            ),
          targetObjectId: z
            .string()
            .describe('Target object ID (e.g., user UUID, email, or domain)'),
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
          userId: z.string().optional().describe('User who made the change'),
          propertyId: z
            .string()
            .optional()
            .describe('Internal property identifier'),
          propertyName: z
            .string()
            .nullable()
            .optional()
            .describe('Human-readable property label'),
          value: z.string().optional().describe('New value after the change'),
          valueLabel: z
            .string()
            .optional()
            .describe('Human-readable label for the new value'),
          label: z
            .string()
            .optional()
            .describe('Human-readable description of the change event'),
          reasoning: z
            .string()
            .nullable()
            .optional()
            .describe('AI-generated reasoning for the change'),
          valueObjectType: z
            .string()
            .nullable()
            .optional()
            .describe('Object type of the value if referencing another object'),
          valueObjectId: z
            .string()
            .nullable()
            .optional()
            .describe('Object ID of the value if referencing another object'),
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
              .describe('Source object type (e.g., "native_thread")'),
            id: z.string().describe('Source object ID'),
            properties: z
              .array(
                z.object({
                  userId: z.string().optional(),
                  name: z.string().optional(),
                  version: z.number().optional(),
                  source: z.string().optional(),
                  citations: z.array(z.unknown()).optional(),
                }),
              )
              .optional(),
          }),
        ),
      )
      .optional()
      .describe(
        'Provenance map keyed by propertyVersionHash when includeLineage is true',
      ),
    notes: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Full structured meeting notes blob (JSON string) when includeNotes is true. Contains AI-generated notes content.',
      ),
    videoAsset: z
      .object({
        id: z.string().describe('Video asset ID'),
        private: z
          .object({
            playbackId: z.string().optional().describe('Mux playback ID'),
            tokens: z
              .object({
                video: z.string().optional().describe('Video playback token'),
                thumbnail: z.string().optional().describe('Thumbnail token'),
                storyboard: z.string().optional().describe('Storyboard token'),
              })
              .optional(),
            thumbnail: z
              .object({
                status: z.string().optional(),
                url: z.string().nullable().optional(),
              })
              .optional(),
            download: z
              .object({
                status: z.string().optional(),
                urls: z
                  .array(
                    z.object({
                      default: z.boolean().optional(),
                      quality: z.string().optional(),
                      url: z.string().optional(),
                    }),
                  )
                  .optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .nullable()
      .optional()
      .describe('Video playback data when includeVideoAsset is true'),
    calendarEvents: z
      .array(
        z.object({
          GoogleEvent: z
            .object({
              id: z.string().describe('Internal Google event ID'),
              googleId: z.string().describe('Google Calendar event ID'),
              start_time: z.string().describe('Event start time'),
              end_time: z.string().describe('Event end time'),
              description: z
                .string()
                .nullable()
                .optional()
                .describe('Event description'),
              attendees: z
                .array(
                  z.object({
                    email: z.string().describe('Attendee email address'),
                    displayName: z.string().nullable().optional(),
                    optional: z.boolean().optional(),
                    responseStatus: z
                      .string()
                      .optional()
                      .describe('NEEDS_ACTION, ACCEPTED, DECLINED, TENTATIVE'),
                    organizer: z.boolean().optional(),
                    resource: z.boolean().optional(),
                    self: z
                      .boolean()
                      .optional()
                      .describe('True if this is the authenticated user'),
                    comment: z.string().nullable().optional(),
                  }),
                )
                .optional()
                .describe('Structured attendee objects from Google Calendar'),
              title: z.string().describe('Event title'),
            })
            .nullable()
            .optional(),
        }),
      )
      .nullable()
      .optional()
      .describe('Calendar event data when includeCalendarEvent is true'),
  }),
};

// ============================================================================
// Type Exports
// ============================================================================

export type Action = z.infer<typeof ActionSchema>;
export type Recording = z.infer<typeof RecordingSchema>;

export type ListActionsInput = z.infer<typeof listActionsSchema.input>;
export type ListActionsOutput = z.infer<typeof listActionsSchema.output>;
export type GetActionInput = z.infer<typeof getActionSchema.input>;
export type GetActionOutput = z.infer<typeof getActionSchema.output>;
export type CreateActionInput = z.infer<typeof createActionSchema.input>;
export type CreateActionOutput = z.infer<typeof createActionSchema.output>;
export type UpdateActionInput = z.infer<typeof updateActionSchema.input>;
export type UpdateActionOutput = z.infer<typeof updateActionSchema.output>;
export type DeleteActionInput = z.infer<typeof deleteActionSchema.input>;
export type DeleteActionOutput = z.infer<typeof deleteActionSchema.output>;
export type ListRecordingsInput = z.infer<typeof listRecordingsSchema.input>;
export type ListRecordingsOutput = z.infer<typeof listRecordingsSchema.output>;
export type GetRecordingInput = z.infer<typeof getRecordingSchema.input>;
export type GetRecordingOutput = z.infer<typeof getRecordingSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allActionsSchemas = [
  listActionsSchema,
  getActionSchema,
  createActionSchema,
  updateActionSchema,
  deleteActionSchema,
  listRecordingsSchema,
  getRecordingSchema,
];
