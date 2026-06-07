/**
 * Slack Message Operations
 *
 * Send, edit, and delete messages.
 */

import type {
  ChatPostMessageInput,
  ChatPostMessageOutput,
  ChatUpdateInput,
  ChatUpdateOutput,
  ChatDeleteInput,
  ChatDeleteOutput,
  ChatGetPermalinkInput,
  ChatGetPermalinkOutput,
} from '../schemas';
import { slackApi } from '../helpers';

export async function chatPostMessage(
  params: ChatPostMessageInput,
): Promise<ChatPostMessageOutput> {
  return slackApi<ChatPostMessageOutput>(
    'chat.postMessage',
    params.token,
    params,
  );
}

export async function chatUpdate(
  params: ChatUpdateInput,
): Promise<ChatUpdateOutput> {
  return slackApi<ChatUpdateOutput>('chat.update', params.token, params);
}

export async function chatDelete(
  params: ChatDeleteInput,
): Promise<ChatDeleteOutput> {
  return slackApi<ChatDeleteOutput>('chat.delete', params.token, params);
}

export async function chatGetPermalink(
  params: ChatGetPermalinkInput,
): Promise<ChatGetPermalinkOutput> {
  return slackApi<ChatGetPermalinkOutput>(
    'chat.getPermalink',
    params.token,
    params,
  );
}
