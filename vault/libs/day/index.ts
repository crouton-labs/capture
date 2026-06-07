export type {
  Contact,
  Organization,
  Stage,
  Opportunity,
  GetContextInput,
  GetContextOutput,
  ListContactsInput,
  ListContactsOutput,
  GetContactInput,
  GetContactOutput,
  ListOpportunitiesInput,
  ListOpportunitiesOutput,
  ListPipelinesInput,
  ListPipelinesOutput,
} from './schemas';

import type {
  GetContextOutput,
  ListContactsInput,
  ListContactsOutput,
  GetContactInput,
  GetContactOutput,
  ListOpportunitiesInput,
  ListOpportunitiesOutput,
  ListPipelinesInput,
  ListPipelinesOutput,
} from './schemas';
import { Validation, NotFound, Unauthenticated, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Constants
// ============================================================================

const TRPC_BASE = 'https://gateway.prod.day.ai/trpc';
const SUPABASE_TOKEN_KEY = 'sb-ffdfsbwhgoaivsfgdupn-auth-token';

// ============================================================================
// Helpers
// ============================================================================

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

function parseHashParams(hash: string): Record<string, string> {
  const params: Record<string, string> = {};
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const pair of cleaned.split(',')) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      const key = pair.slice(0, colonIdx);
      const value = decodeURIComponent(pair.slice(colonIdx + 1));
      params[key] = value;
    }
  }
  return params;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Extract auth token, workspace ID, and user info from the current session.
 */
export async function getContext(): Promise<GetContextOutput> {
  if (!window.location.hostname.includes('day.ai')) {
    throw new Validation(
      `Not on Day.ai domain. Current URL: ${window.location.href}`,
    );
  }

  const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
  if (!raw) {
    throw new Unauthenticated(
      `Supabase auth token not found in localStorage. User may not be logged in. URL: ${window.location.href}`,
    );
  }

  const tokenData = JSON.parse(raw) as {
    access_token: string;
    user: { id: string; email: string };
  };

  if (!tokenData.access_token) {
    throw new Unauthenticated('Access token is empty. User may need to re-authenticate.');
  }

  // Extract workspaceId from URL hash
  const hashParams = parseHashParams(window.location.hash);
  const workspaceId = hashParams['workspaceId'];

  if (!workspaceId) {
    throw new Validation(
      `workspaceId not found in URL hash. Navigate to a workspace page first. URL: ${window.location.href}`,
    );
  }

  return {
    accessToken: tokenData.access_token,
    workspaceId,
    userId: tokenData.user.id,
    email: tokenData.user.email,
  };
}

/**
 * List contacts in the workspace.
 */
export async function listContacts(
  opts: ListContactsInput,
): Promise<ListContactsOutput> {
  const offset = opts.offset ? opts.offset : '1970-01-01T00:00:00.000Z';
  const limit = opts.limit ? opts.limit : 100;

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_contact',
      offset,
      limit,
    },
  );

  return { contacts: items as ListContactsOutput['contacts'] };
}

/**
 * Get a single contact by email address.
 * Uses object.getObjectRows for direct lookup instead of fetching all contacts.
 */
export async function getContact(
  opts: GetContactInput,
): Promise<GetContactOutput> {
  if (!opts.email || !opts.email.trim()) {
    throw new Validation('getContact: email is required and cannot be empty.');
  }

  // Check existence first via lightweight metadata endpoint.
  // This is authoritative: if metadata returns empty, the contact doesn't exist.
  const meta = await trpcCall<
    { label: string; objectId: string; photoUrl: string | null }[]
  >(opts.accessToken, 'object.getObjectMetadata', {
    workspaceId: opts.workspaceId,
    objectType: 'native_contact',
    objectIds: [opts.email],
  });

  if (meta.length === 0) {
    throw new NotFound(
      `Contact not found with email: ${opts.email}. The contact may not exist in this workspace.`,
    );
  }

  // Fetch property rows for the contact
  const body: Record<string, unknown> = {
    workspaceId: opts.workspaceId,
    objectTypeId: 'native_contact',
    objectId: opts.email,
  };
  if (opts.propertyNames) {
    body.propertyNames = opts.propertyNames;
  }

  const rows = await trpcCall<
    {
      workspaceId: string;
      objectId: string;
      name: string;
      value: string;
      propertySourceId: string;
      propertyTypeId: string;
      createdAt: number;
      updatedAt: number;
    }[]
  >(opts.accessToken, 'object.getObjectRows', body);

  // Build contact object from property rows.
  // Filter out internal markers (existsmarker) and deduplicate by preferring
  // rows from the target workspace.
  const propertyRows = rows.filter((r) => r.propertyTypeId !== 'existsmarker');

  // Deduplicate: prefer rows from the target workspace when the same property
  // appears from multiple workspaces.
  const bestRows = new Map<string, (typeof propertyRows)[0]>();
  for (const row of propertyRows) {
    const existing = bestRows.get(row.name);
    if (
      !existing ||
      row.workspaceId === opts.workspaceId ||
      row.updatedAt > existing.updatedAt
    ) {
      bestRows.set(row.name, row);
    }
  }

  const contact: Record<string, unknown> = {
    objectId: opts.email,
  };
  let earliestCreated = Infinity;
  let latestUpdated = 0;
  for (const row of bestRows.values()) {
    const key = `_${row.name}`;
    contact[key] = row.value;
    if (row.createdAt < earliestCreated) earliestCreated = row.createdAt;
    if (row.updatedAt > latestUpdated) latestUpdated = row.updatedAt;
  }
  // If no property rows returned (e.g., all propertyNames were invalid),
  // use current time as fallback for timestamps
  contact.createdAt =
    earliestCreated === Infinity
      ? new Date().toISOString()
      : new Date(earliestCreated).toISOString();
  contact.updatedAt =
    latestUpdated === 0
      ? new Date().toISOString()
      : new Date(latestUpdated).toISOString();

  // Metadata is authoritative for id and photoUrl (overrides row values)
  contact.id = meta[0].objectId;
  contact._photoUrl = meta[0].photoUrl;

  const result: Record<string, unknown> = {
    contact: contact as GetContactOutput['contact'],
  };

  // Optionally fetch structured relationships
  if (opts.includeRelationships) {
    const relData = await trpcCall<{
      relationships: {
        relationship: string;
        targetObjectTypeId: string;
        targetObjectId: string;
      }[];
    }>(opts.accessToken, 'object.getObjectRelationshipsWithProperties', {
      workspaceId: opts.workspaceId,
      objectType: 'native_contact',
      objectId: opts.email,
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
        label?: string;
        userId?: string;
        propertyId?: string;
        propertyName?: string;
        reasoning?: string;
        value?: string;
        valueLabel?: string;
        valueObjectType?: string | null;
        valueObjectId?: string | null;
      }[];
    }>(opts.accessToken, 'timeline.getTimeline', {
      workspaceId: opts.workspaceId,
      objectType: 'native_contact',
      objectId: opts.email,
      since,
    });
    result.timeline = timelineData.entries;
  }

  return result as GetContactOutput;
}

/**
 * List opportunities (deals) in the workspace.
 */
export async function listOpportunities(
  opts: ListOpportunitiesInput,
): Promise<ListOpportunitiesOutput> {
  const offset = opts.offset ? opts.offset : '1970-01-01T00:00:00.000Z';
  const limit = opts.limit ? opts.limit : 100;

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_opportunity',
      offset,
      limit,
    },
  );

  return { opportunities: items as ListOpportunitiesOutput['opportunities'] };
}

/**
 * List all pipeline stages.
 */
export async function listPipelines(
  opts: ListPipelinesInput,
): Promise<ListPipelinesOutput> {
  const offset = opts.offset ? opts.offset : '1970-01-01T00:00:00.000Z';
  const limit = opts.limit !== undefined ? opts.limit : 100;

  if (limit < 1 || limit > 10000) {
    throw new Validation(
      `listPipelines: limit must be between 1 and 10000, got ${limit}`,
    );
  }

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_stage',
      offset,
      limit,
    },
  );

  return { stages: items as ListPipelinesOutput['stages'] };
}

export {
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
  listDrafts,
  getDraft,
  sendEmail,
} from './index-pages';

export {
  listThreads,
  getThread,
  sendChatMessage,
  searchWorkspace,
  getWorkspace,
  listWorkspaceMembers,
  listAssistants,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from './index-workspace';

export {
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
  getPipeline,
  createPipeline,
  updatePipeline,
} from './index-deals';

export {
  listActions,
  getAction,
  createAction,
  updateAction,
  deleteAction,
  listRecordings,
  getRecording,
} from './index-actions';

export {
  listOrganizations,
  getOrganization,
  searchContacts,
  searchOrganizations,
  createContact,
  updateContact,
  createOrganization,
  updateOrganization,
} from './index-contacts-orgs';
