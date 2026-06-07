/**
 * Instagram Library: Publishing
 *
 * createPost, deletePost
 */

import { ContractDrift, Unauthenticated, throwForStatus } from '@vallum/_runtime';
import { buildHeaders, getAppId, getClientRevision } from './helpers';
import type {
  CreatePostInput,
  CreatePostOutput,
  DeletePostInput,
  DeletePostOutput,
} from './schemas-publish';

// ============================================================================
// createPost
// ============================================================================

interface IGUploadResponse {
  upload_id?: string;
  status?: string;
}

interface IGConfigureResponse {
  status?: string;
  message?: string;
  media?: {
    pk?: string;
    code?: string;
  };
}

export async function createPost(
  params: CreatePostInput,
): Promise<CreatePostOutput> {
  const origin = window.location.origin;

  // Convert base64 to binary
  const binaryStr = atob(params.imageBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // Generate upload ID (timestamp-based) and upload name
  const uploadId = String(Date.now());
  const randomSuffix = Math.floor(Math.random() * 1_000_000_000);
  const uploadName = `${uploadId}_0_${randomSuffix}`;

  // Step 1: Upload the image bytes
  // ⚠️ UNVERIFIED (Jun 2026): this POST returns 403 {"message":"login_required"}.
  // The rupload endpoint appears to require an x-ig-www-claim header that we do
  // not send — and the real claim is NOT a cookie (getContext().claimToken
  // reads it from cookies and gets "0"). HAR a real instagram.com web post to
  // capture the exact upload headers before relying on createPost.
  const uploadUrl = `${origin}/rupload_igphoto/${uploadName}`;

  const ruploadParams = JSON.stringify({
    media_type: 1,
    upload_id: uploadId,
    upload_media_height: 1080,
    upload_media_width: 1080,
  });

  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'image/jpeg',
      'x-csrftoken': params.csrf,
      'x-entity-length': String(bytes.byteLength),
      'x-entity-name': uploadName,
      'x-entity-type': 'image/jpeg',
      'x-ig-app-id': getAppId(),
      'x-instagram-rupload-params': ruploadParams,
      'x-requested-with': 'XMLHttpRequest',
    },
    body: bytes,
  });

  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => undefined);
    throwForStatus(uploadResp.status, text);
  }

  const uploadData = (await uploadResp.json()) as IGUploadResponse;

  if (uploadData.status !== 'ok' || !uploadData.upload_id) {
    throw new ContractDrift(
      `createPost upload returned unexpected response. Status: ${uploadData.status}`,
    );
  }

  // Step 2: Configure and publish
  const configureUrl = `${origin}/api/v1/media/configure/`;

  const configureBody: Record<string, unknown> = {
    upload_id: uploadData.upload_id,
    caption: params.caption,
    source_type: 'library',
    disable_comments: params.disableComments ? 1 : 0,
    like_and_view_counts_disabled: params.hideLikesAndViewCounts ? 1 : 0,
  };

  if (params.locationId) {
    configureBody.location = JSON.stringify({
      facebook_places_id: params.locationId,
    });
  }

  if (params.altText) {
    configureBody.custom_accessibility_caption = params.altText;
  }

  const configureHeaders: Record<string, string> = {
    ...buildHeaders(params.csrf),
    'content-type': 'application/json',
    'x-instagram-ajax': getClientRevision(),
  };

  const configureResp = await fetch(configureUrl, {
    method: 'POST',
    credentials: 'include',
    headers: configureHeaders,
    body: JSON.stringify(configureBody),
  });

  if (!configureResp.ok) {
    const text = await configureResp.text().catch(() => undefined);
    throwForStatus(configureResp.status, text);
  }

  const contentType = configureResp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `createPost: Instagram returned HTML instead of JSON from configure. Session may be expired or CSRF token is invalid.`,
    );
  }

  const configureData = (await configureResp.json()) as IGConfigureResponse;

  if (configureData.status !== 'ok' || !configureData.media) {
    const msg = configureData.message ? configureData.message : 'unknown error';
    throw new ContractDrift(
      `createPost configure failed: ${msg}. Status: ${configureData.status}`,
    );
  }

  const postId = configureData.media.pk;
  const shortcode = configureData.media.code;

  if (!postId || !shortcode) {
    throw new ContractDrift(
      `createPost: configure response missing pk or code. Status: ${configureData.status}`,
    );
  }

  return {
    postId,
    shortcode,
    url: `${origin}/p/${shortcode}/`,
  };
}

// ============================================================================
// deletePost
// ============================================================================

interface IGDeleteResponse {
  did_delete?: boolean;
  status?: string;
}

export async function deletePost(
  params: DeletePostInput,
): Promise<DeletePostOutput> {
  const origin = window.location.origin;

  const resp = await fetch(`${origin}/api/v1/media/${params.mediaId}/delete/`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...buildHeaders(params.csrf),
      'x-instagram-ajax': getClientRevision(),
    },
    body: new URLSearchParams({
      media_type: params.mediaType || 'PHOTO',
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated('deletePost: Instagram returned HTML instead of JSON. The sessionid cookie may be missing; try logging out and back in to refresh the session.');
  }

  const data = (await resp.json()) as IGDeleteResponse;

  return {
    success: data.did_delete === true || data.status === 'ok',
  };
}
