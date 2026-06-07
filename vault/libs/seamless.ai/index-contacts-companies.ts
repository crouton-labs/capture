/**
 * Seamless.AI Library: Contacts & Companies
 *
 * Browser-executable functions for saved contacts, saved companies,
 * and company search.
 */

export type {
  ListContactsInput,
  ListContactsOutput,
  GetContactInput,
  GetContactOutput,
  SearchCompaniesInput,
  SearchCompaniesOutput,
  ListCompaniesInput,
  ListCompaniesOutput,
  GetCompanyInput,
  GetCompanyOutput,
  ListCompanyListsInput,
  ListCompanyListsOutput,
  SavedContact,
  CompanySearchResult,
  SavedCompany,
  CompanyList,
} from './schemas-contacts-companies';

import type {
  ListContactsInput,
  ListContactsOutput,
  GetContactInput,
  GetContactOutput,
  SearchCompaniesInput,
  SearchCompaniesOutput,
  ListCompaniesInput,
  ListCompaniesOutput,
  GetCompanyInput,
  GetCompanyOutput,
  ListCompanyListsInput,
  ListCompanyListsOutput,
  SavedContact,
  CompanySearchResult,
  SavedCompany,
} from './schemas-contacts-companies';

import { seamlessGet, seamlessPost } from './helpers';

// ============================================================================
// Mapping helpers
// ============================================================================

function mapSavedContact(c: Record<string, unknown>): SavedContact {
  const contactLoc = (c.ContactLocation ?? {}) as Record<string, unknown>;
  const companyLoc = (c.CompanyLocation ?? {}) as Record<string, unknown>;

  return {
    id: String(c.id ?? ''),
    companyId: String(c.companyId ?? ''),
    createdAt: String(c.createdAt ?? ''),
    updatedAt: String(c.updatedAt ?? ''),
    firstName: String(c.firstName ?? ''),
    middleName: String(c.middleName ?? ''),
    lastName: String(c.lastName ?? ''),
    fullName: String(c.fullName ?? c.Name ?? ''),
    email: String(c.Email ?? ''),
    personalEmail: String(c.PersonalEmail ?? ''),
    contactPhone1: String(c.contactPhone1 ?? ''),
    companyPhone1: String(c.companyPhone1 ?? ''),
    title: String(c.Title ?? ''),
    department: String(c.Department ?? ''),
    seniority: String(c.Seniority ?? ''),
    company: String(c.Company ?? ''),
    companyDomain: String(c.CompanyDomain ?? c.Website ?? ''),
    companyIndustry: String(c.CompanyIndustry ?? ''),
    companyIndustries: (c.CompanyIndustries as string[]) ?? [],
    companyStaffCount: Number(c.CompanyStaffCount ?? 0),
    companyStaffCountRange: String(c.CompanyStaffCountRange ?? ''),
    companyRevenueRange: String(c.CompanyRevenueRange ?? ''),
    companyAnnualRevenue: String(c.CompanyAnnualRevenue ?? ''),
    companyFounded: String(c.CompanyFounded ?? ''),
    companyType: String(c.CompanyType ?? ''),
    linkedInUrl: String(c.LIProfileUrl ?? ''),
    companyLinkedInUrl: String(c.CompanyLIProfileUrl ?? ''),
    contactLocation: {
      city: String(contactLoc.city ?? ''),
      state: String(contactLoc.state ?? ''),
      country: String(contactLoc.country ?? ''),
      fullString: String(contactLoc.fullString ?? ''),
    },
    companyLocation: {
      street1: String(companyLoc.street1 ?? ''),
      city: String(companyLoc.city ?? ''),
      state: String(companyLoc.state ?? ''),
      country: String(companyLoc.country ?? ''),
    },
  };
}

function mapCompanySearchResult(
  c: Record<string, unknown>,
): CompanySearchResult {
  const loc = (c.location ?? c.Location ?? {}) as Record<string, unknown>;
  const social = (c.social ?? {}) as Record<string, unknown>;

  return {
    id: String(c.id ?? ''),
    goldCompanyId: String(c.goldCompanyId ?? c.id ?? ''),
    name: String(c.name ?? c.Name ?? ''),
    domain: String(c.domain ?? c.Domain ?? ''),
    description: String(c.description ?? ''),
    industries: (c.industries ?? c.Industries ?? []) as string[],
    sicCode: String(c.sicCode ?? ''),
    employeeCount: String(c.employeeCount ?? '0'),
    employeeCountNmlzd: Number(c.employeeCountNmlzd ?? 0),
    staffCountRange: String(c.StaffCountRange ?? ''),
    annualRevenue: Number(c.annualRevenue ?? 0),
    revenueRange: String(c.revenueRange ?? ''),
    foundedOn: String(c.foundedOn ?? ''),
    fundingTotal: (c.fundingTotal as string | null) ?? null,
    latestFundingDate: (c.latestFundingDate as string | null) ?? null,
    latestFundingClassifications:
      (c.latestFundingClassifications as string[] | null) ?? null,
    numContacts: String(c.numContacts ?? '0'),
    technologies: ((c.technologies as string[]) ?? []).slice(0, 20),
    technologiesCount: c.technologiesCount
      ? Number(c.technologiesCount)
      : undefined,
    linkedInUrl: String(
      social.linkedin ??
        (c.linkedInProfileIdentifier
          ? `https://www.linkedin.com/company/${c.linkedInProfileIdentifier}/`
          : ''),
    ),
    location: {
      street1: String(loc.street1 ?? ''),
      city: String(loc.city ?? ''),
      state: String(loc.state ?? ''),
      country: String(loc.country ?? ''),
      postCode: String(loc.postCode ?? ''),
    },
  };
}

function mapSavedCompany(c: Record<string, unknown>): SavedCompany {
  const loc = (c.CompanyLocation ?? c.location ?? {}) as Record<
    string,
    unknown
  >;

  return {
    id: String(c.id ?? ''),
    name: String(c.Name ?? c.name ?? c.Company ?? ''),
    domain: String(c.Domain ?? c.domain ?? c.CompanyDomain ?? ''),
    industry: String(c.CompanyIndustry ?? c.industry ?? ''),
    industries: (c.CompanyIndustries ?? c.industries ?? []) as string[],
    staffCount: Number(c.CompanyStaffCount ?? c.staffCount ?? 0),
    staffCountRange: String(
      c.CompanyStaffCountRange ?? c.StaffCountRange ?? '',
    ),
    revenueRange: String(c.CompanyRevenueRange ?? c.revenueRange ?? ''),
    annualRevenue: String(c.CompanyAnnualRevenue ?? c.annualRevenue ?? ''),
    founded: String(c.CompanyFounded ?? c.foundedOn ?? ''),
    companyType: String(c.CompanyType ?? c.companyType ?? ''),
    linkedInUrl: String(c.CompanyLIProfileUrl ?? c.linkedInUrl ?? ''),
    location: {
      street1: String(loc.street1 ?? ''),
      city: String(loc.city ?? ''),
      state: String(loc.state ?? ''),
      country: String(loc.country ?? ''),
    },
  };
}

// ============================================================================
// listContacts
// ============================================================================

export async function listContacts(
  params: ListContactsInput,
): Promise<ListContactsOutput> {
  const page = params.page ?? 0;
  const limit = Math.min(params.limit ?? 25, 50);
  const sortColumn = params.sortColumn ?? 'researchedAt';
  const sortOrder = params.sortOrder ?? 'desc';

  const data = (await seamlessGet(
    `/users/contacts?page=${page}&limit=${limit}&sortColumn=${sortColumn}&sortOrder=${sortOrder}`,
  )) as Record<string, unknown>;

  const rawContacts = (data.contacts ?? []) as Array<Record<string, unknown>>;
  const contacts = rawContacts.map(mapSavedContact);

  return {
    contacts,
    count: rawContacts.length,
    total: Number(data.count ?? data.total ?? 0),
  };
}

// ============================================================================
// getContact
// ============================================================================

export async function getContact(
  params: GetContactInput,
): Promise<GetContactOutput> {
  const data = (await seamlessGet(
    `/users/contacts/${params.contactId}`,
  )) as Record<string, unknown>;

  const raw = (data.data ?? data) as Record<string, unknown>;
  const contact = mapSavedContact(raw);

  return { contact };
}

// ============================================================================
// searchCompanies
// ============================================================================

export async function searchCompanies(
  params: SearchCompaniesInput,
): Promise<SearchCompaniesOutput> {
  // Note: employeeSizes and estimatedRevenues cause 500 on the company search
  // endpoint. They are not supported; use contact search for those filters.
  const body: Record<string, unknown> = {
    page: params.page ?? 0,
    perPage: Math.min(params.perPage ?? 25, 50),
    overallSearch: true,
    companies: params.companies ?? [],
    companiesExactMatch: params.companiesExactMatch ?? false,
    includeCompanyAliases: true,
    industries: params.industries ?? [],
    locations: params.locations ?? [],
    locationTypes: ['both'],
    technologies: params.technologies ?? [],
    keywords: params.keywords ?? [],
    companyFoundedOn: params.companyFoundedOn ?? [],
    companyFundingTotals: params.companyFundingTotals ?? [],
    companyLatestFundingDates: params.companyLatestFundingDates ?? [],
    companyLatestFundingClassifications:
      params.companyLatestFundingClassifications ?? [],
    companyTypes: params.companyTypes ?? [],
  };

  const data = (await seamlessPost('/companies/search', body)) as Record<
    string,
    unknown
  >;

  const wrapper = (data.companies ?? data) as Record<string, unknown>;
  const rawCompanies = (wrapper.companies ?? []) as Array<
    Record<string, unknown>
  >;

  const companies = rawCompanies.map(mapCompanySearchResult);

  return {
    companies,
    isMore: (wrapper.isMore as boolean) ?? false,
    total: Number(wrapper.total ?? 0),
  };
}

// ============================================================================
// listCompanies
// ============================================================================

export async function listCompanies(
  params: ListCompaniesInput,
): Promise<ListCompaniesOutput> {
  const page = params.page ?? 0;
  const limit = Math.min(params.limit ?? 25, 50);

  const data = (await seamlessGet(
    `/users/companies?page=${page}&limit=${limit}`,
  )) as Record<string, unknown>;

  const rawCompanies = (data.companies ?? []) as Array<Record<string, unknown>>;
  const companies = rawCompanies.map(mapSavedCompany);

  return {
    companies,
    count: Number(data.count ?? 0),
  };
}

// ============================================================================
// getCompany
// ============================================================================

export async function getCompany(
  params: GetCompanyInput,
): Promise<GetCompanyOutput> {
  const data = (await seamlessGet(
    `/users/companies/${params.companyId}`,
  )) as Record<string, unknown>;

  const raw = (data.data ?? data) as Record<string, unknown>;
  const company = mapSavedCompany(raw);

  return { company };
}

// ============================================================================
// listCompanyLists
// ============================================================================

export async function listCompanyLists(
  _params: ListCompanyListsInput,
): Promise<ListCompanyListsOutput> {
  const data = (await seamlessGet('/users/companies/list')) as Record<
    string,
    unknown
  >;

  const rawLists = (data.lists ?? []) as Array<Record<string, unknown>>;
  const lists = rawLists.map((l) => ({
    id: String(l.id ?? l._id ?? ''),
    name: String(l.name ?? ''),
    companyCount: l.companyCount ? Number(l.companyCount) : undefined,
  }));

  return { lists };
}
