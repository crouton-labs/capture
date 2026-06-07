/**
 * Facebook Library: Stories Composer
 *
 * Posts a photo to the viewer's Story. Two requests under the hood:
 *   1. POST upload.facebook.com/ajax/react_composer/attachments/photo/upload
 *      (multipart) → returns the uploaded photoID
 *   2. StoriesCreateMutation on /api/graphql/ with that photoID
 */

import {
  buildGraphqlBody,
  getAsbdId,
  getLsdToken,
  getViewerUserId,
  graphql,
} from './helpers';
import type {
  CreatePhotoStoryInput,
  CreatePhotoStoryOutput,
} from './schemas-stories';

const STORIES_ROUTE = 'comet.fbweb.CometStoriesCreateRoute';

interface UploadPayload {
  photoID: string;
  imageSrc?: string;
  width?: number;
  height?: number;
}

interface UploadResponse {
  payload?: Partial<UploadPayload>;
  error?: number;
  errorSummary?: string;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const resp = await fetch(dataUrl);
  return resp.blob();
}

async function uploadComposerPhoto(dataUrl: string): Promise<UploadPayload> {
  const userId = getViewerUserId();
  const blob = await dataUrlToBlob(dataUrl);
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  const filename = `story_${Date.now()}.${ext}`;

  const auth = buildGraphqlBody({
    userId,
    docId: '',
    friendlyName: '',
    variables: {},
    routeName: STORIES_ROUTE,
  });
  // The upload endpoint is not GraphQL — strip Relay-only params.
  for (const k of [
    'fb_api_caller_class',
    'fb_api_req_friendly_name',
    'variables',
    'server_timestamps',
    'doc_id',
  ]) {
    auth.delete(k);
  }

  const url = `https://upload.facebook.com/ajax/react_composer/attachments/photo/upload?${auth.toString()}`;
  const form = new FormData();
  form.append('source', blob, filename);

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: '*/*',
      origin: 'https://www.facebook.com',
      'sec-fetch-site': 'same-site',
      'x-asbd-id': getAsbdId(),
      'x-fb-lsd': getLsdToken(),
    },
    body: form,
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(
      `Facebook photo upload HTTP ${resp.status}. Body: ${txt.slice(0, 300)}`,
    );
  }

  const text = await resp.text();
  // FB prefixes JSON with `for (;;);` to defeat XSSI.
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) {
    throw new Error(
      `Facebook photo upload returned non-JSON. First 200 chars: ${text.slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(text.slice(jsonStart)) as UploadResponse;
  if (parsed.error) {
    throw new Error(
      `Facebook photo upload error ${parsed.error}: ${parsed.errorSummary || 'unknown'}`,
    );
  }
  if (!parsed.payload?.photoID) {
    throw new Error(
      `Facebook photo upload returned no photoID. First 200 chars: ${text.slice(0, 200)}`,
    );
  }
  return parsed.payload as UploadPayload;
}

interface RawCreateStoryResponse {
  data?: {
    story_create?: {
      story?: {
        id?: string;
        legacy_story_hideable_id?: string;
      };
    };
  };
}

function newComposerSessionId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export async function createPhotoStory(
  params: CreatePhotoStoryInput,
): Promise<CreatePhotoStoryOutput> {
  const userId = getViewerUserId();
  const photo = await uploadComposerPhoto(params.dataUrl);

  const raw = await graphql<RawCreateStoryResponse>(
    userId,
    '26770527039211553',
    'StoriesCreateMutation',
    {
      input: {
        audiences: [{ stories: { self: { target_id: userId } } }],
        audiences_is_complete: true,
        logging: { composer_session_id: newComposerSessionId() },
        navigation_data: {
          attribution_id_v2: 'StoriesCreateRoot.react,comet.stories.create',
        },
        source: 'WWW',
        attachments: [{ photo: { id: photo.photoID, overlays: [] } }],
        tracking: [null],
        actor_id: userId,
        client_mutation_id: '1',
      },
    },
    { routeName: STORIES_ROUTE },
  );

  return {
    storyId: raw.data?.story_create?.story?.id ?? null,
    photoId: photo.photoID,
    raw: raw.data,
  };
}
