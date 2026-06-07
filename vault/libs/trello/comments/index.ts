import { apiUrl, apiFetch } from '../helpers';
import { Validation } from '@vallum/_runtime';
import type {
  ListCommentsInput,
  ListCommentsOutput,
  CreateCommentInput,
  CreateCommentOutput,
  UpdateCommentInput,
  UpdateCommentOutput,
  DeleteCommentInput,
  DeleteCommentOutput,
} from './schemas';

// ============================================================================
// Response Shape
// ============================================================================

interface RawActionMemberCreator {
  id: string;
  username: string;
  fullName: string;
  initials: string;
  avatarUrl: string | null;
}

interface RawReactionMember {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  initials: string;
  activityBlocked: boolean;
  nonPublicAvailable: boolean;
}

interface RawReactionEmoji {
  unified: string;
  name: string;
  native: string;
  shortName: string;
  skinVariation: string | null;
}

interface RawReaction {
  id: string;
  idMember: string;
  idModel: string;
  idEmoji: string;
  member: RawReactionMember;
  emoji: RawReactionEmoji;
}

interface RawAction {
  id: string;
  type: 'commentCard';
  date: string;
  data: {
    text: string;
    card: { id: string; name: string; shortLink: string };
    board: { id: string; name: string; shortLink: string };
    list: { id: string; name: string; color: string | null };
    dateLastEdited?: string;
  };
  memberCreator: RawActionMemberCreator;
  reactions?: RawReaction[];
}

function mapAction(a: RawAction): ListCommentsOutput['comments'][number] {
  const mapped: ListCommentsOutput['comments'][number] = {
    id: a.id,
    type: a.type,
    date: a.date,
    data: {
      text: a.data.text,
      card: {
        id: a.data.card.id,
        name: a.data.card.name,
        shortLink: a.data.card.shortLink,
      },
      board: {
        id: a.data.board.id,
        name: a.data.board.name,
        shortLink: a.data.board.shortLink,
      },
      list: {
        id: a.data.list.id,
        name: a.data.list.name,
        color: a.data.list.color,
      },
      ...(a.data.dateLastEdited !== undefined
        ? { dateLastEdited: a.data.dateLastEdited }
        : {}),
    },
    memberCreator: {
      id: a.memberCreator.id,
      username: a.memberCreator.username,
      fullName: a.memberCreator.fullName,
      initials: a.memberCreator.initials,
      avatarUrl: a.memberCreator.avatarUrl,
    },
  };

  if (a.reactions !== undefined) {
    mapped.reactions = a.reactions.map((r) => ({
      id: r.id,
      idMember: r.idMember,
      idModel: r.idModel,
      idEmoji: r.idEmoji,
      member: {
        id: r.member.id,
        username: r.member.username,
        fullName: r.member.fullName,
        avatarUrl: r.member.avatarUrl,
        initials: r.member.initials,
        activityBlocked: r.member.activityBlocked,
        nonPublicAvailable: r.member.nonPublicAvailable,
      },
      emoji: {
        unified: r.emoji.unified,
        name: r.emoji.name,
        native: r.emoji.native,
        shortName: r.emoji.shortName,
        skinVariation: r.emoji.skinVariation,
      },
    }));
  }

  return mapped;
}

// ============================================================================
// Functions
// ============================================================================

export async function listComments(
  params: ListCommentsInput,
): Promise<ListCommentsOutput> {
  const { cardId, limit = 50, since, reactions } = params;

  if (limit <= 0) {
    throw new Validation(`listComments: limit must be at least 1, got ${limit}`);
  }

  const comments: ListCommentsOutput['comments'] = [];
  let before: string | undefined;

  while (true) {
    let qs = `filter=commentCard&limit=${limit}`;
    if (since) qs += `&since=${encodeURIComponent(since)}`;
    if (before) qs += `&before=${before}`;
    if (reactions) qs += `&reactions=true`;

    const url = apiUrl(`cards/${cardId}/actions?${qs}`);
    const res = await apiFetch(url);
    const page: RawAction[] = await res.json();

    for (const action of page) {
      comments.push(mapAction(action));
    }

    if (page.length < limit) break;
    before = page[page.length - 1].id;
  }

  return { comments };
}

export async function createComment(
  params: CreateCommentInput,
): Promise<CreateCommentOutput> {
  const { dsc, cardId, text } = params;

  const res = await apiFetch(apiUrl(`cards/${cardId}/actions/comments`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, dsc }),
  });

  const action: RawAction = await res.json();
  return { comment: mapAction(action) };
}

export async function updateComment(
  params: UpdateCommentInput,
): Promise<UpdateCommentOutput> {
  const { dsc, cardId, actionId, text } = params;

  const res = await apiFetch(
    apiUrl(`cards/${cardId}/actions/${actionId}/comments`),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, dsc }),
    },
  );

  const action: RawAction = await res.json();
  return { comment: mapAction(action) };
}

export async function deleteComment(
  params: DeleteCommentInput,
): Promise<DeleteCommentOutput> {
  const { dsc, cardId, actionId } = params;

  await apiFetch(apiUrl(`cards/${cardId}/actions/${actionId}/comments`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsc }),
  });

  return { success: true };
}
