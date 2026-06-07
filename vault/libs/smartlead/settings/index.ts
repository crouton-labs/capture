import { throwForStatus } from '@vallum/_runtime';
import { apiFetch } from '../helpers';
import type {
  ListTeamMembersInput,
  ListTeamMembersOutput,
  ListWebhooksInput,
  ListWebhooksOutput,
  ListTagsInput,
  ListTagsOutput,
  ListLeadCategoriesInput,
  ListLeadCategoriesOutput,
} from './schemas';

// ============================================================================
// Internal response types
// ============================================================================

interface TeamMembersResponse {
  data: ListTeamMembersOutput['members'];
}

interface WebhooksResponse {
  data: ListWebhooksOutput['webhooks'];
}

interface TagsResponse {
  data: ListTagsOutput['tags'];
}

interface LeadCategoriesResponse {
  data: ListLeadCategoriesOutput['categories'];
}

// ============================================================================
// listTeamMembers
// ============================================================================

/**
 * List all team members in the workspace. Pro+ only.
 */
export async function listTeamMembers(
  params: ListTeamMembersInput,
): Promise<ListTeamMembersOutput> {
  const { token } = params;

  const res = await apiFetch(token, '/api/settings/team-members');

  if (!res.ok) {
    throwForStatus(
      res.status,
      res.status === 403
        ? 'listTeamMembers requires Pro plan or above. Current plan does not have access.'
        : await res.text().catch(() => undefined),
    );
  }

  const body = (await res.json()) as TeamMembersResponse;
  return { members: body.data ?? [] };
}

// ============================================================================
// listWebhooks
// ============================================================================

/**
 * List all configured webhooks in the workspace.
 */
export async function listWebhooks(
  params: ListWebhooksInput,
): Promise<ListWebhooksOutput> {
  const { token } = params;

  const res = await apiFetch(token, '/api/settings/webhooks');

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const body = (await res.json()) as WebhooksResponse;
  return { webhooks: body.data ?? [] };
}

// ============================================================================
// listTags
// ============================================================================

/**
 * List all tags defined in the workspace tag manager.
 */
export async function listTags(params: ListTagsInput): Promise<ListTagsOutput> {
  const { token } = params;

  const res = await apiFetch(token, '/api/settings/tags');

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const body = (await res.json()) as TagsResponse;
  return { tags: body.data ?? [] };
}

// ============================================================================
// listLeadCategories
// ============================================================================

/**
 * List all lead categories/intent labels configured for the workspace.
 */
export async function listLeadCategories(
  params: ListLeadCategoriesInput,
): Promise<ListLeadCategoriesOutput> {
  const { token } = params;

  const res = await apiFetch(token, '/api/settings/lead-categories');

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const body = (await res.json()) as LeadCategoriesResponse;
  return { categories: body.data ?? [] };
}
