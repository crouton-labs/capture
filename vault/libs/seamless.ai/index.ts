/**
 * Seamless.AI Library
 *
 * Browser-executable Seamless.AI operations via internal APIs.
 * Requires user to be logged into Seamless.AI at login.seamless.ai.
 */

export type {
  GetContextInput,
  GetContextOutput,
  SearchContactsInput,
  SearchContactsOutput,
  ResearchContactInput,
  ResearchContactOutput,
  BulkResearchContactsInput,
  BulkResearchContactsOutput,
  ListContactListsInput,
  ListContactListsOutput,
  CreateContactListInput,
  CreateContactListOutput,
  AddContactsToListInput,
  AddContactsToListOutput,
  CreditPool,
  Credits,
  SearchResult,
  Tag,
} from './schemas';

export type {
  ListCampaignsInput,
  ListCampaignsOutput,
  ListTasksInput,
  ListTasksOutput,
  ListActivitiesInput,
  ListActivitiesOutput,
  ListTemplateFoldersInput,
  ListTemplateFoldersOutput,
  GetCampaignInput,
  GetCampaignOutput,
  CreateCampaignInput,
  CreateCampaignOutput,
  CreateTaskInput,
  CreateTaskOutput,
  UpdateTaskInput,
  UpdateTaskOutput,
  Campaign,
  CampaignDetail,
  TaskCounts,
  ActivityStats,
  TemplateFolder,
} from './schemas-engagement';

export {
  listCampaigns,
  listTasks,
  listActivities,
  listTemplateFolders,
  getCampaign,
  createCampaign,
  createTask,
  updateTask,
} from './index-engagement';

export type {
  ListOrgUsersInput,
  ListOrgUsersOutput,
  GetCreditsInput,
  GetCreditsOutput,
  ListIndustriesInput,
  ListIndustriesOutput,
  GetDashboardROIInput,
  GetDashboardROIOutput,
  ListConnectedEmailsInput,
  ListConnectedEmailsOutput,
  GetEmailSignatureInput,
  GetEmailSignatureOutput,
  ListContactStatusesInput,
  ListContactStatusesOutput,
  ListCallDispositionsInput,
  ListCallDispositionsOutput,
  OrgUser,
  CreditPoolDetail,
  Industry,
  ROIMetrics,
  ConnectedEmail,
  EmailSignature,
  ContactStatus,
  CallDisposition,
} from './schemas-settings';

export {
  listOrgUsers,
  getCredits,
  listIndustries,
  getDashboardROI,
  listConnectedEmails,
  getEmailSignature,
  listContactStatuses,
  listCallDispositions,
} from './index-settings';

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

export {
  listContacts,
  getContact,
  searchCompanies,
  listCompanies,
  getCompany,
  listCompanyLists,
} from './index-contacts-companies';

export type {
  DeleteContactListInput,
  DeleteContactListOutput,
  RemoveContactsFromListInput,
  RemoveContactsFromListOutput,
  AddCompaniesToListInput,
  AddCompaniesToListOutput,
  ListSavedSearchesInput,
  ListSavedSearchesOutput,
  DeleteSavedSearchInput,
  DeleteSavedSearchOutput,
  CreateSavedSearchInput,
  CreateSavedSearchOutput,
  ExportContactsInput,
  ExportContactsOutput,
  ListEnrichJobsInput,
  ListEnrichJobsOutput,
  SavedSearch,
  ExportJob,
  EnrichJob,
} from './schemas-lists-searches';

export {
  deleteContactList,
  removeContactsFromList,
  addCompaniesToList,
  listSavedSearches,
  deleteSavedSearch,
  createSavedSearch,
  exportContacts,
  listEnrichJobs,
} from './index-lists-searches';

export type {
  ListTemplatesInput,
  ListTemplatesOutput,
  CreateTemplateInput,
  CreateTemplateOutput,
  UpdateTemplateInput,
  UpdateTemplateOutput,
  DeleteTemplateInput,
  DeleteTemplateOutput,
  Template,
} from './schemas-templates';

export {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from './index-templates';

import type {
  GetContextInput,
  GetContextOutput,
  SearchContactsInput,
  SearchContactsOutput,
  ResearchContactInput,
  ResearchContactOutput,
  BulkResearchContactsInput,
  BulkResearchContactsOutput,
  ListContactListsInput,
  ListContactListsOutput,
  CreateContactListInput,
  CreateContactListOutput,
  AddContactsToListInput,
  AddContactsToListOutput,
} from './schemas';
import { Unauthenticated } from '@vallum/_runtime';
import { seamlessGet, seamlessPost } from './helpers';

// ============================================================================
// getContext
// ============================================================================

export async function getContext(
  _params: GetContextInput,
): Promise<GetContextOutput> {
  const data = (await seamlessGet('/users/me')) as Record<string, unknown>;

  if (!data.id) {
    throw new Unauthenticated(
      'Not logged in to Seamless.AI. Navigate to https://login.seamless.ai and sign in.',
    );
  }

  const credits = data.credits as Record<string, Record<string, unknown>>;

  const mapPool = (pool: Record<string, unknown>) => ({
    key: (pool.key as number) ?? 0,
    label: (pool.label as string) ?? '',
    credits: (pool.credits as number) ?? 0,
    creditsRemaining: (pool.creditsRemaining as number) ?? 0,
    searchCredits: (pool.searchCredits as number) ?? 0,
    searchCreditsRemaining: (pool.searchCreditsRemaining as number) ?? 0,
    companySaveCredits: (pool.companySaveCredits as number) ?? 0,
    companySaveCreditsRemaining:
      (pool.companySaveCreditsRemaining as number) ?? 0,
    licenseType: (pool.licenseType as string | null) ?? null,
    licenseStatus: (pool.licenseStatus as string | null) ?? null,
  });

  return {
    userId: String(data.id),
    orgId: String(data.orgId),
    firstName: (data.firstname as string) ?? '',
    lastName: (data.lastname as string) ?? '',
    fullName: (data.fullName as string) ?? '',
    email: (data.username as string) ?? '',
    company: (data.company as string) ?? '',
    title: (data.title as string) ?? '',
    orgRole: (data.orgRole as string) ?? '',
    isOrgAdmin: (data.isOrgAdmin as boolean) ?? false,
    isPaidOrg: (data.isPaidOrg as boolean) ?? false,
    credits: {
      standard: mapPool(credits.standard ?? {}),
      intent: mapPool(credits.intent ?? {}),
      universal: mapPool(credits.universal ?? {}),
    },
  };
}

// ============================================================================
// searchContacts
// ============================================================================

export async function searchContacts(
  params: SearchContactsInput,
): Promise<SearchContactsOutput> {
  const body: Record<string, unknown> = {
    contactSearchId: null,
    page: params.page ?? 0,
    nextToken: null,
    perPage: params.perPage ?? 50,
    overallSearch: true,
    includeActivities: false,
    includeEducation: false,
    includePositions: false,
    sortColumn: null,
    sortOrder: null,
    includeTasks: false,
    companies: params.companies ?? [],
    companiesBulkId: [],
    companiesExactMatch: params.companiesExactMatch ?? false,
    includeCompanyAliases: true,
    titles: params.titles ?? [],
    titlesExactMatch: params.titlesExactMatch ?? false,
    seniorities: params.seniorities ?? [],
    departments: params.departments ?? [],
    industries: params.industries ?? [],
    industrySicCodes: [],
    industryNaicsCodes: [],
    locations: params.locations ?? [],
    locationRadius: [],
    locationTypes: ['both'],
    zipCodes: [],
    employeeSizes: params.employeeSizes ?? [],
    estimatedRevenues: params.estimatedRevenues ?? [],
    technologies: params.technologies ?? [],
    technologiesIsOr: false,
    keywords: params.keywords ?? [],
    keywordsIsOr: params.keywordsIsOr ?? false,
    formerCompanies: params.formerCompanies ?? [],
    formerCompaniesExactMatch: false,
    anyFormerCompanyMatch: false,
    jobChangesType: params.jobChangesType ?? null,
    jobChangesDayRange: params.jobChangesDayRange ?? null,
    companyFoundedOn: [],
    companyFundingTotals: [],
    companyLatestFundingDates: [],
    companyLatestFundingClassifications: [],
    companyTypes: [],
  };

  const data = (await seamlessPost('/contact/search', body)) as Record<
    string,
    unknown
  >;
  const inner = (data.data ?? data) as Record<string, unknown>;

  const results = ((inner.results as Array<Record<string, unknown>>) ?? []).map(
    (r) => ({
      searchResultId: String(r.searchResultId ?? ''),
      contactSearchId: Number(r.contactSearchId ?? 0),
      name: String(r.name ?? ''),
      title: String(r.title ?? ''),
      company: String(r.company ?? ''),
      domain: String(r.domain ?? ''),
      city: String(r.city ?? ''),
      state: String(r.state ?? ''),
      country: String(r.country ?? ''),
      companyCity: String(r.companyCity ?? ''),
      companyState: String(r.companyState ?? ''),
      companyCountry: String(r.companyCountry ?? ''),
      department: String(r.department ?? ''),
      seniority: String(r.seniority ?? ''),
      industry: String(r.industry ?? ''),
      industries: (r.industries as string[]) ?? [],
      employeeCount: Number(r.employeeCount ?? 0),
      liUrl: String(r.liUrl ?? ''),
      companyRevenueRange: String(r.companyRevenueRange ?? ''),
      companyFundingTotal: String(r.companyFundingTotal ?? ''),
      companyLatestFundingDate: String(r.companyLatestFundingDate ?? ''),
      companyLatestFundingClassifications: String(
        r.companyLatestFundingClassifications ?? '',
      ),
      sicCode: String(r.sicCode ?? ''),
      sicDesc: String(r.sicDesc ?? ''),
      companyFoundedOn: String(r.companyFoundedOn ?? ''),
      titleStartedAt: String(r.titleStartedAt ?? ''),
      startedAtCurrentCompany: String(r.startedAtCurrentCompany ?? ''),
    }),
  );

  return {
    contactSearchId: Number(inner.contactSearchId ?? 0),
    isMore: (inner.isMore as boolean) ?? false,
    results,
    totalResults: inner.totalResults ? Number(inner.totalResults) : undefined,
  };
}

// ============================================================================
// researchContact
// ============================================================================

export async function researchContact(
  params: ResearchContactInput,
): Promise<ResearchContactOutput> {
  // Step 1: Trigger async research via researchBatch
  await seamlessPost('/users/contacts/researchBatch', {
    contacts: [
      {
        searchResultId: params.searchResultId,
        contactSearchId: params.contactSearchId,
      },
    ],
  });

  // Step 2: Poll saved contacts for the researched contact
  // Research is async; wait 3s initially, then poll every 2s
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const maxAttempts = 8;
  const pollInterval = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const data = (await seamlessGet(
      '/users/contacts?page=0&limit=5&sortColumn=researchedAt&sortOrder=desc',
    )) as Record<string, unknown>;

    const contacts = (data.contacts ?? []) as Array<Record<string, unknown>>;

    // Find the most recently researched contact
    for (const c of contacts) {
      const email = String(c.Email ?? '');
      const fullName = String(c.fullName ?? c.Name ?? '');

      // Skip contacts still being researched
      if (email === 'Researching...' || !fullName) continue;

      const personalEmail = String(c.PersonalEmail ?? '');
      const phone = String(c.contactPhone1 ?? '');
      const companyPhone = String(c.companyPhone1 ?? '');

      const emails: Array<{
        email: string;
        type: string;
        isValidated?: boolean;
      }> = [];
      if (email && email !== 'Researching...')
        emails.push({ email, type: 'work' });
      if (personalEmail && personalEmail !== 'Researching...')
        emails.push({ email: personalEmail, type: 'personal' });

      const phones: Array<{ number: string; type: string }> = [];
      if (phone && phone !== 'Researching...')
        phones.push({ number: phone, type: 'direct' });
      if (companyPhone && companyPhone !== 'Researching...')
        phones.push({ number: companyPhone, type: 'company' });

      return {
        success: true,
        contact: {
          id: String(c.id ?? ''),
          name: fullName,
          title: String(c.Title ?? ''),
          company: String(c.Company ?? ''),
          emails,
          phones,
          linkedInUrl: String(c.LIProfileUrl ?? '') || undefined,
        },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Research was accepted but contact hasn't appeared yet
  return {
    success: true,
    contact: {
      id: '',
      name: '',
      title: '',
      company: '',
      emails: [],
      phones: [],
    },
  };
}

// ============================================================================
// bulkResearchContacts
// ============================================================================

export async function bulkResearchContacts(
  params: BulkResearchContactsInput,
): Promise<BulkResearchContactsOutput> {
  if (params.contacts.length === 0) {
    return { success: true, contacts: [], pendingCount: 0 };
  }

  // Step 1: Submit all contacts in a single batch
  await seamlessPost('/users/contacts/researchBatch', {
    contacts: params.contacts.map((c) => ({
      searchResultId: c.searchResultId,
      contactSearchId: c.contactSearchId,
    })),
  });

  // Step 2: Poll saved contacts for enriched results
  const batchSize = params.contacts.length;
  const pollLimit = Math.max(batchSize + 5, 10);
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const maxAttempts = 12;
  const pollInterval = 2000;
  const enriched: Array<{
    id: string;
    name: string;
    title: string;
    company: string;
    emails: Array<{ email: string; type: string; isValidated?: boolean }>;
    phones: Array<{ number: string; type: string }>;
    linkedInUrl?: string;
  }> = [];
  const seenIds = new Set<string>();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const data = (await seamlessGet(
      `/users/contacts?page=0&limit=${pollLimit}&sortColumn=researchedAt&sortOrder=desc`,
    )) as Record<string, unknown>;

    const contacts = (data.contacts ?? []) as Array<Record<string, unknown>>;

    for (const c of contacts) {
      const id = String(c.id ?? '');
      if (seenIds.has(id)) continue;

      const email = String(c.Email ?? '');
      const fullName = String(c.fullName ?? c.Name ?? '');

      // Skip contacts still being researched
      if (email === 'Researching...' || !fullName) continue;

      const personalEmail = String(c.PersonalEmail ?? '');
      const phone = String(c.contactPhone1 ?? '');
      const companyPhone = String(c.companyPhone1 ?? '');

      const emails: Array<{
        email: string;
        type: string;
        isValidated?: boolean;
      }> = [];
      if (email && email !== 'Researching...')
        emails.push({ email, type: 'work' });
      if (personalEmail && personalEmail !== 'Researching...')
        emails.push({ email: personalEmail, type: 'personal' });

      const phones: Array<{ number: string; type: string }> = [];
      if (phone && phone !== 'Researching...')
        phones.push({ number: phone, type: 'direct' });
      if (companyPhone && companyPhone !== 'Researching...')
        phones.push({ number: companyPhone, type: 'company' });

      enriched.push({
        id,
        name: fullName,
        title: String(c.Title ?? ''),
        company: String(c.Company ?? ''),
        emails,
        phones,
        linkedInUrl: String(c.LIProfileUrl ?? '') || undefined,
      });
      seenIds.add(id);
    }

    if (enriched.length >= batchSize) break;
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return {
    success: true,
    contacts: enriched.slice(0, batchSize),
    pendingCount: Math.max(0, batchSize - enriched.length),
  };
}

// ============================================================================
// listContactLists
// ============================================================================

export async function listContactLists(
  _params: ListContactListsInput,
): Promise<ListContactListsOutput> {
  const data = (await seamlessGet('/users/tags')) as Record<string, unknown>;
  const tags = ((data.data ?? []) as Array<Record<string, unknown>>).map(
    (t) => ({
      id: String(t.id ?? t._id ?? ''),
      name: String(t.name ?? ''),
      contactCount: t.contactCount ? Number(t.contactCount) : undefined,
    }),
  );

  return { lists: tags };
}

// ============================================================================
// createContactList
// ============================================================================

export async function createContactList(
  params: CreateContactListInput,
): Promise<CreateContactListOutput> {
  const data = (await seamlessPost('/users/tags', {
    name: params.name,
  })) as Record<string, unknown>;

  const tag = (data.data ?? data) as Record<string, unknown>;

  return {
    id: String(tag.id ?? tag._id ?? ''),
    name: String(tag.name ?? params.name),
  };
}

// ============================================================================
// addContactsToList
// ============================================================================

export async function addContactsToList(
  params: AddContactsToListInput,
): Promise<AddContactsToListOutput> {
  const data = (await seamlessPost('/users/contacts/tags', {
    tagIds: [params.listId],
    contactIds: params.contactIds,
  })) as Record<string, unknown>;

  return {
    success: (data.success as boolean) ?? true,
    addedCount: params.contactIds.length,
  };
}
