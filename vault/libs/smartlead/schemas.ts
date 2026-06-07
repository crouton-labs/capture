import { z } from 'zod';
import { campaignSchemas } from './campaigns/schemas';
import { sequenceSchemas } from './sequences/schemas';
import { leadSchemas } from './leads/schemas';
import { campaignAccountSchemas } from './campaign-accounts/schemas';
import { emailAccountSchemas } from './email-accounts/schemas';
import { crmSchemas } from './crm/schemas';
import { prospectSchemas } from './prospect/schemas';
import { analyticsSchemas } from './analytics/schemas';
import { settingsSchemas } from './settings/schemas';

export const libraryIcon = '/icons/libs/smartlead.png';
export const loginUrl = 'https://app.smartlead.ai';

export const libraryDescription =
  'SmartLead cold email outreach and campaign management via internal APIs';
export const libraryVisibility = 'public' as const;

export const libraryNotes = `
## Workflow

1. Navigate to \`https://app.smartlead.ai/app/email-campaign/all\`
2. Call \`getContext()\` first — extracts Bearer JWT from localStorage. Required for all other calls.
3. Pass the returned \`token\` to all subsequent function calls.

## Auth Pattern

SmartLead uses Bearer JWT auth, NOT cookies. Every function requires a \`token\` parameter from \`getContext()\`. Cookie-based auth (\`credentials: include\`) alone will not work — the token must be explicitly passed in the Authorization header.

## API Surfaces

SmartLead has multiple API surfaces:
- **Internal REST** (\`server.smartlead.ai/api/\`): Bearer JWT auth. Used for campaign reads, sequences, analytics, settings.
- **v1 Public API** (\`server.smartlead.ai/api/v1/\`): api_key query param auth. Used for lead write operations.
- **GraphQL** (\`fe-gql.smartlead.ai/v1/graphql\`): Bearer JWT auth via Hasura. Used for campaign mutations (pause, update).

The \`getContext()\` function returns both \`token\` (for REST/GraphQL) and \`apiKey\` (for v1 API). Check each function's schema for which auth params it requires.

## Key Concepts

- **Campaign IDs**: Numeric integers (e.g., 12345)
- **Pagination**: Offset-based. \`offset\` (0-indexed start), \`limit\` (items per page). Functions auto-paginate.
- **API base**: All main API calls go to \`https://server.smartlead.ai\`, not the app domain.
- **Plan limits**: Some features (CRM, integrations, analytics) require Pro plan or above. Functions throw a clear error on 403.
- **SmartProspect credits**: Searching contacts is free. Unlocking email addresses costs credits (1,250 trial credits). Never unlock emails without user confirmation.
`;

// ============================================================================
// getContext
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract SmartLead auth token and user metadata from the browser session. Must be called before any other SmartLead function — all API calls require the Bearer token this returns.',
  notes:
    'Returns null for smart_senders_api_key if not configured on the account.',
  input: z.object({}),
  output: z.object({
    token: z
      .string()
      .describe('Bearer JWT token. Pass to all other SmartLead functions.'),
    userId: z.number().describe('Numeric user ID'),
    userUuid: z.string().describe('UUID-format user ID'),
    email: z.string().describe('User email address'),
    name: z.string().describe('User full name'),
    role: z.string().describe('User role in the account, e.g. admin, member'),
    apiKey: z
      .string()
      .describe(
        'SmartLead API key for programmatic access. Distinct from smartSendersApiKey.',
      ),
    timezonePreferences: z
      .string()
      .describe('User timezone preference, e.g. Etc/GMT, America/New_York'),
    region: z
      .string()
      .describe(
        'AWS region the account is hosted in, e.g. us-east-2, eu-west-1',
      ),
    companyUrl: z
      .string()
      .nullable()
      .describe('Company website URL associated with the account'),
    allowApiAccess: z
      .boolean()
      .describe('Whether programmatic API access is enabled for this account'),
    planName: z
      .string()
      .describe('Current plan name, e.g. TRIAL_PLAN, PRO_PLAN, SMART_PLAN'),
    trialEndDate: z
      .string()
      .nullable()
      .describe('Trial expiry date in ISO 8601 format. Null if not on trial.'),
    emailCredits: z.number().describe('Total email sending credits'),
    emailCreditsUsed: z.number().describe('Email credits consumed so far'),
    leadCredits: z
      .number()
      .describe('SmartProspect lead unlock credits (costs 1 per unlock)'),
    leadCreditsUsed: z
      .number()
      .describe('SmartProspect lead unlock credits consumed so far'),
    leadSearchCredits: z
      .number()
      .describe('SmartProspect search credits (distinct from unlock credits)'),
    leadSearchCreditsUsed: z
      .number()
      .describe('SmartProspect search credits consumed so far'),
    sequenceCredits: z
      .number()
      .describe('Number of AI-written sequences allowed on this plan'),
    sequenceCreditsUsed: z.number().describe('AI sequence credits used'),
    senderCredits: z
      .number()
      .describe('Number of sender/email account slots allowed on this plan'),
    emailVerificationCredits: z
      .number()
      .describe('Email verification credits available'),
    emailVerificationCreditsUsed: z
      .number()
      .describe('Email verification credits consumed so far'),
    monitorCredits: z
      .number()
      .describe('Domain/mailbox monitoring credits available'),
    monitorCreditsUsed: z
      .number()
      .describe('Monitoring credits consumed so far'),
    noOfLinkedinCookies: z
      .number()
      .describe(
        'Number of LinkedIn cookie slots allowed for LinkedIn outreach integration',
      ),
    newFeatureAccess: z
      .record(z.string(), z.boolean())
      .describe('Feature flags for gated features, e.g. { all_leads: true }'),
    smartSendersApiKey: z
      .string()
      .nullable()
      .describe(
        'SmartSenders API key for domain/mailbox provisioning. Null if not configured.',
      ),
  }),
};

export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// allSchemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  ...campaignSchemas,
  ...sequenceSchemas,
  ...leadSchemas,
  ...campaignAccountSchemas,
  ...emailAccountSchemas,
  ...crmSchemas,
  ...prospectSchemas,
  ...analyticsSchemas,
  ...settingsSchemas,
];
