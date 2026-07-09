/**
 * GoDaddy domain-read-core — portfolio list/get/search + action eligibility.
 *
 * All reads hit the domain API (domainsapi.godaddy.com) as POST `.../domains/get`
 * with a pagination/filter envelope. Context-implicit: customerId is read from
 * the session cookie, never passed in.
 */

import {
  dccFetch,
  getCustomerId,
  DOMAINS_API,
  Validation,
  throwForStatus,
} from './_shared';
import { DOMAIN_ACTIONS } from './schemas-domain-read-core';
import type {
  DomainSummary,
  ListDomainsOutput,
  GetDomainOutput,
  SearchDomainsOutput,
  CheckDomainActionEligibilityOutput,
} from './schemas-domain-read-core';

export type {
  DomainSummary,
  ListDomainsOutput,
  GetDomainOutput,
  SearchDomainsOutput,
  CheckDomainActionEligibilityOutput,
} from './schemas-domain-read-core';

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZE = 50;

/** returnColumns requested from domains/get — covers the DomainSummary fields plus every marker-source field used for cursor pagination. */
const RETURN_COLUMNS = [
  'NAME',
  'ID',
  'STATUS',
  'EXPIRATION_DATE',
  'CREATE_DATE',
  'RECORDCREATE_DATE',
  'RENEWAL_PRICE',
  'HAS_AUTORENEW',
  'IS_LOCKED',
  'NAMESERVERS',
  'ISPRIVATE',
  'PRIVACYLEVEL',
  'REGISTRATION_TYPE',
  'SALE',
  'PROFILE_NAME',
  'PROTECTION_PLAN',
  'FORWARDING_URL',
];

const STATE_MAP: Record<string, string[]> = {
  ACTIVE: ['DCC_ACTIVE_REGISTERED_DOMAINS'],
  REDEMPTION: ['REDEMPTION'],
  ALL: ['DCC_ACTIVE_REGISTERED_DOMAINS', 'REDEMPTION'],
  INACTIVE: ['INACTIVE'],
  ACTION_NEEDED: ['RAA_ACTION_NEEDED'],
};
const DEFAULT_STATES = ['DCC_ACTIVE_REGISTERED_DOMAINS', 'REDEMPTION'];
const SINGLE_DOMAIN_STATES = ['DCC_ACTIVE_REGISTERED_DOMAINS', 'REDEMPTION'];

const SORT_MAP: Record<string, string> = {
  name: 'domainName',
  expiration: 'expirationDate',
  registeredDate: 'createDate',
  autoRenew: 'autoRenewFlag',
  lock: 'isLocked',
  estimatedValue: 'valuationSaleAmt',
  privacy: 'privacyLevel',
  protectionPlan: 'protectionPlan',
  nameservers: 'nameServers',
  forwarding: 'forwardingURL',
  ownershipDate: 'recordCreateDate',
  profileName: 'profileName',
  renewalPrice: 'renewalPrice',
  registrationType: 'registrationType',
};

// ============================================================================
// Raw response shapes
// ============================================================================

interface RawDomain {
  name?: string;
  status?: string;
  expirationDate?: string;
  createDate?: string;
  recordCreateDate?: string;
  hasAutoRenew?: boolean;
  isLocked?: boolean;
  nameservers?: string[];
  privacyLevel?: string;
  isPrivate?: boolean;
  registrationType?: string;
  sale?: unknown;
  forwardingUrl?: string;
  profileName?: string;
  protectionPlan?: unknown;
  renewalPrice?: { listPrice?: number } & Record<string, unknown>;
  [k: string]: unknown;
}

interface DomainsGetResponse {
  domains?: RawDomain[];
  totalInSearch?: number;
  lastDomainName?: string;
}

type Markers = Record<string, unknown>;

interface RawEligibilityEntry {
  action?: string;
  allowed?: boolean;
  domainNames?: string[];
  reasons?: string[];
  requirements?: unknown[];
}
interface RawEligibilityResponse {
  eligibility?: RawEligibilityEntry[];
  lastDomainName?: string;
  totalInSearch?: number;
}

// ============================================================================
// Helpers
// ============================================================================

function nullMarkers(): Markers {
  return {
    markerExpirationDate: null,
    markerDomainName: null,
    markerCreateDate: null,
    markerValuationSaleAmt: null,
    markerAutoRenew: null,
    markerIsLocked: null,
    markerRegistrationType: null,
    markerNameServers: null,
    markerRecordCreateDate: null,
    markerForwardingUrl: null,
    markerProfileName: null,
    markerProtectionPlan: null,
    markerPrivacyLevel: null,
    markerRenewalPrice: null,
  };
}

/** Build the next-page cursor markers from the last domain of the current page. */
function markersFromDomain(d: RawDomain): Markers {
  return {
    markerExpirationDate: d.expirationDate ?? null,
    markerDomainName: d.name ?? null,
    markerCreateDate: d.createDate ?? null,
    markerValuationSaleAmt: d.sale ?? null,
    markerAutoRenew: d.hasAutoRenew ?? null,
    markerIsLocked: d.isLocked ?? null,
    markerRegistrationType: d.registrationType ?? null,
    markerNameServers: d.nameservers ? d.nameservers.join(' ') : null,
    markerRecordCreateDate: d.recordCreateDate ?? null,
    markerForwardingUrl: d.forwardingUrl ?? null,
    markerProfileName: d.profileName ?? null,
    markerProtectionPlan: d.protectionPlan ?? null,
    markerPrivacyLevel: d.privacyLevel ?? null,
    markerRenewalPrice: d.renewalPrice?.listPrice ?? null,
  };
}

function buildBody(
  filter: Record<string, unknown>,
  sortColumn: string,
  sortDirection: string,
  page: number,
  markers: Markers,
) {
  return {
    domainNames: [],
    pagination: {
      filter,
      includeEligibility: false,
      includeMarker: page === 1,
      includeRenewalPrices: true,
      ...markers,
      page,
      pageSize: PAGE_SIZE,
      pagingDirection: 'forward',
      sortColumn,
      sortDirection,
    },
    returnColumns: RETURN_COLUMNS,
    additionalFields: [],
  };
}

function toDomainSummary(d: RawDomain): DomainSummary {
  return {
    name: String(d.name ?? '').toLowerCase(),
    status: d.status ?? null,
    expirationDate: d.expirationDate ?? null,
    autoRenew: d.hasAutoRenew ?? null,
    registrarLock: d.isLocked ?? null,
    nameservers: Array.isArray(d.nameservers) ? d.nameservers : [],
    privacy: d.privacyLevel ?? null,
    renewalPrice: d.renewalPrice ?? null,
  };
}

/** Auto-paginate domains/get via the marker cursor. `predicate` filters client-side (used for tld). */
async function collectDomains(opts: {
  states: string[];
  domainNameContains?: string;
  folder?: string;
  sortColumn: string;
  sortDirection: string;
  count?: number;
  predicate?: (d: RawDomain) => boolean;
  registrationTypes?: string[];
  isAutoRenewEnabled?: boolean;
  isLocked?: boolean;
  privacyLevels?: string[];
  protectionPlans?: string[];
  tlds?: string[];
  nameservers?: string[];
  minimumExpirationDays?: number;
  maximumExpirationDays?: number;
  expiresStartDate?: string;
  expiresEndDate?: string;
  profileIds?: string[];
  forwardingURL?: string;
  expiresOption?: string;
  domainNamesFilter?: { names: string[]; type: 'INCLUDE' | 'EXCLUDE' };
}): Promise<{ domains: RawDomain[]; total: number }> {
  const cid = getCustomerId();
  const url = `${DOMAINS_API}/v2/customers/${cid}/domains/get`;

  const filter: Record<string, unknown> = {
    domainStates: opts.states,
  };
  if (opts.domainNameContains)
    filter.domainNameContains = opts.domainNameContains;
  if (opts.folder) {
    const folderId = parseInt(opts.folder, 10);
    if (isNaN(folderId))
      throw new Validation(
        `listDomains: folder must be a numeric id (from listFolders). Got: "${opts.folder}".`,
      );
    filter.folderIds = [folderId];
  }
  if (opts.registrationTypes?.length)
    filter.registrationTypes = opts.registrationTypes;
  if (opts.isAutoRenewEnabled != null)
    filter.isAutoRenewEnabled = opts.isAutoRenewEnabled;
  if (opts.isLocked != null) filter.isLocked = opts.isLocked;
  if (opts.privacyLevels?.length) filter.privacyLevels = opts.privacyLevels;
  if (opts.protectionPlans?.length)
    filter.protectionPlans = opts.protectionPlans;
  if (opts.tlds?.length) filter.tlds = opts.tlds;
  if (opts.nameservers?.length)
    filter.nameserverFilter = { names: opts.nameservers, type: 'INCLUDE' };
  if (opts.minimumExpirationDays != null)
    filter.minimumExpirationDays = opts.minimumExpirationDays;
  if (opts.maximumExpirationDays != null)
    filter.maximumExpirationDays = opts.maximumExpirationDays;
  if (opts.expiresStartDate) filter.expiresStartDate = opts.expiresStartDate;
  if (opts.expiresEndDate) filter.expiresEndDate = opts.expiresEndDate;
  if (opts.profileIds?.length) filter.profileIds = opts.profileIds;
  if (opts.forwardingURL) filter.forwardingURL = opts.forwardingURL;
  if (opts.expiresOption) filter.expiresOption = opts.expiresOption;
  if (opts.domainNamesFilter?.names?.length)
    filter.domainNamesFilter = opts.domainNamesFilter;

  const out: RawDomain[] = [];
  let page = 1;
  let markers = nullMarkers();
  let serverTotal = 0;

  for (;;) {
    const body = buildBody(
      filter,
      opts.sortColumn,
      opts.sortDirection,
      page,
      markers,
    );
    const resp = await dccFetch<DomainsGetResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const batch = Array.isArray(resp.domains) ? resp.domains : [];
    if (typeof resp.totalInSearch === 'number')
      serverTotal = resp.totalInSearch;

    for (const d of batch) {
      if (!opts.predicate || opts.predicate(d)) out.push(d);
      if (opts.count != null && out.length >= opts.count) break;
    }

    if (opts.count != null && out.length >= opts.count) break;
    if (batch.length < PAGE_SIZE) break;
    markers = markersFromDomain(batch[batch.length - 1]);
    page += 1;
  }

  const domains = opts.count != null ? out.slice(0, opts.count) : out;
  const total = opts.predicate ? domains.length : serverTotal || domains.length;
  return { domains, total };
}

type EligibilityDetail = { domainNames: string[]; requirements?: unknown[] };
type EligibilityBucket = {
  allowedDomainNames: string[];
  notAllowedDomainNames: string[];
  allowedDomainDetails: Record<string, EligibilityDetail>;
  notAllowedDomainDetails: Record<string, EligibilityDetail>;
};

function normalizeEligibility(
  resp: RawEligibilityResponse,
): Record<string, EligibilityBucket> {
  const entries = Array.isArray(resp.eligibility) ? resp.eligibility : [];
  const out: Record<string, EligibilityBucket> = {};

  for (const e of entries) {
    const action = e.action;
    if (!action) continue;
    const bucket =
      out[action] ??
      (out[action] = {
        allowedDomainNames: [],
        notAllowedDomainNames: [],
        allowedDomainDetails: {},
        notAllowedDomainDetails: {},
      });

    const names = (e.domainNames ?? []).map((n) => n.toLowerCase());
    const reasons = e.reasons ?? (e.requirements as string[] | undefined) ?? [];

    if (e.allowed) {
      bucket.allowedDomainNames.push(...names);
      for (const r of reasons) {
        const detail = (bucket.allowedDomainDetails[r] ??= {
          domainNames: [],
          requirements: e.requirements ?? [],
        });
        detail.domainNames.push(...names);
      }
    } else {
      bucket.notAllowedDomainNames.push(...names);
      for (const r of reasons) {
        const detail = (bucket.notAllowedDomainDetails[r] ??= {
          domainNames: [],
        });
        detail.domainNames.push(...names);
      }
    }
  }

  for (const k of Object.keys(out)) {
    out[k].allowedDomainNames = [...new Set(out[k].allowedDomainNames)];
    out[k].notAllowedDomainNames = [...new Set(out[k].notAllowedDomainNames)];
  }
  return out;
}

// ============================================================================
// listDomains
// ============================================================================

export async function listDomains(
  args: {
    state?: 'ACTIVE' | 'REDEMPTION' | 'ALL' | 'INACTIVE' | 'ACTION_NEEDED';
    folder?: string;
    sort?: {
      by?:
        | 'name'
        | 'expiration'
        | 'registeredDate'
        | 'autoRenew'
        | 'lock'
        | 'estimatedValue'
        | 'privacy'
        | 'protectionPlan'
        | 'nameservers'
        | 'forwarding'
        | 'ownershipDate'
        | 'profileName'
        | 'renewalPrice'
        | 'registrationType';
      direction?: 'ascending' | 'descending';
    };
    count?: number;
    registrationTypes?: string[];
    isAutoRenewEnabled?: boolean;
    isLocked?: boolean;
    privacyLevels?: string[];
    protectionPlans?: string[];
    tlds?: string[];
    nameservers?: string[];
    minimumExpirationDays?: number;
    maximumExpirationDays?: number;
    expiresStartDate?: string;
    expiresEndDate?: string;
    profileIds?: string[];
    forwardingURL?: string;
    expiresOption?: string;
    domainNameContains?: string;
    domainNamesFilter?: { names: string[]; type: 'INCLUDE' | 'EXCLUDE' };
  } = {},
): Promise<ListDomainsOutput> {
  if (args.state != null && !(args.state in STATE_MAP)) {
    throw new Validation(
      `listDomains: invalid state "${args.state}". Valid values: ${Object.keys(STATE_MAP).join(', ')}.`,
    );
  }
  if (args.sort?.by != null && !(args.sort.by in SORT_MAP)) {
    throw new Validation(
      `listDomains: invalid sort.by "${args.sort.by}". Valid values: ${Object.keys(SORT_MAP).join(', ')}.`,
    );
  }
  const states = args.state ? STATE_MAP[args.state] : DEFAULT_STATES;
  const sortColumn = SORT_MAP[args.sort?.by ?? 'name'];
  const sortDirection = args.sort?.direction ?? 'ascending';

  const { domains, total } = await collectDomains({
    states,
    folder: args.folder,
    domainNameContains: args.domainNameContains,
    sortColumn,
    sortDirection,
    count: args.count,
    registrationTypes: args.registrationTypes,
    isAutoRenewEnabled: args.isAutoRenewEnabled,
    isLocked: args.isLocked,
    privacyLevels: args.privacyLevels,
    protectionPlans: args.protectionPlans,
    tlds: args.tlds,
    nameservers: args.nameservers,
    minimumExpirationDays: args.minimumExpirationDays,
    maximumExpirationDays: args.maximumExpirationDays,
    expiresStartDate: args.expiresStartDate,
    expiresEndDate: args.expiresEndDate,
    profileIds: args.profileIds,
    forwardingURL: args.forwardingURL,
    expiresOption: args.expiresOption,
    domainNamesFilter: args.domainNamesFilter,
  });
  return { domains: domains.map(toDomainSummary), total };
}

// ============================================================================
// getDomain
// ============================================================================

export async function getDomain(args: {
  domainName: string;
}): Promise<GetDomainOutput> {
  if (!args.domainName) throw new Validation('getDomain requires domainName.');
  const domainName = args.domainName.toLowerCase();
  const cid = getCustomerId();
  const filter = {
    domainStates: SINGLE_DOMAIN_STATES,
    domainNamesFilter: { names: [domainName], type: 'INCLUDE' },
  };
  const body = buildBody(filter, 'domainName', 'ascending', 1, nullMarkers());
  const resp = await dccFetch<DomainsGetResponse>(
    `${DOMAINS_API}/v2/customers/${cid}/domains/get`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  const domains = Array.isArray(resp.domains) ? resp.domains : [];
  const match =
    domains.find((d) => (d.name ?? '').toLowerCase() === domainName) ??
    domains[0];
  if (!match) {
    throwForStatus(404, `Domain ${args.domainName} not found in this account.`);
  }
  return { domain: toDomainSummary(match!) };
}

// ============================================================================
// searchDomains
// ============================================================================

export async function searchDomains(args: {
  query: string;
  tld?: string;
  state?: 'ACTIVE' | 'REDEMPTION' | 'ALL' | 'INACTIVE' | 'ACTION_NEEDED';
  count?: number;
  sort?: {
    by?:
      | 'name'
      | 'expiration'
      | 'registeredDate'
      | 'autoRenew'
      | 'lock'
      | 'estimatedValue'
      | 'privacy'
      | 'protectionPlan'
      | 'nameservers'
      | 'forwarding'
      | 'ownershipDate'
      | 'profileName'
      | 'renewalPrice'
      | 'registrationType';
    direction?: 'ascending' | 'descending';
  };
  folder?: string;
  registrationTypes?: string[];
  isAutoRenewEnabled?: boolean;
  isLocked?: boolean;
  privacyLevels?: string[];
  protectionPlans?: string[];
  tlds?: string[];
  nameservers?: string[];
  minimumExpirationDays?: number;
  maximumExpirationDays?: number;
  profileIds?: string[];
  forwardingURL?: string;
  expiresOption?: string;
}): Promise<SearchDomainsOutput> {
  if (!args.query)
    throw new Validation('searchDomains requires a non-empty query.');
  if (args.state != null && !(args.state in STATE_MAP)) {
    throw new Validation(
      `searchDomains: invalid state "${args.state}". Valid values: ${Object.keys(STATE_MAP).join(', ')}.`,
    );
  }
  if (args.sort?.by != null && !(args.sort.by in SORT_MAP)) {
    throw new Validation(
      `searchDomains: invalid sort.by "${args.sort.by}". Valid values: ${Object.keys(SORT_MAP).join(', ')}.`,
    );
  }
  const states = args.state ? STATE_MAP[args.state] : DEFAULT_STATES;
  const tld = args.tld ? args.tld.replace(/^\./, '').toLowerCase() : undefined;
  const predicate = tld
    ? (d: RawDomain) => !!d.name && d.name.toLowerCase().endsWith('.' + tld)
    : undefined;
  const sortColumn = SORT_MAP[args.sort?.by ?? 'name'];
  const sortDirection = args.sort?.direction ?? 'ascending';

  const { domains, total } = await collectDomains({
    states,
    domainNameContains: args.query,
    sortColumn,
    sortDirection,
    count: args.count,
    predicate,
    folder: args.folder,
    registrationTypes: args.registrationTypes,
    isAutoRenewEnabled: args.isAutoRenewEnabled,
    isLocked: args.isLocked,
    privacyLevels: args.privacyLevels,
    protectionPlans: args.protectionPlans,
    tlds: args.tlds,
    nameservers: args.nameservers,
    minimumExpirationDays: args.minimumExpirationDays,
    maximumExpirationDays: args.maximumExpirationDays,
    profileIds: args.profileIds,
    forwardingURL: args.forwardingURL,
    expiresOption: args.expiresOption,
  });
  return { domains: domains.map(toDomainSummary), total };
}

// ============================================================================
// checkDomainActionEligibility
// ============================================================================

const VALID_DOMAIN_STATES = new Set(['ACTIVE', 'REDEMPTION']);
const VALID_PRIVACY_LEVELS = new Set(['FULL', 'BASIC', 'OPEN']);
const VALID_REGISTRATION_TYPES = new Set([
  'NOT_SPECIFIED',
  'DOMAIN_NES',
  'ANNUAL_TERM_MONTHLY_PAYMENT',
  'LEASE_TO_OWN',
]);
const VALID_PROTECTION_PLANS = new Set([
  'GOOD',
  'DOPL',
  'DOPCLONE',
  'BETTER',
  'BEST',
  'NOTELIGIBLE',
]);
const VALID_EXPIRES_OPTIONS = new Set([
  'customDates',
  'expireIn30',
  'expired',
  'expire18Ago',
]);
const DOMAIN_ACTIONS_SET = new Set<string>(DOMAIN_ACTIONS);

function invalidValues(
  values: string[] | undefined,
  valid: Set<string>,
): string[] {
  return values?.filter((v) => !valid.has(v)) ?? [];
}

export async function checkDomainActionEligibility(args: {
  domainNames: string[];
  action: (typeof DOMAIN_ACTIONS)[number];
  additionalActions?: (typeof DOMAIN_ACTIONS)[number][];
  domainStates?: string[];
  folderIds?: string[];
  isAutoRenewEnabled?: boolean;
  isLocked?: boolean;
  privacyLevels?: string[];
  registrationTypes?: string[];
  domainNameContains?: string;
  pageSize?: number;
  tlds?: string[];
  protectionPlans?: string[];
  minimumExpirationDays?: number;
  maximumExpirationDays?: number;
  expiresOption?: string;
  nameservers?: string[];
  forwardingURL?: string;
  profileIds?: string[];
}): Promise<CheckDomainActionEligibilityOutput> {
  if (!args.domainNames?.length) {
    throw new Validation(
      'checkDomainActionEligibility requires at least one domainName.',
    );
  }
  if (!args.action)
    throw new Validation('checkDomainActionEligibility requires an action.');
  if (!DOMAIN_ACTIONS_SET.has(args.action)) {
    throw new Validation(
      `checkDomainActionEligibility: invalid action "${args.action}". Valid values: ${DOMAIN_ACTIONS.join(', ')}.`,
    );
  }
  const invalidStates = invalidValues(args.domainStates, VALID_DOMAIN_STATES);
  if (invalidStates.length) {
    throw new Validation(
      `checkDomainActionEligibility: invalid domainStates ${JSON.stringify(invalidStates)}. Valid values: ACTIVE, REDEMPTION.`,
    );
  }
  const invalidPrivacyLevels = invalidValues(
    args.privacyLevels,
    VALID_PRIVACY_LEVELS,
  );
  if (invalidPrivacyLevels.length) {
    throw new Validation(
      `checkDomainActionEligibility: invalid privacyLevels ${JSON.stringify(invalidPrivacyLevels)}. Valid values: FULL, BASIC, OPEN.`,
    );
  }
  const invalidRegistrationTypes = invalidValues(
    args.registrationTypes,
    VALID_REGISTRATION_TYPES,
  );
  if (invalidRegistrationTypes.length) {
    throw new Validation(
      `checkDomainActionEligibility: invalid registrationTypes ${JSON.stringify(invalidRegistrationTypes)}. Valid values: NOT_SPECIFIED, DOMAIN_NES, ANNUAL_TERM_MONTHLY_PAYMENT, LEASE_TO_OWN.`,
    );
  }
  if (
    args.pageSize != null &&
    (!Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > 2500)
  ) {
    throw new Validation(
      'checkDomainActionEligibility: pageSize must be a positive integer between 1 and 2500.',
    );
  }
  const invalidAdditionalActions =
    args.additionalActions?.filter((a) => !DOMAIN_ACTIONS_SET.has(a)) ?? [];
  if (invalidAdditionalActions.length) {
    throw new Validation(
      `checkDomainActionEligibility: invalid additionalActions ${JSON.stringify(invalidAdditionalActions)}. Valid values: ${DOMAIN_ACTIONS.join(', ')}.`,
    );
  }
  const invalidProtectionPlans = invalidValues(
    args.protectionPlans,
    VALID_PROTECTION_PLANS,
  );
  if (invalidProtectionPlans.length) {
    throw new Validation(
      `checkDomainActionEligibility: invalid protectionPlans ${JSON.stringify(invalidProtectionPlans)}. Valid values: GOOD, DOPL, DOPCLONE, BETTER, BEST, NOTELIGIBLE.`,
    );
  }
  if (args.expiresOption != null && !VALID_EXPIRES_OPTIONS.has(args.expiresOption)) {
    throw new Validation(
      `checkDomainActionEligibility: invalid expiresOption "${args.expiresOption}". Valid values: customDates, expireIn30, expired, expire18Ago.`,
    );
  }

  const cid = getCustomerId();
  const filter: Record<string, unknown> = {
    domainNamesFilter: { names: args.domainNames, type: 'INCLUDE' },
    domainStates: args.domainStates ?? ['ACTIVE', 'REDEMPTION'],
  };
  if (args.folderIds?.length) filter.folderIds = args.folderIds;
  if (args.isAutoRenewEnabled != null)
    filter.isAutoRenewEnabled = args.isAutoRenewEnabled;
  if (args.isLocked != null) filter.isLocked = args.isLocked;
  if (args.privacyLevels?.length) filter.privacyLevels = args.privacyLevels;
  if (args.registrationTypes?.length)
    filter.registrationTypes = args.registrationTypes;
  if (args.domainNameContains)
    filter.domainNameContains = args.domainNameContains;
  if (args.tlds?.length) filter.tlds = args.tlds;
  if (args.protectionPlans?.length)
    filter.protectionPlans = args.protectionPlans;
  if (args.minimumExpirationDays != null)
    filter.minimumExpirationDays = args.minimumExpirationDays;
  if (args.maximumExpirationDays != null)
    filter.maximumExpirationDays = args.maximumExpirationDays;
  if (args.expiresOption) filter.expiresOption = args.expiresOption;
  if (args.nameservers?.length)
    filter.nameserverFilter = { names: args.nameservers, type: 'INCLUDE' };
  if (args.forwardingURL) filter.forwardingURL = args.forwardingURL;
  if (args.profileIds?.length) filter.profileIds = args.profileIds;

  const actionsToSend = [
    args.action,
    ...(args.additionalActions ?? []),
  ];
  const body = {
    actions: actionsToSend,
    filter,
    pagination: {
      page: 1,
      pageSize: args.pageSize ?? 500,
      pagingDirection: 'forward',
    },
  };
  const resp = await dccFetch<RawEligibilityResponse>(
    `${DOMAINS_API}/v2/customers/${cid}/domains/getActionEligibility`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return { eligibility: normalizeEligibility(resp) };
}
