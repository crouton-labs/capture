/**
 * Claude.ai Library - Export projects, files, docs, and context from Claude.ai
 *
 * Runs in the browser via CDP. Requires user to be logged into claude.ai.
 * Auth is cookie-based (credentials: 'include'), no CSRF needed.
 * All context (orgId, user info, projects) comes from claude.ai HTTP APIs —
 * no DOM scraping, no cookie parsing, no __NEXT_DATA__ reads.
 */

export type {
  GetContextOutput,
  ListProjectsOutput,
  GetProjectOutput,
  ListProjectDocsOutput,
  GetProjectDocOutput,
  ListProjectFilesOutput,
  GetFileContentOutput,
  ListProjectConversationsOutput,
  GetProjectMembersOutput,
  GetMemoryOutput,
  ListSkillsOutput,
  GetFeatureSettingsOutput,
  GetSyncSettingsOutput,
  ListActiveSessionsOutput,
  ExportProjectOutput,
  ListConversationsOutput,
  GetConversationOutput,
  GetConversationBatchOutput,
  CreateConversationInput,
  CreateConversationOutput,
  SendMessageInput,
  SendMessageOutput,
  AttachFile,
  UploadFileToConversationInput,
  UploadFileToConversationOutput,
  GeneratedFile,
  GeneratedSvg,
  DownloadGeneratedFileInput,
  DownloadGeneratedFileOutput,
  ProjectFile,
  ProjectDoc,
  Conversation,
} from './schemas';

import type {
  GetContextOutput,
  ListProjectsOutput,
  GetProjectOutput,
  ListProjectDocsOutput,
  GetProjectDocOutput,
  ListProjectFilesOutput,
  GetFileContentOutput,
  ListProjectConversationsOutput,
  GetProjectMembersOutput,
  GetMemoryOutput,
  ListSkillsOutput,
  GetFeatureSettingsOutput,
  GetSyncSettingsOutput,
  ListActiveSessionsOutput,
  ExportProjectOutput,
  ListConversationsOutput,
  GetConversationOutput,
  GetConversationBatchOutput,
  CreateConversationInput,
  CreateConversationOutput,
  SendMessageInput,
  SendMessageOutput,
  AttachFile,
  UploadFileToConversationInput,
  UploadFileToConversationOutput,
  GeneratedFile,
  GeneratedSvg,
  DownloadGeneratedFileInput,
  DownloadGeneratedFileOutput,
} from './schemas';
import type { FileRef } from '../files/schemas';

import { Validation, ContractDrift, NotFound, Unauthenticated, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// File Save (Northlight Files API)
// ============================================================================

declare const window: Window & {
  __vallum_files?: {
    write(
      name: string,
      data: string | ArrayBuffer | Uint8Array | Blob,
    ): Promise<FileRef>;
    read(identifier: string | { path: string }): Promise<ArrayBuffer>;
  };
};

async function saveToDevice(
  filename: string,
  content: string | ArrayBuffer | Uint8Array,
): Promise<FileRef | undefined> {
  if (typeof window !== 'undefined' && window.__vallum_files) {
    return window.__vallum_files.write(filename, content);
  }
  return undefined;
}

async function readFromDevice(path: string): Promise<ArrayBuffer> {
  if (typeof window === 'undefined' || !window.__vallum_files) {
    throw new Validation(
      '[NORTHLIGHT_REQUIRED] Cannot read device files: __vallum_files bridge unavailable. File attachments require the Northlight Electron host.',
    );
  }
  return window.__vallum_files.read(path);
}

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function inferContentType(name: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const types: Record<string, string> = {
    txt: 'text/plain',
    csv: 'text/csv',
    md: 'text/markdown',
    html: 'text/html',
    htm: 'text/html',
    json: 'application/json',
    xml: 'application/xml',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    zip: 'application/zip',
    gz: 'application/gzip',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    webm: 'video/webm',
  };
  return types[ext] ?? 'application/octet-stream';
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function claudeFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://claude.ai${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throw new ContractDrift(`Claude returned non-JSON response: ${truncated}`);
  }
}

// ============================================================================
// Context Acquisition
// ============================================================================

/**
 * Get org ID and user info from the authenticated Claude.ai session.
 * Uses /api/bootstrap — no DOM scraping, no cookie parsing.
 */
export async function getContext(
  _opts: { timeoutMs?: number } = {},
): Promise<GetContextOutput> {
  const resp = await fetch('https://claude.ai/api/bootstrap', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new Unauthenticated(
      `[AUTH_REQUIRED] Claude.ai session not authenticated. /api/bootstrap returned ${resp.status}.`,
    );
  }

  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const account = ((data.account ?? {}) as Record<string, unknown>) ?? {};
  const memberships = (account.memberships ?? []) as Array<
    Record<string, unknown>
  >;
  const organization =
    ((memberships[0]?.organization ?? {}) as Record<string, unknown>) ?? {};

  const orgId = String(organization.uuid ?? '');
  if (!orgId) {
    throw new Unauthenticated(
      `[AUTH_REQUIRED] /api/bootstrap returned no organization membership.`,
    );
  }

  return {
    orgId,
    userId: String(account.uuid ?? ''),
    email: String(account.email_address ?? account.email ?? ''),
    fullName: String(account.full_name ?? account.name ?? ''),
  };
}

// ============================================================================
// Projects
// ============================================================================

/**
 * List all projects in the organization.
 */
export async function listProjects(opts: {
  orgId: string;
}): Promise<ListProjectsOutput> {
  const data = await claudeFetch<Array<Record<string, unknown>>>(
    `/api/organizations/${opts.orgId}/projects`,
  );

  const raw = Array.isArray(data) ? data : [];
  const projects = raw.map((p: Record<string, unknown>) => ({
    uuid: String(p.uuid ?? ''),
    name: String(p.name ?? ''),
    description: String(p.description ?? ''),
    is_private: Boolean(p.is_private ?? true),
    is_starter_project: Boolean(p.is_starter_project ?? false),
    created_at: String(p.created_at ?? ''),
    updated_at: String(p.updated_at ?? ''),
    docs_count: Number(p.docs_count ?? 0),
    files_count: Number(p.files_count ?? 0),
    archived_at: (p.archived_at as string) ?? null,
  }));

  return { projects };
}

/**
 * Get full details for a single project.
 */
export async function getProject(opts: {
  orgId: string;
  projectId: string;
}): Promise<GetProjectOutput> {
  const data = await claudeFetch<Record<string, unknown>>(
    `/api/organizations/${opts.orgId}/projects/${opts.projectId}`,
  );

  const creator = (data.creator ?? {}) as Record<string, unknown>;

  return {
    uuid: String(data.uuid ?? ''),
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    is_private: Boolean(data.is_private ?? true),
    is_starter_project: Boolean(data.is_starter_project ?? false),
    prompt_template: String(data.prompt_template ?? ''),
    created_at: String(data.created_at ?? ''),
    updated_at: String(data.updated_at ?? ''),
    creator: {
      uuid: String(creator.uuid ?? ''),
      full_name: String(creator.full_name ?? ''),
    },
    docs_count: Number(data.docs_count ?? 0),
    files_count: Number(data.files_count ?? 0),
    permissions: Array.isArray(data.permissions)
      ? data.permissions.map(String)
      : [],
  };
}

// ============================================================================
// Project Docs
// ============================================================================

/**
 * List text documents in a project.
 */
export async function listProjectDocs(opts: {
  orgId: string;
  projectId: string;
}): Promise<ListProjectDocsOutput> {
  const data = await claudeFetch<Array<Record<string, unknown>>>(
    `/api/organizations/${opts.orgId}/projects/${opts.projectId}/docs`,
  );

  const docs = (Array.isArray(data) ? data : []).map(
    (d: Record<string, unknown>) => ({
      uuid: String(d.uuid ?? ''),
      file_name: String(d.file_name ?? d.filename ?? ''),
      content: String(d.content ?? ''),
      content_length: String(d.content ?? '').length,
      created_at: String(d.created_at ?? ''),
    }),
  );

  return { docs };
}

/**
 * Get a single project document with full content.
 */
export async function getProjectDoc(opts: {
  orgId: string;
  projectId: string;
  docId: string;
}): Promise<GetProjectDocOutput> {
  const data = await claudeFetch<Array<Record<string, unknown>>>(
    `/api/organizations/${opts.orgId}/projects/${opts.projectId}/docs`,
  );

  const doc = (Array.isArray(data) ? data : []).find(
    (d) => d.uuid === opts.docId,
  );
  if (!doc) {
    throw new NotFound(`Doc ${opts.docId} not found in project ${opts.projectId}`);
  }

  return {
    uuid: String(doc.uuid),
    file_name: String(doc.file_name ?? doc.filename ?? ''),
    content: String(doc.content ?? ''),
    created_at: String(doc.created_at ?? ''),
  };
}

// ============================================================================
// Project Files
// ============================================================================

/**
 * List uploaded files in a project.
 */
export async function listProjectFiles(opts: {
  orgId: string;
  projectId: string;
}): Promise<ListProjectFilesOutput> {
  const data = await claudeFetch<Array<Record<string, unknown>>>(
    `/api/organizations/${opts.orgId}/projects/${opts.projectId}/files`,
  );

  const files = (Array.isArray(data) ? data : []).map(
    (f: Record<string, unknown>) => ({
      uuid: String(f.uuid ?? f.file_uuid ?? ''),
      file_name: String(f.file_name ?? f.filename ?? ''),
      file_size: Number(f.file_size ?? f.size_bytes ?? 0),
      file_type: String(f.file_type ?? f.content_type ?? f.file_kind ?? ''),
      created_at: String(f.created_at ?? ''),
    }),
  );

  return { files };
}

// ============================================================================
// File Content
// ============================================================================

/**
 * Download a file from a Claude.ai project and save to device.
 * Files are served as binary (WEBP for images) from the preview endpoint.
 */
export async function getFileContent(opts: {
  orgId: string;
  fileId: string;
  filename?: string;
}): Promise<GetFileContentOutput> {
  const baseUrl = `https://claude.ai/api/${opts.orgId}/files/${opts.fileId}`;

  // Try /preview first (works for images), then /document_pdf (works for PDFs)
  let response = await fetch(`${baseUrl}/preview`, { credentials: 'include' });

  if (!response.ok) {
    response = await fetch(`${baseUrl}/document_pdf`, {
      credentials: 'include',
    });
  }

  if (!response.ok) {
    throwForStatus(response.status, `Failed to download file ${opts.fileId}`);
  }

  const contentType =
    response.headers.get('content-type') ?? 'application/octet-stream';
  const contentBuffer = await response.arrayBuffer();

  // Try Content-Disposition header for real filename, then explicit param, then UUID fallback
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";\n]+)/i);
  const fileName =
    opts.filename ?? (match ? decodeURIComponent(match[1]) : opts.fileId);

  const fileRef = await saveToDevice(fileName, contentBuffer);

  return {
    fileName,
    mimeType: contentType,
    size: contentBuffer.byteLength,
    ...(fileRef ? { fileRef } : {}),
  };
}

// ============================================================================
// Conversations
// ============================================================================

/**
 * List conversations in a project with pagination.
 * Response format: { data: [...], pagination: { total, limit, offset, has_more } }
 */
export async function listProjectConversations(opts: {
  orgId: string;
  projectId: string;
  limit?: number;
  offset?: number;
}): Promise<ListProjectConversationsOutput> {
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  const data = await claudeFetch<Record<string, unknown>>(
    `/api/organizations/${opts.orgId}/projects/${opts.projectId}/conversations_v2?${params}`,
  );

  // Response is { data: [...], pagination: { total, limit, offset, has_more } }
  const items = (data.data ?? []) as Array<Record<string, unknown>>;
  const pagination = (data.pagination ?? {}) as Record<string, unknown>;

  const conversations = items.map((c: Record<string, unknown>) => ({
    uuid: String(c.uuid ?? ''),
    name: String(c.name ?? ''),
    created_at: String(c.created_at ?? ''),
    updated_at: String(c.updated_at ?? ''),
  }));

  return {
    conversations,
    total: Number(pagination.total ?? 0),
    hasMore: Boolean(pagination.has_more ?? false),
  };
}

// ============================================================================
// Project Members
// ============================================================================

/**
 * List members who have access to a project.
 * Response format: Array of { project_uuid, role, account: { uuid, full_name, email_address } }
 */
export async function getProjectMembers(opts: {
  orgId: string;
  projectId: string;
}): Promise<GetProjectMembersOutput> {
  const data = await claudeFetch<Array<Record<string, unknown>>>(
    `/api/organizations/${opts.orgId}/projects/${opts.projectId}/accounts`,
  );

  const members = (Array.isArray(data) ? data : []).map(
    (m: Record<string, unknown>) => {
      const account = (m.account ?? {}) as Record<string, unknown>;
      return {
        uuid: String(account.uuid ?? ''),
        full_name: String(account.full_name ?? ''),
        email_address: String(account.email_address ?? ''),
        role: String(m.role ?? ''),
      };
    },
  );

  return { members };
}

// ============================================================================
// Memory
// ============================================================================

/**
 * Get memory text: global or project-scoped.
 * Response format: { memory: string, controls: string[], updated_at: string|null }
 */
export async function getMemory(opts: {
  orgId: string;
  projectId?: string;
}): Promise<GetMemoryOutput> {
  const params = opts.projectId ? `?project_uuid=${opts.projectId}` : '';
  const data = await claudeFetch<Record<string, unknown>>(
    `/api/organizations/${opts.orgId}/memory${params}`,
  );

  const rawControls = Array.isArray(data.controls) ? data.controls : [];

  return {
    memory: String(data.memory ?? ''),
    controls: rawControls.map(String),
    updated_at: (data.updated_at as string) ?? null,
  };
}

// ============================================================================
// Skills
// ============================================================================

/**
 * List available Claude skills.
 * Response format: { skills: [...] }
 */
export async function listSkills(opts: {
  orgId: string;
}): Promise<ListSkillsOutput> {
  const data = await claudeFetch<Record<string, unknown>>(
    `/api/organizations/${opts.orgId}/skills/list-skills`,
  );

  const rawSkills = (data.skills ?? []) as Array<Record<string, unknown>>;

  const skills = rawSkills.map((s: Record<string, unknown>) => ({
    id: String(s.id ?? ''),
    name: String(s.name ?? ''),
    description: String(s.description ?? ''),
    creator_type: String(s.creator_type ?? ''),
    enabled: Boolean(s.enabled ?? false),
    is_public_provisioned: Boolean(s.is_public_provisioned ?? false),
  }));

  return { skills };
}

// ============================================================================
// Feature Settings
// ============================================================================

/**
 * Get feature flags and forced settings.
 * Response format: { disabled_features: string[], forced_settings: [{feature, forced_state}] }
 */
export async function getFeatureSettings(opts: {
  orgId: string;
}): Promise<GetFeatureSettingsOutput> {
  const data = await claudeFetch<Record<string, unknown>>(
    `/api/organizations/${opts.orgId}/feature_settings`,
  );

  const disabledFeatures = Array.isArray(data.disabled_features)
    ? data.disabled_features.map(String)
    : [];

  const rawForced = (data.forced_settings ?? []) as Array<
    Record<string, unknown>
  >;
  const forcedSettings = rawForced.map((f: Record<string, unknown>) => ({
    feature: String(f.feature ?? ''),
    forced_state: Boolean(f.forced_state ?? false),
  }));

  return {
    disabled_features: disabledFeatures,
    forced_settings: forcedSettings,
  };
}

// ============================================================================
// Sync Settings
// ============================================================================

/**
 * Get integration settings.
 * Response format: Direct array of [{ type, enabled, config }]
 */
export async function getSyncSettings(opts: {
  orgId: string;
}): Promise<GetSyncSettingsOutput> {
  const data = await claudeFetch<Array<Record<string, unknown>>>(
    `/api/organizations/${opts.orgId}/sync/settings`,
  );

  const integrations = (Array.isArray(data) ? data : []).map(
    (item: Record<string, unknown>) => ({
      type: String(item.type ?? ''),
      enabled: Boolean(item.enabled ?? false),
      config: item.config ?? null,
    }),
  );

  return { integrations };
}

// ============================================================================
// Active Sessions
// ============================================================================

/**
 * List active login sessions.
 * Response format: { data: [...], pagination: { total, limit, offset, has_more } }
 */
export async function listActiveSessions(
  _opts: Record<string, never> = {},
): Promise<ListActiveSessionsOutput> {
  const data = await claudeFetch<Record<string, unknown>>(
    '/api/auth/sessions/list-active?page=1&per_page=50&application_slug=claude-ai',
  );

  const items = (data.data ?? []) as Array<Record<string, unknown>>;
  const pagination = (data.pagination ?? {}) as Record<string, unknown>;

  const sessions = items.map((s: Record<string, unknown>) => {
    const ua = (s.user_agent ?? {}) as Record<string, unknown>;
    const loc = (s.location_info ?? {}) as Record<string, unknown>;

    return {
      created_at: String(s.created_at ?? ''),
      updated_at: String(s.updated_at ?? ''),
      expires_at: String(s.expires_at ?? ''),
      user_agent: {
        browser_family: String(ua.browser_family ?? ''),
        browser_version: String(ua.browser_version ?? ''),
        os_family: String(ua.os_family ?? ''),
        os_version: String(ua.os_version ?? ''),
        device_family: String(ua.device_family ?? ''),
      },
      location_info: {
        country: String(loc.country ?? ''),
        region: String(loc.region ?? ''),
        city: String(loc.city ?? ''),
      },
      is_current: Boolean(s.is_current ?? false),
    };
  });

  return {
    sessions,
    total: Number(pagination.total ?? sessions.length),
  };
}

// ============================================================================
// Conversations (All)
// ============================================================================

/**
 * List all conversations in the organization (not project-specific).
 * Returns recent conversations with basic metadata.
 */
export async function listConversations(opts: {
  orgId: string;
  limit?: number;
  offset?: number;
}): Promise<ListConversationsOutput> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  // Fetch more than requested to handle pagination
  const allConversations: Array<{
    uuid: string;
    name: string;
    model: string;
    created_at: string;
    updated_at: string;
    project_uuid: string;
  }> = [];

  const data = await claudeFetch<Array<Record<string, unknown>>>(
    `/api/organizations/${opts.orgId}/chat_conversations`,
  );

  if (Array.isArray(data)) {
    for (const c of data) {
      allConversations.push({
        uuid: String(c.uuid ?? ''),
        name: String(c.name ?? ''),
        model: String(c.model ?? ''),
        created_at: String(c.created_at ?? ''),
        updated_at: String(c.updated_at ?? ''),
        project_uuid: String(c.project_uuid ?? ''),
      });
    }
  }

  // Apply offset/limit manually since the API returns all at once
  const sliced = allConversations.slice(offset, offset + limit);

  return {
    conversations: sliced,
    total: allConversations.length,
    hasMore: offset + limit < allConversations.length,
  };
}

/**
 * Internal: fetch the raw conversation tree. Used by getConversation (which
 * applies a narrow mapping) and by sendMessage / createConversation (which
 * need the raw content blocks to harvest generated output).
 */
async function fetchConversationRaw(
  orgId: string,
  conversationId: string,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    tree: 'True',
    rendering_mode: 'messages',
    render_all_tools: 'true',
  });
  return claudeFetch<Record<string, unknown>>(
    `/api/organizations/${orgId}/chat_conversations/${conversationId}?${params}`,
  );
}

/**
 * Get a single conversation with all its messages.
 * Returns the full conversation tree including message content.
 */
export async function getConversation(opts: {
  orgId: string;
  conversationId: string;
}): Promise<GetConversationOutput> {
  const data = await fetchConversationRaw(opts.orgId, opts.conversationId);

  const rawMessages = (data.chat_messages ?? []) as Array<
    Record<string, unknown>
  >;

  const messages = rawMessages.map((m) => {
    const rawContent = (m.content ?? []) as Array<Record<string, unknown>>;
    const content = rawContent.map((block) => ({
      type: String(block.type ?? 'text'),
      text: block.text != null ? String(block.text) : undefined,
    }));

    return {
      uuid: String(m.uuid ?? ''),
      role: m.sender != null ? String(m.sender) : null,
      parent_uuid:
        m.parent_message_uuid != null ? String(m.parent_message_uuid) : null,
      created_at: String(m.created_at ?? ''),
      updated_at: String(m.updated_at ?? ''),
      content,
    };
  });

  return {
    uuid: String(data.uuid ?? ''),
    name: String(data.name ?? ''),
    model: String(data.model ?? ''),
    summary: String(data.summary ?? ''),
    created_at: String(data.created_at ?? ''),
    updated_at: String(data.updated_at ?? ''),
    project_uuid: String(data.project_uuid ?? ''),
    messages,
  };
}

/**
 * Fetch multiple conversations in parallel.
 * More efficient than individual getConversation calls when used via executeLibFunction
 * because it collapses N HTTP requests into a single browser execution.
 */
export async function getConversationBatch(opts: {
  orgId: string;
  conversationIds: string[];
  concurrency?: number;
}): Promise<GetConversationBatchOutput> {
  const maxConcurrency = opts.concurrency ?? 10;
  const results: GetConversationBatchOutput['results'] = [];

  // Process in chunks to respect concurrency limit
  for (let i = 0; i < opts.conversationIds.length; i += maxConcurrency) {
    const chunk = opts.conversationIds.slice(i, i + maxConcurrency);
    const settled = await Promise.allSettled(
      chunk.map((id) =>
        getConversation({ orgId: opts.orgId, conversationId: id }),
      ),
    );

    for (let j = 0; j < chunk.length; j++) {
      const result = settled[j];
      if (result.status === 'fulfilled') {
        results.push({
          conversationId: chunk[j],
          status: 'ok',
          conversation: result.value,
        });
      } else {
        results.push({
          conversationId: chunk[j],
          status: 'error',
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    }
  }

  return { results };
}

// ============================================================================
// Upload (conversation-scoped)
// ============================================================================

/**
 * Upload a local file into an existing Claude.ai conversation.
 * Reads bytes from the device via the Northlight bridge, then POSTs multipart
 * to /wiggle/upload-file. Returns a fileId you can pass to sendMessage.files.
 */
export async function uploadFileToConversation(
  opts: UploadFileToConversationInput,
): Promise<UploadFileToConversationOutput> {
  const buffer = await readFromDevice(opts.path);
  const name = opts.name ?? basenameOf(opts.path);
  const contentType = opts.contentType ?? inferContentType(name);

  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: contentType }), name);

  const response = await fetch(
    `https://claude.ai/api/organizations/${opts.orgId}/conversations/${opts.conversationId}/wiggle/upload-file`,
    {
      method: 'POST',
      credentials: 'include',
      body: formData,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const documentAsset =
    (data.document_asset as Record<string, unknown> | null) ?? null;
  const pageCountRaw = documentAsset?.page_count;

  return {
    fileId: String(data.file_uuid ?? data.uuid ?? ''),
    fileName: String(data.file_name ?? name),
    sanitizedName: String(data.sanitized_name ?? ''),
    fileKind: String(data.file_kind ?? ''),
    sizeBytes: Number(data.size_bytes ?? buffer.byteLength),
    sandboxPath: String(data.path ?? ''),
    ...(typeof pageCountRaw === 'number' ? { pageCount: pageCountRaw } : {}),
  };
}

/**
 * Resolve a caller's `files` array into concrete fileIds, uploading any
 * entries that reference a device path. Entries with `fileId` pass through.
 */
async function resolveAttachments(
  orgId: string,
  conversationId: string,
  files: AttachFile[] | undefined,
): Promise<string[]> {
  if (!files || files.length === 0) return [];
  const fileIds: string[] = [];
  for (const file of files) {
    if (file.fileId) {
      fileIds.push(file.fileId);
      continue;
    }
    if (!file.path) {
      throw new Validation(
        'Each attach file must have either fileId or path. Got neither.',
      );
    }
    const uploaded = await uploadFileToConversation({
      orgId,
      conversationId,
      path: file.path,
      name: file.name,
      contentType: file.contentType,
    });
    fileIds.push(uploaded.fileId);
  }
  return fileIds;
}

// ============================================================================
// Download generated output (files Claude produced in the sandbox)
// ============================================================================

type ScannedFile = { sandboxPath: string; name: string; mimeType: string };

/**
 * Scan a raw assistant message for generated output:
 *   - local_resource blocks (files written to /mnt/user-data/outputs/…)
 *   - show_widget tool calls carrying an inline SVG
 */
function scanMessageForGenerated(rawMessage: Record<string, unknown>): {
  files: ScannedFile[];
  svgs: GeneratedSvg[];
} {
  const files: ScannedFile[] = [];
  const svgs: GeneratedSvg[] = [];
  const content = (rawMessage.content ?? []) as Array<Record<string, unknown>>;

  for (const block of content) {
    const btype = String(block.type ?? '');

    if (btype === 'tool_use') {
      const name = String(block.name ?? '');
      if (name === 'show_widget' || name === 'visualize:show_widget') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const code = String(input.widget_code ?? '');
        if (code.trim().startsWith('<svg')) {
          svgs.push({
            title: String(input.title ?? ''),
            svg: code,
          });
        }
      }
      continue;
    }

    if (btype === 'tool_result') {
      const inner = Array.isArray(block.content)
        ? (block.content as Array<Record<string, unknown>>)
        : [];
      for (const item of inner) {
        if (String(item.type ?? '') !== 'local_resource') continue;
        const filePath = String(item.file_path ?? '');
        if (!filePath) continue;
        files.push({
          sandboxPath: filePath,
          name: String(item.name ?? basenameOf(filePath)),
          mimeType: String(item.mime_type ?? 'application/octet-stream'),
        });
      }
    }
  }

  return { files, svgs };
}

/**
 * Download a file Claude wrote into the conversation sandbox. Saves to device
 * via __vallum_files when the bridge is available; otherwise returns metadata
 * without a fileRef.
 */
export async function downloadGeneratedFile(
  opts: DownloadGeneratedFileInput,
): Promise<DownloadGeneratedFileOutput> {
  const name = opts.name ?? basenameOf(opts.path);
  const params = new URLSearchParams({ path: opts.path });
  const response = await fetch(
    `https://claude.ai/api/organizations/${opts.orgId}/conversations/${opts.conversationId}/wiggle/download-file?${params}`,
    { credentials: 'include' },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  const mimeType =
    response.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = await response.arrayBuffer();
  const fileRef = await saveToDevice(name, buffer);

  return {
    name,
    mimeType,
    size: buffer.byteLength,
    sandboxPath: opts.path,
    ...(fileRef ? { fileRef } : {}),
  };
}

const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

function isTextualMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  return (
    lower.startsWith('text/') ||
    lower === 'application/json' ||
    lower === 'application/xml' ||
    lower === 'application/javascript' ||
    lower === 'image/svg+xml'
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + 0x2000)),
    );
  }
  return btoa(binary);
}

function buildPreview(
  mimeType: string,
  buffer: ArrayBuffer,
): {
  previewText?: string;
  previewDataUrl?: string;
  previewOmitted?: string;
} {
  if (buffer.byteLength > PREVIEW_MAX_BYTES) {
    return {
      previewOmitted: `File is ${buffer.byteLength} bytes; inline preview capped at ${PREVIEW_MAX_BYTES}. Ask the user whether to save via downloadGeneratedFile.`,
    };
  }
  if (isTextualMime(mimeType)) {
    return { previewText: new TextDecoder().decode(buffer) };
  }
  if (mimeType.toLowerCase().startsWith('image/')) {
    return {
      previewDataUrl: `data:${mimeType.toLowerCase()};base64,${arrayBufferToBase64(buffer)}`,
    };
  }
  return {
    previewOmitted: `No inline preview for MIME type ${mimeType}. Show metadata and ask the user whether to save via downloadGeneratedFile.`,
  };
}

async function previewAllGenerated(
  orgId: string,
  conversationId: string,
  scanned: ScannedFile[],
): Promise<GeneratedFile[]> {
  const out: GeneratedFile[] = [];
  for (const f of scanned) {
    try {
      const params = new URLSearchParams({ path: f.sandboxPath });
      const response = await fetch(
        `https://claude.ai/api/organizations/${orgId}/conversations/${conversationId}/wiggle/download-file?${params}`,
        { credentials: 'include' },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const truncated =
          body.length > 500 ? body.slice(0, 500) + '... [truncated]' : body;
        out.push({
          name: f.name,
          mimeType: f.mimeType,
          size: 0,
          sandboxPath: f.sandboxPath,
          error: `Preview fetch ${response.status} on ${f.sandboxPath}: ${truncated}`,
        });
        continue;
      }

      const mimeType =
        response.headers.get('content-type') ??
        f.mimeType ??
        'application/octet-stream';
      const buffer = await response.arrayBuffer();

      out.push({
        name: f.name,
        mimeType,
        size: buffer.byteLength,
        sandboxPath: f.sandboxPath,
        ...buildPreview(mimeType, buffer),
      });
    } catch (err) {
      out.push({
        name: f.name,
        mimeType: f.mimeType,
        size: 0,
        sandboxPath: f.sandboxPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * Given a raw conversation response, extract the assistant-text and the
 * generated output (files + svgs) from messages at index >= startIdx.
 */
function harvestFromRaw(
  raw: Record<string, unknown>,
  startIdx: number,
): {
  response: string;
  scannedFiles: ScannedFile[];
  generatedSvgs: GeneratedSvg[];
} {
  const allMessages = (raw.chat_messages ?? []) as Array<
    Record<string, unknown>
  >;
  const newMessages = allMessages.slice(startIdx);

  let response = '';
  const scannedFiles: ScannedFile[] = [];
  const generatedSvgs: GeneratedSvg[] = [];

  for (const m of newMessages) {
    if (String(m.sender ?? '') === 'assistant') {
      const content = (m.content ?? []) as Array<Record<string, unknown>>;
      const textPieces: string[] = [];
      for (const block of content) {
        if (
          String(block.type ?? '') === 'text' &&
          typeof block.text === 'string'
        ) {
          textPieces.push(block.text);
        }
      }
      response = textPieces.join('');
    }
    const scanned = scanMessageForGenerated(m);
    scannedFiles.push(...scanned.files);
    generatedSvgs.push(...scanned.svgs);
  }

  return { response, scannedFiles, generatedSvgs };
}

// ============================================================================
// Write: Create Conversation / Send Message
// ============================================================================

const NULL_PARENT_UUID = '00000000-0000-4000-8000-000000000000';

/**
 * POST to /completion and drain the SSE stream. Returns when Claude closes
 * the stream (end of generation). The body is discarded — the resulting
 * assistant message is retrieved via getConversation().
 */
async function postCompletionAndDrain(
  orgId: string,
  conversationId: string,
  prompt: string,
  parentMessageUuid: string,
  fileIds: string[] = [],
): Promise<void> {
  const response = await fetch(
    `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}/completion`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        prompt,
        parent_message_uuid: parentMessageUuid,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        attachments: [],
        files: fileIds,
        sync_sources: [],
        rendering_mode: 'messages',
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  const reader = response.body!.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

/**
 * Create a new Claude conversation and send the first message. Returns when
 * Claude finishes streaming its reply, along with any files Claude generated.
 */
export async function createConversation(
  opts: CreateConversationInput,
): Promise<CreateConversationOutput> {
  const conversationId = crypto.randomUUID();

  await claudeFetch<unknown>(
    `/api/organizations/${opts.orgId}/chat_conversations`,
    {
      method: 'POST',
      body: JSON.stringify({ uuid: conversationId, name: '' }),
    },
  );

  const fileIds = await resolveAttachments(
    opts.orgId,
    conversationId,
    opts.files,
  );

  await postCompletionAndDrain(
    opts.orgId,
    conversationId,
    opts.message,
    NULL_PARENT_UUID,
    fileIds,
  );

  const raw = await fetchConversationRaw(opts.orgId, conversationId);
  const { response, scannedFiles, generatedSvgs } = harvestFromRaw(raw, 0);
  const generatedFiles = await previewAllGenerated(
    opts.orgId,
    conversationId,
    scannedFiles,
  );

  return {
    conversationId,
    response,
    generatedFiles,
    generatedSvgs,
  };
}

/**
 * Send a follow-up message in an existing conversation. Resolves the
 * parent message UUID automatically, streams the reply, and downloads any
 * files Claude generated during the turn.
 */
export async function sendMessage(
  opts: SendMessageInput,
): Promise<SendMessageOutput> {
  const beforeRaw = await fetchConversationRaw(opts.orgId, opts.conversationId);
  const beforeMessages = (beforeRaw.chat_messages ?? []) as Array<
    Record<string, unknown>
  >;
  const lastBefore = beforeMessages[beforeMessages.length - 1];
  const parentUuid = lastBefore
    ? String(lastBefore.uuid ?? NULL_PARENT_UUID)
    : NULL_PARENT_UUID;
  const sentinelIdx = beforeMessages.length;

  const fileIds = await resolveAttachments(
    opts.orgId,
    opts.conversationId,
    opts.files,
  );

  await postCompletionAndDrain(
    opts.orgId,
    opts.conversationId,
    opts.message,
    parentUuid,
    fileIds,
  );

  const afterRaw = await fetchConversationRaw(opts.orgId, opts.conversationId);
  const { response, scannedFiles, generatedSvgs } = harvestFromRaw(
    afterRaw,
    sentinelIdx,
  );
  const generatedFiles = await previewAllGenerated(
    opts.orgId,
    opts.conversationId,
    scannedFiles,
  );

  return {
    conversationId: opts.conversationId,
    response,
    generatedFiles,
    generatedSvgs,
  };
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export all data from a Claude.ai project.
 * Downloads files to device and saves a manifest JSON.
 */
export async function exportProject(opts: {
  orgId: string;
  projectId: string;
  includeConversations?: boolean;
  includeFiles?: boolean;
}): Promise<ExportProjectOutput> {
  const includeConversations = opts.includeConversations ?? true;
  const includeFiles = opts.includeFiles ?? true;

  // Step 1: Get project details
  const project = await getProject({
    orgId: opts.orgId,
    projectId: opts.projectId,
  });

  // Step 2: Get docs
  const { docs } = await listProjectDocs({
    orgId: opts.orgId,
    projectId: opts.projectId,
  });

  const exportData: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    project: {
      uuid: project.uuid,
      name: project.name,
      description: project.description,
      prompt_template: project.prompt_template,
      created_at: project.created_at,
      updated_at: project.updated_at,
      creator: project.creator,
    },
    docs: await Promise.all(
      docs.map(async (d) => {
        const full = await getProjectDoc({
          orgId: opts.orgId,
          projectId: opts.projectId,
          docId: d.uuid,
        });
        return { file_name: full.file_name, content: full.content };
      }),
    ),
  };

  // Step 3: Download files
  const { files: projectFiles } = await listProjectFiles({
    orgId: opts.orgId,
    projectId: opts.projectId,
  });

  const downloadedFiles: Array<{
    name: string;
    mimeType: string;
    size: number;
    path?: string;
    status: string;
  }> = [];

  if (includeFiles && projectFiles.length > 0) {
    for (const file of projectFiles) {
      try {
        const result = await getFileContent({
          orgId: opts.orgId,
          fileId: file.uuid,
          filename: file.file_name,
        });
        downloadedFiles.push({
          name: result.fileName,
          mimeType: result.mimeType,
          size: result.size,
          path: result.fileRef?.path,
          status: 'downloaded',
        });
      } catch (err) {
        downloadedFiles.push({
          name: file.file_name,
          mimeType: file.file_type,
          size: file.file_size,
          status: `failed: ${(err as Error).message}`,
        });
      }
    }
  }

  exportData.files = downloadedFiles;

  // Step 4: List conversations (paginate through all)
  const allConversations: Array<{
    uuid: string;
    name: string;
    created_at: string;
    updated_at: string;
  }> = [];

  if (includeConversations) {
    let offset = 0;
    const limit = 30;
    let hasMore = true;

    while (hasMore) {
      const page = await listProjectConversations({
        orgId: opts.orgId,
        projectId: opts.projectId,
        limit,
        offset,
      });
      allConversations.push(...page.conversations);
      hasMore = page.hasMore;
      offset += limit;
    }
  }

  exportData.conversations = allConversations;

  // Step 5: Save manifest
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = project.name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  const manifestFilename = `claude-export-${safeName}-${timestamp}.json`;
  const manifestContent = JSON.stringify(exportData, null, 2);

  const manifestRef = await saveToDevice(manifestFilename, manifestContent);

  return {
    projectName: project.name,
    docsFound: docs.length,
    filesDownloaded: downloadedFiles.filter((f) => f.status === 'downloaded')
      .length,
    filesFailed: downloadedFiles.filter((f) => f.status !== 'downloaded')
      .length,
    conversationsFound: allConversations.length,
    manifestFilename,
    ...(manifestRef ? { manifestFileRef: manifestRef } : { manifestContent }),
    files: downloadedFiles,
  };
}
