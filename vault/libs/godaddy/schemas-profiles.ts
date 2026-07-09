import { z } from 'zod';

// ============================================================================
// Shared entity shape
// ============================================================================

/**
 * A domain profile: a named, reusable bundle of domain settings that can be
 * applied to many domains at once. Which settings a profile manages varies —
 * fields are present only when the profile manages them. Unknown fields pass
 * through, so the safe edit flow is: read a profile via listDomainProfiles,
 * change the fields you want, and pass the whole object back to
 * updateDomainProfile.
 */
export const DomainProfileSchema = z
  .object({
    profileId: z
      .string()
      .describe(
        'Profile id. Use with updateDomainProfile / deleteDomainProfile / applyDomainProfile.',
      ),
    name: z.string().optional().describe('Human-readable profile name.'),
    description: z
      .string()
      .optional()
      .describe('Optional free-text description of the profile.'),
    renewAuto: z
      .object({
        apply: z.boolean().describe('Whether this profile manages auto-renew.'),
        enabled: z
          .boolean()
          .optional()
          .describe('Auto-renew state when apply is true.'),
      })
      .optional()
      .describe(
        'Auto-renew setting. apply=true means the profile enforces auto-renew; enabled=true = always on, enabled=false = always off.',
      ),
    locking: z
      .object({
        apply: z
          .boolean()
          .describe('Whether this profile manages registrar lock.'),
        enabled: z
          .boolean()
          .optional()
          .describe('Lock state when apply is true.'),
      })
      .optional()
      .describe(
        'Registrar (transfer) lock setting. apply=true means the profile enforces locking; enabled=true = always locked, enabled=false = always unlocked.',
      ),
    nameServers: z
      .object({
        apply: z
          .boolean()
          .describe('Whether this profile manages nameservers.'),
        source: z
          .enum(['HOSTED', 'PARKED', 'CUSTOM'])
          .optional()
          .describe(
            'HOSTED = GoDaddy nameservers; PARKED = parked/inactive nameservers; CUSTOM = caller-supplied nameservers.',
          ),
        hostnames: z
          .array(z.string())
          .optional()
          .describe(
            'Custom nameserver hostnames, required when source is CUSTOM.',
          ),
      })
      .optional()
      .describe(
        'Nameserver setting. apply=true means the profile enforces nameservers.',
      ),
    contacts: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Contact settings. Shape: {apply: boolean, ...contact data}. apply=true means the profile enforces contact info.',
      ),
    forwarding: z
      .object({
        apply: z.boolean().describe('Whether this profile manages forwarding.'),
        enabled: z.boolean().optional().describe('Whether forwarding is on.'),
        httpStatus: z
          .enum(['MOVED', 'FOUND'])
          .optional()
          .describe(
            'Redirect type: "MOVED" = 301 Permanent, "FOUND" = 302 Temporary. Note: masked profiles also show "MOVED" — use masked=true to detect masking.',
          ),
        masked: z
          .boolean()
          .optional()
          .describe(
            'True when Forward with masking is active. The only reliable way to detect masking; httpStatus alone cannot distinguish masked from a standard 301.',
          ),
        uri: z
          .string()
          .optional()
          .describe(
            'Forwarding destination URL including protocol, e.g. "https://example.com".',
          ),
        maskingTitle: z
          .string()
          .optional()
          .describe('Page title shown when masking is enabled.'),
        maskingDescription: z
          .string()
          .optional()
          .describe('Meta description shown when masking is enabled.'),
        maskingKeywords: z
          .string()
          .optional()
          .describe('Meta keywords shown when masking is enabled.'),
      })
      .passthrough()
      .optional()
      .describe(
        'Forwarding settings. apply=true enforces forwarding. httpStatus: "MOVED" = 301, "FOUND" = 302. For masking, check masked=true — masked profiles also show httpStatus "MOVED", so httpStatus alone cannot distinguish masking from a standard 301.',
      ),
  })
  .passthrough()
  .describe(
    'A domain profile — a named bundle of domain settings applied to many domains at once.',
  );

// Writable settings shared by create + update inputs. Pair with `.passthrough()`
// on the input object so callers can round-trip any extra keys a profile carries.
const profileWritableFields = {
  description: z
    .string()
    .optional()
    .describe('Optional free-text description of the profile.'),
  privacy: z
    .boolean()
    .optional()
    .describe(
      'Domain privacy setting the profile should apply. Write-only: the API does not return this field in the profile response, so the applied privacy state cannot be confirmed from the update output. Verify the effect using getDomainPrivacy on a targeted domain after applying the profile.',
    ),
  contacts: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Contacts the profile should apply. Shape: {apply: boolean, ...contact data}. apply=true enforces contact info.',
    ),
  forwarding: z
    .object({
      apply: z.boolean().describe('Whether this profile manages forwarding.'),
      enabled: z.boolean().optional().describe('Whether forwarding is on.'),
      httpStatus: z
        .enum(['MOVED', 'FOUND'])
        .optional()
        .describe(
          'Redirect type: "MOVED" = 301 Permanent, "FOUND" = 302 Temporary. Omit when using masking (masked=true).',
        ),
      masked: z
        .boolean()
        .optional()
        .describe(
          'True to enable Forward with masking. When true, supply uri; httpStatus is not used.',
        ),
      uri: z
        .string()
        .optional()
        .describe('Forwarding destination URL, e.g. "https://example.com".'),
      maskingTitle: z
        .string()
        .optional()
        .describe('Page title shown when masking is enabled.'),
      maskingDescription: z
        .string()
        .optional()
        .describe('Meta description shown when masking is enabled.'),
      maskingKeywords: z
        .string()
        .optional()
        .describe('Meta keywords shown when masking is enabled.'),
    })
    .passthrough()
    .optional()
    .describe(
      'Forwarding settings. apply=true enforces forwarding on targeted domains. httpStatus: "MOVED" = 301 Permanent, "FOUND" = 302 Temporary. For masking, set masked=true (httpStatus is not used for masking; GoDaddy stores masked profiles with httpStatus "MOVED"). Masking is only detectable via masked=true in the response.',
    ),
  renewAuto: z
    .object({
      apply: z.boolean().describe('Whether this profile manages auto-renew.'),
      enabled: z
        .boolean()
        .optional()
        .describe('Auto-renew state: true = always on, false = always off.'),
    })
    .optional()
    .describe(
      'Auto-renew using native API format. Prefer over autoRenew. apply=true + enabled=true = always on; apply=true + enabled=false = always off; apply=false = not managed.',
    ),
  locking: z
    .object({
      apply: z
        .boolean()
        .describe('Whether this profile manages registrar lock.'),
      enabled: z
        .boolean()
        .optional()
        .describe('Lock state: true = always locked, false = always unlocked.'),
    })
    .optional()
    .describe(
      'Registrar lock using native API format. Prefer over registrarLock. apply=true + enabled=true = always locked; apply=true + enabled=false = always unlocked.',
    ),
  nameServers: z
    .object({
      apply: z.boolean().describe('Whether this profile manages nameservers.'),
      source: z
        .enum(['HOSTED', 'PARKED', 'CUSTOM'])
        .optional()
        .describe(
          'HOSTED = GoDaddy nameservers; PARKED = parked/inactive nameservers; CUSTOM = caller-supplied (requires hostnames).',
        ),
      hostnames: z
        .array(z.string())
        .optional()
        .describe('Custom nameserver hostnames when source is CUSTOM.'),
    })
    .optional()
    .describe(
      'Nameservers using native API format. Prefer over nameservers. source=HOSTED for GoDaddy nameservers; source=CUSTOM with hostnames for custom.',
    ),
};

// ============================================================================
// Schemas
// ============================================================================

export const listDomainProfilesSchema = {
  name: 'listDomainProfiles',
  description:
    'List the saved domain profiles on the account (reusable bundles of domain settings).',
  notes:
    'A domain profile bundles settings — auto-renew, registrar lock, privacy, nameservers, contacts, and forwarding — so they can be applied to many domains at once. Returns an empty list when no profiles exist.',
  input: z.object({}),
  output: z.object({
    profiles: z
      .array(DomainProfileSchema)
      .describe('Saved domain profiles. Empty when none exist.'),
    total: z.number().describe('Number of profiles returned.'),
  }),
};

export const createDomainProfileSchema = {
  name: 'createDomainProfile',
  description:
    'Create a new domain profile (a reusable bundle of domain settings).',
  notes:
    'Provide a name plus the settings the profile manages; omitted settings are simply not managed by the profile. Creating a profile does not change any domain — apply it with applyDomainProfile. Setting keys mirror the shape returned by listDomainProfiles; extra keys are passed through.',
  input: z
    .object({
      name: z.string().describe('Name for the new profile.'),
      ...profileWritableFields,
    })
    .passthrough(),
  output: z.object({
    profile: DomainProfileSchema.describe(
      'The created profile, including its new profileId.',
    ),
  }),
};

export const updateDomainProfileSchema = {
  name: 'updateDomainProfile',
  description: "Update an existing domain profile's name and/or settings.",
  notes:
    'Supply profileId plus only the fields you want to change. Unspecified fields retain their current values. Updating a profile does not re-apply it to already-targeted domains.',
  input: z
    .object({
      profileId: z
        .string()
        .describe('Id of the profile to update (from listDomainProfiles).'),
      name: z
        .string()
        .min(1)
        .optional()
        .describe(
          'New name for the profile. Must be a non-empty string. Omit entirely to keep the current name.',
        ),
      ...profileWritableFields,
    })
    .passthrough(),
  output: z.object({
    profile: DomainProfileSchema.describe('The updated profile.'),
  }),
};

export const deleteDomainProfileSchema = {
  name: 'deleteDomainProfile',
  description: 'Delete a domain profile.',
  notes:
    'Deletes only the profile definition; domains previously targeted by it keep their current settings. Returns deleted: true on success.',
  input: z.object({
    profileId: z
      .string()
      .describe('Id of the profile to delete (from listDomainProfiles).'),
  }),
  output: z.object({
    profileId: z.string().describe('Id of the deleted profile.'),
    deleted: z.boolean().describe('True when the profile was deleted.'),
  }),
};

export const applyDomainProfileSchema = {
  name: 'applyDomainProfile',
  description: "Apply a profile's settings to one or more domains.",
  notes:
    "Applies the profile's managed settings (auto-renew, registrar lock, privacy, nameservers, contacts, forwarding) to the given domains, changing those settings on each domain. Domain names are fully qualified, e.g. example.com.",
  input: z.object({
    profileId: z
      .string()
      .describe('Id of the profile to apply (from listDomainProfiles).'),
    domainNames: z
      .array(z.string())
      .min(1)
      .describe(
        'Fully-qualified domain names to apply the profile to, e.g. ["example.com"].',
      ),
  }),
  output: z.object({
    profileId: z.string().describe('Id of the applied profile.'),
    applied: z
      .array(z.string())
      .describe('Domain names the profile was applied to.'),
    count: z.number().describe('Number of domains the profile was applied to.'),
  }),
};

// REQUIRED: single array the merge step spreads into allSchemas (declaration order).
export const profilesSchemas = [
  listDomainProfilesSchema,
  createDomainProfileSchema,
  updateDomainProfileSchema,
  deleteDomainProfileSchema,
  applyDomainProfileSchema,
];

// ============================================================================
// Inferred output types
// ============================================================================

export type DomainProfile = z.infer<typeof DomainProfileSchema>;
export type ListDomainProfilesOutput = z.infer<
  typeof listDomainProfilesSchema.output
>;
export type CreateDomainProfileOutput = z.infer<
  typeof createDomainProfileSchema.output
>;
export type UpdateDomainProfileOutput = z.infer<
  typeof updateDomainProfileSchema.output
>;
export type DeleteDomainProfileOutput = z.infer<
  typeof deleteDomainProfileSchema.output
>;
export type ApplyDomainProfileOutput = z.infer<
  typeof applyDomainProfileSchema.output
>;
