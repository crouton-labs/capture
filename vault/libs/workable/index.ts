import { ContractDrift, NotFound, Validation, throwForStatus } from '@vallum/_runtime';

export type {
  GetJobInput,
  GetJobOutput,
  ListDepartmentsInput,
  ListDepartmentsOutput,
  ListJobsInput,
  ListJobsOutput,
  ListLocationsInput,
  ListLocationsOutput,
  WorkableBoardMeta,
  WorkableDepartment,
  WorkableJobDetail,
  WorkableJobSummary,
  WorkableLocation,
} from './schemas';

import type {
  GetJobInput,
  GetJobOutput,
  ListDepartmentsInput,
  ListDepartmentsOutput,
  ListJobsInput,
  ListJobsOutput,
  ListLocationsInput,
  ListLocationsOutput,
  WorkableDepartment,
  WorkableJobDetail,
  WorkableJobSummary,
  WorkableLocation,
} from './schemas';

const WORKABLE_ORIGIN = 'https://apply.workable.com';

function requireWindowOrigin(): string {
  if (typeof window === 'undefined' || !window.location?.origin) {
    throw new Validation('Workable functions must run in a browser on https://apply.workable.com');
  }
  if (window.location.origin !== WORKABLE_ORIGIN) {
    throw new Validation(`Workable functions must run on ${WORKABLE_ORIGIN}. Current URL: ${window.location.href}`);
  }
  return window.location.origin;
}

function requireBoardSlug(value: string): string {
  const slug = value?.trim();
  if (!slug) {
    throw new Validation('boardSlug is required');
  }
  if (slug.includes('/') || slug.includes('?') || slug.includes('#')) {
    throw new Validation(`boardSlug must be a single Workable path segment: ${slug}`);
  }
  return slug;
}

function requireJobId(value: string): string {
  const jobId = value?.trim();
  if (!jobId) {
    throw new Validation('jobId is required');
  }
  if (jobId.includes('/') || jobId.includes('?') || jobId.includes('#')) {
    throw new Validation(`jobId must be a single Workable shortcode segment: ${jobId}`);
  }
  return jobId;
}

function boardBaseUrl(boardSlug: string): string {
  const origin = requireWindowOrigin();
  const slug = requireBoardSlug(boardSlug);
  return `${origin}/${encodeURIComponent(slug)}`;
}

function jobsMarkdownUrl(boardSlug: string): string {
  return `${boardBaseUrl(boardSlug)}/jobs.md`;
}

function jobMarkdownUrl(boardSlug: string, jobId: string): string {
  return `${boardBaseUrl(boardSlug)}/jobs/view/${encodeURIComponent(requireJobId(jobId))}.md`;
}

function jobPublicUrl(boardSlug: string, jobId: string): string {
  return `${boardBaseUrl(boardSlug)}/jobs/view/${encodeURIComponent(requireJobId(jobId))}`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: {
      Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.8',
    },
  });
  const text = await response.text().catch(() => '');

  if (!response.ok) {
    const message = `Workable request failed. URL: ${url} Status: ${response.status} ${response.statusText}. Body: ${text.slice(0, 500)}`;
    if (response.status === 404) {
      throw new NotFound(message);
    }
    throwForStatus(response.status, message);
  }

  if (!text.trim()) {
    throw new ContractDrift(`Workable returned an empty response. URL: ${url}`);
  }

  return text;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function parseHeader(text: string): { companyName: string; lastUpdated: string } {
  const lines = splitLines(text);
  const titleLine = lines.find((line) => line.startsWith('# '));
  if (!titleLine) {
    throw new ContractDrift('Workable jobs markdown is missing the title heading');
  }
  const titleMatch = titleLine.match(/^#\s+(.+?)\s+[—-]\s+All Open Positions\s*$/);
  if (!titleMatch) {
    throw new ContractDrift(`Workable jobs markdown title has an unexpected shape: ${titleLine}`);
  }

  const updatedLine = lines.find((line) => /^>\s+Last updated:/.test(line));
  if (!updatedLine) {
    throw new ContractDrift('Workable jobs markdown is missing the last-updated line');
  }
  const updatedMatch = updatedLine.match(/^>\s+Last updated:\s+(.+)\s*$/);
  if (!updatedMatch) {
    throw new ContractDrift(`Workable jobs markdown last-updated line has an unexpected shape: ${updatedLine}`);
  }

  return {
    companyName: titleMatch[1].trim(),
    lastUpdated: updatedMatch[1].trim(),
  };
}

function parseTableCell(value: string): string {
  return value.trim();
}

function parseMarkdownLink(cell: string): string {
  const match = cell.match(/\((https:\/\/[^)]+)\)/);
  if (!match) {
    throw new ContractDrift(`Workable jobs markdown row is missing a public link: ${cell}`);
  }
  return match[1];
}

function rowCells(row: string): string[] {
  const trimmed = row.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return [];
  }
  return trimmed.slice(1, -1).split('|').map(parseTableCell);
}

function parseJobs(text: string, boardSlug: string): { jobs: WorkableJobSummary[]; departments: WorkableDepartment[]; locations: WorkableLocation[] } {
  const lines = splitLines(text);
  const headerIndex = lines.findIndex((line) => line.includes('| Title | Department | Location | Type | Salary | Posted | Details |'));
  if (headerIndex < 0) {
    throw new ContractDrift('Workable jobs markdown is missing the jobs table header');
  }

  const jobs: WorkableJobSummary[] = [];
  const departmentCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) {
      break;
    }

    const cells = rowCells(line);
    if (cells.length !== 7) {
      throw new ContractDrift(`Workable jobs markdown row has ${cells.length} cells instead of 7: ${line}`);
    }

    const detailsUrl = parseMarkdownLink(cells[6]);
    const markdownUrl = detailsUrl.endsWith('.md') ? detailsUrl : `${detailsUrl}.md`;
    const publicUrl = markdownUrl.endsWith('.md') ? markdownUrl.slice(0, -3) : markdownUrl;
    const jobIdMatch = markdownUrl.match(/\/jobs\/view\/([^/]+)\.md$/);
    if (!jobIdMatch) {
      throw new ContractDrift(`Workable jobs markdown detail link has an unexpected shape: ${detailsUrl}`);
    }

    const department = cells[1];
    const location = cells[2];

    jobs.push({
      id: jobIdMatch[1],
      title: cells[0],
      department,
      location,
      type: cells[3],
      salary: cells[4],
      postedOn: cells[5],
      publicUrl,
      markdownUrl,
    });

    departmentCounts.set(department, (departmentCounts.get(department) ?? 0) + 1);
    locationCounts.set(location, (locationCounts.get(location) ?? 0) + 1);
  }

  const departments = [...departmentCounts.entries()].map(([name, count]) => ({ name, count }));
  const locations = [...locationCounts.entries()].map(([label, count]) => ({ label, count }));

  return { jobs, departments, locations };
}

function parseJobDetail(text: string, boardSlug: string, jobId: string): WorkableJobDetail {
  const lines = splitLines(text);
  const titleLine = lines.find((line) => line.startsWith('# '));
  if (!titleLine) {
    throw new ContractDrift('Workable job detail markdown is missing the title heading');
  }
  const title = titleLine.slice(2).trim();

  const summaryLine = lines.find((line) => line.startsWith('> '));
  if (!summaryLine) {
    throw new ContractDrift('Workable job detail markdown is missing the summary line');
  }
  const summaryMatch = summaryLine.match(/^>\s+(.+?)\s+·\s+(.+?)\s+·\s+(.+?)\s+·\s+Posted\s+(.+)\s*$/);
  if (!summaryMatch) {
    throw new ContractDrift(`Workable job detail summary line has an unexpected shape: ${summaryLine}`);
  }

  const workplaceLine = lines.find((line) => /^\*\*Workplace:\*\*/.test(line));
  const departmentLine = lines.find((line) => /^\*\*Department:\*\*/.test(line));
  if (!workplaceLine || !departmentLine) {
    throw new ContractDrift('Workable job detail markdown is missing workplace or department lines');
  }

  const workplaceMatch = workplaceLine.match(/^\*\*Workplace:\*\*\s*(.+)\s*$/);
  const departmentMatch = departmentLine.match(/^\*\*Department:\*\*\s*(.+)\s*$/);
  if (!workplaceMatch || !departmentMatch) {
    throw new ContractDrift('Workable job detail markdown workplace or department line has an unexpected shape');
  }

  const descriptionIndex = lines.findIndex((line) => line.trim() === '## Description');
  if (descriptionIndex < 0) {
    throw new ContractDrift('Workable job detail markdown is missing the description section');
  }

  const descriptionMarkdown = lines.slice(descriptionIndex + 1).join('\n').trim();
  if (!descriptionMarkdown) {
    throw new ContractDrift('Workable job detail markdown has an empty description section');
  }

  return {
    id: jobId,
    title,
    companyName: summaryMatch[1].trim(),
    location: summaryMatch[2].trim(),
    type: summaryMatch[3].trim(),
    postedOn: summaryMatch[4].trim(),
    workplace: workplaceMatch[1].trim(),
    department: departmentMatch[1].trim(),
    salary: '—',
    publicUrl: jobPublicUrl(boardSlug, jobId),
    markdownUrl: jobMarkdownUrl(boardSlug, jobId),
    descriptionMarkdown,
  };
}

function boardMeta(boardSlug: string, companyName: string, lastUpdated: string) {
  const slug = requireBoardSlug(boardSlug);
  return {
    boardSlug: slug,
    boardUrl: `${WORKABLE_ORIGIN}/${encodeURIComponent(slug)}/`,
    companyName,
    lastUpdated,
  };
}

async function readBoard(boardSlug: string): Promise<{ meta: ReturnType<typeof boardMeta>; jobs: WorkableJobSummary[]; departments: WorkableDepartment[]; locations: WorkableLocation[] }> {
  const slug = requireBoardSlug(boardSlug);
  const markdown = await fetchText(jobsMarkdownUrl(slug));
  const header = parseHeader(markdown);
  const { jobs, departments, locations } = parseJobs(markdown, slug);
  return {
    meta: boardMeta(slug, header.companyName, header.lastUpdated),
    jobs,
    departments,
    locations,
  };
}

export async function listJobs(opts: ListJobsInput): Promise<ListJobsOutput> {
  const board = await readBoard(opts.boardSlug);
  return {
    ...board.meta,
    total: board.jobs.length,
    jobs: board.jobs,
    departments: board.departments,
    locations: board.locations,
  };
}

export async function getJob(opts: GetJobInput): Promise<GetJobOutput> {
  const slug = requireBoardSlug(opts.boardSlug);
  const jobId = requireJobId(opts.jobId);
  const board = await readBoard(slug);
  const markdown = await fetchText(jobMarkdownUrl(slug, jobId));
  const summary = board.jobs.find((job) => job.id === jobId);
  const job = parseJobDetail(markdown, slug, jobId);
  return {
    ...board.meta,
    job: summary
      ? {
          ...job,
          title: summary.title,
          location: summary.location,
          type: summary.type,
          salary: summary.salary,
          postedOn: summary.postedOn,
          publicUrl: summary.publicUrl,
          markdownUrl: summary.markdownUrl,
        }
      : job,
  };
}

export async function listDepartments(opts: ListDepartmentsInput): Promise<ListDepartmentsOutput> {
  const board = await readBoard(opts.boardSlug);
  return {
    ...board.meta,
    departments: board.departments,
  };
}

export async function listLocations(opts: ListLocationsInput): Promise<ListLocationsOutput> {
  const board = await readBoard(opts.boardSlug);
  return {
    ...board.meta,
    locations: board.locations,
  };
}
