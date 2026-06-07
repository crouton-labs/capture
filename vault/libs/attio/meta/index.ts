import { attioFetch } from '../helpers';
import { ContractDrift, throwForStatus } from '@vallum/_runtime';
import type {
  ListObjectsOutput,
  ListUsersOutput,
  ListListsOutput,
  SearchRecordsOutput,
} from './schemas';

interface RawEntityDefinition {
  entity_definition_id: string;
  api_slug: string;
  singular_noun: string;
  is_archived: boolean;
}

interface RawAttributeDefinition {
  attribute_definition_id: string;
  api_slug: string;
  title: string;
  type: string;
  is_required: boolean;
  is_archived: boolean;
}

export async function listObjects(opts: {
  slug: string;
}): Promise<ListObjectsOutput> {
  const defs = await attioFetch<RawEntityDefinition[]>(
    `/api/common/workspaces/${opts.slug}/entity-definitions`,
  );

  if (!Array.isArray(defs)) {
    throw new ContractDrift(
      `Expected array from entity-definitions, got: ${typeof defs}`,
    );
  }

  const objectTypes = await Promise.all(
    defs.map(async (def) => {
      let attributes: ListObjectsOutput['objectTypes'][number]['attributes'] =
        [];
      try {
        const attrResp = await attioFetch<
          { value: RawAttributeDefinition[] } | RawAttributeDefinition[]
        >(
          `/api/common/workspaces/${opts.slug}/entity-definitions/${def.entity_definition_id}/attribute-definitions`,
        );
        const attrDefs = Array.isArray(attrResp)
          ? attrResp
          : ((attrResp as { value: RawAttributeDefinition[] }).value ?? []);
        if (Array.isArray(attrDefs)) {
          attributes = attrDefs.map((a) => ({
            id: a.attribute_definition_id,
            slug: a.api_slug,
            title: a.title,
            type: a.type,
            isRequired: a.is_required,
            isArchived: a.is_archived,
          }));
        }
      } catch {
        // attribute-definitions endpoint may not exist for all entity types
      }

      return {
        id: def.entity_definition_id,
        slug: def.api_slug,
        name: def.singular_noun,
        isArchived: def.is_archived,
        attributes,
      };
    }),
  );

  return { objectTypes };
}

interface RawUser {
  id: string;
  email_address: string;
  name: { first: string | null; last: string | null; full: string | null };
  avatar_url: string | null;
  membership: { access_level: string; default_mailbox_id: string | null };
}

export async function listUsers(opts: {
  slug: string;
}): Promise<ListUsersOutput> {
  const raw = await attioFetch<RawUser[]>(
    `/api/common/workspaces/${opts.slug}/users`,
  );

  if (!Array.isArray(raw)) {
    throw new ContractDrift(`Expected array from users endpoint, got: ${typeof raw}`);
  }

  return {
    users: raw.map((u) => ({
      id: u.id,
      emailAddress: u.email_address,
      name: { first: u.name.first, last: u.name.last, full: u.name.full },
      avatarUrl: u.avatar_url,
      accessLevel: u.membership.access_level,
    })),
  };
}

interface RawCollection {
  id: string;
  name: string | null;
  is_archived: boolean | null;
  [key: string]: unknown;
}

export async function listLists(opts: {
  slug: string;
}): Promise<ListListsOutput> {
  const raw = await attioFetch<RawCollection[]>(
    `/api/common/workspaces/${opts.slug}/collections`,
  );

  if (!Array.isArray(raw)) {
    return { lists: [] };
  }

  return {
    lists: raw.map((c) => ({
      id: c.id,
      name: c.name,
      isArchived: c.is_archived,
    })),
  };
}

interface RawSearchHit {
  entity_instance_id: string;
  entity_definition_id: string;
  entity_type: string;
  epithet: string;
  rank: number;
}

interface RawSearchResponse {
  totalHits: number;
  hits: RawSearchHit[];
}

export async function searchRecords(opts: {
  slug: string;
  query: string;
  entityDefinitionId?: string;
}): Promise<SearchRecordsOutput> {
  const body: Record<string, unknown> = {
    query: opts.query,
    page: 0,
    hitsPerPage: 25,
    filters: {},
  };
  if (opts.entityDefinitionId) {
    body.filters = {
      entity_definition_id: [opts.entityDefinitionId],
    };
  }

  // Search API is on api.attio.com (cross-origin), not the app origin
  const response = await fetch(
    `https://api.attio.com/api/common/search/workspaces/${opts.slug}/query`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-attio-platform': 'web-app',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const raw: RawSearchResponse = await response.json();

  if (!Array.isArray(raw.hits)) {
    throw new ContractDrift(
      `Unexpected search response shape: ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }

  return {
    results: raw.hits.map((h) => ({
      recordId: h.entity_instance_id,
      entityDefinitionId: h.entity_definition_id,
      entitySlug: h.entity_type,
      title: h.epithet,
      subtitle: undefined,
    })),
  };
}
