import { z } from 'zod';

import { searchSchemas } from './search/schemas';
import { profileSchemas } from './profile/schemas';
import { historySchemas } from './history/schemas';

export const libraryDescription =
  'Vamo (vamotalent.com) GitHub-talent search and contact extraction. Find engineers by natural-language skills query, GitHub username, or repo URL; pull emails, X/Twitter, websites, LinkedIn signals, and more.';

export const libraryIcon = '/icons/libs/vamo.png';
export const loginUrl = 'https://vamotalent.com';

export const libraryNotes = `
## Workflow

1. Navigate to a Vamo project page: \`https://vamotalent.com/app/project/{projectId}/...\`
   The project UUID is in the URL path. If the user is at the chats screen, ask them to open a project first.
2. Call \`getContext()\` to extract \`projectId\`. All other functions require it.
3. Call any of the search functions or profile functions.

## Search Modes

Three search entry points map to Vamo's three search modes (visible in the "+ New Search" panel as Skills, Username, Project):

| Function | When to use |
|----------|-------------|
| \`searchBySkills\` | Natural-language description of who you want ("React engineers in SF"). Vamo's LLM extracts focus areas + languages, then matches developers by their repo embeddings. |
| \`searchByUsername\` | You know a specific GitHub login. Returns the user themselves (badge: "seed") followed by similar developers. |
| \`searchByRepo\` | You have a GitHub repo URL. Returns top contributors / similar developers based on that repo. |

The "Job Description" button in the UI maps to \`searchBySkills\` — paste the JD as the query.

## Result Shape

All searches stream **NDJSON** server-side, but each function buffers and returns a single \`{ developers, totalCount, hasMore, extraction?, seed? }\` object. Each developer entry already contains:

- Identity: \`login\`, \`displayName\`, \`bio\`, \`company\`, \`websiteUrl\`
- Location: \`location\`, \`resolvedCountry\`, \`resolvedState\`, \`resolvedCity\`
- **Contacts**: \`emails\` (commit-email list, ~94% of devs), \`socialAccounts\` (Twitter/X, Mastodon, YouTube, etc., ~49% of devs), \`websiteUrl\`
- LinkedIn signal: \`hasLinkedIn\`, \`hasProfessionalLinkedIn\`, \`linkedInSummary\`, \`linkedinSeniority\` (e.g. "Senior", "Founder", "C-Level", "Specialist", "NA")
- Ranking: \`ownerDevrank\` (\`crackedScore\`, \`tier\`, follower stats), \`matchScore\`
- Repos: \`matchedRepositories\` (why they matched the query)

Most contact info you need is already inline — you usually do **not** need a separate "reveal" call.

## Reading More Per-Developer Detail

| Need | Function |
|------|----------|
| LLM bio + LinkedIn experiences/education | \`getDeveloperSynopsis\` |
| What kinds of projects they build | \`getDeveloperInterests\` |
| 1-year contribution heatmap + Twitter handle + follower counts | \`getDeveloperContributions\` |
| Best/featured repo (with optional skip list) | \`getDeveloperTopRepo\` |
| LLM "why this dev matches" | \`getMatchReason\` |
| Owned-repo list with READMEs (100 entries) | \`getDeveloperProfile\` (returns \`owns.edges\`) |
| Spend credits to surface hidden contacts | \`revealDeveloperContacts\` |

## Result Volume / "Scrolling"

A single search request streams up to ~1000+ results (the API delivers everything at once; the UI just paginates client-side as you scroll). Use the optional \`limit\` parameter to cap the result list when you only need the top N — defaults to 100. Pass \`limit: 0\` to return every match.

\`hasMore: true\` in the response means either (a) you stopped early via \`limit\` and the server had more to give, or (b) the server itself capped the result set and the only way to drill in is a more specific query.

## Filters

All three search functions accept the same filter object:

| Field | Type | Notes |
|-------|------|-------|
| \`languages\` | \`string[]\` (skills only) | Canonical GitHub language names ("TypeScript", "Python"). Capitalization matters. |
| \`location\` | \`string\` | Single location string ("San Francisco", "United States", "Berlin"). The Vamo API only honors a single location per request — to OR multiple, run separate searches and merge. |
| \`professional.experienceTier\` | \`"junior" | "senior"\` | LinkedIn-derived seniority bucket. |
| \`professional.companies\` | \`string[]\` | LinkedIn employers. |
| \`professional.schools\` | \`string[]\` | LinkedIn schools. |
| \`professional.titles\` | \`string[]\` | LinkedIn job-title keywords. |

**LinkedIn filter caveat**: 50-80% of the strongest GitHub developers don't link a LinkedIn profile, so any non-empty \`professional\` filter drops them from results. Apply it only when LinkedIn signal is strictly required.

**Mode coverage**: \`location\` and \`professional\` are server-side filters in \`mode=skills\` only. For \`searchByUsername\` and \`searchByRepo\` the same fields are applied client-side over the streamed result set — \`location\` matches against \`resolvedCity\`/\`resolvedState\`/\`resolvedCountry\`/\`location\` (substring, case-insensitive); \`professional.experienceTier\` matches against \`linkedinSeniority\`. \`professional.companies\`/\`schools\`/\`titles\` are forwarded server-side in skills mode but cannot be checked client-side (search results don't expose LinkedIn experience/education arrays); the seed developer is always pinned at position 0 regardless of filter.

## Sort

\`sort\` is applied **client-side** over the full streamed result set:

- \`relevant\` (default): preserve Vamo's match-score ordering.
- \`active\`: most recently active developers first (Vamo's \`embeddedAt\`).
- \`stars\`: total stargazers across owned + matched repos.
- \`cracked\`: Vamo's \`crackedScore\` from \`ownerDevrank\`.

The seed developer in \`searchByUsername\` / \`searchByRepo\` is always pinned at position 0 regardless of \`sort\`.

## Reveal vs Search

\`revealDeveloperContacts\` consumes user credits ("pineapples") and returns extra contact data Vamo holds back from the search response. Only call it when:
- The search response shows \`hasLinkedIn: true\` but \`linkedInSummary\` is empty
- \`emails\` and \`socialAccounts\` are both null and the user explicitly wants you to spend credits

It is idempotent on the same developer (\`alreadyRevealed: true\` after the first call).

## GitHub IDs

Vamo uses GitHub's GraphQL node IDs (e.g., \`U_kgDOAEAhsA\` for users, \`R_kgDOFB...\` for repos), not numeric IDs or logins, when calling profile/synopsis/reveal/analyze endpoints. \`searchByUsername\` is the easiest way to translate a login into the right \`githubId\`.
`;

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract the active Vamo project ID from the current page URL. Call FIRST before any other operation.',
  notes:
    'Requires the current tab to be on a Vamo project page (URL contains /app/project/{uuid}). If the tab is on /app/chats or another non-project page, throws an error asking the caller to navigate first.',
  input: z.object({}),
  output: z
    .object({
      projectId: z
        .string()
        .describe('Vamo project UUID, used as path parameter in API calls'),
      baseUrl: z
        .string()
        .describe('Base URL of the Vamo app, e.g. https://vamotalent.com'),
    })
    .passthrough(),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

export const allSchemas = [
  getContextSchema,
  ...searchSchemas,
  ...profileSchemas,
  ...historySchemas,
];
