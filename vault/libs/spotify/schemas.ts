import { z } from 'zod';

export const libraryDescription =
  'Spotify music playback control, search, playlists, and artist/album info via internal APIs (desktop app and web player)';

export const libraryIcon = '/icons/libs/spotify.png';
export const loginUrl = 'https://open.spotify.com';

export const libraryNotes = `
## Setup

Works with both the **desktop app** and **web player**. Platform is auto-detected.

**Desktop app**: run with remote debugging enabled:
\`\`\`
/Applications/Spotify.app/Contents/MacOS/Spotify --remote-debugging-port=9222
\`\`\`
Navigate to the desktop app page at \`xpui.app.spotify.com\`.

**Web player**: open \`open.spotify.com\` in a browser with CDP enabled. Navigate to the web player tab.

## Workflow

1. Call \`getContext()\`: auto-detects platform, extracts Bearer token and username
2. Use the returned \`token\` for all subsequent operations
3. Check \`platform\` field (\`desktop\` or \`web\`) if you need to know which environment is active

## Key Concepts

**Spotify URIs**: All entities are referenced by URIs like \`spotify:track:ID\`, \`spotify:album:ID\`, \`spotify:artist:ID\`, \`spotify:playlist:ID\`.

**Playback Context**: When playing music, you specify a context (album, artist, playlist) and optionally a specific track within it. Playing a track URI directly creates a one-song queue; playing an album/playlist/artist URI plays all tracks in order.

**Device ID**: The active device is captured by \`getContext()\`. If the user switches devices, call \`getContext()\` again.

**IMPORTANT**: Never call \`api.spotify.com/v1\` endpoints directly. They aggressively rate-limit tokens (429 with retry-after that resets on each new request, creating an unbreakable loop). All library functions use internal APIs that don't have this problem.
`;

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract auth token and session info from Spotify: call FIRST before any other function. Works in both desktop app and web player.',
  notes: '',
  input: z.object({}),
  output: z.object({
    token: z.string().describe('Bearer token for API calls'),
    deviceId: z.string().describe('Active device ID for playback commands'),
    username: z.string().describe('Current Spotify username'),
    deviceName: z.string().describe('Name of the active device'),
    platform: z
      .enum(['desktop', 'web'])
      .describe(
        'Which Spotify environment is active: desktop app or web player',
      ),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Search
// ============================================================================

export const searchSchema = {
  name: 'search',
  description:
    'Search Spotify for tracks, artists, albums, and playlists. Returns top results across all categories.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    query: z.string().describe('Search query (artist name, song title, etc.)'),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Max results per category (default 10)'),
  }),
  output: z.object({
    tracks: z.array(
      z.object({
        name: z.string(),
        uri: z.string(),
        artists: z.array(z.string()),
        album: z.string(),
        durationMs: z.number(),
      }),
    ),
    artists: z.array(
      z.object({
        name: z.string(),
        uri: z.string(),
      }),
    ),
    albums: z.array(
      z.object({
        name: z.string(),
        uri: z.string(),
        year: z.number().nullable(),
        artists: z.array(z.string()),
      }),
    ),
    playlists: z.array(
      z.object({
        name: z.string(),
        uri: z.string(),
        owner: z.string(),
      }),
    ),
  }),
};
export type SearchInput = z.infer<typeof searchSchema.input>;
export type SearchOutput = z.infer<typeof searchSchema.output>;

// ============================================================================
// Artist
// ============================================================================

export const getArtistSchema = {
  name: 'getArtist',
  description:
    'Get detailed artist information including top tracks, discography, monthly listeners, related artists, and biography',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    artistUri: z
      .string()
      .describe(
        'Spotify artist URI (e.g., spotify:artist:4Z8W4fKeB5YxbusRsdQVPb)',
      ),
  }),
  output: z.object({
    name: z.string(),
    uri: z.string(),
    verified: z.boolean(),
    monthlyListeners: z.number(),
    biography: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    topTracks: z.array(
      z.object({
        name: z.string(),
        uri: z.string(),
        playcount: z.string(),
        durationMs: z.number(),
        album: z.string(),
      }),
    ),
    albums: z.array(
      z.object({
        name: z.string(),
        uri: z.string(),
        year: z.number().nullable(),
        type: z.string(),
      }),
    ),
    relatedArtists: z.array(
      z.object({
        name: z.string(),
        uri: z.string(),
      }),
    ),
  }),
};
export type GetArtistInput = z.infer<typeof getArtistSchema.input>;
export type GetArtistOutput = z.infer<typeof getArtistSchema.output>;

// ============================================================================
// Album
// ============================================================================

export const getAlbumSchema = {
  name: 'getAlbum',
  description:
    'Get album details including all tracks, artist info, and release date',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    albumUri: z
      .string()
      .describe(
        'Spotify album URI (e.g., spotify:album:6dVIqQ8qmQ5GBnJ9shOYGE)',
      ),
  }),
  output: z.object({
    name: z.string(),
    uri: z.string(),
    type: z.string().describe('ALBUM, SINGLE, or COMPILATION'),
    releaseDate: z.string().nullable(),
    label: z.string().nullable(),
    totalTracks: z.number(),
    artists: z.array(z.object({ name: z.string(), uri: z.string() })),
    tracks: z.array(
      z.object({
        name: z.string(),
        uri: z.string(),
        trackNumber: z.number(),
        durationMs: z.number(),
        playcount: z.string().nullable(),
      }),
    ),
  }),
};
export type GetAlbumInput = z.infer<typeof getAlbumSchema.input>;
export type GetAlbumOutput = z.infer<typeof getAlbumSchema.output>;

// ============================================================================
// Playlists
// ============================================================================

export const listPlaylistsSchema = {
  name: 'listPlaylists',
  description: "List the current user's playlists from their library",
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    username: z.string().describe('Spotify username from getContext'),
    limit: z
      .number()
      .optional()
      .default(50)
      .describe('Max playlists to return (default 50)'),
  }),
  output: z.object({
    playlists: z.array(
      z.object({
        uri: z.string(),
        name: z.string().nullable(),
      }),
    ),
    total: z.number(),
  }),
};
export type ListPlaylistsInput = z.infer<typeof listPlaylistsSchema.input>;
export type ListPlaylistsOutput = z.infer<typeof listPlaylistsSchema.output>;

export const getPlaylistSchema = {
  name: 'getPlaylist',
  description:
    'Get playlist details including name, owner, track count, and track listing',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    playlistId: z
      .string()
      .describe(
        'Playlist ID (from URI spotify:playlist:ID, pass just the ID part)',
      ),
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Max tracks to return (default 100)'),
  }),
  output: z.object({
    name: z.string(),
    description: z.string().nullable(),
    owner: z.string(),
    trackCount: z.number(),
    tracks: z.array(
      z.object({
        uri: z.string(),
        addedAt: z
          .string()
          .nullable()
          .describe('Timestamp when track was added'),
      }),
    ),
  }),
};
export type GetPlaylistInput = z.infer<typeof getPlaylistSchema.input>;
export type GetPlaylistOutput = z.infer<typeof getPlaylistSchema.output>;

// ============================================================================
// Playback Control
// ============================================================================

export const playSchema = {
  name: 'play',
  description:
    'Start playing music. Can play a specific track, album, playlist, or artist. Optionally start at a specific track within a context.',
  notes:
    'To play a single track, pass its URI as contextUri. To play an album/playlist/artist starting at a specific track, pass the context URI and the track URI as trackUri.',
  input: z.object({
    contextUri: z
      .string()
      .describe(
        'What to play: a track, album, playlist, or artist URI (e.g., spotify:album:ID, spotify:playlist:ID)',
      ),
    trackUri: z
      .string()
      .optional()
      .describe('Start playback at this specific track within the context'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type PlayInput = z.infer<typeof playSchema.input>;
export type PlayOutput = z.infer<typeof playSchema.output>;

export const pauseSchema = {
  name: 'pause',
  description: 'Pause current playback',
  notes: '',
  input: z.object({}),
  output: z.object({ success: z.boolean() }),
};
export type PauseInput = z.infer<typeof pauseSchema.input>;
export type PauseOutput = z.infer<typeof pauseSchema.output>;

export const resumeSchema = {
  name: 'resume',
  description: 'Resume paused playback',
  notes: '',
  input: z.object({}),
  output: z.object({ success: z.boolean() }),
};
export type ResumeInput = z.infer<typeof resumeSchema.input>;
export type ResumeOutput = z.infer<typeof resumeSchema.output>;

export const skipNextSchema = {
  name: 'skipNext',
  description: 'Skip to the next track',
  notes: '',
  input: z.object({}),
  output: z.object({ success: z.boolean() }),
};
export type SkipNextInput = z.infer<typeof skipNextSchema.input>;
export type SkipNextOutput = z.infer<typeof skipNextSchema.output>;

export const skipPrevSchema = {
  name: 'skipPrev',
  description: 'Skip to the previous track',
  notes: '',
  input: z.object({}),
  output: z.object({ success: z.boolean() }),
};
export type SkipPrevInput = z.infer<typeof skipPrevSchema.input>;
export type SkipPrevOutput = z.infer<typeof skipPrevSchema.output>;

export const seekSchema = {
  name: 'seek',
  description: 'Seek to a position in the current track',
  notes: '',
  input: z.object({
    positionMs: z.number().describe('Position in milliseconds to seek to'),
  }),
  output: z.object({ success: z.boolean() }),
};
export type SeekInput = z.infer<typeof seekSchema.input>;
export type SeekOutput = z.infer<typeof seekSchema.output>;

export const setShuffleSchema = {
  name: 'setShuffle',
  description: 'Enable or disable shuffle mode',
  notes: '',
  input: z.object({
    enabled: z.boolean().describe('true to enable shuffle, false to disable'),
  }),
  output: z.object({ success: z.boolean() }),
};
export type SetShuffleInput = z.infer<typeof setShuffleSchema.input>;
export type SetShuffleOutput = z.infer<typeof setShuffleSchema.output>;

export const setRepeatSchema = {
  name: 'setRepeat',
  description: 'Set repeat mode',
  notes: '',
  input: z.object({
    mode: z
      .enum(['off', 'context', 'track'])
      .describe(
        'off = no repeat, context = repeat playlist/album, track = repeat current track',
      ),
  }),
  output: z.object({ success: z.boolean() }),
};
export type SetRepeatInput = z.infer<typeof setRepeatSchema.input>;
export type SetRepeatOutput = z.infer<typeof setRepeatSchema.output>;

export const getPlayerStateSchema = {
  name: 'getPlayerState',
  description:
    'Get the current playback state including what is playing, position, volume, shuffle/repeat status',
  notes: '',
  input: z.object({}),
  output: z.object({
    isPlaying: z.boolean(),
    trackName: z.string().nullable(),
    trackUri: z.string().nullable(),
    artistName: z.string().nullable(),
    albumName: z.string().nullable(),
    contextUri: z
      .string()
      .nullable()
      .describe('The album/playlist/artist being played'),
    durationMs: z.number().nullable(),
    positionMs: z.number().nullable(),
    volume: z.number().nullable().describe('Volume percentage 0-100'),
    shuffleEnabled: z.boolean(),
    repeatMode: z.string().describe('off, context, or track'),
    deviceId: z.string(),
    deviceName: z.string(),
  }),
};
export type GetPlayerStateInput = z.infer<typeof getPlayerStateSchema.input>;
export type GetPlayerStateOutput = z.infer<typeof getPlayerStateSchema.output>;

// ============================================================================
// allSchemas export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  searchSchema,
  getArtistSchema,
  getAlbumSchema,
  listPlaylistsSchema,
  getPlaylistSchema,
  playSchema,
  pauseSchema,
  resumeSchema,
  skipNextSchema,
  skipPrevSchema,
  seekSchema,
  setShuffleSchema,
  setRepeatSchema,
  getPlayerStateSchema,
];
