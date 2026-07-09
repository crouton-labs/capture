/**
 * GoDaddy — domain transfers (registrar transfers in/out + change-of-account).
 *
 * Two flavors, both on domainsapi.godaddy.com (coaApi group, cookie + x-app-key):
 *   - Registrar transfers: in/out of GoDaddy, keyed by a transfer `jobID`.
 *   - Change-of-account (COA): pushing domains between GoDaddy accounts, keyed by a `guid`.
 */

import {
  dccFetch,
  getCustomerId,
  getPlid,
  COA_API,
  DEFAULT_APP_KEY,
  Validation,
  ContractDrift,
  UpstreamError,
  throwForStatus,
  uuid,
} from './_shared';
import type {
  TransferSummary,
  TransferDomain,
  ListIncomingTransfersOutput,
  GetTransferStatusOutput,
  CheckTransferEligibilityOutput,
  StartDomainTransferInOutput,
  PrepareDomainForTransferOutOutput,
  TransferDomainToAccountOutput,
  AcceptDomainTransferOutput,
  CancelDomainTransferOutput,
} from './schemas-transfers';

export type {
  TransferSummary,
  TransferDomain,
  TransferEligibility,
  ListIncomingTransfersOutput,
  GetTransferStatusOutput,
  CheckTransferEligibilityOutput,
  StartDomainTransferInOutput,
  PrepareDomainForTransferOutOutput,
  TransferDomainToAccountOutput,
  AcceptDomainTransferOutput,
  CancelDomainTransferOutput,
} from './schemas-transfers';

type RawRecord = Record<string, unknown>;

/** Null-safe extraction of an array from either a bare array body or `body[key]`. */
function arrayFrom(body: unknown, key: string): RawRecord[] {
  if (Array.isArray(body)) return body as RawRecord[];
  if (body && typeof body === 'object') {
    const v = (body as RawRecord)[key];
    if (Array.isArray(v)) return v as RawRecord[];
  }
  return [];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function dryRunQuery(dryRun?: boolean): string {
  return dryRun ? '?dryRun=true' : '';
}

// ============================================================================
// listIncomingTransfers
// ============================================================================

export async function listIncomingTransfers(): Promise<ListIncomingTransfersOutput> {
  const cid = getCustomerId();
  const body = await dccFetch<unknown>(
    `${COA_API}/v1/customers/${cid}/transfers/incoming/summary`,
  );
  const transfers = arrayFrom(
    body,
    'transfers',
  ) as unknown as TransferSummary[];
  return { transfers, total: transfers.length };
}

// ============================================================================
// getTransferStatus
// ============================================================================

export async function getTransferStatus(
  args: { jobID?: string; domainName?: string; domainNames?: string[] } = {},
): Promise<GetTransferStatusOutput> {
  if (!args.jobID && !args.domainName && !args.domainNames?.length) {
    throw new Validation(
      'getTransferStatus requires at least one of jobID, domainName, or domainNames.',
    );
  }

  const cid = getCustomerId();
  const reqBody: RawRecord = {};
  if (args.jobID) reqBody.jobID = args.jobID;
  const names = args.domainNames?.length
    ? args.domainNames
    : args.domainName
      ? [args.domainName]
      : undefined;
  if (names) reqBody.domainNames = names;

  const body = await dccFetch<unknown>(
    `${COA_API}/v1/customers/${cid}/transfers/domains`,
    {
      method: 'POST',
      body: JSON.stringify(reqBody),
    },
  );

  const domains = arrayFrom(body, 'domains') as unknown as TransferDomain[];
  return { domains, total: domains.length };
}

// ============================================================================
// checkTransferEligibility
// ============================================================================

interface EligibilityAvailableDomain {
  domainName?: string;
  displayName?: string;
  currencyID?: string;
  transferInListPrice?: number;
  transferInSalePrice?: number;
  transferInPfid?: string;
  transferInTerm?: number;
  transferInTermUnit?: string;
  extendListPrice?: number;
  extendSalePrice?: number;
  extendTerm?: number;
  extendTermUnit?: string;
}

interface EligibilityUnavailableDomain {
  domainName?: string;
  displayName?: string;
  reason?: string;
}

interface EligibilityDomainsResp {
  availableDomains?: EligibilityAvailableDomain[] | null;
  unavailableDomains?: EligibilityUnavailableDomain[] | null;
  blockedDomains?: EligibilityUnavailableDomain[] | null;
}

interface EligibilitySummary {
  EligibleCount?: number;
  UnavailableCount?: number;
  BlockedCount?: number;
  TotalTransferFee?: number;
  TotalTransferSalePrice?: number;
  TotalExtensionFee?: number;
  TotalExtensionSalePrice?: number;
}

export async function checkTransferEligibility(args: {
  domainNames: string[];
  authCodes?: Record<string, string>;
}): Promise<CheckTransferEligibilityOutput> {
  if (!args.domainNames?.length) {
    throw new Validation(
      'checkTransferEligibility requires at least one domainName.',
    );
  }

  const plid = getPlid() ?? '1';
  const domainWithAuthCodes = args.domainNames.map((domain) => ({
    domainName: domain,
    authCode: args.authCodes?.[domain] ?? null,
  }));

  // POST initiates an async eligibility check; response is SSE that emits the jobId.
  const res = await fetch(
    `${COA_API}/v1/transfers/incoming/eligibility?privateLabelId=${plid}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'x-app-key': DEFAULT_APP_KEY,
        'X-Request-Id': uuid(),
      },
      body: JSON.stringify({ domainWithAuthCodes }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throwForStatus(
      res.status,
      `GoDaddy eligibility API ${res.status}: ${body.slice(0, 500)}`,
    );
  }

  // Read SSE stream until COMPLETE, extract jobId.
  const reader = res.body!.getReader();
  let jobId: string | undefined;
  let lastStatus: string | undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      for (const line of text.split('\n\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6)) as {
            id?: string;
            status?: string;
          };
          if (ev.id) jobId = ev.id;
          if (ev.status) lastStatus = ev.status;
        } catch {
          /* skip malformed SSE events */
        }
      }
      if (lastStatus === 'COMPLETE') break;
    }
  } finally {
    reader.cancel();
  }

  if (!jobId) {
    throw new ContractDrift(
      'GoDaddy eligibility check did not return a job id via SSE.',
    );
  }

  const base = `${COA_API}/v1/transfers/incoming/eligibility`;
  const [summary, availableResp, unavailableResp, blockedResp] =
    await Promise.all([
      dccFetch<EligibilitySummary>(`${base}/summary/${jobId}`),
      dccFetch<EligibilityDomainsResp>(
        `${base}/${jobId}/domains/AVAILABLE?index=0&maxRecords=500`,
      ),
      dccFetch<EligibilityDomainsResp>(
        `${base}/${jobId}/domains/UNAVAILABLE?index=0&maxRecords=500`,
      ),
      dccFetch<EligibilityDomainsResp>(
        `${base}/${jobId}/domains/BLOCKED?index=0&maxRecords=500`,
      ),
    ]);

  const available = (availableResp.availableDomains ?? []).map((d) => ({
    domainName: d.domainName ?? d.displayName ?? '',
    eligible: true as const,
    status: 'AVAILABLE' as const,
    currency: d.currencyID,
    price: d.transferInSalePrice,
    transferInListPrice: d.transferInListPrice,
    transferInSalePrice: d.transferInSalePrice,
    transferInPfid: d.transferInPfid,
    transferInTerm: d.transferInTerm,
    transferInTermUnit: d.transferInTermUnit,
    extendListPrice: d.extendListPrice,
    extendSalePrice: d.extendSalePrice,
    extendTerm: d.extendTerm,
    extendTermUnit: d.extendTermUnit,
  }));

  const unavailable = (unavailableResp.unavailableDomains ?? []).map((d) => ({
    domainName: d.domainName ?? d.displayName ?? '',
    eligible: false as const,
    status: 'UNAVAILABLE' as const,
    reason: d.reason,
  }));

  const blocked = (blockedResp.blockedDomains ?? []).map((d) => ({
    domainName: d.domainName ?? d.displayName ?? '',
    eligible: false as const,
    status: 'BLOCKED' as const,
    reason: d.reason,
  }));

  const domains = [
    ...available,
    ...unavailable,
    ...blocked,
  ] as CheckTransferEligibilityOutput['domains'];

  return {
    domains,
    total: domains.length,
    eligibleCount: summary.EligibleCount ?? 0,
    unavailableCount: summary.UnavailableCount ?? 0,
    blockedCount: summary.BlockedCount ?? 0,
    totalTransferFee: summary.TotalTransferFee ?? 0,
    totalTransferSalePrice: summary.TotalTransferSalePrice ?? 0,
    totalExtensionFee: summary.TotalExtensionFee ?? 0,
    totalExtensionSalePrice: summary.TotalExtensionSalePrice ?? 0,
  };
}

// ============================================================================
// startDomainTransferIn  (⚠ billing — incurs a charge; never run real)
// ============================================================================

export async function startDomainTransferIn(args: {
  domains: Array<{ domainName: string; authCode: string }>;
  dryRun?: boolean;
}): Promise<StartDomainTransferInOutput> {
  if (!args.domains?.length) {
    throw new Validation('startDomainTransferIn requires at least one domain.');
  }
  for (const d of args.domains) {
    if (!d?.domainName || !d?.authCode) {
      throw new Validation(
        'startDomainTransferIn requires a domainName and authCode for every domain.',
      );
    }
  }

  const dryRun = args.dryRun ?? false;
  const plid = getPlid() ?? '1';
  const cid = getCustomerId();

  // Step 1: Eligibility SSE check — creates a jobId for this batch.
  const eligRes = await fetch(
    `${COA_API}/v1/transfers/incoming/eligibility?privateLabelId=${plid}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'x-app-key': DEFAULT_APP_KEY,
        'X-Request-Id': uuid(),
      },
      body: JSON.stringify({
        domainWithAuthCodes: args.domains.map((d) => ({
          domainName: d.domainName,
          authCode: d.authCode,
        })),
      }),
    },
  );

  if (!eligRes.ok) {
    const errBody = await eligRes.text().catch(() => '');
    throwForStatus(
      eligRes.status,
      `GoDaddy eligibility API ${eligRes.status} (startDomainTransferIn): ${errBody.slice(0, 500)}`,
    );
  }

  const eligReader = eligRes.body!.getReader();
  let jobId: string | undefined;
  let eligStatus: string | undefined;
  try {
    for (;;) {
      const { done, value } = await eligReader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      for (const line of text.split('\n\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6)) as {
            id?: string;
            status?: string;
          };
          if (ev.id) jobId = ev.id;
          if (ev.status) eligStatus = ev.status;
        } catch {
          /* skip malformed SSE events */
        }
      }
      if (eligStatus === 'COMPLETE') break;
    }
  } finally {
    eligReader.cancel();
  }

  if (!jobId) {
    throw new ContractDrift(
      'startDomainTransferIn: eligibility check did not return a job id via SSE.',
    );
  }

  // Step 2: Fetch per-domain eligibility results.
  interface EligDomain {
    domainName?: string;
    displayName?: string;
    reason?: string;
  }
  const [availResp, unavailResp, blockedResp] = await Promise.all([
    dccFetch<{ availableDomains?: EligDomain[] | null }>(
      `${COA_API}/v1/transfers/incoming/eligibility/${jobId}/domains/AVAILABLE?index=0&maxRecords=500`,
    ),
    dccFetch<{ unavailableDomains?: EligDomain[] | null }>(
      `${COA_API}/v1/transfers/incoming/eligibility/${jobId}/domains/UNAVAILABLE?index=0&maxRecords=500`,
    ),
    dccFetch<{ blockedDomains?: EligDomain[] | null }>(
      `${COA_API}/v1/transfers/incoming/eligibility/${jobId}/domains/BLOCKED?index=0&maxRecords=500`,
    ),
  ]);

  const domains: TransferDomain[] = [
    ...(availResp.availableDomains ?? []).map((d) => ({
      domainName: d.domainName ?? d.displayName,
      displayName: d.displayName,
      jobID: jobId,
      status: 'AVAILABLE',
    })),
    ...(unavailResp.unavailableDomains ?? []).map((d) => ({
      domainName: d.domainName ?? d.displayName,
      displayName: d.displayName,
      jobID: jobId,
      status: 'UNAVAILABLE',
      reason: d.reason,
    })),
    ...(blockedResp.blockedDomains ?? []).map((d) => ({
      domainName: d.domainName ?? d.displayName,
      displayName: d.displayName,
      jobID: jobId,
      status: 'BLOCKED',
      reason: d.reason,
    })),
  ];

  // Step 3: If not dryRun, submit the transfer batch to the cart (places the order).
  if (!dryRun) {
    const cartRes = await fetch(
      `${COA_API}/v1/customers/${cid}/transfers/incoming/${jobId}/cart`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          'x-app-key': DEFAULT_APP_KEY,
          'X-Request-Id': uuid(),
        },
        body: JSON.stringify([]),
      },
    );

    if (!cartRes.ok) {
      const errBody = await cartRes.text().catch(() => '');
      throwForStatus(
        cartRes.status,
        `GoDaddy transfer cart API ${cartRes.status} (startDomainTransferIn): ${errBody.slice(0, 500)}`,
      );
    }

    const cartReader = cartRes.body!.getReader();
    let cartStatus: string | undefined;
    const cartErrors: Array<{ code?: string; message?: string }> = [];
    try {
      for (;;) {
        const { done, value } = await cartReader.read();
        if (done) break;
        const text = new TextDecoder().decode(value);
        for (const line of text.split('\n\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as {
              status?: string;
              errors?: Array<{ code?: string; message?: string }>;
            };
            if (ev.status) cartStatus = ev.status;
            if (ev.errors?.length) cartErrors.push(...ev.errors);
          } catch {
            /* skip malformed SSE events */
          }
        }
        if (cartStatus === 'COMPLETE') break;
      }
    } finally {
      cartReader.cancel();
    }

    if (cartErrors.length) {
      throw new UpstreamError(
        `startDomainTransferIn: cart submission failed: ${JSON.stringify(cartErrors).slice(0, 300)}`,
      );
    }
  }

  return { jobID: jobId, domains, dryRun };
}

// ============================================================================
// prepareDomainForTransferOut  (dryRun)
// ============================================================================

export async function prepareDomainForTransferOut(args: {
  domainName: string;
  dryRun?: boolean;
}): Promise<PrepareDomainForTransferOutOutput> {
  if (!args.domainName) {
    throw new Validation('prepareDomainForTransferOut requires domainName.');
  }

  const cid = getCustomerId();
  const dryRun = args.dryRun ?? false;
  const body = await dccFetch<RawRecord | undefined>(
    `${COA_API}/v1/customers/${cid}/domains/${encodeURIComponent(args.domainName)}/prepareForTransferOut${dryRunQuery(dryRun)}`,
    { method: 'POST' },
  );

  const authCode =
    asString(body?.authCode) ??
    asString(body?.authInfo) ??
    asString(body?.eppCode) ??
    asString(body?.password);
  const status = asString(body?.status);
  return { domainName: args.domainName, authCode, status, dryRun };
}

// ============================================================================
// transferDomainToAccount  (COA push; dryRun)
// ============================================================================

export async function transferDomainToAccount(args: {
  domainNames: string[];
  recipient: string;
  recipientShopperId?: string;
  allowCurrentContacts?: boolean;
  isCancellable?: boolean;
  migrateDNS?: boolean;
  dryRun?: boolean;
}): Promise<TransferDomainToAccountOutput> {
  if (!args.domainNames?.length) {
    throw new Validation(
      'transferDomainToAccount requires at least one domainName.',
    );
  }
  if (!args.recipient) {
    throw new Validation(
      'transferDomainToAccount requires a recipient account email.',
    );
  }

  const cid = getCustomerId();
  const dryRun = args.dryRun ?? false;

  const payload: RawRecord = {
    gainingShopperEmail: args.recipient,
    allowCurrentContacts: args.allowCurrentContacts ?? false,
    isCancellable: args.isCancellable ?? true,
    migrateDNS: args.migrateDNS ?? true,
    filter: {
      domainNamesFilter: {
        names: args.domainNames,
        type: 'INCLUDE',
      },
    },
  };
  if (args.recipientShopperId != null)
    payload.gainingShopperId = args.recipientShopperId;

  const body = await dccFetch<RawRecord | undefined>(
    `${COA_API}/v2/customers/${cid}/accountChanges/initiate${dryRunQuery(dryRun)}`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  const guid = asString(body?.guid) ?? asString(body?.accountChangeId);
  return { guid, domains: args.domainNames, dryRun };
}

// ============================================================================
// acceptDomainTransfer
// ============================================================================

export async function acceptDomainTransfer(args: {
  codes?: Array<{ authorizationCode: string; domainName: string }>;
  guid?: string;
}): Promise<AcceptDomainTransferOutput> {
  const hasCodes = args.codes != null && args.codes.length > 0;
  const hasGuid = !!args.guid;

  if (hasCodes) {
    if (hasGuid) {
      throw new Validation(
        'acceptDomainTransfer: provide codes for a registrar transfer OR guid for a change-of-account transfer, not both.',
      );
    }
    const cid = getCustomerId();
    await dccFetch<unknown>(
      `${COA_API}/v1/customers/${cid}/transfers/incoming/accept`,
      {
        method: 'POST',
        body: JSON.stringify({ codes: args.codes }),
      },
    );
    return { accepted: true };
  }

  if (!hasGuid) {
    throw new Validation(
      'acceptDomainTransfer requires codes (array of { authorizationCode, domainName } pairs) for a registrar transfer, or guid for a change-of-account transfer.',
    );
  }

  const cid = getCustomerId();
  await dccFetch<unknown>(
    `${COA_API}/v1/customers/${cid}/accountChanges/${encodeURIComponent(args.guid!)}`,
    { method: 'PATCH', body: JSON.stringify({ accept: true }) },
  );
  return { accepted: true, guid: args.guid };
}

// ============================================================================
// cancelDomainTransfer
// ============================================================================

export async function cancelDomainTransfer(args: {
  transferKind: 'registrar' | 'ownership';
  direction: 'incoming' | 'outgoing';
  domainNames?: string[];
  selectionType?: 'INCLUDE' | 'EXCLUDE';
  statuses?: number[];
}): Promise<CancelDomainTransferOutput> {
  if (args.direction !== 'incoming' && args.direction !== 'outgoing') {
    throw new Validation(
      'cancelDomainTransfer requires direction "incoming" or "outgoing".',
    );
  }
  if (args.transferKind !== 'registrar' && args.transferKind !== 'ownership') {
    throw new Validation(
      'cancelDomainTransfer requires transferKind "registrar" or "ownership".',
    );
  }

  const cid = getCustomerId();
  const domainNamesFilter = args.domainNames?.length
    ? { names: args.domainNames, type: args.selectionType ?? 'INCLUDE' }
    : undefined;

  async function cancelFetch(url: string, body: string): Promise<boolean> {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'x-app-key': DEFAULT_APP_KEY,
        'X-Request-Id': uuid(),
      },
      body,
    });
    if (res.status === 422) {
      // No active transfers matching the filter — nothing to cancel.
      return false;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throwForStatus(
        res.status,
        `cancelDomainTransfer ${res.status} (${url}): ${text.slice(0, 500)}`,
      );
    }
    return true;
  }

  if (args.transferKind === 'registrar') {
    const payload: RawRecord = {};
    if (domainNamesFilter) payload.domainNamesFilter = domainNamesFilter;
    if (args.statuses?.length) payload.statuses = args.statuses;
    const cancelled = await cancelFetch(
      `${COA_API}/v1/customers/${cid}/transfers/${args.direction}/cancel`,
      JSON.stringify(payload),
    );
    return { cancelled, direction: args.direction, transferKind: 'registrar' };
  }

  const coaPayload: RawRecord = {};
  if (domainNamesFilter) coaPayload.domainNamesFilter = domainNamesFilter;
  const cancelled = await cancelFetch(
    `${COA_API}/v2/customers/${cid}/ownershipChanges/${args.direction}/cancel`,
    JSON.stringify(coaPayload),
  );
  return { cancelled, direction: args.direction, transferKind: 'ownership' };
}
