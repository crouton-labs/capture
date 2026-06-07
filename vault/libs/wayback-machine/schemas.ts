import { z } from 'zod';

export const libraryDescription =
  'Wayback Machine: browse archived snapshots of any website and extract logos, testimonials, and page content';

export const libraryIcon = '/icons/libs/wayback-machine.png';
export const libraryVisibility = 'chat' as const;
export const loginUrl = 'https://web.archive.org';

export const libraryNotes = `
## Workflow

1. Navigate to any page (no login required; Wayback Machine is public)
2. Call \`getSnapshots()\` to find archived versions of a target URL
3. Call \`extractLogos()\` or \`extractTestimonials()\` on specific snapshots
4. Use \`extractPageText()\` for general-purpose content extraction

## Key Concepts

- **Snapshots**: Archived copies of web pages captured at specific timestamps (format: YYYYMMDDHHmmss)
- **CDX API**: Index of all archived URLs, used by getSnapshots to query available captures
- **Collapse**: Deduplicate snapshots by time granularity (e.g., one per month with collapse=6)
- **No auth required**: All functions work without login; the Wayback Machine is public

## Snapshot URLs

Archived pages live at: \`https://web.archive.org/web/{timestamp}/{originalUrl}\`
Pass the full \`snapshotUrl\` from getSnapshots to extraction functions.

## Rate Limits

The Wayback Machine has no official rate limit but be respectful; add delays between bulk fetches.
Fetching 30-50 pages sequentially is fine. For 100+ pages, batch with pauses.
`;

export const getSnapshotsSchema = {
  name: 'getSnapshots',
  description:
    'List available archived snapshots of a URL from the Wayback Machine. Returns timestamps and snapshot URLs for a given date range. Use collapse parameter to deduplicate (e.g., 6 = one per month).',
  notes: '',
  input: z.object({
    url: z
      .string()
      .describe(
        'The URL to search for snapshots of. Example: "linearb.io/" or "https://example.com/pricing"',
      ),
    from: z
      .string()
      .optional()
      .describe(
        'Start date in YYYYMMDD format. Example: "20230101" for Jan 1, 2023',
      ),
    to: z
      .string()
      .optional()
      .describe(
        'End date in YYYYMMDD format. Example: "20260101" for Jan 1, 2026',
      ),
    matchType: z
      .enum(['exact', 'prefix', 'host', 'domain'])
      .optional()
      .describe(
        'URL match type. exact = exact URL, prefix = URL prefix, host = same host, domain = entire domain. Default: exact',
      ),
    collapse: z
      .number()
      .optional()
      .describe(
        'Collapse snapshots by timestamp digits. 4 = one per year, 6 = one per month, 8 = one per day. Default: no collapse',
      ),
    limit: z
      .number()
      .optional()
      .describe('Max number of snapshots to return. Default: 1000'),
  }),
  output: z.object({
    snapshots: z.array(
      z.object({
        timestamp: z
          .string()
          .describe('Snapshot timestamp in YYYYMMDDHHmmss format'),
        originalUrl: z.string().describe('The original URL that was archived'),
        snapshotUrl: z
          .string()
          .describe(
            'Full URL to view the archived page. Pass this to extraction functions.',
          ),
        statusCode: z.string().describe('HTTP status code of the capture'),
      }),
    ),
    total: z.number().describe('Total number of snapshots returned'),
  }),
};
export type GetSnapshotsInput = z.infer<typeof getSnapshotsSchema.input>;
export type GetSnapshotsOutput = z.infer<typeof getSnapshotsSchema.output>;

export const extractLogosSchema = {
  name: 'extractLogos',
  description:
    'Extract company logos from an archived webpage. Fetches the page HTML and finds all images with "logo" in alt text or class name. Returns company names and logo image URLs.',
  notes:
    'Pass a snapshotUrl from getSnapshots. Works best on homepages and customer/partner pages where logos are typically displayed.',
  input: z.object({
    snapshotUrl: z
      .string()
      .describe(
        'Full Wayback Machine snapshot URL. Example: "https://web.archive.org/web/20240301103239/https://linearb.io/"',
      ),
  }),
  output: z.object({
    logos: z.array(
      z.object({
        companyName: z
          .string()
          .describe(
            'Company name extracted from alt text (e.g., "Drata" from "Drata Logo")',
          ),
        altText: z.string().describe('Full alt text of the logo image'),
        imageUrl: z.string().describe('URL of the logo image'),
        width: z.number().describe('Image width in pixels'),
        height: z.number().describe('Image height in pixels'),
      }),
    ),
    pageTitle: z.string().describe('Title of the archived page'),
    snapshotUrl: z.string().describe('The snapshot URL that was fetched'),
  }),
};
export type ExtractLogosInput = z.infer<typeof extractLogosSchema.input>;
export type ExtractLogosOutput = z.infer<typeof extractLogosSchema.output>;

export const extractTestimonialsSchema = {
  name: 'extractTestimonials',
  description:
    'Extract customer testimonials from an archived webpage. Fetches the page HTML and finds quoted text with person names, titles, and company names. Returns structured testimonial data.',
  notes:
    'Pass a snapshotUrl from getSnapshots. Works best on homepages, customer stories, and testimonial pages. Looks for blockquotes, testimonial sections, and quoted text patterns.',
  input: z.object({
    snapshotUrl: z
      .string()
      .describe(
        'Full Wayback Machine snapshot URL. Example: "https://web.archive.org/web/20240301103239/https://linearb.io/"',
      ),
  }),
  output: z.object({
    testimonials: z.array(
      z.object({
        quote: z.string().describe('The testimonial quote text'),
        personName: z
          .string()
          .describe('Name of the person giving the testimonial'),
        title: z
          .string()
          .describe('Job title of the person (e.g., "VP of Eng.", "CTO")'),
        companyName: z.string().describe('Company the person works at'),
        companyUrl: z
          .string()
          .optional()
          .describe('Company website URL if found on the page'),
      }),
    ),
    pageTitle: z.string().describe('Title of the archived page'),
    snapshotUrl: z.string().describe('The snapshot URL that was fetched'),
  }),
};
export type ExtractTestimonialsInput = z.infer<
  typeof extractTestimonialsSchema.input
>;
export type ExtractTestimonialsOutput = z.infer<
  typeof extractTestimonialsSchema.output
>;

export const extractPageTextSchema = {
  name: 'extractPageText',
  description:
    'Extract all visible text content from an archived webpage. Useful for general-purpose scraping when you need the full page text rather than specific elements like logos or testimonials.',
  notes:
    'Pass a snapshotUrl from getSnapshots. Fetches the raw archived HTML (no Wayback toolbar).',
  input: z.object({
    snapshotUrl: z.string().describe('Full Wayback Machine snapshot URL'),
    selector: z
      .string()
      .optional()
      .describe(
        'Optional CSS selector to extract text from a specific section. Default: entire body.',
      ),
  }),
  output: z.object({
    text: z.string().describe('Extracted text content from the page'),
    pageTitle: z.string().describe('Title of the archived page'),
    snapshotUrl: z.string().describe('The snapshot URL that was fetched'),
    wordCount: z.number().describe('Approximate word count of extracted text'),
  }),
};
export type ExtractPageTextInput = z.infer<typeof extractPageTextSchema.input>;
export type ExtractPageTextOutput = z.infer<
  typeof extractPageTextSchema.output
>;

export const allSchemas = [
  getSnapshotsSchema,
  extractLogosSchema,
  extractTestimonialsSchema,
  extractPageTextSchema,
];
