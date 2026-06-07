import type {
  GetOpportunityInput,
  GetOpportunityOutput,
  CreateOpportunityInput,
  CreateOpportunityOutput,
  UpdateOpportunityInput,
  UpdateOpportunityOutput,
  DeleteOpportunityInput,
  DeleteOpportunityOutput,
  GetPipelineInput,
  GetPipelineOutput,
  CreatePipelineInput,
  CreatePipelineOutput,
  UpdatePipelineInput,
  UpdatePipelineOutput,
} from './schemas-deals';
import { Validation, NotFound, Unauthenticated, UpstreamError, ContractDrift, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Constants
// ============================================================================

const TRPC_BASE = 'https://gateway.prod.day.ai/trpc';
const GQL_URL = 'https://day.ai/api/graphql';
const SUPABASE_TOKEN_KEY = 'sb-ffdfsbwhgoaivsfgdupn-auth-token';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve accessToken and workspaceId from explicit opts or auto-inject
 * from the Day.ai session (localStorage + URL hash).
 */
async function resolveAuth(
  accessToken?: string,
  workspaceId?: string,
): Promise<{ accessToken: string; workspaceId: string }> {
  if (accessToken && workspaceId) {
    return { accessToken, workspaceId };
  }

  const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
  if (!raw) {
    throw new Unauthenticated(
      'Day.ai: not authenticated. Supabase token not found in localStorage. Navigate to day.ai and log in first.',
    );
  }

  const tokenData = JSON.parse(raw) as {
    access_token: string;
  };

  if (!tokenData.access_token) {
    throw new Unauthenticated(
      'Day.ai: access_token is empty; user may need to re-authenticate.',
    );
  }

  const resolvedToken = accessToken ?? tokenData.access_token;

  if (workspaceId) {
    return { accessToken: resolvedToken, workspaceId };
  }

  // Extract workspaceId from URL hash
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams: Record<string, string> = {};
  for (const pair of hash.split(',')) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      hashParams[pair.slice(0, colonIdx)] = decodeURIComponent(
        pair.slice(colonIdx + 1),
      );
    }
  }

  const resolvedWorkspaceId = hashParams['workspaceId'];
  if (!resolvedWorkspaceId) {
    throw new Validation(
      `Day.ai: workspaceId not found in URL hash. Navigate to a workspace page first. URL: ${window.location.href}`,
    );
  }

  return { accessToken: resolvedToken, workspaceId: resolvedWorkspaceId };
}

interface TrpcResponse<T> {
  result: { data: T };
}

async function trpcCall<T>(
  accessToken: string,
  procedure: string,
  body: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(`${TRPC_BASE}/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throwForStatus(resp.status, truncated);
  }

  const json = (await resp.json()) as TrpcResponse<T>;
  return json.result.data;
}

async function gqlCall<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'auth-provider': 'supabase',
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await resp.json()) as {
    data?: T;
    errors?: { message: string }[];
  };

  // GraphQL can return both data and errors (partial success).
  // Only throw if there's no usable data at all.
  if (json.errors?.length && !json.data) {
    throw new UpstreamError(
      `Day.ai GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`,
    );
  }

  if (!json.data) {
    throw new ContractDrift('Day.ai GraphQL returned no data');
  }

  return json.data;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Get a single opportunity by its UUID.
 * Uses object.getObjectRows for direct lookup instead of fetching all opportunities.
 */
export async function getOpportunity(
  opts: GetOpportunityInput,
): Promise<GetOpportunityOutput> {
  // Check existence first via lightweight metadata endpoint.
  const meta = await trpcCall<
    { label: string; objectId: string; photoUrl: string | null }[]
  >(opts.accessToken, 'object.getObjectMetadata', {
    workspaceId: opts.workspaceId,
    objectType: 'native_opportunity',
    objectIds: [opts.opportunityId],
  });

  if (meta.length === 0) {
    throw new NotFound(
      `Opportunity not found with id: ${opts.opportunityId}. The opportunity may not exist in this workspace.`,
    );
  }

  // Fetch property rows for the opportunity
  const body: Record<string, unknown> = {
    workspaceId: opts.workspaceId,
    objectTypeId: 'native_opportunity',
    objectId: opts.opportunityId,
  };
  if (opts.propertyNames) {
    body.propertyNames = opts.propertyNames;
  }

  const rows = await trpcCall<
    {
      workspaceId: string;
      objectId: string;
      name: string;
      value: string;
      propertySourceId: string;
      propertyTypeId: string;
      propertyVersionHash: string;
      createdAt: number;
      updatedAt: number;
    }[]
  >(opts.accessToken, 'object.getObjectRows', body);

  // Build opportunity object from property rows.
  const propertyRows = rows.filter((r) => r.propertyTypeId !== 'existsmarker');

  const bestRows = new Map<string, (typeof propertyRows)[0]>();
  for (const row of propertyRows) {
    const existing = bestRows.get(row.name);
    if (!existing || row.updatedAt > existing.updatedAt) {
      bestRows.set(row.name, row);
    }
  }

  // object.getObjectRows returns all values as strings; coerce to proper types.
  function coerceValue(v: string): string | number | boolean {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v !== '' && !isNaN(Number(v))) return Number(v);
    return v;
  }

  const opportunity: Record<string, unknown> = {
    objectId: opts.opportunityId,
  };
  let earliestCreated = Infinity;
  let latestUpdated = 0;
  for (const row of bestRows.values()) {
    const key = `_${row.name}`;
    opportunity[key] = coerceValue(row.value);
    if (row.createdAt < earliestCreated) earliestCreated = row.createdAt;
    if (row.updatedAt > latestUpdated) latestUpdated = row.updatedAt;
  }
  opportunity.createdAt =
    earliestCreated === Infinity
      ? new Date().toISOString()
      : new Date(earliestCreated).toISOString();
  opportunity.updatedAt =
    latestUpdated === 0
      ? new Date().toISOString()
      : new Date(latestUpdated).toISOString();

  // Metadata is authoritative for id and photoUrl
  opportunity.id = meta[0].objectId;

  const result: Record<string, unknown> = {
    opportunity: opportunity as GetOpportunityOutput['opportunity'],
  };

  // Optionally fetch property lineage
  if (opts.includeLineage) {
    const hashes = rows
      .filter((r) => r.propertyVersionHash)
      .map((r) => r.propertyVersionHash);
    const uniqueHashes = [...new Set(hashes)];
    if (uniqueHashes.length > 0) {
      const lineageData = await trpcCall<
        Record<
          string,
          {
            type: string;
            id: string;
            properties: {
              userId: string;
              name: string;
              version: number;
              source: string;
              citations: unknown[];
            }[];
          }[]
        >
      >(opts.accessToken, 'lineage.getLineage', {
        workspaceId: opts.workspaceId,
        propertyVersionHashes: uniqueHashes,
      });
      result.lineage = lineageData;
    }
  }

  // Optionally fetch structured relationships
  if (opts.includeRelationships) {
    const relData = await trpcCall<{
      relationships: {
        relationship: string;
        targetObjectTypeId: string;
        targetObjectId: string;
      }[];
    }>(opts.accessToken, 'object.getObjectRelationshipsWithProperties', {
      workspaceId: opts.workspaceId,
      objectType: 'native_opportunity',
      objectId: opts.opportunityId,
    });
    result.relationships = relData.relationships;
  }

  // Optionally fetch activity timeline
  if (opts.includeTimeline) {
    const since =
      opts.timelineSince ||
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const timelineData = await trpcCall<{
      entries: {
        type: string;
        objectType: string;
        objectId: string;
        updatedAt: string;
        propertyName?: string;
        userId?: string;
        valueObjectType?: string | null;
        valueObjectId?: string | null;
      }[];
    }>(opts.accessToken, 'timeline.getTimeline', {
      workspaceId: opts.workspaceId,
      objectType: 'native_opportunity',
      objectId: opts.opportunityId,
      since,
    });
    result.timeline = timelineData.entries;
  }

  return result as GetOpportunityOutput;
}

/**
 * Create a new opportunity in a pipeline.
 */
export async function createOpportunity(
  opts: CreateOpportunityInput,
): Promise<CreateOpportunityOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  if (!opts.title || !opts.title.trim()) {
    throw new Validation(
      'createOpportunity: title is required and cannot be empty. The API returns a 500 error for blank titles.',
    );
  }

  const closeDate =
    opts.expectedCloseDate !== undefined
      ? opts.expectedCloseDate
      : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const mutation = `
    mutation createOpportunity($input: OpportunityCreateInput!) {
      createOpportunity(input: $input) {
        id
        workspaceId
        pipelineId
        stageId
        title
        ownerEmail
        ownerId
        domain
        status
        type
        isSuggested
        expectedRevenue
        expectedCloseDate
        position
      }
    }
  `;

  const input: Record<string, unknown> = {
    title: opts.title,
    type: opts.type ?? 'New Business',
    ownerEmail: opts.ownerEmail ?? null,
    expectedCloseDate: closeDate,
    hasRevenue:
      opts.expectedRevenue !== undefined && opts.expectedRevenue !== null,
    expectedRevenue:
      opts.expectedRevenue !== undefined ? opts.expectedRevenue : null,
    domain: opts.domain !== undefined ? opts.domain : null,
    position: opts.position !== undefined ? opts.position : 0,
    stageId: opts.stageId,
    pipelineId: opts.pipelineId ?? null,
    workspaceId,
    primaryPerson:
      opts.primaryPersonEmail !== undefined ? opts.primaryPersonEmail : null,
    roles: opts.primaryPersonEmail
      ? [{ personEmail: opts.primaryPersonEmail, roles: ['PRIMARY_CONTACT'] }]
      : [],
    currentStatus: '',
    isSuggested: opts.isSuggested !== undefined ? opts.isSuggested : false,
  };

  const data = await gqlCall<{
    createOpportunity: CreateOpportunityOutput['opportunity'];
  }>(accessToken, mutation, { input });

  return { opportunity: data.createOpportunity };
}

/**
 * Update an existing opportunity.
 */
export async function updateOpportunity(
  opts: UpdateOpportunityInput,
): Promise<UpdateOpportunityOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  // expectedCloseDate and currentStatus map to workspace-specific AI-managed
  // custom properties ("Close Date" and "Status"). The standard OpportunityUpdateInput
  // mutation accepts these fields but only updates internal standard property rows;
  // the UI renders the custom properties, so changes via the mutation appear to have
  // no effect. We must use UpdateObjectProperty with the correct custom property UUID.
  if (
    opts.expectedCloseDate !== undefined ||
    opts.currentStatus !== undefined
  ) {
    const propDefsData = await gqlCall<{
      objectPropertyDefinitions: {
        id: string;
        name: string;
        objectTypeId: string;
        propertyTypeId: string;
      }[];
    }>(
      accessToken,
      `query GetOppPropertyDefs($workspaceId: String!) {
        objectPropertyDefinitions(workspaceId: $workspaceId) {
          id name objectTypeId propertyTypeId
        }
      }`,
      { workspaceId },
    );

    const oppDefs = propDefsData.objectPropertyDefinitions.filter(
      (d) => d.objectTypeId === 'native_opportunity',
    );

    const updatePropMutation = `
      mutation UpdateObjectProperty($input: UpdateObjectPropertyInput!) {
        updateObjectProperty(input: $input) { success }
      }
    `;

    if (opts.expectedCloseDate !== undefined) {
      const def = oppDefs.find((d) => d.name === 'Close Date');
      if (def) {
        await gqlCall(accessToken, updatePropMutation, {
          input: {
            workspaceId,
            objectType: 'native_opportunity',
            objectId: opts.id,
            propertyDefinitionId: def.id,
            value: { value: opts.expectedCloseDate },
            propertyType: def.propertyTypeId,
          },
        });
      }
    }

    if (opts.currentStatus !== undefined) {
      const def = oppDefs.find((d) => d.name === 'Status');
      if (def) {
        await gqlCall(accessToken, updatePropMutation, {
          input: {
            workspaceId,
            objectType: 'native_opportunity',
            objectId: opts.id,
            propertyDefinitionId: def.id,
            value: { value: opts.currentStatus },
            propertyType: def.propertyTypeId,
          },
        });
      }
    }
  }

  const mutation = `
    mutation updateOpportunity($input: OpportunityUpdateInput!) {
      updateOpportunity(input: $input) {
        id
      }
    }
  `;

  const input: Record<string, unknown> = {
    id: opts.id,
    workspaceId,
  };

  if (opts.title !== undefined) input.title = opts.title;
  if (opts.ownerEmail !== undefined) input.ownerEmail = opts.ownerEmail;
  if (opts.ownerId !== undefined) input.ownerId = opts.ownerId;
  if (opts.type !== undefined) input.type = opts.type;
  // expectedCloseDate and currentStatus are handled via UpdateObjectProperty above
  if (opts.expectedRevenue !== undefined)
    input.expectedRevenue = opts.expectedRevenue;
  if (opts.stageId !== undefined) input.stageId = opts.stageId;
  if (opts.pipelineId !== undefined) input.pipelineId = opts.pipelineId;
  if (opts.position !== undefined) input.position = opts.position;
  if (opts.domain !== undefined) input.domain = opts.domain;
  if (opts.primaryPerson !== undefined)
    input.primaryPerson = opts.primaryPerson;
  if (opts.hasRevenue !== undefined) input.hasRevenue = opts.hasRevenue;

  const data = await gqlCall<{ updateOpportunity: { id: string } }>(
    accessToken,
    mutation,
    { input },
  );

  return { id: data.updateOpportunity.id };
}

/**
 * Delete an opportunity by UUID.
 */
export async function deleteOpportunity(
  opts: DeleteOpportunityInput,
): Promise<DeleteOpportunityOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  const mutation = `
    mutation deleteOpportunity($id: String!, $workspaceId: String!, $pipelineId: String) {
      deleteOpportunity(id: $id, workspaceId: $workspaceId, pipelineId: $pipelineId) {
        id
        objectType
      }
    }
  `;

  const data = await gqlCall<{
    deleteOpportunity: { id: string; objectType: string };
  }>(accessToken, mutation, {
    id: opts.id,
    workspaceId,
    pipelineId: opts.pipelineId !== undefined ? opts.pipelineId : null,
  });

  return data.deleteOpportunity;
}

/**
 * Get a single pipeline by UUID, with its stages.
 * Fetches pipeline title from object.getObjectRows (native_pipeline).
 * Optionally fetches opportunity details per stage via pipeline.getOpportunityIdsByStages.
 */
export async function getPipeline(
  opts: GetPipelineInput,
): Promise<GetPipelineOutput> {
  // Fetch all stages and pipeline title in parallel
  const [allStages, pipelineRows] = await Promise.all([
    trpcCall<Record<string, unknown>[]>(opts.accessToken, 'tables.getObjects', {
      workspaceId: opts.workspaceId,
      objectType: 'native_stage',
      offset: '1970-01-01T00:00:00.000Z',
      limit: 500,
    }),
    trpcCall<{ name: string; value: string }[]>(
      opts.accessToken,
      'object.getObjectRows',
      {
        workspaceId: opts.workspaceId,
        objectTypeId: 'native_pipeline',
        objectId: opts.pipelineId,
      },
    ),
  ]);

  // Filter stages that belong to this pipeline
  // _pipelineId format: "workspaceId : native_pipeline : pipelineUUID"
  const pipelineStages = allStages.filter((stage) => {
    const pipelineIdField = stage._pipelineId as string | undefined;
    if (!pipelineIdField) return false;
    const parts = pipelineIdField.split(' : ');
    const pipelineUuid = parts[parts.length - 1];
    return pipelineUuid === opts.pipelineId;
  });

  if (pipelineStages.length === 0) {
    throw new NotFound(
      `Pipeline not found with id: ${opts.pipelineId}. No stages found for this pipeline.`,
    );
  }

  // Extract pipeline title from property rows
  const titleRow = pipelineRows.find((r) => r.name === 'title');
  const pipelineTitle = titleRow ? titleRow.value.trim() : '';

  // Optionally fetch opportunity details per stage
  type StageOpp = {
    objectId: string;
    title?: string;
    domain?: string;
    stageId: string;
    position: number;
    autoStageMovement?: boolean;
    expectedCloseDate?: string;
    expectedRevenue?: number;
    assignee?: string[];
    customProperties?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };

  let opportunityMap: Map<string, StageOpp[]> | null = null;
  if (opts.includeOpportunities) {
    const stageUuids = pipelineStages.map((s) => s.objectId as string);
    const opportunities = await trpcCall<StageOpp[]>(
      opts.accessToken,
      'pipeline.getOpportunityIdsByStages',
      { workspaceId: opts.workspaceId, stageIds: stageUuids },
    );
    opportunityMap = new Map<string, StageOpp[]>();
    for (const opp of opportunities) {
      // Extract stage UUID from compound stageId: "workspaceId : native_stage : uuid"
      const stageUuid = opp.stageId.split(' : ').pop() ?? '';
      if (!opportunityMap.has(stageUuid)) {
        opportunityMap.set(stageUuid, []);
      }
      opportunityMap.get(stageUuid)!.push(opp);
    }
  }

  const stages = pipelineStages.map((stage) => {
    const stageWithOpps: Record<string, unknown> = { ...stage };
    if (opportunityMap) {
      stageWithOpps.opportunities =
        opportunityMap.get(stage.objectId as string) ?? [];
    }
    return stageWithOpps;
  });

  return {
    pipeline: {
      id: opts.pipelineId,
      title: pipelineTitle,
      stages: stages as GetPipelineOutput['pipeline']['stages'],
    },
  };
}

/**
 * Create a new pipeline.
 */
export async function createPipeline(
  opts: CreatePipelineInput,
): Promise<CreatePipelineOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  const mutation = `
    mutation createPipeline($input: PipelineCreateInput!) {
      createPipeline(input: $input) {
        id
      }
    }
  `;

  const input: Record<string, unknown> = {
    workspaceId,
    title: opts.title,
    type: opts.type ?? 'NEW_CUSTOMER',
  };

  const data = await gqlCall<{ createPipeline: { id: string } }>(
    accessToken,
    mutation,
    { input },
  );

  return { id: data.createPipeline.id };
}

/**
 * Update a pipeline name, description, type, automation, ICP, or stages.
 */
export async function updatePipeline(
  opts: UpdatePipelineInput,
): Promise<UpdatePipelineOutput> {
  const { accessToken, workspaceId } = await resolveAuth(
    opts.accessToken,
    opts.workspaceId,
  );

  // Verify the pipeline exists before updating.
  // updatePipeline silently creates a new pipeline when given an unknown UUID,
  // so we must validate first.
  const pipelineRows = await trpcCall<{ name: string; value: string }[]>(
    accessToken,
    'object.getObjectRows',
    {
      workspaceId,
      objectTypeId: 'native_pipeline',
      objectId: opts.pipelineId,
    },
  );

  if (pipelineRows.length === 0) {
    throw new NotFound(
      `updatePipeline: Pipeline not found with id "${opts.pipelineId}". Verify the pipelineId is correct before updating.`,
    );
  }

  const mutation = `
    mutation updatePipeline($id: String!, $input: PipelineUpdateInput!) {
      updatePipeline(id: $id, input: $input) {
        id
        title
        description
        type
        automationActive
        hasRevenue
        reminderDays
        setupSteps
        isGeneric
        icp { organization metadata people }
        workspaceId
        createdAt
        updatedAt
        ownerEmails
        opportunityTypes
      }
    }
  `;

  // NOTE: The `stages` field on PipelineUpdateInput is silently ignored by
  // the server. Stage updates must be done via the separate updateStage mutation.
  const input: Record<string, unknown> = {
    id: opts.pipelineId,
    workspaceId,
  };

  if (opts.title !== undefined) {
    if (opts.title.trim() === '') {
      throw new Validation(
        'updatePipeline: title cannot be an empty string. Pass a non-empty title or omit the field.',
      );
    }
    input.title = opts.title;
  }
  if (opts.description !== undefined) input.description = opts.description;
  if (opts.type !== undefined) {
    const validTypes = [
      'NEW_CUSTOMER',
      'FINANCING_INVESTMENT',
      'EXISTING_CUSTOMER',
      'VENDOR_PROCUREMENT',
      'RECRUITING',
      'VENTURE_CAPITAL',
      'PARTNER',
      'NONE',
      'PERSONAL',
      'OTHER',
    ];
    if (!validTypes.includes(opts.type as string)) {
      throw new Validation(
        `updatePipeline: Invalid type "${opts.type}"; the Day.ai API accepts invalid values but silently corrupts the stored type to null. Valid values: ${validTypes.join(', ')}.`,
      );
    }
    input.type = opts.type;
  }
  if (opts.automationActive !== undefined) {
    // The API silently ignores false; only enabling automation is supported.
    // Throw to prevent silent no-op that would mislead the caller.
    if ((opts.automationActive as unknown) === false) {
      throw new Validation(
        'updatePipeline: automationActive cannot be set to false; the Day.ai API silently ignores this value (updatedAt is unchanged). To disable automation, use the Day.ai web UI directly.',
      );
    }
    input.automationActive = opts.automationActive;
  }
  if (opts.hasRevenue !== undefined) {
    // The API silently ignores false; only enabling revenue tracking is supported.
    // Throw to prevent silent no-op that would mislead the caller.
    if ((opts.hasRevenue as unknown) === false) {
      throw new Validation(
        'updatePipeline: hasRevenue cannot be set to false; the Day.ai API silently ignores this value (updatedAt is unchanged, revenue tracking remains enabled). To disable revenue tracking, use the Day.ai web UI directly.',
      );
    }
    input.hasRevenue = opts.hasRevenue;
  }
  if (opts.reminderDays !== undefined) input.reminderDays = opts.reminderDays;
  if (opts.setupSteps !== undefined) input.setupSteps = opts.setupSteps;
  if (opts.icp !== undefined) input.icp = opts.icp;

  const data = await gqlCall<{
    updatePipeline: {
      id: string;
      title: string | null;
      description: string | null;
      type: string | null;
      automationActive: boolean | null;
      hasRevenue: boolean | null;
      reminderDays: number | null;
      setupSteps: string | null;
      isGeneric: boolean | null;
      icp: {
        organization: string | null;
        metadata: unknown | null;
        people: unknown | null;
      } | null;
      workspaceId: string;
      createdAt: string | null;
      updatedAt: string | null;
      ownerEmails: string[];
      opportunityTypes: string[];
    };
  }>(accessToken, mutation, {
    id: opts.pipelineId,
    input,
  });

  // Update stages individually using updateStage mutation.
  // The StageUpdateInput.id must be in compound format:
  // "workspaceId : native_stage : stageUuid"
  const updatedStages: UpdatePipelineOutput['stages'] = [];
  if (opts.stages && opts.stages.length > 0) {
    const stageMutation = `
      mutation UpdateStageFromContext($input: StageUpdateInput!) {
        updateStage(input: $input) {
          id
          title
          description
          workspaceId
          pipelineId
          position
          entranceCriteria
          likelihoodToClose
          color
          type
        }
      }
    `;

    for (const stage of opts.stages) {
      // Validate stage exists and belongs to a pipeline.
      // The updateStage mutation silently creates ghost stages for unknown IDs.
      // Ghost stages lack a pipelineId row in object.getObjectRows.
      const stageRows = await trpcCall<{ name: string; value: string }[]>(
        accessToken,
        'object.getObjectRows',
        {
          workspaceId,
          objectTypeId: 'native_stage',
          objectId: stage.id,
        },
      );

      const hasPipelineId = stageRows.some((r) => r.name === 'pipelineId');
      if (!hasPipelineId) {
        throw new NotFound(
          `updatePipeline: Stage not found or invalid; stage "${stage.id}" does not exist or has no pipeline association. Use getPipeline to get valid stage objectIds.`,
        );
      }

      // Construct compound stage ID required by the API
      const compoundStageId = `${workspaceId} : native_stage : ${stage.id}`;
      const stageInput: Record<string, unknown> = {
        id: compoundStageId,
      };
      if (stage.title !== undefined) stageInput.title = stage.title;
      if (stage.description !== undefined)
        stageInput.description = stage.description;
      if (stage.type !== undefined) stageInput.type = stage.type;
      if (stage.position !== undefined) stageInput.position = stage.position;
      if (stage.likelihoodToClose !== undefined)
        stageInput.likelihoodToClose = stage.likelihoodToClose;
      if (stage.color !== undefined) stageInput.color = stage.color;
      if (stage.entranceCriteria !== undefined)
        stageInput.entranceCriteria = stage.entranceCriteria;
      if (stage.pipelineId !== undefined)
        stageInput.pipelineId = stage.pipelineId;
      if (stage.workspaceId !== undefined)
        stageInput.workspaceId = stage.workspaceId;

      const stageData = await gqlCall<{
        updateStage: {
          id: string;
          title: string;
          description: string | null;
          workspaceId: string;
          pipelineId: string;
          position: number;
          entranceCriteria: string[];
          likelihoodToClose: number;
          color: string | null;
          type: string | null;
        };
      }>(accessToken, stageMutation, { input: stageInput });

      updatedStages.push(stageData.updateStage);
    }
  }

  return {
    ...data.updatePipeline,
    createdAt: data.updatePipeline.createdAt ?? undefined,
    updatedAt: data.updatePipeline.updatedAt ?? undefined,
    stages: updatedStages.length > 0 ? updatedStages : undefined,
  };
}
