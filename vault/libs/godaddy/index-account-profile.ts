/**
 * GoDaddy — account profile functions.
 *
 * Session validation + shopper profile, preferences, and customer-segment reads
 * across dcc.godaddy.com, sso.godaddy.com, and account.godaddy.com. All scoped
 * implicitly to the signed-in session via cookie auth — no account ids are passed in.
 *
 * account.godaddy.com is Akamai-fronted; these calls are single and unbatched.
 * Never loop them.
 */

import {
  gdFetch,
  getShopperId,
  SSO_ORIGIN,
  ACCOUNT_ORIGIN,
  Validation,
  Unauthenticated,
  ContractDrift,
  parseInfoCustIdp,
} from './_shared';
import type {
  ValidateSessionOutput,
  GetAccountProfileOutput,
  UpdateAccountProfileOutput,
  GetShopperPreferencesOutput,
  UpdateShopperPreferencesOutput,
  GetCustomerSegmentOutput,
} from './schemas-account-profile';

const DCC_ORIGIN = 'https://dcc.godaddy.com';

export type {
  AccountContact,
  ValidateSessionOutput,
  GetAccountProfileOutput,
  UpdateAccountProfileOutput,
  GetShopperPreferencesOutput,
  UpdateShopperPreferencesOutput,
  GetCustomerSegmentOutput,
} from './schemas-account-profile';

// ============================================================================
// validateSession
// ============================================================================

interface ValidateDetailsResponse {
  type?: string;
  plid?: string | number;
  customerId?: string;
  cid?: string;
  shopperId?: string;
  privateLabelType?: number;
}

interface ValidateResponse {
  valid?: boolean;
  realm?: string;
  details?: ValidateDetailsResponse;
}

export async function validateSession(
  args: {
    realm?: 'idp' | 'jomax' | 'cert';
    risk?: 'low' | 'medium' | 'high';
    type?: 'basic' | 'mfa';
    allowHeartbeat?: boolean;
    use12HourExpiration?: boolean;
    plid?: string | number;
    groups?: string;
  } = {},
): Promise<ValidateSessionOutput> {
  parseInfoCustIdp();

  const VALID_REALMS = ['idp', 'jomax', 'cert'];
  const VALID_RISKS = ['low', 'medium', 'high'];
  if (args.realm != null && !VALID_REALMS.includes(args.realm)) {
    throw new Validation(
      `validateSession: invalid realm "${args.realm}". Valid values: idp, jomax, cert.`,
    );
  }
  if (args.risk != null && !VALID_RISKS.includes(args.risk)) {
    throw new Validation(
      `validateSession: invalid risk "${args.risk}". Valid values: low, medium, high.`,
    );
  }

  if (!window.location.hostname.endsWith('dcc.godaddy.com')) {
    throw new Unauthenticated(
      `validateSession requires a dcc.godaddy.com page. Navigate to https://dcc.godaddy.com/control/portfolio first. Current URL: ${window.location.href}`,
    );
  }

  const realm = args.realm ?? 'idp';
  const risk = args.risk ?? 'medium';

  const params = new URLSearchParams({ realm, risk });
  if (args.type != null) params.set('type', args.type);
  if (args.allowHeartbeat != null) params.set('allowHeartbeat', String(args.allowHeartbeat));
  if (args.use12HourExpiration != null) params.set('use12HourExpiration', String(args.use12HourExpiration));
  if (args.plid != null) params.set('plid', String(args.plid));
  if (args.groups != null) params.set('groups', args.groups);

  const url = `${DCC_ORIGIN}/control/api/auth/validate?${params}`;
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new Unauthenticated(
      `validateSession: fetch failed for ${url} — navigate to https://dcc.godaddy.com/control/portfolio and ensure you are signed in. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = await res.text().catch(() => '');
  let data: ValidateResponse & { authReason?: number; reason?: string };
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ContractDrift(
      `validateSession: non-JSON response from ${url}: ${text.slice(0, 500)}`,
    );
  }

  // 401 with valid:false is the expected response for elevated-risk checks
  // when only basic auth is present (e.g. risk:"high" without MFA). Return it.
  if (!res.ok) {
    if (data.valid === false) {
      return {
        valid: false,
        realm: data.realm,
        details: {},
        authReason: data.authReason,
        reason: data.reason,
      };
    }
    throw new Unauthenticated(
      `validateSession: ${res.status} from ${url}: ${text.slice(0, 500)}`,
    );
  }

  return {
    valid: data.valid ?? false,
    realm: data.realm,
    details: data.details ?? {},
    authReason: data.authReason,
    reason: data.reason,
  };
}

// ============================================================================
// getAccountProfile
// ============================================================================

export async function getAccountProfile(
  args: { includes?: string } = {},
): Promise<GetAccountProfileOutput> {
  const url = args.includes
    ? `${SSO_ORIGIN}/ajax/shopper?includes=${encodeURIComponent(args.includes)}`
    : `${SSO_ORIGIN}/ajax/shopper`;
  const profile = await gdFetch<GetAccountProfileOutput['profile']>(url);
  return { profile };
}

// ============================================================================
// updateAccountProfile
// ============================================================================

const ADDRESS_FIELDS = [
  'address1',
  'address2',
  'city',
  'state',
  'postalCode',
  'country',
] as const;

export async function updateAccountProfile(
  args: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    organization?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    timeZone?: string;
  } = {},
): Promise<UpdateAccountProfileOutput> {
  const contact: Record<string, unknown> = {};
  const patchBody: Record<string, unknown> = { contact };

  if (args.firstName != null && args.firstName !== '')
    contact.nameFirst = args.firstName;
  if (args.lastName != null && args.lastName !== '')
    contact.nameLast = args.lastName;
  if (args.phone != null && args.phone !== '') contact.phone = args.phone;
  if (args.organization != null && args.organization !== '')
    contact.organization = args.organization;
  if (args.timeZone != null && args.timeZone !== '')
    contact.timeZone = args.timeZone;
  if (args.email != null && args.email !== '') patchBody.email = args.email;

  const address: Record<string, string> = {};
  for (const field of ADDRESS_FIELDS) {
    const value = args[field];
    if (value != null && value !== '') address[field] = value;
  }
  if (Object.keys(address).length > 0) contact.address = address;

  const hasContact = Object.keys(contact).length > 0;
  const hasEmail = patchBody.email != null;
  if (!hasContact && !hasEmail) {
    throw new Validation(
      'updateAccountProfile requires at least one field to change.',
    );
  }
  if (!hasContact) delete patchBody.contact;

  const shopperId = getShopperId();
  await gdFetch<unknown>(
    `${ACCOUNT_ORIGIN}/platapi/v1.1/shoppers/${encodeURIComponent(shopperId)}?auditClientIp=browser`,
    { method: 'PATCH', body: JSON.stringify(patchBody) },
  );

  return { updated: true };
}

// ============================================================================
// getShopperPreferences
// ============================================================================

export async function getShopperPreferences(): Promise<GetShopperPreferencesOutput> {
  const data = await gdFetch<{ preference?: Record<string, unknown> }>(
    `${SSO_ORIGIN}/ajax/shopper?includes=preference`,
  );
  return { preferences: data?.preference ?? {} };
}

// ============================================================================
// updateShopperPreferences
// ============================================================================

const VALID_PREFERENCE_TYPES = [
  'currency',
  'marketId',
  'allowedCommunicationTypes',
] as const;

export async function updateShopperPreferences(args: {
  type: string;
  value: string | string[];
}): Promise<UpdateShopperPreferencesOutput> {
  if (!args?.type) {
    throw new Validation(
      'updateShopperPreferences requires a preference type (a key from getShopperPreferences).',
    );
  }
  if (
    !VALID_PREFERENCE_TYPES.includes(
      args.type as (typeof VALID_PREFERENCE_TYPES)[number],
    )
  ) {
    throw new Validation(
      `updateShopperPreferences: unknown preference type "${args.type}". Valid types: ${VALID_PREFERENCE_TYPES.join(', ')}.`,
    );
  }
  if (args.value === undefined) {
    throw new Validation(
      'updateShopperPreferences requires a value for the preference type.',
    );
  }

  await gdFetch<unknown>(`${SSO_ORIGIN}/ajax/shopper`, {
    method: 'PATCH',
    body: JSON.stringify({ preference: { [args.type]: args.value } }),
  });

  return { updated: true, type: args.type };
}

// ============================================================================
// getCustomerSegment
// ============================================================================

export async function getCustomerSegment(
  args: {
    segmentId?: string;
    scopeIdType?: 'customerId' | 'entitlementId' | 'ventureId';
    scopeId?: string;
  } = {},
): Promise<GetCustomerSegmentOutput> {
  if (args.segmentId) {
    const info = parseInfoCustIdp();
    const customerId = String(info.info_cid);
    const resolvedScopeIdType = args.scopeIdType ?? 'customerId';
    const resolvedScopeId = args.scopeId ?? customerId;
    const params = new URLSearchParams({
      scopeIdType: resolvedScopeIdType,
      scopeId: resolvedScopeId,
      customerId,
      segmentId: args.segmentId,
    });
    const raw = await gdFetch<unknown>(
      `${ACCOUNT_ORIGIN}/products/api/customer-segment/segment/get?${params}`,
    );
    const segmentValue =
      raw !== null && raw !== undefined && raw !== '' ? raw : undefined;
    return {
      result: {},
      segmentId: args.segmentId,
      segmentValue,
      inSegment: segmentValue !== undefined,
    };
  }

  const shopperId = getShopperId();
  const data = await gdFetch<{
    result?: Record<string, unknown>;
    status?: string | number;
    errors?: unknown[];
  }>(
    `${ACCOUNT_ORIGIN}/customertypeapi/v1/get-by-shopper-id/${encodeURIComponent(shopperId)}`,
  );

  return {
    result: data?.result ?? {},
    status: data?.status,
    errors: data?.errors,
  };
}
