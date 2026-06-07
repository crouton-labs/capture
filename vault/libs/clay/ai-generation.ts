/**
 * AI Generation operations for Clay.
 *
 * Functions that leverage Clay's AI generation endpoints to:
 * - Generate claygent prompts from natural language descriptions
 * - Generate JSON schemas for structured output
 * - Generate conditional/basic/array formulas from natural language
 */

import { Validation, ContractDrift, UpstreamError } from '@vallum/_runtime';
import { API_BASE, clayFetch } from './shared';

// ─── Raw XHR helper for SSE endpoints (clayFetch expects JSON, SSE is text) ─

async function claySSEPost(
  path: string,
  body: Record<string, unknown>,
): Promise<string> {
  const url = `${API_BASE}${path}`;
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');

    xhr.onload = function () {
      if (xhr.status >= 400) {
        reject(
          new UpstreamError(
            `Clay SSE error ${xhr.status}: ${xhr.responseText.slice(0, 300)}`,
          ),
        );
        return;
      }
      resolve(xhr.responseText);
    };

    xhr.onerror = () =>
      reject(new UpstreamError(`Clay SSE network error for POST ${path}`));
    xhr.ontimeout = () =>
      reject(new UpstreamError(`Clay SSE timeout for POST ${path} (120s)`));
    xhr.send(JSON.stringify(body));
  });
}

// ─── SSE Parser ──────────────────────────────────────────────────────────────

interface SSEEvent {
  type: string;
  data?: Record<string, unknown>;
  id?: string;
  delta?: string;
  [k: string]: unknown;
}

function parseSSE(text: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const payload = trimmed.slice(6);
    if (payload === '[DONE]') break;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && parsed.type) {
        events.push(parsed);
      }
    } catch {
      // Skip non-JSON SSE lines
    }
  }
  return events;
}

// ─── Generate Claygent Prompt ────────────────────────────────────────────────

/**
 * Generate a refined claygent prompt from a natural-language task description.
 * Uses Clay's metaprompter AI to expand a short user task description into a
 * full structured claygent prompt with context, objectives, and instructions.
 */
export async function generateClaygentPrompt(opts: {
  workspaceId: number;
  taskDescription: string;
  columnNamesToIds?: Record<string, string>;
  model?: string;
}): Promise<{
  prompt: string;
  suggestedUseCase: string;
  suggestedUseCaseReasoning: string;
  suggestedModel: string;
  suggestedModelReasoning: string;
}> {
  const { workspaceId, taskDescription, columnNamesToIds, model } = opts;

  if (!workspaceId)
    throw new Validation('generateClaygentPrompt: workspaceId is required');
  if (!taskDescription)
    throw new Validation('generateClaygentPrompt: taskDescription is required');

  const sseText = await claySSEPost('/ai-generation/stream-metaprompter', {
    taskDescription,
    columnNamesToIds: columnNamesToIds ?? {},
    workspaceId,
    useCase: '"claygent"',
    model: model ?? 'clay-argon',
  });

  const events = parseSSE(sseText);

  let suggestedUseCase = '';
  let suggestedUseCaseReasoning = '';
  let suggestedModel = '';
  let suggestedModelReasoning = '';
  let prompt = '';

  for (const event of events) {
    switch (event.type) {
      case 'data-use-case': {
        const d = event.data as Record<string, unknown>;
        suggestedUseCase = String(d.suggestedUseCase || '');
        suggestedUseCaseReasoning = String(d.suggestedUseCaseReasoning || '');
        break;
      }
      case 'data-model': {
        const d = event.data as Record<string, unknown>;
        suggestedModel = String(d.suggestedModel || '');
        suggestedModelReasoning = String(
          d.suggestModelReasoning || d.suggestedModelReasoning || '',
        );
        break;
      }
      case 'data-object': {
        const d = event.data as Record<string, unknown>;
        if (typeof d.prompt === 'string' && d.prompt.length > prompt.length) {
          prompt = d.prompt;
        }
        break;
      }
    }
  }

  if (!prompt) {
    throw new ContractDrift(
      'generateClaygentPrompt: no prompt generated from SSE response',
    );
  }

  return {
    prompt,
    suggestedUseCase,
    suggestedUseCaseReasoning,
    suggestedModel,
    suggestedModelReasoning,
  };
}

// ─── Generate Output Schema ─────────────────────────────────────────────────

/**
 * Generate a JSON schema for structured claygent output from a prompt.
 * Takes the claygent prompt and produces a JSON schema describing the
 * expected output fields, types, and descriptions.
 */
export async function generateOutputSchema(opts: {
  workspaceId: number;
  prompt: string;
  model?: string;
}): Promise<{
  jsonSchema: string;
}> {
  const { workspaceId, prompt, model } = opts;

  if (!workspaceId)
    throw new Validation('generateOutputSchema: workspaceId is required');
  if (!prompt) throw new Validation('generateOutputSchema: prompt is required');

  const body: Record<string, unknown> = { prompt, workspaceId };
  if (model) body.model = model;

  const data = await clayFetch<{ jsonSchema: string }>(
    '/ai-generation/json-schema',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  if (!data.jsonSchema) {
    throw new ContractDrift('generateOutputSchema: response missing jsonSchema');
  }

  return { jsonSchema: data.jsonSchema };
}

// ─── Generate Formula ────────────────────────────────────────────────────────

/**
 * Generate a formula from a natural-language description.
 * Supports conditional (run conditions), basic (transforms), and array formulas.
 * Returns a JavaScript expression using Clay field references like {{field_id}}.
 * When columnNamesToIds is provided, the formula uses field IDs (e.g. {{f_xxx}}).
 * Without it, the formula uses display names (e.g. {{company name}}).
 */
export async function generateFormula(opts: {
  workspaceId: number;
  userPromptInput: string;
  userId?: number;
  columnNamesToIds?: Record<string, string>;
  mode?: 'conditional' | 'basic' | 'array';
  rawExampleTableData?: Array<Record<string, unknown>>;
  userProvidedCorrectedExamples?: Array<Record<string, unknown>>;
}): Promise<{
  formula: string;
  dataType: string;
}> {
  const {
    userId,
    workspaceId,
    userPromptInput,
    columnNamesToIds,
    mode,
    rawExampleTableData,
    userProvidedCorrectedExamples,
  } = opts;

  if (!workspaceId) throw new Validation('generateFormula: workspaceId is required');
  if (!userPromptInput)
    throw new Validation('generateFormula: userPromptInput is required');

  const body: Record<string, unknown> = {
    id: userId || workspaceId,
    workspaceId: String(workspaceId),
    userPromptInput,
    mode: mode ?? 'conditional',
    rawExampleTableData: rawExampleTableData ?? [],
    userProvidedCorrectedExamples: userProvidedCorrectedExamples ?? [],
  };
  if (columnNamesToIds && Object.keys(columnNamesToIds).length > 0) {
    body.columnNamesToIds = columnNamesToIds;
  }

  const data = await clayFetch<{ formula: string; dataType: string }>(
    '/ai-generation/formula',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  if (!data.formula) {
    throw new ContractDrift('generateFormula: response missing formula');
  }

  return {
    formula: data.formula,
    dataType: data.dataType,
  };
}
