/**
 * Salesforce Activity Operations (Events, ContentDocumentLink)
 *
 * Event list/get via Aura framework.
 * Event create/update via GraphQL mutations (RecordUiController CRUD rejects Event).
 * ContentDocumentLink creation via RecordUiController.
 * Call/Email logging via GraphQL mutations creating Task records with specific types.
 */

import { Validation, NotFound } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString, extractGraphQLRecord } from '../aura';
import type { AuraContext, GraphQLResponse } from '../aura';
import type {
  LogCallInput,
  LogCallOutput,
  LogEmailInput,
  LogEmailOutput,
  CreateEventInput,
  CreateEventOutput,
  UpdateEventInput,
  UpdateEventOutput,
} from '../schemas';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface SObjectRecord {
  Id: string;
  [key: string]: unknown;
}

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

interface ListResultItem {
  record: SObjectRecord;
  actions?: Array<Record<string, unknown>>;
}

interface ListResult {
  result: ListResultItem[];
  totalCount: number;
}

interface GetRecordResult {
  record: SObjectRecord;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(creds: AuraCredentials): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


// ---------------------------------------------------------------------------
// Events (read-only via Aura)
// ---------------------------------------------------------------------------

/**
 * List events with pagination via Aura list view.
 */
export async function listEvents(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    sortBy?: string;
    filterName?: string;
    searchTerm?: string;
    layoutType?: 'FULL' | 'COMPACT' | 'SEARCH';
    enableRowActions?: boolean;
    useTimeout?: boolean;
  },
): Promise<{
  totalCount: number;
  events: SObjectRecord[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityNameOrId: 'Event',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: args.page ?? 0,
    useTimeout: args.useTimeout ?? false,
    getCount: true,
    enableRowActions: args.enableRowActions ?? false,
  };

  if (args.sortBy != null) {
    params.sortBy = args.sortBy;
  }

  if (args.filterName) {
    params.filterName = args.filterName;
  }

  if (args.searchTerm) {
    params.searchTerm = args.searchTerm;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as ListResult;

  const events = result.result.map((item) => {
    const event: Record<string, unknown> = { ...item.record };
    if (args.enableRowActions && item.actions) {
      event.actions = item.actions.map((a) => ({
        label: a.label as string,
        devNameOrId: a.devNameOrId as string,
        url: a.url as string,
        icon: a.icon as string,
        actionTypeEnum: a.actionTypeEnum as string,
        pageReference: a.pageReference as Record<string, unknown> | undefined,
      }));
    }
    return event as SObjectRecord;
  });

  return {
    totalCount: result.totalCount,
    events,
  };
}

/**
 * Get a single event by ID with all fields via Aura DetailController.
 */
export async function getEvent(
  args: AuraCredentials & {
    eventId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
  },
): Promise<SObjectRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.eventId, 'eventId');

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.eventId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getEvent: record not found for ${args.eventId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// ContentDocumentLink (link notes/files to records)
// ---------------------------------------------------------------------------

/**
 * Link a ContentNote or file to a record (contact, account, opportunity, etc.).
 * Creates a ContentDocumentLink via RecordUiController.
 */
export async function linkNoteToRecord(
  args: AuraCredentials & {
    contentDocumentId: string;
    linkedEntityId: string;
    shareType?: 'V' | 'C' | 'I';
    visibility?: 'AllUsers' | 'InternalUsers' | 'SharedUsers';
    allowSaveOnDuplicate?: boolean;
  },
): Promise<{ id: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.contentDocumentId, 'contentDocumentId');
  validateString(args.linkedEntityId, 'linkedEntityId');

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'ContentDocumentLink',
      fields: {
        ContentDocumentId: args.contentDocumentId,
        LinkedEntityId: args.linkedEntityId,
        ShareType: args.shareType ?? 'V',
        Visibility: args.visibility ?? 'AllUsers',
      },
      ...(args.allowSaveOnDuplicate != null && {
        allowSaveOnDuplicate: args.allowSaveOnDuplicate,
      }),
    },
  });

  const result = raw as RecordUiResult;
  return { id: result.id };
}

// ---------------------------------------------------------------------------
// GraphQL helpers for Activity CRUD
// ---------------------------------------------------------------------------

async function executeGraphQL(
  ctx: AuraContext,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GraphQLResponse> {
  const result = await auraAction(
    ctx,
    'aura://RecordUiController/ACTION$executeGraphQL',
    { queryInput: { query, variables } },
  );
  return result as GraphQLResponse;
}

function escapeGraphQLString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// ---------------------------------------------------------------------------
// Log a Call (creates a completed Task with TaskSubtype='Call')
// ---------------------------------------------------------------------------

export async function logCall(args: LogCallInput): Promise<LogCallOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.subject, 'subject');

  const ctx = buildCtx(args);

  const fieldLines: string[] = [
    `Subject: "${escapeGraphQLString(args.subject)}"`,
    `TaskSubtype: "Call"`,
    `Status: "${args.status ?? 'Completed'}"`,
  ];

  if (args.description)
    fieldLines.push(`Description: "${escapeGraphQLString(args.description)}"`);
  if (args.whoId) fieldLines.push(`WhoId: "${args.whoId}"`);
  if (args.whatId) fieldLines.push(`WhatId: "${args.whatId}"`);
  if (args.activityDate)
    fieldLines.push(`ActivityDate: "${args.activityDate}"`);
  if (args.priority) fieldLines.push(`Priority: "${args.priority}"`);
  if (args.callDurationInSeconds != null)
    fieldLines.push(`CallDurationInSeconds: ${args.callDurationInSeconds}`);
  if (args.callDisposition)
    fieldLines.push(
      `CallDisposition: "${escapeGraphQLString(args.callDisposition)}"`,
    );
  if (args.callType) fieldLines.push(`CallType: "${args.callType}"`);

  const query = `
    mutation LogCall {
      uiapi {
        TaskCreate(input: { Task: { ${fieldLines.join(', ')} } }) {
          Record {
            Id
            Subject { value }
            Status { value }
            Priority { value }
            Description { value }
            WhoId { value }
            WhatId { value }
            ActivityDate { value }
            CallDurationInSeconds { value }
            CallDisposition { value }
            CallType { value }
            TaskSubtype { value }
          }
        }
      }
    }
  `;

  const response = await executeGraphQL(ctx, query);
  const record = extractGraphQLRecord(response, 'TaskCreate');

  return {
    id: record.Id,
    record,
  };
}

// ---------------------------------------------------------------------------
// Log an Email (creates a completed Task with TaskSubtype='Email')
// ---------------------------------------------------------------------------

export async function logEmail(args: LogEmailInput): Promise<LogEmailOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.subject, 'subject');

  const ctx = buildCtx(args);

  const fieldLines: string[] = [
    `Subject: "${escapeGraphQLString(args.subject)}"`,
    `TaskSubtype: "Email"`,
    `Status: "${args.status ?? 'Completed'}"`,
  ];

  if (args.description)
    fieldLines.push(`Description: "${escapeGraphQLString(args.description)}"`);
  if (args.whoId) fieldLines.push(`WhoId: "${args.whoId}"`);
  if (args.whatId) fieldLines.push(`WhatId: "${args.whatId}"`);
  if (args.activityDate)
    fieldLines.push(`ActivityDate: "${args.activityDate}"`);
  if (args.priority) fieldLines.push(`Priority: "${args.priority}"`);

  const query = `
    mutation LogEmail {
      uiapi {
        TaskCreate(input: { Task: { ${fieldLines.join(', ')} } }) {
          Record {
            Id
            Subject { value }
            Status { value }
            Priority { value }
            Description { value }
            WhoId { value }
            WhatId { value }
            ActivityDate { value }
            TaskSubtype { value }
          }
        }
      }
    }
  `;

  const response = await executeGraphQL(ctx, query);
  const record = extractGraphQLRecord(response, 'TaskCreate');

  return {
    id: record.Id,
    record,
  };
}

// ---------------------------------------------------------------------------
// Create Event (calendar event via GraphQL mutation)
// ---------------------------------------------------------------------------

export async function createEvent(
  args: CreateEventInput,
): Promise<CreateEventOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.subject, 'subject');
  validateString(args.startDateTime, 'startDateTime');
  validateString(args.endDateTime, 'endDateTime');

  const ctx = buildCtx(args);

  const fieldLines: string[] = [
    `Subject: "${escapeGraphQLString(args.subject)}"`,
    `StartDateTime: "${args.startDateTime}"`,
    `EndDateTime: "${args.endDateTime}"`,
  ];

  if (args.location)
    fieldLines.push(`Location: "${escapeGraphQLString(args.location)}"`);
  if (args.description)
    fieldLines.push(`Description: "${escapeGraphQLString(args.description)}"`);
  if (args.whoId) fieldLines.push(`WhoId: "${args.whoId}"`);
  if (args.whatId) fieldLines.push(`WhatId: "${args.whatId}"`);
  if (args.ownerId) fieldLines.push(`OwnerId: "${args.ownerId}"`);
  if (args.isAllDayEvent != null)
    fieldLines.push(`IsAllDayEvent: ${args.isAllDayEvent}`);
  if (args.showAs) fieldLines.push(`ShowAs: "${args.showAs}"`);
  if (args.isPrivate != null) fieldLines.push(`IsPrivate: ${args.isPrivate}`);
  if (args.isReminderSet != null)
    fieldLines.push(`IsReminderSet: ${args.isReminderSet}`);
  if (args.reminderDateTime)
    fieldLines.push(`ReminderDateTime: "${args.reminderDateTime}"`);

  // Merge additional fields
  if (args.fields) {
    for (const [key, value] of Object.entries(args.fields)) {
      if (typeof value === 'string') {
        fieldLines.push(`${key}: "${escapeGraphQLString(value)}"`);
      } else if (typeof value === 'boolean' || typeof value === 'number') {
        fieldLines.push(`${key}: ${value}`);
      } else if (value === null) {
        fieldLines.push(`${key}: null`);
      }
    }
  }

  const query = `
    mutation CreateEvent {
      uiapi {
        EventCreate(input: { Event: { ${fieldLines.join(', ')} } }) {
          Record {
            Id
            Subject { value }
            StartDateTime { value }
            EndDateTime { value }
            Location { value }
            Description { value }
            WhoId { value }
            WhatId { value }
            OwnerId { value }
            IsAllDayEvent { value }
            ShowAs { value }
            IsPrivate { value }
          }
        }
      }
    }
  `;

  const response = await executeGraphQL(ctx, query);
  const record = extractGraphQLRecord(response, 'EventCreate');

  return {
    id: record.Id,
    record,
  };
}

// ---------------------------------------------------------------------------
// Update Event (via GraphQL mutation)
// ---------------------------------------------------------------------------

export async function updateEvent(
  args: UpdateEventInput,
): Promise<UpdateEventOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.eventId, 'eventId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const fieldLines: string[] = [];
  for (const [key, value] of Object.entries(args.fields)) {
    if (typeof value === 'string') {
      fieldLines.push(`${key}: "${escapeGraphQLString(value)}"`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      fieldLines.push(`${key}: ${value}`);
    } else if (value === null) {
      fieldLines.push(`${key}: null`);
    }
  }

  const query = `
    mutation UpdateEvent {
      uiapi {
        EventUpdate(input: { Event: { ${fieldLines.join(', ')} }, Id: "${args.eventId}" }) {
          Record {
            Id
            Subject { value }
            StartDateTime { value }
            EndDateTime { value }
            Location { value }
            Description { value }
            WhoId { value }
            WhatId { value }
            OwnerId { value }
            IsAllDayEvent { value }
            ShowAs { value }
            IsPrivate { value }
          }
        }
      }
    }
  `;

  const response = await executeGraphQL(ctx, query);
  const record = extractGraphQLRecord(response, 'EventUpdate');

  return {
    id: record.Id,
    record,
  };
}
