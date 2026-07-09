/**
 * GoDaddy domain-write-lifecycle functions.
 *
 * Commerce/lifecycle writes on the domain API (domainsapi.godaddy.com,
 * domainsECommApi group): privacy/protection changes, renewals, and expiration
 * consolidation. Several of these are charge-incurring — the call is
 * implemented but callers MUST confirm with the user first (see schema notes).
 */

import {
  dccFetch,
  getCustomerId,
  getMarket,
  getCurrency,
  ECOMM_DOMAINS_API,
  Validation,
} from './_shared';
import type {
  LifecycleWriteResult,
  SetDomainPrivacyOutput,
  RenewDomainOutput,
  RenewDomainsOutput,
  ConsolidateDomainExpirationsOutput,
} from './schemas-domain-write-lifecycle';

export type {
  LifecycleWriteResult,
  SetDomainPrivacyOutput,
  RenewDomainOutput,
  RenewDomainsOutput,
  ConsolidateDomainExpirationsOutput,
} from './schemas-domain-write-lifecycle';

async function ecommPost(
  url: string,
  body?: unknown,
): Promise<LifecycleWriteResult> {
  const result = await dccFetch<LifecycleWriteResult | undefined>(url, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return result ?? {};
}

// ============================================================================
// setDomainPrivacy
// ============================================================================

export async function setDomainPrivacy(args: {
  domainNames: string[];
  action: 'add' | 'remove' | 'upgrade' | 'downgrade';
}): Promise<SetDomainPrivacyOutput> {
  const { domainNames, action } = args;
  if (!domainNames?.length) {
    throw new Validation('setDomainPrivacy requires at least one domainName.');
  }
  if (!action) {
    throw new Validation(
      'setDomainPrivacy requires an action (add|remove|upgrade|downgrade).',
    );
  }
  const cid = getCustomerId();

  let result: LifecycleWriteResult;
  switch (action) {
    case 'add': {
      const params = new URLSearchParams({
        marketId: getMarket(),
        itc: 'dcc_settings_privacy_add_cart',
      });
      result = await ecommPost(
        `${ECOMM_DOMAINS_API}/v2/customers/${cid}/domains/adddomainproducts?${params.toString()}`,
        { domains: domainNames.map((domain) => ({ domain })) },
      );
      break;
    }
    case 'remove': {
      result = await ecommPost(
        `${ECOMM_DOMAINS_API}/v1/customers/${cid}/domains/cancelDBP`,
        {
          domains: domainNames,
        },
      );
      break;
    }
    case 'upgrade':
    case 'downgrade': {
      result = await ecommPost(
        `${ECOMM_DOMAINS_API}/v1/customers/${cid}/domains/$each/protectionplan/${action}`,
        domainNames.map((domain) => ({ domain })),
      );
      break;
    }
    default:
      throw new Validation(
        `setDomainPrivacy: unknown action "${action as string}". Use add|remove|upgrade|downgrade.`,
      );
  }

  return { action, domainNames, result };
}

// ============================================================================
// renewDomain
// ============================================================================

export async function renewDomain(args: {
  domainName: string;
  years: number;
  discountCode?: string;
  isc?: string;
}): Promise<RenewDomainOutput> {
  const { domainName, years, discountCode, isc } = args;
  if (!domainName) {
    throw new Validation('renewDomain requires a domainName.');
  }
  if (!Number.isInteger(years) || years < 1) {
    throw new Validation(
      `renewDomain requires a positive integer "years" (got ${years}).`,
    );
  }
  const cid = getCustomerId();

  const params = new URLSearchParams({
    renewalYears: String(years),
    marketId: getMarket(),
  });
  const currency = getCurrency();
  if (currency) params.set('currency', currency);
  if (discountCode) params.set('discountCode', discountCode);
  if (isc) params.set('isc', isc);

  const result = await ecommPost(
    `${ECOMM_DOMAINS_API}/v1/customers/${cid}/domains/${encodeURIComponent(domainName)}/renew?${params.toString()}`,
  );
  return { domainName, years, result };
}

// ============================================================================
// renewDomains
// ============================================================================

export async function renewDomains(args: {
  domainNames: string[];
  years: number;
  isc?: string;
}): Promise<RenewDomainsOutput> {
  const { domainNames, years, isc } = args;
  if (!domainNames?.length) {
    throw new Validation('renewDomains requires at least one domainName.');
  }
  if (!Number.isInteger(years) || years < 1) {
    throw new Validation(
      `renewDomains requires a positive integer "years" (got ${years}).`,
    );
  }
  const cid = getCustomerId();

  const params = new URLSearchParams({ marketId: getMarket() });
  const currency = getCurrency();
  if (currency) params.set('currency', currency);
  if (isc) params.set('isc', isc);

  const result = await ecommPost(
    `${ECOMM_DOMAINS_API}/v1/customers/${cid}/domains/renew?${params.toString()}`,
    {
      domains: domainNames.map((domain) => ({ domain, renewalYears: years })),
    },
  );
  return { domainNames, years, result };
}

// ============================================================================
// consolidateDomainExpirations
// ============================================================================

export async function consolidateDomainExpirations(args: {
  domainNames: string[];
  targetDate: string;
  submitPartialSuccess?: boolean;
}): Promise<ConsolidateDomainExpirationsOutput> {
  const { domainNames, targetDate, submitPartialSuccess = false } = args;
  if (!domainNames || domainNames.length < 2) {
    throw new Validation(
      'consolidateDomainExpirations requires at least two domainNames.',
    );
  }
  if (!targetDate) {
    throw new Validation(
      'consolidateDomainExpirations requires a targetDate (ISO 8601, e.g. "2027-12-31").',
    );
  }
  const cid = getCustomerId();

  const body = {
    filter: { domainNamesFilter: { type: 'INCLUDE', names: domainNames } },
    consolidate: { date: targetDate },
    submitPartialSuccess,
  };

  const result = await ecommPost(
    `${ECOMM_DOMAINS_API}/v1/customers/${cid}/domains/consolidateDomains`,
    body,
  );
  return { domainNames, targetDate, result };
}
