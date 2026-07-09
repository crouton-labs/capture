/**
 * GoDaddy — vanity hosts (glue records) and secondary DNS.
 *
 * All operations target the DNS host (domdns.api.godaddy.com) under the
 * signed-in customer scope. Context (customerId) is read internally; callers
 * pass only the domain and the host/config data.
 */

import {
  dccFetch,
  getCustomerId,
  DOMDNS_API,
  Validation,
  NotFound,
} from './_shared';
import type {
  VanityHost,
  SecondaryDnsConfig,
  ListVanityHostsOutput,
  CreateVanityHostOutput,
  UpdateVanityHostOutput,
  DeleteVanityHostOutput,
  GetSecondaryDnsOutput,
  UpdateSecondaryDnsOutput,
} from './schemas-nameservers-vanity';

export type {
  VanityHost,
  SecondaryDnsConfig,
  ListVanityHostsOutput,
  CreateVanityHostOutput,
  UpdateVanityHostOutput,
  DeleteVanityHostOutput,
  GetSecondaryDnsOutput,
  UpdateSecondaryDnsOutput,
} from './schemas-nameservers-vanity';

function hostsBase(domainName: string): string {
  const cid = getCustomerId();
  return `${DOMDNS_API}/v1/customers/${cid}/domains/${encodeURIComponent(domainName)}`;
}

/** Normalize a raw host record to the canonical VanityHost shape. */
function normalizeHost(raw: Record<string, unknown>): VanityHost {
  const ips = (raw.ipAddresses ?? raw.hostIps ?? raw.ips ?? []) as unknown;
  return {
    ...raw,
    hostName: String(raw.hostName ?? raw.host ?? raw.name ?? ''),
    ipAddresses: Array.isArray(ips) ? ips.map(String) : [],
  } as VanityHost;
}

/** Extract the host array from the list response (bare array or wrapped). */
function extractHosts(body: unknown): VanityHost[] {
  let list: unknown = body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    list = obj.hostNames ?? obj.hosts ?? obj.hostList ?? [];
  }
  if (!Array.isArray(list)) return [];
  return list.map((h) => normalizeHost(h as Record<string, unknown>));
}

// ============================================================================
// listVanityHosts
// ============================================================================

export async function listVanityHosts(args: {
  domainName: string;
}): Promise<ListVanityHostsOutput> {
  const domainName = (args.domainName ?? '').trim();
  if (!domainName) throw new Validation('listVanityHosts requires domainName.');

  const body = await dccFetch<unknown>(`${hostsBase(domainName)}/hosts`);
  const hosts = extractHosts(body);
  return { hosts, total: hosts.length };
}

// ============================================================================
// createVanityHost
// ============================================================================

export async function createVanityHost(args: {
  domainName: string;
  hostName: string;
  ips: string[];
}): Promise<CreateVanityHostOutput> {
  const domainName = (args.domainName ?? '').trim();
  const hostName = (args.hostName ?? '').trim();
  if (!domainName)
    throw new Validation('createVanityHost requires domainName.');
  if (!hostName) throw new Validation('createVanityHost requires hostName.');
  if (!args.ips?.length)
    throw new Validation(
      'createVanityHost requires at least one IP address in ips.',
    );
  if (!hostName.toLowerCase().endsWith(`.${domainName.toLowerCase()}`)) {
    throw new Validation(
      `createVanityHost: hostName must be a subdomain of domainName (e.g. "ns1.${domainName}"). Got "${hostName}" for domain "${domainName}".`,
    );
  }

  const resp = await dccFetch<unknown>(`${hostsBase(domainName)}/hosts`, {
    method: 'POST',
    body: JSON.stringify({ host: hostName, hostIps: args.ips }),
  });

  const host =
    resp && typeof resp === 'object'
      ? normalizeHost(resp as Record<string, unknown>)
      : ({ hostName, ipAddresses: args.ips } as VanityHost);
  return { host };
}

// ============================================================================
// updateVanityHost
// ============================================================================

export async function updateVanityHost(args: {
  domainName: string;
  hostName: string;
  ips: string[];
  dryRun?: boolean;
}): Promise<UpdateVanityHostOutput> {
  const domainName = (args.domainName ?? '').trim();
  const hostName = (args.hostName ?? '').trim();
  if (!domainName)
    throw new Validation('updateVanityHost requires domainName.');
  if (!hostName) throw new Validation('updateVanityHost requires hostName.');
  if (!args.ips?.length)
    throw new Validation(
      'updateVanityHost requires at least one IP address in ips.',
    );

  const dryRun = Boolean(args.dryRun);
  const qs = dryRun ? '?dryRun=true' : '';
  const resp = await dccFetch<unknown>(
    `${hostsBase(domainName)}/hosts/${encodeURIComponent(hostName)}${qs}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ host: hostName, hostIps: args.ips }),
    },
  );

  const host =
    resp && typeof resp === 'object'
      ? normalizeHost(resp as Record<string, unknown>)
      : ({ hostName, ipAddresses: args.ips } as VanityHost);
  return { host, dryRun };
}

// ============================================================================
// deleteVanityHost
// ============================================================================

export async function deleteVanityHost(args: {
  domainName: string;
  hostName: string;
  dryRun?: boolean;
}): Promise<DeleteVanityHostOutput> {
  const domainName = (args.domainName ?? '').trim();
  const hostName = (args.hostName ?? '').trim();
  if (!domainName)
    throw new Validation('deleteVanityHost requires domainName.');
  if (!hostName) throw new Validation('deleteVanityHost requires hostName.');

  const dryRun = Boolean(args.dryRun);
  const qs = dryRun ? '?dryRun=true' : '';
  await dccFetch<unknown>(
    `${hostsBase(domainName)}/hosts/${encodeURIComponent(hostName)}${qs}`,
    {
      method: 'DELETE',
    },
  );
  return { deleted: true, hostName, dryRun };
}

// ============================================================================
// getSecondaryDns
// ============================================================================

export async function getSecondaryDns(args: {
  domainName: string;
}): Promise<GetSecondaryDnsOutput> {
  const domainName = (args.domainName ?? '').trim();
  if (!domainName) throw new Validation('getSecondaryDns requires domainName.');

  let resp: Record<string, unknown> | undefined;
  try {
    resp = await dccFetch<Record<string, unknown> | undefined>(
      `${hostsBase(domainName)}/secondarydns`,
    );
  } catch (e) {
    if ((e as NotFound)?.name === 'NotFound') {
      return { configured: false, config: null };
    }
    throw e;
  }
  const config =
    resp && typeof resp === 'object' && Object.keys(resp).length > 0
      ? (resp as SecondaryDnsConfig)
      : null;
  return { configured: config != null, config };
}

// ============================================================================
// updateSecondaryDns
// ============================================================================

export async function updateSecondaryDns(args: {
  domainName: string;
  masterIp: string;
  [key: string]: unknown;
}): Promise<UpdateSecondaryDnsOutput> {
  const domainName = String(args.domainName ?? '').trim();
  const masterIp = String(args.masterIp ?? '').trim();
  if (!domainName)
    throw new Validation('updateSecondaryDns requires domainName.');
  if (!masterIp) throw new Validation('updateSecondaryDns requires masterIp.');

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k !== 'domainName') payload[k] = v;
  }

  const resp = await dccFetch<Record<string, unknown> | undefined>(
    `${hostsBase(domainName)}/secondarydns`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  );

  const config =
    resp && typeof resp === 'object' && Object.keys(resp).length > 0
      ? (resp as SecondaryDnsConfig)
      : (payload as SecondaryDnsConfig);
  return { configured: true, config };
}
