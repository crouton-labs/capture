import { z } from 'zod';
import { AMD_PAGE_NOTE } from './helpers/page-guidance';

export const libraryDescription =
  'LinkedIn operations: profiles, search, connections, posts, messaging, and Sales Navigator.';

export const libraryIcon = '/icons/libs/linkedin.svg';
export const loginUrl = 'https://www.linkedin.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://www.linkedin.com\`
2. Call \`getContext()\` to get \`{ csrf, memberId, tier, fullName, identityToken?, seatRoles? }\`
3. Check \`tier\` BEFORE choosing a search/list function. This gate is mandatory: Sales Nav functions (\`searchLeads\`, \`searchAccounts\`, \`getLeadProfile\`, lead lists, notes, InMail, saved searches) return \`403 SALES_SEAT_REQUIRED\` on a non-Sales-Navigator account, which costs a wasted browser round-trip and a fallback. \`getContext()\` already returns the tier, so never guess the seat by jumping straight to a Sales Nav function.
   - **"free"** / **"premium"**: use the standard functions — \`searchPeople\` (not \`searchLeads\`), \`searchCompanies\` (not \`searchAccounts\`), \`listConnections\` (not \`searchLeads\` with \`connectionsOf\`). Premium additionally allows full connection browsing.
   - **"sales_navigator"** only: the advanced functions become available. Prefer them when the seat is present (\`searchLeads\` over \`searchPeople\`, \`searchAccounts\` over \`searchCompanies\`, \`searchLeads\` with \`connectionsOf\` over \`listConnections\`) — they expose 32+ filters, lead/account lists, notes, and InMail.
   - **LinkedIn Recruiter (Talent Solutions)**: a separate premium seat (not tier-detected by getContext). If the user has a Recruiter seat, the \`recruiter*\` functions expose hiring projects, candidate pipelines, candidate profiles/resumes, talent-pool search, and the Recruiter inbox. Call \`getRecruiterContext()\` to confirm a seat exists before using them.

## LinkedIn Recruiter

A premium hiring product on \`https://www.linkedin.com/talent/\`. Reuses the same \`csrf\` from \`getContext()\`. Recommended flow:

1. \`getRecruiterContext()\` → \`contractId\`, \`seatUrn\`, credits. (Throws NotFound if no Recruiter seat.)
2. \`listHiringProjects({ contractId })\` → \`projectId\` per pipeline/req.
3. \`getHiringProject({ contractId, projectId })\` → \`sourcingChannelId\` + hiring-state urns.
4. Enumerate candidates: \`searchCandidates\` (reliable total; per-hit fields deferred), \`listCandidateRecommendations\` (cleanest — gives hireIdentityId + memberToken), or \`searchProfilesByKeyword\` (resolve a person by name).
5. Hydrate: \`getCandidateProfile({ memberToken, contractId })\`, \`getProjectCandidate({ contractId, profileId, projectId })\`, \`getCandidatesInProject({ contractId, projectId, hireIdentityIds })\`, \`getCandidateActivity({ hireIdentityId })\`, \`getProfileResumeUrl({ profileId })\`.
6. Inbox (read-only): \`getMailboxSummary\`, \`getMailboxMetadata\`, \`getConversation\`, \`getCandidateMessages\`. Some message/conversation reads return urn refs only (hydration not captured) — they are marked thin in their schemas.
7. \`logProfileView\` is the only Recruiter mutation; it is rate-limited.

## GraphQL Query Registry

${AMD_PAGE_NOTE}

Affected: profile-viewer / creator / content / audience / company-page **analytics**, the **home feed** (\`getHomeFeed\`), **post & comment reactions and comments**, post create/edit/delete/repost and **scheduled posts**, **full profile / contact info / badges**, and **GraphQL post & job search** (\`searchPosts\`, \`searchJobs\`). \`getContext\` itself is not affected. Each affected function repeats this requirement in its own notes.

## Key Concepts

- **Member ID** (ACo...): Used by standard LinkedIn functions
- **profileId** (ACw...): Used by Sales Nav functions. Different from memberId.
- **Vanity Name**: URL slug (e.g., "john-smith")
- **Company ID**: Numeric. **Universal Name**: URL slug (e.g., "google")
- **Lead/Account/List**: Sales Nav entities. Lead = person, Account = company, List = saved collection.

## Finding a Specific Person

**Never guess member IDs or vanity names from a person's name.** Use web search instead: \`"{name}" {company} linkedin\`. Extract the linkedin.com/in/ URL, then use \`viewProfile\` with the vanity name.

## Connections & Messaging

- \`"1st"\` = can message directly. \`"2nd"\`/\`"3rd+"\` = must send connection request first.
- **Own connections**: \`listConnections()\` without memberId (any tier).
- **Others' connections**: \`searchLeads\` with \`connectionsOf\` on Sales Nav (richer data, filterable). \`listConnections\` with memberId on free/premium (limited visibility).
- **\`listConnections\` pagination**: Max 50 per call, save to file after each page.
- **\`searchLeads\` pagination**: Auto-paginates internally, safe up to ~1000 per call.
- **InMail** (\`sendInMail\`): Paid messages to anyone (Sales Nav only, costs credits). Use \`sendMessage\` for free messaging to 1st-degree.

## Pagination

Offset-based: \`start\` (offset) + \`count\` (page size).

## Mass Scraping: Bypassing Result Limits

LinkedIn caps how many results a single search returns. To get more people than the cap, use **filter iteration**: run the same base search with different filter values to get different subsets, then union all results and deduplicate.

Works with any search function (\`searchLeads\`, \`searchPeople\`, \`listConnections\`, etc.) on any tier. Read the function's schema for available filters to slice on.

**Ask the user where to save output files before starting.**

1. Run base query with \`count: 1\` to get \`total\`. If it fits in one pass, download directly.
2. Pick a filter dimension, run once per value. Count each bucket first (\`count: 1\`).
3. If any bucket is still too large, add a second filter dimension.
4. Download one slice at a time. **Save each batch to a file on disk immediately.** Never hold everything in memory.
5. Merge all files, **deduplicate by \`profileId\` or \`memberId\`**. Bucket sums will exceed the real total (expected; dedup handles it).
6. Save final deduplicated file. Maintain a progress file throughout so nothing is lost if interrupted.

## Scheduling Posts

**Timezone-critical**: \`scheduledAt\` is epoch milliseconds. The browser runs in the user's local timezone (returned by \`getContext().timezone\`). To build the timestamp correctly:

\`\`\`js
// CORRECT: uses browser local time
new Date(2026, 1, 24, 9, 0).getTime()    // Feb 24, 9:00 AM local
Date.parse("2026-02-24T09:00:00")          // 9:00 AM local (no Z!)

// WRONG: "Z" means UTC, shifts by timezone offset
Date.parse("2026-02-24T09:00:00Z")         // 9:00 AM UTC = 1:00 AM PST!
new Date(Date.UTC(2026, 1, 24, 9, 0))      // same mistake
\`\`\`

LinkedIn requires at least ~20 minutes lead time. The library validates that \`scheduledAt\` is in milliseconds (not seconds) and is in the future.

## Acting as a Company Page

By default, always like, comment, and post as the **user's personal profile** (omit \`companyId\`). Only pass \`companyId\` when the user explicitly asks to act as their company page (e.g., "like this as Northlight", "comment as my company"). Do NOT call \`getAvailableActors\` unless the user asks which identities they can use.

## Activity

When the user asks for someone's "activity", fetch all three: **posts** (getPosts), **comments** (getProfileComments), and **reactions** (getProfileReactions).

## Rate Limits

LinkedIn restricts accounts that perform too many actions too quickly. Exact thresholds are undisclosed and vary by account age, SSI score, and acceptance rate. Conservative safe limits:

- **Connection requests**: 75-100/week free, 100-150/week premium, up to ~200/week Sales Nav (rolling 7-day window). Accounts with low acceptance rates or low SSI may be capped at 20-30/week.
- **Messages**: ~100/week for free, ~150/week for premium. No hard per-message limit for 1st-degree, but rapid-fire outreach triggers restrictions.
- **Profile views**: ~250/day free, ~1000/day premium. Sales Nav allows more within its own interface.
- **Search**: Results capped at ~1000 per query. Free accounts hit commercial use limits sooner.
- **Max network size**: 30,000 first-degree connections.

For bulk outbound (connection requests, messages), pace actions with delays and confirm with the user before large batches.
`;

// ============================================================================
// Rate Limits
// ============================================================================

export const rateLimits: Record<
  string,
  Array<{ window: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY'; maxCalls: number; message: string }>
> = {
  sendConnectionRequest: [
    { window: 'MINUTE', maxCalls: 5, message: 'Max 5 connection requests/min' },
    { window: 'DAY', maxCalls: 30, message: 'Max 30 connection requests/day' },
  ],
  sendMessage: [
    { window: 'MINUTE', maxCalls: 8, message: 'Max 8 messages/min' },
    { window: 'DAY', maxCalls: 100, message: 'Max 100 messages/day' },
  ],
  sendInMail: [
    { window: 'DAY', maxCalls: 30, message: 'InMail credits are paid; cap to prevent runaway spend' },
  ],
  createPost: [
    { window: 'HOUR', maxCalls: 3, message: 'Posting >3/hr looks bot-like' },
    { window: 'DAY', maxCalls: 10, message: 'LinkedIn algorithmically suppresses high-frequency posters' },
  ],
  searchPeople: [
    { window: 'MINUTE', maxCalls: 30, message: 'Search rate ceiling' },
  ],
  searchLeads: [
    { window: 'MINUTE', maxCalls: 30, message: 'Search rate ceiling' },
  ],
  logProfileView: [
    { window: 'DAY', maxCalls: 200, message: 'Recruiter profile views consume seat activity quota; cap to avoid account flags' },
  ],
  getFullProfile: [
    { window: 'MINUTE', maxCalls: 10, message: 'Artificial 10/min cap (testing Borg reroute)' },
  ],
};

export const crmTrackable: Record<string, { argFields?: readonly string[]; resultFields?: readonly string[] }> = {
  sendMessage: {
    argFields: ['recipient', 'text', 'conversationUrn'],
    resultFields: ['success', 'messageUrn', 'conversationUrn', 'recipientMemberId', 'isNewConversation'],
  },
};

export const borgableFunctions: Record<string, { access: 'read' | 'write'; nonPassableArgs: readonly string[] }> = {
  getFullProfile: { access: 'read', nonPassableArgs: ['csrf'] },
};

// ============================================================================
// Shared Params
// ============================================================================

export const CsrfParam = z
  .string()
  .describe(
    'CSRF token from getContext().csrf. Format: "ajax:<digits>" (e.g. "ajax:0899331510395077579"). Do not construct manually; always use the value returned by getContext().',
  );

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get CSRF token, member ID, and account tier for LinkedIn API calls. Automatically detects whether the user has Sales Navigator, Premium, or a free account.',
  notes:
    'Call FIRST before other LinkedIn operations. The returned `tier` field tells you which features are available: "sales_navigator" unlocks advanced search filters, lead lists, notes, InMail, and saved searches. "premium" unlocks full connection browsing. "free" is the base tier. Sales Navigator fields (identityToken, seatRoles) are only present when tier is "sales_navigator".',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: z.object({
    csrf: z.string().describe('CSRF token for API requests'),
    memberId: z.string().describe('Current user member ID'),
    tier: z
      .enum(['free', 'premium', 'sales_navigator'])
      .describe(
        'Account tier. "sales_navigator" = full Sales Nav seat, "premium" = LinkedIn Premium, "free" = basic account.',
      ),
    fullName: z.string().optional().describe('Current user full name'),
    timezone: z
      .string()
      .optional()
      .describe(
        'IANA timezone of the browser (e.g. "America/New_York", "America/Los_Angeles"). Use this when constructing scheduledAt timestamps: `new Date(year, month-1, day, hour, min).getTime()` uses local time automatically, but if parsing an ISO string, NEVER append "Z" (that means UTC). Example: `Date.parse("2026-02-24T09:00:00")` = 9 AM local; `Date.parse("2026-02-24T09:00:00Z")` = 9 AM UTC (WRONG).',
      ),
    identityToken: z
      .string()
      .optional()
      .describe(
        'Sales Navigator identity token for InMail messaging. Only present when tier is "sales_navigator".',
      ),
    seatRoles: z
      .array(z.string())
      .optional()
      .describe(
        'Sales Navigator seat roles (e.g., "SALES_SEAT_TIER1", "LSS_ADMIN_SEAT"). Only present when tier is "sales_navigator".',
      ),
  }),
};

// ============================================================================
// Query ID Discovery
// ============================================================================

// ============================================================================
// Profile Operations
// ============================================================================

export const ProfileSchema = z.object({
  memberId: z.string().describe('Member ID (entityUrn suffix)'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  headline: z.string().optional(),
  vanityName: z.string().optional().describe('Profile URL slug'),
});

const DateSchema = z.object({
  month: z.number().optional(),
  year: z.number().optional(),
});

export const FullProfileSchema = z.object({
  memberId: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string().optional().describe('Profile About/summary section'),
  location: z.string().optional(),
  distance: z.string().optional().describe('Connection degree'),
  followerCount: z.number().optional(),
  profileUrl: z.string().optional(),
  currentPosition: z
    .object({
      title: z.string().optional(),
      companyName: z.string().optional(),
    })
    .optional(),
  positions: z
    .array(
      z
        .object({
          title: z.string().optional(),
          companyName: z.string().optional(),
          companyId: z
            .string()
            .optional()
            .describe(
              'Numeric LinkedIn company ID extracted from the position URN. Use with getCompany or as currentCompany filter in searchPeople.',
            ),
          description: z
            .string()
            .optional()
            .describe('Position description/bullets text'),
          startDate: DateSchema.optional(),
          endDate: DateSchema.optional(),
          current: z.boolean().optional(),
        })
        .passthrough(),
    )
    .optional()
    .describe('Work history'),
  educations: z
    .array(
      z
        .object({
          schoolName: z.string().optional(),
          degreeName: z.string().optional(),
          fieldOfStudy: z.string().optional(),
          activities: z
            .string()
            .optional()
            .describe('Activities and societies'),
          description: z.string().optional().describe('Education description'),
          startDate: DateSchema.optional(),
          endDate: DateSchema.optional(),
        })
        .passthrough(),
    )
    .optional()
    .describe('Education history'),
  skills: z
    .array(z.string())
    .optional()
    .describe(
      'Skill names. May be empty for 2nd/3rd+ degree connections due to LinkedIn visibility restrictions.',
    ),
  emails: z
    .array(z.string())
    .optional()
    .describe(
      'Email addresses from profile contact info. Only populated for own profile or 1st-degree connections who share their email.',
    ),
  volunteering: z
    .array(
      z.object({
        organization: z.string().optional(),
        role: z.string().optional(),
        cause: z.string().optional(),
        description: z.string().optional(),
        startDate: DateSchema.optional(),
        endDate: DateSchema.optional(),
      }),
    )
    .optional()
    .describe('Volunteer experiences'),
  certifications: z
    .array(
      z.object({
        name: z.string().optional(),
        issuingOrganization: z.string().optional(),
        issueDate: DateSchema.optional(),
        credentialId: z.string().optional(),
        credentialUrl: z.string().optional(),
      }),
    )
    .optional()
    .describe('Licenses and certifications'),
  languages: z
    .array(
      z.object({
        name: z.string().optional(),
        proficiency: z.string().optional(),
      }),
    )
    .optional()
    .describe('Languages spoken'),
  courses: z
    .array(
      z.object({
        name: z.string().optional(),
        number: z.string().optional(),
      }),
    )
    .optional()
    .describe('Courses taken'),
  projects: z
    .array(
      z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        url: z.string().optional(),
        startDate: DateSchema.optional(),
        endDate: DateSchema.optional(),
      }),
    )
    .optional()
    .describe('Projects'),
  publications: z
    .array(
      z.object({
        title: z.string().optional(),
        publisher: z.string().optional(),
        date: DateSchema.optional(),
        url: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional()
    .describe('Publications'),
  honors: z
    .array(
      z.object({
        title: z.string().optional(),
        issuer: z.string().optional(),
        date: DateSchema.optional(),
        description: z.string().optional(),
      }),
    )
    .optional()
    .describe('Honors and awards'),
  organizations: z
    .array(
      z.object({
        name: z.string().optional(),
        role: z.string().optional(),
        startDate: DateSchema.optional(),
        endDate: DateSchema.optional(),
      }),
    )
    .optional()
    .describe('Professional organizations'),
  patents: z
    .array(
      z.object({
        title: z.string().optional(),
        patentNumber: z.string().optional(),
        status: z.string().optional(),
        url: z.string().optional(),
        description: z.string().optional(),
        issueDate: DateSchema.optional(),
      }),
    )
    .optional()
    .describe('Patents'),
  testScores: z
    .array(
      z.object({
        name: z.string().optional(),
        score: z.string().optional(),
        date: DateSchema.optional(),
      }),
    )
    .optional()
    .describe('Test scores'),
});

export const getMeSchema = {
  name: 'getMe',
  description: 'Get current user profile info',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    memberId: z.string().describe('Current user member ID'),
    miniProfile: z
      .object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        occupation: z.string().optional(),
        publicIdentifier: z.string().optional().describe('Vanity name'),
        profilePicture: z.string().optional().describe('Profile picture URL'),
      })
      .optional()
      .describe('Mini profile data'),
  }),
};

export const getProfileByVanityNameSchema = {
  name: 'getProfileByVanityName',
  description: 'Resolve vanity name (URL slug) to member ID.',
  notes: 'Use getFullProfile() for complete profile data. ' + AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    vanityName: z.string().describe('Profile URL slug (e.g., "john-smith")'),
  }),
  output: z.object({
    memberId: z.string().describe('Target profile member ID'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    headline: z.string().optional(),
  }),
};

export const getFullProfileSchema = {
  name: 'getFullProfile',
  description: 'Get full profile details by member ID or vanity name',
  notes: `Returns profile data only. For connection/invitation status, call getMemberRelationship in parallel. For email/phone/websites, call getContactInfo in parallel. Skills may be empty if the profile owner has not added any.

fetchMode controls API call count vs data richness:
- "basic" (default): Core data only. 1-2 API calls. Fast. Best for batches (>5 profiles). Returns: name, headline, location, distance, positions (no descriptions), education, skills, emails, followerCount.
- "full": All data. 2-3 API calls. Use when user asks about a specific person or small group (≤5). Returns everything "basic" returns PLUS: summary/about, position descriptions, volunteering, certifications, languages, courses, projects, publications, honors.
- "rich": Rich text only. 1 API call. Returns: summary, position descriptions, volunteering, certifications, languages, but NOT structured skills/distance/emails/followerCount.

Use "full" when: user asks about 1-5 specific people, wants detailed background, needs About section or experience descriptions.
Use "basic" when: searching/filtering many profiles, building lists, any batch over 5 profiles.

Fetching several profiles at once: use Promise.allSettled, not Promise.all — a single call can fail (e.g. rate limit), and Promise.all drops the whole batch on the first rejection, discarding the profiles that succeeded.

${AMD_PAGE_NOTE}`,
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        'Pass an ACo... member ID (from searchPeople) OR a vanity name string (e.g., "john-smith"). The parameter key is always "memberId" regardless of which value you pass; do NOT use "vanityName" as a key.',
      ),
    fetchMode: z
      .enum(['full', 'basic', 'rich'])
      .optional()
      .default('basic')
      .describe(
        'Default "basic" (fast, 1-2 API calls). Use "full" when user asks about a specific person or ≤5 people and needs detailed info (about section, experience descriptions, certifications, languages). Use "basic" for batches, lists, filtering (>5 profiles). "rich" = profileCards only (1 call, rich text but no skills/distance/emails).',
      ),
  }),
  output: FullProfileSchema,
};

export const getContactInfoSchema = {
  name: 'getContactInfo',
  description:
    'Get contact information (email, phone, websites, social handles) for a LinkedIn profile',
  notes:
    'Email availability depends on connection degree and the profile owner\'s privacy settings: own profile = always available, 1st-degree = usually available, 2nd-degree = sometimes available, 3rd+ = rarely available. This is the same data shown in LinkedIn\'s "Contact info" modal on profiles.' +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        'Vanity name (e.g., "john-smith") or member ID (ACo...). If member ID provided, resolves to vanity name first.',
      ),
  }),
  output: z.object({
    memberId: z.string().describe('ACo member ID'),
    vanityName: z.string().describe('URL slug (vanity name)'),
    email: z
      .string()
      .optional()
      .describe('Primary email address if shared by profile owner'),
    phoneNumbers: z
      .array(z.string())
      .optional()
      .describe('Phone numbers if shared by profile owner'),
    websites: z
      .array(
        z.object({
          url: z.string(),
          category: z
            .string()
            .optional()
            .describe(
              'Website category: "BLOG", "COMPANY", "PORTFOLIO", "RSS", "OTHER"',
            ),
        }),
      )
      .optional()
      .describe('Websites listed on the profile'),
    twitterHandles: z
      .array(z.string())
      .optional()
      .describe('Twitter/X handles'),
    birthday: z
      .object({
        month: z.number(),
        day: z.number(),
      })
      .optional()
      .describe('Birthday if shared'),
    address: z.string().optional().describe('Address if shared'),
    ims: z
      .array(
        z.object({
          provider: z.string().describe('IM provider (e.g., "SKYPE", "AIM")'),
          handle: z.string().describe('IM handle/username'),
        }),
      )
      .optional()
      .describe('Instant messaging handles'),
  }),
};

export const downloadProfilePictureSchema = {
  name: 'downloadProfilePicture',
  description:
    "Download a LinkedIn profile picture and save it to the user's device. Returns the file path.",
  notes:
    'Saves the image via the Northlight files API. Returns null fields if the profile has no picture set. Fetches the largest available resolution by default.',
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        'Member ID (ACo...) or vanity name (e.g., "john-smith"). Resolves vanity names automatically.',
      ),
    size: z
      .enum(['small', 'medium', 'large'])
      .optional()
      .default('large')
      .describe(
        'Image size: "small" (~100px), "medium" (~200px), "large" (~400-800px). Default: "large".',
      ),
  }),
  output: z.object({
    memberId: z.string().describe('ACo member ID'),
    imageUrl: z
      .string()
      .nullable()
      .describe(
        'Direct URL to the profile picture on LinkedIn CDN, or null if no profile picture',
      ),
    filePath: z
      .string()
      .nullable()
      .describe(
        "Absolute path where the image was saved on the user's device, or null if no picture or files API unavailable",
      ),
    sizeBytes: z
      .number()
      .nullable()
      .describe('Image file size in bytes, or null if no profile picture'),
  }),
};

export const getProfileBadgesSchema = {
  name: 'getProfileBadges',
  description:
    'Detect whether a LinkedIn profile has an #OpenToWork or #Hiring banner on their profile photo',
  notes: AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        'Member ID (ACo...) or vanity name (e.g., "john-smith"). Resolves vanity names automatically.',
      ),
  }),
  output: z.object({
    memberId: z.string().describe('ACo member ID'),
    openToWork: z
      .boolean()
      .describe(
        'True if the profile has the green #OpenToWork photo frame (publicly visible job seeker status)',
      ),
    hiring: z
      .boolean()
      .describe(
        'True if the profile has the purple #Hiring photo frame (actively hiring)',
      ),
    openToWorkDetails: z
      .object({
        title: z.string().describe('e.g., "Open to work"'),
        description: z
          .string()
          .describe(
            'Desired roles and details, e.g., "Software Engineer, Product Manager roles"',
          ),
      })
      .optional()
      .describe('Details about what roles the person is open to'),
    hiringDetails: z
      .object({
        title: z
          .string()
          .describe('e.g., "Hiring: Senior Quality Engineer & 1 other"'),
        description: z
          .string()
          .describe(
            'Company, location, and recency, e.g., "Acme Corp · New York (On-site) · 3 days ago"',
          ),
      })
      .optional()
      .describe('Details about what positions the person is hiring for'),
  }),
};

// ============================================================================
// Search Operations
// ============================================================================

export const SearchResultSchema = z
  .object({
    memberId: z.string().optional().describe('Member ID'),
    name: z
      .string()
      .optional()
      .describe(
        'Display name. Returns "LinkedIn Member" for privacy-restricted profiles (out-of-network or limited visibility).',
      ),
    headline: z
      .string()
      .optional()
      .describe(
        'Headline/job title. Returns "--" for privacy-restricted profiles.',
      ),
    location: z.string().optional(),
    vanityName: z
      .string()
      .optional()
      .describe(
        'URL slug for the profile. Missing for privacy-restricted profiles.',
      ),
    profileUrl: z
      .string()
      .optional()
      .describe(
        'Full LinkedIn profile URL. Missing for privacy-restricted profiles.',
      ),
    connectionDegree: z
      .string()
      .optional()
      .describe(
        'Connection degree: "1st", "2nd", "3rd+". Missing for privacy-restricted profiles.',
      ),
    connectedAt: z
      .number()
      .optional()
      .describe(
        "Unix timestamp (milliseconds) when the connection was established. Only present for own connections returned by listConnections (not present for search results or other users' connections).",
      ),
    connectedDate: z
      .string()
      .optional()
      .describe(
        'Human-readable connection date in "Month Day, Year" format (e.g. "February 17, 2026"). Only present for own connections returned by listConnections.',
      ),
    connectedDaysAgo: z
      .number()
      .optional()
      .describe(
        'Number of days since the connection was established. Only present for own connections returned by listConnections.',
      ),
  })
  .describe(
    'LinkedIn profile summary. Out-of-network profiles may be privacy-restricted: name shows "LinkedIn Member", headline shows "--", and vanityName/profileUrl/connectionDegree are absent.',
  );

export const searchPeopleSchema = {
  name: 'searchPeople',
  description:
    'Search for people by keyword and/or filters. Results are sorted by connection proximity (1st > 2nd > 3rd+ > out-of-network), so results[0] is the closest match. Returns memberId and connectionDegree for each result. Use the returned memberId for subsequent operations.',
  notes:
    'To find a specific person at a specific company: call `resolveCompanyId(company)` and pass the returned ID to `currentCompany`. Filters and `keywords` combine; do NOT cram a company name into `keywords` (LinkedIn returns the wrong namesakes or empty results). At least one of `keywords` or one filter (firstName, lastName, currentCompany, etc.) is required. When multiple candidates share the same name, verify with `headline` and `connectionDegree` before proceeding. To find a specific connection by name, prefer `listConnections` with `keywords`, which uses the direct connections endpoint and is always accurate.',
  input: z.object({
    csrf: CsrfParam,
    keywords: z
      .string()
      .optional()
      .describe(
        'Search keywords (e.g., person name). Optional when filters like firstName, lastName, or currentCompany are provided.',
      ),
    network: z
      .array(z.enum(['F', 'S', 'O']))
      .optional()
      .describe(
        'Connection degree filter. F=1st degree connections, S=2nd degree, O=3rd+ and out-of-network.',
      ),
    geoUrn: z
      .array(z.string())
      .optional()
      .describe(
        'Location geo IDs (numeric strings). Use resolveGeo to find IDs from location names. Examples: "103644278" (United States), "102277331" (San Francisco Bay Area), "101165590" (United Kingdom).',
      ),
    industry: z
      .array(z.string())
      .optional()
      .describe(
        'Industry codes (numeric strings). Use resolveIndustry to find codes from industry names. Examples: "96" (IT Services), "4" (Computer Software), "6" (Internet).',
      ),
    currentCompany: z
      .array(z.string())
      .optional()
      .describe(
        'Current company IDs (numeric strings). Use resolveCompanyId or searchCompanies to find IDs.',
      ),
    pastCompany: z
      .array(z.string())
      .optional()
      .describe(
        'Past company IDs (numeric strings). Use resolveCompanyId or searchCompanies to find IDs.',
      ),
    school: z
      .array(z.string())
      .optional()
      .describe(
        'School IDs (numeric strings). Use resolveSchool to find IDs from school names. Example: "1150" (Stanford University).',
      ),
    profileLanguage: z
      .array(z.string())
      .optional()
      .describe(
        'Profile language ISO codes. Examples: "en" (English), "pt" (Portuguese), "es" (Spanish), "fr" (French), "de" (German).',
      ),
    firstName: z.string().optional().describe('Filter by first name.'),
    lastName: z.string().optional().describe('Filter by last name.'),
    title: z
      .string()
      .optional()
      .describe('Filter by job title (e.g., "Software Engineer", "VP Sales").'),
    company: z
      .string()
      .optional()
      .describe(
        'Filter by company name (free text, not an ID). For exact company matching, use currentCompany with a numeric ID instead.',
      ),
    serviceCategory: z
      .array(z.string())
      .optional()
      .describe('Service category IDs for filtering by offered services.'),
    connectionOf: z
      .string()
      .optional()
      .describe(
        'Member ID (ACo... format) to filter by connections of that person. Shows people connected to the specified member. Uses GraphQL endpoint (slower but required for this filter).',
      ),
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of results (default 10). Auto-paginates internally.'),
  }),
  output: z.object({
    results: z.array(SearchResultSchema),
    total: z.number().optional().describe('Total matching people on LinkedIn.'),
  }),
};

export const searchCompaniesSchema = {
  name: 'searchCompanies',
  description: 'Search for companies by keyword with optional filters',
  notes:
    'Results include Showcase Pages (product/division pages) alongside regular Company Pages; the main company may not be the first result. Showcase Pages have employees listed under their parent company; use the parent company ID with searchPeople + currentCompany filter. Use specific company names for best results.',
  input: z.object({
    csrf: CsrfParam,
    keywords: z.string().describe('Company name to search'),
    companyHqGeo: z
      .array(z.string())
      .optional()
      .describe(
        'Company headquarters location geo IDs (numeric strings). Use resolveGeo to find IDs. Same IDs as geoUrn in searchPeople.',
      ),
    companySize: z
      .array(z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']))
      .optional()
      .describe(
        'Company size ranges. A=1 employee, B=2-10, C=11-50, D=51-200, E=201-500, F=501-1000, G=1001-5000, H=5001-10000, I=10001+.',
      ),
    industry: z
      .array(z.string())
      .optional()
      .describe(
        'Industry codes (numeric strings). Use resolveIndustry to find codes. Same codes as industry in searchPeople.',
      ),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of results (default 10). Auto-paginates internally.'),
  }),
  output: z.object({
    results: z.array(
      z.object({
        companyId: z.string().optional(),
        name: z.string().optional(),
        subtitle: z.string().optional().describe('Industry and location'),
        universalName: z.string().optional(),
        companyUrl: z.string().optional(),
        logoUrl: z.string().optional().describe('Company logo URL (100x100)'),
      }),
    ),
    total: z.number().optional(),
  }),
};

// ============================================================================
// Connection Operations
// ============================================================================

export const listConnectionsSchema = {
  name: 'listConnections',
  description:
    "List your 1st-degree connections, or browse another person's connections by name, vanity name, or member ID. When browsing someone else, defaults to showing both mutual (1st) and non-mutual (2nd) connections.",
  notes:
    'Without memberId: returns your own 1st-degree connections (sorted by recently added). With memberId: resolves the person (accepts full name like "John Smith", vanity name like "john-smith", or ACo member ID) then returns their visible connections. Default network filter is ["F","S"] when browsing someone else (both mutual and non-mutual). Pass ["F"] for mutual only or ["S"] for non-mutual only.\n\n**LinkedIn restricts visibility of another person\'s connections.** Even with Premium, you can only see a subset, not the full list. Only Sales Navigator provides deeper access. This is a hard LinkedIn platform limit. If the user asks for "all" connections of another person or keeps asking for more pages after results stop, remind them that LinkedIn does not expose the full connection list and the results returned are the best available.\n\n**IMPORTANT: never request more than 50 connections in a single call.** Request 10 at a time (the default). After collecting 50 results, STOP, save results to a file, then start a new call with `start` set to where you left off. Repeat until done. This prevents LinkedIn from flagging automated behavior. Built-in rate limiting adds random delays between pages (occasionally up to 4 seconds).\n\nThe `total` field is absent for own connections. When browsing others, `total` may report a higher number than actually returned due to visibility limits. Use `hasMore` to determine if more pages exist.',
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .optional()
      .describe(
        'Person to browse connections of. Accepts a full name (e.g., "John Smith"), vanity name (e.g., "john-smith"), or ACo member ID. Omit to list your own connections.',
      ),
    keywords: z
      .string()
      .optional()
      .describe('Search within connections by name, title, or company.'),
    network: z
      .array(z.enum(['F', 'S']))
      .optional()
      .describe(
        'Connection degree filter when browsing another person\'s connections. F = 1st-degree (mutual connections), S = 2nd-degree (their connections you\'re not connected to). Default: ["F","S"] (both). Ignored when browsing your own connections.',
      ),
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of results (default 10). Auto-paginates internally.'),
  }),
  output: z.object({
    targetProfile: z
      .object({
        memberId: z.string(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      })
      .optional()
      .describe(
        'Profile info of the target person. Only present when memberId is provided.',
      ),
    results: z.array(SearchResultSchema),
    total: z
      .number()
      .optional()
      .describe(
        'Total reported by LinkedIn (may be higher than results returned due to visibility limits)',
      ),
    hasMore: z.boolean().optional(),
  }),
};

export const getMemberRelationshipSchema = {
  name: 'getMemberRelationship',
  description:
    'Check the relationship status with a LinkedIn member: whether connected, pending invitation, or no connection',
  notes:
    'Call before sendConnectionRequest to avoid CANT_RESEND_YET errors. Can be called in parallel with getFullProfile or getContactInfo.',
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        'Member ID (ACo...) from searchPeople results. Also accepts vanity name.',
      ),
  }),
  output: z.object({
    memberId: z.string().describe('Resolved member ID'),
    status: z
      .enum(['connected', 'pending_sent', 'pending_received', 'not_connected'])
      .describe(
        'Relationship status. connected = 1st degree. pending_sent = you sent an invite. pending_received = they sent you an invite. not_connected = no relationship.',
      ),
    invitationUrn: z
      .string()
      .optional()
      .describe(
        'URN of the pending invitation (if status is pending_sent or pending_received). Pass to withdrawConnectionRequest to withdraw.',
      ),
    sentTime: z
      .number()
      .optional()
      .describe(
        'When the connection request was sent (epoch ms). Only present for pending invitations.',
      ),
    distance: z
      .string()
      .optional()
      .describe('Connection degree (DISTANCE_2, DISTANCE_3, etc.)'),
  }),
};

export type GetMemberRelationshipOutput = z.infer<
  typeof getMemberRelationshipSchema.output
>;

export const sendConnectionRequestSchema = {
  name: 'sendConnectionRequest',
  description: 'Send a connection request',
  notes:
    'Call getMemberRelationship first to check if already connected or pending. Sending to someone with a pending invite returns CANT_RESEND_YET (400). **Rate limit**: 75-100/week free, 100-150/week premium, up to ~200/week Sales Nav (rolling 7-day window). Low acceptance rates or new accounts get capped lower. For bulk sends, pace with delays and confirm with the user before large batches. Skill hint: use the "sales-copy" skill for composing the personalized message.',
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        "Target person's member ID (ACo... from searchPeople) or vanity name. Must be the OTHER person's ID; do NOT pass your own memberId or you will send a self-invite (500 error).",
      ),
    customMessage: z
      .string()
      .optional()
      .describe('Optional personalized message (max 300 chars)'),
  }),
  output: z.object({
    success: z.boolean(),
    recipient: z.string().optional(),
    recipientUrn: z.string().optional(),
    invitationUrn: z.string().optional().describe('Invitation URN if created'),
    error: z.string().optional(),
  }),
};

export const getInvitationsSummarySchema = {
  name: 'getInvitationsSummary',
  description: 'Get counts of pending connection invitations',
  notes:
    'Counts only connection-type invitations. Newsletters, page follows, and content series invitations are excluded. Use listInvitations to get all invitation types.',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    numNewInvitations: z
      .number()
      .describe('Number of unseen connection invitations'),
    numPendingInvitations: z
      .number()
      .describe(
        'Number of pending connection invitations (excludes newsletters and other non-connection invitation types)',
      ),
  }),
};

export const listConnectionRequestsSchema = {
  name: 'listConnectionRequests',
  description: 'List pending connection requests',
  notes:
    'Returns RECEIVED connection requests only (not sent). The sharedSecret in each result is needed for handleInvitationAction.',
  input: z.object({
    csrf: CsrfParam,
    start: z.number().optional().default(0),
    count: z.number().optional().default(20),
  }),
  output: z.object({
    invitations: z.array(
      z.object({
        invitationId: z.string(),
        sharedSecret: z
          .string()
          .describe(
            'Required for accept/reject via handleInvitationAction (pass as validationToken)',
          ),
        fromMemberId: z.string().optional(),
        fromName: z.string().optional(),
        vanityName: z
          .string()
          .optional()
          .describe('URL slug (e.g. "john-smith")'),
        profileUrl: z
          .string()
          .optional()
          .describe(
            'Full LinkedIn profile URL (e.g. "https://www.linkedin.com/in/john-smith")',
          ),
        headline: z
          .string()
          .optional()
          .describe('LinkedIn headline (job title / tagline)'),
        message: z
          .string()
          .optional()
          .describe('Personalized note included with the connection request'),
        sentTime: z
          .number()
          .optional()
          .describe('Epoch milliseconds when the request was sent'),
      }),
    ),
  }),
};

export const listInvitationsSchema = {
  name: 'listInvitations',
  description:
    'List all pending received invitations including connection requests, newsletter subscriptions, and page follows',
  notes:
    'Returns ALL invitation types. Each invitation has a `type` field: "connection", "newsletter", or "other". Use with handleInvitationAction to accept/ignore. Connection invitations have fromMemberId/fromName. Newsletter invitations have title/subtitle/companyName.',
  input: z.object({
    csrf: CsrfParam,
    start: z.number().optional().default(0),
    count: z.number().optional().default(20),
  }),
  output: z.object({
    invitations: z.array(
      z.object({
        invitationId: z.string(),
        sharedSecret: z
          .string()
          .describe('Required for accept/reject via handleInvitationAction'),
        type: z
          .enum(['connection', 'newsletter', 'other'])
          .describe('Invitation type'),
        // Connection-specific fields
        fromMemberId: z
          .string()
          .optional()
          .describe('Sender member ID (connection requests only)'),
        fromName: z
          .string()
          .optional()
          .describe('Sender name (connection requests only)'),
        // Newsletter-specific fields
        title: z
          .string()
          .optional()
          .describe(
            'Invitation title (e.g., "Google invited you to subscribe to The Monthly AI Recap")',
          ),
        subtitle: z
          .string()
          .optional()
          .describe('Subtitle (e.g., "Newsletter • Monthly")'),
        companyName: z
          .string()
          .optional()
          .describe('Company that sent the newsletter invitation'),
      }),
    ),
  }),
};

export const handleInvitationActionSchema = {
  name: 'handleInvitationAction',
  description:
    'Accept or reject any invitation (connection request, newsletter, etc.)',
  notes:
    'validationToken is the sharedSecret from listInvitations or listConnectionRequests. For connection invitations, pass profileId (the sender fromMemberId). For newsletter invitations, profileId is not needed. Works from any LinkedIn page.',
  input: z.object({
    csrf: CsrfParam,
    invitationId: z.string().describe('Invitation ID'),
    profileId: z
      .string()
      .optional()
      .describe(
        'Sender profile member ID (required for connection invitations)',
      ),
    validationToken: z
      .string()
      .describe('sharedSecret from listInvitations or listConnectionRequests'),
    action: z
      .enum(['accept', 'ignore'])
      .describe('Accept or ignore the invitation'),
    invitationType: z
      .enum(['connection', 'newsletter', 'other'])
      .optional()
      .default('connection')
      .describe(
        'Type of invitation. Determines the SDUI invitationType sent to LinkedIn.',
      ),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  }),
  output: z.void(),
};

export const listSentConnectionRequestsSchema = {
  name: 'listSentConnectionRequests',
  description:
    'List pending sent connection requests that you have sent to other people',
  notes:
    'Returns sent connection requests with recipient info and invitation URNs needed for withdrawConnectionRequest. Custom message text is not included in list results. Navigate to /mynetwork/invitation-manager/sent/ first for best results. Pages of 10 from LinkedIn.',
  input: z.object({
    csrf: CsrfParam,
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe(
        'Number of results (default 10). Auto-paginates internally for counts > 10.',
      ),
  }),
  output: z.object({
    invitations: z.array(
      z.object({
        invitationId: z
          .string()
          .describe('Invitation ID, used with withdrawConnectionRequest'),
        invitationUrn: z
          .string()
          .describe(
            'Full invitation URN (urn:li:fsd_invitation:ID). Pass to withdrawConnectionRequest.',
          ),
        name: z.string().optional().describe('Recipient full name'),
        memberId: z
          .string()
          .optional()
          .describe('Recipient ACo-format member ID'),
        vanityName: z
          .string()
          .optional()
          .describe('Recipient LinkedIn vanity name (URL slug)'),
        profileUrl: z.string().optional().describe('Full LinkedIn profile URL'),
      }),
    ),
    hasMore: z.boolean().describe('Whether more results are available'),
  }),
};

export const withdrawConnectionRequestSchema = {
  name: 'withdrawConnectionRequest',
  description: 'Withdraw a pending sent connection request',
  notes:
    'Requires invitationUrn; get it from sendConnectionRequest response or from listSentConnectionRequests. Cannot resend to the same person for up to 3 weeks after withdrawal.',
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        'Target member ID (ACo...) from searchPeople results. Also accepts vanity name.',
      ),
    invitationUrn: z
      .string()
      .describe(
        'Invitation URN from sendConnectionRequest or listSentConnectionRequests (e.g., urn:li:fsd_invitation:1234567890)',
      ),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

// ============================================================================
// Company Operations
// ============================================================================

export const CompanySchema = z.object({
  companyId: z.string(),
  companyUrn: z.string().optional(),
  name: z.string().optional(),
  universalName: z.string().optional().describe('URL slug'),
  description: z.string().optional(),
  tagline: z.string().optional().describe('Short company summary'),
  staffCount: z.number().optional(),
  staffCountRange: z
    .object({
      start: z.number().optional(),
      end: z.number().optional(),
    })
    .optional()
    .describe('Employee count range (e.g., 501-1000)'),
  industry: z.string().optional(),
  companyUrl: z.string().optional(),
  website: z.string().optional().describe('Company external website URL'),
  logoUrl: z.string().optional(),
  companyType: z
    .string()
    .optional()
    .describe('e.g., "Privately Held", "Public Company", "Nonprofit"'),
  foundedOn: z
    .object({
      year: z.number().optional(),
      month: z.number().optional(),
    })
    .optional(),
  specialities: z.array(z.string()).optional(),
  headquarter: z
    .object({
      country: z.string().optional(),
      city: z.string().optional(),
      geographicArea: z.string().optional(),
      postalCode: z.string().optional(),
      line1: z.string().optional(),
    })
    .optional(),
  fundingData: z
    .object({
      lastRoundType: z.string().optional().describe('e.g., "SERIES_F"'),
      lastRoundAmount: z.string().optional().describe('Amount in USD string'),
      lastRoundDate: z
        .object({
          year: z.number().optional(),
          month: z.number().optional(),
          day: z.number().optional(),
        })
        .optional(),
      leadInvestors: z
        .array(z.string())
        .optional()
        .describe('Names of lead investors'),
      numFundingRounds: z.number().optional(),
      crunchbaseUrl: z.string().optional(),
    })
    .optional(),
});

export const getCompanySchema = {
  name: 'getCompany',
  description: 'Get company details by ID or universal name',
  notes:
    'Company names on LinkedIn do NOT always match their universalName (URL slug). For example, "Anthropic" (the AI company) has universalName "anthropicresearch", not "anthropic". When searching by name, check `otherCompaniesWithSameName` to verify you have the right company (especially for common names). Prefer universalName from searchCompanies results.',
  input: z.object({
    csrf: CsrfParam,
    identifier: z
      .string()
      .describe(
        'Company ID, universal name, or search term (prefer universalName)',
      ),
  }),
  output: CompanySchema.extend({
    followingState: z
      .object({
        following: z.boolean(),
        followerCount: z.number().optional(),
      })
      .optional(),
    paidCompany: z
      .boolean()
      .describe(
        'Whether the company has a paid/premium LinkedIn page subscription',
      ),
    isAdmin: z
      .boolean()
      .describe('Whether the current user is an admin of this company page'),
    viewerEmployee: z
      .boolean()
      .describe('Whether the current user is an employee of this company'),
    otherCompaniesWithSameName: z
      .array(
        z.object({
          companyId: z.string().optional(),
          name: z.string().optional(),
          universalName: z.string().optional(),
          subtitle: z.string().optional().describe('Industry and location'),
          companyUrl: z.string().optional(),
        }),
      )
      .optional()
      .describe(
        'Other companies from search with the same or similar name; check these if the returned company is not what you expected',
      ),
  }),
};

export const getCompanyFollowingStateSchema = {
  name: 'getCompanyFollowingState',
  description: 'Get following state for a company',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    companyId: z
      .string()
      .describe(
        'Numeric company ID (from getCompany companyId field). Do NOT use universalName.',
      ),
  }),
  output: z.object({
    following: z.boolean(),
    followerCount: z.number().optional(),
  }),
};

export const updateFollowingStateSchema = {
  name: 'updateFollowingState',
  description: 'Follow or unfollow a company',
  notes:
    'Requires numeric companyId (e.g. "1441"), not universalName. Call getCompany first to get the companyId.',
  input: z.object({
    csrf: CsrfParam,
    companyId: z
      .string()
      .describe(
        'Numeric company ID (from getCompany companyId field). Do NOT use universalName.',
      ),
    following: z.boolean().describe('true to follow, false to unfollow'),
  }),
  output: z.void(),
};

// ============================================================================
// Posts Operations
// ============================================================================

export const PostSchema = z.object({
  postUrn: z.string().optional(),
  activityUrn: z
    .string()
    .optional()
    .describe('Activity URN for social interactions'),
  ugcPostUrn: z
    .string()
    .optional()
    .describe(
      'Pass this value as the `postUrn` parameter to getPostReactions/getPostComments. May be urn:li:ugcPost or urn:li:activity format; both work. For reposts, this points to the original post.',
    ),
  text: z.string().optional(),
  timestamp: z
    .number()
    .optional()
    .describe(
      'Post creation timestamp in epoch ms. Only available on getPostComments. Not populated by getPosts, getProfileReactions, getCompanyPosts, or getHomeFeed; use relativeTime instead.',
    ),
  relativeTime: z
    .string()
    .optional()
    .describe(
      'Compact relative time like "3mo", "4d", "2h". Populated by getPosts, getProfileReactions, getCompanyPosts, and getHomeFeed.',
    ),
  likesCount: z.number().optional(),
  commentsCount: z.number().optional(),
  repostsCount: z.number().optional(),
  authorName: z.string().optional(),
  authorHeadline: z.string().optional(),
  authorMemberId: z
    .string()
    .optional()
    .describe(
      'Author member ID. Usually ACo format (usable with viewProfile, sendMessage, etc.). Company posts may return a numeric ID instead, which is NOT usable with other functions; use authorVanityName to identify those authors.',
    ),
  authorVanityName: z.string().optional(),
  authorProfileUrl: z
    .string()
    .optional()
    .describe(
      'LinkedIn profile URL for the post author. Uses vanity name when available, otherwise memberId.',
    ),
  postType: z
    .enum(['original', 'repost', 'repost_with_commentary'])
    .optional()
    .describe(
      'Post classification: "original" = author wrote this post, "repost" = instant repost/reshare with no added text, "repost_with_commentary" = reshare where the user added their own commentary above the original post.',
    ),
  isRepost: z
    .boolean()
    .optional()
    .describe(
      'True if this is a repost or repost-with-commentary. Use postType for finer-grained classification.',
    ),
  originalPostUrn: z
    .string()
    .optional()
    .describe(
      'For reposts and reposts-with-commentary: activity URN of the original post being shared.',
    ),
  hasImage: z
    .boolean()
    .optional()
    .describe(
      'Populated by getCompanyPosts and getHomeFeed. Not available on profile activity endpoints (getPosts, getProfileReactions).',
    ),
  hasVideo: z
    .boolean()
    .optional()
    .describe(
      'Populated by getCompanyPosts and getHomeFeed. Not available on profile activity endpoints (getPosts, getProfileReactions).',
    ),
  imageUrl: z
    .string()
    .optional()
    .describe(
      'URL of the first image. Populated by getCompanyPosts and getHomeFeed when media extraction succeeds.',
    ),
  videoUrl: z
    .string()
    .optional()
    .describe(
      'URL of the video. Populated by getCompanyPosts and getHomeFeed when media extraction succeeds.',
    ),
  postUrl: z.string().optional().describe('Direct URL to the post on LinkedIn'),
  userReactionType: z
    .enum([
      'LIKE',
      'PRAISE',
      'EMPATHY',
      'INTEREST',
      'APPRECIATION',
      'ENTERTAINMENT',
    ])
    .optional()
    .describe(
      'Which reaction type the profile owner gave to this post. Only populated by getProfileReactions when viewing your own profile.',
    ),
});

export const ReactorSchema = z.object({
  memberId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  headline: z
    .string()
    .optional()
    .describe(
      'LinkedIn headline (freeform text, not a structured field). Use getFullProfile() for structured company/title data.',
    ),
  vanityName: z
    .string()
    .optional()
    .describe(
      'May not be available; LinkedIn reactions endpoint often returns memberId-based URLs only.',
    ),
  profileUrl: z.string().optional(),
  reactionType: z
    .enum([
      'LIKE',
      'PRAISE',
      'EMPATHY',
      'INTEREST',
      'APPRECIATION',
      'ENTERTAINMENT',
    ])
    .optional(),
});

export const CommentSchema = z.object({
  commentUrn: z.string().optional(),
  text: z.string().optional(),
  createdAt: z.number().optional(),
  commenterMemberId: z.string().optional(),
  commenterName: z.string().optional(),
  commenterHeadline: z
    .string()
    .optional()
    .describe(
      'LinkedIn headline (freeform text, not a structured field). Use getFullProfile() for structured company/title data.',
    ),
  commenterVanityName: z.string().optional(),
  commenterProfileUrl: z
    .string()
    .optional()
    .describe(
      'LinkedIn profile URL for the commenter. Uses vanity name when available, otherwise memberId.',
    ),
  likesCount: z.number().optional(),
  repliesCount: z
    .number()
    .optional()
    .describe(
      'Number of replies. Returns 0 when includeReplies is true and no replies exist. Not populated when includeReplies is false.',
    ),
  replies: z.array(z.lazy((): z.ZodTypeAny => CommentSchema)).optional(),
});

export const getCompanyPostsSchema = {
  name: 'getCompanyPosts',
  description: 'Get posts by a company',
  notes:
    'Each post includes `ugcPostUrn`; use this with getPostReactions/getPostComments. It may be urn:li:ugcPost or urn:li:activity format; both work. For reposts, `originalPostUrn` contains the original post URN when available.',
  input: z.object({
    csrf: CsrfParam,
    companyIdOrUniversalName: z
      .string()
      .describe('Company ID or universal name'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe(
        'Number of posts (default 10). Auto-paginates for counts > 50.',
      ),
    start: z.number().optional().default(0).describe('Pagination offset'),
  }),
  output: z.object({
    posts: z.array(PostSchema),
  }),
};

export const getHomeFeedSchema = {
  name: 'getHomeFeed',
  description:
    'Get posts from the LinkedIn home feed (personalized content from connections, followed companies, and recommendations)',
  notes:
    AMD_PAGE_NOTE + ' Sponsored posts are excluded from results.',
  input: z.object({
    csrf: CsrfParam,
    count: z
      .number()
      .optional()
      .default(20)
      .describe(
        'Number of posts to fetch (default 20). Auto-paginates internally.',
      ),
    start: z.number().optional().default(0).describe('Pagination offset'),
  }),
  output: z.object({
    posts: z.array(PostSchema),
    hasMore: z.boolean().optional(),
  }),
};

const ReactionType = z
  .enum([
    'LIKE',
    'PRAISE',
    'EMPATHY',
    'INTEREST',
    'APPRECIATION',
    'ENTERTAINMENT',
  ])
  .describe(
    'Reaction type (LIKE = thumbs up, PRAISE = clap, EMPATHY = heart, INTEREST = curious, APPRECIATION = insightful, ENTERTAINMENT = funny)',
  );

export const likePostSchema = {
  name: 'likePost',
  description: 'React to a post (like, celebrate, love, etc.)',
  notes:
    'Defaults to personal profile. Only pass companyId if the user explicitly asks to react as their company page. ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    postUrn: z.string().describe('Post URN from getPosts or getCompanyPosts'),
    reactionType: ReactionType.optional().default('LIKE'),
    companyId: z
      .string()
      .optional()
      .describe(
        'Company ID to react as (from getAvailableActors). Omit for personal.',
      ),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const unlikePostSchema = {
  name: 'unlikePost',
  description: 'Remove your reaction from a post',
  notes:
    'Pass companyId only if the like was made as a company page. ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    postUrn: z.string().describe('Post URN'),
    companyId: z
      .string()
      .optional()
      .describe(
        'Company ID if the like was made as a company. Omit for personal.',
      ),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const createCommentSchema = {
  name: 'createComment',
  description: 'Add a comment to a post, or reply to an existing comment',
  notes:
    'Defaults to personal profile. Only pass companyId if the user explicitly asks to comment as their company page. To reply to a comment, pass parentCommentUrn.',
  input: z.object({
    csrf: CsrfParam,
    postUrn: z.string().describe('Post URN to comment on'),
    text: z.string().describe('Comment text'),
    parentCommentUrn: z
      .string()
      .optional()
      .describe(
        'Comment URN to reply to. If provided, creates a nested reply instead of a top-level comment.',
      ),
    companyId: z
      .string()
      .optional()
      .describe(
        'Company ID to comment as (from getAvailableActors). Omit for personal.',
      ),
  }),
  output: z.object({
    success: z.boolean(),
    commentUrn: z.string().optional().describe('URN of created comment'),
  }),
};

export const deleteCommentSchema = {
  name: 'deleteComment',
  description: 'Delete a comment you posted',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    commentUrn: z.string().describe('Comment URN to delete'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const getPostsSchema = {
  name: 'getPosts',
  description:
    "Get a person's recent LinkedIn posts and reposts. Returns post text, relative timestamps, reaction/comment counts, and author info.",
  notes:
    AMD_PAGE_NOTE +
    " You do not need to be on the target person's profile page; pass their memberId or vanity name and the function resolves it. LinkedIn's profile posts API uses token-based pagination internally. The start parameter offsets within the fetched batch but cannot retrieve items beyond the initial server response. Request a larger count to get more posts in a single call.",
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        'Member ID (ACo...) from searchPeople results. Also accepts vanity name.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of posts to fetch'),
    start: z.number().optional().default(0).describe('Pagination offset'),
  }),
  output: z.object({
    posts: z.array(PostSchema),
    hasMore: z
      .boolean()
      .optional()
      .describe('True if more posts can be fetched with a higher start offset'),
    profileInfo: z
      .object({
        memberId: z.string().optional(),
        fullName: z.string().optional(),
      })
      .optional(),
  }),
};

export const getProfileCommentsSchema = {
  name: 'getProfileComments',
  description:
    'Get all comments made by a person on LinkedIn posts. Returns comment text, timestamp, commenter info, and the post being commented on.',
  notes:
    "LinkedIn's profile comments API uses token-based pagination internally. The start parameter offsets within the fetched batch but cannot retrieve items beyond the initial server response. Request a larger count to get more comments in a single call." +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        'Member ID (ACo...) from searchPeople results. Also accepts vanity name.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of comments to fetch'),
    start: z.number().optional().default(0).describe('Pagination offset'),
  }),
  output: z.object({
    comments: z.array(
      z.object({
        commentText: z.string().optional().describe('Comment text'),
        commentedAt: z.number().optional().describe('Comment timestamp'),
        commenterName: z.string().optional(),
        commenterHeadline: z.string().optional(),
        commenterMemberId: z.string().optional(),
        commenterVanityName: z.string().optional(),
        commenterProfileUrl: z
          .string()
          .optional()
          .describe(
            'LinkedIn profile URL for the commenter. Uses vanity name when available, otherwise memberId.',
          ),
        postText: z
          .string()
          .optional()
          .describe('Text of post being commented on'),
        postAuthorName: z.string().optional().describe('Original post author'),
        postAuthorMemberId: z
          .string()
          .optional()
          .describe(
            'Post author member ID. Usually ACo format, but may be numeric when ACo format is unavailable. Numeric IDs cannot be used with other functions that expect memberId.',
          ),
        postAuthorVanityName: z.string().optional(),
        postAuthorProfileUrl: z
          .string()
          .optional()
          .describe(
            'LinkedIn profile URL for the post author. Uses vanity name when available, otherwise memberId.',
          ),
        postActivityUrn: z
          .string()
          .optional()
          .describe('Post URN for further operations'),
      }),
    ),
    total: z
      .number()
      .optional()
      .describe('Total available. May not be populated by all endpoints.'),
    hasMore: z.boolean().optional(),
  }),
};

export const getProfileReactionsSchema = {
  name: 'getProfileReactions',
  description:
    'Get all posts a person has reacted to (liked, celebrated, etc.). Returns the posts they reacted to with full post details.',
  notes:
    "userReactionType (LIKE, PRAISE, EMPATHY, etc.) is only available when viewing your own profile reactions. For other profiles, the API does not expose which specific reaction type they gave. LinkedIn's profile reactions API uses token-based pagination internally. The start parameter offsets within the fetched batch but cannot retrieve items beyond the initial server response." +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe(
        'Member ID (ACo...) from searchPeople results. Also accepts vanity name.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of reacted posts to fetch'),
    start: z.number().optional().default(0).describe('Pagination offset'),
  }),
  output: z.object({
    posts: z.array(PostSchema).describe('Posts the user reacted to'),
    total: z
      .number()
      .optional()
      .describe('Total available. May not be populated by all endpoints.'),
    hasMore: z.boolean().optional(),
  }),
};

export const getPostReactionsSchema = {
  name: 'getPostReactions',
  description:
    'Get all people who reacted to a post (likes, celebrates, etc.) with their profile info',
  notes:
    'Prefer ugcPostUrn when available. activityUrn works for personal posts but may return empty results for company posts. For reposts, use originalPostUrn instead of the repost URN. Throws an error for invalid URN formats.' +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    postUrn: z
      .string()
      .describe(
        'Post URN (urn:li:activity:NNNN or urn:li:ugcPost:NNNN). Invalid formats throw an error.',
      ),
    reactionType: z
      .enum([
        'LIKE',
        'PRAISE',
        'EMPATHY',
        'INTEREST',
        'APPRECIATION',
        'ENTERTAINMENT',
      ])
      .optional()
      .describe('Filter by reaction type (omit for all)'),
    count: z.number().optional().default(10).describe('Number of reactors'),
    start: z.number().optional().default(0).describe('Pagination offset'),
  }),
  output: z.object({
    reactions: z.array(ReactorSchema),
    total: z.number().optional(),
    hasMore: z.boolean().optional(),
  }),
};

export const getCommentReactionsSchema = {
  name: 'getCommentReactions',
  description:
    'Get all people who reacted to a specific comment (likes, celebrates, etc.) with their profile info',
  notes:
    'Pass the commentUrn from getPostComments results. Self-reactions may not appear in results. ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    commentUrn: z
      .string()
      .describe(
        'Comment URN from getPostComments (urn:li:fsd_comment:(...) format)',
      ),
    reactionType: z
      .enum([
        'LIKE',
        'PRAISE',
        'EMPATHY',
        'INTEREST',
        'APPRECIATION',
        'ENTERTAINMENT',
      ])
      .optional()
      .describe('Filter by reaction type (omit for all)'),
    count: z.number().optional().default(10).describe('Number of reactors'),
    start: z.number().optional().default(0).describe('Pagination offset'),
  }),
  output: z.object({
    reactions: z.array(ReactorSchema),
    total: z.number().optional(),
    hasMore: z.boolean().optional(),
  }),
};

export const getPostCommentsSchema = {
  name: 'getPostComments',
  description:
    'Get all comments on a post with commenter info and nested replies',
  notes:
    'Prefer ugcPostUrn when available; total and hasMore are only accurate with ugcPostUrn. activityUrn works for personal posts but total may report 0 even when comments exist. For reposts, use originalPostUrn instead of the repost URN. Throws an error for invalid URN formats.' +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    postUrn: z
      .string()
      .describe(
        'Post URN (urn:li:activity:NNNN or urn:li:ugcPost:NNNN). Invalid formats throw an error.',
      ),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of top-level comments'),
    start: z.number().optional().default(0).describe('Pagination offset'),
    sortOrder: z
      .enum(['RELEVANCE', 'RECENCY'])
      .optional()
      .default('RELEVANCE')
      .describe('Sort order'),
    includeReplies: z
      .boolean()
      .optional()
      .default(true)
      .describe('Include initial replies to each comment (up to 2)'),
  }),
  output: z.object({
    comments: z.array(CommentSchema),
    total: z.number().optional(),
    hasMore: z.boolean().optional(),
  }),
};

export const editCommentSchema = {
  name: 'editComment',
  description: 'Edit an existing comment you posted',
  notes: 'Can only edit your own comments.',
  input: z.object({
    csrf: CsrfParam,
    commentUrn: z.string().describe('Comment URN to edit'),
    newText: z.string().describe('New comment text'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const likeCommentSchema = {
  name: 'likeComment',
  description: 'Like a comment on a post',
  notes: 'Uses same reaction mechanism as likePost. ' + AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    commentUrn: z.string().describe('Comment URN to like'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const unlikeCommentSchema = {
  name: 'unlikeComment',
  description: 'Remove your like from a comment',
  notes: AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    commentUrn: z.string().describe('Comment URN to unlike'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

// ============================================================================
// Messaging Operations
// ============================================================================

export const ConversationSchema = z.object({
  conversationUrn: z.string(),
  title: z
    .string()
    .optional()
    .describe(
      'Group chat name. Only present for group conversations that have been given a custom name. Null/absent for 1:1 conversations and unnamed group chats.',
    ),
  groupChat: z
    .boolean()
    .describe(
      'True if this is a group conversation, false for 1:1 direct messages.',
    ),
  participants: z
    .array(
      z.object({
        name: z.string().optional(),
        headline: z.string().optional(),
        profileUrl: z.string().optional(),
        memberId: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      'Other participants (excludes the current user). May be empty for conversations with deactivated or restricted accounts.',
    ),
  unreadCount: z.number().optional(),
  lastMessage: z
    .string()
    .optional()
    .describe('Text of the most recent message in the conversation.'),
  lastMessageSender: z
    .string()
    .optional()
    .describe(
      'Name of the person who sent the last message. May be absent if the sender profile is unavailable (e.g., deactivated account or system message).',
    ),
  lastActivityAt: z
    .string()
    .optional()
    .describe(
      'ISO 8601 timestamp of the last activity (e.g. "2026-03-10T14:30:00.000Z").',
    ),
});

export const AttachmentSchema = z.object({
  type: z
    .enum(['file', 'image'])
    .describe(
      '"file" for documents (PDF, DOC, etc.), "image" for photos (JPG, PNG, etc.)',
    ),
  name: z.string().describe('Original filename (e.g. "report.pdf")'),
  mediaType: z
    .string()
    .describe('MIME type (e.g. "application/pdf", "image/jpeg")'),
  byteSize: z.number().optional().describe('File size in bytes'),
  url: z
    .string()
    .describe(
      'Pre-authenticated download URL. Fetch directly; no extra auth headers needed. Time-limited.',
    ),
  assetUrn: z.string().optional().describe('LinkedIn digital media asset URN'),
});

export const MessageSchema = z.object({
  messageUrn: z
    .string()
    .optional()
    .describe(
      'Message URN (e.g. "urn:li:msg_message:(urn:li:fsd_profile:MEMBER_ID,MESSAGE_ID)")',
    ),
  text: z.string().optional().describe('Message body text'),
  sentAt: z
    .string()
    .optional()
    .describe('ISO 8601 delivery timestamp (e.g. "2026-03-10T14:30:00.000Z")'),
  fromMemberId: z
    .string()
    .optional()
    .describe('Sender member ID (ACo... format)'),
  fromName: z
    .string()
    .optional()
    .describe('Sender full name (e.g. "John Smith")'),
  attachments: z
    .array(AttachmentSchema)
    .optional()
    .describe(
      'File and image attachments on this message. Only present when the message has attachments.',
    ),
});

export const listConversationsSchema = {
  name: 'listConversations',
  description:
    'List recent inbox conversations sorted by last activity (newest first). Auto-paginates internally for counts above 25. Auto-fetches CSRF token and member ID if not provided.',
  notes:
    'Requires the browser to be on a LinkedIn /messaging/ page (e.g. linkedin.com/messaging/) before calling; the messaging JS bundles must be loaded for queryId extraction. Navigate there first if not already on a messaging page. If csrf and memberId are omitted, the function calls getContext() internally; no need to call getContext() first. Auto-paginates using cursor-based pagination (25 per page) with jitter delays between pages to avoid throttling. The pagesLoaded field indicates how many API requests were made.',
  input: z.object({
    csrf: CsrfParam.optional().describe(
      'CSRF token. Optional; auto-fetched via getContext() if omitted.',
    ),
    memberId: z
      .string()
      .optional()
      .describe(
        'Your member ID. Optional; auto-fetched via getContext() if omitted.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe(
        'Max conversations to return (default 20, min 1). Auto-paginates for counts above 25.',
      ),
  }),
  output: z.object({
    conversations: z.array(ConversationSchema),
    pagesLoaded: z.number().optional(),
  }),
};

export const viewConversationSchema = {
  name: 'viewConversation',
  description: 'Get messages in a conversation',
  notes:
    'Requires the browser to be on a LinkedIn /messaging/ page (e.g. linkedin.com/messaging/) before calling; the messaging JS bundles must be loaded for queryId extraction. Navigate there first if not already on a messaging page. ' +
    'Pass the conversationUrn exactly as returned by listConversations() or getConversationWithUser(). ' +
    'Returns up to 40 most recent messages sorted oldest-first. ' +
    'Returns an empty messages array if the conversation has no messages OR if the conversationUrn does not match a real conversation ' +
    '(LinkedIn returns 200 with empty array in both cases; there is no way to distinguish between them). ' +
    'Throws an error if conversationUrn is missing, not a string, or empty.',
  input: z.object({
    csrf: CsrfParam,
    conversationUrn: z
      .string()
      .describe(
        'Full conversation URN from listConversations().conversationUrn or getConversationWithUser().conversationUrn. ' +
          'Format: "urn:li:msg_conversation:(urn:li:fsd_profile:MEMBER_ID,THREAD_ID)" ' +
          'where THREAD_ID is a base64-encoded string (e.g. "2-YWY4YzI2MzMt..."). ' +
          'Do not construct manually; always use the URN returned by listConversations or getConversationWithUser.',
      ),
  }),
  output: z.object({
    messages: z.array(MessageSchema),
  }),
};

export const getConversationWithUserSchema = {
  name: 'getConversationWithUser',
  description: 'Find and load entire conversation with a specific user by name',
  notes:
    'Requires the browser to be on a LinkedIn /messaging/ page (e.g. linkedin.com/messaging/) before calling; the messaging JS bundles must be loaded for queryId extraction. Navigate there first if not already on a messaging page. Auto-fetches CSRF token and member ID via getContext(). Searches recent conversations using auto-pagination. Uses case-insensitive partial match on participant full name (first + last). Returns the first matching conversation found. If multiple people match (e.g., searching "John"), it returns the most recent conversation. Use a more specific name to narrow results.',
  input: z.object({
    participantName: z
      .string()
      .describe(
        'Name of the person to find. Case-insensitive partial match on full name (e.g., "john" matches "John Smith").',
      ),
    maxConversationsToSearch: z
      .number()
      .optional()
      .default(50)
      .describe(
        'Max conversations to search through (default: 50). Higher values search deeper but take longer due to pagination.',
      ),
  }),
  output: z.object({
    found: z.boolean().describe('Whether a matching conversation was found'),
    conversationUrn: z
      .string()
      .optional()
      .describe(
        'URN of the found conversation. Only present when found is true.',
      ),
    participantName: z
      .string()
      .optional()
      .describe(
        'Matched participant full name. Only present when found is true.',
      ),
    messages: z
      .array(MessageSchema)
      .describe(
        'All messages in the conversation. Empty array when found is false.',
      ),
    otherMatches: z
      .array(
        z.object({
          conversationUrn: z.string(),
          participantName: z.string(),
          lastMessage: z.string().optional(),
          lastActivityAt: z.string().optional(),
        }),
      )
      .optional()
      .describe(
        'Other conversations that also matched the name query. Only present when there are additional matches beyond the primary result.',
      ),
    error: z
      .string()
      .optional()
      .describe(
        'Error message explaining why no conversation was found. Only present when found is false.',
      ),
  }),
};

export const sendMessageSchema = {
  name: 'sendMessage',
  description: 'Send a message to a 1st-degree connection',
  notes:
    'Recipient must be a 1st-degree connection; messaging non-connections returns 422. Check connectionDegree from searchPeople before calling. Supports file attachments via the files array; each file is uploaded to LinkedIn before sending. Text can be empty when sending only attachments. Throws on missing/invalid required params (csrf, myMemberId, recipient). Returns { success: false, error } for recoverable failures (vanity name resolution, API errors). Auto-discovers existing conversations with the recipient; no need to provide conversationUrn unless replying to a specific thread. **CRM**: After a message is sent, the recipient is automatically added to the CRM as a contact AND auto-enriched with their full LinkedIn profile (name, headline, company, location, etc.) — you do not need to create or look up the contact, the conversation, or the message; all of that is recorded for you. Higher-level CRM fields (status, notes, deal/stage info) are still left blank and must be updated manually. **Rate limit**: ~100 new outreach messages/week (free), ~150/week (premium). Replies to existing threads are less restricted. **Output format**: If presenting a draft to the user before sending, you MUST use the "message-draft" skill (useSkill("message-draft")) to render it as an editable UI card for approval. Use the "sales-copy" skill for composing effective messages.',
  input: z.object({
    csrf: CsrfParam,
    myMemberId: z
      .string()
      .describe('Your member ID from getContext() (starts with "ACo")'),
    recipient: z
      .string()
      .describe(
        'Recipient identifier. Accepts: (1) member ID from searchPeople (e.g. "ACoAAEtPJo0B..."), (2) vanity name / URL slug (e.g. "john-smith"), or (3) profile URN (e.g. "urn:li:fsd_profile:ACoAAEtPJo0B..."). Always prefer memberId from searchPeople; vanity names are unpredictable and may fail to resolve.',
      ),
    text: z
      .string()
      .describe(
        'Message text (sent verbatim; do not backslash-escape punctuation). Can be empty string if sending only attachments.',
      ),
    files: z
      .array(
        z.object({
          filename: z
            .string()
            .describe(
              'Filename with extension (e.g. "photo.jpg", "report.pdf")',
            ),
          mimeType: z
            .string()
            .describe('MIME type (e.g. "image/jpeg", "application/pdf")'),
          data: z
            .string()
            .describe(
              'Base64-encoded file contents. The function decodes this to binary for upload.',
            ),
        }),
      )
      .optional()
      .describe(
        'Files to attach to the message. Each file is uploaded to LinkedIn before sending. ' +
          'Supports images (JPEG, PNG, GIF) and documents (PDF, DOC, DOCX, ZIP, etc.). ' +
          'Multiple files can be sent in one message.',
      ),
    conversationUrn: z
      .string()
      .optional()
      .describe(
        'Existing conversation URN to reply in (e.g. "urn:li:msg_conversation:(urn:li:fsd_profile:ACo...,THREAD_ID)"). Omit to auto-discover or start a new conversation. Obtain from listConversations or getConversationWithUser.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe(
        'true if message was sent. When false, check the error field for details.',
      ),
    messageUrn: z
      .string()
      .optional()
      .describe('URN of the sent message (present when success is true)'),
    conversationUrn: z
      .string()
      .optional()
      .describe(
        'Conversation URN the message was sent in (present when success is true)',
      ),
    deliveredAt: z
      .string()
      .optional()
      .describe('ISO 8601 delivery timestamp (present when success is true)'),
    isNewConversation: z
      .boolean()
      .optional()
      .describe(
        'true if a new conversation was created, false if sent in an existing one (present when success is true)',
      ),
    recipientMemberId: z
      .string()
      .optional()
      .describe(
        'Resolved LinkedIn member ID of the recipient (ACo… format). Present when success is true. Used for CRM identity resolution.',
      ),
    error: z
      .string()
      .optional()
      .describe(
        'Error message when success is false. Common errors: "Cannot message this person. They must be a 1st-degree connection." (422), vanity name resolution failure.',
      ),
  }),
};

export const createGroupChatSchema = {
  name: 'createGroupChat',
  description:
    'Create a group chat conversation with multiple participants and send an initial message',
  notes:
    'All recipients must be 1st-degree connections; messaging non-connections returns 422. The conversationTitle is the group chat name visible to all participants. Requires at least 2 recipients (otherwise use sendMessage for 1:1). The created group chat appears in listConversations with groupChat: true.',
  input: z.object({
    csrf: CsrfParam,
    myMemberId: z
      .string()
      .describe('Your member ID from getContext() (starts with "ACo")'),
    recipients: z
      .array(z.string())
      .min(2)
      .describe(
        'Array of recipient member IDs (at least 2). Each must start with "ACo"; obtain from searchPeople results.',
      ),
    conversationTitle: z
      .string()
      .describe('Group chat name visible to all participants'),
    text: z
      .string()
      .describe('Initial message text sent when creating the group chat'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('true if group chat was created and initial message sent'),
    conversationUrn: z
      .string()
      .optional()
      .describe(
        'Conversation URN of the new group chat (present when success is true). Use for subsequent sendMessage calls.',
      ),
    messageUrn: z
      .string()
      .optional()
      .describe('URN of the initial message (present when success is true)'),
    deliveredAt: z
      .string()
      .optional()
      .describe('ISO 8601 delivery timestamp (present when success is true)'),
    error: z
      .string()
      .optional()
      .describe(
        'Error message when success is false. Common: "Cannot message this person. They must be a 1st-degree connection." (422).',
      ),
  }),
};

export const renameGroupChatSchema = {
  name: 'renameGroupChat',
  description: 'Rename an existing group chat conversation',
  notes:
    'Only works on group chat conversations (created with createGroupChat or via LinkedIn UI with 3+ participants). The conversationUrn must be from a group chat; renaming a 1:1 conversation will fail.',
  input: z.object({
    csrf: CsrfParam,
    conversationUrn: z
      .string()
      .describe(
        'Conversation URN of the group chat to rename. Format: "urn:li:msg_conversation:(urn:li:fsd_profile:ACo...,THREAD_ID)". Obtain from createGroupChat or listConversations.',
      ),
    title: z.string().describe('New name for the group chat'),
  }),
  output: z.object({
    success: z.boolean().describe('true if the group chat was renamed'),
    error: z
      .string()
      .optional()
      .describe('Error message when success is false'),
  }),
};

export const getComposeOptionsSchema = {
  name: 'getComposeOptions',
  description:
    'Check if you can message a user and whether a conversation already exists',
  notes:
    'Throws if csrf or recipientMemberId is missing/empty. Throws on invalid/expired CSRF token (LinkedIn returns 403 "CSRF check failed"); call getContext() to get a fresh token. Returns canMessage: false (without throwing) when the profile is inaccessible or not a 1st-degree connection. When an existing conversation exists, returns its URN in fsd_conversation format. The recipientMemberId must be a valid LinkedIn member ID starting with "ACo"; use searchPeople to obtain one. The csrf token is obtained from getContext() and has the format "ajax:DIGITS".',
  input: z.object({
    csrf: CsrfParam,
    recipientMemberId: z
      .string()
      .describe(
        'Member ID of the recipient (starts with "ACo", e.g. "ACoAAEtPJo0B..."). Obtain from searchPeople results.',
      ),
  }),
  output: z.object({
    canMessage: z
      .boolean()
      .describe(
        'Whether you can send a message to this person. False when the profile is inaccessible or not a 1st-degree connection (LinkedIn returns 403).',
      ),
    composeOptionType: z
      .string()
      .optional()
      .describe(
        'Type of compose action available. Known values: "REPLY" (existing conversation with 1st-degree connection), "PREMIUM_INMAIL" (requires InMail credits). Only present when canMessage is true.',
      ),
    paidInMail: z
      .boolean()
      .optional()
      .describe(
        'Whether sending a message requires InMail credits. false for 1st-degree connections, true for non-connections. Only present when canMessage is true.',
      ),
    existingConversationUrn: z
      .string()
      .optional()
      .describe(
        'URN of existing conversation (urn:li:fsd_conversation:...). Only present when you have a prior conversation with this person.',
      ),
  }),
};

export const editMessageSchema = {
  name: 'editMessage',
  description: 'Edit the text of a message you sent',
  notes:
    'Can only edit your own messages. Pass the messageUrn from viewConversation() or sendMessage() results. The message text is replaced entirely; there is no partial update.',
  input: z.object({
    csrf: CsrfParam,
    messageUrn: z
      .string()
      .describe(
        'Message URN to edit (e.g. "urn:li:msg_message:(urn:li:fsd_profile:MEMBER_ID,MESSAGE_ID)"). Obtain from viewConversation() or sendMessage() results.',
      ),
    newText: z.string().describe('New message text (replaces existing text)'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the message was successfully edited'),
  }),
};

export const deleteMessageSchema = {
  name: 'deleteMessage',
  description: 'Recall (unsend) a message you sent',
  notes:
    "Can only recall your own messages. Uses LinkedIn's recall action; the message URN remains in the conversation but the body is cleared to empty text. Pass the messageUrn from viewConversation() or sendMessage() results.",
  input: z.object({
    csrf: CsrfParam,
    messageUrn: z
      .string()
      .describe(
        'Message URN to delete (e.g. "urn:li:msg_message:(urn:li:fsd_profile:MEMBER_ID,MESSAGE_ID)"). Obtain from viewConversation() or sendMessage() results.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the message was successfully deleted'),
  }),
};

export const reactToMessageSchema = {
  name: 'reactToMessage',
  description: 'Add an emoji reaction to a message in a LinkedIn conversation',
  notes:
    'Pass the messageUrn from viewConversation() results. Any emoji is supported; common reactions are 👍, 👏, 😊, ❤️, 🔥, 😂.',
  input: z.object({
    csrf: CsrfParam,
    messageUrn: z
      .string()
      .describe(
        'Message URN to react to (e.g. "urn:li:msg_message:(urn:li:fsd_profile:MEMBER_ID,MESSAGE_ID)"). Obtain from viewConversation() results.',
      ),
    emoji: z
      .string()
      .describe(
        'Emoji to react with (e.g. "👍", "👏", "😊", "❤️", "🔥", "😂")',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the reaction was successfully added'),
  }),
};

export const unreactToMessageSchema = {
  name: 'unreactToMessage',
  description:
    'Remove an emoji reaction from a message in a LinkedIn conversation',
  notes:
    'Pass the messageUrn from viewConversation() results and the exact emoji that was previously reacted with.',
  input: z.object({
    csrf: CsrfParam,
    messageUrn: z
      .string()
      .describe(
        'Message URN to remove reaction from (e.g. "urn:li:msg_message:(urn:li:fsd_profile:MEMBER_ID,MESSAGE_ID)"). Obtain from viewConversation() results.',
      ),
    emoji: z
      .string()
      .describe(
        'Emoji reaction to remove (e.g. "👍", "👏", "😊", "❤️", "🔥", "😂"). Must match the emoji that was previously reacted with.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the reaction was successfully removed'),
  }),
};

export const markAllConversationsAsReadSchema = {
  name: 'markAllConversationsAsRead',
  description:
    'Mark all conversations as read, clearing the unread messaging badge and all per-conversation unread counts',
  notes:
    'Call getContext() first to obtain the CSRF token. Pass Date.now() as `until` to mark all messages up to now as read. This clears both the messaging badge icon AND resets unreadCount to 0 on all conversations. To mark only a specific conversation as read, use markConversationAsRead instead.',
  input: z.object({
    csrf: CsrfParam,
    until: z
      .number()
      .describe(
        'Positive epoch timestamp in milliseconds (e.g., Date.now()). All messages received before this timestamp are marked as read. Must be > 0.',
      ),
  }),
  output: z.void(),
};

export const markConversationAsReadSchema = {
  name: 'markConversationAsRead',
  description:
    'Mark a specific conversation as read by acknowledging its latest message',
  notes:
    'Call getContext() first. Requires the conversationUrn from listConversations() or getConversationWithUser(). Internally fetches the latest message in the conversation and sends a delivery acknowledgement. To mark ALL conversations as read at once, use markAllConversationsAsRead instead.',
  input: z.object({
    csrf: CsrfParam,
    conversationUrn: z
      .string()
      .describe(
        'Conversation URN to mark as read (e.g. "urn:li:msg_conversation:(urn:li:fsd_profile:MEMBER_ID,THREAD_ID)"). Obtain from listConversations() or getConversationWithUser().',
      ),
  }),
  output: z.void(),
};

// ============================================================================
// Notifications Operations
// ============================================================================

export const listNotificationsSchema = {
  name: 'listNotifications',
  description:
    'Get LinkedIn notifications (recent activity, mentions, connection updates). Each notification includes a read field indicating whether the user has clicked on it.',
  notes:
    'The read field tracks whether the user clicked on a specific notification, not whether they saw it in the list. The badge count (unseen) resets when the user visits /notifications/.',
  input: z.object({
    csrf: CsrfParam,
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of notifications'),
    filter: z
      .enum(['ALL', 'JOBS', 'MY_POSTS', 'MENTIONS'])
      .optional()
      .default('ALL')
      .describe('Notification category filter'),
  }),
  output: z.object({
    notifications: z.array(
      z.object({
        entityUrn: z.string().optional(),
        headline: z.string().optional().describe('Notification headline text'),
        read: z
          .boolean()
          .optional()
          .describe(
            'Whether this notification has been individually clicked/read by the user',
          ),
        publishedAt: z
          .number()
          .optional()
          .describe('Notification timestamp in epoch ms'),
        actionTarget: z
          .string()
          .optional()
          .describe('URL or URN that clicking the notification navigates to'),
        notificationType: z
          .string()
          .optional()
          .describe(
            'Notification category. Common values: SHARED_BY_YOUR_NETWORK, REACTIONS_BY_YOUR_NETWORK, NEW_JOBS_IN_SAVED_SEARCH, WVMP_V2 (profile views), SEARCH_APPEARANCE, BIRTHDAY_PROP, SERIES_FOLLOW, COMMENTS_BY_YOUR_NETWORK, PREMIUM_RECOMMENDED_ACTION',
          ),
      }),
    ),
    paging: z.object({
      start: z.number(),
      count: z.number(),
      total: z.number().optional(),
    }),
  }),
};

export const getNotificationCountsSchema = {
  name: 'getNotificationCounts',
  description:
    'Get unseen notification badge counts for each LinkedIn section (notifications, messaging, network, nurture)',
  notes:
    'Returns the badge counts shown in the LinkedIn navigation bar. These are "unseen" counts; they reset when the user visits the respective page.',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    counts: z.object({
      notifications: z
        .number()
        .describe('Unseen notification count (bell icon badge)'),
      messaging: z
        .number()
        .describe('Unseen message count (messaging icon badge)'),
      myNetwork: z
        .number()
        .describe('Unseen network activity count (my network badge)'),
      nurture: z.number().describe('Unseen nurture/catch-up suggestions count'),
    }),
  }),
};

// ============================================================================
// Post Creation Operations
// ============================================================================

export const createPostSchema = {
  name: 'createPost',
  description: 'Create a new LinkedIn post, optionally with an image',
  notes:
    'Always confirm with the user before executing this action. To attach an image, provide imageBase64 (base64-encoded image data). To get image data from the user\'s device, use the files library: `const buf = await load({ fileRef: "/absolute/path" })` from `@vallum/files`, then convert to base64 in chunks (spread on large arrays overflows the stack): `const bytes = new Uint8Array(buf); let bin = ""; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.slice(i, i + 8192)); const imageBase64 = btoa(bin);`. Do NOT use bash, require("fs"), fetch("file://"), or other workarounds; only the files library can bridge local files into the browser context.' +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    text: z.string().describe('Post text content'),
    visibility: z
      .enum(['ANYONE', 'CONNECTIONS_ONLY'])
      .optional()
      .default('ANYONE')
      .describe('Post visibility setting'),
    allowedCommenters: z
      .enum(['ALL', 'CONNECTIONS_ONLY', 'NONE'])
      .optional()
      .default('ALL')
      .describe('Who can comment on this post'),
    imageBase64: z
      .string()
      .optional()
      .describe('Base64-encoded image data to attach to the post'),
    imageMimeType: z
      .string()
      .optional()
      .describe(
        'MIME type of the image (e.g. image/jpeg, image/png). Defaults to image/jpeg.',
      ),
  }),
  output: z.object({
    shareUrn: z.string().describe('Share URN (urn:li:share:XXX)'),
    activityUrn: z.string().describe('Activity URN for post interactions'),
    postUrl: z.string().describe('Direct URL to the created post'),
  }),
};

export const deletePostSchema = {
  name: 'deletePost',
  description: 'Delete a post you created',
  notes:
    'Always confirm with the user before executing this action. Accepts activityUrn, shareUrn, or ugcPostUrn; auto-resolves internally. Works on posts you authored and reposts with commentary. Does NOT work on instant reposts (no commentary); use undoRepost for those. Can be slow (30s+). If it errors with "Could not resolve shareUrn", the post may already be deleted; verify with getPosts.',
  input: z.object({
    csrf: CsrfParam,
    postUrn: z
      .string()
      .describe(
        'Post URN to delete (activityUrn, shareUrn, or ugcPostUrn all accepted)',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the post was successfully deleted'),
  }),
};

export const editPostSchema = {
  name: 'editPost',
  description:
    'Edit the text of an existing post or repost-with-commentary you authored',
  notes:
    'Always confirm with the user before executing this action. Can only edit your own posts. Works on both normal posts and reposts with commentary. Does NOT work on instant reposts (no commentary). Requires activityUrn; get it from getPosts or createPost.' +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    activityUrn: z
      .string()
      .describe(
        'Activity URN of the post to edit (urn:li:activity:XXX). From getPosts or createPost.',
      ),
    newText: z.string().describe('New post text content'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the post was successfully edited'),
  }),
};

export const repostPostSchema = {
  name: 'repostPost',
  description:
    'Repost an existing post to your feed, with or without commentary',
  notes:
    'Always confirm with the user before executing this action. Fire-and-forget: returns immediately after sending the request. Wait ~10 seconds then call getPosts to verify the repost appeared and get its activityUrn. Without commentary: creates an instant repost (undo with undoRepost using the activityUrn from getPosts). With commentary: creates a new post referencing the original (delete with deletePost using the activityUrn from getPosts).' +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    activityUrn: z
      .string()
      .describe(
        'Activity URN of the post to repost (urn:li:activity:XXX). From getPosts or getCompanyPosts.',
      ),
    commentary: z
      .string()
      .optional()
      .describe(
        'Text commentary to add. If omitted, creates an instant repost (no commentary).',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the repost request was sent'),
  }),
};

export const undoRepostSchema = {
  name: 'undoRepost',
  description:
    'Remove an instant repost (reshare without commentary) from your feed',
  notes:
    'Always confirm with the user before executing this action. Only works on instant reposts (no commentary). To delete a repost with commentary, use deletePost instead. ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    activityUrn: z
      .string()
      .describe(
        'Activity URN of the original post that was reposted (urn:li:activity:XXX).',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the repost was removed'),
  }),
};

export const schedulePostSchema = {
  name: 'schedulePost',
  description: 'Create a LinkedIn post scheduled for future publication',
  notes:
    'Always confirm with the user before executing this action. scheduledAt must be a future timestamp in epoch milliseconds, at least 20 minutes from now. **Timezone-critical**: use `new Date(year, month-1, day, hour, min).getTime()` to build the timestamp; this uses the browser\'s local timezone (from getContext().timezone). NEVER use `Date.parse("...Z")` or `Date.UTC()`; the "Z" suffix means UTC and will shift the time by the timezone offset (e.g., 8 hours for Pacific). Use listScheduledPosts to view pending scheduled posts. Uses the GraphQL create endpoint. ' + AMD_PAGE_NOTE + ' To attach an image from the user\'s device, use the files library: `const buf = await load({ fileRef: "/absolute/path" })` from `@vallum/files`, then convert to base64 in chunks: `const bytes = new Uint8Array(buf); let bin = ""; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.slice(i, i + 8192)); const imageBase64 = btoa(bin);`.',
  input: z.object({
    csrf: CsrfParam,
    text: z.string().describe('Post text content'),
    scheduledAt: z
      .number()
      .describe(
        'Scheduled publication time in epoch milliseconds. MUST use local time: `new Date(2026, 1, 24, 9, 0).getTime()` for Feb 24 9:00 AM local. NEVER append "Z" to ISO strings; that means UTC and will be off by timezone offset.',
      ),
    visibility: z
      .enum(['ANYONE', 'CONNECTIONS_ONLY'])
      .optional()
      .default('ANYONE')
      .describe('Post visibility setting'),
    allowedCommenters: z
      .enum(['ALL', 'CONNECTIONS_ONLY', 'NONE'])
      .optional()
      .default('ALL')
      .describe('Who can comment on the post'),
    imageBase64: z
      .string()
      .optional()
      .describe('Base64-encoded image data to attach to the scheduled post'),
    imageMimeType: z
      .string()
      .optional()
      .describe(
        'MIME type of the image (e.g. image/jpeg, image/png). Defaults to image/jpeg.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the post was scheduled'),
    shareUrn: z
      .string()
      .optional()
      .describe('Share URN of the scheduled post (urn:li:ugcPost:XXX)'),
  }),
};

const ScheduledPostSchema = z.object({
  shareUrn: z
    .string()
    .optional()
    .describe('Share/ugcPost URN of the scheduled post'),
  scheduledAt: z
    .number()
    .optional()
    .describe('Scheduled time in epoch milliseconds'),
  scheduledAtLocal: z
    .string()
    .optional()
    .describe(
      'Human-readable scheduled time in the browser local timezone (e.g. "Mon, Feb 24 at 9:00 AM"). Use this when displaying the scheduled time to the user.',
    ),
  text: z.string().optional().describe('Post text content'),
  hasImage: z
    .boolean()
    .optional()
    .describe('Whether the post has an image attached'),
  hasVideo: z
    .boolean()
    .optional()
    .describe('Whether the post has a video attached'),
  errorMessage: z
    .string()
    .optional()
    .describe('Error message if scheduling failed'),
});

export const listScheduledPostsSchema = {
  name: 'listScheduledPosts',
  description: 'List all posts scheduled for future publication',
  notes:
    'Returns scheduled posts that have not yet been published. Uses the GraphQL SharePreviews endpoint. ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of scheduled posts to return'),
  }),
  output: z.object({
    scheduledPosts: z
      .array(ScheduledPostSchema)
      .describe('List of scheduled posts'),
    total: z.number().optional().describe('Total number of scheduled posts'),
  }),
};

export const editScheduledPostSchema = {
  name: 'editScheduledPost',
  description: 'Edit the text of a scheduled (not yet published) post',
  notes:
    'Only works on scheduled posts (not yet published). Pass the current scheduledAt value (from listScheduledPosts) to preserve the schedule. ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    shareUrn: z
      .string()
      .describe(
        'Share URN of the scheduled post (urn:li:share:XXX) from listScheduledPosts',
      ),
    newText: z.string().describe('New text content for the post'),
    scheduledAt: z
      .number()
      .describe(
        'Current scheduled time in epoch ms (from listScheduledPosts). Pass the exact value returned by listScheduledPosts to preserve the schedule.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the edit was successful'),
  }),
};

export const reschedulePostSchema = {
  name: 'reschedulePost',
  description: 'Change the scheduled publication time of a scheduled post',
  notes:
    'Always confirm with the user before executing this action. Only works on scheduled posts (not yet published). Does not change the post content. ' + AMD_PAGE_NOTE + ' **Timezone-critical**: use `new Date(year, month-1, day, hour, min).getTime()`; NEVER use "Z" suffix or Date.UTC().',
  input: z.object({
    csrf: CsrfParam,
    shareUrn: z
      .string()
      .describe(
        'Share URN of the scheduled post (urn:li:share:XXX) from listScheduledPosts',
      ),
    scheduledAt: z
      .number()
      .describe(
        'New scheduled publication time in epoch milliseconds. MUST use local time: `new Date(2026, 1, 24, 9, 0).getTime()` for Feb 24 9:00 AM local. NEVER append "Z" to ISO strings.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reschedule was successful'),
  }),
};

// ============================================================================
// Post Search Operations
// ============================================================================

export const searchPostsSchema = {
  name: 'searchPosts',
  description:
    'Search for LinkedIn posts by keyword with optional sort and date filters',
  notes: AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    keywords: z.string().describe('Search keywords'),
    sortBy: z
      .enum(['date_posted', 'relevance'])
      .optional()
      .describe(
        'Sort order. "date_posted" for newest first, "relevance" (default) for most relevant.',
      ),
    datePosted: z
      .enum(['past-24h', 'past-week', 'past-month'])
      .optional()
      .describe(
        'Filter by post date. "past-24h", "past-week", or "past-month".',
      ),
    contentType: z
      .enum(['videos', 'images', 'articles', 'documents', 'liveVideos'])
      .optional()
      .describe(
        'Filter by content type. "videos" for video posts, "images" for image posts, "articles" for long-form articles, "documents" for document/carousel posts, "liveVideos" for LinkedIn Live recordings.',
      ),
    postedBy: z
      .enum(['first', 'me', 'following'])
      .optional()
      .describe(
        'Filter by relationship to author. "first" = posts by 1st-degree connections, "me" = your own posts, "following" = posts by people/companies you follow.',
      ),
    authorCompany: z
      .string()
      .optional()
      .describe(
        "Filter posts by company ID of the author's organization. Use resolveCompanyId or searchCompanies to find numeric company IDs.",
      ),
    authorIndustry: z
      .string()
      .optional()
      .describe(
        "Filter posts by author's industry code (numeric string). Use resolveIndustry to find codes.",
      ),
    fromMember: z
      .string()
      .optional()
      .describe(
        'Filter posts by a specific member ID (ACo... format). Shows only posts authored by that person.',
      ),
    fromOrganization: z
      .string()
      .optional()
      .describe(
        'Filter posts by a specific organization/company ID (numeric string). Shows only posts by that company page.',
      ),
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of results to return'),
  }),
  output: z.object({
    results: z.array(
      z.object({
        activityUrn: z
          .string()
          .optional()
          .describe('Activity URN for the post'),
        authorName: z.string().optional().describe('Post author name'),
        text: z.string().optional().describe('Post text content'),
        publishedAt: z
          .number()
          .optional()
          .describe('Post timestamp in epoch ms'),
        reactionCount: z.number().optional(),
        commentCount: z.number().optional(),
      }),
    ),
    total: z.number().optional().describe('Total matching posts'),
  }),
};

// ============================================================================
// Analytics Operations
// ============================================================================

export const getProfileViewsSummarySchema = {
  name: 'getProfileViewsSummary',
  description:
    'Get summary statistics for profile views (total count, trend percentage, time period)',
  notes:
    'Returns aggregate view metrics over the last 90 days. Use listProfileViewers for the actual list of who viewed your profile.',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    totalViews: z
      .number()
      .optional()
      .describe('Total profile views in time period'),
    changePercentage: z
      .number()
      .optional()
      .describe('Percentage change vs previous period (negative = decrease)'),
    timeFrame: z
      .string()
      .optional()
      .describe('Time period (e.g., LAST_90_DAYS)'),
  }),
};

export const getSocialSellingIndexSchema = {
  name: 'getSocialSellingIndex',
  description:
    'Get your Social Selling Index (SSI) score: a 0-100 measure of how effectively you use LinkedIn for social selling, broken into 4 pillars (25 pts each)',
  notes:
    'Available on all tiers (free, premium, Sales Navigator). Score updates daily. Also returns your rank and average scores for your industry and network peers.',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    score: z.number().describe('Overall SSI score (0-100)'),
    pillars: z.object({
      professionalBrand: z
        .number()
        .describe('Establish your professional brand (0-25)'),
      findRightPeople: z.number().describe('Find the right people (0-25)'),
      engageWithInsights: z.number().describe('Engage with insights (0-25)'),
      buildRelationships: z.number().describe('Build relationships (0-25)'),
    }),
    industryComparison: z
      .object({
        rank: z
          .number()
          .optional()
          .describe('Your percentile rank in your industry (lower = better)'),
        averageScore: z
          .number()
          .optional()
          .describe('Average SSI score in your industry'),
        industry: z.string().optional().describe('Your industry name'),
        groupSize: z
          .number()
          .optional()
          .describe('Number of people in your industry group'),
      })
      .optional(),
    networkComparison: z
      .object({
        rank: z
          .number()
          .optional()
          .describe('Your percentile rank in your network (lower = better)'),
        averageScore: z
          .number()
          .optional()
          .describe('Average SSI score in your network'),
        groupSize: z
          .number()
          .optional()
          .describe('Number of people in your network group'),
      })
      .optional(),
  }),
};

export type GetSocialSellingIndexInput = z.infer<
  typeof getSocialSellingIndexSchema.input
>;
export type GetSocialSellingIndexOutput = z.infer<
  typeof getSocialSellingIndexSchema.output
>;

export const listProfileViewersSchema = {
  name: 'listProfileViewers',
  description:
    'List paginated profile viewers with enriched viewer data from Premium analytics',
  notes:
    'Requires LinkedIn Premium or Sales Navigator. Free accounts cannot see who viewed their profile. Returns paginated list of identified profile viewers. Use getProfileViewsSummary for aggregate stats (total views, trend).' +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    start: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (default: 0)'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of viewers to return per page (default: 10, max: 50)'),
  }),
  output: z.object({
    viewers: z
      .array(
        z.object({
          name: z.string().describe('Viewer full name'),
          headline: z.string().describe('Viewer headline/occupation'),
          viewedAgo: z
            .string()
            .describe('Relative time string (e.g., "13h ago", "2d ago")'),
          connectionDegree: z
            .string()
            .describe('Connection degree (e.g., "1st", "2nd", "3rd+")'),
          publicIdentifier: z
            .string()
            .optional()
            .describe('Viewer vanity name / URL slug (e.g., "john-smith")'),
          memberId: z
            .string()
            .optional()
            .describe('Viewer member ID (starts with "ACo")'),
          profileUrl: z
            .string()
            .optional()
            .describe('LinkedIn profile URL path (e.g., "/in/john-smith")'),
          blurred: z
            .boolean()
            .describe(
              'Whether viewer identity is obfuscated (true = non-Premium viewer or private mode)',
            ),
        }),
      )
      .describe('Array of profile viewers'),
    paging: z.object({
      start: z.number().describe('Current offset'),
      count: z.number().describe('Number of results in this page'),
    }),
  }),
};

export const getCreatorAnalyticsSummarySchema = {
  name: 'getCreatorAnalyticsSummary',
  description:
    'Get dashboard summary of all creator analytics: post impressions, followers, profile viewers, and search appearances with change percentages',
  notes:
    'Returns the same metrics shown on the LinkedIn /dashboard/ page. Available on all account tiers. ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    memberId: z.string().describe('Member ID from getContext().memberId'),
  }),
  output: z.object({
    metrics: z
      .array(
        z.object({
          type: z
            .string()
            .describe(
              'Metric type: POST_IMPRESSIONS, TOTAL_FOLLOWERS, PROFILE_VIEWS, or SEARCH_APPEARANCES',
            ),
          label: z.string().describe('Human-readable metric name'),
          value: z.string().describe('Formatted metric value (e.g. "4,403")'),
          changePercent: z
            .number()
            .optional()
            .describe(
              'Percentage change vs prior period (negative = decrease)',
            ),
          changePeriod: z
            .string()
            .optional()
            .describe('Period for comparison (e.g. "past 7 days")'),
        }),
      )
      .describe('Array of analytics metric summaries'),
  }),
};

export type GetCreatorAnalyticsSummaryOutput = z.infer<
  typeof getCreatorAnalyticsSummarySchema.output
>;

export const getContentAnalyticsSchema = {
  name: 'getContentAnalytics',
  description:
    'Get detailed content performance analytics: impressions/engagement time series, summary metrics, and top performing posts',
  notes:
    'Requires LinkedIn Premium or creator mode. Uses the same data as the LinkedIn Analytics > Posts tab. ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    memberId: z.string().describe('Member ID from getContext().memberId'),
    timeRange: z
      .enum([
        'past_7_days',
        'past_14_days',
        'past_28_days',
        'past_90_days',
        'past_365_days',
      ])
      .optional()
      .default('past_7_days')
      .describe('Time range for analytics (default: past_7_days)'),
    metricType: z
      .enum(['IMPRESSIONS', 'REACTIONS', 'COMMENTS', 'REPOSTS', 'ENGAGEMENTS'])
      .optional()
      .default('IMPRESSIONS')
      .describe('Which metric to show in time series (default: IMPRESSIONS)'),
  }),
  output: z.object({
    timeRange: z.string().describe('Selected time range'),
    metricType: z.string().describe('Selected metric type'),
    metricUnit: z
      .string()
      .describe('Unit label for the metric (e.g. "Impressions")'),
    summary: z
      .array(
        z.object({
          metric: z.string().describe('Metric name (e.g. "Impressions")'),
          value: z.string().describe('Formatted value (e.g. "4,403")'),
          changePercent: z.number().optional().describe('Change %'),
          changePeriod: z.string().optional().describe('Period description'),
        }),
      )
      .describe('Summary metric cards'),
    timeSeries: z
      .array(
        z.object({
          date: z.string().describe('Date label'),
          value: z.number().describe('Metric value for this date'),
        }),
      )
      .describe('Daily time series data points'),
    topPosts: z
      .array(
        z.object({
          activityId: z
            .string()
            .describe(
              'LinkedIn activity ID (use to construct post URL: linkedin.com/feed/update/urn:li:activity:{id})',
            ),
          reactions: z.number().describe('Total reactions on the post'),
          comments: z.number().describe('Total comments on the post'),
        }),
      )
      .describe('Top performing posts in the period'),
  }),
};

export type GetContentAnalyticsOutput = z.infer<
  typeof getContentAnalyticsSchema.output
>;

export const getAudienceDemographicsSchema = {
  name: 'getAudienceDemographics',
  description:
    'Get audience/follower demographics: follower count with trend, and top demographic breakdowns (location, job title, industry)',
  notes:
    'Requires LinkedIn Premium or creator mode. Uses the same data as the LinkedIn Analytics > Audience tab. ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    memberId: z.string().describe('Member ID from getContext().memberId'),
    timeRange: z
      .enum([
        'past_7_days',
        'past_14_days',
        'past_28_days',
        'past_90_days',
        'past_365_days',
      ])
      .optional()
      .default('past_7_days')
      .describe('Time range for analytics (default: past_7_days)'),
  }),
  output: z.object({
    timeRange: z.string().describe('Selected time range'),
    followerSummary: z
      .array(
        z.object({
          metric: z.string().describe('Metric name (e.g. "Total followers")'),
          value: z.string().describe('Formatted value (e.g. "2,157")'),
          changePercent: z.number().optional().describe('Change %'),
          changePeriod: z.string().optional().describe('Period description'),
        }),
      )
      .describe('Follower summary metrics'),
    demographics: z
      .array(
        z.object({
          category: z
            .string()
            .describe(
              'Demographic category (e.g. "From this location", "With this job title")',
            ),
          value: z
            .string()
            .describe('Top value in category (e.g. "San Francisco Bay Area")'),
          percentage: z
            .number()
            .describe('Percentage of audience in this segment'),
        }),
      )
      .describe('Top demographic breakdowns of your followers'),
  }),
};

export type GetAudienceDemographicsOutput = z.infer<
  typeof getAudienceDemographicsSchema.output
>;

export const getCompanyPageAnalyticsSchema = {
  name: 'getCompanyPageAnalytics',
  description:
    'Get company page analytics: visitors, unique visitors, page views, follower trends, or content engagement metrics. Requires admin access to the company page.',
  notes:
    'You must be an admin of the company page. Use companyId (numeric ID, not universal name). Get the companyId from getContext() or by searching for the company.' +
    ' ' +
    AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    companyId: z
      .string()
      .describe(
        'Numeric company ID (e.g. "108697332"). Found in company page URL or via search.',
      ),
    surfaceType: z
      .enum([
        'ORGANIZATION_VISITORS',
        'ORGANIZATION_FOLLOWERS',
        'ORGANIZATION_AGGREGATED_POSTS',
      ])
      .optional()
      .default('ORGANIZATION_VISITORS')
      .describe(
        'Analytics view: ORGANIZATION_VISITORS (page views, unique visitors), ORGANIZATION_FOLLOWERS (follower trends), ORGANIZATION_AGGREGATED_POSTS (content engagement)',
      ),
    startTime: z
      .number()
      .optional()
      .describe(
        'Start time as Unix timestamp in milliseconds (default: 30 days ago)',
      ),
    endTime: z
      .number()
      .optional()
      .describe('End time as Unix timestamp in milliseconds (default: now)'),
  }),
  output: z.object({
    surfaceType: z.string().describe('Selected analytics surface type'),
    title: z.string().describe('Analytics view title'),
    metrics: z
      .array(
        z.object({
          label: z
            .string()
            .describe('Metric name (e.g. "Page views", "Unique visitors")'),
          value: z.string().describe('Formatted metric value'),
          changePercent: z
            .number()
            .optional()
            .describe('Percentage change vs prior period'),
        }),
      )
      .describe('Summary metrics for the selected view'),
    timeSeries: z
      .array(
        z.object({
          date: z.string().describe('Date label'),
          value: z.number().describe('Metric value'),
        }),
      )
      .describe('Daily time series data (if available for this view)'),
  }),
};

export type GetCompanyPageAnalyticsOutput = z.infer<
  typeof getCompanyPageAnalyticsSchema.output
>;

export const listAdminCompaniesSchema = {
  name: 'listAdminCompanies',
  description:
    'List all company pages the current user has admin access to, with basic details',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    companies: z
      .array(
        z.object({
          companyId: z.string().describe('Numeric company ID'),
          name: z.string().describe('Company name'),
          universalName: z
            .string()
            .describe('URL slug (e.g. "north-light-ai")'),
          staffCount: z.number().optional().describe('Employee count'),
          followerCount: z.number().optional().describe('Follower count'),
          logoUrl: z.string().optional().describe('Company logo URL'),
          companyUrl: z.string().describe('LinkedIn company page URL'),
        }),
      )
      .describe('Company pages the user can administer'),
  }),
};

export type ListAdminCompaniesOutput = z.infer<
  typeof listAdminCompaniesSchema.output
>;

export const getAvailableActorsSchema = {
  name: 'getAvailableActors',
  description:
    'List identities the user can act as: personal profile plus any admin company pages',
  notes:
    'Only call when the user asks which identities they can use, or asks to act as a company but you need the companyId. Do NOT call proactively.',
  input: z.object({
    csrf: CsrfParam,
    memberId: z.string().describe('Member ID from getContext().memberId'),
    fullName: z
      .string()
      .optional()
      .describe('Full name from getContext().fullName'),
  }),
  output: z.object({
    actors: z
      .array(
        z.object({
          type: z.enum(['personal', 'company']).describe('Actor type'),
          id: z
            .string()
            .describe(
              'Actor ID: memberId for personal, companyId for company. Pass as companyId to likePost/createComment.',
            ),
          name: z.string().describe('Display name'),
          urn: z.string().describe('Full URN'),
          companyUrl: z
            .string()
            .optional()
            .describe('Company page URL (company actors only)'),
        }),
      )
      .describe('Available identities for the user'),
  }),
};

export type GetAvailableActorsOutput = z.infer<
  typeof getAvailableActorsSchema.output
>;

export const listCompanyPageViewersSchema = {
  name: 'listCompanyPageViewers',
  description:
    'List individual visitors who viewed your company page, with name, headline, location, industry, and when they visited. Requires admin access.',
  notes: AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    companyId: z
      .string()
      .describe(
        'Numeric company ID. Get from listAdminCompanies or getCompany.',
      ),
    start: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (default: 0)'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of viewers to return (default: 10)'),
  }),
  output: z.object({
    viewers: z
      .array(
        z.object({
          name: z.string().describe('Visitor name'),
          headline: z.string().describe('Visitor headline/job title'),
          viewedAgo: z
            .string()
            .describe('When they visited (e.g. "1 day ago")'),
          connectionDegree: z
            .string()
            .describe('Connection degree (1st, 2nd, etc.)'),
          location: z
            .string()
            .describe('Visitor location (e.g. "Orlando, FL")'),
          industry: z
            .string()
            .describe('Visitor industry (e.g. "Design Services")'),
          publicIdentifier: z
            .string()
            .optional()
            .describe('Vanity name URL slug'),
          memberId: z
            .string()
            .optional()
            .describe('Member ID (starts with "ACo")'),
          profileUrl: z.string().optional().describe('LinkedIn profile URL'),
          blurred: z
            .boolean()
            .describe('Whether identity is hidden (private mode)'),
        }),
      )
      .describe('Company page visitors'),
    paging: z.object({
      start: z.number(),
      count: z.number(),
      total: z.number().describe('Total number of visitors available'),
    }),
  }),
};

export type ListCompanyPageViewersOutput = z.infer<
  typeof listCompanyPageViewersSchema.output
>;

// ============================================================================
// Job Search Operations
// ============================================================================

export const searchJobsSchema = {
  name: 'searchJobs',
  description: 'Search for job listings on LinkedIn with optional filters',
  notes: AMD_PAGE_NOTE,
  input: z.object({
    csrf: CsrfParam,
    keywords: z
      .string()
      .describe('Job search keywords (e.g., "software engineer")'),
    location: z
      .string()
      .optional()
      .describe(
        'Location filter (e.g., "United States", "San Francisco Bay Area")',
      ),
    jobType: z
      .array(z.enum(['F', 'P', 'C', 'T', 'I', 'V', 'O']))
      .optional()
      .describe(
        'Job type filter. F=Full-time, P=Part-time, C=Contract, T=Temporary, I=Internship, V=Volunteer, O=Other.',
      ),
    experience: z
      .array(z.enum(['1', '2', '3', '4', '5', '6']))
      .optional()
      .describe(
        'Experience level filter. 1=Internship, 2=Entry level, 3=Associate, 4=Mid-Senior level, 5=Director, 6=Executive.',
      ),
    datePosted: z
      .enum(['r86400', 'r604800', 'r2592000'])
      .optional()
      .describe(
        'Time posted filter. r86400=past 24 hours, r604800=past week, r2592000=past month.',
      ),
    workplaceType: z
      .array(z.enum(['1', '2', '3']))
      .optional()
      .describe('Workplace type filter. 1=On-site, 2=Remote, 3=Hybrid.'),
    sortBy: z
      .enum(['date_posted', 'relevance'])
      .optional()
      .describe(
        'Sort order. "date_posted" for newest first, "relevance" (default) for most relevant.',
      ),
    company: z
      .array(z.string())
      .optional()
      .describe(
        'Company IDs to filter jobs by employer (numeric strings). Use resolveCompanyId or searchCompanies to find IDs.',
      ),
    easyApply: z
      .boolean()
      .optional()
      .describe(
        'When true, show only Easy Apply jobs (apply directly on LinkedIn without external site).',
      ),
    earlyApplicant: z
      .boolean()
      .optional()
      .describe('When true, show only jobs with fewer than 10 applicants.'),
    salary: z
      .array(z.enum(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']))
      .optional()
      .describe(
        'Salary range buckets. 1=$40K+, 2=$60K+, 3=$80K+, 4=$100K+, 5=$120K+, 6=$140K+, 7=$160K+, 8=$180K+, 9=$200K+, 10=$220K+.',
      ),
    industry: z
      .array(z.string())
      .optional()
      .describe(
        'Industry codes (numeric strings). Use resolveIndustry to find codes. Same codes as in searchPeople.',
      ),
    jobFunction: z
      .array(z.string())
      .optional()
      .describe(
        'Job function codes (two-letter codes). Examples: "it" (Information Technology), "eng" (Engineering), "sale" (Sales), "mktg" (Marketing), "fin" (Finance), "acct" (Accounting), "hr" (Human Resources), "bd" (Business Development), "ops" (Operations), "pr" (Public Relations).',
      ),
    titleId: z
      .array(z.string())
      .optional()
      .describe(
        'Job title IDs (numeric strings) for filtering by standardized job title. Use LinkedIn typeahead to discover title IDs.',
      ),
    commitments: z
      .array(z.string())
      .optional()
      .describe(
        'Company commitments filter (numeric strings). 1=Diversity & Inclusion, 2=Work-life Balance, 3=Environmental Sustainability, 4=Social Impact.',
      ),
    benefits: z
      .array(z.string())
      .optional()
      .describe(
        'Job benefits filter (numeric strings). 1=Medical Insurance, 2=Vision Insurance, 3=Dental Insurance, 4=Pension Plan, 5=Paid Maternity Leave, 6=Paid Paternity Leave, 7=Commuter Benefits, 8=Student Loan Assistance, 9=Tuition Assistance, 10=Disability Insurance.',
      ),
    fairChanceEmployer: z
      .boolean()
      .optional()
      .describe(
        'When true, show only jobs from Fair Chance employers (open to applicants with criminal records).',
      ),
    verifications: z
      .boolean()
      .optional()
      .describe(
        'When true, show only jobs from companies with LinkedIn identity verifications.',
      ),
    jobInYourNetwork: z
      .boolean()
      .optional()
      .describe(
        'When true, show only jobs where you have connections at the company.',
      ),
    populatedPlace: z
      .array(z.string())
      .optional()
      .describe(
        'Geo IDs for filtering jobs by specific location (numeric strings). Use resolveGeo to find IDs. Same IDs as geoUrn in searchPeople.',
      ),
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of results (max 25)'),
  }),
  output: z.object({
    results: z.array(
      z.object({
        jobId: z.string().optional().describe('Job posting ID'),
        title: z.string().optional().describe('Job title'),
        company: z.string().optional().describe('Company name'),
        location: z.string().optional().describe('Job location'),
        salary: z.string().optional().describe('Salary range if available'),
        listedAt: z
          .number()
          .optional()
          .describe('When job was posted in epoch ms'),
        jobUrl: z.string().optional().describe('Direct URL to job posting'),
      }),
    ),
    total: z.number().optional().describe('Total matching jobs'),
  }),
};

// ============================================================================
// Connection Removal Operations
// ============================================================================

export const removeConnectionSchema = {
  name: 'removeConnection',
  description: 'Remove a 1st-degree connection',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    memberId: z
      .string()
      .describe('Member ID (ACo...) of the connection to remove'),
  }),
  output: z.void(),
};

// ============================================================================
// Typeahead Resolver Operations
// ============================================================================

export const resolveGeoSchema = {
  name: 'resolveGeo',
  description:
    'Resolve a location name to LinkedIn geo IDs for use with search filters (geoUrn, companyHqGeo)',
  notes:
    "Uses LinkedIn's live typeahead API to resolve location names to geo IDs. Works for any location worldwide: countries, states, cities, metro areas. Returns the same IDs used by LinkedIn's search filter dropdowns.",
  input: z.object({
    csrf: CsrfParam,
    query: z
      .string()
      .describe(
        'Location name to search (e.g., "San Francisco", "United States", "London")',
      ),
  }),
  output: z.object({
    results: z.array(
      z.object({
        geoUrn: z.string().describe('Geo ID to pass to search filters'),
        name: z.string().describe('Display name of the location'),
      }),
    ),
  }),
};

export const resolveIndustrySchema = {
  name: 'resolveIndustry',
  description:
    'Resolve an industry name to LinkedIn industry codes for use with search filters',
  notes:
    "Uses LinkedIn's live typeahead API to resolve industry names to codes. Works for any LinkedIn industry category. Returns the same codes used by LinkedIn's search filter dropdowns.",
  input: z.object({
    csrf: CsrfParam,
    query: z
      .string()
      .describe(
        'Industry name to search (e.g., "Information Technology", "Software", "Finance")',
      ),
  }),
  output: z.object({
    results: z.array(
      z.object({
        industryCode: z
          .string()
          .describe('Industry code to pass to search filters'),
        name: z.string().describe('Display name of the industry'),
      }),
    ),
  }),
};

export const resolveSchoolSchema = {
  name: 'resolveSchool',
  description:
    'Resolve a school name to LinkedIn school IDs for use with search filters',
  notes:
    "Uses LinkedIn's live typeahead API to resolve school names to IDs. Returns the same IDs used by LinkedIn's search filter dropdowns.",
  input: z.object({
    csrf: CsrfParam,
    query: z
      .string()
      .describe(
        'School name to search (e.g., "Stanford", "MIT", "Harvard University")',
      ),
  }),
  output: z.object({
    results: z.array(
      z.object({
        schoolId: z.string().describe('School ID to pass to search filters'),
        name: z.string().describe('Display name of the school'),
      }),
    ),
  }),
};

export const resolveCompanyIdSchema = {
  name: 'resolveCompanyId',
  description:
    'Resolve a company name to LinkedIn company IDs for use with search filters (currentCompany, pastCompany)',
  notes:
    'Resolves company names to numeric IDs for use as `currentCompany` / `pastCompany` filters in searchPeople. Works on every page (no navigation prerequisite).',
  input: z.object({
    csrf: CsrfParam,
    query: z
      .string()
      .describe(
        'Company name to search (e.g., "Google", "Microsoft", "Anthropic")',
      ),
  }),
  output: z.object({
    results: z.array(
      z.object({
        companyId: z.string().describe('Company ID to pass to search filters'),
        name: z.string().describe('Display name of the company'),
      }),
    ),
  }),
};

// ============================================================================
// Sales Navigator Operations
// ============================================================================

export const SearchLeadsSchema = z.object({
  profileId: z.string().describe('Lead profile ID (ACw... format from URN)'),
  name: z.string().optional().describe('Full name'),
  firstName: z.string().optional().describe('First name'),
  lastName: z.string().optional().describe('Last name'),
  headline: z.string().optional().describe('Current job title/headline'),
  companyName: z.string().optional().describe('Current company name'),
  location: z.string().optional().describe('Geographic location'),
  degree: z
    .enum(['DEGREE_1', 'DEGREE_2', 'DEGREE_3'])
    .optional()
    .describe('Connection degree (DEGREE_1 = 1st, DEGREE_2 = 2nd, etc.)'),
  saved: z.boolean().optional().describe('Whether lead is saved to a list'),
  listCount: z
    .number()
    .optional()
    .describe('Number of lists this lead is saved to'),
  openLink: z
    .boolean()
    .optional()
    .describe(
      'Whether lead has an OpenLink profile (can receive InMail without connection)',
    ),
  premium: z.boolean().optional().describe('Whether lead has LinkedIn Premium'),
  profileUrl: z.string().optional().describe('LinkedIn profile URL'),
});

export const SearchAccountsSchema = z.object({
  companyId: z.string().describe('Company ID (numeric string from URN)'),
  name: z.string().optional().describe('Company name'),
  industry: z.string().optional().describe('Industry name'),
  description: z.string().optional().describe('Company description'),
  employeeCount: z.number().optional().describe('Number of employees'),
  employeeCountRange: z
    .string()
    .optional()
    .describe('Employee count range (e.g., "51-200")'),
  companyUrl: z.string().optional().describe('Sales Navigator company URL'),
});

export const salesNavSearchLeadsSchema = {
  name: 'searchLeads',
  description:
    'Search for leads (people) with keywords and 32+ filters. Returns lead results with profile info, company, location, and saved status.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and confirm tier === "sales_navigator" BEFORE calling this; on free/premium accounts use searchPeople instead (calling this without a seat returns 403 SALES_SEAT_REQUIRED and wastes a round-trip). Pass csrf. Auto-paginates internally with random delays between pages to avoid rate limiting. Max 100 results per API request, max 2500 total accessible results (Sales Navigator platform limit). For result sets over 2500, narrow your search with additional filters. Geography filters require numeric IDs; use searchFilterValues with filterType GEO to resolve city/region names to IDs before searching.',
  input: z.object({
    csrf: CsrfParam,
    keywords: z.string().optional().describe('Search keywords'),
    currentCompany: z
      .array(z.string())
      .optional()
      .describe('Current company IDs (numeric strings)'),
    pastCompany: z
      .array(z.string())
      .optional()
      .describe('Past company IDs (numeric strings)'),
    seniority: z
      .array(
        z.enum([
          '100',
          '110',
          '120',
          '130',
          '200',
          '210',
          '220',
          '300',
          '310',
          '320',
        ]),
      )
      .optional()
      .describe(
        'Seniority level codes. 320=Owner/Partner, 310=CXO, 300=VP, 220=Director, 210=Experienced Manager, 200=Entry Level Manager, 130=Strategic, 120=Senior, 110=Entry Level, 100=In Training.',
      ),
    companySize: z
      .array(z.string())
      .optional()
      .describe(
        'Company size codes. A=Self-employed, B=1-10, C=11-50, D=51-200, E=201-500, F=501-1000, G=1001-5000, H=5001-10000, I=10001+.',
      ),
    industry: z
      .array(z.string())
      .optional()
      .describe('Industry codes (numeric strings)'),
    school: z
      .array(z.string())
      .optional()
      .describe('School IDs (numeric strings)'),
    geography: z
      .array(z.string())
      .optional()
      .describe('Geographic region IDs (numeric strings)'),
    function: z
      .array(z.string())
      .optional()
      .describe('Function area codes (numeric strings)'),
    title: z.string().optional().describe('Job title keyword'),
    titleScope: z
      .enum(['CURRENT', 'PAST', 'CURRENT_OR_PAST'])
      .optional()
      .describe(
        'Title filter scope. CURRENT=current title only, PAST=past title only, CURRENT_OR_PAST=either.',
      ),
    companyHeadquarters: z
      .array(z.string())
      .optional()
      .describe('Company headquarters geographic IDs'),
    firstName: z.string().optional().describe('First name filter'),
    lastName: z.string().optional().describe('Last name filter'),
    yearsOfExperience: z
      .array(z.enum(['1', '2', '3', '4', '5']))
      .optional()
      .describe(
        'Years of experience buckets. 1=Less than 1 year, 2=1-2 years, 3=3-5 years, 4=6-10 years, 5=More than 10 years.',
      ),
    yearsAtCurrentCompany: z
      .array(z.enum(['1', '2', '3', '4', '5']))
      .optional()
      .describe(
        'Years at current company buckets. 1=Less than 1 year, 2=1-2 years, 3=3-5 years, 4=6-10 years, 5=More than 10 years.',
      ),
    yearsInCurrentPosition: z
      .array(z.enum(['1', '2', '3', '4', '5']))
      .optional()
      .describe(
        'Years in current position buckets. 1=Less than 1 year, 2=1-2 years, 3=3-5 years, 4=6-10 years, 5=More than 10 years.',
      ),
    connectionDegree: z
      .array(z.enum(['F', 'S', 'O', 'A', 'T']))
      .optional()
      .describe(
        'Connection degree filter. F=1st, S=2nd, O=3rd+, A=Group member, T=TeamLink.',
      ),
    profileLanguage: z
      .array(z.string())
      .optional()
      .describe('Profile language codes'),
    group: z.array(z.string()).optional().describe('LinkedIn group IDs'),
    companyType: z.array(z.string()).optional().describe('Company type codes'),
    postedOnLinkedIn: z
      .boolean()
      .optional()
      .describe('Filter for leads who have posted on LinkedIn'),
    recentlyChangedJobs: z
      .boolean()
      .optional()
      .describe('Filter for leads who recently changed jobs'),
    followsYourCompany: z
      .boolean()
      .optional()
      .describe('Filter for leads who follow your company'),
    viewedYourProfile: z
      .boolean()
      .optional()
      .describe('Filter for leads who viewed your profile'),
    postedContentKeywords: z
      .array(z.string())
      .optional()
      .describe('Keywords in posted content'),
    companyHeadcountGrowth: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .optional()
      .describe('Company headcount growth percentage range'),
    leadList: z
      .array(z.string())
      .optional()
      .describe('Lead list IDs to filter by'),
    savedLeads: z.boolean().optional().describe('Filter for saved leads only'),
    savedAccounts: z
      .boolean()
      .optional()
      .describe('Filter for saved accounts only'),
    pastColleague: z
      .boolean()
      .optional()
      .describe('Filter for leads who are past colleagues'),
    sharedExperiences: z
      .boolean()
      .optional()
      .describe(
        'Filter for leads with shared experiences (groups, schools, companies)',
      ),
    connectionsOf: z
      .array(z.string())
      .optional()
      .describe(
        'Filter for connections of specific members. Pass member profile IDs.',
      ),
    persona: z
      .array(z.string())
      .optional()
      .describe('Filter by persona IDs (custom Sales Navigator personas)'),
    accountList: z
      .array(z.string())
      .optional()
      .describe(
        'Filter for leads at companies in specific account lists. Pass account list IDs.',
      ),
    peopleInteractedWith: z
      .array(z.enum(['LIMP', 'LIVP']))
      .optional()
      .describe(
        'Filter by lead interaction type. LIMP=Messaged on LinkedIn, LIVP=Viewed your profile.',
      ),
    start: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (max 2499)'),
    count: z
      .number()
      .optional()
      .default(25)
      .describe(
        'Total results to return (default 25). Auto-paginates internally in pages of 100 with random delays.',
      ),
  }),
  output: z.object({
    results: z.array(SearchLeadsSchema),
    total: z.number().optional().describe('Total matching leads'),
  }),
};

export const salesNavSearchAccountsSchema = {
  name: 'searchAccounts',
  description:
    'Search for accounts (companies) with keywords and filters. Returns account results with company info, industry, and employee count.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and confirm tier === "sales_navigator" BEFORE calling this; on free/premium accounts use searchCompanies instead (calling this without a seat returns 403 SALES_SEAT_REQUIRED and wastes a round-trip). Pass csrf. Auto-paginates internally with random delays between pages to avoid rate limiting. Max 100 results per API request, max 2500 total accessible results (Sales Navigator platform limit). For result sets over 2500, narrow your search with additional filters.',
  input: z.object({
    csrf: CsrfParam,
    keywords: z.string().optional().describe('Search keywords'),
    companySize: z
      .array(z.string())
      .optional()
      .describe(
        'Company size codes. A=Self-employed, B=1-10, C=11-50, D=51-200, E=201-500, F=501-1000, G=1001-5000, H=5001-10000, I=10001+.',
      ),
    industry: z
      .array(z.string())
      .optional()
      .describe('Industry codes (numeric strings)'),
    annualRevenue: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .optional()
      .describe('Annual revenue range in millions'),
    companyHeadcountGrowth: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .optional()
      .describe('Company headcount growth percentage range'),
    companyType: z.array(z.string()).optional().describe('Company type codes'),
    fortune: z
      .array(z.string())
      .optional()
      .describe(
        'Fortune list filter codes. "1"=Fortune 50, "2"=Fortune 51-100, "3"=Fortune 101-250, "4"=Fortune 251-500.',
      ),
    numOfFollowers: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .optional()
      .describe('Number of LinkedIn followers range'),
    accountActivities: z
      .array(z.enum(['SLC', 'RFE']))
      .optional()
      .describe(
        'Account activity filters. SLC=Senior leadership change, RFE=Recent funding event.',
      ),
    accountList: z
      .array(z.string())
      .optional()
      .describe(
        'Account list IDs to filter by. Use listAccountLists() to get valid list IDs.',
      ),
    headquarters: z
      .array(z.string())
      .optional()
      .describe(
        'Headquarters location geographic IDs (numeric strings). Same format as geography IDs in lead search.',
      ),
    departmentHeadcount: z
      .object({
        range: z.object({
          min: z.number().optional().describe('Minimum headcount'),
          max: z.number().optional().describe('Maximum headcount'),
        }),
        departmentId: z
          .string()
          .describe(
            'Department ID (required). 1=Accounting, 2=Administrative, 3=Arts and Design, 4=Business Development, 5=Community and Social Services, 6=Consulting, 7=Education, 8=Engineering, 9=Entrepreneurship, 10=Finance, 11=Healthcare Services, 12=Human Resources, 13=Information Technology, 14=Legal, 15=Marketing, 16=Media and Communication, 17=Military and Protective Services, 18=Operations, 19=Product Management, 20=Program and Project Management, 21=Purchasing, 22=Quality Assurance, 23=Real Estate, 24=Research, 25=Sales, 26=Support.',
          ),
      })
      .optional()
      .describe('Department headcount range for a specific department'),
    departmentHeadcountGrowth: z
      .object({
        range: z.object({
          min: z.number().optional().describe('Minimum growth percentage'),
          max: z.number().optional().describe('Maximum growth percentage'),
        }),
        departmentId: z
          .string()
          .describe(
            'Department ID (required). Same IDs as departmentHeadcount: 1=Accounting, 8=Engineering, 10=Finance, 13=IT, 15=Marketing, 25=Sales, etc.',
          ),
      })
      .optional()
      .describe(
        'Department headcount growth percentage range for a specific department',
      ),
    connectionDegree: z
      .array(z.enum(['F', 'S', 'O', 'A', 'T']))
      .optional()
      .describe(
        'Connection degree filter for accounts. F=1st, S=2nd, O=3rd+, A=Group member, T=TeamLink.',
      ),
    savedAccounts: z
      .boolean()
      .optional()
      .describe('Filter for saved accounts only'),
    start: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (max 2499)'),
    count: z
      .number()
      .optional()
      .default(25)
      .describe(
        'Total results to return (default 25). Auto-paginates internally in pages of 100 with random delays.',
      ),
  }),
  output: z.object({
    results: z.array(SearchAccountsSchema),
    total: z.number().optional().describe('Total matching accounts'),
  }),
};

const PositionSchema = z.object({
  title: z.string().optional(),
  companyName: z.string().optional(),
  companyId: z.string().optional(),
  description: z.string().optional().describe('Position description text'),
  location: z.string().optional().describe('Position location'),
  startDate: z
    .object({
      month: z.number().optional(),
      year: z.number().optional(),
    })
    .optional(),
  endDate: z
    .object({
      month: z.number().optional(),
      year: z.number().optional(),
    })
    .optional(),
  current: z.boolean().optional(),
});

export const LeadProfileSchema = z.object({
  profileId: z.string().describe('Lead profile ID (ACw... format)'),
  memberId: z
    .string()
    .optional()
    .describe(
      'Standard LinkedIn member ID (ACo... format) extracted from objectUrn. Use this to call standard LinkedIn functions like getFullProfile, getContactInfo, sendConnectionRequest.',
    ),
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  headline: z.string().optional(),
  location: z.string().optional(),
  summary: z.string().optional().describe('Profile summary/about section'),
  pronoun: z.string().optional().describe('Pronoun preference (e.g. "He/Him")'),
  profileUrl: z.string().optional().describe('Flagship LinkedIn profile URL'),
  currentPositions: z
    .array(PositionSchema)
    .optional()
    .describe('Current job positions'),
  pastPositions: z
    .array(PositionSchema)
    .optional()
    .describe('Past job positions'),
  contactInfo: z
    .object({
      emails: z
        .array(
          z.object({
            emailAddress: z.string().optional(),
            dataSource: z.string().optional(),
          }),
        )
        .optional(),
      phoneNumbers: z
        .array(
          z.object({
            number: z.string().optional(),
            type: z.string().optional(),
          }),
        )
        .optional(),
      websites: z
        .array(
          z.object({
            url: z.string().optional(),
            category: z.string().optional(),
          }),
        )
        .optional(),
      primaryEmail: z.string().optional().describe('Primary email address'),
    })
    .optional()
    .describe('Contact information (emails, phones, websites)'),
  educations: z
    .array(
      z.object({
        degree: z.string().optional(),
        schoolName: z.string().optional(),
        fieldsOfStudy: z.array(z.string()).optional(),
        startDate: z
          .object({ month: z.number().optional(), year: z.number().optional() })
          .optional(),
        endDate: z
          .object({ month: z.number().optional(), year: z.number().optional() })
          .optional(),
      }),
    )
    .optional()
    .describe('Education history'),
  skills: z
    .array(
      z.object({
        name: z.string().optional(),
      }),
    )
    .optional()
    .describe('Skills listed on profile'),
  languages: z.array(z.string()).optional().describe('Languages spoken'),
  memberBadges: z
    .object({
      premium: z.boolean().optional(),
      openLink: z.boolean().optional(),
      jobSeeker: z.boolean().optional(),
    })
    .optional()
    .describe('Profile badges'),
  numOfConnections: z.number().optional().describe('Total connections count'),
  numOfSharedConnections: z
    .number()
    .optional()
    .describe('Shared connections count'),
  inmailRestriction: z
    .string()
    .optional()
    .describe('InMail restriction status (e.g. "NO_RESTRICTION")'),
  degree: z
    .enum(['DEGREE_1', 'DEGREE_2', 'DEGREE_3'])
    .optional()
    .describe('Connection degree'),
  saved: z.boolean().optional().describe('Whether lead is saved to a list'),
  unlocked: z.boolean().optional().describe('Whether contact info is unlocked'),
  pendingInvitation: z
    .boolean()
    .optional()
    .describe('Whether a connection request is pending'),
  listCount: z
    .number()
    .optional()
    .describe('Number of lists this lead is saved to'),
  noteCount: z.number().optional().describe('Number of notes on this lead'),
  notes: z
    .array(
      z.object({
        noteId: z.string().optional(),
        text: z.string().optional(),
        createdAt: z.number().optional().describe('Creation timestamp'),
        authorName: z.string().optional(),
      }),
    )
    .optional()
    .describe('Notes on this lead'),
});

export const LeadActivitySchema = z.object({
  activityType: z
    .string()
    .optional()
    .describe(
      'Activity type (e.g., "POSTED_ON_LINKEDIN", "JOB_CHANGE", "ACCOUNT_NEWS")',
    ),
  timestamp: z.number().optional().describe('Activity timestamp'),
  activityUrn: z.string().optional().describe('Activity URN identifier'),
});

export const salesNavGetLeadProfileSchema = {
  name: 'getLeadProfile',
  description:
    'Get detailed profile for a lead by profileId. Returns full profile with work history, connection degree, and saved status.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. profileId is the ACw... format extracted from lead entityUrn. Use searchLeads to get profileIds.',
  input: z.object({
    csrf: CsrfParam,
    profileId: z
      .string()
      .describe(
        'Lead profile ID (ACw... format from salesNavSearchLeads results or entityUrn)',
      ),
  }),
  output: LeadProfileSchema,
};

export const salesNavGetLeadTimelineSchema = {
  name: 'getLeadTimeline',
  description:
    'Get activity timeline for a lead. Returns recent activities like connection accepts, job changes, and shares.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Returns empty activities for profiles with no tracked activity or when LinkedIn returns a server error for that profile.',
  input: z.object({
    csrf: CsrfParam,
    profileId: z.string().describe('Lead profile ID (ACw... format)'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of activities to fetch'),
  }),
  output: z.object({
    activities: z.array(LeadActivitySchema),
  }),
};

export const AccountDetailSchema = z.object({
  companyId: z.string().describe('Company ID (numeric string)'),
  name: z.string().optional().describe('Company name'),
  industry: z.string().optional().describe('Industry name'),
  description: z.string().optional().describe('Company description'),
  location: z.string().optional().describe('Primary location'),
  type: z
    .string()
    .optional()
    .describe('Company type (e.g. "Public Company", "Privately Held")'),
  yearFounded: z.number().optional().describe('Year the company was founded'),
  specialties: z
    .array(z.string())
    .optional()
    .describe('Company specialties/focus areas'),
  employeeCountRange: z
    .string()
    .optional()
    .describe('Employee count range (e.g., "51-200", "10001+")'),
  employeeGrowth: z
    .array(
      z.object({
        timespan: z
          .string()
          .optional()
          .describe('Time period (e.g. "SIX_MONTHS", "ONE_YEAR", "TWO_YEARS")'),
        percentage: z.number().optional().describe('Growth percentage'),
      }),
    )
    .optional()
    .describe('Employee headcount growth over time'),
  revenue: z.string().optional().describe('Revenue range'),
  headquarters: z
    .object({
      country: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      addressLine: z.string().optional().describe('Street address'),
      postalCode: z.string().optional().describe('Postal/zip code'),
    })
    .optional()
    .describe('Headquarters location details'),
  website: z.string().optional().describe('Company website URL'),
  flagshipCompanyUrl: z
    .string()
    .optional()
    .describe('LinkedIn company page URL'),
  companyUrl: z.string().optional().describe('Sales Navigator company URL'),
  saved: z.boolean().optional().describe('Whether account is saved'),
  starred: z.boolean().optional().describe('Whether account is starred'),
  noteCount: z.number().optional().describe('Number of notes on this account'),
  listCount: z
    .number()
    .optional()
    .describe('Number of lists this account is in'),
});

export const salesNavGetAccountDetailSchema = {
  name: 'getAccountDetail',
  description:
    'Get detailed company info by companyId. Returns full account details including industry, employee count, revenue, and headquarters.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. companyId is numeric string extracted from fs_salesCompany URN. Use searchAccounts to get companyIds.',
  input: z.object({
    csrf: CsrfParam,
    companyId: z
      .string()
      .describe(
        'Company ID (numeric string from salesNavSearchAccounts results)',
      ),
  }),
  output: AccountDetailSchema,
};

export const salesNavGetAccountLeadsSchema = {
  name: 'getAccountLeads',
  description:
    'Get leads (people) at a specific account. Returns people working at the company.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Use searchLeads with currentCompany filter for more advanced filtering.',
  input: z.object({
    csrf: CsrfParam,
    companyId: z.string().describe('Company ID (numeric string)'),
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(25)
      .describe('Number of results per page'),
  }),
  output: z.object({
    results: z.array(SearchLeadsSchema),
    total: z.number().optional(),
  }),
};

export const LeadListSchema = z.object({
  listId: z.string().describe('List ID (numeric string)'),
  name: z.string().optional().describe('List name'),
  leadCount: z.number().optional().describe('Number of leads in list'),
  createdAt: z.number().optional().describe('Creation timestamp'),
});

export const AccountListSchema = z.object({
  listId: z.string().describe('List ID (numeric string)'),
  name: z.string().optional().describe('List name'),
  accountCount: z.number().optional().describe('Number of accounts in list'),
  createdAt: z.number().optional().describe('Creation timestamp'),
});

export const salesNavListLeadListsSchema = {
  name: 'listLeadLists',
  description:
    'List all lead lists (custom lists of people). Returns all saved lead lists with counts.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    lists: z.array(LeadListSchema),
  }),
};

export const salesNavListAccountListsSchema = {
  name: 'listAccountLists',
  description:
    'List all account lists (custom lists of companies). Returns all saved account lists with counts.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    lists: z.array(AccountListSchema),
  }),
};

export const salesNavGetLeadsInListSchema = {
  name: 'getLeadsInList',
  description:
    'Get leads in a specific list by listId. Returns paginated lead results.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Use listLeadLists to get listIds.',
  input: z.object({
    csrf: CsrfParam,
    listId: z.string().describe('List ID (numeric string)'),
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(25)
      .describe('Number of results per page'),
  }),
  output: z.object({
    results: z.array(SearchLeadsSchema),
    total: z.number().optional(),
  }),
};

export const salesNavCreateListSchema = {
  name: 'createList',
  description:
    'Create a new lead or account list. Returns the created list with listId.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    name: z.string().describe('List name'),
    type: z
      .enum(['LEAD', 'ACCOUNT'])
      .describe('List type. LEAD for people, ACCOUNT for companies.'),
  }),
  output: z.object({
    listId: z.string().describe('Created list ID'),
    name: z.string(),
    type: z.string(),
  }),
};

export const salesNavDeleteListSchema = {
  name: 'deleteList',
  description: 'Delete a lead or account list by listId.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    listId: z
      .string()
      .describe('List ID from listLeadLists or listAccountLists'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavSaveLeadSchema = {
  name: 'saveLead',
  description:
    'Save a lead to your saved leads. Optionally add to specific lists or associate with a company.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    profileId: z.string().describe('Lead profile ID (ACw... format)'),
    companyId: z
      .string()
      .optional()
      .describe('Company ID to associate with (numeric string)'),
    listIds: z
      .array(z.string())
      .optional()
      .describe('List IDs to add lead to (array of numeric strings)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavUnsaveLeadSchema = {
  name: 'unsaveLead',
  description: 'Remove a lead from your saved leads.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    profileId: z.string().describe('Lead profile ID (ACw... format)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavUpdateListSchema = {
  name: 'updateList',
  description: 'Rename a lead or account list.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Use listLeadLists or listAccountLists to get listIds.',
  input: z.object({
    csrf: CsrfParam,
    listId: z
      .string()
      .describe('List ID from listLeadLists or listAccountLists'),
    name: z.string().describe('New list name'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavGetAccountsInListSchema = {
  name: 'getAccountsInList',
  description:
    'Get accounts in a specific account list by listId. Returns paginated account results.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Use listAccountLists to get listIds.',
  input: z.object({
    csrf: CsrfParam,
    listId: z.string().describe('List ID (numeric string)'),
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(25)
      .describe('Number of results per page'),
  }),
  output: z.object({
    results: z.array(SearchAccountsSchema),
    total: z.number().optional(),
  }),
};

export const salesNavAddLeadToListSchema = {
  name: 'addLeadToList',
  description: 'Add a saved lead to one or more lists.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. The lead must already be saved (use saveLead first). Use listLeadLists to get listIds.',
  input: z.object({
    csrf: CsrfParam,
    profileId: z.string().describe('Lead profile ID (ACw... format)'),
    listIds: z
      .array(z.string())
      .describe('List IDs to add the lead to (array of numeric strings)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavRemoveLeadFromListSchema = {
  name: 'removeLeadFromList',
  description:
    'Remove a lead from one or more lists. Does not unsave the lead.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Use getLeadsInList to find leads in a list.',
  input: z.object({
    csrf: CsrfParam,
    profileId: z.string().describe('Lead profile ID (ACw... format)'),
    listIds: z
      .array(z.string())
      .describe('List IDs to remove the lead from (array of numeric strings)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavAddAccountToListSchema = {
  name: 'addAccountToList',
  description: 'Add a saved account to one or more lists.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. The account must already be saved (use saveAccount first). Use listAccountLists to get listIds.',
  input: z.object({
    csrf: CsrfParam,
    companyId: z
      .string()
      .describe('Company ID (numeric string from searchAccounts results)'),
    listIds: z
      .array(z.string())
      .describe('List IDs to add the account to (array of numeric strings)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavRemoveAccountFromListSchema = {
  name: 'removeAccountFromList',
  description:
    'Remove an account from one or more lists. Does not unsave the account.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Use getAccountsInList to find accounts in a list.',
  input: z.object({
    csrf: CsrfParam,
    companyId: z.string().describe('Company ID (numeric string)'),
    listIds: z
      .array(z.string())
      .describe(
        'List IDs to remove the account from (array of numeric strings)',
      ),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavSaveAccountSchema = {
  name: 'saveAccount',
  description:
    'Save a company to your saved accounts. Optionally add to specific lists.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Use searchAccounts to get companyIds.',
  input: z.object({
    csrf: CsrfParam,
    companyId: z
      .string()
      .describe('Company ID (numeric string from searchAccounts results)'),
    listIds: z
      .array(z.string())
      .optional()
      .describe('List IDs to add account to (array of numeric strings)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavUnsaveAccountSchema = {
  name: 'unsaveAccount',
  description: 'Remove a company from your saved accounts.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Optional: unsave all leads under this account too.',
  input: z.object({
    csrf: CsrfParam,
    companyId: z.string().describe('Company ID (numeric string)'),
    unsaveLeads: z
      .boolean()
      .optional()
      .default(false)
      .describe('Also unsave all leads under this account'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const NoteSchema = z.object({
  noteId: z.string().describe('Note ID'),
  text: z.string().optional().describe('Note text content'),
  createdAt: z.number().optional().describe('Creation timestamp (ms)'),
  authorName: z.string().optional().describe('Author display name'),
  entityUrn: z.string().optional().describe('Lead or account URN'),
  seat: z.string().optional().describe('Seat URN (required for update/delete)'),
  entity: z
    .string()
    .optional()
    .describe('Entity URN (required for update/delete)'),
});

export const salesNavGetLeadNotesSchema = {
  name: 'getLeadNotes',
  description:
    'Get all notes on a lead. Returns notes with text, author, entity and seat URNs needed for update/delete.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    profileId: z.string().describe('Lead profile ID (ACw... format)'),
  }),
  output: z.object({
    notes: z.array(NoteSchema),
  }),
};

export const salesNavGetAccountNotesSchema = {
  name: 'getAccountNotes',
  description:
    'Get all notes on an account (company). Returns notes with text, author, entity and seat URNs needed for update/delete.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    companyId: z.string().describe('Company ID (numeric string)'),
  }),
  output: z.object({
    notes: z.array(NoteSchema),
  }),
};

export const salesNavCreateNoteSchema = {
  name: 'createNote',
  description:
    'Create a note on a lead (person) or account (company). Returns the created note with noteId.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    entityType: z
      .enum(['LEAD', 'ACCOUNT'])
      .describe('Entity type (LEAD for person, ACCOUNT for company)'),
    entityId: z
      .string()
      .describe('Entity ID (profileId for lead, companyId for account)'),
    text: z.string().describe('Note text'),
  }),
  output: z.object({
    noteId: z.string().describe('Created note ID'),
    text: z.string(),
    createdAt: z.number().optional(),
  }),
};

export const salesNavUpdateNoteSchema = {
  name: 'updateNote',
  description: 'Update an existing note. Replaces note text.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Requires entity and seat URNs from getLeadNotes or getAccountNotes response.',
  input: z.object({
    csrf: CsrfParam,
    noteId: z.string().describe('Note ID'),
    entity: z
      .string()
      .describe('Entity URN from getLeadNotes or getAccountNotes'),
    seat: z.string().describe('Seat URN from getLeadNotes or getAccountNotes'),
    text: z.string().describe('New note text'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const salesNavDeleteNoteSchema = {
  name: 'deleteNote',
  description: 'Delete a note by noteId.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Requires entity and seat URNs from getLeadNotes or getAccountNotes response.',
  input: z.object({
    csrf: CsrfParam,
    noteId: z.string().describe('Note ID'),
    entity: z
      .string()
      .describe('Entity URN from getLeadNotes or getAccountNotes'),
    seat: z.string().describe('Seat URN from getLeadNotes or getAccountNotes'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const MessageThreadSchema = z.object({
  threadId: z.string().describe('Thread ID'),
  subject: z.string().optional().describe('Message subject'),
  lastMessageText: z.string().optional().describe('Most recent message text'),
  lastMessageTime: z
    .number()
    .optional()
    .describe('Timestamp of last message (ms)'),
  unread: z.boolean().optional().describe('Whether thread has unread messages'),
  participantName: z
    .string()
    .optional()
    .describe('Other participant display name'),
  participantProfileId: z
    .string()
    .optional()
    .describe('Other participant profile ID (ACw... format)'),
});

export const ThreadMessageSchema = z.object({
  messageId: z.string().describe('Message ID'),
  text: z.string().optional().describe('Message body text'),
  sentAt: z.number().optional().describe('Send timestamp (ms)'),
  senderName: z.string().optional().describe('Sender display name'),
  senderProfileId: z
    .string()
    .optional()
    .describe('Sender profile ID (ACw... format)'),
  isInMail: z
    .boolean()
    .optional()
    .describe('Whether this is an InMail message'),
});

export const salesNavListInMailThreadsSchema = {
  name: 'listInMailThreads',
  description:
    'List Sales Navigator messaging threads (inbox). Returns InMail and message conversations.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. For 1st-degree connections, use sendMessage instead.',
  input: z.object({
    csrf: CsrfParam,
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(25)
      .describe('Number of threads per page'),
  }),
  output: z.object({
    threads: z.array(MessageThreadSchema),
    total: z.number().optional(),
  }),
};

export const salesNavViewInMailThreadSchema = {
  name: 'viewInMailThread',
  description:
    'View all messages in a specific thread. Returns message text, sender, and timestamps.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    threadId: z.string().describe('Thread ID from salesNavListInMailThreads'),
  }),
  output: z.object({
    messages: z.array(ThreadMessageSchema),
  }),
};

export const salesNavSendInMailSchema = {
  name: 'sendInMail',
  description:
    'Send an InMail message to a lead. Costs credits for non-connections. For 1st-degree connections, use sendMessage instead.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf + identityToken. InMails cost credits; check getInMailCredits() before sending and inform the user of remaining balance. **Output format**: If presenting a draft to the user before sending, you MUST use the "message-draft" skill (useSkill("message-draft")) to render it as an editable UI card for approval.',
  input: z.object({
    csrf: CsrfParam,
    identityToken: z
      .string()
      .describe('Enterprise identity token from getContext().identityToken'),
    profileId: z.string().describe('Lead profile ID (ACw... format)'),
    subject: z
      .string()
      .optional()
      .describe('Message subject (optional for threaded replies)'),
    body: z.string().describe('Message body'),
    threadId: z
      .string()
      .optional()
      .describe('Thread ID for replies (null for new conversations)'),
  }),
  output: z.object({
    success: z.boolean(),
    messageId: z.string().optional(),
    threadId: z.string().optional(),
  }),
};

export const SavedSearchSchema = z.object({
  savedSearchId: z.string().describe('Saved search ID (numeric string)'),
  name: z.string().optional().describe('Search name'),
  type: z
    .enum(['LEAD', 'ACCOUNT'])
    .optional()
    .describe('Search type (LEAD or ACCOUNT)'),
  alertEnabled: z
    .boolean()
    .optional()
    .describe('Whether alerts are enabled for new results'),
  createdAt: z.number().optional().describe('Creation timestamp (ms)'),
});

export const salesNavListSavedSearchesSchema = {
  name: 'listSavedSearches',
  description:
    'List saved searches (lead or account type). Returns all saved searches with names and alert status.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    type: z
      .enum(['LEAD', 'ACCOUNT'])
      .optional()
      .describe('Filter by search type (omit for all)'),
  }),
  output: z.object({
    searches: z.array(SavedSearchSchema),
  }),
};

export const SalesNavNotificationSchema = z.object({
  notificationId: z.string().describe('Notification ID'),
  type: z.string().optional().describe('Notification type'),
  text: z.string().optional().describe('Notification text'),
  timestamp: z.number().optional().describe('Notification timestamp (ms)'),
  read: z.boolean().optional().describe('Whether notification has been read'),
  actionUrl: z.string().optional().describe('URL to navigate to on click'),
});

export const salesNavListNotificationsSchema = {
  name: 'listSalesNavNotifications',
  description:
    'List Sales Navigator alerts and notifications. Returns recent alerts with type, text, and read status.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf.',
  input: z.object({
    csrf: CsrfParam,
    start: z.number().optional().default(0).describe('Pagination offset'),
    count: z
      .number()
      .optional()
      .default(25)
      .describe('Number of notifications per page'),
  }),
  output: z.object({
    notifications: z.array(SalesNavNotificationSchema),
    total: z.number().optional(),
  }),
};

export const salesNavGetInMailCreditsSchema = {
  name: 'getInMailCredits',
  description: 'Get remaining InMail credit balance.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Check before sending InMails.',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    credits: z.number().describe('Remaining InMail credits'),
  }),
};

export const salesNavSearchFilterValuesSchema = {
  name: 'searchFilterValues',
  description:
    'Search for valid filter values by type. Use to discover IDs for company, geography, industry, school, title, function, language, and company type filters.',
  notes:
    'Some filter types (FUNCTION, PROFILE_LANGUAGE, COMPANY_TYPE) return all values without a query. Others (GEO, INDUSTRY, SCHOOL, TITLE, COMPANY) require a search query. Seniority, company headcount, and experience bucket filters are not supported; their valid values are documented in the searchLeads schema. Use filterType GEO to resolve geography IDs (e.g., search "Milwaukee" to get the numeric ID for Milwaukee, Wisconsin) before passing them to searchLeads.',
  input: z.object({
    csrf: CsrfParam,
    filterType: z
      .enum([
        'GEO',
        'INDUSTRY',
        'SCHOOL',
        'TITLE',
        'FUNCTION',
        'COMPANY',
        'COMPANY_WITH_LIST',
        'PROFILE_LANGUAGE',
        'COMPANY_TYPE',
      ])
      .describe('Filter type to search values for'),
    query: z
      .string()
      .optional()
      .describe(
        'Search keyword. Required for GEO, INDUSTRY, SCHOOL, TITLE, COMPANY. Optional for FUNCTION, PROFILE_LANGUAGE, COMPANY_TYPE (returns all values without query).',
      ),
  }),
  output: z.object({
    values: z.array(
      z.object({
        id: z.string().describe('Filter value ID to use in search filters'),
        label: z.string().describe('Human-readable display name'),
      }),
    ),
  }),
};

export const downloadAttachmentSchema = {
  name: 'downloadAttachment',
  description:
    'Download a file attachment from a LinkedIn message. Returns base64-encoded file data.',
  notes:
    'Pass the attachment URL from viewConversation() message attachments. The URL is pre-authenticated and time-limited; download soon after retrieving. Returns base64-encoded data that can be written to disk.',
  input: z.object({
    url: z
      .string()
      .describe(
        'Pre-authenticated attachment URL from viewConversation() message attachment.',
      ),
  }),
  output: z.object({
    data: z.string().describe('Base64-encoded file contents'),
    mediaType: z.string().describe('MIME type of the downloaded file'),
    byteSize: z.number().describe('Size in bytes'),
  }),
};

// ============================================================================
// Sales Navigator Account Dossier
// ============================================================================

export const salesNavGetAccountDossierSchema = {
  name: 'getAccountDossier',
  description:
    'Get AI-generated account intelligence (dossier) for a company. Returns strategic priorities, challenges, competitive landscape, revenue data, executive summary, news, and competitor details.',
  notes:
    'Requires Sales Navigator Advanced tier. Call getContext() first and pass csrf. Uses LinkedIn AccountIQ feature. May return partial data if intelligence is not yet generated for this company.',
  input: z.object({
    csrf: CsrfParam,
    companyId: z
      .string()
      .describe(
        'Company ID (numeric string from salesNavSearchAccounts results)',
      ),
  }),
  output: z.object({
    strategicPriorities: z
      .array(
        z.object({
          text: z.string().optional(),
          description: z.string().optional(),
          source: z.string().optional(),
        }),
      )
      .optional()
      .describe('Key strategic priorities identified by AI'),
    challenges: z
      .array(
        z.object({
          text: z.string().optional(),
          description: z.string().optional(),
          source: z.string().optional(),
        }),
      )
      .optional()
      .describe('Key business challenges identified by AI'),
    competitiveLandscape: z
      .object({
        text: z.string().optional(),
        description: z.string().optional(),
        source: z.string().optional(),
      })
      .optional()
      .describe('Competitive landscape summary'),
    annualRevenue: z.string().optional().describe('Annual revenue data'),
    quarterRevenue: z.string().optional().describe('Quarterly revenue data'),
    cxoSummary: z.string().optional().describe('Executive summary text'),
    bingCompanyNews: z
      .array(
        z.object({
          title: z.string().optional(),
          url: z.string().optional(),
          datePublished: z.string().optional(),
        }),
      )
      .optional()
      .describe('Recent company news articles'),
    executivesProfiles: z
      .array(
        z.object({
          name: z.string().optional(),
          title: z.string().optional(),
          profileId: z.string().optional(),
        }),
      )
      .optional()
      .describe('Key executive profiles'),
    competitorDetails: z
      .array(
        z.object({
          companyName: z.string().optional(),
          companyId: z.string().optional(),
        }),
      )
      .optional()
      .describe('Competitor company details'),
  }),
};

// ============================================================================
// Sales Navigator Account Headcount
// ============================================================================

export const salesNavGetAccountHeadcountSchema = {
  name: 'getAccountHeadcount',
  description:
    'Get employee headcount trends and functional breakdown for a company. Returns median tenure, monthly headcount time series, and optional breakdown by department.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Set includeFunctional=true for department breakdown (Engineering, Sales, Marketing, etc.).',
  input: z.object({
    csrf: CsrfParam,
    companyId: z
      .string()
      .describe(
        'Company ID (numeric string from salesNavSearchAccounts results)',
      ),
    includeFunctional: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include functional/department headcount breakdown'),
  }),
  output: z.object({
    medianTenure: z
      .number()
      .optional()
      .describe('Median employee tenure in years'),
    monthlyHeadCounts: z
      .array(
        z.object({
          date: z.string().optional().describe('Month date (ISO format)'),
          employeeCount: z.number().optional(),
          monthlyPercentageDifference: z.number().optional(),
        }),
      )
      .optional()
      .describe('Monthly headcount time series (12 months)'),
    functionalHeadCounts: z
      .array(
        z.object({
          displayName: z
            .string()
            .optional()
            .describe('Department name (e.g. "Engineering", "Sales")'),
          employeeCount: z.number().optional(),
          percentageDifference: z.number().optional(),
          history: z
            .array(
              z.object({
                date: z.string().optional(),
                count: z.number().optional(),
              }),
            )
            .optional(),
        }),
      )
      .optional()
      .describe('Headcount breakdown by department/function'),
  }),
};

// ============================================================================
// Sales Navigator Lead Highlights
// ============================================================================

export const salesNavGetLeadHighlightsSchema = {
  name: 'getLeadHighlights',
  description:
    'Get spotlights, shared connections, shared experiences, and warm introduction paths for a lead. Combines profile spotlights, highlights, and warm intro data.',
  notes:
    'Requires Sales Navigator tier. Call getContext() first and pass csrf. Spotlights (past colleague, job change, etc.) are reliably available. Shared connections/experiences/education and warm intros may be unavailable depending on account tier and profile; these fields will be undefined when the endpoints return errors.',
  input: z.object({
    csrf: CsrfParam,
    profileId: z.string().describe('Lead profile ID (ACw... format)'),
  }),
  output: z.object({
    spotlights: z
      .array(
        z.object({
          type: z
            .string()
            .optional()
            .describe(
              'Spotlight type (e.g. "PAST_COLLEAGUE", "RECENTLY_HIRED", "JOB_CHANGE")',
            ),
          displayValue: z
            .string()
            .optional()
            .describe('Human-readable description'),
        }),
      )
      .optional()
      .describe('Profile spotlight badges'),
    sharedConnections: z
      .array(
        z.object({
          profileId: z.string().describe('Connection profile ID'),
          fullName: z
            .string()
            .optional()
            .describe('Full name of the mutual connection'),
        }),
      )
      .optional()
      .describe(
        'Mutual connections with the lead, resolved from the SECOND_DEGREE_CONNECTION spotlight badge',
      ),
    sharedExperiences: z
      .array(
        z.object({
          companyName: z.string().optional(),
          overlapDuration: z.string().optional(),
        }),
      )
      .optional()
      .describe('Shared work experience (past companies in common)'),
    sharedEducations: z
      .array(
        z.object({
          schoolName: z.string().optional(),
        }),
      )
      .optional()
      .describe('Shared education (schools in common)'),
    warmIntros: z
      .array(
        z.object({
          name: z.string().optional(),
          profileId: z.string().optional(),
          title: z.string().optional(),
          seniorityLevel: z
            .string()
            .optional()
            .describe('e.g. CXO_PLUS, DIRECTOR_PLUS, OTHER'),
          sharedConnection: z
            .boolean()
            .optional()
            .describe('Whether this person is a shared connection'),
          teamlink: z.boolean().optional(),
        }),
      )
      .optional()
      .describe('Warm introduction paths via shared connections or TeamLink'),
  }),
};

// ============================================================================
// Recruiter Operations
// ============================================================================
//
// LinkedIn Recruiter (Talent Solutions) is a premium tier like Sales Navigator.
// Entity ids flow from getRecruiterContext() (contractId, seatUrn) and
// listHiringProjects()/getHiringProject() (projectId, sourcingChannelId,
// hiringState urns). Response shapes are decorated/partial, so output schemas
// are intentionally permissive.
//
// NOT BUILDABLE (no captured requestBody): sendInMail, addNote, rejectCandidate,
// moveStage, saveToProject. Only logProfileView has a captured mutation body.

const RecruiterCreditSchema = z.object({
  creditType: z.string().optional().describe('e.g. PROFILE_UNLOCK'),
  creditsGranted: z.number().optional(),
  creditsLeft: z.number().optional(),
});

const RecruiterProjectSchema = z.object({
  projectId: z
    .string()
    .optional()
    .describe('Numeric tail of the ts_hiring_project urn'),
  projectUrn: z.string().optional(),
  name: z.string().optional(),
  state: z.string().optional(),
  title: z.string().optional(),
  companyName: z.string().optional(),
  location: z.string().optional(),
  createdAt: z.number().optional().describe('Epoch milliseconds'),
  ownerName: z.string().optional(),
});

const RecruiterSourcingChannelSchema = z.object({
  channelUrn: z.string().optional(),
  channelId: z.string().optional(),
  name: z.string().optional(),
  channelType: z
    .string()
    .optional()
    .describe('e.g. RECRUITER_SEARCH, AUTOMATED_SOURCING, JOB_POSTING'),
  state: z.string().optional(),
});

const RecruiterCandidateRefSchema = z.object({
  hiringProjectCandidateUrn: z.string().optional(),
  memberProfileUrn: z.string().optional(),
  hiringCandidateUrn: z.string().optional(),
  hireIdentityId: z
    .string()
    .optional()
    .describe('Numeric ts_hire_identity id parsed from the urns'),
  memberToken: z
    .string()
    .optional()
    .describe('AEMAA…/ACoAA… token parsed from the member profile urn'),
});

const RecruiterDateSchema = z.object({
  month: z.number().optional(),
  year: z.number().optional(),
});

const RECRUITER_SEAT_NOTE =
  'Requires a LinkedIn Recruiter seat. Call getContext() first and pass csrf.';

export const recruiterGetRecruiterContextSchema = {
  name: 'getRecruiterContext',
  description:
    'Get the active LinkedIn Recruiter contract, seat, credits, and account/company info. The anchor for all Recruiter operations — every project/candidate id flows from here or from listHiringProjects.',
  notes: `${RECRUITER_SEAT_NOTE} Returns contractId (needed by almost every other Recruiter function), seatUrn, and remaining PROFILE_UNLOCK credits. Throws NotFound when the logged-in member has no Recruiter seat.`,
  input: z.object({ csrf: CsrfParam }),
  output: z.object({
    contractId: z.string().optional(),
    contractUrn: z.string().optional(),
    contractType: z.string().optional().describe('e.g. AGENCY2'),
    contractName: z.string().optional(),
    recruiterProfileUrn: z.string().optional(),
    seatUrn: z.string().optional(),
    seatRoles: z.array(z.string()).optional(),
    credits: z.array(RecruiterCreditSchema).optional(),
    accountUrn: z.string().optional(),
    accountName: z.string().optional(),
    companyUrn: z.string().optional(),
    companyName: z.string().optional(),
    usingMultipleContracts: z.boolean().optional(),
  }),
};

export const recruiterListContractsSchema = {
  name: 'listContracts',
  description:
    'List the LinkedIn Recruiter contracts the logged-in user has access to.',
  notes: `${RECRUITER_SEAT_NOTE} Use when getRecruiterContext().usingMultipleContracts is true to discover the other contract ids.`,
  input: z.object({ csrf: CsrfParam }),
  output: z.object({
    contracts: z.array(
      z.object({
        name: z.string().optional(),
        contractUrn: z.string().optional(),
        contractId: z.string().optional(),
      }),
    ),
  }),
};

export const recruiterListSeatsSchema = {
  name: 'listSeats',
  description:
    'List active seats (recruiter users) on a contract, with each seat holder’s name and current title/company.',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId from getRecruiterContext(). seatId values (parsed from profileUrn’s sibling seat) feed getMailboxMetadata and logProfileView.`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string().describe('Contract id from getRecruiterContext()'),
    namePrefix: z
      .string()
      .optional()
      .describe('Optional name prefix to filter seats by'),
  }),
  output: z.object({
    seats: z.array(
      z.object({
        profileUrn: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        currentTitle: z.string().optional(),
        currentCompany: z.string().optional(),
      }),
    ),
  }),
};

export const recruiterListHiringProjectsSchema = {
  name: 'listHiringProjects',
  description:
    'List hiring projects (pipelines/reqs) sorted by most recently accessed. Returns project id, name, company, location, owner, and creation time.',
  notes: `${RECRUITER_SEAT_NOTE} The primary way to discover projectId values. projectId is the numeric tail of the ts_hiring_project urn; pass it (with contractId) to getHiringProject for sourcing channels and hiring states.`,
  input: z.object({
    csrf: CsrfParam,
    states: z
      .array(z.string())
      .optional()
      .default(['ACTIVE'])
      .describe('Project states to include (e.g. ACTIVE, ARCHIVED, DRAFT)'),
    types: z
      .array(z.string())
      .optional()
      .default(['ATS', 'JOB_POSTING', 'RECRUITER'])
      .describe('Project types to include'),
    count: z.number().optional().default(25),
    start: z.number().optional().default(0),
  }),
  output: z.object({
    projects: z.array(RecruiterProjectSchema),
    total: z.number().optional(),
    hasMore: z.boolean(),
  }),
};

export const recruiterGetHiringProjectSchema = {
  name: 'getHiringProject',
  description:
    'Get full detail for one hiring project: sourcing channels (with channelId), hiring states, candidate counts, and owner. Yields the sourcingChannelId and hiringState urns required by searchCandidates/getSearchFacets/listCandidateRecommendations.',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId + projectId from listHiringProjects(). The decorated read uses POST (decoration string exceeds URL length).`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string(),
    projectId: z.string().describe('Numeric project id from listHiringProjects'),
  }),
  output: z.object({
    projectUrn: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    state: z.string().optional(),
    title: z.string().optional(),
    sourcingChannels: z.array(RecruiterSourcingChannelSchema),
    hiringStates: z.array(z.object({ stateUrn: z.string().optional() })),
    candidateCounts: z.array(
      z.object({
        type: z.string().optional(),
        entity: z.string().optional(),
        count: z.number().optional(),
      }),
    ),
    ownerName: z.string().optional(),
  }),
};

export const recruiterSearchCandidatesSchema = {
  name: 'searchCandidates',
  description:
    'Run a Recruiter talent-pool search within a project + sourcing channel. Reliably returns the total/formattedTotal match count.',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId + projectId + sourcingChannelId (from getHiringProject). IMPORTANT: in captured traffic the per-hit elements were deferred (empty), so only the total count is reliably observed; individual candidate fields are mapped defensively as urn refs and may require getCandidateProfile to hydrate.`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string(),
    projectId: z.string(),
    sourcingChannelId: z
      .string()
      .describe('Sourcing channel id from getHiringProject'),
    sortBy: z
      .string()
      .optional()
      .default('RELEVANCE')
      .describe('capSearchSortBy value, e.g. RELEVANCE'),
  }),
  output: z.object({
    total: z.number().optional(),
    formattedTotal: z.string().optional().describe('e.g. "4.2K+"'),
    candidates: z.array(RecruiterCandidateRefSchema),
  }),
};

export const recruiterListCandidateRecommendationsSchema = {
  name: 'listCandidateRecommendations',
  description:
    'Get "similar to candidate" recommendations within a project. The cleanest candidate enumerator — returns hireIdentityId + memberToken per recommendation.',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId + projectId + sourcingChannelId + idealMemberToken (an AEMAA… token from a known candidate). Parse hireIdentityId/memberToken from the returned urns to feed getCandidateProfile/getProjectCandidate.`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string(),
    projectId: z.string(),
    sourcingChannelId: z.string(),
    idealMemberToken: z
      .string()
      .describe('AEMAA… member token of the ideal/seed candidate'),
    collectionType: z
      .string()
      .optional()
      .default('SIMILAR_TO_CANDIDATE'),
    count: z.number().optional().default(10),
    start: z.number().optional().default(0),
  }),
  output: z.object({
    total: z.number().optional(),
    candidates: z.array(RecruiterCandidateRefSchema),
    hasMore: z.boolean(),
  }),
};

export const recruiterFindSimilarProfilesSchema = {
  name: 'findSimilarProfiles',
  description:
    'Global "similar to profile" recommendations for a member token, not scoped to a project.',
  notes: `${RECRUITER_SEAT_NOTE} Needs only a memberToken (AEMAA…/ACoAA…). Returns urn refs; parse hireIdentityId/memberToken from them.`,
  input: z.object({
    csrf: CsrfParam,
    memberToken: z.string().describe('AEMAA…/ACoAA… member token of the seed profile'),
    count: z.number().optional().default(10),
  }),
  output: z.object({
    total: z.number().optional(),
    candidates: z.array(
      RecruiterCandidateRefSchema.omit({ hiringProjectCandidateUrn: true }),
    ),
    hasMore: z.boolean(),
  }),
};

export const recruiterSearchProfilesByKeywordSchema = {
  name: 'searchProfilesByKeyword',
  description:
    'Free-text profile search across LinkedIn from within Recruiter. Returns basic profile cards (name, headline, current title/company, location, public URL).',
  notes: `${RECRUITER_SEAT_NOTE} Use to resolve a person by name. Returns member profile urns; for full detail use getCandidateProfile with the member token.`,
  input: z.object({
    csrf: CsrfParam,
    keywords: z.string().describe('Free-text search, e.g. a person’s name'),
    count: z.number().optional().default(10),
    start: z.number().optional().default(0),
  }),
  output: z.object({
    profiles: z.array(
      z.object({
        profileUrn: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        headline: z.string().optional(),
        currentTitle: z.string().optional(),
        currentCompany: z.string().optional(),
        location: z.string().optional(),
        publicProfileUrl: z.string().optional(),
      }),
    ),
    hasMore: z.boolean(),
  }),
};

export const recruiterTypeaheadSchema = {
  name: 'typeahead',
  description:
    'Resolve a name fragment to an entity urn via Recruiter typeahead. Used to convert company/title/geo/occupation names into the urns that search and project filters require.',
  notes: `${RECRUITER_SEAT_NOTE} The "type" selects the typeahead endpoint (q=company/title/geo/occupation).`,
  input: z.object({
    csrf: CsrfParam,
    type: z
      .enum(['company', 'title', 'geo', 'occupation'])
      .describe('Typeahead entity type'),
    query: z.string().describe('Name fragment to resolve'),
  }),
  output: z.object({
    results: z.array(
      z.object({
        urn: z.string().optional(),
        displayName: z.string().optional(),
        type: z.string().optional().describe('e.g. typeaheadCompany'),
      }),
    ),
  }),
};

export const recruiterGetSearchFacetsSchema = {
  name: 'getSearchFacets',
  description:
    'Get facet counts (sourcing channel, candidate hiring state, open-to-work) for a project, optionally scoped to specific sourcing channels and hiring states.',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId + projectId. Pass sourcingChannelUrns/hiringStateUrns (from getHiringProject) to scope; omit for project-only facets.`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string(),
    projectId: z.string(),
    sourcingChannelUrns: z
      .array(z.string())
      .optional()
      .describe('Full ts_sourcing_channel urns from getHiringProject'),
    hiringStateUrns: z
      .array(z.string())
      .optional()
      .describe('Full ts_hiring_state urns from getHiringProject'),
  }),
  output: z.object({
    facets: z.array(
      z.object({
        facetType: z.string().optional(),
        values: z.array(
          z.object({
            value: z.string().optional(),
            displayValue: z.string().optional(),
            count: z.number().optional(),
            selected: z.boolean().optional(),
          }),
        ),
      }),
    ),
  }),
};

export const recruiterGetCandidateProfileSchema = {
  name: 'getCandidateProfile',
  description:
    'Get a candidate’s full member profile (headline, summary, skills, education, positions, certifications, contact info) via a member token.',
  notes: `${RECRUITER_SEAT_NOTE} Needs the AEMAA… memberToken + contractId. projectId is optional (scopes the profile to a project; omit for the unscoped ts_hiring_project:0 form).`,
  input: z.object({
    csrf: CsrfParam,
    memberToken: z.string().describe('AEMAA… member token'),
    contractId: z.string(),
    projectId: z
      .string()
      .optional()
      .describe('Optional project id to scope the profile to'),
  }),
  output: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    headline: z.string().optional(),
    location: z.string().optional(),
    summary: z.string().optional(),
    publicProfileUrl: z.string().optional(),
    numConnections: z.number().optional(),
    networkDistance: z.string().optional(),
    skills: z.array(
      z.object({
        name: z.string().optional(),
        endorsementCount: z.number().optional(),
      }),
    ),
    educations: z.array(
      z.object({
        school: z.string().optional(),
        degreeName: z.string().optional(),
        fieldOfStudy: z.string().optional(),
        startYear: z.number().optional(),
        endYear: z.number().optional(),
      }),
    ),
    positions: z.array(
      z.object({
        title: z.string().optional(),
        companyName: z.string().optional(),
        startDate: RecruiterDateSchema.optional(),
        endDate: RecruiterDateSchema.optional(),
        description: z.string().optional(),
        location: z.string().optional(),
      }),
    ),
    certifications: z.array(
      z.object({
        name: z.string().optional(),
        authority: z.string().optional(),
        url: z.string().optional(),
      }),
    ),
    canSendInMail: z.boolean().optional(),
    contactInfo: z.record(z.string(), z.unknown()).optional(),
  }),
};

export const recruiterGetProjectCandidateSchema = {
  name: 'getProjectCandidate',
  description:
    'Get the per-project candidate record (hiring state, inMail cost, notes, feedback, tags, AI evaluation, contact info) keyed by the candidate’s ts_profile token within a project.',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId + profileId (the AEMAA ts_profile token) + projectId. Tolerates empty arrays and downstream 500-injection sub-errors (a count sub-resolver may fail; that is ignored gracefully).`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string(),
    profileId: z.string().describe('ts_profile (AEMAA) token of the candidate'),
    projectId: z.string(),
  }),
  output: z.object({
    hiringProjectCandidateUrn: z.string().optional(),
    hireIdentityId: z.string().optional(),
    candidateHiringState: z.string().optional(),
    inMailCost: z.number().optional(),
    notes: z.array(z.unknown()),
    tags: z.array(z.unknown()),
    feedback: z.array(z.unknown()),
    assessedCandidate: z.object({
      rejectable: z.boolean().optional(),
      exportable: z.boolean().optional(),
    }),
    contactInfo: z.record(z.string(), z.unknown()).optional(),
    candidateEvaluation: z
      .object({
        classification: z.string().optional(),
        summary: z.string().optional(),
        requiredCriteriaMatchCount: z.number().optional(),
        requiredCriteriaCount: z.number().optional(),
        preferredCriteriaMatchCount: z.number().optional(),
        preferredCriteriaCount: z.number().optional(),
      })
      .optional(),
  }),
};

export const recruiterGetCandidatesInProjectSchema = {
  name: 'getCandidatesInProject',
  description:
    'Batch-hydrate known candidates in a project by hire identity id. Returns name, notes, feedback, and assessment per candidate.',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId + projectId + an array of hireIdentityIds (from listCandidateRecommendations or getCandidateActivity). Decoration/body confirmed from captured traffic. Tolerates empty arrays + downstream 500-injection sub-errors.`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string(),
    projectId: z.string(),
    hireIdentityIds: z
      .array(z.string())
      .describe('Numeric ts_hire_identity ids to hydrate'),
  }),
  output: z.object({
    candidates: z.array(
      z.object({
        hireIdentityId: z.string().optional(),
        hiringProjectCandidateUrn: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        notes: z.array(z.unknown()),
        feedback: z.array(z.unknown()),
        assessedCandidate: z.object({ rejectable: z.boolean().optional() }),
      }),
    ),
  }),
};

export const recruiterGetCandidateActivitySchema = {
  name: 'getCandidateActivity',
  description:
    'Get a candidate’s recruiting activity timeline (messages, profile views, hiring-state changes, documents) as activity urns with an inferred type.',
  notes: `${RECRUITER_SEAT_NOTE} Needs a numeric hireIdentityId. Captured traffic returned only activity urns (hydration deferred); activityType is inferred from the urn segment (ts_cap_message → MESSAGE, ts_cap_profile_view → PROFILE_VIEW, etc.).`,
  input: z.object({
    csrf: CsrfParam,
    hireIdentityId: z.string(),
    count: z.number().optional().default(20),
    start: z.number().optional().default(0),
  }),
  output: z.object({
    activities: z.array(
      z.object({
        activityUrn: z.string(),
        activityType: z.string().optional(),
      }),
    ),
  }),
};

export const recruiterGetProfileResumeUrlSchema = {
  name: 'getProfileResumeUrl',
  description:
    'Generate a temporary PDF resume download URL for a candidate profile.',
  notes: `${RECRUITER_SEAT_NOTE} Needs the ts_profile (AEMAA) token. The returned URL is a short-lived signed LinkedIn ambry link.`,
  input: z.object({
    csrf: CsrfParam,
    profileId: z.string().describe('ts_profile (AEMAA) token of the candidate'),
  }),
  output: z.object({
    url: z.string().optional(),
  }),
};

export const recruiterGetMailboxSummarySchema = {
  name: 'getMailboxSummary',
  description:
    'Get the Recruiter inbox summary: unseen count and recent messages with sender, subject, body, and timestamp.',
  notes: RECRUITER_SEAT_NOTE,
  input: z.object({ csrf: CsrfParam }),
  output: z.object({
    numUnseen: z.number().optional(),
    recentMessages: z.array(
      z.object({
        subject: z.string().optional(),
        body: z.string().optional(),
        createdAt: z.number().optional(),
        read: z.boolean().optional(),
        senderName: z.string().optional(),
        senderProfileUrl: z.string().optional(),
      }),
    ),
  }),
};

export const recruiterGetMailboxMetadataSchema = {
  name: 'getMailboxMetadata',
  description:
    'Get mailbox quick-filter metadata (Inbox/Awaiting Reply/Scheduled/Archived with unread counts) for a seat.',
  notes: `${RECRUITER_SEAT_NOTE} Needs a seatId (from listSeats or getRecruiterContext().seatUrn).`,
  input: z.object({
    csrf: CsrfParam,
    seatId: z.string().describe('Numeric ts_seat id'),
  }),
  output: z.object({
    filters: z.array(
      z.object({
        name: z.string().optional(),
        displayName: z.string().optional(),
        unreadCount: z.number().optional(),
      }),
    ),
    hasDelegatedMailbox: z.boolean().optional(),
  }),
};

export const recruiterGetConversationSchema = {
  name: 'getConversation',
  description:
    'Fetch a Recruiter conversation by urn. Thin: captured traffic only returned a resolved-ref, so this returns the conversation urn plus the best-effort raw resolver object.',
  notes: `${RECRUITER_SEAT_NOTE} Needs a conversationUrn (e.g. ts_mail_thread:…) + the owning seatId. Message hydration was not observed in captures; inspect "raw" for available fields.`,
  input: z.object({
    csrf: CsrfParam,
    conversationUrn: z.string(),
    seatId: z.string().describe('Numeric ts_seat id that owns the mailbox'),
    count: z.number().optional().default(15),
    start: z.number().optional().default(0),
  }),
  output: z.object({
    conversationUrn: z.string(),
    messages: z.array(z.unknown()).optional(),
    raw: z.unknown().optional(),
  }),
};

export const recruiterGetCandidateMessagesSchema = {
  name: 'getCandidateMessages',
  description:
    'List message urns in a candidate message thread. Thin: returns urns only (message body hydration was not captured).',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId (for the thread urn the caller supplies), a numeric hireIdentityId, and the full threadUrn. Returns ts_candidate_message urns; body hydration not captured.`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string(),
    hireIdentityId: z.string(),
    threadUrn: z
      .string()
      .describe('Full ts_candidate_message_thread urn for the candidate'),
    count: z.number().optional().default(50),
    start: z.number().optional().default(0),
  }),
  output: z.object({
    messageUrns: z.array(z.string()),
  }),
};

export const recruiterListSourcingChannelsSchema = {
  name: 'listSourcingChannels',
  description:
    'List sourcing channel urns for a project via GraphQL. Prefer getHiringProject for decorated channel info (name/type); this returns urns/ids only.',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId + projectId. Returns ts_sourcing_channel urns; getHiringProject is richer.`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string(),
    projectId: z.string(),
    types: z.array(z.string()).optional().default(['APPLY_STARTERS']),
    states: z.array(z.string()).optional().default(['ACTIVE']),
    count: z.number().optional().default(10),
  }),
  output: z.object({
    channels: z.array(
      z.object({
        channelUrn: z.string(),
        channelId: z.string().optional(),
      }),
    ),
  }),
};

export const recruiterListNotificationsSchema = {
  name: 'listRecruiterNotifications',
  description:
    'List Recruiter notification cards (new applicants, etc.) with text, published time, and an action url.',
  notes: RECRUITER_SEAT_NOTE,
  input: z.object({
    csrf: CsrfParam,
    count: z.number().optional().default(13),
    onlyUnseen: z.boolean().optional().default(false),
    start: z.number().optional().default(0),
  }),
  output: z.object({
    numUnseen: z.number().optional(),
    notifications: z.array(
      z.object({
        text: z.string().optional(),
        subHeadline: z.string().optional(),
        publishedAt: z.number().optional(),
        actionUrl: z.string().optional(),
        actionText: z.string().optional(),
      }),
    ),
    hasMore: z.boolean(),
  }),
};

export const recruiterListRecruiterTagsSchema = {
  name: 'listRecruiterTags',
  description:
    'List the prospect/candidate tags defined on the contract (id, label, type).',
  notes: RECRUITER_SEAT_NOTE,
  input: z.object({
    csrf: CsrfParam,
    count: z.number().optional().default(50),
  }),
  output: z.object({
    tags: z.array(
      z.object({
        tagId: z.string().optional(),
        tag: z.string().optional(),
        type: z.string().optional().describe('e.g. PROSPECT_TAG'),
        contractUrn: z.string().optional(),
      }),
    ),
  }),
};

export const recruiterLogProfileViewSchema = {
  name: 'logProfileView',
  description:
    'Log a candidate profile view (the same telemetry the Recruiter UI fires when opening a profile). Rate-limited because it can consume a profile view.',
  notes: `${RECRUITER_SEAT_NOTE} Needs contractId, seatId, hireIdentityId, projectId, and sourcingChannelId (all derivable from getRecruiterContext + getHiringProject + a candidate enumerator). Returns { success: true } on the upstream 201.`,
  input: z.object({
    csrf: CsrfParam,
    contractId: z.string(),
    seatId: z.string(),
    hireIdentityId: z.string(),
    projectId: z.string(),
    sourcingChannelId: z.string(),
    entryPointType: z
      .string()
      .optional()
      .default('SEARCH_CONTEXTUAL')
      .describe('profileViewEntryPointType, e.g. SEARCH_CONTEXTUAL'),
    commandName: z.string().optional().default('FETCH_PROFILE'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  getMeSchema,
  getProfileByVanityNameSchema,
  getFullProfileSchema,
  getContactInfoSchema,
  getProfileBadgesSchema,
  downloadProfilePictureSchema,
  searchPeopleSchema,
  searchCompaniesSchema,
  listConnectionsSchema,
  getMemberRelationshipSchema,
  sendConnectionRequestSchema,
  getInvitationsSummarySchema,
  listConnectionRequestsSchema,
  listInvitationsSchema,
  handleInvitationActionSchema,
  listSentConnectionRequestsSchema,
  withdrawConnectionRequestSchema,
  removeConnectionSchema,
  getCompanySchema,
  getCompanyFollowingStateSchema,
  updateFollowingStateSchema,
  getCompanyPostsSchema,
  getHomeFeedSchema,
  getPostsSchema,
  getProfileCommentsSchema,
  getProfileReactionsSchema,
  getPostReactionsSchema,
  getCommentReactionsSchema,
  getPostCommentsSchema,
  likePostSchema,
  unlikePostSchema,
  createPostSchema,
  deletePostSchema,
  editPostSchema,
  repostPostSchema,
  undoRepostSchema,
  schedulePostSchema,
  listScheduledPostsSchema,
  editScheduledPostSchema,
  reschedulePostSchema,
  createCommentSchema,
  editCommentSchema,
  deleteCommentSchema,
  likeCommentSchema,
  unlikeCommentSchema,
  searchPostsSchema,
  getProfileViewsSummarySchema,
  getSocialSellingIndexSchema,
  listProfileViewersSchema,
  getCreatorAnalyticsSummarySchema,
  getContentAnalyticsSchema,
  getAudienceDemographicsSchema,
  getCompanyPageAnalyticsSchema,
  listAdminCompaniesSchema,
  getAvailableActorsSchema,
  listCompanyPageViewersSchema,
  searchJobsSchema,
  resolveGeoSchema,
  resolveIndustrySchema,
  resolveSchoolSchema,
  resolveCompanyIdSchema,
  listConversationsSchema,
  viewConversationSchema,
  getConversationWithUserSchema,
  sendMessageSchema,
  createGroupChatSchema,
  renameGroupChatSchema,
  getComposeOptionsSchema,
  editMessageSchema,
  deleteMessageSchema,
  reactToMessageSchema,
  unreactToMessageSchema,
  markAllConversationsAsReadSchema,
  markConversationAsReadSchema,
  downloadAttachmentSchema,
  listNotificationsSchema,
  getNotificationCountsSchema,
  salesNavSearchLeadsSchema,
  salesNavSearchAccountsSchema,
  salesNavGetLeadProfileSchema,
  salesNavGetLeadTimelineSchema,
  salesNavGetAccountDetailSchema,
  salesNavGetAccountLeadsSchema,
  salesNavListLeadListsSchema,
  salesNavListAccountListsSchema,
  salesNavGetLeadsInListSchema,
  salesNavCreateListSchema,
  salesNavDeleteListSchema,
  salesNavSaveLeadSchema,
  salesNavUnsaveLeadSchema,
  salesNavUpdateListSchema,
  salesNavGetAccountsInListSchema,
  salesNavAddLeadToListSchema,
  salesNavRemoveLeadFromListSchema,
  salesNavAddAccountToListSchema,
  salesNavRemoveAccountFromListSchema,
  salesNavSaveAccountSchema,
  salesNavUnsaveAccountSchema,
  salesNavGetLeadNotesSchema,
  salesNavGetAccountNotesSchema,
  salesNavCreateNoteSchema,
  salesNavUpdateNoteSchema,
  salesNavDeleteNoteSchema,
  salesNavListInMailThreadsSchema,
  salesNavViewInMailThreadSchema,
  salesNavSendInMailSchema,
  salesNavListSavedSearchesSchema,
  salesNavListNotificationsSchema,
  salesNavGetInMailCreditsSchema,
  salesNavSearchFilterValuesSchema,
  salesNavGetAccountDossierSchema,
  salesNavGetAccountHeadcountSchema,
  salesNavGetLeadHighlightsSchema,
  // Recruiter (Talent Solutions) operations
  recruiterGetRecruiterContextSchema,
  recruiterListContractsSchema,
  recruiterListSeatsSchema,
  recruiterListHiringProjectsSchema,
  recruiterGetHiringProjectSchema,
  recruiterSearchCandidatesSchema,
  recruiterListCandidateRecommendationsSchema,
  recruiterFindSimilarProfilesSchema,
  recruiterSearchProfilesByKeywordSchema,
  recruiterTypeaheadSchema,
  recruiterGetSearchFacetsSchema,
  recruiterGetCandidateProfileSchema,
  recruiterGetProjectCandidateSchema,
  recruiterGetCandidatesInProjectSchema,
  recruiterGetCandidateActivitySchema,
  recruiterGetProfileResumeUrlSchema,
  recruiterGetMailboxSummarySchema,
  recruiterGetMailboxMetadataSchema,
  recruiterGetConversationSchema,
  recruiterGetCandidateMessagesSchema,
  recruiterListSourcingChannelsSchema,
  recruiterListNotificationsSchema,
  recruiterListRecruiterTagsSchema,
  recruiterLogProfileViewSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Entity types
export type Profile = z.infer<typeof ProfileSchema>;
export type FullProfile = z.infer<typeof FullProfileSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type Company = z.infer<typeof CompanySchema>;
export type Post = z.infer<typeof PostSchema>;
export type Reactor = z.infer<typeof ReactorSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type SalesNavLead = z.infer<typeof SearchLeadsSchema>;
export type SalesNavAccount = z.infer<typeof SearchAccountsSchema>;
export type SalesNavLeadProfile = z.infer<typeof LeadProfileSchema>;
export type SalesNavLeadActivity = z.infer<typeof LeadActivitySchema>;
export type SalesNavAccountDetail = z.infer<typeof AccountDetailSchema>;
export type SalesNavLeadList = z.infer<typeof LeadListSchema>;
export type SalesNavAccountList = z.infer<typeof AccountListSchema>;
export type SalesNavNote = z.infer<typeof NoteSchema>;
export type SalesNavMessageThread = z.infer<typeof MessageThreadSchema>;
export type SalesNavThreadMessage = z.infer<typeof ThreadMessageSchema>;
export type SalesNavSavedSearch = z.infer<typeof SavedSearchSchema>;
export type SalesNavNotification = z.infer<typeof SalesNavNotificationSchema>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type GetMeOutput = z.infer<typeof getMeSchema.output>;
export type GetProfileByVanityNameOutput = z.infer<
  typeof getProfileByVanityNameSchema.output
>;
export type GetFullProfileInput = z.infer<typeof getFullProfileSchema.input>;
export type GetFullProfileOutput = z.infer<typeof getFullProfileSchema.output>;
export type GetContactInfoOutput = z.infer<typeof getContactInfoSchema.output>;
export type GetProfileBadgesOutput = z.infer<
  typeof getProfileBadgesSchema.output
>;
export type DownloadProfilePictureOutput = z.infer<
  typeof downloadProfilePictureSchema.output
>;
export type SearchPeopleOutput = z.infer<typeof searchPeopleSchema.output>;
export type SearchCompaniesOutput = z.infer<
  typeof searchCompaniesSchema.output
>;
export type ListConnectionsOutput = z.infer<
  typeof listConnectionsSchema.output
>;
export type SendConnectionRequestOutput = z.infer<
  typeof sendConnectionRequestSchema.output
>;
export type GetInvitationsSummaryOutput = z.infer<
  typeof getInvitationsSummarySchema.output
>;
export type ListConnectionRequestsOutput = z.infer<
  typeof listConnectionRequestsSchema.output
>;
export type ListInvitationsOutput = z.infer<
  typeof listInvitationsSchema.output
>;
export type GetCompanyOutput = z.infer<typeof getCompanySchema.output>;
export type GetCompanyFollowingStateOutput = z.infer<
  typeof getCompanyFollowingStateSchema.output
>;
export type GetCompanyPostsOutput = z.infer<
  typeof getCompanyPostsSchema.output
>;
export type GetHomeFeedOutput = z.infer<typeof getHomeFeedSchema.output>;
export type ListConversationsOutput = z.infer<
  typeof listConversationsSchema.output
>;
export type ViewConversationOutput = z.infer<
  typeof viewConversationSchema.output
>;
export type GetConversationWithUserOutput = z.infer<
  typeof getConversationWithUserSchema.output
>;
export type SendMessageOutput = z.infer<typeof sendMessageSchema.output>;
export type CreateGroupChatOutput = z.infer<
  typeof createGroupChatSchema.output
>;
export type RenameGroupChatOutput = z.infer<
  typeof renameGroupChatSchema.output
>;
export type GetComposeOptionsOutput = z.infer<
  typeof getComposeOptionsSchema.output
>;
export type LikePostOutput = z.infer<typeof likePostSchema.output>;
export type UnlikePostOutput = z.infer<typeof unlikePostSchema.output>;
export type CreateCommentOutput = z.infer<typeof createCommentSchema.output>;
export type EditCommentOutput = z.infer<typeof editCommentSchema.output>;
export type DeleteCommentOutput = z.infer<typeof deleteCommentSchema.output>;
export type GetPostsOutput = z.infer<typeof getPostsSchema.output>;
export type GetProfileCommentsOutput = z.infer<
  typeof getProfileCommentsSchema.output
>;
export type GetProfileReactionsOutput = z.infer<
  typeof getProfileReactionsSchema.output
>;
export type GetPostReactionsOutput = z.infer<
  typeof getPostReactionsSchema.output
>;
export type GetCommentReactionsOutput = z.infer<
  typeof getCommentReactionsSchema.output
>;
export type GetPostCommentsOutput = z.infer<
  typeof getPostCommentsSchema.output
>;
export type EditMessageOutput = z.infer<typeof editMessageSchema.output>;
export type DeleteMessageOutput = z.infer<typeof deleteMessageSchema.output>;
export type ReactToMessageOutput = z.infer<typeof reactToMessageSchema.output>;
export type UnreactToMessageOutput = z.infer<
  typeof unreactToMessageSchema.output
>;
export type DownloadAttachmentOutput = z.infer<
  typeof downloadAttachmentSchema.output
>;
export type LikeCommentOutput = z.infer<typeof likeCommentSchema.output>;
export type UnlikeCommentOutput = z.infer<typeof unlikeCommentSchema.output>;
export type ListSentConnectionRequestsOutput = z.infer<
  typeof listSentConnectionRequestsSchema.output
>;
export type WithdrawConnectionRequestOutput = z.infer<
  typeof withdrawConnectionRequestSchema.output
>;
export type RemoveConnectionOutput = z.infer<
  typeof removeConnectionSchema.output
>;
export type CreatePostOutput = z.infer<typeof createPostSchema.output>;
export type DeletePostOutput = z.infer<typeof deletePostSchema.output>;
export type EditPostOutput = z.infer<typeof editPostSchema.output>;
export type RepostPostOutput = z.infer<typeof repostPostSchema.output>;
export type UndoRepostOutput = z.infer<typeof undoRepostSchema.output>;
export type SchedulePostOutput = z.infer<typeof schedulePostSchema.output>;
export type ListScheduledPostsOutput = z.infer<
  typeof listScheduledPostsSchema.output
>;
export type ScheduledPost = z.infer<typeof ScheduledPostSchema>;
export type EditScheduledPostOutput = z.infer<
  typeof editScheduledPostSchema.output
>;
export type ReschedulePostOutput = z.infer<typeof reschedulePostSchema.output>;
export type SearchPostsOutput = z.infer<typeof searchPostsSchema.output>;
export type GetProfileViewsSummaryOutput = z.infer<
  typeof getProfileViewsSummarySchema.output
>;
export type ListProfileViewersOutput = z.infer<
  typeof listProfileViewersSchema.output
>;
export type SearchJobsOutput = z.infer<typeof searchJobsSchema.output>;
export type ListNotificationsOutput = z.infer<
  typeof listNotificationsSchema.output
>;
export type GetNotificationCountsOutput = z.infer<
  typeof getNotificationCountsSchema.output
>;
export type ResolveGeoOutput = z.infer<typeof resolveGeoSchema.output>;
export type ResolveIndustryOutput = z.infer<
  typeof resolveIndustrySchema.output
>;
export type ResolveSchoolOutput = z.infer<typeof resolveSchoolSchema.output>;
export type ResolveCompanyIdOutput = z.infer<
  typeof resolveCompanyIdSchema.output
>;

// Sales Navigator entity types
export type LeadResult = z.infer<typeof SearchLeadsSchema>;
export type AccountResult = z.infer<typeof SearchAccountsSchema>;

// Sales Navigator Input/Output types
export type SearchLeadsInput = z.infer<typeof salesNavSearchLeadsSchema.input>;
export type SearchLeadsOutput = z.infer<
  typeof salesNavSearchLeadsSchema.output
>;
export type SearchAccountsInput = z.infer<
  typeof salesNavSearchAccountsSchema.input
>;
export type SearchAccountsOutput = z.infer<
  typeof salesNavSearchAccountsSchema.output
>;
export type GetLeadProfileInput = z.infer<
  typeof salesNavGetLeadProfileSchema.input
>;
export type GetLeadProfileOutput = z.infer<
  typeof salesNavGetLeadProfileSchema.output
>;
export type GetLeadTimelineInput = z.infer<
  typeof salesNavGetLeadTimelineSchema.input
>;
export type GetLeadTimelineOutput = z.infer<
  typeof salesNavGetLeadTimelineSchema.output
>;
export type GetAccountDetailInput = z.infer<
  typeof salesNavGetAccountDetailSchema.input
>;
export type GetAccountDetailOutput = z.infer<
  typeof salesNavGetAccountDetailSchema.output
>;
export type GetAccountLeadsInput = z.infer<
  typeof salesNavGetAccountLeadsSchema.input
>;
export type GetAccountLeadsOutput = z.infer<
  typeof salesNavGetAccountLeadsSchema.output
>;
export type ListLeadListsInput = z.infer<
  typeof salesNavListLeadListsSchema.input
>;
export type ListLeadListsOutput = z.infer<
  typeof salesNavListLeadListsSchema.output
>;
export type ListAccountListsInput = z.infer<
  typeof salesNavListAccountListsSchema.input
>;
export type ListAccountListsOutput = z.infer<
  typeof salesNavListAccountListsSchema.output
>;
export type GetLeadsInListInput = z.infer<
  typeof salesNavGetLeadsInListSchema.input
>;
export type GetLeadsInListOutput = z.infer<
  typeof salesNavGetLeadsInListSchema.output
>;
export type CreateListInput = z.infer<typeof salesNavCreateListSchema.input>;
export type CreateListOutput = z.infer<typeof salesNavCreateListSchema.output>;
export type DeleteListInput = z.infer<typeof salesNavDeleteListSchema.input>;
export type DeleteListOutput = z.infer<typeof salesNavDeleteListSchema.output>;
export type SaveLeadInput = z.infer<typeof salesNavSaveLeadSchema.input>;
export type SaveLeadOutput = z.infer<typeof salesNavSaveLeadSchema.output>;
export type UnsaveLeadInput = z.infer<typeof salesNavUnsaveLeadSchema.input>;
export type UnsaveLeadOutput = z.infer<typeof salesNavUnsaveLeadSchema.output>;
export type UpdateListInput = z.infer<typeof salesNavUpdateListSchema.input>;
export type UpdateListOutput = z.infer<typeof salesNavUpdateListSchema.output>;
export type GetAccountsInListInput = z.infer<
  typeof salesNavGetAccountsInListSchema.input
>;
export type GetAccountsInListOutput = z.infer<
  typeof salesNavGetAccountsInListSchema.output
>;
export type AddLeadToListInput = z.infer<
  typeof salesNavAddLeadToListSchema.input
>;
export type AddLeadToListOutput = z.infer<
  typeof salesNavAddLeadToListSchema.output
>;
export type RemoveLeadFromListInput = z.infer<
  typeof salesNavRemoveLeadFromListSchema.input
>;
export type RemoveLeadFromListOutput = z.infer<
  typeof salesNavRemoveLeadFromListSchema.output
>;
export type AddAccountToListInput = z.infer<
  typeof salesNavAddAccountToListSchema.input
>;
export type AddAccountToListOutput = z.infer<
  typeof salesNavAddAccountToListSchema.output
>;
export type RemoveAccountFromListInput = z.infer<
  typeof salesNavRemoveAccountFromListSchema.input
>;
export type RemoveAccountFromListOutput = z.infer<
  typeof salesNavRemoveAccountFromListSchema.output
>;
export type SaveAccountInput = z.infer<typeof salesNavSaveAccountSchema.input>;
export type SaveAccountOutput = z.infer<
  typeof salesNavSaveAccountSchema.output
>;
export type UnsaveAccountInput = z.infer<
  typeof salesNavUnsaveAccountSchema.input
>;
export type UnsaveAccountOutput = z.infer<
  typeof salesNavUnsaveAccountSchema.output
>;
export type GetLeadNotesInput = z.infer<
  typeof salesNavGetLeadNotesSchema.input
>;
export type GetLeadNotesOutput = z.infer<
  typeof salesNavGetLeadNotesSchema.output
>;
export type GetAccountNotesInput = z.infer<
  typeof salesNavGetAccountNotesSchema.input
>;
export type GetAccountNotesOutput = z.infer<
  typeof salesNavGetAccountNotesSchema.output
>;
export type CreateNoteInput = z.infer<typeof salesNavCreateNoteSchema.input>;
export type CreateNoteOutput = z.infer<typeof salesNavCreateNoteSchema.output>;
export type UpdateNoteInput = z.infer<typeof salesNavUpdateNoteSchema.input>;
export type UpdateNoteOutput = z.infer<typeof salesNavUpdateNoteSchema.output>;
export type DeleteNoteInput = z.infer<typeof salesNavDeleteNoteSchema.input>;
export type DeleteNoteOutput = z.infer<typeof salesNavDeleteNoteSchema.output>;
export type ListInMailThreadsInput = z.infer<
  typeof salesNavListInMailThreadsSchema.input
>;
export type ListInMailThreadsOutput = z.infer<
  typeof salesNavListInMailThreadsSchema.output
>;
export type ViewInMailThreadInput = z.infer<
  typeof salesNavViewInMailThreadSchema.input
>;
export type ViewInMailThreadOutput = z.infer<
  typeof salesNavViewInMailThreadSchema.output
>;
export type SendInMailInput = z.infer<typeof salesNavSendInMailSchema.input>;
export type SendInMailOutput = z.infer<typeof salesNavSendInMailSchema.output>;
export type ListSavedSearchesInput = z.infer<
  typeof salesNavListSavedSearchesSchema.input
>;
export type ListSavedSearchesOutput = z.infer<
  typeof salesNavListSavedSearchesSchema.output
>;
export type ListSalesNavNotificationsInput = z.infer<
  typeof salesNavListNotificationsSchema.input
>;
export type ListSalesNavNotificationsOutput = z.infer<
  typeof salesNavListNotificationsSchema.output
>;
export type GetInMailCreditsInput = z.infer<
  typeof salesNavGetInMailCreditsSchema.input
>;
export type GetInMailCreditsOutput = z.infer<
  typeof salesNavGetInMailCreditsSchema.output
>;
export type SearchFilterValuesInput = z.infer<
  typeof salesNavSearchFilterValuesSchema.input
>;
export type SearchFilterValuesOutput = z.infer<
  typeof salesNavSearchFilterValuesSchema.output
>;
export type GetAccountDossierInput = z.infer<
  typeof salesNavGetAccountDossierSchema.input
>;
export type GetAccountDossierOutput = z.infer<
  typeof salesNavGetAccountDossierSchema.output
>;
export type GetAccountHeadcountInput = z.infer<
  typeof salesNavGetAccountHeadcountSchema.input
>;
export type GetAccountHeadcountOutput = z.infer<
  typeof salesNavGetAccountHeadcountSchema.output
>;
export type GetLeadHighlightsInput = z.infer<
  typeof salesNavGetLeadHighlightsSchema.input
>;
export type GetLeadHighlightsOutput = z.infer<
  typeof salesNavGetLeadHighlightsSchema.output
>;

// Recruiter (Talent Solutions) Input/Output types
export type GetRecruiterContextInput = z.infer<
  typeof recruiterGetRecruiterContextSchema.input
>;
export type GetRecruiterContextOutput = z.infer<
  typeof recruiterGetRecruiterContextSchema.output
>;
export type ListContractsInput = z.infer<
  typeof recruiterListContractsSchema.input
>;
export type ListContractsOutput = z.infer<
  typeof recruiterListContractsSchema.output
>;
export type ListSeatsInput = z.infer<typeof recruiterListSeatsSchema.input>;
export type ListSeatsOutput = z.infer<typeof recruiterListSeatsSchema.output>;
export type ListHiringProjectsInput = z.infer<
  typeof recruiterListHiringProjectsSchema.input
>;
export type ListHiringProjectsOutput = z.infer<
  typeof recruiterListHiringProjectsSchema.output
>;
export type GetHiringProjectInput = z.infer<
  typeof recruiterGetHiringProjectSchema.input
>;
export type GetHiringProjectOutput = z.infer<
  typeof recruiterGetHiringProjectSchema.output
>;
export type SearchCandidatesInput = z.infer<
  typeof recruiterSearchCandidatesSchema.input
>;
export type SearchCandidatesOutput = z.infer<
  typeof recruiterSearchCandidatesSchema.output
>;
export type ListCandidateRecommendationsInput = z.infer<
  typeof recruiterListCandidateRecommendationsSchema.input
>;
export type ListCandidateRecommendationsOutput = z.infer<
  typeof recruiterListCandidateRecommendationsSchema.output
>;
export type FindSimilarProfilesInput = z.infer<
  typeof recruiterFindSimilarProfilesSchema.input
>;
export type FindSimilarProfilesOutput = z.infer<
  typeof recruiterFindSimilarProfilesSchema.output
>;
export type SearchProfilesByKeywordInput = z.infer<
  typeof recruiterSearchProfilesByKeywordSchema.input
>;
export type SearchProfilesByKeywordOutput = z.infer<
  typeof recruiterSearchProfilesByKeywordSchema.output
>;
export type RecruiterTypeaheadInput = z.infer<
  typeof recruiterTypeaheadSchema.input
>;
export type RecruiterTypeaheadOutput = z.infer<
  typeof recruiterTypeaheadSchema.output
>;
export type GetSearchFacetsInput = z.infer<
  typeof recruiterGetSearchFacetsSchema.input
>;
export type GetSearchFacetsOutput = z.infer<
  typeof recruiterGetSearchFacetsSchema.output
>;
export type GetCandidateProfileInput = z.infer<
  typeof recruiterGetCandidateProfileSchema.input
>;
export type GetCandidateProfileOutput = z.infer<
  typeof recruiterGetCandidateProfileSchema.output
>;
export type GetProjectCandidateInput = z.infer<
  typeof recruiterGetProjectCandidateSchema.input
>;
export type GetProjectCandidateOutput = z.infer<
  typeof recruiterGetProjectCandidateSchema.output
>;
export type GetCandidatesInProjectInput = z.infer<
  typeof recruiterGetCandidatesInProjectSchema.input
>;
export type GetCandidatesInProjectOutput = z.infer<
  typeof recruiterGetCandidatesInProjectSchema.output
>;
export type GetCandidateActivityInput = z.infer<
  typeof recruiterGetCandidateActivitySchema.input
>;
export type GetCandidateActivityOutput = z.infer<
  typeof recruiterGetCandidateActivitySchema.output
>;
export type GetProfileResumeUrlInput = z.infer<
  typeof recruiterGetProfileResumeUrlSchema.input
>;
export type GetProfileResumeUrlOutput = z.infer<
  typeof recruiterGetProfileResumeUrlSchema.output
>;
export type GetMailboxSummaryInput = z.infer<
  typeof recruiterGetMailboxSummarySchema.input
>;
export type GetMailboxSummaryOutput = z.infer<
  typeof recruiterGetMailboxSummarySchema.output
>;
export type GetMailboxMetadataInput = z.infer<
  typeof recruiterGetMailboxMetadataSchema.input
>;
export type GetMailboxMetadataOutput = z.infer<
  typeof recruiterGetMailboxMetadataSchema.output
>;
export type GetRecruiterConversationInput = z.infer<
  typeof recruiterGetConversationSchema.input
>;
export type GetRecruiterConversationOutput = z.infer<
  typeof recruiterGetConversationSchema.output
>;
export type GetCandidateMessagesInput = z.infer<
  typeof recruiterGetCandidateMessagesSchema.input
>;
export type GetCandidateMessagesOutput = z.infer<
  typeof recruiterGetCandidateMessagesSchema.output
>;
export type ListSourcingChannelsInput = z.infer<
  typeof recruiterListSourcingChannelsSchema.input
>;
export type ListSourcingChannelsOutput = z.infer<
  typeof recruiterListSourcingChannelsSchema.output
>;
export type ListRecruiterNotificationsInput = z.infer<
  typeof recruiterListNotificationsSchema.input
>;
export type ListRecruiterNotificationsOutput = z.infer<
  typeof recruiterListNotificationsSchema.output
>;
export type ListRecruiterTagsInput = z.infer<
  typeof recruiterListRecruiterTagsSchema.input
>;
export type ListRecruiterTagsOutput = z.infer<
  typeof recruiterListRecruiterTagsSchema.output
>;
export type LogProfileViewInput = z.infer<
  typeof recruiterLogProfileViewSchema.input
>;
export type LogProfileViewOutput = z.infer<
  typeof recruiterLogProfileViewSchema.output
>;

