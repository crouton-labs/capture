import { z } from 'zod';

export const libraryDescription =
  'Fireflies.ai meeting transcription operations via GraphQL API';

export const libraryIcon = '/icons/libs/fireflies.ico';
export const loginUrl = 'https://app.fireflies.ai';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://app.fireflies.ai\`
2. Call \`getContext()\` to verify login and get user profile
3. Call other functions directly; no auth params needed

## Auth

Fireflies uses cookie-based authentication (credentials: 'include'). The browser's existing login cookies handle auth automatically. No tokens or auth params are passed between functions.

## Key Concepts

- **Meetings**: Meeting recordings with transcripts, identified by \`_id\`
- **Channels**: Organizational folders for grouping meetings, identified by \`_id\`. Can be public (#) or private (lock icon). The channel view is at \`/notebook/{slug}::{channelId}\`.
- **Captions**: Time-stamped transcript segments with speaker identification
- **Summaries**: AI-generated meeting summaries (gist, shortSummary) with sentiment analysis
- **Pagination**: getFeedMeetings uses offset-based pagination (limit/skip), server caps at 20 per page. Use getAllMeetings for automatic pagination.

`;

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Verify login and get current user profile with usage statistics',
  notes:
    'Call FIRST before other Fireflies operations. Must be on fireflies.ai domain. Returns user profile if logged in, throws if not.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: z.object({
    _id: z.string().describe('User ID'),
    email: z.string().describe('User email'),
    isAdmin: z.boolean().describe('Whether user is admin'),
  }),
};

// ============================================================================
// Profiles & Attendees
// ============================================================================

export const ProfileSchema = z.object({
  name: z.string().describe('Display name'),
  email: z.string().describe('Email address'),
  picture: z.string().describe('Profile picture URL'),
});

// ============================================================================
// Channels
// ============================================================================

export const ChannelMemberSchema = z.object({
  _id: z.string().describe('Member user ID'),
  name: z.string().nullable().describe('Member name'),
  email: z.string().nullable().describe('Member email'),
  picture: z.string().nullable().describe('Member profile picture URL'),
  isAdmin: z.boolean().describe('Whether member is a channel admin'),
});

export const ChannelSchema = z.object({
  _id: z.string().describe('Channel ID'),
  title: z.string().describe('Channel name'),
  createdBy: z.string().describe('Creator user ID'),
  isPrivate: z
    .boolean()
    .describe('Whether channel is private (lock icon) or public (# icon)'),
  members: z
    .array(ChannelMemberSchema)
    .nullable()
    .describe(
      'Channel members (empty array when no members added). Member name/email/picture are not populated; use getTeamMembers() to resolve IDs.',
    ),
});

// ============================================================================
// Team
// ============================================================================

export const TeamMemberSchema = z.object({
  id: z.string().describe('User ID (use this for addChannelMembers memberIds)'),
  email: z.string().describe('Member email'),
  name: z.string().describe('Member display name'),
  isAdmin: z.boolean().describe('Whether member is a team admin'),
  status: z.string().describe('Membership status (e.g. "accepted")'),
  picture: z.string().nullable().describe('Profile picture URL'),
});

export const getTeamMembersSchema = {
  name: 'getTeamMembers',
  description: 'List all members of the Fireflies team',
  notes: 'Use the returned member id values when calling addChannelMembers.',
  input: z.object({}),
  output: z.object({
    teamId: z.string().describe('Team ID'),
    teamName: z.string().describe('Team name'),
    members: z.array(TeamMemberSchema).describe('Team members'),
  }),
};

export const listChannelsSchema = {
  name: 'listChannels',
  description: 'List all channels for the current user',
  notes:
    'Member name/email/picture are not populated in this response; only _id and isAdmin. Use getTeamMembers() to resolve member IDs to names and emails.',
  input: z.object({}),
  output: z.array(ChannelSchema).describe('List of channels'),
};

export const createChannelSchema = {
  name: 'createChannel',
  description: 'Create a new channel',
  notes: '',
  input: z.object({
    title: z.string().describe('Channel name'),
    isPrivate: z
      .boolean()
      .describe('Whether channel is private (lock icon) or public (# icon)'),
  }),
  output: ChannelSchema.describe('Created channel'),
};

export const deleteChannelSchema = {
  name: 'deleteChannel',
  description: 'Delete a channel permanently',
  notes:
    'Retrieves channel details automatically to get required internal fields.',
  input: z.object({
    channelId: z.string().describe('Channel ID'),
  }),
  output: z.boolean().describe('Returns true on successful deletion'),
};

export const renameChannelSchema = {
  name: 'renameChannel',
  description: 'Rename a channel',
  notes: '',
  input: z.object({
    channelId: z.string().describe('Channel ID'),
    title: z.string().describe('New channel name'),
  }),
  output: z.object({
    title: z.string().describe('Updated channel name'),
  }),
};

export const ChannelMeetingSchema = z.object({
  id: z.string().describe('Meeting ID'),
  title: z.string().describe('Meeting title'),
  date: z.string().describe('Meeting date ISO string'),
  owner: z.string().describe('Owner user ID'),
  creator_email: z.string().describe('Creator email'),
  durationMins: z.number().describe('Duration in minutes'),
  duration: z.number().describe('Duration in minutes (same as durationMins)'),
  privacy: z.string().describe('Privacy setting'),
  processMeetingStatus: z.string().describe('Processing status'),
});

export const getChannelMeetingsSchema = {
  name: 'getChannelMeetings',
  description: 'List meetings in a channel with pagination',
  notes:
    'Uses from/size pagination like searchMeetings. Meetings use id (not _id) unlike other Fireflies endpoints.',
  input: z.object({
    channelId: z.string().describe('Channel ID'),
    from: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default: 0)'),
    size: z
      .number()
      .optional()
      .default(20)
      .describe('Results per page (default: 20)'),
  }),
  output: z.object({
    total: z.number().describe('Total number of meetings in channel'),
    meetings: z.array(ChannelMeetingSchema).describe('List of meetings'),
  }),
};

export const addChannelMembersSchema = {
  name: 'addChannelMembers',
  description: 'Add members to a channel',
  notes:
    'Member IDs are the id values from getTeamMembers(). Only team members can be added to channels.',
  input: z.object({
    channelId: z.string().describe('Channel ID'),
    memberIds: z.array(z.string()).describe('User IDs to add as members'),
  }),
  output: z.boolean().describe('Returns true on success'),
};

export const removeChannelMemberSchema = {
  name: 'removeChannelMember',
  description: 'Remove a member from a channel',
  notes: '',
  input: z.object({
    channelId: z.string().describe('Channel ID'),
    memberId: z.string().describe('User ID of member to remove'),
  }),
  output: z.boolean().describe('Returns true on success'),
};

export const moveChannelMeetingsSchema = {
  name: 'moveChannelMeetings',
  description: 'Move meetings from one channel to another',
  notes:
    'Use fromChannelId "all" to move uncategorized meetings (not in any channel) into a channel. Only meetings owned by the current user can be moved; others are silently skipped.',
  input: z.object({
    fromChannelId: z
      .string()
      .describe('Source channel ID, or "all" for uncategorized meetings'),
    toChannelId: z.string().describe('Destination channel ID'),
    meetingIds: z.array(z.string()).describe('Meeting IDs to move'),
  }),
  output: z.object({
    meetingsMoved: z
      .array(z.string())
      .describe('Meeting IDs that were successfully moved'),
    meetingsNotMoved: z
      .array(z.string())
      .describe(
        'Meeting IDs that could not be moved (not owned by user or already in target channel)',
      ),
  }),
};

export const removeChannelMeetingsSchema = {
  name: 'removeChannelMeetings',
  description: 'Remove meetings from a channel',
  notes:
    'Removes meetings from the channel without deleting them. Meetings remain accessible outside the channel.',
  input: z.object({
    channelId: z.string().describe('Channel ID'),
    meetingIds: z
      .array(z.string())
      .describe('Meeting IDs to remove from channel'),
  }),
  output: z.boolean().describe('Returns true on success'),
};

export const AttendeeSchema = z.object({
  email: z.string().describe('Attendee email'),
  name: z.string().describe('Attendee name'),
  picture: z.string().nullable().describe('Profile picture URL'),
  displayName: z.string().describe('Display name'),
});

// ============================================================================
// Summaries
// ============================================================================

export const SummarySchema = z.object({
  emoji: z.string().nullable().optional().describe('Summary emoji'),
  title: z.string().nullable().optional().describe('Summary title'),
  sentence: z.string().nullable().optional().describe('Summary sentence'),
});

export const BriefSchema = z.object({
  gist: z.string().nullable().optional().describe('Brief gist'),
  overview: z.string().nullable().optional().describe('Brief overview'),
});

export const DetailedSummarySchema = z.object({
  gist: z.string().nullable().describe('Meeting gist'),
  shortSummary: z.string().nullable().describe('Short summary'),
});

// ============================================================================
// Meetings
// ============================================================================

export const FeedMeetingSchema = z.object({
  _id: z.string().describe('Meeting ID'),
  title: z.string().describe('Meeting title'),
  organizerEmail: z.string().describe('Organizer email'),
  startTime: z.string().describe('Start time ISO string'),
  privacy: z.string().describe('Privacy setting'),
  creator_email: z.string().describe('Creator email'),
  allEmails: z.string().describe('All participant emails (space-separated)'),
  owner: z.string().describe('Owner ID'),
  addedBy: z.string().describe('Added by user ID'),
  hasAiApps: z.boolean().describe('Whether AI apps are enabled'),
  organizerProfile: ProfileSchema.describe('Organizer profile'),
  brief: BriefSchema.nullable().describe('Meeting brief'),
  summary: z
    .union([z.array(SummarySchema), SummarySchema])
    .nullable()
    .describe('Meeting summaries (single or array)'),
  promptSuggestions: z.array(z.string()).describe('Suggested prompts'),
});

export const getFeedMeetingsSchema = {
  name: 'getFeedMeetings',
  description: 'List meetings from Fireflies feed with pagination',
  notes:
    'Server caps results at 20 per page regardless of limit. Use getAllMeetings() for automatic pagination across all results.',
  input: z.object({
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Results per page (default: 20, server max: 20)'),
    skip: z
      .number()
      .optional()
      .default(0)
      .describe('Number of results to skip (default: 0)'),
  }),
  output: z.object({
    total: z.number().describe('Total number of meetings'),
    meetings: z.array(FeedMeetingSchema).describe('List of meetings'),
  }),
};

// ============================================================================
// Transcripts & Captions
// ============================================================================

export const MetricSchema = z.object({
  word: z.string().describe('Keyword'),
  category: z.string().describe('Keyword category'),
});

export const CaptionSchema = z.object({
  index: z.number().describe('Caption index'),
  sentence: z.string().describe('Caption text'),
  speaker_id: z.number().describe('Speaker identifier'),
  time: z.number().describe('Start time in seconds'),
  endTime: z.number().describe('End time in seconds'),
  match: z.string().describe('Search match context ("none" when no match)'),
  metrics: z.array(MetricSchema).nullable().describe('Extracted keywords'),
  sentiment: z
    .number()
    .nullable()
    .describe('Sentiment score (null on some captions)'),
  sentimentType: z
    .enum(['positive', 'negative', 'neutral'])
    .describe('Sentiment classification'),
  filterType: z
    .string()
    .describe('Filter type ("none" when no filter applied)'),
});

export const AudioMetadataSchema = z.object({
  silentMeeting: z.boolean().describe('Whether meeting had no audio'),
  languageCode: z.string().describe('Detected language code'),
  preferredLanguage: z.string().describe('Preferred language'),
  numCaptions: z.number().describe('Total caption count'),
  skipSummaryReason: z
    .string()
    .nullable()
    .describe('Reason summary was skipped'),
  hasGeneratedInstantSummary: z
    .boolean()
    .nullable()
    .describe('Whether instant summary exists'),
});

export const MeetingNoteSchema = z.object({
  _id: z.string().describe('Meeting ID'),
  title: z.string().describe('Meeting title'),
  date: z.string().describe('Meeting date'),
  durationMins: z.string().describe('Duration in minutes'),
  processMeetingStatus: z.string().describe('Processing status'),
  hasCaptions: z.boolean().describe('Whether captions exist'),
  creator_email: z.string().describe('Creator email'),
  privacy: z.string().describe('Privacy setting'),
  captions: z.array(CaptionSchema).describe('Transcript captions'),
  attendees: z.array(AttendeeSchema).describe('Meeting attendees'),
  ownerProfile: ProfileSchema.describe('Owner profile'),
  summary: DetailedSummarySchema.nullable().describe('Meeting summary'),
  audioServiceMetadata: AudioMetadataSchema.describe('Audio metadata'),
});

export const SpeakerMapEntrySchema = z.object({
  speaker_id: z.number().describe('Speaker ID used in captions'),
  name: z.string().describe('Speaker name'),
  email: z.string().describe('Speaker email'),
});

export const fetchTranscriptSchema = {
  name: 'fetchTranscript',
  description:
    'Get full transcript with captions, attendees, and sentiment analysis for a meeting',
  notes:
    'meetingNoteId is the same as the meeting _id from getFeedMeetings. The speakers array maps caption speaker_id values to attendee names.',
  input: z.object({
    meetingNoteId: z.string().describe('Meeting _id from getFeedMeetings'),
  }),
  output: MeetingNoteSchema.extend({
    speakers: z
      .array(SpeakerMapEntrySchema)
      .describe('Mapping from speaker_id to attendee name/email'),
  }),
};

// ============================================================================
// Utilities
// ============================================================================

export const getAllMeetingsSchema = {
  name: 'getAllMeetings',
  description: 'Get all meetings with automatic pagination',
  notes:
    'Returns same meeting objects as getFeedMeetings but auto-paginates to fetch all. Does not return total count; use getFeedMeetings if you need total without fetching all.',
  input: z.object({
    maxMeetings: z
      .number()
      .optional()
      .default(1000)
      .describe('Maximum meetings to fetch (default: 1000)'),
  }),
  output: z
    .array(FeedMeetingSchema)
    .describe('All meetings (same shape as getFeedMeetings items)'),
};

// ============================================================================
// Summary
// ============================================================================

export const RichSummarySchema = z.object({
  gist: z.string().nullable().describe('One-line meeting summary'),
  bulletGist: z
    .string()
    .nullable()
    .describe('Emoji-prefixed bullet point summary (markdown)'),
  shortSummary: z.string().nullable().describe('Detailed paragraph summary'),
  promptSuggestions: z
    .array(z.string())
    .nullable()
    .describe('AI-suggested follow-up questions'),
  overview: z
    .string()
    .nullable()
    .describe('Long-form meeting overview paragraph'),
  outline: z.string().nullable().describe('Meeting outline'),
  shorthandBullet: z
    .string()
    .nullable()
    .describe(
      'Timestamped section outline with emoji headers and bullet points',
    ),
  actionItems: z
    .string()
    .nullable()
    .describe('Action items grouped by person with timestamps'),
  keywords: z
    .array(z.string())
    .nullable()
    .describe(
      'Topic keywords (e.g. "Data loss prevention", "AI security", "Sales strategy")',
    ),
  freeStyleNotes: z.string().nullable().describe('Free-form notes'),
});

export const SummarySectionSchema = z.object({
  key: z
    .string()
    .describe(
      'Section type: BULLET_GIST, SHORTHAND_BULLET, ACTION_ITEMS, PROMPT_SUGGESTIONS, OVERVIEW, etc.',
    ),
  value: z.string().nullable().describe('Raw text content of the section'),
  json: z
    .any()
    .nullable()
    .describe(
      'Structured parsed data. Shape varies by key: BULLET_GIST → [{emoji, title, sentence}], SHORTHAND_BULLET → [{emoji, title, contents[], startTime, endTime}], ACTION_ITEMS → [{personName, personEmail, actionItem, actionItemTimestamp}], OVERVIEW → [paragraph strings]',
    ),
  variant: z.string().nullable().describe('Section variant'),
});

export const getMeetingSummarySchema = {
  name: 'getMeetingSummary',
  description:
    'Get rich AI-generated meeting summary including topics, overview, action items, and structured sections',
  notes:
    'Returns the full summary as shown in the Fireflies UI: topics/keywords, overview paragraph, bullet gist, action items, and timestamped outline. Use summarySections[].json for structured/parsed data.',
  input: z.object({
    meetingNoteId: z.string().describe('Meeting ID from getFeedMeetings'),
  }),
  output: z.object({
    meetingId: z.string().describe('Meeting ID'),
    templateId: z.string().nullable().describe('Summary template ID'),
    summary: RichSummarySchema.nullable().describe(
      'Rich meeting summary with topics, overview, action items, and more',
    ),
    isAutoClassified: z
      .boolean()
      .nullable()
      .describe('Whether meeting was auto-classified'),
    summarySections: z
      .array(SummarySectionSchema)
      .nullable()
      .describe(
        'Structured summary sections with parsed JSON data per section type',
      ),
  }),
};

// ============================================================================
// Search
// ============================================================================

export const HighlightCaptionSchema = z.object({
  sentence: z
    .string()
    .describe('Caption text with <em> tags around matched keywords'),
  time: z.number().describe('Start time in seconds'),
  endTime: z.number().describe('End time in seconds'),
  speaker_id: z.number().describe('Speaker identifier'),
});

export const SearchResultSchema = z.object({
  id: z.string().describe('Meeting ID'),
  title: z.string().describe('Meeting title'),
  shortSummary: z
    .string()
    .nullable()
    .describe('AI-generated short summary of the meeting'),
  parseId: z.string().describe('Parse ID (same as meeting ID)'),
  owner: z.string().describe('Owner user ID'),
  date: z.string().describe('Meeting date ISO string'),
  createdAt: z.string().describe('Creation date ISO string'),
  audioOnly: z.boolean().describe('Whether meeting is audio-only'),
  addedBy: z.string().describe('How the meeting was added'),
  creator_email: z.string().describe('Creator email'),
  durationMins: z.number().describe('Duration in minutes'),
  duration: z.number().describe('Duration in minutes (same as durationMins)'),
  allEmails: z.string().describe('All participant emails (space-separated)'),
  processMeetingStatus: z.string().describe('Processing status'),
  privacy: z.string().describe('Privacy setting'),
  _highlight: z
    .object({
      title: z
        .array(z.string())
        .nullable()
        .describe(
          'Title with <em> tags around matches (array of highlighted title strings)',
        ),
      creator_email: z
        .string()
        .nullable()
        .describe('Creator email with <em> tags if matched'),
      captions: z
        .array(HighlightCaptionSchema)
        .nullable()
        .describe(
          'Transcript excerpts where keyword was found. Can return 4-8+ per meeting; use the full array length for accurate instance counts, do not slice.',
        ),
    })
    .nullable()
    .describe('Search result highlights with matched keyword context'),
});

export const searchMeetingsSchema = {
  name: 'searchMeetings',
  description:
    'Search meetings by keyword across titles and transcripts with filters',
  notes:
    'Full-text search across meeting titles and transcript content. Results include highlighted excerpts with <em> tags around matched keywords. Use channelId "all" to search all meetings. Pagination is offset-based (from/size). Run searches sequentially; concurrent calls cause server errors.',
  input: z.object({
    keywords: z.string().describe('Search query text'),
    from: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default: 0)'),
    size: z
      .number()
      .optional()
      .default(20)
      .describe('Results per page (default: 20)'),
    channelId: z
      .string()
      .optional()
      .default('all')
      .describe(
        'Channel ID to search within, or "all" for all meetings (default: "all")',
      ),
    people: z
      .array(z.string())
      .optional()
      .describe('Filter by host/organizer emails'),
    participants: z
      .array(z.string())
      .optional()
      .describe('Filter by participant emails'),
    exact: z
      .boolean()
      .optional()
      .default(false)
      .describe('Exact phrase match (default: false)'),
    sortField: z
      .string()
      .optional()
      .default('date')
      .describe('Sort field (default: "date")'),
    sortOrder: z
      .enum(['ASC', 'DESC'])
      .optional()
      .default('DESC')
      .describe('Sort order (default: "DESC")'),
  }),
  output: z.object({
    total: z.number().describe('Total number of matching meetings'),
    meetings: z
      .array(SearchResultSchema)
      .describe('Search results with highlights'),
  }),
};

// ============================================================================
// Write Operations
// ============================================================================

export const deleteMeetingSchema = {
  name: 'deleteMeeting',
  description: 'Delete a meeting transcript permanently',
  notes:
    'Permanently removes meeting and all associated data. Cannot be undone.',
  input: z.object({
    meetingId: z.string().describe('Meeting ID'),
  }),
  output: z.boolean().describe('Returns true on successful deletion'),
};

export const renameMeetingSchema = {
  name: 'renameMeeting',
  description: 'Update a meeting title',
  notes: 'Changes meeting title. Returns the updated title on success.',
  input: z.object({
    meetingId: z.string().describe('Meeting ID'),
    title: z.string().describe('New title'),
  }),
  output: z.object({
    title: z.string().describe('Updated meeting title'),
  }),
};

export const uploadRecordingSchema = {
  name: 'uploadRecording',
  description: 'Upload an audio or video recording for transcription',
  notes:
    'Supported formats: audio/mpeg, mp3, m4a, wav, video/mp4, webm. File is queued for transcription after upload. Default language is English (en).',
  input: z.object({
    fileData: z
      .string()
      .describe('Base64-encoded file content (browser environment)'),
    fileName: z
      .string()
      .describe('File name with extension (e.g., "meeting.mp4")'),
    contentType: z
      .string()
      .optional()
      .default('video/mp4')
      .describe('MIME type (default: video/mp4)'),
    customLanguage: z
      .string()
      .optional()
      .default('en')
      .describe('Language code for transcription (default: en)'),
    email: z
      .string()
      .optional()
      .describe(
        'User email (optional, uses authenticated user if not provided)',
      ),
  }),
  output: z.object({
    meetingId: z.string().describe('Meeting ID for the uploaded recording'),
    fileId: z.string().describe('File ID from createUserFile mutation'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  getFeedMeetingsSchema,
  fetchTranscriptSchema,
  getAllMeetingsSchema,
  getMeetingSummarySchema,
  searchMeetingsSchema,
  deleteMeetingSchema,
  renameMeetingSchema,
  uploadRecordingSchema,
  getTeamMembersSchema,
  listChannelsSchema,
  createChannelSchema,
  deleteChannelSchema,
  renameChannelSchema,
  getChannelMeetingsSchema,
  addChannelMembersSchema,
  removeChannelMemberSchema,
  moveChannelMeetingsSchema,
  removeChannelMeetingsSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Entity types
export type Profile = z.infer<typeof ProfileSchema>;
export type Attendee = z.infer<typeof AttendeeSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type DetailedSummary = z.infer<typeof DetailedSummarySchema>;
export type FeedMeeting = z.infer<typeof FeedMeetingSchema>;
export type Metric = z.infer<typeof MetricSchema>;
export type Caption = z.infer<typeof CaptionSchema>;
export type AudioMetadata = z.infer<typeof AudioMetadataSchema>;
export type MeetingNote = z.infer<typeof MeetingNoteSchema>;
export type RichSummary = z.infer<typeof RichSummarySchema>;
export type SummarySection = z.infer<typeof SummarySectionSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type HighlightCaption = z.infer<typeof HighlightCaptionSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type ChannelMember = z.infer<typeof ChannelMemberSchema>;
export type ChannelMeeting = z.infer<typeof ChannelMeetingSchema>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type GetFeedMeetingsOutput = z.infer<
  typeof getFeedMeetingsSchema.output
>;
export type FetchTranscriptOutput = z.infer<
  typeof fetchTranscriptSchema.output
>;
export type GetMeetingSummaryOutput = z.infer<
  typeof getMeetingSummarySchema.output
>;
export type SearchMeetingsOutput = z.infer<typeof searchMeetingsSchema.output>;
export type DeleteMeetingOutput = z.infer<typeof deleteMeetingSchema.output>;
export type RenameMeetingOutput = z.infer<typeof renameMeetingSchema.output>;
export type UploadRecordingOutput = z.infer<
  typeof uploadRecordingSchema.output
>;
export type ListChannelsOutput = z.infer<typeof listChannelsSchema.output>;
export type CreateChannelOutput = z.infer<typeof createChannelSchema.output>;
export type DeleteChannelOutput = z.infer<typeof deleteChannelSchema.output>;
export type RenameChannelOutput = z.infer<typeof renameChannelSchema.output>;
export type GetChannelMeetingsOutput = z.infer<
  typeof getChannelMeetingsSchema.output
>;
export type AddChannelMembersOutput = z.infer<
  typeof addChannelMembersSchema.output
>;
export type RemoveChannelMemberOutput = z.infer<
  typeof removeChannelMemberSchema.output
>;
export type MoveChannelMeetingsOutput = z.infer<
  typeof moveChannelMeetingsSchema.output
>;
export type RemoveChannelMeetingsOutput = z.infer<
  typeof removeChannelMeetingsSchema.output
>;
export type TeamMember = z.infer<typeof TeamMemberSchema>;
export type GetTeamMembersOutput = z.infer<typeof getTeamMembersSchema.output>;
