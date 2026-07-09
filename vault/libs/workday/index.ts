import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

export type {
  GetJobInput,
  GetJobOutput,
  ListJobsInput,
  ListJobsOutput,
  WorkdayAppliedFacetsParam,
  WorkdayFacetGroup,
  WorkdayFacetNode,
  WorkdayFacetValue,
  WorkdayHiringOrganization,
  WorkdayJobPostingInfo,
  WorkdayListJobPosting,
  WorkdaySimilarJob,
} from './schemas';

import type {
  GetJobInput,
  GetJobOutput,
  ListJobsInput,
  ListJobsOutput,
  WorkdayFacetGroup,
  WorkdayFacetNode,
  WorkdayHiringOrganization,
  WorkdayJobPostingInfo,
  WorkdayListJobPosting,
  WorkdaySimilarJob,
} from './schemas';

type RawObject = Record<string, unknown>;

function trim(value: string): string {
  return value.trim();
}

function requiredText(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new ContractDrift(`${context} must be a string`);
  }
  const text = value.trim();
  if (!text) {
    throw new ContractDrift(`${context} must be a non-empty string`);
  }
  return text;
}

function stringValue(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new ContractDrift(`${context} must be a string`);
  }
  return value;
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ContractDrift(`${context} must be a string when present`);
  }
  const text = value.trim();
  return text ? text : undefined;
}

function boolValue(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ContractDrift(`${context} must be a boolean`);
  }
  return value;
}

function intValue(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ContractDrift(`${context} must be a non-negative integer`);
  }
  return value;
}

function arrayValue(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ContractDrift(`${context} must be an array`);
  }
  return value;
}

function objectValue(value: unknown, context: string): RawObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractDrift(`${context} must be an object`);
  }
  return value as RawObject;
}

function requiredStringArray(value: unknown, context: string): string[] {
  return arrayValue(value, context).map((entry, index) => requiredText(entry, `${context}[${index}]`));
}

function optionalStringArray(value: unknown, context: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  return requiredStringArray(value, context);
}

function optionalNullableText(value: unknown, context: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return requiredText(value, context);
}

function requiredCountry(value: unknown, context: string): { descriptor: string; id: string; alpha2Code?: string } {
  const raw = objectValue(value, context);
  const alpha2Code = optionalString(raw.alpha2Code, `${context}.alpha2Code`);
  return {
    descriptor: requiredText(raw.descriptor, `${context}.descriptor`),
    id: requiredText(raw.id, `${context}.id`),
    ...(alpha2Code ? { alpha2Code } : {}),
  };
}

function requiredJobRequisitionLocation(value: unknown, context: string): { descriptor: string; country: { descriptor: string; id: string; alpha2Code?: string } } {
  const raw = objectValue(value, context);
  return {
    descriptor: requiredText(raw.descriptor, `${context}.descriptor`),
    country: requiredCountry(raw.country, `${context}.country`),
  };
}

function normalizeContext(opts: { tenant: string; dataCenter: string; site: string }): { tenant: string; dataCenter: string; site: string; careersUrl: string } {
  const tenant = trim(opts.tenant);
  const dataCenter = trim(opts.dataCenter);
  const site = trim(opts.site);

  if (!tenant) {
    throw new Validation('tenant is required for Workday requests');
  }
  if (!dataCenter) {
    throw new Validation('dataCenter is required for Workday requests');
  }
  if (!site) {
    throw new Validation('site is required for Workday requests');
  }

  const expectedOrigin = `https://${tenant}.${dataCenter}.myworkdayjobs.com`;
  if (window.location.origin !== expectedOrigin) {
    throw new Validation(`Workday functions must run on ${expectedOrigin}. Current URL: ${window.location.href}`);
  }

  const sitePrefix = `/en-US/${site}`;
  const detailPrefix = `/${site}`;
  if (!window.location.pathname.startsWith(sitePrefix) && !window.location.pathname.startsWith(detailPrefix)) {
    throw new Validation(`Workday site mismatch. Expected path starting with ${sitePrefix} or ${detailPrefix}. Current URL: ${window.location.href}`);
  }

  return {
    tenant,
    dataCenter,
    site,
    careersUrl: `${expectedOrigin}${sitePrefix}`,
  };
}

function listEndpoint(opts: { tenant: string; dataCenter: string; site: string }): string {
  const ctx = normalizeContext(opts);
  return `${window.location.origin}/wday/cxs/${ctx.tenant}/${ctx.site}/jobs`;
}

function detailEndpoint(opts: { tenant: string; dataCenter: string; site: string; externalPath: string }): string {
  const ctx = normalizeContext(opts);
  const externalPath = trim(opts.externalPath);
  if (!externalPath) {
    throw new Validation('externalPath is required for Workday getJob requests');
  }
  if (!externalPath.startsWith('/job/')) {
    throw new Validation(`externalPath must start with /job/. Current value: ${externalPath}`);
  }
  return `${window.location.origin}/wday/cxs/${ctx.tenant}/${ctx.site}${externalPath}`;
}

async function readJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    credentials: 'omit',
  });
  const text = await response.text().catch(() => '');

  if (!response.ok) {
    throwForStatus(
      response.status,
      `Workday request failed. URL: ${url} Status: ${response.status} ${response.statusText}. Body: ${text.slice(0, 500)}`,
    );
  }

  if (!text) {
    throw new ContractDrift(`Workday returned an empty response. URL: ${url}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ContractDrift(`Workday returned non-JSON response. URL: ${url} Body: ${text.slice(0, 500)}`);
  }
}

function parseFacetNode(value: unknown, context: string): WorkdayFacetNode {
  const raw = objectValue(value, context);
  if (Array.isArray(raw.values) && typeof raw.facetParameter === 'string') {
    return {
      facetParameter: requiredText(raw.facetParameter, `${context}.facetParameter`),
      descriptor: optionalNullableText(raw.descriptor, `${context}.descriptor`),
      values: raw.values.map((entry, index) => parseFacetNode(entry, `${context}.values[${index}]`)),
    };
  }

  if ('id' in raw && 'count' in raw) {
    return {
      descriptor: requiredText(raw.descriptor, `${context}.descriptor`),
      id: requiredText(raw.id, `${context}.id`),
      count: intValue(raw.count, `${context}.count`),
    };
  }

  throw new ContractDrift(`Workday facet node has an unexpected shape. Context: ${context}`);
}

function parseFacetGroup(value: unknown, context: string): WorkdayFacetGroup {
  const raw = objectValue(value, context);
  if (!Array.isArray(raw.values) || typeof raw.facetParameter !== 'string') {
    throw new ContractDrift(`Workday facet group has an unexpected shape. Context: ${context}`);
  }
  return {
    facetParameter: requiredText(raw.facetParameter, `${context}.facetParameter`),
    descriptor: optionalNullableText(raw.descriptor, `${context}.descriptor`),
    values: raw.values.map((entry, index) => parseFacetNode(entry, `${context}.values[${index}]`)),
  };
}

function parseListPosting(value: unknown, careersUrl: string, context: string): WorkdayListJobPosting {
  const raw = objectValue(value, context);
  const bulletFields = requiredStringArray(raw.bulletFields, `${context}.bulletFields`);
  const jobReqId = requiredText(bulletFields[0], `${context}.bulletFields[0]`);
  const externalPath = requiredText(raw.externalPath, `${context}.externalPath`);

  if (!externalPath.startsWith('/job/')) {
    throw new ContractDrift(`Workday list jobPosting.externalPath must start with /job/. Context: ${context}`);
  }

  return {
    title: requiredText(raw.title, `${context}.title`),
    externalPath,
    publicUrl: `${careersUrl}${externalPath}`,
    locationsText: requiredText(raw.locationsText, `${context}.locationsText`),
    postedOn: requiredText(raw.postedOn, `${context}.postedOn`),
    jobReqId,
    bulletFields,
  };
}

function parseSimilarJob(value: unknown, careersUrl: string, context: string): WorkdaySimilarJob {
  const raw = objectValue(value, context);
  const externalPath = requiredText(raw.externalPath, `${context}.externalPath`);

  if (!externalPath.startsWith('/job/')) {
    throw new ContractDrift(`Workday similarJobs.externalPath must start with /job/. Context: ${context}`);
  }

  return {
    title: requiredText(raw.title, `${context}.title`),
    externalPath,
    publicUrl: `${careersUrl}${externalPath}`,
    timeType: requiredText(raw.timeType, `${context}.timeType`),
    locationsText: requiredText(raw.locationsText, `${context}.locationsText`),
    postedOn: requiredText(raw.postedOn, `${context}.postedOn`),
    startDate: requiredText(raw.startDate, `${context}.startDate`),
  };
}

function parseHiringOrganization(value: unknown, context: string): WorkdayHiringOrganization {
  const raw = objectValue(value, context);
  return {
    name: requiredText(raw.name, `${context}.name`),
    url: stringValue(raw.url, `${context}.url`),
  };
}

function parseJobPostingInfo(value: unknown, context: string): WorkdayJobPostingInfo {
  const raw = objectValue(value, context);
  return {
    id: requiredText(raw.id, `${context}.id`),
    title: requiredText(raw.title, `${context}.title`),
    jobDescription: requiredText(raw.jobDescription, `${context}.jobDescription`),
    location: requiredText(raw.location, `${context}.location`),
    additionalLocations: optionalStringArray(raw.additionalLocations, `${context}.additionalLocations`),
    postedOn: requiredText(raw.postedOn, `${context}.postedOn`),
    startDate: requiredText(raw.startDate, `${context}.startDate`),
    timeType: requiredText(raw.timeType, `${context}.timeType`),
    jobReqId: requiredText(raw.jobReqId, `${context}.jobReqId`),
    jobPostingId: requiredText(raw.jobPostingId, `${context}.jobPostingId`),
    jobPostingSiteId: requiredText(raw.jobPostingSiteId, `${context}.jobPostingSiteId`),
    country: requiredCountry(raw.country, `${context}.country`),
    canApply: boolValue(raw.canApply, `${context}.canApply`),
    posted: boolValue(raw.posted, `${context}.posted`),
    includeResumeParsing: boolValue(raw.includeResumeParsing, `${context}.includeResumeParsing`),
    jobRequisitionLocation: requiredJobRequisitionLocation(raw.jobRequisitionLocation, `${context}.jobRequisitionLocation`),
    externalUrl: optionalString(raw.externalUrl, `${context}.externalUrl`),
    questionnaireId: optionalString(raw.questionnaireId, `${context}.questionnaireId`),
  };
}

async function listJobsFromCxs(opts: ListJobsInput): Promise<ListJobsOutput> {
  const ctx = normalizeContext(opts);
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const searchText = opts.searchText ?? '';
  const appliedFacets = opts.appliedFacets ?? {};

  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Validation(`limit must be an integer between 1 and 20. Current value: ${String(opts.limit)}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Validation(`offset must be a non-negative integer. Current value: ${String(opts.offset)}`);
  }
  if (typeof searchText !== 'string') {
    throw new Validation(`searchText must be a string. Current value: ${String(opts.searchText)}`);
  }
  if (!appliedFacets || typeof appliedFacets !== 'object' || Array.isArray(appliedFacets)) {
    throw new Validation('appliedFacets must be an object map of facet ids');
  }

  const url = listEndpoint(ctx);
  const raw = await readJson(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      limit,
      offset,
      searchText,
      appliedFacets,
    }),
  });
  const response = objectValue(raw, 'Workday list response');
  const total = intValue(response.total, 'Workday list response.total');
  const jobPostings = arrayValue(response.jobPostings, 'Workday list response.jobPostings').map((entry, index) =>
    parseListPosting(entry, ctx.careersUrl, `Workday list response.jobPostings[${index}]`),
  );
  const facets = arrayValue(response.facets, 'Workday list response.facets').map((entry, index) =>
    parseFacetGroup(entry, `Workday list response.facets[${index}]`),
  );
  const returned = jobPostings.length;
  const nextOffset = offset + returned < total ? offset + returned : null;

  return {
    careersUrl: ctx.careersUrl,
    tenant: ctx.tenant,
    dataCenter: ctx.dataCenter,
    site: ctx.site,
    paging: {
      limit,
      offset,
      returned,
      total,
      hasMore: nextOffset !== null,
      nextOffset,
    },
    total,
    jobPostings,
    facets,
  };
}

async function getJobFromCxs(opts: GetJobInput): Promise<GetJobOutput> {
  const ctx = normalizeContext(opts);
  const url = detailEndpoint(opts);
  const raw = await readJson(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  const response = objectValue(raw, 'Workday detail response');

  return {
    careersUrl: ctx.careersUrl,
    tenant: ctx.tenant,
    dataCenter: ctx.dataCenter,
    site: ctx.site,
    externalPath: trim(opts.externalPath),
    jobPostingInfo: parseJobPostingInfo(response.jobPostingInfo, 'Workday detail response.jobPostingInfo'),
    hiringOrganization: parseHiringOrganization(response.hiringOrganization, 'Workday detail response.hiringOrganization'),
    similarJobs: arrayValue(response.similarJobs, 'Workday detail response.similarJobs').map((entry, index) =>
      parseSimilarJob(entry, ctx.careersUrl, `Workday detail response.similarJobs[${index}]`),
    ),
  };
}

export async function listJobs(opts: ListJobsInput): Promise<ListJobsOutput> {
  return listJobsFromCxs(opts);
}

export async function getJob(opts: GetJobInput): Promise<GetJobOutput> {
  return getJobFromCxs(opts);
}
