import { z } from 'zod';

// Inline shared params to avoid circular imports
const AccessTokenParam = z
  .string()
  .describe('Bearer access token from getContext()');

const WorkspaceIdParam = z
  .string()
  .describe('Workspace UUID from getContext()');

// Inline entity schemas to avoid circular imports
const ContactSchema = z
  .object({
    id: z.string().describe('Internal hash ID'),
    objectId: z.string().describe('Contact ID: email address'),
    _firstName: z.string().optional().describe('First name'),
    _lastName: z.string().optional().describe('Last name'),
    _email: z
      .string()
      .optional()
      .describe('Email address (may differ from objectId)'),
    _currentJobTitle: z.string().optional().describe('Current job title'),
    _currentCompanyName: z.string().optional().describe('Current company name'),
    _headline: z.string().optional().describe('Professional headline'),
    _description: z.string().optional().describe('Bio or description'),
    _careerSummary: z.string().optional().describe('Career summary'),
    _linkedInUrl: z.string().optional().describe('LinkedIn profile URL'),
    _socialLinkedIn: z.string().optional().describe('LinkedIn handle'),
    _socialTwitter: z.string().optional().describe('Twitter/X handle'),
    _photoUrl: z.string().nullable().optional().describe('Profile photo URL'),
    _phoneNumbers: z
      .string()
      .optional()
      .describe('Phone numbers (JSON string)'),
    _city: z.string().optional().describe('City'),
    _state: z.string().optional().describe('State or region'),
    _country: z.string().optional().describe('Country'),
    _postalCode: z.string().optional().describe('Postal code'),
    _location: z.string().optional().describe('Full location string'),
    _timezone: z
      .string()
      .optional()
      .describe('Timezone (e.g., America/Los_Angeles)'),
    _workExperience: z
      .string()
      .optional()
      .describe('Work experience history (JSON string array)'),
    _education: z
      .string()
      .optional()
      .describe('Education history (JSON string array)'),
    _skills: z.string().optional().describe('Skills list (JSON string array)'),
    _languages: z.string().optional().describe('Languages (JSON string array)'),
    '@organization': z
      .array(z.string())
      .optional()
      .describe(
        'Related organizations in format "native_organization : domain.com"',
      ),
    '@related': z
      .array(z.string())
      .optional()
      .describe('Related objects (opportunities, etc.)'),
    '@attended': z
      .array(z.string())
      .optional()
      .describe(
        'Meeting recordings attended in format "native_meetingrecording : uuid"',
      ),
    '@isInFocusFor': z
      .array(z.string())
      .optional()
      .describe(
        'Thread messages where this contact is in focus in format "native_threadmessage : uuid"',
      ),
    _exists: z
      .string()
      .optional()
      .describe('Internal existence marker (empty string, always present)'),
    mzTimestamp: z
      .number()
      .optional()
      .describe('Materialize DB internal timestamp (milliseconds)'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z.string().describe('ISO timestamp when last updated'),
  })
  .passthrough();

const OrganizationSchema = z
  .object({
    id: z.string().describe('Internal hash ID'),
    objectId: z.string().describe('Organization ID: domain name'),
    _name: z.string().optional().describe('Organization display name'),
    _domain: z.string().optional().describe('Primary domain'),
    _description: z.string().optional().describe('Organization description'),
    _aiDescription: z
      .string()
      .optional()
      .describe('AI-generated description of the organization'),
    _industry: z.string().optional().describe('Industry'),
    _industryType: z
      .string()
      .optional()
      .describe('Industry type code (e.g., PROFESSIONAL_SERVICES)'),
    _city: z.string().optional().describe('City'),
    _state: z.string().optional().describe('State or region'),
    _country: z.string().optional().describe('Country'),
    _postalCode: z.string().optional().describe('Postal code'),
    _location: z.string().optional().describe('Full location string'),
    _address: z.string().optional().describe('Street address'),
    _employeeCount: z.number().optional().describe('Number of employees'),
    _employeeCountFrom: z
      .number()
      .optional()
      .describe('Employee count lower bound'),
    _employeeCountTo: z
      .number()
      .optional()
      .describe('Employee count upper bound'),
    _annualRevenue: z.number().optional().describe('Annual revenue in USD'),
    _funding: z.number().optional().describe('Total funding in USD'),
    _founded: z
      .number()
      .optional()
      .describe('Year founded (stored as a number, e.g. 2020)'),
    _photoSquare: z
      .string()
      .nullable()
      .optional()
      .describe('Company logo URL (square format)'),
    _socialLinkedIn: z.string().optional().describe('LinkedIn company URL'),
    _socialFacebook: z.string().optional().describe('Facebook page URL'),
    _socialTwitter: z.string().optional().describe('Twitter/X handle or URL'),
    _socialYouTube: z.string().optional().describe('YouTube channel URL'),
    _resolvedUrl: z.string().optional().describe('Website URL'),
    _stockTicker: z.string().optional().describe('Stock ticker symbol'),
    _isHiring: z.boolean().optional().describe('Whether the company is hiring'),
    '@member': z
      .array(z.string())
      .optional()
      .describe(
        'Contact members in format "native_contact : email@domain.com"',
      ),
    '@opportunity': z
      .array(z.string())
      .optional()
      .describe('Related opportunities in format "native_opportunity : uuid"'),
    '@related': z
      .array(z.string())
      .optional()
      .describe('Other related objects'),
    _socialInstagram: z.string().optional().describe('Instagram profile URL'),
    _phoneNumbers: z
      .string()
      .optional()
      .describe('Phone numbers (JSON string array)'),
    _missionAndVision: z
      .string()
      .optional()
      .describe('Mission and vision statement'),
    _differentiators: z
      .array(z.string())
      .optional()
      .describe('Key differentiators / competitive advantages'),
    _doesBusinessWith: z
      .array(z.string())
      .optional()
      .describe('Business model indicators, e.g. ["B2B", "B2C"]'),
    _promises: z
      .array(z.string())
      .optional()
      .describe('Value propositions / promises'),
    _values: z.array(z.string()).optional().describe('Company values'),
    _naicsCodes: z
      .array(z.string())
      .optional()
      .describe('NAICS industry classification codes'),
    _sicCodes: z
      .array(z.string())
      .optional()
      .describe('SIC industry classification codes'),
    _icpMatchReasoning: z
      .string()
      .optional()
      .describe('AI-generated reasoning about ICP match'),
    _noPipelineReasoning: z
      .string()
      .optional()
      .describe('AI-generated reasoning for why no pipeline opportunity'),
    _idealCustomerProfile: z
      .string()
      .optional()
      .describe('ICP definition as JSON string'),
    _photosOther: z
      .string()
      .optional()
      .describe('Additional photo URLs as JSON string array'),
    _upcomingEvents: z
      .string()
      .optional()
      .describe('Upcoming calendar events as JSON string array'),
    '_objective/proofOfPayment': z
      .string()
      .optional()
      .describe('AI analysis of payment evidence'),
    '_objective/relationshipOrigin': z
      .string()
      .optional()
      .describe('AI analysis of how relationship started'),
    '_objective/roles': z
      .string()
      .optional()
      .describe('AI analysis of relationship roles as JSON string array'),
    '_status/currentStatusOneSentence': z
      .string()
      .optional()
      .describe('One-sentence summary of current relationship status'),
    '_status/isSensitive': z
      .boolean()
      .optional()
      .describe('Whether this relationship is marked sensitive'),
    '_relationship/TO/CUSTOMER/PROSPECTIVE': z
      .boolean()
      .optional()
      .describe('Whether this org is a prospective customer'),
    '@attended': z
      .array(z.string())
      .optional()
      .describe(
        'Meeting recordings attended in format "native_meetingrecording : uuid"',
      ),
    _exists: z
      .string()
      .optional()
      .describe('Internal existence marker (always empty string)'),
    mzTimestamp: z
      .number()
      .optional()
      .describe('Materialize DB internal timestamp (milliseconds)'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z.string().describe('ISO timestamp when last updated'),
  })
  .passthrough();

// ============================================================================
// Function Schemas: Contacts & Organizations
// ============================================================================

export const listOrganizationsSchema = {
  name: 'listOrganizations',
  description:
    'List all organizations (companies) in the workspace. Returns enriched org records with name, domain, industry, location, employee count, and relationship data.',
  notes: '',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Max organizations to return (1–10000, default 100)'),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe(
        'Pagination offset as ISO timestamp (createdAt >= offset). Use createdAt from last item for next page.',
      ),
  }),
  output: z.object({
    organizations: z
      .array(OrganizationSchema)
      .describe('Array of organization records'),
  }),
};

export const getOrganizationSchema = {
  name: 'getOrganization',
  description:
    'Get detailed information about a single organization by domain name. Returns full org record including description, industry, location, employee count, LinkedIn, website, and relationships.',
  notes: '',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    domain: z
      .string()
      .describe(
        'Organization domain name (this is the organization ID in Day.ai, e.g. "example.com")',
      ),
  }),
  output: z.object({
    organization: OrganizationSchema.describe('Full organization record'),
  }),
};

export const searchContactsSchema = {
  name: 'searchContacts',
  description:
    'Search contacts by a query string. Matches against first name, last name, email address, and current company name. Returns all matching contact records.',
  notes: '',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    query: z
      .string()
      .describe(
        'Search query string. Matched against name, email, and company fields.',
      ),
    limit: z
      .number()
      .optional()
      .default(1000)
      .describe(
        'Max contacts to fetch from the database before client-side filtering (1–10000, default 1000). Reduce for performance in large workspaces.',
      ),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe(
        'Pagination offset as ISO timestamp (createdAt >= offset). Use the createdAt from the last item on a page to fetch the next page of contacts.',
      ),
  }),
  output: z.object({
    contacts: z
      .array(ContactSchema)
      .describe('Contact records matching the query'),
    total: z.number().describe('Total number of matching contacts'),
  }),
};

export const searchOrganizationsSchema = {
  name: 'searchOrganizations',
  description:
    'Search organizations by a query string. Matches against organization name and domain. Returns all matching organization records.',
  notes: '',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    query: z
      .string()
      .describe(
        'Search query string. Matched against organization name and domain.',
      ),
    limit: z
      .number()
      .optional()
      .default(1000)
      .describe(
        'Max organizations to fetch before client-side filtering (1–10000, default 1000). Reduce for large workspaces to improve performance.',
      ),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe(
        'Pagination offset as ISO timestamp (createdAt >= offset). Use createdAt from last item in previous page for next page.',
      ),
  }),
  output: z.object({
    organizations: z
      .array(OrganizationSchema)
      .describe('Organization records matching the query'),
    total: z.number().describe('Total number of matching organizations'),
  }),
};

export const createContactSchema = {
  name: 'createContact',
  description:
    'Create a new contact in the workspace. The contact email is the unique identifier (objectId) in Day.ai.',
  notes: '',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    email: z
      .string()
      .email()
      .describe('Contact email address (required, used as the contact ID)'),
    firstName: z.string().optional().describe('First name'),
    lastName: z.string().optional().describe('Last name'),
    jobTitle: z.string().optional().describe('Current job title'),
    companyName: z.string().optional().describe('Current company name'),
    linkedInUrl: z.string().optional().describe('LinkedIn profile URL'),
    phone: z.string().optional().describe('Phone number'),
    description: z.string().optional().describe('Bio or description'),
    headline: z.string().optional().describe('Professional headline'),
    location: z.string().optional().describe('Full location string'),
    timezone: z
      .string()
      .optional()
      .describe('Timezone (e.g., America/Los_Angeles)'),
    country: z.string().optional().describe('Country'),
    city: z.string().optional().describe('City'),
    state: z.string().optional().describe('State or region'),
    postalCode: z.string().optional().describe('Postal code'),
    twitterUrl: z.string().optional().describe('Twitter/X profile URL'),
    careerSummary: z.string().optional().describe('Career summary'),
    photoUrl: z.string().optional().describe('Profile photo URL'),
  }),
  output: z.object({
    contact: ContactSchema.describe('Newly created contact record'),
  }),
};

export const updateContactSchema = {
  name: 'updateContact',
  description:
    'Update properties on an existing contact. Only provided fields are updated; omitted fields remain unchanged.',
  notes: '',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    email: z.string().email().describe('Contact email address (contact ID)'),
    firstName: z.string().optional().describe('First name'),
    lastName: z.string().optional().describe('Last name'),
    jobTitle: z.string().optional().describe('Current job title'),
    companyName: z.string().optional().describe('Current company name'),
    linkedInUrl: z.string().optional().describe('LinkedIn profile URL'),
    phone: z.string().optional().describe('Phone number'),
  }),
  output: z.object({
    contact: ContactSchema.describe('Updated contact record'),
  }),
};

export const createOrganizationSchema = {
  name: 'createOrganization',
  description:
    'Create a new organization in the workspace, or return the existing one if the domain already exists (upsert behavior). The domain is the unique identifier (objectId) in Day.ai. If called with a domain that already exists, the existing record is returned unchanged; no fields are updated. The returned organization record includes all fields populated from the read model after creation.',
  notes:
    'Domain must be a bare hostname like "example.com"; do NOT include protocol (https://example.com would create a malformed record). The API silently accepts URL-format domains without error, so this function validates the domain before sending.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    domain: z
      .string()
      .min(1, 'domain must not be empty')
      .refine(
        (d) => !d.startsWith('http://') && !d.startsWith('https://'),
        'domain must be a bare hostname like "example.com", not a full URL with protocol',
      )
      .describe(
        'Organization domain name (required, used as the org ID, e.g. "example.com"). Must be a bare domain without protocol.',
      ),
    name: z.string().optional().describe('Organization display name'),
    description: z.string().optional().describe('Organization description'),
    industry: z.string().optional().describe('Industry'),
    industryType: z
      .string()
      .optional()
      .describe('Industry type code (e.g., TECHNOLOGY, PROFESSIONAL_SERVICES)'),
    website: z.string().optional().describe('Website URL'),
    linkedInUrl: z.string().optional().describe('LinkedIn company URL'),
    socialFacebook: z.string().optional().describe('Facebook page URL'),
    socialTwitter: z.string().optional().describe('Twitter/X profile URL'),
    socialYouTube: z.string().optional().describe('YouTube channel URL'),
    socialInstagram: z.string().optional().describe('Instagram profile URL'),
    photoSquare: z
      .string()
      .optional()
      .describe('Company logo URL (square format)'),
    city: z.string().optional().describe('City'),
    state: z.string().optional().describe('State or region'),
    country: z.string().optional().describe('Country'),
    postalCode: z.string().optional().describe('Postal/ZIP code'),
    location: z.string().optional().describe('Full location string'),
    address: z.string().optional().describe('Street address'),
    founded: z
      .string()
      .optional()
      .describe('Year or date the company was founded'),
    employeeCount: z.number().optional().describe('Number of employees'),
    employeeCountFrom: z
      .number()
      .optional()
      .describe('Employee count lower bound'),
    employeeCountTo: z
      .number()
      .optional()
      .describe('Employee count upper bound'),
    annualRevenue: z.number().optional().describe('Annual revenue in USD'),
    funding: z.number().optional().describe('Total funding raised in USD'),
    stockTicker: z.string().optional().describe('Stock ticker symbol'),
    isHiring: z.boolean().optional().describe('Whether the company is hiring'),
  }),
  output: z.object({
    organization: OrganizationSchema.describe(
      'Newly created organization record',
    ),
  }),
};

export const updateOrganizationSchema = {
  name: 'updateOrganization',
  description:
    'Update properties on an existing organization. Only provided fields are updated; omitted fields remain unchanged.',
  notes: '',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    domain: z.string().describe('Organization domain name (org ID)'),
    name: z.string().optional().describe('Organization display name'),
    description: z.string().optional().describe('Organization description'),
    industry: z.string().optional().describe('Industry'),
    website: z.string().optional().describe('Website URL'),
    linkedInUrl: z.string().optional().describe('LinkedIn company URL'),
  }),
  output: z.object({
    organization: OrganizationSchema.describe('Updated organization record'),
  }),
};

// ============================================================================
// Type Exports
// ============================================================================

export type ListOrganizationsInput = z.infer<
  typeof listOrganizationsSchema.input
>;
export type ListOrganizationsOutput = z.infer<
  typeof listOrganizationsSchema.output
>;
export type GetOrganizationInput = z.infer<typeof getOrganizationSchema.input>;
export type GetOrganizationOutput = z.infer<
  typeof getOrganizationSchema.output
>;
export type SearchContactsInput = z.infer<typeof searchContactsSchema.input>;
export type SearchContactsOutput = z.infer<typeof searchContactsSchema.output>;
export type SearchOrganizationsInput = z.infer<
  typeof searchOrganizationsSchema.input
>;
export type SearchOrganizationsOutput = z.infer<
  typeof searchOrganizationsSchema.output
>;
export type CreateContactInput = z.infer<typeof createContactSchema.input>;
export type CreateContactOutput = z.infer<typeof createContactSchema.output>;
export type UpdateContactInput = z.infer<typeof updateContactSchema.input>;
export type UpdateContactOutput = z.infer<typeof updateContactSchema.output>;
export type CreateOrganizationInput = z.infer<
  typeof createOrganizationSchema.input
>;
export type CreateOrganizationOutput = z.infer<
  typeof createOrganizationSchema.output
>;
export type UpdateOrganizationInput = z.infer<
  typeof updateOrganizationSchema.input
>;
export type UpdateOrganizationOutput = z.infer<
  typeof updateOrganizationSchema.output
>;

// ============================================================================
// All Schemas
// ============================================================================

export const allContactsOrgsSchemas = [
  listOrganizationsSchema,
  getOrganizationSchema,
  searchContactsSchema,
  searchOrganizationsSchema,
  createContactSchema,
  updateContactSchema,
  createOrganizationSchema,
  updateOrganizationSchema,
];
