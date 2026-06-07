import type {
  Channel,
  CreateDMFriendInput,
  CreateDMFriendOutput,
  // CreateDMDesktopInput, CreateDMDesktopOutput — types commented out in
  // ../schemas alongside the schema. Restore here when reviving.
  CreateDMDesktopDOMInput,
  CreateDMDesktopDOMOutput,
  SendMessageDesktopDOMInput,
  SendMessageDesktopDOMOutput,
  GetStickerInput,
  GetStickerOutput,
  GetStickerPackInput,
  GetStickerPackOutput,
  ListMessagesInput,
  ListMessagesOutput,
  Message,
  SendMessageInput,
  SendMessageOutput,
  SendTypingInput,
  SendTypingOutput,
  Sticker,
  StickerPack,
  MarkChannelReadInput,
  MarkChannelReadOutput,
  GreetChannelInput,
  GreetChannelOutput,
} from '../schemas';
import {
  discordFetch,
  generateNonce,
  sleep,
  buildQuery,
  awaitCapturedFingerprint,
  contextProperties,
  scienceTrack,
  getActiveSurface,
  withDomFlow,
} from '../helpers';
import {
  selectChannel,
  getWebpackRequire,
  walkExports,
  safeGet,
} from '../gateway';
import { listRelationships } from '../relationships';

// DM channel ids created by createDMDesktopDOM that did NOT successfully send
// their first message through Discord's composer. sendMessage refuses to
// operate on these to prevent the dominant cold-DM ban signal: an orphan
// channels-POST (created by Discord's React handler on the popout's Message-
// button click) followed seconds later by a from-our-code POST to
// /channels/{id}/messages with none of the composer-mount telemetry around
// it. Session-scoped — cleared on page reload, which is the right granularity
// since the ban window is the immediate-aftermath of the popout flow.
const POISONED_DM_CHANNELS = new Set<string>();

// DM channel ids that ensureRestSendSafe has confirmed are safe for REST
// sendMessage: either non-DMs (guild channels, group DMs), or 1:1 DMs whose
// only recipient is on the friend roster. sendMessage skips the full lookup
// on these. Cleared on page reload, which is also the granularity at which
// friendship-flip cases would need re-checking — and friendship flipping
// from friend → not-friend is rare enough that the cache is worth the speed.
const VERIFIED_OK_DM_CHANNELS = new Set<string>();

// Provenance gate for sendMessage. As of 2026-05-18, REST sendMessage to a
// non-friend DM reliably gets accounts suspended for bot activity — and this
// is true regardless of whether the channel has prior message history. The
// May-2026 review's original finding ("warm non-friend DMs are safe via REST
// because anti-abuse no longer correlates subsequent messages against the
// original channels POST") was overturned by fresh suspension reports. The
// classifier appears to weight the *recipient relationship* heavily enough
// that "API request from us to a non-friend's DM" is the discriminative
// signal — independent of how cold the channel is. The new rule:
//
//   1:1 DM + at least one recipient not on friend roster  →  REFUSE via REST
//
// The agent must use sendMessageDesktopDOM instead, which drives Discord's
// composer so the messages POST is emitted by Discord's own React handler
// with the natural chat_input X-Context-Properties, fingerprint headers, and
// composer-mount science telemetry. The function name encodes the intent so
// a misuse surfaces as a clean refusal here.
//
// Skipped (fast-pathed) when:
//   - channel is not a 1:1 DM (type ≠ 1) — guild channels and group DMs are
//     safe via REST.
//   - all recipients are on the friend roster — createDMFriend + REST send
//     is the documented friend-DM path and hasn't shown suspension issues.
//
// On unrecoverable lookup error we fall open (let it through). The throw-on-
// failure would be too aggressive: a transient network blip would break
// legitimate friend-DM sends. The agent is required by the library docs to
// call listRelationships before any DM-shaped operation; this gate is
// defense-in-depth, not the primary check.
async function ensureRestSendSafe(channelId: string): Promise<void> {
  if (VERIFIED_OK_DM_CHANNELS.has(channelId)) return;

  let channel: Channel;
  try {
    channel = await discordFetch<Channel>(undefined, `/channels/${channelId}`);
  } catch {
    // Can't look up the channel — fall open. Future sendMessages will
    // re-check.
    return;
  }

  // type 1 = DM. Everything else (guild channels=0, group DMs=3, etc.) is
  // out of scope for this gate.
  if (channel.type !== 1) {
    VERIFIED_OK_DM_CHANNELS.add(channelId);
    return;
  }

  // /channels/{id} returns recipients with the current user excluded; a 1:1
  // DM therefore has exactly one entry. If recipients is missing/empty,
  // treat as a degenerate self-DM and let it through.
  const recipients = channel.recipients ?? [];
  if (recipients.length === 0) {
    VERIFIED_OK_DM_CHANNELS.add(channelId);
    return;
  }

  let friendIds: Set<string>;
  try {
    const { relationships } = await listRelationships({ type: 1 });
    friendIds = new Set(relationships.map((r) => r.user.id));
  } catch {
    // Roster lookup failed — fall open. The friend check is best-effort
    // defense-in-depth; the agent is expected to verify per § DM Workflow.
    return;
  }

  if (recipients.every((r) => friendIds.has(r.id))) {
    VERIFIED_OK_DM_CHANNELS.add(channelId);
    return;
  }

  // Non-friend recipient. Refuse — no message-count fallthrough.
  const targetId = recipients[0]?.id;
  throw new Error(
    `Refusing sendMessage on channel ${channelId}: this DM is with a non-friend (user ${targetId}). As of 2026-05-18, sending any message to a non-friend DM via REST (POST /channels/${channelId}/messages from our code) reliably gets accounts suspended for bot activity — including in DMs with prior message history, where the May-2026 review had previously assessed API replay as sufficient. Use sendMessageDesktopDOM({channelId: "${channelId}", content: "..."}) so Discord's own composer fires the messages POST with the natural composer-mount + chat_input X-Context-Properties + science telemetry sequence that anti-abuse expects.`,
  );
}

export async function listMessages(
  params: ListMessagesInput,
): Promise<ListMessagesOutput> {
  const { token, channelId } = params;
  const limit = params.limit ?? 50;
  const qs = buildQuery({ limit, before: params.before });
  const messages = await discordFetch<Message[]>(
    token,
    `/channels/${channelId}/messages${qs}`,
  );
  const oldestId = messages.length ? messages[messages.length - 1].id : null;
  return { messages, oldestId };
}

export async function sendMessage(
  params: SendMessageInput,
): Promise<SendMessageOutput> {
  const { token, channelId, content } = params;
  // Hard refuse if this channel was opened by createDMDesktopDOM but the
  // function failed before sending its in-DOM first message. Sending through
  // /channels/{id}/messages from our code at this point is the dominant
  // cold-DM ban signal — the popout's channels POST went through Discord's
  // own bundle (good telemetry) but our follow-up message POST arrives
  // ~seconds later without the composer-mount / sticker-bar GET / entitlements
  // GET batch that Discord's anti-abuse classifier expects to see wrapping a
  // real first-message send. Even if the agent retries the DOM choreography,
  // this channel is poisoned: the discriminative signal is the gap between
  // the channels POST and the eventual messages POST, and any API-side send
  // now lands inside that gap. The agent must surface the createDMDesktopDOM
  // error to the user and stop, not improvise a fallback.
  if (POISONED_DM_CHANNELS.has(channelId)) {
    throw new Error(
      `Refusing sendMessage on channel ${channelId}: this DM was opened by createDMDesktopDOM but the function did not complete its in-DOM first-message send. Issuing a /channels/${channelId}/messages POST from our code now would emit the orphan-channels-POST + delayed-API-sendMessage pattern that gets accounts suspended for bot activity. Report the createDMDesktopDOM failure to the user and stop — do not improvise a fallback.`,
    );
  }
  // Provenance gate: REST sendMessage to a non-friend DM gets accounts
  // suspended (see ensureRestSendSafe — the rule and its 2026-05-18 dating).
  // Friend DMs, guild channels, and group DMs fall through unchanged.
  await ensureRestSendSafe(channelId);
  // Mirror Discord's UI message-send body exactly: field order matches HAR
  // capture (mobile_network_type first), and mobile_network_type:"unknown"
  // is sent by the web client on every chat composer send. Omitting it is a
  // distinguishing fingerprint vs the legitimate client.
  const body = {
    mobile_network_type: 'unknown',
    content,
    nonce: params.nonce ?? generateNonce(),
    tts: params.tts ?? false,
    flags: params.flags ?? 0,
  };
  // Anti-abuse: every chat-composer send carries the full fingerprint set
  // plus X-Context-Properties=chat_input. Missing either correlates with bot
  // detection / temporary suspension on accounts that DM strangers.
  await awaitCapturedFingerprint();
  return discordFetch<Message>(token, `/channels/${channelId}/messages`, {
    method: 'POST',
    body,
    headers: {
      'X-Context-Properties': contextProperties('chat_input'),
    },
  });
}

export async function sendTyping(
  params: SendTypingInput,
): Promise<SendTypingOutput> {
  const { token, channelId } = params;
  await discordFetch<void>(token, `/channels/${channelId}/typing`, {
    method: 'POST',
  });
  return { ok: true };
}

// Module-scope per-channel ack token cache. Discord chains the token across
// successive ack calls; the agent shouldn't have to plumb it through manually.
const ackTokenCache = new Map<string, string | null>();
let lastViewedCounter = 0;

export async function markChannelRead(
  params: MarkChannelReadInput,
): Promise<MarkChannelReadOutput> {
  const { token, channelId, messageId } = params;
  const cached = ackTokenCache.get(channelId);
  const ackToken =
    params.ackToken !== undefined ? params.ackToken : (cached ?? null);

  lastViewedCounter += 1;
  const body = {
    token: ackToken,
    last_viewed: lastViewedCounter,
  };

  const resp = await discordFetch<{ token: string | null }>(
    token,
    `/channels/${channelId}/messages/${messageId}/ack`,
    { method: 'POST', body },
  );

  ackTokenCache.set(channelId, resp.token);
  return { ackToken: resp.token };
}

// Friend-only DM open. Runs on either surface; ALWAYS validates that every
// recipient is on the current user's friend roster before issuing the channel
// POST. The function name signals the agent's intent ("I'm DMing a friend"),
// and the library enforces it — there is no surface escape hatch, since
// DMing strangers from any surface is the dominant trigger for Discord's
// anti-abuse pipeline (captcha / temporary suspension / silent shadow
// throttling). When the agent has a userId and is unsure whether the target
// is a friend, this is the right call: it short-circuits cleanly with a
// diagnostic error if they aren't, instead of opening a DM that may get the
// user's account flagged.
//
// For non-friend desktop DMs (e.g., a cold message to a user discovered via
// guild listMessages), use `createDMDesktopDOM({userId, guildId, channelId,
// messageId, firstMessage})` — that function drives Discord's own UI via
// simulated DOM events so the cold-DM trail is emitted by Discord's React
// handlers, not by us, which is currently the only known way to cold-DM a
// non-friend without tripping anti-abuse / account suspension. The older
// `createDMDesktop` (which replayed the HAR telemetry ourselves) is disabled.
export async function createDMFriend(
  params: CreateDMFriendInput,
): Promise<CreateDMFriendOutput> {
  const { token, recipients } = params;

  // Always-on friend gate. No surface conditional: the name `createDMFriend`
  // signals "I expect every recipient to be a friend"; the library refuses
  // the call otherwise so the agent surfaces a clear error and falls back
  // to the right alternative (createDMDesktopDOM for a stranger who authored
  // an in-viewport guild message, or addFriendById + wait) instead of
  // producing a DM that's at elevated risk of anti-abuse scoring.
  const { relationships } = await listRelationships({ token, type: 1 });
  const friendIds = new Set(relationships.map((r) => r.id));
  const strangers = recipients.filter((id) => !friendIds.has(id));
  if (strangers.length) {
    const subj = strangers.length === 1 ? 'is not a friend' : 'are not friends';
    throw new Error(
      `Refusing to open DM via createDMFriend: ${strangers.join(', ')} ${subj}. ` +
        `On desktop, use createDMDesktopDOM({userId, guildId, channelId, messageId, firstMessage}) — it drives Discord's UI via simulated DOM events so the cold-DM trail comes from Discord's own React handlers, not from us. The recipient must be the author of a message currently rendered in a guild channel. ` +
        `Otherwise, call addFriendById and wait for the request to be accepted before retrying with createDMFriend.`,
    );
  }

  return openDMWithPopoutTrail(token, recipients);
}

/**
 * Raw DM open with the browser-shape popout telemetry trail (profile GET +
 * single SEND_MESSAGE science event + channels POST). Used by createDMFriend
 * after its friend check passes, and by createDMDesktop's dm_list /
 * friends_list source variants which don't have a useful HAR-shaped popout
 * of their own (the desktop client never goes through an avatar popout for
 * those entry points). No friend check here — that lives one layer up so
 * each caller can decide independently.
 */
async function openDMWithPopoutTrail(
  token: string | undefined,
  recipients: string[],
): Promise<Channel> {
  await awaitCapturedFingerprint();

  // Mirror Discord's UI sequence: when the user clicks "Message" on a profile
  // popout, the client first GETs the popout-profile (a UI-load fetch), then
  // fires user_profile_action SEND_MESSAGE telemetry, then POSTs the channel
  // open. Skipping the popout GET + telemetry leaves the channel-open POST
  // with no preceding interaction trail — anti-abuse treats that as a bot
  // signal. Best-effort: failures here never block the actual DM open.
  //
  // Only applicable to 1:1 DMs (recipients.length === 1). Group DMs are
  // initiated from the "+" button, a different UI flow.
  if (recipients.length === 1) {
    const targetUserId = recipients[0];
    const profileQs = buildQuery({
      type: 'popout',
      with_mutual_guilds: true,
      with_mutual_friends: true,
      with_mutual_friends_count: false,
    });
    await discordFetch<unknown>(
      token,
      `/users/${targetUserId}/profile${profileQs}`,
    ).catch((): undefined => {
      // best-effort UI-mirror fetch; failures must never block the actual DM open
      return undefined;
    });
    await scienceTrack('user_profile_action', {
      profile_layout: 'POPOUT',
      profile_action: 'SEND_MESSAGE',
      location_stack: ['user profile popout'],
      related_user_id: targetUserId,
      is_guild_profile: false,
      is_bot_profile: false,
      is_private_to_viewer: false,
      relationship_type: 0,
      user_status: 'offline',
    });
  }

  return discordFetch<Channel>(token, '/users/@me/channels', {
    method: 'POST',
    body: { recipients },
    headers: {
      'X-Context-Properties': contextProperties('user profile popout'),
    },
  });
}

// Desktop-surface DM open. Mirrors the exact HAR sequence emitted by the
// Electron client when "Message" is clicked from an avatar-triggered profile
// popout inside a guild channel. No friend pre-check anywhere in this path:
// Hard Rule #4 (friend-only DMs) is browser-only and the desktop client
// itself makes no such check.
//
// HAR-derived sequence (1:1 DMs):
//   1. POST /science ack_messages                         (replays the scroll/read tick the UI emits just before the avatar click)
//   2. GET /users/{id}/profile?type=popout&with_mutual_guilds=true&with_mutual_friends=true&with_mutual_friends_count=false[&guild_id=…]
//   3. GET /users/@me/notes/{id}                          (popout-time note fetch)
//   4. POST /science user_profile_action VIEW             (location_stack=["avatar","user profile popout"], full guild/channel context)
//   5. ~3s popout dwell                                   (human reads the popout before clicking "Message")
//   6. POST /users/@me/channels                           (X-Context-Properties=user profile popout)
//   7. POST /science user_profile_action SEND_DIRECT_MESSAGE  (same profile_session_id as VIEW)
//   8. GET /channels/{id}/messages?limit=10               (DM-open hydration)
//   9. POST /science batched (dm_list_viewed + channel_opened)  (single POST, two events — matches HAR batching)
//  10. GET /users/@me/message-requests/supplemental-data  (chat-composer pre-send)
//
// All GETs / science events past the POST are best-effort: their failure must
// never propagate into the createDMDesktop return path. The classifier scores
// on presence + relative timing + property shape of these signals — sending an
// event with a 4-field body when the UI's body has 35 fields is itself a tell.
//
// Preconditions enforced:
//   • Executor must be on the desktop surface.
//   • A real /api/v9/science POST must have been observed (the science hook
//     captures token + heartbeat-session-id; without these the event bodies
//     are unsigned and Discord drops them silently — a coherent telemetry
//     trail is the whole point of this function vs createDMFriend). The
//     library auto-provokes one via FluxDispatcher (WINDOW_FOCUS edge +
//     TRACK action) if cold, so this normally resolves in ~1s.
//   • If guildId + sourceChannelId are provided, the page MUST currently be
//     on /channels/{guildId}/{sourceChannelId}. The popout-VIEW event claims
//     the avatar was clicked from that channel; if the page is elsewhere the
//     referer header on the channels POST contradicts the science event, a
//     fingerprint contradiction the classifier flags directly.
//
// Group DMs (recipients.length > 1) come from the "+" button on desktop, not
// from a profile popout, so the choreography is skipped and only the POST is
// issued — matching the desktop client's group-DM flow.
//
// ============================================================================
// DISABLED — non-friend DM creation from the desktop surface.
//
// Cold/non-friend DMs from desktop have repeatedly resulted in the operating
// Discord account being temporarily suspended (and on repeat offenses, fully
// locked) for "bot activity / spam / harassment". This held up even after we
// rebuilt the function to mirror the May-2026 desktop HAR end-to-end:
// ack_messages → profile GET → notes GET → user_profile_action VIEW → 3s
// popout dwell → channels POST → SEND_DIRECT_MESSAGE → messages?limit=10 →
// entitlements → sticker-packs → supplemental-data → atomic first message →
// batched dm_list_viewed + channel_opened → supplemental-data polls. The
// channels POST itself looks fine; what the anti-abuse classifier scores on
// is the AGGREGATE pattern of a client emitting cold-DM trails to strangers
// at any rate above a normal user's organic message-to-stranger frequency.
// We can match the HAR shape per call, but we cannot fake "this is a real
// human messaging someone they actually want to talk to."
//
// Latest attempt before disable was commit f5dfa3c4 ("update createDMdesktop
// to match har more closely (still getting banned)") — the title says it all.
//
// Replacement: `createDMDesktopDOM` (defined later in this file). Rather than
// issuing the cold-DM API calls ourselves, it drives Discord's own UI via
// simulated DOM events (avatar click → popout "Message" click → composer
// paste → Enter) so Discord's bundle emits every request naturally. The
// suspension issue was a property of "we are the ones making the calls,"
// not of "our HAR replay was imperfect" — matching the request shape isn't
// sufficient when anti-abuse scores on aggregate cold-DM-volume-from-a-client
// patterns; ceding emission to Discord's bundle is the only known fix.
//
// Callers get an immediate throw with a remediation hint rather than a
// silent no-op:
//   - Friend the recipient first → use `createDMFriend`.
//   - Recipient is reachable via a guild message in current channel view →
//     use `createDMDesktopDOM({userId, guildId, channelId, messageId,
//     firstMessage})`. That's the explicit, library-supported replacement.
//   - Otherwise → reach them through a shared guild channel (sendMessage
//     into a server channel is unaffected by this guard).
// ============================================================================
//
// REGISTRY-LEVEL REMOVAL: the schema, allSchemas entry, type exports, and
// barrel re-exports for createDMDesktop have all been commented out so the
// function is no longer visible to the agent tool registry. We additionally
// comment out the function declaration itself, preserving BOTH the immediate-
// disable throw-stub form AND the full original implementation inside the
// REVIVABLE STUB block below. To revive the function, uncomment this block
// in tandem with the schema/barrel changes referenced in the stub header.

/* REVIVABLE STUB — uncomment in tandem with:
     - ../schemas.ts: the createDMDesktopSchema block + sub-schemas + the
       `createDMDesktopSchema,` entry in `allSchemas` + the CreateDMDesktopInput
       and CreateDMDesktopOutput type exports.
     - ../index.ts (barrel): the `createDMDesktop` value re-export and the
       CreateDMDesktopInput/Output type re-exports.
     - This file: the `CreateDMDesktopInput, CreateDMDesktopOutput` type
       imports near the top.
     - This file: the value imports `generateUuid, awaitCapturedScience,
       scienceTrackBatch` from `../helpers`, `provokeScienceEmission` from
       `../gateway`, and the type imports `ScienceGuildContext,
       ScienceChannelContext` from `../helpers` (all referenced only by the
       original implementation and its support helpers below).
     - This file: the `PopoutProfileResponse`, `PartialGuildResponse`,
       `PartialChannelResponse` interfaces and the `ensureGuildContext` /
       `ensureChannelContext` helper functions, preserved in the
       --- SUPPORT HELPERS --- section below.

   Two forms are preserved here: the throw-stub (the form the function had
   right before being removed from the registry — a clean failure surface
   that redirects callers to createDMDesktopDOM) and the original
   implementation (the API-replay flow that got accounts suspended; preserved
   as a starting point if Discord's anti-abuse model ever changes enough that
   API-side replay becomes viable again).

   --- THROW-STUB FORM ---

export async function createDMDesktop(
  _params: CreateDMDesktopInput,
): Promise<CreateDMDesktopOutput> {
  throw new Error(
    'createDMDesktop is disabled: non-friend DMs from the desktop surface have repeatedly triggered Discord anti-abuse and resulted in temporary account suspension for bot activity, even with full HAR-fidelity telemetry replay. The replacement is `createDMDesktopDOM({userId, guildId, channelId, messageId, firstMessage})` — it drives Discord\'s UI via simulated DOM events so Discord\'s own bundle emits the cold-DM trail (the suspension issue traced to our code being the emitter, not to imperfect replay). If the recipient isn\'t the author of a currently-rendered guild message, friend them first and use `createDMFriend`, or message them through a shared guild channel. See the banner above this function for the full reason.',
  );
}

   --- SUPPORT HELPERS (interfaces + ensureGuildContext + ensureChannelContext) ---

   These are used only by the ORIGINAL IMPLEMENTATION body below. Restore at
   module top-level (alongside the other interfaces) when reviving.

// Profile-popout response shape we actually read. Discord returns ~50 fields;
// we type only the ones we propagate onto science events.
interface PopoutProfileResponse {
  mutual_guilds?: Array<{ id: string }>;
  mutual_friends?: Array<{ id: string }>;
  user?: { id?: string; bot?: boolean };
  user_profile?: {
    badges?: Array<{ id: string }>;
    profile_themes_experiment_bucket?: number;
  };
  guild_member_profile?: {
    badges?: Array<{ id: string }>;
  };
  badges?: Array<{ id: string }>;
  application?: { id?: string } | null;
  profile_application?: { id?: string } | null;
  premium_type?: number | null;
  premium_since?: string | null;
  premium_guild_since?: string | null;
}

interface PartialGuildResponse {
  approximate_member_count?: number;
  channels?: Array<{ type: number }>;
  roles?: Array<unknown>;
  features?: string[];
}

interface PartialChannelResponse {
  type?: number;
  member_count?: number;
  recipients?: Array<unknown>;
  nsfw?: boolean;
  permissions?: string;
}

// If guild context for this guild hasn't been observed via captured science
// yet, fetch /guilds/{id}?with_counts=true and derive the fields the UI's
// science events normally carry. Returns the populated context (or whatever
// could be derived) for direct use as event properties.
async function ensureGuildContext(
  token: string | undefined,
  guildId: string,
): Promise<ScienceGuildContext> {
  const existing = window.__nlDiscordScience?.guildContexts?.[guildId];
  if (existing?.guild_size_total !== undefined) return existing;
  const guild = await discordFetch<PartialGuildResponse>(
    token,
    `/guilds/${guildId}?with_counts=true`,
  ).catch((): PartialGuildResponse | null => {
    // best-effort guild-context backfill; if the GET fails (e.g., transient
    // 5xx) the event bodies just omit guild_size_total etc. — better than
    // throwing and dropping the whole DM open.
    return null;
  });
  if (!guild) return existing ?? {};
  const channels = Array.isArray(guild.channels) ? guild.channels : [];
  const ctx: ScienceGuildContext = {
    guild_size_total: guild.approximate_member_count,
    guild_num_channels: channels.length,
    guild_num_text_channels: channels.filter((c) => c.type === 0).length,
    guild_num_voice_channels: channels.filter((c) => c.type === 2).length,
    guild_num_roles: Array.isArray(guild.roles) ? guild.roles.length : 1,
    // We don't get per-member role-count or perms from the public guild GET;
    // leave undefined so the field is absent on the event rather than wrong.
    guild_is_vip: (guild.features ?? []).includes('VIP_REGIONS'),
    is_member: true,
    num_voice_channels_active: 0,
    ...existing,
  };
  const state = window.__nlDiscordScience ?? {};
  state.guildContexts = { ...(state.guildContexts ?? {}), [guildId]: ctx };
  window.__nlDiscordScience = state;
  return ctx;
}

// Same as ensureGuildContext but for the source channel. Derives channel_type,
// channel_size_total, channel_member_perms, channel_hidden from the channel
// GET if not already observed.
async function ensureChannelContext(
  token: string | undefined,
  channelId: string,
): Promise<ScienceChannelContext> {
  const existing = window.__nlDiscordScience?.channelContexts?.[channelId];
  if (existing?.channel_type !== undefined) return existing;
  const ch = await discordFetch<PartialChannelResponse>(
    token,
    `/channels/${channelId}`,
  ).catch((): PartialChannelResponse | null => {
    // best-effort channel-context backfill; absence on the event body is a
    // smaller tell than a thrown error blocking the popout sequence.
    return null;
  });
  if (!ch) return existing ?? {};
  const ctx: ScienceChannelContext = {
    channel_type: ch.type,
    channel_size_total: Array.isArray(ch.recipients)
      ? ch.recipients.length
      : (ch.member_count ?? 0),
    channel_member_perms: ch.permissions,
    channel_hidden: false,
    ...existing,
  };
  const state = window.__nlDiscordScience ?? {};
  state.channelContexts = {
    ...(state.channelContexts ?? {}),
    [channelId]: ctx,
  };
  window.__nlDiscordScience = state;
  return ctx;
}

   --- ORIGINAL FULL IMPLEMENTATION (was wrapped in a nested  /*  ...  *^/  block inside the throw-stub function body; markers stripped here so this outer block wraps cleanly) ---

export async function createDMDesktop(
  params: CreateDMDesktopInput,
): Promise<CreateDMDesktopOutput> {
  const { token, recipients, source, firstMessage } = params;

  // Surface guard: emitting desktop-flavored telemetry against a browser
  // session is a fingerprint contradiction (the captured x-super-properties
  // says `browser: "Chrome"` while the science events claim avatar→popout
  // desktop UX) — more bot-like than just using createDMFriend. Refuse rather
  // than silently produce a self-inconsistent request.
  const surface = getActiveSurface();
  if (surface !== 'desktop') {
    throw new Error(
      `createDMDesktop requires the desktop surface, but getContext() resolved to "${surface}". From browser, friend-only DMs go through createDMFriend; non-friend DMs from browser are not supported by this library. Re-open the executor against the Discord desktop app to use createDMDesktop.`,
    );
  }

  await awaitCapturedFingerprint();

  if (source.type === 'group_button') {
    // Group DM: no profile/popout context on desktop either — just POST.
    // The schema cross-check already enforced recipients.length >= 2.
    const channel = await discordFetch<Channel>(token, '/users/@me/channels', {
      method: 'POST',
      body: { recipients },
      headers: {
        'X-Context-Properties': contextProperties('user profile popout'),
      },
    });
    return { channel, sentMessage: undefined };
  }

  // All remaining variants are 1:1 — the schema enforced recipients.length === 1.
  const targetUserId = recipients[0];

  if (source.type !== 'guild_message_avatar') {
    // dm_list / friends_list: no source-channel context, no ack_messages, no
    // popout-dwell-from-guild-avatar — the desktop client's behavior for
    // these UI entry points is materially shorter than the avatar flow.
    // Open the DM with a minimal popout trail (profile GET + a single
    // SEND_MESSAGE event, no VIEW dwell). Bypasses createDMFriend's friend
    // gate intentionally: a `dm_list` recipient may legitimately be a
    // non-friend the user has prior DM history with (e.g., from a shared
    // server), and on desktop the client itself does no friend check for
    // these flows.
    const channel = await openDMWithPopoutTrail(token, recipients);
    // firstMessage support for these shorter flows: send immediately after
    // the popout-trail open. The schema makes firstMessage optional for
    // these variants since the caller may legitimately just want to fetch
    // an existing DM channel id.
    let sentMessage: Message | undefined;
    if (firstMessage !== undefined) {
      // Brief gap so the message doesn't fire on the same tick as the
      // channels POST — Discord's UI never sends that fast organically.
      await sleep(450, 100);
      sentMessage = await discordFetch<Message>(
        token,
        `/channels/${channel.id}/messages`,
        {
          method: 'POST',
          body: {
            mobile_network_type: 'unknown',
            content: firstMessage,
            nonce: generateNonce(),
            tts: false,
            flags: 0,
          },
          headers: {
            'X-Context-Properties': contextProperties('chat_input'),
          },
        },
      );
    }
    return { channel, sentMessage };
  }

  // === source.type === 'guild_message_avatar' — the full HAR mirror ===
  const {
    guildId,
    channelId: sourceChannelId,
    messageId: sourceMessageId,
  } = source;

  // Page-URL precondition. The popout-VIEW event we're about to fire claims
  // `location_stack: ["avatar","user profile popout"]` and carries the source
  // channel_id; if the renderer is sitting on a different URL the referer
  // header on every request contradicts that claim. The May-2026 false-
  // positive review pinned this mismatch as a dominant tell.
  //
  // When the URL doesn't match, auto-navigate via SPA routing (selectChannel)
  // rather than throwing. The agent's previous bug pattern was: navigate via
  // `window.location.href = ...` (full-page reload) → fetch hook wiped →
  // Discord fires its post-mount telemetry batch in a hook-less context →
  // science capture stays cold → popout VIEW silently no-ops → orphan
  // channels-POST. `selectChannel` uses Discord's own router (or Flux
  // CHANNEL_SELECT fallback), so the hook survives and Discord fires the
  // mount batch into a context that's actually observing it.
  const expectedPath = `/channels/${guildId}/${sourceChannelId}`;
  if (window.location?.pathname !== expectedPath) {
    await selectChannel({ guildId, channelId: sourceChannelId });
    // selectChannel waits ~600ms for React to mount; verify the URL stuck.
    // If it didn't (extension blocked, hostile build, etc.) we have to
    // throw — proceeding would produce the same referer mismatch the
    // precondition exists to prevent.
    if (window.location?.pathname !== expectedPath) {
      throw new Error(
        `createDMDesktop could not navigate to the source guild channel "${expectedPath}" via Discord's in-app router (window.location.pathname is "${window.location?.pathname}" after selectChannel). The Flux dispatch may have been rejected; verify the executor is attached to a live, signed-in Discord desktop window.`,
      );
    }
    // After navigation, Discord fires its full post-mount science batch
    // (channel_opened, guild_viewed, settings-proto sync, entitlements GET,
    // sticker bar GET). Wait long enough for the batch to land in our
    // hook so the popout sequence below has captured science to work with.
    // 2-3s is the HAR-observed window between channel mount and the first
    // organic user action like an avatar hover.
    await sleep(2500, 500);
  }

  // Science capture gate. The popout VIEW + SEND_DIRECT_MESSAGE events are
  // the entire reason to use this variant over createDMFriend; firing them
  // without a captured heartbeat-session-id means Discord drops them and
  // we're back to a createDMFriend-shaped trail with extra latency.
  //
  // Two-stage capture:
  //   1. If state is cold, provoke a science emission via FluxDispatcher
  //      (WINDOW_FOCUS edge + TRACK action). Discord's analytics middleware
  //      reliably flushes a batch on the focus edge within ~1s.
  //   2. Wait up to 5s for the hook to observe the resulting POST.
  //
  // The total budget (3s provoke + 5s await) is bounded so the function
  // fits comfortably under any reasonable executeJS timeout. Earlier
  // versions waited 15s here, which combined with the 4s popout sequence
  // exceeded typical 15s executeJS budgets — the agent's previous run
  // timed out and left the channels-POST orphaned.
  if (
    !window.__nlDiscordScience?.token ||
    !window.__nlDiscordScience?.client_heartbeat_session_id
  ) {
    await provokeScienceEmission(3000);
  }
  const science = await awaitCapturedScience(5000);
  if (!science?.token || !science.client_heartbeat_session_id) {
    throw new Error(
      'createDMDesktop could not observe a real /api/v9/science POST from the Discord client within 5s, even after provoking one via FluxDispatcher (WINDOW_FOCUS + TRACK). Popout telemetry would silently no-op, defeating the point of the desktop variant. Confirm the executor is attached to a live Discord desktop window that is signed in; if the issue persists, navigate via `selectChannel(guildId, channelId)` rather than `window.location.href` so the fetch hook survives.',
    );
  }

  // Backfill guild + channel context maps from REST if the captured science
  // state doesn't already have them. Without these, VIEW + SEND_DIRECT_MESSAGE
  // go out with `guild_size_total` absent, which the classifier sees as a
  // partial fingerprint.
  await ensureGuildContext(token, guildId);
  await ensureChannelContext(token, sourceChannelId);

  // Step 1: ack_messages — the UI emits this whenever the user scrolls or
  // brings a channel into view. The HAR shows it firing ~590ms before the
  // popout VIEW, on the same tick as the avatar hover/click. Without it,
  // the VIEW is the first event in the trail, which doesn't happen in the
  // real UI (the channel was already mounted; ack is implied).
  void scienceTrack('ack_messages', {
    channel_id: sourceChannelId,
    guild_id: guildId,
    location_section: 'Channel',
    location_object: 'Ack - Channel Scroll',
    location_object_type: 'ack_automatic',
  });
  // Brief dwell so the ack and the profile GET don't share a millisecond.
  await sleep(160, 40);

  const profileQs = buildQuery({
    type: 'popout',
    with_mutual_guilds: true,
    with_mutual_friends: true,
    with_mutual_friends_count: false,
    guild_id: guildId,
  });
  const profile = await discordFetch<PopoutProfileResponse>(
    token,
    `/users/${targetUserId}/profile${profileQs}`,
  ).catch((): PopoutProfileResponse | null => {
    // best-effort UI-mirror fetch; failures must never block the actual DM open
    return null;
  });
  const numMutualGuilds = profile?.mutual_guilds?.length ?? 0;
  const numMutualFriends = profile?.mutual_friends?.length ?? 0;
  const profileBadges = (
    profile?.user_profile?.badges ??
    profile?.badges ??
    []
  ).map((b) => b.id);
  const guildProfileBadges = (profile?.guild_member_profile?.badges ?? []).map(
    (b) => b.id,
  );
  const applicationId =
    profile?.application?.id ?? profile?.profile_application?.id ?? null;
  const isBotProfile = profile?.user?.bot ?? false;

  // ~358ms between profile GET response and notes GET in HAR — the renderer
  // mounting the popout component and firing its own note fetch.
  await sleep(360, 80);

  await discordFetch<unknown>(token, `/users/@me/notes/${targetUserId}`).catch(
    (): undefined => {
      // best-effort UI-mirror fetch; 404 is normal when no note exists
      return undefined;
    },
  );

  // Discord correlates VIEW and SEND_DIRECT_MESSAGE on the same popout via
  // a UUID — regenerating it per event is a strong tell.
  const profileSessionId = generateUuid();

  // Full property set for VIEW / SEND_DIRECT_MESSAGE — matches the HAR's
  // user_profile_action event body 1:1. guild_id / channel_id trigger
  // scienceTrack to merge the captured guild/channel context.
  const profileEventProps: Record<string, unknown> = {
    profile_layout: 'POPOUT',
    profile_session_id: profileSessionId,
    profile_properties: [],
    guild_profile_properties: [],
    profile_activity_types: [],
    profile_badges: profileBadges.length ? profileBadges : guildProfileBadges,
    user_status: 'offline',
    is_guild_profile: true,
    is_bot_profile: isBotProfile,
    is_private_to_viewer: false,
    related_user_id: targetUserId,
    relationship_type: 0,
    num_mutual_friends: numMutualFriends,
    num_mutual_guilds: numMutualGuilds,
    application_linked: applicationId,
    location_stack: ['avatar', 'user profile popout'],
    guild_id: guildId,
    channel_id: sourceChannelId,
    source_message_id: sourceMessageId,
  };

  // ~60ms between notes GET and VIEW science event in HAR.
  await sleep(60, 30);

  await scienceTrack('user_profile_action', {
    ...profileEventProps,
    profile_action: 'VIEW',
  });

  // Popout dwell — HAR shows ~3.4s between VIEW and the channels POST. A
  // <100ms gap here was the loudest single tell in the May-2026 review.
  // Jittered to avoid a fixed-interval signature across calls.
  await sleep(3000, 700);

  const channel = await discordFetch<Channel>(token, '/users/@me/channels', {
    method: 'POST',
    body: { recipients },
    headers: {
      'X-Context-Properties': contextProperties('user profile popout'),
    },
  });

  // === Post-channels-POST sequence (HAR-faithful order) ===
  //
  // The order below mirrors the May-2026 desktop HAR exactly. Earlier versions
  // of this function emitted the batched mount science before supplemental-data
  // and skipped the composer-mount calls entirely — that left a discriminative
  // gap on every agent-initiated cold DM (a real client always fetches the
  // sticker bar + entitlements before the first message). HAR offsets are in
  // the inline comments; jitter is applied so the fingerprint isn't a fixed
  // interval across calls.
  //
  // 1. SEND_DIRECT_MESSAGE science (5ms after channels POST)
  // 2. ~325ms       → GET /channels/{dm}/messages?limit=10
  // 3. ~245ms       → GET /users/@me/entitlements?entitlement_type=11
  // 4. ~175ms       → GET /sticker-packs/847199849233514549
  // 5. ~22ms        → GET /users/@me/message-requests/supplemental-data
  // 6. ~15ms        → POST /channels/{dm}/messages  (first message — if provided)
  // 7. ~122ms       → batched dm_list_viewed + channel_opened science
  // 8. ~53ms        → GET supplemental-data  (poll #1, only if message sent)
  // 9. ~1.2s        → GET supplemental-data  (poll #2, only if message sent)
  //
  // When `firstMessage` is omitted, steps 6, 8, and 9 are skipped — but for
  // the guild_message_avatar variant the schema requires it precisely because
  // a popout-VIEW + channels-POST trail with no following first message is a
  // discriminative pattern: real users who click "Message" from a guild
  // avatar virtually always type something within the same UI session.

  // 1. SEND_DIRECT_MESSAGE — same profile_session_id as the VIEW above.
  void scienceTrack('user_profile_action', {
    ...profileEventProps,
    profile_action: 'SEND_DIRECT_MESSAGE',
  });

  // 2. DM history hydration (~325ms after channels POST).
  await sleep(325, 90);
  await discordFetch<unknown>(
    token,
    `/channels/${channel.id}/messages?limit=10`,
  ).catch((): undefined => {
    // best-effort UI-mirror fetch; failures must never block the actual DM open
    return undefined;
  });

  // 3. Composer-mount entitlements GET (~245ms after messages GET in HAR).
  //    Real DM composer fetches sticker entitlements on every open; missing
  //    this on agent runs was a stable fingerprint vs the real client.
  await sleep(245, 60);
  await discordFetch<unknown>(
    token,
    `/users/@me/entitlements?with_sku=false&with_application=false&entitlement_type=11&exclude_ended=true`,
  ).catch((): undefined => {
    // best-effort UI-mirror fetch; failures must never block the actual DM open
    return undefined;
  });

  // 4. Sticker bar fetch (~175ms after entitlements). Hardcoded pack id is
  //    Discord's "Wumpus Beyond" pack which the desktop composer pre-loads
  //    on every DM open — same id observed on every HAR captured.
  await sleep(175, 50);
  await discordFetch<unknown>(
    token,
    `/sticker-packs/847199849233514549?country_code=US`,
  ).catch((): undefined => {
    // best-effort UI-mirror fetch; failures must never block the actual DM open
    return undefined;
  });

  // 5. Supplemental-data eligibility check (~22ms after sticker-packs). This
  //    is the message-request gate the UI consults right before the composer
  //    becomes interactive.
  await sleep(22, 8);
  const supplementalQs = buildQuery({ channel_ids: channel.id });
  await discordFetch<unknown>(
    token,
    `/users/@me/message-requests/supplemental-data${supplementalQs}`,
  ).catch((): undefined => {
    // best-effort UI-mirror fetch; failures must never block the actual DM open
    return undefined;
  });

  // 6. First message POST (~15ms after supplemental-data). The HAR's
  //    channels-POST → first-message-POST gap is 788ms; we hit ~782ms with
  //    the jittered sleeps above. The agent's previous runs left this gap
  //    at >10s by sending the message in a separate executeJS, which is
  //    the dominant signal Discord's anti-abuse pipeline uses to identify
  //    cold-DM bots.
  let sentMessage: Message | undefined;
  if (firstMessage !== undefined) {
    await sleep(15, 5);
    sentMessage = await discordFetch<Message>(
      token,
      `/channels/${channel.id}/messages`,
      {
        method: 'POST',
        body: {
          mobile_network_type: 'unknown',
          content: firstMessage,
          nonce: generateNonce(),
          tts: false,
          flags: 0,
        },
        headers: {
          'X-Context-Properties': contextProperties('chat_input'),
        },
      },
    );
  }

  // 7. Batched dm_list_viewed + channel_opened science (~122ms after first
  //    message POST when one was sent; ~50ms after supplemental-data when not).
  //    Order matters: in the HAR this science batch fires AFTER the first
  //    message POST, NOT before. Earlier versions of this function emitted
  //    it pre-supplemental-data, which is wrong.
  await sleep(firstMessage !== undefined ? 122 : 50, 30);

  // Seed the brand-new DM's channel context so the merged event bodies carry
  // channel_type:1 / channel_size_total:1 / channel_member_perms:"0".
  const dmCtx: ScienceChannelContext = {
    channel_type: channel.type,
    channel_size_total: 1,
    channel_member_perms: '0',
    channel_hidden: false,
  };
  const scienceState = window.__nlDiscordScience ?? {};
  scienceState.channelContexts = {
    ...(scienceState.channelContexts ?? {}),
    [channel.id]: { ...dmCtx, ...scienceState.channelContexts?.[channel.id] },
  };
  window.__nlDiscordScience = scienceState;

  void scienceTrackBatch([
    {
      type: 'dm_list_viewed',
      properties: {
        num_users_visible: 0,
        num_users_visible_with_mobile_indicator: 0,
        now_playing_visible: false,
        now_playing_num_cards: 0,
        now_playing_games_detected: [],
        visible_user_ids: [targetUserId],
        changelog_dm_visible: false,
        channel_id: channel.id,
      },
    },
    {
      type: 'channel_opened',
      properties: {
        channel_id: channel.id,
        is_app_dm: false,
        selected_guild_id: null,
      },
    },
  ]);

  // 8 + 9. Two supplemental-data polls after the first message. The HAR
  // shows these firing at ~53ms and ~1.2s after the science batch — the
  // composer's post-send eligibility recheck. Best-effort; we don't await
  // the second one so total wall-clock stays bounded.
  if (firstMessage !== undefined) {
    await sleep(53, 15);
    await discordFetch<unknown>(
      token,
      `/users/@me/message-requests/supplemental-data${supplementalQs}`,
    ).catch((): undefined => {
      // best-effort UI-mirror fetch
      return undefined;
    });
    // Fire-and-forget second poll so we don't block the return value on it.
    void (async () => {
      await sleep(1220, 200);
      await discordFetch<unknown>(
        token,
        `/users/@me/message-requests/supplemental-data${supplementalQs}`,
      ).catch((): undefined => {
        // best-effort post-send supplemental-data poll
        return undefined;
      });
    })();
  }

  return { channel, sentMessage };
  // --- end ORIGINAL IMPLEMENTATION body ---
}

   end REVIVABLE STUB */

export async function getSticker(
  params: GetStickerInput,
): Promise<GetStickerOutput> {
  return discordFetch<Sticker>(params.token, `/stickers/${params.stickerId}`);
}

export async function getStickerPack(
  params: GetStickerPackInput,
): Promise<GetStickerPackOutput> {
  const qs = buildQuery({ country_code: params.countryCode ?? 'US' });
  return discordFetch<StickerPack>(
    params.token,
    `/sticker-packs/${params.packId}${qs}`,
  );
}

export async function greetChannel(
  params: GreetChannelInput,
): Promise<GreetChannelOutput> {
  const { token, channelId, stickerIds } = params;
  const fingerprint = await awaitCapturedFingerprint();
  return discordFetch<GreetChannelOutput>(
    token,
    `/channels/${channelId}/greet`,
    {
      method: 'POST',
      body: { sticker_ids: stickerIds },
      headers: {
        ...fingerprint,
        'X-Context-Properties': contextProperties('greet'),
      },
    },
  );
}

// ============================================================================
// createDMDesktopDOM — pure DOM-driven cold-DM open
//
// Philosophy: createDMDesktop (now disabled) tries to mimic the desktop client's
// HAR by issuing the API calls ourselves and replaying the surrounding science
// telemetry. Even matched byte-for-byte, the AGGREGATE pattern of a logged-in
// client emitting cold-DM trails to strangers gets accounts suspended for bot
// activity. The fundamental problem is that we are the ones making the calls.
//
// This function inverts that: we make zero API calls. We simulate real DOM
// events — a click on the message-author avatar, a click on the popout's
// "Message" button, a paste into the composer, an Enter keypress — and let
// Discord's own React handlers emit every /api/v9/* request. The shape, the
// timing, the x-context-properties, the location_stack, the profile_session_id,
// the fingerprint headers are all whatever Discord's bundle decided to emit
// for a real user interaction, because that's exactly what they are.
//
// Trade-off: brittleness against Discord's DOM. Class names are hashed
// (`avatar_a8e728`), Slate-editor selectors can change shape, popout container
// markup occasionally gets reworked. The function uses partial class-name
// matching (`[class*="userPopout"]`) and Flux-store fallback identification to
// reduce single-string brittleness, but a clean-slate redesign will break it.
// When that happens, expect a "could not find <X> within Yms" diagnostic.
// ============================================================================

interface MessageStoreLike {
  getMessages: (channelId: string) => {
    toArray?: () => Message[];
    _array?: Message[];
  };
  getName?: () => string;
}

function findMessageStore(): MessageStoreLike | null {
  const wp = getWebpackRequire();
  if (!wp) return null;
  for (const c of walkExports(wp)) {
    const getMessages = safeGet(c, 'getMessages');
    const getName = safeGet(c, 'getName');
    if (typeof getMessages === 'function' && typeof getName === 'function') {
      try {
        if ((getName as () => unknown).call(c) === 'MessageStore') {
          return c as MessageStoreLike;
        }
      } catch {
        // getName threw — skip
      }
    }
  }
  return null;
}

async function waitForElement<T extends Element = HTMLElement>(
  selector: string,
  timeoutMs: number,
  root: ParentNode = document,
): Promise<T> {
  const start = Date.now();
  while (true) {
    const el = root.querySelector(selector) as T | null;
    if (el) return el;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for selector "${selector}". Discord's DOM may have been redesigned (this function depends on partial-class-name shape) — verify the selector against a live desktop session.`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Dispatch a click that goes through React's synthetic event system. React
// 17+ listens for native events at the React root container, so a bubbled
// MouseEvent is what we want — `.click()` works too but is sometimes
// blocked by `pointer-events: none` shells; pointerdown/up + click together
// covers handlers attached to any of the three.
function dispatchUserClick(el: Element): void {
  const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

// Paste text into a Slate/contenteditable composer. Slate ignores direct
// `.textContent =` and `.value =` assignments; the only reliable way to
// inject text that triggers its onChange path is a synthetic ClipboardEvent
// carrying a DataTransfer payload.
function pasteIntoComposer(el: Element, text: string): void {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  const ev = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  });
  el.dispatchEvent(ev);
}

function dispatchEnterKey(el: Element): void {
  const opts = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
}

// Find the popout's "Message" button. Discord renders it as a real
// <button> inside the popout container (class name varies across builds:
// userPopoutOuter / userPopout / userProfileOuter / userProfilePopout —
// see the popout-selector list above). We match on visible text content
// ("Message"), tolerating surrounding whitespace. i18n: Discord's UI
// strings vary, but for English locale the text is reliably "Message".
// Callers running non-EN sessions will need a locale-aware lookup; we
// throw with a clear diagnostic in that case.
function findMessageButtonInPopout(popout: Element): HTMLElement | null {
  const buttons = popout.querySelectorAll(
    'button, [role="button"], [class*="button_"]',
  );
  for (const b of Array.from(buttons)) {
    const text = (b.textContent ?? '').trim().toLowerCase();
    if (text === 'message' || text === 'send message') {
      return b as HTMLElement;
    }
  }
  return null;
}

async function waitForDMRouteSwitch(timeoutMs: number): Promise<string> {
  const start = Date.now();
  while (true) {
    const m = window.location?.pathname?.match(
      /^\/channels\/@me\/(\d{17,20})$/,
    );
    if (m) return m[1];
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Discord did not navigate to a DM route within ${timeoutMs}ms after the Message-button click (window.location.pathname is "${window.location?.pathname}"). The popout's React handler may have failed to fire — check that the popout was actually open, that the matched button was the right one, and that the executor is on the desktop surface.`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Best-effort read of the optimistically-inserted first message. Discord's
// composer inserts into MessageStore before the POST resolves; if we don't
// see it within the budget we just return undefined and let callers verify
// via listMessages if they care.
async function readOptimisticMessage(
  channelId: string,
  content: string,
  authorId: string | undefined,
  timeoutMs: number,
): Promise<Message | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const store = findMessageStore();
    if (store) {
      try {
        const bag = store.getMessages(channelId);
        const arr: Message[] | undefined =
          typeof bag?.toArray === 'function' ? bag.toArray() : bag?._array;
        if (Array.isArray(arr)) {
          for (let i = arr.length - 1; i >= 0; i--) {
            const m = arr[i];
            if (
              m?.content === content &&
              (authorId === undefined || m.author?.id === authorId)
            ) {
              return m;
            }
          }
        }
      } catch {
        // MessageStore shape changed — bail out of optimistic read.
        return undefined;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

export async function createDMDesktopDOM(
  params: CreateDMDesktopDOMInput,
): Promise<CreateDMDesktopDOMOutput> {
  // Wrap the whole flow in `withDomFlow` so `discordFetch` will refuse any
  // non-GET call from anywhere inside this body. The function legitimately
  // uses GET reads (listRelationships, /users/@me/channels, listMessages)
  // for precondition checks; the guard only blocks state-changing calls,
  // which would invalidate the DOM-provenance guarantee if emitted here.
  return withDomFlow(() => createDMDesktopDOMImpl(params));
}

async function createDMDesktopDOMImpl(
  params: CreateDMDesktopDOMInput,
): Promise<CreateDMDesktopDOMOutput> {
  const { userId, guildId, channelId, messageId, firstMessage } = params;

  // 1. Surface guard. Browser sessions don't have the Discord-app DOM shape
  //    this function depends on (Slate composer, popout containers, message
  //    element ids) — they exist on web Discord too but with different
  //    class-name conventions, and the cold-DM-via-DOM has not been audited
  //    against the web HAR. Refuse rather than silently misbehave.
  const surface = getActiveSurface();
  if (surface !== 'desktop') {
    throw new Error(
      `createDMDesktopDOM requires the desktop surface, but getContext() resolved to "${surface}". This function drives Discord's desktop UI via simulated DOM events; the browser surface has different DOM shape and is not supported. Re-open the executor against the Discord desktop app.`,
    );
  }

  // 2. Friend-roster gate. The library workflow requires the agent to call
  //    listRelationships({type: 1}) before any DM call so it can route to
  //    createDMFriend (for friends) vs createDMDesktopDOM (for strangers).
  //    Agents skip this step often enough that it's the #1 source of
  //    "DOM flow ran when the API flow would have worked" incidents. If the
  //    target IS on the friend roster, refuse here with a clear pointer to
  //    createDMFriend — both because that path is ~10s faster (no popout
  //    dwell, no DOM brittleness) and because emitting popout telemetry for
  //    a friend you could have addressed via a plain channels POST is
  //    unnecessary noise. Fail-open if the roster fetch itself fails: we'd
  //    rather over-run the DOM flow than block legitimate cold DMs on a
  //    transient network blip.
  try {
    const { relationships } = await listRelationships({ type: 1 });
    if (relationships.some((r) => r.id === userId)) {
      throw new Error(
        `Refusing createDMDesktopDOM: user ${userId} is on the friend roster. Use createDMFriend({recipients: ["${userId}"]}) → sendMessage({channelId, content: "${firstMessage}"}) instead — it's ~10s faster, doesn't depend on Discord's DOM shape, and avoids emitting unnecessary popout/profile-VIEW telemetry for a relationship that's already cleared on Discord's side. (Library workflow: every DM task starts with listRelationships({type: 1}) to route between createDMFriend and createDMDesktopDOM — skipping that step is what led here.)`,
      );
    }
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.startsWith('Refusing createDMDesktopDOM:')
    )
      throw e;
    // Roster fetch failed (network / rate limit / token-not-yet-captured) —
    // fall through and let the DOM flow run. The agent is expected to have
    // enforced this externally per § DM Workflow Step 1.
  }

  // 3. Pre-existing-DM gate. The whole purpose of this function is the cold,
  //    never-before-opened DM flow — the popout-click-into-channels-POST
  //    choreography. If a DM channel already exists, the desktop client
  //    doesn't re-run the popout flow; it just navigates to the existing
  //    channel. Replaying the popout sequence on an already-open DM emits
  //    a channels POST that Discord's server folds back to the same channel
  //    id, but the surrounding telemetry is shaped for a fresh open — itself
  //    a discriminative signal. Refuse the call and tell the agent to use
  //    sendMessage on the existing channel instead.
  //
  //    Implementation: GET /users/@me/channels and look for a DM with the
  //    target user in recipients. The previous Flux-based lookup
  //    (findPrivateChannelLookup → PrivateChannelStore.getDMFromUserId) is
  //    unreliable on current Discord builds (≥545032) because every Flux
  //    store is now wrapped in a $$loader proxy that stubs every method to
  //    return empty values for outside-bundle code, so the lookup can both
  //    miss an existing DM (false negative → we'd improperly run the cold
  //    flow on an open channel) AND fire on truthy-but-meaningless stubs
  //    (false positive → throw on a legitimately new DM). The REST call is
  //    deterministic and immune to the proxy refactor.
  let existingDmId: string | undefined;
  try {
    const channels = await discordFetch<Channel[]>(
      undefined,
      '/users/@me/channels',
    );
    const dm = channels.find(
      (c) => c.type === 1 && c.recipients?.some((r) => r.id === userId),
    );
    if (dm?.id && /^\d{17,20}$/.test(dm.id)) {
      existingDmId = dm.id;
    }
  } catch {
    // Transient network / rate-limit / token-not-yet-captured — proceed
    // without gating. The agent is expected to enforce this externally too
    // (the library docs require checking listRelationships before this
    // call); the gate is defense-in-depth, not a primary check.
  }
  if (existingDmId) {
    // Distinguish "existing DM with prior history" from "existing DM that is
    // empty". An empty existing DM (e.g. an orphan from a prior failed
    // createDMDesktopDOM, or a channel the user opened manually but never
    // wrote in) is structurally the same risk shape as a cold DM: the
    // channels POST has happened but no first message has been sent through
    // the composer. REST sendMessage in that state would be the dominant
    // ban signal — and ensureRestSendSafe in sendMessage will refuse
    // it. The only safe path forward is to drive Discord's composer, even
    // though the popout-click would technically navigate-to-existing rather
    // than create-new (Discord folds the channels POST idempotently). The
    // "fresh-open-shaped telemetry on an idempotent POST" risk is real but
    // smaller than the orphan-channels-POST + delayed-API-send risk.
    let existingDmIsEmpty = false;
    try {
      const { messages } = await listMessages({
        channelId: existingDmId,
        limit: 1,
      });
      existingDmIsEmpty = messages.length === 0;
    } catch {
      // Can't verify — default to the original "refuse" behavior, since
      // refusing the DOM flow is the conservative choice when state is
      // unknown (a wrong refusal forces the agent to retry; a wrong
      // proceed could re-emit popout telemetry on a warm channel).
    }
    if (!existingDmIsEmpty) {
      throw new Error(
        `A DM channel (${existingDmId}) already exists with user ${userId} and has prior message history. createDMDesktopDOM is for cold/never-opened DMs only — replaying the popout flow on an active DM produces fresh-open-shaped telemetry around an idempotent channels POST, which is itself a fingerprint. Use sendMessageDesktopDOM({channelId: "${existingDmId}", content: "..."}) to message this user instead — REST sendMessage to a non-friend DM (which you've already established this is, by virtue of reaching this function) gets accounts suspended as of 2026-05-18 even when the channel has prior history.`,
      );
    }
    // Empty existing DM — fall through to the DOM choreography. The popout
    // click will navigate to the existing channel rather than create a new
    // one (Discord's React handler dispatches CHANNEL_SELECT on the existing
    // channel id), but the composer-mount → paste → Enter sequence still
    // emits a real first-message POST as the natural follow-up to the
    // original channels POST.
  }

  // 4. Navigate to the source guild channel if not already there. The popout
  //    VIEW science event encodes location_stack:["avatar","user profile
  //    popout"] AND the referer header on the channels POST is the page URL —
  //    if the page is elsewhere when the avatar is clicked, the referer
  //    contradicts location_stack. selectChannel routes via Discord's own
  //    SPA router so the fetch hook survives and post-mount telemetry fires
  //    naturally.
  const expectedPath = `/channels/${guildId}/${channelId}`;
  if (window.location?.pathname !== expectedPath) {
    await selectChannel({ guildId, channelId });
    if (window.location?.pathname !== expectedPath) {
      throw new Error(
        `Could not navigate to ${expectedPath} via selectChannel (window.location.pathname is "${window.location?.pathname}"). The Flux dispatch may have been rejected; verify the executor is attached to a live, signed-in Discord desktop window and the user is a member of the guild.`,
      );
    }
    // Brief settle after channel mount so React finishes rendering messages
    // before we look for the source-message element. Discord's mount-batch
    // fires within ~600ms; we wait a bit more conservatively.
    await sleep(1200, 300);
  }

  // 5. Locate the source message in the DOM. Discord assigns each message
  //    element id `chat-messages-{channelId}-{messageId}`. If the message is
  //    not currently rendered (out of the recent-history window or below the
  //    scroll viewport even after channel mount), we throw with a hint.
  const messageEl = await waitForElement<HTMLElement>(
    `#chat-messages-${channelId}-${messageId}`,
    8000,
  );

  // 6. Find the avatar inside that message. Discord renders the author
  //    avatar as `<img class="avatar_xxx" ...>` in the message header. Class
  //    names are hashed per build so we match on the prefix.
  const avatar = messageEl.querySelector(
    'img[class*="avatar_"], [class*="avatar_"][role="button"]',
  ) as HTMLElement | null;
  if (!avatar) {
    throw new Error(
      `Could not find author avatar inside message element "#chat-messages-${channelId}-${messageId}". Either the message has no rendered avatar (system message, "compact" mode, grouped-author second message), or Discord renamed the class prefix from "avatar_". Pick a message with a visible avatar (the first message of an author's run) and retry.`,
    );
  }

  // Scroll into view so the click target is rendered with a real bounding
  // box — clicks on offscreen avatars sometimes get swallowed by Discord's
  // virtual-scroll renderer. Brief settle so the scroll completes.
  avatar.scrollIntoView({
    block: 'center',
    behavior: 'instant' as ScrollBehavior,
  });
  await sleep(250, 80);

  // 7. Click the avatar. Discord's React handler opens the profile popout.
  dispatchUserClick(avatar);

  // 8. Wait for the popout to render. The class name has drifted across
  //    builds:
  //      - Pre-2026: camelCase CSS-module names — `userPopoutOuter_xxx`,
  //        `userPopout_xxx`.
  //      - 2026+: kebab-case stable name — `user-profile-popout` (confirmed
  //        live: `outer_c0bea0 theme-dark theme-darker images-dark
  //        user-profile-popout themeContainer__5be3e`, mounted inside a
  //        wrapper with `id="popout_<n>"`).
  //    We match all known variants; the kebab-case name is the current
  //    canonical one and the camelCase patterns are kept for older builds.
  //    The `[id^="popout_"]` wrapper is a structural fallback if Discord
  //    renames the inner class again. 4s budget covers slow popout-component
  //    lazy-loads on first open.
  const popout = await waitForElement<HTMLElement>(
    [
      '[class*="user-profile-popout"]',
      '[class*="userPopoutOuter"]',
      '[class*="userPopout"]',
      '[class*="userProfileOuter"]',
      '[class*="userProfilePopout"]',
      '[id^="popout_"] [class*="outer_"]',
    ].join(', '),
    4000,
  );

  // 9. Human-natural popout dwell. ~3s is the HAR-observed median between
  //    avatar click and "Message" button click. DO NOT optimise this down —
  //    sub-second popout-to-action was identified in the May-2026 review as
  //    the loudest single timing tell. Jittered so calls don't share a fixed
  //    signature across accounts.
  await sleep(3000, 700);

  // 10. Find the "Message" button inside the popout. We scope to the popout
  //    element rather than document to avoid catching unrelated "Message"
  //    buttons elsewhere on the page (inbox button, etc.).
  const messageBtn = findMessageButtonInPopout(popout);
  if (!messageBtn) {
    throw new Error(
      `Could not find a "Message" button inside the open popout. Discord may have renamed the label (non-English locale?) or restructured the popout actions row. Inspect the popout DOM and update findMessageButtonInPopout.`,
    );
  }

  // 11. Click the Message button. Discord's React handler emits the
  //     channels POST and SPA-navigates to /channels/@me/{newDmId}.
  dispatchUserClick(messageBtn);

  // 12. Wait for the route to switch. The DM channel id is in the URL once
  //     the navigation commits.
  const dmChannelId = await waitForDMRouteSwitch(8000);

  // Poison this channel id immediately. From here until the in-DOM Enter
  // dispatch fires (step 18), any throw means Discord's bundle has emitted
  // the channels POST (good telemetry) but we have NOT yet emitted a
  // messages POST through the composer. If the caller subsequently tries
  // sendMessage({channelId: dmChannelId, ...}) from our code, the resulting
  // /channels/{id}/messages POST arrives seconds after the channels POST
  // with none of the composer-mount telemetry the anti-abuse classifier
  // expects to see — the dominant cold-DM ban signal. POISONED_DM_CHANNELS
  // is consulted at the top of sendMessage; entries are session-scoped.
  // Cleared on success at the end of step 18.
  POISONED_DM_CHANNELS.add(dmChannelId);

  // 13. Build the Channel object for the return value. The route switch
  //     already proved Discord created the channel — the desktop client
  //     does not navigate to a non-existent `/channels/@me/{id}`. Discord's
  //     Flux ChannelStore is wrapped in a $$loader proxy on current builds
  //     (≥545032) that stubs every method to return empty objects for
  //     outside-bundle code, so reading the hydrated channel out of it is
  //     no longer possible; we synthesize a minimal Channel from what we
  //     know. Callers needing full channel metadata can hit GET /channels/
  //     {id} or listMessages after this returns. type=1 because cold DMs
  //     are always 1:1 (never group DMs) — group DMs use a different UI
  //     flow that this function does not implement.
  const channel = {
    id: dmChannelId,
    type: 1,
  } as Channel;

  // 14. Wait for the message composer to mount. Discord's composer is a
  //     Slate editor with `data-slate-editor="true"` and `role="textbox"`.
  //     The DM composer mounts within ~500ms of route commit; we budget
  //     longer to be safe.
  const composer = await waitForElement<HTMLElement>(
    '[role="textbox"][data-slate-editor="true"]',
    5000,
  );

  // 15. Focus the composer. Discord's onFocus handler emits a composer-mount
  //     batch (sticker-bar GET, entitlements GET) — same as a real user
  //     clicking into the textbox.
  composer.focus();
  await sleep(350, 100);

  // 16. Paste the first message. Real users type character-by-character, but
  //     paste-into-composer also matches a common UX (drop a prepared
  //     message), and Discord's composer doesn't fingerprint typing-vs-paste
  //     against anti-abuse on cold DMs in the May-2026 HAR. Pasting also
  //     dodges the rabbit-hole of synthesising plausible inter-key timings.
  pasteIntoComposer(composer, firstMessage);

  // 17. Brief dwell so paste-to-send isn't sub-100ms. Real users always
  //     pause before pressing Enter on a cold DM.
  await sleep(600, 150);

  // 18. Press Enter. Discord's composer handler emits the messages POST
  //     with its own context-properties + fingerprint headers + nonce.
  dispatchEnterKey(composer);

  // The composer just fired the messages POST as the natural follow-up to
  // the channels POST, with all the surrounding telemetry Discord expects.
  // Sending to this channel from our code is now safe — clear the poison.
  POISONED_DM_CHANNELS.delete(dmChannelId);

  // 19. Best-effort read of the optimistically-inserted message. Discord
  //     inserts into MessageStore before the POST resolves. We match on
  //     content only — author filtering would need the current user's id,
  //     which isn't trivially reachable from here, and content-match is
  //     sufficient for the immediate-post case (the only writer in the
  //     channel that fast is us).
  const sentMessage = await readOptimisticMessage(
    dmChannelId,
    firstMessage,
    undefined,
    1500,
  );

  return { channel, sentMessage };
}

// ============================================================================
// sendMessageDesktopDOM — DOM-driven send for established DM channels
//
// Companion to createDMDesktopDOM. createDMDesktopDOM opens a non-friend DM
// and sends the first message via Discord's React handlers (the channels POST
// and the messages POST both come from Discord's bundle). After that, the
// channel is "warm" — it has prior message history. The May-2026 review
// concluded that subsequent sends on warm DMs were safe via REST (i.e., the
// regular `sendMessage` path), because anti-abuse no longer correlated those
// sends back to the original channels POST.
//
// As of 2026-05-18 that conclusion is invalidated by fresh suspension reports.
// REST `sendMessage` to a non-friend DM gets accounts flagged even with prior
// history — the classifier appears to weight the recipient relationship
// heavily enough that "API request from us to a non-friend's DM" is itself
// the discriminative signal, regardless of how cold the channel is. The
// `ensureRestSendSafe` gate in sendMessage now refuses these calls and
// routes the agent here.
//
// What this function does (mirrors steps 14–19 of createDMDesktopDOM):
//   1. Surface guard (desktop only — DOM shape differs on web Discord and
//      hasn't been audited).
//   2. SPA-navigate to /channels/@me/{channelId} via selectChannel if not
//      already there. Never window.location.href — wipes the fetch hook.
//   3. Wait for the Slate composer to mount.
//   4. Focus the composer (emits Discord's composer-mount science batch).
//   5. Paste content via synthetic ClipboardEvent (Slate-compatible).
//   6. ~600ms dwell so paste-to-send isn't sub-100ms (real users always
//      pause before pressing Enter).
//   7. Dispatch Enter — Discord's composer handler fires the messages POST
//      with chat_input X-Context-Properties, fingerprint headers, and
//      nonce, all emitted by Discord's bundle.
//   8. Best-effort read of the optimistically-inserted message from Flux
//      MessageStore.
//
// What it does NOT do:
//   - Call the Discord REST API. Like createDMDesktopDOM, every /api/v9/*
//     request in the resulting flow comes from Discord's own React handlers.
//   - Friend-status check. This function works for ANY DM channel — the
//     point is to use it for non-friends, but it's safe (just slower) on
//     friend DMs too if the caller prefers symmetric provenance.
//   - Channel-type check. If the agent passes a guild channel id, this
//     function will still drive the guild composer; that's not the intended
//     use but it's not wrong either. The intended use is DMs.
//
// Wall-clock: ~3–5s (navigation + composer-mount + paste + 600ms dwell +
// Enter + optimistic-read). Faster than createDMDesktopDOM because there's
// no popout dwell and no avatar choreography.
// ============================================================================

export async function sendMessageDesktopDOM(
  params: SendMessageDesktopDOMInput,
): Promise<SendMessageDesktopDOMOutput> {
  // Wrap in `withDomFlow` so `discordFetch` refuses any non-GET request
  // anywhere inside this body. Today the function makes zero REST calls
  // at all; the wrap is defense-in-depth against a future maintainer
  // adding a "retry via sendMessage if the Enter dispatch fails" branch,
  // which would silently regress the DOM-provenance guarantee.
  return withDomFlow(() => sendMessageDesktopDOMImpl(params));
}

async function sendMessageDesktopDOMImpl(
  params: SendMessageDesktopDOMInput,
): Promise<SendMessageDesktopDOMOutput> {
  const { channelId, content } = params;

  // 1. Surface guard. Browser Discord has different DOM class-name
  //    conventions and this function hasn't been audited against the web
  //    HAR. Refuse rather than silently misbehave.
  const surface = getActiveSurface();
  if (surface !== 'desktop') {
    throw new Error(
      `sendMessageDesktopDOM requires the desktop surface, but getContext() resolved to "${surface}". This function drives Discord's desktop composer via simulated DOM events; the browser surface has different DOM shape and is not supported. Re-open the executor against the Discord desktop app, or use sendMessage if the recipient is a friend (REST is safe for friend DMs).`,
    );
  }

  // 2. Navigate to the DM if not already there. selectChannel uses
  //    transitionTo → pushState+Flux dispatch; both preserve the fetch hook,
  //    unlike window.location.href.
  const expectedPath = `/channels/@me/${channelId}`;
  if (window.location?.pathname !== expectedPath) {
    await selectChannel({ channelId });
    if (window.location?.pathname !== expectedPath) {
      throw new Error(
        `Could not navigate to ${expectedPath} via selectChannel (window.location.pathname is "${window.location?.pathname}"). Verify the channel id is a real DM the current user can access, and that the executor is attached to a live, signed-in Discord desktop window.`,
      );
    }
    // Brief settle so the composer can mount before we query it.
    await sleep(1200, 300);
  }

  // 3. Wait for the composer.
  const composer = await waitForElement<HTMLElement>(
    '[role="textbox"][data-slate-editor="true"]',
    5000,
  );

  // 4. Focus — Discord's onFocus emits composer-mount telemetry that
  //    anti-abuse correlates with the upcoming messages POST.
  composer.focus();
  await sleep(350, 100);

  // 5. Paste via synthetic ClipboardEvent. Direct .textContent / .value
  //    assignment doesn't trigger Slate's onChange path.
  pasteIntoComposer(composer, content);

  // 6. Brief dwell so paste-to-send isn't sub-100ms (the loudest single
  //    timing tell on cold sends in the May-2026 review; same principle
  //    applies to warm sends here, just less critical).
  await sleep(600, 150);

  // 7. Enter — Discord's composer handler emits the messages POST with its
  //    own context-properties + fingerprint headers + nonce.
  dispatchEnterKey(composer);

  // 8. Best-effort read of the optimistically-inserted message. Content-
  //    match is sufficient: in the ~1.5s window the only writer to this
  //    channel that fast is us.
  const sentMessage = await readOptimisticMessage(
    channelId,
    content,
    undefined,
    1500,
  );

  return { sentMessage };
}
