import type {
  ListQuestsInput,
  ListQuestsOutput,
  GetQuestPlacementInput,
  GetQuestPlacementOutput,
  RecordQuestDecisionInput,
  RecordQuestDecisionOutput,
} from '../schemas';
import { discordFetch, buildQuery } from '../helpers';

export async function listQuests(
  params: ListQuestsInput,
): Promise<ListQuestsOutput> {
  return discordFetch<ListQuestsOutput>(params.token, '/quests/@me');
}

export async function getQuestPlacement(
  params: GetQuestPlacementInput,
): Promise<GetQuestPlacementOutput> {
  const qs = buildQuery({
    placements: params.placements,
    platform: params.platform ?? 'web',
  });
  return discordFetch<GetQuestPlacementOutput>(
    params.token,
    `/quests/placement-alpha${qs}`,
  );
}

export async function recordQuestDecision(
  params: RecordQuestDecisionInput,
): Promise<RecordQuestDecisionOutput> {
  const qs = buildQuery({
    placement: params.placement,
    client_heartbeat_session_id: params.clientHeartbeatSessionId,
    client_ad_session_id: params.clientAdSessionId,
    visible_guild_ids: params.visibleGuildIds,
  });
  return discordFetch<RecordQuestDecisionOutput>(
    params.token,
    `/quests/decision${qs}`,
  );
}
