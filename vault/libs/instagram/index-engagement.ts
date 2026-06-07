/**
 * Instagram Library: Engagement
 *
 * likePost, unlikePost, commentOnPost, deleteComment
 */

import { ContractDrift, Unauthenticated, throwForStatus } from '@vallum/_runtime';
import { buildHeaders } from './helpers';
import type {
  LikePostInput,
  LikePostOutput,
  UnlikePostInput,
  UnlikePostOutput,
  CommentOnPostInput,
  CommentOnPostOutput,
  DeleteCommentInput,
  DeleteCommentOutput,
} from './schemas-engagement';

// ============================================================================
// likePost
// ============================================================================

interface IGLikeResponse {
  status?: string;
}

export async function likePost(params: LikePostInput): Promise<LikePostOutput> {
  const origin = window.location.origin;
  const url = `${origin}/api/v1/web/likes/${params.mediaId}/like/`;

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
    body: new URLSearchParams().toString(),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `likePost: Instagram returned HTML instead of JSON. This usually means the session is expired or auth tokens are invalid.`,
    );
  }

  const data = (await resp.json()) as IGLikeResponse;
  return { success: data.status === 'ok' };
}

// ============================================================================
// unlikePost
// ============================================================================

export async function unlikePost(
  params: UnlikePostInput,
): Promise<UnlikePostOutput> {
  const origin = window.location.origin;
  // NOTE: unlike uses the mobile-API path, NOT the /web/likes/ path that
  // likePost uses. The web variant (/api/v1/web/likes/{id}/unlike/) returns
  // 404 — only /api/v1/media/{id}/unlike/ works (verified live Jun 2026).
  const url = `${origin}/api/v1/media/${params.mediaId}/unlike/`;

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
    body: new URLSearchParams().toString(),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `unlikePost: Instagram returned HTML instead of JSON. This usually means the session is expired or auth tokens are invalid.`,
    );
  }

  const data = (await resp.json()) as IGLikeResponse;
  return { success: data.status === 'ok' };
}

// ============================================================================
// commentOnPost
// ============================================================================

interface IGCommentResponse {
  status?: string;
  pk?: string;
  id?: string;
}

export async function commentOnPost(
  params: CommentOnPostInput,
): Promise<CommentOnPostOutput> {
  const origin = window.location.origin;
  const url = `${origin}/api/v1/web/comments/${params.mediaId}/add/`;

  const body = new URLSearchParams({
    comment_text: params.text,
  });

  if (params.replyToCommentId) {
    body.set('replied_to_comment_id', params.replyToCommentId);
  }

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
    body: body.toString(),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as IGCommentResponse;
  const commentId = data.pk ?? data.id;

  if (!commentId) {
    throw new ContractDrift(
      `commentOnPost: response missing comment ID. Status: ${data.status}`,
    );
  }

  return { success: data.status === 'ok', commentId: String(commentId) };
}

// ============================================================================
// deleteComment
// ============================================================================

interface IGDeleteCommentResponse {
  status?: string;
}

export async function deleteComment(
  params: DeleteCommentInput,
): Promise<DeleteCommentOutput> {
  const origin = window.location.origin;
  const url = `${origin}/api/v1/web/comments/${params.mediaId}/delete/${params.commentId}/`;

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
    body: new URLSearchParams().toString(),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as IGDeleteCommentResponse;
  return { success: data.status === 'ok' };
}
