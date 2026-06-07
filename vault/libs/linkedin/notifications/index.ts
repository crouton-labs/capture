/**
 * LinkedIn Notifications Operations
 *
 * View notifications and activity alerts.
 */

import { linkedinFetch } from '../helpers';
import type {
  ListNotificationsOutput,
  GetNotificationCountsOutput,
} from '../schemas';

const FILTER_MAP: Record<string, string> = {
  ALL: 'ALL',
  JOBS: 'JOBS_ALL',
  MY_POSTS: 'MY_POSTS_ALL',
  MENTIONS: 'MENTIONS',
};

export async function listNotifications(opts: {
  csrf: string;
  start?: number;
  count?: number;
  filter?: string;
}): Promise<ListNotificationsOutput> {
  const start = opts.start !== undefined ? opts.start : 0;
  const count = opts.count !== undefined ? opts.count : 10;
  const filterKey = opts.filter || 'ALL';
  const filterValue = FILTER_MAP[filterKey] || 'ALL';

  interface NotificationsResponse {
    data?: {
      elements?: unknown[];
      paging?: {
        total?: number;
        count?: number;
        start?: number;
      };
    };
    included?: Array<{
      entityUrn?: string;
      $type?: string;
      headline?: { text?: string };
      read?: boolean;
      publishedAt?: number;
      cardAction?: {
        actionTarget?: string;
      };
      actions?: Array<{
        actionTarget?: string;
      }>;
    }>;
  }

  const filterUrn = encodeURIComponent(
    `urn:li:fsd_notificationFilter:${filterValue}`,
  );
  const resp = await linkedinFetch<NotificationsResponse>(
    opts.csrf,
    `/voyager/api/voyagerIdentityDashNotificationCards?decorationId=com.linkedin.voyager.dash.deco.identity.notifications.CardsCollection-80&count=${count}&filterUrn=${filterUrn}&q=notifications&start=${start}`,
  );

  const notifications: ListNotificationsOutput['notifications'] = [];

  if (resp.included) {
    for (const entity of resp.included) {
      if (
        !entity.$type?.includes('Card') ||
        !entity.entityUrn?.includes('fsd_notification')
      ) {
        continue;
      }

      // Extract action target from cardAction or first action
      let actionTarget: string | undefined;
      if (entity.cardAction?.actionTarget) {
        actionTarget = entity.cardAction.actionTarget;
      } else if (entity.actions?.length && entity.actions[0].actionTarget) {
        actionTarget = entity.actions[0].actionTarget;
      }

      // Extract notification type from entityUrn
      // Format: urn:li:fsd_notificationCard:(TYPE,...)
      let notificationType: string | undefined;
      const typeMatch = entity.entityUrn?.match(
        /fsd_notificationCard:\(([^,)]+)/,
      );
      if (typeMatch) {
        notificationType = typeMatch[1];
      }

      notifications.push({
        entityUrn: entity.entityUrn,
        headline: entity.headline?.text,
        read: entity.read,
        publishedAt: entity.publishedAt,
        actionTarget,
        notificationType,
      });
    }
  }

  const paging = resp.data?.paging;

  return {
    notifications,
    paging: {
      start: paging?.start !== undefined ? paging.start : start,
      count: paging?.count !== undefined ? paging.count : notifications.length,
      total: paging?.total,
    },
  };
}

export async function getNotificationCounts(opts: {
  csrf: string;
}): Promise<GetNotificationCountsOutput> {
  interface BadgingResponse {
    data?: {
      elements?: Array<{
        count?: number;
        badgingItem?: string;
      }>;
    };
  }

  const resp = await linkedinFetch<BadgingResponse>(
    opts.csrf,
    '/voyager/api/voyagerNotificationsDashBadgingItemCounts',
  );

  const counts: GetNotificationCountsOutput['counts'] = {
    notifications: 0,
    messaging: 0,
    myNetwork: 0,
    nurture: 0,
  };

  if (resp.data?.elements) {
    for (const el of resp.data.elements) {
      switch (el.badgingItem) {
        case 'NOTIFICATIONS':
          counts.notifications = el.count || 0;
          break;
        case 'MESSAGING':
          counts.messaging = el.count || 0;
          break;
        case 'MY_NETWORK':
          counts.myNetwork = el.count || 0;
          break;
        case 'NURTURE':
          counts.nurture = el.count || 0;
          break;
      }
    }
  }

  return { counts };
}
