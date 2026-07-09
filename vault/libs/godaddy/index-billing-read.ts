/**
 * GoDaddy billing-read functions.
 *
 * Read-only billing/subscription surface on account.godaddy.com (Akamai-fronted).
 * Calls are spaced and never parallelized — this host hard-blocks bursts.
 */

import {
  gdFetch,
  getCustomerId,
  getMarket,
  getCurrency,
  paginateOffset,
  ACCOUNT_ORIGIN,
  ContractDrift,
  Validation,
  throwForStatus,
} from './_shared';
import type {
  SubscriptionSummary,
  Entitlement,
  ProductFamily,
  Product,
  PaymentProfile,
  CommerceSubscription,
  SearchSubscriptionsOutput,
  ListEntitlementsOutput,
  ListProductFamiliesOutput,
  ListProductsOutput,
  ListPaymentProfilesOutput,
  GetPaymentProfileOutput,
  ListCommerceSubscriptionsOutput,
  GetBillingSummaryOutput,
} from './schemas-billing-read';

export type {
  SubscriptionSummary,
  Entitlement,
  ProductFamily,
  Product,
  PaymentProfile,
  CommerceSubscription,
  SearchSubscriptionsOutput,
  ListEntitlementsOutput,
  ListProductFamiliesOutput,
  ListProductsOutput,
  ListPaymentProfilesOutput,
  GetPaymentProfileOutput,
  ListCommerceSubscriptionsOutput,
  GetBillingSummaryOutput,
} from './schemas-billing-read';

interface RawGatewaySubscription {
  subscriptionId: string;
  name?: string;
  commonName?: string;
  status?: string;
  paidThroughDate?: string;
  metadata?: { createdAt?: string };
  offer?: {
    autoRenew?: boolean;
    products?: Array<{
      product?: { productFamily?: string; productType?: string };
    }>;
  };
}

function toSubscriptionSummary(
  raw: RawGatewaySubscription,
): SubscriptionSummary {
  const firstProduct = raw.offer?.products?.[0]?.product;
  return {
    subscriptionId: raw.subscriptionId,
    productName: raw.name ?? undefined,
    label: raw.commonName || undefined,
    productFamily: firstProduct?.productFamily ?? undefined,
    productType: firstProduct?.productType ?? undefined,
    status: raw.status ?? undefined,
    autoRenew: raw.offer?.autoRenew ?? undefined,
    expiresAt: raw.paidThroughDate ?? undefined,
    createdAt: raw.metadata?.createdAt ?? undefined,
  };
}

interface EntitlementsResponse {
  entitlements?: Entitlement[];
  pagination?: { total?: number };
}

interface PlatapiSubscriptionsResponse {
  subscriptions?: Product[];
  pagination?: { total?: number };
}

interface CommerceSubscriptionsResponse {
  items?: CommerceSubscription[];
  subscriptions?: CommerceSubscription[];
  links?: Array<{ href: string; rel: string }>;
  pagination?: { total?: number };
}

interface LaunchResponse {
  components?: {
    subscriptionList?: { cards?: Array<Record<string, unknown>> };
  };
}

/** Pull an array out of a list response that may be a bare array or an enveloped object. */
function extractArray<T>(resp: unknown, key: string): T[] {
  if (Array.isArray(resp)) return resp as T[];
  if (resp && typeof resp === 'object') {
    const v = (resp as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

// ============================================================================
// searchSubscriptions
// ============================================================================

export async function searchSubscriptions(
  args: {
    query?: string;
    productFamily?: string;
    productFamilies?: string[];
    excludes?: ('CES' | 'FREEMIUM')[];
    status?: string;
    count?: number;
  } = {},
): Promise<SearchSubscriptionsOutput> {
  const cid = getCustomerId();
  const market = getMarket();

  const fetchPage = async (limit: number, offset: number) => {
    const qs = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      marketId: market,
    });
    if (args.productFamilies?.length) {
      qs.set('productFamilies', args.productFamilies.join(','));
    } else if (args.productFamily) {
      qs.set('productFamilies', args.productFamily);
    }
    if (args.excludes?.length) qs.set('excludes', args.excludes.join(','));
    const resp = await gdFetch<RawGatewaySubscription[]>(
      `${ACCOUNT_ORIGIN}/gateway/v2/customers/${cid}/subscriptions?${qs.toString()}`,
    );
    if (!Array.isArray(resp)) {
      throw new ContractDrift(
        `searchSubscriptions: expected array from gateway/v2/customers/${cid}/subscriptions but got ${JSON.stringify(resp).slice(0, 200)}`,
      );
    }
    return { items: resp.map(toSubscriptionSummary), total: undefined };
  };

  const hasClientFilter = Boolean(args.query || args.status);
  const { items } = await paginateOffset(
    fetchPage,
    hasClientFilter ? undefined : args.count,
    50,
  );

  let filtered = items;
  if (args.query) {
    const q = args.query.toLowerCase();
    filtered = filtered.filter((s) =>
      `${s.productName ?? ''} ${s.label ?? ''}`.toLowerCase().includes(q),
    );
  }
  if (args.status) filtered = filtered.filter((s) => s.status === args.status);

  const subscriptions =
    args.count != null ? filtered.slice(0, args.count) : filtered;
  return { subscriptions, total: subscriptions.length };
}

// ============================================================================
// listEntitlements
// ============================================================================

export async function listEntitlements(
  args: {
    productFamilies?: string[];
    includes?: 'third-party';
    count?: number;
  } = {},
): Promise<ListEntitlementsOutput> {
  const cid = getCustomerId();
  const market = getMarket();

  // The entitlements endpoint requires productFamilies to return any results.
  // Auto-discover the account's families when none are provided.
  let families: string[];
  if (args.productFamilies?.length) {
    families = args.productFamilies;
  } else {
    const pfResp = await gdFetch<{ productFamilies?: unknown[] }>(
      `${ACCOUNT_ORIGIN}/gateway/v2/customers/${cid}/productFamilies?excludes=ces&includes=third-party`,
    );
    const discovered = (
      Array.isArray(pfResp?.productFamilies) ? pfResp.productFamilies : []
    ).filter((f): f is string => typeof f === 'string');
    // 'security' covers SSL/cert entitlements and is always requested by the UI
    const familySet = new Set([...discovered, 'security']);
    families = Array.from(familySet);
  }

  const fetchPage = async (limit: number, offset: number) => {
    const qs = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      marketId: market,
      excludes: 'CES',
    });
    qs.set('productFamilies', families.join(','));
    if (args.includes) qs.set('includes', args.includes);
    const resp = await gdFetch<unknown>(
      `${ACCOUNT_ORIGIN}/gateway/v2/customers/${cid}/subscriptions-shim/entitlements?${qs.toString()}`,
    );
    const items = extractArray<Entitlement>(resp, 'entitlements');
    const envelope = resp as EntitlementsResponse;
    return { items, total: envelope.pagination?.total };
  };

  const { items, total } = await paginateOffset(fetchPage, args.count, 50);
  return { entitlements: items, ...(total !== undefined ? { total } : {}) };
}

// ============================================================================
// listProductFamilies
// ============================================================================

export async function listProductFamilies(
  args: {
    excludes?: 'ces';
    includes?: 'third-party';
  } = {},
): Promise<ListProductFamiliesOutput> {
  const cid = getCustomerId();
  const qs = new URLSearchParams();
  if (args.excludes) qs.set('excludes', args.excludes);
  if (args.includes) qs.set('includes', args.includes);
  const query = qs.toString();
  const url = `${ACCOUNT_ORIGIN}/gateway/v2/customers/${cid}/productFamilies${query ? `?${query}` : ''}`;
  const resp = await gdFetch<Record<string, unknown>>(url);

  const raw = extractArray<unknown>(resp, 'productFamilies');
  const productFamilies: ProductFamily[] = raw.map((item) => {
    if (typeof item === 'string') return { productFamily: item };
    const obj = (item ?? {}) as Record<string, unknown>;
    const key =
      obj.productFamily ?? obj.familyKey ?? obj.key ?? obj.id ?? obj.name;
    return { ...obj, productFamily: key != null ? String(key) : '' };
  });

  const totalSubscriptionCount =
    typeof resp?.totalSubscriptionCount === 'number'
      ? resp.totalSubscriptionCount
      : undefined;

  const thirdPartyRaw = resp?.thirdParty as
    | { productFamilies?: unknown[]; productsCount?: number }
    | undefined;
  const thirdParty =
    thirdPartyRaw != null
      ? {
          productFamilies: (thirdPartyRaw.productFamilies ?? []).filter(
            (f): f is string => typeof f === 'string',
          ),
          productsCount: thirdPartyRaw.productsCount,
        }
      : undefined;

  return {
    productFamilies,
    total: productFamilies.length,
    ...(totalSubscriptionCount !== undefined ? { totalSubscriptionCount } : {}),
    ...(thirdParty !== undefined ? { thirdParty } : {}),
  };
}

// ============================================================================
// listProducts
// ============================================================================

export async function listProducts(
  args: {
    count?: number;
    includes?: ('addons' | 'relations' | 'renewOptions')[];
    productGroupKeys?: string[];
    sort?: string;
  } = {},
): Promise<ListProductsOutput> {
  const fetchPage = async (limit: number, offset: number) => {
    const qs = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (args.includes?.length) qs.set('includes', args.includes.join(','));
    if (args.productGroupKeys?.length)
      qs.set('productGroupKeys', args.productGroupKeys.join(','));
    if (args.sort) qs.set('sort', args.sort);
    const resp = await gdFetch<PlatapiSubscriptionsResponse>(
      `${ACCOUNT_ORIGIN}/platapi/v1/subscriptions?${qs.toString()}`,
    );
    return { items: resp.subscriptions ?? [], total: resp.pagination?.total };
  };

  const { items, total } = await paginateOffset(fetchPage, args.count, 50);
  return { products: items, total };
}

// ============================================================================
// listPaymentProfiles
// ============================================================================

export async function listPaymentProfiles(): Promise<ListPaymentProfilesOutput> {
  const currency = getCurrency();
  const market = getMarket();
  const country = market.includes('-')
    ? market.split('-')[1]
    : market.toUpperCase();
  const qs = new URLSearchParams({
    source: 'MYA',
    r: String(Math.floor(1e9 * Math.random())),
  });
  if (currency) qs.set('currency', currency);
  if (country) qs.set('country', country);
  const resp = await gdFetch<unknown>(
    `${ACCOUNT_ORIGIN}/payapi/v1/paymentprofiles?${qs.toString()}`,
  );
  const paymentProfiles = extractArray<PaymentProfile>(resp, 'paymentProfiles');
  return { paymentProfiles, total: paymentProfiles.length };
}

// ============================================================================
// getPaymentProfile
// ============================================================================

export async function getPaymentProfile(args: {
  paymentProfileId: string;
  source?: 'MYA' | 'CHECKOUT';
  includes?: ('backup' | 'backupPaymentMethod' | 'vaultedCards')[];
}): Promise<GetPaymentProfileOutput> {
  if (!args.paymentProfileId) {
    throw new Validation('getPaymentProfile requires paymentProfileId.');
  }
  const currency = getCurrency();
  const market = getMarket();
  const country = market.includes('-')
    ? market.split('-')[1]
    : market.toUpperCase();
  const qs = new URLSearchParams({
    source: args.source ?? 'MYA',
    r: String(Math.floor(1e9 * Math.random())),
  });
  if (currency) qs.set('currency', currency);
  if (country) qs.set('country', country);
  if (args.includes?.length) qs.set('includes', args.includes.join(','));
  const resp = await gdFetch<unknown>(
    `${ACCOUNT_ORIGIN}/payapi/v1/paymentprofiles?${qs.toString()}`,
  );
  const paymentProfiles = extractArray<PaymentProfile>(resp, 'paymentProfiles');
  const match = paymentProfiles.find(
    (p) => String(p.paymentProfileId) === args.paymentProfileId,
  );
  if (!match) {
    throwForStatus(
      404,
      `Payment profile ${args.paymentProfileId} not found on this account.`,
    );
  }
  return { paymentProfile: match! };
}

// ============================================================================
// listCommerceSubscriptions
// ============================================================================

export async function listCommerceSubscriptions(
  args: {
    status?: string;
    type?: string;
    businessId?: string;
    storeId?: string;
    entitlementId?: string;
    subscriptionPlanRef?: string;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
    page?: number;
    pageSize?: number;
    count?: number;
  } = {},
): Promise<ListCommerceSubscriptionsOutput> {
  const cid = getCustomerId();

  const qs = new URLSearchParams({
    customerId: cid,
    pageSize: String(args.pageSize ?? 100),
    page: String(args.page ?? 1),
  });
  if (args.status) qs.set('status', args.status);
  if (args.type) qs.set('type', args.type);
  if (args.businessId) qs.set('businessId', args.businessId);
  if (args.storeId) qs.set('storeId', args.storeId);
  if (args.entitlementId) qs.set('entitlementId', args.entitlementId);
  if (args.subscriptionPlanRef)
    qs.set('subscriptionPlanRef', args.subscriptionPlanRef);
  if (args.sortBy) qs.set('sortBy', args.sortBy);
  if (args.sortOrder) qs.set('sortOrder', args.sortOrder);

  const resp = await gdFetch<CommerceSubscriptionsResponse>(
    `${ACCOUNT_ORIGIN}/products/commapi/v1/commerce/subscriptions?${qs.toString()}`,
  );

  let subscriptions = resp.items ?? resp.subscriptions ?? [];
  const total = resp.pagination?.total ?? subscriptions.length;
  if (args.count != null) subscriptions = subscriptions.slice(0, args.count);
  return { subscriptions, total };
}

// ============================================================================
// getBillingSummary
// ============================================================================

export async function getBillingSummary(): Promise<GetBillingSummaryOutput> {
  const currency = getCurrency();
  const launch = await gdFetch<LaunchResponse>(
    `${ACCOUNT_ORIGIN}/myrenewalsapi/v2/launch`,
  );
  const cards = launch.components?.subscriptionList?.cards;

  if (!Array.isArray(cards) || cards.length === 0) {
    return {
      available: false,
      subscriptionCount: 0,
      autoRenewOnCount: 0,
      autoRenewOffCount: 0,
      expiringSoonCount: 0,
      currency,
    };
  }

  const now = Date.now();
  const horizon = now + 30 * 24 * 60 * 60 * 1000;
  let autoRenewOnCount = 0;
  let expiringSoonCount = 0;

  for (const card of cards) {
    if (card.autoRenew === true) autoRenewOnCount += 1;
    const dateStr =
      (card.nextBillOn as string | undefined) ??
      (card.paidThroughDateISO as string | undefined) ??
      (card.renewalDate as string | undefined) ??
      (card.expiresAt as string | undefined);
    if (dateStr) {
      const t = Date.parse(dateStr);
      if (!Number.isNaN(t) && t >= now && t <= horizon) expiringSoonCount += 1;
    }
  }

  return {
    available: true,
    subscriptionCount: cards.length,
    autoRenewOnCount,
    autoRenewOffCount: cards.length - autoRenewOnCount,
    expiringSoonCount,
    currency,
  };
}
