/**
 * Facebook Library: Photo Functions
 */

import { getViewerUserId, graphql } from './helpers';
import type {
  GetPhotoInput,
  GetPhotoOutput,
  GetPhotoTagsInput,
  GetPhotoTagsOutput,
} from './schemas-photo';

const PHOTO_RELAY_PROVIDERS = {
  __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
  __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
  __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
  __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:
    'ORIGINAL',
  __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
  __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
  __relay_internal__pv__IsWorkUserrelayprovider: false,
  __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
  __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
  __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
};

interface RawPhotoResponse {
  data?: {
    currMedia?: Record<string, unknown>;
  };
}

interface RawPhotoTagsResponse {
  data?: {
    node?: {
      id?: string;
      photo_tags?: { nodes?: Array<Record<string, unknown>> };
      tags?: { nodes?: Array<Record<string, unknown>> };
    };
  };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asNullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asNullableNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

export async function getPhoto(params: GetPhotoInput): Promise<GetPhotoOutput> {
  const userId = getViewerUserId();
  const raw = await graphql<RawPhotoResponse>(
    userId,
    '25876389962040718',
    'CometPhotoRootContentQuery',
    {
      feedbackSource: 65,
      feedLocation: 'COMET_MEDIA_VIEWER',
      focusCommentID: null,
      isMediaset: false,
      mediasetToken: null,
      nodeID: params.nodeID,
      privacySelectorRenderLocation: 'COMET_MEDIA_VIEWER',
      renderLocation: 'comet_media_viewer',
      scale: 1,
      useDefaultActor: false,
      ...PHOTO_RELAY_PROVIDERS,
    },
  );

  const m = raw.data?.currMedia ?? {};
  const image = m.image as
    | { uri?: unknown; width?: unknown; height?: unknown }
    | undefined;
  const owner = m.owner as { id?: unknown; name?: unknown } | undefined;
  const creationStory = m.creation_story as { url?: unknown } | undefined;

  return {
    id: asString(m.id) || params.nodeID,
    accessibilityCaption: asNullableString(m.accessibility_caption),
    createdTime: asNullableNumber(m.created_time),
    imageUrl: asNullableString(image?.uri),
    imageWidth: asNullableNumber(image?.width),
    imageHeight: asNullableNumber(image?.height),
    permalinkUrl: asNullableString(creationStory?.url),
    ownerId: asNullableString(owner?.id),
    ownerName: asNullableString(owner?.name),
    canViewerEdit: m.can_viewer_edit === true,
    isPlayable: m.is_playable === true,
    raw: raw.data,
  };
}

export async function getPhotoTags(
  params: GetPhotoTagsInput,
): Promise<GetPhotoTagsOutput> {
  const userId = getViewerUserId();
  const raw = await graphql<RawPhotoTagsResponse>(
    userId,
    '24087149617645850',
    'CometPhotoTagLayerQuery',
    { nodeID: params.nodeID, scale: 1 },
  );

  const node = raw.data?.node;
  const tagNodes = node?.photo_tags?.nodes ?? node?.tags?.nodes ?? [];

  const tags = tagNodes.map((t) => {
    const subject = t.subject as
      | { id?: unknown; name?: unknown; url?: unknown }
      | undefined;
    return {
      id: asNullableString(subject?.id ?? t.id),
      name: asNullableString(subject?.name ?? t.text),
      url: asNullableString(subject?.url),
      x: asNullableNumber(t.x),
      y: asNullableNumber(t.y),
    };
  });

  return {
    nodeID: asString(node?.id) || params.nodeID,
    tags,
    raw: raw.data,
  };
}
