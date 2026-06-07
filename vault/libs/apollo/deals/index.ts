/**
 * Apollo Deals Module
 *
 * CRUD operations for Apollo deals (opportunities) including search, view, create, update, delete,
 * and pipeline/stage management.
 */

import { Validation, throwForStatus } from '@vallum/_runtime';

import type {
  SearchDealsInput,
  SearchDealsOutput,
  ViewDealInput,
  ViewDealOutput,
  CreateDealInput,
  CreateDealOutput,
  UpdateDealInput,
  UpdateDealOutput,
  DeleteDealInput,
  DeleteDealOutput,
  ListDealStagesInput,
  ListDealStagesOutput,
  ListDealPipelinesInput,
  ListDealPipelinesOutput,
} from '../schemas';

/**
 * Search deals/opportunities with pagination and sorting.
 */
export async function searchDeals(
  opts: SearchDealsInput,
): Promise<SearchDealsOutput> {
  const { page = 1, perPage = 25, sortByField, sortAscending } = opts;

  const body: Record<string, unknown> = {
    page,
    per_page: perPage,
  };

  if (sortByField !== undefined) {
    body.sort_by_field = sortByField;
  }
  if (sortAscending !== undefined) {
    body.sort_ascending = sortAscending;
  }

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/opportunities/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * View a single deal/opportunity by ID.
 */
export async function viewDeal(opts: ViewDealInput): Promise<ViewDealOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/opportunities/${id}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Create a new deal/opportunity.
 */
export async function createDeal(
  opts: CreateDealInput,
): Promise<CreateDealOutput> {
  const {
    name,
    opportunity_stage_id,
    amount,
    account_id,
    owner_id,
    closed_date,
    description,
    source,
  } = opts;

  if (!name) throw new Validation('name is required');

  const body: Record<string, unknown> = { name };

  if (opportunity_stage_id !== undefined)
    body.opportunity_stage_id = opportunity_stage_id;
  if (amount !== undefined) body.amount = amount;
  if (account_id !== undefined) body.account_id = account_id;
  if (owner_id !== undefined) body.owner_id = owner_id;
  if (closed_date !== undefined) body.closed_date = closed_date;
  if (description !== undefined) body.description = description;
  if (source !== undefined) body.source = source;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/opportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Update an existing deal/opportunity.
 */
export async function updateDeal(
  opts: UpdateDealInput,
): Promise<UpdateDealOutput> {
  const { id, ...fields } = opts;

  if (!id) throw new Validation('id is required');

  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      body[key] = value;
    }
  }

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/opportunities/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Delete a deal/opportunity by ID.
 */
export async function deleteDeal(
  opts: DeleteDealInput,
): Promise<DeleteDealOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/opportunities/bulk_destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ids: [id] }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return { success: true };
}

/**
 * List all deal/opportunity stages.
 */
export async function listDealStages(
  _opts: ListDealStagesInput,
): Promise<ListDealStagesOutput> {
  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/opportunity_stages`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * List all deal/opportunity pipelines.
 */
export async function listDealPipelines(
  _opts: ListDealPipelinesInput,
): Promise<ListDealPipelinesOutput> {
  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/opportunity_pipelines`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}
