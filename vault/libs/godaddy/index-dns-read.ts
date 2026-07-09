/**
 * GoDaddy — DNS read functions.
 *
 * Reads DNS-hosted zones and their records via the DNS API (domdns.api).
 * Context-implicit: customer scope is read from the session cookie, never
 * passed in.
 */

import {
  dccFetch,
  getCustomerId,
  paginatePage,
  DOMDNS_API,
  Validation,
  ContractDrift,
  Unauthenticated,
  throwForStatus,
  uuid,
  DEFAULT_APP_KEY,
} from './_shared';
import type {
  DnsRecord,
  DnsZone,
  ListDnsZonesOutput,
  GetDnsRecordsOutput,
  SearchDnsRecordsOutput,
  ExportZoneFileOutput,
} from './schemas-dns-read';

export type {
  DnsRecord,
  DnsZone,
  ListDnsZonesOutput,
  GetDnsRecordsOutput,
  SearchDnsRecordsOutput,
  ExportZoneFileOutput,
} from './schemas-dns-read';

// ============================================================================
// Internal helpers
// ============================================================================

interface ZonesResponse {
  pagination?: { total?: number };
  zoneList?: DnsZone[] | null;
}

interface ZoneRecordRaw {
  rtype?: string;
  type?: string;
  [key: string]: unknown;
}

/** The API returns `rtype` (lowercase); normalise to the schema's `type` (uppercase) and strip the wire-only `rtype` field. */
function normalizeRecord(raw: ZoneRecordRaw): DnsRecord {
  const { rtype, type: _type, ...rest } = raw as Record<string, unknown>;
  const type = (
    (_type as string | undefined) ??
    (rtype as string | undefined) ??
    ''
  ).toUpperCase();
  return { ...rest, type } as unknown as DnsRecord;
}

/** Fetch every DNS record in a zone, paginating the 100/page record cap. */
async function fetchZoneRecords(
  domainName: string,
  types?: string[],
): Promise<DnsRecord[]> {
  const cid = getCustomerId();
  const typeQs = types?.length
    ? types.map((t) => `&type=${encodeURIComponent(t.toUpperCase())}`).join('')
    : '';
  return paginatePage<DnsRecord>(
    async (pageNumber, pageSize) => {
      const url = `${DOMDNS_API}/v1/customers/${cid}/zones/${encodeURIComponent(
        domainName,
      )}?pageSize=${pageSize}&pageNumber=${pageNumber}${typeQs}`;
      const data = await dccFetch<
        ZoneRecordRaw[] | { records?: ZoneRecordRaw[] }
      >(url);
      const page = Array.isArray(data) ? data : (data?.records ?? []);
      return page.map(normalizeRecord);
    },
    undefined,
    100,
  );
}

// ============================================================================
// listDnsZones
// ============================================================================

export async function listDnsZones(
  args: { count?: number } = {},
): Promise<ListDnsZonesOutput> {
  const cid = getCustomerId();
  const pageSize = 250;
  const zones: DnsZone[] = [];
  let total: number | undefined;
  let pageNumber = 1;

  for (;;) {
    const url = `${DOMDNS_API}/v1/customers/${cid}/zones?pageSize=${pageSize}&pageNumber=${pageNumber}`;
    const resp = await dccFetch<ZonesResponse>(url);
    const page = resp.zoneList ?? [];
    if (typeof resp.pagination?.total === 'number')
      total = resp.pagination.total;
    zones.push(...page);
    if (page.length < pageSize) break;
    if (args.count != null && zones.length >= args.count) break;
    pageNumber += 1;
  }

  const sliced = args.count != null ? zones.slice(0, args.count) : zones;
  return { zones: sliced, total: total ?? zones.length };
}

// ============================================================================
// getDnsRecords
// ============================================================================

export async function getDnsRecords(args: {
  domainName: string;
  type?: string;
  types?: string[];
  name?: string;
  count?: number;
}): Promise<GetDnsRecordsOutput> {
  if (!args.domainName)
    throw new Validation('getDnsRecords requires domainName.');

  let records = await fetchZoneRecords(args.domainName, args.types);

  if (args.type) {
    const wanted = args.type.toUpperCase();
    records = records.filter((r) => r.type === wanted);
  }
  if (args.name) {
    records = records.filter((r) => r.name === args.name);
  }

  const total = records.length;
  const out = args.count != null ? records.slice(0, args.count) : records;
  return { records: out, total };
}

// ============================================================================
// searchDnsRecords
// ============================================================================

export async function searchDnsRecords(args: {
  domainName: string;
  type?: string;
  types?: string[];
  name?: string;
  value?: string;
  count?: number;
}): Promise<SearchDnsRecordsOutput> {
  if (!args.domainName)
    throw new Validation('searchDnsRecords requires domainName.');

  let records = await fetchZoneRecords(args.domainName, args.types);

  if (args.type) {
    const wanted = args.type.toUpperCase();
    records = records.filter((r) => r.type === wanted);
  }
  if (args.name) {
    const needle = args.name.toLowerCase();
    records = records.filter((r) => r.name?.toLowerCase().includes(needle));
  }
  if (args.value) {
    const needle = args.value.toLowerCase();
    records = records.filter((r) =>
      String(r.data ?? '')
        .toLowerCase()
        .includes(needle),
    );
  }

  const total = records.length;
  if (args.count != null) records = records.slice(0, args.count);
  return { records, total };
}

// ============================================================================
// exportZoneFile
// ============================================================================

export async function exportZoneFile(args: {
  domainName: string;
}): Promise<ExportZoneFileOutput> {
  if (!args.domainName)
    throw new Validation('exportZoneFile requires domainName.');

  const cid = getCustomerId();

  // The v2 domdns endpoint requires sso-jwt Authorization (cookie-only gets 401).
  // The JWT lives in the DCC Next.js page config, available on dcc.godaddy.com pages.
  const nextData = (
    window as unknown as {
      __NEXT_DATA__?: {
        props?: {
          pageProps?: { initialState?: { config?: { jwtToken?: string } } };
        };
      };
    }
  ).__NEXT_DATA__;
  const jwtToken = nextData?.props?.pageProps?.initialState?.config?.jwtToken;
  if (!jwtToken) {
    throw new Unauthenticated(
      `exportZoneFile: No JWT found in DCC page config on ${window.location.href}. Open dcc.godaddy.com while signed in.`,
    );
  }

  const url = `${DOMDNS_API}/v2/customers/${cid}/domains/${encodeURIComponent(args.domainName)}/zonefile`;

  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'x-app-key': DEFAULT_APP_KEY,
      'X-Request-Id': uuid(),
      Authorization: `sso-jwt ${jwtToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(
      res.status,
      `exportZoneFile: GoDaddy API ${res.status} (${url}): ${truncated}`,
    );
  }

  const text = await res.text();
  if (!text) {
    throw new ContractDrift(`exportZoneFile: empty response from ${url}.`);
  }

  // The endpoint returns JSON { zonefile: "..." }. If it ever returns plain BIND
  // text (non-JSON), use the raw text as the zone file.
  let zoneFile: string;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const candidate = parsed.zonefile ?? parsed.zoneFile ?? parsed.payload;
    if (typeof candidate === 'string' && candidate) {
      zoneFile = candidate;
    } else {
      throw new ContractDrift(
        `exportZoneFile: response missing zone file field (${url}): ${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    if (err instanceof ContractDrift) throw err;
    // Non-JSON response — treat as raw BIND text.
    zoneFile = text;
  }

  return { domainName: args.domainName, zoneFile };
}
