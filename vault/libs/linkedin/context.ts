/**
 * LinkedIn Context & Authentication
 *
 * CSRF token extraction, tier detection, and queryId discovery for LinkedIn API.
 */

import { Unauthenticated, ContractDrift } from '@vallum/_runtime';

export interface LinkedInContext {
  csrf: string;
  memberId: string;
  tier: 'free' | 'premium' | 'sales_navigator';
  fullName?: string;
  /** IANA timezone of the browser (e.g. "America/New_York"). Use for scheduling. */
  timezone?: string;
  /** Sales Navigator identity token (only present when tier = sales_navigator). Required for sendMessage via Sales Nav. */
  identityToken?: string;
  /** Sales Navigator seat roles (only present when tier = sales_navigator). */
  seatRoles?: string[];
}

interface MeResponse {
  data?: {
    '*miniProfile'?: string;
    premiumSubscriber?: boolean;
  };
  included?: Array<{
    firstName?: string;
    lastName?: string;
    entityUrn?: string;
  }>;
}

interface SalesNavChromeResponse {
  data?: {
    seatRoles?: string[];
    admin?: boolean;
    member?: string;
    '*member'?: string;
    '*memberResolutionResult'?: string;
  };
  included?: Array<{
    entityUrn?: string;
    objectUrn?: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
  }>;
}

/**
 * Get CSRF token, member ID, and account tier for LinkedIn API calls.
 * Call this FIRST before any other LinkedIn operations.
 *
 * Automatically detects whether the user has Sales Navigator, Premium, or a free account.
 */
export async function getContext(
  opts: {
    timeoutMs?: number;
  } = {},
): Promise<LinkedInContext> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const startTime = Date.now();

  // Wait for page to be on LinkedIn domain
  while (!window.location.hostname.includes('linkedin.com')) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Unauthenticated(`Not on LinkedIn domain. URL: ${window.location.href}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Get CSRF from JSESSIONID cookie
  const csrf = document.cookie
    .split('; ')
    .find((c) => c.startsWith('JSESSIONID='))
    ?.split('=')[1]
    ?.replace(/"/g, '');

  if (!csrf) {
    throw new Unauthenticated(
      `CSRF token not found. User may not be logged in. URL: ${window.location.href}`,
    );
  }

  // Fetch /me for member ID + premiumSubscriber flag
  const { linkedinFetch } = await import('./helpers/index.js');
  const meResp = await linkedinFetch<MeResponse>(csrf, '/voyager/api/me');
  const miniProfileUrn = meResp.data?.['*miniProfile'];

  if (!miniProfileUrn) {
    throw new ContractDrift('Could not extract member ID from /me response.');
  }

  const memberId = miniProfileUrn.split(':').pop();
  if (!memberId) {
    throw new ContractDrift(`Could not parse member ID from URN: ${miniProfileUrn}`);
  }

  // Extract full name from included miniProfile
  let fullName: string | undefined;
  if (meResp.included?.[0]) {
    const profile = meResp.included[0];
    if (profile.firstName) {
      fullName = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .join(' ');
    }
  }

  // Detect browser timezone for scheduling
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Intl not available (non-fatal)
  }

  // Detect tier: try Sales Navigator first, then check premium flag
  const salesNavResult = await probeSalesNavigator(csrf);

  if (salesNavResult) {
    return {
      csrf,
      memberId,
      tier: 'sales_navigator',
      fullName: salesNavResult.fullName || fullName,
      timezone,
      identityToken: salesNavResult.identityToken,
      seatRoles: salesNavResult.seatRoles,
    };
  }

  const isPremium = meResp.data?.premiumSubscriber === true;

  return {
    csrf,
    memberId,
    tier: isPremium ? 'premium' : 'free',
    fullName,
    timezone,
  };
}

/**
 * Probe Sales Navigator endpoint to detect if user has a Sales Nav seat.
 * Returns seat info if available, null if not (403 = SALES_SEAT_REQUIRED).
 */
async function probeSalesNavigator(csrf: string): Promise<{
  fullName?: string;
  identityToken?: string;
  seatRoles?: string[];
} | null> {
  const SALES_NAV_HEADERS = {
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    'x-restli-protocol-version': '2.0.0',
  };

  try {
    const decoration = encodeURIComponent(
      '(seatRoles*,admin,member~fs_salesProfile(entityUrn,fullName))',
    )
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
    const resp = await fetch(
      `https://www.linkedin.com/sales-api/salesApiNavChrome?decoration=${decoration}`,
      {
        credentials: 'include',
        headers: { 'csrf-token': csrf, ...SALES_NAV_HEADERS },
      },
    );

    if (!resp.ok) return null;

    const data: SalesNavChromeResponse = await resp.json();

    // Extract full name from included profile entity
    let fullName: string | undefined;
    if (data.included) {
      for (const entity of data.included) {
        if (entity.entityUrn?.includes('fs_salesProfile')) {
          fullName = entity.fullName || entity.firstName;
          break;
        }
      }
    }

    // Fetch identity token (required for Sales Nav messaging)
    let identityToken: string | undefined;
    try {
      const identityResp = await fetch(
        'https://www.linkedin.com/sales-api/salesApiPrimaryIdentity',
        {
          credentials: 'include',
          headers: { 'csrf-token': csrf, ...SALES_NAV_HEADERS },
        },
      );
      if (identityResp.ok) {
        const identityData = (await identityResp.json()) as {
          data?: { primaryIdentity?: string };
        };
        if (identityData.data?.primaryIdentity) {
          identityToken = identityData.data.primaryIdentity;
        }
      }
    } catch {
      // Identity token fetch failed (non-fatal); messaging won't work but everything else will
    }

    return {
      fullName,
      identityToken,
      seatRoles: data.data?.seatRoles,
    };
  } catch {
    return null;
  }
}
