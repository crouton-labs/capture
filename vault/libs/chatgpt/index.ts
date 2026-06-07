/**
 * ChatGPT Library - Export projects, files, and conversations from ChatGPT
 *
 * Runs in the browser via CDP. Requires user to be logged into chatgpt.com.
 */

export type {
  GetContextOutput,
  ListProjectsOutput,
  GetProjectOutput,
  DownloadFileOutput,
  GetProjectFileContentOutput,
  ListAllConversationsOutput,
  ListConversationsOutput,
  GetConversationOutput,
  GetConversationBatchOutput,
  ExportProjectOutput,
  ListMemoriesOutput,
  CreateConversationInput,
  CreateConversationOutput,
  SendMessageInput,
  SendMessageOutput,
  ProjectFile,
  Conversation,
} from './schemas';

import type {
  GetContextOutput,
  ListProjectsOutput,
  GetProjectOutput,
  DownloadFileOutput,
  GetProjectFileContentInput,
  GetProjectFileContentOutput,
  ListAllConversationsOutput,
  ListConversationsOutput,
  GetConversationOutput,
  GetConversationBatchOutput,
  ExportProjectOutput,
  ListMemoriesOutput,
  CreateConversationInput,
  CreateConversationOutput,
  SendMessageInput,
  SendMessageOutput,
} from './schemas';
import type { FileRef } from '../files/schemas';

import { ContractDrift, Unauthenticated, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// File Save (Northlight Files API)
// ============================================================================

type SentinelTriple = {
  chatRequirementsToken: string;
  proofToken?: string;
  turnstileToken?: string;
  expiresAtMs: number;
};

declare const window: Window & {
  __vallum_files?: {
    write(
      name: string,
      data: string | ArrayBuffer | Uint8Array | Blob,
    ): Promise<FileRef>;
    read(identifier: string | { path: string }): Promise<ArrayBuffer>;
  };
  __vallum_chatgpt_sentinel?: SentinelTriple;
  __vallum_chatgpt_sentinel_debug?: string[];
  __sentinel_token_pending?: unknown;
  __sentinel_init_pending?: unknown;
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

async function readAttachmentBytes(ref: FileRef): Promise<ArrayBuffer> {
  if (!ref?.path) throw new Error('fileRef.path is required');
  if (!window.__vallum_files) throw new Error('__vallum_files not available');
  return window.__vallum_files.read({ path: ref.path });
}

function uuid(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================================
// Internal Helpers
// ============================================================================

function unixToIso(value: unknown): string {
  if (value == null || value === '') return '';
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num) || num <= 0) return '';
  return new Date(num * 1000).toISOString();
}

async function chatgptFetch<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const base = window.location.origin;
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
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
    throw new ContractDrift(`ChatGPT returned non-JSON response: ${truncated}`);
  }
}

// ============================================================================
// Client Info (user-variant header values)
//
// ChatGPT's backend requires `oai-device-id`, `oai-client-version`, and
// `oai-client-build-number` on write requests. These identify the user's
// browser profile and the deployed bundle version. They are read from
// localStorage / the page HTML rather than hard-coded so the library follows
// rolling deploys without edits.
// ============================================================================

type ClientInfo = {
  deviceId: string;
  sessionId: string;
  clientVersion: string;
  buildNumber: string;
  language: string;
  timezone: string;
  timezoneOffsetMin: number;
};

let cachedClientInfo: ClientInfo | null = null;

function discoverClientVersion(): string {
  const v = document.documentElement.dataset.build;
  if (v) return v;
  throw new Error(
    'Could not discover oai-client-version from page. Are you on chatgpt.com?',
  );
}

function discoverBuildNumber(): string {
  return document.documentElement.dataset.seq ?? '';
}

function getDeviceId(): string {
  for (const k of ['oai-did', 'oai/device-id', 'oai:device-id', 'device-id']) {
    const v = localStorage.getItem(k);
    if (v) return v.replace(/^"|"$/g, '');
  }
  const generated = uuid();
  try {
    localStorage.setItem('oai-did', generated);
  } catch {
    // ignore
  }
  return generated;
}

function getClientInfo(): ClientInfo {
  if (cachedClientInfo) return cachedClientInfo;
  cachedClientInfo = {
    deviceId: getDeviceId(),
    sessionId: uuid(),
    clientVersion: discoverClientVersion(),
    buildNumber: discoverBuildNumber(),
    language: navigator.language || 'en-US',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffsetMin: -new Date().getTimezoneOffset(),
  };
  return cachedClientInfo;
}

// ChatGPT's web bundle relays a server-minted integrity token via the
// `__Secure-oai-is` cookie. The token format is `ois1.{header}.{iv}.{ct+tag}`
// and is replayed as the `x-oai-is` header on every authenticated write. The
// server rotates it by sending `x-oai-is-update` on responses, which the
// browser stores back into the same cookie.
const OAI_IS_COOKIE = '__Secure-oai-is';
const OAI_IS_REGEX = /^ois1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const OAI_IS_MAX_AGE_SECONDS = 720 * 60 * 60;

function isValidOaiIs(v: string | undefined): v is string {
  return (
    !!v &&
    v.length > 0 &&
    v.length <= 2048 &&
    v.trim() === v &&
    OAI_IS_REGEX.test(v)
  );
}

function getOaiIntegrityToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const cookies = document.cookie.split(';');
  for (const raw of cookies) {
    const c = raw.trim();
    const eq = c.indexOf('=');
    if (eq < 0) continue;
    if (c.slice(0, eq) !== OAI_IS_COOKIE) continue;
    const value = c.slice(eq + 1);
    if (isValidOaiIs(value)) return value;
  }
  return undefined;
}

function setOaiIntegrityToken(value: string): void {
  if (typeof document === 'undefined') return;
  if (!isValidOaiIs(value)) return;
  document.cookie =
    `${OAI_IS_COOKIE}=${value}; Max-Age=${OAI_IS_MAX_AGE_SECONDS}; ` +
    `Path=/; SameSite=Lax; Secure`;
}

function buildBaseHeaders(
  targetPath: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const info = getClientInfo();
  const headers: Record<string, string> = {
    accept: '*/*',
    'accept-language': `${info.language},${info.language.split('-')[0]};q=0.9`,
    'content-type': 'application/json',
    'oai-client-version': info.clientVersion,
    'oai-device-id': info.deviceId,
    'oai-language': info.language,
    'oai-session-id': info.sessionId,
    'oai-telemetry': '[1,null]',
    'x-openai-target-path': targetPath,
    'x-openai-target-route': targetPath,
    ...extra,
  };
  if (info.buildNumber) headers['oai-client-build-number'] = info.buildNumber;
  const oaiIs = getOaiIntegrityToken();
  if (oaiIs) headers['x-oai-is'] = oaiIs;
  return headers;
}

// ============================================================================
// Sentinel Token Interception
//
// Every write to /backend-api/f/conversation requires three anti-bot tokens:
//   - openai-sentinel-chat-requirements-token  (from /sentinel/.../finalize response)
//   - openai-sentinel-proof-token              (same `proofofwork` sent to /finalize)
//   - openai-sentinel-turnstile-token          (same `turnstile` solution sent to /finalize)
//
// The `turnstile` and `proofofwork` values are produced by live browser JS:
// Cloudflare Turnstile + a runtime fingerprint probe. They cannot be computed
// off-browser. Instead, we install a one-time fetch wrapper that captures the
// triple from ChatGPT's own UI-initiated sentinel flow (which fires naturally
// while the user is typing or opening the app) and reuses it for our writes.
// The chat-requirements token is valid for 540s.
// ============================================================================

let sentinelInterceptorInstalled = false;

function recordSeenUrl(url: string): void {
  const dbg = (window.__vallum_chatgpt_sentinel_debug ??= []);
  if (dbg.length < 50) dbg.push(url);
}

function looksLikeSentinelUrl(url: string): boolean {
  return /\/sentinel\/.*chat-requirements/.test(url);
}

function mergeSentinelFields(
  reqBody: Record<string, unknown> | null,
  resp: Record<string, unknown> | null,
): void {
  const token = (resp?.token ??
    resp?.chat_requirements_token ??
    resp?.chatRequirementsToken) as string | undefined;
  const proof = (reqBody?.proofofwork ??
    reqBody?.proof_of_work ??
    reqBody?.p ??
    resp?.proofofwork ??
    resp?.proof_of_work) as string | undefined;
  const turnstile = (reqBody?.turnstile ??
    reqBody?.turnstile_token ??
    resp?.turnstile ??
    resp?.turnstile_token) as string | undefined;
  const expireAt = (resp?.expire_at ?? resp?.expiresAt) as number | undefined;
  const expireAfter = (resp?.expire_after ?? resp?.expiresAfter) as
    | number
    | undefined;

  if (!token && !proof && !turnstile) return;

  const prev = window.__vallum_chatgpt_sentinel;
  const next: SentinelTriple = {
    chatRequirementsToken: token ?? prev?.chatRequirementsToken ?? '',
    proofToken: proof ?? prev?.proofToken,
    turnstileToken: turnstile ?? prev?.turnstileToken,
    expiresAtMs: expireAt
      ? expireAt * 1000
      : expireAfter
        ? Date.now() + expireAfter * 1000
        : (prev?.expiresAtMs ?? Date.now() + 540 * 1000),
  };
  if (next.chatRequirementsToken) window.__vallum_chatgpt_sentinel = next;
}

async function readBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Record<string, unknown> | null> {
  if (init?.body && typeof init.body === 'string') {
    try {
      return JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (input instanceof Request) {
    try {
      return (await input.clone().json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function captureFromResponse(
  url: string,
  reqBody: Record<string, unknown> | null,
  respBody: Record<string, unknown> | null,
): void {
  recordSeenUrl(url);
  mergeSentinelFields(reqBody, respBody);
}

function installSentinelInterceptor(): void {
  if (sentinelInterceptorInstalled) return;
  sentinelInterceptorInstalled = true;

  // Wrap fetch
  const origFetch = window.fetch.bind(window);
  (window as unknown as { fetch: typeof fetch }).fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    // Pre-clone Request inputs for sentinel URLs. Request.body is a one-shot
    // stream; after origFetch consumes it, .clone() either throws or returns
    // a disturbed clone whose .json() silently fails — which is why
    // proofofwork/turnstile were never captured before this fix.
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    let preCloned: Request | null = null;
    if (input instanceof Request && looksLikeSentinelUrl(url)) {
      try {
        preCloned = input.clone();
      } catch {
        // ignore — fall through to readBody, may still work for string init.body
      }
    }

    const response = await origFetch(input, init);
    try {
      const update = response.headers.get('x-oai-is-update');
      if (update) setOaiIntegrityToken(update);
    } catch {
      // best-effort
    }
    try {
      if (looksLikeSentinelUrl(url)) {
        let reqBody: Record<string, unknown> | null = null;
        if (preCloned) {
          try {
            reqBody = (await preCloned.json()) as Record<string, unknown>;
          } catch {
            reqBody = null;
          }
        } else {
          reqBody = await readBody(input, init);
        }
        let respBody: Record<string, unknown> | null = null;
        try {
          respBody = (await response.clone().json()) as Record<string, unknown>;
        } catch {
          respBody = null;
        }
        captureFromResponse(url, reqBody, respBody);
      }
    } catch {
      // interception is best-effort; never break the original fetch
    }
    return response;
  };

  // Wrap XHR (in case ChatGPT's bundle holds a cached fetch reference, or
  // moves the sentinel call to XMLHttpRequest)
  type XhrState = { url?: string; reqBody?: Record<string, unknown> | null };
  const xhrState = new WeakMap<XMLHttpRequest, XhrState>();
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    xhrState.set(this, { url: url.toString() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origOpen as any).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const state = xhrState.get(this) ?? {};
    if (typeof body === 'string') {
      try {
        state.reqBody = JSON.parse(body) as Record<string, unknown>;
      } catch {
        state.reqBody = null;
      }
    }
    xhrState.set(this, state);
    if (state.url && looksLikeSentinelUrl(state.url)) {
      this.addEventListener('load', () => {
        try {
          const respBody = JSON.parse(this.responseText) as Record<
            string,
            unknown
          >;
          captureFromResponse(state.url ?? '', state.reqBody ?? null, respBody);
        } catch {
          // best-effort
        }
      });
    }
    return origSend.call(this, body);
  } as typeof XMLHttpRequest.prototype.send;
}

async function maybeReadFromChatGPTGlobals(
  timeoutMs: number,
): Promise<SentinelTriple | null> {
  const isThenable = (v: unknown): v is PromiseLike<unknown> =>
    !!v && typeof (v as { then?: unknown }).then === 'function';

  const initPending = window.__sentinel_init_pending;
  if (isThenable(initPending)) {
    try {
      await Promise.race([
        Promise.resolve(initPending),
        new Promise((r) => setTimeout(r, timeoutMs)),
      ]);
    } catch {
      // best-effort init wait
    }
  }

  let resolved: unknown = window.__sentinel_token_pending;
  if (isThenable(resolved)) {
    try {
      resolved = await Promise.race([
        Promise.resolve(resolved),
        new Promise((r) => setTimeout(() => r(null), timeoutMs)),
      ]);
    } catch {
      resolved = null;
    }
  }
  if (!resolved || typeof resolved !== 'object') return null;
  mergeSentinelFields(null, resolved as Record<string, unknown>);
  return window.__vallum_chatgpt_sentinel ?? null;
}

// Drive ChatGPT's own composer to send a one-token message. This is the only
// path that mints fresh sentinel tokens — the UI must actually submit, focus
// and typing alone don't trigger the /sentinel/finalize call. We add a small
// amount of pointer/keystroke noise so the resulting POST inherits a stronger
// behavioral context, which the bot detector weighs against the score for
// subsequent programmatic /f/conversation calls.
//
// Only runs when the caller supplied a token (we need it to hide the seed
// conversation afterwards) and we are on a fresh-chat URL (otherwise the send
// would append to an existing conversation and pollute user data).
async function seedSentinelTokensViaUI(
  token: string,
  timeoutMs: number,
): Promise<SentinelTriple | null> {
  if (typeof document === 'undefined') return null;
  if (window.location.pathname !== '/') return null;

  const composer = document.querySelector<HTMLElement>('#prompt-textarea');
  if (!composer) return null;

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const jitter = (min: number, max: number) =>
    wait(min + Math.floor(Math.random() * (max - min)));

  // Brief pointer activity establishes that a human-ish cursor is on the page
  for (let i = 0; i < 3; i++) {
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 200 + Math.floor(Math.random() * 400),
        clientY: 200 + Math.floor(Math.random() * 300),
      }),
    );
    await jitter(40, 110);
  }

  composer.focus();
  composer.dispatchEvent(new Event('focus', { bubbles: true }));
  await jitter(90, 220);

  const seedTexts = ['hi', 'hello', 'hey', 'test', 'ok', 'yo'];
  const text = seedTexts[Math.floor(Math.random() * seedTexts.length)];
  document.execCommand('insertText', false, text);
  composer.dispatchEvent(
    new InputEvent('input', { bubbles: true, data: text }),
  );
  await jitter(220, 480);

  const sendBtn = document.querySelector<HTMLButtonElement>(
    '[data-testid="send-button"]',
  );
  if (!sendBtn) return null;
  sendBtn.click();

  const deadline = Date.now() + timeoutMs;
  let seedConvId: string | null = null;
  while (Date.now() < deadline) {
    await wait(200);
    const m = window.location.pathname.match(/^\/c\/([0-9a-fA-F-]+)/);
    if (m) seedConvId = m[1];
    const t = window.__vallum_chatgpt_sentinel;
    if (seedConvId && t && t.expiresAtMs > Date.now() + 30000) {
      try {
        await deleteConversation({ token, conversationId: seedConvId });
      } catch {
        // non-fatal: leave the seed conversation visible rather than failing
      }
      return t;
    }
  }
  return null;
}

async function acquireSentinelTokens(
  opts: { token?: string; timeoutMs?: number } = {},
): Promise<SentinelTriple> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const startTime = Date.now();
  installSentinelInterceptor();
  const SAFETY_MARGIN_MS = 30000;
  const fresh = (): SentinelTriple | null => {
    const t = window.__vallum_chatgpt_sentinel;
    return t && t.expiresAtMs > Date.now() + SAFETY_MARGIN_MS ? t : null;
  };

  const cached = fresh();
  if (cached) return cached;

  // Primary: read from ChatGPT's own pending globals if present
  const fromGlobals = await maybeReadFromChatGPTGlobals(
    Math.min(timeoutMs, 5000),
  );
  if (fromGlobals) {
    window.__vallum_chatgpt_sentinel = fromGlobals;
    return fromGlobals;
  }

  // Auto-seed by driving the UI when we have a token to clean up afterwards.
  if (opts.token) {
    const remaining = Math.max(5000, timeoutMs - (Date.now() - startTime));
    const seeded = await seedSentinelTokensViaUI(opts.token, remaining);
    if (seeded) return seeded;
  }

  // Fallback: wait for the fetch/XHR interceptor to capture a finalize call
  const deadline = startTime + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const t = fresh();
    if (t) return t;
  }

  const seen = window.__vallum_chatgpt_sentinel_debug ?? [];
  const sentinelGlobals = Object.keys(window).filter((k) =>
    /sentinel/i.test(k),
  );
  throw new Error(
    '[SENTINEL_REQUIRED] No ChatGPT sentinel tokens captured. ' +
      "These are minted only when ChatGPT's UI actually submits a message. " +
      'Workflow: (1) attach to a visible chatgpt.com tab, (2) call getContext() to install the ' +
      'token interceptor, (3) drive a one-character UI submit via DOM (focus #prompt-textarea, ' +
      "execCommand('insertText', false, '.'), click [data-testid=\"send-button\"]), " +
      '(4) wait briefly for the URL to become /c/{id}, (5) call deleteConversation({token, conversationId}) ' +
      'to hide the seed, then retry. Tokens are good for ~8 minutes after capture. ' +
      `Diagnostic — sentinel-related URLs observed: ${JSON.stringify(seen)}; ` +
      `sentinel-named window globals: ${JSON.stringify(sentinelGlobals)}.`,
  );
}

// ============================================================================
// Context Acquisition
// ============================================================================

/**
 * Get auth token and user info from ChatGPT session.
 * Call this FIRST before any other ChatGPT operations.
 */
export async function getContext(
  opts: { timeoutMs?: number } = {},
): Promise<GetContextOutput> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const startTime = Date.now();

  while (!window.location.hostname.includes('chatgpt.com')) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Unauthenticated(
        `[AUTH_REQUIRED] Not logged in to ChatGPT. Could not reach chatgpt.com.`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Install as early as possible so any UI-triggered sentinel flow during
  // the rest of the session is captured for later writes.
  installSentinelInterceptor();

  const base = window.location.origin;
  const resp = await fetch(`${base}/api/auth/session`, {
    credentials: 'include',
  });

  if (!resp.ok) {
    throw new Unauthenticated(
      `[AUTH_REQUIRED] Not logged in to ChatGPT. HTTP ${resp.status} from /api/auth/session.`,
    );
  }

  const data = await resp.json();

  if (!data.accessToken) {
    throw new Unauthenticated(
      `[AUTH_REQUIRED] Not logged in to ChatGPT. No session token found.`,
    );
  }

  return {
    token: data.accessToken,
    userId: data.user?.id ?? '',
    userName: data.user?.name ?? '',
    userEmail: data.user?.email ?? '',
  };
}

// ============================================================================
// Projects (Gizmos)
// ============================================================================

/**
 * List all user's ChatGPT projects.
 */
export async function listProjects(opts: {
  token: string;
  cursor?: string;
  limit?: number;
}): Promise<ListProjectsOutput> {
  const params = new URLSearchParams({
    conversations_per_gizmo: '5',
    owned_only: 'true',
  });
  if (opts.cursor) params.set('cursor', opts.cursor);

  const data = await chatgptFetch<Record<string, unknown>>(
    opts.token,
    `/backend-api/gizmos/snorlax/sidebar?${params}`,
  );

  const items = (data?.items ?? []) as Array<Record<string, unknown>>;

  const projects = items.map((item: Record<string, unknown>) => {
    // Response nests as item.gizmo.gizmo (wrapper → inner gizmo)
    const gizmoWrapper = (item.gizmo ?? {}) as Record<string, unknown>;
    const gizmo = (gizmoWrapper.gizmo ?? gizmoWrapper) as Record<
      string,
      unknown
    >;
    const display = (gizmo.display ?? {}) as Record<string, unknown>;
    return {
      id: String(gizmo.id ?? ''),
      name: String(display.name ?? ''),
      description: String(display.description ?? ''),
      createdAt: String(gizmo.created_at ?? ''),
      updatedAt: String(gizmo.updated_at ?? ''),
    };
  });

  const cursor = (data?.cursor ?? null) as string | null;

  return { projects, cursor };
}

/**
 * Get full project details including instructions, files, and tools.
 */
export async function getProject(opts: {
  token: string;
  gizmoId: string;
}): Promise<GetProjectOutput> {
  const data = await chatgptFetch<Record<string, unknown>>(
    opts.token,
    `/backend-api/gizmos/${opts.gizmoId}`,
  );

  const gizmo = (data?.gizmo ?? data) as Record<string, unknown>;
  const display = (gizmo.display ?? {}) as Record<string, unknown>;
  const files = ((data?.files ?? []) as Array<Record<string, unknown>>).map(
    (f) => ({
      id: String(f.file_id ?? f.id ?? ''),
      name: String(f.name ?? f.file_name ?? ''),
      mimeType: String(f.type ?? f.mime_type ?? ''),
      size: Number(f.size ?? f.file_size ?? 0),
    }),
  );

  return {
    id: String(gizmo.id ?? ''),
    name: String(display.name ?? ''),
    description: String(display.description ?? ''),
    instructions: String(gizmo.instructions ?? ''),
    files,
    tools: ((data?.tools ?? []) as Array<Record<string, unknown>>).map((t) => ({
      type: String(t.type ?? ''),
      id: String(t.id ?? ''),
    })),
    createdAt: String(gizmo.created_at ?? ''),
    updatedAt: String(gizmo.updated_at ?? ''),
    numInteractions: Number(gizmo.num_interactions ?? 0),
  };
}

// ============================================================================
// Files
// ============================================================================

async function fetchFileDownload(
  token: string,
  fileId: string,
  gizmoId: string,
): Promise<{
  downloadUrl: string;
  fileName: string;
  rawMimeType: string | undefined;
  fileSize: number;
  response: Response;
}> {
  const downloadInfo = await chatgptFetch<{
    status: string;
    download_url?: string;
    file_name?: string;
    mime_type?: string;
    file_size_bytes?: number;
  }>(token, `/backend-api/files/download/${fileId}?gizmo_id=${gizmoId}`);

  if (downloadInfo.status !== 'success' && !downloadInfo.download_url) {
    throw new ContractDrift(
      `File download failed for ${fileId}: ${JSON.stringify(downloadInfo)}`,
    );
  }

  const downloadUrl = String(downloadInfo.download_url);
  const fileName = String(downloadInfo.file_name ?? fileId);
  const fileSize = Number(downloadInfo.file_size_bytes ?? 0);

  // Signed URLs already contain embedded auth; don't leak bearer token to CDN
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throwForStatus(response.status, `Failed to download file: ${fileName}`);
  }

  return {
    downloadUrl,
    fileName,
    rawMimeType: downloadInfo.mime_type,
    fileSize,
    response,
  };
}

/**
 * Download a file from a ChatGPT project and save to device.
 */
export async function downloadFile(opts: {
  token: string;
  fileId: string;
  gizmoId: string;
  filename?: string;
}): Promise<DownloadFileOutput> {
  const {
    fileName: defaultName,
    rawMimeType,
    fileSize,
    response,
  } = await fetchFileDownload(opts.token, opts.fileId, opts.gizmoId);

  const fileName = opts.filename ?? defaultName;
  const mimeType = rawMimeType ?? 'application/octet-stream';
  const contentBuffer = await response.arrayBuffer();
  const fileRef = await saveToDevice(fileName, contentBuffer);

  return {
    fileName,
    mimeType,
    size: fileSize || contentBuffer.byteLength,
    ...(fileRef ? { fileRef } : {}),
  };
}

/**
 * Get the text content of a file from a ChatGPT project.
 */
export async function getProjectFileContent(
  opts: GetProjectFileContentInput,
): Promise<GetProjectFileContentOutput> {
  const { fileName, rawMimeType, response } = await fetchFileDownload(
    opts.token,
    opts.fileId,
    opts.gizmoId,
  );

  const mimeType = rawMimeType ?? 'text/plain';
  const content = await response.text();

  return { fileName, mimeType, content };
}

// ============================================================================
// Conversations
// ============================================================================

/**
 * List all conversations across ChatGPT (the sidebar conversation list).
 * Returns conversations ordered by most recently updated.
 */
export async function listAllConversations(opts: {
  token: string;
  offset?: number;
  limit?: number;
}): Promise<ListAllConversationsOutput> {
  const params = new URLSearchParams({
    order: 'updated',
    offset: String(opts.offset ?? 0),
    limit: String(opts.limit ?? 28),
  });

  const data = await chatgptFetch<Record<string, unknown>>(
    opts.token,
    `/backend-api/conversations?${params}`,
  );

  const items = ((data?.items ?? []) as Array<Record<string, unknown>>).map(
    (c) => ({
      id: String(c.id ?? ''),
      title: String(c.title ?? ''),
      createTime: unixToIso(c.create_time),
      updateTime: unixToIso(c.update_time),
      isArchived: Boolean(c.is_archived ?? false),
      gizmoId: (c.gizmo_id as string) ?? null,
      snippet: String(c.snippet ?? ''),
    }),
  );

  const total = Number(data?.total ?? 0);
  const hasMore = items.length >= (opts.limit ?? 28);

  return { conversations: items, total, hasMore };
}

/**
 * List conversations for a ChatGPT project.
 */
export async function listConversations(opts: {
  token: string;
  gizmoId: string;
  cursor?: string;
  limit?: number;
}): Promise<ListConversationsOutput> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));

  const data = await chatgptFetch<Record<string, unknown>>(
    opts.token,
    `/backend-api/gizmos/${opts.gizmoId}/conversations?${params}`,
  );

  const items = ((data?.items ?? []) as Array<Record<string, unknown>>).map(
    (c) => ({
      id: String(c.id ?? ''),
      title: String(c.title ?? ''),
      createTime: unixToIso(c.create_time),
      updateTime: unixToIso(c.update_time),
      isArchived: Boolean(c.is_archived ?? false),
    }),
  );

  const cursor = (data?.cursor ?? null) as string | null;

  return { conversations: items, cursor };
}

/**
 * Get full conversation content with all messages.
 */
export async function getConversation(opts: {
  token: string;
  conversationId: string;
}): Promise<GetConversationOutput> {
  const data = await chatgptFetch<Record<string, unknown>>(
    opts.token,
    `/backend-api/conversation/${opts.conversationId}`,
  );

  const title = String(data?.title ?? '');
  const createTime = unixToIso(data?.create_time);
  const updateTime = unixToIso(data?.update_time);
  const mapping = (data?.mapping ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  // Extract messages from the mapping tree in order
  const messages: Array<{
    id: string;
    role: string;
    content: string;
    createTime: string;
  }> = [];

  // Walk the message tree from current_node backwards
  const currentNode = String(data?.current_node ?? '');
  const visited = new Set<string>();
  const nodeOrder: string[] = [];

  // Build order by walking parents
  let nodeId = currentNode;
  while (nodeId && !visited.has(nodeId) && mapping[nodeId]) {
    visited.add(nodeId);
    nodeOrder.unshift(nodeId);
    const node = mapping[nodeId];
    nodeId = String(node.parent ?? '');
  }

  for (const nid of nodeOrder) {
    const node = mapping[nid];
    const message = node?.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const author = (message.author ?? {}) as Record<string, unknown>;
    const role = String(author.role ?? '');
    if (!role || role === 'system') continue;

    const contentObj = (message.content ?? {}) as Record<string, unknown>;
    const parts = (contentObj.parts ?? []) as unknown[];
    const contentText = parts.filter((p) => typeof p === 'string').join('\n');

    messages.push({
      id: String(message.id ?? nid),
      role,
      content: contentText,
      createTime: unixToIso(message.create_time),
    });
  }

  return {
    id: String(data?.id ?? opts.conversationId),
    title,
    createTime,
    updateTime,
    messages,
  };
}

/**
 * Fetch multiple conversations in parallel.
 * More efficient than individual getConversation calls when used via executeLibFunction
 * because it collapses N HTTP requests into a single browser execution.
 */
export async function getConversationBatch(opts: {
  token: string;
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
        getConversation({ token: opts.token, conversationId: id }),
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
// Conversation Writes (API-driven, no DOM)
//
// The /backend-api/f/conversation endpoint accepts a JSON body and streams
// back an SSE response of JSON-patch-style deltas describing the assistant's
// reply as it is generated. This section implements the three-step flow the
// ChatGPT web UI performs for every send:
//   1) Upload any attachments via /backend-api/files (3-step Azure blob flow)
//   2) Call /backend-api/f/conversation/prepare to get a 60s conduit_token
//   3) POST /backend-api/f/conversation with sentinel headers and parse SSE
// ============================================================================

type UploadedAttachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  libraryFileId: string;
};

// Images upload through the `multimodal` pipeline (no retrieval indexing).
// Everything else goes through `my_files` with retrieval indexing on.
function attachmentUseCase(mimeType: string): {
  use_case: 'multimodal' | 'my_files';
  index_for_retrieval: boolean;
} {
  if (mimeType.startsWith('image/')) {
    return { use_case: 'multimodal', index_for_retrieval: false };
  }
  return { use_case: 'my_files', index_for_retrieval: true };
}

async function uploadAttachment(
  token: string,
  ref: FileRef,
): Promise<UploadedAttachment> {
  const info = getClientInfo();
  const buffer = await readAttachmentBytes(ref);
  const size = buffer.byteLength;
  const mimeType = ref.contentType || 'application/octet-stream';
  const name = ref.name;
  const { use_case, index_for_retrieval } = attachmentUseCase(mimeType);

  const create = await chatgptFetch<{
    status: string;
    upload_url?: string;
    file_id?: string;
  }>(token, '/backend-api/files', {
    method: 'POST',
    body: JSON.stringify({
      file_name: name,
      file_size: size,
      use_case,
      timezone_offset_min: info.timezoneOffsetMin,
      reset_rate_limits: false,
      store_in_library: true,
      library_persistence_mode: 'opportunistic',
    }),
  });
  if (create.status !== 'success' || !create.upload_url || !create.file_id) {
    throw new Error(
      `ChatGPT file creation failed for ${name}: ${JSON.stringify(create)}`,
    );
  }

  const put = await fetch(create.upload_url, {
    method: 'PUT',
    body: buffer,
    headers: {
      'content-type': mimeType,
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': '2020-04-08',
    },
  });
  if (!put.ok) {
    throw new Error(
      `ChatGPT blob upload failed for ${name}: ${put.status} ${put.statusText}`,
    );
  }

  const processResp = await fetch(
    `${window.location.origin}/backend-api/files/process_upload_stream`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_id: create.file_id,
        use_case,
        index_for_retrieval,
        file_name: name,
        library_persistence_mode: 'opportunistic',
        metadata: { store_in_library: true },
        entry_surface: 'chat_composer',
      }),
    },
  );
  if (!processResp.ok || !processResp.body) {
    throw new Error(
      `ChatGPT file process_upload_stream failed for ${name}: ${processResp.status}`,
    );
  }

  // Response is labelled text/event-stream but actually NDJSON — bare JSON
  // objects separated by single \n, no `data:` prefix, no `\n\n` framing.
  // Older shapes used SSE-style framing, so accept either.
  const reader = processResp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let libraryFileId = '';
  let completed = false;
  const deadline = Date.now() + 120000;

  const consumeLine = (rawLine: string): void => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    const payload = trimmed.startsWith('data:')
      ? trimmed.slice(5).trim()
      : trimmed;
    if (!payload || payload === '[DONE]') return;
    let ev: {
      event?: string;
      type?: string;
      extra?: { metadata_object_id?: string };
    };
    try {
      ev = JSON.parse(payload);
    } catch {
      return;
    }
    const libId = ev.extra?.metadata_object_id;
    if (typeof libId === 'string' && libId.startsWith('libfile_')) {
      libraryFileId = libId;
    }
    const eventName = ev.event ?? ev.type;
    if (
      eventName === 'file.processing.completed' ||
      eventName === 'file.indexing.completed'
    ) {
      if (libraryFileId) completed = true;
    }
  };

  while (Date.now() < deadline && !completed) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      consumeLine(line);
      if (completed) break;
    }
  }
  // Flush trailing line if the server didn't terminate with \n.
  if (!completed && buf) consumeLine(buf);
  try {
    await reader.cancel();
  } catch {
    // ignore
  }

  if (!libraryFileId) {
    throw new Error(`ChatGPT indexing did not complete for ${name}`);
  }
  return { id: create.file_id, name, size, mimeType, libraryFileId };
}

async function fConversationPrepare(params: {
  token: string;
  conversationId?: string;
  parentMessageId: string;
  model: string;
  attachmentMimeTypes: string[];
  turnTraceId: string;
}): Promise<string> {
  const info = getClientInfo();
  const path = '/backend-api/f/conversation/prepare';
  const resp = await fetch(`${window.location.origin}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildBaseHeaders(path, {
      Authorization: `Bearer ${params.token}`,
      'x-conduit-token': 'no-token',
      'x-oai-turn-trace-id': params.turnTraceId,
    }),
    body: JSON.stringify({
      action: 'next',
      fork_from_shared_post: false,
      parent_message_id: params.parentMessageId,
      model: params.model,
      client_prepare_state: 'none',
      timezone_offset_min: info.timezoneOffsetMin,
      timezone: info.timezone,
      conversation_mode: { kind: 'primary_assistant' },
      system_hints: [],
      attachment_mime_types: params.attachmentMimeTypes,
      supports_buffering: true,
      supported_encodings: ['v1'],
      client_contextual_info: { app_name: 'chatgpt.com' },
      ...(params.conversationId
        ? { conversation_id: params.conversationId }
        : {}),
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `ChatGPT /f/conversation/prepare failed ${resp.status}: ${body.slice(0, 500)}`,
    );
  }
  const data = (await resp.json()) as { conduit_token?: string };
  if (!data.conduit_token) {
    throw new Error(
      'ChatGPT /f/conversation/prepare returned no conduit_token',
    );
  }
  return data.conduit_token;
}

type StreamResult = {
  conversationId: string;
  assistantMessageId: string;
  response: string;
};

async function parseConversationStream(
  stream: ReadableStream<Uint8Array>,
  knownConversationId: string | undefined,
): Promise<StreamResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  let conversationId = knownConversationId ?? '';
  let assistantMessageId = '';
  let responseText = '';
  let lastAppendPath = '';
  let completed = false;

  type StreamEvent = {
    type?: string;
    conversation_id?: string;
    o?: string;
    p?: string;
    v?: unknown;
  };

  const applyOp = (ev: StreamEvent): void => {
    if (typeof ev.conversation_id === 'string') {
      conversationId = ev.conversation_id;
    }

    if (ev.type === 'resume_conversation_token') return;
    if (ev.type === 'message_stream_complete') {
      completed = true;
      return;
    }

    if (
      ev.o === 'add' &&
      ev.v &&
      typeof ev.v === 'object' &&
      (ev.v as { message?: unknown }).message
    ) {
      const message = (ev.v as { message: Record<string, unknown> }).message;
      const author = message.author as { role?: string } | undefined;
      if (author?.role === 'assistant') {
        if (typeof message.id === 'string') assistantMessageId = message.id;
        const parts = ((message.content as { parts?: unknown[] } | undefined)
          ?.parts ?? []) as unknown[];
        const first = parts[0];
        if (typeof first === 'string') responseText = first;
      }
      return;
    }

    if (
      ev.o === 'append' &&
      ev.p === '/message/content/parts/0' &&
      typeof ev.v === 'string'
    ) {
      responseText += ev.v;
      lastAppendPath = ev.p;
      return;
    }

    // Bare continuation: `{v: "..."}` appends to the last path.
    if (
      ev.o === undefined &&
      ev.p === undefined &&
      typeof ev.v === 'string' &&
      lastAppendPath === '/message/content/parts/0'
    ) {
      responseText += ev.v;
      return;
    }

    if (ev.o === 'patch' && Array.isArray(ev.v)) {
      for (const op of ev.v as StreamEvent[]) applyOp(op);
    }
  };

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !completed) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const rawLine of block.split('\n')) {
        const line = rawLine.replace(/^\s+/, '');
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          completed = true;
          break;
        }
        try {
          applyOp(JSON.parse(payload) as StreamEvent);
        } catch {
          // Non-JSON payloads (rare) are safe to ignore
        }
      }
      if (completed) break;
    }
  }
  try {
    await reader.cancel();
  } catch {
    // ignore
  }

  if (!conversationId) {
    throw new Error(
      'ChatGPT /f/conversation stream ended without conversation_id',
    );
  }
  return { conversationId, assistantMessageId, response: responseText };
}

function pickDefaultModel(): string {
  for (const key of [
    'oai/apps-sdk-gizmo-model',
    'oai-selected-model',
    'chat-gpt/model',
  ]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'id' in parsed &&
        typeof (parsed as { id: unknown }).id === 'string'
      ) {
        return (parsed as { id: string }).id;
      }
    } catch {
      // ignore
    }
  }
  return 'auto';
}

async function submitConversationMessage(params: {
  token: string;
  message: string;
  conversationId?: string;
  parentMessageId: string;
  model: string;
  fileRefs?: FileRef[];
}): Promise<StreamResult> {
  const info = getClientInfo();
  const sentinel = await acquireSentinelTokens({ token: params.token });

  const attachments: UploadedAttachment[] = [];
  if (params.fileRefs?.length) {
    for (const ref of params.fileRefs) {
      attachments.push(await uploadAttachment(params.token, ref));
    }
  }

  const turnTraceId = uuid();
  const conduitToken = await fConversationPrepare({
    token: params.token,
    conversationId: params.conversationId,
    parentMessageId: params.parentMessageId,
    model: params.model,
    attachmentMimeTypes: attachments.map((a) => a.mimeType),
    turnTraceId,
  });

  const userMessageId = uuid();
  const attachmentMetadata =
    attachments.length > 0
      ? {
          attachments: attachments.map((a) => ({
            id: a.id,
            size: a.size,
            name: a.name,
            mime_type: a.mimeType,
            source: 'library',
            library_file_id: a.libraryFileId,
            is_big_paste: false,
          })),
        }
      : {};

  const body = {
    action: 'next',
    messages: [
      {
        id: userMessageId,
        author: { role: 'user' },
        create_time: Date.now() / 1000,
        content: { content_type: 'text', parts: [params.message] },
        metadata: {
          ...attachmentMetadata,
          selected_github_repos: [],
          selected_all_github_repos: false,
          serialization_metadata: { custom_symbol_offsets: [] },
        },
      },
    ],
    parent_message_id: params.parentMessageId,
    model: params.model,
    client_prepare_state: 'sent',
    timezone_offset_min: info.timezoneOffsetMin,
    timezone: info.timezone,
    conversation_mode: { kind: 'primary_assistant' },
    enable_message_followups: true,
    system_hints: [],
    supports_buffering: true,
    supported_encodings: ['v1'],
    client_contextual_info: {
      is_dark_mode: false,
      time_since_loaded: Math.round(performance.now() / 1000),
      page_height: window.innerHeight,
      page_width: window.innerWidth,
      pixel_ratio: window.devicePixelRatio,
      screen_height: window.screen.height,
      screen_width: window.screen.width,
      app_name: 'chatgpt.com',
    },
    paragen_cot_summary_display_override: 'allow',
    force_parallel_switch: 'auto',
    ...(params.conversationId
      ? { conversation_id: params.conversationId }
      : {}),
  };

  const path = '/backend-api/f/conversation';
  const resp = await fetch(`${window.location.origin}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildBaseHeaders(path, {
      Authorization: `Bearer ${params.token}`,
      accept: 'text/event-stream',
      'openai-sentinel-chat-requirements-token': sentinel.chatRequirementsToken,
      ...(sentinel.proofToken
        ? { 'openai-sentinel-proof-token': sentinel.proofToken }
        : {}),
      ...(sentinel.turnstileToken
        ? { 'openai-sentinel-turnstile-token': sentinel.turnstileToken }
        : {}),
      'x-conduit-token': conduitToken,
      'x-oai-turn-trace-id': turnTraceId,
    }),
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `ChatGPT /f/conversation failed ${resp.status}: ${text.slice(0, 500)}`,
    );
  }

  return parseConversationStream(resp.body, params.conversationId);
}

/**
 * Create a new ChatGPT conversation by POSTing to the conversation API
 * directly. Works from any ChatGPT page; no navigation required.
 */
export async function createConversation(
  opts: CreateConversationInput,
): Promise<CreateConversationOutput> {
  const result = await submitConversationMessage({
    token: opts.token,
    message: opts.message,
    parentMessageId: 'client-created-root',
    model: pickDefaultModel(),
    fileRefs: opts.fileRefs as FileRef[] | undefined,
  });
  return {
    conversationId: result.conversationId,
    response: result.response,
  };
}

/**
 * Send a follow-up message in an existing ChatGPT conversation via the
 * conversation API. Works from any ChatGPT page; no navigation required.
 */
export async function sendMessage(
  opts: SendMessageInput,
): Promise<SendMessageOutput> {
  const current = await getConversation({
    token: opts.token,
    conversationId: opts.conversationId,
  });
  const lastAssistant = [...current.messages]
    .reverse()
    .find((m) => m.role === 'assistant');
  if (!lastAssistant) {
    throw new Error(
      `No prior assistant message in conversation ${opts.conversationId} to anchor the reply to`,
    );
  }

  const result = await submitConversationMessage({
    token: opts.token,
    message: opts.message,
    conversationId: opts.conversationId,
    parentMessageId: lastAssistant.id,
    model: pickDefaultModel(),
    fileRefs: opts.fileRefs as FileRef[] | undefined,
  });
  return {
    conversationId: result.conversationId,
    response: result.response,
  };
}

/**
 * Hide a conversation from the sidebar (the same action ChatGPT's UI performs
 * when you "delete" a conversation). Used to clean up the sentinel-seed
 * conversation after harvesting tokens.
 */
export async function deleteConversation(opts: {
  token: string;
  conversationId: string;
}): Promise<{ success: boolean }> {
  const data = await chatgptFetch<{ success?: boolean }>(
    opts.token,
    `/backend-api/conversation/${opts.conversationId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ is_visible: false }),
    },
  );
  return { success: Boolean(data?.success ?? true) };
}

// ============================================================================
// Memories
// ============================================================================

/**
 * Get memories/context stored for a project.
 */
export async function listMemories(opts: {
  token: string;
  gizmoId?: string;
}): Promise<ListMemoriesOutput> {
  const params = new URLSearchParams({
    include_memory_entries: 'true',
  });
  if (opts.gizmoId) {
    params.set('gizmo_id', opts.gizmoId);
    params.set('exclusive_to_gizmo', 'false');
  }

  const data = await chatgptFetch<Record<string, unknown>>(
    opts.token,
    `/backend-api/memories?${params}`,
  );

  return {
    memories: ((data?.memories ?? []) as Array<Record<string, unknown>>).map(
      (m) => ({
        id: String(m.id ?? ''),
        content: String(m.content ?? m.value ?? ''),
        createdAt: String(m.created_at ?? ''),
      }),
    ),
    maxTokens: Number(data?.memory_max_tokens ?? 0),
    usedTokens: Number(data?.memory_num_tokens ?? 0),
  };
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export all data from a ChatGPT project: instructions, files, and conversation list.
 * Downloads all project files to device and saves a project manifest JSON.
 */
export async function exportProject(opts: {
  token: string;
  gizmoId: string;
  includeConversations?: boolean;
  includeFiles?: boolean;
}): Promise<ExportProjectOutput> {
  const includeConversations = opts.includeConversations ?? true;
  const includeFiles = opts.includeFiles ?? true;

  // Step 1: Get project details
  const project = await getProject({
    token: opts.token,
    gizmoId: opts.gizmoId,
  });

  const exportData: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      instructions: project.instructions,
      tools: project.tools,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      numInteractions: project.numInteractions,
    },
  };

  // Step 2: Download files
  const downloadedFiles: Array<{
    name: string;
    mimeType: string;
    size: number;
    path?: string;
    status: string;
  }> = [];

  if (includeFiles && project.files.length > 0) {
    for (const file of project.files) {
      try {
        const result = await downloadFile({
          token: opts.token,
          fileId: file.id,
          gizmoId: opts.gizmoId,
          filename: file.name,
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
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          status: `failed: ${(err as Error).message}`,
        });
      }
    }
  }

  exportData.files = downloadedFiles;

  // Step 3: List conversations (paginate through all)
  const allConversations: Array<{
    id: string;
    title: string;
    createTime: string;
    updateTime: string;
  }> = [];

  if (includeConversations) {
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const page = await listConversations({
        token: opts.token,
        gizmoId: opts.gizmoId,
        cursor,
        limit: 50,
      });
      allConversations.push(...page.conversations);
      cursor = page.cursor ?? undefined;
      hasMore = !!cursor;
    }
  }

  exportData.conversations = allConversations;

  // Step 4: Save manifest
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = project.name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  const manifestFilename = `chatgpt-export-${safeName}-${timestamp}.json`;
  const manifestContent = JSON.stringify(exportData, null, 2);

  const manifestRef = await saveToDevice(manifestFilename, manifestContent);

  return {
    projectName: project.name,
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
