/**
 * GoDaddy billing-write functions — renewals & billing actions on
 * `account.godaddy.com/myrenewalsapi` (Fastify).
 *
 * Every write here is optimistic-concurrency guarded: the renewals launch
 * response carries each subscription's current `revision` token, which must be
 * round-tripped on the write. We re-read the cards and attach revision on every
 * call (the main index.ts owns the canonical fetchSubscriptionCards/revisionOf;
 * duplicated here because split modules cannot import from it).
 *
 * Akamai note: account.godaddy.com hard-blocks synthetic bursts. Each function
 * does ONE launch read + ONE write, sequentially — never loop/parallelize.
 */

import {
  gdFetch,
  ACCOUNT_ORIGIN,
  getCurrency,
  getMarket,
  Validation,
  ContractDrift,
  UpstreamError,
  throwForStatus,
} from './_shared';
import type {
  RenewSubscriptionOutput,
  UpdateSubscriptionPaymentOutput,
  CancelSubscriptionOutput,
  CheckSubscriptionActionsOutput,
} from './schemas-billing-write';

export type {
  RenewSubscriptionOutput,
  UpdateSubscriptionPaymentOutput,
  CancelSubscriptionOutput,
  CheckSubscriptionActionsOutput,
} from './schemas-billing-write';

// ============================================================================
// Renewals launch cards — local copy of the optimistic-concurrency source
// ============================================================================

interface LaunchResponse {
  components?: {
    subscriptionList?: { cards?: Array<Record<string, unknown>> };
  };
}

/** The renewals page's data source: subscription cards carry the revision token. */
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

/**
 * Resolve each requested subscription to its current card + revision token.
 * Throws 404 for unknown ids and ContractDrift if a card lacks a revision.
 */
async function withRevisions(
  subscriptionIds: string[],
): Promise<
  Array<{ card: Record<string, unknown>; revision: number | string }>
> {
  if (!subscriptionIds?.length) {
    throw new Validation('At least one subscriptionId is required.');
  }
  const cards = await fetchSubscriptionCards();
  const byId = new Map(cards.map((s) => [s.subscriptionId as string, s]));
  return subscriptionIds.map((id) => {
    const card = byId.get(id);
    if (!card) {
      throwForStatus(
        404,
        `Subscription ${id} not found among renewals-managed subscriptions.`,
      );
    }
    const revision = revisionOf(card!);
    if (revision == null) {
      throw new ContractDrift(
        `Subscription ${id} has no revision token; cannot perform optimistic-concurrency write.`,
      );
    }
    return { card: card!, revision };
  });
}

interface WriteResult {
  success?: boolean;
  message?: string;
  results?: {
    failures?: Array<{
      subscriptionId?: string;
      status?: string;
      message?: string;
    }>;
  };
}

/** Fail fast on an explicit failure signal in a myrenewalsapi write response. */
function assertWriteOk(resp: WriteResult, action: string): void {
  const failures = resp.results?.failures ?? [];
  if (resp.success === false || failures.length) {
    throw new UpstreamError(
      `${action} failed: ${resp.message ?? ''} ${JSON.stringify(failures).slice(0, 300)}`.trim(),
    );
  }
}

// ============================================================================
// renewSubscription  ⚠ incurs a charge
// ============================================================================

export async function renewSubscription(args: {
  subscriptionIds: string[];
  itc?: string;
}): Promise<RenewSubscriptionOutput> {
  const subs = await withRevisions(args.subscriptionIds);
  const items = subs.map(({ card, revision }) => ({
    subscriptionId: card.subscriptionId,
    revision,
    productFamily: card.productFamily,
    termType: card.termType,
    numberOfTerms: card.numberOfTerms,
  }));

  const body: Record<string, unknown> = { subscriptions: items };
  if (args.itc != null) body.itc = args.itc;

  const resp = await gdFetch<WriteResult>(
    `${ACCOUNT_ORIGIN}/myrenewalsapi/v1/subscriptions/renew`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  assertWriteOk(resp, 'renewSubscription');

  return { renewed: args.subscriptionIds };
}

// ============================================================================
// updateSubscriptionPayment
// ============================================================================

export async function updateSubscriptionPayment(args: {
  subscriptionIds: string[];
  paymentProfileId: string;
}): Promise<UpdateSubscriptionPaymentOutput> {
  if (!args.paymentProfileId) {
    throw new Validation(
      'updateSubscriptionPayment requires paymentProfileId.',
    );
  }
  const subs = await withRevisions(args.subscriptionIds);

  // FREEMIUM subscriptions have no billing — GoDaddy silently accepts the
  // request but never applies the payment profile change.
  for (const { card } of subs) {
    if ((card.status as string) === 'FREEMIUM') {
      throw new UpstreamError(
        `updateSubscriptionPayment: subscription ${card.subscriptionId} has status FREEMIUM and cannot have a payment method assigned.`,
      );
    }
  }

  // Resolve the target payment profile to get its paymentInstrumentUri.
  const currency = getCurrency();
  const market = getMarket();
  const country = market.includes('-')
    ? market.split('-')[1]
    : market.toUpperCase();
  const pqs = new URLSearchParams({
    source: 'MYA',
    r: String(Math.floor(1e9 * Math.random())),
  });
  if (currency) pqs.set('currency', currency);
  if (country) pqs.set('country', country);
  const profilesResp = await gdFetch<unknown>(
    `${ACCOUNT_ORIGIN}/payapi/v1/paymentprofiles?${pqs.toString()}`,
  );
  const profileList: Record<string, unknown>[] = Array.isArray(profilesResp)
    ? profilesResp
    : (((profilesResp as Record<string, unknown>)?.paymentProfiles as
        | Record<string, unknown>[]
        | undefined) ?? []);
  const targetProfile = profileList.find(
    (p) => String(p.paymentProfileId) === args.paymentProfileId,
  );
  if (!targetProfile) {
    throwForStatus(
      404,
      `updateSubscriptionPayment: payment profile ${args.paymentProfileId} not found on this account.`,
    );
  }
  const paymentInstrumentUri =
    (targetProfile!.paymentInstrumentUri as string | null) ?? null;

  const items = subs.map(({ card, revision }) => ({
    subscriptionId: card.subscriptionId,
    isLegacy: card.isLegacy ?? false,
    paymentInstrumentUri,
    paymentProfileId: args.paymentProfileId,
    revision,
  }));

  // updatePayment returns the full launch payload (not a WriteResult).
  const resp = await gdFetch<LaunchResponse>(
    `${ACCOUNT_ORIGIN}/myrenewalsapi/v1/subscriptions/updatePayment`,
    {
      method: 'POST',
      body: JSON.stringify({ subscriptions: items }),
    },
  );

  const respCards = resp.components?.subscriptionList?.cards;
  if (!Array.isArray(respCards)) {
    throw new ContractDrift(
      'updateSubscriptionPayment: response missing components.subscriptionList.cards',
    );
  }
  const byId = new Map(respCards.map((c) => [c.subscriptionId as string, c]));

  const updated: Array<{ subscriptionId: string; paymentProfileId: string }> =
    [];
  for (const id of args.subscriptionIds) {
    const respCard = byId.get(id);
    if (!respCard) {
      throw new ContractDrift(
        `updateSubscriptionPayment: subscription ${id} missing from response cards`,
      );
    }
    const confirmedProfileId = respCard.paymentProfileId as string | null;
    if (confirmedProfileId !== args.paymentProfileId) {
      throw new UpstreamError(
        `updateSubscriptionPayment: subscription ${id} paymentProfileId was not updated (response shows ${confirmedProfileId ?? 'null'}, expected ${args.paymentProfileId})`,
      );
    }
    updated.push({ subscriptionId: id, paymentProfileId: confirmedProfileId });
  }

  return { updated };
}

// ============================================================================
// cancelSubscription  ⚠ destructive / billing-consequential
// ============================================================================

export async function cancelSubscription(args: {
  subscriptionIds: string[];
}): Promise<CancelSubscriptionOutput> {
  const subs = await withRevisions(args.subscriptionIds);
  const items = subs.map(({ card, revision }) => ({
    subscriptionId: card.subscriptionId,
    isATMP: card.isATMP ?? false,
    name: card.productName ?? card.title,
    isDomain: card.isDomainSubscription ?? false,
    revision,
    metadata: card.metadata,
  }));

  const resp = await gdFetch<WriteResult>(
    `${ACCOUNT_ORIGIN}/myrenewalsapi/v1/subscriptions/delete`,
    {
      method: 'POST',
      body: JSON.stringify({ subscriptions: items }),
    },
  );
  assertWriteOk(resp, 'cancelSubscription');

  return { cancelled: args.subscriptionIds };
}

// ============================================================================
// checkSubscriptionActions
// ============================================================================

export async function checkSubscriptionActions(args: {
  subscriptionIds: string[];
  autoRenew?: boolean;
}): Promise<CheckSubscriptionActionsOutput> {
  if (!args.subscriptionIds?.length) {
    throw new Validation(
      'checkSubscriptionActions requires at least one subscriptionId.',
    );
  }
  for (const id of args.subscriptionIds) {
    if (!id || !id.trim()) {
      throw new Validation(
        'checkSubscriptionActions: subscriptionIds must not contain empty or whitespace-only values.',
      );
    }
  }

  const items = args.subscriptionIds.map((id) => ({ subscriptionId: id }));

  const resp = await gdFetch<{ results?: unknown }>(
    `${ACCOUNT_ORIGIN}/myrenewalsapi/v1/subscriptions/actions/evaluate`,
    {
      method: 'POST',
      body: JSON.stringify({
        subscriptions: items,
        autoRenew: args.autoRenew ?? false,
      }),
    },
  );

  if (!Array.isArray(resp.results)) {
    throw new ContractDrift(
      `actions/evaluate returned an unrecognized shape: ${JSON.stringify(resp).slice(0, 300)}`,
    );
  }

  const evaluations = (resp.results as Array<Record<string, unknown>>).map(
    (entry) => ({
      ...entry,
      subscriptionId: String(entry.subscriptionId ?? ''),
    }),
  );

  return { evaluations } as CheckSubscriptionActionsOutput;
}
