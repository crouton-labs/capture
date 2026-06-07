import type {
  CreateChannelInviteInput,
  CreateChannelInviteOutput,
  CreateGuildInput,
  CreateGuildOutput,
  Guild,
  GuildMember,
  Integration,
  Invite,
  ListGuildEntitlementsInput,
  ListGuildEntitlementsOutput,
  ListGuildIntegrationsInput,
  ListGuildIntegrationsOutput,
  ListGuildPowerupsInput,
  ListGuildPowerupsOutput,
  ListGuildsInput,
  ListGuildsOutput,
  ListGuildMembersInput,
  ListGuildMembersOutput,
  Entitlement,
  GuildPowerup,
  MemberListGroup,
  MemberListOp,
  SearchGuildMembersInput,
  SearchGuildMembersOutput,
} from '../schemas';
import { discordFetch, buildQuery } from '../helpers';
import { gatewayRequest, awaitChannelStore, awaitGuildReady } from '../gateway';

const PAGE_SIZE = 200;

export async function listGuilds(
  params: ListGuildsInput,
): Promise<ListGuildsOutput> {
  const all: Guild[] = [];
  let after: string | undefined;
  while (true) {
    const qs = buildQuery({
      with_counts: params.withCounts ?? false,
      limit: PAGE_SIZE,
      after,
    });
    const page = await discordFetch<Guild[]>(
      params.token,
      `/users/@me/guilds${qs}`,
    );
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1].id;
  }
  return { guilds: all };
}

interface GuildMemberListUpdateAction {
  guildId: string;
  groups: MemberListGroup[];
  ops: MemberListOp[];
  memberCount?: number;
  member_count?: number;
  onlineCount?: number;
  online_count?: number;
}

export async function listGuildMembers(
  params: ListGuildMembersInput,
): Promise<ListGuildMembersOutput> {
  await awaitGuildReady(params.guildId);
  const ranges = params.ranges ?? [[0, 99]];
  const channelId =
    params.channelId ?? (await pickDefaultChannelId(params.guildId));

  const action = await gatewayRequest<GuildMemberListUpdateAction>(
    {
      op: 14,
      d: {
        guild_id: params.guildId,
        channels: { [channelId]: ranges },
        members: [],
        thread_member_lists: [],
      },
    },
    'GUILD_MEMBER_LIST_UPDATE',
    (a) => a?.guildId === params.guildId,
    10_000,
  );

  const groups = action.groups ?? [];
  const ops = action.ops ?? [];

  const memberMap = new Map<string, GuildMember>();
  let totalRows = 0;
  for (const op of ops) {
    if (Array.isArray(op.items)) {
      for (const item of op.items) {
        if (item?.member?.user?.id) {
          memberMap.set(item.member.user.id, item.member);
          totalRows++;
        }
      }
    } else if (op.item?.member?.user?.id) {
      memberMap.set(op.item.member.user.id, op.item.member);
      totalRows++;
    }
  }

  const groupTotal = groups.reduce((sum, g) => sum + (g.count ?? 0), 0);
  const partialResult = groupTotal > totalRows;

  return {
    groups,
    ops,
    members: Array.from(memberMap.values()),
    totalRows,
    memberCount: action.memberCount ?? action.member_count ?? null,
    onlineCount: action.onlineCount ?? action.online_count ?? null,
    partialResult,
  };
}

async function pickDefaultChannelId(guildId: string): Promise<string> {
  const store = await awaitChannelStore();
  const channels = store.getMutableGuildChannelsForGuild(guildId);
  for (const c of Object.values(channels)) {
    if (c?.type === 0) return c.id;
  }
  throw new Error(
    `No text channel found in guild ${guildId} to anchor Op 14 ranges. ` +
      `Pass channelId explicitly, or ensure the user is a member of a guild with at least one visible text channel.`,
  );
}

interface GuildMembersChunkAction {
  guildId: string;
  members: GuildMember[];
  notFound?: string[];
  not_found?: string[];
  chunkIndex?: number;
  chunkCount?: number;
  chunk_index?: number;
  chunk_count?: number;
}

export async function createGuild(
  params: CreateGuildInput,
): Promise<CreateGuildOutput> {
  return discordFetch<Guild>(params.token, '/guilds', {
    method: 'POST',
    body: {
      name: params.name,
      icon: params.icon ?? null,
      channels: params.channels ?? [],
      system_channel_id: params.systemChannelId ?? null,
      guild_template_code: params.guildTemplateCode ?? '2TffvPucqHkN',
    },
  });
}

export async function listGuildIntegrations(
  params: ListGuildIntegrationsInput,
): Promise<ListGuildIntegrationsOutput> {
  const qs = buildQuery({
    include_applications: params.includeApplications ?? true,
    include_role_connections_metadata:
      params.includeRoleConnectionsMetadata ?? true,
  });
  const integrations = await discordFetch<Integration[]>(
    params.token,
    `/guilds/${params.guildId}/integrations${qs}`,
  );
  return { integrations };
}

export async function listGuildEntitlements(
  params: ListGuildEntitlementsInput,
): Promise<ListGuildEntitlementsOutput> {
  const qs = buildQuery({
    with_sku: params.withSku ?? true,
    with_application: params.withApplication ?? true,
  });
  const entitlements = await discordFetch<Entitlement[]>(
    params.token,
    `/guilds/${params.guildId}/entitlements${qs}`,
  );
  return { entitlements };
}

export async function listGuildPowerups(
  params: ListGuildPowerupsInput,
): Promise<ListGuildPowerupsOutput> {
  const qs = buildQuery({
    country_code: params.countryCode ?? 'US',
    include_ends_at: params.includeEndsAt ?? true,
  });
  const powerups = await discordFetch<GuildPowerup[]>(
    params.token,
    `/guilds/${params.guildId}/powerups${qs}`,
  );
  return { powerups };
}

export async function createChannelInvite(
  params: CreateChannelInviteInput,
): Promise<CreateChannelInviteOutput> {
  const body: Record<string, unknown> = {
    max_age: params.maxAge ?? 86400,
    max_uses: params.maxUses ?? 0,
    temporary: params.temporary ?? false,
    flags: params.flags ?? 0,
    target_user_id: params.targetUserId ?? null,
    target_type: params.targetType ?? null,
  };
  if (params.validate !== undefined) body.validate = params.validate;
  return discordFetch<Invite>(
    params.token,
    `/channels/${params.channelId}/invites`,
    { method: 'POST', body },
  );
}

export async function searchGuildMembers(
  params: SearchGuildMembersInput,
): Promise<SearchGuildMembersOutput> {
  if (!params.query || params.query.length === 0) {
    throw new Error(
      'searchGuildMembers requires a non-empty query string. Discord rejects empty-query enumeration.',
    );
  }

  await awaitGuildReady(params.guildId);

  const action = await gatewayRequest<GuildMembersChunkAction>(
    {
      op: 8,
      d: {
        guild_id: params.guildId,
        query: params.query,
        limit: params.limit ?? 10,
        presences: params.presences ?? true,
      },
    },
    'GUILD_MEMBERS_CHUNK',
    (a) => a?.guildId === params.guildId,
    10_000,
  );

  return {
    members: action.members ?? [],
    notFound: action.notFound ?? action.not_found ?? [],
  };
}
