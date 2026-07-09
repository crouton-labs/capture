/**
 * GoDaddy — account security & delegation.
 *
 * Account-level security operations on the signed-in session: MFA factors,
 * security options, contact verification, login/account events, and delegated
 * access. All endpoints live on sso.godaddy.com and are session-scoped
 * (`/my/...`), so no customer/shopper ids are threaded through — cookie auth
 * resolves the account.
 *
 * Pace requests against this host; the factor writes additionally require the
 * user's live, bot-cleared session.
 */

import { gdFetch, SSO_ORIGIN, Validation, UpstreamError } from './_shared';
import type {
  SecurityFactor,
  AccountEvent,
  SecurityOptions,
  Delegate,
  DelegateInvitation,
  ListSecurityFactorsOutput,
  AddSecurityFactorOutput,
  RemoveSecurityFactorOutput,
  GetSecurityOptionsOutput,
  UpdateSecurityOptionsOutput,
  RequestContactVerificationOutput,
  VerifyContactOutput,
  ListAccountEventsOutput,
  ListDelegatesOutput,
  CreateDelegateInvitationOutput,
} from './schemas-account-security';

export type {
  SecurityFactor,
  AccountEvent,
  Delegate,
  SecurityOptions,
  DelegateInvitation,
  ListSecurityFactorsOutput,
  AddSecurityFactorOutput,
  RemoveSecurityFactorOutput,
  GetSecurityOptionsOutput,
  UpdateSecurityOptionsOutput,
  RequestContactVerificationOutput,
  VerifyContactOutput,
  ListAccountEventsOutput,
  ListDelegatesOutput,
  CreateDelegateInvitationOutput,
} from './schemas-account-security';

/** Pull the array payload from a response that is either a bare array or an envelope. */
function listFrom<T>(data: unknown, keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

// ============================================================================
// Security factors (MFA)
// ============================================================================

export async function listSecurityFactors(): Promise<ListSecurityFactorsOutput> {
  const data = await gdFetch<unknown>(`${SSO_ORIGIN}/v1/api/my/factors`);
  const factors = listFrom<SecurityFactor>(data, ['data', 'factors']);
  return { factors, total: factors.length };
}

export async function addSecurityFactor(args: {
  type: string;
  number?: string;
  name?: string;
  value?: string;
  makeDefault?: boolean;
}): Promise<AddSecurityFactorOutput> {
  if (!args?.type)
    throw new Validation('addSecurityFactor requires a factor type.');

  const body: Record<string, unknown> = { type: args.type };
  if (args.number != null) body.number = args.number;
  if (args.name != null) body.name = args.name;
  if (args.value != null) body.value = args.value;
  if (args.makeDefault != null) body.default = args.makeDefault;

  const factor = await gdFetch<SecurityFactor>(
    `${SSO_ORIGIN}/v1/api/idp/my/factors`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return { factor: factor ?? (body as SecurityFactor) };
}

export async function removeSecurityFactor(args: {
  factorId: string;
}): Promise<RemoveSecurityFactorOutput> {
  if (!args?.factorId)
    throw new Validation('removeSecurityFactor requires factorId.');

  await gdFetch<unknown>(
    `${SSO_ORIGIN}/v1/api/my/factors/${encodeURIComponent(args.factorId)}`,
    {
      method: 'DELETE',
    },
  );
  return { removed: true, factorId: args.factorId };
}

// ============================================================================
// Security options
// ============================================================================

export async function getSecurityOptions(): Promise<GetSecurityOptionsOutput> {
  const raw = await gdFetch<{
    code?: number;
    message?: string;
    data?: SecurityOptions[];
  }>(`${SSO_ORIGIN}/v1/api/idp/my/security/opts`);
  const options = raw?.data ?? [];
  return { options };
}

export async function updateSecurityOptions(args: {
  contact_id: 'email' | 'phoneWork' | 'phoneMobile';
  contact_info: string;
}): Promise<UpdateSecurityOptionsOutput> {
  if (!args?.contact_id)
    throw new Validation('updateSecurityOptions requires contact_id.');
  if (!args?.contact_info)
    throw new Validation('updateSecurityOptions requires contact_info.');

  const item = { contact_id: args.contact_id, contact_info: args.contact_info };
  const raw = await gdFetch<{
    code?: number;
    message?: string;
    data?: SecurityOptions[];
  }>(`${SSO_ORIGIN}/api/my/security/opts`, {
    method: 'PUT',
    body: JSON.stringify(item),
  });
  const options = raw?.data ?? [item as SecurityOptions];
  return { options };
}

// ============================================================================
// Contact verification
// ============================================================================

const VALID_USER_INTERACTIONS = [
  'PROFILE_UPDATE',
  'PROFILE_VERIFY',
  'LOGIN_INTERSTITIAL',
  'LOGIN_INTERSTITIAL_MANDATORY',
  'BILLING_PHONE',
  'DOMAINS_REGISTRANT_VERIFICATION',
  'STUDENT_VALIDATION',
] as const;

export async function requestContactVerification(args: {
  email?: string;
  phone?: string;
  contactType?: 'email' | 'phoneWork' | 'phoneMobile';
  contactValue?: string;
  userInteraction?: string;
}): Promise<RequestContactVerificationOutput> {
  const email = args?.email?.trim();
  const phone = args?.phone?.trim();
  const contactType = args?.contactType;
  const contactValue = args?.contactValue?.trim();

  const hasEmail = !!email;
  const hasPhone = !!phone;
  const hasContactTypePair = !!(contactType || contactValue);

  if ([hasEmail, hasPhone, hasContactTypePair].filter(Boolean).length > 1) {
    throw new Validation(
      'requestContactVerification: provide exactly one of email, phone, or contactType+contactValue — not multiple.',
    );
  }

  let resolvedType: string;
  let resolvedValue: string;

  if (hasContactTypePair) {
    if (!contactType || !contactValue) {
      throw new Validation(
        'requestContactVerification: contactType and contactValue must both be provided together.',
      );
    }
    resolvedType = contactType;
    resolvedValue = contactValue;
  } else if (hasEmail) {
    resolvedType = 'email';
    resolvedValue = email;
  } else if (hasPhone) {
    resolvedType = 'phoneWork';
    resolvedValue = phone;
  } else {
    throw new Validation(
      'requestContactVerification requires an email, phone, or contactType+contactValue.',
    );
  }

  if (
    args?.userInteraction &&
    !(VALID_USER_INTERACTIONS as readonly string[]).includes(
      args.userInteraction,
    )
  ) {
    throw new Validation(
      `requestContactVerification: invalid userInteraction "${args.userInteraction}". Must be one of: ${VALID_USER_INTERACTIONS.join(', ')}.`,
    );
  }

  const body: Record<string, unknown> = {
    contactType: resolvedType,
    contactValue: resolvedValue,
  };
  if (args?.userInteraction) body.userInteraction = args.userInteraction;

  const data = await gdFetch<RequestContactVerificationOutput>(
    `${SSO_ORIGIN}/v1/api/my/contact/validation/challenge`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return data ?? {};
}

export async function verifyContact(args: {
  code: string;
  contactType: 'email' | 'phoneWork' | 'phoneMobile';
  contactValue: string;
  userInteraction: string;
}): Promise<VerifyContactOutput> {
  if (!args?.code) throw new Validation('verifyContact requires a code.');
  if (!args?.contactType)
    throw new Validation('verifyContact requires contactType.');
  if (!args?.contactValue)
    throw new Validation('verifyContact requires contactValue.');
  if (!args?.userInteraction)
    throw new Validation('verifyContact requires userInteraction.');

  const body: Record<string, unknown> = {
    code: args.code,
    contactType: args.contactType,
    contactValue: args.contactValue,
    userInteraction: args.userInteraction,
  };

  const data = await gdFetch<VerifyContactOutput>(
    `${SSO_ORIGIN}/v1/api/my/contact/validation/verify`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  if (!data) {
    throw new UpstreamError(
      'verifyContact: server returned no confirmation — no active verification challenge found. Call requestContactVerification first, then submit the delivered code.',
    );
  }
  return data;
}

// ============================================================================
// Account events
// ============================================================================

export async function listAccountEvents(
  args: { count?: number; eventTypes?: string[] } = {},
): Promise<ListAccountEventsOutput> {
  const eventCount = args.count != null && args.count > 0 ? args.count : 100;
  const types = args.eventTypes?.length
    ? args.eventTypes
    : ['login', 'partial_login', 'additional_factor_login'];
  const includeTypes = types.map((t) => encodeURIComponent(t)).join(',');

  const raw = await gdFetch<unknown>(
    `${SSO_ORIGIN}/v1/api/my/account_events?event_count=${eventCount}&include_event_types=${includeTypes}`,
  );
  const payload = (raw as Record<string, unknown>)?.data ?? raw;
  const events = listFrom<AccountEvent>(payload, [
    'events',
    'accountEvents',
    'account_events',
  ]);
  return { events, total: events.length };
}

// ============================================================================
// Delegation
// ============================================================================

export async function listDelegates(
  args: { pageSize?: number; page?: number } = {},
): Promise<ListDelegatesOutput> {
  const params = new URLSearchParams();
  if (args.pageSize != null) params.set('pageSize', String(args.pageSize));
  if (args.page != null) params.set('page', String(args.page));
  const qs = params.toString();

  const data = await gdFetch<unknown>(
    `${SSO_ORIGIN}/v1/api/s2s/delegation/delegates${qs ? `?${qs}` : ''}`,
  );

  const raw = data as Record<string, unknown> | null;
  const delegates = listFrom<Delegate>(raw, ['results', 'delegates', 'data']);
  const paginationRaw = raw?.pagination as Record<string, unknown> | undefined;
  const pagination = paginationRaw
    ? {
        pageSize: paginationRaw.pageSize as number | undefined,
        totalRecords: paginationRaw.totalRecords as number | undefined,
        totalPages: paginationRaw.totalPages as number | undefined,
      }
    : undefined;

  return { delegates, total: delegates.length, pagination };
}

export async function createDelegateInvitation(args: {
  email: string;
  level?: 1 | 2 | 3 | 5;
  inviteName?: string;
  role?: string;
  permissions?: string[];
}): Promise<CreateDelegateInvitationOutput> {
  const email = args?.email?.trim();
  if (!email)
    throw new Validation('createDelegateInvitation requires an email.');

  const body: Record<string, unknown> = { email };
  if (args.level != null) body.level = args.level;
  if (args.inviteName != null) body.inviteName = args.inviteName;
  if (args.role != null) body.role = args.role;
  if (args.permissions?.length) body.permissions = args.permissions;

  const invitation = await gdFetch<DelegateInvitation>(
    `${SSO_ORIGIN}/v1/api/s2s/delegation/invitations`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return { invitation: invitation ?? ({ email } as DelegateInvitation) };
}
