import { z } from 'zod';

export const libraryDescription =
  'Y Combinator public directories — search the YC startup directory (5,000+ companies) and the YC founder directory (13,000+ people) by batch, industry, title, region, and free-text query';

export const libraryIcon = '/icons/libs/ycombinator.png';
export const libraryVisibility = 'chat' as const;
export const loginUrl = 'https://www.ycombinator.com/companies';

export const libraryNotes = `
## Workflow

The library exposes two surfaces — **companies** and **founders** — backed by two separate Algolia indexes (\`YCCompany_production\`, \`YCUsers_production\`) with their own secured API keys.

1. Navigate to \`https://www.ycombinator.com/companies\` or \`/founders\` first — each page exposes its own \`window.AlgoliaOpts\`. \`getContext()\` resolves both surfaces by fetching whichever pages it doesn't already have cached.
2. Call \`getFacets()\` (companies) or \`getFounderFacets()\` (founders) to discover valid filter values.
3. Call \`searchCompanies()\` / \`searchFounders()\` with free-text \`query\` and/or facet filters.
4. Call \`getCompany({ slug })\` / \`getFounder({ urlSlug })\` for a single directory-card record (fast, Algolia-backed).
5. Call \`getCompanyDetail({ slug })\` for the full public profile — founders with bios + social links, group partner, app/demo-day videos, news, launches. Slower; parses Inertia.js \`data-page\` JSON from \`/companies/{slug}\`.
6. Call \`listCompanyJobs({ slug })\` for active job postings (salary, equity, role, visa policy).
7. Use \`searchFacetValues()\` to autocomplete a single facet (useful for \`yc_titles\`, which has thousands of free-form values).

## Pagination

Algolia native pagination on both surfaces: \`page\` is **0-indexed**, \`hitsPerPage\` is the page size (max 1000). \`nbHits\` and \`nbPages\` are returned on every search response.

## Filters

Filter parameters are arrays of facet values. Within a single facet, values are OR-combined; across different facets, AND-combined.

Boolean facets (\`isHiring\`, \`topCompany\`, \`nonprofit\`) accept \`true\`/\`false\`/omit. Omitting the field returns both.

## Key Concepts

- **Batch format differs across surfaces**:
  - Companies: full-name strings — \`Summer 2014\`, \`Winter 2026\`, \`Spring 2025\`, \`Fall 2025\`.
  - Founders: short codes — \`S26\` (Summer 2026), \`W09\` (Winter 2009), \`P26\` (Spring 2026), \`F25\` (Fall 2025). Always 1 letter + 2 digits.
  - Pass the format that matches the surface you are querying.
- **Industry / Subindustry**: Two-level taxonomy. Subindustries are formatted as \`"Industry -> Subindustry"\` (literal arrow), e.g. \`B2B -> Engineering, Product and Design\`. Same values across both surfaces, but the facet field name differs (\`industries\`/\`subindustry\` on companies; \`yc_industries\`/\`yc_subindustries\` on founders).
- **Title** (founders only): \`yc_titles\` is a free-form facet. Top values: \`Founder\` (~10k), \`CEO\`, \`CTO\`, \`Co-Founder\`, \`COO\`. Many bespoke variants like \`Founder/President\` exist; use \`searchFacetValues\` to discover.
- **Status / Stage / Tags** (companies only): \`status\` (\`Active\`/\`Inactive\`/\`Acquired\`/\`Public\`), \`stage\` (\`Early\`/\`Growth\`), and \`tags\` live on hits but are NOT Algolia facets — they cannot be passed to \`searchCompanies\`. Filter the returned \`hits\` array client-side.
- **Numeric filters** (companies): \`minTeamSize\`/\`maxTeamSize\` map to \`team_size\`, and \`launchedAfter\`/\`launchedBefore\` (ISO date strings) map to the unix \`launched_at\` field. All inclusive.
- **Sort by launch date** (companies): pass \`sortBy: 'launchDate'\` to use the \`YCCompany_By_Launch_Date_production\` replica (most-recent first). Default ordering is Algolia relevance.
- **Region**:
  - Companies: \`regions\` is an array per hit, includes meta-regions (\`Remote\`, \`Europe\`).
  - Founders: \`current_region\` is a single string per hit and is NOT a facet — filter client-side.
- **Slugs**:
  - Company: \`slug\` (e.g. \`oklo\`) → \`/companies/{slug}\`.
  - Founder: \`url_slug\` (e.g. \`brian-chesky\`) → \`/people/{url_slug}\`.
  - \`hnid\` is the founder's Hacker News username when known.

## Detail Pages

- \`/companies/{slug}\` ships an Inertia.js SSR payload — JSON embedded in a \`<div data-page="...">\` attribute. \`getCompanyDetail\` and \`listCompanyJobs\` parse this. No XHR or JSON API; the route IS the data.
- Avatar/photo URLs in detail responses are AWS pre-signed and **expire within ~1 hour**. Treat them as transient.
- The job \`applyUrl\` requires an authenticated YC account; the listing itself is public.
- An equivalent \`/people/{url_slug}\` Inertia route likely exists for founder detail pages, but no HAR has confirmed its shape — not implemented.

## Coverage Caveats

- Both indexes are restricted to \`ycdc_public\` records by their secured keys. Stealth/unlaunched data is omitted.
- Founder detail prose lives on \`/people/{url_slug}\` (not yet wrapped); the Algolia founder hit only carries name, current title, batches, industries.
- Bookface/alumni-only fields are out of scope — they require login.
`;

const companyHitSchema = z
  .object({
    id: z.number().describe('Numeric YC company ID'),
    objectID: z
      .string()
      .describe('Algolia object ID (string form of `id`, used for lookups)'),
    slug: z
      .string()
      .describe(
        'URL slug, used in `https://www.ycombinator.com/companies/{slug}`',
      ),
    name: z.string().describe('Current company name'),
    former_names: z.array(z.string()).describe('Previous names, if any'),
    one_liner: z.string().describe('Short tagline'),
    long_description: z.string().describe('Full company description'),
    website: z.string().describe('Company homepage URL'),
    small_logo_thumb_url: z
      .string()
      .describe('Square logo thumbnail (S3-hosted)'),
    all_locations: z
      .string()
      .describe(
        'Semicolon-separated office locations, e.g. "Santa Clara, CA, USA; Sunnyvale, CA, USA"',
      ),
    team_size: z.number().nullable().describe('Reported headcount'),
    launched_at: z
      .number()
      .nullable()
      .describe('Unix timestamp (seconds) when the company launched on YC'),
    batch: z.string().describe('YC batch, e.g. "Summer 2014"'),
    status: z
      .string()
      .describe('Company status: Active, Inactive, Acquired, Public'),
    stage: z.string().describe('Investment stage: Early or Growth'),
    industry: z.string().describe('Top-level industry'),
    subindustry: z
      .string()
      .describe('Composite "Industry -> Subindustry" string'),
    industries: z
      .array(z.string())
      .describe('Industry tags including parent + subindustry'),
    regions: z.array(z.string()).describe('Geo and remote-mode tags'),
    tags: z.array(z.string()).describe('Free-form topic tags (e.g. "Climate")'),
    top_company: z.boolean().describe('YC "Top Company" badge'),
    isHiring: z.boolean().describe('Currently posted jobs at workatastartup'),
    nonprofit: z.boolean(),
    app_video_public: z.boolean(),
    demo_day_video_public: z.boolean(),
    app_answers: z.boolean().nullable(),
    question_answers: z.boolean().nullable(),
  })
  .describe('A company record from the YCCompany_production Algolia index');

export type CompanyHit = z.infer<typeof companyHitSchema>;

const facetCountsSchema = z
  .record(z.string(), z.number())
  .describe('Facet value -> hit count');

const surfaceContextSchema = z.object({
  algoliaAppId: z.string(),
  algoliaApiKey: z
    .string()
    .describe(
      'Browser-safe secured key. Embeds tagFilters=["ycdc_public"] and an index allowlist baked in by YC.',
    ),
  indexName: z.string(),
});

export const getContextSchema = {
  name: 'getContext',
  description:
    'Resolve and cache Algolia credentials for both the companies and founders surfaces. Other functions auto-call this if not yet primed.',
  notes:
    'Each surface has its own secured key. Reads `window.AlgoliaOpts` first (only valid for the page currently open); otherwise fetches the corresponding `/companies` or `/founders` HTML and parses the inline `window.AlgoliaOpts = {...}` script.',
  input: z.object({}),
  output: z.object({
    companies: surfaceContextSchema,
    founders: surfaceContextSchema,
  }),
};

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type SurfaceContext = z.infer<typeof surfaceContextSchema>;

export const searchCompaniesSchema = {
  name: 'searchCompanies',
  description:
    'Search the YC startup directory by free-text query and/or facet filters. Returns paginated company records.',
  notes: '',
  input: z.object({
    query: z
      .string()
      .optional()
      .describe('Free-text query against name, description, tags, etc.'),
    batches: z
      .array(z.string())
      .optional()
      .describe('YC batches to include, e.g. ["Summer 2014","Winter 2016"]'),
    industries: z
      .array(z.string())
      .optional()
      .describe('Top-level industries, e.g. ["Fintech","Healthcare"]'),
    subindustries: z
      .array(z.string())
      .optional()
      .describe(
        'Composite subindustry strings, e.g. ["B2B -> Engineering, Product and Design"]',
      ),
    regions: z
      .array(z.string())
      .optional()
      .describe(
        'Region tags. Mix of countries ("India") and meta ("Remote", "Europe")',
      ),
    isHiring: z
      .boolean()
      .optional()
      .describe('Filter to only currently-hiring companies'),
    topCompany: z
      .boolean()
      .optional()
      .describe('Filter to YC "Top Company" badge holders'),
    nonprofit: z.boolean().optional(),
    hasAppAnswers: z
      .boolean()
      .optional()
      .describe('Whether the company has public application answers'),
    hasAppVideo: z
      .boolean()
      .optional()
      .describe('Whether the company has a public application video'),
    hasDemoDayVideo: z
      .boolean()
      .optional()
      .describe('Whether the company has a public Demo Day video'),
    hasQuestionAnswers: z
      .boolean()
      .optional()
      .describe(
        'Whether the company has public free-response question answers',
      ),
    minTeamSize: z
      .number()
      .optional()
      .describe('Minimum reported team size (inclusive)'),
    maxTeamSize: z
      .number()
      .optional()
      .describe('Maximum reported team size (inclusive)'),
    launchedAfter: z
      .string()
      .optional()
      .describe(
        'ISO date string (e.g. "2023-01-01"); only return companies launched on or after this date',
      ),
    launchedBefore: z
      .string()
      .optional()
      .describe(
        'ISO date string (e.g. "2025-12-31"); only return companies launched on or before this date',
      ),
    sortBy: z
      .enum(['relevance', 'launchDate'])
      .optional()
      .default('relevance')
      .describe(
        'Result ordering. `launchDate` swaps to the YCCompany_By_Launch_Date_production replica (most-recent-first). Default sorts by Algolia relevance.',
      ),
    page: z
      .number()
      .optional()
      .default(0)
      .describe('Page number, 0-indexed (Algolia native)'),
    hitsPerPage: z
      .number()
      .optional()
      .default(50)
      .describe('Results per page (max 1000)'),
  }),
  output: z.object({
    nbHits: z.number().describe('Total matching companies'),
    page: z.number().describe('Current page (0-indexed)'),
    nbPages: z.number().describe('Total pages'),
    hitsPerPage: z.number(),
    hits: z.array(companyHitSchema),
  }),
};

export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema.input>;
export type SearchCompaniesOutput = z.infer<
  typeof searchCompaniesSchema.output
>;

export const getCompanySchema = {
  name: 'getCompany',
  description:
    'Get a single company record from the YC directory by slug. Returns the same fields as searchCompanies hits.',
  notes:
    'Backed by a slug-filter Algolia query, not a per-company API. Founder names and job postings are NOT in the directory index — fetch from workatastartup if needed.',
  input: z.object({
    slug: z
      .string()
      .describe('Company slug, e.g. "oklo" (matches /companies/{slug} URL)'),
  }),
  output: companyHitSchema.nullable().describe('null if no company matches'),
};

export type GetCompanyInput = z.infer<typeof getCompanySchema.input>;
export type GetCompanyOutput = z.infer<typeof getCompanySchema.output>;

export const getFacetsSchema = {
  name: 'getFacets',
  description:
    'Get all facet values and their hit counts in one call. Use this to discover valid filter values for searchCompanies.',
  notes: '',
  input: z.object({}),
  output: z.object({
    nbHits: z.number().describe('Total companies in the public directory'),
    batch: facetCountsSchema,
    industries: facetCountsSchema,
    subindustry: facetCountsSchema,
    regions: facetCountsSchema,
    isHiring: facetCountsSchema,
    nonprofit: facetCountsSchema,
    top_company: facetCountsSchema,
    app_video_public: facetCountsSchema,
    demo_day_video_public: facetCountsSchema,
    app_answers: facetCountsSchema,
    question_answers: facetCountsSchema,
  }),
};

export type GetFacetsInput = z.infer<typeof getFacetsSchema.input>;
export type GetFacetsOutput = z.infer<typeof getFacetsSchema.output>;

// === Company Detail Page ===

const founderRefSchema = z.object({
  user_id: z.number(),
  full_name: z.string(),
  title: z.string().nullable(),
  founder_bio: z.string().nullable(),
  avatar_thumb_url: z
    .string()
    .describe('AWS pre-signed URL; expires within ~1 hour'),
  twitter_url: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  has_email: z.boolean(),
  is_active: z.boolean(),
  latest_yc_company: z
    .object({ name: z.string(), href: z.string() })
    .nullable(),
});

const groupPartnerSchema = z.object({
  id: z.number(),
  full_name: z.string(),
  avatar_thumb_url: z.string(),
  url: z.string().describe('e.g. https://www.ycombinator.com/people/garry-tan'),
});

const companyDetailRecordSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  batch: z.string().describe('Short code, e.g. "W09"'),
  batch_name: z.string().describe('Full name, e.g. "Winter 2009"'),
  small_logo_url: z.string(),
  logo_url: z.string(),
  one_liner: z.string(),
  long_description: z.string(),
  website: z.string(),
  year_founded: z.number().nullable(),
  team_size: z.number().nullable(),
  location: z.string().nullable().describe('Free-text city or region'),
  city: z.string().nullable(),
  city_tag: z.string().nullable(),
  country: z.string().nullable().describe('ISO-2 country code, e.g. "US"'),
  ycdc_status: z
    .string()
    .describe(
      'Active, Inactive, Acquired, Public — same domain as Algolia `status`',
    ),
  tags: z.array(z.string()).describe('Free-form topic tags'),
  linkedin_url: z.string().nullable(),
  twitter_url: z.string().nullable(),
  fb_url: z.string().nullable(),
  cb_url: z.string().nullable().describe('Crunchbase profile URL'),
  github_url: z.string().nullable(),
  dday_video_url: z.string().nullable().describe('Demo Day video, when public'),
  app_video_url: z
    .string()
    .nullable()
    .describe('Application video, when public'),
  app_answers: z
    .array(z.record(z.string(), z.any()))
    .nullable()
    .describe('Public application answers (varies by batch)'),
  free_response_question_answers: z
    .array(z.record(z.string(), z.any()))
    .nullable(),
  company_photos: z.array(z.record(z.string(), z.any())),
  ycdc_url: z.string().nullable(),
});

const companyNewsItemSchema = z.object({
  title: z.string(),
  url: z.string(),
  date: z.string().describe('Display string, e.g. "Dec 01, 2025"'),
});

const companyLaunchSchema = z
  .record(z.string(), z.any())
  .describe(
    'Launch post object. Common properties: id, title, slug, tagline, body, posted_at, url, vote_count',
  );

export const getCompanyDetailSchema = {
  name: 'getCompanyDetail',
  description:
    'Fetch the full public profile page for a YC company by slug — richer than getCompany. Returns founders (with bios + social links), group partner, social URLs, application answers, news, and launches.',
  notes:
    'Backed by `/companies/{slug}` HTML and the Inertia.js `data-page` JSON inside it; not Algolia. Use getCompany for fast directory-card lookups; use this for full profile detail.',
  input: z.object({
    slug: z.string().describe('Company slug, e.g. "airbnb"'),
  }),
  output: z.object({
    company: companyDetailRecordSchema,
    founders: z.array(founderRefSchema),
    groupPartner: groupPartnerSchema.nullable(),
    newsItems: z.array(companyNewsItemSchema),
    launches: z.array(companyLaunchSchema),
  }),
};

export type GetCompanyDetailInput = z.infer<
  typeof getCompanyDetailSchema.input
>;
export type GetCompanyDetailOutput = z.infer<
  typeof getCompanyDetailSchema.output
>;

const jobPostingSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z
    .string()
    .describe('Path on ycombinator.com, e.g. /companies/atob/jobs/OG5OoOo-...'),
  applyUrl: z
    .string()
    .describe(
      'Authenticated workatastartup application URL (requires YC account login)',
    ),
  type: z.string().describe('Full-time, Intern, Contract, etc.'),
  role: z.string().describe('Role slug, e.g. "product", "eng"'),
  prettyRole: z.string().describe('Display role, e.g. "Product"'),
  roleSpecificType: z.string().nullable(),
  location: z.string().nullable(),
  salaryRange: z
    .string()
    .describe('Display string, e.g. "$180K - $200K", or empty'),
  equityRange: z.string(),
  minExperience: z.string().describe('e.g. "6+ years"'),
  minSchoolYear: z.string().nullable(),
  visa: z.string().nullable().describe('e.g. "US citizen/visa only"'),
  skills: z.array(z.string()),
  askUs: z.boolean().describe('Whether the listing accepts "ask us" inquiries'),
  isIncomplete: z.boolean(),
  createdAt: z.string().describe('Relative date, e.g. "14 days"'),
  lastActive: z.string().describe('Relative date, e.g. "14 days"'),
  hiringManager: z.record(z.string(), z.any()).nullable(),
  companyName: z.string(),
  companyOneLiner: z.string(),
  companyBatchName: z.string().describe('Short code, e.g. "S20"'),
  companyLogoUrl: z.string(),
  companyUrl: z.string(),
});

export const listCompanyJobsSchema = {
  name: 'listCompanyJobs',
  description:
    'List active job postings for a YC company by slug. Includes salary/equity ranges, role, location, experience requirements, and visa policy.',
  notes:
    'Sourced from the same /companies/{slug} Inertia page as getCompanyDetail. The `applyUrl` requires a YC account login; unauthenticated users can only read the listing.',
  input: z.object({
    slug: z.string().describe('Company slug, e.g. "atob"'),
  }),
  output: z.object({
    jobs: z.array(jobPostingSchema),
  }),
};

export type ListCompanyJobsInput = z.infer<typeof listCompanyJobsSchema.input>;
export type ListCompanyJobsOutput = z.infer<
  typeof listCompanyJobsSchema.output
>;

// === Founders ===

const founderHitSchema = z
  .object({
    id: z.number().describe('Numeric YC user ID'),
    objectID: z.string().describe('Algolia object ID (string form of `id`)'),
    url_slug: z
      .string()
      .describe('URL slug used in `/people/{url_slug}`, e.g. "brian-chesky"'),
    first_name: z.string(),
    last_name: z.string(),
    hnid: z
      .string()
      .nullable()
      .describe('Hacker News username when known (else null/empty)'),
    avatar_thumb: z.string().describe('Avatar URL (S3-hosted)'),
    current_company: z.string().nullable(),
    current_title: z.string().nullable(),
    company_slug: z
      .string()
      .nullable()
      .describe(
        'Slug of `current_company` for cross-linking with the company directory',
      ),
    all_companies_text: z
      .string()
      .describe(
        'Free-text concatenation of all YC companies the user has been part of',
      ),
    yc_titles: z
      .array(z.string())
      .describe(
        'Titles held across YC companies (free-form, e.g. "Founder", "CEO", "Founder/President")',
      ),
    batches: z
      .array(z.string())
      .describe(
        'YC batch codes the user is associated with, e.g. ["W09"]. NOTE: short-code format (S/W/P/F + 2-digit year), distinct from company-surface "Summer 2014" format.',
      ),
    yc_industries: z
      .array(z.array(z.string()))
      .describe('Nested [parent, sub] tuples for each YC company'),
    yc_parent_industries: z.array(z.string()),
    yc_subindustries: z
      .array(z.string())
      .describe('Composite "Parent -> Sub" strings'),
    current_region: z
      .string()
      .nullable()
      .describe('Single region string; not a facet, filter client-side'),
    top_company: z.boolean().describe('Founder of a YC "Top Company"'),
  })
  .describe(
    'A founder/operator record from the YCUsers_production Algolia index',
  );

export type FounderHit = z.infer<typeof founderHitSchema>;

export const searchFoundersSchema = {
  name: 'searchFounders',
  description:
    'Search the YC founder/people directory by free-text query and/or facet filters. Returns paginated founder records.',
  notes: '',
  input: z.object({
    query: z
      .string()
      .optional()
      .describe('Free-text query against name, hnid, and `all_companies_text`'),
    batches: z
      .array(z.string())
      .optional()
      .describe(
        'YC batch SHORT CODES, e.g. ["W09","S26","P26","F25"]. NOT "Summer 2014"-style strings — those only work on searchCompanies.',
      ),
    industries: z
      .array(z.string())
      .optional()
      .describe(
        'Top-level industries, e.g. ["Fintech","Consumer"]. Maps to the `yc_industries` facet.',
      ),
    subindustries: z
      .array(z.string())
      .optional()
      .describe(
        'Composite subindustry strings, e.g. ["Consumer -> Travel, Leisure and Tourism"]. Maps to `yc_subindustries`.',
      ),
    titles: z
      .array(z.string())
      .optional()
      .describe(
        'Title facet values, e.g. ["Founder","CEO","CTO"]. Free-form — use searchFacetValues to discover variants.',
      ),
    topCompany: z
      .boolean()
      .optional()
      .describe('Filter to founders of YC "Top Company" badge holders'),
    page: z.number().optional().default(0).describe('Page number, 0-indexed'),
    hitsPerPage: z
      .number()
      .optional()
      .default(50)
      .describe('Results per page (max 1000)'),
  }),
  output: z.object({
    nbHits: z.number().describe('Total matching founders'),
    page: z.number(),
    nbPages: z.number(),
    hitsPerPage: z.number(),
    hits: z.array(founderHitSchema),
  }),
};

export type SearchFoundersInput = z.infer<typeof searchFoundersSchema.input>;
export type SearchFoundersOutput = z.infer<typeof searchFoundersSchema.output>;

export const getFounderSchema = {
  name: 'getFounder',
  description:
    'Get a single founder/user record by url_slug. Returns the same fields as searchFounders hits.',
  notes: '',
  input: z.object({
    urlSlug: z
      .string()
      .describe(
        'Founder url_slug, e.g. "brian-chesky" (matches /people/{url_slug} URL)',
      ),
  }),
  output: founderHitSchema.nullable().describe('null if no founder matches'),
};

export type GetFounderInput = z.infer<typeof getFounderSchema.input>;
export type GetFounderOutput = z.infer<typeof getFounderSchema.output>;

export const getFounderFacetsSchema = {
  name: 'getFounderFacets',
  description:
    'Get all facet values and hit counts for the founder index in one call. Use this to discover valid filter values for searchFounders.',
  notes: '',
  input: z.object({}),
  output: z.object({
    nbHits: z.number().describe('Total founders in the public directory'),
    batches: facetCountsSchema.describe(
      'Batch short-code -> count, e.g. {"W09": 234, "S13": 198}',
    ),
    yc_industries: facetCountsSchema,
    yc_subindustries: facetCountsSchema,
    yc_titles: facetCountsSchema.describe(
      'Truncated to top 1000 by count. For broader title search use searchFacetValues.',
    ),
    top_company: facetCountsSchema,
  }),
};

export type GetFounderFacetsInput = z.infer<
  typeof getFounderFacetsSchema.input
>;
export type GetFounderFacetsOutput = z.infer<
  typeof getFounderFacetsSchema.output
>;

export const searchFacetValuesSchema = {
  name: 'searchFacetValues',
  description:
    'Autocomplete-style search within a single facet on the founder index. Useful when a facet (especially `yc_titles`) has more values than `getFounderFacets` returns.',
  notes:
    "Backed by Algolia's facet-search endpoint. Returns up to `limit` values matching `query`, sorted by hit count.",
  input: z.object({
    facet: z
      .enum(['yc_titles', 'yc_industries', 'yc_subindustries', 'batches'])
      .describe('Facet field to search within'),
    query: z
      .string()
      .optional()
      .default('')
      .describe(
        'Substring to match against facet values; empty returns top by count',
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Max facet values to return (Algolia default 5; max ~100)'),
  }),
  output: z.object({
    facet: z.string(),
    values: z.array(
      z.object({
        value: z.string(),
        count: z.number().describe('Number of founders with this facet value'),
      }),
    ),
  }),
};

export type SearchFacetValuesInput = z.infer<
  typeof searchFacetValuesSchema.input
>;
export type SearchFacetValuesOutput = z.infer<
  typeof searchFacetValuesSchema.output
>;

export const allSchemas = [
  getContextSchema,
  searchCompaniesSchema,
  getCompanySchema,
  getCompanyDetailSchema,
  listCompanyJobsSchema,
  getFacetsSchema,
  searchFoundersSchema,
  getFounderSchema,
  getFounderFacetsSchema,
  searchFacetValuesSchema,
];
