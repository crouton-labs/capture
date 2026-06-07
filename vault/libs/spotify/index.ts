import type {
  GetContextOutput,
  SearchInput,
  SearchOutput,
  GetArtistInput,
  GetArtistOutput,
  GetAlbumInput,
  GetAlbumOutput,
  ListPlaylistsInput,
  ListPlaylistsOutput,
  GetPlaylistInput,
  GetPlaylistOutput,
  PlayInput,
  PlayOutput,
  PauseInput,
  PauseOutput,
  ResumeInput,
  ResumeOutput,
  SkipNextInput,
  SkipNextOutput,
  SkipPrevInput,
  SkipPrevOutput,
  SeekInput,
  SeekOutput,
  SetShuffleInput,
  SetShuffleOutput,
  SetRepeatInput,
  SetRepeatOutput,
  GetPlayerStateInput,
  GetPlayerStateOutput,
} from './schemas';

import { Validation, ContractDrift, Unauthenticated, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Internal types for Spotify API responses
// ============================================================================

interface SpotifyGraphQLResponse {
  data: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

interface SpotifyRootlist {
  length: number;
  contents: {
    items: Array<{
      uri: string;
      attributes: { name?: string; timestamp?: string };
    }>;
  };
}

interface SpotifyPlaylistDetail {
  attributes: { name: string; description?: string };
  ownerUsername: string;
  length: number;
  contents: {
    items: Array<{ uri: string; attributes: { timestamp?: string } }>;
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

const PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
const SPCLIENT_URL = 'https://spclient.wg.spotify.com';

const QUERY_HASHES: Record<string, string> = {
  searchDesktop:
    '3c9d3f60dac5dea3876b6db3f534192b1c1d90032c4233c1bbaba526db41eb31',
  queryArtistOverview:
    '446130b4a0aa6522a686aafccddb0ae849165b5e0436fd802f96e0243617b5d8',
  getAlbum: 'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10',
};

function isWebPlayer(): boolean {
  return window.location.hostname === 'open.spotify.com';
}

function makeHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'app-platform': isWebPlayer() ? 'WebPlayer' : 'OSX_ARM64',
    'content-type': 'application/json;charset=UTF-8',
  };
}

async function graphql(
  token: string,
  operationName: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const hash = QUERY_HASHES[operationName];
  if (!hash) throw new Validation(`Unknown GraphQL operation: ${operationName}`);

  const resp = await fetch(PATHFINDER_URL, {
    method: 'POST',
    headers: makeHeaders(token),
    body: JSON.stringify({
      variables,
      operationName,
      extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const json = (await resp.json()) as SpotifyGraphQLResponse;
  if (json.errors?.length) {
    throw new ContractDrift(
      `GraphQL ${operationName} error: ${JSON.stringify(json.errors[0])}`,
    );
  }
  return json.data;
}

function clickButton(testId: string, ariaLabel?: string): boolean {
  const btn = ariaLabel
    ? Array.from(document.querySelectorAll(`[data-testid="${testId}"]`)).find(
        (el) => el.getAttribute('aria-label') === ariaLabel,
      )
    : document.querySelector(`[data-testid="${testId}"]`);
  if (!btn) {
    throw new ContractDrift(
      `Button not found: testid=${testId}${ariaLabel ? ` aria-label=${ariaLabel}` : ''}`,
    );
  }
  (btn as HTMLElement).click();
  return true;
}

function getPlayPauseLabel(): string {
  const btn = document.querySelector(
    '[data-testid="control-button-playpause"]',
  );
  return btn?.getAttribute('aria-label') ?? '';
}

// Helper to safely traverse nested GraphQL response objects
function dig(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function digStr(obj: unknown, ...keys: string[]): string {
  const val = dig(obj, ...keys);
  if (typeof val === 'string') return val;
  return '';
}

function digNum(obj: unknown, ...keys: string[]): number {
  const val = dig(obj, ...keys);
  if (typeof val === 'number') return val;
  return 0;
}

function digBool(obj: unknown, ...keys: string[]): boolean {
  const val = dig(obj, ...keys);
  return val === true;
}

function digArray(obj: unknown, ...keys: string[]): unknown[] {
  const val = dig(obj, ...keys);
  return Array.isArray(val) ? val : [];
}

// ============================================================================
// Platform API (internal Spotify service registry via React fiber tree)
// ============================================================================

interface SpotifyPlatform {
  getHistory: () => SpotifyHistory;
  getRegistry: () => SpotifyRegistry;
  getSession: () => { accessToken: string };
  username: string;
}

interface SpotifyHistory {
  push: (path: string) => void;
  replace: (path: string) => void;
  location: { pathname: string; search: string; hash: string };
}

interface SpotifyRegistry {
  _map: Map<symbol, { instance?: unknown; factory?: unknown }>;
  resolve: (symbol: symbol) => unknown;
}

interface SpotifyPlayerAPI {
  play: (
    context: { uri: string },
    options: { featureVersion: string },
    extra?: { skipTo?: { uri: string } },
  ) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  skipToNext: () => Promise<void>;
  skipToPrevious: () => Promise<void>;
  seekTo: (positionMs: number) => Promise<void>;
  setShuffle: (enabled: boolean) => Promise<void>;
  setRepeat: (mode: number) => Promise<void>;
  getState: () => SpotifyPlayerState;
  getQueue: () => { nextTracks: unknown[] };
  _defaultFeatureVersion: string;
}

interface SpotifyPlayerState {
  isPaused: boolean;
  hasContext: boolean;
  duration: number;
  positionAsOfTimestamp: number;
  timestamp: number;
  speed: number;
  shuffle: boolean;
  repeat: number; // 0=off, 1=context, 2=track
  item?: {
    name: string;
    uri: string;
    album?: { name: string; uri: string };
    artists?: Array<{ name: string; uri: string }>;
    duration?: { milliseconds: number };
  };
  context?: { uri: string };
}

// Cached platform reference, discovered once, reused across calls
declare const window: Window & {
  __spotifyTokenCapture?: { token: string | null };
  __origSpotifyFetch?: typeof fetch;
  __spotifyPlatform?: SpotifyPlatform;
  __spotifyPlayerAPI?: SpotifyPlayerAPI;
  webpackChunkclient_web?: Array<unknown>;
};

/**
 * Get the Spotify Platform API by walking the React fiber tree.
 * Caches on window for subsequent calls.
 */
function getPlatform(): SpotifyPlatform {
  if (window.__spotifyPlatform) return window.__spotifyPlatform;

  const playBtn = document.querySelector(
    '[data-testid="control-button-playpause"]',
  );
  if (!playBtn)
    throw new ContractDrift(
      'Playback controls not found. Ensure Spotify is open with music loaded.',
    );

  const fiberKey = Object.keys(playBtn).find(
    (k) =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
  );
  if (!fiberKey) throw new ContractDrift('React fiber not found on playback controls');

  let fiber = (
    playBtn as unknown as Record<
      string,
      {
        return?: unknown;
        dependencies?: {
          firstContext?: {
            memoizedValue?: Record<string, unknown>;
            next?: unknown;
          };
        };
      }
    >
  )[fiberKey] as {
    return?: unknown;
    dependencies?: {
      firstContext?: {
        memoizedValue?: Record<string, unknown>;
        next?: unknown;
      };
    };
  };
  let depth = 0;

  while (fiber && depth < 200) {
    const deps = fiber.dependencies;
    if (deps?.firstContext) {
      let ctx:
        | { memoizedValue?: Record<string, unknown>; next?: unknown }
        | undefined = deps.firstContext;
      while (ctx) {
        const val = ctx.memoizedValue;
        if (
          val &&
          typeof val === 'object' &&
          typeof val.getHistory === 'function' &&
          typeof val.getRegistry === 'function'
        ) {
          window.__spotifyPlatform = val as unknown as SpotifyPlatform;
          return window.__spotifyPlatform;
        }
        ctx = ctx.next as typeof ctx;
      }
    }
    fiber = fiber.return as typeof fiber;
    depth++;
  }

  throw new ContractDrift(
    'Spotify Platform not found in React tree. Ensure Spotify is open with music loaded.',
  );
}

/**
 * Get the PlayerAPI from the Spotify service registry.
 * Resolves the PlayerAPI symbol and caches the instance.
 */
function getPlayerAPI(): SpotifyPlayerAPI {
  if (window.__spotifyPlayerAPI) return window.__spotifyPlayerAPI;

  const platform = getPlatform();
  const registry = platform.getRegistry();

  // Find the PlayerAPI symbol in the registry map
  let playerSymbol: symbol | null = null;
  registry._map.forEach((_val: unknown, key: symbol) => {
    if (String(key) === 'Symbol(PlayerAPI)') {
      playerSymbol = key;
    }
  });

  if (!playerSymbol)
    throw new ContractDrift('PlayerAPI not found in Spotify service registry');

  const player = registry.resolve(playerSymbol) as SpotifyPlayerAPI;
  window.__spotifyPlayerAPI = player;
  return player;
}

// ============================================================================
// Context
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  const platformType: 'desktop' | 'web' = isWebPlayer() ? 'web' : 'desktop';

  let token = '';
  let username = '';

  // Strategy 1: Platform API (most reliable, works on both desktop and web)
  try {
    const platform = getPlatform();
    const session = platform.getSession();
    if (session?.accessToken) {
      token = session.accessToken;
    }
    if (platform.username) {
      username = platform.username;
    }
  } catch {
    // Platform not available (playback controls not loaded yet)
  }

  // Strategy 2: Fetch interceptor fallback
  if (!token) {
    if (!window.__spotifyTokenCapture) {
      window.__spotifyTokenCapture = { token: null };
      const origFetch = window.__origSpotifyFetch
        ? window.__origSpotifyFetch
        : window.fetch;
      window.__origSpotifyFetch = origFetch;

      window.fetch = async function (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;

        let authHeader: string | undefined;
        const headers = init?.headers;
        if (headers) {
          if (typeof (headers as Headers).get === 'function') {
            const val = (headers as Headers).get('authorization');
            if (val !== null) authHeader = val;
          } else {
            const h = headers as Record<string, string>;
            if (h.authorization) {
              authHeader = h.authorization;
            } else if (h.Authorization) {
              authHeader = h.Authorization;
            }
          }
        }

        if (
          (url.includes('spotify.com') || url.includes('spclient')) &&
          authHeader
        ) {
          window.__spotifyTokenCapture!.token = authHeader.replace(
            'Bearer ',
            '',
          );
        }
        return origFetch.call(window, input, init);
      };
    }

    if (!window.__spotifyTokenCapture.token) {
      // Wait for the app to make a background API call
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (window.__spotifyTokenCapture.token) {
      token = window.__spotifyTokenCapture.token;
    }
  }

  if (!token) {
    throw new Unauthenticated(
      'Could not capture Spotify access token. Ensure Spotify is open and logged in.',
    );
  }

  // Username fallbacks (if Platform didn't provide it)
  if (!username) {
    // 1. Try IndexedDB (desktop app: DB named "username:client-web")
    try {
      const dbs = await indexedDB.databases();
      const clientDb = dbs.find((db: IDBDatabaseInfo) =>
        db.name?.endsWith(':client-web'),
      );
      if (clientDb?.name) {
        username = clientDb.name.split(':')[0];
      }
    } catch {
      // indexedDB.databases() may not be available
    }
  }

  // 2. Try localStorage keys (web player: keys like "{username}:user-comments-approved-conditions")
  if (!username) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.endsWith(':user-comments-approved-conditions')) {
        username = key.split(':')[0];
        break;
      }
    }
  }

  // 3. Try user widget aria-label (both platforms)
  if (!username) {
    const userWidget = document.querySelector(
      '[data-testid="user-widget-link"]',
    );
    if (userWidget) {
      const label = userWidget.getAttribute('aria-label');
      if (label) username = label;
    }
  }

  if (!username) {
    throw new Unauthenticated(
      'Could not find Spotify username. Ensure Spotify is open and logged in.',
    );
  }

  const defaultDeviceName =
    platformType === 'web' ? 'Web Player' : 'Spotify Desktop';

  return {
    token,
    deviceId: platformType,
    username,
    deviceName: defaultDeviceName,
    platform: platformType,
  };
}

// ============================================================================
// Search
// ============================================================================

export async function search(args: SearchInput): Promise<SearchOutput> {
  const { token, query, limit = 10 } = args;

  const data = await graphql(token, 'searchDesktop', {
    searchTerm: query,
    offset: 0,
    limit,
    numberOfTopResults: 5,
    includeAudiobooks: false,
    includeArtistHasConcertsField: false,
    includePreReleases: false,
    includeAuthors: false,
  });

  const sv2 = data.searchV2;

  const tracks = digArray(sv2, 'tracksV2', 'items').map((t) => ({
    name: digStr(t, 'item', 'data', 'name'),
    uri: digStr(t, 'item', 'data', 'uri'),
    artists: digArray(t, 'item', 'data', 'artists', 'items').map((a) =>
      digStr(a, 'profile', 'name'),
    ),
    album: digStr(t, 'item', 'data', 'albumOfTrack', 'name'),
    durationMs: digNum(t, 'item', 'data', 'duration', 'totalMilliseconds'),
  }));

  const artists = digArray(sv2, 'artists', 'items').map((a) => ({
    name: digStr(a, 'data', 'profile', 'name'),
    uri: digStr(a, 'data', 'uri'),
  }));

  const albums = digArray(sv2, 'albumsV2', 'items').map((a) => ({
    name: digStr(a, 'data', 'name'),
    uri: digStr(a, 'data', 'uri'),
    year: (dig(a, 'data', 'date', 'year') as number) ?? null,
    artists: digArray(a, 'data', 'artists', 'items').map((ar) =>
      digStr(ar, 'profile', 'name'),
    ),
  }));

  const playlists = digArray(sv2, 'playlists', 'items').map((p) => ({
    name: digStr(p, 'data', 'name'),
    uri: digStr(p, 'data', 'uri'),
    owner: digStr(p, 'data', 'ownerV2', 'data', 'name'),
  }));

  return { tracks, artists, albums, playlists };
}

// ============================================================================
// Artist
// ============================================================================

export async function getArtist(
  args: GetArtistInput,
): Promise<GetArtistOutput> {
  const { token, artistUri } = args;

  const data = await graphql(token, 'queryArtistOverview', {
    uri: artistUri,
    locale: '',
  });
  const artist = data.artistUnion;

  return {
    name: digStr(artist, 'profile', 'name'),
    uri: artistUri,
    verified: digBool(artist, 'profile', 'verified'),
    monthlyListeners: digNum(artist, 'stats', 'monthlyListeners'),
    biography: (dig(artist, 'profile', 'biography', 'text') as string) ?? null,
    avatarUrl:
      (dig(
        artist,
        'visuals',
        'avatarImage',
        'sources',
        '0',
        'url',
      ) as string) ?? null,
    topTracks: digArray(artist, 'discography', 'topTracks', 'items').map(
      (t) => ({
        name: digStr(t, 'track', 'name'),
        uri: digStr(t, 'track', 'uri'),
        playcount: digStr(t, 'track', 'playcount')
          ? digStr(t, 'track', 'playcount')
          : '0',
        durationMs: digNum(t, 'track', 'duration', 'totalMilliseconds'),
        album: digStr(t, 'track', 'albumOfTrack', 'name'),
      }),
    ),
    albums: digArray(
      artist,
      'discography',
      'popularReleasesAlbums',
      'items',
    ).map((a) => ({
      name: digStr(a, 'name'),
      uri: digStr(a, 'uri'),
      year: (dig(a, 'date', 'year') as number) ?? null,
      type: digStr(a, 'type') ? digStr(a, 'type') : 'ALBUM',
    })),
    relatedArtists: digArray(
      artist,
      'relatedContent',
      'relatedArtists',
      'items',
    ).map((a) => ({
      name: digStr(a, 'profile', 'name'),
      uri: digStr(a, 'uri'),
    })),
  };
}

// ============================================================================
// Album
// ============================================================================

export async function getAlbum(args: GetAlbumInput): Promise<GetAlbumOutput> {
  const { token, albumUri } = args;

  const data = await graphql(token, 'getAlbum', {
    uri: albumUri,
    locale: '',
    offset: 0,
    limit: 50,
  });

  const album = data.albumUnion;

  return {
    name: digStr(album, 'name'),
    uri: albumUri,
    type: digStr(album, 'type') ? digStr(album, 'type') : 'ALBUM',
    releaseDate:
      typeof dig(album, 'date', 'isoString') === 'string'
        ? (dig(album, 'date', 'isoString') as string)
        : null,
    label:
      typeof dig(album, 'label') === 'string'
        ? (dig(album, 'label') as string)
        : null,
    totalTracks: digNum(album, 'tracksV2', 'totalCount'),
    artists: digArray(album, 'artists', 'items').map((a) => ({
      name: digStr(a, 'profile', 'name'),
      uri: digStr(a, 'uri'),
    })),
    tracks: digArray(album, 'tracksV2', 'items').map((t) => ({
      name: digStr(t, 'track', 'name'),
      uri: digStr(t, 'track', 'uri'),
      trackNumber: digNum(t, 'track', 'trackNumber'),
      durationMs: digNum(t, 'track', 'duration', 'totalMilliseconds'),
      playcount: (dig(t, 'track', 'playcount') as string) ?? null,
    })),
  };
}

// ============================================================================
// Playlists
// ============================================================================

export async function listPlaylists(
  args: ListPlaylistsInput,
): Promise<ListPlaylistsOutput> {
  const { token, username, limit = 50 } = args;

  const resp = await fetch(
    `${SPCLIENT_URL}/playlist/v2/user/${encodeURIComponent(username)}/rootlist`,
    { headers: makeHeaders(token) },
  );

  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  const data = (await resp.json()) as SpotifyRootlist;
  const total = data.length;
  const items = data.contents.items
    .filter((item) => item.uri.startsWith('spotify:playlist:'))
    .slice(0, limit);

  // Rootlist only returns URIs; fetch names in parallel from individual playlist endpoints
  const playlists = await Promise.all(
    items.map(async (item) => {
      const id = item.uri.replace('spotify:playlist:', '');
      try {
        const plResp = await fetch(
          `${SPCLIENT_URL}/playlist/v2/playlist/${id}`,
          {
            headers: makeHeaders(token),
          },
        );
        if (plResp.ok) {
          const pl = (await plResp.json()) as SpotifyPlaylistDetail;
          return { uri: item.uri, name: pl.attributes?.name ?? null };
        }
      } catch {
        // Fall through to return null name
      }
      return { uri: item.uri, name: null };
    }),
  );

  return { playlists, total };
}

export async function getPlaylist(
  args: GetPlaylistInput,
): Promise<GetPlaylistOutput> {
  const { token, playlistId, limit = 100 } = args;

  const resp = await fetch(
    `${SPCLIENT_URL}/playlist/v2/playlist/${playlistId}`,
    {
      headers: makeHeaders(token),
    },
  );

  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  const data = (await resp.json()) as SpotifyPlaylistDetail;

  const tracks = data.contents.items.slice(0, limit).map((item) => ({
    uri: item.uri,
    addedAt: item.attributes.timestamp ?? null,
  }));

  return {
    name: data.attributes.name,
    description: data.attributes.description ?? null,
    owner: data.ownerUsername,
    trackCount: data.length,
    tracks,
  };
}

// ============================================================================
// Playback Control
// ============================================================================

export async function play(args: PlayInput): Promise<PlayOutput> {
  const { contextUri, trackUri } = args;

  const player = getPlayerAPI();

  const extra = trackUri ? { skipTo: { uri: trackUri } } : undefined;
  await player.play(
    { uri: contextUri },
    { featureVersion: player._defaultFeatureVersion },
    extra,
  );

  return { success: true };
}

export async function pause(_args: PauseInput): Promise<PauseOutput> {
  if (getPlayPauseLabel() === 'Play') {
    return { success: true }; // Already paused
  }
  clickButton('control-button-playpause');
  return { success: true };
}

export async function resume(_args: ResumeInput): Promise<ResumeOutput> {
  if (getPlayPauseLabel() === 'Pause') {
    return { success: true }; // Already playing
  }
  clickButton('control-button-playpause');
  return { success: true };
}

export async function skipNext(_args: SkipNextInput): Promise<SkipNextOutput> {
  clickButton('control-button-skip-forward');
  return { success: true };
}

export async function skipPrev(_args: SkipPrevInput): Promise<SkipPrevOutput> {
  clickButton('control-button-skip-back');
  return { success: true };
}

export async function seek(args: SeekInput): Promise<SeekOutput> {
  // Seek requires the playback bar; compute position and click
  const progressBar = document.querySelector(
    '[data-testid="playback-progressbar"]',
  );
  if (!progressBar) {
    throw new ContractDrift(
      'Playback progress bar not found. Ensure music is playing.',
    );
  }

  // Read duration from the time display
  const durationText = document.querySelector(
    '[data-testid="playback-duration"]',
  )?.textContent;
  if (!durationText) {
    throw new ContractDrift('Could not read track duration from UI');
  }
  const parts = durationText.split(':').map(Number);
  const durationMs = parts.length === 2 ? (parts[0] * 60 + parts[1]) * 1000 : 0;

  if (durationMs <= 0) {
    throw new ContractDrift('Could not read track duration from UI');
  }

  const rect = progressBar.getBoundingClientRect();
  const fraction = args.positionMs / durationMs;
  const clickX = rect.left + rect.width * fraction;
  const clickY = rect.top + rect.height / 2;

  progressBar.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      clientX: clickX,
      clientY: clickY,
    }),
  );

  return { success: true };
}

export async function setShuffle(
  args: SetShuffleInput,
): Promise<SetShuffleOutput> {
  // Read current state from aria-label
  const shuffleBtn = document.querySelector(
    'button[aria-label*="Shuffle"], button[aria-label*="shuffle"]',
  ) as HTMLButtonElement | null;

  if (!shuffleBtn) {
    throw new ContractDrift('Shuffle button not found');
  }

  const label = shuffleBtn.getAttribute('aria-label') ?? '';
  const isEnabled = label.toLowerCase().includes('disable');

  if (args.enabled !== isEnabled) {
    shuffleBtn.click();
  }

  return { success: true };
}

export async function setRepeat(
  args: SetRepeatInput,
): Promise<SetRepeatOutput> {
  const repeatBtn = document.querySelector(
    '[data-testid="control-button-repeat"]',
  ) as HTMLButtonElement | null;

  if (!repeatBtn) {
    throw new ContractDrift('Repeat button not found');
  }

  // Cycle: off -> context -> track -> off
  // Read current state from aria-label
  const getRepeatState = (): string => {
    const lbl = repeatBtn.getAttribute('aria-label') ?? '';
    if (lbl.toLowerCase().includes('disable repeat')) return 'track';
    if (lbl.toLowerCase().includes('enable repeat one')) return 'context';
    return 'off';
  };

  let current = getRepeatState();
  let clicks = 0;
  while (current !== args.mode && clicks < 3) {
    repeatBtn.click();
    await new Promise((r) => setTimeout(r, 100));
    current = getRepeatState();
    clicks++;
  }

  return { success: true };
}

export async function getPlayerState(
  _args: GetPlayerStateInput,
): Promise<GetPlayerStateOutput> {
  const player = getPlayerAPI();
  const state = player.getState();

  // Calculate current position (state gives position at a timestamp, adjust for elapsed time)
  const elapsed = state.isPaused
    ? 0
    : (Date.now() - state.timestamp) * state.speed;
  const positionMs = Math.round(state.positionAsOfTimestamp + elapsed);

  const repeatModes: Record<number, string> = {
    0: 'off',
    1: 'context',
    2: 'track',
  };

  return {
    isPlaying: !state.isPaused,
    trackName: state.item?.name ?? null,
    trackUri: state.item?.uri ?? null,
    artistName: state.item?.artists?.[0]?.name ?? null,
    albumName: state.item?.album?.name ?? null,
    contextUri: state.context?.uri ?? null,
    durationMs: state.duration,
    positionMs,
    volume: null, // Volume not in player state
    shuffleEnabled: state.shuffle,
    repeatMode: repeatModes[state.repeat] ?? 'off',
    deviceId: '',
    deviceName: isWebPlayer() ? 'Web Player' : 'Spotify Desktop',
  };
}
