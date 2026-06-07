import { z } from 'zod';

// ============================================================================
// Shared types for settings functions
// ============================================================================

const OrgUserSchema = z.object({
  id: z.string().describe('User ID'),
  firstName: z.string().describe('First name'),
  lastName: z.string().describe('Last name'),
  username: z.string().describe('Email address'),
  role: z.string().describe('Org role: owner, admin, member'),
  orgUserId: z.string().describe('Org-specific user ID'),
  deactivatedAt: z
    .string()
    .nullable()
    .describe('Deactivation timestamp or null if active'),
  deactivationReason: z
    .string()
    .nullable()
    .describe('Reason for deactivation or null'),
});

export type OrgUser = z.infer<typeof OrgUserSchema>;

const CreditPoolDetailSchema = z.object({
  key: z.number().describe('Credit pool key identifier'),
  label: z.string().describe('Human-readable pool name'),
  credits: z.number().describe('Total credits allocated'),
  creditsRemaining: z.number().describe('Credits remaining'),
  searchCredits: z.number().describe('Total search credits'),
  searchCreditsRemaining: z.number().describe('Search credits remaining'),
  companySaveCredits: z.number().describe('Company save credits allocated'),
  companySaveCreditsRemaining: z
    .number()
    .describe('Company save credits remaining'),
  licenseType: z
    .string()
    .nullable()
    .describe('License type: free, pro, enterprise'),
  licenseStatus: z
    .string()
    .nullable()
    .describe('License status: trial, active, etc.'),
  bonusCredits: z.number().describe('Bonus credits'),
  licenseCreditPeriodEndsAt: z
    .string()
    .nullable()
    .describe('When the current credit period ends (ISO date)'),
});

export type CreditPoolDetail = z.infer<typeof CreditPoolDetailSchema>;

const IndustryChildSchema = z.object({
  label: z.string().describe('Display name'),
  value: z.string().describe('Value for search filters'),
  apiValue: z.string().describe('API value (same as value)'),
});

const IndustrySchema = z.object({
  label: z.string().describe('Category display name'),
  value: z.string().describe('Category value for search filters'),
  apiValue: z.string().describe('API value (same as value)'),
  children: z
    .array(IndustryChildSchema)
    .describe('Sub-industries within this category'),
});

export type Industry = z.infer<typeof IndustrySchema>;

const ROIMetricsSchema = z.object({
  opportunitiesCreated: z.number().describe('Total opportunities created'),
  pipelineGenerated: z.number().describe('Pipeline value generated'),
  sales: z.number().describe('Total sales closed'),
  revenue: z.number().describe('Revenue generated'),
  returnOnInvestment: z.number().describe('ROI percentage'),
  averageDealSize: z.number().describe('Average deal size'),
  costPerLead: z.number().describe('Cost per lead'),
  costPerOpportunity: z.number().describe('Cost per opportunity'),
  costPerSale: z.number().describe('Cost per sale'),
  researchedLeads: z.number().describe('Total researched leads'),
  searchedLeads: z.number().describe('Total searched leads'),
  minutesSaved: z.number().describe('Minutes saved'),
  hoursSaved: z.number().describe('Hours saved'),
  daysSaved: z.number().describe('Days saved'),
});

export type ROIMetrics = z.infer<typeof ROIMetricsSchema>;

const ConnectedEmailSchema = z.object({
  email: z.string().describe('Connected email address'),
  provider: z
    .string()
    .optional()
    .describe('Email provider (gmail, outlook, etc.)'),
  isActive: z.boolean().optional().describe('Whether the connection is active'),
});

export type ConnectedEmail = z.infer<typeof ConnectedEmailSchema>;

const EmailSignatureSchema = z.object({
  emailSignatureId: z.string().describe('Signature ID (empty if none set)'),
  signature: z.string().describe('HTML signature content (empty if none set)'),
  isDefault: z.boolean().describe('Whether this is the default signature'),
});

export type EmailSignature = z.infer<typeof EmailSignatureSchema>;

const ContactStatusSchema = z.object({
  id: z.string().describe('Status ID'),
  name: z.string().describe('Status display name'),
  color: z.string().optional().describe('Status color hex code'),
  order: z.number().optional().describe('Display order'),
});

export type ContactStatus = z.infer<typeof ContactStatusSchema>;

const CallDispositionSchema = z.object({
  id: z.string().describe('Disposition ID'),
  name: z.string().describe('Disposition display name'),
  order: z.number().optional().describe('Display order'),
});

export type CallDisposition = z.infer<typeof CallDispositionSchema>;

// ============================================================================
// listOrgUsers
// ============================================================================

export const listOrgUsersSchema = {
  name: 'listOrgUsers',
  description:
    'List organization team members with their roles and license information.',
  notes: 'Requires orgId from getContext().',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
  }),
  output: z.object({
    users: z.array(OrgUserSchema).describe('Organization team members'),
  }),
};

export type ListOrgUsersInput = z.infer<typeof listOrgUsersSchema.input>;
export type ListOrgUsersOutput = z.infer<typeof listOrgUsersSchema.output>;

// ============================================================================
// getCredits
// ============================================================================

export const getCreditsSchema = {
  name: 'getCredits',
  description:
    'Get current credit balances across all pools (standard, intent, universal, etc.).',
  notes:
    'More detailed than the credits object returned by getContext(); includes bonusCredits and licenseCreditPeriodEndsAt per pool. Use this before credit-consuming operations when you need precise per-pool breakdown.',
  input: z.object({}),
  output: z.object({
    pools: z
      .record(z.string(), CreditPoolDetailSchema)
      .describe(
        'Credit pools keyed by name. Keys: standard, intent, universal, bullhorn, publicAPI, connect, campaign, inbox',
      ),
  }),
};

export type GetCreditsInput = z.infer<typeof getCreditsSchema.input>;
export type GetCreditsOutput = z.infer<typeof getCreditsSchema.output>;

// ============================================================================
// listIndustries
// ============================================================================

export const listIndustriesSchema = {
  name: 'listIndustries',
  description:
    'Get the full industry taxonomy for use in searchContacts industry filters. Returns categories with sub-industries.',
  notes:
    'Use the value or apiValue field from a returned industry/sub-industry as the string to pass in the industries array of searchContacts or searchCompanies.',
  input: z.object({}),
  output: z.object({
    industries: z
      .array(IndustrySchema)
      .describe('Industry categories with nested sub-industries'),
  }),
};

export type ListIndustriesInput = z.infer<typeof listIndustriesSchema.input>;
export type ListIndustriesOutput = z.infer<typeof listIndustriesSchema.output>;

// ============================================================================
// getDashboardROI
// ============================================================================

export const getDashboardROISchema = {
  name: 'getDashboardROI',
  description:
    'Get ROI dashboard metrics including pipeline generated, opportunities created, revenue, and time saved.',
  notes: 'Requires orgId from getContext().',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
  }),
  output: z.object({
    metrics: ROIMetricsSchema.describe('ROI dashboard metrics'),
    dashboardType: z.string().describe('Dashboard type: statistic or other'),
    enabledCrms: z
      .array(z.string())
      .describe('CRM integrations enabled (e.g., salesforce)'),
  }),
};

export type GetDashboardROIInput = z.infer<typeof getDashboardROISchema.input>;
export type GetDashboardROIOutput = z.infer<
  typeof getDashboardROISchema.output
>;

// ============================================================================
// listConnectedEmails
// ============================================================================

export const listConnectedEmailsSchema = {
  name: 'listConnectedEmails',
  description: 'Get connected email accounts for the organization.',
  notes: 'Requires orgId from getContext().',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
  }),
  output: z.object({
    emails: z
      .array(ConnectedEmailSchema)
      .describe('Connected email accounts (empty array if none connected)'),
  }),
};

export type ListConnectedEmailsInput = z.infer<
  typeof listConnectedEmailsSchema.input
>;
export type ListConnectedEmailsOutput = z.infer<
  typeof listConnectedEmailsSchema.output
>;

// ============================================================================
// getEmailSignature
// ============================================================================

export const getEmailSignatureSchema = {
  name: 'getEmailSignature',
  description: 'Get the default email signature for the organization.',
  notes: 'Requires orgId from getContext().',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
  }),
  output: EmailSignatureSchema.describe('Email signature data'),
};

export type GetEmailSignatureInput = z.infer<
  typeof getEmailSignatureSchema.input
>;
export type GetEmailSignatureOutput = z.infer<
  typeof getEmailSignatureSchema.output
>;

// ============================================================================
// listContactStatuses
// ============================================================================

export const listContactStatusesSchema = {
  name: 'listContactStatuses',
  description:
    'Get prospect/contact status options configured for the organization.',
  notes: 'Requires orgId from getContext().',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
  }),
  output: z.object({
    statuses: z
      .array(ContactStatusSchema)
      .describe('Contact status options (empty array if none configured)'),
  }),
};

export type ListContactStatusesInput = z.infer<
  typeof listContactStatusesSchema.input
>;
export type ListContactStatusesOutput = z.infer<
  typeof listContactStatusesSchema.output
>;

// ============================================================================
// listCallDispositions
// ============================================================================

export const listCallDispositionsSchema = {
  name: 'listCallDispositions',
  description: 'Get call disposition options configured for the organization.',
  notes: 'Requires orgId from getContext().',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
  }),
  output: z.object({
    dispositions: z
      .array(CallDispositionSchema)
      .describe('Call disposition options (empty array if none configured)'),
  }),
};

export type ListCallDispositionsInput = z.infer<
  typeof listCallDispositionsSchema.input
>;
export type ListCallDispositionsOutput = z.infer<
  typeof listCallDispositionsSchema.output
>;

// ============================================================================
// allSchemas (for merging into root schemas.ts)
// ============================================================================

export const settingsSchemas = [
  listOrgUsersSchema,
  getCreditsSchema,
  listIndustriesSchema,
  getDashboardROISchema,
  listConnectedEmailsSchema,
  getEmailSignatureSchema,
  listContactStatusesSchema,
  listCallDispositionsSchema,
];
