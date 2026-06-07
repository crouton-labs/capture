import { attioFetch, listAllEntityIds } from '../helpers';
import { NotFound, ContractDrift } from '@vallum/_runtime';
import type {
  ListDealsOutput,
  GetDealOutput,
  CreateDealOutput,
  UpdateDealOutput,
  DeleteDealOutput,
} from './schemas';

export async function listDeals(opts: {
  slug: string;
  dealEntityDefId: string;
  limit?: number;
}): Promise<ListDealsOutput> {
  const limit = opts.limit ?? 100;

  const { total, ids } = await listAllEntityIds(
    opts.slug,
    opts.dealEntityDefId,
    limit,
  );

  if (ids.length === 0) {
    return { total, deals: [] };
  }

  const deals = await attioFetch<GetDealOutput[]>(
    `/api/common/workspaces/${opts.slug}/deals?deal_ids=${encodeURIComponent(ids.join(','))}`,
  );

  return {
    total,
    deals: Array.isArray(deals) ? deals : [],
  };
}

export async function getDeal(opts: {
  slug: string;
  dealId: string;
}): Promise<GetDealOutput> {
  const deals = await attioFetch<GetDealOutput[]>(
    `/api/common/workspaces/${opts.slug}/deals?deal_ids=${encodeURIComponent(opts.dealId)}`,
  );

  if (!Array.isArray(deals) || deals.length === 0) {
    throw new NotFound(`Deal not found: ${opts.dealId}`);
  }

  return deals[0];
}

export async function createDeal(opts: {
  slug: string;
  name: string;
  value?: number;
  stage?: string;
}): Promise<CreateDealOutput> {
  const body: Record<string, unknown> = { name: opts.name };
  if (opts.value !== undefined) body.value = opts.value;
  if (opts.stage !== undefined) body.stage = opts.stage;

  const deal = await attioFetch<CreateDealOutput>(
    `/api/common/workspaces/${opts.slug}/deals`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  if (!deal?.id) {
    throw new ContractDrift(
      `Unexpected deal creation response: ${JSON.stringify(deal)}`,
    );
  }

  return deal;
}

export async function updateDeal(opts: {
  slug: string;
  dealId: string;
  name?: string;
  value?: number;
  stage?: string;
}): Promise<UpdateDealOutput> {
  const body: Record<string, unknown> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.value !== undefined) body.value = opts.value;
  if (opts.stage !== undefined) body.stage = opts.stage;

  const deal = await attioFetch<UpdateDealOutput>(
    `/api/common/workspaces/${opts.slug}/deals/${opts.dealId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );

  if (!deal?.id) {
    throw new ContractDrift(`Unexpected deal update response: ${JSON.stringify(deal)}`);
  }

  return deal;
}

export async function deleteDeal(opts: {
  slug: string;
  dealId: string;
}): Promise<DeleteDealOutput> {
  await attioFetch<undefined>(
    `/api/common/workspaces/${opts.slug}/deals/${opts.dealId}`,
    { method: 'DELETE' },
  );

  return { deleted: true };
}
