import type {
  ListActionsInput,
  ListActionsOutput,
  GetActionInput,
  GetActionOutput,
  CreateActionInput,
  CreateActionOutput,
  UpdateActionInput,
  UpdateActionOutput,
  DeleteActionInput,
  DeleteActionOutput,
  ListRecordingsInput,
  ListRecordingsOutput,
  GetRecordingInput,
  GetRecordingOutput,
} from './schemas-actions';
import { Validation, NotFound, Unauthenticated, UpstreamError, ContractDrift, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Constants
// ============================================================================

const TRPC_BASE = 'https://gateway.prod.day.ai/trpc';
const GQL_URL = 'https://day.ai/api/graphql';
const SUPABASE_TOKEN_KEY = 'sb-ffdfsbwhgoaivsfgdupn-auth-token';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve accessToken and workspaceId from explicit opts or auto-inject
 * from the Day.ai session (localStorage + URL hash).
 */
async function resolveAuth(
  accessToken?: string,
  workspaceId?: string,
): Promise<{ accessToken: string; workspaceId: string }> {
  if (workspaceId !== undefined && workspaceId.trim() === '') {
    throw new Validation(
      'Day.ai: workspaceId cannot be empty; pass a valid workspace UUID from getContext()',
    );
  }

  if (accessToken && workspaceId) {
    return { accessToken, workspaceId };
  }

  const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
  if (!raw) {
    throw new Unauthenticated(
      'Day.ai: not authenticated. Supabase token not found in localStorage. Navigate to day.ai and log in first.',
    );
  }

  const tokenData = JSON.parse(raw) as { access_token: string };
  if (!tokenData.access_token) {
    throw new Unauthenticated(
      'Day.ai: access_token is empty; user may need to re-authenticate.',
    );
  }

  const resolvedToken = accessToken ?? tokenData.access_token;

  if (workspaceId) {
    return { accessToken: resolvedToken, workspaceId };
  }

  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams: Record<string, string> = {};
  for (const pair of hash.split(',')) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      hashParams[pair.slice(0, colonIdx)] = decodeURIComponent(
        pair.slice(colonIdx + 1),
      );
    }
  }

  const resolvedWorkspaceId = hashParams['workspaceId'];
  if (!resolvedWorkspaceId) {
    throw new Validation(
      `Day.ai: workspaceId not found in URL hash. Navigate to a workspace page first. URL: ${window.location.href}`,
    );
  }

  return { accessToken: resolvedToken, workspaceId: resolvedWorkspaceId };
}

interface TrpcResponse<T> {
  result: { data: T };
}

async function trpcCall<T>(
  accessToken: string,
  procedure: string,
  body: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(`${TRPC_BASE}/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throwForStatus(resp.status, truncated);
  }

  const json = (await resp.json()) as TrpcResponse<T>;
  return json.result.data;
}

async function gqlCall<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'auth-provider': 'supabase',
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await resp.json()) as {
    data?: T;
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new UpstreamError(
      `Day.ai GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`,
    );
  }

  if (!json.data) {
    throw new ContractDrift('Day.ai GraphQL returned no data');
  }

  return json.data;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * List action items in the workspace.
 */
export async function listActions(
  opts: ListActionsInput,
): Promise<ListActionsOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );
  const offset = opts.offset ? opts.offset : '1970-01-01T00:00:00.000Z';
  const limit = opts.limit ? opts.limit : 100;

  const items = await trpcCall<Record<string, unknown>[]>(
    accessToken,
    'tables.getObjects',
    {
      workspaceId,
      objectType: 'native_action',
      offset,
      limit,
    },
  );

  return { actions: items as ListActionsOutput['actions'] };
}

/**
 * Get a single action item by its UUID.
 * Uses object.getObjectRows for direct lookup instead of fetching all actions.
 */
export async function getAction(
  opts: GetActionInput,
): Promise<GetActionOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  if (!opts.actionId || !opts.actionId.trim()) {
    throw new Validation('getAction: actionId is required and cannot be empty.');
  }

  // Check existence first via lightweight metadata endpoint.
  const meta = await trpcCall<
    { label: string; objectId: string; photoUrl: string | null }[]
  >(accessToken, 'object.getObjectMetadata', {
    workspaceId,
    objectType: 'native_action',
    objectIds: [opts.actionId],
  });

  if (meta.length === 0) {
    throw new NotFound(
      `Action not found with id: ${opts.actionId}. The action may not exist in this workspace.`,
    );
  }

  // Fetch property rows for the action
  const body: Record<string, unknown> = {
    workspaceId,
    objectTypeId: 'native_action',
    objectId: opts.actionId,
  };
  if (opts.propertyNames) {
    body.propertyNames = opts.propertyNames;
  }

  const rows = await trpcCall<
    {
      propertyVersionHash: string;
      workspaceId: string;
      objectId: string;
      name: string;
      value: string;
      propertySourceId: string;
      propertyTypeId: string;
      createdAt: number;
      updatedAt: number;
    }[]
  >(accessToken, 'object.getObjectRows', body);

  // Build action object from property rows.
  // getObjectRows returns ALL versions of each property; deduplicate by keeping
  // only the row with the highest updatedAt for each property name.
  const propertyRows = rows.filter((r) => r.propertyTypeId !== 'existsmarker');
  const latestByName = new Map<
    string,
    { value: string; createdAt: number; updatedAt: number }
  >();
  for (const row of propertyRows) {
    const existing = latestByName.get(row.name);
    if (!existing || row.updatedAt > existing.updatedAt) {
      latestByName.set(row.name, {
        value: row.value,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
  }

  const action: Record<string, unknown> = {
    objectId: opts.actionId,
  };
  let earliestCreated = Infinity;
  let latestUpdated = 0;
  for (const [name, prop] of latestByName) {
    action[`_${name}`] = prop.value;
    if (prop.createdAt < earliestCreated) earliestCreated = prop.createdAt;
    if (prop.updatedAt > latestUpdated) latestUpdated = prop.updatedAt;
  }
  action.createdAt =
    earliestCreated === Infinity
      ? new Date().toISOString()
      : new Date(earliestCreated).toISOString();
  action.updatedAt =
    latestUpdated === 0
      ? new Date().toISOString()
      : new Date(latestUpdated).toISOString();

  // Metadata is authoritative for id
  action.id = meta[0].objectId;

  const result: Record<string, unknown> = {
    action: action as GetActionOutput['action'],
  };

  // Optionally fetch structured relationships
  if (opts.includeRelationships) {
    const relData = await trpcCall<{
      relationships: {
        relationship: string;
        targetObjectTypeId: string;
        targetObjectId: string;
      }[];
    }>(accessToken, 'object.getObjectRelationshipsWithProperties', {
      workspaceId,
      objectType: 'native_action',
      objectId: opts.actionId,
    });
    result.relationships = relData.relationships;
  }

  // Optionally fetch activity timeline
  if (opts.includeTimeline) {
    const since =
      opts.timelineSince ||
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const timelineData = await trpcCall<{
      entries: {
        type: string;
        objectType: string;
        objectId: string;
        updatedAt: string;
        userId?: string;
        propertyId?: string;
        propertyName?: string | null;
        value?: string;
        valueLabel?: string;
        label?: string;
        reasoning?: string;
        valueObjectType?: string | null;
        valueObjectId?: string | null;
      }[];
      hasMore: boolean;
    }>(accessToken, 'timeline.getTimeline', {
      workspaceId,
      objectType: 'native_action',
      objectId: opts.actionId,
      since,
    });
    result.timeline = timelineData.entries;
  }

  // Optionally fetch lineage/provenance for property rows
  if (opts.includeLineage) {
    const hashes = rows
      .map((r) => r.propertyVersionHash)
      .filter((h): h is string => Boolean(h));
    if (hashes.length > 0) {
      const lineageData = await trpcCall<
        Record<
          string,
          {
            type: string;
            id: string;
            properties?: {
              userId?: string;
              name?: string;
              version?: number;
              source?: string;
              citations?: unknown[];
            }[];
          }[]
        >
      >(accessToken, 'lineage.getLineage', {
        workspaceId,
        propertyVersionHashes: hashes,
      });
      result.lineage = lineageData;
    } else {
      result.lineage = {};
    }
  }

  return result as GetActionOutput;
}

/**
 * Create a new action item.
 */
export async function createAction(
  opts: CreateActionInput,
): Promise<CreateActionOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  const mutation = `
    mutation CreateAction($input: CreateActionInput!) {
      createActionByUser(input: $input)
    }
  `;

  const input: Record<string, unknown> = {
    workspaceId,
    title: opts.title,
    ownerEmail: opts.ownerEmail,
    ownerId: opts.ownerId,
    type: opts.type ? opts.type : 'FOLLOWUP',
    priority: opts.priority ? opts.priority : 'MEDIUM',
    people: opts.people ? opts.people : [],
    domains: opts.domains ? opts.domains : [],
    opportunityIds: opts.opportunityIds ? opts.opportunityIds : [],
  };

  if (opts.description !== undefined) input.description = opts.description;
  if (opts.dueDate !== undefined) input.timeframeEnd = opts.dueDate;
  if (opts.status !== undefined) input.status = opts.status;
  if (opts.timeframeStart !== undefined)
    input.timeframeStart = opts.timeframeStart;
  if (opts.sourceType !== undefined) input.sourceType = opts.sourceType;
  if (opts.sourceId !== undefined) input.sourceId = opts.sourceId;
  if (opts.sourceLabel !== undefined) input.sourceLabel = opts.sourceLabel;
  if (opts.reasoning !== undefined) input.reasoning = opts.reasoning;
  if (opts.channelType !== undefined) input.channelType = opts.channelType;
  if (opts.channelId !== undefined) input.channelId = opts.channelId;
  if (opts.channelLabel !== undefined) input.channelLabel = opts.channelLabel;
  if (opts.channelAccountId !== undefined)
    input.channelAccountId = opts.channelAccountId;
  if (opts.descriptionPoints !== undefined)
    input.descriptionPoints = opts.descriptionPoints;
  if (opts.id !== undefined) input.id = opts.id;
  if (opts.userId !== undefined) input.userId = opts.userId;
  if (opts.sources !== undefined) input.sources = opts.sources;
  if (opts.draftPrompts !== undefined) input.draftPrompts = opts.draftPrompts;

  await gqlCall<{ createActionByUser: boolean }>(accessToken, mutation, {
    input,
  });

  return { success: true };
}

/**
 * Update an existing action item.
 */
export async function updateAction(
  opts: UpdateActionInput,
): Promise<UpdateActionOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  const mutation = `
    mutation UpdateAction($input: UpdateActionInput!) {
      updateActionByUser(input: $input)
    }
  `;

  const input: Record<string, unknown> = {
    id: opts.actionId,
    workspaceId,
  };

  if (opts.title !== undefined) input.title = opts.title;
  if (opts.status !== undefined) input.status = opts.status;
  if (opts.priority !== undefined) input.priority = opts.priority;
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.dueDate !== undefined) input.timeframeEnd = opts.dueDate;
  if (opts.timeframeStart !== undefined)
    input.timeframeStart = opts.timeframeStart;
  if (opts.people !== undefined) input.people = opts.people;
  if (opts.domains !== undefined) input.domains = opts.domains;
  if (opts.opportunityIds !== undefined)
    input.opportunityIds = opts.opportunityIds;
  if (opts.type !== undefined) input.type = opts.type;
  if (opts.ownerEmail !== undefined) input.ownerEmail = opts.ownerEmail;
  if (opts.userId !== undefined) input.userId = opts.userId;
  if (opts.reasoning !== undefined) input.reasoning = opts.reasoning;
  if (opts.channelType !== undefined) input.channelType = opts.channelType;
  if (opts.channelId !== undefined) input.channelId = opts.channelId;
  if (opts.channelLabel !== undefined) input.channelLabel = opts.channelLabel;
  if (opts.channelAccountId !== undefined)
    input.channelAccountId = opts.channelAccountId;
  if (opts.descriptionPoints !== undefined)
    input.descriptionPoints = opts.descriptionPoints;
  if (opts.statusUpdatedAt !== undefined)
    input.statusUpdatedAt = opts.statusUpdatedAt;
  if (opts.sources !== undefined) input.sources = opts.sources;
  if (opts.draftPrompts !== undefined) input.draftPrompts = opts.draftPrompts;

  await gqlCall<{ updateActionByUser: boolean }>(accessToken, mutation, {
    input,
  });

  return { success: true };
}

/**
 * Dismiss (soft-delete) an action item by calling the deleteAction GraphQL mutation.
 * The action is not destroyed; it is set to DISMISSED with an audit entry in _reasoning.
 */
export async function deleteAction(
  opts: DeleteActionInput,
): Promise<DeleteActionOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  const mutation = `
    mutation DeleteAction($id: String!, $workspaceId: String!) {
      deleteAction(id: $id, workspaceId: $workspaceId)
    }
  `;

  await gqlCall<{ deleteAction: boolean }>(accessToken, mutation, {
    id: opts.actionId,
    workspaceId,
  });

  return { success: true };
}

/**
 * List meeting recordings in the workspace.
 */
export async function listRecordings(
  opts: ListRecordingsInput,
): Promise<ListRecordingsOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );
  const offset = opts.offset ?? '1970-01-01T00:00:00.000Z';
  const limit = opts.limit !== undefined ? opts.limit : 100;

  if (limit < 1 || limit > 10000) {
    throw new Validation(
      `listRecordings: limit must be between 1 and 10000, got ${limit}`,
    );
  }

  const items = await trpcCall<Record<string, unknown>[]>(
    accessToken,
    'tables.getObjects',
    {
      workspaceId,
      objectType: 'native_meetingrecording',
      offset,
      limit,
    },
  );

  return { recordings: items as ListRecordingsOutput['recordings'] };
}

/**
 * Get a single meeting recording by its UUID.
 */
export async function getRecording(
  opts: GetRecordingInput,
): Promise<GetRecordingOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  const items = await trpcCall<Record<string, unknown>[]>(
    accessToken,
    'tables.getObjects',
    {
      workspaceId,
      objectType: 'native_meetingrecording',
      offset: '1970-01-01T00:00:00.000Z',
      limit: 1000,
    },
  );

  const recording = items.find((r) => r.objectId === opts.recordingId);

  if (!recording) {
    throw new NotFound(
      `Recording not found with id: ${opts.recordingId}. Found ${items.length} recordings in workspace.`,
    );
  }

  const result: Record<string, unknown> = {
    recording: recording as GetRecordingOutput['recording'],
  };

  // Optionally fetch structured relationships
  if (opts.includeRelationships) {
    const relData = await trpcCall<{
      relationships: {
        relationship: string;
        targetObjectTypeId: string;
        targetObjectId: string;
      }[];
    }>(accessToken, 'object.getObjectRelationshipsWithProperties', {
      workspaceId,
      objectType: 'native_meetingrecording',
      objectId: opts.recordingId,
    });
    result.relationships = relData.relationships;
  }

  // Optionally fetch activity timeline
  if (opts.includeTimeline) {
    const since =
      opts.timelineSince ||
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const timelineData = await trpcCall<{
      entries: {
        type: string;
        objectType: string;
        objectId: string;
        updatedAt: string;
        userId?: string;
        propertyId?: string;
        propertyName?: string | null;
        value?: string;
        valueLabel?: string;
        label?: string;
        reasoning?: string;
        valueObjectType?: string | null;
        valueObjectId?: string | null;
      }[];
      hasMore: boolean;
    }>(accessToken, 'timeline.getTimeline', {
      workspaceId,
      objectType: 'native_meetingrecording',
      objectId: opts.recordingId,
      since,
    });
    result.timeline = timelineData.entries;
  }

  // Optionally fetch lineage/provenance
  if (opts.includeLineage) {
    const rows = await trpcCall<{ propertyVersionHash: string }[]>(
      accessToken,
      'object.getObjectRows',
      {
        workspaceId,
        objectTypeId: 'native_meetingrecording',
        objectId: opts.recordingId,
      },
    );
    const hashes = rows
      .map((r) => r.propertyVersionHash)
      .filter((h): h is string => Boolean(h));
    if (hashes.length > 0) {
      const lineageData = await trpcCall<
        Record<
          string,
          {
            type: string;
            id: string;
            properties?: {
              userId?: string;
              name?: string;
              version?: number;
              source?: string;
              citations?: unknown[];
            }[];
          }[]
        >
      >(accessToken, 'lineage.getLineage', {
        workspaceId,
        propertyVersionHashes: hashes,
      });
      result.lineage = lineageData;
    } else {
      result.lineage = {};
    }
  }

  // Optionally fetch full notes blob (404 = no notes for this recording)
  if (opts.includeNotes) {
    try {
      const notesResp = await trpcCall<{ blob: string | null }>(
        accessToken,
        'object.getBlob',
        {
          workspaceId,
          propertyName: 'notes',
          objectId: opts.recordingId,
          objectType: 'native_meetingrecording',
        },
      );
      result.notes = notesResp.blob;
    } catch (err) {
      // 404 = recording has no notes blob (e.g., no transcript was captured)
      if (err instanceof Error && err.message.includes('404')) {
        result.notes = null;
      } else {
        throw err;
      }
    }
  }

  // Optionally fetch video asset playback data
  if (opts.includeVideoAsset) {
    const videoAssetId = recording['_videoAsset/id'];
    if (videoAssetId) {
      const videoQuery = `
        query GetVideoAssetForObject($workspaceId: String!, $objectType: String!, $objectId: String!, $videoAssetId: String!) {
          videoAssetForObject(
            workspaceId: $workspaceId
            objectType: $objectType
            objectId: $objectId
            videoAssetId: $videoAssetId
          ) {
            id
            private {
              playbackId
              tokens { video thumbnail storyboard }
              thumbnail { status url }
              download { status urls { default quality url } }
            }
          }
        }
      `;
      const videoData = await gqlCall<{
        videoAssetForObject: Record<string, unknown> | null;
      }>(accessToken, videoQuery, {
        workspaceId,
        objectType: 'native_meetingrecording',
        objectId: opts.recordingId,
        videoAssetId,
      });
      result.videoAsset = videoData.videoAssetForObject;
    } else {
      result.videoAsset = null;
    }
  }

  // Optionally fetch linked calendar event
  if (opts.includeCalendarEvent) {
    const calendarQuery = `
      query GetMeetingRecordingCalendarEvent($workspaceId: String!, $id: String!) {
        workspaceMeetingRecording(workspaceId: $workspaceId, id: $id) {
          id
          calendarEvents {
            GoogleEvent {
              id
              googleId
              start_time
              end_time
              description
              attendees
              title
            }
          }
        }
      }
    `;
    const calData = await gqlCall<{
      workspaceMeetingRecording: {
        id: string;
        calendarEvents: Array<{
          GoogleEvent: {
            id: string;
            googleId: string;
            start_time: string;
            end_time: string;
            description: string | null;
            attendees: string[];
            title: string;
          } | null;
        }> | null;
      } | null;
    }>(accessToken, calendarQuery, {
      workspaceId,
      id: opts.recordingId,
    });
    result.calendarEvents = calData.workspaceMeetingRecording?.calendarEvents;
  }

  return result as GetRecordingOutput;
}
