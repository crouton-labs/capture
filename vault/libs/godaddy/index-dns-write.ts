/**
 * GoDaddy DNS write operations — domdns.api.godaddy.com.
 *
 * Create / update / delete DNS records in a domain's managed zone, plus
 * adding and cancelling GoDaddy DNS hosting. Every record write supports
 * dryRun (?dryRun=true) so a change can be validated before it commits.
 */

import {
  dccFetch,
  getCustomerId,
  paginatePage,
  DOMDNS_API,
  Validation,
} from './_shared';
import type {
  DnsRecordInput,
  DnsRecordKey,
  CreateDnsRecordOutput,
  CreateDnsRecordsOutput,
  UpdateDnsRecordOutput,
  UpdateDnsRecordsOutput,
  DeleteDnsRecordOutput,
  DeleteDnsRecordsOutput,
  AddDnsHostingOutput,
  CancelDnsHostingOutput,
} from './schemas-dns-write';

export type {
  DnsRecordInput,
  DnsRecordKey,
  CreateDnsRecordOutput,
  CreateDnsRecordsOutput,
  UpdateDnsRecordOutput,
  UpdateDnsRecordsOutput,
  DeleteDnsRecordOutput,
  DeleteDnsRecordsOutput,
  AddDnsHostingOutput,
  CancelDnsHostingOutput,
} from './schemas-dns-write';

const RECORD_TYPES = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'NS',
  'SOA',
  'SRV',
  'TXT',
  'CAA',
  'HTTPS',
  'TLSA',
  'SVCB',
];

const RECORD_FIELDS = [
  'data',
  'ttl',
  'priority',
  'service',
  'protocol',
  'weight',
  'port',
  'flags',
  'tag',
  'parameters',
  'certificate_data',
  'matching_type',
  'selector',
  'guid',
  'mbox',
  'ns',
  'serial',
  'refresh',
  'retry',
  'expire',
  'minimum',
] as const;

function normalizeType(type: string | undefined): string {
  if (!type) throw new Validation('DNS record requires a type.');
  const upper = type.toUpperCase();
  if (!RECORD_TYPES.includes(upper)) {
    throw new Validation(
      `Unsupported DNS record type "${type}". Valid types: ${RECORD_TYPES.join(', ')}.`,
    );
  }
  return upper;
}

/** Serialize an agent-facing record to the domdns.api wire shape (rtype + fields). */
function toWireRecord(record: DnsRecordInput): Record<string, unknown> {
  const type = normalizeType(record.type);
  if (!record.name) {
    throw new Validation(
      `DNS ${type} record requires a name (use "@" for the zone apex).`,
    );
  }
  const wire: Record<string, unknown> = {
    rtype: type.toLowerCase(),
    name: record.name,
  };
  for (const field of RECORD_FIELDS) {
    const value = (record as Record<string, unknown>)[field];
    if (value !== undefined) wire[field] = value;
  }
  return wire;
}

function zoneRecordsUrl(
  domainName: string,
  dryRun: boolean | undefined,
): string {
  const cid = getCustomerId();
  return `${DOMDNS_API}/v1/customers/${cid}/zones/${encodeURIComponent(domainName)}/records?dryRun=${dryRun ? 'true' : 'false'}`;
}

function zoneRecordsEachUrl(
  domainName: string,
  dryRun: boolean | undefined,
): string {
  const cid = getCustomerId();
  return `${DOMDNS_API}/v1/customers/${cid}/zones/${encodeURIComponent(domainName)}/records/$each?dryRun=${dryRun ? 'true' : 'false'}`;
}

/** Single-record PATCH: create or update one DNS record. Body must be a single object (not array). */
async function patchRecord(
  domainName: string,
  record: DnsRecordInput,
  dryRun: boolean | undefined,
): Promise<CreateDnsRecordsOutput> {
  if (!domainName) throw new Validation('domainName is required.');
  const wire = toWireRecord(record);
  await dccFetch(zoneRecordsUrl(domainName, dryRun), {
    method: 'PATCH',
    body: JSON.stringify(wire),
  });
  return { domainName, dryRun: Boolean(dryRun), recordCount: 1 };
}

/** Bulk PATCH via $each: add and/or update multiple records in one call. */
async function patchRecordsBulk(
  domainName: string,
  addRecords: DnsRecordInput[],
  updateRecords: DnsRecordInput[],
  dryRun: boolean | undefined,
): Promise<CreateDnsRecordsOutput> {
  if (!domainName) throw new Validation('domainName is required.');
  const count = addRecords.length + updateRecords.length;
  if (count === 0) throw new Validation('At least one record is required.');
  const body = {
    add: addRecords.map(toWireRecord),
    update: updateRecords.map(toWireRecord),
    delete: [] as string[],
  };
  await dccFetch(zoneRecordsEachUrl(domainName, dryRun), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return { domainName, dryRun: Boolean(dryRun), recordCount: count };
}

interface ZoneRecordRaw {
  rtype?: string;
  name?: string;
  guid?: string;
  [key: string]: unknown;
}

interface ZoneResponse {
  records?: ZoneRecordRaw[];
  [key: string]: unknown;
}

/** Resolve record GUIDs by fetching the zone and matching type+name, then DELETE by GUID array. */
async function removeRecords(
  domainName: string,
  keys: DnsRecordKey[],
  dryRun: boolean | undefined,
): Promise<DeleteDnsRecordsOutput> {
  if (!domainName) throw new Validation('domainName is required.');
  if (!keys.length) throw new Validation('At least one record is required.');

  const cid = getCustomerId();
  const allRecords = await paginatePage<ZoneRecordRaw>(
    async (pageNumber, pageSize) => {
      const url = `${DOMDNS_API}/v1/customers/${cid}/zones/${encodeURIComponent(domainName)}?pageSize=${pageSize}&pageNumber=${pageNumber}`;
      const data = await dccFetch<ZoneRecordRaw[] | ZoneResponse>(url);
      return Array.isArray(data)
        ? data
        : ((data as ZoneResponse).records ?? []);
    },
    undefined,
    100,
  );

  const guids: string[] = [];
  for (const key of keys) {
    const rtype = normalizeType(key.type).toLowerCase();
    const matching = allRecords.filter(
      (r) => r.rtype === rtype && r.name === key.name && r.guid,
    );
    for (const r of matching) guids.push(r.guid as string);
  }

  if (!guids.length)
    return { domainName, dryRun: Boolean(dryRun), recordCount: 0 };

  await dccFetch(zoneRecordsUrl(domainName, dryRun), {
    method: 'DELETE',
    body: JSON.stringify(guids),
  });
  return { domainName, dryRun: Boolean(dryRun), recordCount: guids.length };
}

// ============================================================================
// Record writes
// ============================================================================

export async function createDnsRecord(args: {
  domainName: string;
  record: DnsRecordInput;
  dryRun?: boolean;
}): Promise<CreateDnsRecordOutput> {
  if (!args.record) throw new Validation('createDnsRecord requires a record.');
  return patchRecord(args.domainName, args.record, args.dryRun);
}

export async function createDnsRecords(args: {
  domainName: string;
  records: DnsRecordInput[];
  dryRun?: boolean;
}): Promise<CreateDnsRecordsOutput> {
  return patchRecordsBulk(args.domainName, args.records ?? [], [], args.dryRun);
}

export async function updateDnsRecord(args: {
  domainName: string;
  record: DnsRecordInput;
  dryRun?: boolean;
}): Promise<UpdateDnsRecordOutput> {
  if (!args.record) throw new Validation('updateDnsRecord requires a record.');
  return patchRecord(args.domainName, args.record, args.dryRun);
}

export async function updateDnsRecords(args: {
  domainName: string;
  records: DnsRecordInput[];
  dryRun?: boolean;
}): Promise<UpdateDnsRecordsOutput> {
  return patchRecordsBulk(args.domainName, [], args.records ?? [], args.dryRun);
}

export async function deleteDnsRecord(args: {
  domainName: string;
  type: DnsRecordKey['type'];
  name: string;
  dryRun?: boolean;
}): Promise<DeleteDnsRecordOutput> {
  if (!args.domainName)
    throw new Validation('deleteDnsRecord: domainName is required.');
  normalizeType(args.type);
  if (!args.name)
    throw new Validation(
      'deleteDnsRecord: name is required (use "@" for zone apex).',
    );
  return removeRecords(
    args.domainName,
    [{ type: args.type, name: args.name }],
    args.dryRun,
  );
}

export async function deleteDnsRecords(args: {
  domainName: string;
  records: DnsRecordKey[];
  dryRun?: boolean;
}): Promise<DeleteDnsRecordsOutput> {
  return removeRecords(args.domainName, args.records ?? [], args.dryRun);
}

// ============================================================================
// DNS hosting
// ============================================================================

export async function addDnsHosting(args: {
  domainName: string;
}): Promise<AddDnsHostingOutput> {
  if (!args.domainName)
    throw new Validation('addDnsHosting requires domainName.');
  const cid = getCustomerId();
  await dccFetch(
    `${DOMDNS_API}/v1/customers/${cid}/domains/${encodeURIComponent(args.domainName)}/dnsHosting`,
    {
      method: 'PUT',
    },
  );
  return { domainName: args.domainName, dnsHostingEnabled: true };
}

interface CancelDnsHostingResponse {
  successDomains?: string[] | null;
}

export async function cancelDnsHosting(args: {
  domainName: string;
  domainNames?: string[];
}): Promise<CancelDnsHostingOutput> {
  if (!args.domainName)
    throw new Validation('cancelDnsHosting requires domainName.');
  const cid = getCustomerId();
  const domains = [args.domainName, ...(args.domainNames ?? [])];
  const resp = await dccFetch<CancelDnsHostingResponse>(
    `${DOMDNS_API}/v1/customers/${cid}/dnsRecords/cancelDNSHosting`,
    { method: 'POST', body: JSON.stringify({ domains }) },
  );
  const succeeded = resp?.successDomains ?? [];
  if (!succeeded.includes(args.domainName)) {
    throw new Validation(
      `cancelDnsHosting: ${args.domainName} was not cancelled — it may not have GoDaddy DNS hosting enabled. API response: ${JSON.stringify(resp)}`,
    );
  }
  return { domainName: args.domainName, dnsHostingEnabled: false };
}
