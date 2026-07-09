import { z } from 'zod';

export const libraryDescription =
  'Wellfound public job-board reads — browse public search, company, and job pages from the live browser session';
export const libraryIcon = '/icons/libs/wellfound.png';
export const loginUrl = 'https://wellfound.com';
export const libraryVisibility = 'public' as const;

export const libraryNotes = `
## Workflow

Wellfound is read-only and public. Use the live wellfound.com browser session; there is no public API and no separate auth flow.

1. Read search pages from /jobs, /role/*, and /location/*.
2. Read company pages from /company/{slug} and /company/{slug}/jobs.
3. Read job detail pages from /jobs/{id}-{slug} when you need the full body, skills, recruiter, or application URL.

## Key Concepts

- Company slugs are the path segment after /company/.
- Role and location slugs are canonical Wellfound path slugs, not display names.
- Search result job cards carry snippets and a preformatted compensation string; the full description and apply URL live on the job detail page.
- Company pages ship a normalized Apollo cache in __NEXT_DATA__. StartupResult and JobListingSearchResult are search cards; Startup is the company profile; JobListing is the full job page entity.
- Location names and other relations are stored as Apollo reference wrappers; unwrap them before returning results.
- Company jobs expose only the embedded first jobListingsConnection on the page; this reader caps the returned jobs with first but does not navigate cursors. nextCursor and totalPageCount are informational only.
`;

const CompanySizeSchema = z
  .enum([
    'SIZE_1_10',
    'SIZE_11_50',
    'SIZE_51_100',
    'SIZE_101_200',
    'SIZE_201_500',
    'SIZE_501_1000',
    'SIZE_1001_5000',
    'SIZE_5001_10000',
    'SIZE_10001_',
  ])
  .describe('Wellfound company-size enum. Known values: SIZE_1_10, SIZE_11_50, SIZE_51_100, SIZE_101_200, SIZE_201_500, SIZE_501_1000, SIZE_1001_5000, SIZE_5001_10000, SIZE_10001_.');

const JobTypeSchema = z
  .enum(['full_time', 'part_time', 'contract', 'internship', 'cofounder'])
  .describe('Wellfound job type code. Known values: full_time, part_time, contract, internship, cofounder.');

const SearchPageTypeSchema = z
  .enum(['jobs', 'role', 'location'])
  .describe('Wellfound page type used for a search request.');

const BadgeSchema = z
  .object({
    label: z.string().describe('Badge label shown on the company card'),
    tooltip: z.string().nullable().describe('Badge tooltip text, when Wellfound exposes one'),
  })
  .describe('Company-card badge');

const JobCardSchema = z
  .object({
    id: z.string().describe('Wellfound job listing ID'),
    title: z.string().describe('Job title'),
    slug: z.string().describe('Canonical job URL slug'),
    url: z.string().describe('Canonical Wellfound job URL'),
    companyName: z.string().nullable().describe('Company name, when visible on the card'),
    companySlug: z.string().nullable().describe('Company slug, when visible on the card'),
    companyProfileUrl: z.string().nullable().describe('Company profile URL, when visible on the card'),
    companyJobsUrl: z.string().nullable().describe('Company jobs-tab URL, when visible on the card'),
    companyLogoUrl: z.string().nullable().describe('Company logo URL, when visible on the card'),
    companyHighConcept: z.string().nullable().describe('Company pitch/short summary, when visible on the card'),
    companySize: CompanySizeSchema.nullable().describe('Company size enum, when visible on the card'),
    primaryRoleTitle: z.string().nullable().describe('Primary role label, when visible on the card'),
    primaryRoleParent: z.string().nullable().describe('Parent role category, when visible on the card'),
    jobType: JobTypeSchema.nullable().describe('Employment type code, when visible on the card'),
    remote: z.boolean().nullable().describe('Whether the role is marked remote, when visible on the card'),
    locationNames: z.array(z.string()).describe('Location labels shown on the card'),
    liveStartAt: z.number().nullable().describe('Posting timestamp in Unix seconds, when visible on the card'),
    compensationText: z.string().nullable().describe('Human-readable salary/equity string shown on the card, when visible'),
    descriptionSnippet: z.string().nullable().describe('Short HTML excerpt shown on the card, when visible'),
  })
  .describe('Wellfound search-result job card');

const CompanySearchCardSchema = z
  .object({
    id: z.string().describe('Wellfound company ID'),
    name: z.string().describe('Company name'),
    slug: z.string().describe('Company slug'),
    profileUrl: z.string().describe('Canonical Wellfound company profile URL'),
    jobsUrl: z.string().describe('Canonical Wellfound company jobs-tab URL'),
    logoUrl: z.string().nullable().describe('Company logo URL, when visible'),
    highConcept: z.string().nullable().describe('Company pitch/short summary, when visible'),
    companySize: CompanySizeSchema.nullable().describe('Company size enum, when visible'),
    badges: z.array(BadgeSchema).describe('Badges shown on the company card'),
    highlightedJobs: z.array(JobCardSchema).describe('Highlighted job cards shown inside the company card'),
  })
  .describe('Wellfound search-result company card');

const CompanyProfileSchema = z
  .object({
    id: z.string().describe('Wellfound company ID'),
    name: z.string().describe('Company name'),
    slug: z.string().describe('Company slug'),
    profileUrl: z.string().describe('Canonical Wellfound company profile URL'),
    jobsUrl: z.string().describe('Canonical Wellfound company jobs-tab URL'),
    logoUrl: z.string().nullable().describe('Company logo URL, when visible'),
    highConcept: z.string().nullable().describe('Company pitch/short summary, when visible'),
    companySize: CompanySizeSchema.nullable().describe('Company size enum, when visible'),
    totalRaisedAmount: z.number().nullable().describe('Total funding raised in USD, when visible'),
    websiteUrl: z.string().nullable().describe('Public company website URL, when visible'),
    twitterUrl: z.string().nullable().describe('Public Twitter/X URL, when visible'),
    linkedInUrl: z.string().nullable().describe('Public LinkedIn URL, when visible'),
    productHuntUrl: z.string().nullable().describe('Public Product Hunt URL, when visible'),
    blogUrl: z.string().nullable().describe('Public blog URL, when visible'),
    facebookUrl: z.string().nullable().describe('Public Facebook URL, when visible'),
    jobPreamble: z.string().nullable().describe('Company-written hiring intro text, when visible'),
    isOperating: z.boolean().nullable().describe('Whether Wellfound marks the company as operating, when visible'),
    public: z.boolean().nullable().describe('Whether the profile is public, when visible'),
    published: z.boolean().nullable().describe('Whether the profile is published, when visible'),
    quarantined: z.boolean().nullable().describe('Whether the profile is quarantined, when visible'),
    isShell: z.boolean().nullable().describe('Whether the profile is a shell company record, when visible'),
    isIncubator: z.boolean().nullable().describe('Whether the profile is marked as an incubator, when visible'),
  })
  .describe('Wellfound company profile summary');

const JobCompanyContextSchema = z
  .object({
    name: z.string().describe('Company name'),
    slug: z.string().nullable().describe('Company slug, when visible'),
    profileUrl: z.string().nullable().describe('Canonical Wellfound company profile URL, when visible'),
    jobsUrl: z.string().nullable().describe('Canonical Wellfound company jobs-tab URL, when visible'),
    logoUrl: z.string().nullable().describe('Company logo URL, when visible'),
    highConcept: z.string().nullable().describe('Company pitch/short summary, when visible'),
    companySize: CompanySizeSchema.nullable().describe('Company size enum, when visible'),
    totalRaisedAmount: z.number().nullable().describe('Total funding raised in USD, when visible'),
    websiteUrl: z.string().nullable().describe('Public company website URL, when visible'),
  })
  .describe('Company context visible on a job detail page');

const RecruiterSchema = z
  .object({
    name: z.string().nullable().describe('Recruiter or hiring-manager name, when visible'),
    title: z.string().nullable().describe('Recruiter or hiring-manager title, when visible'),
    profileUrl: z.string().nullable().describe('Public recruiter profile URL, when visible'),
  })
  .describe('Recruiter or hiring-manager reference');

const SalaryRangeSchema = z
  .object({
    currency: z.string().nullable().describe('ISO currency code, when visible'),
    minUsd: z.number().nullable().describe('Minimum salary in USD, when visible'),
    maxUsd: z.number().nullable().describe('Maximum salary in USD, when visible'),
    unitText: z.string().nullable().describe('Salary unit text, when visible'),
  })
  .describe('Structured salary range visible on the job detail page');

const EquityRangeSchema = z
  .object({
    minPct: z.number().nullable().describe('Minimum equity percentage, when visible'),
    maxPct: z.number().nullable().describe('Maximum equity percentage, when visible'),
  })
  .describe('Structured equity range visible on the job detail page');

const CompensationSchema = z
  .object({
    salaryText: z.string().nullable().describe('Human-readable compensation text, when visible'),
    salary: SalaryRangeSchema.nullable().describe('Structured salary range, when visible'),
    equity: EquityRangeSchema.nullable().describe('Structured equity range, when visible'),
  })
  .describe('Job compensation details visible on the detail page');

export const searchJobsSchema = {
  name: 'searchJobs',
  description:
    'Read a public Wellfound search, role, location, or jobs-filter page and return the visible job cards and company cards.',
  notes:
    'Role and location slugs are the Wellfound path slugs, not display names. When role is provided, the function reads the role route; when location is provided without role, it reads the location route; otherwise it reads /jobs with query and market filters. page is the SEO page number on paginated routes.',
  input: z.object({
    query: z.string().optional().describe('Free-text query for /jobs, when used'),
    role: z.string().optional().describe('Role slug from a Wellfound role page, when used'),
    location: z.string().optional().describe('Location slug from a Wellfound location page or /jobs filter, when used'),
    market: z.string().optional().describe('Market slug for /jobs, when used'),
    page: z.number().int().positive().optional().default(1).describe('SEO page number to read, starting at 1'),
  }),
  output: z.object({
    sourceUrl: z.string().describe('Canonical Wellfound page URL that was read'),
    pageType: SearchPageTypeSchema.describe('Page type used for the search request'),
    page: z.number().describe('SEO page number that was requested'),
    query: z.string().nullable().describe('Free-text query used on /jobs, when any'),
    role: z.string().nullable().describe('Role slug used on a role page, when any'),
    location: z.string().nullable().describe('Location slug used on a location page, when any'),
    market: z.string().nullable().describe('Market slug used on /jobs, when any'),
    jobs: z.array(JobCardSchema).describe('Visible job cards returned from the page'),
    companies: z.array(CompanySearchCardSchema).describe('Visible company cards returned from the page'),
  }),
};

export type SearchJobsInput = z.infer<typeof searchJobsSchema.input>;
export type SearchJobsOutput = z.infer<typeof searchJobsSchema.output>;

export const getCompanyProfileSchema = {
  name: 'getCompanyProfile',
  description: 'Read a public Wellfound company profile page and return the visible company summary.',
  notes:
    'Use the company slug from the Wellfound /company/{slug} path segment. The returned slug is the canonical Wellfound slug, including any numeric disambiguator suffix.',
  input: z.object({
    companySlug: z.string().min(1).describe('Wellfound company slug from /company/{slug}'),
  }),
  output: CompanyProfileSchema,
};

export type GetCompanyProfileInput = z.infer<typeof getCompanyProfileSchema.input>;
export type GetCompanyProfileOutput = z.infer<typeof getCompanyProfileSchema.output>;

export const listCompanyJobsSchema = {
  name: 'listCompanyJobs',
  description: 'Read a public Wellfound company jobs tab and return jobs from the embedded first-page connection.',
  notes:
    'Use the company slug from /company/{slug}. This reader only consumes the page-embedded first jobListingsConnection and cannot follow cursors; first is only a cap on how many jobs are returned from that embedded page.',
  input: z.object({
    companySlug: z.string().min(1).describe('Wellfound company slug from /company/{slug}'),
    first: z.number().int().positive().max(20).optional().default(20).describe('Maximum number of jobs to return from the embedded first-page connection'),
  }),
  output: z.object({
    sourceUrl: z.string().describe('Canonical Wellfound company jobs-tab URL that was read'),
    first: z.number().describe('Requested return cap for the embedded first-page connection'),
    pageSize: z.number().describe('Page size reported by Wellfound for the loaded connection'),
    totalPageCount: z.number().nullable().describe('Total page count reported by Wellfound, when visible'),
    nextCursor: z.string().nullable().describe('Cursor for the next page, when visible; informational only because this reader does not page'),
    company: CompanyProfileSchema.describe('Company summary for the jobs page'),
    jobs: z.array(JobCardSchema).describe('Jobs returned from the embedded first-page connection'),
  }),
};

export type ListCompanyJobsInput = z.infer<typeof listCompanyJobsSchema.input>;
export type ListCompanyJobsOutput = z.infer<typeof listCompanyJobsSchema.output>;

export const getJobSchema = {
  name: 'getJob',
  description: 'Read a public Wellfound job detail page and return the full description, skills, recruiter, and company context.',
  notes:
    'Use the job id and slug from the canonical /jobs/{id}-{slug} path. The job detail page is the only surface that exposes the full body, skill tags, recruiter reference, and application URL.',
  input: z.object({
    jobId: z.string().min(1).describe('Wellfound numeric job ID from /jobs/{id}-{slug}'),
    slug: z.string().min(1).describe('Wellfound job slug from /jobs/{id}-{slug}'),
  }),
  output: z.object({
    jobId: z.string().describe('Wellfound numeric job ID'),
    slug: z.string().describe('Canonical Wellfound job slug'),
    url: z.string().describe('Canonical Wellfound job URL'),
    title: z.string().describe('Job title'),
    company: JobCompanyContextSchema.describe('Company context visible on the job page'),
    descriptionHtml: z.string().describe('Full HTML description from the job page'),
    descriptionText: z.string().describe('Plain-text rendering of the full job description'),
    skills: z.array(z.string()).describe('Skill tags visible on the job detail page'),
    locationNames: z.array(z.string()).describe('Location labels visible on the job detail page'),
    remote: z.boolean().nullable().describe('Whether the role is marked remote, when visible'),
    jobType: JobTypeSchema.nullable().describe('Employment type code, when visible'),
    employmentType: z.string().nullable().describe('Normalized Wellfound employment type, when visible'),
    experienceLevel: z.string().nullable().describe('Experience level, when visible'),
    liveStartAt: z.number().nullable().describe('Posting timestamp in Unix seconds, when visible'),
    postedAtIso: z.string().nullable().describe('Posting date/time in ISO format, when visible'),
    compensation: CompensationSchema.nullable().describe('Compensation details visible on the job page'),
    applyUrl: z.string().nullable().describe('Application URL, when visible'),
    atsUrl: z.string().nullable().describe('External ATS URL, when Wellfound surfaces one'),
    atsSource: z.string().nullable().describe('External ATS source label, when Wellfound surfaces one'),
    recruiter: RecruiterSchema.nullable().describe('Recruiter or hiring-manager reference, when visible'),
  }),
};

export type GetJobInput = z.infer<typeof getJobSchema.input>;
export type GetJobOutput = z.infer<typeof getJobSchema.output>;

export const allSchemas = [
  searchJobsSchema,
  getCompanyProfileSchema,
  listCompanyJobsSchema,
  getJobSchema,
];
