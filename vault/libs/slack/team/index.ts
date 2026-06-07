/**
 * Slack Team & Emoji Operations
 *
 * Team information, emoji, and bot management.
 */

import type {
  EmojiListInput,
  EmojiListOutput,
  TeamInfoInput,
  TeamInfoOutput,
  BotsInfoInput,
  BotsInfoOutput,
} from '../schemas';
import { slackApi } from '../helpers';

export async function emojiList(
  params: EmojiListInput,
): Promise<EmojiListOutput> {
  return slackApi<EmojiListOutput>('emoji.list', params.token, params);
}

export async function teamInfo(params: TeamInfoInput): Promise<TeamInfoOutput> {
  return slackApi<TeamInfoOutput>('team.info', params.token, params);
}

export async function botsInfo(params: BotsInfoInput): Promise<BotsInfoOutput> {
  return slackApi<BotsInfoOutput>('bots.info', params.token, params);
}
