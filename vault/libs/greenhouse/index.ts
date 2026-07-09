import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

export type {
  Board,
  DataCompliance,
  DepartmentChild,
  Department,
  DemographicQuestions,
  GreenhouseJob,
  JobQuestion,
  JobQuestionField,
  JobSection,
  MetadataItem,
  Office,
  OfficeChild,
  PayInputRange,
  GetBoardOutput,
  ListJobsOutput,
  GetJobOutput,
  ListDepartmentsOutput,
  GetDepartmentOutput,
  ListOfficesOutput,
  GetOfficeOutput,
  ListSectionsOutput,
  SearchJobsOutput,
} from './schemas';

import type {
  GreenhouseJob,
  GetBoardOutput,
  ListJobsOutput,
  GetJobOutput,
  ListDepartmentsOutput,
  GetDepartmentOutput,
  ListOfficesOutput,
  GetOfficeOutput,
  ListSectionsOutput,
  SearchJobsOutput,
} from './schemas';

const GREENHOUSE_API_BASE = 'https://boards.greenhouse.io';

function requireToken(boardToken: string): string {
  const token = boardToken?.trim();
  if (!token) {
    throw new Validation('boardToken is required for Greenhouse public board requests.');
  }
  return encodeURIComponent(token);
}

function requireNumericId(value: number, fieldName: string): number {
  if (!Number.isFinite(value)) {
    throw new Validation(`${fieldName} must be a finite numeric Greenhouse ID.`);
  }
  return value;
}

async function greenhouseFetch<T>(path: string): Promise<T> {
  const url = new URL(path, GREENHOUSE_API_BASE).toString();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  const text = await response.text().catch(() => '');

  if (!response.ok) {
    throwForStatus(
      response.status,
      `Greenhouse API ${response.status} for ${url}: ${text}`,
    );
  }

  if (!text) {
    throw new ContractDrift(`Greenhouse returned an empty response for ${url}.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 2000 ? `${text.slice(0, 2000)}... [truncated]` : text;
    throw new ContractDrift(
      `Greenhouse returned non-JSON response for ${url}: ${truncated}`,
    );
  }
}

function boardPath(boardToken: string, suffix = ''): string {
  return `/v1/boards/${requireToken(boardToken)}${suffix}`;
}

function matchesText(value: string | undefined, needle: string | undefined): boolean {
  if (!needle) return true;
  return (value ?? '').toLocaleLowerCase().includes(needle);
}

function matchesDepartment(job: GreenhouseJob, needle: string | undefined): boolean {
  if (!needle) return true;
  return (job.departments ?? []).some((department) =>
    department.name.toLocaleLowerCase().includes(needle),
  );
}

function matchesOffice(job: GreenhouseJob, needle: string | undefined): boolean {
  if (!needle) return true;
  return (job.offices ?? []).some((office) =>
    office.name.toLocaleLowerCase().includes(needle),
  );
}

export async function getBoard(opts: { boardToken: string }): Promise<GetBoardOutput> {
  return greenhouseFetch<GetBoardOutput>(boardPath(opts.boardToken));
}

export async function listJobs(opts: {
  boardToken: string;
  content?: boolean;
}): Promise<ListJobsOutput> {
  const query = opts.content ? '?content=true' : '';
  return greenhouseFetch<ListJobsOutput>(boardPath(opts.boardToken, `/jobs${query}`));
}

export async function getJob(opts: {
  boardToken: string;
  jobId: number;
  questions?: boolean;
  pay_transparency?: boolean;
}): Promise<GetJobOutput> {
  const jobId = requireNumericId(opts.jobId, 'jobId');
  const params = new URLSearchParams();
  if (opts.questions) params.set('questions', 'true');
  if (opts.pay_transparency) params.set('pay_transparency', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  return greenhouseFetch<GetJobOutput>(
    boardPath(opts.boardToken, `/jobs/${encodeURIComponent(String(jobId))}${query}`),
  );
}

export async function listDepartments(opts: {
  boardToken: string;
  render_as?: 'list' | 'tree';
}): Promise<ListDepartmentsOutput> {
  const params = new URLSearchParams();
  if (opts.render_as) params.set('render_as', opts.render_as);
  const query = params.toString() ? `?${params.toString()}` : '';
  return greenhouseFetch<ListDepartmentsOutput>(boardPath(opts.boardToken, `/departments${query}`));
}

export async function getDepartment(opts: {
  boardToken: string;
  departmentId: number;
}): Promise<GetDepartmentOutput> {
  const departmentId = requireNumericId(opts.departmentId, 'departmentId');
  return greenhouseFetch<GetDepartmentOutput>(
    boardPath(opts.boardToken, `/departments/${encodeURIComponent(String(departmentId))}`),
  );
}

export async function listOffices(opts: {
  boardToken: string;
  render_as?: 'list' | 'tree';
}): Promise<ListOfficesOutput> {
  const params = new URLSearchParams();
  if (opts.render_as) params.set('render_as', opts.render_as);
  const query = params.toString() ? `?${params.toString()}` : '';
  return greenhouseFetch<ListOfficesOutput>(boardPath(opts.boardToken, `/offices${query}`));
}

export async function getOffice(opts: {
  boardToken: string;
  officeId: number;
  render_as?: 'list' | 'tree';
}): Promise<GetOfficeOutput> {
  const officeId = requireNumericId(opts.officeId, 'officeId');
  const params = new URLSearchParams();
  if (opts.render_as) params.set('render_as', opts.render_as);
  const query = params.toString() ? `?${params.toString()}` : '';
  return greenhouseFetch<GetOfficeOutput>(
    boardPath(opts.boardToken, `/offices/${encodeURIComponent(String(officeId))}${query}`),
  );
}

export async function listSections(opts: {
  boardToken: string;
}): Promise<ListSectionsOutput> {
  return greenhouseFetch<ListSectionsOutput>(boardPath(opts.boardToken, '/sections'));
}

export async function searchJobs(opts: {
  boardToken: string;
  query?: string;
  location?: string;
  department?: string;
  office?: string;
}): Promise<SearchJobsOutput> {
  const query = opts.query?.trim().toLocaleLowerCase();
  const location = opts.location?.trim().toLocaleLowerCase();
  const department = opts.department?.trim().toLocaleLowerCase();
  const office = opts.office?.trim().toLocaleLowerCase();
  const allJobs = await listJobs({ boardToken: opts.boardToken, content: true });
  const jobs = allJobs.jobs.filter(
    (job) =>
      matchesText(job.title, query) &&
      matchesText(job.location?.name, location) &&
      matchesDepartment(job, department) &&
      matchesOffice(job, office),
  );

  return {
    jobs,
    meta: {
      total: jobs.length,
    },
  };
}
