import { z } from 'zod';

export const libraryDescription = 'Public Workday careers-board reads for hosted job lists and detail pages on myworkdayjobs.com';
export const libraryIcon = '/icons/libs/workday.png';
export const loginUrl = 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite';
export const libraryVisibility = 'public' as const;

export const libraryNotes = `
## Workflow

Workday public careers pages are unauthenticated. Open the exact tenant careers tab first, then pass the tenant, dataCenter, and site from that URL directly into the functions.

1. Use the tenant slug from the hostname, the opaque dataCenter from the hostname, and the site slug from the "/en-US/{site}" path segment.
2. Use the listing function for pagination, searchText, and facet discovery. Workday rejects limit values above 20.
3. Feed appliedFacets with leaf facet IDs from facets[].values[].id; facet trees can nest under higher-level groups.
4. Use the detail function with the exact externalPath returned by the listing function. Do not rewrite or reconstruct it.

## Key Concepts

- Public scope only: no login, CSRF, cookies, or private Workday admin APIs.
- tenant appears twice: once in the hostname and once in the CXS path.
- dataCenter is opaque and must be copied from the public careers URL host.
- site comes from the careers URL path after /en-US/.
- jobPostings[].bulletFields[0] is the requisition ID; later bullet fields are location/store labels when present.
- detail externalPath starts with /job/ and must be used verbatim.
`.trim();

export const TenantParam = z
  .string()
  .min(1)
  .describe('Workday tenant slug that appears in both the hostname and the CXS path, for example nvidia or carmax.');

export const DataCenterParam = z
  .string()
  .min(1)
  .describe('Opaque Workday data center slug from the hostname, for example wd5 or wd1. Copy it exactly from the careers URL.');

export const SiteParam = z
  .string()
  .min(1)
  .describe('Workday careers site slug from the URL path after /en-US/, for example NVIDIAExternalCareerSite or External.');

export const ExternalPathParam = z
  .string()
  .min(1)
  .regex(/^\/job\//, 'Public Workday job path must start with /job/.')
  .describe('Public Workday job path copied verbatim from listJobs jobPostings[].externalPath. Must start with /job/.');

export const WorkdayAppliedFacetsParam = z
  .record(
    z.string(),
    z
      .array(z.string().describe('Opaque Workday facet value ID taken from facets[].values[].id.'))
      .describe('Facet value IDs for one Workday facetParameter. Use leaf IDs only, not group IDs.'),
  )
  .describe('Map of Workday facetParameter names to arrays of leaf facet value IDs. Common keys include jobFamilyGroup, workerSubType, timeType, and location hierarchy facets.')
  .default({});

const WorkdayCountrySchema = z
  .object({
    descriptor: z.string().describe('Country display name as returned by Workday.'),
    id: z.string().describe('Opaque Workday country ID.'),
    alpha2Code: z
      .string()
      .optional()
      .describe('ISO 3166-1 alpha-2 country code when Workday includes it.'),
  })
  .describe('Workday country reference used on job detail pages.');

const WorkdayJobRequisitionLocationSchema = z
  .object({
    descriptor: z.string().describe('Human-readable requisition location label.'),
    country: WorkdayCountrySchema.describe('Country attached to the requisition location.'),
  })
  .describe('Workday requisition location payload.');

const WorkdayListJobPostingSchema = z
  .object({
    title: z.string().describe('Job title shown on the public Workday board.'),
    externalPath: z
      .string()
      .describe('Public Workday job path. Reuse verbatim when calling getJob; it starts with /job/.'),
    publicUrl: z.string().url().describe('Public Workday careers URL for this posting.'),
    locationsText: z.string().describe('Human-readable location summary shown on the board.'),
    postedOn: z.string().describe('Relative posted-on label shown on the board, such as Posted Today.'),
    jobReqId: z.string().describe('Workday requisition ID extracted from bulletFields[0].'),
    bulletFields: z
      .array(z.string())
      .describe('Raw Workday bullet fields. The first element is the requisition ID; later elements are location/store labels when present.'),
  })
  .describe('Normalized Workday list/search job posting.');

const WorkdayFacetValueSchema = z
  .object({
    descriptor: z.string().describe('Facet value label shown in the Workday UI.'),
    id: z.string().describe('Opaque facet value ID to send in appliedFacets.'),
    count: z.number().describe('Number of matching jobs for this facet value.'),
  })
  .describe('Workday facet leaf value.');

export type WorkdayFacetValue = z.infer<typeof WorkdayFacetValueSchema>;
export type WorkdayFacetGroup = {
  facetParameter: string;
  descriptor?: string | null;
  values: WorkdayFacetNode[];
};
export type WorkdayFacetNode = WorkdayFacetValue | WorkdayFacetGroup;

let WorkdayFacetNodeSchema: z.ZodType<WorkdayFacetNode>;
const WorkdayFacetGroupSchema: z.ZodType<WorkdayFacetGroup> = z
  .object({
    facetParameter: z.string().describe('Workday facet parameter name for this facet group.'),
    descriptor: z
      .string()
      .nullable()
      .optional()
      .describe('Facet group label shown in the Workday UI, when present.'),
    values: z
      .array(z.lazy(() => WorkdayFacetNodeSchema))
      .describe('Nested facet values or nested facet groups.'),
  })
  .describe('Workday facet group.');

WorkdayFacetNodeSchema = z.lazy(() => z.union([WorkdayFacetValueSchema, WorkdayFacetGroupSchema])) as z.ZodType<WorkdayFacetNode>;

const WorkdayHiringOrganizationSchema = z
  .object({
    name: z.string().describe('Hiring organization name shown on the public job page.'),
    url: z.string().describe('Hiring organization URL shown by Workday.'),
  })
  .describe('Public hiring organization payload.');

const WorkdayJobPostingInfoSchema = z
  .object({
    id: z.string().describe('Internal Workday job posting ID.'),
    title: z.string().describe('Job title.'),
    jobDescription: z.string().describe('HTML job description from Workday.'),
    location: z.string().describe('Primary location label.'),
    additionalLocations: z
      .array(z.string())
      .describe('Additional location labels, when Workday publishes them.'),
    postedOn: z.string().describe('Relative posted-on label shown on the public job page.'),
    startDate: z.string().describe('Job start date in YYYY-MM-DD format.'),
    timeType: z.string().describe('Workday time type label, for example Full time or Part time.'),
    jobReqId: z.string().describe('Workday requisition ID.'),
    jobPostingId: z.string().describe('Workday posting slug identifier.'),
    jobPostingSiteId: z.string().describe('Workday site identifier for this job posting.'),
    country: WorkdayCountrySchema.describe('Country attached to the job posting.'),
    canApply: z.boolean().describe('Whether Workday says the public job can be applied to.'),
    posted: z.boolean().describe('Whether the posting is currently live on the public careers page.'),
    includeResumeParsing: z.boolean().describe('Whether Workday exposes resume parsing for this job.'),
    jobRequisitionLocation: WorkdayJobRequisitionLocationSchema.describe('Requisition location payload.'),
    externalUrl: z
      .string()
      .optional()
      .describe('Public Workday job URL when Workday exposes one on the detail response.'),
    questionnaireId: z
      .string()
      .optional()
      .describe('Public Workday questionnaire ID when Workday exposes one on the detail response.'),
  })
  .describe('Public Workday job detail payload.');

const WorkdaySimilarJobSchema = z
  .object({
    title: z.string().describe('Job title from Workday similar-jobs suggestions.'),
    externalPath: z
      .string()
      .describe('Public Workday job path for the suggested job. Reuse verbatim if you open the job page.'),
    publicUrl: z.string().url().describe('Public Workday careers URL for the suggested job.'),
    timeType: z.string().describe('Workday time type label for the suggested job.'),
    locationsText: z.string().describe('Human-readable location summary for the suggested job.'),
    postedOn: z.string().describe('Relative posted-on label for the suggested job.'),
    startDate: z.string().describe('Suggested job start date in YYYY-MM-DD format.'),
  })
  .describe('Workday similar job suggestion.');

export const listJobsSchema = {
  name: 'listJobs',
  description:
    'List public Workday jobs for one tenant/site, with server-side search, offset pagination, and facet discovery.',
  notes:
    'Run this on the same-origin public careers tab for the exact tenant/dataCenter/site. tenant appears in both the hostname and the CXS path, dataCenter is opaque, site comes from /en-US/{site}, limit is capped at 20, and appliedFacets must use leaf IDs from facets[].values[].id.',
  input: z.object({
    tenant: TenantParam,
    dataCenter: DataCenterParam,
    site: SiteParam,
    limit: z
      .number()
      .int()
      .positive()
      .max(20)
      .optional()
      .default(20)
      .describe('Maximum number of jobs to return. Workday rejects values above 20.'),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(0)
      .describe('Zero-based offset into the public Workday job list.'),
    searchText: z
      .string()
      .optional()
      .default('')
      .describe('Public Workday full-text search query. Empty string means no search filter.'),
    appliedFacets: WorkdayAppliedFacetsParam,
  }),
  output: z.object({
    careersUrl: z.string().url().describe('Public Workday careers page URL for this tenant/site.'),
    tenant: TenantParam.describe('Workday tenant slug echoed back from the request.'),
    dataCenter: DataCenterParam.describe('Workday data center slug echoed back from the request.'),
    site: SiteParam.describe('Workday careers site slug echoed back from the request.'),
    paging: z
      .object({
        limit: z.number().int().positive().max(20).describe('Effective page size used for this request.'),
        offset: z.number().int().nonnegative().describe('Offset used for this request.'),
        returned: z.number().int().nonnegative().describe('Number of job postings returned on this page.'),
        total: z.number().int().nonnegative().describe('Total jobs matching the current query.'),
        hasMore: z.boolean().describe('True when another page exists after this one.'),
        nextOffset: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .describe('Offset for the next page, or null when this page ends the result set.'),
      })
      .describe('Paging metadata for the returned query result.'),
    total: z.number().int().nonnegative().describe('Total jobs matching the current query.'),
    jobPostings: z.array(WorkdayListJobPostingSchema).describe('Normalized public Workday job postings for this page.'),
    facets: z.array(WorkdayFacetGroupSchema).describe('Facet groups and nested values returned by Workday.'),
  }),
};

export const getJobSchema = {
  name: 'getJob',
  description:
    'Get one public Workday job posting by tenant/site and exact externalPath, including the hiring organization and similar jobs.',
  notes:
    'Run this on the same-origin public careers tab. Use the exact externalPath returned by listJobs, prefer jobPostingInfo.externalUrl when opening the public page, and do not rewrite the /job/... path.',
  input: z.object({
    tenant: TenantParam,
    dataCenter: DataCenterParam,
    site: SiteParam,
    externalPath: ExternalPathParam,
  }),
  output: z.object({
    careersUrl: z.string().url().describe('Public Workday careers page URL for this tenant/site.'),
    tenant: TenantParam.describe('Workday tenant slug echoed back from the request.'),
    dataCenter: DataCenterParam.describe('Workday data center slug echoed back from the request.'),
    site: SiteParam.describe('Workday careers site slug echoed back from the request.'),
    externalPath: ExternalPathParam.describe('Exact Workday job path echoed back from the request.'),
    jobPostingInfo: WorkdayJobPostingInfoSchema.describe('Public Workday job detail payload.'),
    hiringOrganization: WorkdayHiringOrganizationSchema.describe('Public hiring organization payload.'),
    similarJobs: z.array(WorkdaySimilarJobSchema).describe('Public similar job suggestions shown on the detail page.'),
  }),
};

export type ListJobsInput = z.infer<typeof listJobsSchema.input>;
export type ListJobsOutput = z.infer<typeof listJobsSchema.output>;
export type GetJobInput = z.infer<typeof getJobSchema.input>;
export type GetJobOutput = z.infer<typeof getJobSchema.output>;

export type WorkdayListJobPosting = z.infer<typeof WorkdayListJobPostingSchema>;
export type WorkdayJobPostingInfo = z.infer<typeof WorkdayJobPostingInfoSchema>;
export type WorkdayHiringOrganization = z.infer<typeof WorkdayHiringOrganizationSchema>;
export type WorkdaySimilarJob = z.infer<typeof WorkdaySimilarJobSchema>;

export const allSchemas = [listJobsSchema, getJobSchema];
