import { attioFetch } from '../helpers';
import { Unauthenticated, ContractDrift } from '@vallum/_runtime';
import type { GetContextOutput } from './schemas';

interface RawEntityDefinition {
  entity_definition_id: string;
  api_slug: string;
  singular_noun: string;
  is_archived: boolean;
}

export async function getContext(): Promise<GetContextOutput> {
  const slug = (
    window as unknown as {
      ATTIO_DEHYDRATED_WORKSPACES?: Array<{ slug?: string; id?: string }>;
    }
  ).ATTIO_DEHYDRATED_WORKSPACES?.[0]?.slug;
  const workspaceId = (
    window as unknown as {
      ATTIO_DEHYDRATED_WORKSPACES?: Array<{ slug?: string; id?: string }>;
    }
  ).ATTIO_DEHYDRATED_WORKSPACES?.[0]?.id;
  const userId = (
    window as unknown as {
      ATTIO_DEHYDRATED_STORE?: { active_user?: { id?: string } };
    }
  ).ATTIO_DEHYDRATED_STORE?.active_user?.id;

  if (!slug) {
    throw new Unauthenticated(
      `Workspace slug not found in window.ATTIO_DEHYDRATED_WORKSPACES. URL: ${window.location.href}`,
    );
  }
  if (!workspaceId) {
    throw new Unauthenticated(
      `Workspace ID not found in window.ATTIO_DEHYDRATED_WORKSPACES. URL: ${window.location.href}`,
    );
  }
  if (!userId) {
    throw new Unauthenticated(
      `User ID not found in window.ATTIO_DEHYDRATED_STORE.active_user. URL: ${window.location.href}`,
    );
  }

  const defs = await attioFetch<RawEntityDefinition[]>(
    `/api/common/workspaces/${slug}/entity-definitions`,
  );

  if (!Array.isArray(defs)) {
    throw new ContractDrift(
      `Expected array from entity-definitions, got: ${typeof defs}`,
    );
  }

  return {
    slug,
    workspaceId,
    userId,
    entityDefinitions: defs.map((d) => ({
      id: d.entity_definition_id,
      slug: d.api_slug,
      name: d.singular_noun,
      isArchived: d.is_archived,
    })),
  };
}
