/**
 * Salesforce Security & Admin Operations
 *
 * Company information and security health check operations
 * via Aura framework API.
 */

import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import { NotFound, ContractDrift, UpstreamError } from '@vallum/_runtime';
import type {
  GetCompanyInfoInput,
  GetCompanyInfoOutput,
  GetSecurityHealthCheckInput,
  GetSecurityHealthCheckOutput,
} from '../schemas';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(creds: AuraCredentials): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


// Default fields returned when no fields param is provided
const DEFAULT_ORGANIZATION_FIELDS = [
  'Name',
  'Phone',
  'Fax',
  'PrimaryContact',
  'Division',
  'Street',
  'City',
  'State',
  'PostalCode',
  'Country',
  'DefaultLocaleSidKey',
  'LanguageLocaleKey',
  'TimeZoneSidKey',
  'FiscalYearStartMonth',
  'OrganizationType',
  'InstanceName',
  'IsSandbox',
  'IsReadOnly',
  'TrialExpirationDate',
  'NamespacePrefix',
  'MonthlyPageViewsEntitlement',
  'MonthlyPageViewsUsed',
  'ReceivesInfoEmails',
  'ReceivesAdminInfoEmails',
  'CreatedDate',
  'LastModifiedDate',
];

// ---------------------------------------------------------------------------
// GraphQL response types
// ---------------------------------------------------------------------------

interface GraphQLFieldValue {
  value: unknown;
  displayValue?: string | null;
}

interface GraphQLOrgNode {
  Id: string;
  [fieldName: string]: string | GraphQLFieldValue;
}

interface GraphQLOrgResponse {
  data: {
    uiapi: {
      query: {
        Organization: {
          edges: Array<{ node: GraphQLOrgNode }>;
        };
      };
    };
  };
  errors: Array<{ message: string }>;
}

// ---------------------------------------------------------------------------
// getCompanyInfo
// ---------------------------------------------------------------------------

export async function getCompanyInfo(
  args: GetCompanyInfoInput,
): Promise<GetCompanyInfoOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);
  const fields = args.fields ?? DEFAULT_ORGANIZATION_FIELDS;

  // Build GraphQL query for Organization fields
  // Each field is queried as FieldName { value } in the uiapi schema
  const fieldSelections = fields.map((f) => `${f} { value }`).join(' ');
  const query = `{ uiapi { query { Organization { edges { node { Id ${fieldSelections} } } } } } }`;

  const result = (await auraAction(
    ctx,
    'aura://RecordUiController/ACTION$executeGraphQL',
    { queryInput: { query, variables: {} } },
  )) as GraphQLOrgResponse;

  if (result.errors && result.errors.length > 0) {
    throw new UpstreamError(`Salesforce GraphQL error: ${result.errors[0].message}`);
  }

  const edges = result.data?.uiapi?.query?.Organization?.edges;
  if (!edges || edges.length === 0) {
    throw new NotFound('No Organization record found.');
  }

  const node = edges[0].node;

  // Flatten the GraphQL response into a flat record
  const record: Record<string, unknown> = { Id: node.Id };
  for (const [key, val] of Object.entries(node)) {
    if (key === 'Id') continue;
    if (val && typeof val === 'object' && 'value' in val) {
      record[key] = (val as GraphQLFieldValue).value;
    } else {
      record[key] = val;
    }
  }

  return record as GetCompanyInfoOutput;
}

// ---------------------------------------------------------------------------
// Aura response types for Security Health Check
// ---------------------------------------------------------------------------

interface SecuritySettingRaw {
  label: string;
  setting: string;
  group: string;
  yourValue: string;
  yourValueRaw: string;
  standardValue: string;
  standardValueRaw: string;
  color: string;
  durableId: string;
  urlRecord: { urlSfx: string; urlAloha: string };
}

interface GetAllDataResponse {
  HIGH_RISK_CATEGORY: SecuritySettingRaw[];
  MEDIUM_RISK_CATEGORY: SecuritySettingRaw[];
  LOW_RISK_CATEGORY: SecuritySettingRaw[];
  INFORMATIONAL_CATEGORY: SecuritySettingRaw[];
  ATTRIBUTES: unknown[];
}

interface GetProgressBarResponse {
  score: string;
  total: number;
}

// ---------------------------------------------------------------------------
// getSecurityHealthCheck
// ---------------------------------------------------------------------------

export async function getSecurityHealthCheck(
  args: GetSecurityHealthCheckInput,
): Promise<GetSecurityHealthCheckOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);
  const baselineId = args.customBaselineId ?? '0';

  // Fetch score and settings data in parallel via separate aura calls
  const [allData, progressBar] = await Promise.all([
    auraAction(ctx, DESCRIPTORS.getSecurityHealthCheckData, {
      customBaselineId: baselineId,
    }) as Promise<GetAllDataResponse | null>,
    auraAction(ctx, DESCRIPTORS.getSecurityHealthCheckProgress, {
      customBaselineId: baselineId,
    }) as Promise<GetProgressBarResponse | null>,
  ]);

  if (!allData || !progressBar) {
    throw new ContractDrift(
      `getSecurityHealthCheck: No data returned for customBaselineId "${baselineId}". The baseline may not exist.`,
    );
  }

  return {
    score: parseInt(progressBar.score, 10),
    totalScore: progressBar.total,
    settings: {
      HIGH_RISK_CATEGORY: allData.HIGH_RISK_CATEGORY ?? [],
      MEDIUM_RISK_CATEGORY: allData.MEDIUM_RISK_CATEGORY ?? [],
      LOW_RISK_CATEGORY: allData.LOW_RISK_CATEGORY ?? [],
      INFORMATIONAL_CATEGORY: allData.INFORMATIONAL_CATEGORY ?? [],
    },
  } as GetSecurityHealthCheckOutput;
}
