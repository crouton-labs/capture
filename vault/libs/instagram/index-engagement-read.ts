/**
 * Instagram Library: Engagement Read
 *
 * getPostComments, getPostLikers
 */

import { ContractDrift, Unauthenticated, throwForStatus } from '@vallum/_runtime';
import { buildHeaders, getClientRevision } from './helpers';
import type {
  GetPostCommentsInput,
  GetPostCommentsOutput,
  GetPostLikersInput,
  GetPostLikersOutput,
} from './schemas';

// ============================================================================
// getPostComments
// ============================================================================

interface IGCommentUser {
  pk: string | number;
  username: string;
  profile_pic_url: string;
  is_verified: boolean;
}

interface IGComment {
  pk: string | number;
  text: string;
  user: IGCommentUser;
  created_at: number;
  comment_like_count: number;
  child_comment_count: number;
}

interface IGCommentsResponse {
  comments: IGComment[];
  next_min_id?: string | null;
  has_more_comments?: boolean;
  comment_count?: number;
  status?: string;
}

export async function getPostComments(
  params: GetPostCommentsInput,
): Promise<GetPostCommentsOutput> {
  const origin = window.location.origin;
  const url = new URL(`${origin}/api/v1/media/${params.mediaId}/comments/`);
  url.searchParams.set('can_support_threading', 'true');
  url.searchParams.set('count', String(params.count));
  if (params.cursor) {
    url.searchParams.set('min_id', params.cursor);
  }

  const resp = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...buildHeaders(params.csrf),
      'x-instagram-ajax': getClientRevision(),
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  if (resp.headers.get('content-type')?.includes('text/html')) {
    throw new Unauthenticated(
      'getPostComments: received HTML instead of JSON. Auth tokens may be missing or invalid.',
    );
  }

  const data = (await resp.json()) as IGCommentsResponse;

  if (!Array.isArray(data.comments)) {
    throw new ContractDrift(
      `getPostComments: unexpected response shape. Expected comments array. Keys: ${JSON.stringify(Object.keys(data))}`,
    );
  }

  const comments = data.comments.map((c) => ({
    commentId: String(c.pk),
    text: c.text,
    username: c.user.username,
    userId: String(c.user.pk),
    profilePicUrl: c.user.profile_pic_url,
    likeCount: c.comment_like_count,
    childCommentCount: c.child_comment_count,
    createdAt: c.created_at,
    isVerified: c.user.is_verified,
  }));

  const nextCursor =
    typeof data.next_min_id === 'string' ? data.next_min_id : null;

  return {
    comments,
    hasMore: data.has_more_comments === true,
    nextCursor,
    totalCount: comments.length,
  };
}

// ============================================================================
// getPostLikers
// ============================================================================

interface IGLikerUser {
  pk: string | number;
  username: string;
  full_name: string;
  profile_pic_url: string;
  is_verified: boolean;
  is_private: boolean;
}

interface IGLikersResponse {
  users: IGLikerUser[];
  status?: string;
}

export async function getPostLikers(
  params: GetPostLikersInput,
): Promise<GetPostLikersOutput> {
  const origin = window.location.origin;

  const resp = await fetch(`${origin}/api/v1/media/${params.mediaId}/likers/`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...buildHeaders(params.csrf),
      'x-instagram-ajax': getClientRevision(),
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  if (resp.headers.get('content-type')?.includes('text/html')) {
    throw new Unauthenticated(
      'getPostLikers: received HTML instead of JSON. Auth tokens may be missing or invalid.',
    );
  }

  const data = (await resp.json()) as IGLikersResponse;

  if (!Array.isArray(data.users)) {
    throw new ContractDrift(
      `getPostLikers: unexpected response shape. Expected users array. Keys: ${JSON.stringify(Object.keys(data))}`,
    );
  }

  const likers = data.users.map((u) => ({
    userId: String(u.pk),
    username: u.username,
    fullName: u.full_name,
    profilePicUrl: u.profile_pic_url,
    isVerified: u.is_verified,
    isPrivate: u.is_private,
  }));

  return {
    likers,
    totalCount: likers.length,
  };
}
