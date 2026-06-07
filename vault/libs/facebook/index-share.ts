/**
 * Facebook Library: Sharing Functions
 *
 * Wrapped share URLs and link previews for Facebook posts.
 */

import { getViewerUserId, graphql } from './helpers';
import type {
  CreateShareUrlInput,
  CreateShareUrlOutput,
  GetShareLinkPreviewInput,
  GetShareLinkPreviewOutput,
} from './schemas-share';

interface RawCreateShareResponse {
  data?: {
    xfb_create_share_url_wrapper?: {
      share_url_wrapper?: {
        id?: string;
        original_content_url?: string;
        wrapped_url?: string;
      };
    };
  };
}

export async function createShareUrl(
  params: CreateShareUrlInput,
): Promise<CreateShareUrlOutput> {
  const userId = getViewerUserId();
  const raw = await graphql<RawCreateShareResponse>(
    userId,
    '30568280579452205',
    'useLinkSharingCreateWrappedUrlMutation',
    {
      input: {
        actor_id: userId,
        client_mutation_id: '1',
        original_content_url: params.originalUrl,
        product_type: params.productType,
      },
    },
  );

  const wrapper = raw.data?.xfb_create_share_url_wrapper?.share_url_wrapper;
  if (!wrapper?.wrapped_url) {
    throw new Error(
      `Facebook useLinkSharingCreateWrappedUrlMutation returned no wrapped_url for ${params.originalUrl}.`,
    );
  }

  return {
    id: wrapper.id ?? '',
    originalUrl: wrapper.original_content_url ?? params.originalUrl,
    wrappedUrl: wrapper.wrapped_url,
    raw: raw.data,
  };
}

interface RawXmaPreviewResponse {
  data?: {
    xma_preview_data?: {
      title_text?: string;
      subtitle_text?: string;
      header_title?: string;
      preview_url?: string;
      favicon_url?: string;
      header_image_url?: string;
      xma_content_type?: string;
      post_id?: string;
      is_public?: boolean;
    };
  };
}

export async function getShareLinkPreview(
  params: GetShareLinkPreviewInput,
): Promise<GetShareLinkPreviewOutput> {
  const userId = getViewerUserId();
  const raw = await graphql<RawXmaPreviewResponse>(
    userId,
    '9840669832713841',
    'MAWFetchXMAData_fetchXmaPreviewDataQuery',
    { url: params.url },
  );

  const x = raw.data?.xma_preview_data ?? {};
  return {
    title: x.title_text ?? null,
    subtitle: x.subtitle_text ?? null,
    headerTitle: x.header_title ?? null,
    previewUrl: x.preview_url ?? null,
    faviconUrl: x.favicon_url ?? null,
    headerImageUrl: x.header_image_url ?? null,
    contentType: x.xma_content_type ?? null,
    postId: x.post_id ?? null,
    isPublic: x.is_public === true,
    raw: raw.data,
  };
}
