/**
 * Notion Library - Browser-executable Notion operations via internal API
 *
 * This library uses Notion's internal /api/v3 API which authenticates via
 * HttpOnly cookies (sent automatically). No token extraction needed.
 */

import type {
  AddDatabasePropertyInput,
  AddDatabaseRowInput,
  AddImageBlockInput,
  AppendBlocksInput,
  ArchivePageInput,
  CopyBlocksInput,
  CreateDatabaseInput,
  CreatePageInput,
  DeleteBlockInput,
  GetDatabaseSchemaInput,
  GetPageAsTextInput,
  GetPageLinkInput,
  GetPagePermissionsInput,
  GetSubscriptionInput,
  GetWorkspaceDetailsInput,
  ListBlocksInput,
  ListRecentPagesInput,
  ListTeamspacesInput,
  MoveBlockInput,
  NotionContext,
  PublishToWebInput,
  QueryDatabaseInput,
  QuickSearchInput,
  RemoveDatabasePropertyInput,
  ReplaceSectionInput,
  RestorePageInput,
  SharePageInput,
  UpdateDatabaseRowInput,
  UpdatePageInput,
  UpdatePagePermissionInput,
} from './schemas';

import { Validation, ContractDrift, NotFound, Unauthenticated, throwForStatus } from '@vallum/_runtime';

// Re-export schemas for documentation
export * from './schemas';

// ============================================================================
// Internal API Types
// ============================================================================

interface InternalSearchResult {
  results: Array<{
    id: string;
    isNavigable: boolean;
    score: number;
    highlight?: {
      text: string;
      pathText: string;
    };
    highlightBlockId?: string;
  }>;
  recordMap: {
    block: Record<string, { value: InternalBlock }>;
  };
  total: number;
}

interface InternalBlock {
  id: string;
  type: string;
  properties?: {
    title?: Array<[string, Array<[string, string]>?]>;
    [key: string]: unknown;
  };
  content?: string[];
  parent_id?: string;
  parent_table?: string;
  space_id?: string;
  created_time?: number;
  last_edited_time?: number;
  created_by_id?: string;
  last_edited_by_id?: string;
  alive?: boolean;
  collection_id?: string;
  view_ids?: string[];
  format?: Record<string, unknown>;
}

interface InternalPageChunk {
  recordMap: {
    block: Record<string, { value: InternalBlock }>;
    collection?: Record<string, { value: InternalCollection }>;
    collection_view?: Record<string, { value: InternalCollectionView }>;
  };
  cursor?: { stack: unknown[] };
}

interface InternalCollection {
  id: string;
  name?: Array<[string, Array<[string, string]>?]>;
  schema: Record<string, InternalPropertySchema>;
}

interface InternalCollectionView {
  id: string;
  type: string;
}

interface InternalPropertySchema {
  name: string;
  type: string;
  options?: Array<{ id: string; value: string; color: string }>;
}

interface SpaceRecord {
  id: string;
  name: string;
  icon?: string;
  plan_type?: string;
  subscription_tier?: string;
  created_time?: number;
  invite_link_enabled?: boolean;
  disable_guests?: boolean;
  disable_export?: boolean;
  disable_public_access?: boolean;
  settings?: {
    enable_ai_feature?: boolean;
    is_teams_enabled?: boolean;
  };
}

interface SpaceUserRecord {
  membership_type?: string;
  user_id?: string;
  space_id?: string;
}

interface TeamRecord {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  space_id: string;
  team_pages?: string[];
  parent_id: string;
  parent_table: string;
  is_default?: boolean;
  settings?: {
    visibility?: string;
  };
}

interface SpacesInitialResponse {
  users: Record<
    string,
    {
      user_root: Record<
        string,
        {
          value: {
            space_view_pointers: Array<{
              id: string;
              spaceId: string;
            }>;
          };
        }
      >;
      space_view: Record<
        string,
        { value: { space_id: string; private_pages?: string[] } }
      >;
      space: Record<string, { value: SpaceRecord }>;
      space_user: Record<string, { value: SpaceUserRecord }>;
      team?: Record<string, { value: TeamRecord }>;
    }
  >;
}

// ============================================================================
// Workspace Management
// ============================================================================

/**
 * List all Notion workspaces accessible to the current user.
 */
export async function listWorkspaces(_params: { timeoutMs?: number }): Promise<{
  workspaces: Array<{ id: string; name: string }>;
}> {
  // Verify we're on a Notion page
  if (
    !window.location.hostname.includes('notion.so') &&
    !window.location.hostname.includes('notion.site') &&
    !window.location.hostname.includes('notion.com')
  ) {
    throw new Validation(
      `Not on a Notion page. Navigate to https://www.notion.so first. Current: ${window.location.href}`,
    );
  }

  // Extract userId from notion_user_id cookie
  const cookies = document.cookie.split(';').map((c) => c.trim());
  let userId: string | undefined;

  for (const cookie of cookies) {
    if (cookie.startsWith('notion_user_id=')) {
      userId = cookie.substring('notion_user_id='.length);
      break;
    }
  }

  if (!userId) {
    throw new Unauthenticated(
      'Could not extract user ID from cookies. Ensure you are logged in.',
    );
  }

  // Get spaces from getSpacesInitial API
  const spacesResponse = await fetch('/api/v3/getSpacesInitial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (!spacesResponse.ok) {
    const body = await spacesResponse.text().catch(() => undefined);
    throwForStatus(spacesResponse.status, body);
  }

  const spacesData = (await spacesResponse.json()) as SpacesInitialResponse;
  const userRoot = spacesData.users?.[userId]?.user_root?.[userId]?.value;
  const spacePointers = userRoot?.space_view_pointers ?? [];
  const userSpaces = spacesData.users?.[userId]?.space ?? {};

  // Build initial workspace list from space records
  const workspaces: Array<{ id: string; name: string }> = [];
  const missingNameIds: string[] = [];

  for (const pointer of spacePointers) {
    const spaceId = pointer.spaceId;
    const spaceData = userSpaces[spaceId]?.value;
    if (spaceData?.name) {
      workspaces.push({ id: spaceId, name: spaceData.name });
    } else {
      missingNameIds.push(spaceId);
      workspaces.push({ id: spaceId, name: spaceId }); // placeholder
    }
  }

  // Fetch names for guest workspaces via getPublicSpaceData
  if (missingNameIds.length > 0) {
    const nameResults = await Promise.all(
      missingNameIds.map(async (spaceId) => {
        try {
          const resp = await fetch('/api/v3/getPublicSpaceData', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-notion-space-id': spaceId,
            },
            body: JSON.stringify({ type: 'space-ids', spaceIds: [spaceId] }),
          });
          if (!resp.ok) return { id: spaceId, name: spaceId };
          const data = (await resp.json()) as {
            results?: Array<{ id: string; name: string }>;
          };
          return {
            id: spaceId,
            name: data.results?.[0]?.name || spaceId,
          };
        } catch {
          return { id: spaceId, name: spaceId };
        }
      }),
    );

    // Replace placeholders with resolved names
    const nameMap = new Map(nameResults.map((r) => [r.id, r.name]));
    for (const ws of workspaces) {
      const resolved = nameMap.get(ws.id);
      if (resolved && resolved !== ws.id) {
        ws.name = resolved;
      }
    }
  }

  return { workspaces };
}

/**
 * List all teamspaces in a workspace, including the Private section.
 */
export async function listTeamspaces(params: ListTeamspacesInput): Promise<{
  teamspaces: Array<{
    id: string;
    name: string;
    description: string;
    icon: string | null;
    is_default: boolean;
    page_count: number;
    is_private_section: boolean;
  }>;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });

  const spacesResponse = await fetch('/api/v3/getSpacesInitial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (!spacesResponse.ok) {
    const body = await spacesResponse.text().catch(() => undefined);
    throwForStatus(spacesResponse.status, body);
  }

  const spacesData = (await spacesResponse.json()) as SpacesInitialResponse;
  const userData = spacesData.users?.[ctx.userId];

  if (!userData) {
    throw new ContractDrift(`User data not found for userId: ${ctx.userId}`);
  }

  const teamspaces: Array<{
    id: string;
    name: string;
    description: string;
    icon: string | null;
    is_default: boolean;
    page_count: number;
    is_private_section: boolean;
  }> = [];

  // Add teamspaces from team records
  const teamRecords = userData.team ?? {};
  for (const teamEntry of Object.values(teamRecords)) {
    const team = teamEntry.value;
    // Filter to teams belonging to the current space
    if (team.space_id !== ctx.spaceId) continue;
    teamspaces.push({
      id: team.id,
      name: team.name,
      description: team.description ?? '',
      icon: team.icon ?? null,
      is_default: team.is_default ?? false,
      page_count: team.team_pages?.length ?? 0,
      is_private_section: false,
    });
  }

  // Add the Private section from space_view
  const spaceViewEntries = Object.values(userData.space_view ?? {});
  const spaceView = spaceViewEntries.find(
    (sv) => sv.value.space_id === ctx.spaceId,
  );
  if (spaceView) {
    teamspaces.push({
      id: 'private',
      name: 'Private',
      description: 'Your private pages visible only to you',
      icon: null,
      is_default: false,
      page_count: spaceView.value.private_pages?.length ?? 0,
      is_private_section: true,
    });
  }

  return { teamspaces };
}

// ============================================================================
// ID Normalization
// ============================================================================

/**
 * Normalize ID format (add dashes if needed)
 */
function normalizeId(id: string): string {
  if (id.length === 32 && !id.includes('-')) {
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  }
  return id;
}

// ============================================================================
// Context Extraction
// ============================================================================

/**
 * Extract Notion context from current browser session.
 * Gets userId from cookies and spaceId from API.
 */
export async function getContext(params: {
  timeoutMs?: number;
  workspaceName?: string;
}): Promise<NotionContext> {
  // Verify we're on a Notion page
  if (
    !window.location.hostname.includes('notion.so') &&
    !window.location.hostname.includes('notion.site') &&
    !window.location.hostname.includes('notion.com')
  ) {
    throw new Validation(
      `Not on a Notion page. Navigate to https://www.notion.so first. Current: ${window.location.href}`,
    );
  }

  // Extract userId from notion_user_id cookie
  const cookies = document.cookie.split(';').map((c) => c.trim());
  let userId: string | undefined;

  for (const cookie of cookies) {
    if (cookie.startsWith('notion_user_id=')) {
      userId = cookie.substring('notion_user_id='.length);
      break;
    }
  }

  if (!userId) {
    throw new Unauthenticated(
      'Could not extract user ID from cookies. Ensure you are logged in.',
    );
  }

  // Get spaceId from getSpacesInitial API
  const spacesResponse = await fetch('/api/v3/getSpacesInitial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (!spacesResponse.ok) {
    const body = await spacesResponse.text().catch(() => undefined);
    throwForStatus(spacesResponse.status, body);
  }

  const spacesData = (await spacesResponse.json()) as SpacesInitialResponse;
  const userRoot = spacesData.users?.[userId]?.user_root?.[userId]?.value;
  const spacePointers = userRoot?.space_view_pointers ?? [];

  if (spacePointers.length === 0) {
    throw new ContractDrift(
      'Could not determine workspace. Navigate to a workspace page.',
    );
  }

  // If workspaceName is provided, resolve all names and find match
  if (params.workspaceName) {
    const { workspaces } = await listWorkspaces({});
    const workspaceNameLower = params.workspaceName.toLowerCase();

    const matched = workspaces.find((ws) =>
      ws.name.toLowerCase().includes(workspaceNameLower),
    );

    if (!matched) {
      const names = workspaces.map((ws) => ws.name);
      throw new NotFound(
        `Workspace "${params.workspaceName}" not found. Available workspaces: ${names.join(', ')}`,
      );
    }

    return {
      userId,
      spaceId: matched.id,
    };
  }

  // Try to detect active workspace from current page URL
  const urlMatch = window.location.pathname.match(/([a-f0-9]{32})(?:[?#]|$)/);
  if (urlMatch) {
    const currentPageId = normalizeId(urlMatch[1]);
    try {
      const pageSync = await notionV3<{
        recordMap: {
          block: Record<string, { value: { space_id?: string } }>;
        };
      }>(
        'syncRecordValuesMain',
        {
          requests: [
            { pointer: { id: currentPageId, table: 'block' }, version: -1 },
          ],
        },
        spacePointers[0].spaceId,
        userId,
      );
      const pageBlock = Object.values(pageSync.recordMap.block ?? {})[0]?.value;
      if (pageBlock?.space_id) {
        return { userId, spaceId: pageBlock.space_id };
      }
    } catch {
      // Fall through to default
    }
  }

  // Default to first workspace
  return {
    userId,
    spaceId: spacePointers[0].spaceId,
  };
}

// ============================================================================
// Workspace Details & Subscription
// ============================================================================

/**
 * Get detailed information about a workspace including plan, features, and settings.
 */
export async function getWorkspaceDetails(
  params: GetWorkspaceDetailsInput,
): Promise<{
  id: string;
  name: string;
  icon: string | null;
  plan_type: string;
  subscription_tier: string;
  created_time: string;
  invite_link_enabled: boolean;
  disable_guests: boolean;
  disable_export: boolean;
  disable_public_access: boolean;
  ai_enabled: boolean;
  teams_enabled: boolean;
  membership_type: string;
}> {
  const ctx = await getContext({
    workspaceName: params.workspaceName,
    timeoutMs: params.timeoutMs,
  });

  // Fetch space record via syncRecordValuesMain
  // (getSpacesInitial only includes the active workspace's space record)
  const spaceResult = await notionV3<{
    recordMap: {
      space?: Record<string, { value: SpaceRecord }>;
    };
  }>(
    'syncRecordValuesMain',
    {
      requests: [{ pointer: { id: ctx.spaceId, table: 'space' }, version: -1 }],
    },
    ctx.spaceId,
    ctx.userId,
  );

  const spaceRecord = spaceResult.recordMap.space?.[ctx.spaceId]?.value;
  if (!spaceRecord) {
    throw new ContractDrift(`Space data not found for spaceId: ${ctx.spaceId}`);
  }

  // Fetch space_user record (requires spaceId in pointer)
  const spaceUserCompositeId = `${ctx.userId}|${ctx.spaceId}`;
  let membershipType = 'none';
  try {
    const suResult = await notionV3<{
      recordMap: {
        space_user?: Record<string, { value: SpaceUserRecord }>;
      };
    }>(
      'syncRecordValuesMain',
      {
        requests: [
          {
            pointer: {
              id: spaceUserCompositeId,
              table: 'space_user',
              spaceId: ctx.spaceId,
            },
            version: -1,
          },
        ],
      },
      ctx.spaceId,
      ctx.userId,
    );
    const suRecord =
      suResult.recordMap.space_user?.[spaceUserCompositeId]?.value;
    if (suRecord?.membership_type) {
      membershipType = suRecord.membership_type;
    }
  } catch {
    // Guest workspaces may not expose space_user data
  }

  return {
    id: ctx.spaceId,
    name: spaceRecord.name,
    icon: spaceRecord.icon ?? null,
    plan_type: spaceRecord.plan_type!,
    subscription_tier: spaceRecord.subscription_tier!,
    created_time: new Date(spaceRecord.created_time!).toISOString(),
    invite_link_enabled: spaceRecord.invite_link_enabled ?? false,
    disable_guests: spaceRecord.disable_guests ?? false,
    disable_export: spaceRecord.disable_export ?? false,
    disable_public_access: spaceRecord.disable_public_access ?? false,
    ai_enabled: spaceRecord.settings?.enable_ai_feature ?? false,
    teams_enabled: spaceRecord.settings?.is_teams_enabled ?? false,
    membership_type: membershipType,
  };
}

/**
 * Get subscription and billing information for a workspace.
 */
export async function getSubscription(params: GetSubscriptionInput): Promise<{
  type: string;
  subscription_tier: string;
  is_subscribed: boolean;
  has_paid: boolean;
  plan: string | null;
  account_balance: number;
  add_ons: string[];
}> {
  const ctx = await getContext({
    workspaceName: params.workspaceName,
    timeoutMs: params.timeoutMs,
  });

  const response = await fetch('/api/v3/getSubscriptionData', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-notion-space-id': ctx.spaceId,
    },
    body: JSON.stringify({ spaceId: ctx.spaceId }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  const data = (await response.json()) as {
    type?: string;
    subscriptionTier?: string;
    hasPaidNonzero?: boolean;
    customerData?: {
      isSubscribed?: boolean;
      stripe?: {
        plan?: string;
        accountBalance?: number;
      };
    };
    addOns?: Array<string | { id?: string }>;
  };

  if (!data.type) {
    throw new ContractDrift(
      'getSubscriptionData response missing required field: type',
    );
  }
  if (!data.subscriptionTier) {
    throw new ContractDrift(
      'getSubscriptionData response missing required field: subscriptionTier',
    );
  }

  const addOns = (data.addOns ?? []).map((addon) => {
    if (typeof addon === 'string') return addon;
    if (addon.id) return addon.id;
    throw new ContractDrift(`Unexpected add-on shape: ${JSON.stringify(addon)}`);
  });

  return {
    type: data.type,
    subscription_tier: data.subscriptionTier,
    is_subscribed: data.customerData?.isSubscribed ?? false,
    has_paid: data.hasPaidNonzero ?? false,
    plan: data.customerData?.stripe?.plan ?? null,
    account_balance: data.customerData?.stripe?.accountBalance ?? 0,
    add_ons: addOns,
  };
}

// ============================================================================
// Internal API Helpers
// ============================================================================

async function notionV3<T>(
  endpoint: string,
  body: Record<string, unknown>,
  spaceId?: string,
  userId?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (spaceId) {
    headers['x-notion-space-id'] = spaceId;
  }
  if (userId) {
    headers['x-notion-active-user-header'] = userId;
  }

  const response = await fetch(`/api/v3/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  return response.json() as Promise<T>;
}

/**
 * Extract plain text from internal rich text format
 */
function extractInternalText(
  props: Array<[string, Array<[string, string]>?]> | undefined,
): string {
  if (!props) return '';
  return props.map((p) => p[0]).join('');
}

/**
 * Extract title from internal block
 */
function extractBlockTitle(block: InternalBlock): string {
  return extractInternalText(block.properties?.title) || 'Untitled';
}

// ============================================================================
// Convenience Functions (Read-Optimized)
// ============================================================================

/**
 * List recently edited pages in the workspace.
 * Great for browsing/exploring what's in the workspace.
 */
export async function listRecentPages(params: ListRecentPagesInput): Promise<{
  pages: Array<{
    id: string;
    title: string;
    url: string;
    last_edited: string;
  }>;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const limit = params.limit ?? 20;

  const fetchLimit = Math.min(limit * 2, 100);

  // Use search with empty query; API only supports relevance sort,
  // so we sort client-side by last_edited_time
  const result = await notionV3<InternalSearchResult>(
    'search',
    {
      type: 'BlocksInSpace',
      query: '',
      limit: fetchLimit,
      source: 'quick_find',
      spaceId: ctx.spaceId,
      filters: {
        isDeletedOnly: false,
        excludeTemplates: false,
        navigableBlockContentOnly: true,
        requireEditPermissions: false,
        includePublicPagesWithoutExplicitAccess: false,
        ancestors: [],
        createdBy: [],
        editedBy: [],
        lastEditedTime: {},
        createdTime: {},
        inTeams: [],
        excludeSurrogateCollections: false,
        excludedParentCollectionIds: [],
      },
      sort: { field: 'relevance' },
      peopleBlocksToInclude: 'all',
      ignoresHighlight: false,
    },
    ctx.spaceId,
    ctx.userId,
  );

  const pages = result.results
    .map((r) => {
      const block = result.recordMap.block[r.id]?.value;
      if (!block) return null;

      return {
        id: block.id,
        title: extractBlockTitle(block),
        url: `https://www.notion.so/${block.id.replace(/-/g, '')}`,
        last_edited: block.last_edited_time
          ? new Date(block.last_edited_time).toISOString()
          : '',
        type: block.type === 'collection_view_page' ? 'database' : 'page',
        _ts: block.last_edited_time ?? 0,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b._ts - a._ts)
    .slice(0, limit)
    .map(({ _ts, ...rest }) => rest);

  return { pages };
}

/**
 * Get full page content as plain text.
 * Recursively fetches all blocks and flattens to readable text.
 */
export async function getPageAsText(params: GetPageAsTextInput): Promise<{
  title: string;
  url: string;
  content: string;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const maxDepth = params.max_depth ?? 3;

  const pageId = normalizeId(params.page_id);

  // Fetch fresh page block via syncRecordValuesMain to get up-to-date content array
  const freshPageSync = await notionV3<{
    recordMap: { block: Record<string, { value: InternalBlock }> };
  }>(
    'syncRecordValuesMain',
    {
      requests: [{ pointer: { id: pageId, table: 'block' }, version: -1 }],
    },
    ctx.spaceId,
    ctx.userId,
  );

  const freshPageBlock = freshPageSync.recordMap.block[pageId]?.value;
  if (!freshPageBlock) {
    throw new NotFound(`Page not found: ${pageId}`);
  }

  // Load full chunk for descendant blocks (loadCachedPageChunkV2 fetches all nested blocks)
  const chunk = await notionV3<InternalPageChunk>(
    'loadCachedPageChunkV2',
    {
      page: { id: pageId },
      cursor: { stack: [] },
      verticalColumns: false,
    },
    ctx.spaceId,
    ctx.userId,
  );

  const blocks = chunk.recordMap.block;
  // Overlay fresh page block onto the chunk to ensure top-level content array is current
  blocks[pageId] = { value: freshPageBlock };
  const pageBlock = freshPageBlock;

  const title = extractBlockTitle(pageBlock);

  // Recursively extract text from blocks
  async function extractText(
    blockId: string,
    depth: number,
    indent: string,
  ): Promise<string> {
    if (depth > maxDepth) return '';

    const block = blocks[blockId]?.value;
    if (!block || !block.alive) return '';

    const lines: string[] = [];
    const text = extractInternalText(block.properties?.title);

    // Format based on block type
    switch (block.type) {
      // --- Tier 1: Text-renderable blocks ---
      case 'header':
        if (text) lines.push(`\n# ${text}`);
        break;
      case 'sub_header':
        if (text) lines.push(`\n## ${text}`);
        break;
      case 'sub_sub_header':
        if (text) lines.push(`\n### ${text}`);
        break;
      case 'bulleted_list':
        if (text) lines.push(`${indent}- ${text}`);
        break;
      case 'numbered_list':
        if (text) lines.push(`${indent}1. ${text}`);
        break;
      case 'to_do': {
        const checked = block.properties?.checked?.[0]?.[0] === 'Yes';
        if (text) lines.push(`${indent}${checked ? '[x]' : '[ ]'} ${text}`);
        break;
      }
      case 'toggle':
        if (text) lines.push(`${indent}▸ ${text}`);
        break;
      case 'quote':
        if (text) lines.push(`${indent}> ${text}`);
        break;
      case 'callout':
        if (text) lines.push(`${indent}📌 ${text}`);
        break;
      case 'code': {
        const language = block.properties?.language?.[0]?.[0] ?? '';
        if (text) lines.push(`\n\`\`\`${language}\n${text}\n\`\`\``);
        break;
      }
      case 'divider':
        lines.push('\n---');
        break;
      case 'text':
        if (text) lines.push(`${indent}${text}`);
        break;
      case 'page':
        if (depth > 0 && text) {
          lines.push(`${indent}📄 [${text}]`);
        }
        break;

      // --- Tier 1: Layout containers (just recurse into children) ---
      case 'column_list':
      case 'column':
        break;

      // --- Tier 3: Inline databases (one lightweight fetch per DB) ---
      case 'collection_view':
      case 'collection_view_page': {
        const collectionId = block.collection_id;
        if (collectionId) {
          const collection = chunk.recordMap.collection?.[collectionId]?.value;
          const dbName = collection
            ? extractInternalText(collection.name) || 'Untitled'
            : 'Untitled';
          const columns = collection
            ? Object.values(collection.schema)
                .map((s) => s.name)
                .join(', ')
            : '';

          // Lightweight query for row count + sample row titles
          let rowInfo = '';
          try {
            const viewId = block.view_ids?.[0];
            if (viewId) {
              const qResult = await notionV3<{
                result: {
                  reducerResults: {
                    collection_group_results: {
                      blockIds: string[];
                    };
                    aggregation_results?: {
                      aggregationResult?: { value: number };
                    };
                  };
                };
                recordMap: {
                  block: Record<
                    string,
                    { value: { role: string; value: InternalBlock } }
                  >;
                };
              }>(
                'queryCollection',
                {
                  collection: { id: collectionId },
                  collectionView: { id: viewId },
                  loader: {
                    type: 'reducer',
                    reducers: {
                      collection_group_results: {
                        type: 'results',
                        limit: 5,
                        loadContentCover: false,
                      },
                      aggregation_results: {
                        type: 'aggregation',
                        aggregation: {
                          property: 'title',
                          aggregator: 'count',
                        },
                      },
                    },
                    searchQuery: '',
                    userTimeZone: 'America/New_York',
                  },
                },
                ctx.spaceId,
                ctx.userId,
              );

              const groupResults =
                qResult.result.reducerResults.collection_group_results;
              const total =
                qResult.result.reducerResults.aggregation_results
                  ?.aggregationResult?.value ?? groupResults.blockIds.length;
              const sampleTitles = groupResults.blockIds
                .map((id) => {
                  const rowBlock = qResult.recordMap.block[id]?.value?.value;
                  return rowBlock ? extractBlockTitle(rowBlock) : 'Untitled';
                })
                .filter((t) => t !== 'Untitled');

              rowInfo = ` | ${total} rows`;
              if (sampleTitles.length > 0) {
                rowInfo += `\n${indent}  Sample: ${sampleTitles.map((t) => `"${t}"`).join(', ')}`;
              }
            }
          } catch {
            // If query fails, just show schema info without row data
          }

          lines.push(`\n${indent}[Database: "${dbName}"${rowInfo}]`);
          if (columns) {
            lines.push(`${indent}  Columns: ${columns}`);
          }
        }
        break;
      }

      // --- Tier 2: Generic, extract whatever metadata exists ---
      default: {
        // Try to get useful info from block properties/format
        const source =
          (block.properties?.source as Array<[string]>)?.[0]?.[0] ??
          (block.format?.display_source as string) ??
          (block.format?.bookmark_link as string) ??
          '';
        const caption = extractInternalText(
          block.properties?.caption as
            | Array<[string, Array<[string, string]>?]>
            | undefined,
        );

        if (text) {
          // Block has title text; label with type so context isn't lost
          lines.push(`${indent}[${block.type}: ${text}]`);
        } else if (source || caption) {
          // Block has a URL or caption, show it
          const parts = [block.type];
          if (caption) parts.push(caption);
          if (source) parts.push(source);
          lines.push(`${indent}[${parts.join(': ')}]`);
        } else {
          // Truly unknown; still surface it, never silently skip
          lines.push(`${indent}[${block.type}]`);
        }
      }
    }

    // Process children
    if (block.content) {
      for (const childId of block.content) {
        const childText = await extractText(childId, depth + 1, indent + '  ');
        if (childText) lines.push(childText);
      }
    }

    return lines.join('\n');
  }

  // Extract content from page's children
  let content = '';
  if (pageBlock.content) {
    for (const childId of pageBlock.content) {
      const text = await extractText(childId, 0, '');
      if (text) content += text + '\n';
    }
  }

  return {
    title,
    url: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
    content: content.trim(),
  };
}

/**
 * Search pages by title and return results with content previews.
 * Combines search with first-paragraph extraction for quick overview.
 */
export async function quickSearch(params: QuickSearchInput): Promise<{
  results: Array<{
    id: string;
    title: string;
    url: string;
    preview: string;
    last_edited: string;
  }>;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const limit = params.limit ?? 10;

  const result = await notionV3<InternalSearchResult>(
    'search',
    {
      type: 'BlocksInSpace',
      query: params.query,
      limit,
      source: 'quick_find',
      spaceId: ctx.spaceId,
      filters: {
        isDeletedOnly: false,
        excludeTemplates: false,
        navigableBlockContentOnly: false,
        requireEditPermissions: false,
        includePublicPagesWithoutExplicitAccess: false,
        ancestors: [],
        createdBy: [],
        editedBy: [],
        lastEditedTime: {},
        createdTime: {},
        inTeams: [],
        excludeSurrogateCollections: false,
        excludedParentCollectionIds: [],
      },
      sort: { field: 'relevance' },
      peopleBlocksToInclude: 'all',
      ignoresHighlight: false,
    },
    ctx.spaceId,
    ctx.userId,
  );

  const results = result.results
    .map((r) => {
      const block = result.recordMap.block[r.id]?.value;
      if (!block) return null;

      // Use highlight text as preview if available, stripping Notion's
      // internal search highlighting tags (e.g. <gzkNfoUU>matched</gzkNfoUU>)
      const rawPreview = r.highlight?.text ?? r.highlight?.pathText ?? '';
      const preview = rawPreview.replace(/<\/?[a-zA-Z0-9]+>/g, '');

      return {
        id: block.id,
        title: extractBlockTitle(block),
        url: `https://www.notion.so/${block.id.replace(/-/g, '')}`,
        preview: preview.slice(0, 200),
        last_edited: block.last_edited_time
          ? new Date(block.last_edited_time).toISOString()
          : '',
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .slice(0, limit);

  return { results };
}

// ============================================================================
// Internal Write Helpers
// ============================================================================

/**
 * Submit a transaction to Notion's internal API
 */
async function submitTransaction(
  operations: Array<{
    id: string;
    table: string;
    path: string[];
    command: string;
    args: unknown;
  }>,
  spaceId?: string,
  userId?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (spaceId) {
    headers['x-notion-space-id'] = spaceId;
  }
  if (userId) {
    headers['x-notion-active-user-header'] = userId;
  }

  const response = await fetch('/api/v3/submitTransaction', {
    method: 'POST',
    headers,
    body: JSON.stringify({ operations }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }
}

/**
 * Load collection metadata from a database ID.
 * Uses syncRecordValuesMain for fresh schema data (loadCachedPageChunkV2 can be stale).
 */
async function loadCollectionInfo(
  databaseId: string,
  spaceId?: string,
  userId?: string,
): Promise<{
  collectionId: string;
  viewId: string;
  schema: Record<string, InternalPropertySchema>;
  name: string;
} | null> {
  const pageId = normalizeId(databaseId);

  // Fetch fresh block data via syncRecordValuesMain (loadCachedPageChunkV2
  // returns stale data with null collection_id for Notion app pages)
  const blockSync = await notionV3<{
    recordMap: {
      block?: Record<
        string,
        {
          value: InternalBlock & {
            format?: { app_uri_map?: Record<string, string> };
          };
        }
      >;
    };
  }>(
    'syncRecordValuesMain',
    {
      requests: [{ pointer: { id: pageId, table: 'block' }, version: -1 }],
    },
    spaceId,
    userId,
  );

  const pageBlock = blockSync.recordMap.block?.[pageId]?.value;

  if (
    !pageBlock ||
    (pageBlock.type !== 'collection_view_page' &&
      pageBlock.type !== 'collection_view')
  ) {
    throw new Validation(`Not a database page: ${pageId}`);
  }

  const viewId = pageBlock.view_ids?.[0];
  if (!viewId) {
    throw new ContractDrift(`Database ${pageId} is missing view IDs`);
  }

  // collection_id may be null for Notion app pages (e.g., built-in Meetings);
  // these store the collection ID in format.app_uri_map under a *_collection key
  let collectionId = pageBlock.collection_id;
  if (!collectionId) {
    const appUriMap = pageBlock.format?.app_uri_map;
    const collectionEntry =
      appUriMap &&
      Object.entries(appUriMap).find(([key]) => key.endsWith('_collection'));
    collectionId = collectionEntry?.[1];
  }

  if (!collectionId) {
    return null;
  }

  // Fetch fresh collection record for schema
  const syncResult = await notionV3<{
    recordMap: {
      collection?: Record<string, { value: InternalCollection }>;
    };
  }>(
    'syncRecordValuesMain',
    {
      requests: [
        { pointer: { id: collectionId, table: 'collection' }, version: -1 },
      ],
    },
    spaceId,
    userId,
  );

  const collection = syncResult.recordMap.collection?.[collectionId]?.value;

  return {
    collectionId,
    viewId,
    schema: collection?.schema || {},
    name: extractInternalText(collection?.name) || 'Untitled',
  };
}

/**
 * Resolve property name to property ID from schema
 */
function resolvePropertyId(
  schema: Record<string, { name: string; type: string }>,
  propertyName: string,
): string | undefined {
  // title is always 'title'
  const nameLower = propertyName.toLowerCase();
  if (nameLower === 'name' || nameLower === 'title') {
    return 'title';
  }

  for (const [id, prop] of Object.entries(schema)) {
    if (prop.name === propertyName) return id;
  }

  return undefined;
}

/**
 * Convert simple string values to internal property format.
 * Checkbox properties use "Yes"/"No" internally.
 */
function toInternalPropertyValue(
  value: unknown,
  propType?: string,
): Array<[string]> {
  if (propType === 'checkbox') {
    return [[value === true || value === 'Yes' ? 'Yes' : 'No']];
  }
  return [[String(value)]];
}

/**
 * Extract plain text from internal property format
 */
function fromInternalPropertyValue(
  value: Array<[string, Array<[string, string]>?]> | undefined,
): string {
  if (!value) return '';
  return value.map((v) => v[0]).join('');
}

/**
 * Generate a random 4-character property ID
 */
function generatePropertyId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Map user-facing filter operator to Notion's internal filter format.
 * Notion uses type-prefixed operators (string_is, enum_is, date_is_before, etc.)
 */
function buildNotionFilter(
  operator: string,
  value: string | undefined,
  propType: string,
): Record<string, unknown> {
  // is_empty / is_not_empty don't need a value
  if (operator === 'is_empty') {
    return { operator: 'is_empty' };
  }
  if (operator === 'is_not_empty') {
    return { operator: 'is_not_empty' };
  }

  const v = { type: 'exact' as const, value: value ?? '' };

  // Select / multi_select / status use enum_ operators
  if (
    propType === 'select' ||
    propType === 'multi_select' ||
    propType === 'status'
  ) {
    const opMap: Record<string, string> = {
      equals: 'enum_is',
      not_equals: 'enum_is_not',
      contains: 'enum_contains',
      not_contains: 'enum_does_not_contain',
    };
    const mapped = opMap[operator];
    if (!mapped) {
      throw new Validation(
        `Operator "${operator}" not supported for ${propType}. Use: ${Object.keys(opMap).join(', ')}`,
      );
    }
    return { operator: mapped, value: v };
  }

  // Date properties
  if (propType === 'date') {
    const opMap: Record<string, string> = {
      equals: 'date_is',
      before: 'date_is_before',
      after: 'date_is_after',
    };
    const mapped = opMap[operator];
    if (!mapped) {
      throw new Validation(
        `Operator "${operator}" not supported for date. Use: ${Object.keys(opMap).join(', ')}`,
      );
    }
    return {
      operator: mapped,
      value: { type: 'exact', value: { type: 'date', start_date: value } },
    };
  }

  // Number properties
  if (propType === 'number') {
    const opMap: Record<string, string> = {
      equals: 'number_equals',
      not_equals: 'number_does_not_equal',
      greater_than: 'number_greater_than',
      less_than: 'number_less_than',
    };
    const mapped = opMap[operator];
    if (!mapped) {
      throw new Validation(
        `Operator "${operator}" not supported for number. Use: ${Object.keys(opMap).join(', ')}`,
      );
    }
    return { operator: mapped, value: v };
  }

  // Checkbox
  if (propType === 'checkbox') {
    return {
      operator: 'checkbox_is',
      value: { type: 'exact', value: value === 'true' ? 'Yes' : 'No' },
    };
  }

  // Default: text-based operators (text, title, url, email, phone_number)
  const opMap: Record<string, string> = {
    equals: 'string_is',
    not_equals: 'string_is_not',
    contains: 'string_contains',
    not_contains: 'string_does_not_contain',
    starts_with: 'string_starts_with',
    ends_with: 'string_ends_with',
  };
  const mapped = opMap[operator];
  if (!mapped) {
    throw new Validation(
      `Operator "${operator}" not supported for text. Use: ${Object.keys(opMap).join(', ')}`,
    );
  }
  return { operator: mapped, value: v };
}

// ============================================================================
// Write Functions (Mutations)
// ============================================================================

/**
 * Create a new page under a parent page or at the root of a teamspace/private section
 */
export async function createPage(
  params: CreatePageInput,
): Promise<{ id: string; url: string }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = crypto.randomUUID();

  if (params.teamspace !== undefined) {
    // Teamspace / private section mode
    const { teamspaces } = await listTeamspaces({
      workspaceName: params.workspaceName,
    });

    const teamspaceLower = params.teamspace.toLowerCase();
    const target = teamspaces.find(
      (ts) => ts.name.toLowerCase() === teamspaceLower,
    );

    if (!target) {
      const names = teamspaces.map((ts) => ts.name);
      throw new NotFound(
        `Teamspace "${params.teamspace}" not found. Available: ${names.join(', ')}`,
      );
    }

    if (target.is_private_section) {
      // Private section: parent is the space itself
      const operations: Array<{
        id: string;
        table: string;
        path: string[];
        command: string;
        args: unknown;
      }> = [
        {
          id: pageId,
          table: 'block',
          path: [],
          command: 'set',
          args: {
            type: 'page',
            id: pageId,
            parent_id: ctx.spaceId,
            parent_table: 'space',
            alive: true,
            created_time: Date.now(),
            created_by_id: ctx.userId,
            last_edited_time: Date.now(),
            last_edited_by_id: ctx.userId,
            space_id: ctx.spaceId,
            permissions: [
              {
                role: 'editor',
                type: 'user_permission',
                user_id: ctx.userId,
              },
            ],
            properties: {
              title: [[params.title]],
            },
            ...(params.icon ? { format: { page_icon: params.icon } } : {}),
          },
        },
      ];

      // Find the space_view id for this space to add to private_pages
      const spacesResponse = await fetch('/api/v3/getSpacesInitial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!spacesResponse.ok) {
        const body = await spacesResponse.text().catch(() => undefined);
        throwForStatus(spacesResponse.status, body);
      }
      const spacesData = (await spacesResponse.json()) as SpacesInitialResponse;
      const userData = spacesData.users?.[ctx.userId];
      if (!userData) {
        throw new ContractDrift(`User data not found for userId: ${ctx.userId}`);
      }
      const spaceViewEntry = Object.entries(userData.space_view ?? {}).find(
        ([, sv]) => sv.value.space_id === ctx.spaceId,
      );
      if (spaceViewEntry) {
        const spaceViewId = spaceViewEntry[0];
        operations.push({
          id: spaceViewId,
          table: 'space_view',
          path: ['private_pages'],
          command: 'listAfter',
          args: { id: pageId },
        });
      }

      await submitTransaction(operations, ctx.spaceId, ctx.userId);
    } else {
      // Named teamspace: parent is the team record
      const operations = [
        {
          id: pageId,
          table: 'block',
          path: [],
          command: 'set',
          args: {
            type: 'page',
            id: pageId,
            parent_id: target.id,
            parent_table: 'team',
            alive: true,
            created_time: Date.now(),
            created_by_id: ctx.userId,
            last_edited_time: Date.now(),
            last_edited_by_id: ctx.userId,
            space_id: ctx.spaceId,
            properties: {
              title: [[params.title]],
            },
            ...(params.icon ? { format: { page_icon: params.icon } } : {}),
          },
        },
        // Add to team's page list
        {
          id: target.id,
          table: 'team',
          path: ['team_pages'],
          command: 'listAfter',
          args: { id: pageId },
        },
      ];

      await submitTransaction(operations, ctx.spaceId, ctx.userId);
    }
  } else {
    // Parent page mode (original behavior)
    if (!params.parent_id) {
      throw new Validation('Either parent_id or teamspace must be provided');
    }
    const parentId = normalizeId(params.parent_id);

    const operations = [
      {
        id: pageId,
        table: 'block',
        path: [],
        command: 'set',
        args: {
          type: 'page',
          id: pageId,
          parent_id: parentId,
          parent_table: 'block',
          alive: true,
          created_time: Date.now(),
          created_by_id: ctx.userId,
          last_edited_time: Date.now(),
          last_edited_by_id: ctx.userId,
          space_id: ctx.spaceId,
          properties: {
            title: [[params.title]],
          },
          ...(params.icon ? { format: { page_icon: params.icon } } : {}),
        },
      },
      {
        id: parentId,
        table: 'block',
        path: ['content'],
        command: 'listAfter',
        args: { id: pageId },
      },
    ];

    await submitTransaction(operations, ctx.spaceId, ctx.userId);
  }

  return {
    id: pageId,
    url: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
  };
}

/**
 * Update page title and/or icon
 */
export async function updatePage(
  params: UpdatePageInput,
): Promise<{ success: boolean }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);

  const operations: Array<{
    id: string;
    table: string;
    path: string[];
    command: string;
    args: unknown;
  }> = [];

  if (params.title !== undefined) {
    operations.push({
      id: pageId,
      table: 'block',
      path: ['properties', 'title'],
      command: 'set',
      args: [[params.title]],
    });
  }

  if (params.icon !== undefined) {
    operations.push({
      id: pageId,
      table: 'block',
      path: ['format', 'page_icon'],
      command: 'set',
      args: params.icon,
    });
  }

  if (operations.length > 0) {
    await submitTransaction(operations, ctx.spaceId, ctx.userId);
  }

  return { success: true };
}

/**
 * Archive (soft-delete) a page
 */
export async function archivePage(
  params: ArchivePageInput,
): Promise<{ success: boolean }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);

  await submitTransaction(
    [
      {
        id: pageId,
        table: 'block',
        path: [],
        command: 'update',
        args: { alive: false },
      },
    ],
    ctx.spaceId,
    ctx.userId,
  );

  return { success: true };
}

/**
 * Restore an archived page from trash
 */
export async function restorePage(
  params: RestorePageInput,
): Promise<{ success: boolean }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);

  await submitTransaction(
    [
      {
        id: pageId,
        table: 'block',
        path: [],
        command: 'update',
        args: { alive: true },
      },
    ],
    ctx.spaceId,
    ctx.userId,
  );

  return { success: true };
}

/**
 * Create a new database with columns
 */
export async function createDatabase(params: CreateDatabaseInput): Promise<{
  id: string;
  collection_id: string;
  view_id: string;
  url: string;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const parentId = normalizeId(params.parent_id);
  const pageId = crypto.randomUUID();
  const collectionId = crypto.randomUUID();
  const viewId = crypto.randomUUID();

  // Build schema, ensuring there's a title property
  const schema: Record<string, unknown> = {};
  let hasTitle = false;

  for (const [name, config] of Object.entries(params.properties)) {
    const nameLower = name.toLowerCase();
    if (nameLower === 'name' || nameLower === 'title') {
      schema.title = { name, type: 'title' };
      hasTitle = true;
    } else {
      const propId = generatePropertyId();
      const propSchema: {
        name: string;
        type: string;
        options?: Array<{ id: string; value: string; color: string }>;
        groups?: Array<{
          id: string;
          name: string;
          color: string;
          optionIds: string[];
        }>;
      } = {
        name,
        type: config.type,
      };

      if (config.options) {
        propSchema.options = config.options.map((opt) => {
          if (!opt.color) {
            throw new Validation(
              `Color is required for select option "${opt.value}". Valid colors: default, gray, brown, orange, yellow, green, blue, purple, pink, red`,
            );
          }
          return {
            id: crypto.randomUUID(),
            value: opt.value,
            color: opt.color,
          };
        });
      }

      if (config.type === 'status') {
        const optionIds = propSchema.options?.map((o) => o.id) || [];
        propSchema.groups = config.groups?.map((g) => ({
          id: crypto.randomUUID(),
          name: g.name,
          color: g.color,
          optionIds: [] as string[],
        })) || [
          {
            id: crypto.randomUUID(),
            name: 'To-do',
            color: 'default',
            optionIds: optionIds.slice(0, 1),
          },
          {
            id: crypto.randomUUID(),
            name: 'In progress',
            color: 'blue',
            optionIds: optionIds.slice(1, 2),
          },
          {
            id: crypto.randomUUID(),
            name: 'Complete',
            color: 'green',
            optionIds: optionIds.slice(2, 3),
          },
        ];
      }

      schema[propId] = propSchema;
    }
  }

  // Auto-add title property if missing
  if (!hasTitle) {
    schema.title = { name: 'Name', type: 'title' };
  }

  const operations = [
    // Create collection_view_page
    {
      id: pageId,
      table: 'block',
      path: [],
      command: 'set',
      args: {
        type: params.inline ? 'collection_view' : 'collection_view_page',
        id: pageId,
        collection_id: collectionId,
        view_ids: [viewId],
        parent_id: parentId,
        parent_table: 'block',
        alive: true,
        created_time: Date.now(),
        created_by_id: ctx.userId,
        last_edited_time: Date.now(),
        last_edited_by_id: ctx.userId,
        space_id: ctx.spaceId,
      },
    },
    // Create collection
    {
      id: collectionId,
      table: 'collection',
      path: [],
      command: 'set',
      args: {
        id: collectionId,
        name: [[params.title]],
        schema,
        parent_id: pageId,
        parent_table: 'block',
        alive: true,
        space_id: ctx.spaceId,
      },
    },
    // Create collection_view
    {
      id: viewId,
      table: 'collection_view',
      path: [],
      command: 'set',
      args: {
        id: viewId,
        type: 'table',
        name: 'Default View',
        format: { table_properties: [] },
        parent_id: pageId,
        parent_table: 'block',
        alive: true,
        space_id: ctx.spaceId,
      },
    },
    // Add to parent's content
    {
      id: parentId,
      table: 'block',
      path: ['content'],
      command: 'listAfter',
      args: { id: pageId },
    },
  ];

  await submitTransaction(operations, ctx.spaceId, ctx.userId);

  return {
    id: pageId,
    collection_id: collectionId,
    view_id: viewId,
    url: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
  };
}

/**
 * Query a database to list its rows
 */
export async function queryDatabase(params: QueryDatabaseInput): Promise<{
  rows: Array<{
    id: string;
    properties: Record<string, string>;
    url: string;
  }>;
  schema: Record<string, { type: string }>;
  total: number;
  error?: string;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const info = await loadCollectionInfo(
    params.database_id,
    ctx.spaceId,
    ctx.userId,
  );

  if (info === null) {
    return {
      rows: [],
      schema: {},
      total: 0,
      error: `Database ${params.database_id} is a template or built-in database that does not expose a queryable collection. Open it in Notion and use a regular database instead.`,
    };
  }

  const limit = params.limit ?? 50;

  // Build name→propertyId map for filter/sort
  const nameToId = new Map<string, string>();
  const nameToType = new Map<string, string>();
  for (const [propId, propSchema] of Object.entries(info.schema)) {
    nameToId.set(propSchema.name.toLowerCase(), propId);
    nameToType.set(propSchema.name.toLowerCase(), propSchema.type);
  }

  // Build internal filter2 from user-facing filter
  let filter2: Record<string, unknown> | undefined;
  if (params.filter?.conditions?.length) {
    const filters = params.filter.conditions.map((cond) => {
      const propId = nameToId.get(cond.property.toLowerCase());
      if (!propId) {
        throw new Validation(
          `Unknown property "${cond.property}". Available: ${[...nameToId.keys()].join(', ')}`,
        );
      }
      const propType = nameToType.get(cond.property.toLowerCase())!;
      return {
        property: propId,
        filter: buildNotionFilter(cond.operator, cond.value, propType),
      };
    });
    filter2 = {
      operator: params.filter.operator || 'and',
      filters,
    };
  }

  // Apply sort by updating the view's query2.sort before querying
  if (params.sort?.length) {
    const sortSpec = params.sort.map((s) => {
      const propId = nameToId.get(s.property.toLowerCase());
      if (!propId) {
        throw new Validation(
          `Unknown sort property "${s.property}". Available: ${[...nameToId.keys()].join(', ')}`,
        );
      }
      return { property: propId, direction: s.direction };
    });
    await submitTransaction(
      [
        {
          id: info.viewId,
          table: 'collection_view',
          path: ['query2'],
          command: 'update',
          args: { sort: sortSpec },
        },
      ],
      ctx.spaceId,
      ctx.userId,
    );
  }

  // queryCollection wraps blocks as { spaceId, value: { role, value: InternalBlock } }
  const result = await notionV3<{
    result: {
      reducerResults: {
        collection_group_results: {
          blockIds: string[];
          total: number;
        };
        collection_group_count: {
          aggregationResult: { value: number };
        };
      };
    };
    recordMap: {
      block: Record<string, { value: { role: string; value: InternalBlock } }>;
    };
  }>(
    'queryCollection',
    {
      collection: { id: info.collectionId },
      collectionView: { id: info.viewId },
      loader: {
        type: 'reducer',
        reducers: {
          collection_group_results: {
            type: 'results',
            limit,
            loadContentCover: false,
          },
          collection_group_count: {
            type: 'aggregation',
            aggregation: {
              aggregator: 'count',
            },
          },
        },
        ...(filter2 ? { filter: filter2 } : {}),
        searchQuery: '',
        userTimeZone: 'America/New_York',
      },
    },
    ctx.spaceId,
    ctx.userId,
  );

  const groupResults = result.result.reducerResults.collection_group_results;
  const blockIds = groupResults.blockIds || [];
  const totalCount =
    result.result.reducerResults.collection_group_count?.aggregationResult
      ?.value ??
    groupResults.total ??
    blockIds.length;

  const rows = blockIds.map((blockId) => {
    const block = result.recordMap.block[blockId]?.value?.value;
    if (!block) {
      return {
        id: blockId,
        properties: {},
        url: `https://www.notion.so/${blockId.replace(/-/g, '')}`,
      };
    }

    const properties: Record<string, string> = {};
    for (const [propId, propSchema] of Object.entries(info.schema)) {
      const value = block.properties?.[propId] as
        | Array<[string, Array<[string, string]>?]>
        | undefined;
      properties[propSchema.name] = fromInternalPropertyValue(value);
    }

    return {
      id: block.id,
      properties,
      url: `https://www.notion.so/${block.id.replace(/-/g, '')}`,
    };
  });

  // Client-side sort (Notion stores sorts on the view, not in query params)
  if (params.sort?.length) {
    // Build option-order maps for select/multi_select properties
    const optionOrderMaps = new Map<string, Map<string, number>>();
    for (const [, propSchema] of Object.entries(info.schema)) {
      if (
        (propSchema.type === 'select' ||
          propSchema.type === 'multi_select' ||
          propSchema.type === 'status') &&
        propSchema.options?.length
      ) {
        const orderMap = new Map<string, number>();
        propSchema.options.forEach((opt, idx) => orderMap.set(opt.value, idx));
        optionOrderMaps.set(propSchema.name, orderMap);
      }
    }

    rows.sort((a, b) => {
      for (const s of params.sort!) {
        const aVal = a.properties[s.property] ?? '';
        const bVal = b.properties[s.property] ?? '';
        const orderMap = optionOrderMaps.get(s.property);
        let cmp: number;
        if (orderMap) {
          // Sort by option order for select properties
          const aIdx = orderMap.get(aVal) ?? orderMap.size;
          const bIdx = orderMap.get(bVal) ?? orderMap.size;
          cmp = aIdx - bIdx;
        } else {
          cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
        }
        if (cmp !== 0) return s.direction === 'ascending' ? cmp : -cmp;
      }
      return 0;
    });
  }

  return {
    rows,
    schema: Object.fromEntries(
      Object.entries(info.schema).map(([, prop]) => [
        prop.name,
        { type: prop.type },
      ]),
    ),
    total: totalCount,
  };
}

/**
 * Add a row to a database
 */
export async function addDatabaseRow(
  params: AddDatabaseRowInput,
): Promise<{ id: string; url: string }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const info = await loadCollectionInfo(
    params.database_id,
    ctx.spaceId,
    ctx.userId,
  );
  if (info === null) {
    throw new Validation(
      `Database ${params.database_id} is a template and does not support row creation`,
    );
  }

  const rowId = crypto.randomUUID();

  // Convert user properties to internal format
  const internalProps: Record<string, Array<[string]>> = {};
  for (const [name, value] of Object.entries(params.properties)) {
    const propId = resolvePropertyId(info.schema, name);
    if (propId) {
      const propType = info.schema[propId]?.type;
      internalProps[propId] = toInternalPropertyValue(value, propType);
    }
  }

  await submitTransaction(
    [
      {
        id: rowId,
        table: 'block',
        path: [],
        command: 'set',
        args: {
          type: 'page',
          id: rowId,
          parent_id: info.collectionId,
          parent_table: 'collection',
          alive: true,
          created_time: Date.now(),
          created_by_id: ctx.userId,
          last_edited_time: Date.now(),
          last_edited_by_id: ctx.userId,
          space_id: ctx.spaceId,
          properties: internalProps,
        },
      },
    ],
    ctx.spaceId,
    ctx.userId,
  );

  return {
    id: rowId,
    url: `https://www.notion.so/${rowId.replace(/-/g, '')}`,
  };
}

/**
 * Update properties of an existing database row
 */
export async function updateDatabaseRow(
  params: UpdateDatabaseRowInput,
): Promise<{ success: boolean }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const info = await loadCollectionInfo(
    params.database_id,
    ctx.spaceId,
    ctx.userId,
  );
  if (info === null) {
    throw new Validation(
      `Database ${params.database_id} is a template and does not support row updates`,
    );
  }
  const rowId = normalizeId(params.row_id);

  const operations: Array<{
    id: string;
    table: string;
    path: string[];
    command: string;
    args: unknown;
  }> = [];

  for (const [name, value] of Object.entries(params.properties)) {
    const propId = resolvePropertyId(info.schema, name);
    if (propId) {
      const propType = info.schema[propId]?.type;
      operations.push({
        id: rowId,
        table: 'block',
        path: ['properties', propId],
        command: 'set',
        args: toInternalPropertyValue(value, propType),
      });
    }
  }

  if (operations.length > 0) {
    await submitTransaction(operations, ctx.spaceId, ctx.userId);
  }

  return { success: true };
}

/**
 * Add a new column/property to a database
 */
export async function addDatabaseProperty(
  params: AddDatabasePropertyInput,
): Promise<{ success: boolean; property_id: string }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const info = await loadCollectionInfo(
    params.database_id,
    ctx.spaceId,
    ctx.userId,
  );
  if (info === null) {
    throw new Validation(
      `Database ${params.database_id} is a template and does not support property addition`,
    );
  }

  const propId = generatePropertyId();
  const propSchema: {
    name: string;
    type: string;
    options?: Array<{ id: string; value: string; color: string }>;
    groups?: Array<{
      id: string;
      name: string;
      color: string;
      optionIds: string[];
    }>;
  } = {
    name: params.name,
    type: params.type,
  };

  if (params.options) {
    propSchema.options = params.options.map((opt) => {
      if (!opt.color) {
        throw new Validation(
          `Color is required for select option "${opt.value}". Valid colors: default, gray, brown, orange, yellow, green, blue, purple, pink, red`,
        );
      }
      return {
        id: crypto.randomUUID(),
        value: opt.value,
        color: opt.color,
      };
    });
  }

  if (params.type === 'status') {
    const optionIds = propSchema.options?.map((o) => o.id) || [];
    propSchema.groups = params.groups?.map((g) => ({
      id: crypto.randomUUID(),
      name: g.name,
      color: g.color,
      optionIds: [] as string[],
    })) || [
      {
        id: crypto.randomUUID(),
        name: 'To-do',
        color: 'default',
        optionIds: optionIds.slice(0, 1),
      },
      {
        id: crypto.randomUUID(),
        name: 'In progress',
        color: 'blue',
        optionIds: optionIds.slice(1, 2),
      },
      {
        id: crypto.randomUUID(),
        name: 'Complete',
        color: 'green',
        optionIds: optionIds.slice(2, 3),
      },
    ];
  }

  await submitTransaction(
    [
      {
        id: info.collectionId,
        table: 'collection',
        path: ['schema', propId],
        command: 'set',
        args: propSchema,
      },
    ],
    ctx.spaceId,
    ctx.userId,
  );

  return { success: true, property_id: propId };
}

/**
 * Remove a column from a database
 */
export async function removeDatabaseProperty(
  params: RemoveDatabasePropertyInput,
): Promise<{ success: boolean }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const info = await loadCollectionInfo(
    params.database_id,
    ctx.spaceId,
    ctx.userId,
  );
  if (info === null) {
    throw new Validation(
      `Database ${params.database_id} is a template and does not support property removal`,
    );
  }

  const propId = resolvePropertyId(info.schema, params.property_name);
  if (!propId) {
    throw new NotFound(`Property "${params.property_name}" not found in database`);
  }

  if (propId === 'title') {
    throw new Validation('Cannot remove the title property');
  }

  // Notion requires two operations for property deletion:
  // 1. Remove from schema (set property key to undefined via JSON trick)
  // 2. Move to deleted_schema (for undo/recovery)
  const pointer = {
    table: 'collection' as const,
    id: info.collectionId,
    spaceId: ctx.spaceId,
  };

  const propertySchema = info.schema[propId];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (ctx.spaceId) headers['x-notion-space-id'] = ctx.spaceId;
  if (ctx.userId) headers['x-notion-active-user-header'] = ctx.userId;

  // Build the body manually to control JSON serialization:
  // The schema removal needs the property key present but with null value
  // (Notion's update command interprets null as "remove this key")
  const body = JSON.stringify({
    requestId: crypto.randomUUID(),
    transactions: [
      {
        id: crypto.randomUUID(),
        spaceId: ctx.spaceId,
        operations: [
          {
            pointer,
            command: 'update',
            path: ['schema'],
            args: { [propId]: null },
          },
          {
            pointer,
            command: 'update',
            path: ['deleted_schema'],
            args: { [propId]: propertySchema },
          },
        ],
      },
    ],
  });

  const response = await fetch('/api/v3/saveTransactions', {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  return { success: true };
}

// User-facing → internal block type mapping (single source of truth)
const userToInternalType: Record<string, string> = {
  text: 'text',
  paragraph: 'text',
  heading_1: 'header',
  heading_2: 'sub_header',
  heading_3: 'sub_sub_header',
  bulleted_list: 'bulleted_list',
  bulleted_list_item: 'bulleted_list',
  numbered_list: 'numbered_list',
  numbered_list_item: 'numbered_list',
  to_do: 'to_do',
  toggle: 'toggle',
  quote: 'quote',
  callout: 'callout',
  code: 'code',
  divider: 'divider',
};

// Derived reverse mapping
const internalToUserType: Record<string, string> = Object.fromEntries(
  Object.entries(userToInternalType).map(([user, internal]) => [
    internal,
    user,
  ]),
);

type BlockEntry = {
  id: string;
  type: string;
  content: string;
  has_children: boolean;
  children?: BlockEntry[];
};

/**
 * List all content blocks on a page
 */
export async function listBlocks(
  params: ListBlocksInput,
): Promise<{ blocks: BlockEntry[] }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);
  const recursive = params.recursive ?? false;
  const maxDepth = params.max_depth ?? 3;

  async function fetchBlockChildren(
    parentId: string,
    depth: number,
  ): Promise<BlockEntry[]> {
    // Fetch the parent block to get fresh content array
    const pageSync = await notionV3<{
      recordMap: { block: Record<string, { value: InternalBlock }> };
    }>(
      'syncRecordValuesMain',
      {
        requests: [{ pointer: { id: parentId, table: 'block' }, version: -1 }],
      },
      ctx.spaceId,
      ctx.userId,
    );

    const parentBlock = pageSync.recordMap.block[parentId]?.value;
    if (!parentBlock) throw new NotFound(`Page not found: ${parentId}`);

    const childIds = parentBlock.content || [];
    if (childIds.length === 0) return [];

    // Batch-fetch all child blocks
    const childSync = await notionV3<{
      recordMap: { block: Record<string, { value: InternalBlock }> };
    }>(
      'syncRecordValuesMain',
      {
        requests: childIds.map((id) => ({
          pointer: { id, table: 'block' as const },
          version: -1,
        })),
      },
      ctx.spaceId,
      ctx.userId,
    );

    const allBlocks = childSync.recordMap.block;
    const result: BlockEntry[] = [];

    for (const childId of childIds) {
      const block = allBlocks[childId]?.value;
      if (!block || !block.alive) continue;

      const userType = internalToUserType[block.type] || block.type;
      let content = extractInternalText(block.properties?.title) || '';

      // Enrich content for block types that don't use properties.title
      if (!content) {
        switch (block.type) {
          case 'collection_view':
          case 'collection_view_page': {
            content = 'Untitled database';
            if (block.collection_id) {
              try {
                const collSync = await notionV3<{
                  recordMap: {
                    collection: Record<string, { value: InternalCollection }>;
                  };
                }>(
                  'syncRecordValuesMain',
                  {
                    requests: [
                      {
                        pointer: {
                          id: block.collection_id,
                          table: 'collection' as const,
                        },
                        version: -1,
                      },
                    ],
                  },
                  ctx.spaceId,
                  ctx.userId,
                );
                const coll = Object.values(
                  collSync.recordMap.collection ?? {},
                )[0]?.value;
                if (coll) {
                  content =
                    extractInternalText(coll.name) || 'Untitled database';
                }
              } catch {
                // Keep default
              }
            }
            break;
          }
          case 'image':
          case 'video':
          case 'embed':
          case 'bookmark': {
            content =
              (block.properties?.source as Array<[string]>)?.[0]?.[0] ??
              (block.format?.display_source as string) ??
              (block.format?.bookmark_link as string) ??
              '';
            break;
          }
        }
      }

      const hasChildren = (block.content?.length ?? 0) > 0;
      const entry: BlockEntry = {
        id: childId,
        type: userType,
        content,
        has_children: hasChildren,
      };

      if (recursive && hasChildren && depth < maxDepth) {
        entry.children = await fetchBlockChildren(childId, depth + 1);
      }

      result.push(entry);
    }

    return result;
  }

  const blocks = await fetchBlockChildren(pageId, 1);
  return { blocks };
}

/**
 * Append content blocks to a page
 */
export async function appendBlocks(
  params: AppendBlocksInput,
): Promise<{ block_ids: string[] }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);

  const blockIds: string[] = [];
  const operations: Array<{
    id: string;
    table: string;
    path: string[];
    command: string;
    args: unknown;
  }> = [];

  let afterId = params.after_block_id
    ? normalizeId(params.after_block_id)
    : undefined;

  for (const block of params.blocks) {
    const blockId = crypto.randomUUID();
    blockIds.push(blockId);

    const internalType = userToInternalType[block.type];
    if (!internalType) {
      throw new Validation(`Unknown block type: ${block.type}`);
    }
    const blockArgs: Record<string, unknown> = {
      type: internalType,
      id: blockId,
      parent_id: pageId,
      parent_table: 'block',
      alive: true,
      created_time: Date.now(),
      created_by_id: ctx.userId,
      last_edited_time: Date.now(),
      last_edited_by_id: ctx.userId,
      space_id: ctx.spaceId,
    };

    if (internalType !== 'divider' && block.content) {
      blockArgs.properties = { title: [[block.content]] };
    }

    if (internalType === 'to_do' && block.checked !== undefined) {
      blockArgs.properties = {
        ...(blockArgs.properties as Record<string, unknown>),
        checked: [[block.checked ? 'Yes' : 'No']],
      };
    }

    if (internalType === 'code' && block.language) {
      blockArgs.properties = {
        ...(blockArgs.properties as Record<string, unknown>),
        language: [[block.language]],
      };
    }

    if (internalType === 'callout') {
      blockArgs.format = {
        page_icon: block.emoji || '💡',
        block_color: 'gray_background',
      };
    }

    operations.push({
      id: blockId,
      table: 'block',
      path: [],
      command: 'set',
      args: blockArgs,
    });

    operations.push({
      id: pageId,
      table: 'block',
      path: ['content'],
      command: 'listAfter',
      args: {
        id: blockId,
        ...(afterId ? { after: afterId } : {}),
      },
    });

    afterId = blockId;
  }

  await submitTransaction(operations, ctx.spaceId, ctx.userId);

  return { block_ids: blockIds };
}

/**
 * Delete a block from a page
 */
export async function deleteBlock(
  params: DeleteBlockInput,
): Promise<{ success: boolean }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const blockId = normalizeId(params.block_id);

  // Fetch block to get parent_id
  const blockData = await notionV3<{
    recordMap: {
      block: Record<
        string,
        { value: { parent_id: string; parent_table: string } }
      >;
    };
  }>(
    'syncRecordValuesMain',
    {
      requests: [{ pointer: { id: blockId, table: 'block' }, version: -1 }],
    },
    ctx.spaceId,
    ctx.userId,
  );

  const block = Object.values(blockData.recordMap?.block ?? {})[0]?.value;
  if (!block?.parent_id) {
    throw new NotFound(`Block not found: ${blockId}`);
  }

  await submitTransaction(
    [
      {
        id: blockId,
        table: 'block',
        path: [],
        command: 'update',
        args: { alive: false },
      },
      {
        id: block.parent_id,
        table: block.parent_table,
        path: ['content'],
        command: 'listRemove',
        args: { id: blockId },
      },
    ],
    ctx.spaceId,
    ctx.userId,
  );

  return { success: true };
}

/**
 * Move a block to a different parent page or position within the same page
 */
export async function moveBlock(
  params: MoveBlockInput,
): Promise<{ success: boolean }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const blockId = normalizeId(params.block_id);
  const targetParentId = normalizeId(params.target_parent_id);

  // Fetch block to get current parent
  const blockData = await notionV3<{
    recordMap: {
      block: Record<
        string,
        { value: { parent_id: string; parent_table: string } }
      >;
    };
  }>(
    'syncRecordValuesMain',
    {
      requests: [{ pointer: { id: blockId, table: 'block' }, version: -1 }],
    },
    ctx.spaceId,
    ctx.userId,
  );

  const block = Object.values(blockData.recordMap?.block ?? {})[0]?.value;
  if (!block?.parent_id) {
    throw new NotFound(`Block not found: ${blockId}`);
  }

  const operations = [
    // Remove from old parent
    {
      id: block.parent_id,
      table: block.parent_table,
      path: ['content'],
      command: 'listRemove',
      args: { id: blockId },
    },
    // Add to new parent
    {
      id: targetParentId,
      table: 'block',
      path: ['content'],
      command: 'listAfter',
      args: {
        id: blockId,
        ...(params.after_block_id
          ? { after: normalizeId(params.after_block_id) }
          : {}),
      },
    },
    // Update block's parent reference
    {
      id: blockId,
      table: 'block',
      path: [],
      command: 'update',
      args: { parent_id: targetParentId, parent_table: 'block' },
    },
  ];

  await submitTransaction(operations, ctx.spaceId, ctx.userId);
  return { success: true };
}

/**
 * Replace all content under a heading with new blocks
 */
export async function replaceSection(
  params: ReplaceSectionInput,
): Promise<{ deleted_block_ids: string[]; new_block_ids: string[] }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);

  // Get fresh block list
  const { blocks } = await listBlocks({
    page_id: pageId,
    workspaceName: params.workspaceName,
  });

  // Find the section heading
  const headingLevels: Record<string, number> = {
    heading_1: 1,
    heading_2: 2,
    heading_3: 3,
  };

  const sectionIdx = blocks.findIndex(
    (b) => b.id === normalizeId(params.heading_block_id),
  );
  if (sectionIdx === -1) {
    throw new NotFound(`Heading block not found: ${params.heading_block_id}`);
  }

  const sectionBlock = blocks[sectionIdx];
  const sectionLevel = headingLevels[sectionBlock.type];
  if (!sectionLevel) {
    throw new Validation(
      `Block ${params.heading_block_id} is not a heading (type: ${sectionBlock.type})`,
    );
  }

  // Find end of section (next heading of same or higher level, or end of page)
  let endIdx = blocks.length;
  for (let i = sectionIdx + 1; i < blocks.length; i++) {
    const level = headingLevels[blocks[i].type];
    if (level && level <= sectionLevel) {
      endIdx = i;
      break;
    }
  }

  // Delete blocks in section (after the heading itself)
  const blocksToDelete = blocks.slice(sectionIdx + 1, endIdx);
  const deleteOps: Array<{
    id: string;
    table: string;
    path: string[];
    command: string;
    args: unknown;
  }> = [];

  for (const block of blocksToDelete) {
    deleteOps.push(
      {
        id: block.id,
        table: 'block',
        path: [],
        command: 'update',
        args: { alive: false },
      },
      {
        id: pageId,
        table: 'block',
        path: ['content'],
        command: 'listRemove',
        args: { id: block.id },
      },
    );
  }

  if (deleteOps.length > 0) {
    await submitTransaction(deleteOps, ctx.spaceId, ctx.userId);
  }

  // Insert new blocks after the heading
  const { block_ids } = await appendBlocks({
    page_id: pageId,
    blocks: params.new_blocks,
    after_block_id: params.heading_block_id,
    workspaceName: params.workspaceName,
  });

  return {
    deleted_block_ids: blocksToDelete.map((b) => b.id),
    new_block_ids: block_ids,
  };
}

/**
 * Get the schema of a database
 */
export async function getDatabaseSchema(
  params: GetDatabaseSchemaInput,
): Promise<{
  schema: Record<
    string,
    {
      type: string;
      options?: Array<{ value: string; color: string }>;
    }
  >;
  title: string;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const info = await loadCollectionInfo(
    params.database_id,
    ctx.spaceId,
    ctx.userId,
  );
  if (info === null) {
    throw new Validation(
      `Database ${params.database_id} is a template and does not expose a queryable schema`,
    );
  }

  const schema: Record<
    string,
    {
      type: string;
      options?: Array<{ value: string; color: string }>;
    }
  > = {};

  for (const [, prop] of Object.entries(info.schema)) {
    const entry: {
      type: string;
      options?: Array<{ value: string; color: string }>;
    } = {
      type: prop.type,
    };

    if (prop.options) {
      entry.options = prop.options.map((opt) => ({
        value: opt.value,
        color: opt.color,
      }));
    }

    schema[prop.name] = entry;
  }

  return {
    schema,
    title: info.name,
  };
}

// ============================================================================
// Sharing & Permissions
// ============================================================================

/**
 * Resolve an email to a Notion user ID, creating one if needed.
 */
async function resolveEmailToUserId(email: string): Promise<string> {
  const resp = await fetch('/api/v3/createEmailUser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email,
      preferredLocaleOrigin: 'inferred_from_inviter',
      preferredLocale: 'en-US',
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as { userId: string };
  return data.userId;
}

/**
 * Share a page with someone by email
 */
export async function sharePage(
  params: SharePageInput,
): Promise<{ success: boolean; user_id: string }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);
  const role = params.role ?? 'reader';

  // Resolve email to Notion user ID
  const targetUserId = await resolveEmailToUserId(params.email);

  // Invite via inviteGuestsToSpace
  await notionV3<Record<string, unknown>>(
    'inviteGuestsToSpace',
    {
      blockId: pageId,
      spaceId: ctx.spaceId,
      permissionItems: [
        {
          type: 'user_permission',
          role,
          user_id: targetUserId,
        },
      ],
    },
    ctx.spaceId,
    ctx.userId,
  );

  return { success: true, user_id: targetUserId };
}

/**
 * Update or remove a user's permission on a page
 */
export async function updatePagePermission(
  params: UpdatePagePermissionInput,
): Promise<{ success: boolean }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);
  const targetUserId = normalizeId(params.user_id);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (ctx.spaceId) headers['x-notion-space-id'] = ctx.spaceId;
  if (ctx.userId) headers['x-notion-active-user-header'] = ctx.userId;

  const response = await fetch('/api/v3/saveTransactions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      transactions: [
        {
          id: crypto.randomUUID(),
          spaceId: ctx.spaceId,
          operations: [
            {
              pointer: {
                table: 'block',
                id: pageId,
                spaceId: ctx.spaceId,
              },
              command: 'setPermissionItem',
              path: ['permissions'],
              args: {
                type: 'user_permission',
                role: params.role,
                user_id: targetUserId,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  return { success: true };
}

/**
 * Get current share settings and permissions for a page
 */
export async function getPagePermissions(
  params: GetPagePermissionsInput,
): Promise<{
  permissions: Array<{
    type: string;
    role: string;
    user_id?: string;
    allow_duplicate?: boolean;
    allow_search_engine_indexing?: boolean;
  }>;
  public_access: boolean;
  public_url: string | null;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);

  const blockData = await notionV3<{
    recordMap: {
      block: Record<
        string,
        {
          value: {
            permissions?: Array<Record<string, unknown>>;
            space_id?: string;
          };
        }
      >;
    };
  }>(
    'syncRecordValuesMain',
    {
      requests: [{ pointer: { id: pageId, table: 'block' }, version: -1 }],
    },
    ctx.spaceId,
    ctx.userId,
  );

  const block = blockData.recordMap.block[pageId]?.value;
  if (!block) {
    throw new NotFound(`Page not found: ${pageId}`);
  }

  const rawPermissions = block.permissions ?? [];

  const publicPerm = rawPermissions.find((p) => p.type === 'public_permission');
  const hasPublicAccess = publicPerm != null && publicPerm.role !== 'none';

  let publicUrl: string | null = null;
  if (hasPublicAccess) {
    try {
      const spaceData = await notionV3<{
        results?: Array<{ domain?: string }>;
      }>(
        'getPublicSpaceData',
        { type: 'space-ids', spaceIds: [ctx.spaceId] },
        ctx.spaceId,
        ctx.userId,
      );
      const domain = spaceData.results?.[0]?.domain;
      if (domain) {
        publicUrl = `https://${domain}.notion.site/${pageId.replace(/-/g, '')}`;
      }
    } catch {
      // Domain lookup failed, skip public URL
    }
  }

  const permissions = rawPermissions.map((p) => {
    const perm: {
      type: string;
      role: string;
      user_id?: string;
      allow_duplicate?: boolean;
      allow_search_engine_indexing?: boolean;
    } = {
      type: p.type as string,
      role: p.role as string,
    };
    if (p.user_id) perm.user_id = p.user_id as string;
    if (p.allow_duplicate != null)
      perm.allow_duplicate = p.allow_duplicate as boolean;
    if (p.allow_search_engine_indexing != null)
      perm.allow_search_engine_indexing =
        p.allow_search_engine_indexing as boolean;
    return perm;
  });

  return {
    permissions,
    public_access: hasPublicAccess,
    public_url: publicUrl,
  };
}

/**
 * Enable or disable "Share to web" for a page
 */
export async function publishToWeb(params: PublishToWebInput): Promise<{
  success: boolean;
  public_url: string | null;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (ctx.spaceId) headers['x-notion-space-id'] = ctx.spaceId;
  if (ctx.userId) headers['x-notion-active-user-header'] = ctx.userId;

  if (params.enabled === false) {
    const response = await fetch('/api/v3/saveTransactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        transactions: [
          {
            id: crypto.randomUUID(),
            spaceId: ctx.spaceId,
            operations: [
              {
                pointer: { table: 'block', id: pageId, spaceId: ctx.spaceId },
                command: 'setPermissionItem',
                path: ['permissions'],
                args: { type: 'public_permission', role: 'none' },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => undefined);
      throwForStatus(response.status, body);
    }

    return { success: true, public_url: null };
  }

  const allowDuplicate = params.allow_duplicate === true;
  const args: Record<string, unknown> = {
    type: 'public_permission',
    role: params.role,
    allow_duplicate: allowDuplicate,
  };
  if (params.allow_search_engine_indexing != null) {
    args.allow_search_engine_indexing = params.allow_search_engine_indexing;
  }

  const response = await fetch('/api/v3/saveTransactions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      transactions: [
        {
          id: crypto.randomUUID(),
          spaceId: ctx.spaceId,
          operations: [
            {
              pointer: { table: 'block', id: pageId, spaceId: ctx.spaceId },
              command: 'setPermissionItem',
              path: ['permissions'],
              args,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  let publicUrl: string | null = null;
  try {
    const spaceData = await notionV3<{
      results?: Array<{ domain?: string }>;
    }>(
      'getPublicSpaceData',
      { type: 'space-ids', spaceIds: [ctx.spaceId] },
      ctx.spaceId,
      ctx.userId,
    );
    const domain = spaceData.results?.[0]?.domain;
    if (domain) {
      publicUrl = `https://${domain}.notion.site/${pageId.replace(/-/g, '')}`;
    }
  } catch {
    publicUrl = `https://www.notion.so/${pageId.replace(/-/g, '')}`;
  }

  return { success: true, public_url: publicUrl };
}

/**
 * Get shareable links for a page (internal URL and public URL if published)
 */
export async function getPageLink(params: GetPageLinkInput): Promise<{
  url: string;
  public_url: string | null;
  is_published: boolean;
}> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);

  const url = `https://www.notion.so/${pageId.replace(/-/g, '')}`;

  const blockData = await notionV3<{
    recordMap: {
      block: Record<
        string,
        { value: { permissions?: Array<Record<string, unknown>> } }
      >;
    };
  }>(
    'syncRecordValuesMain',
    {
      requests: [{ pointer: { id: pageId, table: 'block' }, version: -1 }],
    },
    ctx.spaceId,
    ctx.userId,
  );

  const block = blockData.recordMap.block[pageId]?.value;
  if (!block) {
    throw new NotFound(`Page not found: ${pageId}`);
  }

  const publicPerm = (block.permissions ?? []).find(
    (p) => p.type === 'public_permission' && p.role !== 'none',
  );
  const isPublished = publicPerm != null;

  let publicUrl: string | null = null;
  if (isPublished) {
    try {
      const spaceData = await notionV3<{
        results?: Array<{ domain?: string }>;
      }>(
        'getPublicSpaceData',
        { type: 'space-ids', spaceIds: [ctx.spaceId] },
        ctx.spaceId,
        ctx.userId,
      );
      const domain = spaceData.results?.[0]?.domain;
      if (domain) {
        publicUrl = `https://${domain}.notion.site/${pageId.replace(/-/g, '')}`;
      }
    } catch {
      // Fall back; no public URL available
    }
  }

  return { url, public_url: publicUrl, is_published: isPublished };
}

// ============================================================================
// Image & Copy Utilities
// ============================================================================

interface UploadFileUrlResponse {
  url: string;
  signedPutUrl: string;
  signedGetUrl: string;
}

/**
 * Upload an image from a URL and embed it as an image block in a Notion page.
 */
export async function addImageBlock(
  params: AddImageBlockInput,
): Promise<{ block_id: string }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const pageId = normalizeId(params.page_id);
  const afterId = params.after_block_id
    ? normalizeId(params.after_block_id)
    : undefined;

  // Step 1: Create a placeholder image block first.
  // Notion requires the block to exist before getUploadFileUrl can reference it.
  const blockId = crypto.randomUUID();
  const placeholderArgs: Record<string, unknown> = {
    type: 'image',
    id: blockId,
    parent_id: pageId,
    parent_table: 'block',
    alive: true,
    created_time: Date.now(),
    created_by_id: ctx.userId,
    last_edited_time: Date.now(),
    last_edited_by_id: ctx.userId,
    space_id: ctx.spaceId,
    properties: { source: [[params.image_url]] },
    format: {
      block_width: 680,
      block_full_width: false,
      block_page_width: true,
    },
  };
  if (params.caption) {
    (placeholderArgs.properties as Record<string, unknown>).caption = [
      [params.caption],
    ];
  }

  await submitTransaction(
    [
      {
        id: blockId,
        table: 'block',
        path: [],
        command: 'set',
        args: placeholderArgs,
      },
      {
        id: pageId,
        table: 'block',
        path: ['content'],
        command: 'listAfter',
        args: { id: blockId, ...(afterId ? { after: afterId } : {}) },
      },
    ],
    ctx.spaceId,
    ctx.userId,
  );

  // Step 2: Try to download the image and re-upload to Notion's S3.
  // If this fails (CORS, network), the block keeps the external URL which Notion proxies.
  try {
    const imageResp = await fetch(params.image_url);
    if (imageResp.ok) {
      const rawContentType = imageResp.headers.get('content-type');
      const contentType = rawContentType ? rawContentType : 'image/png';
      const imageBuffer = await imageResp.arrayBuffer();

      const urlPath = new URL(params.image_url).pathname;
      const lastSegment = urlPath.split('/').pop();
      const filename = lastSegment ? lastSegment : 'image.png';

      // Get upload URL referencing the BLOCK (not the page), required by Notion
      const uploadResp = await fetch('/api/v3/getUploadFileUrl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-notion-space-id': ctx.spaceId,
        },
        credentials: 'include',
        body: JSON.stringify({
          bucket: 'secure',
          contentType,
          name: filename,
          record: {
            id: blockId,
            table: 'block',
            spaceId: ctx.spaceId,
          },
        }),
      });

      if (uploadResp.ok) {
        const uploadData = (await uploadResp.json()) as UploadFileUrlResponse;

        const s3Resp = await fetch(uploadData.signedPutUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: imageBuffer,
        });

        if (s3Resp.ok) {
          // Update the block source to the Notion-hosted attachment URL
          await submitTransaction(
            [
              {
                id: blockId,
                table: 'block',
                path: ['properties', 'source'],
                command: 'set',
                args: [[uploadData.url]],
              },
              {
                id: blockId,
                table: 'block',
                path: ['format', 'display_source'],
                command: 'set',
                args: uploadData.signedGetUrl,
              },
            ],
            ctx.spaceId,
            ctx.userId,
          );
        }
      }
    }
  } catch {
    // CORS or network error; block keeps the external URL.
  }

  return { block_id: blockId };
}

/**
 * Copy all content blocks from one page to another.
 */
export async function copyBlocks(
  params: CopyBlocksInput,
): Promise<{ copied_count: number }> {
  const ctx = await getContext({ workspaceName: params.workspaceName });
  const sourceId = normalizeId(params.source_page_id);
  const targetId = normalizeId(params.target_page_id);

  // Load source page to get child block IDs
  const pageSync = await notionV3<{
    recordMap: { block: Record<string, { value: InternalBlock }> };
  }>(
    'syncRecordValuesMain',
    {
      requests: [{ pointer: { id: sourceId, table: 'block' }, version: -1 }],
    },
    ctx.spaceId,
    ctx.userId,
  );

  const sourcePage = pageSync.recordMap.block[sourceId]?.value;
  if (!sourcePage) {
    throw new NotFound(`Source page not found: ${sourceId}`);
  }

  const childIds = sourcePage.content ?? [];
  if (childIds.length === 0) {
    return { copied_count: 0 };
  }

  // Batch-fetch all child blocks
  const childSync = await notionV3<{
    recordMap: { block: Record<string, { value: InternalBlock }> };
  }>(
    'syncRecordValuesMain',
    {
      requests: childIds.map((id) => ({
        pointer: { id, table: 'block' as const },
        version: -1,
      })),
    },
    ctx.spaceId,
    ctx.userId,
  );

  const operations: Array<{
    id: string;
    table: string;
    path: string[];
    command: string;
    args: unknown;
  }> = [];

  let afterId: string | undefined;

  for (const sourceChildId of childIds) {
    const sourceBlock = childSync.recordMap.block[sourceChildId]?.value;
    if (!sourceBlock) continue;

    const newBlockId = crypto.randomUUID();

    const blockArgs: Record<string, unknown> = {
      type: sourceBlock.type,
      id: newBlockId,
      parent_id: targetId,
      parent_table: 'block',
      alive: true,
      created_time: Date.now(),
      created_by_id: ctx.userId,
      last_edited_time: Date.now(),
      last_edited_by_id: ctx.userId,
      space_id: ctx.spaceId,
    };

    if (sourceBlock.properties) {
      blockArgs.properties = sourceBlock.properties;
    }
    if (sourceBlock.format) {
      blockArgs.format = sourceBlock.format;
    }

    operations.push(
      {
        id: newBlockId,
        table: 'block',
        path: [],
        command: 'set',
        args: blockArgs,
      },
      {
        id: targetId,
        table: 'block',
        path: ['content'],
        command: 'listAfter',
        args: { id: newBlockId, ...(afterId ? { after: afterId } : {}) },
      },
    );

    afterId = newBlockId;
  }

  await submitTransaction(operations, ctx.spaceId, ctx.userId);

  return { copied_count: childIds.length };
}
