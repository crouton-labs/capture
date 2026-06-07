import { z } from 'zod';

const ProjectIdParam = z.string().describe('Project UUID from getContext()');

const LimitParam = z
  .number()
  .int()
  .nonnegative()
  .optional()
  .describe(
    'Maximum number of developers to return. Default 100. Pass 0 to return every result the stream delivers (can be 1000+).',
  );

const SortParam = z
  .enum(['relevant', 'active', 'stars', 'cracked'])
  .optional()
  .describe(
    'How to rank the returned developers. Applied client-side over the full stream Vamo delivered: ' +
      '"relevant" (default — Vamo\'s match score), ' +
      '"active" (most recent activity / recently embedded), ' +
      '"stars" (sum of stargazers across owned + matched repos), ' +
      '"cracked" (Vamo\'s crackedScore from ownerDevrank). ' +
      'The Vamo server ignores sort — sort is applied locally after the stream.',
  );

const LocationParam = z
  .string()
  .optional()
  .describe(
    'Geographic filter, e.g. "San Francisco", "United States", "Berlin". ' +
      'Server only accepts a SINGLE location string per request — to OR multiple locations, run separate searches and merge.',
  );

const ProfessionalParam = z
  .object({
    experienceTier: z
      .enum(['junior', 'senior'])
      .nullable()
      .optional()
      .describe(
        'Experience-level bucket. Only "junior" and "senior" are honored by the server (other values silently no-op). Despite the name, the filter blends LinkedIn seniority with GitHub signals (account age, follower count, contribution volume), so it can affect developers with no LinkedIn profile too.',
      ),
    companies: z
      .array(z.string())
      .nullable()
      .optional()
      .describe(
        'Filter to developers with these companies on their LinkedIn. Match is OR across the array. Use the LinkedIn-canonical company name (e.g. "Meta", "Google", "Stripe").',
      ),
    companyIntent: z
      .enum(['any', 'current', 'past'])
      .nullable()
      .optional()
      .describe(
        '"any" (default) accepts current OR past employment, "current" only present role, "past" only prior employers. Only meaningful when `companies` is non-empty.',
      ),
    schools: z
      .array(z.string())
      .nullable()
      .optional()
      .describe(
        'Filter to developers with these schools on their LinkedIn. Match is OR. Use the LinkedIn-canonical name (e.g. "Stanford University").',
      ),
    titles: z
      .array(z.string())
      .nullable()
      .optional()
      .describe(
        'Filter to developers whose LinkedIn job title contains any of these strings (e.g. ["Software Engineer", "ML Engineer"]).',
      ),
  })
  .partial()
  .optional()
  .describe(
    'LinkedIn-derived professional filters. WARNING: 50-80% of top GitHub developers do not link a LinkedIn profile, so any non-empty `professional` block (other than experienceTier alone) can drastically reduce results.',
  );

const SocialAccount = z
  .object({
    provider: z
      .string()
      .describe(
        'Provider id, uppercased: TWITTER, MASTODON, LINKEDIN, YOUTUBE, FACEBOOK, etc.',
      ),
    url: z.string(),
    displayName: z.string().nullable(),
  })
  .passthrough();

const OwnerDevrank = z
  .object({
    crackedScore: z
      .number()
      .describe('0-100 ranking metric Vamo uses to rank GitHub developers'),
    tier: z
      .string()
      .describe('Coarse tier: Beginner | Intermediate | Advanced | Expert'),
    rawScore: z.number(),
    trust: z.number(),
    pc: z.number(),
    followersIn: z.number(),
    followingOut: z.number(),
    community: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .partial()
  .passthrough();

const MatchScoreCriterion = z
  .object({
    name: z.string(),
    matched: z.boolean(),
    value: z.number(),
    detail: z.string().optional(),
    pending: z.boolean().optional(),
  })
  .passthrough();

const MatchScore = z
  .object({
    total: z.number().describe('0-100 match score for this query'),
    label: z.string().describe('Strong | Good | Weak'),
    criteria: z.array(MatchScoreCriterion),
    totalFocusAreas: z.number().optional(),
  })
  .passthrough();

const MatchedRepository = z
  .object({
    githubId: z.string(),
    ownerLogin: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    language: z.string().nullable(),
    stargazerCount: z.number(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    score: z.number().optional(),
  })
  .passthrough();

const OwnedRepoEdge = z
  .object({
    id: z.string(),
    githubId: z.string(),
    ownerLogin: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    stargazerCount: z.number(),
    language: z.string().nullable(),
    totalIssuesCount: z.number().optional(),
    totalIssuesOpen: z.number().optional(),
    totalIssuesClosed: z.number().optional(),
    readmePreview: z.string().nullable().optional(),
    lastContributorLocations: z.array(z.string()).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    embeddedAt: z.string().optional(),
  })
  .passthrough();

const Developer = z
  .object({
    id: z.string().describe('Internal Vamo UUID'),
    githubId: z
      .string()
      .describe(
        'GitHub GraphQL node ID (e.g. U_kgDOAEAhsA). Use this for synopsis/reveal/analyze calls.',
      ),
    login: z.string().describe('GitHub username/login'),
    displayName: z.string().nullable(),
    bio: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable().describe('Raw location string from GitHub'),
    websiteUrl: z.string().nullable(),
    socialAccounts: z.array(SocialAccount).nullable(),
    emails: z
      .array(z.string())
      .nullable()
      .describe(
        "All commit email addresses Vamo has scraped from this user. Sorted by frequency on the user's repos.",
      ),
    resolvedCountry: z.string().nullable(),
    resolvedState: z.string().nullable(),
    resolvedCity: z.string().nullable(),
    createdAt: z.string().describe('GitHub account creation date (ISO)'),
    updatedAt: z.string(),
    embeddedAt: z.string().optional(),
    ownerDevrank: OwnerDevrank.nullable().optional(),
    linkedInSummary: z.string().nullable(),
    linkedinSeniority: z.string().nullable(),
    isBookmarked: z.boolean(),
    matchedRepositoryIds: z.array(z.string()).optional(),
    matchedRepositories: z.array(MatchedRepository).optional(),
    hasProfessionalLinkedIn: z.boolean().optional(),
    hasLinkedIn: z.boolean().optional(),
    developerLevel: z.string().nullable().optional(),
    matchScore: MatchScore.optional(),
    badge: z
      .string()
      .optional()
      .describe(
        'Set to "seed" for the seed developer in searchByUsername / searchByRepo (i.e. the user/repo the query is about). Absent for similar developers.',
      ),
    owns: z
      .object({
        edges: z.array(OwnedRepoEdge),
      })
      .optional()
      .describe(
        'Owned repositories. Populated for searchByUsername seed and similar-mode results, omitted for skills-mode results.',
      ),
  })
  .passthrough();

const Extraction = z
  .object({
    isLanguageOnly: z.boolean().optional(),
    cleanedSearchQuery: z
      .string()
      .describe(
        'LLM-rewritten skills query, e.g. "react jsx hooks components spa frontend"',
      ),
    extractedLocation: z.array(z.string()),
    professional: z.unknown().nullable(),
    focusAreas: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          readmeKeywords: z.array(z.string()),
          suggestedQuery: z.string(),
        })
        .passthrough(),
    ),
    languages: z.array(z.string()),
  })
  .passthrough();

const SearchOutput = z
  .object({
    developers: z.array(Developer),
    totalCount: z.number().describe('Total developers delivered by the stream'),
    hasMore: z
      .boolean()
      .describe(
        'True if Vamo had to truncate; the API does not expose a paging token, so re-running with a more specific query is the only way to drill in.',
      ),
    cached: z.boolean().describe('Server-side cache hit on this query'),
    extraction: Extraction.optional().describe(
      "Present for searchBySkills only — Vamo's LLM-extracted focus areas, languages, and rewritten query.",
    ),
    seed: Developer.optional().describe(
      'Present for searchByUsername / searchByRepo — the developer the query is about, separated out from the similar-developer list.',
    ),
  })
  .passthrough();

// ============================================================================

export const searchBySkillsSchema = {
  name: 'searchBySkills',
  description:
    'Find developers by a natural-language skills/job-description query. Vamo extracts focus areas + languages, then matches against repo embeddings. Use for "I want React engineers in SF" or pasting a full job description.',
  notes: '',
  input: z.object({
    projectId: ProjectIdParam,
    query: z
      .string()
      .min(1)
      .describe(
        'Skills description or job description. Free-form. Long descriptions work — Vamo runs an LLM extraction step.',
      ),
    languages: z
      .array(z.string())
      .optional()
      .describe(
        'Optional GitHub language filter, e.g. ["TypeScript","Python"]. Capitalization matters — use the canonical GitHub language name.',
      ),
    location: LocationParam,
    professional: ProfessionalParam,
    sort: SortParam,
    limit: LimitParam,
  }),
  output: SearchOutput,
};
export type SearchBySkillsInput = z.infer<typeof searchBySkillsSchema.input>;
export type SearchBySkillsOutput = z.infer<typeof searchBySkillsSchema.output>;

export const searchByUsernameSchema = {
  name: 'searchByUsername',
  description:
    'Look up a GitHub user by login and return developers similar to them. Result ordering: the seed user first (badge: "seed"), then similar developers ranked by Vamo. Useful both for fetching a specific developer\'s profile and for "find more people like X".',
  notes:
    'The seed developer is also returned in `seed` for convenience. If you only want the seed (not similar developers), use `getDeveloperProfile` from the profile module.',
  input: z.object({
    projectId: ProjectIdParam,
    username: z
      .string()
      .min(1)
      .describe('GitHub username/login (no @ prefix). Case-insensitive.'),
    location: LocationParam,
    professional: ProfessionalParam,
    sort: SortParam,
    limit: LimitParam,
  }),
  output: SearchOutput,
};
export type SearchByUsernameInput = z.infer<
  typeof searchByUsernameSchema.input
>;
export type SearchByUsernameOutput = z.infer<
  typeof searchByUsernameSchema.output
>;

export const searchByRepoSchema = {
  name: 'searchByRepo',
  description:
    'Find developers based on a GitHub repository URL. Returns top contributors / similar developers ranked by relevance to that repo.',
  notes: '',
  input: z.object({
    projectId: ProjectIdParam,
    repoUrl: z
      .string()
      .describe(
        'Full GitHub repo URL, e.g. https://github.com/facebook/react. Both https://github.com/owner/repo and owner/repo accepted.',
      ),
    location: LocationParam,
    professional: ProfessionalParam,
    sort: SortParam,
    limit: LimitParam,
  }),
  output: SearchOutput,
};
export type SearchByRepoInput = z.infer<typeof searchByRepoSchema.input>;
export type SearchByRepoOutput = z.infer<typeof searchByRepoSchema.output>;

export const searchSchemas = [
  searchBySkillsSchema,
  searchByUsernameSchema,
  searchByRepoSchema,
];
