import { ContractDrift, NotFound, UpstreamError, Validation } from '@vallum/_runtime';

export type {
  Job,
  JobDetail,
  ApplicationForm,
  Team,
  LightweightPosting,
  Department,
  ListJobsOutput,
  GetJobOutput,
  SearchJobsOutput,
  ListTeamsOutput,
  ListDepartmentsOutput,
  GetApplicationFormOutput,
} from './schemas';

import type {
  Job,
  JobDetail,
  ListJobsOutput,
  SearchJobsOutput,
  ListTeamsOutput,
  ListDepartmentsOutput,
  GetApplicationFormOutput,
} from './schemas';

const POSTING_API_ORIGIN = 'https://api.ashbyhq.com';
const JOBS_ORIGIN = 'https://jobs.ashbyhq.com';

const API_JOB_BOARD_WITH_TEAMS_QUERY = `
query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    teams { id name parentTeamId __typename }
    jobPostings { id title teamId locationName employmentType secondaryLocations { locationName __typename } compensationTierSummary __typename }
    __typename
  }
}`;

const API_JOB_POSTING_QUERY = `
query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    title
    departmentName
    teamNames
    locationName
    workplaceType
    employmentType
    descriptionHtml
    isListed
    compensationTierSummary
    compensationTiers { id title tierSummary }
    secondaryLocationNames
    publishedDate
    linkedData
    applicationForm { sections { title fieldEntries { field isRequired } } }
  }
}`;

type PostingApiResponse = {
  jobs?: Job[];
  apiVersion?: number;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type JobBoardWithTeamsResponse = {
  jobBoard?: {
    teams?: Array<{
      id: string;
      name: string;
      parentTeamId: string | null;
    }>;
    jobPostings?: Array<{
      id: string;
      title: string;
      teamId?: string | null;
      locationName?: string | null;
      employmentType?: Job['employmentType'];
      secondaryLocations?: Array<{ locationName?: string | null }>;
      compensationTierSummary?: string | null;
    }>;
  } | null;
};

type JobPostingResponse = {
  jobPosting?: JobDetail | null;
};

function validateSlug(name: string, label: string): string {
  const value = name?.trim();
  if (!value) {
    throw new Validation(`${label} is required`);
  }
  if (value.includes('/')) {
    throw new Validation(`${label} must be the Ashby URL slug only, not a full path: ${value}`);
  }
  return value;
}

function validateJobId(jobId: string): string {
  const value = jobId?.trim();
  if (!value) {
    throw new Validation('jobId is required');
  }
  return value;
}

async function readJson<T>(response: Response, url: string): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    const body = text ? ` body: ${truncate(text)}` : '';
    if (response.status === 404) {
      throw new NotFound(`Ashby resource not found. URL: ${url} status: ${response.status}${body}`);
    }
    throw new UpstreamError(`Ashby request failed. URL: ${url} status: ${response.status}${body}`);
  }

  if (!text) {
    throw new ContractDrift(`Ashby returned an empty JSON response. URL: ${url}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ContractDrift(`Ashby returned non-JSON response. URL: ${url} body: ${truncate(text)}`);
  }
}

function truncate(text: string): string {
  return text.length > 1000 ? `${text.slice(0, 1000)}... [truncated]` : text;
}

async function fetchPostingBoard(jobBoardName: string, includeCompensation: boolean): Promise<ListJobsOutput> {
  const board = validateSlug(jobBoardName, 'jobBoardName');
  const url = `${POSTING_API_ORIGIN}/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=${includeCompensation ? 'true' : 'false'}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });
  const data = await readJson<PostingApiResponse>(response, url);

  if (!Array.isArray(data.jobs)) {
    throw new ContractDrift(`Ashby Posting API response missing jobs array. URL: ${url}`);
  }

  return {
    jobs: data.jobs,
    total: data.jobs.length,
    apiVersion: data.apiVersion,
  };
}

async function ashbyGraphQL<T>(
  operationName: 'ApiJobBoardWithTeams' | 'ApiJobPosting',
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const url = `${JOBS_ORIGIN}/api/non-user-graphql?op=${encodeURIComponent(operationName)}`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operationName, variables, query }),
  });
  const parsed = await readJson<GraphQLResponse<T>>(response, url);

  if (parsed.errors?.length) {
    throw new UpstreamError(`Ashby GraphQL errors. URL: ${url} errors: ${truncate(JSON.stringify(parsed.errors))}`);
  }
  if (!parsed.data) {
    throw new ContractDrift(`Ashby GraphQL response missing data. URL: ${url}`);
  }

  return parsed.data;
}

function textMatches(value: string | null | undefined, query: string): boolean {
  return (value ?? '').toLowerCase().includes(query.toLowerCase());
}

function locationMatches(job: Job, location: string): boolean {
  if (textMatches(job.location, location)) return true;
  return (job.secondaryLocations ?? []).some((secondary) => textMatches(secondary.location, location));
}

export async function listJobs(opts: {
  jobBoardName: string;
  includeCompensation?: boolean;
}): Promise<ListJobsOutput> {
  return fetchPostingBoard(opts.jobBoardName, opts.includeCompensation ?? true);
}

export async function getJob(opts: {
  jobBoardName: string;
  jobId: string;
}): Promise<JobDetail> {
  const board = validateSlug(opts.jobBoardName, 'jobBoardName');
  const jobId = validateJobId(opts.jobId);
  const data = await ashbyGraphQL<JobPostingResponse>('ApiJobPosting', API_JOB_POSTING_QUERY, {
    organizationHostedJobsPageName: board,
    jobPostingId: jobId,
  });

  if (!data.jobPosting) {
    throw new NotFound(`Ashby job not found. jobBoardName: ${board} jobId: ${jobId}`);
  }

  return data.jobPosting;
}

export async function searchJobs(opts: {
  jobBoardName: string;
  query?: string;
  location?: string;
  department?: string;
  team?: string;
  isRemote?: boolean;
  workplaceType?: Job['workplaceType'];
  employmentType?: Job['employmentType'];
}): Promise<SearchJobsOutput> {
  const { jobs } = await fetchPostingBoard(opts.jobBoardName, true);
  const query = opts.query?.trim();
  const location = opts.location?.trim();
  const department = opts.department?.trim();
  const team = opts.team?.trim();

  const filtered = jobs.filter((job) => {
    if (query && !textMatches(`${job.title ?? ''}\n${job.descriptionPlain ?? ''}`, query)) return false;
    if (location && !locationMatches(job, location)) return false;
    if (department && !textMatches(job.department, department)) return false;
    if (team && !textMatches(job.team, team)) return false;
    if (opts.isRemote !== undefined && job.isRemote !== opts.isRemote) return false;
    if (opts.workplaceType && job.workplaceType !== opts.workplaceType) return false;
    if (opts.employmentType && job.employmentType !== opts.employmentType) return false;
    return true;
  });

  return {
    jobs: filtered,
    total: filtered.length,
  };
}

export async function listTeams(opts: { jobBoardName: string }): Promise<ListTeamsOutput> {
  const board = validateSlug(opts.jobBoardName, 'jobBoardName');
  const data = await ashbyGraphQL<JobBoardWithTeamsResponse>(
    'ApiJobBoardWithTeams',
    API_JOB_BOARD_WITH_TEAMS_QUERY,
    { organizationHostedJobsPageName: board },
  );

  if (!data.jobBoard) {
    throw new NotFound(`Ashby job board not found. jobBoardName: ${board}`);
  }

  if (!Array.isArray(data.jobBoard.teams)) {
    throw new ContractDrift(`Ashby team hierarchy response missing teams array. jobBoardName: ${board}`);
  }
  if (!Array.isArray(data.jobBoard.jobPostings)) {
    throw new ContractDrift(`Ashby team hierarchy response missing jobPostings array. jobBoardName: ${board}`);
  }

  const jobPostings = data.jobBoard.jobPostings;
  const jobCounts = new Map<string, number>();
  for (const posting of jobPostings) {
    if (posting.teamId) {
      jobCounts.set(posting.teamId, (jobCounts.get(posting.teamId) ?? 0) + 1);
    }
  }

  const teams = data.jobBoard.teams.map((team) => ({
    id: team.id,
    name: team.name,
    parentTeamId: team.parentTeamId,
    jobCount: jobCounts.get(team.id) ?? 0,
  }));

  return {
    teams,
    jobPostings,
    total: teams.length,
  };
}

export async function listDepartments(opts: { jobBoardName: string }): Promise<ListDepartmentsOutput> {
  const { jobs } = await fetchPostingBoard(opts.jobBoardName, true);
  const counts = new Map<string, number>();

  for (const job of jobs) {
    const name = job.department?.trim() || 'Uncategorized';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const departments = [...counts.entries()]
    .map(([name, jobCount]) => ({ name, jobCount }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    departments,
    total: departments.length,
  };
}

export async function getApplicationForm(opts: {
  jobBoardName: string;
  jobId: string;
}): Promise<GetApplicationFormOutput> {
  const job = await getJob(opts);

  return {
    jobId: job.id,
    title: job.title,
    applicationForm: job.applicationForm ?? null,
  };
}
