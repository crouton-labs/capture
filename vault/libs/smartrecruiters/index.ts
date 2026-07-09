import { ContractDrift, NotFound, throwForStatus } from '@vallum/_runtime';

import type {
  GetPostingInput,
  GetPostingOutput,
  ListPostingsInput,
  ListPostingsOutput,
  SmartRecruitersCustomField,
  SmartRecruitersPostingDetail,
  SmartRecruitersPostingSummary,
} from './schemas';

export type {
  GetPostingInput,
  GetPostingOutput,
  ListPostingsInput,
  ListPostingsOutput,
  SmartRecruitersPostingDetail,
  SmartRecruitersPostingSummary,
} from './schemas';

const API_ORIGIN = 'https://api.smartrecruiters.com';
const CAREERS_ORIGIN = 'https://careers.smartrecruiters.com';

type RawObject = Record<string, unknown>;

function requireText(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new ContractDrift(`${context} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ContractDrift(`${context} must be a non-empty string`);
  }
  return trimmed;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ContractDrift('Optional SmartRecruiters text field must be a string when present');
  }
  return value;
}

function optionalBool(value: unknown, context: string): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'boolean') {
    throw new ContractDrift(`${context} must be a boolean when present`);
  }
  return value;
}

function optionalNumberOrString(value: unknown, context: string): string | number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  throw new ContractDrift(`${context} must be a string or number when present`);
}

function asRecord(value: unknown, context: string): RawObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractDrift(`${context} must be an object`);
  }
  return value as RawObject;
}

function asOptionalRecord(value: unknown): RawObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as RawObject;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function encodeCompanyIdentifier(value: string): string {
  return encodeURIComponent(value.trim());
}

function normalizeCompanyIdentifier(value: string): string {
  return requireText(value, 'companyIdentifier');
}

function buildCareersUrl(companyIdentifier: string): string {
  return `${CAREERS_ORIGIN}/${encodeCompanyIdentifier(companyIdentifier)}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const message = `SmartRecruiters request failed. URL: ${url} Status: ${response.status} ${response.statusText}. Body: ${body.slice(0, 500)}`;
    if (response.status === 404) {
      throw new NotFound(message);
    }
    throwForStatus(response.status, message);
  }
  return response.json();
}

function normalizeCompany(raw: unknown): { identifier: string; name: string } {
  const obj = asRecord(raw, 'SmartRecruiters company');
  return {
    identifier: requireText(obj.identifier, 'company.identifier'),
    name: requireText(obj.name, 'company.name'),
  };
}

function normalizeLocation(raw: unknown): SmartRecruitersPostingSummary['location'] {
  const obj = asOptionalRecord(raw);
  if (!obj) {
    return {
      city: null,
      region: null,
      country: null,
      remote: null,
      hybrid: null,
      latitude: null,
      longitude: null,
      fullLocation: null,
    };
  }
  return {
    city: optionalText(obj.city),
    region: optionalText(obj.region),
    country: optionalText(obj.country),
    remote: optionalBool(obj.remote, 'location.remote'),
    hybrid: optionalBool(obj.hybrid, 'location.hybrid'),
    latitude: optionalText(obj.latitude),
    longitude: optionalText(obj.longitude),
    fullLocation: optionalText(obj.fullLocation),
  };
}

function normalizeLabel(raw: unknown): SmartRecruitersPostingSummary['industry'] {
  const obj = asOptionalRecord(raw);
  if (!obj) {
    return null;
  }
  return {
    id: optionalNumberOrString(obj.id, 'label.id') ?? '',
    label: requireText(obj.label, 'label.label'),
  };
}

function normalizeLanguage(raw: unknown): SmartRecruitersPostingSummary['language'] {
  const obj = asOptionalRecord(raw);
  if (!obj) {
    return null;
  }
  return {
    code: requireText(obj.code, 'language.code'),
    label: requireText(obj.label, 'language.label'),
    labelNative: requireText(obj.labelNative, 'language.labelNative'),
  };
}

function normalizeCustomFields(raw: unknown): SmartRecruitersCustomField[] {
  return asArray(raw).map((item, index) => {
    const obj = asRecord(item, `customField[${index}]`);
    return {
      fieldId: requireText(obj.fieldId, `customField[${index}].fieldId`),
      fieldLabel: requireText(obj.fieldLabel, `customField[${index}].fieldLabel`),
      valueId: optionalText(obj.valueId),
      valueLabel: optionalText(obj.valueLabel),
    };
  });
}

function normalizeSection(raw: unknown): { title: string; text: string } | null {
  const obj = asOptionalRecord(raw);
  if (!obj) {
    return null;
  }
  return {
    title: requireText(obj.title, 'jobAd section title'),
    text: requireText(obj.text, 'jobAd section text'),
  };
}

function normalizeVideos(raw: unknown): Array<{ title: string; urls: string[] }> {
  return asArray(raw).map((item, index) => {
    const obj = asRecord(item, `jobAd.sections.videos[${index}]`);
    const urls = asArray(obj.urls).map((url, urlIndex) => requireText(url, `jobAd.sections.videos[${index}].urls[${urlIndex}]`));
    return {
      title: requireText(obj.title, `jobAd.sections.videos[${index}].title`),
      urls,
    };
  });
}

function normalizeJobAd(raw: unknown): SmartRecruitersPostingDetail['jobAd'] {
  const obj = asOptionalRecord(raw);
  if (!obj) {
    return null;
  }
  const sections = asOptionalRecord(obj.sections);
  return {
    sections: {
      companyDescription: normalizeSection(sections?.companyDescription),
      jobDescription: normalizeSection(sections?.jobDescription),
      qualifications: normalizeSection(sections?.qualifications),
      additionalInformation: normalizeSection(sections?.additionalInformation),
      videos: normalizeVideos(sections?.videos),
    },
  };
}

function normalizeCreator(raw: unknown): SmartRecruitersPostingDetail['creator'] {
  const obj = asOptionalRecord(raw);
  if (!obj) {
    return { name: null, avatarUrl: null };
  }
  return {
    name: optionalText(obj.name),
    avatarUrl: optionalText(obj.avatarUrl),
  };
}

function normalizePostingSummary(raw: unknown): SmartRecruitersPostingSummary {
  const obj = asRecord(raw, 'SmartRecruiters posting');
  const company = normalizeCompany(obj.company);
  const location = normalizeLocation(obj.location);
  const detailUrl = requireText(obj.ref, 'posting.ref');
  const visibility = requireText(obj.visibility, 'posting.visibility');
  if (visibility !== 'PUBLIC') {
    throw new ContractDrift(`Unexpected SmartRecruiters posting visibility: ${visibility}`);
  }
  return {
    id: requireText(obj.id, 'posting.id'),
    uuid: requireText(obj.uuid, 'posting.uuid'),
    title: requireText(obj.name, 'posting.name'),
    jobAdId: requireText(obj.jobAdId, 'posting.jobAdId'),
    defaultJobAd: Boolean(obj.defaultJobAd),
    refNumber: requireText(obj.refNumber, 'posting.refNumber'),
    company,
    releasedDate: requireText(obj.releasedDate, 'posting.releasedDate'),
    location,
    industry: normalizeLabel(obj.industry),
    department: normalizeLabel(obj.department),
    function: normalizeLabel(obj.function),
    typeOfEmployment: normalizeLabel(obj.typeOfEmployment),
    experienceLevel: normalizeLabel(obj.experienceLevel),
    customFields: normalizeCustomFields(obj.customField),
    visibility: 'PUBLIC',
    detailUrl,
    language: normalizeLanguage(obj.language),
  };
}

function normalizePostingDetail(raw: unknown): SmartRecruitersPostingDetail {
  const summary = normalizePostingSummary(raw);
  const obj = asRecord(raw, 'SmartRecruiters posting');
  return {
    ...summary,
    jobId: requireText(obj.jobId, 'posting.jobId'),
    postingUrl: requireText(obj.postingUrl, 'posting.postingUrl'),
    applyUrl: requireText(obj.applyUrl, 'posting.applyUrl'),
    referralUrl: requireText(obj.referralUrl, 'posting.referralUrl'),
    creator: normalizeCreator(obj.creator),
    jobAd: normalizeJobAd(obj.jobAd),
    active: Boolean(obj.active),
  };
}

function setParam(params: URLSearchParams, key: string, value: string | number | null | undefined): void {
  if (value === undefined || value === null || value === '') {
    return;
  }
  params.set(key, String(value));
}

function setCommaSeparatedParam(params: URLSearchParams, key: string, value: string | string[] | null | undefined): void {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    const values = value.map((item) => item.trim()).filter(Boolean);
    if (values.length > 0) {
      params.set(key, values.join(','));
    }
    return;
  }
  const trimmed = value.trim();
  if (trimmed) {
    params.set(key, trimmed);
  }
}

function setCustomFieldParams(
  params: URLSearchParams,
  customField: Record<string, string | string[]> | undefined,
): Record<string, string[]> {
  const applied: Record<string, string[]> = {};
  if (!customField) {
    return applied;
  }
  for (const [fieldId, value] of Object.entries(customField)) {
    if (Array.isArray(value)) {
      const values = value.map((item) => item.trim()).filter(Boolean);
      if (values.length > 0) {
        params.set(`custom_field.${fieldId}`, values.join(','));
        applied[fieldId] = values;
      }
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      params.set(`custom_field.${fieldId}`, trimmed);
      applied[fieldId] = [trimmed];
    }
  }
  return applied;
}

function buildListUrl(args: ListPostingsInput): { url: string; filtersApplied: ListPostingsOutput['filtersApplied']; companyIdentifier: string } {
  const companyIdentifier = normalizeCompanyIdentifier(args.companyIdentifier);
  const params = new URLSearchParams();
  setParam(params, 'q', args.q);
  setParam(params, 'limit', args.limit ?? 100);
  setParam(params, 'offset', args.offset ?? 0);
  setParam(params, 'country', args.country);
  setParam(params, 'region', args.region);
  setParam(params, 'city', args.city);
  setParam(params, 'department', args.department);
  setParam(params, 'jobAdId', args.jobAdId);
  setParam(params, 'releasedAfter', args.releasedAfter);
  setParam(params, 'locationType', args.locationType);
  setCommaSeparatedParam(params, 'language', args.language);
  const customField = setCustomFieldParams(params, args.custom_field as Record<string, string | string[]> | undefined);

  return {
    url: `${API_ORIGIN}/v1/companies/${encodeCompanyIdentifier(companyIdentifier)}/postings?${params.toString()}`,
    companyIdentifier,
    filtersApplied: {
      q: args.q ?? null,
      limit: args.limit ?? 100,
      offset: args.offset ?? 0,
      country: args.country ?? null,
      region: args.region ?? null,
      city: args.city ?? null,
      department: args.department === undefined ? null : String(args.department),
      jobAdId: args.jobAdId ?? null,
      releasedAfter: args.releasedAfter ?? null,
      locationType: args.locationType ?? null,
      language: Array.isArray(args.language) ? args.language.map((item) => item.trim()).filter(Boolean) : args.language ? [args.language.trim()] : [],
      custom_field: customField,
    },
  };
}

export async function listPostings(args: ListPostingsInput): Promise<ListPostingsOutput> {
  const { url, filtersApplied, companyIdentifier } = buildListUrl(args);
  const raw = await fetchJson(url);
  const response = asRecord(raw, 'SmartRecruiters list response');
  const content = asArray(response.content);
  const postings = content.map(normalizePostingSummary);
  const responseCompany = postings[0]?.company ?? null;
  const effectiveCompanyIdentifier = responseCompany?.identifier ?? companyIdentifier;
  return {
    careersUrl: buildCareersUrl(effectiveCompanyIdentifier),
    companyIdentifier: effectiveCompanyIdentifier,
    companyName: responseCompany?.name ?? null,
    filtersApplied,
    paging: {
      offset: Number(response.offset ?? filtersApplied.offset),
      limit: Number(response.limit ?? filtersApplied.limit),
      returned: postings.length,
      totalFound: Number(response.totalFound ?? postings.length),
      hasMore: Number(response.offset ?? filtersApplied.offset) + postings.length < Number(response.totalFound ?? postings.length),
      nextOffset:
        Number(response.offset ?? filtersApplied.offset) + postings.length < Number(response.totalFound ?? postings.length)
          ? Number(response.offset ?? filtersApplied.offset) + postings.length
          : null,
    },
    postings,
  };
}

export async function getPosting(args: GetPostingInput): Promise<GetPostingOutput> {
  const companyIdentifier = normalizeCompanyIdentifier(args.companyIdentifier);
  const postingId = requireText(args.postingId, 'postingId');
  const url = `${API_ORIGIN}/v1/companies/${encodeCompanyIdentifier(companyIdentifier)}/postings/${encodeURIComponent(postingId)}`;
  const raw = await fetchJson(url);
  const posting = normalizePostingDetail(raw);

  return {
    careersUrl: buildCareersUrl(posting.company.identifier ?? companyIdentifier),
    companyIdentifier: posting.company.identifier,
    companyName: posting.company.name,
    posting,
  };
}
