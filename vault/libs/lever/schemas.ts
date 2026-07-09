import { z } from 'zod';

export const libraryDescription =
  'Lever public postings — read published jobs from public Lever job boards by company slug, filters, grouping, pagination, and posting ID';
export const libraryIcon = '/icons/libs/lever.png';
export const loginUrl = 'https://lever.co';
export const libraryVisibility = 'public' as const;

export const libraryNotes = `
## Workflow

Lever public postings are unauthenticated. You only need the company's Lever slug, usually the path segment in a jobs.lever.co URL: \`https://jobs.lever.co/{companySlug}\`.

1. Start with a known company slug from the user's prompt or a jobs.lever.co careers URL.
2. Use filters when you know exact Lever category values. Filter matching is case-sensitive, and multiple values for one filter are OR-combined.
3. Use \`skip\` and \`limit\` for offset pagination on large boards.
4. Use \`groupBy\` for career-page-style buckets by team, location, or commitment. The response still includes a flattened postings array plus grouped buckets.
5. Use a posting ID from a list result to fetch one full posting detail.

## Key Concepts

- Public scope only: published postings on public Lever job boards. Internal drafts, candidates, applications, recruiter/admin actions, and tenant management are not available here.
- Posting IDs are UUID-like public IDs and appear in both \`hostedUrl\` and \`applyUrl\`.
- \`categories\` carries recruiter-facing fields: location, team, department, commitment, optional level, and allLocations.
- Text fields come in HTML and plain-text variants. Prefer plain fields for summaries; use HTML fields when preserving formatting matters.
- Salary data is optional and appears only when a company publishes it.
`;

const stringOrStringArraySchema = z
  .union([z.string(), z.array(z.string())])
  .describe(
    'One exact category value or multiple exact values. Lever treats repeated values for the same filter as OR and matching is case-sensitive.',
  );

const postingCategoriesSchema = z
  .object({
    location: z
      .string()
      .nullable()
      .describe('Primary location label shown on the posting, when present'),
    team: z
      .string()
      .nullable()
      .describe('Team/category label shown on the posting, when present'),
    department: z
      .string()
      .nullable()
      .describe('Department label shown on the posting, when present'),
    commitment: z
      .string()
      .nullable()
      .describe('Commitment/employment-type label, e.g. Permanent or Full-time'),
    level: z
      .string()
      .nullable()
      .describe('Level/seniority label, when the board publishes one'),
    allLocations: z
      .array(z.string())
      .describe('All location labels published for this posting'),
  })
  .describe('Lever category labels attached to a posting');

const postingListSectionSchema = z
  .object({
    title: z.string().describe('Section heading from the posting, e.g. responsibilities or requirements'),
    contentHtml: z.string().describe('HTML content for this section'),
    contentPlain: z.string().describe('Plain-text content extracted from the section HTML'),
  })
  .describe('Structured section from the job posting body');

const salaryRangeSchema = z
  .object({
    currency: z.string().nullable().describe('ISO currency code, when supplied'),
    interval: z
      .string()
      .nullable()
      .describe('Pay interval label published by Lever, e.g. per-year-salary'),
    min: z.number().nullable().describe('Minimum salary/rate value, when supplied'),
    max: z.number().nullable().describe('Maximum salary/rate value, when supplied'),
  })
  .describe('Published salary range, when the posting includes structured pay data');

const leverPostingSchema = z
  .object({
    id: z.string().describe('Public Lever posting ID'),
    title: z.string().describe('Normalized job title'),
    text: z.string().describe('Raw Lever title field'),
    categories: postingCategoriesSchema,
    country: z
      .string()
      .nullable()
      .describe('ISO 3166-1 alpha-2 country/territory code, when supplied'),
    workplaceType: z
      .string()
      .nullable()
      .describe('Workplace type. Known values include unspecified, on-site, remote, and hybrid.'),
    opening: z.string().describe('Opening/introduction HTML from Lever, often empty'),
    openingPlain: z.string().describe('Plain-text opening/introduction, often empty'),
    description: z.string().describe('Main posting description HTML'),
    descriptionPlain: z.string().describe('Main posting description as plain text'),
    descriptionBody: z.string().describe('Posting body HTML, when Lever separates it from description'),
    descriptionBodyPlain: z.string().describe('Posting body as plain text'),
    lists: z.array(postingListSectionSchema).describe('Structured posting sections'),
    additional: z.string().describe('Additional information HTML such as benefits or equal-opportunity text'),
    additionalPlain: z.string().describe('Additional information as plain text'),
    hostedUrl: z.string().url().describe('Public Lever-hosted detail page URL'),
    applyUrl: z.string().url().describe('Public Lever-hosted application URL'),
    createdAt: z.number().nullable().describe('Lever-created timestamp in Unix epoch milliseconds'),
    createdAtIso: z
      .string()
      .nullable()
      .describe('ISO-8601 rendering of createdAt, when createdAt is available'),
    salaryRange: salaryRangeSchema.nullable().describe('Structured salary range, when published'),
    salaryDescription: z.string().nullable().describe('Salary description HTML, when published'),
    salaryDescriptionPlain: z.string().nullable().describe('Salary description as plain text, when published'),
  })
  .describe('Normalized public Lever posting');

const groupBySchema = z
  .enum(['team', 'location', 'commitment'])
  .describe('Career-page grouping dimension supported by Lever');

const postingGroupSchema = z
  .object({
    title: z.string().describe('Bucket label for the grouped postings'),
    postings: z.array(leverPostingSchema).describe('Postings in this bucket'),
    count: z.number().describe('Number of postings in this bucket'),
  })
  .describe('Grouped Lever posting bucket');

const listFiltersAppliedSchema = z.object({
  location: z
    .array(z.string())
    .describe('Location filter values sent to Lever, case-sensitive'),
  team: z.array(z.string()).describe('Team filter values sent to Lever, case-sensitive'),
  department: z
    .array(z.string())
    .describe('Department filter values sent to Lever, case-sensitive'),
  commitment: z
    .array(z.string())
    .describe('Commitment filter values sent to Lever, case-sensitive'),
  level: z.array(z.string()).describe('Level filter values sent to Lever, case-sensitive'),
});

export const listPostingsSchema = {
  name: 'listPostings',
  description:
    'List published public Lever postings for one company slug, with optional Lever category filters, offset pagination, and grouped buckets.',
  notes:
    'Use the company slug from a jobs.lever.co URL. Filters are case-sensitive exact category labels. Multiple values for one filter are OR-combined by Lever. groupBy can be team, location, or commitment and returns grouped buckets plus a flattened postings array.',
  input: z.object({
    companySlug: z
      .string()
      .min(1)
      .describe('Lever company slug, e.g. spotify from https://jobs.lever.co/spotify'),
    location: stringOrStringArraySchema.optional().describe('Location filter value(s), case-sensitive'),
    team: stringOrStringArraySchema.optional().describe('Team filter value(s), case-sensitive'),
    department: stringOrStringArraySchema.optional().describe('Department filter value(s), case-sensitive'),
    commitment: stringOrStringArraySchema.optional().describe('Commitment filter value(s), case-sensitive'),
    level: stringOrStringArraySchema.optional().describe('Level filter value(s), case-sensitive'),
    skip: z.number().int().nonnegative().optional().describe('Offset into the posting list'),
    limit: z.number().int().positive().optional().describe('Maximum number of postings to return'),
    groupBy: groupBySchema.optional(),
  }),
  output: z.object({
    companySlug: z.string().describe('Lever company slug that was queried'),
    total: z.number().describe('Number of postings returned after filters and pagination'),
    groupBy: groupBySchema.nullable().describe('Grouping dimension used, or null for an ungrouped list'),
    filtersApplied: listFiltersAppliedSchema.describe('Filter values sent to Lever'),
    skip: z.number().nullable().describe('Offset sent to Lever, or null when omitted'),
    limit: z.number().nullable().describe('Limit sent to Lever, or null when omitted'),
    postings: z.array(leverPostingSchema).describe('Flattened normalized postings'),
    groups: z
      .array(postingGroupSchema)
      .describe('Grouped buckets. Empty when groupBy is omitted.'),
  }),
};

export type ListPostingsInput = z.infer<typeof listPostingsSchema.input>;
export type ListPostingsOutput = z.infer<typeof listPostingsSchema.output>;

export const getPostingSchema = {
  name: 'getPosting',
  description:
    'Get one published public Lever posting by company slug and public posting ID.',
  notes:
    'Use a posting ID from listPostings or from the jobs.lever.co detail URL. Returns only published public postings; internal or closed postings are not available.',
  input: z.object({
    companySlug: z
      .string()
      .min(1)
      .describe('Lever company slug, e.g. spotify from https://jobs.lever.co/spotify'),
    postingId: z.string().min(1).describe('Public Lever posting ID'),
  }),
  output: z.object({
    companySlug: z.string().describe('Lever company slug that was queried'),
    postingId: z.string().describe('Public Lever posting ID that was queried'),
    posting: leverPostingSchema.describe('Normalized public Lever posting detail'),
  }),
};

export type GetPostingInput = z.infer<typeof getPostingSchema.input>;
export type GetPostingOutput = z.infer<typeof getPostingSchema.output>;
export type LeverPosting = z.infer<typeof leverPostingSchema>;

export const allSchemas = [listPostingsSchema, getPostingSchema];
