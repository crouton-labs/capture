import { z } from 'zod';

export const libraryDescription =
  'Discord chat operations via the internal v9 REST API';

export const libraryIcon = '/icons/libs/discord.ico';
export const loginUrl = 'https://discord.com/channels/@me';

export const libraryNotes = `
## Hard Rules — Read Before Calling Anything

1. **Library functions only.** Every supported Discord operation has a wrapper in this library. Do NOT DOM-scrape the Discord UI, do NOT dispatch synthetic \`KeyboardEvent\`/\`MouseEvent\`/\`PointerEvent\`/\`ClipboardEvent\`s, do NOT read \`localStorage.token\` directly, do NOT POST to \`/api/v9/*\` by hand, do NOT walk React fibers or webpack module caches, do NOT touch Flux stores directly. If you can't find a wrapper for what the user asked, the operation is genuinely unsupported (see § Unsupported Operations) — say so and stop, rather than improvising in-page.

   **The sole exceptions are \`createDMDesktopDOM\` and \`sendMessageDesktopDOM\`.** Those two functions are the only places in the codebase where DOM-driving (avatar click → popout "Message" click → composer paste → Enter, or composer focus → paste → Enter) is permitted, and they're permitted only because the *library* encapsulates the full sequences behind typed schemas — the agent still calls them via \`createDMDesktopDOM({...})\` / \`sendMessageDesktopDOM({...})\` like any other wrapper. The carve-out exists because issuing non-friend DM API calls ourselves reliably gets accounts suspended for bot activity (both the cold first-message and — as of 2026-05-18 — every subsequent message); routing through Discord's own React handlers via real DOM events is the only known way to emit non-friend DM traffic that anti-abuse doesn't flag. **This carve-out does NOT generalise**: it does not authorise you to write your own DOM clicks, to fire your own \`KeyboardEvent\`s for sending messages, to extend either function with extra DOM steps via \`executeJS\`, to fall back to the disabled \`createDMDesktop\`, or to apply the same trick to other operations (relationships, guilds, settings, etc.). If the DOM functions don't fit the situation (recipient isn't the author of an in-viewport guild message for the cold case, locale isn't English so the "Message" button label differs, Discord redesigned the popout/composer, etc.), the answer is still "stop and tell the user" — not "improvise in-page."
2. **\`getContext()\` is the only acceptable way to obtain a token.** It works on desktop and browser without manual intervention. If it throws, do not retry with a hand-rolled extraction — surface the error verbatim.
3. **Ask before opening Discord, then persist the answer.** Before the first \`createExecutor\` call of any task, determine the user's desktop-vs-browser preference and reuse it forever after. See § Surface Preference.
4. **Every DM task starts with \`listRelationships({type: 1})\`. No exceptions.** This is the single most-skipped rule in the library, and skipping it is the single biggest source of wrong-recipient and account-flag incidents. Before the FIRST DM-shaped call of a task — before \`createDMFriend\`, before \`createDMDesktopDOM\`, before \`sendMessage\` to anything that might be a DM channel, before \`greetChannel\` — call \`listRelationships({type: 1})\` and decide your path from the result. Do NOT guess friend status from prior conversation, from workspace memory, from how the user described the person, from a cached DM channel id you've seen before, or from "I just opened this DM in another turn so they must be addressable." None of those are substitutes. The roster is the only source of truth, and it can change between turns. If you find yourself about to send a DM and you have not called \`listRelationships\` in the current task, stop and call it. See § DM Workflow for the routing tree this feeds into. The older \`createDMDesktop\` (API-driven, replays HAR telemetry from our side) is **disabled** — it throws immediately on every call because it repeatedly got accounts suspended for bot activity; do not attempt it as a fallback.

## DM Workflow

Pick your path mechanically based on **friend status**, not surface. The function names encode the agent's intent so a mistake surfaces as a clean error instead of an at-risk DM.

### Step 1 (mandatory, no shortcuts): Check the friend roster

Call \`listRelationships({type: 1})\` and check whether the recipient is on the list (match by \`id\`, \`username\`, or \`global_name\`). The answer routes you to Path A or Path B below.

**This step is mandatory on EVERY DM task, even if:**
- You DM'd this person earlier in the same conversation — friend status can change between turns; a cached channel id from a previous turn can 403 with \`Missing Access\` if they unfriended you, deleted their account, or you got rate-limited.
- Workspace memory or scrollback has a channel id for this recipient — that id may be stale; \`sendMessage\` on a stale DM channel returns 403 and the recovery path requires the friend check anyway.
- The user phrased the request as "send a message to X" and X is obviously a friend / obviously a stranger — phrasing is not evidence. The roster is.
- You "just want to send one message" — the time-cost of a \`listRelationships\` call is ~200ms; the time-cost of recovering from sending to the wrong person is unbounded.

**Common failure mode that skipping this enables:** agent reads a DM channel id from workspace memory, calls \`sendMessage(channelId, ...)\` directly, gets a 403, then jumps to \`createDMDesktopDOM\` without ever checking the roster — missing the case where the recipient IS a friend and \`createDMFriend\` would have worked first try.

### Path A: Target IS a friend — use \`createDMFriend\` (both surfaces)

1. **\`createDMFriend({recipients: [userId]})\`** — opens (or fetches the existing) DM channel. Runs on either surface. The library re-runs the friend check defensively and throws \`Refusing to open DM via createDMFriend: <id> is not a friend\` if anything changed since step 1. Faster than \`createDMDesktopDOM\` (no popout dwell, no DOM steps), and the telemetry shape Discord emits for a friend DM is already low-risk — there's no fidelity reason to prefer the DOM path here.
2. **\`sendMessage({channelId, content})\`** — use the channel id from step 1.

### Path B: Target is NOT a friend — desktop only, use \`createDMDesktopDOM\`

1. Confirm \`getContext().surface === "desktop"\`. From browser, **stop** — non-friend DMs are not supported by this library (the DOM path has only been audited against the desktop HAR). Offer \`addFriendById\` and let the user decide whether to wait for acceptance, or to switch to the desktop app.
2. The recipient must be the author of a message currently rendered in a guild channel you can see (\`listMessages({channelId})\` then pick a message with \`author.id === targetUserId\`). If they aren't — they're only reachable via DM list or friends list, or the message scrolled out of the loaded history — \`createDMDesktopDOM\` doesn't apply. **Stop and tell the user**; do not improvise.
3. **\`createDMDesktopDOM({userId, guildId, channelId, messageId, firstMessage})\`** — drives Discord's UI: clicks the author avatar on \`messageId\` to open the profile popout, dwells ~3s, clicks the popout's "Message" button (Discord's React handler fires the channels POST), waits for the route to switch to \`/channels/@me/{newDmId}\`, focuses the composer, pastes \`firstMessage\` via a synthetic \`ClipboardEvent\`, dispatches Enter (Discord's composer fires the message POST). All API calls are emitted by Discord's own bundle — the request shape, timing, context-properties, location_stack, and fingerprint headers are whatever Discord decided to emit for a real user click, because they ARE the result of (simulated) real user clicks. **The function refuses if a DM channel with the target user already exists and has prior history** — replaying the popout flow on an existing DM produces fresh-open-shaped telemetry around an idempotent channels POST, itself a tell. Use \`sendMessageDesktopDOM\` on the existing channel id instead — NOT \`sendMessage\` (see step 4 below).

   Returns \`{ channel, sentMessage }\`. \`sentMessage\` is best-effort (read from Flux \`MessageStore\` after the optimistic insert; may be \`undefined\` if not observed within 1.5s — \`listMessages\` to verify if needed). **~7–10s wall-clock** (the ~3s popout dwell is intentional and MUST NOT be tuned down — sub-second popout-to-action was the loudest single timing tell in the May-2026 review).

4. **Every subsequent send in this DM goes through \`sendMessageDesktopDOM({channelId, content})\`, not \`sendMessage\`.** As of 2026-05-18, REST \`sendMessage\` to a non-friend DM reliably gets accounts suspended for bot activity — and **this is true even when the channel has prior message history**. The May-2026 review's earlier finding that "warm non-friend DMs are safe via REST because anti-abuse no longer correlates subsequent messages against the original channels POST" was overturned by fresh suspension reports. The classifier appears to weight the recipient relationship heavily enough that "API request from us to a non-friend's DM" is the discriminative signal, independent of channel age. \`sendMessage\` enforces this via its \`ensureRestSendSafe\` gate and will refuse with a clear pointer to \`sendMessageDesktopDOM\`. \`sendMessageDesktopDOM\` is faster than \`createDMDesktopDOM\` (~3–5s wall-clock — no popout, no avatar choreography, just SPA-navigate to the DM → focus composer → paste → dwell → Enter), and produces messages POSTs with the same Discord-bundle provenance as \`createDMDesktopDOM\`'s first message.

5. **Fragility:** \`createDMDesktopDOM\` and \`sendMessageDesktopDOM\` both depend on Discord's desktop DOM shape (partial-class-match selectors like \`[class*="userPopout"]\`, \`[role="textbox"][data-slate-editor="true"]\`, message element id \`chat-messages-{channelId}-{messageId}\`) and on its Flux store layout (\`PrivateChannelStore.getDMFromUserId\`, \`ChannelStore.getChannel\`, \`MessageStore.getMessages\`). A clean-slate Discord redesign breaks them without changing the REST API. When that happens the functions throw with a "could not find <X> within Yms" diagnostic — the right response is to flag it to the user and stop, not to write your own fallback DOM clicks.

6. **Page navigation BEFORE these calls is unnecessary** — both \`createDMDesktopDOM\` and \`sendMessageDesktopDOM\` call \`selectChannel\` themselves if the page isn't already on the right channel. If you DO call \`selectChannel\` first, **never use \`window.location.href = ...\`** instead — that's a full-page reload, wipes the fetch hook, and leaves the executor's helpers cold for the rest of the session.

### Both paths

**NEVER** use a channel id pulled from the executor's landing URL (\`/channels/@me/<id>\`): that's whichever DM Discord happened to auto-open, not necessarily the intended recipient. Treating it as "good enough" has silently sent messages to the wrong person. The same applies to \`greetChannel\` — only call it on a channel id returned by \`createDMFriend\` / \`createDMDesktopDOM\` in the current run.

**NEVER** use a DM channel id pulled from workspace memory, prior-turn scrollback, or any source that isn't a \`createDMFriend\` / \`createDMDesktopDOM\` return value from the current task. DM channel ids look durable but they're effectively per-relationship: if the recipient unfriends, blocks, or churns, the id starts returning 403 \`Missing Access\` on every send. Worse, a stale id might still be writeable but point to the wrong person (group DM was renamed, recipient transferred ownership, etc.) — there is no agent-visible signal distinguishing "stale, will 403" from "stale, will silently send to someone else." The only safe path is: \`listRelationships\` → \`createDMFriend\` or \`createDMDesktopDOM\` → use THAT return value as your channelId, every task.

**If \`sendMessage\` returns 403 on a DM channel, that is the signal to restart at Step 1 (\`listRelationships\`)** — not the signal to retry with \`createDMDesktopDOM\` directly. The 403 means the cached id is unusable; it tells you nothing about whether the recipient is currently a friend, so the routing decision still has to come from a fresh roster check.

**If \`sendMessage\` refuses with \`Refusing sendMessage on channel <id>: this DM is with a non-friend ...\`, the answer is \`sendMessageDesktopDOM\`, not retry-with-different-params.** That refusal is the \`ensureRestSendSafe\` gate (added 2026-05-18); it fires when the recipient is on the channel but NOT on the friend roster. The fix is not to remove the gate, switch surfaces, or fall back to REST elsewhere — it's to send through \`sendMessageDesktopDOM\` so Discord's composer emits the messages POST. If the executor is on browser, you cannot send to a non-friend at all through this library; offer \`addFriendById\` and have the user accept on the desktop app, or wait for the friend request to clear.

## DOM flow isolation (invariant)

\`createDMDesktopDOM\` and \`sendMessageDesktopDOM\` exist so that the messages POST hitting Discord's servers is emitted by Discord's own React handlers in response to simulated DOM events — same request shape and provenance a real human keypress would produce. That guarantee is load-bearing: the entire reason these functions exist is that REST POSTs from our code to non-friend DM endpoints reliably get accounts suspended.

The library enforces this with a runtime guard. While either DOM function is executing, \`discordFetch\` refuses any non-GET request from anywhere in the call stack — including indirect calls through \`sendMessage\`, \`createDMFriend\`, \`greetChannel\`, \`addFriend\`, etc. GET reads (\`listRelationships\`, \`/users/@me/channels\`, \`listMessages\`) remain allowed because they're precondition checks, not state changes. A non-GET attempt throws with \`Refusing <METHOD> <path> during a DOM-driven send flow ...\` — that throw is the invariant catching a regression.

**Practical implication for agents:** if you see that error, do NOT remove the guard, retry with REST, or work around it. It means a state-changing REST call is being attempted inside a DOM flow, which is exactly the orphan-channels-POST pattern the DOM path was built to prevent. The bug is in the calling code, not in the guard. Report the error verbatim and stop. The library's own DOM functions never trip this guard; if you're seeing it, something in surrounding orchestration is wrong.

**Never call \`sendMessage\` to send the first message of a cold DM separately from the channel-open.** \`createDMDesktopDOM\` requires \`firstMessage\` precisely so the entire choreography runs in one in-page session; an orphaned \`sendMessage\` arriving 10+ seconds after the channels POST (which is exactly what happens when the agent splits "open the DM" and "send the message" across two \`executeJS\` calls) is the dominant cold-DM ban signal — the channels POST goes through, but the surrounding telemetry around it doesn't match a real composer-mount sequence.

**The disabled \`createDMDesktop\` is not a fallback.** It exists in the schema list for backwards reference only, throws immediately on every call, and was the function whose suspension issues motivated \`createDMDesktopDOM\` in the first place. Do not call it.

## Surface Preference — Required First Step (Enforced)

**\`getContext\` will throw unless you pass \`surface: "desktop" | "browser"\` as input.** This is enforcement, not a guideline — the library refuses to guess because silent defaulting is what got users frustrated.

Procedure on every Discord task:

1. Check the agent's workspace memory for a saved \`discordSurface\` value (\`"desktop"\` or \`"browser"\`).
2. If present, skip to step 4.
3. If absent, **ask the user**: "Use the Discord desktop app, or a browser tab?" Save the answer to workspace memory under \`discordSurface\`. (Don't auto-pick based on prior browser preferences — the user has a Discord-specific opinion.)
4. Create the matching executor:
   - \`desktop\`: \`createExecutor({ app: "discord", mode: "attached" })\`
   - \`browser\`: \`createExecutor({ url: "https://discord.com/channels/@me" })\`
5. Call \`getContext({ surface })\` with the value from steps 1–3. The library cross-checks against the actual executor attachment and throws if they disagree (e.g., you said "desktop" but the executor landed on a browser tab because the app wasn't running).
6. The library auto-persists the confirmed surface to \`discord.com\` \`localStorage\` on success. \`getSurfacePreference()\` and \`setSurfacePreference()\` remain available for explicit inspection, but step 5 is the only required call.

The preference does not decay. Reuse for every subsequent Discord task in the same workspace; only re-ask if the user explicitly says to switch.

## Workflow After Surface Is Chosen

1. \`createExecutor\` with the surface from above.
2. \`getContext({ surface })\` once. \`surface\` is REQUIRED — the value from workspace memory / the user. Returns \`{ token, userId, username, globalName, surface }\` AND caches the token internally. The returned \`username\`/\`globalName\` identify WHICH account is signed in — report that to the user instead of guessing from \`userId\`.
3. Every other function reads the cached token automatically. Do NOT pass \`token\` as a parameter — it is optional and only exists as an override for multi-session or test scenarios.

\`getContext\` works on both surfaces without external tooling. On desktop it walks Discord's webpack module cache for the REST client, fires a no-op authenticated request through Discord's own auth interceptor, and reads the resulting \`Authorization\` header off the outgoing call via an installed fetch/XHR hook. No CDP, no forced navigation, no header scraping. If it throws \`Discord token not captured\` despite all of that, the Discord session itself is broken (logged out, blocked, throttled) — report verbatim and stop.

If any other function throws \`No Discord session. Call getContext() before any other Discord function.\`, you skipped step 2. Call \`getContext()\`, then retry.

## Key Concepts

- **Snowflake IDs**: Channel, message, user, guild, and application IDs are 17–20 digit numeric strings. ALWAYS treat as strings; numeric coercion loses precision (> 2^53).
- **Auth header**: Discord expects \`Authorization: <token>\` (raw — NO \`Bearer\` prefix).
- **Pagination (messages)**: cursor-based via \`before\` (a snowflake from the previous page). \`limit\` is 1–100.
- **Rate limits**: Discord enforces per-route limits. 429 responses include \`retry_after\` (seconds); the implementation surfaces these errors verbatim.

## Channel IDs

The agent must already know the channel ID before calling messaging functions. Either ask the user to navigate to the target channel and read the path \`/channels/{guildId}/{channelId}\`, or call \`getCurrentChannelFromUrl()\` if the user is already on the channel.

## People in a Guild

REST enumeration of guild members is policy-blocked on community / verified guilds (\`GET /guilds/{id}/members\` and \`/members/search\` return 403 \`Missing Access\`). To find people, use these in priority order:

1. \`searchGuildMembers(guildId, query)\` — prefix search via the gateway (Op 8). Same protocol the in-app \`@mention\` autocomplete uses; works on community/verified guilds even when REST search is blocked. Requires a non-empty query; returns up to ~100 matches per call.
2. \`getGuildMember(guildId, userId)\` — REST hydration when you already have a userId (e.g., from a message author or a mention). Works on every guild including community ones; 200 with full member object.
3. \`listGuildMembers(guildId, channelId?, ranges?)\` — gateway sidebar lazy-load (Op 14). Returns the full roster on small guilds (under ~25k). Returns a partial / online-only slice on community/verified guilds (\`partialResult: true\` in the response). Useful for small servers; not a substitute for enumeration on large ones.

For "find a specific person without admin caps," the canonical path is: read recent channel history with \`listMessages\`, accumulate \`message.author.id\` values, then \`getGuildMember\` to hydrate. Op 8 search is the second resort when the user can supply at least a prefix of the username.

## Gateway Functions

\`searchGuildMembers\` and \`listGuildMembers\` send frames over Discord's existing gateway WebSocket. They require \`getContext()\` to have run first (it ensures the WS reference is captured). Responses are read via Discord's internal Flux dispatcher — no zlib decompression on our side.

## Server Creation & Invites

\`createGuild(token, name, ...)\` creates a new server owned by the current user (default uses Discord's "Create My Own" template). Right after creation, send an invite to friends in three calls: \`createChannelInvite(token, channelId)\` returns \`{code, ...}\` → \`createDMFriend({recipients: [userId]})\` opens (or fetches existing) DM → \`sendMessage({channelId: dmChannelId, content: "https://discord.gg/{code}"})\`. \`createDMFriend\` is idempotent: passing a userId you already DM with returns the existing channel.

## Unsupported Operations

The following are NOT addressable via this library. Do not attempt raw API calls — they will fail or be incorrect:

- Editing or deleting messages
- Adding or removing reactions
- Listing or creating threads
- Searching messages by content
- Voice/stage state, presence subscriptions
- Accepting/declining incoming friend requests, removing friends, cancelling outgoing requests, blocking/unblocking (only \`listRelationships\`, \`addFriend\`, and \`addFriendById\` are wrapped)
- Attachment upload (multi-step; not yet wrapped)
- Guild/role/channel mutation other than \`createGuild\` and \`createChannelInvite\` (no rename/delete/move)
- Real-time event subscription (incoming messages, typing, edits) — gateway primitives exist internally but no functions wrap them yet

## Friend Requests & Greetings

- \`listRelationships(token, type?)\` returns the full roster (friends, blocked, pending requests in either direction) in one unpaginated call. Filter via \`type\` (1=friend, 2=blocked, 3=incoming, 4=outgoing) or omit to get all.
- \`greetChannel(token, channelId, stickerIds)\` posts a sticker "wave" in an existing DM — the icebreaker prompt Discord shows on never-spoken-in DMs. The built-in Wave sticker ID is \`749054660769218631\`.
- Friend-request and greet endpoints can return HTTP 400 with \`captcha_key: ["captcha-required"]\` when Discord's anti-abuse system trips (typical on new accounts or rapid-fire requests). The captcha challenge is surfaced verbatim in the thrown error; the user must solve it in the Discord UI before retrying.

### Picking the addFriend variant

Two functions send friend requests; they hit different Discord endpoints and look like different UI flows to the anti-abuse classifier. Pick mechanically based on what you have:

| You have… | Call | Endpoint | UI flow it imitates |
|---|---|---|---|
| userId (snowflake) | \`addFriendById(token, userId)\` | \`PUT /users/@me/relationships/{userId}\` | Add Friend button on a profile popout |
| username only | \`addFriend(token, username, discriminator?)\` | \`POST /users/@me/relationships\` | Typing a name in the Add Friend search box |

\`addFriendById\` is the preferred path. Anywhere you have a userId — \`getUserProfile\`, \`listMessages\` author IDs, \`listRelationships\`, \`searchGuildMembers\`, \`getGuildMember\` — use it. Reach for \`addFriend\` only when the user gives you a bare username string with no way to resolve it.
`;

// ============================================================================
// Shared Params (snowflake strings — never numbers)
// ============================================================================

export const TokenParam = z
  .string()
  .optional()
  .describe(
    'Override the cached session token. Omit to use the token from the most recent getContext() call. The library caches the token in module scope and at __nl_discord_session in localStorage; passing it explicitly is only needed for multi-session scenarios or tests.',
  );

const SnowflakeRegex = /^\d{17,20}$/;

export const ChannelIdParam = z
  .string()
  .regex(SnowflakeRegex)
  .describe('Discord channel snowflake ID (17–20 digit string)');

export const MessageIdParam = z
  .string()
  .regex(SnowflakeRegex)
  .describe('Discord message snowflake ID');

export const UserIdParam = z
  .string()
  .regex(SnowflakeRegex)
  .describe('Discord user snowflake ID');

export const GuildIdParam = z
  .string()
  .regex(SnowflakeRegex)
  .describe('Discord guild snowflake ID');

export const ApplicationIdParam = z
  .string()
  .regex(SnowflakeRegex)
  .describe('Discord application snowflake ID');

// ============================================================================
// Shared Entity Schemas
// ============================================================================

export const UserSchema = z
  .object({
    id: UserIdParam,
    username: z.string().describe('Account username (unique)'),
    global_name: z
      .string()
      .nullable()
      .describe(
        'Display name across Discord (replaces legacy discriminator system)',
      ),
    discriminator: z
      .string()
      .describe('Legacy 4-digit tag; "0" for accounts migrated to global_name'),
    avatar: z
      .string()
      .nullable()
      .describe('Avatar hash; null = default avatar'),
    bot: z.boolean().optional().describe('True if this user is a bot account'),
    system: z
      .boolean()
      .optional()
      .describe('True if this is a Discord system user'),
    public_flags: z
      .number()
      .optional()
      .describe('Bitfield of public user flags (badges, etc.)'),
    flags: z.number().optional(),
    banner: z.string().nullable().optional(),
    banner_color: z.string().nullable().optional(),
    accent_color: z.number().nullable().optional(),
    premium_type: z
      .number()
      .optional()
      .describe('Nitro tier: 0=none, 1=Classic, 2=Nitro, 3=Basic'),
  })
  .passthrough();

export const AttachmentSchema = z
  .object({
    id: z.string().describe('Attachment snowflake ID'),
    filename: z.string(),
    size: z.number().describe('File size in bytes'),
    url: z.string().describe('CDN URL'),
    proxy_url: z.string().describe('Discord-proxied URL'),
    content_type: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .passthrough();

export const EmbedSchema = z
  .object({
    type: z
      .string()
      .optional()
      .describe('Embed type: rich, image, video, link, gifv, etc.'),
    title: z.string().optional(),
    description: z.string().optional(),
    url: z.string().optional(),
    timestamp: z.string().optional(),
    color: z.number().optional(),
  })
  .passthrough()
  .describe(
    'Discord embed. Common properties: type, title, description, url, color, fields[], footer, image, video, thumbnail, author. See Discord embed structure docs.',
  );

export const MessageSchema = z
  .object({
    id: MessageIdParam,
    channel_id: ChannelIdParam,
    content: z
      .string()
      .describe('Message body (markdown). Empty for system messages.'),
    author: UserSchema,
    timestamp: z.string().describe('ISO 8601 send timestamp'),
    edited_timestamp: z
      .string()
      .nullable()
      .describe('ISO 8601 last-edit timestamp; null if never edited'),
    attachments: z.array(AttachmentSchema),
    embeds: z.array(EmbedSchema),
    mentions: z.array(UserSchema).describe('Users explicitly @-mentioned'),
    mention_roles: z.array(z.string()).describe('Role snowflake IDs mentioned'),
    mention_everyone: z.boolean(),
    pinned: z.boolean(),
    tts: z.boolean(),
    type: z
      .number()
      .describe(
        'Message type: 0=default, 7=member-join, 19=reply, 20=app-command, etc.',
      ),
    flags: z
      .number()
      .describe(
        'Bitfield: 1=crossposted, 2=is-crosspost, 4=suppress-embeds, 64=ephemeral, etc.',
      ),
    nonce: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Client-generated dedupe key (echoed on send response)'),
    components: z
      .array(z.unknown())
      .optional()
      .describe('Interactive UI components (buttons, selects)'),
    sticker_items: z
      .array(
        z
          .object({
            id: z.string().describe('Sticker snowflake ID'),
            name: z.string(),
            format_type: z.number().describe('1=PNG, 2=APNG, 3=Lottie, 4=GIF'),
          })
          .passthrough(),
      )
      .optional()
      .describe('Stickers attached to the message (e.g., from greetChannel)'),
  })
  .passthrough();

export const ApplicationSchema = z
  .object({
    id: ApplicationIdParam,
    name: z.string(),
    icon: z.string().nullable(),
    description: z.string(),
    summary: z.string().optional(),
    type: z.number().nullable().optional(),
    hook: z.boolean().optional(),
    is_monetized: z.boolean().optional(),
    is_verified: z.boolean().optional(),
    is_discoverable: z.boolean().optional(),
    flags: z.number().optional(),
    storefront_available: z.boolean().optional(),
    verify_key: z.string().optional(),
  })
  .passthrough();

export const EntitlementSchema = z
  .object({
    id: z.string().describe('Entitlement snowflake ID'),
    type: z.number().describe('Entitlement type code'),
    sku_id: z.string().optional(),
    application_id: ApplicationIdParam.optional(),
    user_id: UserIdParam.optional(),
    deleted: z.boolean().optional(),
    starts_at: z.string().nullable().optional(),
    ends_at: z.string().nullable().optional(),
  })
  .passthrough();

export const GuildSchema = z
  .object({
    id: GuildIdParam,
    name: z.string(),
    icon: z.string().nullable().describe('Icon hash; null = default icon'),
    banner: z
      .string()
      .nullable()
      .optional()
      .describe('Banner image hash; null/absent = no banner'),
    owner: z.boolean().describe('True if the current user owns this guild'),
    permissions: z
      .string()
      .describe(
        'Current user permission bitfield as a decimal string (snowflake-sized)',
      ),
    features: z
      .array(z.string())
      .describe(
        'Enabled guild features (e.g., COMMUNITY, NEWS, BANNER, VANITY_URL)',
      ),
    approximate_member_count: z
      .number()
      .optional()
      .describe('Total member count; included only when withCounts=true'),
    approximate_presence_count: z
      .number()
      .optional()
      .describe('Online member count; included only when withCounts=true'),
  })
  .passthrough();

export const MutualGuildSchema = z
  .object({
    id: GuildIdParam,
    nick: z.string().nullable().optional(),
  })
  .passthrough();

export const GuildMemberSchema = z
  .object({
    user: UserSchema,
    nick: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Server-specific display name; null if using the global username',
      ),
    avatar: z
      .string()
      .nullable()
      .optional()
      .describe('Server-specific avatar hash; null if using global avatar'),
    roles: z
      .array(z.string())
      .describe('Role snowflake IDs the member holds in this guild'),
    joined_at: z
      .string()
      .describe('ISO 8601 timestamp the user joined the guild'),
    premium_since: z
      .string()
      .nullable()
      .optional()
      .describe(
        'ISO 8601 timestamp the user started boosting; null if not boosting',
      ),
    pending: z
      .boolean()
      .optional()
      .describe('True if the member has not completed membership screening'),
    communication_disabled_until: z
      .string()
      .nullable()
      .optional()
      .describe('ISO 8601 timeout end; null if not timed out'),
    flags: z.number().optional(),
  })
  .passthrough()
  .describe(
    'Guild-scoped member record. The nested user object holds the global identity (username, avatar); top-level fields are guild-specific (nick, roles, joined_at).',
  );

export const MemberListGroupSchema = z
  .object({
    id: z
      .string()
      .describe(
        'Group identifier: a role snowflake ID, "online", or "offline"',
      ),
    count: z
      .number()
      .describe(
        'Total members in this group across the entire guild (not just the requested range)',
      ),
  })
  .passthrough();

export const MemberListOpSchema = z
  .object({
    op: z
      .string()
      .describe(
        'Operation type: "SYNC" (initial range fill), "UPDATE", "INSERT", "DELETE", "INVALIDATE"',
      ),
    range: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe('[start, end] row indices this op covers (SYNC only)'),
    items: z
      .array(
        z
          .object({
            group: MemberListGroupSchema.optional().describe(
              'Present on group-header rows ("Admins — 5"); absent on member rows',
            ),
            member: GuildMemberSchema.optional().describe(
              'Present on member rows; absent on group-header rows',
            ),
          })
          .passthrough(),
      )
      .optional()
      .describe(
        'Rows in this op. Mix of group headers and member entries in display order.',
      ),
    item: z
      .object({
        group: MemberListGroupSchema.optional(),
        member: GuildMemberSchema.optional(),
      })
      .passthrough()
      .optional()
      .describe('Single row for INSERT/UPDATE ops'),
    index: z.number().optional().describe('Row index for INSERT/UPDATE/DELETE'),
  })
  .passthrough();

export const ConnectedAccountSchema = z
  .object({
    type: z
      .string()
      .describe('Provider: github, twitter, steam, spotify, etc.'),
    id: z.string(),
    name: z.string(),
    verified: z.boolean(),
  })
  .passthrough();

export const ChannelSchema = z
  .object({
    id: ChannelIdParam,
    type: z
      .number()
      .describe(
        '0=guild text, 1=DM, 2=guild voice, 3=group DM, 4=category, 5=announcement, 10/11/12=thread, 13=stage, 15=forum',
      ),
    name: z
      .string()
      .nullable()
      .optional()
      .describe('Channel name (null for DMs)'),
    guild_id: GuildIdParam.optional().describe(
      'Parent guild ID (absent for DMs/group DMs)',
    ),
    parent_id: ChannelIdParam.nullable()
      .optional()
      .describe('Category snowflake; null if top-level'),
    position: z.number().optional(),
    topic: z.string().nullable().optional(),
    nsfw: z.boolean().optional(),
    last_message_id: MessageIdParam.nullable().optional(),
    flags: z.number().optional(),
    recipients: z
      .array(UserSchema)
      .optional()
      .describe('DM/group-DM recipients (absent for guild channels)'),
  })
  .passthrough();

export const InviteSchema = z
  .object({
    code: z.string().describe('Invite code (the part after discord.gg/)'),
    type: z
      .number()
      .describe('0=guild invite, 1=group-DM invite, 2=friend invite'),
    inviter: UserSchema.optional(),
    guild: z
      .object({
        id: GuildIdParam,
        name: z.string(),
        icon: z.string().nullable(),
        features: z.array(z.string()),
        verification_level: z.number(),
        vanity_url_code: z.string().nullable(),
        nsfw_level: z.number(),
      })
      .passthrough()
      .optional()
      .describe('Partial guild metadata (absent for non-guild invites)'),
    guild_id: GuildIdParam.optional(),
    channel: z
      .object({
        id: ChannelIdParam,
        type: z.number(),
        name: z.string().nullable(),
      })
      .passthrough(),
    created_at: z.string().describe('ISO 8601 invite creation timestamp'),
    expires_at: z
      .string()
      .nullable()
      .describe('ISO 8601 expiry; null for never-expiring'),
    max_age: z.number().describe('Lifetime in seconds; 0 = never expires'),
    max_uses: z.number().describe('Max uses; 0 = unlimited'),
    uses: z.number().optional().describe('Current use count'),
    temporary: z
      .boolean()
      .describe(
        'If true, joiners are kicked when they disconnect unless they get a role',
      ),
  })
  .passthrough()
  .describe('A Discord invite. Public link is https://discord.gg/{code}.');

export const StickerSchema = z
  .object({
    id: z.string().describe('Sticker snowflake ID'),
    name: z.string(),
    description: z.string().nullable(),
    tags: z
      .string()
      .describe('Comma-separated tag list (used for autocomplete/search)'),
    type: z
      .number()
      .describe(
        '1=standard (Discord built-in pack), 2=guild (uploaded to a server)',
      ),
    format_type: z.number().describe('1=PNG, 2=APNG, 3=Lottie, 4=GIF'),
    pack_id: z
      .string()
      .optional()
      .describe('Sticker pack snowflake (standard stickers only)'),
    sort_value: z.number().optional(),
    asset: z
      .string()
      .optional()
      .describe('Legacy asset hash; usually empty string'),
    available: z.boolean().optional(),
    guild_id: GuildIdParam.optional().describe(
      'Owning guild (guild stickers only)',
    ),
  })
  .passthrough();

export const StickerPackSchema = z
  .object({
    id: z.string().describe('Pack snowflake ID'),
    sku_id: z.string().describe('Storefront SKU snowflake'),
    name: z.string(),
    description: z.string().nullable(),
    cover_sticker_id: z
      .string()
      .optional()
      .describe('Sticker shown as the pack thumbnail'),
    banner_asset_id: z.string().optional(),
    stickers: z.array(StickerSchema),
  })
  .passthrough();

export const IntegrationSchema = z
  .object({
    id: z.string().describe('Integration snowflake ID'),
    name: z.string(),
    type: z
      .string()
      .describe('Provider: discord (bot), twitch, youtube, guild_subscription'),
    enabled: z.boolean(),
    application: ApplicationSchema.optional().describe(
      'Linked application (bot integrations); included when include_applications=true',
    ),
    account: z
      .object({ id: z.string(), name: z.string() })
      .passthrough()
      .optional(),
    role_id: z
      .string()
      .optional()
      .describe('Role granted to subscribers (twitch/youtube)'),
    scopes: z
      .array(z.string())
      .optional()
      .describe('OAuth2 scopes granted to the integration'),
  })
  .passthrough();

export const GuildPowerupSchema = z
  .object({
    sku_id: z.string().describe('Powerup SKU snowflake'),
    listing_id: z.string().describe('Store listing snowflake'),
    quantity: z
      .number()
      .describe(
        'Number of times this powerup is currently active on the guild',
      ),
    ends_at: z
      .string()
      .nullable()
      .optional()
      .describe('ISO 8601 expiry; null for permanent'),
  })
  .passthrough();

export const StoreSkuListingSchema = z
  .object({
    id: z.string().describe('Listing snowflake ID'),
    summary: z.string().describe('Display name of the listing'),
    description: z.string(),
    sku: z
      .object({
        id: z.string().describe('SKU snowflake ID'),
        name: z.string(),
        type: z.number().describe('SKU type code (2 = durable item)'),
        application_id: ApplicationIdParam,
        slug: z.string(),
        flags: z.number(),
        access_type: z.number(),
        premium: z.boolean(),
        dependent_sku_id: z
          .string()
          .nullable()
          .optional()
          .describe('Required prerequisite SKU; null if standalone'),
      })
      .passthrough(),
    powerup_metadata: z
      .object({
        category_type: z.string().describe('"level" or "perk"'),
        static_image_url: z.string().optional(),
        animated_image_url: z.string().nullable().optional(),
        store_removal_date: z.string().nullable().optional(),
      })
      .passthrough()
      .optional()
      .describe('Powerup display metadata (perks/levels only)'),
    published: z.boolean(),
    benefits: z.array(z.unknown()),
  })
  .passthrough()
  .describe(
    'Published store SKU listing for guild powerups (server boost rewards). Use sku.id when constructing purchase flows.',
  );

export const PaymentSourceSchema = z
  .object({
    id: z.string().describe('Payment source snowflake ID'),
    type: z
      .number()
      .describe('Type code: 1=card, 2=paypal, 3=apple, 4=google, etc.'),
    invalid: z
      .boolean()
      .describe('True if the source has expired or been revoked'),
    flags: z.number().optional(),
    country: z.string().optional(),
    default: z.boolean().optional(),
    billing_address: z.unknown().optional(),
  })
  .passthrough();

export const SubscriptionSchema = z
  .object({
    id: z.string().describe('Subscription snowflake ID'),
    type: z
      .number()
      .describe('1=premium (Nitro), 2=premium-guild (boost), 3=application'),
    status: z
      .number()
      .describe(
        '0=unpaid, 1=active, 2=past_due, 3=cancelled, 4=ended, 5=inactive, 6=account_hold',
      ),
    current_period_start: z
      .string()
      .describe('ISO 8601 start of current billing period'),
    current_period_end: z
      .string()
      .describe('ISO 8601 end of current billing period'),
    canceled_at: z.string().nullable().optional(),
    items: z
      .array(
        z
          .object({
            id: z.string(),
            plan_id: z.string(),
            quantity: z.number(),
          })
          .passthrough(),
      )
      .optional(),
    payment_source_id: z.string().nullable().optional(),
    currency: z.string().optional(),
    trial_id: z.string().nullable().optional(),
  })
  .passthrough();

export const UserProfileSchema = z
  .object({
    user: UserSchema,
    connected_accounts: z.array(ConnectedAccountSchema),
    premium_type: z.number().nullable(),
    premium_since: z.string().nullable(),
    premium_guild_since: z.string().nullable(),
    badges: z
      .array(z.unknown())
      .describe('User badge objects (HypeSquad, Active Developer, etc.)'),
    guild_badges: z.array(z.unknown()).optional(),
    mutual_guilds: z.array(MutualGuildSchema).optional(),
    mutual_friends_count: z.number().optional(),
    user_profile: z
      .unknown()
      .optional()
      .describe('Profile customization (bio, theme colors, banner)'),
  })
  .passthrough();

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract Discord auth token and identify the signed-in account (userId, username, global name)',
  notes:
    'Call FIRST, before any other Discord function. REQUIRES surface: "desktop" | "browser" — the caller must have already asked the user (or read it from workspace memory) and created the matching executor. The library refuses to guess; mismatched surface throws with a clear remediation message. On success it caches the token internally — every subsequent function reads it automatically; do NOT thread the returned token through subsequent calls. The returned `username` and `globalName` are authoritative — use them to name the account to the user, do NOT infer the account from `userId` alone. Do NOT read localStorage.token, walk webpack, or scrape /api/v9 requests with CDP — getContext does all of that internally and is hardened against Discord\'s anti-paste protections.',
  input: z.object({
    surface: z
      .enum(['desktop', 'browser'])
      .describe(
        'REQUIRED. The Discord surface the executor was opened against. Obtain by reading workspace memory ("discordSurface") or by asking the user. The library refuses to start without this so the agent cannot silently default; mismatched values (e.g., surface="desktop" but the executor opened a browser tab) throw a clear error.',
      ),
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: z.object({
    token: z
      .string()
      .describe('Auth token; cached internally — do not thread to other calls'),
    userId: UserIdParam,
    username: z
      .string()
      .describe(
        'Discord account username (unique handle, e.g. "god_holytriangle"). Authoritative — use this to identify which of the user\'s accounts is signed in rather than inferring from userId.',
      ),
    globalName: z
      .string()
      .nullable()
      .describe(
        'Display name shown across Discord (e.g. "lemons"). Null if the account has not set a display name. Prefer this when addressing the user; fall back to username.',
      ),
    surface: z
      .enum(['desktop', 'browser'])
      .describe('Confirmed surface the executor is attached to'),
  }),
};

// ============================================================================
// Surface Preference
// ============================================================================

export const getSurfacePreferenceSchema = {
  name: 'getSurfacePreference',
  description:
    "Inspect the runtime surface (desktop vs browser) and the user's saved preference",
  notes:
    'Call this in-page once an executor exists if you want to verify the surface matches the user\'s saved choice. The CANONICAL preference lives in the agent\'s workspace memory under "discordSurface" — check that BEFORE createExecutor. This in-page localStorage copy is only a same-browser fallback. preference=null means the user has not been asked yet and must be.',
  input: z.object({}),
  output: z.object({
    preference: z
      .enum(['desktop', 'browser'])
      .nullable()
      .describe(
        'Saved preference, or null if the user has never been asked on this browser profile. Null = ask the user.',
      ),
    surface: z
      .enum(['desktop', 'browser'])
      .describe(
        'Surface the current executor is actually attached to, independent of preference.',
      ),
  }),
};

export const setSurfacePreferenceSchema = {
  name: 'setSurfacePreference',
  description:
    'Persist the user-chosen surface (desktop or browser) at discord.com',
  notes:
    'Call right after asking the user. Persists at discord.com localStorage (same browser profile only). The agent MUST ALSO write the same value to its workspace memory under "discordSurface" — workspace memory is the canonical record; this call is the same-browser fallback.',
  input: z.object({
    surface: z
      .enum(['desktop', 'browser'])
      .describe(
        '"desktop" = Discord desktop app via attached mode. "browser" = plain web tab on discord.com.',
      ),
  }),
  output: z.object({
    surface: z.enum(['desktop', 'browser']),
  }),
};

export const selectChannelSchema = {
  name: 'selectChannel',
  description:
    'Navigate the Discord client to a guild channel via SPA routing (no full-page reload)',
  notes:
    "**Always use this instead of `window.location.href = ...` for any in-Discord navigation before calling createDMDesktop.** Routes through Discord's own NavigationUtils.transitionTo (sidebar-click equivalent) — falls back to history.pushState + Flux CHANNEL_SELECT dispatch if the router function isn't located. The fetch hook installed by getContext() survives because no full-page reload occurs; Discord then fires its full channel-mount telemetry batch (channel_opened, guild_viewed, settings-proto/2 sync, entitlements GET, sticker bar GET) into a context that's actually observing it, which is what populates the science capture state that createDMDesktop's popout sequence needs. A `window.location.href = ...` navigation wipes the hook, leaves the science state cold, and produces the orphan channels-POST pattern Discord's anti-abuse pipeline uses to identify cold-DM bots. Returns when navigation is done and React has had ~600ms to mount the channel; callers can then proceed directly. Best-effort: never throws on the navigation itself, but throws if FluxDispatcher can't be located (the session is too broken to do anything meaningful).",
  input: z.object({
    guildId: GuildIdParam.describe(
      'Guild snowflake the channel belongs to. The URL becomes /channels/{guildId}/{channelId}.',
    ),
    channelId: ChannelIdParam.describe(
      'Channel snowflake to navigate to. Must be a channel the current user can see.',
    ),
  }),
  output: z.object({}).describe('Empty object on success; throws on failure.'),
};

// ============================================================================
// Messages
// ============================================================================

export const listMessagesSchema = {
  name: 'listMessages',
  description: 'List recent messages in a channel, newest first',
  notes:
    'The only correct way to read channel history. Do NOT query `li[class*="messageListItem"]` or any DOM selector to extract messages — the DOM only holds the rendered window (~10 items) and authors/timestamps come back smushed together. Cursor pagination via "before" (oldest snowflake from the previous page). Discord caps "limit" at 100.',
  input: z.object({
    token: TokenParam,
    channelId: ChannelIdParam,
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe('Max messages to return (1–100, default 50)'),
    before: MessageIdParam.optional().describe(
      'Snowflake; return messages older than this. Omit for the newest page.',
    ),
  }),
  output: z.object({
    messages: z.array(MessageSchema).describe('Newest first'),
    oldestId: MessageIdParam.nullable().describe(
      'Snowflake of the oldest message in this page. Pass as "before" to fetch the next page. Null if empty.',
    ),
  }),
};

export const sendMessageSchema = {
  name: 'sendMessage',
  description: 'Send a plain-text message to a channel',
  notes:
    "The REST send path. Use for: guild channels, group DMs, and DMs with friends. **As of 2026-05-18 this function refuses sends to a non-friend 1:1 DM** — REST `sendMessage` to a non-friend reliably gets accounts suspended even when the DM has prior message history (the May-2026 review's earlier \"warm DMs are safe via REST\" finding was overturned by fresh suspension reports). Non-friend DM sends must go through `sendMessageDesktopDOM` instead, which drives Discord's composer so the messages POST is emitted by Discord's React handler. The refusal surfaces here as: `Refusing sendMessage on channel <id>: this DM is with a non-friend (user <uid>). ...` — pointing the agent at `sendMessageDesktopDOM`.\n\nDo NOT type into Discord's contenteditable via execCommand, do NOT dispatch synthetic KeyboardEvents with key=\"Enter\", do NOT call React fiber onKeyDown handlers, do NOT click a \"Send Message\" button — Discord's editor swallows synthetic input events and there is no send button in the desktop voice-channel-open layout. Destructive: confirm with the user before sending. Attachment upload is not yet supported. **DM channel ids MUST come from a current-run `createDMFriend` or `createDMDesktopDOM` call** — do NOT use a channel id parsed from the executor's landing URL (e.g. /channels/@me/<id>); that's whichever DM Discord auto-opened, not necessarily the intended recipient, and has silently sent messages to the wrong person. Guild-channel sends are unaffected by the non-friend rule.",
  input: z.object({
    token: TokenParam,
    channelId: ChannelIdParam,
    content: z
      .string()
      .min(1)
      .max(2000)
      .describe('Message body (markdown supported, max 2000 chars)'),
    tts: z
      .boolean()
      .optional()
      .default(false)
      .describe('Send as text-to-speech'),
    flags: z
      .number()
      .optional()
      .default(0)
      .describe('Message flags bitfield (default 0)'),
    nonce: z
      .string()
      .optional()
      .describe('Client-generated dedupe key. Auto-generated if omitted.'),
  }),
  output: MessageSchema,
};

export const sendTypingSchema = {
  name: 'sendTyping',
  description: 'Show the "typing…" indicator in a channel for ~10s',
  notes: '',
  input: z.object({
    token: TokenParam,
    channelId: ChannelIdParam,
  }),
  output: z.object({
    ok: z.literal(true),
  }),
};

export const greetChannelSchema = {
  name: 'greetChannel',
  description:
    'Send a sticker "wave" greeting in a DM channel (the icebreaker prompt Discord shows on never-spoken-in DMs)',
  notes:
    'Destructive: confirm with the user before sending. Discord enforces hCaptcha on this endpoint for accounts in poor standing or new DMs — a 400 with `captcha_key: ["captcha-required"]` is surfaced verbatim in the thrown error and indicates the user must solve a captcha in the Discord UI before retrying. The Wave sticker ID is "749054660769218631". The channelId MUST come from a current-run createDMFriend or createDMDesktop call — do NOT pass a channel id from the executor\'s landing URL.',
  input: z.object({
    token: TokenParam,
    channelId: ChannelIdParam.describe('DM channel snowflake ID'),
    stickerIds: z
      .array(z.string().regex(SnowflakeRegex))
      .min(1)
      .describe(
        'Sticker snowflake IDs to send. Discord typically expects exactly one (e.g., the built-in Wave sticker "749054660769218631").',
      ),
  }),
  output: MessageSchema,
};

export const createDMFriendSchema = {
  name: 'createDMFriend',
  description:
    'Open (or fetch the existing) DM channel with a friend (verified against the friend roster before opening)',
  notes:
    '**Prefer this whenever the recipient is on the friend roster, regardless of surface (desktop or browser).** Runs the friend check unconditionally — both surfaces — by calling listRelationships({type: 1}) and throwing `Refusing to open DM via createDMFriend: <id> is not a friend` if any recipient is missing. The function name signals the agent\'s intent ("I expect this to be a friend"); the library enforces it so a typo / stale id surfaces as a clean error instead of an at-risk DM. There is no override. For a cold DM to a non-friend on desktop, use `createDMDesktop({source: { type: "guild_message_avatar", ... }})` — that\'s the only correct path when the recipient was discovered via guild messages and is not yet a friend. Idempotent: if a DM already exists, Discord returns the existing channel — no new channel is created. Pass a single userId for a 1:1 DM, or 2+ for a group DM (current user implicit). Use the returned channel.id with sendMessage.',
  input: z.object({
    token: TokenParam,
    recipients: z
      .array(UserIdParam)
      .min(1)
      .max(9)
      .describe(
        "Other user snowflake IDs (1 for DM; 2–9 for group DM, current user implicit). Every recipient must be on the current user's friend roster — the function throws before issuing any POST if any are missing.",
      ),
  }),
  output: ChannelSchema.describe(
    'DM channel object: { id, type:1 (DM) or 3 (group DM), recipients, last_message_id }',
  ),
};

// ============================================================================
// COMMENTED OUT — createDMDesktopSchema and its source sub-schemas.
//
// The `createDMDesktop` function itself (in messages/index.ts) is disabled
// and the agent should never see it as a callable tool, so we also remove
// the schema from the agent-visible registry by commenting out this whole
// block + the entry in `allSchemas` + the CreateDMDesktopInput/Output type
// exports below. The shape is preserved here verbatim so a future maintainer
// reviving the function can uncomment the block and the registry entry in a
// single change.
//
// Why revival is unlikely: the suspension issue that disabled createDMDesktop
// is a property of "we are the ones issuing the API calls," not of "our HAR
// replay was imperfect." Matching the request shape per call doesn't beat the
// classifier's aggregate cold-DM-volume heuristic. The replacement,
// createDMDesktopDOM, ceded emission to Discord's own React handlers via
// simulated DOM events — that's what worked. If a future redesign changes
// Discord's anti-abuse model and API-side replay becomes viable again, this
// block is the starting point.
// ============================================================================
/* REVIVABLE STUB — uncomment in tandem with the allSchemas entry, the type
   exports below, the function in messages/index.ts, and the barrel exports
   in libs/discord/index.ts.

// `source` discriminator. Encodes WHICH UI flow the agent is simulating — the
// telemetry trail, dwell behavior, and page-URL precondition all depend on it,
// so the type system forces the agent to declare it explicitly. Each variant
// requires exactly the fields the corresponding HAR sequence needs; partial
// states (e.g. guildId without messageId) are unrepresentable.
const guildMessageAvatarSourceSchema = z
  .object({
    type: z.literal('guild_message_avatar'),
    guildId: GuildIdParam.describe(
      'Guild the source channel belongs to. Appended as `&guild_id={id}` on the profile GET and set as `guild_id` + `is_guild_profile: true` on the science events. The page must currently be on `/channels/{guildId}/{channelId}` before calling — the runtime checks `window.location.pathname` and refuses to proceed if it disagrees, since a mismatched referer is the loudest single fingerprint contradiction the May-2026 review identified.',
    ),
    channelId: ChannelIdParam.describe(
      'Source guild channel the avatar was clicked in. Set as `channel_id` on the ack_messages, VIEW, and SEND_DIRECT_MESSAGE science events. Must be the channel you just read messages from with listMessages — `listMessages` is the only well-known way to obtain a guild channel id + a real message author id without admin permissions.',
    ),
    messageId: MessageIdParam.describe(
      'Message id whose author avatar was clicked. Set as `source_message_id` on the VIEW + SEND_DIRECT_MESSAGE events. Must be the snowflake of an actual message returned by listMessages on the same `channelId` — Discord cross-references this against the popout-VIEW trail in anti-abuse scoring. Picking a synthetic id (or a message from a different channel) is a direct tell.',
    ),
  })
  .describe(
    'The canonical full-fidelity flow. Simulates clicking the avatar attached to a specific message in a guild channel. This is the only variant that emits the complete HAR sequence (ack_messages, VIEW with source_message_id, SEND_DIRECT_MESSAGE, batched dm_list_viewed+channel_opened, supplemental-data) — every other variant maps to a shorter, less-loaded UI path. Choose this whenever the recipient was discovered via listMessages on a guild channel.',
  );

const dmListSourceSchema = z
  .object({ type: z.literal('dm_list') })
  .describe(
    "Existing-DM-rail flow. Simulates clicking a user in your DM sidebar — the popout opens with no `source_message_id`, no `guild_id` context, and the channels POST is essentially a no-op since the DM already exists. Use this only when the recipient is already in the agent's DM list and there is no relevant source channel; the HAR is shorter than the guild_message_avatar flow and the classifier scores it as a less-suspicious interaction.",
  );

const friendsListSourceSchema = z
  .object({ type: z.literal('friends_list') })
  .describe(
    'Friends-list flow. Simulates clicking a user in the Friends tab. No guild context, no source message, the popout VIEW carries `location_stack: ["user profile popout"]` (without the "avatar" prefix). Use only when the recipient is on the friend roster and there is no other natural source flow.',
  );

const groupButtonSourceSchema = z
  .object({ type: z.literal('group_button') })
  .describe(
    'Group DM creation flow. Simulates the "+" button → invitee multi-select → "Create DM". No popout choreography at all — just the channels POST. Required for `recipients.length >= 2`; refused for 1-recipient calls because the desktop client never goes through this flow to open a 1:1 DM.',
  );

const createDMDesktopSourceSchema = z
  .discriminatedUnion('type', [
    guildMessageAvatarSourceSchema,
    dmListSourceSchema,
    friendsListSourceSchema,
    groupButtonSourceSchema,
  ])
  .describe(
    'The UI flow the agent is simulating. Encodes which HAR-step set the library runs and which preconditions it enforces. Every variant maps to a real Discord client interaction; no variant is "no opinion" — pick the one that best matches how the agent obtained the recipient.',
  );

export const createDMDesktopSchema = {
  name: 'createDMDesktop',
  description:
    'Open (or fetch the existing) DM channel with another user — desktop-surface only',
  notes:
    '**Desktop surface only.** Throws if `getContext()` resolved to "browser". Use this when the recipient is NOT on the friend roster (`createDMFriend` would refuse those) and you want the full HAR-fidelity cold-DM trail. If the recipient IS a friend, prefer `createDMFriend` — it\'s faster and emits the matching friend-DM telemetry shape.\n\n**`firstMessage` is REQUIRED for `source.type="guild_message_avatar"`** (the cold-DM path). The library sends the first message ATOMICALLY inside the same flow, at the HAR-correct timing (~788ms after the channels POST, after the composer-mount GETs). Sending the first message in a SEPARATE call after `createDMDesktop` returns is the dominant cold-DM ban signal: the channels POST goes through but the surrounding telemetry (SEND_DIRECT_MESSAGE science, dm_list_viewed, channel_opened) lands seconds before the message POST instead of around it, producing an orphan-message pattern. The library will refuse the call if `firstMessage` is missing for this variant.\n\n**Page navigation:** the page must be on `/channels/{guildId}/{channelId}` for the `guild_message_avatar` variant. If it isn\'t, the library auto-navigates via `selectChannel(guildId, channelId)` (SPA routing through Discord\'s own router — preserves the fetch hook and lets Discord fire its real channel-mount telemetry batch). **NEVER use `window.location.href = ...` to navigate before this call** — that\'s a full-page reload, wipes the fetch hook, and causes Discord to fire its post-mount science batch in a hook-less context. Either call `selectChannel` yourself first, or let `createDMDesktop` do it.\n\nHAR sequence executed for `guild_message_avatar`: `ack_messages` (source channel) → profile GET → `/users/@me/notes/{id}` GET → `user_profile_action VIEW` (full guild + channel context, profile_session_id, source_message_id, num_mutual_*, profile_badges) → ~3s popout dwell → POST `/users/@me/channels` → `user_profile_action SEND_DIRECT_MESSAGE` (same `profile_session_id` as VIEW) → `/channels/{id}/messages?limit=10` → `/users/@me/entitlements?entitlement_type=11` → `/sticker-packs/847199849233514549` → `/users/@me/message-requests/supplemental-data` → **POST `/channels/{id}/messages` (the first message)** → batched `dm_list_viewed` + `channel_opened` science → supplemental-data polls. **~5–7s wall-clock.**\n\nA real `/api/v9/science` POST must be observed by the fetch hook before the popout sequence; the library auto-provokes one via FluxDispatcher (WINDOW_FOCUS + TRACK) if cold, then waits up to 5s. Throws fast with remediation if capture still fails. Returns `{ channel, sentMessage }` — `sentMessage` is populated when `firstMessage` was provided, undefined otherwise. Idempotent on the channel: if a DM already exists, Discord returns the existing channel and the first message is appended to it.',
  input: z
    .object({
      token: TokenParam,
      recipients: z
        .array(UserIdParam)
        .min(1)
        .max(9)
        .describe(
          'Other user snowflake IDs (1 for 1:1 DM; 2–9 for group DM, current user implicit). Length is cross-validated against `source.type` — 1 for every variant except `group_button`, which requires 2–9.',
        ),
      source: createDMDesktopSourceSchema,
      firstMessage: z
        .string()
        .min(1)
        .max(2000)
        .optional()
        .describe(
          'First message body to send atomically inside the same flow as the DM open. **REQUIRED for `source.type="guild_message_avatar"`** — the cold-DM HAR has the message POST ~788ms after the channels POST, inside the same UI session; sending in a separate call later is the dominant anti-abuse signal. Optional for `dm_list` / `friends_list` / `group_button` (those variants are typically used to fetch existing DM channels, not cold-message strangers).',
        ),
    })
    .superRefine((data, ctx) => {
      const isGroup = data.source.type === 'group_button';
      const isGuildAvatar = data.source.type === 'guild_message_avatar';
      if (isGroup && data.recipients.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recipients'],
          message:
            'source.type="group_button" requires at least 2 recipients. Use one of the 1:1 variants (guild_message_avatar / dm_list / friends_list) for a single-recipient DM.',
        });
      }
      if (!isGroup && data.recipients.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recipients'],
          message: `source.type="${data.source.type}" is a 1:1-DM flow and requires exactly 1 recipient (got ${data.recipients.length}). Use source.type="group_button" for ≥2-recipient calls.`,
        });
      }
      if (isGuildAvatar && data.firstMessage === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['firstMessage'],
          message:
            'source.type="guild_message_avatar" requires `firstMessage` — the cold-DM HAR has the first message POST inside the same flow as the DM open. Sending in a separate sendMessage call after createDMDesktop returns leaves the channels-POST orphaned (no surrounding telemetry), which is the dominant anti-abuse signal Discord uses for cold-DM bot detection.',
        });
      }
    }),
  output: z
    .object({
      channel: ChannelSchema.describe(
        'DM channel object: { id, type:1 (DM) or 3 (group DM), recipients, last_message_id }',
      ),
      sentMessage: MessageSchema.optional().describe(
        'The first message that was sent atomically, if `firstMessage` was provided; otherwise undefined.',
      ),
    })
    .describe(
      'Channel + optionally the first message sent inside the same flow.',
    ),
};

   end REVIVABLE STUB */

export const createDMDesktopDOMSchema = {
  name: 'createDMDesktopDOM',
  description:
    'Open a brand-new DM channel with a non-friend by driving Discord\'s own UI — clicks the avatar in a guild message, then the popout\'s "Message" button, then types and sends the first message. No direct REST calls.',
  notes:
    '**Desktop surface only. Refuses if a DM with the target user already exists** (the desktop client would just navigate to the existing channel in that case, not re-run the popout flow — replaying the popout sequence on an already-open DM is itself a discriminative signal). Use `sendMessage` on the existing channel id instead.\n\n**This function does NOT call the Discord REST API directly.** Every request to `/api/v9/*` is emitted by Discord\'s OWN React handlers in response to simulated DOM events — meaning the entire HAR sequence (profile GET, notes GET, popout VIEW science, channels POST, SEND_DIRECT_MESSAGE science, composer-mount entitlements/sticker-packs/supplemental-data, message POST, batched dm_list_viewed+channel_opened, post-send supplemental-data polls) is generated by Discord\'s own bundle. The `x-context-properties` header, `location_stack`, `profile_session_id`, fingerprint headers, and timing are all whatever Discord\'s client decided to emit, not what we constructed. Functionally this is the closest "ungameable" approximation of "a real user clicked through": anti-abuse sees identical request shapes to a hand-typed cold DM because they ARE the request shapes of a hand-typed cold DM.\n\n**The price is fragility.** This function depends on Discord\'s DOM class-name shape (`[class*="userPopoutOuter_"]`, `[role="textbox"][data-slate-editor="true"]`, message-element id `chat-messages-{channelId}-{messageId}`) and on its Flux store layout (`PrivateChannelStore.getDMFromUserId`, `ChannelStore.getChannel`). A Discord client redesign can break any of these without changing the REST API — when that happens, expect this function to throw with a "could not find <X>" diagnostic, and either patch the selectors or fall back to `createDMDesktop` (which is currently disabled — see its banner — but trades a different set of risks).\n\nFlow:\n  1. Surface guard (must be desktop).\n  2. Pre-existing-DM check via `PrivateChannelStore` / `ChannelStore` — refuse with a clear error if a DM already exists.\n  3. SPA-navigate to `/channels/{guildId}/{channelId}` via `selectChannel` if not already there.\n  4. Wait for the source message element to mount (`#chat-messages-{channelId}-{messageId}`).\n  5. Scroll into view, dispatch a real `click` on the message-author avatar inside that element. Discord\'s React handler opens the popout.\n  6. Wait for the popout DOM (`[class*="userPopout"]`) to render. ~3s human-natural dwell.\n  7. Find and click the "Message" button inside the popout. Discord\'s React handler fires the channels POST and navigates the route to `/channels/@me/{newDmId}`.\n  8. Wait for the URL to switch.\n  9. Read the new Channel object from Flux `ChannelStore.getChannel(newDmId)`.\n  10. Wait for the composer (`[role="textbox"][data-slate-editor="true"]`) to mount, paste `firstMessage` via a synthetic `ClipboardEvent`, dispatch Enter. Discord\'s React composer fires the message POST.\n  11. Best-effort read of the resulting message from Flux `MessageStore`.\n\nReturns `{ channel, sentMessage }`. `sentMessage` is best-effort: undefined if MessageStore hasn\'t observed the optimistic insert within ~1.5s. Total wall-clock: **~7–10s** (the ~3s popout dwell is intentional and must NOT be tuned down — sub-second popout-to-click is the loudest single tell in the May-2026 review).\n\n**Schema constraint:** `userId` MUST be the same user whose avatar appears on `messageId` in `channelId`. The function locates the avatar by walking down from the message element, so if `messageId` was authored by someone else there is no avatar for `userId` to click and the function throws. Pick a `messageId` returned by `listMessages({channelId})` whose `author.id === userId`.',
  input: z.object({
    userId: UserIdParam.describe(
      'Snowflake of the user to DM. Must be the author of `messageId` in `channelId` — the function clicks the avatar embedded in that specific rendered message. If the user is on the friend roster the call still works, but prefer `createDMFriend` (no popout dwell, no fragility on Discord DOM shape).',
    ),
    guildId: GuildIdParam.describe(
      "Guild snowflake the source channel belongs to. The function ensures `window.location.pathname === /channels/{guildId}/{channelId}` before clicking; if it isn't, it calls `selectChannel` first.",
    ),
    channelId: ChannelIdParam.describe(
      'Guild channel snowflake where the source message is rendered. Must be a channel the current user can read.',
    ),
    messageId: MessageIdParam.describe(
      "Message snowflake whose author avatar will be clicked. Must be a message currently rendered in the source channel's viewport — the function scrolls it into view via `element.scrollIntoView`, but the element must exist in the DOM (which means it must be inside the recent-history window the channel currently has loaded; for older messages, `listMessages` + scroll-up the UI manually first, then call this).",
    ),
    firstMessage: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        "First message body to send. Required — a popout-VIEW → channels-POST trail with no following message is the same orphan-message pattern that gets cold-DMs flagged. The function pastes this into the composer and dispatches Enter; Discord's own React handler emits the message POST with the natural context-properties + composer-mount sequence wrapped around it.",
      ),
  }),
  output: z
    .object({
      channel: ChannelSchema.describe(
        'DM channel object as read from Flux ChannelStore after the route switch. `type` is 1 (DM).',
      ),
      sentMessage: MessageSchema.optional().describe(
        "First message as read from Flux MessageStore, best-effort. May be undefined if the optimistic insert wasn't observed within ~1.5s — call `listMessages({channelId})` on the returned channel to verify if needed.",
      ),
    })
    .describe(
      'The newly-created DM channel and (best-effort) the first message that was sent inside the same flow.',
    ),
};

export const sendMessageDesktopDOMSchema = {
  name: 'sendMessageDesktopDOM',
  description:
    "Send a message to a DM channel by driving Discord's own composer — focuses the composer, pastes the content via a synthetic ClipboardEvent, dispatches Enter. Discord's React handler fires the messages POST. Desktop surface only. Required (not optional) for non-friend DMs as of 2026-05-18.",
  notes:
    '**Use this for ALL sends to a non-friend DM, not just the first one.** Companion to `createDMDesktopDOM`: that function opens a non-friend DM and sends the first message via Discord\'s React handlers; `sendMessageDesktopDOM` continues the same provenance story for every subsequent message in that channel. As of 2026-05-18, REST `sendMessage` to a non-friend DM reliably gets accounts suspended even when the channel has prior message history — the May-2026 review\'s earlier "warm DMs are safe via REST" assessment was overturned by fresh suspension reports, and the `ensureRestSendSafe` gate in `sendMessage` now refuses non-friend DM REST sends and routes the agent here.\n\n**Desktop surface only.** Browser Discord has different DOM class-name conventions and this function has not been audited against the web HAR. Refuses on browser with a clear diagnostic. For browser sessions targeting a non-friend, there is no supported path — friend them first via `addFriendById`, or switch to desktop.\n\n**Friend DMs and guild channels do not require this function.** REST `sendMessage` is safe for friends (per `createDMFriend`\'s own API-replay precedent) and for any non-DM channel (guild text, group DM, thread, etc.). Use this for non-friend 1:1 DMs.\n\nFlow:\n  1. Surface guard (must be desktop).\n  2. SPA-navigate to `/channels/@me/{channelId}` via `selectChannel` if not already there. Never `window.location.href` — wipes the fetch hook.\n  3. Wait for the Slate composer (`[role="textbox"][data-slate-editor="true"]`) to mount.\n  4. Focus the composer (emits composer-mount telemetry).\n  5. Paste `content` via synthetic ClipboardEvent (Slate-compatible).\n  6. ~600ms dwell.\n  7. Dispatch Enter — Discord\'s composer handler fires the messages POST with `X-Context-Properties: chat_input`, fingerprint headers, and nonce, all emitted by Discord\'s bundle.\n  8. Best-effort read of the optimistically-inserted message from Flux `MessageStore`.\n\n**Wall-clock: ~3–5s** (faster than `createDMDesktopDOM` — no popout dwell, no avatar choreography). `sentMessage` is best-effort: undefined if MessageStore hasn\'t observed the optimistic insert within ~1.5s.\n\n**Fragility:** depends on the same DOM and Flux shape as `createDMDesktopDOM` (composer selector, MessageStore via webpack walk). A Discord redesign breaks this without changing the REST API; expect a "Timed out after Yms waiting for selector" or "Could not find <X>" diagnostic, and flag the breakage rather than improvising fallbacks.',
  input: z.object({
    token: TokenParam,
    channelId: ChannelIdParam.describe(
      "DM channel snowflake. The function navigates to `/channels/@me/{channelId}` via SPA routing if the page isn't already there. Must be a 1:1 DM the current user can access; the function does not validate channel type itself (a guild channel id will still drive the guild composer, which is not the intended use).",
    ),
    content: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        "Message body. Pasted into the composer via synthetic ClipboardEvent; markdown is rendered by Discord's composer exactly as if typed.",
      ),
  }),
  output: z
    .object({
      sentMessage: MessageSchema.optional().describe(
        "Message as read from Flux MessageStore after the optimistic insert, best-effort. May be undefined if MessageStore wasn't observed within ~1.5s — call `listMessages({channelId})` to verify if needed.",
      ),
    })
    .describe(
      "The (best-effort) message that was sent. The actual messages POST was emitted by Discord's own React handler, not by this library.",
    ),
};

export const getStickerSchema = {
  name: 'getSticker',
  description: 'Get metadata for a Discord sticker by ID',
  notes:
    'Works for both standard (Discord pack) and guild stickers. Use the returned id with greetChannel or message attachments. The returned `pack_id` (standard stickers only) feeds getStickerPack to enumerate siblings.',
  input: z.object({
    token: TokenParam,
    stickerId: z
      .string()
      .regex(SnowflakeRegex)
      .describe('Sticker snowflake ID'),
  }),
  output: StickerSchema,
};

export const getStickerPackSchema = {
  name: 'getStickerPack',
  description: 'Get a sticker pack and all stickers it contains',
  notes:
    'Use to enumerate stickers in a pack so you can pick one for greetChannel. The built-in "Wumpus Beyond" pack ("847199849233514549") contains the Wave sticker ("749054660769218631") used as the default greet sticker.',
  input: z.object({
    token: TokenParam,
    packId: z
      .string()
      .regex(SnowflakeRegex)
      .describe('Sticker pack snowflake ID'),
    countryCode: z
      .string()
      .optional()
      .default('US')
      .describe('ISO 3166-1 alpha-2 country (affects pricing display only)'),
  }),
  output: StickerPackSchema,
};

export const markChannelReadSchema = {
  name: 'markChannelRead',
  description: 'Mark a channel as read up to a specific message',
  notes:
    'Each ack returns a token used to chain the next call; the implementation caches it per channel automatically. Pass "ackToken" only to override the cached value.',
  input: z.object({
    token: TokenParam,
    channelId: ChannelIdParam,
    messageId: MessageIdParam.describe(
      'Mark messages up to and including this ID as read',
    ),
    ackToken: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Optional override for the cached ack token from a previous call',
      ),
  }),
  output: z.object({
    ackToken: z
      .string()
      .nullable()
      .describe('Returned ack token; cached internally for the next call'),
  }),
};

// ============================================================================
// Guilds
// ============================================================================

export const listGuildsSchema = {
  name: 'listGuilds',
  description: 'List all guilds (servers) the current user is a member of',
  notes:
    'Returns partial guild objects (id, name, icon, owner, permissions, features). Auto-paginated; no cursor handling needed by the caller.',
  input: z.object({
    token: TokenParam,
    withCounts: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Include approximate_member_count and approximate_presence_count on each guild',
      ),
  }),
  output: z.object({
    guilds: z.array(GuildSchema),
  }),
};

export const listGuildMembersSchema = {
  name: 'listGuildMembers',
  description:
    'List members of a guild via the gateway sidebar lazy-load (Op 14)',
  notes:
    'Returns the full roster on small guilds (under ~25k members). Returns a partial / online-only slice on community/verified guilds — partialResult will be true and totalRows will be less than the sum of group counts. For "find a specific person" on a verified guild, prefer searchGuildMembers. Each range covers up to 100 sidebar rows; default is [[0,99]].',
  input: z.object({
    token: TokenParam,
    guildId: GuildIdParam,
    channelId: ChannelIdParam.optional().describe(
      'Channel to anchor the member-list view on. Discord groups members by visibility per-channel. Defaults to the first text channel the user can see in the guild.',
    ),
    ranges: z
      .array(z.tuple([z.number().int().min(0), z.number().int().min(0)]))
      .optional()
      .describe(
        'Row index ranges as [start, end] pairs. Default [[0, 99]]. Each range covers up to 100 rows.',
      ),
  }),
  output: z.object({
    groups: z
      .array(MemberListGroupSchema)
      .describe(
        'Group breakdown across the entire guild (online, offline, or per-role hoist groups)',
      ),
    ops: z
      .array(MemberListOpSchema)
      .describe('Raw ops as returned by the GUILD_MEMBER_LIST_UPDATE dispatch'),
    members: z
      .array(GuildMemberSchema)
      .describe('Member rows extracted from ops, deduplicated by user.id'),
    totalRows: z
      .number()
      .describe(
        'Number of member rows actually returned (excludes group headers)',
      ),
    memberCount: z
      .number()
      .nullable()
      .describe('Total members in the guild per Discord; null if not provided'),
    onlineCount: z
      .number()
      .nullable()
      .describe('Total online members per Discord; null if not provided'),
    partialResult: z
      .boolean()
      .describe(
        'True if totalRows is less than the sum of group counts — typical on community/verified guilds where Discord caps the lazy-load response',
      ),
  }),
};

export const createGuildSchema = {
  name: 'createGuild',
  description: 'Create a new guild (server) owned by the current user',
  notes:
    'Destructive: confirm with the user before creating. Discord caps users at 200 owned guilds. The guildTemplateCode "2TffvPucqHkN" is the default "Create My Own" template the official client uses; pass a community template code (e.g., from a discord.new link) to clone its channel layout. Channels and systemChannelId override the template and are usually omitted.',
  input: z.object({
    token: TokenParam,
    name: z.string().min(2).max(100).describe('Server name (2–100 chars)'),
    icon: z
      .string()
      .nullable()
      .optional()
      .default(null)
      .describe(
        'Base64-encoded data URI for the icon (e.g., "data:image/png;base64,..."); null for no icon',
      ),
    guildTemplateCode: z
      .string()
      .optional()
      .default('2TffvPucqHkN')
      .describe(
        'Template code; defaults to Discord\'s "Create My Own" template',
      ),
    channels: z
      .array(z.unknown())
      .optional()
      .default([])
      .describe("Initial channel layout; omit to use the template's default"),
    systemChannelId: z
      .string()
      .nullable()
      .optional()
      .default(null)
      .describe(
        'Channel snowflake to receive system messages; null lets Discord pick',
      ),
  }),
  output: GuildSchema.describe(
    'Full guild object including owner_id, system_channel_id, default @everyone role, and feature list',
  ),
};

export const listGuildIntegrationsSchema = {
  name: 'listGuildIntegrations',
  description:
    'List third-party integrations installed on a guild (bots, Twitch/YouTube subscribers, etc.)',
  notes:
    'Returns the same data the "Integrations" tab in server settings shows. Caller must have MANAGE_GUILD permission.',
  input: z.object({
    token: TokenParam,
    guildId: GuildIdParam,
    includeApplications: z
      .boolean()
      .optional()
      .default(true)
      .describe('Embed the linked application object on bot integrations'),
    includeRoleConnectionsMetadata: z
      .boolean()
      .optional()
      .default(true)
      .describe('Include linked-role metadata schemas for OAuth integrations'),
  }),
  output: z.object({
    integrations: z.array(IntegrationSchema),
  }),
};

export const listGuildEntitlementsSchema = {
  name: 'listGuildEntitlements',
  description:
    'List guild-scoped entitlements (powerups purchased for the server, subscription perks)',
  notes: '',
  input: z.object({
    token: TokenParam,
    guildId: GuildIdParam,
    withSku: z
      .boolean()
      .optional()
      .default(true)
      .describe('Embed the SKU object on each entitlement'),
    withApplication: z
      .boolean()
      .optional()
      .default(true)
      .describe('Embed the application object on each entitlement'),
  }),
  output: z.object({
    entitlements: z.array(EntitlementSchema),
  }),
};

export const listGuildPowerupsSchema = {
  name: 'listGuildPowerups',
  description: 'List active powerups (boost-funded perks) on a guild',
  notes:
    'Powerups are the post-2024 replacement for premium tiers; they unlock features like extra emoji slots, custom banners, role icons. Empty array means no powerups are active.',
  input: z.object({
    token: TokenParam,
    guildId: GuildIdParam,
    countryCode: z
      .string()
      .optional()
      .default('US')
      .describe('ISO 3166-1 alpha-2 country (affects pricing display only)'),
    includeEndsAt: z.boolean().optional().default(true),
  }),
  output: z.object({
    powerups: z.array(GuildPowerupSchema),
  }),
};

export const createChannelInviteSchema = {
  name: 'createChannelInvite',
  description: 'Create an invite link for a guild channel',
  notes:
    'Destructive: confirm with the user. The full invite URL is "https://discord.gg/{code}" where code is the returned `code` field. maxAge=0 means never expires; maxUses=0 means unlimited. Set validate to an existing invite code to reuse it instead of creating a new one (Discord returns the same code if still valid).',
  input: z.object({
    token: TokenParam,
    channelId: ChannelIdParam.describe(
      'Channel to invite into; users land here when they accept',
    ),
    maxAge: z
      .number()
      .int()
      .min(0)
      .max(604800)
      .optional()
      .default(86400)
      .describe(
        'Lifetime in seconds (0–604800, 0=never expires; default 1 day)',
      ),
    maxUses: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .default(0)
      .describe('Max uses (0–100, 0=unlimited)'),
    temporary: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, kicks joiners on disconnect unless they get a role'),
    flags: z.number().int().optional().default(0),
    targetUserId: UserIdParam.nullable()
      .optional()
      .describe('User snowflake to stream to (Go-Live invites)'),
    targetType: z
      .number()
      .nullable()
      .optional()
      .describe('1=stream, 2=embedded application'),
    validate: z
      .string()
      .nullable()
      .optional()
      .describe('Existing invite code to revalidate instead of creating new'),
  }),
  output: InviteSchema,
};

export const searchGuildMembersSchema = {
  name: 'searchGuildMembers',
  description:
    'Find guild members by username prefix via the gateway autocomplete (Op 8)',
  notes:
    'Same protocol the in-app @mention picker and search "from:" autocomplete use. Works on community/verified guilds where REST /members/search returns 403. Query must be non-empty (Discord rejects empty-query enumeration). Each call returns up to ~100 matches; pace at typing speed (~1 query per 200–500ms) for sustained use to look indistinguishable from real client traffic.',
  input: z.object({
    token: TokenParam,
    guildId: GuildIdParam,
    query: z
      .string()
      .min(1)
      .describe(
        'Username prefix to match (case-insensitive). Empty string is rejected.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe(
        'Max matches to request (1–100, default 10). Discord may return fewer.',
      ),
    presences: z
      .boolean()
      .optional()
      .default(true)
      .describe('Include presence (online/offline status) per match'),
  }),
  output: z.object({
    members: z.array(GuildMemberSchema),
    notFound: z
      .array(z.string())
      .describe(
        'User IDs explicitly requested via "userIds" that were not found (always empty for prefix-search calls)',
      ),
  }),
};

// ============================================================================
// Relationships (friends, blocks, requests)
// ============================================================================

export const RelationshipTypeEnum = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  .describe(
    '1=friend, 2=blocked, 3=incoming friend request, 4=outgoing friend request',
  );

export const RelationshipSchema = z
  .object({
    id: UserIdParam.describe(
      'Snowflake of the other user (the friend / blocked / requester)',
    ),
    type: RelationshipTypeEnum,
    nickname: z
      .string()
      .nullable()
      .describe('User-set nickname for this relationship; null if none'),
    user: UserSchema,
    since: z
      .string()
      .optional()
      .describe(
        'ISO 8601 timestamp the relationship entered its current state',
      ),
    is_spam_request: z
      .boolean()
      .optional()
      .describe(
        'True if Discord flagged an incoming request as spam (type=3 only)',
      ),
  })
  .passthrough();

export const listRelationshipsSchema = {
  name: 'listRelationships',
  description:
    "List the current user's relationships (friends, blocked users, pending friend requests)",
  notes:
    'Returns all relationship types in one call; filter client-side via the optional "type" param. Type codes: 1=friend, 2=blocked, 3=incoming request (someone added you), 4=outgoing request (you added them and they haven\'t accepted). The roster is unpaginated — Discord returns it in full.',
  input: z.object({
    token: TokenParam,
    type: RelationshipTypeEnum.optional().describe(
      'Filter to a single relationship type. Omit to return all relationships.',
    ),
  }),
  output: z.object({
    relationships: z.array(RelationshipSchema),
  }),
};

export const addFriendSchema = {
  name: 'addFriend',
  description: 'Send a friend request by username (Add Friend search-box flow)',
  notes:
    "PICK THIS variant ONLY when you have a username string and NO userId. If you have a userId (e.g., from getUserProfile, listMessages author.id, listRelationships, searchGuildMembers, getGuildMember), call addFriendById instead — that path matches Discord's profile-popout flow and trips anti-abuse less often. Destructive: confirm the target with the user before sending. Returns ok on success (Discord responds 204). Pass discriminator only for legacy 4-digit-tag accounts; modern accounts (global names) use discriminator=null. Discord may issue an hCaptcha challenge on accounts in poor standing — a 400 surfaced verbatim in the error indicates the user must solve a captcha in the Discord UI before retrying.",
  input: z.object({
    token: TokenParam,
    username: z
      .string()
      .min(2)
      .describe(
        'Target Discord username (case-sensitive). For modern accounts this is the unique handle (no #tag).',
      ),
    discriminator: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .optional()
      .describe(
        'Legacy 4-digit tag (e.g., "1234"). Omit or pass null for modern accounts using global names.',
      ),
  }),
  output: z.object({
    ok: z.literal(true),
  }),
};

export const addFriendByIdSchema = {
  name: 'addFriendById',
  description:
    'Send a friend request by user snowflake ID (profile-popout flow)',
  notes:
    "PICK THIS variant whenever you have the target's userId. Internally fires the same popout-profile GET Discord's UI does, then PUTs the relationship — without that GET, anti-abuse sees a popout-tagged PUT with no preceding popout flow and challenges with captcha. Use addFriend (POST-by-username) only when you have a username string and no way to resolve it to a userId. Destructive: confirm the target with the user before sending. Returns ok on success (Discord responds 204). Discord may still issue an hCaptcha challenge on accounts in poor standing — a 400 surfaced verbatim indicates the user must solve a captcha in the Discord UI before retrying.",
  input: z.object({
    token: TokenParam,
    userId: UserIdParam.describe(
      'Snowflake ID of the user to friend. Sources: getUserProfile().user.id, listMessages()[].author.id, listRelationships()[].id, searchGuildMembers/getGuildMember.',
    ),
    guildId: GuildIdParam.optional().describe(
      "Guild context: the server you saw this user in. Auto-detected from /channels/{guildId}/... URL when omitted. Pass explicitly if the active tab isn't on the right guild.",
    ),
  }),
  output: z.object({
    ok: z.literal(true),
  }),
};

// ============================================================================
// Users
// ============================================================================

export const getUserProfileSchema = {
  name: 'getUserProfile',
  description: 'Get a user profile (badges, connected accounts, mutual guilds)',
  notes: '',
  input: z.object({
    token: TokenParam,
    userId: UserIdParam,
    type: z
      .enum(['sidebar', 'popout', 'panel'])
      .optional()
      .describe(
        'Profile fetch shape. Defaults to "sidebar" (member-list/right-rail click). Use "popout" when imitating an avatar-popout open from chat — required if you intend to addFriendById right after, otherwise Discord\'s anti-abuse sees a sidebar→popout-PUT flow mismatch.',
      ),
    guildId: GuildIdParam.optional().describe(
      'Guild context for the profile fetch. Pass when viewing the user from inside a guild — Discord includes this in the popout flow.',
    ),
    withMutualGuilds: z.boolean().optional().default(true),
    withMutualFriends: z
      .boolean()
      .optional()
      .describe(
        "Default flips with type: false for sidebar, true for popout (matches the browser's defaults).",
      ),
    withMutualFriendsCount: z
      .boolean()
      .optional()
      .describe('Default flips with type: true for sidebar, false for popout.'),
  }),
  output: UserProfileSchema,
};

export const getInboxSchema = {
  name: 'getInbox',
  description: 'Get the home inbox feed (content-inventory entries)',
  notes:
    'Returns Discord-curated entries (recent friend activity, game events). Not a message inbox; use listMessages for DMs.',
  input: z.object({
    token: TokenParam,
  }),
  output: z
    .object({
      request_id: z.string(),
      entries: z
        .array(z.unknown())
        .describe('Inventory entries (friend plays, game events, etc.)'),
      entries_hash: z.string().optional(),
      expired_at: z.string().optional(),
      refresh_token: z.string().optional(),
      refresh_stale_inbox_after_ms: z.number().optional(),
      wait_ms_until_next_fetch: z.number().optional(),
      unranked_game_entries: z.array(z.unknown()).optional(),
    })
    .passthrough(),
};

export const listMfaCredentialsSchema = {
  name: 'listMfaCredentials',
  description:
    'List the current user’s registered WebAuthn (passkey) MFA credentials',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z.object({
    credentials: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().optional(),
          })
          .passthrough(),
      )
      .describe('Registered passkey credentials (empty if none configured)'),
  }),
};

export const getReferralEligibilitySchema = {
  name: 'getReferralEligibility',
  description:
    'Check whether the current user is eligible for the Discord referral program',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z
    .object({
      code: z
        .number()
        .describe('Discord error code (0 = not found / not eligible)'),
      message: z.string().optional(),
    })
    .passthrough(),
};

export const getUserSettingsSchema = {
  name: 'getUserSettings',
  description:
    'Get the current user’s settings as a base64-encoded protobuf blob',
  notes:
    'The "settings" field is opaque base64 protobuf — this library does not decode it. Treat as round-trip data: read with getUserSettings, modify only via updateUserSettings, do not parse.',
  input: z.object({
    token: TokenParam,
    version: z
      .union([z.literal(1), z.literal(2)])
      .describe(
        'Settings proto version. 1 = main settings, 2 = frecency/usage',
      ),
  }),
  output: z.object({
    settings: z.string().describe('Base64-encoded protobuf payload'),
  }),
};

export const updateUserSettingsSchema = {
  name: 'updateUserSettings',
  description: 'Update the current user’s settings proto (version 1 only)',
  notes:
    'Destructive: confirm with the user. Only version 1 accepts updates. The settings string is base64 protobuf — pass back what getUserSettings returned, modified upstream.',
  input: z.object({
    token: TokenParam,
    settings: z
      .string()
      .describe('Full base64-encoded settings protobuf to PATCH'),
  }),
  output: z.object({
    settings: z.string().describe('Server’s acknowledged settings blob'),
  }),
};

export const listUnclaimedGamesSchema = {
  name: 'listUnclaimedGames',
  description:
    'List free games / Nitro perks the user is eligible to claim but has not claimed yet',
  notes:
    'Empty object {} when nothing is unclaimed — this is normal, not an error.',
  input: z.object({
    token: TokenParam,
  }),
  output: z
    .record(z.string(), z.unknown())
    .describe('Map keyed by claim slot ID. Empty if nothing to claim.'),
};

export const listPaymentSourcesSchema = {
  name: 'listPaymentSources',
  description:
    "List the current user's saved payment methods (cards, PayPal, etc.)",
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z.object({
    paymentSources: z.array(PaymentSourceSchema),
  }),
};

export const listBillingSubscriptionsSchema = {
  name: 'listBillingSubscriptions',
  description:
    "List the current user's active and recent billing subscriptions (Nitro, server boosts)",
  notes: '',
  input: z.object({
    token: TokenParam,
    syncLevel: z
      .number()
      .int()
      .min(0)
      .max(2)
      .optional()
      .default(2)
      .describe(
        'Server-side sync level: 0=cached, 1=light refresh, 2=full sync from billing provider',
      ),
  }),
  output: z.object({
    subscriptions: z.array(SubscriptionSchema),
  }),
};

// ============================================================================
// Applications, Entitlements, Games
// ============================================================================

export const listApplicationsSchema = {
  name: 'listApplications',
  description: 'Look up public application metadata by ID (one or many)',
  notes: '',
  input: z.object({
    token: TokenParam,
    applicationIds: z
      .array(ApplicationIdParam)
      .min(1)
      .describe('Application snowflake IDs to fetch'),
  }),
  output: z.object({
    applications: z.array(ApplicationSchema),
  }),
};

export const listOauthTokensSchema = {
  name: 'listOauthTokens',
  description:
    'List the current user’s OAuth2 authorizations for an application',
  notes: '',
  input: z.object({
    token: TokenParam,
    applicationId: ApplicationIdParam,
  }),
  output: z.object({
    tokens: z
      .array(z.unknown())
      .describe(
        'OAuth2 grants the user has issued to this application (empty if none)',
      ),
  }),
};

export const listApplicationEntitlementsSchema = {
  name: 'listApplicationEntitlements',
  description:
    'List the current user’s entitlements for a specific application',
  notes: '',
  input: z.object({
    token: TokenParam,
    applicationId: ApplicationIdParam,
    excludeConsumed: z.boolean().optional().default(true),
  }),
  output: z.object({
    entitlements: z.array(EntitlementSchema),
  }),
};

export const listEntitlementsSchema = {
  name: 'listEntitlements',
  description:
    'List all entitlements for the current user (across applications)',
  notes:
    'Filter by entitlementType: 8 = application-subscription, 11 = guild-boost, etc. Pass null to omit the filter.',
  input: z.object({
    token: TokenParam,
    entitlementType: z
      .number()
      .nullable()
      .optional()
      .default(11)
      .describe(
        'Entitlement type code; null = no filter (default 11 matches Discord client behavior)',
      ),
    withSku: z.boolean().optional().default(false),
    withApplication: z.boolean().optional().default(false),
    excludeEnded: z.boolean().optional().default(true),
  }),
  output: z.object({
    entitlements: z.array(EntitlementSchema),
  }),
};

export const listGamesSchema = {
  name: 'listGames',
  description:
    'Get rich game metadata (description, screenshots, executables, reviews) by ID',
  notes: '',
  input: z.object({
    token: TokenParam,
    gameIds: z
      .array(z.string().regex(SnowflakeRegex))
      .min(1)
      .describe('Game/application snowflake IDs'),
    withSupplementalData: z.boolean().optional().default(true),
  }),
  output: z.object({
    games: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
            icon_hash: z.string().nullable().optional(),
            cover_image_hash: z.string().nullable().optional(),
            executables: z.array(z.unknown()).optional(),
            third_party_skus: z.array(z.unknown()).optional(),
            screenshot_urls: z.array(z.string()).optional(),
            genres: z.array(z.unknown()).optional(),
            companies: z.array(z.unknown()).optional(),
            platforms: z.array(z.string()).optional(),
            first_release_date: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .describe('Rich game records'),
  }),
};

export const listGameExclusionsSchema = {
  name: 'listGameExclusions',
  description:
    'Get the global executable/pattern allowlist Discord uses to suppress false-positive game detection',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z.object({
    executables: z
      .array(z.string())
      .describe('Excluded executable filenames (lowercase)'),
    patterns: z
      .array(z.string())
      .describe('Regex patterns matched against executable paths'),
  }),
};

// ============================================================================
// Commerce / Promotions / Store
// ============================================================================

export const listPromotionsSchema = {
  name: 'listPromotions',
  description: 'List active outbound promotions (partner deals, Nitro perks)',
  notes: '',
  input: z.object({
    token: TokenParam,
    locale: z
      .string()
      .optional()
      .default('en-US')
      .describe('BCP-47 locale (e.g., en-US)'),
    platform: z
      .number()
      .optional()
      .default(0)
      .describe('Platform code (0 = web/desktop)'),
  }),
  output: z.object({
    promotions: z
      .array(
        z
          .object({
            id: z.string(),
            partner_id: z.string().optional(),
            promotion_type: z.number().optional(),
            start_date: z.string(),
            end_date: z.string(),
            outbound_title: z.string().optional(),
            outbound_redemption_modal_body: z.string().optional(),
            outbound_redemption_page_link: z.string().optional(),
            outbound_terms_and_conditions: z.string().optional(),
            outbound_redemption_end_date: z.string().optional(),
            allowed_countries: z.array(z.string()).optional(),
            country_list_mode: z.number().optional(),
            flags: z.number().optional(),
            marketing_components: z.array(z.unknown()).optional(),
          })
          .passthrough(),
      )
      .describe('Outbound promotion records'),
  }),
};

export const listCollectiblesMarketingSchema = {
  name: 'listCollectiblesMarketing',
  description:
    'Get marketing copy for the Discord Shop (collectibles, avatar decorations, profile effects)',
  notes: '',
  input: z.object({
    token: TokenParam,
    platform: z.number().optional().default(0),
  }),
  output: z.object({
    marketings: z
      .record(
        z.string(),
        z
          .object({
            type: z.number(),
            version: z.number(),
            title: z.string(),
            body: z.string(),
            asset: z.string(),
            dismissible_content: z.number().optional(),
            ref_target_background: z.unknown().nullable().optional(),
          })
          .passthrough(),
      )
      .describe(
        'Map keyed by marketing slot ID. Each value has: type (slot category), version, title, body, asset (CDN URL), dismissible_content (bitfield).',
      ),
  }),
};

export const getCheckoutRecoverySchema = {
  name: 'getCheckoutRecovery',
  description:
    'Check whether the current user has an interrupted checkout to resume',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z.object({
    is_eligible: z.boolean(),
  }),
};

export const createUserOfferSchema = {
  name: 'createUserOffer',
  description: 'Create a billing offer (Nitro upsell flow)',
  notes:
    'Destructive: this kicks off a billing flow. Confirm with the user before calling. The body shape varies by offer type; pass through what the Discord client UI emits.',
  input: z.object({
    token: TokenParam,
    body: z
      .record(z.string(), z.unknown())
      .describe(
        'Offer payload (shape determined by Discord; pass through verbatim)',
      ),
  }),
  output: z
    .record(z.string(), z.unknown())
    .describe('Offer creation result (shape varies)'),
};

export const getStorefrontConfigSchema = {
  name: 'getStorefrontConfig',
  description:
    'Get the Partner SDK storefront configuration (promoted SKUs, eligible storefronts)',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z
    .object({
      promotional_sku_ids: z.array(z.string()),
      promotion_end_datetime: z.string(),
      storefronts: z.array(
        z
          .object({
            guild_id: GuildIdParam,
            application_id: ApplicationIdParam,
            game_id: z.string(),
          })
          .passthrough(),
      ),
      announcement_modal_config: z
        .object({
          version: z.number(),
          application_id: ApplicationIdParam,
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
};

export const listGuildStoreSkusSchema = {
  name: 'listGuildStoreSkus',
  description:
    'List published store SKUs (purchasable powerups) for an application + guild context',
  notes:
    'Returns the catalog of guild boosts/powerups available to purchase — server tags, badge packs, level upgrades, role styles. Each entry has a sku.id (use for purchase flows), powerup_metadata (display info, image URLs), and tenant_metadata.guild_monetization.powerup describing the unlocked guild_features (e.g., GUILD_TAGS, ANIMATED_BANNER, AUDIO_BITRATE_256_KBPS).',
  input: z.object({
    token: TokenParam,
    applicationId: ApplicationIdParam.describe(
      'Storefront application ID. Use Discord\'s Boost Rewards application ("1340102344645283891") for standard powerups.',
    ),
    guildId: GuildIdParam.describe(
      'Guild context (affects which SKUs are eligible / already-owned)',
    ),
    countryCode: z.string().optional().default('US'),
  }),
  output: z.object({
    listings: z.array(StoreSkuListingSchema),
  }),
};

export const getStorefrontEligibilitySchema = {
  name: 'getStorefrontEligibility',
  description:
    'Check the current user’s eligibility for each Partner SDK storefront',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z
    .record(z.string(), z.object({ is_eligible: z.boolean() }).passthrough())
    .describe(
      'Map keyed by application snowflake ID; each value has { is_eligible }',
    ),
};

// ============================================================================
// Quests
// ============================================================================

export const listQuestsSchema = {
  name: 'listQuests',
  description: 'List active quests offered to the current user',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z
    .object({
      quests: z
        .array(
          z
            .object({
              id: z.string(),
              config: z
                .unknown()
                .describe(
                  'Quest config: starts_at, expires_at, application, assets, rewards, etc.',
                ),
            })
            .passthrough(),
        )
        .describe('Active quest records'),
      excluded_quests: z
        .array(z.string())
        .optional()
        .describe('Quest IDs the user has dismissed'),
      quest_enrollment_blocked_until: z.string().nullable().optional(),
    })
    .passthrough(),
};

export const getQuestPlacementSchema = {
  name: 'getQuestPlacement',
  description:
    'Get quests targeted to specific UI placements (e.g., home banner)',
  notes: '',
  input: z.object({
    token: TokenParam,
    placements: z
      .array(z.string())
      .min(1)
      .describe('Placement keys (e.g., "quest_home_banner")'),
    platform: z
      .string()
      .optional()
      .default('web')
      .describe('Platform key (default "web")'),
  }),
  output: z
    .object({
      version: z.number(),
      placements: z
        .record(z.string(), z.unknown())
        .describe('Map keyed by placement; empty object if no targeted quest'),
    })
    .passthrough(),
};

export const recordQuestDecisionSchema = {
  name: 'recordQuestDecision',
  description:
    'Record a quest impression/decision for an ad placement (has side effects despite being GET)',
  notes:
    'Discord uses GET with side effects here. The placement is an integer code (e.g., 1). visibleGuildIds list is required so the server can target.',
  input: z.object({
    token: TokenParam,
    placement: z.number().describe('Placement code (e.g., 1)'),
    visibleGuildIds: z
      .array(GuildIdParam)
      .describe('Guild snowflake IDs currently visible to the user'),
    clientHeartbeatSessionId: z
      .string()
      .describe('Heartbeat session UUID from the client'),
    clientAdSessionId: z.string().describe('Ad session UUID from the client'),
  }),
  output: z
    .object({
      request_id: z.string(),
      quest: z.unknown().nullable(),
      creative: z.unknown().nullable(),
      ad_identifiers: z.unknown().nullable(),
      ad_context: z.unknown().nullable(),
      response_ttl_seconds: z.number().optional(),
      metadata_sealed: z.string().optional(),
      traffic_metadata_sealed: z.string().optional(),
      traffic_metadata_raw: z.unknown().optional(),
    })
    .passthrough(),
};

// ============================================================================
// Aggregation
// ============================================================================

export const allSchemas = [
  // Tier 1
  getContextSchema,
  getSurfacePreferenceSchema,
  setSurfacePreferenceSchema,
  selectChannelSchema,
  listMessagesSchema,
  sendMessageSchema,
  sendTypingSchema,
  greetChannelSchema,
  markChannelReadSchema,
  createDMFriendSchema,
  // createDMDesktopSchema — commented out in tandem with the schema block
  // and the function (see messages/index.ts). Re-add this line when reviving
  // the REVIVABLE STUB above.
  createDMDesktopDOMSchema,
  sendMessageDesktopDOMSchema,
  getStickerSchema,
  getStickerPackSchema,
  // Guilds
  listGuildsSchema,
  listGuildMembersSchema,
  searchGuildMembersSchema,
  createGuildSchema,
  createChannelInviteSchema,
  listGuildIntegrationsSchema,
  listGuildEntitlementsSchema,
  listGuildPowerupsSchema,
  // Relationships
  listRelationshipsSchema,
  addFriendSchema,
  addFriendByIdSchema,
  // Tier 2
  getUserProfileSchema,
  getInboxSchema,
  listMfaCredentialsSchema,
  getReferralEligibilitySchema,
  getUserSettingsSchema,
  updateUserSettingsSchema,
  listUnclaimedGamesSchema,
  listPaymentSourcesSchema,
  listBillingSubscriptionsSchema,
  // Tier 3
  listApplicationsSchema,
  listOauthTokensSchema,
  listApplicationEntitlementsSchema,
  listEntitlementsSchema,
  listGamesSchema,
  listGameExclusionsSchema,
  // Tier 4
  listPromotionsSchema,
  listCollectiblesMarketingSchema,
  getCheckoutRecoverySchema,
  createUserOfferSchema,
  getStorefrontConfigSchema,
  getStorefrontEligibilitySchema,
  listGuildStoreSkusSchema,
  // Tier 5
  listQuestsSchema,
  getQuestPlacementSchema,
  recordQuestDecisionSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Entities
export type User = z.infer<typeof UserSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type Embed = z.infer<typeof EmbedSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Application = z.infer<typeof ApplicationSchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;
export type Guild = z.infer<typeof GuildSchema>;
export type MutualGuild = z.infer<typeof MutualGuildSchema>;
export type GuildMember = z.infer<typeof GuildMemberSchema>;
export type MemberListGroup = z.infer<typeof MemberListGroupSchema>;
export type MemberListOp = z.infer<typeof MemberListOpSchema>;
export type ConnectedAccount = z.infer<typeof ConnectedAccountSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type Invite = z.infer<typeof InviteSchema>;
export type Sticker = z.infer<typeof StickerSchema>;
export type StickerPack = z.infer<typeof StickerPackSchema>;
export type Integration = z.infer<typeof IntegrationSchema>;
export type GuildPowerup = z.infer<typeof GuildPowerupSchema>;
export type StoreSkuListing = z.infer<typeof StoreSkuListingSchema>;
export type PaymentSource = z.infer<typeof PaymentSourceSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;

// Context
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type DiscordContext = GetContextOutput;
export type GetSurfacePreferenceInput = z.infer<
  typeof getSurfacePreferenceSchema.input
>;
export type GetSurfacePreferenceOutput = z.infer<
  typeof getSurfacePreferenceSchema.output
>;
export type SetSurfacePreferenceInput = z.infer<
  typeof setSurfacePreferenceSchema.input
>;
export type SetSurfacePreferenceOutput = z.infer<
  typeof setSurfacePreferenceSchema.output
>;

// Messages
export type ListMessagesInput = z.infer<typeof listMessagesSchema.input>;
export type ListMessagesOutput = z.infer<typeof listMessagesSchema.output>;
export type SendMessageInput = z.infer<typeof sendMessageSchema.input>;
export type SendMessageOutput = z.infer<typeof sendMessageSchema.output>;
export type SendTypingInput = z.infer<typeof sendTypingSchema.input>;
export type SendTypingOutput = z.infer<typeof sendTypingSchema.output>;
export type MarkChannelReadInput = z.infer<typeof markChannelReadSchema.input>;
export type MarkChannelReadOutput = z.infer<
  typeof markChannelReadSchema.output
>;
export type GreetChannelInput = z.infer<typeof greetChannelSchema.input>;
export type GreetChannelOutput = z.infer<typeof greetChannelSchema.output>;
export type CreateDMFriendInput = z.infer<typeof createDMFriendSchema.input>;
export type CreateDMFriendOutput = z.infer<typeof createDMFriendSchema.output>;
// Type exports for createDMDesktop — commented out in tandem with the schema
// block and the function. Re-enable when reviving the REVIVABLE STUB.
// export type CreateDMDesktopInput = z.infer<typeof createDMDesktopSchema.input>;
// export type CreateDMDesktopOutput = z.infer<
//   typeof createDMDesktopSchema.output
// >;
export type CreateDMDesktopDOMInput = z.infer<
  typeof createDMDesktopDOMSchema.input
>;
export type CreateDMDesktopDOMOutput = z.infer<
  typeof createDMDesktopDOMSchema.output
>;
export type SendMessageDesktopDOMInput = z.infer<
  typeof sendMessageDesktopDOMSchema.input
>;
export type SendMessageDesktopDOMOutput = z.infer<
  typeof sendMessageDesktopDOMSchema.output
>;
export type GetStickerInput = z.infer<typeof getStickerSchema.input>;
export type GetStickerOutput = z.infer<typeof getStickerSchema.output>;
export type GetStickerPackInput = z.infer<typeof getStickerPackSchema.input>;
export type GetStickerPackOutput = z.infer<typeof getStickerPackSchema.output>;

// Relationships
export type Relationship = z.infer<typeof RelationshipSchema>;
export type ListRelationshipsInput = z.infer<
  typeof listRelationshipsSchema.input
>;
export type ListRelationshipsOutput = z.infer<
  typeof listRelationshipsSchema.output
>;
export type AddFriendInput = z.infer<typeof addFriendSchema.input>;
export type AddFriendOutput = z.infer<typeof addFriendSchema.output>;
export type AddFriendByIdInput = z.infer<typeof addFriendByIdSchema.input>;
export type AddFriendByIdOutput = z.infer<typeof addFriendByIdSchema.output>;

// Guilds
export type ListGuildsInput = z.infer<typeof listGuildsSchema.input>;
export type ListGuildsOutput = z.infer<typeof listGuildsSchema.output>;
export type ListGuildMembersInput = z.infer<
  typeof listGuildMembersSchema.input
>;
export type ListGuildMembersOutput = z.infer<
  typeof listGuildMembersSchema.output
>;
export type SearchGuildMembersInput = z.infer<
  typeof searchGuildMembersSchema.input
>;
export type SearchGuildMembersOutput = z.infer<
  typeof searchGuildMembersSchema.output
>;
export type CreateGuildInput = z.infer<typeof createGuildSchema.input>;
export type CreateGuildOutput = z.infer<typeof createGuildSchema.output>;
export type CreateChannelInviteInput = z.infer<
  typeof createChannelInviteSchema.input
>;
export type CreateChannelInviteOutput = z.infer<
  typeof createChannelInviteSchema.output
>;
export type ListGuildIntegrationsInput = z.infer<
  typeof listGuildIntegrationsSchema.input
>;
export type ListGuildIntegrationsOutput = z.infer<
  typeof listGuildIntegrationsSchema.output
>;
export type ListGuildEntitlementsInput = z.infer<
  typeof listGuildEntitlementsSchema.input
>;
export type ListGuildEntitlementsOutput = z.infer<
  typeof listGuildEntitlementsSchema.output
>;
export type ListGuildPowerupsInput = z.infer<
  typeof listGuildPowerupsSchema.input
>;
export type ListGuildPowerupsOutput = z.infer<
  typeof listGuildPowerupsSchema.output
>;

// Users
export type GetUserProfileInput = z.infer<typeof getUserProfileSchema.input>;
export type GetUserProfileOutput = z.infer<typeof getUserProfileSchema.output>;
export type GetInboxInput = z.infer<typeof getInboxSchema.input>;
export type GetInboxOutput = z.infer<typeof getInboxSchema.output>;
export type ListMfaCredentialsInput = z.infer<
  typeof listMfaCredentialsSchema.input
>;
export type ListMfaCredentialsOutput = z.infer<
  typeof listMfaCredentialsSchema.output
>;
export type GetReferralEligibilityInput = z.infer<
  typeof getReferralEligibilitySchema.input
>;
export type GetReferralEligibilityOutput = z.infer<
  typeof getReferralEligibilitySchema.output
>;
export type GetUserSettingsInput = z.infer<typeof getUserSettingsSchema.input>;
export type GetUserSettingsOutput = z.infer<
  typeof getUserSettingsSchema.output
>;
export type UpdateUserSettingsInput = z.infer<
  typeof updateUserSettingsSchema.input
>;
export type UpdateUserSettingsOutput = z.infer<
  typeof updateUserSettingsSchema.output
>;
export type ListUnclaimedGamesInput = z.infer<
  typeof listUnclaimedGamesSchema.input
>;
export type ListUnclaimedGamesOutput = z.infer<
  typeof listUnclaimedGamesSchema.output
>;
export type ListPaymentSourcesInput = z.infer<
  typeof listPaymentSourcesSchema.input
>;
export type ListPaymentSourcesOutput = z.infer<
  typeof listPaymentSourcesSchema.output
>;
export type ListBillingSubscriptionsInput = z.infer<
  typeof listBillingSubscriptionsSchema.input
>;
export type ListBillingSubscriptionsOutput = z.infer<
  typeof listBillingSubscriptionsSchema.output
>;

// Applications
export type ListApplicationsInput = z.infer<
  typeof listApplicationsSchema.input
>;
export type ListApplicationsOutput = z.infer<
  typeof listApplicationsSchema.output
>;
export type ListOauthTokensInput = z.infer<typeof listOauthTokensSchema.input>;
export type ListOauthTokensOutput = z.infer<
  typeof listOauthTokensSchema.output
>;
export type ListApplicationEntitlementsInput = z.infer<
  typeof listApplicationEntitlementsSchema.input
>;
export type ListApplicationEntitlementsOutput = z.infer<
  typeof listApplicationEntitlementsSchema.output
>;
export type ListEntitlementsInput = z.infer<
  typeof listEntitlementsSchema.input
>;
export type ListEntitlementsOutput = z.infer<
  typeof listEntitlementsSchema.output
>;
export type ListGamesInput = z.infer<typeof listGamesSchema.input>;
export type ListGamesOutput = z.infer<typeof listGamesSchema.output>;
export type ListGameExclusionsInput = z.infer<
  typeof listGameExclusionsSchema.input
>;
export type ListGameExclusionsOutput = z.infer<
  typeof listGameExclusionsSchema.output
>;

// Commerce
export type ListPromotionsInput = z.infer<typeof listPromotionsSchema.input>;
export type ListPromotionsOutput = z.infer<typeof listPromotionsSchema.output>;
export type ListCollectiblesMarketingInput = z.infer<
  typeof listCollectiblesMarketingSchema.input
>;
export type ListCollectiblesMarketingOutput = z.infer<
  typeof listCollectiblesMarketingSchema.output
>;
export type GetCheckoutRecoveryInput = z.infer<
  typeof getCheckoutRecoverySchema.input
>;
export type GetCheckoutRecoveryOutput = z.infer<
  typeof getCheckoutRecoverySchema.output
>;
export type CreateUserOfferInput = z.infer<typeof createUserOfferSchema.input>;
export type CreateUserOfferOutput = z.infer<
  typeof createUserOfferSchema.output
>;
export type GetStorefrontConfigInput = z.infer<
  typeof getStorefrontConfigSchema.input
>;
export type GetStorefrontConfigOutput = z.infer<
  typeof getStorefrontConfigSchema.output
>;
export type GetStorefrontEligibilityInput = z.infer<
  typeof getStorefrontEligibilitySchema.input
>;
export type GetStorefrontEligibilityOutput = z.infer<
  typeof getStorefrontEligibilitySchema.output
>;
export type ListGuildStoreSkusInput = z.infer<
  typeof listGuildStoreSkusSchema.input
>;
export type ListGuildStoreSkusOutput = z.infer<
  typeof listGuildStoreSkusSchema.output
>;

// Quests
export type ListQuestsInput = z.infer<typeof listQuestsSchema.input>;
export type ListQuestsOutput = z.infer<typeof listQuestsSchema.output>;
export type GetQuestPlacementInput = z.infer<
  typeof getQuestPlacementSchema.input
>;
export type GetQuestPlacementOutput = z.infer<
  typeof getQuestPlacementSchema.output
>;
export type RecordQuestDecisionInput = z.infer<
  typeof recordQuestDecisionSchema.input
>;
export type RecordQuestDecisionOutput = z.infer<
  typeof recordQuestDecisionSchema.output
>;
