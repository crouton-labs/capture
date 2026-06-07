/**
 * Slack Conversations Operations
 *
 * Channel and DM conversation management.
 */

import type {
  ConversationsListInput,
  ConversationsListOutput,
  ConversationsHistoryInput,
  ConversationsHistoryOutput,
  ConversationsInfoInput,
  ConversationsInfoOutput,
  ConversationsMembersInput,
  ConversationsMembersOutput,
  ConversationsRepliesInput,
  ConversationsRepliesOutput,
  ConversationsCreateInput,
  ConversationsCreateOutput,
  ConversationsArchiveInput,
  ConversationsArchiveOutput,
  ConversationsUnarchiveInput,
  ConversationsUnarchiveOutput,
  ConversationsJoinInput,
  ConversationsJoinOutput,
  ConversationsLeaveInput,
  ConversationsLeaveOutput,
  ConversationsRenameInput,
  ConversationsRenameOutput,
  ConversationsOpenInput,
  ConversationsOpenOutput,
  ConversationsCloseInput,
  ConversationsCloseOutput,
  ConversationsMarkInput,
  ConversationsMarkOutput,
  ConversationsSetPurposeInput,
  ConversationsSetPurposeOutput,
  ConversationsSetTopicInput,
  ConversationsSetTopicOutput,
  ConversationsInviteInput,
  ConversationsInviteOutput,
  ConversationsInviteSharedInput,
  ConversationsInviteSharedOutput,
} from '../schemas';
import { slackApi } from '../helpers';

export async function conversationsList(
  params: ConversationsListInput,
): Promise<ConversationsListOutput> {
  return slackApi<ConversationsListOutput>(
    'conversations.list',
    params.token,
    params,
  );
}

export async function conversationsHistory(
  params: ConversationsHistoryInput,
): Promise<ConversationsHistoryOutput> {
  return slackApi<ConversationsHistoryOutput>(
    'conversations.history',
    params.token,
    params,
  );
}

export async function conversationsInfo(
  params: ConversationsInfoInput,
): Promise<ConversationsInfoOutput> {
  return slackApi<ConversationsInfoOutput>(
    'conversations.info',
    params.token,
    params,
  );
}

export async function conversationsMembers(
  params: ConversationsMembersInput,
): Promise<ConversationsMembersOutput> {
  return slackApi<ConversationsMembersOutput>(
    'conversations.members',
    params.token,
    params,
  );
}

export async function conversationsReplies(
  params: ConversationsRepliesInput,
): Promise<ConversationsRepliesOutput> {
  return slackApi<ConversationsRepliesOutput>(
    'conversations.replies',
    params.token,
    params,
  );
}

export async function conversationsCreate(
  params: ConversationsCreateInput,
): Promise<ConversationsCreateOutput> {
  return slackApi<ConversationsCreateOutput>(
    'conversations.create',
    params.token,
    params,
  );
}

export async function conversationsArchive(
  params: ConversationsArchiveInput,
): Promise<ConversationsArchiveOutput> {
  return slackApi<ConversationsArchiveOutput>(
    'conversations.archive',
    params.token,
    params,
  );
}

export async function conversationsUnarchive(
  params: ConversationsUnarchiveInput,
): Promise<ConversationsUnarchiveOutput> {
  return slackApi<ConversationsUnarchiveOutput>(
    'conversations.unarchive',
    params.token,
    params,
  );
}

export async function conversationsJoin(
  params: ConversationsJoinInput,
): Promise<ConversationsJoinOutput> {
  return slackApi<ConversationsJoinOutput>(
    'conversations.join',
    params.token,
    params,
  );
}

export async function conversationsLeave(
  params: ConversationsLeaveInput,
): Promise<ConversationsLeaveOutput> {
  return slackApi<ConversationsLeaveOutput>(
    'conversations.leave',
    params.token,
    params,
  );
}

export async function conversationsRename(
  params: ConversationsRenameInput,
): Promise<ConversationsRenameOutput> {
  return slackApi<ConversationsRenameOutput>(
    'conversations.rename',
    params.token,
    params,
  );
}

export async function conversationsOpen(
  params: ConversationsOpenInput,
): Promise<ConversationsOpenOutput> {
  return slackApi<ConversationsOpenOutput>(
    'conversations.open',
    params.token,
    params,
  );
}

export async function conversationsClose(
  params: ConversationsCloseInput,
): Promise<ConversationsCloseOutput> {
  return slackApi<ConversationsCloseOutput>(
    'conversations.close',
    params.token,
    params,
  );
}

export async function conversationsMark(
  params: ConversationsMarkInput,
): Promise<ConversationsMarkOutput> {
  return slackApi<ConversationsMarkOutput>(
    'conversations.mark',
    params.token,
    params,
  );
}

export async function conversationsSetPurpose(
  params: ConversationsSetPurposeInput,
): Promise<ConversationsSetPurposeOutput> {
  return slackApi<ConversationsSetPurposeOutput>(
    'conversations.setPurpose',
    params.token,
    params,
  );
}

export async function conversationsSetTopic(
  params: ConversationsSetTopicInput,
): Promise<ConversationsSetTopicOutput> {
  return slackApi<ConversationsSetTopicOutput>(
    'conversations.setTopic',
    params.token,
    params,
  );
}

export async function conversationsInvite(
  params: ConversationsInviteInput,
): Promise<ConversationsInviteOutput> {
  return slackApi<ConversationsInviteOutput>(
    'conversations.invite',
    params.token,
    params,
  );
}

export async function conversationsInviteShared(
  params: ConversationsInviteSharedInput,
): Promise<ConversationsInviteSharedOutput> {
  return slackApi<ConversationsInviteSharedOutput>(
    'conversations.inviteShared',
    params.token,
    params,
  );
}
