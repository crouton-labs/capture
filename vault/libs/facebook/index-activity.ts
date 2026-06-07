import { getViewerUserId, graphql } from './helpers';
import type {
  ListActivityLogInput,
  GetActivityLogViewerInput,
  CurateActivityLogItemInput,
  CurateActivityLogItemOutput,
  ActivityResponse,
} from './schemas-activity';

export async function listActivityLog(
  params: ListActivityLogInput,
): Promise<ActivityResponse> {
  const userId = getViewerUserId();
  return graphql<ActivityResponse>(
    userId,
    '27535951789328477',
    'CometActivityLogMainContentRootQuery',
    {
      activity_history: false,
      audience: null,
      ayi_taxonomy: true,
      category: params.category,
      category_key: params.category,
      count: params.count,
      cursor: params.cursor ?? null,
      entry_point: null,
      media_content_filters: [],
      month: params.month ?? null,
      person_id: null,
      privacy: 'NONE',
      scale: 1,
      timeline_visibility: 'ALL',
      year: params.year ?? null,
    },
    { routeName: 'comet.fbweb.CometActivityLogMainContentRootRoute' },
  );
}

export async function getActivityLogViewer(
  _params: GetActivityLogViewerInput,
): Promise<ActivityResponse> {
  const userId = getViewerUserId();
  return graphql<ActivityResponse>(
    userId,
    '25249943571348322',
    'CometActivityLogViewViewerQuery',
    {
      activity_history: false,
      ayi_taxonomy: true,
      manage_mode: false,
    },
  );
}

interface RawCurationResponse {
  data?: {
    activity_log_story_curation?: {
      story?: { id?: string };
      success?: boolean;
      error?: unknown;
    };
  };
}

export async function curateActivityLogItem(
  params: CurateActivityLogItemInput,
): Promise<CurateActivityLogItemOutput> {
  const userId = getViewerUserId();
  const raw = await graphql<RawCurationResponse>(
    userId,
    '24411931498505270',
    'CometActivityLogItemCurationMutation',
    {
      input: {
        action: params.action,
        category_key: params.categoryKey,
        deletion_request_id: null,
        post_id_str: params.postId,
        story_id: params.storyId,
        story_location: params.storyLocation,
        structured_error_handling: true,
        actor_id: userId,
        client_mutation_id: '1',
      },
    },
    { routeName: 'comet.fbweb.CometActivityLogMainContentRootRoute' },
  );

  const result = raw.data?.activity_log_story_curation;
  return {
    success: result?.success === true,
    storyId: result?.story?.id ?? null,
    error: result?.error ?? null,
    raw: raw.data,
  };
}
