/**
 * Slack Bookmark Operations
 *
 * Manage channel bookmarks.
 */

import type {
  BookmarksAddInput,
  BookmarksAddOutput,
  BookmarksListInput,
  BookmarksListOutput,
  BookmarksEditInput,
  BookmarksEditOutput,
  BookmarksRemoveInput,
  BookmarksRemoveOutput,
} from '../schemas';
import { slackApi } from '../helpers';

export async function bookmarksAdd(
  params: BookmarksAddInput,
): Promise<BookmarksAddOutput> {
  return slackApi<BookmarksAddOutput>('bookmarks.add', params.token, params);
}

export async function bookmarksList(
  params: BookmarksListInput,
): Promise<BookmarksListOutput> {
  return slackApi<BookmarksListOutput>('bookmarks.list', params.token, params);
}

export async function bookmarksEdit(
  params: BookmarksEditInput,
): Promise<BookmarksEditOutput> {
  return slackApi<BookmarksEditOutput>('bookmarks.edit', params.token, params);
}

export async function bookmarksRemove(
  params: BookmarksRemoveInput,
): Promise<BookmarksRemoveOutput> {
  return slackApi<BookmarksRemoveOutput>(
    'bookmarks.remove',
    params.token,
    params,
  );
}
