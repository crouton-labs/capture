import type {
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
} from './schemas-pages';
import { Validation, NotFound, UpstreamError, ContractDrift, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Constants
// ============================================================================

const TRPC_BASE = 'https://gateway.prod.day.ai/trpc';
const GRAPHQL_URL = 'https://day.ai/api/graphql';

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

interface GraphQLResponse<T> {
  data: T | null;
  errors?: Array<{ message: string; path?: string[] }>;
}

async function graphqlCall<T>(
  accessToken: string,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'auth-provider': 'supabase',
    },
    body: JSON.stringify({ operationName, query, variables }),
  });

  let json: GraphQLResponse<T>;
  try {
    json = (await resp.json()) as GraphQLResponse<T>;
  } catch {
    throwForStatus(resp.status, `non-JSON response on ${operationName}`);
  }

  if (!resp.ok) {
    const messages =
      json!.errors?.map((e) => e.message).join('; ') ?? 'Unknown error';
    throwForStatus(resp.status, `${operationName}: ${messages}`);
  }

  if (json!.errors?.length) {
    const messages = json!.errors.map((e) => e.message).join('; ');
    throw new UpstreamError(`Day.ai GraphQL error on ${operationName}: ${messages}`);
  }

  if (json!.data === null || json!.data === undefined) {
    throw new ContractDrift(`Day.ai GraphQL returned null data for ${operationName}`);
  }

  return json!.data;
}

// ============================================================================
// Page Functions
// ============================================================================

/**
 * List all pages in the workspace.
 */
export async function listPages(
  opts: ListPagesInput,
): Promise<ListPagesOutput> {
  const offset = opts.offset ? opts.offset : '1970-01-01T00:00:00.000Z';
  const rawLimit = opts.limit ?? 100;
  const limit = Math.max(1, Math.min(rawLimit, 10000));

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_page',
      offset,
      limit,
    },
  );

  return { pages: items as ListPagesOutput['pages'] };
}

const PAGE_FIELDS = `
  id
  title
  contentJson
  contentHtml
  ownerEmail
  workspaceId
  createdAt
  updatedAt
  shortLinkHash
  madeExternalAt
  emoji
  isKnowledge
  templateType
  headerImage
  publishedForUserAt
  parentObject {
    objectId
    objectType
  }
  crmObjects {
    objectId
    objectType
    properties
    workspaceId
  }
  aiInitialPrompt
  aiPopulationCompletedAt
  sourceTemplate {
    id
    templateType
  }
  domains
  actionIds
  people
`;

const INSTRUCTIONS_FIELDS = `
  instructions {
    id
    userId
    workspaceId
    pageTitle
    createdAt
    updatedAt
  }
`;

const AUTHORIZATION_FIELDS = `
  authorization {
    workspace {
      isShared
    }
    users {
      id
      accessLevel
    }
  }
`;

/**
 * Get full page content by UUID.
 */
export async function getPage(opts: GetPageInput): Promise<GetPageOutput> {
  const authFields = opts.includeAuthorization ? AUTHORIZATION_FIELDS : '';
  const instructionsFields = opts.includeInstructions
    ? INSTRUCTIONS_FIELDS
    : '';

  const data = await graphqlCall<{
    workspacePage: GetPageOutput['page'];
  }>(
    opts.accessToken,
    'GetPage',
    `query GetPage($workspaceId: String!, $id: String!) {
      workspacePage(workspaceId: $workspaceId, id: $id) {
        ${PAGE_FIELDS}
        ${authFields}
        ${instructionsFields}
      }
    }`,
    { workspaceId: opts.workspaceId, id: opts.pageId },
  );

  if (!data.workspacePage) {
    throw new NotFound(`Page not found: ${opts.pageId}`);
  }

  return { page: data.workspacePage };
}

/**
 * Create a new page in the workspace.
 */
export async function createPage(
  opts: CreatePageInput,
): Promise<CreatePageOutput> {
  const contentJson = opts.contentJson ?? {
    type: 'doc',
    content: [
      {
        type: 'title',
        content: opts.title ? [{ type: 'text', text: opts.title }] : [],
      },
      { type: 'paragraph', content: [] },
    ],
  };
  const contentHtml = opts.contentHtml ?? `<h1>${opts.title}</h1>`;

  const input: Record<string, unknown> = {
    title: opts.title,
    contentJson,
    contentHtml,
    workspaceId: opts.workspaceId,
  };
  if (opts.templateType !== undefined) input.templateType = opts.templateType;
  if (opts.emoji !== undefined) input.emoji = opts.emoji;
  if (opts.headerImage !== undefined) input.headerImage = opts.headerImage;
  if (opts.ownerEmail !== undefined) input.ownerEmail = opts.ownerEmail;
  if (opts.publishedForUserAt !== undefined)
    input.publishedForUserAt = opts.publishedForUserAt;
  if (opts.madeExternalAt !== undefined)
    input.madeExternalAt = opts.madeExternalAt;
  if (opts.aiInitialPrompt !== undefined)
    input.aiInitialPrompt = opts.aiInitialPrompt;
  if (opts.sourceTemplateId !== undefined)
    input.sourceTemplateId = opts.sourceTemplateId;
  if (opts.objectType !== undefined) input.objectType = opts.objectType;
  if (opts.objectId !== undefined) input.objectId = opts.objectId;
  if (opts.crmObjects !== undefined) input.crmObjects = opts.crmObjects;

  const data = await graphqlCall<{ createPage: CreatePageOutput['page'] }>(
    opts.accessToken,
    'CreatePage',
    `mutation CreatePage($input: CreatePageInput!) {
      createPage(input: $input) {
        ${PAGE_FIELDS}
      }
    }`,
    { input },
  );

  return { page: data.createPage };
}

/**
 * Update an existing page's title, content, emoji, header image, sharing,
 * knowledge status, template type, or linked CRM objects.
 */
export async function updatePage(
  opts: UpdatePageInput,
): Promise<UpdatePageOutput> {
  const input: Record<string, unknown> = {
    workspaceId: opts.workspaceId,
  };
  if (opts.title !== undefined) input.title = opts.title;
  if (opts.contentJson !== undefined) input.contentJson = opts.contentJson;
  if (opts.contentHtml !== undefined) input.contentHtml = opts.contentHtml;
  if (opts.emoji !== undefined) input.emoji = opts.emoji;
  if (opts.headerImage !== undefined) input.headerImage = opts.headerImage;
  if (opts.madeExternalAt !== undefined)
    input.madeExternalAt = opts.madeExternalAt;
  if (opts.templateType !== undefined) input.templateType = opts.templateType;
  if (opts.publishedForUserAt !== undefined)
    input.publishedForUserAt = opts.publishedForUserAt;
  if (opts.shortLinkHash !== undefined)
    input.shortLinkHash = opts.shortLinkHash;
  if (opts.crmObjects !== undefined) {
    if (opts.crmObjects.length === 0) {
      throw new Validation(
        'updatePage: crmObjects empty array is not supported; the Day.ai backend silently ignores it and existing links remain. To replace linked objects, pass the desired non-empty set.',
      );
    }
    input.crmObjects = opts.crmObjects;
  }

  const data = await graphqlCall<{ updatePage: UpdatePageOutput['page'] }>(
    opts.accessToken,
    'UpdatePage',
    `mutation UpdatePage($id: String!, $input: UpdatePageInput!) {
      updatePage(id: $id, input: $input) {
        ${PAGE_FIELDS}
      }
    }`,
    { id: opts.pageId, input },
  );

  return { page: data.updatePage };
}

/**
 * Permanently delete a page by UUID.
 */
export async function deletePage(
  opts: DeletePageInput,
): Promise<DeletePageOutput> {
  const data = await graphqlCall<{ deletePage: { id: string } }>(
    opts.accessToken,
    'DeletePage',
    `mutation DeletePage($id: String!) {
      deletePage(id: $id) {
        id
      }
    }`,
    { id: opts.pageId },
  );

  return { id: data.deletePage.id };
}

// ============================================================================
// Draft Functions
// ============================================================================

/**
 * List all email drafts in the workspace.
 */
export async function listDrafts(
  opts: ListDraftsInput,
): Promise<ListDraftsOutput> {
  const offset = opts.offset ? opts.offset : '1970-01-01T00:00:00.000Z';
  const limit = opts.limit ? opts.limit : 100;

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_draft',
      offset,
      limit,
    },
  );

  return { drafts: items as ListDraftsOutput['drafts'] };
}

/**
 * Get a single email draft by UUID.
 * Uses GraphQL workspaceDraft query for direct lookup.
 */
export async function getDraft(opts: GetDraftInput): Promise<GetDraftOutput> {
  const emailFields = opts.includeEmail
    ? `email { subject to from cc bcc }`
    : '';
  const authFields =
    opts.includePage && opts.includeAuthorization ? AUTHORIZATION_FIELDS : '';
  const pageFields = opts.includePage
    ? `page { ${PAGE_FIELDS} ${authFields} }`
    : '';

  let data: { workspaceDraft: GetDraftOutput['draft'] };
  try {
    data = await graphqlCall<{
      workspaceDraft: GetDraftOutput['draft'];
    }>(
      opts.accessToken,
      'GetDraft',
      `query GetDraft($workspaceId: String!, $id: String!) {
        workspaceDraft(workspaceId: $workspaceId, id: $id) {
          id type status channel workspaceId createdAt updatedAt
          parent { objectId objectType }
          ${emailFields}
          ${pageFields}
        }
      }`,
      { workspaceId: opts.workspaceId, id: opts.draftId },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Day.ai returns HTTP 500 (not 404) for non-existent draft IDs.
    // Convert to a descriptive error so callers can distinguish bad IDs from real failures.
    if (/HTTP 5\d\d/.test(msg)) {
      throw new NotFound(
        `getDraft: Draft not found with ID: ${opts.draftId}. Day.ai returns HTTP 500 for missing draft IDs.`,
      );
    }
    throw err;
  }

  if (!data.workspaceDraft) {
    throw new NotFound(`getDraft: Draft not found with ID: ${opts.draftId}`);
  }

  return { draft: data.workspaceDraft };
}

// ============================================================================
// Email Functions
// ============================================================================

const WORK_ACCOUNTS_QUERY = `
  query GetWorkAccounts($ownerEmail: String!) {
    workAccounts(ownerEmail: $ownerEmail) {
      id email provider
    }
  }
`;

const SEND_EMAIL_MUTATION = `
  mutation SendEmail($workAccountId: Int!, $emailData: EmailData!) {
    sendEmail(workAccountId: $workAccountId, emailData: $emailData)
  }
`;

/**
 * Send an email via the connected Gmail account.
 * Looks up the user's connected work account automatically using their email.
 */
export async function sendEmail(
  opts: SendEmailInput,
): Promise<SendEmailOutput> {
  // Look up the user's connected work account
  const accountData = await graphqlCall<{
    workAccounts: Array<{ id: number; email: string; provider: string }>;
  }>(opts.accessToken, 'GetWorkAccounts', WORK_ACCOUNTS_QUERY, {
    ownerEmail: opts.email,
  });

  if (accountData.workAccounts.length === 0) {
    throw new NotFound(
      'sendEmail: No connected email account found. Connect Gmail in Day.ai workspace settings.',
    );
  }

  const workAccount = accountData.workAccounts[0];

  const emailData: Record<string, unknown> = {
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
  };
  if (opts.cc && opts.cc.length > 0) emailData.cc = opts.cc;

  const data = await graphqlCall<{ sendEmail: boolean }>(
    opts.accessToken,
    'SendEmail',
    SEND_EMAIL_MUTATION,
    {
      workAccountId: workAccount.id,
      emailData,
    },
  );

  return {
    success: data.sendEmail,
    fromEmail: workAccount.email,
  };
}
