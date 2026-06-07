export * from './schemas';

import { Validation, Unauthenticated, UpstreamError } from '@vallum/_runtime';

import type {
  GetContextInput,
  GetContextOutput,
  ListTeamsInput,
  ListTeamsOutput,
  ListUsersInput,
  ListUsersOutput,
  ListLabelsInput,
  ListLabelsOutput,
  ListProjectsInput,
  ListProjectsOutput,
  ListCyclesInput,
  ListCyclesOutput,
  ListIssuesInput,
  ListIssuesOutput,
  GetIssueInput,
  GetIssueOutput,
  CreateIssueInput,
  CreateIssueOutput,
  UpdateIssueInput,
  UpdateIssueOutput,
  DeleteIssueInput,
  DeleteIssueOutput,
  SearchIssuesInput,
  SearchIssuesOutput,
  AddCommentInput,
  AddCommentOutput,
  ListSubIssuesInput,
  ListSubIssuesOutput,
  ListCommentsInput,
  ListCommentsOutput,
  UpdateCommentInput,
  UpdateCommentOutput,
  DeleteCommentInput,
  DeleteCommentOutput,
  ListAttachmentsInput,
  ListAttachmentsOutput,
  CreateUrlAttachmentInput,
  CreateUrlAttachmentOutput,
  DeleteAttachmentInput,
  DeleteAttachmentOutput,
} from './schemas';

// ============================================================================
// Helpers
// ============================================================================

interface LinearGraphQLClient {
  query(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  mutate(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

function getClient(): LinearGraphQLClient {
  const root = document.getElementById('root');
  if (!root) {
    throw new Validation(
      `Linear: #root element not found. Navigate to https://linear.app first. URL: ${window.location.href}`,
    );
  }

  const containerKey = Object.keys(root).find((k) =>
    k.startsWith('__reactContainer'),
  );
  if (!containerKey) {
    throw new Validation(
      `Linear: React not initialized. Ensure Linear is fully loaded. URL: ${window.location.href}`,
    );
  }

  interface ContextNode {
    memoizedValue?: {
      graphQLClient?: LinearGraphQLClient;
    };
    next?: ContextNode;
  }

  interface FiberNode {
    child?: FiberNode;
    sibling?: FiberNode;
    dependencies?: {
      firstContext?: ContextNode;
    };
  }

  const fiber = (root as unknown as Record<string, FiberNode>)[containerKey];
  const queue: FiberNode[] = [fiber];
  let count = 0;

  while (queue.length > 0 && count < 500) {
    const node = queue.shift();
    if (!node) continue;
    count++;

    let ctx = node.dependencies?.firstContext;
    while (ctx) {
      const client = ctx.memoizedValue?.graphQLClient;
      if (client && typeof client.query === 'function') {
        return client;
      }
      ctx = ctx.next;
    }

    if (node.child) queue.push(node.child);
    if (node.sibling) queue.push(node.sibling);
  }

  throw new Unauthenticated(
    `Linear: GraphQL client not found in React tree (traversed ${count} nodes). Ensure you are logged in. URL: ${window.location.href}`,
  );
}

let cachedClient: LinearGraphQLClient | null = null;

function client(): LinearGraphQLClient {
  if (!cachedClient) {
    cachedClient = getClient();
  }
  return cachedClient;
}

// ============================================================================
// Issue field fragments
// ============================================================================

const ISSUE_SUMMARY_FIELDS = `
  id
  identifier
  title
  priority
  state { id name type }
  assignee { id name }
  labels { nodes { id name } }
  dueDate
  createdAt
  updatedAt
  url
`;

const ISSUE_DETAIL_FIELDS = `
  ${ISSUE_SUMMARY_FIELDS}
  description
  team { id name key }
  creator { id name }
  project { id name }
  cycle { id name number startsAt endsAt }
  estimate
  completedAt
  canceledAt
  archivedAt
  children { nodes { id identifier title state { id name type } } }
`;

const COMMENT_FIELDS = `
  id
  body
  createdAt
  updatedAt
  user { id name }
`;

const ATTACHMENT_FIELDS = `
  id
  title
  url
  subtitle
  metadata
  createdAt
  creator { id name }
`;

function mapIssue(node: Record<string, unknown>): Record<string, unknown> {
  const labels = node.labels as
    | { nodes?: Array<{ id: string; name: string }> }
    | undefined;
  const children = node.children as
    | { nodes?: Array<Record<string, unknown>> }
    | undefined;
  return {
    ...node,
    labels: labels?.nodes ?? [],
    children: children?.nodes ?? [],
  };
}

// ============================================================================
// Functions
// ============================================================================

export async function getContext(
  _params: GetContextInput,
): Promise<GetContextOutput> {
  const data = (await client().query(`{
    viewer { id name email displayName }
    teams {
      nodes {
        id name key
        states { nodes { id name type color position } }
      }
    }
  }`)) as {
    viewer: { id: string; name: string; email: string; displayName: string };
    teams: {
      nodes: Array<{
        id: string;
        name: string;
        key: string;
        states: {
          nodes: Array<{
            id: string;
            name: string;
            type: string;
            color: string;
            position: number;
          }>;
        };
      }>;
    };
  };

  return {
    viewer: data.viewer,
    teams: data.teams.nodes.map((t) => ({
      ...t,
      states: t.states.nodes.sort(
        (a: { position: number }, b: { position: number }) =>
          a.position - b.position,
      ),
    })),
  };
}

export async function listTeams(
  _params: ListTeamsInput,
): Promise<ListTeamsOutput> {
  const data = (await client().query(`{
    teams {
      nodes {
        id name key
        states { nodes { id name type color position } }
      }
    }
  }`)) as {
    teams: {
      nodes: Array<{
        id: string;
        name: string;
        key: string;
        states: {
          nodes: Array<{
            id: string;
            name: string;
            type: string;
            color: string;
            position: number;
          }>;
        };
      }>;
    };
  };

  return {
    teams: data.teams.nodes.map((t) => ({
      ...t,
      states: t.states.nodes.sort(
        (a: { position: number }, b: { position: number }) =>
          a.position - b.position,
      ),
    })),
  };
}

export async function listUsers(
  params: ListUsersInput,
): Promise<ListUsersOutput> {
  const includeDisabled = params.includeDisabled ? 'true' : 'false';
  const data = (await client().query(`{
    users(first: 50, includeDisabled: ${includeDisabled}) {
      nodes {
        id name email displayName active admin guest avatarUrl
      }
    }
  }`)) as {
    users: {
      nodes: Array<{
        id: string;
        name: string;
        email: string;
        displayName: string;
        active: boolean;
        admin: boolean;
        guest: boolean;
        avatarUrl: string | null;
      }>;
    };
  };

  return { users: data.users.nodes };
}

export async function listLabels(
  params: ListLabelsInput,
): Promise<ListLabelsOutput> {
  const first = params.first ?? 100;
  const afterArg = params.after ? `, after: "${params.after}"` : '';
  const filterArg = params.teamId
    ? `, filter: { team: { id: { eq: "${params.teamId}" } } }`
    : '';

  const data = (await client().query(`{
    issueLabels(first: ${first}${afterArg}${filterArg}) {
      nodes {
        id name color description isGroup
        parent { id name }
        team { id name }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`)) as {
    issueLabels: {
      nodes: Array<{
        id: string;
        name: string;
        color: string;
        description: string | null;
        isGroup: boolean;
        parent: { id: string; name: string } | null;
        team: { id: string; name: string } | null;
      }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  return {
    labels: data.issueLabels.nodes,
    pageInfo: data.issueLabels.pageInfo,
  };
}

export async function listProjects(
  params: ListProjectsInput,
): Promise<ListProjectsOutput> {
  const first = params.first ?? 50;
  const afterArg = params.after ? `, after: "${params.after}"` : '';
  const filterArg = params.status
    ? `, filter: { status: { type: { eq: "${params.status}" } } }`
    : '';

  const data = (await client().query(`{
    projects(first: ${first}${afterArg}${filterArg}, orderBy: updatedAt) {
      nodes {
        id name description
        status { type }
        icon color progress
        lead { id name }
        startDate targetDate
        url
        teams { nodes { id name } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`)) as {
    projects: {
      nodes: Array<{
        id: string;
        name: string;
        description: string;
        status: { type: string };
        icon: string | null;
        color: string;
        progress: number;
        lead: { id: string; name: string } | null;
        startDate: string | null;
        targetDate: string | null;
        url: string;
        teams: { nodes: Array<{ id: string; name: string }> };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  return {
    projects: data.projects.nodes.map((p) => ({
      ...p,
      teams: p.teams.nodes,
    })),
    pageInfo: data.projects.pageInfo,
  };
}

export async function listCycles(
  params: ListCyclesInput,
): Promise<ListCyclesOutput> {
  const first = params.first ?? 50;
  const afterArg = params.after ? `, after: "${params.after}"` : '';

  const data = (await client().query(`{
    cycles(first: ${first}${afterArg}, filter: { team: { id: { eq: "${params.teamId}" } } }, orderBy: updatedAt) {
      nodes {
        id name number startsAt endsAt completedAt
        isActive isFuture isPast progress
        team { id name }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`)) as {
    cycles: {
      nodes: Array<{
        id: string;
        name: string | null;
        number: number;
        startsAt: string;
        endsAt: string;
        completedAt: string | null;
        isActive: boolean;
        isFuture: boolean;
        isPast: boolean;
        progress: number;
        team: { id: string; name: string };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  return {
    cycles: data.cycles.nodes,
    pageInfo: data.cycles.pageInfo,
  };
}

export async function listIssues(
  params: ListIssuesInput,
): Promise<ListIssuesOutput> {
  const filters: string[] = [];
  if (params.teamId) filters.push(`team: { id: { eq: "${params.teamId}" } }`);
  if (params.assigneeId)
    filters.push(`assignee: { id: { eq: "${params.assigneeId}" } }`);
  if (params.stateType)
    filters.push(`state: { type: { eq: "${params.stateType}" } }`);
  if (params.projectId)
    filters.push(`project: { id: { eq: "${params.projectId}" } }`);
  if (params.cycleId)
    filters.push(`cycle: { id: { eq: "${params.cycleId}" } }`);
  if (params.labelId)
    filters.push(`labels: { id: { eq: "${params.labelId}" } }`);

  const filterArg =
    filters.length > 0 ? `filter: { ${filters.join(', ')} }` : '';
  const first = params.first ?? 25;
  const afterArg = params.after ? `after: "${params.after}"` : '';

  const args = [`first: ${first}`, afterArg, filterArg, 'orderBy: updatedAt']
    .filter(Boolean)
    .join(', ');

  const data = (await client().query(`{
    issues(${args}) {
      nodes { ${ISSUE_SUMMARY_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }`)) as {
    issues: {
      nodes: Array<Record<string, unknown>>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  return {
    issues: data.issues.nodes.map(mapIssue) as ListIssuesOutput['issues'],
    pageInfo: data.issues.pageInfo,
  };
}

export async function getIssue(params: GetIssueInput): Promise<GetIssueOutput> {
  const data = (await client().query(
    `query($id: String!) {
      issue(id: $id) { ${ISSUE_DETAIL_FIELDS} }
    }`,
    { id: params.issueId },
  )) as { issue: Record<string, unknown> };

  return {
    issue: mapIssue(data.issue) as GetIssueOutput['issue'],
  };
}

export async function createIssue(
  params: CreateIssueInput,
): Promise<CreateIssueOutput> {
  const input: Record<string, unknown> = {
    teamId: params.teamId,
    title: params.title,
  };

  if (params.description !== undefined) input.description = params.description;
  if (params.stateId !== undefined) input.stateId = params.stateId;
  if (params.assigneeId !== undefined) input.assigneeId = params.assigneeId;
  if (params.priority !== undefined) input.priority = params.priority;
  if (params.labelIds !== undefined) input.labelIds = params.labelIds;
  if (params.projectId !== undefined) input.projectId = params.projectId;
  if (params.cycleId !== undefined) input.cycleId = params.cycleId;
  if (params.dueDate !== undefined) input.dueDate = params.dueDate;
  if (params.estimate !== undefined) input.estimateValue = params.estimate;
  if (params.parentId !== undefined) input.parentId = params.parentId;

  const data = (await client().mutate(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { ${ISSUE_DETAIL_FIELDS} }
      }
    }`,
    { input },
  )) as {
    issueCreate: { success: boolean; issue: Record<string, unknown> };
  };

  if (!data.issueCreate.success) {
    throw new UpstreamError('Linear issueCreate returned success=false');
  }

  return {
    issue: mapIssue(data.issueCreate.issue) as CreateIssueOutput['issue'],
  };
}

export async function updateIssue(
  params: UpdateIssueInput,
): Promise<UpdateIssueOutput> {
  const input: Record<string, unknown> = {};

  if (params.title !== undefined) input.title = params.title;
  if (params.description !== undefined) input.description = params.description;
  if (params.stateId !== undefined) input.stateId = params.stateId;
  if (params.assigneeId !== undefined) input.assigneeId = params.assigneeId;
  if (params.priority !== undefined) input.priority = params.priority;
  if (params.labelIds !== undefined) input.labelIds = params.labelIds;
  if (params.addedLabelIds !== undefined)
    input.addedLabelIds = params.addedLabelIds;
  if (params.removedLabelIds !== undefined)
    input.removedLabelIds = params.removedLabelIds;
  if (params.projectId !== undefined) input.projectId = params.projectId;
  if (params.cycleId !== undefined) input.cycleId = params.cycleId;
  if (params.teamId !== undefined) input.teamId = params.teamId;
  if (params.dueDate !== undefined) input.dueDate = params.dueDate;
  if (params.estimate !== undefined) input.estimateValue = params.estimate;

  const data = (await client().mutate(
    `mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { ${ISSUE_DETAIL_FIELDS} }
      }
    }`,
    { id: params.issueId, input },
  )) as {
    issueUpdate: { success: boolean; issue: Record<string, unknown> };
  };

  if (!data.issueUpdate.success) {
    throw new UpstreamError('Linear issueUpdate returned success=false');
  }

  return {
    issue: mapIssue(data.issueUpdate.issue) as UpdateIssueOutput['issue'],
  };
}

export async function deleteIssue(
  params: DeleteIssueInput,
): Promise<DeleteIssueOutput> {
  const data = (await client().mutate(
    `mutation($id: String!) {
      issueDelete(id: $id) { success }
    }`,
    { id: params.issueId },
  )) as { issueDelete: { success: boolean } };

  return { success: data.issueDelete.success };
}

export async function searchIssues(
  params: SearchIssuesInput,
): Promise<SearchIssuesOutput> {
  const first = params.first ?? 25;

  const data = (await client().query(
    `query($query: String!, $first: Int) {
      searchIssues(term: $query, first: $first) {
        nodes { ${ISSUE_SUMMARY_FIELDS} }
      }
    }`,
    { query: params.query, first },
  )) as { searchIssues: { nodes: Array<Record<string, unknown>> } };

  return {
    issues: data.searchIssues.nodes.map(
      mapIssue,
    ) as SearchIssuesOutput['issues'],
  };
}

export async function addComment(
  params: AddCommentInput,
): Promise<AddCommentOutput> {
  const data = (await client().mutate(
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment { ${COMMENT_FIELDS} }
      }
    }`,
    { issueId: params.issueId, body: params.body },
  )) as {
    commentCreate: {
      success: boolean;
      comment: {
        id: string;
        body: string;
        createdAt: string;
        updatedAt: string;
        user: { id: string; name: string };
      };
    };
  };

  if (!data.commentCreate.success) {
    throw new UpstreamError('Linear commentCreate returned success=false');
  }

  return { comment: data.commentCreate.comment };
}

export async function listSubIssues(
  params: ListSubIssuesInput,
): Promise<ListSubIssuesOutput> {
  const first = params.first ?? 50;
  const afterArg = params.after ? `, after: "${params.after}"` : '';

  const data = (await client().query(
    `query($id: String!) {
      issue(id: $id) {
        children(first: ${first}${afterArg}) {
          nodes { ${ISSUE_SUMMARY_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    { id: params.issueId },
  )) as {
    issue: {
      children: {
        nodes: Array<Record<string, unknown>>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  };

  return {
    issues: data.issue.children.nodes.map(
      mapIssue,
    ) as ListSubIssuesOutput['issues'],
    pageInfo: data.issue.children.pageInfo,
  };
}

export async function listComments(
  params: ListCommentsInput,
): Promise<ListCommentsOutput> {
  const first = params.first ?? 50;
  const afterArg = params.after ? `, after: "${params.after}"` : '';

  const data = (await client().query(
    `query($id: String!) {
      issue(id: $id) {
        comments(first: ${first}${afterArg}) {
          nodes { ${COMMENT_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    { id: params.issueId },
  )) as {
    issue: {
      comments: {
        nodes: Array<{
          id: string;
          body: string;
          createdAt: string;
          updatedAt: string;
          user: { id: string; name: string };
        }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  };

  return {
    comments: data.issue.comments.nodes,
    pageInfo: data.issue.comments.pageInfo,
  };
}

export async function updateComment(
  params: UpdateCommentInput,
): Promise<UpdateCommentOutput> {
  const data = (await client().mutate(
    `mutation($id: String!, $body: String!) {
      commentUpdate(id: $id, input: { body: $body }) {
        success
        comment { ${COMMENT_FIELDS} }
      }
    }`,
    { id: params.commentId, body: params.body },
  )) as {
    commentUpdate: {
      success: boolean;
      comment: {
        id: string;
        body: string;
        createdAt: string;
        updatedAt: string;
        user: { id: string; name: string };
      };
    };
  };

  if (!data.commentUpdate.success) {
    throw new UpstreamError('Linear commentUpdate returned success=false');
  }

  return { comment: data.commentUpdate.comment };
}

export async function deleteComment(
  params: DeleteCommentInput,
): Promise<DeleteCommentOutput> {
  const data = (await client().mutate(
    `mutation($id: String!) {
      commentDelete(id: $id) { success }
    }`,
    { id: params.commentId },
  )) as { commentDelete: { success: boolean } };

  return { success: data.commentDelete.success };
}

export async function listAttachments(
  params: ListAttachmentsInput,
): Promise<ListAttachmentsOutput> {
  const data = (await client().query(
    `query($id: String!) {
      issue(id: $id) {
        attachments {
          nodes { ${ATTACHMENT_FIELDS} }
        }
      }
    }`,
    { id: params.issueId },
  )) as {
    issue: {
      attachments: {
        nodes: Array<{
          id: string;
          title: string;
          url: string;
          subtitle: string | null;
          metadata: Record<string, unknown>;
          createdAt: string;
          creator: { id: string; name: string } | null;
        }>;
      };
    };
  };

  return { attachments: data.issue.attachments.nodes };
}

export async function createUrlAttachment(
  params: CreateUrlAttachmentInput,
): Promise<CreateUrlAttachmentOutput> {
  const input: Record<string, unknown> = {
    issueId: params.issueId,
    title: params.title,
    url: params.url,
  };
  if (params.subtitle !== undefined) input.subtitle = params.subtitle;

  const data = (await client().mutate(
    `mutation($input: AttachmentCreateInput!) {
      attachmentCreate(input: $input) {
        success
        attachment { ${ATTACHMENT_FIELDS} }
      }
    }`,
    { input },
  )) as {
    attachmentCreate: {
      success: boolean;
      attachment: {
        id: string;
        title: string;
        url: string;
        subtitle: string | null;
        metadata: Record<string, unknown>;
        createdAt: string;
        creator: { id: string; name: string } | null;
      };
    };
  };

  if (!data.attachmentCreate.success) {
    throw new UpstreamError('Linear attachmentCreate returned success=false');
  }

  return { attachment: data.attachmentCreate.attachment };
}

export async function deleteAttachment(
  params: DeleteAttachmentInput,
): Promise<DeleteAttachmentOutput> {
  const data = (await client().mutate(
    `mutation($id: String!) {
      attachmentDelete(id: $id) { success }
    }`,
    { id: params.attachmentId },
  )) as { attachmentDelete: { success: boolean } };

  return { success: data.attachmentDelete.success };
}
