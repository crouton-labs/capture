/**
 * GoDaddy Library
 *
 * Browser-executable GoDaddy account/billing operations via cookie auth.
 * Requires the user to be signed in and on an account.godaddy.com page.
 */

import {
  ContractDrift,
  Validation,
  UpstreamError,
  RateLimited,
  throwForStatus,
  parseInfoCustIdp,
} from './_shared';
import type {
  GetContextOutput,
  ListSubscriptionsOutput,
  GetSubscriptionOutput,
  SetSubscriptionAutoRenewOutput,
  Subscription,
} from './schemas';

export type {
  Subscription,
  GetContextOutput,
  ListSubscriptionsOutput,
  ListRenewalsOutput,
  GetSubscriptionOutput,
  SetSubscriptionAutoRenewOutput,
} from './schemas';

// ============================================================================
// Split-module re-exports — functions (explicit named) + output/entity types.
// Each split module is the permanent home of its functions; this wires them
// into the library's single public entry point.
// ============================================================================

export {
  listDomains,
  getDomain,
  searchDomains,
  checkDomainActionEligibility,
} from './index-domain-read-core';
export type * from './schemas-domain-read-core';

export {
  getDomainContacts,
  getDomainNameservers,
  getDomainForwarding,
  getDomainPrivacy,
  getDomainRenewalTerms,
  listDomainExports,
  exportDomains,
  getDomainExportStatus,
} from './index-domain-read-detail';
export type * from './schemas-domain-read-detail';

export {
  setDomainAutoRenew,
  setDomainLock,
  updateDomainNameservers,
  updateDomainContacts,
  updateDomainForwarding,
  deleteDomainForwarding,
} from './index-domain-write-settings';
export type * from './schemas-domain-write-settings';

export {
  setDomainPrivacy,
  renewDomain,
  renewDomains,
  consolidateDomainExpirations,
} from './index-domain-write-lifecycle';
export type * from './schemas-domain-write-lifecycle';

export {
  listIncomingTransfers,
  getTransferStatus,
  checkTransferEligibility,
  startDomainTransferIn,
  prepareDomainForTransferOut,
  transferDomainToAccount,
  acceptDomainTransfer,
  cancelDomainTransfer,
} from './index-transfers';
export type * from './schemas-transfers';

export {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  addDomainsToFolder,
  removeDomainsFromFolder,
} from './index-folders';
export type * from './schemas-folders';

export {
  listDomainProfiles,
  createDomainProfile,
  updateDomainProfile,
  deleteDomainProfile,
  applyDomainProfile,
} from './index-profiles';
export type * from './schemas-profiles';

export {
  listDnsZones,
  getDnsRecords,
  searchDnsRecords,
  exportZoneFile,
} from './index-dns-read';
export type * from './schemas-dns-read';

export {
  createDnsRecord,
  createDnsRecords,
  updateDnsRecord,
  updateDnsRecords,
  deleteDnsRecord,
  deleteDnsRecords,
  addDnsHosting,
  cancelDnsHosting,
} from './index-dns-write';
export type * from './schemas-dns-write';

export {
  listVanityHosts,
  createVanityHost,
  updateVanityHost,
  deleteVanityHost,
  getSecondaryDns,
  updateSecondaryDns,
} from './index-nameservers-vanity';
export type * from './schemas-nameservers-vanity';

export {
  getDnssec,
  enableDnssec,
  disableDnssec,
  listDsRecords,
  createDsRecord,
  updateDsRecord,
  deleteDsRecord,
} from './index-dnssec';
export type * from './schemas-dnssec';

export {
  listDnsTemplates,
  getDnsTemplate,
  createDnsTemplate,
  updateDnsTemplate,
  deleteDnsTemplate,
  applyDnsTemplate,
  addTemplateRecord,
  updateTemplateRecord,
  deleteTemplateRecord,
} from './index-dns-templates';
export type * from './schemas-dns-templates';

export {
  searchSubscriptions,
  listEntitlements,
  listProductFamilies,
  listProducts,
  listPaymentProfiles,
  getPaymentProfile,
  listCommerceSubscriptions,
  getBillingSummary,
} from './index-billing-read';
export type * from './schemas-billing-read';

export {
  renewSubscription,
  updateSubscriptionPayment,
  cancelSubscription,
  checkSubscriptionActions,
} from './index-billing-write';
export type * from './schemas-billing-write';

export { listCertificates, searchCertificates } from './index-ssl';
export type * from './schemas-ssl';

export {
  validateSession,
  getAccountProfile,
  updateAccountProfile,
  getShopperPreferences,
  updateShopperPreferences,
  getCustomerSegment,
} from './index-account-profile';
export type * from './schemas-account-profile';

export {
  listSecurityFactors,
  addSecurityFactor,
  removeSecurityFactor,
  getSecurityOptions,
  updateSecurityOptions,
  requestContactVerification,
  verifyContact,
  listAccountEvents,
  listDelegates,
  createDelegateInvitation,
} from './index-account-security';
export type * from './schemas-account-security';

export {
  listNotifications,
  updateNotificationConsent,
  listProjects,
  getProjectCounts,
} from './index-account-dashboard';
export type * from './schemas-account-dashboard';

export {
  checkDomainAvailability,
  getDomainSuggestions,
  getTldPricing,
  listAccountActivity,
} from './index-discovery-activity';
export type * from './schemas-discovery-activity';

const ACCOUNT_ORIGIN = 'https://account.godaddy.com';

/** Plain cookie read (non-httpOnly). */
function readCookie(name: string): string | undefined {
  const prefix = name + '=';
  const hit = document.cookie.split('; ').find((c) => c.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

/**
 * Authenticated JSON fetch for account.godaddy.com. Cookie auth only —
 * myrenewalsapi takes no x-app-key / X-Request-Id headers.
 */
async function gdFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && body.includes('edgesuite')) {
      throw new RateLimited(
        `GoDaddy account.godaddy.com temporarily blocked by Akamai WAF (${url}). Navigate to account.godaddy.com in your browser to reset the session, then retry.`,
      );
    }
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(
      res.status,
      `GoDaddy API ${res.status} (${url}): ${truncated}`,
    );
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ContractDrift(
      `GoDaddy returned non-JSON (${url}): ${text.slice(0, 500)}`,
    );
  }
}

// ============================================================================
// getContext
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  const info = parseInfoCustIdp();

  const fullName =
    [info.firstname, info.lastname].filter(Boolean).join(' ') || undefined;
  return {
    customerId: String(info.info_cid),
    shopperId: String(info.info_shopperId),
    email: info.username,
    market: readCookie('market'),
    currency: info.currency ?? readCookie('currency') ?? undefined,
    privateLabelId: info.plid,
    fullName,
  };
}

// ============================================================================
// Renewals (myrenewalsapi) — subscription source for the billing surface
// ============================================================================

interface LaunchResponse {
  components?: {
    subscriptionList?: { cards?: Array<Record<string, unknown>> };
  };
  context?: { shopperId?: string; customerId?: string };
}

/** The renewals page's data source: subscription cards carry autoRenew + revision. */
async function fetchSubscriptionCards(): Promise<
  Array<Record<string, unknown>>
> {
  const launch = await gdFetch<LaunchResponse>(
    `${ACCOUNT_ORIGIN}/myrenewalsapi/v2/launch`,
  );
  const cards = launch.components?.subscriptionList?.cards;
  if (!Array.isArray(cards)) {
    throw new ContractDrift(
      'GoDaddy launch shape drift: components.subscriptionList.cards is missing or not an array.',
    );
  }
  return cards;
}

function revisionOf(sub: Record<string, unknown>): number | string | undefined {
  const meta = sub.metadata as { revision?: number | string } | undefined;
  return (sub.revision as number | string | undefined) ?? meta?.revision;
}

/** Project a raw renewals card to the clean, documented Subscription shape. */
function toSubscription(card: Record<string, unknown>): Subscription {
  return {
    subscriptionId: String(card.subscriptionId),
    productName:
      (card.productName as string) ?? (card.title as string) ?? undefined,
    productFamily: (card.productFamily as string) ?? undefined,
    productType: (card.productType as string) ?? undefined,
    status: (card.status as string) ?? undefined,
    autoRenew: card.autoRenew as boolean | undefined,
    renewalDate:
      (card.nextBillOn as string) ??
      (card.paidThroughDateISO as string) ??
      undefined,
    revision: revisionOf(card),
    paymentProfileId: (card.paymentProfileId as string) ?? undefined,
    isDomainSubscription: card.isDomainSubscription as boolean | undefined,
    numberOfTerms:
      (card.numberOfTerms as string | number | undefined) ?? undefined,
    termType: (card.termType as string) ?? undefined,
  };
}

// ============================================================================
// listSubscriptions
// ============================================================================

export async function listSubscriptions(
  args: {
    productFamilies?: string[];
    status?: string;
    autoRenew?: boolean;
    count?: number;
    search?: string;
    expiresWithinDays?: number;
    missingPayment?: boolean;
  } = {},
): Promise<ListSubscriptionsOutput> {
  let cards = await fetchSubscriptionCards();

  if (args.productFamilies?.length) {
    const want = new Set(args.productFamilies);
    cards = cards.filter(
      (c) => c.productFamily != null && want.has(c.productFamily as string),
    );
  }
  if (args.status) cards = cards.filter((c) => c.status === args.status);
  if (args.autoRenew != null)
    cards = cards.filter((c) => c.autoRenew === args.autoRenew);
  if (args.search != null) {
    const q = args.search.toLowerCase();
    cards = cards.filter((c) => {
      const name = (
        (c.productName as string) ??
        (c.title as string) ??
        ''
      ).toLowerCase();
      const common = ((c.commonName as string) ?? '').toLowerCase();
      const tld = ((c.tld as string) ?? '').toLowerCase();
      return name.includes(q) || common.includes(q) || tld.includes(q);
    });
  }
  if (args.expiresWithinDays != null) {
    cards = cards.filter(
      (c) =>
        c.daysToExpire != null &&
        (c.daysToExpire as number) <= args.expiresWithinDays!,
    );
  }
  if (args.missingPayment != null) {
    cards = cards.filter((c) =>
      args.missingPayment
        ? c.paymentProfileId == null
        : c.paymentProfileId != null,
    );
  }

  const total = cards.length;
  if (args.count != null) cards = cards.slice(0, args.count);

  return { subscriptions: cards.map(toSubscription), total };
}

export async function listRenewals(
  args: {
    productFamilies?: string[];
    status?: string;
    autoRenew?: boolean;
    count?: number;
    search?: string;
    expiresWithinDays?: number;
    missingPayment?: boolean;
  } = {},
): Promise<ListSubscriptionsOutput> {
  return listSubscriptions(args);
}

// ============================================================================
// getSubscription
// ============================================================================

export async function getSubscription(args: {
  subscriptionId: string;
}): Promise<GetSubscriptionOutput> {
  if (!args.subscriptionId)
    throw new Validation('getSubscription requires subscriptionId.');
  const cards = await fetchSubscriptionCards();
  const card = cards.find((s) => s.subscriptionId === args.subscriptionId);
  if (!card) {
    throwForStatus(
      404,
      `Subscription ${args.subscriptionId} not found among renewals-managed subscriptions.`,
    );
  }
  return { subscription: toSubscription(card!) };
}

// ============================================================================
// setSubscriptionAutoRenew
// ============================================================================

interface AutoRenewResult {
  success?: boolean;
  message?: string;
  results?: {
    successes?: Array<{
      subscriptionId: string;
      autoRenew: boolean;
      status?: string;
    }>;
    failures?: Array<{
      subscriptionId: string;
      status?: string;
      message?: string;
    }>;
  };
}

export async function setSubscriptionAutoRenew(args: {
  subscriptionIds: string[];
  autoRenew: boolean;
}): Promise<SetSubscriptionAutoRenewOutput> {
  if (!args.subscriptionIds?.length) {
    throw new Validation(
      'setSubscriptionAutoRenew requires at least one subscriptionId.',
    );
  }
  if (typeof args.autoRenew !== 'boolean') {
    throw new Validation(
      'setSubscriptionAutoRenew requires autoRenew to be a boolean (true or false).',
    );
  }

  // Read each subscription's current card (carries the fresh revision the write round-trips).
  const cards = await fetchSubscriptionCards();
  const byId = new Map(cards.map((s) => [s.subscriptionId as string, s]));

  const items = args.subscriptionIds.map((id) => {
    const sub = byId.get(id);
    if (!sub)
      throwForStatus(
        404,
        `Subscription ${id} not found among renewals-managed subscriptions.`,
      );
    const revision = revisionOf(sub!);
    if (revision == null) {
      throw new ContractDrift(
        `Subscription ${id} has no revision token; cannot perform optimistic-concurrency write.`,
      );
    }
    return { ...sub!, revision };
  });

  const resp = await gdFetch<AutoRenewResult>(
    `${ACCOUNT_ORIGIN}/myrenewalsapi/v1/subscriptions/autorenew`,
    {
      method: 'POST',
      body: JSON.stringify({ subscriptions: items, autoRenew: args.autoRenew }),
    },
  );

  const failures = resp.results?.failures ?? [];
  if (resp.success === false || failures.length) {
    throw new UpstreamError(
      `Auto-renew write failed: ${resp.message ?? ''} ${JSON.stringify(failures).slice(0, 300)}`,
    );
  }

  const successes = resp.results?.successes;
  if (!Array.isArray(successes)) {
    throw new ContractDrift(
      'Auto-renew write missing results.successes confirmation.',
    );
  }

  const confirmedById = new Map(
    successes.map((s) => [s.subscriptionId, s.autoRenew] as const),
  );
  for (const id of args.subscriptionIds) {
    if (!confirmedById.has(id)) {
      throw new ContractDrift(
        `Auto-renew write missing confirmation for subscription ${id}.`,
      );
    }
    if (confirmedById.get(id) !== args.autoRenew) {
      throw new ContractDrift(
        `Auto-renew write confirmed the wrong state for subscription ${id}.`,
      );
    }
  }

  return {
    updated: args.subscriptionIds.map((subscriptionId) => ({
      subscriptionId,
      autoRenew: args.autoRenew,
    })),
  };
}
