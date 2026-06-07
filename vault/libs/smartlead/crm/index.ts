import { throwForStatus } from '@vallum/_runtime';
import { apiFetch, unwrapList } from '../helpers';
import type {
  ListAllLeadsInput,
  ListAllLeadsOutput,
  GetLeadCountsByTypeInput,
  GetLeadCountsByTypeOutput,
  ListLeadListsInput,
  ListLeadListsOutput,
} from './schemas';
import { CrmLeadSchema, CrmLeadListSchema } from './schemas';
import { z } from 'zod';

const CRM_PRO_MESSAGE =
  'CRM requires Pro plan or above. Current plan does not have access.';

// ============================================================================
// Internal types
// ============================================================================

type CrmLead = z.infer<typeof CrmLeadSchema>;
type CrmLeadList = z.infer<typeof CrmLeadListSchema>;

interface CrmLeadsResponse {
  data: {
    results?: CrmLead[];
    count?: number;
  };
}

interface CrmLeadCountsResponse {
  data: Record<string, number>;
}

interface CrmLeadListsResponse {
  data: CrmLeadList[] | { results?: CrmLeadList[]; count?: number };
}

// ============================================================================
// listAllLeads
// ============================================================================

/**
 * List all leads across the entire account in the CRM view.
 * Supports pagination via offset and limit.
 */
export async function listAllLeads(
  params: ListAllLeadsInput,
): Promise<ListAllLeadsOutput> {
  const { token, offset = 0, limit = 100 } = params;

  const qs = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });

  const res = await apiFetch(token, `/api/crm/leads?${qs}`);

  if (!res.ok) {
    throwForStatus(res.status, res.status === 403 ? CRM_PRO_MESSAGE : await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as CrmLeadsResponse;
  const leads: CrmLead[] = data.data?.results ?? [];
  const total = data.data?.count ?? leads.length;

  return { leads, total };
}

// ============================================================================
// getLeadCountsByType
// ============================================================================

/**
 * Get counts of leads grouped by category/status across the entire account.
 */
export async function getLeadCountsByType(
  params: GetLeadCountsByTypeInput,
): Promise<GetLeadCountsByTypeOutput> {
  const { token } = params;

  const res = await apiFetch(token, '/api/crm/leads/counts');

  if (!res.ok) {
    throwForStatus(res.status, res.status === 403 ? CRM_PRO_MESSAGE : await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as CrmLeadCountsResponse;
  const counts: Record<string, number> = data.data ?? {};

  return { counts };
}

// ============================================================================
// listLeadLists
// ============================================================================

/**
 * List all saved lead lists in the CRM.
 */
export async function listLeadLists(
  params: ListLeadListsInput,
): Promise<ListLeadListsOutput> {
  const { token } = params;

  const res = await apiFetch(token, '/api/crm/lead-lists');

  if (!res.ok) {
    throwForStatus(res.status, res.status === 403 ? CRM_PRO_MESSAGE : await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as CrmLeadListsResponse;
  const lists = unwrapList<CrmLeadList>(data.data);

  return { lists, total: lists.length };
}
