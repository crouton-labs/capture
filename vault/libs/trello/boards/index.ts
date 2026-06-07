import { apiUrl, apiFetch } from '../helpers';
import { ContractDrift } from '@vallum/_runtime';
import type {
  ListBoardsInput,
  ListBoardsOutput,
  GetBoardInput,
  GetBoardOutput,
  CreateBoardInput,
  CreateBoardOutput,
  UpdateBoardInput,
  UpdateBoardOutput,
  CloseBoardInput,
  CloseBoardOutput,
  DeleteBoardInput,
  DeleteBoardOutput,
  ListWorkspacesInput,
  ListWorkspacesOutput,
  GetWorkspaceInput,
  GetWorkspaceOutput,
} from './schemas';

export async function listBoards(
  params: ListBoardsInput,
): Promise<ListBoardsOutput> {
  const filter = params.filter ?? 'open';
  // board_fields required: the boards embed omits shortLink and url by default
  const boardFields = 'id,name,shortLink,url,closed,idOrganization,starred';
  const res = await apiFetch(
    apiUrl(
      `members/me?boards=${filter}&organizations=all&board_fields=${boardFields}`,
    ),
  );
  const data = await res.json();

  const boards = (data.boards ?? []).map(
    (b: {
      id: string;
      name: string;
      shortLink?: string;
      url?: string;
      closed: boolean;
      idOrganization: string | null;
      starred: boolean;
    }) => ({
      id: b.id,
      name: b.name,
      shortLink: b.shortLink,
      url: b.url,
      closed: b.closed,
      idOrganization: b.idOrganization,
      starred: b.starred,
    }),
  );

  const organizations = (data.organizations ?? []).map(
    (o: { id: string; displayName: string; name: string; url?: string }) => ({
      id: o.id,
      displayName: o.displayName,
      name: o.name,
      url: o.url,
    }),
  );

  return { boards, organizations };
}

export async function getBoard(params: GetBoardInput): Promise<GetBoardOutput> {
  const fields =
    'name,desc,closed,url,shortLink,prefs,labelNames,idOrganization';
  const query = new URLSearchParams({ fields });

  if (params.lists !== undefined) query.set('lists', params.lists);
  if (params.members !== undefined) query.set('members', params.members);
  if (params.cards !== undefined) query.set('cards', params.cards);
  if (params.labels !== undefined) query.set('labels', params.labels);
  if (params.organization !== undefined)
    query.set('organization', String(params.organization));
  if (params.checklists !== undefined)
    query.set('checklists', params.checklists);
  if (params.myPrefs !== undefined)
    query.set('myPrefs', String(params.myPrefs));
  if (params.pluginData !== undefined)
    query.set('pluginData', String(params.pluginData));
  if (params.boardStars !== undefined)
    query.set('boardStars', params.boardStars);
  if (params.actions !== undefined) query.set('actions', params.actions);
  if (params.actions_limit !== undefined)
    query.set('actions_limit', String(params.actions_limit));

  const res = await apiFetch(
    apiUrl(`boards/${params.boardId}?${query.toString()}`),
  );
  const b = await res.json();

  if (!b.prefs)
    throw new ContractDrift(
      `Trello getBoard: missing prefs in response for board ${params.boardId}`,
    );
  if (!b.labelNames)
    throw new ContractDrift(
      `Trello getBoard: missing labelNames in response for board ${params.boardId}`,
    );

  return {
    board: {
      id: b.id,
      name: b.name,
      desc: b.desc,
      closed: b.closed,
      url: b.url,
      shortLink: b.shortLink,
      prefs: b.prefs,
      labelNames: b.labelNames,
      idOrganization: b.idOrganization ?? null,
      ...(b.lists !== undefined && { lists: b.lists }),
      ...(b.members !== undefined && { members: b.members }),
      ...(b.cards !== undefined && { cards: b.cards }),
      ...(b.labels !== undefined && { labels: b.labels }),
      ...(b.checklists !== undefined && { checklists: b.checklists }),
      ...(b.organization !== undefined && { organization: b.organization }),
      ...(b.myPrefs !== undefined && { myPrefs: b.myPrefs }),
      ...(b.pluginData !== undefined && { pluginData: b.pluginData }),
      ...(b.boardStars !== undefined && { boardStars: b.boardStars }),
      ...(b.actions !== undefined && { actions: b.actions }),
    },
  };
}

export async function createBoard(
  params: CreateBoardInput,
): Promise<CreateBoardOutput> {
  const {
    dsc,
    name,
    desc,
    idOrganization,
    defaultLists,
    prefs_permissionLevel,
    prefs_background,
    prefs_background_url,
    prefs_selfJoin,
  } = params;

  const body: Record<string, unknown> = { name, dsc };
  if (desc !== undefined) body.desc = desc;
  if (idOrganization !== undefined) body.idOrganization = idOrganization;
  if (defaultLists !== undefined) body.defaultLists = defaultLists;
  if (prefs_permissionLevel !== undefined)
    body.prefs_permissionLevel = prefs_permissionLevel;
  if (prefs_background !== undefined) body.prefs_background = prefs_background;
  if (prefs_background_url !== undefined)
    body.prefs_background_url = prefs_background_url;
  if (prefs_selfJoin !== undefined) body.prefs_selfJoin = prefs_selfJoin;

  // ?fields=all returns shortUrl (full short URL) and url in POST response
  const res = await apiFetch(apiUrl('boards?fields=all'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const b = await res.json();

  // POST returns shortUrl (e.g. "https://trello.com/b/SLUG"), not shortLink.
  // Extract the slug from the URL path segment.
  const shortLink: string = b.url
    ? (b.url as string).split('/b/')[1].split('/')[0]
    : '';

  return {
    board: {
      id: b.id,
      name: b.name,
      desc: b.desc,
      closed: b.closed,
      shortLink,
      url: b.url,
      idOrganization: b.idOrganization ?? null,
    },
  };
}

export async function updateBoard(
  params: UpdateBoardInput,
): Promise<UpdateBoardOutput> {
  const { dsc, boardId, name, desc, closed, subscribed, prefs } = params;

  const body: Record<string, unknown> = { dsc };
  if (name !== undefined) body.name = name;
  if (desc !== undefined) body.desc = desc;
  if (closed !== undefined) body.closed = closed;
  if (subscribed !== undefined) body.subscribed = subscribed;

  // Trello accepts prefs sub-fields as "prefs/fieldName" keys in the body
  if (prefs) {
    for (const [k, v] of Object.entries(prefs)) {
      if (v !== undefined) body[`prefs/${k}`] = v;
    }
  }

  const res = await apiFetch(apiUrl(`boards/${boardId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const b = await res.json();

  // PUT /1/boards/:id returns shortUrl (e.g. "https://trello.com/b/JRX8Zj2a"), not shortLink.
  // Extract the slug from the URL path segment.
  const shortLink: string = b.shortUrl
    ? (b.shortUrl as string).split('/b/')[1].split('/')[0]
    : b.url
      ? (b.url as string).split('/b/')[1].split('/')[0]
      : '';

  return {
    board: {
      id: b.id,
      name: b.name,
      desc: b.desc,
      closed: b.closed,
      shortLink,
      url: b.url,
      idOrganization: b.idOrganization ?? null,
    },
  };
}

export async function closeBoard(
  params: CloseBoardInput,
): Promise<CloseBoardOutput> {
  const { dsc, boardId, subscribed } = params;

  const body: Record<string, unknown> = { closed: true, dsc };
  if (subscribed !== undefined) body.subscribed = subscribed;

  await apiFetch(apiUrl(`boards/${boardId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return { success: true };
}

export async function deleteBoard(
  params: DeleteBoardInput,
): Promise<DeleteBoardOutput> {
  const { dsc, boardId } = params;

  await apiFetch(apiUrl(`boards/${boardId}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsc }),
  });

  return { success: true };
}

export async function listWorkspaces(
  params: ListWorkspacesInput,
): Promise<ListWorkspacesOutput> {
  const orgFilter = params.organizations ?? 'all';
  const query = new URLSearchParams({
    organizations: orgFilter,
    fields: 'none',
  });

  if (params.organization_fields !== undefined)
    query.set('organization_fields', params.organization_fields);
  if (params.organizationsInvited !== undefined)
    query.set('organizationsInvited', params.organizationsInvited);
  if (params.organizationsInvited_fields !== undefined)
    query.set(
      'organizationsInvited_fields',
      params.organizationsInvited_fields,
    );

  const res = await apiFetch(apiUrl(`members/me?${query.toString()}`));
  const data = await res.json();

  type OrgShape = {
    id: string;
    displayName: string;
    name: string;
    url?: string;
    logoUrl?: string | null;
    [key: string]: unknown;
  };

  const mapOrg = (o: OrgShape) => ({
    ...o,
    logoUrl: o.logoUrl ?? null,
  });

  const workspaces = (data.organizations ?? []).map(mapOrg);

  const result: ListWorkspacesOutput = { workspaces };

  if (data.organizationsInvited !== undefined) {
    result.workspacesInvited = (data.organizationsInvited as OrgShape[]).map(
      mapOrg,
    );
  }

  return result;
}

export async function getWorkspace(
  params: GetWorkspaceInput,
): Promise<GetWorkspaceOutput> {
  // ?fields=all required for premiumFeatures and memberships to be included in response
  const query = new URLSearchParams({ fields: 'all' });

  if (params.boards !== undefined) query.set('boards', params.boards);
  if (params.board_fields !== undefined)
    query.set('board_fields', params.board_fields);
  if (params.members !== undefined) query.set('members', params.members);
  if (params.member_fields !== undefined)
    query.set('member_fields', params.member_fields);
  if (params.memberships_member !== undefined)
    query.set('memberships_member', String(params.memberships_member));
  if (params.memberships_member_fields !== undefined)
    query.set('memberships_member_fields', params.memberships_member_fields);
  if (params.paid_account !== undefined)
    query.set('paid_account', String(params.paid_account));
  if (params.tags !== undefined) query.set('tags', String(params.tags));

  const res = await apiFetch(
    apiUrl(`organizations/${params.workspaceId}?${query.toString()}`),
  );
  const o = await res.json();

  return {
    workspace: {
      id: o.id,
      name: o.name,
      displayName: o.displayName,
      desc: o.desc,
      url: o.url,
      website: o.website ?? null,
      logoUrl: o.logoUrl ?? null,
      memberships: (o.memberships ?? []).map(
        (m: {
          id: string;
          idMember: string;
          memberType: string;
          unconfirmed: boolean;
          deactivated: boolean;
          lastActive?: string;
          member?: Record<string, unknown>;
        }) => ({
          id: m.id,
          idMember: m.idMember,
          memberType: m.memberType,
          unconfirmed: m.unconfirmed,
          deactivated: m.deactivated,
          ...(m.lastActive !== undefined && { lastActive: m.lastActive }),
          ...(m.member !== undefined && { member: m.member }),
        }),
      ),
      premiumFeatures: o.premiumFeatures ?? [],
      products: o.products ?? [],
      ...(o.boards !== undefined && { boards: o.boards }),
      ...(o.members !== undefined && { members: o.members }),
      ...(o.paidAccount !== undefined && { paidAccount: o.paidAccount }),
      ...(o.tags !== undefined && { tags: o.tags }),
    },
  };
}
