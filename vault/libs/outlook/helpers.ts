/**
 * Shared helpers for Outlook Web App library.
 *
 * Internal utilities used across all domain modules: headers, folder resolution,
 * email parsing, timezone mapping.
 */

import type { OutlookAuth } from './schemas';

export type { OutlookAuth } from './schemas';

/**
 * Build standard headers for OWA service.svc requests.
 */
export function buildHeaders(
  auth: OutlookAuth,
  action: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-owa-sessionid': auth.sessionId,
    'x-anchormailbox': auth.anchorMailbox,
    'x-owa-correlationid': auth.correlationId,
    action: action,
    'x-req-source': 'Mail',
    'x-owa-hosted-ux': 'false',
    prefer:
      'IdType="ImmutableId", exchange.behavior="IncludeThirdPartyOnlineMeetingProviders"',
    'content-type': 'application/json; charset=utf-8',
  };

  // Only include canary when it's a real token (not the sentinel).
  // On outlook.office.com (org accounts), there's no canary cookie and the
  // browser omits the header entirely. Sending the sentinel causes 401.
  if (auth.canary && auth.canary !== 'X-OWA-CANARY_cookie_is_null_or_empty') {
    headers['x-owa-canary'] = auth.canary;
  }

  if (auth.authorization) {
    headers.authorization = auth.authorization;
  }

  return headers;
}

/**
 * Build the standard EWS Header sub-object for service.svc request envelopes.
 */
export function buildEwsHeader(auth: OutlookAuth): Record<string, unknown> {
  return {
    __type: 'JsonRequestHeaders:#Exchange',
    RequestServerVersion: 'V2018_01_08',
    TimeZoneContext: {
      __type: 'TimeZoneContext:#Exchange',
      TimeZoneDefinition: {
        __type: 'TimeZoneDefinitionType:#Exchange',
        Id: auth.timezone,
      },
    },
  };
}

/**
 * Resolve well-known folder names to distinguished folder IDs.
 */
export function resolveDistinguishedFolderId(
  folderId: string,
): { __type: string; Id: string } | string {
  const wellKnown: Record<string, string> = {
    inbox: 'inbox',
    drafts: 'drafts',
    sentitems: 'sentitems',
    deleteditems: 'deleteditems',
    junkemail: 'junkemail',
    archive: 'archive',
  };

  const lower = folderId.toLowerCase();
  if (wellKnown[lower]) {
    return {
      __type: 'DistinguishedFolderId:#Exchange',
      Id: wellKnown[lower],
    };
  }

  // Assume it's a raw folder ID
  return folderId;
}

/**
 * Parse an EWS EmailAddress object into our EmailAddress shape.
 */
export function parseEmailAddress(addr: Record<string, unknown>): {
  name: string;
  email: string;
} {
  return {
    name: (addr.Name as string) || '',
    email: (addr.EmailAddress as string) || '',
  };
}

/**
 * Map IANA timezone to Windows timezone ID.
 * OWA requires Windows-format timezone IDs for its API requests.
 */
export function mapIanaToWindows(iana: string): string {
  const map: Record<string, string> = {
    'America/Los_Angeles': 'Pacific Standard Time',
    'America/Denver': 'Mountain Standard Time',
    'America/Chicago': 'Central Standard Time',
    'America/New_York': 'Eastern Standard Time',
    'America/Anchorage': 'Alaskan Standard Time',
    'Pacific/Honolulu': 'Hawaiian Standard Time',
    'America/Phoenix': 'US Mountain Standard Time',
    'Europe/London': 'GMT Standard Time',
    'Europe/Paris': 'Romance Standard Time',
    'Europe/Berlin': 'W. Europe Standard Time',
    'Asia/Tokyo': 'Tokyo Standard Time',
    'Asia/Shanghai': 'China Standard Time',
    'Asia/Kolkata': 'India Standard Time',
    'Asia/Calcutta': 'India Standard Time',
    'Australia/Sydney': 'AUS Eastern Standard Time',
    UTC: 'UTC',
  };
  return map[iana] || 'UTC';
}
