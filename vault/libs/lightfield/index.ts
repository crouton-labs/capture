/**
 * Lightfield CRM Library - Browser-executable CRM operations via AI chat and direct API
 *
 * Lightfield uses Stytch session cookies for auth (sent automatically).
 * CRM mutations happen through the AI chatbot's tool calls or direct GraphQL.
 */

export * from './schemas';

import type {
  GetContextOutput,
  SendChatInput,
  SendChatOutput,
  ListAccountsInput,
  ListAccountsOutput,
  GetAccountInput,
  GetAccountOutput,
  CreateAccountInput,
  CreateAccountOutput,
  UpdateAccountInput,
  UpdateAccountOutput,
  DeleteAccountInput,
  DeleteAccountOutput,
  ListContactsInput,
  ListContactsOutput,
  GetContactInput,
  GetContactOutput,
  CreateContactInput,
  CreateContactOutput,
  DeleteContactInput,
  DeleteContactOutput,
  ListOpportunitiesInput,
  ListOpportunitiesOutput,
  GetOpportunityInput,
  GetOpportunityOutput,
  CreateOpportunityInput,
  CreateOpportunityOutput,
  DeleteOpportunityInput,
  DeleteOpportunityOutput,
  ListTasksInput,
  ListTasksOutput,
  GetTaskInput,
  GetTaskOutput,
  CreateTaskInput,
  CreateTaskOutput,
  UpdateTaskInput,
  UpdateTaskOutput,
  DeleteTaskInput,
  DeleteTaskOutput,
  ListNotesInput,
  ListNotesOutput,
  GetNoteInput,
  GetNoteOutput,
  CreateNoteInput,
  CreateNoteOutput,
  DeleteNoteInput,
  DeleteNoteOutput,
  ListMeetingsInput,
  ListMeetingsOutput,
} from './schemas';

import { UpstreamError, ContractDrift, Unauthenticated, NotFound, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Helpers
// ============================================================================

const BACKEND_URL = 'https://backend.lightfield.app';

function generateId(length = 16): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateThreadId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `thread_${timestamp}${random}`;
}

interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

async function parseSSEStream(response: Response): Promise<{
  messageId: string;
  text: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    output: string | Record<string, unknown>;
  }>;
  finishReason: string;
}> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new UpstreamError('No response body stream available');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let messageId = '';
  let text = '';
  const toolCalls: Map<
    string,
    {
      toolCallId: string;
      toolName: string;
      inputText: string;
      input: Record<string, unknown>;
      output: string | Record<string, unknown>;
    }
  > = new Map();
  let finishReason = 'stop';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    const lastLine = lines.pop();
    buffer = lastLine !== undefined ? lastLine : '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      let event: SSEEvent;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      switch (event.type) {
        case 'start':
          if (typeof event.messageId === 'string') {
            messageId = event.messageId;
          }
          break;

        case 'text-delta':
          if (typeof event.delta === 'string') {
            text += event.delta;
          }
          break;

        case 'tool-input-start': {
          const id = event.toolCallId as string;
          toolCalls.set(id, {
            toolCallId: id,
            toolName: typeof event.toolName === 'string' ? event.toolName : '',
            inputText: '',
            input: {},
            output: '',
          });
          break;
        }

        case 'tool-input-delta': {
          const id = event.toolCallId as string;
          const tc = toolCalls.get(id);
          if (tc && typeof event.inputTextDelta === 'string') {
            tc.inputText += event.inputTextDelta;
          }
          break;
        }

        case 'tool-input-available': {
          const id = event.toolCallId as string;
          const tc = toolCalls.get(id);
          if (tc && event.input != null) {
            tc.input = event.input as Record<string, unknown>;
          }
          break;
        }

        case 'tool-output-available': {
          const id = event.toolCallId as string;
          const tc = toolCalls.get(id);
          if (tc && event.output != null) {
            tc.output = event.output as string | Record<string, unknown>;
          }
          break;
        }

        case 'finish':
          if (typeof event.finishReason === 'string') {
            finishReason = event.finishReason;
          }
          break;
      }
    }
  }

  return {
    messageId,
    text,
    toolCalls: Array.from(toolCalls.values()).map((tc) => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
      output: tc.output,
    })),
    finishReason,
  };
}

interface CrmField {
  id: string;
  key: string;
  label: string;
  type: string;
  value: unknown;
  system?: boolean;
}

interface GraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

async function graphql(
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphQLResponse> {
  const body: Record<string, unknown> = { query };
  if (variables) {
    body.variables = variables;
  }

  const response = await fetch(`${BACKEND_URL}/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throwForStatus(response.status);
  }

  const data = (await response.json()) as GraphQLResponse;
  if (data.errors?.length) {
    throw new ContractDrift(
      `GraphQL error: ${data.errors[0].message}. URL: ${window.location.href}`,
    );
  }

  return data;
}

function toEpochMs(dateStr: string): number {
  return new Date(dateStr).getTime();
}

function textToSlate(
  text: string,
): Array<{ type: string; children: Array<{ text: string }> }> {
  return [{ type: 'paragraph', children: [{ text }] }];
}

// ============================================================================
// GraphQL Queries
// ============================================================================

const CRM_OBJECTS_QUERY = `query CRM_OBJECTS_QUERY(
  $crmObjectType: CrmObjectType!,
  $limit: Int!,
  $offset: Int!,
  $sortBy: [SortInput!]!,
  $filterBy: [FilterInput!]!,
  $objectStatus: GQLCrmObjectStatus
) {
  crmObjects(
    crmObjectType: $crmObjectType,
    limit: $limit,
    offset: $offset,
    sortBy: $sortBy,
    filterBy: $filterBy,
    objectStatus: $objectStatus
  ) {
    edges {
      node {
        id
        crmAccount {
          id name websites createdAt updatedAt ownerUserId objectStatus
          crmOpportunityCount lastInteractionAt nextInteractionAt
          crmFields { id type key label value system }
        }
        crmContact {
          id orgId profilePhotoUrl createdAt updatedAt objectStatus
          crmAccountIds lastInteractionAt nextInteractionAt
          crmFields { id type key label value system }
        }
        crmOpportunity {
          id createdAt updatedAt objectStatus
          crmFields { id type key label value system }
        }
        crmTask {
          id title status description assignedToUserId crmAccountId createdAt updatedAt
        }
        crmNote {
          id title content createdAt updatedAt
        }
        crmMeeting {
          id startDate endDate updatedAt
        }
      }
    }
    pageInfo { hasNextPage hasPreviousPage totalCount }
  }
}`;

interface CrmObjectsEdge {
  node: {
    id: string;
    crmAccount?: {
      id: string;
      name: string;
      websites: string[];
      createdAt: string;
      updatedAt: string;
      ownerUserId: string;
      objectStatus: string;
      crmOpportunityCount: number;
      crmFields: CrmField[];
    };
    crmContact?: {
      id: string;
      orgId: string;
      createdAt: string;
      updatedAt: string;
      objectStatus: string;
      crmAccountIds: string[];
      crmFields: CrmField[];
    };
    crmOpportunity?: {
      id: string;
      createdAt: string;
      updatedAt: string;
      objectStatus: string;
      crmFields: CrmField[];
    };
    crmTask?: {
      id: string;
      title: string;
      status: string;
      description: Array<{ type: string; children: Array<{ text: string }> }>;
      assignedToUserId: string;
      crmAccountId: string;
      createdAt: string;
      updatedAt: string;
    };
    crmNote?: {
      id: string;
      title: string;
      content: Array<{ type: string; children: Array<{ text: string }> }>;
      createdAt: string;
      updatedAt: string;
    };
    crmMeeting?: {
      id: string;
      startDate: string;
      endDate: string;
      updatedAt: string;
    };
  };
}

async function queryCrmObjects(
  crmObjectType: string,
  limit: number,
  offset: number,
  sortBy: Array<{ key: string; direction: string }>,
  objectStatus: string,
): Promise<{
  edges: CrmObjectsEdge[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    totalCount: number;
  };
}> {
  const result = await graphql(CRM_OBJECTS_QUERY, {
    crmObjectType,
    limit,
    offset,
    sortBy,
    filterBy: [],
    objectStatus,
  });

  const crmObjects = (result.data as Record<string, unknown>)?.crmObjects as
    | {
        edges: CrmObjectsEdge[];
        pageInfo: {
          hasNextPage: boolean;
          hasPreviousPage: boolean;
          totalCount: number;
        };
      }
    | undefined;

  return {
    edges: crmObjects?.edges ?? [],
    pageInfo: crmObjects?.pageInfo ?? {
      hasNextPage: false,
      hasPreviousPage: false,
      totalCount: 0,
    },
  };
}

const SINGLE_OBJECT_QUERY = `query($id: String!, $crmObjectType: CrmObjectType!) {
  crmObject(id: $id, crmObjectType: $crmObjectType) {
    id
    crmAccount {
      id name websites createdAt updatedAt ownerUserId objectStatus
      crmOpportunityCount
      crmFields { id type key label value system }
    }
    crmContact {
      id orgId createdAt updatedAt objectStatus
      crmFields { id type key label value system }
    }
    crmOpportunity {
      id createdAt updatedAt objectStatus
      crmFields { id type key label value system }
    }
    crmTask {
      id title status description assignedToUserId crmAccountId createdAt updatedAt
    }
    crmNote {
      id title content createdAt updatedAt
    }
    crmMeeting {
      id startDate endDate updatedAt
    }
  }
}`;

// ============================================================================
// getContext
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  const result = await graphql('{ me { id email name } }');

  const me = (
    result.data as { me?: { id?: string; email?: string; name?: string } }
  )?.me;
  if (!me?.id) {
    throw new Unauthenticated(
      `User not authenticated. URL: ${window.location.href}. Navigate to crm.lightfield.app and log in.`,
    );
  }
  if (!me.email) {
    throw new ContractDrift(
      `Email not found in user context. URL: ${window.location.href}`,
    );
  }
  if (!me.name) {
    throw new ContractDrift(
      `User name not found in context. URL: ${window.location.href}`,
    );
  }

  return { userId: me.id, email: me.email, name: me.name };
}

// ============================================================================
// sendChat
// ============================================================================

export async function sendChat(params: SendChatInput): Promise<SendChatOutput> {
  const threadId = params.threadId || generateThreadId();
  const messageId = generateId();

  const body = {
    modelName: params.modelName || 'sonnet_4_6',
    threadId,
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    enabledMcpConnectors: [],
    message: {
      parts: [{ type: 'text', text: params.message }],
      id: messageId,
      role: 'user',
    },
  };

  const response = await fetch(`${BACKEND_URL}/qnaChat/chat/default`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throwForStatus(response.status);
  }

  const result = await parseSSEStream(response);

  return {
    messageId: result.messageId,
    threadId,
    text: result.text,
    toolCalls: result.toolCalls,
    finishReason: result.finishReason,
  };
}

// ============================================================================
// Accounts
// ============================================================================

export async function listAccounts(
  params: ListAccountsInput,
): Promise<ListAccountsOutput> {
  const sortBy = (params.sortBy?.filter(Boolean) as Array<{
    key: string;
    direction: string;
  }>) ?? [{ key: 'name', direction: 'ASC' }];

  const result = await queryCrmObjects(
    'ACCOUNT',
    params.limit ?? 20,
    params.offset ?? 0,
    sortBy,
    params.objectStatus ?? 'ACTIVE',
  );

  const accounts = result.edges
    .filter((e) => e.node.crmAccount)
    .map((e) => {
      const a = e.node.crmAccount!;
      return {
        id: a.id,
        name: a.name,
        objectStatus: a.objectStatus,
        ownerUserId: a.ownerUserId,
        createdAt: toEpochMs(a.createdAt),
        updatedAt: toEpochMs(a.updatedAt),
        crmOpportunityCount: a.crmOpportunityCount,
        crmOpportunityIds: undefined,
        crmFields: a.crmFields,
      };
    });

  return { accounts, pageInfo: result.pageInfo };
}

export async function getAccount(
  params: GetAccountInput,
): Promise<GetAccountOutput> {
  const result = await graphql(SINGLE_OBJECT_QUERY, {
    id: params.id,
    crmObjectType: 'ACCOUNT',
  });

  const obj = (result.data as Record<string, unknown>)?.crmObject as
    | CrmObjectsEdge['node']
    | undefined;
  const a = obj?.crmAccount;
  if (!a) {
    throw new NotFound(`Account not found: ${params.id}`);
  }

  return {
    id: a.id,
    name: a.name,
    objectStatus: a.objectStatus,
    ownerUserId: a.ownerUserId,
    createdAt: toEpochMs(a.createdAt),
    updatedAt: toEpochMs(a.updatedAt),
    crmOpportunityCount: a.crmOpportunityCount,
    crmOpportunityIds: undefined,
    crmFields: a.crmFields,
  };
}

export async function createAccount(
  params: CreateAccountInput,
): Promise<CreateAccountOutput> {
  const result = await graphql(
    `
      mutation ($companyName: String!) {
        createCrmAccount(companyName: $companyName) {
          id
          name
          crmFields {
            id
            key
            label
            type
            value
            system
          }
        }
      }
    `,
    { companyName: params.companyName },
  );

  const account = (result.data as Record<string, unknown>)
    ?.createCrmAccount as {
    id: string;
    name: string;
    crmFields: CrmField[];
  };

  return {
    id: account.id,
    name: account.name,
    crmFields: account.crmFields,
  };
}

export async function updateAccount(
  params: UpdateAccountInput,
): Promise<UpdateAccountOutput> {
  const result = await graphql(
    `
      mutation ($id: String!, $crmAccount: UpdateCrmAccountInput!) {
        updateCrmAccount(id: $id, crmAccount: $crmAccount) {
          id
          name
        }
      }
    `,
    { id: params.id, crmAccount: { id: params.id, name: params.name } },
  );

  const account = (result.data as Record<string, unknown>)
    ?.updateCrmAccount as {
    id: string;
    name: string;
  };

  return { id: account.id, name: account.name };
}

export async function deleteAccount(
  params: DeleteAccountInput,
): Promise<DeleteAccountOutput> {
  const result = await graphql(
    `
      mutation ($id: String!) {
        deleteCrmAccount(id: $id) {
          id
        }
      }
    `,
    { id: params.id },
  );

  const account = (result.data as Record<string, unknown>)
    ?.deleteCrmAccount as { id: string };
  return { id: account.id };
}

// ============================================================================
// Contacts
// ============================================================================

export async function listContacts(
  params: ListContactsInput,
): Promise<ListContactsOutput> {
  const sortBy = (params.sortBy?.filter(Boolean) as Array<{
    key: string;
    direction: string;
  }>) ?? [{ key: 'createdAt', direction: 'DESC' }];

  const result = await queryCrmObjects(
    'CONTACT',
    params.limit ?? 20,
    params.offset ?? 0,
    sortBy,
    params.objectStatus ?? 'ACTIVE',
  );

  const contacts = result.edges
    .filter((e) => e.node.crmContact)
    .map((e) => {
      const c = e.node.crmContact!;
      const nameField = c.crmFields?.find((f) => f.key === 'name');
      const nameValue = nameField?.value as
        | { firstName?: string; lastName?: string }
        | undefined;
      const name = nameValue
        ? `${nameValue.firstName ?? ''} ${nameValue.lastName ?? ''}`.trim()
        : undefined;
      return {
        id: c.id,
        name,
        objectStatus: c.objectStatus,
        ownerUserId: undefined,
        createdAt: toEpochMs(c.createdAt),
        updatedAt: toEpochMs(c.updatedAt),
        crmFields: c.crmFields,
      };
    });

  return { contacts, pageInfo: result.pageInfo };
}

export async function getContact(
  params: GetContactInput,
): Promise<GetContactOutput> {
  const result = await graphql(SINGLE_OBJECT_QUERY, {
    id: params.id,
    crmObjectType: 'CONTACT',
  });

  const obj = (result.data as Record<string, unknown>)?.crmObject as
    | CrmObjectsEdge['node']
    | undefined;
  const c = obj?.crmContact;
  if (!c) {
    throw new NotFound(`Contact not found: ${params.id}`);
  }

  const nameField = c.crmFields?.find((f) => f.key === 'name');
  const nameValue = nameField?.value as
    | { firstName?: string; lastName?: string }
    | undefined;
  const name = nameValue
    ? `${nameValue.firstName ?? ''} ${nameValue.lastName ?? ''}`.trim()
    : undefined;

  return {
    id: c.id,
    name,
    objectStatus: c.objectStatus,
    ownerUserId: undefined,
    createdAt: toEpochMs(c.createdAt),
    updatedAt: toEpochMs(c.updatedAt),
    crmFields: c.crmFields,
  };
}

export async function createContact(
  params: CreateContactInput,
): Promise<CreateContactOutput> {
  const result = await graphql(
    `
      mutation ($contact: CreateCrmContactInputV2!) {
        createCrmContactV2(contact: $contact) {
          id
          crmFields {
            id
            key
            label
            type
            value
            system
          }
        }
      }
    `,
    {
      contact: {
        firstName: params.firstName,
        lastName: params.lastName,
        title: params.title,
        crmAccountIds: params.crmAccountIds ?? [],
      },
    },
  );

  const contact = (result.data as Record<string, unknown>)
    ?.createCrmContactV2 as {
    id: string;
    crmFields: CrmField[];
  };

  return { id: contact.id, crmFields: contact.crmFields };
}

export async function deleteContact(
  params: DeleteContactInput,
): Promise<DeleteContactOutput> {
  const result = await graphql(
    `
      mutation ($id: ID!) {
        deleteCrmContact(id: $id)
      }
    `,
    { id: params.id },
  );

  const success = (result.data as Record<string, unknown>)?.deleteCrmContact;
  return { success: success === true };
}

// ============================================================================
// Opportunities
// ============================================================================

export async function listOpportunities(
  params: ListOpportunitiesInput,
): Promise<ListOpportunitiesOutput> {
  const sortBy = (params.sortBy?.filter(Boolean) as Array<{
    key: string;
    direction: string;
  }>) ?? [{ key: 'createdAt', direction: 'DESC' }];

  const result = await queryCrmObjects(
    'OPPORTUNITY',
    params.limit ?? 20,
    params.offset ?? 0,
    sortBy,
    params.objectStatus ?? 'ACTIVE',
  );

  const opportunities = result.edges
    .filter((e) => e.node.crmOpportunity)
    .map((e) => {
      const o = e.node.crmOpportunity!;
      const nameField = o.crmFields?.find(
        (f) => f.key === 'crmOpportunityName',
      );
      return {
        id: o.id,
        name: (nameField?.value as string) ?? undefined,
        objectStatus: o.objectStatus,
        ownerUserId: undefined,
        createdAt: toEpochMs(o.createdAt),
        updatedAt: toEpochMs(o.updatedAt),
        crmFields: o.crmFields,
      };
    });

  return { opportunities, pageInfo: result.pageInfo };
}

export async function getOpportunity(
  params: GetOpportunityInput,
): Promise<GetOpportunityOutput> {
  const result = await graphql(SINGLE_OBJECT_QUERY, {
    id: params.id,
    crmObjectType: 'OPPORTUNITY',
  });

  const obj = (result.data as Record<string, unknown>)?.crmObject as
    | CrmObjectsEdge['node']
    | undefined;
  const o = obj?.crmOpportunity;
  if (!o) {
    throw new NotFound(`Opportunity not found: ${params.id}`);
  }

  const nameField = o.crmFields?.find((f) => f.key === 'crmOpportunityName');

  return {
    id: o.id,
    name: (nameField?.value as string) ?? undefined,
    objectStatus: o.objectStatus,
    ownerUserId: undefined,
    createdAt: toEpochMs(o.createdAt),
    updatedAt: toEpochMs(o.updatedAt),
    crmFields: o.crmFields,
  };
}

export async function createOpportunity(
  params: CreateOpportunityInput,
): Promise<CreateOpportunityOutput> {
  const result = await graphql(
    `
      mutation (
        $crmOpportunity: CreateCrmOpportunityInput!
        $crmAccountId: ID!
        $crmContactIdsToAssociate: [ID!]!
      ) {
        createCrmOpportunity(
          crmOpportunity: $crmOpportunity
          crmAccountId: $crmAccountId
          crmContactIdsToAssociate: $crmContactIdsToAssociate
        ) {
          id
          crmFields {
            id
            key
            label
            type
            value
            system
          }
        }
      }
    `,
    {
      crmOpportunity: {
        name: params.name,
        stage: { id: params.stageId, label: params.stageLabel },
      },
      crmAccountId: params.crmAccountId,
      crmContactIdsToAssociate: params.crmContactIds ?? [],
    },
  );

  const opp = (result.data as Record<string, unknown>)
    ?.createCrmOpportunity as {
    id: string;
    crmFields: CrmField[];
  };

  return { id: opp.id, crmFields: opp.crmFields };
}

export async function deleteOpportunity(
  params: DeleteOpportunityInput,
): Promise<DeleteOpportunityOutput> {
  const result = await graphql(
    `
      mutation ($id: ID!, $crmAccountId: ID!) {
        deleteCrmOpportunity(id: $id, crmAccountId: $crmAccountId) {
          id
        }
      }
    `,
    { id: params.id, crmAccountId: params.crmAccountId },
  );

  const opp = (result.data as Record<string, unknown>)
    ?.deleteCrmOpportunity as { id: string };
  return { id: opp.id };
}

// ============================================================================
// Tasks
// ============================================================================

export async function listTasks(
  params: ListTasksInput,
): Promise<ListTasksOutput> {
  const sortBy = (params.sortBy?.filter(Boolean) as Array<{
    key: string;
    direction: string;
  }>) ?? [{ key: 'createdAt', direction: 'DESC' }];

  const result = await queryCrmObjects(
    'TASK',
    params.limit ?? 20,
    params.offset ?? 0,
    sortBy,
    params.objectStatus ?? 'ACTIVE',
  );

  const tasks = result.edges
    .filter((e) => e.node.crmTask)
    .map((e) => {
      const t = e.node.crmTask!;
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        description: t.description,
        assignedToUserId: t.assignedToUserId,
        crmAccountId: t.crmAccountId,
        createdAt: toEpochMs(t.createdAt),
        updatedAt: toEpochMs(t.updatedAt),
      };
    });

  return { tasks, pageInfo: result.pageInfo };
}

export async function getTask(params: GetTaskInput): Promise<GetTaskOutput> {
  const result = await graphql(SINGLE_OBJECT_QUERY, {
    id: params.id,
    crmObjectType: 'TASK',
  });

  const obj = (result.data as Record<string, unknown>)?.crmObject as
    | CrmObjectsEdge['node']
    | undefined;
  const t = obj?.crmTask;
  if (!t) {
    throw new NotFound(`Task not found: ${params.id}`);
  }

  return {
    id: t.id,
    title: t.title,
    status: t.status,
    description: t.description,
    assignedToUserId: t.assignedToUserId,
    crmAccountId: t.crmAccountId,
    createdAt: toEpochMs(t.createdAt),
    updatedAt: toEpochMs(t.updatedAt),
  };
}

export async function createTask(
  params: CreateTaskInput,
): Promise<CreateTaskOutput> {
  const description = params.description
    ? textToSlate(params.description)
    : textToSlate('');

  const result = await graphql(
    `
      mutation ($task: CrmTaskInput!) {
        createCrmTask(task: $task) {
          id
          title
          status
        }
      }
    `,
    {
      task: {
        title: params.title,
        description,
        status: params.status ?? 'TODO',
        assignedToUserId: params.assignedToUserId,
        crmAccountId: params.crmAccountId,
      },
    },
  );

  const task = (result.data as Record<string, unknown>)?.createCrmTask as {
    id: string;
    title: string;
    status: string;
  };

  return { id: task.id, title: task.title, status: task.status };
}

export async function updateTask(
  params: UpdateTaskInput,
): Promise<UpdateTaskOutput> {
  const taskInput: Record<string, unknown> = {};
  if (params.title !== undefined) taskInput.title = params.title;
  if (params.status !== undefined) taskInput.status = params.status;
  if (params.description !== undefined) {
    taskInput.description = textToSlate(params.description);
  }

  const result = await graphql(
    `
      mutation ($id: String!, $task: UpdateCrmTaskInput!) {
        updateCrmTask(id: $id, task: $task) {
          id
          title
          status
        }
      }
    `,
    { id: params.id, task: taskInput },
  );

  const task = (result.data as Record<string, unknown>)?.updateCrmTask as {
    id: string;
    title: string;
    status: string;
  };

  return { id: task.id, title: task.title, status: task.status };
}

export async function deleteTask(
  params: DeleteTaskInput,
): Promise<DeleteTaskOutput> {
  const result = await graphql(
    `
      mutation ($id: String!) {
        deleteCrmTask(id: $id) {
          id
        }
      }
    `,
    { id: params.id },
  );

  const task = (result.data as Record<string, unknown>)?.deleteCrmTask as {
    id: string;
  };
  return { id: task.id };
}

// ============================================================================
// Notes
// ============================================================================

export async function listNotes(
  params: ListNotesInput,
): Promise<ListNotesOutput> {
  const sortBy = (params.sortBy?.filter(Boolean) as Array<{
    key: string;
    direction: string;
  }>) ?? [{ key: 'createdAt', direction: 'DESC' }];

  const result = await queryCrmObjects(
    'NOTE',
    params.limit ?? 20,
    params.offset ?? 0,
    sortBy,
    params.objectStatus ?? 'ACTIVE',
  );

  const notes = result.edges
    .filter((e) => e.node.crmNote)
    .map((e) => {
      const n = e.node.crmNote!;
      return {
        id: n.id,
        title: n.title,
        content: n.content,
        createdAt: toEpochMs(n.createdAt),
        updatedAt: toEpochMs(n.updatedAt),
      };
    });

  return { notes, pageInfo: result.pageInfo };
}

export async function getNote(params: GetNoteInput): Promise<GetNoteOutput> {
  const result = await graphql(SINGLE_OBJECT_QUERY, {
    id: params.id,
    crmObjectType: 'NOTE',
  });

  const obj = (result.data as Record<string, unknown>)?.crmObject as
    | CrmObjectsEdge['node']
    | undefined;
  const n = obj?.crmNote;
  if (!n) {
    throw new NotFound(`Note not found: ${params.id}`);
  }

  return {
    id: n.id,
    title: n.title,
    content: n.content,
    createdAt: toEpochMs(n.createdAt),
    updatedAt: toEpochMs(n.updatedAt),
  };
}

export async function createNote(
  params: CreateNoteInput,
): Promise<CreateNoteOutput> {
  const variables: Record<string, unknown> = {
    input: { title: params.title },
  };

  let mutation = `mutation($input: CreateCrmNoteInput!) {
    createCrmNote(input: $input) { id title content }
  }`;

  if (params.crmAccountId) {
    mutation = `mutation($input: CreateCrmNoteInput!, $crmAccountId: ID!) {
      createCrmNote(input: $input, crmAccountId: $crmAccountId) { id title content }
    }`;
    variables.crmAccountId = params.crmAccountId;
  }

  const result = await graphql(mutation, variables);

  const note = (result.data as Record<string, unknown>)?.createCrmNote as {
    id: string;
    title: string;
    content: Array<{ type: string; children: Array<{ text: string }> }>;
  };

  return { id: note.id, title: note.title, content: note.content };
}

export async function deleteNote(
  params: DeleteNoteInput,
): Promise<DeleteNoteOutput> {
  const result = await graphql(
    `
      mutation ($id: ID!) {
        deleteCrmNote(id: $id) {
          id
        }
      }
    `,
    { id: params.id },
  );

  const note = (result.data as Record<string, unknown>)?.deleteCrmNote as {
    id: string;
  };
  return { id: note.id };
}

// ============================================================================
// Meetings
// ============================================================================

export async function listMeetings(
  params: ListMeetingsInput,
): Promise<ListMeetingsOutput> {
  const sortBy = (params.sortBy?.filter(Boolean) as Array<{
    key: string;
    direction: string;
  }>) ?? [{ key: 'createdAt', direction: 'DESC' }];

  const result = await queryCrmObjects(
    'MEETING',
    params.limit ?? 20,
    params.offset ?? 0,
    sortBy,
    params.objectStatus ?? 'ACTIVE',
  );

  const meetings = result.edges
    .filter((e) => e.node.crmMeeting)
    .map((e) => {
      const m = e.node.crmMeeting!;
      return {
        id: m.id,
        startDate: m.startDate,
        endDate: m.endDate,
        updatedAt: toEpochMs(m.updatedAt),
      };
    });

  return { meetings, pageInfo: result.pageInfo };
}
