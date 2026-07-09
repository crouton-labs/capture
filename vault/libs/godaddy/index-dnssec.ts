/**
 * GoDaddy — DNSSEC & DS records (domdns.api.godaddy.com).
 *
 * DNSSEC enable/disable is a PUT on the domain's `dnssec` resource; DS records
 * are CRUD'd on the customer-scoped `dsrecords` collection. All calls are
 * cookie-auth on the dedicated DNS host (DCC app key), so account-scoping comes
 * from getCustomerId() — no auth/customer params are threaded by the caller.
 */

import {
  dccFetch,
  getCustomerId,
  DOMDNS_API,
  Validation,
  PermissionDenied,
} from './_shared';
import type {
  DsRecord,
  GetDnssecOutput,
  EnableDnssecOutput,
  DisableDnssecOutput,
  ListDsRecordsOutput,
  CreateDsRecordOutput,
  UpdateDsRecordOutput,
  DeleteDsRecordOutput,
} from './schemas-dnssec';

export type {
  DsRecord,
  GetDnssecOutput,
  EnableDnssecOutput,
  DisableDnssecOutput,
  ListDsRecordsOutput,
  CreateDsRecordOutput,
  UpdateDsRecordOutput,
  DeleteDsRecordOutput,
} from './schemas-dnssec';

/** Pull the DS-record array out of whatever envelope the list endpoint returns. */
function asDsRecordArray(resp: unknown): DsRecord[] {
  if (Array.isArray(resp)) return resp as DsRecord[];
  if (resp && typeof resp === 'object') {
    const obj = resp as Record<string, unknown>;
    for (const key of [
      'dsRecords',
      'dsRecord',
      'records',
      'dnssecRecords',
      'items',
    ]) {
      if (Array.isArray(obj[key])) return obj[key] as DsRecord[];
    }
  }
  return [];
}

// ============================================================================
// getDnssec
// ============================================================================

export async function getDnssec(args: {
  domainName: string;
}): Promise<GetDnssecOutput> {
  if (!args.domainName) throw new Validation('getDnssec requires domainName.');
  const cid = getCustomerId();
  const url = `${DOMDNS_API}/v1/customers/${cid}/domains/${encodeURIComponent(args.domainName)}/dnssec`;
  let resp: Record<string, unknown>;
  try {
    resp = (await dccFetch<Record<string, unknown>>(url)) ?? {};
  } catch (err: unknown) {
    const name =
      err && typeof err === 'object' && 'name' in err
        ? (err as { name: string }).name
        : '';
    if (name === 'NotFound' || name === 'PermissionDenied') {
      throw new PermissionDenied(
        `getDnssec: "${args.domainName}" is not available — the domain must use GoDaddy's Managed DNS service (nameservers pointing to GoDaddy). Domains using external nameservers are not supported.`,
      );
    }
    throw err;
  }
  return { domainName: args.domainName, ...resp } as GetDnssecOutput;
}

// ============================================================================
// enableDnssec / disableDnssec
// ============================================================================

async function setDnssec(
  domainName: string,
  enabled: boolean,
  notifyEmail?: string,
): Promise<{ domainName: string; enabled: boolean }> {
  const cid = getCustomerId();
  const url = `${DOMDNS_API}/v1/customers/${cid}/domains/${encodeURIComponent(domainName)}/dnssec`;
  const body: Record<string, unknown> = { enabled };
  if (notifyEmail != null) body.notifyEmail = notifyEmail;
  await dccFetch<void>(url, { method: 'PUT', body: JSON.stringify(body) });
  return { domainName, enabled };
}

export async function enableDnssec(args: {
  domainName: string;
  notifyEmail?: string;
}): Promise<EnableDnssecOutput> {
  if (!args.domainName)
    throw new Validation('enableDnssec requires domainName.');
  return setDnssec(args.domainName, true, args.notifyEmail);
}

export async function disableDnssec(args: {
  domainName: string;
  notifyEmail?: string;
}): Promise<DisableDnssecOutput> {
  if (!args.domainName)
    throw new Validation('disableDnssec requires domainName.');
  return setDnssec(args.domainName, false, args.notifyEmail);
}

// ============================================================================
// listDsRecords
// ============================================================================

export async function listDsRecords(args: {
  domainName: string;
}): Promise<ListDsRecordsOutput> {
  if (!args.domainName)
    throw new Validation('listDsRecords requires domainName.');
  const cid = getCustomerId();
  const url = `${DOMDNS_API}/v1/customers/${cid}/domains/${encodeURIComponent(args.domainName)}/dsrecords`;
  let resp: unknown;
  try {
    resp = await dccFetch<unknown>(url);
  } catch (err: unknown) {
    const name =
      err && typeof err === 'object' && 'name' in err
        ? (err as { name: string }).name
        : '';
    if (name === 'NotFound' || name === 'PermissionDenied') {
      throw new PermissionDenied(
        `listDsRecords: "${args.domainName}" is not available — the domain must use GoDaddy's Managed DNS service (nameservers pointing to GoDaddy). Domains using external nameservers are not supported.`,
      );
    }
    throw err;
  }
  const dsRecords = asDsRecordArray(resp);
  return { dsRecords, total: dsRecords.length };
}

// ============================================================================
// createDsRecord
// ============================================================================

export async function createDsRecord(args: {
  domainName: string;
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
  maxSigLife?: number;
  flags?: number;
  protocol?: number;
  keyDataAlgorithm?: number;
  publicKey?: string;
}): Promise<CreateDsRecordOutput> {
  const {
    domainName,
    keyTag,
    algorithm,
    digestType,
    digest,
    maxSigLife,
    flags,
    protocol,
    keyDataAlgorithm,
    publicKey,
  } = args;
  if (!domainName) throw new Validation('createDsRecord requires domainName.');
  if (keyTag == null || algorithm == null || digestType == null || !digest) {
    throw new Validation(
      'createDsRecord requires keyTag, algorithm, digestType, and digest.',
    );
  }
  if (!Number.isInteger(keyTag) || keyTag < 0 || keyTag > 65535) {
    throw new Validation(
      'createDsRecord: keyTag must be an integer in the range 0–65535.',
    );
  }
  const SUPPORTED_ALGORITHMS = new Set([5, 7, 8, 10, 12, 13, 14, 15, 16]);
  if (!Number.isInteger(algorithm) || !SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new Validation(
      `createDsRecord: unsupported algorithm ${algorithm}. Supported values: 5 = RSA/SHA-1, 7 = RSASHA1-NSEC3-SHA1, 8 = RSA/SHA-256, 10 = RSA/SHA-512, 12 = ECC-GOST, 13 = ECDSA P-256/SHA-256, 14 = ECDSA P-384/SHA-384, 15 = Ed25519, 16 = Ed448.`,
    );
  }
  const SUPPORTED_DIGEST_TYPES = new Set([1, 2, 3, 4]);
  if (
    !Number.isInteger(digestType) ||
    !SUPPORTED_DIGEST_TYPES.has(digestType)
  ) {
    throw new Validation(
      `createDsRecord: unsupported digestType ${digestType}. Supported values: 1 = SHA-1, 2 = SHA-256, 3 = GOST R 34.11-94, 4 = SHA-384.`,
    );
  }
  const cid = getCustomerId();
  const url = `${DOMDNS_API}/v1/customers/${cid}/domains/${encodeURIComponent(domainName)}/dsrecords`;
  const body: Record<string, unknown> = {
    keyTag,
    algorithm,
    digestType,
    digest,
  };
  if (maxSigLife != null) body.maxSigLife = maxSigLife;
  if (flags != null) body.flags = flags;
  if (protocol != null) body.protocol = protocol;
  if (keyDataAlgorithm != null) body.keyDataAlgorithm = keyDataAlgorithm;
  if (publicKey != null) body.publicKey = publicKey;
  let resp: Record<string, unknown> | undefined;
  try {
    resp = await dccFetch<Record<string, unknown>>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (err: unknown) {
    const name =
      err && typeof err === 'object' && 'name' in err
        ? (err as { name: string }).name
        : '';
    if (name === 'NotFound' || name === 'PermissionDenied') {
      throw new PermissionDenied(
        `createDsRecord: "${domainName}" is not available — the domain must use GoDaddy's Managed DNS service (nameservers pointing to GoDaddy). Domains using external nameservers are not supported.`,
      );
    }
    throw err;
  }
  const dsRecord = { keyTag, algorithm, digestType, digest, ...(resp ?? {}) };
  return { dsRecord } as CreateDsRecordOutput;
}

// ============================================================================
// updateDsRecord
// ============================================================================

export async function updateDsRecord(args: {
  domainName: string;
  dsRecordId: string | number;
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
  maxSigLife?: number;
  flags?: number;
  protocol?: number;
  keyDataAlgorithm?: number;
  publicKey?: string;
}): Promise<UpdateDsRecordOutput> {
  const {
    domainName,
    dsRecordId,
    keyTag,
    algorithm,
    digestType,
    digest,
    maxSigLife,
    flags,
    protocol,
    keyDataAlgorithm,
    publicKey,
  } = args;
  if (!domainName) throw new Validation('updateDsRecord requires domainName.');
  if (dsRecordId == null || dsRecordId === '')
    throw new Validation('updateDsRecord requires dsRecordId.');
  if (keyTag == null || algorithm == null || digestType == null || !digest) {
    throw new Validation(
      'updateDsRecord replaces the full record — supply keyTag, algorithm, digestType, and digest.',
    );
  }
  const cid = getCustomerId();
  const url = `${DOMDNS_API}/v1/customers/${cid}/domains/${encodeURIComponent(domainName)}/dsrecords/${encodeURIComponent(String(dsRecordId))}`;
  const body: Record<string, unknown> = {
    keyTag,
    algorithm,
    digestType,
    digest,
  };
  if (maxSigLife != null) body.maxSigLife = maxSigLife;
  if (flags != null) body.flags = flags;
  if (protocol != null) body.protocol = protocol;
  if (keyDataAlgorithm != null) body.keyDataAlgorithm = keyDataAlgorithm;
  if (publicKey != null) body.publicKey = publicKey;
  let resp: Record<string, unknown> | undefined;
  try {
    resp = await dccFetch<Record<string, unknown>>(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  } catch (err: unknown) {
    const name =
      err && typeof err === 'object' && 'name' in err
        ? (err as { name: string }).name
        : '';
    if (name === 'NotFound' || name === 'PermissionDenied') {
      throw new PermissionDenied(
        `updateDsRecord: "${domainName}" is not available — the domain must use GoDaddy's Managed DNS service (nameservers pointing to GoDaddy). Domains using external nameservers are not supported.`,
      );
    }
    throw err;
  }
  const dsRecord = {
    dsRecordId,
    keyTag,
    algorithm,
    digestType,
    digest,
    ...(resp ?? {}),
  };
  return { dsRecord } as UpdateDsRecordOutput;
}

// ============================================================================
// deleteDsRecord
// ============================================================================

export async function deleteDsRecord(args: {
  domainName: string;
  dsRecordId: string | number;
}): Promise<DeleteDsRecordOutput> {
  if (!args.domainName)
    throw new Validation('deleteDsRecord requires domainName.');
  if (args.dsRecordId == null || args.dsRecordId === '')
    throw new Validation('deleteDsRecord requires dsRecordId.');
  const cid = getCustomerId();
  const url = `${DOMDNS_API}/v1/customers/${cid}/domains/${encodeURIComponent(String(args.domainName))}/dsrecords/${encodeURIComponent(String(args.dsRecordId))}`;
  try {
    await dccFetch<void>(url, { method: 'DELETE' });
  } catch (err: unknown) {
    const name =
      err && typeof err === 'object' && 'name' in err
        ? (err as { name: string }).name
        : '';
    if (name === 'NotFound' || name === 'PermissionDenied') {
      throw new PermissionDenied(
        `deleteDsRecord: "${args.domainName}" is not available — the domain must use GoDaddy's Managed DNS service (nameservers pointing to GoDaddy). Domains using external nameservers are not supported.`,
      );
    }
    throw err;
  }
  return { dsRecordId: args.dsRecordId, deleted: true };
}
