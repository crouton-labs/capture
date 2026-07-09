import { z } from 'zod';

// ============================================================================
// Shared entity shapes
// ============================================================================

export const AccountContactSchema = z
  .object({
    firstName: z.string().optional().describe('Contact first / given name.'),
    lastName: z.string().optional().describe('Contact last / family name.'),
    email: z.string().optional().describe('Contact email address.'),
    phone: z.string().optional().describe('Contact phone number.'),
    organization: z
      .string()
      .optional()
      .describe('Company / organization name, when set.'),
    address1: z.string().optional().describe('Street address line 1.'),
    address2: z.string().optional().describe('Street address line 2.'),
    city: z.string().optional().describe('City / locality.'),
    state: z.string().optional().describe('State / province / region.'),
    postalCode: z.string().optional().describe('Postal / ZIP code.'),
    country: z
      .string()
      .optional()
      .describe('Country, ISO code where available (e.g. "US").'),
  })
  .passthrough()
  .describe(
    'Account holder contact details. Only commonly-present fields are typed; provider-specific keys pass through.',
  );

export const ValidateSessionDetailsSchema = z
  .object({
    type: z
      .string()
      .optional()
      .describe('Auth type reported by the session validator (e.g. "basic").'),
    plid: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Private label id (plid); 1 for retail GoDaddy.'),
    customerId: z
      .string()
      .optional()
      .describe('Customer UUID the session resolves to.'),
    cid: z
      .string()
      .optional()
      .describe('Customer UUID alias returned by the validator.'),
    shopperId: z
      .string()
      .optional()
      .describe('Numeric shopper id the session resolves to.'),
    privateLabelType: z
      .number()
      .optional()
      .describe('Private label type code reported by the validator.'),
  })
  .passthrough()
  .describe('Identity details returned by the session validator.');

// ============================================================================
// validateSession
// ============================================================================

export const validateSessionSchema = {
  name: 'validateSession',
  description:
    'Check whether the current browser session is a signed-in, valid GoDaddy session and read the identity it resolves to (realm, auth type, shopper/customer ids).',
  notes:
    'Must be called from a dcc.godaddy.com page (e.g. navigate to https://dcc.godaddy.com/control/portfolio first — the validate endpoint is same-origin only and will fail with a fetch error from any other domain). Throws an authentication error when the session is missing or expired. Identity fields (`type`, `shopperId`, `customerId`, etc.) are returned inside the `details` object. Pass `risk: "high"` to check whether the session satisfies MFA/elevated auth — returns `{valid:false, authReason:2, reason:"Token is expired (ssoCode: 2)"}` when only basic auth is present (note: despite the "expired" wording in `reason`, this means auth level is insufficient, not that the token is actually expired — prompt for MFA, not re-login). The `jomax` and `cert` realms require employee/certificate tokens; calling them without those tokens returns `{valid:false, reason:"Missing token in header or cookie"}` rather than throwing.',
  input: z.object({
    realm: z
      .enum(['idp', 'jomax', 'cert'])
      .optional()
      .describe(
        'Auth realm to validate. "idp" (default) = standard GoDaddy identity provider — use for all normal account operations. "jomax" = employee/internal realm; "cert" = certificate-management realm. Omit for the default "idp" realm.',
      ),
    risk: z
      .enum(['low', 'medium', 'high'])
      .optional()
      .describe(
        'Minimum auth assurance level to verify. "low" = any valid session; "medium" (default) = standard session required; "high" = MFA/elevated auth required — returns valid=false with authReason when only basic auth is present. Omit for the default "medium" level.',
      ),
    type: z
      .enum(['basic', 'mfa'])
      .optional()
      .describe(
        'Assert a required auth type. "basic" = password-only session; "mfa" = multi-factor session. When the current session auth type does not match, returns valid=false with a reason message (e.g. "Token auth (basic) does not match GdAuth auths (mfa)"). Omit to accept any auth type.',
      ),
    allowHeartbeat: z
      .boolean()
      .optional()
      .describe(
        'When true, extends/refreshes the session token as part of the validate call (heartbeat). Omit or set false to validate without modifying session expiry.',
      ),
    use12HourExpiration: z
      .boolean()
      .optional()
      .describe(
        'When true, enforces a strict 12-hour token expiry check — returns valid=false with authReason:1 ("Token is expired") if the session is older than 12 hours, even if it has not yet expired under the default longer window. Omit for the default expiry behavior.',
      ),
    plid: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        'Private label id. Forwarded to the upstream validator but the server ignores it — validation always resolves against the session\'s actual brand regardless of this value. Omit in all normal cases.',
      ),
    groups: z
      .string()
      .optional()
      .describe(
        'Comma-separated group ids forwarded to upstream. The server does not enforce group membership — passing a nonexistent group id still returns valid=true. This parameter has no observable access-control effect. Omit.',
      ),
  }),
  output: z
    .object({
      valid: z
        .boolean()
        .describe('Whether the current session is authenticated and valid.'),
      realm: z
        .string()
        .optional()
        .describe(
          'Auth realm the session belongs to (e.g. "idp"). Treat as opaque.',
        ),
      details: ValidateSessionDetailsSchema.describe(
        'Identity payload returned by the validator. Contains auth type, shopper/customer ids, plid, and privateLabelType.',
      ),
      authReason: z
        .number()
        .optional()
        .describe(
          'Numeric error code when valid=false (ssoCode from the upstream validator). Present on auth-level failures (e.g. risk=high without MFA: authReason=2) but absent on type-mismatch failures (e.g. type=mfa when session is basic-only). Use the `reason` string to distinguish.',
        ),
      reason: z
        .string()
        .optional()
        .describe(
          'Human-readable explanation when valid=false. Auth-level failures (risk=high without MFA) return "Token is expired (ssoCode: 2)" — despite the "expired" wording this means insufficient auth level, not actual token expiry; prompt for MFA, not re-login. Type-mismatch failures return e.g. "Token auth (basic) does not match GdAuth auths (mfa)" with no authReason.',
        ),
    })
    .passthrough(),
};

// ============================================================================
// getAccountProfile
// ============================================================================

export const getAccountProfileSchema = {
  name: 'getAccountProfile',
  description:
    'Get the signed-in account holder profile: shopper/customer ids, login email, and optionally contact details, preferences, and account timestamps.',
  notes:
    'Operates on the signed-in session. Pass `includes` to request extra sections: "contact" adds name/address/timezone, "preference" adds currency/locale/communication settings, "customerSince" adds account creation date. Combine as a comma-separated string (e.g. "contact,preference"). shopperId, customerId, email, loginName, privateLabelId, hasCredentials, createdAt, and updatedAt are always returned regardless of includes.',
  input: z.object({
    includes: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of extra sections to include in the response. Valid values: "contact" (nameFirst, nameLast, address, timeZone), "preference" (currency, marketId, allowedCommunicationTypes), "customerSince" (account creation date). Example: "contact,preference".',
      ),
  }),
  output: z.object({
    profile: z
      .object({
        shopperId: z.string().optional().describe('Numeric shopper id.'),
        customerId: z.string().optional().describe('Customer UUID.'),
        email: z.string().optional().describe('Account login email.'),
        loginName: z
          .string()
          .optional()
          .describe('Login username (typically same as email).'),
        privateLabelId: z
          .union([z.string(), z.number()])
          .optional()
          .describe('Private label id (plid); 1 for retail GoDaddy.'),
        hasCredentials: z
          .boolean()
          .optional()
          .describe('Whether the account has credentials set.'),
        createdAt: z
          .string()
          .optional()
          .describe('Account creation timestamp (ISO 8601).'),
        updatedAt: z
          .string()
          .optional()
          .describe('Account last-updated timestamp (ISO 8601).'),
        customerSince: z
          .string()
          .optional()
          .describe(
            'Customer-since date (ISO 8601). Present when includes contains "customerSince".',
          ),
        contact: z
          .object({
            nameFirst: z.string().optional().describe('First name.'),
            nameLast: z.string().optional().describe('Last name.'),
            address: z
              .object({
                address1: z
                  .string()
                  .optional()
                  .describe('Street address line 1.'),
                address2: z
                  .string()
                  .optional()
                  .describe('Street address line 2.'),
                city: z.string().optional().describe('City.'),
                state: z.string().optional().describe('State / province.'),
                postalCode: z
                  .string()
                  .optional()
                  .describe('Postal / ZIP code.'),
                country: z
                  .string()
                  .optional()
                  .describe('Country ISO code (e.g. "US").'),
              })
              .passthrough()
              .optional()
              .describe('Mailing address.'),
            timeZone: z
              .string()
              .optional()
              .describe('IANA timezone (e.g. "America/Chicago").'),
          })
          .passthrough()
          .optional()
          .describe('Contact block. Present when includes contains "contact".'),
        preference: z
          .object({
            currency: z
              .string()
              .optional()
              .describe('Preferred currency code (e.g. "USD").'),
            marketId: z
              .string()
              .optional()
              .describe('Market locale (e.g. "en-US").'),
            allowedCommunicationTypes: z
              .array(z.string())
              .optional()
              .describe('Communication opt-in types.'),
          })
          .passthrough()
          .optional()
          .describe(
            'Account preferences. Present when includes contains "preference".',
          ),
      })
      .passthrough()
      .describe(
        'Signed-in account holder profile. Extra sections (contact, preference, customerSince) appear only when requested via includes.',
      ),
  }),
};

// ============================================================================
// updateAccountProfile
// ============================================================================

export const updateAccountProfileSchema = {
  name: 'updateAccountProfile',
  description:
    'Update the signed-in account holder contact details (name, email, phone, organization, postal address, timezone).',
  notes:
    'Operates on the signed-in session. Pass only the fields to change; omitted fields are left unchanged, and at least one non-empty field is required (empty strings are treated as absent). Name (firstName/lastName), email, organization, and address fields require a GoDaddy session verified within the last 60 minutes — if the call returns a PermissionDenied error, the user must sign in to GoDaddy again to refresh their session. Phone and timeZone work with any valid session. Account writes are eventually consistent.',
  input: z.object({
    firstName: z.string().optional().describe('New first / given name.'),
    lastName: z.string().optional().describe('New last / family name.'),
    email: z.string().optional().describe('New account contact email.'),
    phone: z.string().optional().describe('New contact phone number.'),
    organization: z
      .string()
      .optional()
      .describe('New company / organization name.'),
    address1: z.string().optional().describe('New street address line 1.'),
    address2: z.string().optional().describe('New street address line 2.'),
    city: z.string().optional().describe('New city / locality.'),
    state: z.string().optional().describe('New state / province / region.'),
    postalCode: z.string().optional().describe('New postal / ZIP code.'),
    country: z
      .string()
      .optional()
      .describe('New country, ISO code where available (e.g. "US").'),
    timeZone: z
      .string()
      .optional()
      .describe(
        'New IANA timezone (e.g. "America/Chicago", "America/New_York").',
      ),
  }),
  output: z.object({
    updated: z.boolean().describe('True when the contact update was accepted.'),
    profile: AccountContactSchema.optional().describe(
      'Updated contact details echoed by the write, when returned.',
    ),
  }),
};

// ============================================================================
// getShopperPreferences
// ============================================================================

export const getShopperPreferencesSchema = {
  name: 'getShopperPreferences',
  description:
    'Get the signed-in account preference settings — currency, market locale, and communication opt-ins.',
  notes:
    'Operates on the signed-in session; takes no arguments. The keys returned here are the valid `type` values for updateShopperPreferences. Returns an empty object when no preferences are set.',
  input: z.object({}),
  output: z.object({
    preferences: z
      .object({
        currency: z
          .string()
          .optional()
          .describe('Preferred currency code (e.g. "USD").'),
        marketId: z
          .string()
          .optional()
          .describe('Market locale code (e.g. "en-US").'),
        allowedCommunicationTypes: z
          .array(z.string())
          .optional()
          .describe('Communication channel opt-in keys currently enabled.'),
      })
      .passthrough()
      .describe(
        'Account preference settings. Known fields: currency, marketId, allowedCommunicationTypes. Each key here is a valid `type` for updateShopperPreferences.',
      ),
  }),
};

// ============================================================================
// updateShopperPreferences
// ============================================================================

export const updateShopperPreferencesSchema = {
  name: 'updateShopperPreferences',
  description:
    'Update one preference category for the signed-in account (currency, market locale, or communication opt-ins).',
  notes:
    'Operates on the signed-in session. Pass "currency" to set the preferred currency code (e.g. "USD", "GBP", "EUR") — the API accepts any string but only recognized currency codes take effect on the account. Pass "marketId" to set the market locale; the API enforces a server-side enum and returns 422 for unrecognized locales — valid values: ar-AE, da-DK, de-AT, de-CH, de-DE, en-AE, en-AU, en-CA, en-GB, en-HK, en-IE, en-IL, en-IN, en-MY, en-NZ, en-PH, en-PK, en-SG, en-US, en-ZA, es-AR, es-CL, es-CO, es-ES, es-MX, es-PE, es-US, fr-BE, fr-CA, fr-CH, fr-FR, hi-IN, id-ID, it-CH, it-IT, ja-JP, ko-KR, mr-IN, nb-NO, nl-BE, nl-NL, pl-PL, pt-BR, pt-PT, ru-RU, sv-SE, ta-IN, th-TH, tr-TR, uk-UA, vi-VN, zh-HK, zh-SG, zh-TW. Pass "allowedCommunicationTypes" with an array of opt-in channel keys; known valid values: "email", "sms"; pass [] to clear all.',
  input: z.object({
    type: z
      .enum(['currency', 'marketId', 'allowedCommunicationTypes'])
      .describe(
        'Preference category to update. "currency" = preferred currency code; "marketId" = market locale; "allowedCommunicationTypes" = communication channel opt-ins.',
      ),
    value: z
      .union([z.string(), z.array(z.string())])
      .describe(
        'New value for the preference. String for "currency" (e.g. "USD") and "marketId" (e.g. "en-US"). Array of strings for "allowedCommunicationTypes" (e.g. ["email", "sms"] or [] to clear).',
      ),
  }),
  output: z.object({
    updated: z
      .boolean()
      .describe('True when the preference update was accepted.'),
    type: z.string().describe('The preference category that was updated.'),
  }),
};

// ============================================================================
// getCustomerSegment
// ============================================================================

export const getCustomerSegmentSchema = {
  name: 'getCustomerSegment',
  description:
    'Get the customer-type / segmentation classification for the signed-in account. Without segmentId returns the bulk classification payload. With segmentId checks whether the account belongs to a specific named segment and returns its value.',
  notes:
    'Operates on the signed-in session. Segment ids are opaque internal codes (e.g. "gdHubProAlert"); compare by exact value. Returns an empty result when the account has no classification. When segmentId is provided, inSegment=false means the account does not have that segment. scopeIdType/scopeId allow scoping the segment lookup to an entitlement or venture UUID instead of the default customerId scope.',
  input: z.object({
    segmentId: z
      .string()
      .optional()
      .describe(
        'Named segment to check (e.g. "gdHubProAlert"). When provided, performs a targeted segment lookup and returns inSegment + segmentValue instead of the bulk result. Omit to get the full bulk classification payload.',
      ),
    scopeIdType: z
      .enum(['customerId', 'entitlementId', 'ventureId'])
      .optional()
      .describe(
        'Scope type for the segment lookup. Defaults to "customerId" (the signed-in account). Use "entitlementId" or "ventureId" with a matching scopeId UUID to look up a segment for a specific entitlement or venture. Only applies when segmentId is provided.',
      ),
    scopeId: z
      .string()
      .optional()
      .describe(
        'UUID to use as the scope for the segment lookup. Required when scopeIdType is "entitlementId" or "ventureId". Defaults to the signed-in customerId when scopeIdType is "customerId" or omitted. Must be a valid UUID.',
      ),
  }),
  output: z
    .object({
      result: z
        .record(z.string(), z.unknown())
        .describe(
          'Bulk customer-type classification payload (present when segmentId is omitted). Empty object when the account has no classification or when a targeted segmentId lookup was used.',
        ),
      status: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Upstream status field from the bulk endpoint, when present.',
        ),
      errors: z
        .array(z.unknown())
        .optional()
        .describe(
          'Upstream errors array from the bulk endpoint; empty or absent on success.',
        ),
      segmentId: z
        .string()
        .optional()
        .describe(
          'The segment id checked, echoed back when segmentId was provided.',
        ),
      inSegment: z
        .boolean()
        .optional()
        .describe(
          'Whether the account belongs to the requested segment. Only present when segmentId was provided. false = not in segment; true = in segment (segmentValue will be populated).',
        ),
      segmentValue: z
        .unknown()
        .optional()
        .describe(
          'The segment payload returned by the targeted endpoint when the account is in the segment. Shape is segment-specific (e.g. {hasSeenProMessage: "Yes"} for gdHubProAlert). Only present when segmentId was provided and inSegment=true.',
        ),
    })
    .passthrough(),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const accountProfileSchemas = [
  validateSessionSchema,
  getAccountProfileSchema,
  updateAccountProfileSchema,
  getShopperPreferencesSchema,
  updateShopperPreferencesSchema,
  getCustomerSegmentSchema,
];

export type AccountContact = z.infer<typeof AccountContactSchema>;
export type ValidateSessionOutput = z.infer<
  typeof validateSessionSchema.output
>;
export type GetAccountProfileOutput = z.infer<
  typeof getAccountProfileSchema.output
>;
export type UpdateAccountProfileOutput = z.infer<
  typeof updateAccountProfileSchema.output
>;
export type GetShopperPreferencesOutput = z.infer<
  typeof getShopperPreferencesSchema.output
>;
export type UpdateShopperPreferencesOutput = z.infer<
  typeof updateShopperPreferencesSchema.output
>;
export type GetCustomerSegmentOutput = z.infer<
  typeof getCustomerSegmentSchema.output
>;
