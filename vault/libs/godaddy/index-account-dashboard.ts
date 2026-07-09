/**
 * GoDaddy — account dashboard functions.
 *
 * Dashboard notifications + notification consent (notifications-api.godaddy.com)
 * and website/WAM projects (pg.api.godaddy.com GraphQL). All scoped implicitly
 * to the signed-in session via cookie auth — no account ids are passed in.
 */

import { gdFetch, gqlFetch, NOTIFICATIONS_API, Validation } from './_shared';
import type {
  ListNotificationsOutput,
  UpdateNotificationConsentOutput,
  ListProjectsOutput,
  GetProjectCountsOutput,
  Project,
} from './schemas-account-dashboard';

export type {
  Notification,
  Project,
  ListNotificationsOutput,
  UpdateNotificationConsentOutput,
  ListProjectsOutput,
  GetProjectCountsOutput,
} from './schemas-account-dashboard';

// ============================================================================
// listNotifications
// ============================================================================

interface NotificationsLaunchResponse {
  cards?: Array<Record<string, unknown>>;
  notifications?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
}

export async function listNotifications(
  args: {
    manifest?: string;
    requestPage?: string;
    includeRad?: boolean;
    appKey?: string;
  } = {},
): Promise<ListNotificationsOutput> {
  const body: Record<string, unknown> = {};
  if (args.manifest != null) body.manifest = args.manifest;
  if (args.requestPage != null) body.requestPage = args.requestPage;
  if (args.includeRad != null) body.includeRad = args.includeRad;

  const extraHeaders: Record<string, string> = {};
  if (args.appKey != null) extraHeaders['x-app-key'] = args.appKey;

  const resp = await gdFetch<
    NotificationsLaunchResponse | Array<Record<string, unknown>> | undefined
  >(`${NOTIFICATIONS_API}/v1/launch`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: extraHeaders,
  });

  const notifications: Array<Record<string, unknown>> = Array.isArray(resp)
    ? resp
    : (resp?.cards ?? resp?.notifications ?? resp?.messages ?? []);

  return { notifications, total: notifications.length };
}

// ============================================================================
// updateNotificationConsent
// ============================================================================

export async function updateNotificationConsent(args: {
  consentType: string;
  value: boolean;
}): Promise<UpdateNotificationConsentOutput> {
  if (!args.consentType) {
    throw new Validation(
      'updateNotificationConsent requires a consentType (e.g. "SMS_PROMOTIONAL").',
    );
  }
  if (typeof args.value !== 'boolean') {
    throw new Validation(
      'updateNotificationConsent requires a boolean value (true = opt in, false = opt out).',
    );
  }

  await gdFetch<unknown>(
    `${NOTIFICATIONS_API}/v1/consent/updateCustomerConsent/${encodeURIComponent(args.consentType)}`,
    { method: 'PUT', body: JSON.stringify({ value: args.value }) },
  );

  return { consentType: args.consentType, value: args.value };
}

// ============================================================================
// Projects (pg.api GraphQL)
// ============================================================================

interface ProductNode {
  __typename?: string;
  businessName?: string;
  ventureId?: string;
  domainName?: string;
  status?: string;
  updateDate?: string;
  properties?: unknown;
}

interface ProjectEdge {
  cursor?: string | null;
  node?: {
    id?: string | null;
    created?: string | null;
    updated?: string | null;
    product?: ProductNode | null;
  } | null;
}

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  endCursor?: string | null;
  startCursor?: string | null;
}

interface ProjectsGqlResponse {
  projects?: {
    edges?: Array<ProjectEdge | null>;
    pageInfo?: PageInfo;
  };
}

const PROJECTS_QUERY = `query Projects($first: Int, $after: String, $last: Int, $before: String) {
  projects(first: $first, after: $after, last: $last, before: $before) {
    edges {
      cursor
      node {
        id
        created
        updated
        product {
          __typename
          ... on WebsiteProduct { businessName }
          ... on WAMProduct { ventureId domainName properties status updateDate }
        }
      }
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      endCursor
      startCursor
    }
  }
}`;

const PROJECT_COUNTS_QUERY = `query getProjectCounts($groups: [ProjectGroup]!) {
  user {
    projectCounts(groups: $groups)
  }
}`;

interface UserProjectCountsResponse {
  user?: {
    projectCounts?: Record<string, number>;
  };
}

function toProject(edge: ProjectEdge): Project {
  const node = edge.node;
  const product = node?.product;
  return {
    type: product?.__typename ?? 'Unknown',
    id: node?.id ?? undefined,
    created: node?.created ?? undefined,
    updated: node?.updated ?? undefined,
    cursor: edge.cursor ?? undefined,
    businessName: product?.businessName,
    ventureId: product?.ventureId,
    domainName: product?.domainName,
    status: product?.status,
    updateDate: product?.updateDate,
    properties: product?.properties,
  };
}

export async function listProjects(
  args: {
    count?: number;
    first?: number;
    after?: string;
    last?: number;
    before?: string;
  } = {},
): Promise<ListProjectsOutput> {
  const variables: Record<string, unknown> = {};
  if (args.first != null) variables.first = args.first;
  if (args.after != null) variables.after = args.after;
  if (args.last != null) variables.last = args.last;
  if (args.before != null) variables.before = args.before;

  const data = await gqlFetch<ProjectsGqlResponse>(
    'Projects',
    PROJECTS_QUERY,
    variables,
  );

  const edges = (data.projects?.edges ?? []).filter(
    (edge): edge is ProjectEdge => edge != null,
  );
  let projects = edges.map(toProject);

  const rawPageInfo = data.projects?.pageInfo;

  if (args.count != null) projects = projects.slice(0, args.count);
  const total = projects.length;

  return {
    projects,
    total,
    ...(rawPageInfo != null
      ? {
          pageInfo: {
            hasNextPage: rawPageInfo.hasNextPage,
            hasPreviousPage: rawPageInfo.hasPreviousPage,
            endCursor: rawPageInfo.endCursor ?? null,
            startCursor: rawPageInfo.startCursor ?? null,
          },
        }
      : {}),
  };
}

export async function getProjectCounts(
  args: {
    groups?: Array<
      | 'domain'
      | 'wordpress'
      | 'vnext'
      | 'aap'
      | 'gdpayments'
      | 'qsc'
      | 'olstore'
    >;
  } = {},
): Promise<GetProjectCountsOutput> {
  const groups = args.groups ?? [];
  const data = await gqlFetch<UserProjectCountsResponse>(
    'getProjectCounts',
    PROJECT_COUNTS_QUERY,
    { groups },
  );

  const countsByType = data.user?.projectCounts ?? {};
  const total = Object.values(countsByType).reduce((sum, n) => sum + n, 0);

  return { total, countsByType };
}
