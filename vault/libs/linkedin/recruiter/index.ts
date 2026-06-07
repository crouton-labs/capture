/**
 * LinkedIn Recruiter (Talent Solutions) Library — browser-executable functions for the
 * `/talent/api/` Recruiter API. Requires a LinkedIn Recruiter seat.
 *
 * All requests use `credentials: 'include'` + a `csrf-token` header. csrf comes from
 * `getContext().csrf` (JSESSIONID cookie; same as the rest of the LinkedIn lib). Recruiter
 * is a premium tier just like Sales Navigator — most reads are either decorated REST calls
 * or GraphQL queries against `/talent/api/graphql`.
 *
 * NOT BUILDABLE (no captured requestBody — do not implement): sendInMail, addNote,
 * rejectCandidate, moveStage, saveToProject. The only mutation with a captured body is
 * `logProfileView`.
 */

import type {
  GetRecruiterContextInput,
  GetRecruiterContextOutput,
  ListContractsInput,
  ListContractsOutput,
  ListSeatsInput,
  ListSeatsOutput,
  ListHiringProjectsInput,
  ListHiringProjectsOutput,
  GetHiringProjectInput,
  GetHiringProjectOutput,
  SearchCandidatesInput,
  SearchCandidatesOutput,
  ListCandidateRecommendationsInput,
  ListCandidateRecommendationsOutput,
  FindSimilarProfilesInput,
  FindSimilarProfilesOutput,
  SearchProfilesByKeywordInput,
  SearchProfilesByKeywordOutput,
  RecruiterTypeaheadInput,
  RecruiterTypeaheadOutput,
  GetSearchFacetsInput,
  GetSearchFacetsOutput,
  GetCandidateProfileInput,
  GetCandidateProfileOutput,
  GetProjectCandidateInput,
  GetProjectCandidateOutput,
  GetCandidatesInProjectInput,
  GetCandidatesInProjectOutput,
  GetCandidateActivityInput,
  GetCandidateActivityOutput,
  GetProfileResumeUrlInput,
  GetProfileResumeUrlOutput,
  GetMailboxSummaryInput,
  GetMailboxSummaryOutput,
  GetMailboxMetadataInput,
  GetMailboxMetadataOutput,
  GetRecruiterConversationInput,
  GetRecruiterConversationOutput,
  GetCandidateMessagesInput,
  GetCandidateMessagesOutput,
  ListSourcingChannelsInput,
  ListSourcingChannelsOutput,
  ListRecruiterNotificationsInput,
  ListRecruiterNotificationsOutput,
  ListRecruiterTagsInput,
  ListRecruiterTagsOutput,
  LogProfileViewInput,
  LogProfileViewOutput,
} from '../schemas';

import { ContractDrift, NotFound, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Helpers
// ============================================================================

const BASE = 'https://www.linkedin.com/talent/api';

const RECRUITER_HEADERS = {
  accept: 'application/json',
  'x-restli-protocol-version': '2.0.0',
};

/**
 * Encode a RestLI query-parameter value. `encodeURIComponent` doesn't escape
 * `( )` which LinkedIn requires as `%28 %29`.
 */
function encodeRestLi(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Encode a URN for use as a RestLI path segment. In addition to `( )`, RestLI
 * path segments require `,` → `%2C` and `:` → `%3A`.
 */
function encodeUrn(urn: string): string {
  return encodeURIComponent(urn)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/,/g, '%2C')
    .replace(/:/g, '%3A');
}

// --- URN builders -----------------------------------------------------------

function tsContract(contractId: string | number): string {
  return `urn:li:ts_contract:${contractId}`;
}

function tsHiringProject(
  contractId: string | number,
  projectId: string | number,
): string {
  return `urn:li:ts_hiring_project:(${tsContract(contractId)},${projectId})`;
}

function tsHireIdentity(hireIdentityId: string | number): string {
  return `urn:li:ts_hire_identity:${hireIdentityId}`;
}

function tsHiringCandidate(
  contractId: string | number,
  hireIdentityId: string | number,
): string {
  return `urn:li:ts_hiring_candidate:(${tsContract(contractId)},${tsHireIdentity(hireIdentityId)})`;
}

function tsSourcingChannel(
  contractId: string | number,
  sourcingChannelId: string | number,
): string {
  return `urn:li:ts_sourcing_channel:(${tsContract(contractId)},${sourcingChannelId})`;
}

function tsSeat(seatId: string | number): string {
  return `urn:li:ts_seat:${seatId}`;
}

/**
 * ts_linkedin_member_profile URN. `projectId` may be a numeric project id (scoped
 * to a contract) or `0` for the unscoped form `urn:li:ts_hiring_project:0`.
 */
function tsLinkedinMemberProfile(
  memberToken: string,
  contractId: string | number,
  projectId: string | number,
): string {
  const project =
    projectId === 0 || projectId === '0'
      ? 'urn:li:ts_hiring_project:0'
      : tsHiringProject(contractId, projectId);
  return `urn:li:ts_linkedin_member_profile:(${memberToken},1,${project})`;
}

/**
 * ts_hiring_project_candidate URN keyed by ts_profile (the AEMAA token), as used
 * by talentHiringProjectRecruitingProfiles.
 */
function tsHiringProjectCandidateByProfile(
  contractId: string | number,
  profileId: string,
  projectId: string | number,
): string {
  return `urn:li:ts_hiring_project_candidate:(${tsContract(contractId)},urn:li:ts_profile:${profileId},${tsHiringProject(contractId, projectId)})`;
}

// --- URN parsers ------------------------------------------------------------

/** Pull the numeric ts_hire_identity id out of any URN containing one. */
function parseHireIdentityId(urn: string): string | undefined {
  return urn.match(/ts_hire_identity:(\d+)/)?.[1];
}

/** Pull the member token (AEMAA…/ACoAA…) out of a ts_linkedin_member_profile URN. */
function parseMemberToken(urn: string): string | undefined {
  return urn.match(/ts_linkedin_member_profile:\(([^,)]+)/)?.[1];
}

/** Pull the numeric tail off a ts_hiring_project URN. */
function parseProjectId(urn: string): string | undefined {
  return urn.match(/ts_hiring_project:\(urn:li:ts_contract:\d+,(\d+)\)/)?.[1];
}

/** Pull the numeric tail off a ts_sourcing_channel URN. */
function parseSourcingChannelId(urn: string): string | undefined {
  return urn.match(/ts_sourcing_channel:\(urn:li:ts_contract:\d+,(\d+)\)/)?.[1];
}

// --- Fetch helpers ----------------------------------------------------------

/**
 * Shared REST fetch for the Recruiter API. Mirrors salesFetch.
 */
async function recruiterFetch<T>(
  csrf: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http')
    ? path
    : `${BASE}/${path.replace(/^\/+/, '')}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'csrf-token': csrf,
      ...RECRUITER_HEADERS,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(
      response.status,
      `LinkedIn Recruiter API error ${response.status}: ${truncated}`,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throw new ContractDrift(
      `LinkedIn Recruiter returned non-JSON response: ${truncated}`,
    );
  }
}

/**
 * POST-as-GET decorated read. LinkedIn uses POST because the decoration string
 * exceeds URL length limits. Response is the decorated entity JSON.
 */
async function recruiterDecoratedGet<T>(
  csrf: string,
  resource: string,
  urn: string,
  decoration: string,
): Promise<T> {
  const body = `altkey=urn&decoration=${encodeURIComponent(decoration)}`;
  return recruiterFetch<T>(csrf, `${resource}/${encodeUrn(urn)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

/**
 * GraphQL GET. `variables` is a RestLI-encoded string the caller already built
 * (e.g. `(candidate:urn:li:ts_hire_identity:123,count:10)`). Returns
 * `json.data.data` (the resolver map).
 */
async function recruiterGraphql<T>(
  csrf: string,
  queryId: string,
  variables: string,
): Promise<T> {
  const json = await recruiterFetch<{ data?: { data?: T } }>(
    csrf,
    `graphql?includeWebMetadata=true&variables=${encodeRestLi(variables)}&queryId=${queryId}`,
  );
  return (json.data?.data ?? ({} as T)) as T;
}

// --- Shared parsing helpers -------------------------------------------------

interface DateOn {
  month?: number;
  year?: number;
  day?: number;
}

function mapDate(d?: DateOn): { month?: number; year?: number } | undefined {
  if (!d) return undefined;
  return { month: d.month, year: d.year };
}

// ============================================================================
// Context / account
// ============================================================================

const RECRUITER_CONTEXT_DECORATION =
  '(contract~(entityUrn,type,name,created,lastModified,account~(accountLevelJobsAccess,entityUrn,name,crossContractEnabled,company~),contractERSStatus,moving,credits*,features,enterpriseApplicationInstance,ofccpTrackingIdRequired,accountCenterEnabled,online),seat~(entityUrn,state,profile~(entityUrn,firstName,lastName,headline,profilePicture,vectorProfilePicture,publicProfileUrl,followerCount,networkDistance,automatedActionProfile),seatEntitlements,seatRoles,contract,description,penaltyBoxInfo,entitlementsWithMetadata*,productRestrictions*),agentSeatUrn,contractSeat,profile~(entityUrn,firstName,lastName,headline,profilePicture,publicProfileUrl,vectorProfilePicture),csImpersonationType,usingMultipleContracts,enterpriseProfile~(entityUrn,preferredFirstName,preferredLastName,workTitle,hiringEntitlements,entitlementsWithMetadata*,applicationInstanceUrn),realtimeIdentityToken,enterpriseAuthTokenUrnBase64)';

export async function getRecruiterContext(
  params: GetRecruiterContextInput,
): Promise<GetRecruiterContextOutput> {
  const { csrf } = params;

  const data = await recruiterFetch<{
    contract?: string;
    profile?: string;
    usingMultipleContracts?: boolean;
    contractResolutionResult?: {
      entityUrn?: string;
      type?: string;
      name?: string;
      credits?: Array<{
        creditType?: string;
        creditsGranted?: number;
        creditsLeft?: number;
      }>;
      accountResolutionResult?: {
        entityUrn?: string;
        name?: string;
        companyResolutionResult?: { entityUrn?: string; name?: string };
      };
    };
    seatResolutionResult?: { entityUrn?: string; seatRoles?: string[] };
  }>(
    csrf,
    `talentMe?decoration=${encodeRestLi(RECRUITER_CONTEXT_DECORATION)}`,
  );

  const contract = data.contractResolutionResult;
  if (!data.contract && !contract) {
    throw new NotFound(
      'No Recruiter contract found. The logged-in member may not have a LinkedIn Recruiter seat.',
    );
  }

  const contractUrn = data.contract || contract?.entityUrn;
  const contractId = contractUrn?.match(/ts_contract:(\d+)/)?.[1];
  const account = contract?.accountResolutionResult;
  const company = account?.companyResolutionResult;

  return {
    contractId,
    contractUrn,
    contractType: contract?.type,
    contractName: contract?.name,
    recruiterProfileUrn: data.profile,
    seatUrn: data.seatResolutionResult?.entityUrn,
    seatRoles: data.seatResolutionResult?.seatRoles,
    credits: contract?.credits?.map((c) => ({
      creditType: c.creditType,
      creditsGranted: c.creditsGranted,
      creditsLeft: c.creditsLeft,
    })),
    accountUrn: account?.entityUrn,
    accountName: account?.name,
    companyUrn: company?.entityUrn,
    companyName: company?.name,
    usingMultipleContracts: data.usingMultipleContracts,
  };
}

export async function listContracts(
  params: ListContractsInput,
): Promise<ListContractsOutput> {
  const { csrf } = params;

  const data = await recruiterFetch<{
    elements?: Array<{ name?: string; entityUrn?: string }>;
  }>(
    csrf,
    `talentContracts?q=userAccount&decoration=${encodeRestLi('(name,entityUrn)')}&count=100&start=0`,
  );

  const contracts = (data.elements || []).map((c) => ({
    name: c.name,
    contractUrn: c.entityUrn,
    contractId: c.entityUrn?.match(/ts_contract:(\d+)/)?.[1],
  }));

  return { contracts };
}

export async function listSeats(
  params: ListSeatsInput,
): Promise<ListSeatsOutput> {
  const { csrf, contractId, namePrefix } = params;

  const decoration =
    '(entityUrn,profile~(entityUrn,firstName,lastName,workExperience*))';
  let path =
    `talentSeats?q=search&contractIds=${encodeRestLi(`List(${contractId})`)}` +
    `&seatStatuses=${encodeRestLi('List(ACTIVE)')}` +
    `&decoration=${encodeRestLi(decoration)}`;
  if (namePrefix) {
    path += `&namePrefix=${encodeURIComponent(namePrefix)}`;
  }

  const data = await recruiterFetch<{
    elements?: Array<{
      profileResolutionResult?: {
        entityUrn?: string;
        firstName?: string;
        lastName?: string;
        workExperience?: Array<{ title?: string; companyName?: string }>;
      };
    }>;
  }>(csrf, path);

  const seats = (data.elements || []).map((s) => {
    const p = s.profileResolutionResult;
    const job = p?.workExperience?.[0];
    return {
      profileUrn: p?.entityUrn,
      firstName: p?.firstName,
      lastName: p?.lastName,
      currentTitle: job?.title,
      currentCompany: job?.companyName,
    };
  });

  return { seats };
}

// ============================================================================
// Projects (pipelines / reqs)
// ============================================================================

export async function listHiringProjects(
  params: ListHiringProjectsInput,
): Promise<ListHiringProjectsOutput> {
  const {
    csrf,
    states = ['ACTIVE'],
    types = ['ATS', 'JOB_POSTING', 'RECRUITER'],
    count = 25,
    start = 0,
  } = params;

  // Decoration mirrors the real Recruiter UI capture (talentHiringProjects?q=criteria).
  const decoration =
    '(entityUrn,hiringProjectMetadata(company~(entityUrn,name),created,locationDescription,name,owner~(entityUrn,profile~(entityUrn,firstName,lastName,headline,publicProfileUrl,networkDistance))),connectedProjectInfo(integrationJobRequisitionUrn~(entityUrn,externalId,title,dataProviderUrn~(entityUrn,name))))';
  const query = `(hiringProjectTypes:List(${types.join(',')}),hiringProjectStates:List(${states.join(',')}))`;

  const data = await recruiterFetch<{
    metadata?: {
      contentTrackingContainers?: Array<{ hiringProjectUrn?: string }>;
    };
    elements?: Array<{
      entityUrn?: string;
      hiringProjectMetadata?: {
        name?: string;
        state?: string;
        locationDescription?: string;
        created?: { time?: number };
        title?: string;
        companyResolutionResult?: { name?: string };
        ownerResolutionResult?: {
          profileResolutionResult?: { firstName?: string; lastName?: string };
        };
      };
    }>;
    paging?: { total?: number };
  }>(
    csrf,
    `talentHiringProjects?q=criteria&query=${encodeRestLi(query)}` +
      `&sortBy=${encodeRestLi('(sortByType:LAST_ACCESS_TIME,sortOrder:DESCENDING)')}` +
      `&decoration=${encodeRestLi(decoration)}&count=${count}&start=${start}`,
  );

  const projects = (data.elements || []).map((el) => {
    const meta = el.hiringProjectMetadata;
    const owner = meta?.ownerResolutionResult?.profileResolutionResult;
    const ownerName = owner
      ? [owner.firstName, owner.lastName].filter(Boolean).join(' ') || undefined
      : undefined;
    return {
      projectId: el.entityUrn ? parseProjectId(el.entityUrn) : undefined,
      projectUrn: el.entityUrn,
      name: meta?.name,
      state: meta?.state,
      title: meta?.title,
      companyName: meta?.companyResolutionResult?.name,
      location: meta?.locationDescription,
      createdAt: meta?.created?.time,
      ownerName,
    };
  });

  const total = data.paging?.total;
  const hasMore = projects.length >= count;

  return { projects, total, hasMore };
}

const HIRING_PROJECT_DECORATION =
  '(entityUrn,candidateCounts*,hiringProjectMetadata(created,lastModified,deleted,name,description,owner~(entityUrn,profile~(entityUrn,firstName,lastName)),title,state,type,locationDescription,company~),sourcingChannels*~(name,entityUrn,channelType,state,hidden),hiringPipeline~(entityUrn,name,hiringStates*~))';

export async function getHiringProject(
  params: GetHiringProjectInput,
): Promise<GetHiringProjectOutput> {
  const { csrf, contractId, projectId } = params;

  const data = await recruiterDecoratedGet<{
    entityUrn?: string;
    hiringProjectMetadata?: {
      name?: string;
      description?: string;
      state?: string;
      title?: string;
      owner?: string;
      ownerResolutionResult?: {
        profileResolutionResult?: { firstName?: string; lastName?: string };
      };
    };
    sourcingChannelsResolutionResults?: Record<
      string,
      {
        entityUrn?: string;
        name?: string;
        channelType?: string;
        state?: string;
      }
    >;
    hiringPipelineResolutionResult?: {
      hiringStates?: string[];
    };
    candidateCounts?: Array<{
      type?: string;
      entity?: string;
      count?: number;
    }>;
  }>(
    csrf,
    'talentHiringProjects',
    tsHiringProject(contractId, projectId),
    HIRING_PROJECT_DECORATION,
  );

  const sourcingChannels = Object.values(
    data.sourcingChannelsResolutionResults || {},
  ).map((c) => ({
    channelUrn: c.entityUrn,
    channelId: c.entityUrn ? parseSourcingChannelId(c.entityUrn) : undefined,
    name: c.name,
    channelType: c.channelType,
    state: c.state,
  }));

  const hiringStates = (
    data.hiringPipelineResolutionResult?.hiringStates || []
  ).map((stateUrn) => ({ stateUrn }));

  const candidateCounts = (data.candidateCounts || []).map((c) => ({
    type: c.type,
    entity: c.entity,
    count: c.count,
  }));

  const ownerProfile =
    data.hiringProjectMetadata?.ownerResolutionResult?.profileResolutionResult;
  const ownerName = ownerProfile
    ? [ownerProfile.firstName, ownerProfile.lastName]
        .filter(Boolean)
        .join(' ') || undefined
    : undefined;

  return {
    projectUrn: data.entityUrn,
    name: data.hiringProjectMetadata?.name,
    description: data.hiringProjectMetadata?.description,
    state: data.hiringProjectMetadata?.state,
    title: data.hiringProjectMetadata?.title,
    sourcingChannels,
    hiringStates,
    candidateCounts,
    ownerName,
  };
}

// ============================================================================
// Candidate discovery
// ============================================================================

export async function searchCandidates(
  params: SearchCandidatesInput,
): Promise<SearchCandidatesOutput> {
  const { csrf, contractId, projectId, sourcingChannelId, sortBy = 'RELEVANCE' } =
    params;

  const projectUrn = tsHiringProject(contractId, projectId);
  const sourcingChannelUrn = tsSourcingChannel(contractId, sourcingChannelId);

  const variables =
    `(query:(capSearchSortBy:${sortBy},facets:List(TALENT_POOL),project:${projectUrn}),` +
    `requestParams:(updateSearchHistory:false,doFacetCounting:true,doFacetDecoration:true,` +
    `hiringProjectId:${projectId},sourcingChannel:${sourcingChannelUrn},hiringProject:${projectUrn}))`;

  const data = await recruiterGraphql<{
    recruiterSearchHitsByRecruiterSearch?: {
      metadata?: { total?: number; formattedTotal?: string };
      elements?: Array<Record<string, unknown>>;
    };
  }>(
    csrf,
    'talentRecruiterSearchHits.86b7058213f93b72cb32f27f797ea766',
    variables,
  );

  const result = data.recruiterSearchHitsByRecruiterSearch;
  const total = result?.metadata?.total;
  const formattedTotal = result?.metadata?.formattedTotal;

  // In captures `elements`/`included` were empty (deferred hydration). Map any
  // urn refs defensively — do not invent field names.
  const candidates = (result?.elements || []).map((el) => {
    const hpcUrn = el['*hiringProjectCandidate'] as string | undefined;
    const lmpUrn = el['*linkedInMemberProfile'] as string | undefined;
    const hcUrn = el['*hiringCandidate'] as string | undefined;
    return {
      hiringProjectCandidateUrn: hpcUrn,
      memberProfileUrn: lmpUrn,
      hiringCandidateUrn: hcUrn,
      hireIdentityId: hpcUrn
        ? parseHireIdentityId(hpcUrn)
        : hcUrn
          ? parseHireIdentityId(hcUrn)
          : undefined,
      memberToken: lmpUrn ? parseMemberToken(lmpUrn) : undefined,
    };
  });

  return { total, formattedTotal, candidates };
}

export async function listCandidateRecommendations(
  params: ListCandidateRecommendationsInput,
): Promise<ListCandidateRecommendationsOutput> {
  const {
    csrf,
    contractId,
    projectId,
    sourcingChannelId,
    idealMemberToken,
    collectionType = 'SIMILAR_TO_CANDIDATE',
    count = 10,
  } = params;

  const projectUrn = tsHiringProject(contractId, projectId);
  const sourcingChannelUrn = tsSourcingChannel(contractId, sourcingChannelId);
  const memberProfileUrn = tsLinkedinMemberProfile(
    idealMemberToken,
    contractId,
    projectId,
  );

  const variables =
    `(recommendationCriteria:(hiringProjectUrn:${projectUrn},sourcingChannelUrn:${sourcingChannelUrn},` +
    `idealLinkedInMemberProfileUrn:${memberProfileUrn},collectionType:${collectionType},retrievalType:CACHE_BASED),` +
    `count:${count})`;

  const data = await recruiterGraphql<{
    candidateRecommendationsByRecommendationCriteria?: {
      paging?: { count?: number; start?: number; total?: number };
      elements?: Array<{
        '*hiringProjectCandidate'?: string;
        '*linkedInMemberProfile'?: string;
        '*hiringCandidate'?: string;
      }>;
    };
  }>(
    csrf,
    'talentCandidateRecommendations.7e26fd7fb0f55086c38216534693889d',
    variables,
  );

  const result = data.candidateRecommendationsByRecommendationCriteria;
  const total = result?.paging?.total;

  const candidates = (result?.elements || []).map((el) => {
    const hpcUrn = el['*hiringProjectCandidate'];
    const lmpUrn = el['*linkedInMemberProfile'];
    const hcUrn = el['*hiringCandidate'];
    return {
      hiringProjectCandidateUrn: hpcUrn,
      memberProfileUrn: lmpUrn,
      hiringCandidateUrn: hcUrn,
      hireIdentityId: hpcUrn
        ? parseHireIdentityId(hpcUrn)
        : hcUrn
          ? parseHireIdentityId(hcUrn)
          : undefined,
      memberToken: lmpUrn ? parseMemberToken(lmpUrn) : undefined,
    };
  });

  const start = result?.paging?.start ?? 0;
  const returned = result?.paging?.count ?? candidates.length;
  const hasMore =
    total !== undefined ? start + returned < total : candidates.length >= count;

  return { total, candidates, hasMore };
}

export async function findSimilarProfiles(
  params: FindSimilarProfilesInput,
): Promise<FindSimilarProfilesOutput> {
  const { csrf, memberToken, count = 10 } = params;

  const idealUrn = `urn:li:ts_linkedin_member_profile:(${memberToken},1,urn:li:ts_hiring_project:0)`;
  const variables = `(idealLinkedInMemberProfileUrn:${idealUrn},count:${count})`;

  const data = await recruiterGraphql<{
    candidateRecommendationsByGlobalIdealCandidate?: {
      paging?: { count?: number; start?: number; total?: number };
      elements?: Array<{
        '*linkedInMemberProfile'?: string;
        '*hiringCandidate'?: string;
      }>;
    };
  }>(
    csrf,
    'talentCandidateRecommendations.ba3e9263e8e6df0dffa36d4db717ebf3',
    variables,
  );

  const result = data.candidateRecommendationsByGlobalIdealCandidate;
  const total = result?.paging?.total;

  const candidates = (result?.elements || []).map((el) => {
    const lmpUrn = el['*linkedInMemberProfile'];
    const hcUrn = el['*hiringCandidate'];
    return {
      memberProfileUrn: lmpUrn,
      hiringCandidateUrn: hcUrn,
      hireIdentityId: hcUrn ? parseHireIdentityId(hcUrn) : undefined,
      memberToken: lmpUrn ? parseMemberToken(lmpUrn) : undefined,
    };
  });

  const start = result?.paging?.start ?? 0;
  const returned = result?.paging?.count ?? candidates.length;
  const hasMore =
    total !== undefined ? start + returned < total : candidates.length >= count;

  return { total, candidates, hasMore };
}

const KEYWORD_PROFILE_DECORATION =
  '(entityUrn,firstName,lastName,headline,location(displayName),publicProfileUrl,numConnections,networkDistance,industryName,workExperience*(company~(entityUrn,name),companyName,title,startDateOn,endDateOn),educations*(school~(entityUrn,name),schoolName,degreeName,startDateOn,endDateOn))';

export async function searchProfilesByKeyword(
  params: SearchProfilesByKeywordInput,
): Promise<SearchProfilesByKeywordOutput> {
  const { csrf, keywords, count = 10, start = 0 } = params;

  const data = await recruiterFetch<{
    elements?: Array<{
      entityUrn?: string;
      firstName?: string;
      lastName?: string;
      headline?: string;
      location?: { displayName?: string };
      publicProfileUrl?: string;
      workExperience?: Array<{ title?: string; companyName?: string }>;
    }>;
  }>(
    csrf,
    `talentProfiles?q=keywords&keywords=${encodeURIComponent(keywords)}` +
      `&decoration=${encodeRestLi(KEYWORD_PROFILE_DECORATION)}&count=${count}&start=${start}`,
  );

  const profiles = (data.elements || []).map((p) => {
    const job = p.workExperience?.[0];
    return {
      profileUrn: p.entityUrn,
      firstName: p.firstName,
      lastName: p.lastName,
      headline: p.headline,
      currentTitle: job?.title,
      currentCompany: job?.companyName,
      location: p.location?.displayName,
      publicProfileUrl: p.publicProfileUrl,
    };
  });

  const hasMore = profiles.length >= count;

  return { profiles, hasMore };
}

export async function typeahead(
  params: RecruiterTypeaheadInput,
): Promise<RecruiterTypeaheadOutput> {
  const { csrf, type, query } = params;

  const data = await recruiterFetch<{
    elements?: Array<{
      hitInfoUnion?: Record<string, { entityUrn?: string }>;
      text?: { text?: string };
    }>;
  }>(
    csrf,
    `talentTypeaheads?q=${encodeURIComponent(type)}&query=${encodeURIComponent(query)}`,
  );

  const results = (data.elements || []).map((el) => {
    // hitInfoUnion is keyed by typeaheadCompany / typeaheadTitle / typeaheadGeo / ...
    const unionKey = el.hitInfoUnion
      ? Object.keys(el.hitInfoUnion)[0]
      : undefined;
    const hit = unionKey ? el.hitInfoUnion?.[unionKey] : undefined;
    return {
      urn: hit?.entityUrn,
      displayName: el.text?.text,
      type: unionKey,
    };
  });

  return { results };
}

export async function getSearchFacets(
  params: GetSearchFacetsInput,
): Promise<GetSearchFacetsOutput> {
  const { csrf, contractId, projectId, sourcingChannelUrns, hiringStateUrns } =
    params;

  const facets =
    'List((facetType:SOURCING_CHANNEL),(facetType:CANDIDATE_HIRING_STATE),(facetType:IS_OPEN_CANDIDATE))';

  const queryParts = [
    `hiringContext:${tsContract(contractId)}`,
    `hiringProject:${tsHiringProject(contractId, projectId)}`,
  ];
  if (sourcingChannelUrns && sourcingChannelUrns.length > 0) {
    queryParts.push(`sourcingChannels:List(${sourcingChannelUrns.join(',')})`);
  }
  if (hiringStateUrns && hiringStateUrns.length > 0) {
    queryParts.push(`candidateHiringStates:List(${hiringStateUrns.join(',')})`);
  }
  const query = `(${queryParts.join(',')})`;

  const data = await recruiterFetch<{
    elements?: Array<{
      facetType?: string;
      values?: Array<{
        value?: string;
        displayValue?: string;
        count?: number;
        selected?: boolean;
      }>;
    }>;
  }>(
    csrf,
    `talentHiringCandidateSearchFacets?q=projectCriteria` +
      `&facets=${encodeRestLi(facets)}&query=${encodeRestLi(query)}`,
  );

  const facetsOut = (data.elements || []).map((f) => ({
    facetType: f.facetType,
    values: (f.values || []).map((v) => ({
      value: v.value,
      displayValue: v.displayValue,
      count: v.count,
      selected: v.selected,
    })),
  }));

  return { facets: facetsOut };
}

// ============================================================================
// Candidate detail
// ============================================================================

const CANDIDATE_PROFILE_DECORATION =
  '(entityUrn,firstName,lastName,headline,location,summary,publicProfileUrl,numConnections,networkDistance,profileSkills*(entityUrn,name,endorsementCount,topSkill),publicProfileUrl,contactInfo,canSendInMail,educations*(entityUrn,schoolName,school~(name),degreeName,fieldOfStudy,startDateOn,endDateOn),groupedWorkExperience*(companyUrn~(name),positions*(entityUrn,title,startDateOn,endDateOn,description,location,companyName,companyUrn~(name)),startDateOn,endDateOn),currentPositions*(company~(name),companyName,title,startDateOn,endDateOn,description,location),certifications*(id,name,authority,company~(name),url,startDateOn,endDateOn),industryName)';

export async function getCandidateProfile(
  params: GetCandidateProfileInput,
): Promise<GetCandidateProfileOutput> {
  const { csrf, memberToken, contractId, projectId } = params;

  const urn = tsLinkedinMemberProfile(memberToken, contractId, projectId ?? 0);

  interface Position {
    title?: string;
    companyName?: string;
    startDateOn?: DateOn;
    endDateOn?: DateOn;
    description?: string;
    location?: string;
  }

  const data = await recruiterDecoratedGet<{
    firstName?: string;
    lastName?: string;
    headline?: string;
    location?: string;
    summary?: string;
    publicProfileUrl?: string;
    numConnections?: number;
    networkDistance?: string;
    canSendInMail?: boolean;
    contactInfo?: Record<string, unknown>;
    profileSkills?: Array<{ name?: string; endorsementCount?: number }>;
    educations?: Array<{
      schoolName?: string;
      schoolResolutionResult?: { name?: string };
      degreeName?: string;
      fieldOfStudy?: string;
      startDateOn?: DateOn;
      endDateOn?: DateOn;
    }>;
    groupedWorkExperience?: Array<{ positions?: Position[] }>;
    currentPositions?: Position[];
    certifications?: Array<{
      name?: string;
      authority?: string;
      companyResolutionResult?: { name?: string };
      url?: string;
      startDateOn?: DateOn;
      endDateOn?: DateOn;
    }>;
  }>(
    csrf,
    'talentLinkedInMemberProfiles',
    urn,
    CANDIDATE_PROFILE_DECORATION,
  );

  const skills = (data.profileSkills || []).map((s) => ({
    name: s.name,
    endorsementCount: s.endorsementCount,
  }));

  const educations = (data.educations || []).map((e) => ({
    school: e.schoolName || e.schoolResolutionResult?.name,
    degreeName: e.degreeName,
    fieldOfStudy: e.fieldOfStudy,
    startYear: e.startDateOn?.year,
    endYear: e.endDateOn?.year,
  }));

  // Prefer grouped positions; fall back to currentPositions.
  const grouped = (data.groupedWorkExperience || []).flatMap(
    (g) => g.positions || [],
  );
  const rawPositions = grouped.length > 0 ? grouped : data.currentPositions || [];
  const positions = rawPositions.map((p) => ({
    title: p.title,
    companyName: p.companyName,
    startDate: mapDate(p.startDateOn),
    endDate: mapDate(p.endDateOn),
    description: p.description,
    location: p.location,
  }));

  const certifications = (data.certifications || []).map((c) => ({
    name: c.name,
    authority: c.authority || c.companyResolutionResult?.name,
    url: c.url,
  }));

  return {
    firstName: data.firstName,
    lastName: data.lastName,
    headline: data.headline,
    location: data.location,
    summary: data.summary,
    publicProfileUrl: data.publicProfileUrl,
    numConnections: data.numConnections,
    networkDistance: data.networkDistance,
    skills,
    educations,
    positions,
    certifications,
    canSendInMail: data.canSendInMail,
    contactInfo: data.contactInfo,
  };
}

const PROJECT_CANDIDATE_DECORATION =
  '(hiringContext,candidate,currentHiringProjectCandidate(entityUrn,candidateHiringState,candidateHiringStateUrn~(entityUrn,customName,statusType,vanityName),lastModified,created),contactInfo(emails,phones*,primaryPhone,primaryEmail),assessedCandidate(candidateRejectionRecord,rejectable,exportable,featuredSkills*,videoResponses*),notes*,candidateFeedbacksV2*,reviewNotes*,screenerQuestionAnswers*,candidateEvaluationUrn~(classification,summary,preferredCriteriaMatchCount,preferredCriteriaCount,requiredCriteriaMatchCount,requiredCriteriaCount,evaluationProcessingState),inMailCost,entityUrn)';

export async function getProjectCandidate(
  params: GetProjectCandidateInput,
): Promise<GetProjectCandidateOutput> {
  const { csrf, contractId, profileId, projectId } = params;

  const urn = tsHiringProjectCandidateByProfile(contractId, profileId, projectId);

  const data = await recruiterDecoratedGet<{
    entityUrn?: string;
    candidate?: string;
    inMailCost?: number;
    currentHiringProjectCandidate?: { candidateHiringState?: string };
    candidateHiringState?: string;
    notes?: unknown[];
    candidateFeedbacks?: unknown[];
    candidateFeedbacksV2?: unknown[];
    contactInfo?: Record<string, unknown>;
    assessedCandidate?: { rejectable?: boolean; exportable?: boolean };
    candidateEvaluationUrnResolutionResult?: {
      classification?: string;
      summary?: string;
      requiredCriteriaMatchCount?: number;
      requiredCriteriaCount?: number;
      preferredCriteriaMatchCount?: number;
      preferredCriteriaCount?: number;
    };
    tags?: unknown[];
  }>(
    csrf,
    'talentHiringProjectRecruitingProfiles',
    urn,
    PROJECT_CANDIDATE_DECORATION,
  );

  const evalResult = data.candidateEvaluationUrnResolutionResult;

  return {
    hiringProjectCandidateUrn: data.entityUrn,
    hireIdentityId: data.candidate
      ? parseHireIdentityId(data.candidate)
      : undefined,
    candidateHiringState:
      data.currentHiringProjectCandidate?.candidateHiringState ||
      data.candidateHiringState,
    inMailCost: data.inMailCost,
    notes: data.notes || [],
    tags: data.tags || [],
    feedback: data.candidateFeedbacksV2 || data.candidateFeedbacks || [],
    assessedCandidate: {
      rejectable: data.assessedCandidate?.rejectable,
      exportable: data.assessedCandidate?.exportable,
    },
    contactInfo: data.contactInfo,
    candidateEvaluation: evalResult
      ? {
          classification: evalResult.classification,
          summary: evalResult.summary,
          requiredCriteriaMatchCount: evalResult.requiredCriteriaMatchCount,
          requiredCriteriaCount: evalResult.requiredCriteriaCount,
          preferredCriteriaMatchCount: evalResult.preferredCriteriaMatchCount,
          preferredCriteriaCount: evalResult.preferredCriteriaCount,
        }
      : undefined,
  };
}

// Decoration + body confirmed from samples/talentHiringCandidates.txt.
const HIRING_CANDIDATES_DECORATION =
  '(entityUrn,memberProfile~(entityUrn,firstName,lastName,contactInfo,headline),hiringProjectRecruitingProfile~(entityUrn,notes*,candidateFeedbacksV2*,contactInfo(emails,phones*,primaryPhone,primaryEmail),assessedCandidate(rejectable),profileViews*,reviewNotes*,screenerQuestionAnswers*))';

export async function getCandidatesInProject(
  params: GetCandidatesInProjectInput,
): Promise<GetCandidatesInProjectOutput> {
  const { csrf, contractId, projectId, hireIdentityIds } = params;

  const candidateUrns = hireIdentityIds
    .map((id) => tsHiringCandidate(contractId, id))
    .map((u) => encodeURIComponent(u))
    .join(',');

  const query =
    `(candidates:List(${candidateUrns}),` +
    `hiringProject:${encodeURIComponent(tsHiringProject(contractId, projectId))},` +
    `hiringContext:${encodeURIComponent(tsContract(contractId))})`;

  const body =
    `decoration=${encodeURIComponent(HIRING_CANDIDATES_DECORATION)}` +
    `&q=projectCriteria&query=${query}`;

  const data = await recruiterFetch<{
    elements?: Array<{
      memberProfileResolutionResult?: {
        firstName?: string;
        lastName?: string;
      };
      hiringProjectRecruitingProfileResolutionResult?: {
        entityUrn?: string;
        notes?: unknown[];
        candidateFeedbacksV2?: unknown[];
        candidateFeedbacks?: unknown[];
        assessedCandidate?: { rejectable?: boolean };
      };
    }>;
  }>(csrf, 'talentHiringCandidates?q=projectCriteria', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const candidates = (data.elements || []).map((el) => {
    const member = el.memberProfileResolutionResult;
    const hpc = el.hiringProjectRecruitingProfileResolutionResult;
    return {
      hireIdentityId: hpc?.entityUrn
        ? parseHireIdentityId(hpc.entityUrn)
        : undefined,
      hiringProjectCandidateUrn: hpc?.entityUrn,
      firstName: member?.firstName,
      lastName: member?.lastName,
      notes: hpc?.notes || [],
      feedback: hpc?.candidateFeedbacksV2 || hpc?.candidateFeedbacks || [],
      assessedCandidate: { rejectable: hpc?.assessedCandidate?.rejectable },
    };
  });

  return { candidates };
}

const ACTIVITY_TYPES =
  'BACKGROUND_CHECK,CANDIDATE_REJECTION,HIRING_DOCUMENT,HRIS_PROFILE_EXPORT,LINK,MESSAGE,NOTE,PROFILE_SUBSCRIBE,PROFILE_UNSUBSCRIBE,PROFILE_SUBSCRIPTION_UPDATE,PROFILE_VIEW,PROJECT_CANDIDATE,PROJECT_STATUS,RECRUITER_CALL,RESUME_HIRING_DOCUMENT,TAG,THIRD_PARTY_ASSESSMENT';

/** Infer a coarse activity type from the inner urn segment of a recruiting_activity_item. */
function inferActivityType(urn: string): string | undefined {
  if (urn.includes('ts_cap_message')) return 'MESSAGE';
  if (urn.includes('ts_cap_profile_view')) return 'PROFILE_VIEW';
  if (urn.includes('ts_hiring_project_candidate_hiring_state_with_time'))
    return 'PROJECT_STATUS';
  if (urn.includes('ts_hiring_document_v2')) return 'HIRING_DOCUMENT';
  return undefined;
}

export async function getCandidateActivity(
  params: GetCandidateActivityInput,
): Promise<GetCandidateActivityOutput> {
  const { csrf, hireIdentityId, count = 20, start = 0 } = params;

  const variables =
    `(candidate:${tsHireIdentity(hireIdentityId)},sortOrder:DESCENDING,` +
    `activityTypes:List(${ACTIVITY_TYPES}),contracts:List(),start:${start},count:${count})`;

  const data = await recruiterGraphql<{
    recruitingActivityItemsByCandidate?: { '*elements'?: string[] };
  }>(
    csrf,
    'talentRecruitingActivityItems.d61a4b60146b6fb7d0cf6aa1a5c361ae',
    variables,
  );

  const elements = data.recruitingActivityItemsByCandidate?.['*elements'] || [];
  const activities = elements.map((urn) => ({
    activityUrn: urn,
    activityType: inferActivityType(urn),
  }));

  return { activities };
}

export async function getProfileResumeUrl(
  params: GetProfileResumeUrlInput,
): Promise<GetProfileResumeUrlOutput> {
  const { csrf, profileId } = params;

  const data = await recruiterFetch<{ value?: string }>(
    csrf,
    'talentProfiles?action=generatePDFResumeForCandidates',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        profileIds: [`urn:li:ts_profile:${profileId}`],
      }),
    },
  );

  return { url: data.value };
}

// ============================================================================
// Messaging (reads only)
// ============================================================================

const MAILBOX_SUMMARY_DECORATION =
  '(numUnseenMessages,inboxHomeUrl,recentMessages*(read,createdAt,subject,body,url,senderFirstName,senderLastName,senderProfile~(entityUrn,firstName,lastName,headline,publicProfileUrl)))';

export async function getMailboxSummary(
  params: GetMailboxSummaryInput,
): Promise<GetMailboxSummaryOutput> {
  const { csrf } = params;

  const data = await recruiterFetch<{
    numUnseenMessages?: number;
    recentMessages?: Array<{
      subject?: string;
      body?: string;
      createdAt?: number;
      read?: boolean;
      senderFirstName?: string;
      senderLastName?: string;
      senderProfileResolutionResult?: {
        firstName?: string;
        lastName?: string;
        publicProfileUrl?: string;
      };
    }>;
  }>(
    csrf,
    `talentMailboxSummary?decoration=${encodeRestLi(MAILBOX_SUMMARY_DECORATION)}`,
  );

  const recentMessages = (data.recentMessages || []).map((m) => {
    const sender = m.senderProfileResolutionResult;
    const senderName =
      [
        m.senderFirstName || sender?.firstName,
        m.senderLastName || sender?.lastName,
      ]
        .filter(Boolean)
        .join(' ') || undefined;
    return {
      subject: m.subject,
      body: m.body,
      createdAt: m.createdAt,
      read: m.read,
      senderName,
      senderProfileUrl: sender?.publicProfileUrl,
    };
  });

  return { numUnseen: data.numUnseenMessages, recentMessages };
}

export async function getMailboxMetadata(
  params: GetMailboxMetadataInput,
): Promise<GetMailboxMetadataOutput> {
  const { csrf, seatId } = params;

  const variables = `(seatIds:List(${tsSeat(seatId)}))`;

  const data = await recruiterGraphql<{
    mailboxMetadataByIds?: Array<{
      hasDelegatedMailbox?: boolean;
      quickFilters?: Array<{
        name?: string;
        displayName?: string;
        unreadCount?: number;
      }>;
    }>;
  }>(
    csrf,
    'talentMailboxMetadata.3344e506f4573f1ca523c34ad981ee3c',
    variables,
  );

  const mailbox = data.mailboxMetadataByIds?.[0];
  const filters = (mailbox?.quickFilters || []).map((f) => ({
    name: f.name,
    displayName: f.displayName,
    unreadCount: f.unreadCount,
  }));

  return { filters, hasDelegatedMailbox: mailbox?.hasDelegatedMailbox };
}

export async function getConversation(
  params: GetRecruiterConversationInput,
): Promise<GetRecruiterConversationOutput> {
  const { csrf, conversationUrn, seatId, count = 15, start = 0 } = params;

  const variables =
    `(conversationUrn:${conversationUrn},start:${start},count:${count},ownerSeat:${tsSeat(seatId)})`;

  // Captures only ever returned a `*conversationsByUrn` ref (hydration deferred).
  // Return the resolved object if present, else the raw resolver map + the ref.
  const data = await recruiterGraphql<Record<string, unknown>>(
    csrf,
    'talentConversations.9cc3867d182b15e8e8eb142a7d0abbc3',
    variables,
  );

  const resolved = data['conversationsByUrn'];
  if (resolved && typeof resolved === 'object') {
    return {
      conversationUrn,
      messages: (resolved as { messages?: unknown[] }).messages,
      raw: resolved,
    };
  }

  return { conversationUrn, raw: data };
}

export async function getCandidateMessages(
  params: GetCandidateMessagesInput,
): Promise<GetCandidateMessagesOutput> {
  const { csrf, hireIdentityId, threadUrn, count = 50, start = 0 } = params;

  const variables =
    `(candidate:${tsHireIdentity(hireIdentityId)},thread:${threadUrn},start:${start},count:${count})`;

  const data = await recruiterGraphql<{
    candidateMessagesByThread?: { '*elements'?: string[] };
  }>(
    csrf,
    'talentCandidateMessages.335ee9d4c487ad39dd64cfa7c39feae1',
    variables,
  );

  const messageUrns = data.candidateMessagesByThread?.['*elements'] || [];

  return { messageUrns };
}

// ============================================================================
// Sourcing channels & misc reads
// ============================================================================

export async function listSourcingChannels(
  params: ListSourcingChannelsInput,
): Promise<ListSourcingChannelsOutput> {
  const {
    csrf,
    contractId,
    projectId,
    types = ['APPLY_STARTERS'],
    states = ['ACTIVE'],
    count = 10,
  } = params;

  const variables =
    `(hiringProject:${tsHiringProject(contractId, projectId)},` +
    `types:List(${types.join(',')}),states:List(${states.join(',')}),count:${count})`;

  const data = await recruiterGraphql<{
    sourcingChannelsByHiringProject?: { '*elements'?: string[] };
  }>(
    csrf,
    'talentSourcingChannels.788c1a713b9cfbf755005a27d03d2522',
    variables,
  );

  const channelUrns =
    data.sourcingChannelsByHiringProject?.['*elements'] || [];
  const channels = channelUrns.map((channelUrn) => ({
    channelUrn,
    channelId: parseSourcingChannelId(channelUrn),
  }));

  return { channels };
}

const NOTIFICATION_CARD_DECORATION =
  '(entityUrn,notificationCardId,publishedAt,headline,subHeadline,contentText*,cardAction)';

export async function listRecruiterNotifications(
  params: ListRecruiterNotificationsInput,
): Promise<ListRecruiterNotificationsOutput> {
  const { csrf, count = 13, onlyUnseen = false, start = 0 } = params;

  const data = await recruiterFetch<{
    metadata?: { numUnseen?: number };
    elements?: Array<{
      publishedAt?: number;
      subHeadline?: { text?: string };
      contentText?: Array<{ text?: string }>;
      cardAction?: {
        displayText?: { text?: string };
        actionTarget?: string;
      };
    }>;
  }>(
    csrf,
    `talentNotificationCards?q=loginUser&decoration=${encodeRestLi(NOTIFICATION_CARD_DECORATION)}` +
      `&count=${count}&onlyUnseen=${onlyUnseen}&start=${start}`,
  );

  const notifications = (data.elements || []).map((n) => ({
    text: n.contentText?.map((c) => c.text).filter(Boolean).join(' ') || undefined,
    subHeadline: n.subHeadline?.text,
    publishedAt: n.publishedAt,
    actionUrl: n.cardAction?.actionTarget,
    actionText: n.cardAction?.displayText?.text,
  }));

  const hasMore = notifications.length >= count;

  return { numUnseen: data.metadata?.numUnseen, notifications, hasMore };
}

export async function listRecruiterTags(
  params: ListRecruiterTagsInput,
): Promise<ListRecruiterTagsOutput> {
  const { csrf, count = 50 } = params;

  const data = await recruiterFetch<{
    elements?: Array<{
      entityUrn?: string;
      tag?: string;
      type?: string;
      contractUrn?: string;
    }>;
  }>(csrf, `talentRecruiterTags?count=${count}`);

  const tags = (data.elements || []).map((t) => ({
    tagId: t.entityUrn?.match(/ts_cap_tag:(\d+)/)?.[1],
    tag: t.tag,
    type: t.type,
    contractUrn: t.contractUrn,
  }));

  return { tags };
}

// ============================================================================
// Mutation (the only buildable one — see file header for the NOT BUILDABLE list)
// ============================================================================

export async function logProfileView(
  params: LogProfileViewInput,
): Promise<LogProfileViewOutput> {
  const {
    csrf,
    contractId,
    seatId,
    hireIdentityId,
    projectId,
    sourcingChannelId,
    entryPointType = 'SEARCH_CONTEXTUAL',
    commandName = 'FETCH_PROFILE',
  } = params;

  const body = {
    hiringContext: tsContract(contractId),
    performedAt: Date.now(),
    commandName,
    entityId: Number(hireIdentityId),
    runTime: 0,
    seat: tsSeat(seatId),
    successful: true,
    hireIdentity: tsHireIdentity(hireIdentityId),
    hireIdentityUrn: tsHireIdentity(hireIdentityId),
    hiringProject: tsHiringProject(contractId, projectId),
    sourcingChannel: tsSourcingChannel(contractId, sourcingChannelId),
    profileViewEntryPointType: entryPointType,
  };

  // Returns 201 with an empty body.
  await recruiterFetch<void>(csrf, 'talentCandidateProfileView', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });

  return { success: true };
}
