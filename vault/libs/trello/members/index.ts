import { getDsc, apiUrl, apiFetch } from '../helpers';
import { ContractDrift } from '@vallum/_runtime';
import type {
  GetContextInput,
  GetContextOutput,
  GetMeInput,
  GetMeOutput,
  GetMemberInput,
  GetMemberOutput,
  ListBoardMembersInput,
  ListBoardMembersOutput,
  AddMemberToCardInput,
  AddMemberToCardOutput,
  RemoveMemberFromCardInput,
  RemoveMemberFromCardOutput,
} from './schemas';

export async function getContext(
  _params: GetContextInput,
): Promise<GetContextOutput> {
  const dsc = getDsc();
  const res = await apiFetch(apiUrl('members/me'));
  const member = await res.json();
  return {
    dsc,
    memberId: member.id,
    username: member.username,
    fullName: member.fullName,
  };
}

export async function getMe(params: GetMeInput): Promise<GetMeOutput> {
  const qs = new URLSearchParams({ fields: 'all' });
  if (params.boards !== undefined) qs.set('boards', params.boards);
  if (params.board_fields !== undefined)
    qs.set('board_fields', params.board_fields);
  if (params.organizations !== undefined)
    qs.set('organizations', params.organizations);
  if (params.organization_fields !== undefined)
    qs.set('organization_fields', params.organization_fields);
  if (params.cards !== undefined) qs.set('cards', params.cards);
  if (params.boardStars !== undefined)
    qs.set('boardStars', String(params.boardStars));

  const res = await apiFetch(apiUrl(`members/me?${qs.toString()}`));
  const m = await res.json();

  return {
    id: m.id,
    username: m.username,
    fullName: m.fullName,
    email: m.email,
    avatarUrl: m.avatarUrl,
    initials: m.initials,
    bio: m.bio,
    url: m.url,
    idBoards: m.idBoards,
    idOrganizations: m.idOrganizations,
    confirmed: m.confirmed,
    memberType: m.memberType,
    prefs: m.prefs,
    ...(m.boards !== undefined && { boards: m.boards }),
    ...(m.organizations !== undefined && { organizations: m.organizations }),
    ...(m.cards !== undefined && { cards: m.cards }),
    ...(m.boardStars !== undefined && { boardStars: m.boardStars }),
  };
}

export async function getMember(
  params: GetMemberInput,
): Promise<GetMemberOutput> {
  const {
    memberId,
    fields,
    boards,
    board_fields,
    organizations,
    organization_fields,
    cards,
    card_fields,
    actions,
    actions_limit,
    boardStars,
    boardsInvited,
    boardsInvited_fields,
    organizationsInvited,
    organizationsInvited_fields,
  } = params;

  const query = new URLSearchParams();
  if (fields !== undefined) query.set('fields', fields);
  if (boards !== undefined) query.set('boards', boards);
  if (board_fields !== undefined) query.set('board_fields', board_fields);
  if (organizations !== undefined) query.set('organizations', organizations);
  if (organization_fields !== undefined)
    query.set('organization_fields', organization_fields);
  if (cards !== undefined) query.set('cards', cards);
  if (card_fields !== undefined) query.set('card_fields', card_fields);
  if (actions !== undefined) query.set('actions', actions);
  if (actions_limit !== undefined)
    query.set('actions_limit', String(actions_limit));
  if (boardStars !== undefined) query.set('boardStars', String(boardStars));
  if (boardsInvited !== undefined) query.set('boardsInvited', boardsInvited);
  if (boardsInvited_fields !== undefined)
    query.set('boardsInvited_fields', boardsInvited_fields);
  if (organizationsInvited !== undefined)
    query.set('organizationsInvited', organizationsInvited);
  if (organizationsInvited_fields !== undefined)
    query.set('organizationsInvited_fields', organizationsInvited_fields);

  const queryStr = query.toString();
  const url = queryStr
    ? apiUrl(`members/${memberId}?${queryStr}`)
    : apiUrl(`members/${memberId}`);
  const res = await apiFetch(url);
  const m = await res.json();

  return {
    id: m.id,
    username: m.username,
    fullName: m.fullName,
    avatarUrl: m.avatarUrl,
    initials: m.initials,
    url: m.url,
    bio: m.bio,
    ...(m.boards !== undefined && { boards: m.boards }),
    ...(m.organizations !== undefined && { organizations: m.organizations }),
    ...(m.cards !== undefined && { cards: m.cards }),
    ...(m.actions !== undefined && { actions: m.actions }),
    ...(m.boardStars !== undefined && { boardStars: m.boardStars }),
    ...(m.boardsInvited !== undefined && { boardsInvited: m.boardsInvited }),
    ...(m.organizationsInvited !== undefined && {
      organizationsInvited: m.organizationsInvited,
    }),
  };
}

export async function listBoardMembers(
  params: ListBoardMembersInput,
): Promise<ListBoardMembersOutput> {
  const { boardId, filter, activity } = params;

  if (filter === 'owners') {
    // /boards/:id/memberships does not support 'owners' filter; fall back to
    // the members endpoint for the filtered list, then fetch memberships
    // separately to get the correct board-level memberType.
    const membersQs = new URLSearchParams({
      filter: 'owners',
      fields: 'id,username,fullName,avatarUrl,initials',
    });
    if (activity) membersQs.set('activity', 'true');

    const [membersRes, membershipsRes] = await Promise.all([
      apiFetch(apiUrl(`boards/${boardId}/members?${membersQs.toString()}`)),
      apiFetch(apiUrl(`boards/${boardId}/memberships`)),
    ]);

    const membersData = await membersRes.json();
    const membershipsData = await membershipsRes.json();

    if (!Array.isArray(membersData)) {
      throw new ContractDrift(
        `Trello listBoardMembers: expected array from GET /1/boards/${boardId}/members, got ${typeof membersData}`,
      );
    }
    if (!Array.isArray(membershipsData)) {
      throw new ContractDrift(
        `Trello listBoardMembers: expected array from GET /1/boards/${boardId}/memberships, got ${typeof membershipsData}`,
      );
    }

    const roleMap = new Map<string, 'admin' | 'normal' | 'observer'>();
    for (const ms of membershipsData as Array<{
      idMember: string;
      memberType: 'admin' | 'normal' | 'observer';
    }>) {
      roleMap.set(ms.idMember, ms.memberType);
    }

    const members = (
      membersData as Array<{
        id: string;
        username: string;
        fullName: string;
        avatarUrl: string | null;
        initials: string;
        lastActive?: string | null;
      }>
    ).map((m) => ({
      id: m.id,
      username: m.username,
      fullName: m.fullName,
      avatarUrl: m.avatarUrl ?? null,
      initials: m.initials,
      memberType: roleMap.get(m.id) ?? ('admin' as const),
      ...(activity && { lastActive: m.lastActive ?? null }),
    }));

    return { members };
  }

  // Return empty immediately; no API call needed.
  if (filter === 'none') return { members: [] };

  // Use /boards/:id/memberships to get board-level memberType (admin/normal/observer).
  // The /boards/:id/members endpoint returns Atlassian account tier, not board role.
  // NOTE: the memberships endpoint filter param is unreliable; filter client-side instead.
  const qs = new URLSearchParams({
    member: 'true',
    member_fields: 'id,username,fullName,avatarUrl,initials',
  });
  if (activity) qs.set('activity', 'true');

  const res = await apiFetch(
    apiUrl(`boards/${boardId}/memberships?${qs.toString()}`),
  );
  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new ContractDrift(
      `Trello listBoardMembers: expected array from GET /1/boards/${boardId}/memberships, got ${typeof data}`,
    );
  }

  type Membership = {
    memberType: 'admin' | 'normal' | 'observer';
    deactivated: boolean;
    lastActive?: string | null;
    member: {
      id: string;
      username: string;
      fullName: string;
      avatarUrl: string | null;
      initials: string;
    };
  };

  let memberships = (data as Membership[]).filter((m) => !m.deactivated);

  if (filter === 'admins') {
    memberships = memberships.filter((m) => m.memberType === 'admin');
  } else if (filter === 'normal') {
    memberships = memberships.filter((m) => m.memberType === 'normal');
  }

  const members = memberships.map((m) => ({
    id: m.member.id,
    username: m.member.username,
    fullName: m.member.fullName,
    avatarUrl: m.member.avatarUrl ?? null,
    initials: m.member.initials,
    memberType: m.memberType,
    ...(activity && { lastActive: m.lastActive ?? null }),
  }));

  return { members };
}

export async function addMemberToCard(
  params: AddMemberToCardInput,
): Promise<AddMemberToCardOutput> {
  const { dsc, cardId, memberId } = params;

  const res = await apiFetch(apiUrl(`cards/${cardId}/idMembers`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: memberId, dsc }),
  });

  const data = await res.json();

  const members = Array.isArray(data)
    ? data.map(
        (m: {
          id: string;
          username: string;
          fullName: string;
          initials: string;
          avatarUrl: string | null;
        }) => ({
          id: m.id,
          username: m.username,
          fullName: m.fullName,
          initials: m.initials,
          avatarUrl: m.avatarUrl,
        }),
      )
    : [];

  return { members };
}

export async function removeMemberFromCard(
  params: RemoveMemberFromCardInput,
): Promise<RemoveMemberFromCardOutput> {
  const { dsc, cardId, memberId } = params;

  await apiFetch(apiUrl(`cards/${cardId}/idMembers/${memberId}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsc }),
  });

  return { success: true };
}
