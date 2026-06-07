import { z } from 'zod';

export const libraryDescription =
  'Gong revenue intelligence operations: calls, transcripts, deals, and AI insights via internal APIs';

export const libraryIcon = '/icons/libs/gong.png';
export const loginUrl = 'https://app.gong.io';

export const libraryNotes = `
## Workflow

1. Navigate to any Gong page (e.g., \`https://app.gong.io/home\`)
2. Call \`getContext()\` to verify login and get workspace info
3. Call other functions directly; auth is handled automatically

## Key Concepts

- **Implicit Auth**: All functions auto-fetch CSRF tokens internally. No need to pass auth params.
- **Workspace Scoping**: All requests are scoped to the current workspace automatically.
- **IDs**: All Gong-native IDs are 19-digit numeric strings (calls, users, accounts, deals, flows).
- **Calls**: Recorded meetings with transcripts, AI summaries, and participant data.
- **Ask Anything**: AI Q&A that can answer questions about a specific call's content.
- **Engage**: CRM-style module covering accounts (companies), people (contacts), deals, and flows (email sequences). Engage accounts and people are separate from call participants; they are the company's pipeline.
- **Deals**: Two deal contexts exist: Engage deals (AE home view) and the Deals Board (pipeline board with stage/close-date filtering). Use \`listDeals\` for the pipeline board.
- **Forecast**: Revenue forecast aggregated by period (quarter/month) and category (Commit, Best Case, Pipeline). Call \`getForecastBoards\` first to get the boardId.
- **Flows**: Sequences of automated steps for outreach. Listed globally; not tied to a single deal or person.
- **Smart Trackers**: Workspace-configured keyword/phrase monitors that automatically flag matching transcript segments.
- **Team Stats**: Call activity metrics scoped to a team leader's direct reports. Pass userId from \`getContext()\` to see your own team.

## Modules at a Glance

| Domain | Functions |
|--------|-----------|
| Calls & Transcripts | Search calls, get transcript, AI spotlight, ask questions |
| Engage Accounts | List/get company accounts in the pipeline |
| Engage People | List contacts in the pipeline |
| Users | List all workspace users |
| Deals | Pipeline board deals with stage and close-date filters |
| Forecast | Forecast deals and category rollup totals |
| Flows | Engage sequences (list only) |
| Team Stats | Per-user and aggregated activity metrics |
| Smart Trackers | Keyword/phrase monitors configured in the workspace |

## Pagination

Calls use offset-based pagination (\`offset\`, \`pageSize\`). Default page size is 25.
Accounts return all results in a single response (no pagination). People use \`pageNumber\` (1-indexed) + \`pageSize\` (default 100).

## Known Limitations

- **Call bookmarks, comments, and pins cannot be created programmatically.** No API endpoint exists for creating or managing call bookmarks/comments/pins. These are UI-only features. Do not attempt to discover endpoints for this; none exist.
`;

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Verify login and get workspace context. All other functions handle auth automatically.',
  notes:
    'Call first to confirm user is logged in. Returns workspace and user info for reference.',
  input: z.object({}),
  output: z.object({
    workspaceId: z.string().describe('Current workspace ID'),
    companyId: z.string().describe('Company ID'),
    userId: z.string().describe('Current user ID'),
    workspaceName: z.string().describe('Workspace display name'),
    companyName: z.string().optional().describe('Company display name'),
    workspaces: z
      .array(
        z.object({
          id: z.string().describe('Workspace ID'),
          name: z.string().describe('Workspace name'),
        }),
      )
      .optional()
      .describe(
        'All workspaces the user has access to. Useful for multi-workspace accounts.',
      ),
    isRecruiting: z
      .boolean()
      .optional()
      .describe('Whether the current workspace is a recruiting workspace'),
  }),
};

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Calls & Transcripts
// ============================================================================

const CallParticipantSchema = z.object({
  id: z
    .string()
    .nullable()
    .describe('Participant user ID (null for external participants)'),
  name: z.string().describe('Participant display name'),
  email: z.string().optional().describe('Participant email'),
  title: z.string().optional().describe('Participant job title'),
  affiliation: z
    .enum(['COMPANY', 'NON_COMPANY'])
    .describe(
      'COMPANY = internal team member, NON_COMPANY = external participant',
    ),
});

const CallTopicSchema = z.object({
  name: z
    .string()
    .describe('Topic name (e.g., Pricing, Next Steps, Small Talk)'),
  coveragePercent: z
    .number()
    .describe('Percentage of call time spent on this topic'),
});

const CallItemSchema = z.object({
  id: z.string().describe('Call ID (19-digit numeric string)'),
  title: z.string().describe('Call title'),
  activityTime: z
    .string()
    .describe('Call time in user timezone (format: YYYY/MM/DD HH:mm:ss)'),
  duration: z.number().describe('Call duration in seconds'),
  language: z.string().optional().describe('Detected language'),
  participants: z.array(CallParticipantSchema).describe('Call participants'),
  topics: z
    .array(CallTopicSchema)
    .describe('Detected conversation topics with coverage'),
  isPrivate: z.boolean().optional().describe('Whether call is private'),
});

export const listCallsSchema = {
  name: 'listCalls',
  description:
    'Search and list recorded calls with optional filters. Returns call metadata including title, date, duration, and participants.',
  notes:
    'Returns call IDs needed for getCallTranscript, getCall, getCallSpotlight, and askCallQuestion. Default sort is by date descending. WARNING: participant lists from this search endpoint are often incomplete; organizers and some attendees may be missing. Use getCall for authoritative participant data when participant membership matters.',
  input: z.object({
    searchText: z
      .string()
      .optional()
      .default('')
      .describe('Full-text search query across call transcripts'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (0-indexed)'),
    pageSize: z
      .number()
      .optional()
      .default(25)
      .describe('Number of results per page'),
    sortField: z
      .enum([
        'date',
        'durationSec',
        'crmData.accounts.opportunities.opportunityAtActivityTime.stage',
        'crmData.accounts.opportunities.opportunityCurrent.stage',
        'crmData.accounts.opportunities.opportunityAtActivityTime.probabilityPercent',
        'crmData.accounts.opportunities.opportunityCurrent.probabilityPercent',
      ])
      .optional()
      .describe(
        'Sort field. date = call date (default), durationSec = call duration. Other fields are CRM deal stage and probability at activity time or current.',
      ),
    sortAscending: z
      .boolean()
      .optional()
      .describe(
        'Sort direction. true = ascending, false = descending (default).',
      ),
  }),
  output: z.object({
    calls: z.array(CallItemSchema).describe('Call results'),
    totalCount: z
      .number()
      .describe(
        'Number of calls matching the search query (equals filteredCount when no searchText)',
      ),
    filteredCount: z
      .number()
      .describe(
        'Total number of calls in the workspace (before search filtering)',
      ),
  }),
};

export type ListCallsInput = z.infer<typeof listCallsSchema.input>;
export type ListCallsOutput = z.infer<typeof listCallsSchema.output>;

const MonologueSchema = z.object({
  speakerId: z.string().describe('Speaker ID'),
  speakerName: z.string().describe('Speaker first name'),
  text: z.string().describe('Full monologue text'),
  timestamp: z.number().describe('Start time in seconds'),
  timestampStr: z
    .string()
    .describe('Start time as display string (e.g., "1:43")'),
  startingTopic: z
    .string()
    .nullable()
    .describe('Topic starting in this segment'),
  endingTopic: z.string().nullable().describe('Topic ending in this segment'),
});

const TranscriptParticipantSchema = z.object({
  fullName: z.string().describe('Participant full name'),
  companyName: z.string().optional().describe('Participant company'),
  title: z.string().optional().describe('Job title'),
});

const TranscriptTopicSchema = z.object({
  name: z.string().describe('Topic name'),
  start: z.string().describe('Start time as display string (e.g., "1:43")'),
});

const TranslationDetailsSchema = z.object({
  originalLanguage: z
    .string()
    .describe('Original language code (e.g., "en-US")'),
  originalLanguageDisplayName: z
    .string()
    .describe('Original language display name (e.g., "English")'),
  targetLanguage: z.string().describe('Target language code (e.g., "es-US")'),
  targetLanguageDisplayName: z
    .string()
    .describe('Target language display name (e.g., "Spanish")'),
  translationSucceeded: z
    .boolean()
    .describe('Whether the translation completed successfully'),
  isTranslatedByDefault: z
    .boolean()
    .describe(
      'Whether this call is automatically translated (vs. user-requested translation)',
    ),
});

export const getCallTranscriptSchema = {
  name: 'getCallTranscript',
  description:
    'Get the full transcript of a call including speaker-attributed monologues with timestamps, topics, and participant details. Optionally translate to another language.',
  notes:
    'Requires a callId from listCalls. For AI-generated summaries and action items instead of raw transcript, use getCallSpotlight. Pass a language code to get the transcript translated server-side.',
  input: z.object({
    callId: z.string().describe('Call ID from listCalls results'),
    language: z
      .string()
      .optional()
      .describe(
        'Language code for server-side translation (e.g., "es", "fr", "ja", "de"). Accepts short codes (e.g., "es") or full locale codes (e.g., "es-US"). Omit to get the original transcript language.',
      ),
  }),
  output: z.object({
    callId: z.string().describe('Call ID'),
    callTitle: z.string().describe('Call title'),
    callCustomers: z.string().describe('Customer company name(s)'),
    callOrganizerName: z
      .string()
      .optional()
      .describe('Full name of the call organizer'),
    callMeetingProvider: z
      .string()
      .optional()
      .describe(
        'How the call was recorded (e.g., "Upload API", "Zoom", "Microsoft Teams", "Google Meet")',
      ),
    durationMinutes: z
      .number()
      .optional()
      .describe('Call duration in minutes (remainder after hours)'),
    durationHours: z.number().optional().describe('Call duration in hours'),
    monologues: z
      .array(MonologueSchema)
      .describe(
        'Speaker-attributed transcript segments in chronological order',
      ),
    topics: z
      .array(TranscriptTopicSchema)
      .describe('Detected conversation topics with start times'),
    companyParticipants: z
      .array(TranscriptParticipantSchema)
      .describe('Internal (company) participants'),
    customerParticipants: z
      .array(TranscriptParticipantSchema)
      .describe('External (customer) participants'),
    unknownParticipants: z
      .array(TranscriptParticipantSchema)
      .optional()
      .describe(
        'Participants with unknown affiliation (neither company nor customer)',
      ),
    language: z.string().optional().describe('Detected language code'),
    languageDisplayName: z
      .string()
      .optional()
      .describe('Human-readable language name (e.g., "English", "Spanish")'),
    canBeTranslated: z
      .boolean()
      .optional()
      .describe('Whether server-side translation is available for this call'),
    isInHouseTranscript: z
      .boolean()
      .optional()
      .describe('Whether the transcript was generated in-house by Gong'),
    translationDetails: TranslationDetailsSchema.optional().describe(
      'Present when a language parameter was provided and translation was performed',
    ),
  }),
};

export type GetCallTranscriptInput = z.infer<
  typeof getCallTranscriptSchema.input
>;
export type GetCallTranscriptOutput = z.infer<
  typeof getCallTranscriptSchema.output
>;

// ============================================================================
// Ask Anything (AI)
// ============================================================================

export const askCallQuestionSchema = {
  name: 'askCallQuestion',
  description:
    'Ask a natural language question about a specific call and get an AI-generated answer based on the call content.',
  notes:
    'Returns suggested questions if you need ideas. The AI answer is based on the call transcript and context. Pass externalCallToken when accessing shared calls via external share links.',
  input: z.object({
    callId: z.string().describe('Call ID to ask about'),
    question: z.string().describe('Natural language question about the call'),
    externalCallToken: z
      .string()
      .optional()
      .describe(
        'Token for accessing shared/external calls. Obtained from shared call URLs (e.g., /e/c-share/ links). Omit for calls the user has direct access to.',
      ),
  }),
  output: z.object({
    answer: z
      .string()
      .describe('AI-generated answer based on the call transcript'),
    answerHtml: z
      .string()
      .optional()
      .describe(
        'HTML-formatted version of the answer. Use when rendering in a web context.',
      ),
    status: z
      .enum([
        'AVAILABLE',
        'ANSWER_NOT_FOUND',
        'OK',
        'ERROR',
        'PENDING',
        'NOT_APPLICABLE',
        'CALL_TOO_LONG',
      ])
      .optional()
      .describe(
        'Response status indicating if the answer was generated successfully',
      ),
    questionId: z
      .string()
      .optional()
      .describe(
        'Unique ID of this question, usable for referencing or deleting the saved question',
      ),
    hash: z
      .string()
      .optional()
      .describe(
        'SHA-256 hash of the question. Used to reference or delete the saved question via the delete endpoint.',
      ),
    evidenceTimestamps: z
      .array(z.number())
      .optional()
      .describe(
        'Timestamps (seconds) of transcript segments that support the answer',
      ),
    suggestedQuestions: z
      .array(z.string())
      .optional()
      .describe('Suggested follow-up questions'),
    recentQuestions: z
      .array(
        z.object({
          hash: z.string().describe('Question hash'),
          question: z.string().describe('Question text'),
        }),
      )
      .optional()
      .describe(
        'Previously asked questions on this call by the current user, ordered most-recent first.',
      ),
  }),
};

export type AskCallQuestionInput = z.infer<typeof askCallQuestionSchema.input>;
export type AskCallQuestionOutput = z.infer<
  typeof askCallQuestionSchema.output
>;

// ============================================================================
// getCall
// ============================================================================

const HighlightItemSchema = z.object({
  text: z.string().describe('Highlight text'),
  monologueStartTime: z
    .number()
    .describe('Timestamp in seconds of the relevant monologue'),
});

const CallParticipantDetailSchema = z.object({
  fullName: z.string().describe('Participant full name'),
  companyName: z.string().optional().describe('Participant company'),
  title: z.string().optional().describe('Job title'),
  affiliation: z
    .enum(['COMPANY', 'NON_COMPANY'])
    .describe(
      'COMPANY = internal team member, NON_COMPANY = external participant',
    ),
});

const CallTopicDetailSchema = z.object({
  name: z.string().describe('Topic name'),
  start: z.string().describe('Start time as display string (e.g., "1:43")'),
});

export const getCallSchema = {
  name: 'getCall',
  description:
    'Get detailed metadata for a single call by ID. Returns title, participants, topics, and a compact AI summary with action items. For the full spotlight with chapters and timed notes, use getCallSpotlight.',
  notes:
    'Duration is available from listCalls. Participants are split into company (internal) and customer (external) affiliation.',
  input: z.object({
    callId: z
      .string()
      .describe('Call ID (19-digit numeric string from listCalls)'),
    language: z
      .string()
      .optional()
      .describe(
        'Language code for server-side transcript translation (e.g., "es", "fr", "ja", "de"). Accepts short codes or full locale codes. Omit to get the original language.',
      ),
    shouldRegenerate: z
      .boolean()
      .optional()
      .describe(
        'When true, forces the AI spotlight to be regenerated. Defaults to false.',
      ),
  }),
  output: z.object({
    callId: z.string().describe('Call ID'),
    title: z.string().describe('Call title'),
    callCustomers: z.string().describe('Customer company name(s)'),
    participants: z
      .array(CallParticipantDetailSchema)
      .describe('All call participants (company and customer combined)'),
    topics: z
      .array(CallTopicDetailSchema)
      .describe('Detected conversation topics with start times'),
    aiSummary: z
      .string()
      .optional()
      .describe(
        'AI-generated brief summary of the call (absent if spotlight not yet available)',
      ),
    generatedTitle: z
      .string()
      .optional()
      .describe(
        'AI-generated descriptive title (absent if spotlight not yet available)',
      ),
    actionItems: z
      .array(HighlightItemSchema)
      .describe('Next steps and action items identified by AI'),
    keyPoints: z
      .array(HighlightItemSchema)
      .describe('Key points and highlights from the call'),
    language: z
      .string()
      .optional()
      .describe('Transcript language (e.g., "en-US", "es-US")'),
    translationDetails: TranslationDetailsSchema.optional().describe(
      'Present when a language parameter was provided and translation was performed',
    ),
  }),
};

export type GetCallInput = z.infer<typeof getCallSchema.input>;
export type GetCallOutput = z.infer<typeof getCallSchema.output>;

// ============================================================================
// getCallSpotlight
// ============================================================================

const SpotlightChapterSchema = z.object({
  title: z.string().describe('Chapter title'),
  startTime: z.number().describe('Chapter start time in seconds'),
  duration: z.number().describe('Chapter duration in seconds'),
  highlights: z
    .array(HighlightItemSchema)
    .describe('Key highlights within this chapter'),
});

export const getCallSpotlightSchema = {
  name: 'getCallSpotlight',
  description:
    'Get the full AI spotlight analysis for a call: chapters, timed notes, key points, and next steps. More detailed than getCall; use this when you need the chapter-by-chapter breakdown.',
  notes:
    'Check status field first: when "PROCESSING", spotlight is not yet ready and most fields will be absent. When "AVAILABLE", all fields are populated. Requires a callId from listCalls.',
  input: z.object({
    callId: z
      .string()
      .describe('Call ID (19-digit numeric string from listCalls)'),
    shouldRegenerate: z
      .boolean()
      .optional()
      .describe(
        'When true, forces the AI spotlight to be regenerated from scratch. Defaults to false (returns cached results).',
      ),
    externalCallToken: z
      .string()
      .optional()
      .describe(
        'Token for accessing shared/external calls via /e/c-share/ URLs. Omit for calls the user has direct access to.',
      ),
  }),
  output: z.object({
    status: z
      .string()
      .describe('Spotlight status (e.g., AVAILABLE, PROCESSING)'),
    brief: z
      .string()
      .optional()
      .describe('AI-generated brief summary of the call'),
    generatedTitle: z
      .string()
      .optional()
      .describe('AI-generated descriptive title'),
    notes: z
      .array(HighlightItemSchema)
      .describe('Chronological timed notes covering the full call'),
    keyPoints: z
      .array(HighlightItemSchema)
      .describe('Key points and talking points extracted by AI'),
    nextSteps: z
      .array(HighlightItemSchema)
      .describe('Action items and next steps identified by AI'),
    chapters: z
      .array(SpotlightChapterSchema)
      .describe('Quick-read chapter breakdown of the call'),
    language: z
      .string()
      .optional()
      .describe('Transcript language code (e.g., "en-US")'),
  }),
};

export type GetCallSpotlightInput = z.infer<
  typeof getCallSpotlightSchema.input
>;
export type GetCallSpotlightOutput = z.infer<
  typeof getCallSpotlightSchema.output
>;

// ============================================================================
// Accounts
// ============================================================================

const AccountItemSchema = z.object({
  companyName: z.string().describe('Account company name'),
  companyIdentifier: z
    .string()
    .optional()
    .describe('CRM company identifier or domain'),
  gongId: z.string().optional().describe('Gong internal account ID (19-digit)'),
  crmId: z.string().optional().describe('CRM record ID'),
  crmObjectPageUrl: z
    .string()
    .optional()
    .describe('URL to this account in the CRM'),
  ownerFullName: z.string().optional().describe('Account owner full name'),
  website: z.string().optional().describe('Company website URL'),
  createdDate: z
    .string()
    .optional()
    .describe('Account creation date as returned by the server'),
});

export const listAccountsSchema = {
  name: 'listAccounts',
  description:
    'List accounts in Gong Engage. Returns account metadata including company name, CRM IDs, owner, and website.',
  notes:
    "Engage accounts are the company's pipeline accounts, distinct from call participants. searchText performs server-side filtering by account name. Returns all matching accounts in a single response (no pagination).",
  input: z.object({
    searchText: z
      .string()
      .optional()
      .describe(
        'Server-side search keyword to filter accounts by name. Matched against account name on the server.',
      ),
    sortField: z
      .string()
      .optional()
      .describe(
        'CRM field name to sort by (e.g., "ACCOUNT_NAME", "LastActivityDate", "CreatedDate", "AnnualRevenue", "NumberOfEmployees"). Defaults to LastActivityDate.',
      ),
    sortFieldType: z
      .enum(['string', 'currency', 'int', 'date', 'datetime'])
      .optional()
      .describe(
        'Data type of the sort field. Helps the server apply type-appropriate sorting (e.g., numeric vs lexicographic). Observed values: "string" for text fields, "currency" for monetary fields, "int" for numeric, "date" for date-only, "datetime" for timestamp fields.',
      ),
    sortDirection: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe('Sort direction. Defaults to ASC.'),
  }),
  output: z.object({
    accounts: z.array(AccountItemSchema).describe('Account results'),
    totalCount: z
      .number()
      .describe('Total number of accounts matching the query'),
  }),
};

export type ListAccountsInput = z.infer<typeof listAccountsSchema.input>;
export type ListAccountsOutput = z.infer<typeof listAccountsSchema.output>;

export const getAccountSchema = {
  name: 'getAccount',
  description:
    'Get detailed information about a single Engage account by name or CRM ID. Returns null when no matching account is found. When accountCrmId is provided, uses a direct lookup endpoint; otherwise searches by name and returns the best match.',
  notes:
    'Returns null (not an error) when no account matches; check for null before use, especially in parallel calls. Prefer accountCrmId when available; it uses the dedicated account detail endpoint and avoids ambiguous name matching. CRM IDs are available from listAccounts results.',
  input: z.object({
    accountName: z
      .string()
      .optional()
      .describe(
        'Account company name to search for (exact or partial match). Required unless accountCrmId is provided.',
      ),
    accountCrmId: z
      .string()
      .optional()
      .describe(
        'CRM record ID for direct account lookup (e.g., Salesforce Account ID like "001gK00000f1WElQAM"). Bypasses name search and uses the dedicated account detail endpoint. Available from listAccounts crmId field.',
      ),
    sortField: z
      .string()
      .optional()
      .describe(
        'CRM field name to sort search results by when using name search. Affects which account is returned when multiple matches exist. Common values: "ACCOUNT_NAME", "LastActivityDate", "CreatedDate", "AnnualRevenue", "NumberOfEmployees". Defaults to ACCOUNT_NAME.',
      ),
    sortDirection: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe('Sort direction for name search results. Defaults to ASC.'),
  }),
  output: z
    .object({
      companyName: z.string().describe('Account company name'),
      companyIdentifier: z
        .string()
        .optional()
        .describe('CRM company identifier or domain'),
      gongId: z
        .string()
        .optional()
        .describe('Gong internal account ID (19-digit)'),
      crmId: z.string().optional().describe('CRM record ID'),
      crmObjectPageUrl: z
        .string()
        .optional()
        .describe('URL to this account in the CRM'),
      createdDate: z.string().optional().describe('Account creation date'),
      ownerFullName: z.string().optional().describe('Account owner full name'),
      website: z.string().optional().describe('Company website URL'),
    })
    .nullable()
    .describe('Account details, or null if no matching account was found'),
};

export type GetAccountInput = z.infer<typeof getAccountSchema.input>;
export type GetAccountOutput = z.infer<typeof getAccountSchema.output>;

// ============================================================================
// People
// ============================================================================

const PersonItemSchema = z.object({
  name: z.string().describe('Full name'),
  firstName: z.string().optional().describe('First name'),
  lastName: z.string().optional().describe('Last name'),
  emails: z.array(z.string()).describe('Email addresses'),
  title: z.string().optional().describe('Job title'),
  gongId: z
    .string()
    .optional()
    .describe('Gong internal person ID (19-digit, null for CRM-only contacts)'),
  crmId: z.string().optional().describe('CRM record ID'),
  crmType: z
    .string()
    .optional()
    .describe('CRM type (e.g., SALESFORCE, HUBSPOT)'),
  crmUrl: z.string().optional().describe('URL to this contact in the CRM'),
  timezone: z.string().optional().describe('Timezone'),
  city: z.string().optional().describe('City'),
  state: z.string().optional().describe('State'),
  country: z.string().optional().describe('Country'),
  companyName: z.string().optional().describe('Associated company name'),
  linkedInUrl: z.string().optional().describe('LinkedIn profile URL'),
  crmAccountId: z
    .string()
    .optional()
    .describe('CRM account ID this contact belongs to'),
  gongAccountId: z
    .string()
    .optional()
    .describe('Gong account ID this contact belongs to'),
  isLead: z
    .boolean()
    .optional()
    .describe('Whether this person is a lead (vs. contact)'),
  imageUrl: z.string().optional().describe('Profile image URL'),
  phoneNumbers: z
    .array(z.string())
    .optional()
    .describe('Phone numbers in normalized format (e.g., "(555) 163-3824")'),
});

export const listPeopleSchema = {
  name: 'listPeople',
  description:
    'List people (contacts or leads) in Gong Engage. Returns contact metadata including name, email addresses, phone numbers, title, and CRM IDs.',
  notes:
    'Engage people are pipeline contacts (prospects/customers), distinct from call participants. Uses server-side pagination via pageNumber/pageSize. Default sort is newest first (last modified/created). Confirmed working sort fields: "CreatedDate" (creation date), "SystemModstamp" (last modification, same as default behavior), "LastModifiedDate" (last modification, different ordering than default). Note: "FirstName" does NOT work as a sort field; the API silently ignores it. totalCount returns the total count of matching people across all pages (both with and without searchText). flowName filters to contacts/leads enrolled in a specific Engage flow.',
  input: z.object({
    searchText: z
      .string()
      .optional()
      .describe(
        'Server-side keyword search. Filters by name, job title, and company name. Does not match email addresses.',
      ),
    entityType: z
      .enum(['contact', 'lead'])
      .optional()
      .default('contact')
      .describe(
        'Entity type to list. "contact" for contacts (default), "lead" for leads.',
      ),
    pageNumber: z
      .number()
      .optional()
      .default(1)
      .describe('Page number (1-indexed). Defaults to 1.'),
    pageSize: z
      .number()
      .optional()
      .default(100)
      .describe('Number of results per page (default 100).'),
    sortField: z
      .string()
      .optional()
      .describe(
        'CRM field name to sort by. Confirmed working: "CreatedDate" (creation date), "SystemModstamp" (last modification), "LastModifiedDate" (last modification with different ordering). Note: "FirstName" does NOT work; the API silently ignores it. Defaults to "SystemModstamp" (newest first, same as the UI default "last modified/created" label).',
      ),
    sortDirection: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe(
        'Sort direction. "ASC" = oldest/lowest first, "DESC" = newest/highest first (default). Confirmed working with "CreatedDate" and "SystemModstamp" sort fields.',
      ),
    flowName: z
      .string()
      .optional()
      .describe(
        'Filter contacts/leads to those enrolled in a specific Engage flow (sequence) by exact flow name (e.g., "Business Review Flow"). Maps to the "Flow name (incl. history)" filter in the Gong Engage UI.',
      ),
  }),
  output: z.object({
    people: z.array(PersonItemSchema).describe('People results'),
    totalCount: z
      .number()
      .describe(
        'Total number of matching people across all pages (accurate for both with and without searchText).',
      ),
    pageNumber: z.number().describe('Current page number (1-indexed)'),
    pageSize: z.number().describe('Page size used for this response'),
  }),
};

export type ListPeopleInput = z.infer<typeof listPeopleSchema.input>;
export type ListPeopleOutput = z.infer<typeof listPeopleSchema.output>;

// ============================================================================
// Users
// ============================================================================

const UserItemSchema = z.object({
  appUserId: z.string().describe('Gong user ID (19-digit)'),
  managerId: z
    .string()
    .optional()
    .describe("Manager's Gong user ID. Absent when user has no manager."),
  emailAddress: z.string().describe('User email address'),
  firstName: z.string().describe('First name'),
  lastName: z.string().describe('Last name'),
  title: z.string().optional().describe('Job title'),
  companyID: z.string().optional().describe('Company ID'),
  companyName: z.string().optional().describe('Company display name'),
  active: z.boolean().describe('Whether the user is active'),
  manager: z
    .boolean()
    .optional()
    .describe('Whether the user is a manager (has direct reports)'),
  permitted: z
    .boolean()
    .optional()
    .describe('Whether the user has Engage permissions'),
  imageUrl: z
    .string()
    .optional()
    .describe(
      'Profile photo URL (protocol-relative, prefix with https: if needed)',
    ),
});

export const listUsersSchema = {
  name: 'listUsers',
  description:
    'List all Engage users in the current workspace. Returns user metadata including name, email, manager, and active status.',
  notes:
    'Returns appUserId for each user. Use these IDs as teamLeaderId in getTeamStats to scope metrics to a specific team.',
  input: z.object({}),
  output: z.object({
    users: z.array(UserItemSchema).describe('Engage workspace users'),
  }),
};

export type ListUsersInput = z.infer<typeof listUsersSchema.input>;
export type ListUsersOutput = z.infer<typeof listUsersSchema.output>;

// ============================================================================
// Deals
// ============================================================================

const DealItemSchema = z.object({
  id: z.string().describe('Deal ID (19-digit numeric string)'),
  name: z.string().describe('Deal name'),
  amount: z
    .number()
    .nullable()
    .describe(
      'Deal value/amount in the requested currency (viewingCurrency param)',
    ),
  stage: z.string().describe('Current pipeline stage name'),
  closeDate: z.string().nullable().describe('Expected close date (YYYY-MM-DD)'),
  accountName: z
    .string()
    .nullable()
    .describe('Associated account/company name'),
  accountId: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Gong account ID (19-digit). Use with getDealActivities or listAccounts.',
    ),
  ownerId: z
    .string()
    .nullable()
    .describe(
      'Deal owner user ID (19-digit). Resolve to a name via listUsers if needed.',
    ),
  crmId: z
    .string()
    .optional()
    .describe('CRM opportunity record ID (e.g., Salesforce Opportunity ID)'),
  urlToCrm: z
    .string()
    .optional()
    .describe('Direct URL to this deal in the CRM'),
  status: z
    .string()
    .optional()
    .describe('Deal status (e.g., OPEN, CLOSE_WON, CLOSE_LOST)'),
  probability: z
    .number()
    .optional()
    .describe('Win probability percentage (0-100)'),
});

export const listDealsSchema = {
  name: 'listDeals',
  description:
    'List deals from the pipeline board with optional period, sort, pagination, and currency filters. Auto-detects the first available user board if no boardId is provided.',
  notes:
    'Returns deal IDs needed for getDealActivities. boardId is auto-detected if omitted; only provide it when targeting a specific named board. Sort defaults to DealActivity descending. Pagination defaults to 200 deals from offset 0.',
  input: z.object({
    boardId: z
      .string()
      .optional()
      .describe(
        'Pipeline board ID. Auto-detected from the first user board if not provided.',
      ),
    period: z
      .enum([
        'CLOSING_THIS_QUARTER',
        'CLOSING_THIS_MONTH',
        'CLOSING_NEXT_QUARTER',
        'CLOSING_THIS_YEAR',
        'CLOSING_PREV_MONTH',
        'CLOSING_PREV_QUARTER',
        'CLOSING_PREV_YEAR',
        'CLOSING_NEXT_MONTH',
        'CLOSING_NEXT_YEAR',
      ])
      .optional()
      .default('CLOSING_THIS_QUARTER')
      .describe(
        'Close date period filter. Prev = last, Next = upcoming. Defaults to this quarter.',
      ),
    sortField: z
      .enum([
        'DealActivity',
        'Amount',
        'DealName',
        'Stage',
        'Owner',
        'Contacts',
        'NextCall',
        'CloseDate',
      ])
      .optional()
      .describe(
        'Field to sort deals by. Defaults to DealActivity (most recent activity).',
      ),
    sortOrder: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe('Sort direction. Defaults to DESC.'),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of deals per page (e.g., 10, 20, 50, 200). Defaults to 200.',
      ),
    pageFrom: z
      .number()
      .optional()
      .describe('Pagination offset (0-indexed). Defaults to 0.'),
    viewingCurrency: z
      .string()
      .optional()
      .describe(
        'ISO currency code for deal amounts (e.g., "USD", "GBP", "JPY"). Defaults to USD. Available currencies depend on workspace configuration.',
      ),
    activeDealsRollupTabIndex: z
      .number()
      .optional()
      .describe(
        'Index of the rollup tab to filter by (0 = Target attainment, 1 = Pipeline coverage, 2 = Commit, etc.). Tab order is configured per board. Defaults to 0.',
      ),
  }),
  output: z.object({
    boardId: z.string().describe('Board ID used for the query'),
    boardName: z.string().describe('Board display name'),
    deals: z.array(DealItemSchema).describe('Deal records from the board'),
    totalCount: z
      .number()
      .describe(
        'Total number of deals matching the filters (may exceed deals array length when paginated)',
      ),
  }),
};

export type ListDealsInput = z.infer<typeof listDealsSchema.input>;
export type ListDealsOutput = z.infer<typeof listDealsSchema.output>;

const ActivityItemSchema = z.object({
  activityType: z
    .string()
    .describe(
      'Activity type (e.g., EMAIL, ENGAGEMENT, CALL, MEETING, CRM_CHANGE, TEXT, DIGITAL_INTERACTION)',
    ),
  activityDirection: z
    .string()
    .nullable()
    .describe('Direction: INBOUND or OUTBOUND'),
  activityDateTime: z
    .string()
    .describe('Activity time as display string (e.g., "1:13 PM EST")'),
  activityDateEpoch: z.number().describe('Activity timestamp as epoch seconds'),
  activityId: z.string().describe('Activity ID'),
  activityTitle: z
    .string()
    .nullable()
    .describe('Activity title or email subject'),
  activitySubTitle: z
    .string()
    .optional()
    .describe('Activity subtitle or context (e.g., flow name for engagements)'),
  dealId: z
    .string()
    .optional()
    .describe('Deal ID this activity belongs to (19-digit numeric string)'),
  dealAmount: z
    .number()
    .optional()
    .describe('Deal value/amount at the time of the activity'),
  accountId: z
    .string()
    .optional()
    .describe(
      'Gong account ID associated with this activity (19-digit numeric string)',
    ),
  fromDisplayName: z
    .string()
    .optional()
    .describe('Display name of the person who performed the activity'),
  fromTitle: z
    .string()
    .nullable()
    .optional()
    .describe('Job title of the person who performed the activity'),
  isNew: z.boolean().optional().describe('Whether the activity is new/unread'),
  dealName: z.string().optional().describe('Associated deal name'),
  accountName: z
    .string()
    .optional()
    .describe('Associated account/company name'),
});

export const getDealActivitiesSchema = {
  name: 'getDealActivities',
  description:
    'Get activity history for a specific deal: calls, emails, and meetings in reverse chronological order.',
  notes:
    'Requires a dealId from listDeals. activityType values include EMAIL, ENGAGEMENT, CALL, MEETING. Activity type and tracker filters are client-side only; the API returns all activities.',
  input: z.object({
    dealId: z.string().describe('Deal ID (19-digit numeric string)'),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of activities to return per page. Server-side pagination. Omit for default (all activities).',
      ),
  }),
  output: z.object({
    activities: z
      .array(ActivityItemSchema)
      .describe('Activity records in reverse chronological order'),
    totalFound: z.number().describe('Total number of activities found'),
    totalNew: z.number().describe('Number of new (unread) activities'),
  }),
};

export type GetDealActivitiesInput = z.infer<
  typeof getDealActivitiesSchema.input
>;
export type GetDealActivitiesOutput = z.infer<
  typeof getDealActivitiesSchema.output
>;

// ============================================================================
// Forecast
// ============================================================================

const ForecastPeriodSchema = z.object({
  id: z
    .string()
    .describe(
      'Period ID (e.g., "2026-M3-FY2026", "2025-Q4-FY2026", "2025-Y-FY2026")',
    ),
  parentId: z
    .string()
    .optional()
    .describe(
      'Parent period ID: links months to their quarter, quarters to their year. Absent for year-level periods.',
    ),
  type: z.string().describe('Period type: YEAR, QUARTER, or MONTH'),
  value: z
    .number()
    .describe(
      'Period value: quarter number (1–4), month number (1–12), or 0 for year',
    ),
  year: z.number().describe('Calendar year'),
  fiscalYear: z.number().describe('Fiscal year'),
  label: z
    .string()
    .describe(
      'Human-readable label (e.g., "Q1, FY2026", "Mar, FY2026", "FY2026")',
    ),
  isCurrent: z
    .boolean()
    .optional()
    .describe('Whether this is the currently active period'),
  isOver: z.boolean().optional().describe('Whether this period has ended'),
});

const ForecastCategorySchema = z.object({
  id: z.string().describe('Category ID'),
  name: z
    .string()
    .describe(
      'Category name (e.g., Commit, Best Case, Pipeline, Most Likely, Key Deals)',
    ),
  order: z.number().describe('Display order index'),
});

const ForecastBoardSummarySchema = z.object({
  boardId: z.string().describe('Forecast board ID'),
  boardName: z.string().describe('Forecast board display name'),
  shadowBoardId: z
    .string()
    .nullable()
    .describe(
      'Shadow board ID: use this (not boardId) when calling getForecast',
    ),
});

export const getForecastBoardsSchema = {
  name: 'getForecastBoards',
  description:
    'Get forecast board configuration including available periods, forecast categories, and the current active period. Also returns all configured forecast boards.',
  notes:
    "Use the returned shadowBoardId (not boardId) when calling getForecast. The currentPeriod indicates which period is selected by default. In multi-board setups, use allBoards to discover available boards and pass their boardId as forecastBoardId to get each board's full config.",
  input: z.object({
    forecastBoardId: z
      .string()
      .optional()
      .describe(
        'Forecast board ID to retrieve config for. When omitted, returns the default board. Use this in multi-board setups to target a specific forecast board.',
      ),
  }),
  output: z.object({
    boardId: z.string().describe('Forecast board ID for the selected board'),
    boardName: z.string().describe('Forecast board display name'),
    shadowBoardId: z
      .string()
      .nullable()
      .describe(
        'Shadow board ID: use this (not boardId) when calling getForecast',
      ),
    periods: z
      .array(ForecastPeriodSchema)
      .describe('Available forecast periods (months, quarters, and years)'),
    currentPeriod: ForecastPeriodSchema.describe(
      'Currently active forecast period',
    ),
    forecastCategories: z
      .array(ForecastCategorySchema)
      .describe(
        'Forecast categories used to classify deals (e.g., Commit, Best Case, Pipeline)',
      ),
    allBoards: z
      .array(ForecastBoardSummarySchema)
      .describe(
        "All configured forecast boards. Use a board's boardId as forecastBoardId to get its full config.",
      ),
  }),
};

export type GetForecastBoardsInput = z.infer<
  typeof getForecastBoardsSchema.input
>;
export type GetForecastBoardsOutput = z.infer<
  typeof getForecastBoardsSchema.output
>;

const RollupTabSchema = z.object({
  index: z.number().describe('Rollup tab position index'),
  label: z
    .string()
    .describe('Tab label (e.g., "Pipeline", "Commit", "Best Case", "Won")'),
  type: z
    .string()
    .describe(
      'Rollup type identifier (always "OTHER" in practice, not useful for discrimination)',
    ),
  totalAmountValue: z
    .number()
    .describe('Total deal amount summed for this category'),
  totalCount: z.number().describe('Number of deals in this category'),
  warningsAmountValue: z
    .number()
    .optional()
    .describe('Total amount of deals with risk warnings in this category'),
  warningsCount: z
    .number()
    .optional()
    .describe('Number of deals with risk warnings in this category'),
});

export const getForecastSchema = {
  name: 'getForecast',
  description:
    'Get forecast deals and pipeline rollup totals for a board and period. Returns both the individual deals and aggregated category totals.',
  notes:
    'boardId is required: call getForecastBoards first and pass its shadowBoardId here. Using the boardId (instead of shadowBoardId) from getForecastBoards will return a 404.',
  input: z.object({
    boardId: z
      .string()
      .describe(
        'The shadowBoardId from getForecastBoards (the pipeline board backing the forecast)',
      ),
    period: z
      .enum([
        'CLOSING_THIS_QUARTER',
        'CLOSING_THIS_MONTH',
        'CLOSING_THIS_YEAR',
        'CLOSING_NEXT_QUARTER',
        'CLOSING_NEXT_MONTH',
        'CLOSING_NEXT_YEAR',
        'CLOSING_PREV_QUARTER',
        'CLOSING_PREV_MONTH',
        'CLOSING_PREV_YEAR',
        'CLOSING_CUSTOM_RANGE',
      ])
      .optional()
      .default('CLOSING_THIS_QUARTER')
      .describe(
        'Close date period filter. PREV = previous (last). Use CLOSING_CUSTOM_RANGE with closeDateFrom and closeDateTo for a specific date range. Weekly granularity (e.g., CLOSING_THIS_WEEK) is not supported and will return a 400 error.',
      ),
    closeDateFrom: z
      .string()
      .optional()
      .describe(
        'Start date for custom close date range in ISO format (YYYY-MM-DD). Only used when period is CLOSING_CUSTOM_RANGE.',
      ),
    closeDateTo: z
      .string()
      .optional()
      .describe(
        'End date for custom close date range in ISO format (YYYY-MM-DD). Only used when period is CLOSING_CUSTOM_RANGE.',
      ),
    viewingCurrency: z
      .string()
      .optional()
      .describe(
        'Currency ISO code to display deal amounts in (e.g., "USD", "GBP", "JPY"). Defaults to "USD". For accurate amounts matching the Gong UI, pass the workspace\'s configured currency; amounts will be off if the workspace uses a non-USD currency (e.g., GBP). Available currencies can vary by workspace configuration.',
      ),
    sortField: z
      .string()
      .optional()
      .describe(
        'Field name to sort deals by. Common values: "DealActivity" (default), "Amount", "CloseDate", "Stage", "DealName", "Contacts", "NextCall", "PredictionScore", "Owner", "CreatedDate".',
      ),
    sortOrder: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe('Sort direction. Defaults to DESC.'),
    activeDealsRollupTabIndex: z
      .number()
      .optional()
      .describe(
        'Index of the rollup tab to filter deals by (0 = Target attainment, 1 = Pipeline coverage, 2+ = forecast categories like Commit, Best Case). Defaults to 0.',
      ),
    paginationSize: z
      .number()
      .optional()
      .describe('Number of deals per page. Defaults to 200.'),
    paginationFrom: z
      .number()
      .optional()
      .describe('Pagination offset (0-indexed). Defaults to 0.'),
    ownerUserIds: z
      .array(z.string())
      .optional()
      .describe(
        'User IDs to filter deals by owner. Defaults to the current user. Pass an empty array alongside ownerTeamIds to filter by team only. User IDs are available from listUsers or getContext.',
      ),
    ownerTeamIds: z
      .array(z.string())
      .optional()
      .describe(
        'Team IDs to filter deals by team ownership. When provided alongside empty ownerUserIds, shows all deals owned by members of those teams. Team IDs correspond to manager appUserIds from listUsers.',
      ),
    accountId: z
      .string()
      .optional()
      .describe(
        'Filter deals by a specific Gong account ID (19-digit numeric string). When provided, only deals associated with this account are returned. Account IDs are available from listAccounts.',
      ),
    territoryIds: z
      .array(z.string())
      .optional()
      .describe(
        'Territory IDs to filter deals by territory assignment. Pass an empty array to clear the territory filter. Territory IDs are workspace-configured.',
      ),
    adHocFilters: z
      .object({
        type: z.literal('And').describe('Filter combinator: always "And"'),
        filters: z
          .array(
            z.object({
              type: z
                .string()
                .describe(
                  'Filter type. Native types: "Warnings" (deal risk flags, values are 19-digit IDs), "Status" (deal status: "OPEN"/"WON"/"LOST"), "Stage" (pipeline stage name). CRM field type: "StringCrmCustomFieldFilter" (requires a `field` object with workspace-specific gongId).',
                ),
              values: z
                .array(z.string())
                .describe(
                  'Filter values. For "Status": "OPEN", "WON", "LOST". For "Warnings": 19-digit warning IDs. For "Stage": stage name strings. For CRM fields (e.g., ForecastCategory): internal API picklist values, not UI labels (e.g., Salesforce "Forecast" shows as "Commit" in UI).',
                ),
              field: z
                .object({
                  type: z
                    .string()
                    .describe('CRM field type: typically "StringCrmCustom"'),
                  gongId: z
                    .string()
                    .describe(
                      'Workspace-specific Gong field ID (19-digit numeric string)',
                    ),
                  name: z
                    .string()
                    .describe('CRM field API name (e.g., "ForecastCategory")'),
                  objectType: z
                    .string()
                    .describe('CRM object type: typically "OPPORTUNITY"'),
                })
                .optional()
                .describe(
                  'CRM field descriptor. Required when type is "StringCrmCustomFieldFilter". The gongId is workspace-specific.',
                ),
            }),
          )
          .describe('Array of filter conditions (all applied with AND logic)'),
      })
      .optional()
      .describe(
        'Ad-hoc filter conditions applied on top of the board query. Supports native filters (Status, Warnings, Stage) and CRM field filters (StringCrmCustomFieldFilter). All conditions are combined with AND logic.',
      ),
  }),
  output: z.object({
    deals: z
      .array(DealItemSchema)
      .describe('Deal records for the forecast period'),
    rollupTabs: z
      .array(RollupTabSchema)
      .describe(
        'Pipeline totals broken down by forecast category (Pipeline, Commit, Best Case, Won, etc.)',
      ),
    totalCount: z
      .number()
      .describe(
        'Total number of deals matching the filters across all pages. Use this (not deals array length) to determine if more pages exist.',
      ),
  }),
};

export type GetForecastInput = z.infer<typeof getForecastSchema.input>;
export type GetForecastOutput = z.infer<typeof getForecastSchema.output>;

// ============================================================================
// Flows
// ============================================================================

const FlowItemSchema = z.object({
  id: z.string().describe('Flow ID (19-digit numeric string)'),
  name: z.string().describe('Flow name'),
  createdBy: z
    .string()
    .describe('Creator user ID. "null" for system-generated starter flows.'),
  createdByFullName: z
    .string()
    .nullable()
    .describe('Creator full name. Null for system-generated starter flows.'),
  lastUpdatedBy: z
    .string()
    .describe(
      'User ID of last editor. "null" for system-generated starter flows.',
    ),
  lastUpdatedByFullName: z
    .string()
    .optional()
    .describe('Full name of last editor'),
  visibility: z
    .enum(['COMPANY', 'PERSONAL'])
    .describe('COMPANY = shared with workspace, PERSONAL = private to creator'),
  createDate: z.string().describe('Creation date (ISO 8601)'),
  lastUpdateDate: z.string().describe('Last modification date (ISO 8601)'),
  folderId: z
    .string()
    .optional()
    .describe('Folder ID this flow belongs to in the flow tree'),
  enabled: z
    .boolean()
    .optional()
    .describe('Whether the flow is currently enabled/active'),
  hasAttachments: z
    .boolean()
    .optional()
    .describe('Whether the flow has email attachments'),
  description: z.string().optional().describe('Flow description'),
  rulesetId: z
    .string()
    .optional()
    .describe(
      'Associated ruleset ID governing flow behavior (exclusivity, unsubscribe, etc.)',
    ),
  includeUnsubscribeLink: z
    .boolean()
    .optional()
    .describe('Whether the flow includes an unsubscribe link in emails'),
  exclusive: z
    .boolean()
    .optional()
    .describe(
      'Whether the flow is exclusive (contacts can only be in one exclusive flow at a time)',
    ),
  isOOBSequence: z
    .boolean()
    .optional()
    .describe('Whether this is an out-of-box starter flow provided by Gong'),
  currentUsage: z
    .number()
    .optional()
    .describe('Number of contacts currently active in this flow'),
  totalUsage: z
    .number()
    .optional()
    .describe(
      'Total number of contacts that have ever been enrolled in this flow',
    ),
  completedCount: z
    .number()
    .optional()
    .describe('Number of contacts that have completed the flow'),
  totalSteps: z
    .number()
    .optional()
    .describe('Total number of steps in this flow'),
  totalDays: z
    .number()
    .optional()
    .describe('Total number of days the flow spans'),
});

export const listFlowsSchema = {
  name: 'listFlows',
  description:
    'List Engage flows (sequences) in the current workspace. Deleted flows are excluded.',
  notes:
    'Flows with visibility COMPANY are shared workspace sequences; PERSONAL flows are private to their creator. Use getEnabledOnly to filter to only enabled flows.',
  input: z.object({
    getEnabledOnly: z
      .boolean()
      .optional()
      .describe(
        'When true, returns only enabled/active flows. When false or omitted, returns all flows including disabled ones.',
      ),
  }),
  output: z.object({
    flows: z.array(FlowItemSchema).describe('Active flows in the workspace'),
  }),
};

export type ListFlowsInput = z.infer<typeof listFlowsSchema.input>;
export type ListFlowsOutput = z.infer<typeof listFlowsSchema.output>;

// ============================================================================
// Team Stats
// ============================================================================

const TeamStatMetricEnum = z.enum([
  // Activity category metrics (category: 'activity')
  'avgCallDuration',
  'avgWeeklyCalls',
  'avgWeeklyDuration',
  'totalCalls',
  'totalDuration',
  // Interaction category metrics (category: 'interaction')
  'avgRepTalkPercent',
  'longestRepMonologue',
  'longestCustomerInterview',
  'callInteractivity',
  'patience',
  'questionsByOwnerPerHour',
  // Responsiveness/emails category metrics (category: 'emails')
  'fastResponses',
  'responseTime',
  'responseRate',
]);

const PerUserMetricSchema = z.object({
  userId: z.string().describe('User ID'),
  value: z.number().nullable().describe('Metric value (null if no data)'),
  displayFormat: z
    .string()
    .nullable()
    .describe(
      'Format code for rendering the value. Known values: "time" (duration), "decimal2" (counts), "percent" (percentages), "human" (human-readable time, e.g., for email responseTime). Note: perUser displayFormat may differ from the top-level displayFormat for some metrics (e.g., avgWeeklyDuration returns "decimal2" per user despite "time" at the aggregate level).',
    ),
  numberOfCalls: z
    .number()
    .nullable()
    .optional()
    .describe(
      'Number of calls counted for this metric. Absent for email category metrics (fastResponses, responseTime, responseRate).',
    ),
  noData: z
    .boolean()
    .optional()
    .describe(
      'True when user had no activity in this period. Absent for email category metrics (fastResponses, responseTime, responseRate).',
    ),
});

export const getTeamStatsSchema = {
  name: 'getTeamStats',
  description:
    'Get aggregated team stats for a specific metric plus a per-user breakdown. Supports call activity, interaction quality, and email responsiveness metrics. Use getContext() to get the userId for teamLeaderId.',
  notes:
    "teamLeaderId scopes results to that user's direct team. Pass the current user's ID (from getContext) to see your own team. Each metric belongs to a category; use the matching category for the metric you want (e.g., category 'interaction' for avgRepTalkPercent). Activity metrics are returned by default. Note: avgWeeklyCalls and avgWeeklyDuration return errors with dateRangeType LAST_7_DAYS; use LAST_30_DAYS or larger for weekly average metrics.",
  input: z.object({
    metric: TeamStatMetricEnum.describe(
      'Metric to retrieve. Activity metrics (category=activity): avgCallDuration, avgWeeklyCalls, avgWeeklyDuration, totalCalls, totalDuration. Interaction metrics (category=interaction): avgRepTalkPercent (talk ratio), longestRepMonologue, longestCustomerInterview, callInteractivity, patience, questionsByOwnerPerHour. Responsiveness metrics (category=emails): fastResponses, responseTime, responseRate.',
    ),
    category: z
      .enum(['activity', 'interaction', 'emails'])
      .optional()
      .default('activity')
      .describe(
        'Stats category that determines which API endpoint is called and which metrics are available. "activity" = call volume/duration stats (default). "interaction" = call quality metrics (talk ratio, monologue length, patience, question rate). "emails" = email responsiveness metrics (response time, response rate). Must match the selected metric.',
      ),
    teamLeaderId: z
      .string()
      .describe(
        'Team leader user ID to scope the team view. Use userId from getContext() for your own team.',
      ),
    dateRangeType: z
      .enum([
        'LAST_7_DAYS',
        'LAST_30_DAYS',
        'LAST_90_DAYS',
        'THIS_WEEK',
        'THIS_MONTH',
        'THIS_QUARTER',
        'ANY_TIME',
        'DATE_RANGE',
      ])
      .optional()
      .default('LAST_30_DAYS')
      .describe(
        'Date range preset. Use DATE_RANGE for a custom date range (requires from and to).',
      ),
    from: z
      .string()
      .optional()
      .describe(
        'Start date in MM/DD/YYYY format. Required when dateRangeType is DATE_RANGE.',
      ),
    to: z
      .string()
      .optional()
      .describe(
        'End date in MM/DD/YYYY format. Required when dateRangeType is DATE_RANGE.',
      ),
    callFilter: z
      .string()
      .optional()
      .describe(
        'Call category filter. "ALL_CALLS" for all calls (default), "CUSTOMER_CALLS" for customer calls only, or a category ID string for workspace-specific custom categories.',
      ),
    withParticipant: z
      .boolean()
      .optional()
      .describe(
        'When false (default), shows stats for calls hosted by team members. When true, shows stats for calls where team members were attendees.',
      ),
    groupingMode: z
      .enum(['ROLLUP', 'FLAT'])
      .optional()
      .describe(
        'ROLLUP (default) groups metrics by team (aggregated under team leaders). FLAT shows individual user metrics without team hierarchy.',
      ),
  }),
  output: z.object({
    metric: z.string().describe('Metric that was queried'),
    value: z
      .number()
      .nullable()
      .describe('Aggregated metric value for the team'),
    displayFormat: z
      .string()
      .nullable()
      .describe(
        'Format code for the value (e.g., "time" for duration, "decimal2" for counts, "percent" for percentages)',
      ),
    numberOfCalls: z
      .number()
      .nullable()
      .describe('Total number of calls included in this stat'),
    perUser: z
      .array(PerUserMetricSchema)
      .describe('Per-user breakdown of the metric for all team members'),
  }),
};

export type GetTeamStatsInput = z.infer<typeof getTeamStatsSchema.input>;
export type GetTeamStatsOutput = z.infer<typeof getTeamStatsSchema.output>;

// ============================================================================
// Smart Trackers
// ============================================================================

const SmartTrackerSchema = z.object({
  id: z.string().describe('Smart tracker ID'),
  title: z.string().describe('Smart tracker name'),
  description: z
    .string()
    .describe(
      'Smart tracker description explaining what keywords or phrases it monitors',
    ),
  smartTrackerType: z
    .string()
    .optional()
    .describe(
      'Tracker type. "GDC" for AI/ML-powered smart trackers (only present when trackerType is "smart")',
    ),
  modelStatus: z
    .enum(['PUBLISHED', 'DRAFT', 'TRAINING'])
    .optional()
    .describe(
      'ML model status (only present for smart trackers). PUBLISHED = active and detecting.',
    ),
  searchScope: z
    .enum(['ANYONE', 'COMPANY', 'NON_COMPANY'])
    .optional()
    .describe(
      'Who the tracker monitors. ANYONE = all speakers, COMPANY = internal, NON_COMPANY = external/customer.',
    ),
  enabledForEmails: z
    .boolean()
    .optional()
    .describe(
      'Whether the tracker also scans email content (only present for smart trackers)',
    ),
  hidden: z
    .boolean()
    .optional()
    .describe(
      'Whether the tracker is hidden from the UI (only present for smart trackers)',
    ),
  createdBy: z
    .string()
    .nullable()
    .optional()
    .describe(
      'User ID of the tracker creator. Null for Gong-provided trackers.',
    ),
  createdByUserName: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Full name of the tracker creator. Null for Gong-provided trackers.',
    ),
  appliedSince: z
    .string()
    .optional()
    .describe(
      'ISO 8601 timestamp when the tracker was activated (only present for smart trackers)',
    ),
  phrases: z
    .array(z.string())
    .optional()
    .describe(
      'Keyword phrases the tracker monitors (only present for keyword trackers)',
    ),
  examples: z
    .array(z.string())
    .optional()
    .describe(
      'Example transcript quotes that triggered this tracker. Each element is a JSON-encoded array of example strings. Only present for smart trackers.',
    ),
  modelId: z
    .number()
    .optional()
    .describe(
      'Internal ML model ID for this smart tracker. Only present for smart trackers.',
    ),
  modelIntentInstructions: z
    .object({
      question: z
        .string()
        .describe(
          'The intent question used to train/evaluate the model (e.g., "Did the customer mention budget constraints?")',
        ),
      additionalContext: z
        .string()
        .nullable()
        .describe('Additional context used to refine model detection'),
      searchScope: z
        .enum(['ANYONE', 'COMPANY', 'NON_COMPANY'])
        .describe('Scope of speakers the model focuses on'),
    })
    .optional()
    .describe(
      'AI model intent configuration showing what the model is designed to detect. Only present for smart trackers.',
    ),
  activityTypes: z
    .array(
      z.object({
        activityType: z
          .enum(['CALL', 'EMAIL'])
          .describe('Activity channel type'),
        enabled: z
          .boolean()
          .describe('Whether this tracker is active for this channel'),
      }),
    )
    .optional()
    .describe(
      'Which activity channels (CALL, EMAIL) this tracker monitors. Only present for keyword trackers.',
    ),
});

export const listSmartTrackersSchema = {
  name: 'listSmartTrackers',
  description:
    'List trackers in the workspace. Smart trackers use AI/ML to detect topics; keyword trackers use phrase matching. Both types are used to flag matching transcript segments.',
  notes:
    'Tracker IDs can be used to filter call searches by tracker matches. Use trackerType to select between AI-powered smart trackers (default) and keyword-based trackers. The trackers shown here are the same ones visible in the Conversations Search "Trackers" filter dropdown.',
  input: z.object({
    trackerType: z
      .enum(['smart', 'keyword'])
      .optional()
      .default('smart')
      .describe(
        'Type of trackers to list. "smart" = AI/ML-powered trackers (default), "keyword" = phrase-based keyword trackers.',
      ),
  }),
  output: z.object({
    smartTrackers: z
      .array(SmartTrackerSchema)
      .describe('Trackers configured in the workspace'),
  }),
};

export type ListSmartTrackersInput = z.infer<
  typeof listSmartTrackersSchema.input
>;
export type ListSmartTrackersOutput = z.infer<
  typeof listSmartTrackersSchema.output
>;

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listCallsSchema,
  getCallTranscriptSchema,
  askCallQuestionSchema,
  getCallSchema,
  getCallSpotlightSchema,
  listAccountsSchema,
  getAccountSchema,
  listPeopleSchema,
  listUsersSchema,
  listDealsSchema,
  getDealActivitiesSchema,
  getForecastBoardsSchema,
  getForecastSchema,
  listFlowsSchema,
  getTeamStatsSchema,
  listSmartTrackersSchema,
];
