/**
 * GoDaddy — domain discovery + account activity (read-only).
 *
 * Domain availability hits api.godaddy.com, suggestions come from the rendered domain search surface, TLD pricing goes through the DCC merchandising proxy, and account activity comes from the DCC activity-log API.
 */

import {
  dccFetch,
  gdFetch,
  getCustomerId,
  getCurrency,
  getMarket,
  paginateOffset,
  Validation,
  parseInfoCustIdp,
  DOMAINFIND_ORIGIN,
} from './_shared';
import type {
  CheckDomainAvailabilityOutput,
  GetDomainSuggestionsOutput,
  GetTldPricingOutput,
  ListAccountActivityOutput,
} from './schemas-discovery-activity';

export type {
  DomainAvailability,
  DomainSuggestion,
  TldPricing,
  ActivityEntry,
  CheckDomainAvailabilityOutput,
  GetDomainSuggestionsOutput,
  GetTldPricingOutput,
  ListAccountActivityOutput,
} from './schemas-discovery-activity';

// DCC runtime config exposes the authenticated proxy and activity-log base URLs.
interface DccRuntimeConfig {
  jwtToken?: string;
  baseUrls?: {
    merchandisingProxyApi?: string;
    activityLogApi?: string;
  };
}

function getDccRuntimeConfig(): Required<Pick<DccRuntimeConfig, 'jwtToken'>> & {
  baseUrls: { merchandisingProxyApi: string; activityLogApi: string };
} {
  const config = (
    window as typeof window & {
      __NEXT_DATA__?: {
        props?: { initialState?: { config?: DccRuntimeConfig } };
      };
    }
  ).__NEXT_DATA__?.props?.initialState?.config;

  if (
    !config?.jwtToken ||
    !config.baseUrls?.merchandisingProxyApi ||
    !config.baseUrls?.activityLogApi
  ) {
    throw new Validation(
      `GoDaddy DCC config is missing pricing/activity endpoints. URL: ${window.location.href}`,
    );
  }

  return config as Required<Pick<DccRuntimeConfig, 'jwtToken'>> & {
    baseUrls: { merchandisingProxyApi: string; activityLogApi: string };
  };
}

// ============================================================================
// Coercion + extraction helpers
// ============================================================================

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {};
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNum(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return undefined;
}

function asStr(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function firstDefined(...values: unknown[]): unknown {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

/** Pull the first present array from a body under any of the candidate keys. */
function extractArray(body: Json, keys: string[]): Json[] {
  for (const key of keys) {
    const v = body[key];
    if (Array.isArray(v)) return v.map(asObject);
  }
  return [];
}

function stripDot(tld: string): string {
  return tld.trim().replace(/^\.+/, '').toLowerCase();
}

// ============================================================================
// checkDomainAvailability
// ============================================================================

function normalizeAvailability(domain: string, body: Json): Json {
  const result: Json = {
    domain,
    available: asBool(firstDefined(body.available, body.Available)),
    definitive: asBool(firstDefined(body.definitive, body.Definitive)),
    period: asNum(firstDefined(body.period, body.Period)),
    premium: asBool(firstDefined(body.premium, body.Premium)),
    price: asNum(firstDefined(body.price, body.Price)),
    renewalPrice: asNum(
      firstDefined(body.renewalPrice, body.renewal_price, body.RenewalPrice),
    ),
    currency: asStr(firstDefined(body.currency, body.Currency)),
  };
  // Strip undefined values so callers get a clean object
  return Object.fromEntries(
    Object.entries(result).filter(([, v]) => v !== undefined),
  );
}

export async function checkDomainAvailability(args: {
  domains: string[];
  checkType?: 'FAST' | 'FULL';
  forTransfer?: boolean;
}): Promise<CheckDomainAvailabilityOutput> {
  const domains = (args?.domains ?? [])
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (!domains.length) {
    throw new Validation(
      'checkDomainAvailability requires a non-empty `domains` array.',
    );
  }

  parseInfoCustIdp();

  const results: Json[] = [];
  for (const domain of domains) {
    const params = new URLSearchParams({ domain });
    if (args.checkType) params.set('checkType', args.checkType);
    if (args.forTransfer != null)
      params.set('forTransfer', String(args.forTransfer));
    const body = asObject(
      await gdFetch<Json>(
        `https://api.godaddy.com/v1/domains/available?${params.toString()}`,
      ),
    );
    results.push(normalizeAvailability(domain, body));
  }

  return { results, total: results.length } as CheckDomainAvailabilityOutput;
}

// ============================================================================
// getDomainSuggestions
// ============================================================================

function parseDollarValue(value: unknown): number | undefined {
  const numeric = asNum(value);
  if (numeric != null) return numeric;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[^\d.-]/g, '');
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dollarsToMicroUnits(value: unknown): number | undefined {
  const dollars = parseDollarValue(value);
  return dollars == null ? undefined : Math.round(dollars * 1_000_000);
}

function buildPriceByTld(body: Json): Map<string, number> {
  const map = new Map<string, number>();
  for (const product of extractArray(body, ['Products'])) {
    const tld = stripDot(asStr(product.Tld) ?? '');
    if (!tld) continue;
    const priceInfo = asObject(product.PriceInfo);
    const price = dollarsToMicroUnits(
      firstDefined(
        priceInfo.CurrentPrice,
        priceInfo.CurrentPriceDisplay,
        priceInfo.TotalCurrentPrice,
        product.Price,
        product.PriceDisplay,
      ),
    );
    if (price != null) map.set(tld, price);
  }
  return map;
}

function normalizeSuggestion(
  item: Json,
  priceByTld: Map<string, number>,
): Json {
  const fqdn = asStr(item.Fqdn) ?? asStr(item.domain) ?? '';
  const extension = stripDot(asStr(item.Extension) ?? '');
  const inventory = asStr(item.Inventory)?.toLowerCase();
  const directPrice = dollarsToMicroUnits(
    firstDefined(item.Price, item.UsdPrice, item.AftermarketMinPriceUSD),
  );
  const standardPrice = extension ? priceByTld.get(extension) : undefined;
  const price =
    directPrice != null && directPrice > 0
      ? directPrice
      : standardPrice ?? directPrice;
  const available =
    item.IsRestricted === true ? false : inventory !== 'auction';

  return {
    ...item,
    domain: fqdn,
    available,
    price,
    currency: asStr(firstDefined(item.Currency, 'USD')),
  };
}

export async function getDomainSuggestions(args: {
  keyword: string;
  limit?: number;
  tlds?: string[];
  sources?: Array<'CC_TLD' | 'EXTENSION' | 'KEYWORD_SPIN' | 'PREMIUM'>;
  lengthMin?: number;
  lengthMax?: number;
  country?: string;
  city?: string;
  waitMs?: number;
}): Promise<GetDomainSuggestionsOutput> {
  const keyword = args?.keyword?.trim();
  if (!keyword) {
    throw new Validation(
      'getDomainSuggestions requires a non-empty `keyword`.',
    );
  }

  const limit = Math.max(1, args.limit ?? 10);
  const params = new URLSearchParams({
    search_guid: crypto.randomUUID(),
    req_id: String(Date.now()),
    isc: '',
    itc: 'dpp_absol1',
    partial_query: keyword,
    pagesize: String(Math.max(limit, 36)),
    pagestart: '0',
    key: 'dpp_search',
    q: keyword,
  });

  const body = asObject(
    await gdFetch<Json>(
      `${DOMAINFIND_ORIGIN}/domainfind/v1/search/spins?${params.toString()}`,
    ),
  );
  const priceByTld = buildPriceByTld(body);
  const tlds = new Set((args.tlds ?? []).map(stripDot).filter(Boolean));
  const sources = new Set(
    (args.sources ?? []).map((s) => s.toLowerCase()),
  );
  const suggestions = extractArray(body, ['RecommendedDomains'])
    .map((item) => normalizeSuggestion(item, priceByTld))
    .filter((s) => s.domain)
    .filter((s) => {
      const extension = stripDot(asStr(s.Extension) ?? s.domain.split('.').slice(-1)[0] ?? '');
      const source = asStr(s.DomainSource)?.toLowerCase();
      if (tlds.size && !tlds.has(extension)) return false;
      if (sources.size) {
        const matchesSource =
          (sources.has('cc_tld') && source === 'cctld') ||
          (sources.has('extension') && source === 'extension') ||
          (sources.has('keyword_spin') && source === 'keywordspin') ||
          (sources.has('premium') && (source === 'premium' || source === 'auctions'));
        if (!matchesSource) return false;
      }
      if (args.lengthMin != null || args.lengthMax != null) {
        const labelLength = asStr(s.NameWithoutExtension)?.length ?? 0;
        if (args.lengthMin != null && labelLength < args.lengthMin) return false;
        if (args.lengthMax != null && labelLength > args.lengthMax) return false;
      }
      return true;
    })
    .slice(0, limit);

  return {
    suggestions,
    total: suggestions.length,
  } as GetDomainSuggestionsOutput;
}

// ============================================================================
// getTldPricing
// ============================================================================

export async function getTldPricing(args: {
  tlds: string[];
}): Promise<GetTldPricingOutput> {
  const tlds = (args?.tlds ?? []).map(stripDot).filter(Boolean);
  if (!tlds.length) {
    throw new Validation('getTldPricing requires a non-empty `tlds` array.');
  }

  const { jwtToken, baseUrls } = getDccRuntimeConfig();
  const currencyId = getCurrency();
  const body = JSON.stringify({
    tlds,
    ...(currencyId ? { currencyId } : {}),
    marketId: getMarket(),
  });

  const resp = asObject(
    await gdFetch<Json>(
      `${baseUrls.merchandisingProxyApi}api/v1/tlds/pricing`,
      {
        method: 'POST',
        body,
        headers: { Authorization: `sso-jwt ${jwtToken}` },
      },
    ),
  );

  const priceByTld = asObject(resp.priceByTld);
  const pricing: Json[] = [];
  for (const tld of tlds) {
    const entry = firstDefined(priceByTld[tld], priceByTld[`.${tld}`]);
    if (entry == null) continue;
    pricing.push({ ...asObject(entry), tld });
  }

  return { currency: asStr(resp.currencyId), pricing } as GetTldPricingOutput;
}

// ============================================================================
// listAccountActivity
// ============================================================================

export async function listAccountActivity(
  args: {
    count?: number;
    dateSort?: 'ASC' | 'DESC';
    startDate?: string;
    endDate?: string;
    userType?: 'SHOPPER' | 'DELEGATE';
    activity?: string[];
    statuses?: Array<'SUCCEEDED' | 'INITIATED' | 'FAILED' | 'MULTIPLE'>;
    changeValidated?: Array<'YES' | 'NO'>;
  } = {},
): Promise<ListAccountActivityOutput> {
  const cid = getCustomerId();
  const { baseUrls } = getDccRuntimeConfig();

  const { items, total } = await paginateOffset<Json>(
    async (limit, offset) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (args.dateSort) params.set('dateSort', args.dateSort);
      if (args.startDate) params.set('startDate', args.startDate);
      if (args.endDate) params.set('endDate', args.endDate);
      if (args.userType) params.set('userType', args.userType);
      for (const a of args.activity ?? []) params.append('activity', a);
      for (const s of args.statuses ?? []) params.append('statuses', s);
      for (const cv of args.changeValidated ?? [])
        params.append('changeValidated', cv);
      const body = asObject(
        await dccFetch<Json>(
          `${baseUrls.activityLogApi}v1/customers/${cid}/resources?${params.toString()}`,
        ),
      );
      const pagination = asObject(body.pagination);
      const reported = asNum(firstDefined(pagination.total, body.total));
      return {
        items: extractArray(body, [
          'activities',
          'resources',
          'data',
          'records',
          'results',
          'items',
        ]),
        total: reported,
      };
    },
    args.count,
    50,
  );

  return { activity: items, total } as ListAccountActivityOutput;
}
