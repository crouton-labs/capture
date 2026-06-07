/**
 * TikTok Studio Comment Operations
 *
 * Bulk and moderation operations for comments.
 *
 * IMPORTANT: TikTok's modified window.fetch adds anti-bot tokens (msToken,
 * X-Bogus, X-Gnarly) automatically. All fetch() calls go through their
 * interceptor; no manual signature computation needed.
 */

export type {
  DeleteCommentsInput,
  DeleteCommentsOutput,
  PinCommentInput,
  PinCommentOutput,
  UnpinCommentInput,
  UnpinCommentOutput,
} from './schemas-comments-ops';

import { UpstreamError, ContractDrift, throwForStatus } from '@vallum/_runtime';

import type {
  DeleteCommentsOutput,
  PinCommentOutput,
  UnpinCommentOutput,
} from './schemas-comments-ops';

// ============================================================================
// Helpers (mirrors from index.ts; must be self-contained for browser execution)
// ============================================================================

interface CommonParams {
  deviceId: string;
  region: string;
  language: string;
}

function buildApiUrl(
  path: string,
  common: CommonParams,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({
    locale: common.language,
    aid: '1988',
    priority_region: common.region,
    region: common.region,
    app_name: 'tiktok_creator_center',
    app_language: common.language,
    device_platform: 'web_pc',
    channel: 'tiktok_web',
    device_id: common.deviceId,
    ...extra,
  });
  return `${path}?${params.toString()}`;
}

async function apiPostForm<T>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams(params).toString();
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();
  if (data.status_code !== undefined && data.status_code !== 0) {
    throw new UpstreamError(
      `TikTok API error: status_code=${data.status_code}, msg="${data.status_msg}". URL: ${url}`,
    );
  }
  return data as T;
}

// ============================================================================
// Internal Types
// ============================================================================

interface CommentDeleteResponse {
  status_code: number;
  status_msg: string;
}

// ============================================================================
// Comment Operations
// ============================================================================

/**
 * Bulk delete multiple comments from your TikTok posts.
 * Calls the single delete endpoint sequentially for each comment ID.
 */
export async function deleteComments(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  commentIds: string[];
}): Promise<DeleteCommentsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const url = buildApiUrl('/api/comment/delete/', common);

  const results: DeleteCommentsOutput['results'] = [];

  for (const commentId of params.commentIds) {
    try {
      await apiPostForm<CommentDeleteResponse>(url, {
        cid: commentId,
        action: '1',
      });
      results.push({ commentId, success: true });
    } catch (err) {
      results.push({
        commentId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return { results, successCount, failureCount };
}

/**
 * Pin a comment to the top of a post's comment section.
 *
 * NOTE: Comment pinning is not available in TikTok Studio web. This feature
 * is only accessible via the TikTok mobile app. This function always throws.
 */
export async function pinComment(_params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  itemId: string;
  commentId: string;
}): Promise<PinCommentOutput> {
  throw new ContractDrift(
    'pinComment is not available in TikTok Studio web. Comment pinning is only supported in the TikTok mobile app.',
  );
}

/**
 * Unpin a previously pinned comment from the top of a post's comment section.
 *
 * NOTE: Comment unpinning is not available in TikTok Studio web. This feature
 * is only accessible via the TikTok mobile app. This function always throws.
 */
export async function unpinComment(_params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  itemId: string;
  commentId: string;
}): Promise<UnpinCommentOutput> {
  throw new ContractDrift(
    'unpinComment is not available in TikTok Studio web. Comment unpinning is only supported in the TikTok mobile app.',
  );
}
