import { attioFetch, listAllEntityIds } from '../helpers';
import { NotFound, Validation, ContractDrift } from '@vallum/_runtime';
import type {
  ListCompaniesOutput,
  GetCompanyOutput,
  CreateCompanyOutput,
  UpdateCompanyOutput,
  DeleteCompanyOutput,
} from './schemas';

export async function listCompanies(opts: {
  slug: string;
  companyEntityDefId: string;
  limit?: number;
}): Promise<ListCompaniesOutput> {
  const limit = opts.limit ?? 100;

  const { total, ids } = await listAllEntityIds(
    opts.slug,
    opts.companyEntityDefId,
    limit,
  );

  if (ids.length === 0) {
    return { total, companies: [] };
  }

  const companies = await attioFetch<GetCompanyOutput[]>(
    `/api/common/workspaces/${opts.slug}/companies?company_ids=${encodeURIComponent(ids.join(','))}`,
  );

  return {
    total,
    companies: Array.isArray(companies) ? companies : [],
  };
}

export async function getCompany(opts: {
  slug: string;
  companyId: string;
}): Promise<GetCompanyOutput> {
  const companies = await attioFetch<GetCompanyOutput[]>(
    `/api/common/workspaces/${opts.slug}/companies?company_ids=${encodeURIComponent(opts.companyId)}`,
  );

  if (!Array.isArray(companies) || companies.length === 0) {
    throw new NotFound(`Company not found: ${opts.companyId}`);
  }

  return companies[0];
}

export async function createCompany(opts: {
  slug: string;
  name?: string;
  domain?: string;
}): Promise<CreateCompanyOutput> {
  if (!opts.name && !opts.domain) {
    throw new Validation('createCompany requires at least one of name or domain');
  }

  const body: Record<string, string> = {};
  if (opts.name) body.name = opts.name;
  if (opts.domain) body.domain = opts.domain;

  const company = await attioFetch<CreateCompanyOutput>(
    `/api/common/workspaces/${opts.slug}/companies`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  if (!company?.id) {
    throw new ContractDrift(
      `Unexpected company creation response: ${JSON.stringify(company)}`,
    );
  }

  return company;
}

export async function updateCompany(opts: {
  slug: string;
  companyId: string;
  name?: string;
  domain?: string;
  description?: string;
}): Promise<UpdateCompanyOutput> {
  const body: Record<string, string> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.domain !== undefined) body.domain = opts.domain;
  if (opts.description !== undefined) body.description = opts.description;

  const company = await attioFetch<UpdateCompanyOutput>(
    `/api/common/workspaces/${opts.slug}/companies/${opts.companyId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );

  if (!company?.id) {
    throw new ContractDrift(
      `Unexpected company update response: ${JSON.stringify(company)}`,
    );
  }

  return company;
}

export async function deleteCompany(opts: {
  slug: string;
  companyId: string;
}): Promise<DeleteCompanyOutput> {
  await attioFetch<undefined>(
    `/api/common/workspaces/${opts.slug}/companies/${opts.companyId}`,
    { method: 'DELETE' },
  );

  return { deleted: true };
}
