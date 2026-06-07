// Shared fetch helper for all Attio API calls

import { throwForStatus, ContractDrift } from '@vallum/_runtime';

export async function attioFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'x-attio-platform': 'web-app',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throw new ContractDrift(`Attio returned non-JSON response: ${truncated}`);
  }
}

export interface ParticleMrlResponse {
  total_instance_count: number;
  entity_instance_ids_chunk: string[];
  mrl_snapshot_id: string;
}

interface AttributeDefinition {
  attribute_definition_id: string;
  entity_definition_id: string;
  title: string;
  api_slug: string;
  type: string;
  system_attribute?: { type: string };
}

interface AttributeDefsResponse {
  value: AttributeDefinition[];
}

/**
 * List all entity instance IDs for an entity definition using the Particle MRL API.
 * The Particle API requires attribute-based filters (empty filters return 0).
 * This function auto-discovers the created-at attribute and uses it to match all records.
 */
export async function listAllEntityIds(
  slug: string,
  entityDefId: string,
  limit: number = 100,
): Promise<{ total: number; ids: string[] }> {
  // Discover attribute definitions
  const attrResp = await attioFetch<AttributeDefsResponse>(
    `/api/common/workspaces/${slug}/entity-definitions/${entityDefId}/attribute-definitions`,
  );
  const attrs = attrResp?.value ?? [];
  const createdAtAttr = attrs.find(
    (a) => a.system_attribute?.type === 'created-at',
  );
  if (!createdAtAttr) {
    throw new ContractDrift(
      `Could not find created-at attribute for entity definition ${entityDefId}`,
    );
  }

  const mrlResp = await attioFetch<ParticleMrlResponse>(
    `/api/common/particle/workspaces/${slug}/entity-definitions/${entityDefId}/entity-instances/mrl`,
    {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          and: [
            {
              path: [
                {
                  attribute_definition_id:
                    createdAtAttr.attribute_definition_id,
                  entity_definition_id: entityDefId,
                },
              ],
              mode: 'must',
              constraints: [
                {
                  field: 'value',
                  operator: 'not-empty',
                  value: 'null',
                },
                {
                  field: 'active_until',
                  operator: 'empty',
                  value: 'null',
                },
              ],
            },
          ],
        },
        sorts: [],
        initialRange: { start: 0, size: limit },
      }),
    },
  );

  return {
    total: mrlResp.total_instance_count,
    ids: mrlResp.entity_instance_ids_chunk ?? [],
  };
}
