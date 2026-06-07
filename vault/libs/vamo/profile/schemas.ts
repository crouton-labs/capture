import { z } from 'zod';

const ProjectIdParam = z.string().describe('Project UUID from getContext()');
const GithubIdParam = z
  .string()
  .describe(
    "GitHub GraphQL node ID for the user, e.g. U_kgDOAEAhsA. Get one from any developer object's `githubId` field, or call searchByUsername first.",
  );

const ProfessionalExperience = z
  .object({
    title: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .partial()
  .passthrough();

const ProfessionalEducation = z
  .object({
    school: z.string().nullable().optional(),
    degree: z.string().nullable().optional(),
    fieldOfStudy: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
  })
  .partial()
  .passthrough();

const Professional = z
  .object({
    synopsis: z.string().nullable(),
    experiences: z.array(ProfessionalExperience),
    education: z.array(ProfessionalEducation),
    currentRole: z.string().nullable(),
    headline: z.string().nullable(),
    occupation: z.string().nullable(),
    linkedInUrl: z.string().nullable(),
  })
  .partial()
  .passthrough();

// ---------------------------------------------------------------------------

export const getDeveloperProfileSchema = {
  name: 'getDeveloperProfile',
  description:
    "Fetch a single GitHub developer's profile by login. Convenience over searchByUsername — returns just the seed user, not similar developers. Includes emails, social accounts, location, owned repos, devrank.",
  notes: '',
  input: z.object({
    projectId: ProjectIdParam,
    username: z.string().describe('GitHub login (no @ prefix)'),
  }),
  output: z
    .object({
      developer: z
        .record(z.string(), z.unknown())
        .describe(
          'Same shape as a developer entry from search results — login, displayName, bio, emails, socialAccounts, websiteUrl, location, ownerDevrank, owns.edges, etc.',
        ),
    })
    .passthrough(),
};
export type GetDeveloperProfileInput = z.infer<
  typeof getDeveloperProfileSchema.input
>;
export type GetDeveloperProfileOutput = z.infer<
  typeof getDeveloperProfileSchema.output
>;

export const getDeveloperSynopsisSchema = {
  name: 'getDeveloperSynopsis',
  description:
    'Get an LLM-generated bullet-point synopsis of a developer plus any LinkedIn data Vamo holds (experiences, education, headline, currentRole, linkedInUrl).',
  notes:
    'Free of charge — does NOT consume reveal credits. Use for "summarize this developer" or to check if Vamo has LinkedIn data without spending credits.',
  input: z.object({
    projectId: ProjectIdParam,
    githubId: GithubIdParam,
  }),
  output: z
    .object({
      synopsis: z
        .string()
        .nullable()
        .describe('Multi-bullet plain-text summary of the developer'),
      professional: Professional.nullable(),
    })
    .passthrough(),
};
export type GetDeveloperSynopsisInput = z.infer<
  typeof getDeveloperSynopsisSchema.input
>;
export type GetDeveloperSynopsisOutput = z.infer<
  typeof getDeveloperSynopsisSchema.output
>;

export const getDeveloperInterestsSchema = {
  name: 'getDeveloperInterests',
  description:
    'Get an LLM-categorized analysis of what kinds of projects this developer is interested in. Returns a free-form summary plus categorized interest tags with confidence levels.',
  notes: '',
  input: z.object({
    projectId: ProjectIdParam,
    githubId: GithubIdParam,
  }),
  output: z
    .object({
      userInterests: z
        .object({
          summary: z.string().describe('1-2 sentence narrative summary'),
          interests: z.array(
            z
              .object({
                category: z.string(),
                interests: z.array(z.string()),
                confidence: z.string().describe('high | medium | low'),
              })
              .passthrough(),
          ),
        })
        .partial()
        .passthrough(),
    })
    .passthrough(),
};
export type GetDeveloperInterestsInput = z.infer<
  typeof getDeveloperInterestsSchema.input
>;
export type GetDeveloperInterestsOutput = z.infer<
  typeof getDeveloperInterestsSchema.output
>;

export const revealDeveloperContactsSchema = {
  name: 'revealDeveloperContacts',
  description:
    'Spend reveal credits to surface additional contact data Vamo holds back from the public search response (deeper LinkedIn, additional emails, etc.). Idempotent on the same developer.',
  notes:
    'Consumes user credits ("pineapples") on first call. Subsequent calls return alreadyRevealed: true and do not re-charge. Most contact info is already inline in search results — call this only when needed.',
  input: z.object({
    projectId: ProjectIdParam,
    githubId: GithubIdParam,
  }),
  output: z
    .object({
      revealedData: z
        .object({
          login: z.string(),
          displayName: z.string().nullable(),
          socialAccounts: z
            .array(
              z
                .object({
                  provider: z.string(),
                  url: z.string(),
                  displayName: z.string().nullable(),
                })
                .passthrough(),
            )
            .nullable(),
          websiteUrl: z.string().nullable(),
          ownerDevrank: z
            .object({
              crackedScore: z.number(),
              tier: z.string(),
            })
            .partial()
            .passthrough()
            .nullable(),
          emails: z.array(z.string()).nullable(),
          professional: Professional.nullable(),
        })
        .partial()
        .passthrough(),
      creditsBalance: z
        .number()
        .describe('Remaining reveal credits after this call'),
      alreadyRevealed: z
        .boolean()
        .describe('True if this developer was already revealed previously'),
    })
    .passthrough(),
};
export type RevealDeveloperContactsInput = z.infer<
  typeof revealDeveloperContactsSchema.input
>;
export type RevealDeveloperContactsOutput = z.infer<
  typeof revealDeveloperContactsSchema.output
>;

export const getDeveloperTopRepoSchema = {
  name: 'getDeveloperTopRepo',
  description:
    'Fetch a developer\'s top repository by Vamo ranking. Used to surface a "best work" repo for a card. You can pass repos to skip via excludeNames.',
  notes: '',
  input: z.object({
    githubId: GithubIdParam,
    excludeNames: z
      .array(z.string())
      .optional()
      .describe(
        'Repo names to exclude (matched against `name`). Useful when you already showed the matched repos and want a different one.',
      ),
  }),
  output: z
    .object({
      repo: z
        .object({
          githubId: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          language: z.string().nullable(),
          stargazerCount: z.number(),
        })
        .partial()
        .passthrough()
        .nullable(),
    })
    .passthrough(),
};
export type GetDeveloperTopRepoInput = z.infer<
  typeof getDeveloperTopRepoSchema.input
>;
export type GetDeveloperTopRepoOutput = z.infer<
  typeof getDeveloperTopRepoSchema.output
>;

export const getMatchReasonSchema = {
  name: 'getMatchReason',
  description:
    'Generate an LLM explanation for why a developer matches a given query, given their matched repositories. Used by the search UI to write the "why" line on each card.',
  notes:
    'Pass the same matchedRepositories array you got back in the search result for this developer.',
  input: z.object({
    githubId: GithubIdParam,
    query: z.string().describe('The original search query'),
    login: z.string().describe('Developer GitHub login'),
    displayName: z.string().nullable().optional(),
    matchedRepositories: z
      .array(
        z
          .object({
            githubId: z.string(),
            ownerLogin: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            language: z.string().nullable(),
            stargazerCount: z.number(),
          })
          .passthrough(),
      )
      .describe(
        'Up to ~3 matched repos. Use the matchedRepositories array from the search result for this developer.',
      ),
  }),
  output: z
    .object({
      facetMatches: z
        .array(
          z
            .object({
              tag: z
                .string()
                .describe(
                  'The matched concept, e.g. "JavaScript", "api design", "interaction"',
                ),
              type: z
                .string()
                .describe(
                  'Facet type: "language" (programming language), "domain" (subject domain), etc.',
                ),
              reason: z
                .string()
                .describe(
                  'Short LLM explanation of how the developer matches this facet',
                ),
              repos: z
                .array(z.string())
                .describe(
                  'Names of the matched repositories that support this facet',
                ),
            })
            .passthrough(),
        )
        .describe('One entry per matched facet (language, domain, etc.)'),
    })
    .passthrough(),
};
export type GetMatchReasonInput = z.infer<typeof getMatchReasonSchema.input>;
export type GetMatchReasonOutput = z.infer<typeof getMatchReasonSchema.output>;

export const getDeveloperContributionsSchema = {
  name: 'getDeveloperContributions',
  description:
    "Fetch a developer's 1-year GitHub contribution heatmap plus follower/following counts and Twitter username. Use to assess current activity level and confirm a developer is still active.",
  notes: '',
  input: z.object({
    githubId: GithubIdParam,
  }),
  output: z
    .object({
      data: z
        .object({
          user: z
            .object({
              login: z.string(),
              websiteUrl: z.string().nullable(),
              twitterUsername: z.string().nullable(),
              followers: z
                .object({ totalCount: z.number() })
                .partial()
                .passthrough(),
              following: z
                .object({ totalCount: z.number() })
                .partial()
                .passthrough(),
              contributionsCollection: z
                .object({
                  contributionCalendar: z
                    .object({
                      totalContributions: z.number(),
                      weeks: z.array(
                        z
                          .object({
                            contributionDays: z.array(
                              z
                                .object({
                                  contributionCount: z.number(),
                                  date: z.string(),
                                })
                                .passthrough(),
                            ),
                          })
                          .passthrough(),
                      ),
                    })
                    .partial()
                    .passthrough(),
                })
                .partial()
                .passthrough(),
            })
            .partial()
            .passthrough(),
        })
        .partial()
        .passthrough(),
    })
    .partial()
    .passthrough(),
};
export type GetDeveloperContributionsInput = z.infer<
  typeof getDeveloperContributionsSchema.input
>;
export type GetDeveloperContributionsOutput = z.infer<
  typeof getDeveloperContributionsSchema.output
>;

export const profileSchemas = [
  getDeveloperProfileSchema,
  getDeveloperSynopsisSchema,
  getDeveloperInterestsSchema,
  revealDeveloperContactsSchema,
  getDeveloperTopRepoSchema,
  getMatchReasonSchema,
  getDeveloperContributionsSchema,
];
