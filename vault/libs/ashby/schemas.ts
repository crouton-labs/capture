import { z } from 'zod';

export const libraryDescription =
  'Public Ashby job-board reads for discovering open roles, teams, departments, compensation, and application forms.';
export const libraryIcon = '/icons/libs/ashby.png';
export const loginUrl = 'https://jobs.ashbyhq.com';

export const libraryNotes = `
## Workflow

Ashby job boards are public. No login, auth, CSRF token, or getContext call is used. Navigate is optional; every function takes a \`jobBoardName\` argument directly.

## Key Concepts

- **jobBoardName** is the slug in \`https://jobs.ashbyhq.com/{jobBoardName}\`, for example \`linear\`, \`ramp\`, \`notion\`, or \`cursor\`.
- Do **not** guess a company display name into a slug. Use the actual slug from the company's Ashby jobs URL.
- Bad or inactive board slugs return NotFound.
- Reads use two public Ashby surfaces: the REST job-board list has the richest job and compensation data; single-job detail and application forms come from the public jobs page GraphQL API.
- Search filtering is client-side: the library fetches the full public board, then filters by text, location, department, team, remote flag, workplace type, and employment type.
- Employment type values are \`FullTime\`, \`PartTime\`, \`Intern\`, \`Contract\`, and \`Temporary\`. Workplace type values are \`Remote\`, \`Hybrid\`, \`OnSite\`, or null when Ashby does not classify the role.
- Compensation component values use \`Salary\`, \`EquityPercentage\`, \`EquityCashValue\`, \`Commission\`, or \`Bonus\`; interval values are \`1 YEAR\`, \`1 MONTH\`, or \`NONE\`.
`;

export const JobBoardNameParam = z
  .string()
  .min(1)
  .describe('Ashby hosted jobs page slug from https://jobs.ashbyhq.com/{jobBoardName}; do not guess from company display name');

export const JobIdParam = z
  .string()
  .min(1)
  .describe('Ashby job posting ID, usually a UUID from listJobs or searchJobs');

export const EmploymentTypeSchema = z
  .enum(['FullTime', 'PartTime', 'Intern', 'Contract', 'Temporary'])
  .describe('Ashby employment type. Values: FullTime, PartTime, Intern, Contract, Temporary.');

export const WorkplaceTypeSchema = z
  .enum(['Remote', 'Hybrid', 'OnSite'])
  .describe('Ashby workplace type. Values: Remote, Hybrid, OnSite; nullable when unclassified.');

export const CompensationIntervalSchema = z
  .enum(['1 YEAR', '1 MONTH', 'NONE'])
  .describe('Compensation interval code. Values: 1 YEAR, 1 MONTH, NONE.');

export const AddressSchema = z
  .object({
    postalAddress: z
      .object({
        addressCountry: z.string().optional().describe('Country code or name'),
        addressLocality: z.string().optional().describe('City or locality'),
        addressRegion: z.string().optional().describe('State, province, or region'),
      })
      .optional()
      .describe('Postal address fields for the primary job location'),
  })
  .passthrough()
  .describe('Primary job address');

export const SecondaryLocationSchema = z.object({
  location: z.string().describe('Secondary location display name'),
  address: AddressSchema.optional().describe('Secondary location address'),
});

export const CompensationComponentSchema = z.object({
  id: z.string().optional().nullable().describe('Ashby compensation component ID when present'),
  summary: z.string().optional().nullable().describe('Human-readable compensation component summary'),
  compensationType: z
    .enum(['Salary', 'EquityPercentage', 'EquityCashValue', 'Commission', 'Bonus'])
    .optional()
    .nullable()
    .describe('Compensation component type. Values: Salary, EquityPercentage, EquityCashValue, Commission, Bonus.'),
  interval: CompensationIntervalSchema.optional().nullable().describe('Compensation interval code. Values: 1 YEAR, 1 MONTH, NONE.'),
  currencyCode: z.string().optional().nullable().describe('ISO currency code when the component is monetary'),
  minValue: z.number().optional().nullable().describe('Minimum numeric compensation value'),
  maxValue: z.number().optional().nullable().describe('Maximum numeric compensation value'),
});

export const CompensationTierSchema = z.object({
  id: z.string().describe('Ashby compensation tier ID'),
  tierSummary: z.string().optional().nullable().describe('Human-readable tier summary'),
  title: z.string().optional().nullable().describe('Tier title when Ashby exposes one'),
  additionalInformation: z.string().optional().nullable().describe('Additional public compensation notes'),
  components: z.array(CompensationComponentSchema).optional().describe('Structured compensation components in this tier'),
});

export const CompensationSchema = z.object({
  compensationTierSummary: z.string().optional().nullable().describe('Human-readable compensation summary'),
  scrapeableCompensationSalarySummary: z.string().optional().nullable().describe('Salary-only summary intended for scraping'),
  compensationTiers: z.array(CompensationTierSchema).optional().describe('Structured public compensation tiers'),
  summaryComponents: z.array(CompensationComponentSchema).optional().describe('Top-level structured compensation summary components'),
});

export const JobSchema = z.object({
  id: z.string().describe('Ashby job posting ID'),
  title: z.string().describe('Job title'),
  department: z.string().optional().nullable().describe('Department name'),
  team: z.string().optional().nullable().describe('Team name'),
  employmentType: EmploymentTypeSchema.optional().nullable().describe('Employment type'),
  location: z.string().optional().nullable().describe('Primary location display name'),
  secondaryLocations: z.array(SecondaryLocationSchema).optional().describe('Additional eligible job locations'),
  publishedAt: z.string().optional().nullable().describe('Published timestamp in ISO format'),
  isListed: z.boolean().optional().describe('Whether the job is publicly listed'),
  isRemote: z.boolean().optional().describe('Whether Ashby marks the role as remote'),
  workplaceType: WorkplaceTypeSchema.optional().nullable().describe('Remote, hybrid, or on-site workplace type'),
  address: AddressSchema.optional().describe('Primary job location address'),
  jobUrl: z.string().optional().describe('Public Ashby job detail URL'),
  applyUrl: z.string().optional().describe('Public Ashby application URL'),
  descriptionHtml: z.string().optional().describe('HTML job description'),
  descriptionPlain: z.string().optional().describe('Plain-text job description'),
  shouldDisplayCompensationOnJobPostings: z.boolean().optional().describe('Whether Ashby displays compensation publicly'),
  compensation: CompensationSchema.optional().nullable().describe('Public compensation information when includeCompensation is enabled and available'),
});

export const SchemaOrgPostalAddressSchema = z
  .object({
    '@type': z.string().optional().describe('schema.org type, typically PostalAddress'),
    addressCountry: z.string().optional().describe('Country code or name'),
    addressLocality: z.string().optional().describe('City or locality'),
    addressRegion: z.string().optional().describe('State, province, or region'),
    postalCode: z.string().optional().describe('Postal code'),
    streetAddress: z.string().optional().describe('Street address'),
  })
  .passthrough()
  .describe('schema.org PostalAddress object. Known properties: @type, addressCountry, addressLocality, addressRegion, postalCode, streetAddress.');

export const SchemaOrgJobLocationSchema = z
  .object({
    '@type': z.string().optional().describe('schema.org type, typically Place'),
    address: SchemaOrgPostalAddressSchema.optional().describe('Postal address for the job location'),
  })
  .passthrough()
  .describe('schema.org Place object. Known properties: @type, address.');

export const SchemaOrgHiringOrganizationSchema = z
  .object({
    '@type': z.string().optional().describe('schema.org type, typically Organization'),
    name: z.string().optional().describe('Organization name'),
    sameAs: z.string().optional().describe('Organization website or profile URL'),
    logo: z.string().optional().describe('Organization logo URL'),
  })
  .passthrough()
  .describe('schema.org hiringOrganization object. Known properties: @type, name, sameAs, logo.');

export const SchemaOrgBaseSalarySchema = z
  .object({
    '@type': z.string().optional().describe('schema.org type, typically MonetaryAmount'),
    currency: z.string().optional().describe('ISO currency code'),
    value: z
      .object({
        '@type': z.string().optional().describe('schema.org type, typically QuantitativeValue'),
        minValue: z.number().optional().describe('Minimum salary value'),
        maxValue: z.number().optional().describe('Maximum salary value'),
        value: z.number().optional().describe('Exact salary value when a range is not used'),
        unitText: z.string().optional().describe('Salary unit such as YEAR, MONTH, or HOUR'),
      })
      .passthrough()
      .optional()
      .describe('schema.org QuantitativeValue object. Known properties: @type, minValue, maxValue, value, unitText.'),
  })
  .passthrough()
  .describe('schema.org baseSalary object. Known properties: @type, currency, value.');

export const LinkedDataSchema = z
  .object({
    title: z.string().optional().describe('schema.org job title'),
    description: z.string().optional().describe('schema.org HTML job description'),
    datePosted: z.string().optional().describe('schema.org posting date'),
    employmentType: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('schema.org employment type value or values'),
    hiringOrganization: SchemaOrgHiringOrganizationSchema.optional().describe('schema.org hiring organization'),
    jobLocation: z
      .union([SchemaOrgJobLocationSchema, z.array(SchemaOrgJobLocationSchema)])
      .optional()
      .describe('schema.org job location object or array'),
    baseSalary: SchemaOrgBaseSalarySchema.optional().describe('schema.org base salary'),
  })
  .passthrough()
  .describe('schema.org JobPosting linked data object. Known properties: title, description, datePosted, employmentType, hiringOrganization, jobLocation, baseSalary.');

export const ApplicationFieldSchema = z
  .object({
    id: z.string().optional().describe('Application field ID'),
    path: z.string().optional().describe('Machine path such as _systemfield_name'),
    humanReadablePath: z.string().optional().describe('Human-readable field path'),
    title: z.string().optional().describe('Applicant-facing field label'),
    isNullable: z.boolean().optional().describe('Whether Ashby marks the field nullable'),
    isPrivate: z.boolean().optional().describe('Whether Ashby marks the field private'),
    isDeactivated: z.boolean().optional().describe('Whether the field is deactivated'),
    isMany: z.boolean().optional().describe('Whether the field accepts multiple values'),
    metadata: z
      .object({})
      .passthrough()
      .optional()
      .nullable()
      .describe('Dynamic field metadata object; contents vary by field type.'),
    type: z.string().optional().describe('Field type. Known values include String, Email, Phone, File, LongText, Boolean, and Number.'),
  })
  .passthrough()
  .describe('Ashby application form field JSON scalar. Known properties: id, path, humanReadablePath, title, isNullable, isPrivate, isDeactivated, isMany, metadata, type.');

export const ApplicationFieldEntrySchema = z.object({
  field: ApplicationFieldSchema.describe('Application field definition'),
  isRequired: z.boolean().describe('Whether applicants must provide this field'),
});

export const ApplicationFormSectionSchema = z.object({
  title: z.string().optional().nullable().describe('Application form section title'),
  fieldEntries: z.array(ApplicationFieldEntrySchema).describe('Fields in this section'),
});

export const ApplicationFormSchema = z.object({
  sections: z.array(ApplicationFormSectionSchema).describe('Application form sections'),
});

export const JobDetailSchema = z.object({
  id: z.string().describe('Ashby job posting ID'),
  title: z.string().describe('Job title'),
  departmentName: z.string().optional().nullable().describe('Department name'),
  teamNames: z.array(z.string()).optional().describe('Team hierarchy names'),
  locationName: z.string().optional().nullable().describe('Primary location display name'),
  workplaceType: WorkplaceTypeSchema.optional().nullable().describe('Remote, hybrid, or on-site workplace type'),
  employmentType: EmploymentTypeSchema.optional().nullable().describe('Employment type'),
  descriptionHtml: z.string().optional().nullable().describe('HTML job description'),
  isListed: z.boolean().optional().describe('Whether the job is publicly listed'),
  compensationTierSummary: z.string().optional().nullable().describe('Human-readable compensation summary'),
  compensationTiers: z
    .array(
      z.object({
        id: z.string().describe('Compensation tier ID'),
        title: z.string().optional().nullable().describe('Compensation tier title'),
        tierSummary: z.string().optional().nullable().describe('Compensation tier summary'),
      }),
    )
    .optional()
    .describe('GraphQL compensation tiers; public single-job GraphQL exposes id, title, and tierSummary only'),
  secondaryLocationNames: z.array(z.string()).optional().describe('Additional eligible location names'),
  publishedDate: z.string().optional().nullable().describe('Published date in YYYY-MM-DD format'),
  linkedData: LinkedDataSchema.optional().nullable().describe('schema.org JobPosting linked data'),
  applicationForm: ApplicationFormSchema.optional().nullable().describe('Public application form definition'),
});

export const TeamSchema = z.object({
  id: z.string().describe('Ashby team ID'),
  name: z.string().describe('Team display name'),
  parentTeamId: z.string().nullable().describe('Parent team ID; null means top-level team'),
  jobCount: z.number().describe('Number of lightweight job postings assigned directly to this team'),
});

export const LightweightPostingSchema = z.object({
  id: z.string().describe('Ashby job posting ID'),
  title: z.string().describe('Job title'),
  teamId: z.string().optional().nullable().describe('Ashby team ID for the posting'),
  locationName: z.string().optional().nullable().describe('Primary location display name'),
  employmentType: EmploymentTypeSchema.optional().nullable().describe('Employment type'),
  secondaryLocations: z
    .array(
      z.object({
        locationName: z.string().optional().nullable().describe('Secondary location display name'),
      }),
    )
    .optional()
    .describe('Secondary locations from the jobs page GraphQL API'),
  compensationTierSummary: z.string().optional().nullable().describe('Human-readable compensation summary'),
});

export const DepartmentSchema = z.object({
  name: z.string().describe('Department display name'),
  jobCount: z.number().describe('Number of public jobs in this department'),
});

export const listJobsSchema = {
  name: 'listJobs',
  description: 'List all public jobs on an Ashby job board, including rich compensation data when publicly displayed.',
  notes: 'No pagination: Ashby returns the full public board. Pass includeCompensation=true unless the user explicitly wants the lighter response.',
  input: z.object({
    jobBoardName: JobBoardNameParam,
    includeCompensation: z.boolean().optional().default(true).describe('Include structured public compensation fields'),
  }),
  output: z.object({
    jobs: z.array(JobSchema).describe('Public job postings'),
    total: z.number().describe('Number of jobs returned'),
    apiVersion: z.number().optional().describe('Ashby Posting API version'),
  }),
};

export const getJobSchema = {
  name: 'getJob',
  description: 'Get full public details for a single Ashby job posting, including description, linked data, compensation tiers, and application form.',
  notes: 'Use a jobId from listJobs or searchJobs. Returns public detail data for the specific posting when Ashby exposes it.',
  input: z.object({
    jobBoardName: JobBoardNameParam,
    jobId: JobIdParam,
  }),
  output: JobDetailSchema,
};

export const searchJobsSchema = {
  name: 'searchJobs',
  description: 'Search public jobs on an Ashby board by text and common job filters.',
  notes: 'Filtering is client-side after fetching the full public board. Text query matches title and plain-text description case-insensitively.',
  input: z.object({
    jobBoardName: JobBoardNameParam,
    query: z.string().optional().describe('Case-insensitive text query over title and descriptionPlain'),
    location: z.string().optional().describe('Case-insensitive match over primary and secondary location names'),
    department: z.string().optional().describe('Case-insensitive department name match'),
    team: z.string().optional().describe('Case-insensitive team name match'),
    isRemote: z.boolean().optional().describe('Filter by Ashby isRemote flag'),
    workplaceType: WorkplaceTypeSchema.optional().describe('Filter by workplace type'),
    employmentType: EmploymentTypeSchema.optional().describe('Filter by employment type'),
  }),
  output: z.object({
    jobs: z.array(JobSchema).describe('Jobs matching all provided filters'),
    total: z.number().describe('Number of matching jobs'),
  }),
};

export const listTeamsSchema = {
  name: 'listTeams',
  description: 'List the public Ashby team hierarchy for a job board with direct job counts.',
  notes: 'Teams form a tree through parentTeamId; null parentTeamId means a top-level team.',
  input: z.object({
    jobBoardName: JobBoardNameParam,
  }),
  output: z.object({
    teams: z.array(TeamSchema).describe('Team hierarchy'),
    jobPostings: z.array(LightweightPostingSchema).describe('Lightweight postings returned with team IDs'),
    total: z.number().describe('Number of teams returned'),
  }),
};

export const listDepartmentsSchema = {
  name: 'listDepartments',
  description: 'List distinct departments on a public Ashby job board with job counts.',
  notes: 'Departments are derived from the full public job list.',
  input: z.object({
    jobBoardName: JobBoardNameParam,
  }),
  output: z.object({
    departments: z.array(DepartmentSchema).describe('Distinct departments sorted by name'),
    total: z.number().describe('Number of distinct departments'),
  }),
};

export const getApplicationFormSchema = {
  name: 'getApplicationForm',
  description: 'Get the public application form sections and required applicant fields for a single Ashby job.',
  notes: 'Use this to assess application friction before applying. Field definitions come from Ashby as JSON scalars with type-specific metadata.',
  input: z.object({
    jobBoardName: JobBoardNameParam,
    jobId: JobIdParam,
  }),
  output: z.object({
    jobId: z.string().describe('Ashby job posting ID'),
    title: z.string().describe('Job title'),
    applicationForm: ApplicationFormSchema.nullable().describe('Public application form definition, or null if Ashby exposes none'),
  }),
};

export const allSchemas = [
  listJobsSchema,
  getJobSchema,
  searchJobsSchema,
  listTeamsSchema,
  listDepartmentsSchema,
  getApplicationFormSchema,
];

export type Job = z.infer<typeof JobSchema>;
export type JobDetail = z.infer<typeof JobDetailSchema>;
export type ApplicationForm = z.infer<typeof ApplicationFormSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type LightweightPosting = z.infer<typeof LightweightPostingSchema>;
export type Department = z.infer<typeof DepartmentSchema>;
export type ListJobsOutput = z.infer<typeof listJobsSchema.output>;
export type GetJobOutput = z.infer<typeof getJobSchema.output>;
export type SearchJobsOutput = z.infer<typeof searchJobsSchema.output>;
export type ListTeamsOutput = z.infer<typeof listTeamsSchema.output>;
export type ListDepartmentsOutput = z.infer<typeof listDepartmentsSchema.output>;
export type GetApplicationFormOutput = z.infer<typeof getApplicationFormSchema.output>;
