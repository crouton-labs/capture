/**
 * Inbox and blocklist operations
 */

import { Validation } from '@vallum/_runtime';
import { clayFetch } from './shared';
import type {
  ListInboxRepliesInput,
  ListInboxRepliesOutput,
  SendInboxReplyInput,
  SendInboxReplyOutput,
  SetLeadCategoryInput,
  SetLeadCategoryOutput,
  SetLeadReadStatusInput,
  SetLeadReadStatusOutput,
  GetMessageHistoryInput,
  GetMessageHistoryOutput,
  AddToGlobalBlocklistInput,
  AddToGlobalBlocklistOutput,
  BatchAddToGlobalBlocklistInput,
  BatchAddToGlobalBlocklistOutput,
} from './schemas';

interface InboxReplyRaw {
  email_lead_map_id: number;
  email_lead_id: number;
  email_campaign_id: number;
  email_campaign_name: string;
  lead_email: string;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_status: string;
  lead_category_id: number;
  last_sent_time: string;
  last_reply_time: string;
  has_new_unread_email: boolean;
}

interface InboxRepliesResponse {
  paginated_replies: InboxReplyRaw[];
}

interface MessageHistoryRaw {
  type: string;
  message_id: string;
  stats_id: string;
  time: string;
  email_body: string;
  subject: string;
  from: string;
  to: string;
  email_seq_number?: string;
  open_count?: number;
  click_count?: number;
}

interface MessageHistoryResponse {
  history: MessageHistoryRaw[];
}

interface GlobalBlocklistEntry {
  id: number;
  email_or_domain: string;
  created_at: string;
  source: string;
}

/**
 * List email replies from the global inbox.
 */
export async function listInboxReplies(
  opts: ListInboxRepliesInput,
): Promise<ListInboxRepliesOutput> {
  const { workspaceId, offset = 0, campaignId, categoryId } = opts;

  if (!workspaceId) {
    throw new Validation('listInboxReplies: workspaceId is required');
  }

  const body: Record<string, unknown> = { offset };
  if (campaignId != null) body.campaign_id = campaignId;
  if (categoryId != null) body.category_id = categoryId;

  const data = await clayFetch<InboxRepliesResponse>(
    `/workspaces/${workspaceId}/clay-sequencer/master-inbox/replies`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  const rawReplies = data.paginated_replies || [];

  const replies = rawReplies.map((r) => ({
    emailLeadMapId: r.email_lead_map_id,
    emailLeadId: r.email_lead_id,
    emailCampaignId: r.email_campaign_id,
    emailCampaignName: r.email_campaign_name,
    leadEmail: r.lead_email,
    leadFirstName: r.lead_first_name ?? undefined,
    leadLastName: r.lead_last_name ?? undefined,
    leadStatus: r.lead_status,
    leadCategoryId: r.lead_category_id,
    lastSentTime: r.last_sent_time,
    lastReplyTime: r.last_reply_time,
    hasNewUnreadEmail: r.has_new_unread_email,
  }));

  return {
    replies,
    totalCount: replies.length,
  };
}

/**
 * Send a reply to an email in the global inbox.
 */
export async function sendInboxReply(
  opts: SendInboxReplyInput,
): Promise<SendInboxReplyOutput> {
  const {
    workspaceId,
    campaignId,
    emailBody,
    emailStatsId,
    replyMessageId,
    replyEmailTime,
    replyEmailBody,
  } = opts;

  if (!workspaceId) {
    throw new Validation('sendInboxReply: workspaceId is required');
  }
  if (campaignId == null) {
    throw new Validation('sendInboxReply: campaignId is required');
  }
  if (!emailBody) {
    throw new Validation('sendInboxReply: emailBody is required');
  }
  if (!emailStatsId) {
    throw new Validation('sendInboxReply: emailStatsId is required');
  }
  if (!replyMessageId) {
    throw new Validation('sendInboxReply: replyMessageId is required');
  }

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/master-inbox/reply`,
    {
      method: 'POST',
      body: JSON.stringify({
        campaign_id: campaignId,
        reply_data: {
          email_body: emailBody,
          email_stats_id: emailStatsId,
          reply_message_id: replyMessageId,
          reply_email_time: replyEmailTime,
          reply_email_body: replyEmailBody,
        },
      }),
    },
  );

  return { success: true };
}

/**
 * Categorize a lead reply in the campaign inbox.
 */
export async function setLeadCategory(
  opts: SetLeadCategoryInput,
): Promise<SetLeadCategoryOutput> {
  const { workspaceId, emailLeadMapId, categoryId } = opts;

  if (!workspaceId) throw new Validation('setLeadCategory: workspaceId is required');
  if (emailLeadMapId == null)
    throw new Validation('setLeadCategory: emailLeadMapId is required');
  if (categoryId == null)
    throw new Validation('setLeadCategory: categoryId is required');

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/master-inbox/lead-category`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        email_lead_map_id: emailLeadMapId,
        category_id: categoryId,
      }),
    },
  );

  return { success: true };
}

/**
 * Mark a lead conversation as read or unread.
 */
export async function setLeadReadStatus(
  opts: SetLeadReadStatusInput,
): Promise<SetLeadReadStatusOutput> {
  const { workspaceId, emailLeadMapId, readStatus } = opts;

  if (!workspaceId)
    throw new Validation('setLeadReadStatus: workspaceId is required');
  if (emailLeadMapId == null)
    throw new Validation('setLeadReadStatus: emailLeadMapId is required');
  if (!readStatus) throw new Validation('setLeadReadStatus: readStatus is required');

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/master-inbox/lead-read-status`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        email_lead_map_id: emailLeadMapId,
        new_read_status: readStatus,
      }),
    },
  );

  return { success: true };
}

/**
 * Get the full email message history for a specific lead.
 */
export async function getMessageHistory(
  opts: GetMessageHistoryInput,
): Promise<GetMessageHistoryOutput> {
  const { workspaceId, campaignId, leadId } = opts;

  if (!workspaceId)
    throw new Validation('getMessageHistory: workspaceId is required');
  if (campaignId == null)
    throw new Validation('getMessageHistory: campaignId is required');
  if (leadId == null) throw new Validation('getMessageHistory: leadId is required');

  let data: MessageHistoryResponse;
  try {
    data = await clayFetch<MessageHistoryResponse>(
      `/workspaces/${workspaceId}/clay-sequencer/master-inbox/message-history`,
      {
        method: 'POST',
        body: JSON.stringify({
          campaign_id: campaignId,
          lead_id: leadId,
        }),
      },
    );
  } catch (err: unknown) {
    // Clay backend Zod parse error on empty history; returns 400 with
    // {"details":{"responseBody":{"history":[]}}} when the lead has no messages
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('400') &&
      msg.includes('Failed to parse campaign lead message history')
    ) {
      return { messages: [] };
    }
    throw err;
  }

  const raw = data.history ?? [];

  return {
    messages: raw.map((m) => ({
      type: m.type,
      messageId: m.message_id,
      statsId: m.stats_id,
      subject: m.subject,
      body: m.email_body,
      time: m.time,
      from: m.from,
      to: m.to,
      emailSeqNumber: m.email_seq_number,
      openCount: m.open_count,
      clickCount: m.click_count,
    })),
  };
}

// ============================================================================
// Trash Management
// ============================================================================

/**
 * List deleted/trashed resources that can be restored.
 */

/**
 * List all emails and domains on the global email blocklist.
 */
export async function listGlobalBlocklist(opts: {
  workspaceId: string;
}): Promise<{
  entries: Array<{
    id: number;
    emailOrDomain: string;
    createdAt: string;
    source: string;
  }>;
  totalCount: number;
}> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const data = await clayFetch<GlobalBlocklistEntry[]>(
    `/workspaces/${workspaceId}/clay-sequencer/global-blocklist`,
  );

  const entries = (data || []).map((e) => ({
    id: e.id,
    emailOrDomain: e.email_or_domain,
    createdAt: e.created_at,
    source: e.source,
  }));

  return {
    entries,
    totalCount: entries.length,
  };
}

/**
 * Add an email address or domain to the global blocklist to prevent sending emails to it.
 */
export async function addToGlobalBlocklist(
  opts: AddToGlobalBlocklistInput,
): Promise<AddToGlobalBlocklistOutput> {
  const { workspaceId, emailOrDomain } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!emailOrDomain) {
    throw new Validation('emailOrDomain is required');
  }

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/global-blocklist/add`,
    {
      method: 'POST',
      body: JSON.stringify({ emailOrDomain }),
    },
  );

  return {
    success: true,
  };
}

/**
 * Add multiple email addresses or domains to the global blocklist in one call.
 */
export async function batchAddToGlobalBlocklist(
  opts: BatchAddToGlobalBlocklistInput,
): Promise<BatchAddToGlobalBlocklistOutput> {
  const { workspaceId, entries } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!entries || entries.length === 0) {
    throw new Validation('entries array is required and must not be empty');
  }

  let added = 0;
  const failed: Array<{ entry: string; error: string }> = [];

  for (const emailOrDomain of entries) {
    try {
      await clayFetch(
        `/workspaces/${workspaceId}/clay-sequencer/global-blocklist/add`,
        {
          method: 'POST',
          body: JSON.stringify({ emailOrDomain }),
        },
      );
      added++;
    } catch (err: unknown) {
      failed.push({
        entry: emailOrDomain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { added, failed };
}

/**
 * Remove an entry from the global blocklist by its ID.
 */
export async function removeFromGlobalBlocklist(opts: {
  workspaceId: string;
  entryId: number;
}): Promise<{ success: boolean }> {
  const { workspaceId, entryId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!entryId) {
    throw new Validation('entryId is required');
  }

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/global-blocklist/${entryId}`,
    { method: 'DELETE' },
  );

  return {
    success: true,
  };
}

// ============================================================================
// Clay Sequencer - Campaign Email Accounts
// ============================================================================

/**
 * Add email accounts to a campaign for sending emails.
 */
