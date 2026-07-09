import { z } from 'zod';

// ============================================================================
// Shared entity shapes
// ============================================================================

export const NotificationSchema = z
  .object({
    key: z
      .string()
      .optional()
      .describe(
        'Notification/campaign key identifier (e.g. "sms_consent"), when present.',
      ),
    campaignKey: z
      .string()
      .optional()
      .describe('Campaign key, when present. Often matches key.'),
    template: z
      .string()
      .optional()
      .describe(
        'Display template type (e.g. "link", "redirect"), when present.',
      ),
    body: z
      .string()
      .optional()
      .describe('HTML body content of the notification card, when present.'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Content categorization tags (e.g. ["account", "consent"]).'),
    ctas: z
      .array(
        z
          .object({
            text: z.string().optional().describe('CTA button label.'),
            key: z.string().optional().describe('CTA key identifier.'),
            action: z
              .string()
              .optional()
              .describe('CTA action type (e.g. "consent").'),
            consentKey: z
              .string()
              .optional()
              .describe(
                'Consent code for consent-type CTAs (e.g. "SMS_PROMOTIONAL").',
              ),
          })
          .passthrough(),
      )
      .optional()
      .describe('Call-to-action buttons on the notification, when present.'),
  })
  .passthrough()
  .describe(
    'A dashboard notification card. Field set varies by notification type; commonly-present fields are typed and the rest pass through.',
  );

export const ProjectSchema = z
  .object({
    type: z
      .string()
      .describe(
        'Product type discriminator from the product graph. Known values: "WebsiteProduct" (a Websites + Marketing site), "WAMProduct" (a Website/App/Marketing venture), "UndecidedProduct" (a project not yet assigned a product type). Other types pass through unchanged.',
      ),
    id: z
      .string()
      .optional()
      .describe('Opaque project node id from the product graph.'),
    created: z
      .string()
      .optional()
      .describe('ISO timestamp of when the project node was created.'),
    updated: z
      .string()
      .optional()
      .describe('ISO timestamp of when the project node was last updated.'),
    cursor: z
      .string()
      .optional()
      .describe(
        'Opaque pagination cursor for this edge; pass as `after` to page past this project.',
      ),
    businessName: z
      .string()
      .optional()
      .describe('Business/site display name (WebsiteProduct), when set.'),
    ventureId: z
      .string()
      .optional()
      .describe(
        'Stable venture/project id (WAMProduct). Use to reference the project elsewhere.',
      ),
    domainName: z
      .string()
      .optional()
      .describe('Domain attached to the project (WAMProduct), when set.'),
    status: z
      .string()
      .optional()
      .describe('Project lifecycle status code (WAMProduct). Treat as opaque.'),
    updateDate: z
      .string()
      .optional()
      .describe(
        'Last-updated timestamp (ISO string), WAMProduct, when present.',
      ),
    properties: z
      .unknown()
      .optional()
      .describe(
        'Raw WAM project properties bag; structure varies by project, treat as opaque.',
      ),
  })
  .passthrough()
  .describe(
    'A website or WAM (Website + App + Marketing) project owned by the signed-in account.',
  );

// ============================================================================
// listNotifications
// ============================================================================

export const listNotificationsSchema = {
  name: 'listNotifications',
  description:
    "List the signed-in account's dashboard notifications — the alert/notice cards GoDaddy surfaces on the account home and My Products views.",
  notes: '',
  input: z.object({
    manifest: z
      .string()
      .optional()
      .describe(
        'Notification component placement context. Known values: "applicationsidebar" (My Products page sidebar), "applicationheader" (account header on other pages). Omit for the default SSO bell context.',
      ),
    requestPage: z
      .string()
      .optional()
      .describe(
        'Current page URL sent for telemetry context (e.g. "https://account.godaddy.com/products"). Omit when not on a specific account page.',
      ),
    includeRad: z
      .boolean()
      .optional()
      .describe(
        'When true, includes real-time asset delivery data in the response. Used by the sidebar component on the My Products page.',
      ),
    appKey: z
      .string()
      .optional()
      .describe(
        'Application context key, forwarded as the x-app-key request header. Known values: "account" (My Products / account pages), "renewals" (renewals and billing pages). Omit to call without this header.',
      ),
  }),
  output: z.object({
    notifications: z
      .array(NotificationSchema)
      .describe(
        'Notification cards for the account. Empty array when there are none.',
      ),
    total: z.number().describe('Number of notifications returned.'),
  }),
};

// ============================================================================
// updateNotificationConsent
// ============================================================================

export const updateNotificationConsentSchema = {
  name: 'updateNotificationConsent',
  description:
    "Update one of the signed-in account's notification/marketing consent settings (e.g. opt in or out of promotional SMS, email, phone calls, WhatsApp, or mail).",
  notes:
    'value is the desired consent state: true = opted in / consent granted, false = opted out / consent withdrawn. Applies to the signed-in account; no account ids are passed.',
  input: z.object({
    consentType: z
      .enum([
        'SMS_PROMOTIONAL',
        'EMAIL_PROMOTIONAL',
        'VOICE_PROMOTIONAL',
        'WHATSAPP_GENERAL_1',
        'DIRECT_MAIL_GENERAL',
        'EMAIL_NOTIFICATION',
        'EMAIL_ACCOUNT_SUMMARY',
        'MARKETING_ADVERTISING_GENERAL',
        'SUPPORT_GENERAL',
        'OFFLINE_DATA_ADVERTISING_GENERAL_1',
      ])
      .describe(
        'Consent setting code to change. SMS_PROMOTIONAL = promotional text messages; EMAIL_PROMOTIONAL = promotional emails; VOICE_PROMOTIONAL = promotional phone calls; WHATSAPP_GENERAL_1 = WhatsApp messages; DIRECT_MAIL_GENERAL = physical promotional mail; EMAIL_NOTIFICATION = email notifications; EMAIL_ACCOUNT_SUMMARY = account summary emails; MARKETING_ADVERTISING_GENERAL = marketing/advertising; SUPPORT_GENERAL = support communications; OFFLINE_DATA_ADVERTISING_GENERAL_1 = offline data advertising.',
      ),
    value: z
      .boolean()
      .describe(
        'Desired consent state: true = opt in (consent granted), false = opt out.',
      ),
  }),
  output: z.object({
    consentType: z.string().describe('The consent setting that was updated.'),
    value: z.boolean().describe('The consent state now in effect.'),
  }),
};

// ============================================================================
// listProjects
// ============================================================================

export const listProjectsSchema = {
  name: 'listProjects',
  description:
    "List the signed-in account's website and WAM (Website + App + Marketing) projects, each with its type and identifying details.",
  notes:
    'Returns websites and ventures owned by the account (the projects behind the My Products / Websites views). Supports Relay-style cursor pagination via first/after. count is a client-side cap applied after retrieval when first/after are not used.',
  input: z.object({
    count: z
      .number()
      .optional()
      .describe('Max projects to return (client-side cap). Omit for all.'),
    first: z
      .number()
      .optional()
      .describe(
        'Page size for server-side cursor pagination. Pass with after to page through results.',
      ),
    after: z
      .string()
      .optional()
      .describe(
        'Cursor from a previous response (project.cursor or pageInfo.endCursor) to fetch the next page.',
      ),
    last: z
      .number()
      .optional()
      .describe('Page size for reverse cursor pagination. Pass with before.'),
    before: z
      .string()
      .optional()
      .describe(
        'Cursor for reverse pagination; fetches the page before this cursor.',
      ),
  }),
  output: z.object({
    projects: z
      .array(ProjectSchema)
      .describe(
        "The account's projects. Empty array when the account has none.",
      ),
    total: z.number().describe('Total projects returned in this response.'),
    pageInfo: z
      .object({
        hasNextPage: z
          .boolean()
          .describe('Whether more projects follow the last edge.'),
        hasPreviousPage: z
          .boolean()
          .describe('Whether projects precede the first edge.'),
        endCursor: z
          .string()
          .nullable()
          .describe(
            'Cursor after the last edge; pass as after for the next page.',
          ),
        startCursor: z
          .string()
          .nullable()
          .describe(
            'Cursor before the first edge; pass as before for the previous page.',
          ),
      })
      .optional()
      .describe(
        'Relay-style page info for cursor pagination. Present when first/after/last/before was used.',
      ),
  }),
};

// ============================================================================
// getProjectCounts
// ============================================================================

export const getProjectCountsSchema = {
  name: 'getProjectCounts',
  description:
    "Get a count of the signed-in account's projects broken down by product group — the per-group totals behind the My Products dashboard.",
  notes:
    'Omit groups (or pass []) to return counts for all groups the account has projects in. countsByType is keyed by group name. Known group keys: "domain", "wordpress", "vnext", "aap", "gdpayments", "qsc", "olstore".',
  input: z.object({
    groups: z
      .array(
        z.enum([
          'domain',
          'wordpress',
          'vnext',
          'aap',
          'gdpayments',
          'qsc',
          'olstore',
        ]),
      )
      .optional()
      .describe(
        'Product groups to count. Known values: "domain" (domain names), "wordpress" (Managed WordPress), "vnext" (Website Builder), "aap" (App & Packs), "gdpayments" (GoDaddy Payments), "qsc" (Quick Start Creator), "olstore" (Online Store). Omit or pass [] to return counts for all groups.',
      ),
  }),
  output: z.object({
    total: z
      .number()
      .describe('Total number of projects across all returned groups.'),
    countsByType: z
      .record(z.string(), z.number())
      .describe(
        'Map of group name to project count. Only groups with at least one project appear as keys. Empty object when the account has no projects in the requested groups.',
      ),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const accountDashboardSchemas = [
  listNotificationsSchema,
  updateNotificationConsentSchema,
  listProjectsSchema,
  getProjectCountsSchema,
];

export type Notification = z.infer<typeof NotificationSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ListNotificationsOutput = z.infer<
  typeof listNotificationsSchema.output
>;
export type UpdateNotificationConsentOutput = z.infer<
  typeof updateNotificationConsentSchema.output
>;
export type ListProjectsOutput = z.infer<typeof listProjectsSchema.output>;
export type ProjectPageInfo = NonNullable<ListProjectsOutput['pageInfo']>;
export type GetProjectCountsOutput = z.infer<
  typeof getProjectCountsSchema.output
>;
