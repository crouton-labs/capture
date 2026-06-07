/**
 * HubSpot Account Info Module
 *
 * Detects user plan, subscription status, available hubs, and feature access.
 * All functions require CSRF token and portalId from getContext().
 */

import { Validation, throwForStatus } from '@vallum/_runtime';

interface PaidProduct {
  id: string;
  name: string;
  skuId: number;
  type: string;
  productTier: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  productApiName: string;
  includedProductTypes: string[];
  limits: Array<{
    name: string;
    limit: number;
    used: number;
  }>;
  included: Array<{
    name: string;
    type: string;
  }>;
}

interface PaidProductsResponse {
  subscriptionId: number;
  paidProducts: PaidProduct[];
}

interface TrialProduct {
  name: string;
  type: string;
  productTier: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  productApiName: string;
}

interface Trial {
  daysRemaining: number;
  product: TrialProduct;
  endsAt: number;
}

interface TrialsResponse {
  trials: Trial[];
}

interface FreeProduct {
  id: string;
  name: string;
  type: string;
  productApiName: string;
}

interface CompanyDetailsResponse {
  id: number;
  name: string;
  industry?: string;
  phone?: string;
  website?: string;
}

/**
 * Comprehensive view of user's subscription, including paid products, trials, and free products.
 */
export interface SubscriptionInfo {
  paidProducts: PaidProduct[];
  trials: Trial[];
  freeProducts: FreeProduct[];
  companyDetails?: CompanyDetailsResponse;
}

/**
 * Tier level or free access status.
 */
export type HubTier = 'free' | 'starter' | 'professional' | 'enterprise';

/**
 * Information about hub availability and access level.
 */
export interface HubAccessEntry {
  tier: HubTier;
  isTrial: boolean;
  daysRemaining?: number;
}

/**
 * Hub access map showing which hubs are available and at what tier.
 */
export interface HubAccess {
  marketing?: HubAccessEntry;
  sales?: HubAccessEntry;
  service?: HubAccessEntry;
  content?: HubAccessEntry;
  operations?: HubAccessEntry;
  commerce?: HubAccessEntry;
}

/**
 * Fetch subscription info: paid products, trials, and free products.
 *
 * Returns a comprehensive view of all active subscriptions and trials
 * for the user's account. Use getHubAccess() for a simpler hub-level summary.
 */
export async function getSubscriptionInfo(opts: {
  csrf: string;
  portalId: string;
}): Promise<SubscriptionInfo> {
  if (!opts.csrf) {
    throw new Validation('CSRF token required');
  }
  if (!opts.portalId) {
    throw new Validation('Portal ID required');
  }

  const headers = {
    credentials: 'include' as const,
    'x-hubspot-csrf-hubspotapi': opts.csrf,
    accept: 'application/json',
  };

  // Fetch all three endpoints in parallel
  const [paidRes, trialsRes, freeRes] = await Promise.all([
    fetch(
      `/api/subscription-experience/v1/paid-products?portalId=${opts.portalId}`,
      { credentials: 'include', headers },
    ),
    fetch(`/api/subscription-experience/v1/trials?portalId=${opts.portalId}`, {
      credentials: 'include',
      headers,
    }),
    fetch(
      `/api/subscription-experience/v1/free-products?portalId=${opts.portalId}`,
      { credentials: 'include', headers },
    ),
  ]);

  // Check responses
  if (!paidRes.ok) {
    throwForStatus(paidRes.status, paidRes.statusText || undefined);
  }
  if (!trialsRes.ok) {
    throwForStatus(trialsRes.status, trialsRes.statusText || undefined);
  }
  if (!freeRes.ok) {
    throwForStatus(freeRes.status, freeRes.statusText || undefined);
  }

  const paidData = (await paidRes.json()) as PaidProductsResponse[];
  const trialsData = (await trialsRes.json()) as TrialsResponse;
  const freeData = await freeRes.json();

  // Flatten paid products array (API returns array of subscription objects)
  const paidProducts: PaidProduct[] = [];
  for (const subscription of paidData) {
    paidProducts.push(...subscription.paidProducts);
  }

  // free-products endpoint returns a bare array, not {freeProducts: [...]}
  const freeProducts: FreeProduct[] = Array.isArray(freeData)
    ? freeData
    : (freeData.freeProducts ?? []);

  return {
    paidProducts,
    trials: trialsData.trials,
    freeProducts,
  };
}

/**
 * Get a simple hub-level view of user's feature access.
 *
 * Maps subscription info to hub names with tier levels.
 * Returns which hubs (marketing, sales, service, etc.) are available
 * and whether access is free, trial, or paid subscription.
 *
 * Example output:
 * {
 *   marketing: { tier: 'professional', isTrial: true, daysRemaining: 14 },
 *   sales: { tier: 'starter', isTrial: false },
 *   content: { tier: 'free', isTrial: false }
 * }
 */
export async function getHubAccess(opts: {
  csrf: string;
  portalId: string;
}): Promise<HubAccess> {
  const subscriptionInfo = await getSubscriptionInfo(opts);

  const hubAccess: HubAccess = {};

  // Build trial map for quick lookup
  const trialsByProductType = new Map<string, Trial>();
  for (const trial of subscriptionInfo.trials) {
    trialsByProductType.set(trial.product.type, trial);
  }

  // Map product types to hub names
  const productTypeToHub: Record<string, keyof HubAccess> = {
    MARKETING: 'marketing',
    SALES_SEAT: 'sales',
    SERVICE_SEAT: 'service',
    CMS: 'content',
    OPERATIONS: 'operations',
    COMMERCE: 'commerce',
  };

  // Track which hubs we've seen (to avoid duplicates)
  const processedHubs = new Set<keyof HubAccess>();

  // Process paid products
  for (const product of subscriptionInfo.paidProducts) {
    for (const productType of product.includedProductTypes) {
      const hubName = productTypeToHub[productType];
      if (!hubName || processedHubs.has(hubName)) {
        continue;
      }
      processedHubs.add(hubName);

      const trial = trialsByProductType.get(productType);
      hubAccess[hubName] = {
        tier: product.productTier.toLowerCase() as HubTier,
        isTrial: !!trial,
        daysRemaining: trial?.daysRemaining,
      };
    }
  }

  // Process trials (standalone, not part of paid products)
  for (const trial of subscriptionInfo.trials) {
    const hubName = productTypeToHub[trial.product.type];
    if (!hubName || processedHubs.has(hubName)) {
      continue;
    }
    processedHubs.add(hubName);

    hubAccess[hubName] = {
      tier: trial.product.productTier.toLowerCase() as HubTier,
      isTrial: true,
      daysRemaining: trial.daysRemaining,
    };
  }

  // Process free products
  for (const freeProduct of subscriptionInfo.freeProducts) {
    const hubName = productTypeToHub[freeProduct.type];
    if (!hubName || processedHubs.has(hubName)) {
      continue;
    }
    processedHubs.add(hubName);

    hubAccess[hubName] = {
      tier: 'free',
      isTrial: false,
    };
  }

  return hubAccess;
}

/**
 * Feature flags for premium features (Breeze agents, enrichment, etc.).
 */
interface FeatureFlag {
  name: string;
  enabled: boolean;
}

/**
 * Response from feature enablement endpoint.
 */
interface FeatureEnablementResponse {
  type: 'data';
  data: {
    data: Array<{
      featureType: string;
      enabled: boolean;
    }>;
  };
}

/**
 * Response from governance endpoint.
 */
interface GovernanceResponse {
  type: 'data';
  data: {
    featureStates: Record<string, { isEnabled: boolean }>;
  };
}

/**
 * Combined feature flags output.
 */
export interface FeatureFlags {
  features: FeatureFlag[];
  featureStates: Record<string, boolean>;
}

/**
 * Check which premium features (Breeze agents, enrichment, intent, workflows) are enabled.
 *
 * Only call when you need to verify whether a specific premium feature is available
 * before attempting to use it.
 *
 * Combines two endpoints:
 * - Feature enablement (top-level features: CUSTOMER_AGENT, ENRICHMENT, etc.)
 * - Governance (granular sub-features: BREEZE_CONTACT_ENRICHMENT, etc.)
 */
export async function getFeatureFlags(opts: {
  csrf: string;
  portalId: string;
}): Promise<FeatureFlags> {
  if (!opts.csrf) {
    throw new Validation('CSRF token required');
  }
  if (!opts.portalId) {
    throw new Validation('Portal ID required');
  }

  const headers = {
    'x-hubspot-csrf-hubspotapi': opts.csrf,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  // Fetch both endpoints in parallel
  const [enablementRes, governanceRes] = await Promise.all([
    fetch(
      `/api/chirp-frontend-app/v1/gateway/com.hubspot.usagebasedbilling.experience.rpc.UsageBasedBillingFeatureEnablementRpc/getFeatureEnablementStatuses?portalId=${opts.portalId}&clienttimeout=5000`,
      {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({}),
      },
    ),
    fetch(
      `/api/chirp-frontend-app/v1/gateway/com.hubspot.usagebasedbilling.experience.rpc.UsageBasedBillingGovernanceRpc/getGovernanceStatus?portalId=${opts.portalId}&clienttimeout=5000`,
      {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({}),
      },
    ),
  ]);

  if (!enablementRes.ok) {
    throwForStatus(enablementRes.status, enablementRes.statusText || undefined);
  }
  if (!governanceRes.ok) {
    throwForStatus(governanceRes.status, governanceRes.statusText || undefined);
  }

  const enablementData =
    (await enablementRes.json()) as FeatureEnablementResponse;
  const governanceData = (await governanceRes.json()) as GovernanceResponse;

  // Transform enablement data
  const features: FeatureFlag[] = enablementData.data.data.map((f) => ({
    name: f.featureType,
    enabled: f.enabled,
  }));

  // Flatten governance data
  const featureStates: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(
    governanceData.data.featureStates,
  )) {
    featureStates[key] = value.isEnabled;
  }

  return {
    features,
    featureStates,
  };
}

/**
 * Response from usage period endpoint.
 */
interface UsagePeriodResponse {
  type: 'data';
  data: {
    startDate: string;
    endDate: string;
    totalCredits: number;
    creditsUsed: number;
    grantedCredits: number;
    overages: number;
    isOverageEnabled: boolean;
    breakdown: unknown[];
  };
}

/**
 * Credit usage output.
 */
export interface CreditUsage {
  startDate: string;
  endDate: string;
  totalCredits: number;
  creditsUsed: number;
  creditsRemaining: number;
  isOverageEnabled: boolean;
}

/**
 * Check HubSpot credit balance and usage for the current billing period.
 *
 * Only call when the user asks about credits/usage or before performing
 * credit-consuming operations like enrichment.
 */
export async function getCreditUsage(opts: {
  csrf: string;
  portalId: string;
}): Promise<CreditUsage> {
  if (!opts.csrf) {
    throw new Validation('CSRF token required');
  }
  if (!opts.portalId) {
    throw new Validation('Portal ID required');
  }

  const headers = {
    'x-hubspot-csrf-hubspotapi': opts.csrf,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  const response = await fetch(
    `/api/chirp-frontend-app/v1/gateway/com.hubspot.usagebasedbilling.experience.rpc.UsageBasedBillingExperienceRpc/getUsagePeriodUsage?portalId=${opts.portalId}&clienttimeout=5000`,
    {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ showBreakdown: true }),
    },
  );

  if (!response.ok) {
    throwForStatus(response.status, response.statusText || undefined);
  }

  const data = (await response.json()) as UsagePeriodResponse;

  return {
    startDate: data.data.startDate,
    endDate: data.data.endDate,
    totalCredits: data.data.totalCredits,
    creditsUsed: data.data.creditsUsed,
    creditsRemaining: data.data.totalCredits - data.data.creditsUsed,
    isOverageEnabled: data.data.isOverageEnabled,
  };
}
