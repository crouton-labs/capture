/**
 * Instagram Library: Core Context
 *
 * getContext: Extract authentication and session context from the browser.
 */

import { getCookie, getRequire, getAppId, getClientRevision } from './helpers';
import { Unauthenticated } from '@vallum/_runtime';
import type { GetContextOutput } from './schemas';

interface PolarisViewerData {
  data?: {
    id?: string;
    username?: string;
    full_name?: string;
    fbid?: string;
    is_private?: boolean;
  };
  id?: string;
}

export async function getContext(): Promise<GetContextOutput> {
  const csrf = getCookie('csrftoken');
  if (!csrf) {
    throw new Unauthenticated(
      `CSRF token not found in cookies. Are you logged into Instagram? URL: ${window.location.href}`,
    );
  }

  const userId = getCookie('ds_user_id');
  if (!userId) {
    throw new Unauthenticated(
      `User ID (ds_user_id) not found in cookies. Are you logged into Instagram? URL: ${window.location.href}`,
    );
  }

  const appId = getAppId();

  // Viewer data from PolarisViewer module
  let username = '';
  let fbid = '';
  let fullName = '';
  let isPrivate = false;
  const requireFn = getRequire();
  if (requireFn) {
    try {
      const viewer = requireFn('PolarisViewer') as
        | PolarisViewerData
        | undefined;
      if (viewer?.data?.username) {
        username = viewer.data.username;
      }
      if (viewer?.data?.fbid) {
        fbid = viewer.data.fbid;
      }
      if (viewer?.data?.full_name) {
        fullName = viewer.data.full_name;
      }
      if (viewer?.data?.is_private != null) {
        isPrivate = !!viewer.data.is_private;
      }
    } catch {
      /* module not available */
    }
  }

  // Device ID from localStorage (used for DM iris subscriptions)
  let deviceId = '';
  try {
    deviceId = localStorage.getItem('chatd-deviceid') || '';
  } catch {
    /* localStorage may be blocked */
  }
  if (!deviceId) {
    deviceId = getCookie('mid') || '';
  }

  // Ajax version from SiteData module
  const ajaxVersion = getClientRevision();

  // Claim token from cookie
  const claimToken = getCookie('x-ig-www-claim') || '0';

  return {
    csrf,
    userId,
    username,
    fbid,
    fullName,
    isPrivate,
    appId,
    deviceId,
    ajaxVersion,
    claimToken,
  };
}
