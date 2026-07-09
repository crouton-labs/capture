import { z } from 'zod';

export const libraryDescription = 'Public Workable job-board reads for board listings, job detail pages, departments, and locations.';
export const libraryIcon = '/icons/libs/workable.png';
export const loginUrl = 'https://apply.workable.com';
export const libraryVisibility = 'public' as const;

export const libraryNotes = `
## Workflow

Workable is public and read-only. Pass the exact board slug from the apply.workable.com URL into every function.

1. Use the board slug from the public board URL, for example \`huggingface\`, \`hospitable\`, or \`futureplc\`.
2. listJobs reads the public board markdown page and returns the full visible job table plus derived department/location aggregates.
3. getJob reads the public markdown detail page for one job shortcode.
4. listDepartments and listLocations are derived from the same public board table.

## Key Concepts

- Public scope only: no login, cookies, or hidden admin APIs.
- The library must run on https://apply.workable.com.
- Job rows expose title, department, location, type, salary, posted date, and a public detail link.
- Job detail pages expose the board/company name, workplace, department, and the rendered description markdown.
`.trim();

export const BoardSlugParam = z
  .string()
  .min(1)
  .describe('Workable board slug from the public apply.workable.com URL, such as huggingface or hospitable.');

export const JobIdParam = z
  .string()
  .min(1)
  .describe('Workable job shortcode from the public board detail URL, such as 81B46579FE.');

export const WorkableBoardMetaSchema = z
  .object({
    boardSlug: z.string().describe('Public Workable board slug echoed from the request.'),
    boardUrl: z.string().url().describe('Public Workable board URL for this slug.'),
    companyName: z.string().describe('Company name shown by the public Workable board.'),
    lastUpdated: z.string().describe('Last updated date shown on the public board markdown page.'),
  })
  .passthrough()
  .describe('Public Workable board metadata.');

export const WorkableJobSummarySchema = z
  .object({
    id: z.string().describe('Workable job shortcode from the public board detail URL.'),
    title: z.string().describe('Job title shown on the public board.'),
    department: z.string().describe('Department label shown on the public board.'),
    location: z.string().describe('Location label shown on the public board.'),
    type: z.string().describe('Employment type label shown on the public board.'),
    salary: z.string().describe('Salary label shown on the public board, or an em dash when absent.'),
    postedOn: z.string().describe('Posted date shown on the public board.'),
    publicUrl: z.string().url().describe('Public HTML job page URL.'),
    markdownUrl: z.string().url().describe('Public markdown job page URL.'),
  })
  .passthrough()
  .describe('Public Workable job summary row.');

export const WorkableJobDetailSchema = WorkableJobSummarySchema.extend({
  companyName: z.string().describe('Company name shown on the public detail page.'),
  workplace: z.string().describe('Workplace label shown on the public detail page.'),
  descriptionMarkdown: z.string().describe('Rendered markdown body of the public job description.'),
}).describe('Public Workable job detail page.');

export const WorkableDepartmentSchema = z
  .object({
    name: z.string().describe('Department name shown on the public board.'),
    count: z.number().int().nonnegative().describe('Number of jobs in this department on the public board.'),
  })
  .passthrough()
  .describe('Aggregated public Workable department.');

export const WorkableLocationSchema = z
  .object({
    label: z.string().describe('Location label shown on the public board.'),
    count: z.number().int().nonnegative().describe('Number of jobs in this location on the public board.'),
  })
  .passthrough()
  .describe('Aggregated public Workable location.');

export const listJobsSchema = {
  name: 'listJobs',
  description: 'List public Workable jobs for one board slug, along with derived department and location aggregates.',
  notes: 'Use the exact public board slug from apply.workable.com. The board data is read from the public jobs markdown page and the returned jobs include public HTML and markdown URLs.',
  input: z.object({
    boardSlug: BoardSlugParam,
  }),
  output: z.object({
    ...WorkableBoardMetaSchema.shape,
    total: z.number().int().nonnegative().describe('Total number of public jobs on the board.'),
    jobs: z.array(WorkableJobSummarySchema).describe('Public Workable job rows.'),
    departments: z.array(WorkableDepartmentSchema).describe('Derived department aggregates from the public board rows.'),
    locations: z.array(WorkableLocationSchema).describe('Derived location aggregates from the public board rows.'),
  }),
};

export type ListJobsInput = z.infer<typeof listJobsSchema.input>;
export type ListJobsOutput = z.infer<typeof listJobsSchema.output>;
export type WorkableBoardMeta = z.infer<typeof WorkableBoardMetaSchema>;
export type WorkableJobSummary = z.infer<typeof WorkableJobSummarySchema>;
export type WorkableJobDetail = z.infer<typeof WorkableJobDetailSchema>;
export type WorkableDepartment = z.infer<typeof WorkableDepartmentSchema>;
export type WorkableLocation = z.infer<typeof WorkableLocationSchema>;

export const getJobSchema = {
  name: 'getJob',
  description: 'Get one public Workable job by board slug and job shortcode.',
  notes: 'Use the exact public board slug from apply.workable.com and the job shortcode from the public detail URL. The returned job includes the rendered markdown description.',
  input: z.object({
    boardSlug: BoardSlugParam,
    jobId: JobIdParam,
  }),
  output: z.object({
    ...WorkableBoardMetaSchema.shape,
    job: WorkableJobDetailSchema.describe('Public Workable job detail.'),
  }),
};

export type GetJobInput = z.infer<typeof getJobSchema.input>;
export type GetJobOutput = z.infer<typeof getJobSchema.output>;

export const listDepartmentsSchema = {
  name: 'listDepartments',
  description: 'List the public Workable departments derived from the visible job table for one board slug.',
  notes: 'Use the exact public board slug from apply.workable.com. This function derives department counts from the public jobs markdown page.',
  input: z.object({
    boardSlug: BoardSlugParam,
  }),
  output: z.object({
    ...WorkableBoardMetaSchema.shape,
    departments: z.array(WorkableDepartmentSchema).describe('Derived department aggregates.'),
  }),
};

export type ListDepartmentsInput = z.infer<typeof listDepartmentsSchema.input>;
export type ListDepartmentsOutput = z.infer<typeof listDepartmentsSchema.output>;

export const listLocationsSchema = {
  name: 'listLocations',
  description: 'List the public Workable locations derived from the visible job table for one board slug.',
  notes: 'Use the exact public board slug from apply.workable.com. This function derives location counts from the public jobs markdown page.',
  input: z.object({
    boardSlug: BoardSlugParam,
  }),
  output: z.object({
    ...WorkableBoardMetaSchema.shape,
    locations: z.array(WorkableLocationSchema).describe('Derived location aggregates.'),
  }),
};

export type ListLocationsInput = z.infer<typeof listLocationsSchema.input>;
export type ListLocationsOutput = z.infer<typeof listLocationsSchema.output>;

export const allSchemas = [listJobsSchema, getJobSchema, listDepartmentsSchema, listLocationsSchema];
