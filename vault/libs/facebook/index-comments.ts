/**
 * Facebook Library: Comment & Reaction (UFI) Functions
 *
 * Universal Feedback Interface mutations and reads. Every operation targets a
 * `feedback:{...}` base64 id that is attached to the post/photo/video/comment.
 */

import { getViewerUserId, graphql } from './helpers';
import type {
  CreateCommentInput,
  CreateCommentOutput,
  ReactToFeedbackInput,
  ReactToFeedbackOutput,
  ListReactorsInput,
  ListReactorsOutput,
  GetReactionsSummaryInput,
  GetReactorsByImportanceInput,
  GetReactionTooltipInput,
  StartTypingCommentInput,
  StopTypingCommentInput,
  GetMentionSuggestionsInput,
  GetMentionSuggestionsOutput,
  CommentsResponse,
} from './schemas-comments';

// Numeric reaction ids are stable across the platform.
const REACTION_IDS = {
  LIKE: '1635855486666999',
  LOVE: '1678524932434102',
  CARE: '613557422527858',
  HAHA: '115940658764963',
  WOW: '478547315650144',
  SAD: '908563459236466',
  ANGRY: '444813342392137',
} as const;

type ReactionName = keyof typeof REACTION_IDS;

function reactionToId(name: ReactionName): string {
  return REACTION_IDS[name];
}

const COMMENT_RELAY_PROVIDERS = {
  __relay_internal__pv__groups_comet_use_glvrelayprovider: false,
  __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
  __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
  __relay_internal__pv__IsWorkUserrelayprovider: false,
  __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:
    'ORIGINAL',
};

interface RawCreateCommentResponse {
  data?: {
    comment_create?: {
      feedback?: {
        id?: string;
        comment_rendering_instance?: { comments?: { total_count?: number } };
      };
      feedback_comment_edge?: {
        cursor?: string;
        node?: {
          id?: string;
          author?: { id?: string; name?: string };
        };
      };
    };
  };
}

export async function createComment(
  params: CreateCommentInput,
): Promise<CreateCommentOutput> {
  const userId = getViewerUserId();
  const idempotenceToken = `client:${crypto.randomUUID()}`;
  const sessionId = crypto.randomUUID();

  const raw = await graphql<RawCreateCommentResponse>(
    userId,
    '26571106175872836',
    'useCometUFICreateCommentMutation',
    {
      feedLocation: 'POST_PERMALINK_DIALOG',
      feedbackSource: 2,
      groupID: null,
      input: {
        actor_id: userId,
        client_mutation_id: '1',
        attachments: null,
        feedback_id: params.feedbackId,
        formatting_style: null,
        message: {
          ranges: params.messageRanges,
          text: params.text,
        },
        attribution_id_v2:
          'CometSinglePostDialogRoot.react,comet.post.single_dialog,unexpected,' +
          `${Date.now()},0,,,;CometHomeRoot.react,comet.home,via_cold_start,${Date.now()},0,,,`,
        vod_video_timestamp: null,
        is_tracking_encrypted: true,
        tracking: [],
        feedback_source: params.feedbackSource,
        idempotence_token: idempotenceToken,
        session_id: sessionId,
      },
      inviteShortLinkKey: null,
      renderLocation: null,
      scale: 1,
      useDefaultActor: false,
      focusCommentID: null,
      ...COMMENT_RELAY_PROVIDERS,
    },
  );

  const result = raw.data?.comment_create;
  const edge = result?.feedback_comment_edge;
  if (!edge?.node?.id) {
    throw new Error(
      `Facebook useCometUFICreateCommentMutation returned no comment edge for feedbackId=${params.feedbackId}.`,
    );
  }

  return {
    commentId: edge.node.id,
    cursor: edge.cursor ?? null,
    feedbackId: result?.feedback?.id ?? params.feedbackId,
    totalComments:
      result?.feedback?.comment_rendering_instance?.comments?.total_count ??
      null,
    authorId: edge.node.author?.id ?? null,
    authorName: edge.node.author?.name ?? null,
    raw: raw.data,
  };
}

interface RawReactResponse {
  data?: {
    feedback_react?: {
      feedback?: {
        id?: string;
        i18n_reaction_count?: string;
        reaction_count?: { count?: number };
        viewer_feedback_reaction_info?: { id?: string } | null;
        top_reactions?: {
          edges?: Array<{
            visible_in_bling_bar?: boolean;
            i18n_reaction_count?: string;
            reaction_count?: number;
            node?: { id?: string; localized_name?: string };
          }>;
        };
      };
    };
  };
}

export async function reactToFeedback(
  params: ReactToFeedbackInput,
): Promise<ReactToFeedbackOutput> {
  const userId = getViewerUserId();
  const reactionId = reactionToId(params.reaction);
  const sessionId = crypto.randomUUID();

  const raw = await graphql<RawReactResponse>(
    userId,
    '27045420388428225',
    'CometUFIFeedbackReactMutation',
    {
      input: {
        attribution_id_v2: `CometHomeRoot.react,comet.home,via_cold_start,${Date.now()},0,,,`,
        feedback_id: params.feedbackId,
        feedback_reaction_id: reactionId,
        feedback_source: params.feedbackSource,
        is_tracking_encrypted: true,
        tracking: [],
        session_id: sessionId,
        actor_id: userId,
        client_mutation_id: '1',
      },
      useDefaultActor: false,
      __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
    },
  );

  const fb = raw.data?.feedback_react?.feedback;
  const top = (fb?.top_reactions?.edges ?? []).map((edge) => ({
    id: edge.node?.id ?? '',
    name: edge.node?.localized_name ?? '',
    count: edge.reaction_count ?? 0,
    i18nCount: edge.i18n_reaction_count ?? '',
    visibleInBlingBar: edge.visible_in_bling_bar === true,
  }));

  return {
    feedbackId: fb?.id ?? params.feedbackId,
    viewerReactionId: fb?.viewer_feedback_reaction_info?.id ?? null,
    totalCount: fb?.reaction_count?.count ?? null,
    i18nTotalCount: fb?.i18n_reaction_count ?? null,
    topReactions: top,
    raw: raw.data,
  };
}

interface RawReactorsResponse {
  data?: {
    node?: {
      reactors?: {
        edges?: Array<{
          feedback_reaction_info?: { id?: string };
          node?: {
            id?: string;
            name?: string;
            profile_picture?: { uri?: string };
          };
        }>;
        page_info?: { has_next_page?: boolean; end_cursor?: string };
      };
    };
  };
}

export async function listReactors(
  params: ListReactorsInput,
): Promise<ListReactorsOutput> {
  const userId = getViewerUserId();
  const reactionId = params.reaction
    ? reactionToId(params.reaction)
    : reactionToId('LIKE');

  const raw = await graphql<RawReactorsResponse>(
    userId,
    '25576256592037408',
    'CometUFIReactionsDialogTabContentRefetchQuery',
    {
      count: params.count,
      cursor: params.cursor ?? null,
      feedbackTargetID: params.feedbackId,
      reactionID: reactionId,
      scale: 1,
      id: params.feedbackId,
    },
  );

  const reactorEdges = raw.data?.node?.reactors?.edges ?? [];
  const reactors = reactorEdges.map((edge) => ({
    id: edge.node?.id ?? '',
    name: edge.node?.name ?? null,
    profilePicUrl: edge.node?.profile_picture?.uri ?? null,
    reactionId: edge.feedback_reaction_info?.id ?? null,
  }));

  const pageInfo = raw.data?.node?.reactors?.page_info;
  return {
    reactors,
    nextCursor: pageInfo?.end_cursor ?? null,
    hasNextPage: pageInfo?.has_next_page === true,
    raw: raw.data,
  };
}

export async function getReactionsSummary(
  params: GetReactionsSummaryInput,
): Promise<CommentsResponse> {
  const userId = getViewerUserId();
  return graphql<CommentsResponse>(
    userId,
    '26547888478196893',
    'CometUFIReactionsDialogQuery',
    {
      feedbackTargetID: params.feedbackId,
      reactionID: reactionToId(params.reaction),
      scale: 1,
    },
  );
}

export async function getReactorsByImportance(
  params: GetReactorsByImportanceInput,
): Promise<CommentsResponse> {
  const userId = getViewerUserId();
  return graphql<CommentsResponse>(
    userId,
    '25460587863633246',
    'CometUFIReactionsDialogTabImportantContentRefetchQuery',
    {
      feedbackTargetID: params.feedbackId,
      reactionID: reactionToId(params.reaction),
      scale: 1,
      id: params.feedbackId,
    },
  );
}

export async function getReactionTooltip(
  params: GetReactionTooltipInput,
): Promise<CommentsResponse> {
  const userId = getViewerUserId();
  return graphql<CommentsResponse>(
    userId,
    '26417294487963485',
    'CometUFIReactionIconTooltipContentQuery',
    {
      feedbackTargetID: params.feedbackId,
      reactionID: reactionToId(params.reaction),
    },
  );
}

export async function startTypingComment(
  params: StartTypingCommentInput,
): Promise<CommentsResponse> {
  const userId = getViewerUserId();
  return graphql<CommentsResponse>(
    userId,
    '9815271091886179',
    'CometUFILiveTypingBroadcastMutation_StartMutation',
    {
      input: {
        feedback_id: params.feedbackId,
        session_id: params.sessionId,
        actor_id: userId,
        client_mutation_id: '1',
      },
    },
  );
}

export async function stopTypingComment(
  params: StopTypingCommentInput,
): Promise<CommentsResponse> {
  const userId = getViewerUserId();
  return graphql<CommentsResponse>(
    userId,
    '9972315006159780',
    'CometUFILiveTypingBroadcastMutation_StopMutation',
    {
      input: {
        feedback_id: params.feedbackId,
        session_id: params.sessionId,
        actor_id: userId,
        client_mutation_id: '1',
      },
    },
  );
}

interface RawMentionsResponse {
  data?: {
    xfb_tag_suggestion_search?: {
      suggestions?: Array<{
        eligibility?: { is_eligible?: boolean };
        subtext?: string;
        profile?: {
          __typename?: string;
          id?: string;
          name?: string;
          profile_picture?: { uri?: string };
        };
      }>;
    };
  };
}

export async function getMentionSuggestions(
  params: GetMentionSuggestionsInput,
): Promise<GetMentionSuggestionsOutput> {
  const userId = getViewerUserId();
  const sessionId = crypto.randomUUID();
  const raw = await graphql<RawMentionsResponse>(
    userId,
    '25872647982320641',
    'useFeedComposerCometMentionsBootloadDataSourceWithTaggingTransparencyQuery',
    {
      limit: params.limit,
      profile_id: userId,
      mention_types: params.mentionTypes,
      tag_type: 'MENTION',
      session_id: sessionId,
      scale: 1,
      post_id: '',
      surface: 'FEED_COMPOSER',
    },
  );

  const list = raw.data?.xfb_tag_suggestion_search?.suggestions ?? [];
  const suggestions = list.map((s) => ({
    id: s.profile?.id ?? '',
    name: s.profile?.name ?? null,
    type: s.profile?.__typename ?? 'Unknown',
    pictureUrl: s.profile?.profile_picture?.uri ?? null,
    subtext: s.subtext ?? null,
    isEligible: s.eligibility?.is_eligible === true,
  }));

  return { suggestions, raw: raw.data };
}
