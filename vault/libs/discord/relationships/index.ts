import type {
  AddFriendInput,
  AddFriendOutput,
  AddFriendByIdInput,
  AddFriendByIdOutput,
  ListRelationshipsInput,
  ListRelationshipsOutput,
  Relationship,
} from '../schemas';
import {
  discordFetch,
  buildQuery,
  awaitCapturedFingerprint,
  contextProperties,
} from '../helpers';

// Pull a guild snowflake out of /channels/{guildId}/{channelId}.
// Returns undefined for /channels/@me or any other path.
function currentGuildIdFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const m = window.location.pathname.match(/^\/channels\/(\d{17,20})\//);
  return m?.[1];
}

export async function addFriend(
  params: AddFriendInput,
): Promise<AddFriendOutput> {
  const { token, username, discriminator } = params;
  const fingerprint = await awaitCapturedFingerprint();
  await discordFetch<void>(token, '/users/@me/relationships', {
    method: 'POST',
    body: { username, discriminator: discriminator ?? null },
    headers: {
      ...fingerprint,
      'X-Context-Properties': contextProperties('Add Friend'),
    },
  });
  return { ok: true };
}

export async function addFriendById(
  params: AddFriendByIdInput,
): Promise<AddFriendByIdOutput> {
  const { token, userId } = params;
  const guildId = params.guildId ?? currentGuildIdFromUrl();
  const fingerprint = await awaitCapturedFingerprint();

  // Mirror Discord's UI sequence exactly: a profile-popout GET precedes the
  // PUT in the browser. Without it, anti-abuse sees a popout-tagged PUT with
  // no preceding popout fetch and challenges with captcha. Param shape and
  // guild_id mirror the browser request observed in HAR.
  const profileQs = buildQuery({
    type: 'popout',
    with_mutual_guilds: true,
    with_mutual_friends: true,
    with_mutual_friends_count: false,
    guild_id: guildId,
  });
  await discordFetch<unknown>(token, `/users/${userId}/profile${profileQs}`, {
    headers: { ...fingerprint },
  });

  await discordFetch<void>(token, `/users/@me/relationships/${userId}`, {
    method: 'PUT',
    body: {},
    headers: {
      ...fingerprint,
      'X-Context-Properties': contextProperties('user profile popout'),
    },
  });
  return { ok: true };
}

export async function listRelationships(
  params: ListRelationshipsInput,
): Promise<ListRelationshipsOutput> {
  const { token, type } = params;
  const relationships = await discordFetch<Relationship[]>(
    token,
    '/users/@me/relationships',
  );
  const filtered =
    type === undefined
      ? relationships
      : relationships.filter((r) => r.type === type);
  return { relationships: filtered };
}
