// Types from schemas - single source of truth
export type {
  Profile,
  Attendee,
  Summary,
  Brief,
  DetailedSummary,
  FeedMeeting,
  Metric,
  Caption,
  AudioMetadata,
  MeetingNote,
  RichSummary,
  SummarySection,
  SearchResult,
  HighlightCaption,
  Channel,
  ChannelMember,
  ChannelMeeting,
  TeamMember,
  GetContextOutput,
  GetFeedMeetingsOutput,
  FetchTranscriptOutput,
  GetMeetingSummaryOutput,
  SearchMeetingsOutput,
  DeleteMeetingOutput,
  RenameMeetingOutput,
  UploadRecordingOutput,
  ListChannelsOutput,
  CreateChannelOutput,
  DeleteChannelOutput,
  RenameChannelOutput,
  GetChannelMeetingsOutput,
  AddChannelMembersOutput,
  RemoveChannelMemberOutput,
  MoveChannelMeetingsOutput,
  RemoveChannelMeetingsOutput,
  GetTeamMembersOutput,
} from './schemas';

import { Validation, Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';

import type {
  GetContextOutput,
  GetFeedMeetingsOutput,
  FetchTranscriptOutput,
  GetMeetingSummaryOutput,
  SearchMeetingsOutput,
  DeleteMeetingOutput,
  RenameMeetingOutput,
  UploadRecordingOutput,
  ListChannelsOutput,
  CreateChannelOutput,
  DeleteChannelOutput,
  RenameChannelOutput,
  GetChannelMeetingsOutput,
  AddChannelMembersOutput,
  RemoveChannelMemberOutput,
  MoveChannelMeetingsOutput,
  RemoveChannelMeetingsOutput,
  GetTeamMembersOutput,
} from './schemas';

// ============================================================================
// Context Acquisition
// ============================================================================

/**
 * Get authentication context and user profile for Fireflies.
 * Call this FIRST before any other Fireflies operations.
 */
export async function getContext(
  opts: {
    timeoutMs?: number;
  } = {},
): Promise<GetContextOutput> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const startTime = Date.now();

  // Wait for page to be on Fireflies domain
  while (!window.location.hostname.includes('fireflies.ai')) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Validation(`Not on Fireflies domain. URL: ${window.location.href}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Verify login by fetching user profile
  const data = await graphqlRequest<{
    user: { _id: string; email: string; isAdmin: boolean };
  }>('GetUser', GET_USER_QUERY, {});

  return {
    _id: data.user._id,
    email: data.user.email,
    isAdmin: data.user.isAdmin,
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

const GRAPHQL_ENDPOINT = '/api/v4/graphql';
const HIVE_GRAPHQL_ENDPOINT = '/api/v4/hive';

async function graphqlRequest<T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
    },
    body: JSON.stringify({
      operationName,
      variables,
      query,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(response.status, truncated);
  }

  const json = await response.json();

  if (json.errors) {
    throw new UpstreamError(`GraphQL errors: ${JSON.stringify(json.errors, null, 2)}`);
  }

  return json.data;
}

/**
 * GraphQL request to /api/v4/hive endpoint with JWT auth.
 * Used for media upload operations.
 */
async function hiveGraphqlRequest<T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  // Extract JWT from localStorage
  const token = localStorage.getItem('REFRESH_TOKEN');
  if (!token) {
    throw new Unauthenticated(
      `JWT token not found in localStorage (REFRESH_TOKEN). URL: ${window.location.href}`,
    );
  }

  const response = await fetch(HIVE_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      'x-refresh-token': token,
      'x-graphql-client-name': 'dashboard-ff',
      'apollographql-client-name': 'app.fireflies.ai',
      'x-auth-provider': 'gauth',
    },
    body: JSON.stringify({
      operationName,
      variables,
      query,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(response.status, truncated);
  }

  const json = await response.json();

  if (json.errors) {
    throw new UpstreamError(`GraphQL errors: ${JSON.stringify(json.errors, null, 2)}`);
  }

  return json.data;
}

// ============================================================================
// GraphQL Queries
// ============================================================================

const GET_USER_QUERY = `query GetUser {
  user {
    _id
    email
    isAdmin
  }
}`;

const GET_FEED_MEETINGS_QUERY = `query GetFeedMeetings($limit: Int, $skip: Int) {
  getFeedMeetings(limit: $limit, skip: $skip) {
    total
    meetings {
      _id
      title
      organizerEmail
      startTime
      privacy
      creator_email
      allEmails
      owner
      addedBy
      hasAiApps
      organizerProfile {
        name
        email
        picture
        __typename
      }
      brief {
        gist
        overview
        __typename
      }
      summary {
        emoji
        title
        sentence
        __typename
      }
      promptSuggestions
      __typename
    }
    __typename
  }
}`;

const FETCH_TRANSCRIPT_QUERY = `query fetchNotepadMeeting($meetingNoteId: String!) {
  meetingNote(_id: $meetingNoteId) {
    _id
    title
    date
    durationMins
    processMeetingStatus
    hasCaptions
    creator_email
    privacy
    captions {
      index
      sentence
      speaker_id
      time
      endTime
      match
      metrics {
        word
        category
        __typename
      }
      sentiment
      sentimentType
      filterType
      __typename
    }
    attendees {
      email
      name
      picture
      displayName
      __typename
    }
    ownerProfile {
      name
      email
      picture
      __typename
    }
    summary {
      gist
      shortSummary
      __typename
    }
    audioServiceMetadata {
      silentMeeting
      languageCode
      preferredLanguage
      numCaptions
      skipSummaryReason
      hasGeneratedInstantSummary
      __typename
    }
    __typename
  }
}`;

// ============================================================================
// Meetings
// ============================================================================

/**
 * List meetings from Fireflies feed.
 */
export async function getFeedMeetings(opts: {
  limit?: number;
  skip?: number;
}): Promise<GetFeedMeetingsOutput> {
  const data = await graphqlRequest<{ getFeedMeetings: GetFeedMeetingsOutput }>(
    'GetFeedMeetings',
    GET_FEED_MEETINGS_QUERY,
    {
      limit: opts.limit ?? 20,
      skip: opts.skip ?? 0,
    },
  );

  return data.getFeedMeetings;
}

/**
 * Get all meetings (handles pagination automatically).
 */
export async function getAllMeetings(
  opts: {
    maxMeetings?: number;
  } = {},
): Promise<GetFeedMeetingsOutput['meetings']> {
  const meetings: GetFeedMeetingsOutput['meetings'] = [];
  const maxMeetings = opts.maxMeetings ?? 1000;
  let skip = 0;
  const limit = 20;

  while (meetings.length < maxMeetings) {
    const result = await getFeedMeetings({ limit, skip });
    meetings.push(...result.meetings);

    if (meetings.length >= result.total || result.meetings.length === 0) {
      break;
    }

    skip += result.meetings.length;
  }

  return meetings.slice(0, maxMeetings);
}

// ============================================================================
// Transcripts
// ============================================================================

/**
 * Get full transcript for a meeting.
 */
export async function fetchTranscript(opts: {
  meetingNoteId: string;
}): Promise<FetchTranscriptOutput> {
  const data = await graphqlRequest<{ meetingNote: FetchTranscriptOutput }>(
    'fetchNotepadMeeting',
    FETCH_TRANSCRIPT_QUERY,
    { meetingNoteId: opts.meetingNoteId },
  );

  const note = data.meetingNote;
  const speakers = (note.attendees || []).map((a, i) => ({
    speaker_id: i,
    name: a.displayName || a.name,
    email: a.email,
  }));

  return { ...note, speakers };
}

// ============================================================================
// Summary & Speakers
// ============================================================================

const GET_MEETING_SUMMARY_QUERY = `query getMeetingSummary($meetingId: ID!) {
  getMeetingSummary(meetingId: $meetingId) {
    meetingId
    templateId
    summary {
      gist
      bulletGist
      shortSummary
      promptSuggestions
      overview
      outline
      shorthandBullet
      actionItems
      keywords
      freeStyleNotes
    }
    isAutoClassified
    summarySections {
      key
      value
      json
      variant
    }
  }
}`;

/**
 * Get rich AI-generated meeting summary including topics, overview, action items, and structured sections.
 */
export async function getMeetingSummary(opts: {
  meetingNoteId: string;
}): Promise<GetMeetingSummaryOutput> {
  const data = await hiveGraphqlRequest<{
    getMeetingSummary: GetMeetingSummaryOutput;
  }>('getMeetingSummary', GET_MEETING_SUMMARY_QUERY, {
    meetingId: opts.meetingNoteId,
  });
  return data.getMeetingSummary;
}

// ============================================================================
// Search
// ============================================================================

const GLOBAL_SEARCH_QUERY = `query globalSearch($from: Int!, $size: Int!, $channelId: String!, $keywords: String, $filters: SearchFilters, $sort: [GlobalSearchSortInput!]) {
  globalSearch(
    from: $from
    size: $size
    channelId: $channelId
    keywords: $keywords
    filters: $filters
    sort: $sort
  ) {
    total
    meetings {
      id
      title
      shortSummary
      parseId
      owner
      date
      createdAt
      audioOnly
      addedBy
      creator_email
      durationMins
      duration
      allEmails
      processMeetingStatus
      privacy
      _highlight {
        title
        creator_email
        captions {
          sentence
          time
          endTime
          speaker_id
        }
      }
    }
  }
}`;

/**
 * Search meetings by keyword across titles and transcripts.
 */
export async function searchMeetings(opts: {
  keywords: string;
  from?: number;
  size?: number;
  channelId?: string;
  people?: string[];
  participants?: string[];
  exact?: boolean;
  sortField?: string;
  sortOrder?: string;
}): Promise<SearchMeetingsOutput> {
  if (!opts.keywords) {
    throw new Validation('keywords is required and cannot be empty');
  }
  const data = await hiveGraphqlRequest<{
    globalSearch: SearchMeetingsOutput;
  }>('globalSearch', GLOBAL_SEARCH_QUERY, {
    from: opts.from ?? 0,
    size: opts.size ?? 20,
    channelId: opts.channelId ?? 'all',
    keywords: opts.keywords,
    filters: {
      people: opts.people ?? [],
      participants: opts.participants ?? [],
      exact: opts.exact ?? false,
    },
    sort: [
      {
        field: opts.sortField ?? 'date',
        order: opts.sortOrder ?? 'DESC',
      },
    ],
  });
  return data.globalSearch;
}

// ============================================================================
// Write Operations
// ============================================================================

const DELETE_MEETING_MUTATION = `mutation DeleteMeetings($meetingIds: [String!]!) {
  deleteMeetings(meetingIds: $meetingIds)
}`;

/**
 * Delete a meeting transcript.
 */
export async function deleteMeeting(opts: {
  meetingId: string;
}): Promise<DeleteMeetingOutput> {
  const data = await graphqlRequest<{ deleteMeetings: string }>(
    'DeleteMeetings',
    DELETE_MEETING_MUTATION,
    { meetingIds: [opts.meetingId] },
  );
  return data.deleteMeetings === 'true';
}

const RENAME_MEETING_MUTATION = `mutation RenameMeeting($meetingId: String!, $title: String!) {
  updateMeetingTitle(meetingId: $meetingId, title: $title)
}`;

/**
 * Rename a meeting title.
 */
export async function renameMeeting(opts: {
  meetingId: string;
  title: string;
}): Promise<RenameMeetingOutput> {
  const data = await graphqlRequest<{ updateMeetingTitle: string }>(
    'RenameMeeting',
    RENAME_MEETING_MUTATION,
    { meetingId: opts.meetingId, title: opts.title },
  );
  return { title: data.updateMeetingTitle };
}

// ============================================================================
// Upload Operations
// ============================================================================

const CREATE_MEETING_IN_MEDIA_STORAGE_MUTATION = `mutation createMeetingInMediaStorage($title: String!, $extension: String!, $contentType: String!, $assetType: String!, $customLanguage: String, $meetingDate: String) {
  createMeetingInMediaStorage(title: $title, extension: $extension, contentType: $contentType, assetType: $assetType, customLanguage: $customLanguage, meetingDate: $meetingDate) {
    meeting
    uploadSignedUrl
  }
}`;

const GET_SIGNED_MEDIA_URL_QUERY = `query getSignedMediaUrl($meetingId: String!, $contentType: String!, $extension: String!) {
  getSignedMediaUrl(meetingId: $meetingId, contentType: $contentType, extension: $extension)
}`;

const CREATE_USER_FILE_MUTATION = `mutation CreateUserFile($fileName: String!, $fileType: String!, $fileSize: Float, $audioUrl: String, $email: String, $meetingId: String) {
  createUserFile(fileName: $fileName, fileType: $fileType, fileSize: $fileSize, audioUrl: $audioUrl, email: $email, meetingId: $meetingId)
}`;

// ============================================================================
// Channel Queries & Mutations
// ============================================================================

const GET_CHANNELS_LIST_QUERY = `query getChannelsList {
  getChannelsList {
    _id
    title
    createdBy
    isPrivate
    members {
      _id
      name
      email
      picture
      isAdmin
    }
  }
}`;

const GET_CHANNEL_QUERY = `query getChannel($id: String!) {
  getChannel(id: $id) {
    _id
    title
    createdBy
    isPrivate
    members {
      _id
      name
      email
      picture
      isAdmin
    }
  }
}`;

const CREATE_CHANNEL_MUTATION = `mutation createChannel($title: String!, $privacy: Boolean!) {
  createChannel(title: $title, privacy: $privacy) {
    _id
    title
    createdBy
    isPrivate
    members {
      _id
      name
      email
      picture
      isAdmin
    }
  }
}`;

const DELETE_CHANNEL_MUTATION = `mutation deleteChannel($channelId: String!, $isPrivate: Boolean!, $createdBy: String!) {
  deleteChannel(channelId: $channelId, isPrivate: $isPrivate, createdBy: $createdBy)
}`;

const RENAME_CHANNEL_MUTATION = `mutation renameChannel($channelId: String!, $title: String!) {
  renameChannel(channelId: $channelId, title: $title)
}`;

const GET_CHANNEL_MEETINGS_QUERY = `query getChannelMeetings($channelId: String!, $from: Int!, $size: Int!) {
  getChannelMeetings(channelId: $channelId, from: $from, size: $size) {
    total
    meetings {
      id
      title
      date
      owner
      creator_email
      durationMins
      duration
      privacy
      processMeetingStatus
    }
  }
}`;

const ADD_MEMBERS_MUTATION = `mutation addMembers($channelId: String!, $membersId: [String]!) {
  addMembers(channelId: $channelId, membersId: $membersId)
}`;

const REMOVE_MEMBER_MUTATION = `mutation removeMember($channelId: String!, $memberId: String!) {
  removeMember(channelId: $channelId, memberId: $memberId)
}`;

const MOVE_CHANNEL_MEETINGS_MUTATION = `mutation moveChannelMeetings($toChannelId: String!, $fromChannelId: String!, $meetingIds: [String!]!) {
  moveChannelMeetings(toChannelId: $toChannelId, fromChannelId: $fromChannelId, meetingIds: $meetingIds)
}`;

const GET_TEAM_MEMBERS_QUERY = `query getTeamMembers {
  team: teamAccount {
    _id
    name
    teammates {
      id
      email
      name
      isAdmin
      status
      profile {
        picture
      }
    }
  }
}`;

const REMOVE_CHANNEL_MEETINGS_MUTATION = `mutation removeChannelMeetings($channelId: String!, $meetingIds: [String!]!) {
  removeChannelMeetings(channelId: $channelId, meetingIds: $meetingIds)
}`;

/**
 * Upload an audio or video recording for transcription.
 * Executes the 4-step upload flow: create meeting → upload to S3 → get CDN URL → register file.
 */
export async function uploadRecording(opts: {
  fileData: string;
  fileName: string;
  contentType?: string;
  customLanguage?: string;
  email?: string;
}): Promise<UploadRecordingOutput> {
  // Apply defaults matching schema
  const contentType =
    opts.contentType !== undefined ? opts.contentType : 'video/mp4';
  const customLanguage =
    opts.customLanguage !== undefined ? opts.customLanguage : 'en';

  // Extract extension from fileName
  const extension = opts.fileName.split('.').pop();
  if (!extension) {
    throw new Validation(
      `Invalid fileName: no extension found in "${opts.fileName}"`,
    );
  }

  // Determine asset type from contentType
  const assetType = contentType.startsWith('video/') ? 'video' : 'audio';

  // Convert base64 to Uint8Array
  const fileBytes = Uint8Array.from(atob(opts.fileData), (c) =>
    c.charCodeAt(0),
  );
  const fileSize = fileBytes.length;

  // Step 1: Create meeting and get presigned URL
  const createResponse = await hiveGraphqlRequest<{
    createMeetingInMediaStorage: {
      meeting: { status: boolean; meeting: string };
      uploadSignedUrl: string;
    };
  }>('createMeetingInMediaStorage', CREATE_MEETING_IN_MEDIA_STORAGE_MUTATION, {
    title: opts.fileName,
    extension,
    contentType,
    assetType,
    customLanguage,
  });

  const meetingId = createResponse.createMeetingInMediaStorage.meeting.meeting;
  const uploadSignedUrl =
    createResponse.createMeetingInMediaStorage.uploadSignedUrl;

  // Step 2: Upload file to S3
  const uploadResponse = await fetch(uploadSignedUrl, {
    method: 'PUT',
    body: fileBytes,
    headers: {
      'Content-Type': contentType,
    },
  });

  if (!uploadResponse.ok) {
    throw new UpstreamError(
      `S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
    );
  }

  // Step 3: Get CDN URL
  const cdnResponse = await hiveGraphqlRequest<{
    getSignedMediaUrl: string;
  }>('getSignedMediaUrl', GET_SIGNED_MEDIA_URL_QUERY, {
    meetingId,
    contentType,
    extension,
  });

  const cdnUrl = cdnResponse.getSignedMediaUrl;

  // Step 4: Register file
  // If email not provided, use the authenticated user's email from getContext
  let userEmail = opts.email;
  if (!userEmail) {
    const context = await getContext();
    userEmail = context.email;
  }

  const fileIdResponse = await hiveGraphqlRequest<{
    createUserFile: string;
  }>('CreateUserFile', CREATE_USER_FILE_MUTATION, {
    fileName: opts.fileName,
    fileType: contentType,
    fileSize,
    audioUrl: cdnUrl,
    email: userEmail,
    meetingId,
  });

  const fileId = fileIdResponse.createUserFile;

  return {
    meetingId,
    fileId,
  };
}

// ============================================================================
// Team
// ============================================================================

/**
 * List all members of the Fireflies team.
 */
export async function getTeamMembers(): Promise<GetTeamMembersOutput> {
  const data = await graphqlRequest<{
    team: {
      _id: string;
      name: string;
      teammates: Array<{
        id: string;
        email: string;
        name: string;
        isAdmin: boolean;
        status: string;
        profile: { picture: string | null };
      }>;
    };
  }>('getTeamMembers', GET_TEAM_MEMBERS_QUERY, {});

  return {
    teamId: data.team._id,
    teamName: data.team.name,
    members: data.team.teammates.map((t) => ({
      id: t.id,
      email: t.email,
      name: t.name,
      isAdmin: t.isAdmin,
      status: t.status,
      picture: t.profile?.picture ?? null,
    })),
  };
}

// ============================================================================
// Channels
// ============================================================================

/**
 * List all channels for the current user.
 */
export async function listChannels(): Promise<ListChannelsOutput> {
  const data = await graphqlRequest<{ getChannelsList: ListChannelsOutput }>(
    'getChannelsList',
    GET_CHANNELS_LIST_QUERY,
    {},
  );
  return data.getChannelsList;
}

/**
 * Create a new channel.
 */
export async function createChannel(opts: {
  title: string;
  isPrivate: boolean;
}): Promise<CreateChannelOutput> {
  const data = await graphqlRequest<{ createChannel: CreateChannelOutput }>(
    'createChannel',
    CREATE_CHANNEL_MUTATION,
    {
      title: opts.title,
      privacy: opts.isPrivate,
    },
  );
  return data.createChannel;
}

/**
 * Delete a channel permanently.
 * Retrieves channel details automatically to get required internal fields.
 */
export async function deleteChannel(opts: {
  channelId: string;
}): Promise<DeleteChannelOutput> {
  // Get channel details first to get isPrivate and createdBy
  const channelData = await graphqlRequest<{
    getChannel: { isPrivate: boolean; createdBy: string };
  }>('getChannel', GET_CHANNEL_QUERY, { id: opts.channelId });

  const data = await graphqlRequest<{ deleteChannel: string }>(
    'deleteChannel',
    DELETE_CHANNEL_MUTATION,
    {
      channelId: opts.channelId,
      isPrivate: channelData.getChannel.isPrivate,
      createdBy: channelData.getChannel.createdBy,
    },
  );

  return data.deleteChannel === 'Channel deleted successfully';
}

/**
 * Rename a channel.
 */
export async function renameChannel(opts: {
  channelId: string;
  title: string;
}): Promise<RenameChannelOutput> {
  const data = await graphqlRequest<{ renameChannel: string }>(
    'renameChannel',
    RENAME_CHANNEL_MUTATION,
    {
      channelId: opts.channelId,
      title: opts.title,
    },
  );
  return { title: data.renameChannel };
}

/**
 * List meetings in a channel with pagination.
 */
export async function getChannelMeetings(opts: {
  channelId: string;
  from?: number;
  size?: number;
}): Promise<GetChannelMeetingsOutput> {
  const data = await graphqlRequest<{
    getChannelMeetings: GetChannelMeetingsOutput;
  }>('getChannelMeetings', GET_CHANNEL_MEETINGS_QUERY, {
    channelId: opts.channelId,
    from: opts.from ?? 0,
    size: opts.size ?? 20,
  });
  return data.getChannelMeetings;
}

/**
 * Add members to a channel.
 */
export async function addChannelMembers(opts: {
  channelId: string;
  memberIds: string[];
}): Promise<AddChannelMembersOutput> {
  await graphqlRequest<{ addMembers: unknown }>(
    'addMembers',
    ADD_MEMBERS_MUTATION,
    {
      channelId: opts.channelId,
      membersId: opts.memberIds,
    },
  );
  return true;
}

/**
 * Remove a member from a channel.
 */
export async function removeChannelMember(opts: {
  channelId: string;
  memberId: string;
}): Promise<RemoveChannelMemberOutput> {
  await graphqlRequest<{ removeMember: unknown }>(
    'removeMember',
    REMOVE_MEMBER_MUTATION,
    {
      channelId: opts.channelId,
      memberId: opts.memberId,
    },
  );
  return true;
}

/**
 * Move meetings from one channel to another.
 */
export async function moveChannelMeetings(opts: {
  fromChannelId: string;
  toChannelId: string;
  meetingIds: string[];
}): Promise<MoveChannelMeetingsOutput> {
  const data = await graphqlRequest<{
    moveChannelMeetings: {
      meetingsMoved: string[];
      meetingsNotMoved: string[];
    };
  }>('moveChannelMeetings', MOVE_CHANNEL_MEETINGS_MUTATION, {
    fromChannelId: opts.fromChannelId,
    toChannelId: opts.toChannelId,
    meetingIds: opts.meetingIds,
  });
  const result = data.moveChannelMeetings;
  return {
    meetingsMoved: result.meetingsMoved ?? [],
    meetingsNotMoved: result.meetingsNotMoved ?? [],
  };
}

/**
 * Remove meetings from a channel.
 */
export async function removeChannelMeetings(opts: {
  channelId: string;
  meetingIds: string[];
}): Promise<RemoveChannelMeetingsOutput> {
  await graphqlRequest<{ removeChannelMeetings: unknown }>(
    'removeChannelMeetings',
    REMOVE_CHANNEL_MEETINGS_MUTATION,
    {
      channelId: opts.channelId,
      meetingIds: opts.meetingIds,
    },
  );
  return true;
}
