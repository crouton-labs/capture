import {
  getDtsgToken,
  getLsdToken,
  getAsbdId,
  getViewerUserId,
  getRequire,
} from './helpers';
import type { GetContextOutput } from './schemas-common';

export async function getContext(): Promise<GetContextOutput> {
  if (!window.location.hostname.endsWith('facebook.com')) {
    throw new Error(
      `Not on facebook.com (current: ${window.location.hostname}). Navigate to https://www.facebook.com/ first.`,
    );
  }
  const req = getRequire();
  if (!req) {
    throw new Error(
      'Meta require() not available. The page is not a Comet-rendered Facebook page.',
    );
  }

  const dtsg = getDtsgToken();
  const lsd = getLsdToken();
  const asbdId = getAsbdId();
  const userId = getViewerUserId();

  if (userId === '0') {
    throw new Error(
      'Viewer user id not found. Likely logged out. Log in at https://www.facebook.com/ and retry.',
    );
  }

  return {
    userId,
    fbDtsg: dtsg,
    lsd,
    asbdId,
    origin: window.location.origin,
  };
}
