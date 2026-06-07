import { z } from 'zod';

const ApiKeyParam = z.string().describe('Hunter.io API key from getContext()');

// ============================================================================
// Shared Sub-Schemas
// ============================================================================

const GeoSchema = z.object({
  city: z.string().nullable().describe('City name'),
  state: z.string().nullable().describe('State or region name'),
  stateCode: z.string().nullable().describe('State/region code (e.g. "CA")'),
  country: z.string().nullable().describe('Country name'),
  countryCode: z.string().nullable().describe('ISO 2-letter country code'),
  lat: z.number().nullable().describe('Latitude'),
  lng: z.number().nullable().describe('Longitude'),
});

const PersonNameSchema = z.object({
  fullName: z.string().nullable().describe('Full name'),
  givenName: z.string().nullable().describe('First/given name'),
  familyName: z.string().nullable().describe('Last/family name'),
});

const EmploymentSchema = z.object({
  domain: z.string().nullable().describe('Employer company domain'),
  name: z.string().nullable().describe('Employer company name'),
  title: z.string().nullable().describe('Job title'),
  role: z
    .string()
    .nullable()
    .describe('Role category (e.g. "executive", "engineering")'),
  subRole: z.string().nullable().describe('Sub-role category'),
  seniority: z
    .string()
    .nullable()
    .describe('Seniority level (e.g. "executive", "manager")'),
});

const FacebookProfileSchema = z.object({
  handle: z.string().nullable().describe('Facebook handle or page ID'),
});

const GithubProfileSchema = z.object({
  handle: z.string().nullable().describe('GitHub username'),
  id: z.string().nullable().describe('GitHub numeric ID'),
  avatar: z.string().nullable().describe('GitHub avatar URL'),
  company: z.string().nullable().describe('GitHub company'),
  blog: z.string().nullable().describe('GitHub blog URL'),
  followers: z.number().nullable().describe('Number of followers'),
  following: z.number().nullable().describe('Number following'),
});

const TwitterProfileSchema = z.object({
  handle: z.string().nullable().describe('Twitter/X handle'),
  id: z.string().nullable().describe('Twitter/X numeric ID'),
  bio: z.string().nullable().describe('Twitter/X bio'),
  followers: z.number().nullable().describe('Number of followers'),
  following: z.number().nullable().describe('Number following'),
  statuses: z
    .number()
    .nullable()
    .optional()
    .describe('Number of tweets (person enrichment only)'),
  favorites: z
    .number()
    .nullable()
    .optional()
    .describe('Number of liked tweets (person enrichment only)'),
  location: z.string().nullable().describe('Twitter/X location'),
  site: z.string().nullable().describe('Twitter/X website'),
  avatar: z.string().nullable().describe('Twitter/X avatar URL'),
});

const LinkedInProfileSchema = z.object({
  handle: z.string().nullable().describe('LinkedIn handle (username slug)'),
});

const GooglePlusProfileSchema = z.object({
  handle: z.string().nullable().describe('Google+ handle (deprecated)'),
});

const GravatarProfileSchema = z.object({
  handle: z.string().nullable().describe('Gravatar handle'),
  urls: z
    .array(z.record(z.string(), z.string()))
    .describe(
      'Gravatar profile URLs. Each item has "title" and "value" (URL) keys.',
    ),
  avatar: z.string().nullable().describe('Gravatar avatar URL'),
  avatars: z
    .array(z.record(z.string(), z.string()))
    .describe('All Gravatar avatar URLs. Each item has "url" and "type" keys.'),
});

// ============================================================================
// Person Schema
// ============================================================================

const PersonDataSchema = z.object({
  id: z.string().describe('Unique person identifier (UUID)'),
  name: PersonNameSchema.describe('Person name components'),
  email: z.string().nullable().describe('Primary email address'),
  location: z.string().nullable().describe('Full location string'),
  timeZone: z
    .string()
    .nullable()
    .describe('IANA timezone (e.g. "America/Chicago")'),
  utcOffset: z.number().nullable().describe('UTC offset in hours'),
  geo: GeoSchema.nullable().describe('Structured geographic location'),
  bio: z.string().nullable().describe('Short biography'),
  site: z.string().nullable().describe('Personal website URL'),
  avatar: z.string().nullable().describe('Avatar/photo URL'),
  employment: EmploymentSchema.nullable().describe(
    'Current employment details',
  ),
  facebook: FacebookProfileSchema.nullable().describe('Facebook profile'),
  github: GithubProfileSchema.nullable().describe('GitHub profile'),
  twitter: TwitterProfileSchema.nullable().describe('Twitter/X profile'),
  linkedin: LinkedInProfileSchema.nullable().describe('LinkedIn profile'),
  googleplus: GooglePlusProfileSchema.nullable().describe(
    'Google+ profile (deprecated)',
  ),
  gravatar: GravatarProfileSchema.nullable().describe('Gravatar profile'),
  fuzzy: z.boolean().describe('Whether the match was fuzzy (approximate)'),
  emailProvider: z
    .string()
    .nullable()
    .describe('Email hosting provider domain'),
  indexedAt: z
    .string()
    .nullable()
    .describe('Date the person was last indexed (YYYY-MM-DD)'),
  phone: z.string().nullable().describe('Phone number'),
  activeAt: z
    .string()
    .nullable()
    .describe('Date person was last seen active (YYYY-MM-DD)'),
  inactiveAt: z
    .string()
    .nullable()
    .describe('Date person became inactive (YYYY-MM-DD)'),
});

// ============================================================================
// Company Schema
// ============================================================================

const CompanyGeoSchema = z.object({
  streetNumber: z.string().nullable().describe('Street number'),
  streetName: z.string().nullable().describe('Street name'),
  subPremise: z.string().nullable().describe('Sub-premise (suite, unit)'),
  streetAddress: z.string().nullable().describe('Full street address'),
  city: z.string().nullable().describe('City name'),
  postalCode: z.string().nullable().describe('Postal/zip code'),
  state: z.string().nullable().describe('State or region name'),
  stateCode: z.string().nullable().describe('State/region code'),
  country: z.string().nullable().describe('Country name'),
  countryCode: z.string().nullable().describe('ISO 2-letter country code'),
  lat: z.number().nullable().describe('Latitude'),
  lng: z.number().nullable().describe('Longitude'),
});

const CompanySiteSchema = z.object({
  phoneNumbers: z.array(z.string()).describe('Phone numbers found on site'),
  emailAddresses: z.array(z.string()).describe('Email addresses found on site'),
});

const CompanyCategorySchema = z.object({
  sector: z.string().nullable().describe('GICS sector'),
  industryGroup: z.string().nullable().describe('GICS industry group'),
  industry: z.string().nullable().describe('GICS industry'),
  subIndustry: z.string().nullable().describe('GICS sub-industry'),
  gicsCode: z.string().nullable().describe('GICS numeric code'),
  sicCode: z.string().nullable().describe('SIC code'),
  sic4Codes: z.array(z.string()).describe('4-digit SIC codes'),
  naicsCode: z.string().nullable().describe('NAICS code'),
  naics6Codes: z.array(z.string()).describe('6-digit NAICS codes'),
  naics6Codes2022: z.array(z.string()).describe('6-digit NAICS 2022 codes'),
});

const CompanyMetricsSchema = z.object({
  alexaUsRank: z.number().nullable().describe('Alexa US rank (deprecated)'),
  alexaGlobalRank: z
    .number()
    .nullable()
    .describe('Alexa global rank (deprecated)'),
  trafficRank: z
    .string()
    .nullable()
    .describe('Traffic rank bucket (e.g. "very_high")'),
  employees: z
    .string()
    .nullable()
    .describe('Employee count range (e.g. "10K-50K", "51-250")'),
  marketCap: z.string().nullable().describe('Market capitalization'),
  raised: z.string().nullable().describe('Total funding raised'),
  annualRevenue: z.string().nullable().describe('Annual revenue'),
  estimatedAnnualRevenue: z
    .string()
    .nullable()
    .describe('Estimated annual revenue'),
  fiscalYearEnd: z.number().nullable().describe('Fiscal year end month'),
});

const CompanyIdentifiersSchema = z.object({
  usEIN: z.string().nullable().describe('US Employer Identification Number'),
});

const CompanyFacebookSchema = z.object({
  handle: z.string().nullable().describe('Facebook page handle or ID'),
  likes: z.number().nullable().describe('Number of Facebook likes'),
});

const CompanyCrunchbaseSchema = z.object({
  handle: z.string().nullable().describe('Crunchbase handle'),
});

const CompanyYouTubeSchema = z.object({
  handle: z.string().nullable().describe('YouTube channel handle'),
});

const CompanyInstagramSchema = z.object({
  handle: z.string().nullable().describe('Instagram handle'),
});

const CompanyParentSchema = z.object({
  domain: z.string().nullable().describe('Parent company domain'),
});

const CompanyDataSchema = z.object({
  id: z.string().describe('Unique company identifier (UUID)'),
  name: z.string().nullable().describe('Company name'),
  legalName: z.string().nullable().describe('Legal/registered company name'),
  domain: z.string().nullable().describe('Company domain'),
  domainAliases: z.array(z.string()).describe('Alternative domains'),
  site: CompanySiteSchema.nullable().describe('Website contact info'),
  category: CompanyCategorySchema.nullable().describe(
    'Industry classification',
  ),
  tags: z.array(z.string()).describe('Descriptive tags'),
  description: z.string().nullable().describe('Company description'),
  foundedYear: z.number().nullable().describe('Year founded'),
  location: z.string().nullable().describe('Full location string'),
  timeZone: z.string().nullable().describe('IANA timezone'),
  utcOffset: z.number().nullable().describe('UTC offset in hours'),
  geo: CompanyGeoSchema.nullable().describe('Structured geographic location'),
  logo: z.string().nullable().describe('Company logo URL'),
  facebook: CompanyFacebookSchema.nullable().describe('Facebook page'),
  linkedin: LinkedInProfileSchema.nullable().describe('LinkedIn company page'),
  twitter: TwitterProfileSchema.nullable().describe('Twitter/X profile'),
  crunchbase: CompanyCrunchbaseSchema.nullable().describe('Crunchbase profile'),
  youtube: CompanyYouTubeSchema.nullable().describe('YouTube channel'),
  instagram: CompanyInstagramSchema.nullable().describe('Instagram profile'),
  emailProvider: z
    .string()
    .nullable()
    .describe('Email hosting provider domain'),
  type: z
    .string()
    .nullable()
    .describe('Company type (e.g. "private", "public")'),
  companyType: z
    .string()
    .nullable()
    .describe('Detailed company type (e.g. "privately held")'),
  ticker: z.string().nullable().describe('Stock ticker symbol'),
  identifiers: CompanyIdentifiersSchema.nullable().describe(
    'Business identifiers',
  ),
  phone: z.string().nullable().describe('Primary phone number'),
  metrics: CompanyMetricsSchema.nullable().describe(
    'Company size and rank metrics',
  ),
  indexedAt: z.string().nullable().describe('Date last indexed (YYYY-MM-DD)'),
  tech: z.array(z.string()).describe('Technologies used (slugified names)'),
  techCategories: z.array(z.string()).describe('Technology category slugs'),
  fundingRounds: z
    .array(
      z
        .record(z.string(), z.unknown())
        .describe(
          'Funding round. Common keys: announcedDate, raisedAmount, raisedAmountUsd, series (e.g. "a", "b", "seed"), sourceUrl',
        ),
    )
    .describe('Funding rounds for the company. Empty array if none known.'),
  parent: CompanyParentSchema.nullable().describe('Direct parent company'),
  ultimateParent: CompanyParentSchema.nullable().describe(
    'Ultimate parent company',
  ),
});

// ============================================================================
// enrichPerson
// ============================================================================

export const enrichPersonSchema = {
  name: 'enrichPerson',
  description:
    'Enrich a person by email or LinkedIn handle, returning employment, social profiles, location, geo, and activity data',
  notes:
    'Provide email OR linkedinHandle; at least one is required. linkedinHandle is the URL slug (e.g. "steliefti" from linkedin.com/in/steliefti). Returns empty/null fields when data is unavailable, not an error. Set clearbit_format to any value to receive a Clearbit-compatible response schema instead of the default Hunter schema.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    email: z.string().optional().describe('Email address to look up'),
    linkedinHandle: z
      .string()
      .optional()
      .describe(
        'LinkedIn handle/slug (e.g. "steliefti" from linkedin.com/in/steliefti)',
      ),
    clearbit_format: z
      .string()
      .optional()
      .describe(
        "When set to any value, formats the response to match Clearbit's schema for compatibility. Changes the response structure significantly.",
      ),
  }),
  output: z.object({
    data: PersonDataSchema.describe('Enriched person data'),
    meta: z
      .object({
        email: z.string().optional().describe('Email used for lookup'),
      })
      .passthrough()
      .describe('Lookup metadata'),
  }),
};

// ============================================================================
// enrichCompany
// ============================================================================

export const enrichCompanySchema = {
  name: 'enrichCompany',
  description:
    'Enrich a company by domain, returning firmographic data including industry, location, social profiles, tech stack, metrics, and funding',
  notes:
    'Set clearbit_format to any value to receive a Clearbit-compatible response schema instead of the default Hunter schema.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    domain: z
      .string()
      .describe('Company domain to look up (e.g. "stripe.com")'),
    clearbit_format: z
      .string()
      .optional()
      .describe(
        "When set to any value, formats the response to match Clearbit's schema for compatibility. Changes the response structure significantly.",
      ),
  }),
  output: z.object({
    data: CompanyDataSchema.describe('Enriched company data'),
    meta: z
      .object({
        domain: z.string().describe('Domain used for lookup'),
      })
      .describe('Lookup metadata'),
  }),
};

// ============================================================================
// enrichCombined
// ============================================================================

export const enrichCombinedSchema = {
  name: 'enrichCombined',
  description:
    'Enrich both a person and their company in a single call by email, returning full person attributes plus company firmographics',
  notes:
    'The company is inferred from the email domain (e.g. steli@close.com enriches Close). There is no separate domain parameter. Set clearbit_format to any value to receive a Clearbit-compatible response schema instead of the default Hunter schema.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    email: z.string().describe('Email address to look up'),
    clearbit_format: z
      .string()
      .optional()
      .describe(
        "When set to any value, formats the response to match Clearbit's schema for compatibility. Changes the response structure significantly.",
      ),
  }),
  output: z.object({
    data: z
      .object({
        person: PersonDataSchema.describe('Enriched person data'),
        company: CompanyDataSchema.describe('Enriched company data'),
      })
      .describe('Combined person and company enrichment'),
    meta: z
      .object({
        email: z.string().describe('Email used for lookup'),
      })
      .describe('Lookup metadata'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const enrichmentSchemas = [
  enrichPersonSchema,
  enrichCompanySchema,
  enrichCombinedSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

export type EnrichPersonInput = z.infer<typeof enrichPersonSchema.input>;
export type EnrichPersonOutput = z.infer<typeof enrichPersonSchema.output>;
export type EnrichCompanyInput = z.infer<typeof enrichCompanySchema.input>;
export type EnrichCompanyOutput = z.infer<typeof enrichCompanySchema.output>;
export type EnrichCombinedInput = z.infer<typeof enrichCombinedSchema.input>;
export type EnrichCombinedOutput = z.infer<typeof enrichCombinedSchema.output>;
