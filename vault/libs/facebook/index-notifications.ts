import { getViewerUserId, graphql } from './helpers';
import type {
  ListNotificationsInput,
  NotificationsResponse,
} from './schemas-notifications';

export async function listNotifications(
  params: ListNotificationsInput,
): Promise<NotificationsResponse> {
  const userId = getViewerUserId();
  return graphql<NotificationsResponse>(
    userId,
    '25911731828525772',
    'CometNotificationsDropdownQuery',
    {
      count: params.count,
      environment: params.environment,
      scale: 1,
    },
  );
}
