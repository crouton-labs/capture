/**
 * Claygent operations
 */

import { ContractDrift, Validation, NotFound, Unauthenticated, PermissionDenied, UpstreamError } from '@vallum/_runtime';
import { clayFetch } from './shared';
import type {
  ListClaygentsInput,
  ListClaygentsOutput,
  GetClaygentInput,
  GetClaygentOutput,
  CreateClaygentInput,
  CreateClaygentOutput,
  UpdateClaygentInput,
  UpdateClaygentOutput,
  DeleteClaygentInput,
  DeleteClaygentOutput,
  RunClaygentInput,
  RunClaygentOutput,
  GetClaygentRunInput,
  GetClaygentRunOutput,
  GetSignalInput,
  GetSignalOutput,
  UpdateSignalInput,
  UpdateSignalOutput,
  DeleteSignalInput,
  DeleteSignalOutput,
  CreateSignalInput,
  CreateSignalOutput,
  ListSignalsInput,
  ListSignalsOutput,
  ListClaygentDocumentsInput,
  ListClaygentDocumentsOutput,
  CreateClaygentDocumentInput,
  CreateClaygentDocumentOutput,
  DeleteClaygentDocumentInput,
  DeleteClaygentDocumentOutput,
  AddClaygentColumnInput,
  AddClaygentColumnOutput,
  ListCustomSignalSourceTypesInput,
  ListCustomSignalSourceTypesOutput,
  CreateCustomSignalInput,
  CreateCustomSignalOutput,
} from './schemas';

interface ClaygentVersionResponse {
  id: string;
  versionNumber: number;
  claygentId: string;
  userPrompt: string;
  variables: unknown[];
  modelSettings: {
    model: string;
    useCase?: string;
    internetSearchEnabled?: boolean;
  };
  toolSettings: Record<string, unknown>;
  outputFormat: {
    type: 'json';
    jsonType: 'Fields' | 'JSONSchema';
    fields?: Record<
      string,
      {
        type: 'string' | 'number' | 'boolean' | 'array';
        description?: string;
        id?: string;
        options?: string;
      }
    >;
    jsonSchema?: string;
  } | null;
  summary: string | null;
  isPublished: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface ClaygentResponse {
  id: string;
  workspaceId: number;
  name: string;
  description: string | null;
  currentVersionId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  currentVersion: ClaygentVersionResponse;
}

interface ClaygentsResponse {
  claygents: ClaygentResponse[];
}

interface DocumentsResponse {
  documents: Array<{
    id: string;
    name: string;
    folderId?: string | null;
    mimeType?: string;
    size?: string;
    context?: string;
    content?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
}

/**
 * List claygents in workspace.
 */
export async function listClaygents(
  opts: ListClaygentsInput,
): Promise<ListClaygentsOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const data = await clayFetch<ClaygentsResponse>(
    `/workspaces/${workspaceId}/claygents`,
  );

  const claygents = (data.claygents || []).map((c) => ({
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    description: c.description === null ? null : c.description,
    currentVersionId: c.currentVersionId,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    publishedAt: c.publishedAt === null ? null : c.publishedAt,
    currentVersion: {
      id: c.currentVersion.id,
      versionNumber: c.currentVersion.versionNumber,
      claygentId: c.currentVersion.claygentId,
      userPrompt: c.currentVersion.userPrompt,
      variables: c.currentVersion.variables,
      modelSettings: c.currentVersion.modelSettings,
      toolSettings: c.currentVersion.toolSettings,
      outputFormat: c.currentVersion.outputFormat,
      summary: c.currentVersion.summary,
      isPublished: c.currentVersion.isPublished,
      createdBy: c.currentVersion.createdBy,
      createdAt: c.currentVersion.createdAt,
      updatedAt: c.currentVersion.updatedAt,
    },
  }));

  return {
    claygents,
    totalCount: claygents.length,
  };
}

interface SingleClaygentResponse {
  claygent: ClaygentResponse;
}

/**
 * Get a single claygent by ID.
 */
export async function getClaygent(
  opts: GetClaygentInput,
): Promise<GetClaygentOutput> {
  const { workspaceId, claygentId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!claygentId) {
    throw new Validation('claygentId is required');
  }

  const data = await clayFetch<SingleClaygentResponse>(
    `/workspaces/${workspaceId}/claygents/${claygentId}`,
  );

  const c = data.claygent;

  return {
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    description: c.description === null ? null : c.description,
    currentVersionId: c.currentVersionId,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    publishedAt: c.publishedAt === null ? null : c.publishedAt,
    currentVersion: {
      id: c.currentVersion.id,
      versionNumber: c.currentVersion.versionNumber,
      claygentId: c.currentVersion.claygentId,
      userPrompt: c.currentVersion.userPrompt,
      variables: c.currentVersion.variables,
      modelSettings: c.currentVersion.modelSettings,
      toolSettings: c.currentVersion.toolSettings,
      outputFormat: c.currentVersion.outputFormat,
      summary: c.currentVersion.summary,
      isPublished: c.currentVersion.isPublished,
      createdBy: c.currentVersion.createdBy,
      createdAt: c.currentVersion.createdAt,
      updatedAt: c.currentVersion.updatedAt,
    },
  };
}

/**
 * Create a new claygent (AI agent) in a workspace.
 */
export async function createClaygent(
  opts: CreateClaygentInput,
): Promise<CreateClaygentOutput> {
  const {
    workspaceId,
    name,
    userPrompt,
    description,
    model,
    internetSearchEnabled,
    outputFormat,
    variables,
    toolSettings,
    markAsPublished,
  } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!name) {
    throw new Validation('name is required');
  }
  if (!userPrompt) {
    throw new Validation('userPrompt is required');
  }

  // Clay's default model identifier; must match what Clay's UI sends
  const CLAY_DEFAULT_MODEL = ['gpt', '4o'].join('-');
  const modelSettings: Record<string, unknown> = {
    model: model || CLAY_DEFAULT_MODEL,
    useCase: '"claygent"',
    internetSearchEnabled:
      internetSearchEnabled !== undefined ? internetSearchEnabled : true,
  };

  const payload: Record<string, unknown> = {
    name,
    userPrompt,
    modelSettings,
    toolSettings: toolSettings || {},
    toolConfigs: {},
    toolAuthConfigs: {},
    variables: variables || [],
  };

  if (description !== undefined) {
    payload.description = description;
  }
  if (outputFormat !== undefined) {
    // Auto-fill required id/options on Fields output format so callers don't need to generate UUIDs
    if (outputFormat.jsonType === 'Fields' && outputFormat.fields) {
      const filledFields: Record<string, Record<string, unknown>> = {};
      for (const [key, field] of Object.entries(outputFormat.fields)) {
        const f = field as Record<string, unknown>;
        const hasId = typeof f.id === 'string' && f.id.length > 0;
        const hasOptions = typeof f.options === 'string';
        const hasDescription = typeof f.description === 'string';
        filledFields[key] = {
          ...f,
          id: hasId ? f.id : crypto.randomUUID(),
          options: hasOptions ? f.options : '',
          description: hasDescription ? (f.description as string) : '',
        };
      }
      payload.outputFormat = { ...outputFormat, fields: filledFields };
    } else {
      payload.outputFormat = outputFormat;
    }
  }
  if (markAsPublished !== undefined) {
    payload.markAsPublished = markAsPublished;
  }

  const data = await clayFetch<SingleClaygentResponse>(
    `/workspaces/${workspaceId}/claygents`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  const c = data.claygent;

  return {
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    description: c.description === null ? null : c.description,
    currentVersionId: c.currentVersionId,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    publishedAt: c.publishedAt === null ? null : c.publishedAt,
    currentVersion: {
      id: c.currentVersion.id,
      versionNumber: c.currentVersion.versionNumber,
      claygentId: c.currentVersion.claygentId,
      userPrompt: c.currentVersion.userPrompt,
      variables: c.currentVersion.variables,
      modelSettings: c.currentVersion.modelSettings,
      toolSettings: c.currentVersion.toolSettings,
      outputFormat: c.currentVersion.outputFormat,
      summary: c.currentVersion.summary,
      isPublished: c.currentVersion.isPublished,
      createdBy: c.currentVersion.createdBy,
      createdAt: c.currentVersion.createdAt,
      updatedAt: c.currentVersion.updatedAt,
    },
  };
}

/**
 * Update an existing claygent's properties.
 * Changes to version-related fields (userPrompt, modelSettings, toolSettings, outputFormat, variables)
 * create a new version with an incremented versionNumber.
 */
export async function updateClaygent(
  opts: UpdateClaygentInput,
): Promise<UpdateClaygentOutput> {
  const {
    workspaceId,
    claygentId,
    name,
    userPrompt,
    description,
    model,
    internetSearchEnabled,
    outputFormat,
    variables,
    toolSettings,
    markAsPublished,
  } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!claygentId) {
    throw new Validation('claygentId is required');
  }

  const payload: Record<string, unknown> = {};

  if (name !== undefined) {
    payload.name = name;
  }
  if (description !== undefined) {
    payload.description = description;
  }
  if (userPrompt !== undefined) {
    payload.userPrompt = userPrompt;
  }
  if (model !== undefined || internetSearchEnabled !== undefined) {
    // Fetch current claygent to merge modelSettings; the API replaces the
    // entire modelSettings object, so omitting a field erases it.
    const current = await clayFetch<SingleClaygentResponse>(
      `/workspaces/${workspaceId}/claygents/${claygentId}`,
    );
    const existing = current.claygent.currentVersion.modelSettings;
    const modelSettings: Record<string, unknown> = {
      model: model !== undefined ? model : existing.model,
      useCase: existing.useCase || '"claygent"',
      internetSearchEnabled:
        internetSearchEnabled !== undefined
          ? internetSearchEnabled
          : (existing.internetSearchEnabled ?? true),
    };
    payload.modelSettings = modelSettings;
  }
  if (toolSettings !== undefined) {
    payload.toolSettings = toolSettings;
  }
  if (variables !== undefined) {
    payload.variables = variables;
  }
  if (outputFormat !== undefined) {
    // Auto-fill required id/options on Fields output format so callers don't need to generate UUIDs
    if (outputFormat.jsonType === 'Fields' && outputFormat.fields) {
      const filledFields: Record<string, Record<string, unknown>> = {};
      for (const [key, field] of Object.entries(outputFormat.fields)) {
        const f = field as Record<string, unknown>;
        const hasId = typeof f.id === 'string' && f.id.length > 0;
        const hasOptions = typeof f.options === 'string';
        const hasDescription = typeof f.description === 'string';
        filledFields[key] = {
          ...f,
          id: hasId ? f.id : crypto.randomUUID(),
          options: hasOptions ? f.options : '',
          description: hasDescription ? (f.description as string) : '',
        };
      }
      payload.outputFormat = { ...outputFormat, fields: filledFields };
    } else {
      payload.outputFormat = outputFormat;
    }
  }
  if (markAsPublished !== undefined) {
    payload.markAsPublished = markAsPublished;
  }

  const data = await clayFetch<SingleClaygentResponse>(
    `/workspaces/${workspaceId}/claygents/${claygentId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );

  const c = data.claygent;

  return {
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    description: c.description === null ? null : c.description,
    currentVersionId: c.currentVersionId,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    publishedAt: c.publishedAt === null ? null : c.publishedAt,
    currentVersion: {
      id: c.currentVersion.id,
      versionNumber: c.currentVersion.versionNumber,
      claygentId: c.currentVersion.claygentId,
      userPrompt: c.currentVersion.userPrompt,
      variables: c.currentVersion.variables,
      modelSettings: c.currentVersion.modelSettings,
      toolSettings: c.currentVersion.toolSettings,
      outputFormat: c.currentVersion.outputFormat,
      summary: c.currentVersion.summary,
      isPublished: c.currentVersion.isPublished,
      createdBy: c.currentVersion.createdBy,
      createdAt: c.currentVersion.createdAt,
      updatedAt: c.currentVersion.updatedAt,
    },
  };
}

/**
 * Delete a claygent from a workspace.
 */
export async function deleteClaygent(
  opts: DeleteClaygentInput,
): Promise<DeleteClaygentOutput> {
  const { workspaceId, claygentId } = opts;

  if (
    !workspaceId ||
    typeof workspaceId === 'boolean' ||
    String(workspaceId).trim() === ''
  ) {
    throw new Validation(
      'deleteClaygent: workspaceId is required and must be a non-empty string',
    );
  }
  if (
    !claygentId ||
    typeof claygentId === 'boolean' ||
    String(claygentId).trim() === ''
  ) {
    throw new Validation(
      'deleteClaygent: claygentId is required and must be a non-empty string',
    );
  }

  await clayFetch(`/workspaces/${workspaceId}/claygents/${claygentId}`, {
    method: 'DELETE',
  });

  return {
    success: true,
  };
}

// ============================================================================
// Playground Run (Claygent Execution)
// ============================================================================

interface PlaygroundRunResponse {
  success: boolean;
  data: unknown;
  metadata: {
    status: string;
    message: string | null;
    textPreview: string | null;
    streamingProgressKey: string;
    hiddenData: {
      asyncRequestId: string;
      jobId: string;
    };
  };
}

interface PlaygroundRunResultResponse {
  fullValue: Record<string, unknown> | null;
  status: string;
  message: string | null;
  textPreview: string | null;
  imagePreview: string | null;
  isComplete: boolean;
  confidence: string | null;
  additionalCreditCost: number | null;
  hiddenData: {
    costDetails?: {
      inputTokens: number;
      outputTokens: number;
      tokensUsed: number;
      totalCostToAIProvider: string;
    };
    responseType?: string;
    requestedModel?: string;
    actualModel?: string;
    provider?: string;
    langSmithTraceURL?: string;
  } | null;
  timestamp: number;
  runId: string;
}

interface WorkspaceFeatureFlags {
  enableClaygent?: boolean;
  [key: string]: unknown;
}

interface WorkspaceDetailsForFeatureCheck {
  id: number;
  featureFlags: WorkspaceFeatureFlags;
}

/**
 * Start a claygent run (fire-and-forget).
 * Returns runId immediately; use getClaygentRun() to poll for results.
 */
export async function runClaygent(
  opts: RunClaygentInput,
): Promise<RunClaygentOutput> {
  const { workspaceId, claygentId, variableValues } = opts;

  if (
    !workspaceId ||
    typeof workspaceId === 'boolean' ||
    String(workspaceId).trim() === ''
  ) {
    throw new Validation(
      'runClaygent: workspaceId is required and must be a non-empty string or number',
    );
  }
  if (
    !claygentId ||
    typeof claygentId === 'boolean' ||
    String(claygentId).trim() === ''
  ) {
    throw new Validation(
      'runClaygent: claygentId is required and must be a non-empty string (c_xxx format)',
    );
  }

  // Step 1: Check workspace feature flags (non-blocking, used for diagnostics)
  let claygentFeatureEnabled = true;
  try {
    const wsData = await clayFetch<WorkspaceDetailsForFeatureCheck>(
      `/workspaces/${workspaceId}`,
    );
    claygentFeatureEnabled = wsData?.featureFlags?.enableClaygent !== false;
  } catch {
    // Non-blocking; if workspace check fails, proceed anyway
  }

  // Step 2: Fetch claygent config
  const claygentData = await clayFetch<SingleClaygentResponse>(
    `/workspaces/${workspaceId}/claygents/${claygentId}`,
  );
  const c = claygentData.claygent;
  const cv = c.currentVersion;

  // Step 3: Build the playground-run request body (matches what the UI sends)
  const runId = `playground-run-${crypto.randomUUID().slice(0, 8)}`;

  const formValues: Record<string, unknown> = {
    description: c.description || '',
    userPrompt: cv.userPrompt,
    selectedModel: cv.modelSettings.model,
    useCase: cv.modelSettings.useCase || '"claygent"',
    toolSettings: cv.toolSettings || {},
    internetSearchEnabled: cv.modelSettings.internetSearchEnabled ?? true,
    variables: cv.variables || [],
    toolConfigs: {},
    toolAuthConfigs: {},
    contextDocumentIds: [],
  };
  // outputFormat must be a serialized JSON string; omit when not configured
  if (cv.outputFormat) {
    formValues.outputFormat = JSON.stringify(cv.outputFormat);
  }

  const payload = {
    formValues,
    variables: cv.variables || [],
    variableValues: variableValues || {},
    runId,
    documentConnections: {},
  };

  // Step 4: Submit the run
  let runResponse: PlaygroundRunResponse;
  try {
    runResponse = await clayFetch<PlaygroundRunResponse>(
      `/workspaces/${workspaceId}/playground-run`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  } catch (err) {
    const msg = (err as Error).message;
    // Provide context-specific error messages
    if (msg.includes('500')) {
      const featureFlagHint = !claygentFeatureEnabled
        ? ` Additionally, this workspace has featureFlags.enableClaygent=false, which may prevent claygent execution on some plans.`
        : '';
      throw new UpstreamError(
        `runClaygent: playground-run returned 500 for claygent ${claygentId}. ` +
          `This may indicate an invalid model ("${cv.modelSettings.model}"), missing API keys, or a server-side error.${featureFlagHint} ` +
          `Check the claygent's model settings with getClaygent().`,
      );
    }
    if (msg.includes('403')) {
      throw new PermissionDenied(
        `runClaygent: permission denied (403) for workspace ${workspaceId}. ` +
          `Ensure you are logged in and have permission to run claygents in this workspace.`,
      );
    }
    if (msg.includes('401')) {
      throw new Unauthenticated(
        `runClaygent: authentication error (401) for workspace ${workspaceId}. ` +
          `Ensure you are logged in and have permission to run claygents in this workspace.`,
      );
    }
    throw new UpstreamError(`runClaygent: failed to submit run: ${msg}`);
  }

  // Check if the run started successfully
  if (
    !runResponse.metadata ||
    runResponse.metadata.status !== 'AWAITING_CALLBACK'
  ) {
    throw new ContractDrift(
      `runClaygent: unexpected status "${runResponse.metadata?.status || 'unknown'}" from playground-run for claygent ${claygentId}. ` +
        `Expected "AWAITING_CALLBACK". Message: ${runResponse.metadata?.message || 'none'}`,
    );
  }

  // Fire and forget; return immediately with runId for polling via getClaygentRun()
  return {
    runId,
  };
}

/**
 * Check the status of a claygent run by its runId.
 * Use after runClaygent() returns TIMEOUT status to check if the run completed.
 */
export async function getClaygentRun(
  opts: GetClaygentRunInput,
): Promise<GetClaygentRunOutput> {
  const { workspaceId, runId } = opts;

  if (
    !workspaceId ||
    typeof workspaceId === 'boolean' ||
    String(workspaceId).trim() === ''
  ) {
    throw new Validation(
      'getClaygentRun: workspaceId is required and must be a non-empty string or number',
    );
  }
  if (!runId || typeof runId !== 'string' || runId.trim() === '') {
    throw new Validation(
      'getClaygentRun: runId is required and must be a non-empty string',
    );
  }

  const result = await clayFetch<PlaygroundRunResultResponse | null>(
    `/workspaces/${workspaceId}/playground-run/result/${runId}`,
  );

  // API returns null while the run is still in progress
  if (result === null || result === undefined) {
    return {
      status: 'PENDING',
      runId,
      textPreview: null,
      message: 'Run is still in progress.',
      fullValue: null,
      confidence: null,
      additionalCreditCost: null,
      model: null,
      tokensUsed: null,
      imagePreview: null,
    };
  }

  return {
    status: (result.status as 'SUCCESS' | 'ERROR' | 'PENDING') || 'PENDING',
    runId: result.runId || runId,
    textPreview: result.textPreview ?? null,
    message: result.message ?? null,
    fullValue: result.fullValue ?? null,
    confidence: result.confidence ?? null,
    additionalCreditCost: result.additionalCreditCost ?? null,
    model: result.hiddenData?.actualModel ?? null,
    tokensUsed: result.hiddenData?.costDetails?.tokensUsed ?? null,
    imagePreview: result.imagePreview ?? null,
  };
}

/**
 * Compute the next scheduled run time from a schedule's lastRunAt and period.
 */
function computeNextRunAt(
  schedule: TriggerDefinitionSchedule | null,
): string | null {
  if (!schedule || !schedule.lastRunAt) return null;
  const last = new Date(schedule.lastRunAt);
  if (isNaN(last.getTime())) return null;
  const amount = schedule.periodAmount || 1;
  switch (schedule.periodUnit) {
    case 'daily':
      last.setDate(last.getDate() + amount);
      break;
    case 'weekly':
      last.setDate(last.getDate() + amount * 7);
      break;
    case 'monthly':
      last.setMonth(last.getMonth() + amount);
      break;
    default:
      return null;
  }
  return last.toISOString();
}

/**
 * List signals in workspace.
 */
export async function listSignals(
  opts: ListSignalsInput,
): Promise<ListSignalsOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const data = await clayFetch<TriggerDefinitionsListResponse>(
    `/workspaces/${workspaceId}/trigger-definitions-with-schedule`,
  );

  const signals = (data.triggerDefinitions || []).map((td) => ({
    id: td.signalId,
    name: td.name,
    workspaceId: td.workspaceId,
    type: td.signal.type,
    runStatus: td.runStatus,
    triggerDefinitionId: td.id,
    schedule: td.schedule
      ? {
          periodAmount: td.schedule.periodAmount,
          periodUnit: td.schedule.periodUnit,
        }
      : null,
    lastRunAt: td.lastRunAt ?? td.schedule?.lastRunAt ?? null,
    nextRunAt: computeNextRunAt(td.schedule),
    outputWorkbookId: td.signalsHubInfo?.workbook?.id ?? null,
    outputTableId: td.signalsHubInfo?.table?.id ?? null,
    signalCost: td.signalsHubInfo?.signalCost ?? null,
    settings: td.signal.settings,
    inputs: td.signal.inputs,
  }));

  return {
    signals,
    totalCount: signals.length,
  };
}

/**
 * Get a single signal by ID.
 */
export async function getSignal(
  opts: GetSignalInput,
): Promise<GetSignalOutput> {
  const { workspaceId, signalId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!signalId) {
    throw new Validation('signalId is required');
  }

  // Use trigger-definitions to get the full signal data including name
  const data = await clayFetch<TriggerDefinitionsListResponse>(
    `/workspaces/${workspaceId}/trigger-definitions-with-schedule`,
  );

  const td = (data.triggerDefinitions || []).find(
    (t) => t.signalId === signalId,
  );
  if (!td) {
    throw new NotFound(
      `getSignal: signal ${signalId} not found in workspace ${workspaceId}`,
    );
  }

  return {
    id: td.signalId,
    name: td.name,
    workspaceId: td.workspaceId,
    type: td.signal.type,
    runStatus: td.runStatus,
    triggerDefinitionId: td.id,
    schedule: td.schedule
      ? {
          periodAmount: td.schedule.periodAmount,
          periodUnit: td.schedule.periodUnit,
        }
      : null,
    lastRunAt: td.lastRunAt ?? td.schedule?.lastRunAt ?? null,
    nextRunAt: computeNextRunAt(td.schedule),
    outputWorkbookId: td.signalsHubInfo?.workbook?.id ?? null,
    outputTableId: td.signalsHubInfo?.table?.id ?? null,
    signalCost: td.signalsHubInfo?.signalCost ?? null,
    settings: td.signal.settings,
    inputs: td.signal.inputs,
  };
}

interface TriggerDefinitionSchedule {
  id: string;
  periodAmount: number;
  periodUnit: string;
  lastRunAt: string | null;
  createdAt: string;
}

interface TriggerDefinitionResponse {
  triggerDefinition: {
    id: string;
    workspaceId: number;
    name: string;
    signalId: string;
    runStatus: string;
    settings: Record<string, unknown>;
    schedule: TriggerDefinitionSchedule | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    signal: Record<string, unknown>;
    lastRunAt: string | null;
    signalsHubInfo: Record<string, unknown>;
  };
}

interface TriggerDefinitionsListResponse {
  triggerDefinitions: Array<{
    id: string;
    workspaceId: number;
    name: string;
    signalId: string;
    runStatus: string;
    settings: Record<string, unknown>;
    schedule: TriggerDefinitionSchedule | null;
    createdAt: string;
    updatedAt: string;
    lastRunAt: string | null;
    signal: {
      id: string;
      workspaceId: number;
      type: string;
      settings: Record<string, unknown>;
      inputs: Record<string, unknown>;
    };
    signalsHubInfo?: {
      signalCost?: { cost: number; chargeUnit: string };
      workbook?: { id: string; name: string };
      table?: { id: string; name: string; workbookId: string };
      sources?: Array<{ tableId: string; sourceId: string }>;
    };
  }>;
}

/**
 * Resolve a signalId to its triggerDefinitionId by listing trigger definitions.
 */
async function resolveTriggerDefinitionId(
  workspaceId: string,
  signalId: string,
): Promise<string> {
  const data = await clayFetch<TriggerDefinitionsListResponse>(
    `/workspaces/${workspaceId}/trigger-definitions-with-schedule`,
  );

  const td = (data.triggerDefinitions || []).find(
    (t) => t.signalId === signalId,
  );
  if (!td) {
    throw new NotFound(
      `No trigger definition found for signalId ${signalId} in workspace ${workspaceId}`,
    );
  }
  return td.id;
}

/**
 * Update a signal's operational configuration (status, schedule, name, filters).
 * Schedule updates use a separate /trigger-definitions/update-schedule endpoint.
 */
export async function updateSignal(
  opts: UpdateSignalInput,
): Promise<UpdateSignalOutput> {
  const { workspaceId, signalId, runStatus, name, schedule, settings, runNow } =
    opts;

  if (!workspaceId) {
    throw new Validation('updateSignal: workspaceId is required');
  }
  if (!signalId) {
    throw new Validation('updateSignal: signalId is required');
  }
  if (name !== undefined && name.length === 0) {
    throw new Validation('updateSignal: name must be non-empty');
  }

  // Resolve signalId to triggerDefinitionId
  const triggerDefinitionId = await resolveTriggerDefinitionId(
    String(workspaceId),
    signalId,
  );

  // Build the update payload; only include fields that were provided
  const hasNonScheduleUpdates =
    runStatus !== undefined ||
    name !== undefined ||
    settings !== undefined ||
    runNow === true;

  let data!: TriggerDefinitionResponse;

  if (hasNonScheduleUpdates) {
    const update: Record<string, unknown> = {
      from: 'signals-dashboard',
    };

    if (runStatus !== undefined) {
      update.runStatus = runStatus;
    }
    if (name !== undefined) {
      update.name = name;
    }
    if (settings !== undefined) {
      update.settings = settings;
    }

    const body: Record<string, unknown> = {
      workspaceId: String(workspaceId),
      triggerDefinitionId,
      update,
    };

    if (runNow === true) {
      body.updateAndRunNow = true;
    }

    data = await clayFetch<TriggerDefinitionResponse>(
      '/trigger-definitions/update',
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
    );
  }

  // Schedule changes use a dedicated endpoint (workspaceId must be a number)
  if (schedule !== undefined) {
    data = await clayFetch<TriggerDefinitionResponse>(
      '/trigger-definitions/update-schedule',
      {
        method: 'PUT',
        body: JSON.stringify({
          workspaceId: Number(workspaceId),
          triggerDefinitionId,
          newSchedule: schedule,
        }),
      },
    );

    // Verify schedule was actually applied; Clay silently ignores schedule
    // changes on some plan tiers (returns 200 with old schedule unchanged)
    const returnedSchedule = data.triggerDefinition.schedule;
    if (
      returnedSchedule &&
      (returnedSchedule.periodAmount !== schedule.periodAmount ||
        returnedSchedule.periodUnit !== schedule.periodUnit)
    ) {
      throw new ContractDrift(
        `updateSignal: schedule change was not applied (requested ${schedule.periodAmount} ${schedule.periodUnit}, ` +
          `got ${returnedSchedule.periodAmount} ${returnedSchedule.periodUnit}). ` +
          `This is likely a plan-level restriction; upgrade to change signal schedules.`,
      );
    }
  }

  // If neither update was needed, fetch current state
  if (!hasNonScheduleUpdates && schedule === undefined) {
    data = await clayFetch<TriggerDefinitionResponse>(
      '/trigger-definitions/update',
      {
        method: 'PUT',
        body: JSON.stringify({
          workspaceId: String(workspaceId),
          triggerDefinitionId,
          update: { from: 'signals-dashboard' },
        }),
      },
    );
  }

  const td = data.triggerDefinition;

  return {
    id: td.id,
    workspaceId: td.workspaceId,
    name: td.name,
    signalId: td.signalId,
    runStatus: td.runStatus,
    schedule: td.schedule
      ? {
          periodAmount: td.schedule.periodAmount,
          periodUnit: td.schedule.periodUnit,
        }
      : null,
    settings: td.settings,
    createdAt: td.createdAt,
    updatedAt: td.updatedAt,
    deletedAt: td.deletedAt ?? null,
    lastRunAt: td.lastRunAt ?? null,
  };
}

/**
 * Delete a signal from a workspace.
 * Signals are backed by trigger definitions; this calls DELETE on the
 * trigger-definitions endpoint using the signal ID.
 */
export async function deleteSignal(
  opts: DeleteSignalInput,
): Promise<DeleteSignalOutput> {
  const { workspaceId, signalId } = opts;

  if (
    !workspaceId ||
    typeof workspaceId === 'boolean' ||
    String(workspaceId).trim() === ''
  ) {
    throw new Validation(
      'deleteSignal: workspaceId is required and must be a non-empty string',
    );
  }
  if (
    !signalId ||
    typeof signalId === 'boolean' ||
    String(signalId).trim() === ''
  ) {
    throw new Validation(
      'deleteSignal: signalId is required and must be a non-empty string',
    );
  }

  // Resolve signalId (sig_xxx) to triggerDefinitionId (td_xxx)
  const triggerDefinitionId = await resolveTriggerDefinitionId(
    String(workspaceId),
    signalId,
  );

  await clayFetch(
    `/workspaces/${workspaceId}/trigger-definitions/${triggerDefinitionId}`,
    { method: 'DELETE' },
  );

  return {
    success: true,
  };
}

/**
 * Signal inputs by type: the shape the API expects for each signal type.
 */
type PersonIdentifier = {
  fieldId: string;
  pathAsFormula: string;
};

type CompanyIdentifier = {
  fieldId: string;
  pathAsFormula: string;
};

interface CreateSourceResponse {
  table: {
    id: string;
    workspaceId: number;
    name: string;
    workbookId: string;
    firstViewId: string;
  };
  sourceId: string;
}

interface CreateTriggerResponse {
  triggerDefinition: {
    id: string;
    workspaceId: number;
    name: string;
    runStatus: string;
    signal: {
      id: string;
      workspaceId: number;
      type: string;
      settings: Record<string, unknown>;
      inputs: Record<string, unknown>;
    };
    settings: Record<string, unknown>;
    signalsHubInfo: {
      workbook: { id: string; name: string };
      table: { id: string; name: string; workbookId: string };
    };
  };
}

/**
 * People-based signal types require a personIdentifier field.
 */
const PEOPLE_SIGNAL_TYPES = new Set(['JobChange', 'NewHire', 'Promotion']);

/**
 * Company-based signal types require a companyIdentifier field (JobPost)
 * or companyDomain field (News).
 */
const COMPANY_SIGNAL_TYPES = new Set(['JobPost', 'News']);

/**
 * Map user-facing signal type to the type string the create-trigger API accepts.
 * The create-source endpoint accepts all types, but create-trigger's Zod union
 * only recognizes a subset. NewHire maps to JobChange in the trigger inputs.
 */
const TRIGGER_INPUT_TYPE_MAP: Record<string, string> = {
  NewHire: 'JobChange',
};

/**
 * Build the signal inputs object for the trigger definition.
 */
function buildSignalInputs(
  signalType: string,
  tableId: string,
  viewId: string,
  personIdentifier: PersonIdentifier | null,
  companyIdentifier: CompanyIdentifier | null,
  lookBackMonths: number,
): Record<string, unknown> {
  const inputType = TRIGGER_INPUT_TYPE_MAP[signalType] || signalType;

  const base: Record<string, unknown> = {
    type: inputType,
    tableId,
    viewId,
    lookBackTimeWindowInMonths: lookBackMonths,
  };

  if (PEOPLE_SIGNAL_TYPES.has(signalType) && personIdentifier) {
    base.personIdentifier = personIdentifier;
    base.initialCompanyIdentifier = null;
  } else if (signalType === 'News' && companyIdentifier) {
    // News uses companyDomain (not companyIdentifier)
    base.companyDomain = companyIdentifier;
  } else if (COMPANY_SIGNAL_TYPES.has(signalType) && companyIdentifier) {
    base.companyIdentifier = companyIdentifier;
  }

  return base;
}

/**
 * Create a new signal to monitor contacts or companies for changes.
 */
export async function createSignal(
  opts: CreateSignalInput,
): Promise<CreateSignalOutput> {
  const {
    workspaceId,
    signalType,
    name,
    originTableId,
    originViewId,
    personIdentifierFieldId,
    companyIdentifierFieldId,
    lookBackTimeWindowInMonths = 3,
    schedule,
    parentFolderId,
  } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!originTableId) {
    throw new Validation('originTableId is required');
  }

  // Supported signal types for table-based creation
  const SUPPORTED_TYPES = new Set([
    'JobChange',
    'NewHire',
    'Promotion',
    'JobPost',
    'News',
  ]);
  if (!SUPPORTED_TYPES.has(signalType)) {
    throw new Validation(
      `createSignal does not support "${signalType}". Supported types: ${Array.from(SUPPORTED_TYPES).join(', ')}. For custom signals (RSS, social media, GitHub, etc.), use createCustomSignal().`,
    );
  }

  // Validate identifier requirements by signal type
  if (PEOPLE_SIGNAL_TYPES.has(signalType) && !personIdentifierFieldId) {
    throw new Validation(
      `personIdentifierFieldId is required for ${signalType} signals. Provide a field ID (f_xxx) for a LinkedIn Profile URL or email field in the origin table.`,
    );
  }
  if (COMPANY_SIGNAL_TYPES.has(signalType) && !companyIdentifierFieldId) {
    throw new Validation(
      `companyIdentifierFieldId is required for ${signalType} signals. Provide a field ID (f_xxx) for a company domain or LinkedIn URL field in the origin table.`,
    );
  }

  // Validate lookBackTimeWindowInMonths bounds
  if (
    lookBackTimeWindowInMonths !== undefined &&
    (lookBackTimeWindowInMonths < 1 ||
      !Number.isInteger(lookBackTimeWindowInMonths))
  ) {
    throw new Validation(
      `createSignal: lookBackTimeWindowInMonths must be a positive integer (got ${lookBackTimeWindowInMonths})`,
    );
  }

  // Validate schedule if provided
  if (schedule) {
    if (
      !schedule.periodAmount ||
      schedule.periodAmount < 1 ||
      !Number.isInteger(schedule.periodAmount)
    ) {
      throw new Validation(
        `createSignal: schedule.periodAmount must be a positive integer (got ${schedule.periodAmount})`,
      );
    }
    const VALID_PERIOD_UNITS = new Set([
      'minute',
      'fifteen-minutes',
      'hourly',
      'daily',
      'weekly',
      'biweekly',
      'monthly',
      'quarterly',
    ]);
    if (!schedule.periodUnit) {
      throw new Validation(
        `createSignal: schedule.periodUnit is required when schedule is provided. Valid values: ${Array.from(VALID_PERIOD_UNITS).join(', ')}`,
      );
    }
    if (!VALID_PERIOD_UNITS.has(schedule.periodUnit)) {
      throw new Validation(
        `createSignal: invalid schedule.periodUnit "${schedule.periodUnit}". Valid values: ${Array.from(VALID_PERIOD_UNITS).join(', ')}`,
      );
    }
  }

  const signalName = name || signalType.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Step 1: Create the signal source (destination table + source binding)
  const sourceBody: Record<string, unknown> = {
    workspaceId: Number(workspaceId),
    signalType,
    name: signalName,
    originTableId,
  };
  if (parentFolderId) {
    sourceBody.parentFolderId = parentFolderId;
  }

  const sourceData = await clayFetch<CreateSourceResponse>(
    '/trigger-definitions/create-source',
    {
      method: 'POST',
      body: JSON.stringify(sourceBody),
    },
  );

  const sourceId = sourceData.sourceId;
  const destTableId = sourceData.table.id;
  const destWorkbookId = sourceData.table.workbookId;
  const destViewId = sourceData.table.firstViewId;

  // Resolve the origin view ID if not provided
  let resolvedViewId = originViewId;
  if (!resolvedViewId) {
    // Fetch origin table to get its first view
    const tableData = await clayFetch<{
      table: { firstViewId: string; views?: Array<{ id: string }> };
    }>(`/tables/${originTableId}`);
    resolvedViewId =
      tableData.table.firstViewId ||
      tableData.table.views?.[0]?.id ||
      destViewId;
  }

  // Build person/company identifiers
  const personIdentifier: PersonIdentifier | null = personIdentifierFieldId
    ? {
        fieldId: personIdentifierFieldId,
        pathAsFormula: `{{${personIdentifierFieldId}}}`,
      }
    : null;

  const companyIdentifier: CompanyIdentifier | null = companyIdentifierFieldId
    ? {
        fieldId: companyIdentifierFieldId,
        pathAsFormula: `{{${companyIdentifierFieldId}}}`,
      }
    : null;

  // Build inputs
  const signalInputs = buildSignalInputs(
    signalType,
    originTableId,
    resolvedViewId,
    personIdentifier,
    companyIdentifier,
    lookBackTimeWindowInMonths,
  );

  // Step 2: Create the trigger definition
  const triggerBody: Record<string, unknown> = {
    sourceId,
    newTriggerDefinition: {
      workspaceId: Number(workspaceId),
      name: signalName,
      runStatus: 'Paused',
      signal: {
        workspaceId: Number(workspaceId),
        type: signalType,
        inputs: signalInputs,
      },
    },
  };

  if (schedule) {
    triggerBody.newSchedule = schedule;
  } else {
    triggerBody.newSchedule = {
      periodAmount: 1,
      periodUnit: 'monthly',
    };
  }

  const triggerData = await clayFetch<CreateTriggerResponse>(
    '/trigger-definitions/create-trigger',
    {
      method: 'POST',
      body: JSON.stringify(triggerBody),
    },
  );

  const td = triggerData.triggerDefinition;

  return {
    signalId: td.signal.id,
    triggerDefinitionId: td.id,
    sourceId,
    tableId: destTableId,
    workbookId: destWorkbookId,
    name: td.name,
    signalType: td.signal.type,
    runStatus: td.runStatus,
  };
}

/**
 * List documents in a workspace, optionally filtered by context.
 */
export async function listClaygentDocuments(
  opts: ListClaygentDocumentsInput,
): Promise<ListClaygentDocumentsOutput> {
  const { workspaceId, context = 'agent_playground' } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const data = await clayFetch<DocumentsResponse>(
    `/documents/${workspaceId}?context=${encodeURIComponent(context)}`,
  );

  const documents = (data.documents || []).map((d) => ({
    id: d.id,
    name: d.name,
    folderId: d.folderId ?? null,
    mimeType: d.mimeType ?? '',
    size: d.size ?? '0',
    context: d.context ?? '',
    createdAt: d.createdAt ?? '',
    updatedAt: d.updatedAt ?? '',
  }));

  return {
    documents,
  };
}

// ============================================================================
// Custom Signal Source Registry
// ============================================================================

/**
 * Static registry of all 37 custom signal source types available in Clay.
 * Extracted from Clay's JS bundle; no API call needed.
 * Wizard config fields (defaultPreviewText/previewTextPath, recordsPath, idPath,
 * csRank, csTitle, csDesc) are required by the wizard evaluate-step API.
 */
const CUSTOM_SIGNAL_SOURCES = [
  // SOCIAL (20)
  {
    actionKey: 'social-posts-discover-posts-source-v2',
    actionPackageId: 'b210a16b-cdaf-4cbd-ad9b-42d762cd165f',
    name: 'Find professional posts',
    iconType: 'SocialPostsSource',
    category: 'social' as const,
    description: 'Discover professional social media posts by topic or keyword',
    authRequired: false,
    defaultPreviewText: 'Professional Post',
    recordsPath: 'posts',
    idPath: 'url',
    requiredInputs: ['keywords'],
    csRank: 1,
    csTitle: 'Monitor professional posts',
    csDesc: 'Monitor for professional posts based on keywords and filters.',
  },
  {
    actionKey: 'social-posts-get-posts-interactions-source',
    actionPackageId: 'b210a16b-cdaf-4cbd-ad9b-42d762cd165f',
    name: 'Get interactions with professional posts',
    iconType: 'SocialPostsSource',
    category: 'social' as const,
    description:
      'Track interactions (likes, comments, shares) on social media posts',
    authRequired: false,
    previewTextPath: 'preview_text',
    recordsPath: 'interactions',
    idPath: 'dedupe_id',
    requiredInputs: ['postUrls'],
    csRank: 2,
    csTitle: 'Monitor interactions with professional posts',
    csDesc:
      'Monitor comments, reactions, or shares for a list of professional posts.',
  },
  {
    actionKey: 'linkedin-social-action-audience-source-v2',
    actionPackageId: '33e29508-31ff-481e-ab3f-8830bab872d7',
    name: 'Find post audiences on LinkedIn',
    iconType: 'LinkedInOfficialSource',
    category: 'social' as const,
    description: 'Monitor audiences engaging with LinkedIn posts',
    authRequired: true,
    authType: 'linkedin',
    previewTextPath: 'reactionType',
    recordsPath: 'reactions',
    idPath: 'profile_url',
    requiredInputs: ['postUrls'],
    csRank: 3,
    csTitle: 'Monitor post audiences on LinkedIn',
    csDesc:
      'Monitor LinkedIn users who engaged with posts mentioning your brand or reposts of your content.',
  },
  {
    actionKey: 'adbeat-find-ads-source',
    actionPackageId: 'f764eeac-881e-45c5-90d2-1882c039e7ff',
    name: 'Search for ads with Adbeat',
    iconType: 'Adbeat',
    category: 'social' as const,
    description: 'Find display advertising data via Adbeat',
    authRequired: true,
    authType: 'adbeat',
    defaultPreviewText: 'Ad found',
    recordsPath: 'ads',
    idPath: 'adHash',
    requiredInputs: ['domain'],
    csRank: 3,
    csTitle: 'Monitor for ads with Adbeat',
    csDesc:
      'Monitor for ads using filters like company domain, category, ad type, creative copy, & more.',
  },
  {
    actionKey: 'reddit-search-source',
    actionPackageId: '33e29508-31ff-481e-ab3f-8830bab872d7',
    name: 'Find mentions on Reddit',
    iconType: 'RedditSource',
    category: 'social' as const,
    description: 'Monitor Reddit for mentions of keywords, brands, or topics',
    authRequired: true,
    authType: 'reddit',
    previewTextPath: 'keywords',
    recordsPath: 'mentions',
    idPath: 'id',
    requiredInputs: ['keywords'],
    csRank: 4,
    csTitle: 'Monitor mentions on Reddit',
    csDesc:
      'Monitor posts on Reddit mentioning your brand, other brands, or specific keywords.',
  },
  {
    actionKey: 'x-mentions-source',
    actionPackageId: '4e650664-606c-485a-8e0c-073eae4c1aca',
    name: 'Pull mentions from X',
    iconType: 'XSource',
    category: 'social' as const,
    description: 'Monitor X (Twitter) for mentions of keywords or handles',
    authRequired: false,
    previewTextPath: 'user.handle',
    recordsPath: 'mentions',
    idPath: 'id',
    requiredInputs: ['keywords'],
    csRank: 5,
    csTitle: 'Monitor mentions from X',
    csDesc: 'Monitor recent posts mentioning any keyword or handle on X',
  },
  {
    actionKey: 'x-profile-search-source',
    actionPackageId: '4e650664-606c-485a-8e0c-073eae4c1aca',
    name: 'Profiles on X by topic',
    iconType: 'XSource',
    category: 'social' as const,
    description: 'Find X profiles related to specific topics or keywords',
    authRequired: false,
    defaultPreviewText: 'Profile',
    recordsPath: 'users',
    idPath: 'rest_id',
    requiredInputs: ['keywords'],
    csRank: 6,
    csTitle: 'Monitor profiles on X by topic',
    csDesc: 'Monitor all profiles on X by a specific topic.',
  },
  {
    actionKey: 'google-news-rss-feed-source',
    actionPackageId: '28d4ca01-42a7-4085-8b31-097d20ea420a',
    name: 'Monitor Google News RSS Feed',
    iconType: 'GoogleNewsSource',
    category: 'social' as const,
    description: 'Monitor Google News RSS feeds for articles matching keywords',
    authRequired: false,
    defaultPreviewText: 'News Article',
    recordsPath: 'items',
    idPath: 'clayFeedItemId',
    requiredInputs: ['url'],
    csRank: 7,
    csTitle: 'Monitor Google News RSS Feed',
    csDesc:
      'Monitor a Google News RSS feed to pull news articles into a Clay Table',
  },
  {
    actionKey: 'x-followers-source',
    actionPackageId: '4e650664-606c-485a-8e0c-073eae4c1aca',
    name: 'Pull followers on X',
    iconType: 'XSource',
    category: 'social' as const,
    description: 'Import followers of a specific X account',
    authRequired: false,
    defaultPreviewText: 'Profile',
    recordsPath: 'users',
    idPath: 'rest_id',
    requiredInputs: ['handle'],
    csRank: 8,
    csTitle: 'Monitor followers on X',
    csDesc: 'Monitor all followers of a specific X user.',
  },
  {
    actionKey: 'x-following-source',
    actionPackageId: '4e650664-606c-485a-8e0c-073eae4c1aca',
    name: 'Profiles followed by X user',
    iconType: 'XSource',
    category: 'social' as const,
    description: 'Import accounts followed by a specific X user',
    authRequired: false,
    defaultPreviewText: 'Profile',
    recordsPath: 'users',
    idPath: 'rest_id',
    requiredInputs: ['handle'],
    csRank: 8,
    csTitle: 'Monitor profiles followed by X user',
    csDesc: 'Monitor all followers of a specific X profile.',
  },
  {
    actionKey: 'x-recent-tweets-source',
    actionPackageId: '4e650664-606c-485a-8e0c-073eae4c1aca',
    name: 'Pull activity from X accounts',
    iconType: 'XSource',
    category: 'social' as const,
    description: 'Import recent tweets/posts from a specific X account',
    authRequired: false,
    previewTextPath: 'user.handle',
    recordsPath: 'tweets',
    idPath: 'id',
    requiredInputs: ['handles'],
    csRank: 9,
    csTitle: 'Monitor activity from X accounts',
    csDesc:
      'Monitor recent X activity from a list of specified account handles.',
  },
  {
    actionKey: 'youtube-search-source',
    actionPackageId: '4fd1716e-9627-4955-8e6e-e5a3d6073fcc',
    name: 'Search for YouTube videos or creators',
    iconType: 'YouTube',
    category: 'social' as const,
    description: 'Search YouTube for videos or creators by topic',
    authRequired: false,
    defaultPreviewText: 'Result Found',
    recordsPath: 'results',
    idPath: 'link',
    requiredInputs: ['query'],
    csRank: 10,
    csTitle: 'Monitor for YouTube videos or creators',
    csDesc:
      'Use natural language to monitor YouTube videos for enrichment & analysis or channels to find influencers & partners.',
  },
  {
    actionKey: 'instagram-find-following-profiles-source',
    actionPackageId: 'e178d3f1-56c2-4b7b-b6f7-f5ab05480b36',
    name: 'Find profiles followed by an Instagram user',
    iconType: 'InstagramSource',
    category: 'social' as const,
    description: 'Import accounts followed by a specific Instagram profile',
    authRequired: false,
    defaultPreviewText: 'Profile',
    recordsPath: 'users',
    idPath: 'profile_url',
    requiredInputs: ['username'],
    csRank: 11,
    csTitle: 'Monitor profiles followed by an Instagram user',
    csDesc: 'Monitor all profiles followed by a specific Instagram user.',
  },
  {
    actionKey: 'instagram-followers-source',
    actionPackageId: 'e178d3f1-56c2-4b7b-b6f7-f5ab05480b36',
    name: 'Pull followers on Instagram',
    iconType: 'InstagramSource',
    category: 'social' as const,
    description: 'Import followers of a specific Instagram account',
    authRequired: false,
    defaultPreviewText: 'Profile',
    recordsPath: 'users',
    idPath: 'uuid',
    requiredInputs: ['username'],
    csRank: 12,
    csTitle: 'Monitor followers on Instagram',
    csDesc: 'Monitor all followers of a specific Instagram profile.',
  },
  {
    actionKey: 'modash-search',
    actionPackageId: '1d8e2ea3-4ab7-4293-b223-8bcd53e85944',
    name: 'Find social media influencers with Modash',
    iconType: 'ModashSource',
    category: 'social' as const,
    description: 'Search for influencers via Modash platform',
    authRequired: true,
    authType: 'modash',
    defaultPreviewText: 'Influencer Found',
    recordsPath: 'influencers',
    idPath: 'userId',
    requiredInputs: ['criteria'],
    csRank: 13,
    csTitle: 'Monitor social media influencers with Modash',
    csDesc:
      'Monitor influencers on Instagram, TikTok, and Youtube based on relevant criteria.',
  },
  {
    actionKey: 'upfluence-find-influencers-source',
    actionPackageId: 'fb9e1d38-6046-4aca-901e-152c349fd0bf',
    name: 'Find social media micro-influencers with Upfluence',
    iconType: 'UpfluenceSource',
    category: 'social' as const,
    description: 'Find micro-influencers via Upfluence',
    authRequired: true,
    authType: 'upfluence',
    defaultPreviewText: 'Influencer Found',
    recordsPath: 'influencers',
    idPath: 'id',
    requiredInputs: ['criteria'],
    csRank: 14,
    csTitle: 'Monitor social media micro-influencers with Upfluence',
    csDesc:
      'Monitor Instagram, TikTok, and YouTube influencers with between 10k and 100k followers from Upfluence',
  },
  {
    actionKey: 'trigify-social-mapping-source',
    actionPackageId: '812333ce-918d-41e0-8418-2a13d0d59695',
    name: 'Find prospects engaging with professional posts using Trigify',
    iconType: 'Trigify',
    category: 'social' as const,
    description: 'Map social post engagement data via Trigify',
    authRequired: true,
    authType: 'trigify',
    defaultPreviewText: 'Prospect',
    recordsPath: 'results',
    idPath: 'hash',
    requiredInputs: ['postUrls'],
    csRank: 15,
    csTitle: 'Monitor prospects engaging with professional posts using Trigify',
    csDesc:
      'Monitor for prospects that have engaged with specific professional posts',
  },
  {
    actionKey: 'find-stargazers',
    actionPackageId: '47b53465-3762-4509-90d1-1208e3acdcc5',
    name: 'Find stargazers on GitHub',
    iconType: 'GitHubSource',
    category: 'social' as const,
    description: 'Import users who starred a GitHub repository',
    authRequired: false,
    previewTextPath: 'username',
    recordsPath: 'stargazers',
    idPath: 'username',
    requiredInputs: ['repoUrl'],
    csRank: 16,
    csTitle: 'Monitor stargazers on GitHub',
    csDesc: 'Monitor people who have starred a repository',
  },
  {
    actionKey: 'find-contributors',
    actionPackageId: '47b53465-3762-4509-90d1-1208e3acdcc5',
    name: 'Find contributors on GitHub',
    iconType: 'GitHubSource',
    category: 'social' as const,
    description: 'Import contributors to a GitHub repository',
    authRequired: false,
    previewTextPath: 'username',
    recordsPath: 'contributors',
    idPath: 'username',
    requiredInputs: ['repoUrl'],
    csRank: 17,
    csTitle: 'Monitor contributors on GitHub',
    csDesc: 'Monitor people who have contributed to a repository.',
  },
  {
    actionKey: 'find-forks',
    actionPackageId: '47b53465-3762-4509-90d1-1208e3acdcc5',
    name: 'Find forks on GitHub',
    iconType: 'GitHubSource',
    category: 'social' as const,
    description: 'Import users who forked a GitHub repository',
    authRequired: false,
    previewTextPath: 'username',
    recordsPath: 'forks',
    idPath: 'username',
    requiredInputs: ['repoUrl'],
    csRank: 18,
    csTitle: 'Monitor forks on GitHub',
    csDesc: 'Monitor people who have forked a repository',
  },
  // FIRST_PARTY (5)
  {
    actionKey: 'snowflake-select-source-v3',
    actionPackageId: '95e948a2-0e4c-43fb-84e4-06449ae1e077',
    name: 'Import from Snowflake',
    iconType: 'Snowflake',
    category: 'first_party' as const,
    description: 'Import data from Snowflake warehouse queries',
    authRequired: true,
    authType: 'snowflake',
    defaultPreviewText: 'Snowflake row found',
    recordsPath: 'results',
    idPath: 'clayDedupeId',
    requiredInputs: ['query'],
    csRank: 1,
    csTitle: 'Monitor Snowflake data',
    csDesc: 'Monitor changes to data in a Snowflake table',
  },
  {
    actionKey: 'databricks-import-table-source',
    actionPackageId: '7b7b7440-2352-4513-b697-db09506ecf27',
    name: 'Import from Databricks',
    iconType: 'Databricks',
    category: 'first_party' as const,
    description: 'Import data from Databricks tables',
    authRequired: true,
    authType: 'databricks',
    defaultPreviewText: 'Databricks row found',
    recordsPath: 'results',
    idPath: 'clayDedupeId',
    requiredInputs: ['tableId'],
    csRank: 1,
    csTitle: 'Monitor Databricks data',
    csDesc: 'Monitor changes to data in a Databricks table',
  },
  {
    actionKey: 'mixpanel-profiles-in-cohort-source',
    actionPackageId: '865573fa-f8af-4796-8774-253f8cb12066',
    name: 'Import profiles from a Mixpanel cohort',
    iconType: 'MixpanelSource',
    category: 'first_party' as const,
    description: 'Import profiles from a Mixpanel cohort',
    authRequired: true,
    authType: 'mixpanel',
    previewTextPath: '$distinct_id',
    recordsPath: 'results',
    idPath: '$distinct_id',
    requiredInputs: ['cohortId'],
    csRank: 2,
    csTitle: 'Monitor profiles from a Mixpanel cohort',
    csDesc: 'Monitor and enrich profiles from your Mixpanel Cohorts.',
  },
  {
    actionKey: 'gong-get-calls-source',
    actionPackageId: '48aa0220-fa5b-43d8-a1a3-ffcbebfb713a',
    name: 'Pull calls from Gong',
    iconType: 'GongSource',
    category: 'first_party' as const,
    description: 'Import call recordings and metadata from Gong',
    authRequired: true,
    authType: 'gong',
    defaultPreviewText: 'Gong Call',
    recordsPath: 'calls',
    idPath: 'id',
    requiredInputs: [],
    csRank: 5,
    csTitle: 'Monitor calls from Gong',
    csDesc: 'Monitor calls from Gong',
  },
  {
    actionKey: 'crossbeam-accounts-source',
    actionPackageId: 'a8eef82c-7374-447f-9e23-bd586fd33f95',
    name: 'Import from Crossbeam',
    iconType: 'Crossbeam',
    category: 'first_party' as const,
    description: 'Import partner overlap accounts from Crossbeam',
    authRequired: true,
    authType: 'crossbeam',
    defaultPreviewText: 'Account Found',
    recordsPath: 'accounts',
    idPath: 'record_id',
    requiredInputs: ['partnerId'],
    csRank: 6,
    csTitle: 'Monitor accounts from Crossbeam',
    csDesc: 'Monitor accounts that overlap with a specific partner',
  },
  // SOURCING (6)
  {
    actionKey: 'trustradius-intent-source',
    actionPackageId: 'ff0ef5a7-4923-431e-8d08-bdb295372c78',
    name: 'Companies with buying intent by TrustRadius',
    iconType: 'TrustRadiusSource',
    category: 'sourcing' as const,
    description: 'Monitor buyer intent signals from TrustRadius',
    authRequired: true,
    authType: 'trustradius',
    previewTextPath: 'account_name',
    recordsPath: 'results',
    idPath: 'account_id',
    requiredInputs: ['criteria'],
    csRank: 1,
    csTitle: 'Monitor companies with buying intent by TrustRadius',
    csDesc: 'Monitor lists of companies based on their intent activities.',
  },
  {
    actionKey: 'hg-insights-companies-by-tech-stack-source-v2',
    actionPackageId: 'b7f3454a-5095-4cb2-b91b-79cdb54e0dd2',
    name: 'Companies by product usage with HG Insights',
    iconType: 'HGInsightsSource',
    category: 'sourcing' as const,
    description: 'Find companies by technology stack via HG Insights',
    authRequired: true,
    authType: 'hg-insights',
    previewTextPath: 'company_name',
    recordsPath: 'results',
    idPath: 'hg_company_id',
    requiredInputs: ['products'],
    csRank: 2,
    csTitle: 'Monitor companies by product usage with HG Insights',
    csDesc: 'Monitor lists of companies based on what products they use.',
  },
  {
    actionKey: 'openmart-find-local-businesses-source',
    actionPackageId: '8242cd97-37b4-4318-b25d-d46d1059f834',
    name: 'Find local businesses using Openmart',
    iconType: 'OpenmartSource',
    category: 'sourcing' as const,
    description: 'Find local businesses via Openmart',
    authRequired: false,
    defaultPreviewText: 'Business Found',
    recordsPath: 'results',
    idPath: 'id',
    requiredInputs: ['locations'],
    csRank: 3,
    csTitle: 'Monitor local businesses using Openmart',
    csDesc:
      'Monitor local businesses from a specific set of locations on Openmart',
  },
  {
    actionKey: 'google-review-source-v3',
    actionPackageId: '3282a1c7-6bb0-497e-a34b-32268e104e55',
    name: 'Find local businesses using Google Maps',
    iconType: 'GoogleMapsSource',
    category: 'sourcing' as const,
    description: 'Find local businesses from Google Maps reviews and listings',
    authRequired: false,
    defaultPreviewText: 'Business Found',
    recordsPath: 'results',
    idPath: 'id',
    requiredInputs: ['location'],
    csRank: 3,
    csTitle: 'Monitor local businesses using Google Maps',
    csDesc: 'Monitor local businesses from a specific location on Google Maps',
  },
  {
    actionKey: 'storeleads-source-v2',
    actionPackageId: '8921d8a0-8f6e-4b35-b668-4a53e7705acc',
    name: 'Find companies with Store Leads',
    iconType: 'StoreleadsSource',
    category: 'sourcing' as const,
    description:
      'Find e-commerce stores and their technology data via Store Leads',
    authRequired: false,
    defaultPreviewText: 'Search Result Found',
    recordsPath: 'results',
    idPath: 'name',
    requiredInputs: ['query'],
    csRank: 4,
    csTitle: 'Monitor companies with Store Leads',
    csDesc:
      'Monitor Store Leads to find companies by keyword, technology, or ecommerce platform',
  },
  {
    actionKey: 'pitchbook-pull-shared-search-results-source',
    actionPackageId: 'db12db1b-a228-480a-b1bb-7a1d8dd5fa8a',
    name: 'Import companies from Pitchbook shared search',
    iconType: 'PitchbookSource',
    category: 'sourcing' as const,
    description: 'Pull shared search results from Pitchbook',
    authRequired: true,
    authType: 'pitchbook',
    previewTextPath: 'companyName',
    recordsPath: 'results',
    idPath: 'companyId',
    requiredInputs: ['searchId'],
    csRank: 5,
    csTitle: 'Monitor companies from Pitchbook shared search',
    csDesc: 'Monitor companies from a Pitchbook Shared Search',
  },
  // OTHER (6)
  {
    actionKey: 'rss-feed-fetcher-source',
    actionPackageId: 'bd8ac81e-5c96-4cde-b096-017be9869f68',
    name: 'Pull RSS Feed',
    iconType: 'RSSFeedSource',
    category: 'other' as const,
    description: 'Monitor an RSS feed for new entries',
    authRequired: false,
    defaultPreviewText: 'RSS Feed Item',
    recordsPath: 'items',
    idPath: 'clayFeedItemId',
    requiredInputs: ['url'],
    csRank: 1,
    csTitle: 'Monitor RSS Feed',
    csDesc: 'Monitor an RSS feed to pull rows into a Clay Table',
  },
  {
    actionKey: 'search-google-source',
    actionPackageId: '3282a1c7-6bb0-497e-a34b-32268e104e55',
    name: 'Find with a Google Search',
    iconType: 'GoogleSource',
    category: 'other' as const,
    description: 'Monitor Google Search results for specific queries',
    authRequired: false,
    defaultPreviewText: 'Search Result Found',
    recordsPath: 'results',
    idPath: 'link',
    requiredInputs: ['query'],
    csRank: 2,
    csTitle: 'Monitor Google Search results',
    csDesc: 'Monitor search results from Google Search',
  },
  {
    actionKey: 'pull-data-source',
    actionPackageId: '3ac0ca43-ed34-4662-b69a-82a225f7a005',
    name: 'Pull in leads from Phantombuster',
    iconType: 'PhantomBusterSource',
    category: 'other' as const,
    description: 'Pull data from Phantombuster automations',
    authRequired: true,
    authType: 'phantombuster',
    defaultPreviewText: 'PhantomBuster Record',
    recordsPath: 'results',
    idPath: 'clayHTTPItemId',
    requiredInputs: ['containerId'],
    csRank: 4,
    csTitle: 'Monitor leads from Phantombuster',
    csDesc: 'Monitor your results from PhantomBuster Containers',
  },
  {
    actionKey: 'apify-source',
    actionPackageId: 'ea91b0b8-6c78-4d32-a978-345e923bdc93',
    name: 'Import data from Apify actor',
    iconType: 'ApifySource',
    category: 'other' as const,
    description: 'Run Apify actors and import results',
    authRequired: true,
    authType: 'apify',
    defaultPreviewText: 'Apify Record',
    recordsPath: 'results',
    idPath: 'id',
    requiredInputs: ['actorId'],
    csRank: 5,
    csTitle: 'Monitor data from Apify actor',
    csDesc: 'Monitor data from Apify Actor runs.',
  },
  {
    actionKey: 'airtable-pull-records-source',
    actionPackageId: 'c80f9425-497b-4a13-86a4-3edf0a093c2d',
    name: 'Enrich your data from Airtable',
    iconType: 'AirtableSource',
    category: 'other' as const,
    description: 'Import records from an Airtable base',
    authRequired: true,
    authType: 'airtable',
    defaultPreviewText: 'Airtable Record',
    recordsPath: 'records',
    idPath: 'id',
    requiredInputs: ['baseId'],
    csRank: 6,
    csTitle: 'Monitor and enrich your data from Airtable',
    csDesc: 'Monitor data from Airtable',
  },
  {
    actionKey: 'http-api-source',
    actionPackageId: '4299091f-3cd3-4d68-b198-0143575f471d',
    name: 'Import data from an HTTP API',
    iconType: 'HTTPAPISource',
    category: 'other' as const,
    description: 'Import data from any HTTP API endpoint',
    authRequired: false,
    defaultPreviewText: 'HTTP API Record',
    recordsPath: 'results',
    idPath: 'clayHTTPItemId',
    requiredInputs: ['url'],
    csRank: 6,
    csTitle: 'Monitor data from an HTTP API',
    csDesc: 'Monitor data from an HTTP API.',
  },
];

/**
 * List available custom signal source types.
 * Returns static metadata; no API call.
 */
export async function listCustomSignalSourceTypes(
  opts: ListCustomSignalSourceTypesInput,
): Promise<ListCustomSignalSourceTypesOutput> {
  const { category } = opts;

  let sources = CUSTOM_SIGNAL_SOURCES;
  if (category) {
    sources = sources.filter((s) => s.category === category);
  }

  return {
    sourceTypes: sources.map((s) => ({
      actionKey: s.actionKey,
      actionPackageId: s.actionPackageId,
      name: s.name,
      iconType: s.iconType,
      category: s.category,
      description: s.description,
      authRequired: s.authRequired,
      authType: s.authType,
      requiredInputs: s.requiredInputs,
    })),
    totalCount: sources.length,
  };
}

/** Response from wizard step 0 (action-selection): returns validated source config */
interface WizardStep0Response {
  workbookId: string | null;
  output: {
    type: string;
    workbookId: string | null;
    categories: string[];
    stepId: string;
    typeSettings: Record<string, unknown>;
    clientSettings: Record<string, unknown>;
    requiredInputs: string[];
    customSignalSettings: {
      categories: string[];
      rank?: number;
      title: string;
      description: string;
    };
  };
}

/** Response from wizard step 1 (signal-config): creates the signal, table, workbook, source */
interface WizardStep1Response {
  workbookId: string;
  output: {
    type: string;
    categories: string[];
    stepId: string;
    workbookId: string;
    isNewWorkbook: boolean;
    table: {
      tableId: string;
      tableName: string;
      viewId: string;
      fieldIds: string[];
      creditEstimatePerRow: number;
    };
    signal: {
      signalId: string;
    };
    triggerDefinition: {
      triggerDefinitionId: string;
      signalId: string;
      sourceId: string;
      tableId: string;
      viewId: string;
      schedule: Record<string, unknown>;
    };
    actionInputs: Record<string, unknown>;
  };
}

/**
 * Create a custom signal via the wizard API.
 * Uses a multi-step wizard flow matching the Clay UI:
 *   Step 0 (action-selection): validates source type, returns full typeSettings
 *   Step 1 (signal-config): sends inputs, creates signal + table + workbook + source
 */
export async function createCustomSignal(
  opts: CreateCustomSignalInput,
): Promise<CreateCustomSignalOutput> {
  const {
    workspaceId,
    sourceType,
    sourceInputs,
    appAccountId,
    schedule,
    name,
    parentFolderId,
  } = opts;

  if (!workspaceId) {
    throw new Validation('createCustomSignal: workspaceId is required');
  }
  if (!sourceType) {
    throw new Validation('createCustomSignal: sourceType is required');
  }

  // Look up source config from registry
  const sourceConfig = CUSTOM_SIGNAL_SOURCES.find(
    (s) => s.actionKey === sourceType,
  );
  if (!sourceConfig) {
    const validKeys = CUSTOM_SIGNAL_SOURCES.map((s) => s.actionKey).join(', ');
    throw new Validation(
      `createCustomSignal: unknown sourceType "${sourceType}". Valid source types: ${validKeys}`,
    );
  }

  if (sourceConfig.authRequired && !appAccountId) {
    throw new Validation(
      `createCustomSignal: sourceType "${sourceType}" (${sourceConfig.name}) requires an app account. ` +
        `Provide appAccountId (use listAppAccounts() to find a connected ${sourceConfig.authType || 'integration'} account).`,
    );
  }

  const signalName = name || sourceConfig.name;
  const sessionId = crypto.randomUUID();
  const categoryUpper = sourceConfig.category.toUpperCase();

  // ── Step 0: action-selection ──
  // Sends source type with full wizard config. Server validates all fields
  // and returns enriched typeSettings. Missing fields cause 500.
  const step0TypeSettings: Record<string, unknown> = {
    name: sourceConfig.name,
    iconType: sourceConfig.iconType,
    actionKey: sourceConfig.actionKey,
    actionPackageId: sourceConfig.actionPackageId,
    recordsPath: sourceConfig.recordsPath,
    idPath: sourceConfig.idPath,
    dedupeOnUniqueIds: true,
    hasEvaluatedInputs: false,
    scheduleConfig: {
      periodUnit: 'daily',
      periodAmount: 1,
      runSettings: 'schedule',
    },
  };

  // Set preview text: either static defaultPreviewText or path-based previewTextPath
  if ('defaultPreviewText' in sourceConfig && sourceConfig.defaultPreviewText) {
    step0TypeSettings.defaultPreviewText = sourceConfig.defaultPreviewText;
  }
  if ('previewTextPath' in sourceConfig && sourceConfig.previewTextPath) {
    step0TypeSettings.previewTextPath = sourceConfig.previewTextPath;
  }

  if (appAccountId) {
    step0TypeSettings.authAccountId = appAccountId;
  }

  const step0Payload = {
    workbookId: null,
    wizardId: 'custom-signal',
    wizardStepId: 'action-selection',
    formInputs: {
      actionSource: {
        typeSettings: step0TypeSettings,
        clientSettings: {},
        requiredInputs: Object.keys(sourceInputs || {}),
        customSignalSettings: {
          categories: [categoryUpper],
          rank: sourceConfig.csRank,
          title: sourceConfig.csTitle,
          description: sourceConfig.csDesc,
        },
      },
    },
    sessionId,
    currentStepIndex: 0,
    outputs: [],
    firstUseCase: null,
    parentFolderId: parentFolderId ?? null,
  };

  const step0 = await clayFetch<WizardStep0Response>(
    `/workspaces/${workspaceId}/wizard/evaluate-step`,
    {
      method: 'POST',
      body: JSON.stringify(step0Payload),
    },
  );

  if (!step0.output?.typeSettings) {
    throw new ContractDrift(
      'createCustomSignal: step 0 (action-selection) did not return typeSettings',
    );
  }

  // ── Step 1: signal-config ──
  // Sends the validated typeSettings from step 0 WITH inputs added.
  // This step creates the signal, table, workbook, and source.
  const step1TypeSettings = {
    ...step0.output.typeSettings,
    inputs: sourceInputs,
  };

  const step1Payload = {
    workbookId: null,
    wizardId: 'custom-signal',
    wizardStepId: 'signal-config',
    formInputs: {
      signalInputs: {
        type: 'Custom',
        typeSettings: step1TypeSettings,
        clientSettings: step0.output.clientSettings || {},
        requiredInputs: step0.output.requiredInputs || [],
      },
      initialResultsConfig: { option: 'skip-initial-results' },
      areInputsValid: true,
    },
    sessionId,
    currentStepIndex: 1,
    outputs: [step0.output],
    firstUseCase: null,
    parentFolderId: parentFolderId ?? null,
  };

  const step1 = await clayFetch<WizardStep1Response>(
    `/workspaces/${workspaceId}/wizard/evaluate-step`,
    {
      method: 'POST',
      body: JSON.stringify(step1Payload),
    },
  );

  if (!step1.output?.table?.tableId) {
    throw new ContractDrift(
      'createCustomSignal: step 1 (signal-config) did not return table data',
    );
  }

  const signalId =
    step1.output.signal?.signalId ||
    step1.output.triggerDefinition?.signalId ||
    '';
  const sourceId = step1.output.triggerDefinition?.sourceId || '';

  // Optional: Step 2 (select-frequency) - update schedule if non-default
  if (schedule) {
    try {
      await clayFetch(`/workspaces/${workspaceId}/wizard/evaluate-step`, {
        method: 'POST',
        body: JSON.stringify({
          workbookId: step1.workbookId,
          wizardId: 'custom-signal',
          wizardStepId: 'select-frequency',
          formInputs: {
            tableId: step1.output.table.tableId,
            viewId: step1.output.table.viewId,
            schedule: {
              periodUnit: schedule.periodUnit,
              periodAmount: schedule.periodAmount,
            },
            triggerDefinitionId:
              step1.output.triggerDefinition?.triggerDefinitionId,
          },
          sessionId,
          currentStepIndex: 2,
          outputs: [step0.output, step1.output],
          firstUseCase: null,
          parentFolderId: parentFolderId ?? null,
        }),
      });
    } catch {
      // Schedule update is non-critical; signal was already created
    }
  }

  // Rename the workbook to the user-provided name if specified
  if (name && step1.workbookId) {
    try {
      await clayFetch(`/${workspaceId}/workbooks/${step1.workbookId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: signalName }),
      });
    } catch {
      // Rename is non-critical
    }
  }

  // Rename the signal itself using the trigger-definitions/update endpoint
  const triggerDefinitionId =
    step1.output.triggerDefinition?.triggerDefinitionId;
  if (name && triggerDefinitionId) {
    try {
      await clayFetch(`/trigger-definitions/update`, {
        method: 'PUT',
        body: JSON.stringify({
          workspaceId: String(workspaceId),
          triggerDefinitionId,
          update: {
            name: signalName,
            from: 'signals-dashboard',
          },
        }),
      });
    } catch {
      // Signal rename is non-critical; signal was already created
    }
  }

  return {
    signalId,
    tableId: step1.output.table.tableId,
    workbookId: step1.workbookId,
    sourceId,
    name: signalName,
    runStatus: 'Paused',
  };
}

// ============================================================================
// Document Management
// ============================================================================

interface UploadUrlResponse {
  documentId: string;
  uploadUrl: string;
  fields: Record<string, string>;
}

interface ConfirmUploadResponse {
  id: string;
  name: string;
  folderId: string | null;
  mimeType: string;
  size: number;
  context: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create a context document in a workspace.
 * Documents can be referenced by Claygents for additional context.
 * Uses a 3-step presigned S3 upload flow internally.
 */
export async function createClaygentDocument(
  opts: CreateClaygentDocumentInput,
): Promise<CreateClaygentDocumentOutput> {
  const { workspaceId, name, content, context = 'agent_playground' } = opts;

  if (!workspaceId) {
    throw new Validation('createClaygentDocument: workspaceId is required');
  }
  if (!name) {
    throw new Validation('createClaygentDocument: name is required');
  }
  if (!content) {
    throw new Validation('createClaygentDocument: content is required');
  }

  // Step 1: Get presigned S3 upload URL
  const uploadData = await clayFetch<UploadUrlResponse>(
    `/documents/${workspaceId}/upload-url`,
    {
      method: 'POST',
      body: JSON.stringify({ name, context }),
    },
  );

  if (!uploadData.documentId || !uploadData.uploadUrl || !uploadData.fields) {
    throw new ContractDrift(
      'createClaygentDocument: upload-url response missing required fields (documentId, uploadUrl, fields)',
    );
  }

  // Step 2: Upload content to S3 via multipart form-data
  const formData = new FormData();
  for (const [key, value] of Object.entries(uploadData.fields)) {
    formData.append(key, value);
  }
  const blob = new Blob([content], { type: 'text/plain' });
  formData.append('file', blob, name);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadData.uploadUrl, true);
    xhr.timeout = 30000;

    xhr.onload = function () {
      if (xhr.status >= 400) {
        reject(
          new UpstreamError(
            `createClaygentDocument: S3 upload failed with status ${xhr.status}`,
          ),
        );
        return;
      }
      resolve();
    };

    xhr.onerror = function () {
      reject(new UpstreamError('createClaygentDocument: S3 upload network error'));
    };

    xhr.ontimeout = function () {
      reject(new UpstreamError('createClaygentDocument: S3 upload timeout (30s)'));
    };

    xhr.send(formData);
  });

  // Step 3: Confirm upload with Clay API
  const confirmed = await clayFetch<ConfirmUploadResponse>(
    `/documents/${workspaceId}/${uploadData.documentId}/confirm-upload`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );

  return {
    id: confirmed.id,
    name: confirmed.name,
  };
}

/**
 * Delete a context document from a workspace.
 */
export async function deleteClaygentDocument(
  opts: DeleteClaygentDocumentInput,
): Promise<DeleteClaygentDocumentOutput> {
  const { workspaceId, documentId } = opts;

  if (!workspaceId) {
    throw new Validation('deleteClaygentDocument: workspaceId is required');
  }
  if (!documentId) {
    throw new Validation('deleteClaygentDocument: documentId is required');
  }

  await clayFetch(`/documents/${workspaceId}/${documentId}?hard=false`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });

  return {
    success: true,
  };
}

// ============================================================================
// Claygent Column Deployment
// ============================================================================

/**
 * Claygent action metadata: extracted from Clay's JS bundle.
 * Clay's frontend uses actionKey "use-ai" for the AI action package.
 */
const USE_AI_ACTION_KEY = 'use-ai';
const AI_ACTION_PACKAGE_ID = '67ba01e9-1898-4e7d-afe7-7ebe24819a57';

interface CreateFieldResponse {
  field: {
    id: string;
    tableId: string;
    type: string;
    name: string;
    typeSettings?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * Add a published claygent as an enrichment column on a table.
 * Creates an action field with "use-ai" action bindings that reference the
 * saved claygent via claygentId + claygentFieldMapping.
 *
 * Uses POST /tables/{tableId}/fields with type "action" and named
 * inputsBinding params (claygentId, claygentFieldMapping, model, prompt,
 * useCase, answerSchemaType). The field is then runnable via PATCH /run.
 */
export async function addClaygentColumn(
  opts: AddClaygentColumnInput,
): Promise<AddClaygentColumnOutput> {
  const { tableId, claygentId, workspaceId, inputMappings, columnName } = opts;

  if (!tableId) {
    throw new Validation('addClaygentColumn: tableId is required');
  }
  if (!claygentId) {
    throw new Validation('addClaygentColumn: claygentId is required');
  }
  if (!workspaceId) {
    throw new Validation('addClaygentColumn: workspaceId is required');
  }

  // 1. Fetch claygent to validate it exists and is published
  const claygentData = await clayFetch<SingleClaygentResponse>(
    `/workspaces/${workspaceId}/claygents/${claygentId}`,
  );
  const c = claygentData.claygent;

  if (!c.publishedAt) {
    throw new Validation(
      `addClaygentColumn: claygent "${c.name}" (${claygentId}) is not published. ` +
        `Use updateClaygent() with markAsPublished: true before adding as a column.`,
    );
  }

  // 2. Build inputsBinding with named action parameters
  const inputsBinding: Array<
    | { name: string; formulaText: string }
    | { name: string; formulaMap: Record<string, string> }
  > = [
    { name: 'claygentId', formulaText: `"${claygentId}"` },
    { name: 'useCase', formulaText: '"claygent"' },
    {
      name: 'model',
      formulaText: `"${c.currentVersion.modelSettings.model}"`,
    },
    { name: 'prompt', formulaText: '"Using claygent"' },
  ];

  // Map claygent variable names → table field IDs
  if (inputMappings && inputMappings.length > 0) {
    const fieldMapping: Record<string, string> = {};
    for (const m of inputMappings) {
      fieldMapping[m.variableName] = `{{${m.fieldId}}}`;
    }
    inputsBinding.push({
      name: 'claygentFieldMapping',
      formulaMap: fieldMapping,
    });
  }

  // Serialize output format into answerSchemaType binding
  const outputFormat = c.currentVersion.outputFormat;
  if (outputFormat) {
    const schemaMap: Record<string, string> = {
      type: `"${outputFormat.type}"`,
    };
    if (outputFormat.jsonType === 'Fields' && outputFormat.fields) {
      schemaMap.fields = JSON.stringify(outputFormat.fields);
    } else if (
      outputFormat.jsonType === 'JSONSchema' &&
      outputFormat.jsonSchema
    ) {
      schemaMap.fields = outputFormat.jsonSchema;
    }
    inputsBinding.push({ name: 'answerSchemaType', formulaMap: schemaMap });
  }

  const fieldName = columnName || c.name;

  // 3. Create the action field via POST /tables/{tableId}/fields
  const body = {
    type: 'action',
    name: fieldName,
    typeSettings: {
      actionKey: USE_AI_ACTION_KEY,
      actionVersion: 1,
      actionPackageId: AI_ACTION_PACKAGE_ID,
      inputsBinding,
      dataTypeSettings: { type: 'json' },
    },
  };

  const resp = await clayFetch<CreateFieldResponse>(
    `/tables/${tableId}/fields`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  return {
    fieldId: resp.field.id,
    fieldName: resp.field.name || fieldName,
  };
}
