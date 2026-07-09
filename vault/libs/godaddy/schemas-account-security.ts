import { z } from 'zod';

// ============================================================================
// Shared entity shapes
// ============================================================================

export const SecurityFactorSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe('Factor id. Pass to removeSecurityFactor to delete it.'),
    type: z
      .string()
      .optional()
      .describe(
        'Factor type. Common values: "sms", "voice", "email", "authenticator" (TOTP app), "security_key", "k_google" (Google social login).',
      ),
    name: z
      .string()
      .nullable()
      .optional()
      .describe('Internal factor name, e.g. "SocialConnection".'),
    display_name: z
      .string()
      .nullable()
      .optional()
      .describe('Display name for the factor.'),
    phone: z
      .string()
      .nullable()
      .optional()
      .describe('Masked phone number for SMS/voice factors, when applicable.'),
    status: z
      .string()
      .nullable()
      .optional()
      .describe('Factor status, e.g. "ready", "active", "pending".'),
    lastused: z
      .string()
      .nullable()
      .optional()
      .describe('ISO timestamp when this factor was last used, when present.'),
    default: z
      .boolean()
      .optional()
      .describe('Whether this is the default/primary second factor.'),
    created: z
      .string()
      .nullable()
      .optional()
      .describe('When the factor was added (ISO timestamp), when present.'),
    reference_id: z
      .string()
      .nullable()
      .optional()
      .describe('Internal reference id for the factor, when present.'),
  })
  .passthrough()
  .describe(
    'An MFA / second-factor authentication method configured on the account.',
  );

export const AccountEventSchema = z
  .object({
    event_id: z.string().optional().describe('Unique event id.'),
    event_type: z
      .string()
      .optional()
      .describe(
        'Event type. Known values: "login", "partial_login", "additional_factor_login", "social_connect_create_unique".',
      ),
    event_category: z
      .string()
      .optional()
      .describe('Broad event category, e.g. "access" or "management".'),
    event_status: z
      .string()
      .optional()
      .describe('Outcome of the event, e.g. "normal_success", "new_success".'),
    created_at: z
      .string()
      .optional()
      .describe('When the event occurred (ISO timestamp).'),
    user_ip: z
      .string()
      .optional()
      .describe('Source IP address (may be masked).'),
    actor_id: z.string().optional().describe('Account id of the actor.'),
    account_id: z
      .string()
      .optional()
      .describe('Account/shopper id associated with the event.'),
    account_type: z
      .string()
      .optional()
      .describe('Account type, typically "idp".'),
    factors: z
      .array(z.string())
      .optional()
      .describe('Authentication factors used, e.g. ["k_google"].'),
    device_info: z
      .object({
        browser_family: z.string().optional(),
        browser_version: z.string().optional(),
        device_brand: z.string().optional(),
        device_family: z.string().optional(),
        device_model: z.string().optional(),
        os_family: z.string().optional(),
        os_version: z.string().optional(),
        user_agent: z.string().optional(),
        visitor_id: z.string().optional(),
      })
      .passthrough()
      .optional()
      .describe('Device and browser details for the event.'),
    geo_info: z
      .object({
        city: z.string().optional(),
        state: z.string().optional(),
        country_name: z.string().optional(),
        country_code: z.string().optional(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        time_zone: z.string().optional(),
      })
      .passthrough()
      .optional()
      .describe('Approximate geographic location of the event.'),
    jti: z.string().optional().describe('Session token identifier.'),
    data: z
      .object({
        token_jti: z
          .string()
          .nullable()
          .optional()
          .describe('Session token JTI, same as top-level jti.'),
        factor_type: z
          .string()
          .nullable()
          .optional()
          .describe('Authentication factor type used, e.g. "k_google".'),
        name: z
          .string()
          .nullable()
          .optional()
          .describe('Factor name when applicable.'),
        native_app_id: z
          .string()
          .nullable()
          .optional()
          .describe('Native app identifier when applicable.'),
      })
      .passthrough()
      .optional()
      .describe('Event-specific metadata.'),
    jti_deletion_info: z
      .null()
      .optional()
      .describe('Session revocation info; null when not deleted.'),
  })
  .passthrough()
  .describe('A recent account security event (login or factor activity).');

export const DelegateSchema = z
  .object({
    id: z.string().optional().describe('Delegate id, when present.'),
    email: z.string().optional().describe('Delegate email address.'),
    name: z
      .string()
      .optional()
      .describe('Delegate display name, when present.'),
    status: z
      .string()
      .optional()
      .describe('Delegation status, e.g. "active" or "pending".'),
    role: z
      .string()
      .optional()
      .describe('Access role / permission level granted to the delegate.'),
  })
  .passthrough()
  .describe('A person granted delegated access to the account.');

export const SecurityOptionsSchema = z
  .object({
    contact_id: z
      .enum(['email', 'phoneWork', 'phoneMobile'])
      .optional()
      .describe(
        'Contact method type. "email" = email address, "phoneWork" = primary phone, "phoneMobile" = secondary phone.',
      ),
    contact_info: z
      .string()
      .optional()
      .describe(
        'The contact value: email address for "email", phone number for "phoneWork"/"phoneMobile".',
      ),
  })
  .passthrough()
  .describe(
    'A configured security option entry (the recovery contact for 2FA notifications).',
  );

export const DelegateInvitationSchema = z
  .object({
    id: z.string().optional().describe('Invitation id, when present.'),
    email: z.string().optional().describe('Email the invitation was sent to.'),
    status: z
      .string()
      .optional()
      .describe('Invitation status, e.g. "sent" or "pending".'),
    role: z
      .string()
      .optional()
      .describe('Access role offered in the invitation, when present.'),
  })
  .passthrough()
  .describe('A pending delegation invitation.');

// ============================================================================
// listSecurityFactors
// ============================================================================

export const listSecurityFactorsSchema = {
  name: 'listSecurityFactors',
  description:
    'List the MFA / second-factor authentication methods (SMS, authenticator app, email, etc.) configured on the signed-in account.',
  notes: '',
  input: z.object({}),
  output: z.object({
    factors: z
      .array(SecurityFactorSchema)
      .describe('Configured second factors. Empty when none are set up.'),
    total: z.number().describe('Number of factors returned.'),
  }),
};

// ============================================================================
// addSecurityFactor
// ============================================================================

export const addSecurityFactorSchema = {
  name: 'addSecurityFactor',
  description:
    'Add an MFA / second-factor authentication method (e.g. SMS phone or authenticator app) to the signed-in account.',
  notes:
    'Requires a fresh step-up authentication session on sso.godaddy.com. GoDaddy enforces a short-lived HBI (high-bot-intent) claim for security factor writes — if this call fails with Unauthenticated, navigate the user to sso.godaddy.com/security to complete the step-up re-authentication flow, then retry. Adding a factor also triggers an out-of-band verification step the user must complete before it becomes active. Confirmed type values: "p_sms" (SMS), "p_auth" (TOTP authenticator app), "p_fido2" (FIDO2/passkey), "p_u2f" (legacy U2F security key), "p_studio_app" (GoDaddy mobile app). For SMS factors, phone number goes in the `number` field.',
  input: z.object({
    type: z
      .enum(['p_sms', 'p_auth', 'p_fido2', 'p_u2f', 'p_studio_app'])
      .describe(
        'Factor type to add. "p_sms" = SMS, "p_auth" = TOTP authenticator app, "p_fido2" = FIDO2/passkey, "p_u2f" = legacy U2F security key, "p_studio_app" = GoDaddy mobile app.',
      ),
    number: z
      .string()
      .optional()
      .describe(
        'Phone number for SMS factors (e.g. "+15551234567"). Required when type is "p_sms".',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Display label for the factor shown in the account security UI (e.g. "Google Authenticator", "My phone"). For SMS the UI defaults to "SMS" when omitted.',
      ),
    value: z
      .string()
      .optional()
      .describe(
        'Legacy destination field for the factor. Prefer `number` for SMS. Kept for backward compatibility.',
      ),
    makeDefault: z
      .boolean()
      .optional()
      .describe('Set this factor as the default/primary second factor.'),
  }),
  output: z.object({
    factor: SecurityFactorSchema.describe(
      'The factor that was created (may be in a pending state until verified).',
    ),
  }),
};

// ============================================================================
// removeSecurityFactor
// ============================================================================

export const removeSecurityFactorSchema = {
  name: 'removeSecurityFactor',
  description:
    'Remove an MFA / second-factor authentication method from the signed-in account.',
  notes:
    "Navigate to sso.godaddy.com/v1/login before calling — the delete endpoint only permits requests from the sso.godaddy.com origin (CORS). Navigating to sso.godaddy.com/security may redirect to account.godaddy.com in some session states, which breaks CORS; sso.godaddy.com/v1/login reliably stays on the sso.godaddy.com origin. Only factors added via addSecurityFactor are removable: SMS (p_sms), authenticator app (p_auth), FIDO2 (p_fido2), U2F (p_u2f), mobile app (p_studio_app). Social-connection factors (type k_google, k_facebook, etc.) return 404 and cannot be removed via this endpoint. Call listSecurityFactors first and check the type field; do not attempt removal if the type starts with k_. Removing the last or primary factor may also be blocked by the account's security policy.",
  input: z.object({
    factorId: z
      .string()
      .describe(
        'Factor id from listSecurityFactors. Only factors with type p_sms, p_auth, p_fido2, p_u2f, or p_studio_app are removable — social-connection factors (k_google, k_facebook, etc.) return 404.',
      ),
  }),
  output: z.object({
    removed: z.boolean().describe('True when the factor was removed.'),
    factorId: z.string().describe('The factor id that was removed.'),
  }),
};

// ============================================================================
// getSecurityOptions
// ============================================================================

export const getSecurityOptionsSchema = {
  name: 'getSecurityOptions',
  description:
    "Get the signed-in account's configured 2FA contact methods (security options): which contact types (email, SMS, authenticator) are set up and the associated contact info.",
  notes:
    'Must be called from sso.godaddy.com. Returns an empty array when no security options are configured.',
  input: z.object({}),
  output: z.object({
    options: z
      .array(SecurityOptionsSchema)
      .describe(
        'Configured security option entries. Each entry describes a 2FA contact method (contact_id) and its value (contact_info). Empty array when none are configured.',
      ),
  }),
};

// ============================================================================
// updateSecurityOptions
// ============================================================================

export const updateSecurityOptionsSchema = {
  name: 'updateSecurityOptions',
  description:
    "Update the signed-in account's security recovery contact — the email or phone where 2FA notification codes are sent.",
  notes:
    'Call getSecurityOptions first to read the current contact_id and contact_info values. Requires a recent password re-authentication (HBI step-up) on sso.godaddy.com — navigate the user to sso.godaddy.com/security so they can complete the step-up, then call this function. Stale sessions return 400. To change the recovery contact: set contact_id to "email", "phoneWork", or "phoneMobile" and contact_info to the new address/number.',
  input: z.object({
    contact_id: z
      .enum(['email', 'phoneWork', 'phoneMobile'])
      .describe(
        'Contact method to set as the security recovery contact. "email" = email address, "phoneWork" = primary phone, "phoneMobile" = secondary phone.',
      ),
    contact_info: z
      .string()
      .describe(
        'The new email address or phone number for the selected contact_id.',
      ),
  }),
  output: z.object({
    options: z
      .array(SecurityOptionsSchema)
      .describe('The security options after the update.'),
  }),
};

// ============================================================================
// requestContactVerification
// ============================================================================

export const requestContactVerificationSchema = {
  name: 'requestContactVerification',
  description:
    'Send a verification challenge (one-time code) to an email address or phone number for the signed-in account.',
  notes:
    'Provide exactly one of: email, phone, or contactType+contactValue. The code is delivered out-of-band; pass it to verifyContact to complete validation. Use contactType to distinguish primary mobile (phoneWork) from secondary mobile (phoneMobile).',
  input: z.object({
    email: z
      .string()
      .optional()
      .describe(
        'Email address to verify. Provide this OR phone OR contactType+contactValue, not multiple.',
      ),
    phone: z
      .string()
      .optional()
      .describe(
        'Phone number to verify (treated as primary mobile / phoneWork). Provide this OR email OR contactType+contactValue, not multiple.',
      ),
    contactType: z
      .enum(['email', 'phoneWork', 'phoneMobile'])
      .optional()
      .describe(
        'Contact type for the v1 API. "email" = email address, "phoneWork" = primary mobile phone, "phoneMobile" = secondary mobile phone. Must be paired with contactValue. Prefer this over email/phone when you need to target a specific phone slot.',
      ),
    contactValue: z
      .string()
      .optional()
      .describe(
        'The actual email address or phone number to verify when using contactType. Required when contactType is set.',
      ),
    userInteraction: z
      .enum([
        'PROFILE_UPDATE',
        'PROFILE_VERIFY',
        'LOGIN_INTERSTITIAL',
        'LOGIN_INTERSTITIAL_MANDATORY',
        'BILLING_PHONE',
        'DOMAINS_REGISTRANT_VERIFICATION',
        'STUDENT_VALIDATION',
      ])
      .optional()
      .describe(
        'Context for the verification challenge. "PROFILE_UPDATE" when the user is adding/changing a contact. "PROFILE_VERIFY" when verifying an existing contact without change. "LOGIN_INTERSTITIAL" when triggered during sign-in. "BILLING_PHONE" for billing contact verification. "DOMAINS_REGISTRANT_VERIFICATION" for ICANN registrant verification. Omit to use the server default.',
      ),
  }),
  output: z
    .object({
      code: z
        .number()
        .optional()
        .describe('Numeric result code. 1 = challenge sent successfully.'),
      message: z
        .string()
        .optional()
        .describe('Human-readable result message (e.g. "Ok").'),
    })
    .passthrough(),
};

// ============================================================================
// verifyContact
// ============================================================================

export const verifyContactSchema = {
  name: 'verifyContact',
  description:
    'Verify a new email or phone for the signed-in account using the one-time code from requestContactVerification. Throws if the code is incorrect or no active challenge exists.',
  notes:
    'Call requestContactVerification first — the function throws UpstreamError if no active challenge is found. contactType, contactValue, and userInteraction must exactly match the values sent in requestContactVerification; the API validates all three against the active challenge. An incorrect code throws UpstreamError with the message "Incorrect contact validation code".',
  input: z.object({
    code: z
      .string()
      .describe('The one-time code delivered to the email/phone.'),
    contactType: z
      .enum(['email', 'phoneWork', 'phoneMobile'])
      .describe(
        'Contact method type being verified. Must match the contactType from requestContactVerification. "email" = email address, "phoneWork" = primary phone, "phoneMobile" = secondary phone.',
      ),
    contactValue: z
      .string()
      .describe(
        'The actual email address or phone number being verified. Must match the contactValue from requestContactVerification.',
      ),
    userInteraction: z
      .enum([
        'PROFILE_UPDATE',
        'PROFILE_VERIFY',
        'LOGIN_INTERSTITIAL',
        'LOGIN_INTERSTITIAL_MANDATORY',
        'BILLING_PHONE',
        'DOMAINS_REGISTRANT_VERIFICATION',
        'SIGN_IN_MANDATORY_DOMAIN',
        'SIGN_IN_MANDATORY_BOUNCE',
      ])
      .describe(
        'Verification context. Must match the userInteraction from requestContactVerification. "PROFILE_UPDATE" when changing a contact, "PROFILE_VERIFY" when verifying an existing contact, "LOGIN_INTERSTITIAL" during sign-in, "BILLING_PHONE" for billing contact, "DOMAINS_REGISTRANT_VERIFICATION" for ICANN registrant, "SIGN_IN_MANDATORY_DOMAIN" / "SIGN_IN_MANDATORY_BOUNCE" for mandatory login flows.',
      ),
  }),
  output: z
    .object({
      verified: z
        .boolean()
        .optional()
        .describe('True when the contact was successfully verified.'),
    })
    .passthrough(),
};

// ============================================================================
// listAccountEvents
// ============================================================================

export const listAccountEventsSchema = {
  name: 'listAccountEvents',
  description:
    'List recent account security events (logins, partial logins, additional-factor logins) for the signed-in account.',
  notes:
    'count controls how many of the most recent events to return (default 100). eventTypes overrides which categories are included; default is login, partial_login, additional_factor_login.',
  input: z.object({
    count: z
      .number()
      .optional()
      .describe('Max number of recent events to return. Defaults to 100.'),
    eventTypes: z
      .array(z.string())
      .optional()
      .describe(
        'Event categories to include. Defaults to ["login", "partial_login", "additional_factor_login"].',
      ),
  }),
  output: z.object({
    events: z
      .array(AccountEventSchema)
      .describe('Recent account events, newest first. Empty when none.'),
    total: z.number().describe('Number of events returned.'),
  }),
};

// ============================================================================
// listDelegates
// ============================================================================

export const listDelegatesSchema = {
  name: 'listDelegates',
  description:
    'List the people who have delegated access to the signed-in account.',
  notes: '',
  input: z.object({
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of delegates to return per page. Default 100. Reflected in pagination.pageSize.',
      ),
    page: z
      .number()
      .optional()
      .describe(
        'Page number to return (1-indexed). Use with pageSize and pagination.totalPages to paginate.',
      ),
  }),
  output: z.object({
    delegates: z
      .array(DelegateSchema)
      .describe('People with delegated access. Empty when none.'),
    total: z.number().describe('Number of delegates returned on this page.'),
    pagination: z
      .object({
        pageSize: z
          .number()
          .optional()
          .describe('Page size used for the request.'),
        totalRecords: z
          .number()
          .optional()
          .describe('Total number of delegates across all pages.'),
        totalPages: z
          .number()
          .optional()
          .describe('Total number of pages available.'),
      })
      .optional()
      .describe('Pagination metadata returned by the API.'),
  }),
};

// ============================================================================
// createDelegateInvitation
// ============================================================================

export const createDelegateInvitationSchema = {
  name: 'createDelegateInvitation',
  description:
    'Invite a person to have delegated access to the signed-in account.',
  notes:
    'Requires a fresh HBI (high-bot-intent) step-up authentication claim. Navigate to account.godaddy.com/access to complete the step-up, then retry — a stale HBI claim returns Unauthenticated. The invitee receives an invitation they must accept before access is granted. level controls what the delegate can access: 1 = Account Connection Only (no product access), 2 = Products & Domains, 3 = Products, Domains, & Purchase (can buy using stored cards), 5 = Domains Only. Omit level to use the server default.',
  input: z.object({
    email: z.string().describe('Email address of the person to invite.'),
    level: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)])
      .optional()
      .describe(
        'Access level to grant. 1 = Account Connection Only (no product/purchase access), 2 = Products & Domains, 3 = Products, Domains, & Purchase (can buy using stored payment cards; no access to payment info), 5 = Domains Only. Omit to use the server default.',
      ),
    inviteName: z
      .string()
      .optional()
      .describe(
        'Display name of the person being invited, shown in the invitation and delegation UI.',
      ),
    role: z
      .string()
      .optional()
      .describe('Access role to grant, when the account supports named roles.'),
    permissions: z
      .array(z.string())
      .optional()
      .describe('Specific permission codes to grant, when supported.'),
  }),
  output: z.object({
    invitation: DelegateInvitationSchema.describe(
      'The invitation that was created.',
    ),
  }),
};

// ============================================================================
// Registry + types
// ============================================================================

export const accountSecuritySchemas = [
  listSecurityFactorsSchema,
  addSecurityFactorSchema,
  removeSecurityFactorSchema,
  getSecurityOptionsSchema,
  updateSecurityOptionsSchema,
  requestContactVerificationSchema,
  verifyContactSchema,
  listAccountEventsSchema,
  listDelegatesSchema,
  createDelegateInvitationSchema,
];

export type SecurityFactor = z.infer<typeof SecurityFactorSchema>;
export type AccountEvent = z.infer<typeof AccountEventSchema>;
export type Delegate = z.infer<typeof DelegateSchema>;
export type SecurityOptions = z.infer<typeof SecurityOptionsSchema>;
export type DelegateInvitation = z.infer<typeof DelegateInvitationSchema>;

export type ListSecurityFactorsOutput = z.infer<
  typeof listSecurityFactorsSchema.output
>;
export type AddSecurityFactorOutput = z.infer<
  typeof addSecurityFactorSchema.output
>;
export type RemoveSecurityFactorOutput = z.infer<
  typeof removeSecurityFactorSchema.output
>;
export type GetSecurityOptionsOutput = z.infer<
  typeof getSecurityOptionsSchema.output
>;
export type UpdateSecurityOptionsOutput = z.infer<
  typeof updateSecurityOptionsSchema.output
>;
export type RequestContactVerificationOutput = z.infer<
  typeof requestContactVerificationSchema.output
>;
export type VerifyContactOutput = z.infer<typeof verifyContactSchema.output>;
export type ListAccountEventsOutput = z.infer<
  typeof listAccountEventsSchema.output
>;
export type ListDelegatesOutput = z.infer<typeof listDelegatesSchema.output>;
export type CreateDelegateInvitationOutput = z.infer<
  typeof createDelegateInvitationSchema.output
>;
