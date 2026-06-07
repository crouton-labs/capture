/**
 * HubSpot Pipeline Operations
 *
 * CRUD for deal and ticket pipelines and their stages.
 */

import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

export interface PipelineStage {
  label: string;
  displayOrder: number;
  metadata: {
    isClosed: string;
    probability: string;
  };
  id: string;
  archived: boolean;
}

export interface Pipeline {
  label: string;
  displayOrder: number;
  id: string;
  stages: PipelineStage[];
  archived: boolean;
}

export async function listPipelines(opts: {
  csrf: string;
  portalId: string;
  objectType: 'deals' | 'tickets';
}): Promise<{
  results: Pipeline[];
}> {
  if (!opts.csrf) {
    throw new Validation('CSRF token is required');
  }

  const url = new URL(
    `${window.location.origin}/api/crm/v3/pipelines/${opts.objectType}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data.results || !Array.isArray(data.results)) {
    throw new ContractDrift('Invalid response structure: missing results array');
  }

  return {
    results: data.results,
  };
}

export async function getPipeline(opts: {
  csrf: string;
  portalId: string;
  objectType: 'deals' | 'tickets';
  pipelineId: string;
}): Promise<Pipeline> {
  if (!opts.csrf) {
    throw new Validation('CSRF token is required');
  }

  if (!opts.pipelineId) {
    throw new Validation('Pipeline ID is required');
  }

  const url = new URL(
    `${window.location.origin}/api/crm/v3/pipelines/${opts.objectType}/${opts.pipelineId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data.id) {
    throw new ContractDrift('Invalid response structure: missing pipeline data');
  }

  return data;
}

export async function createPipeline(opts: {
  csrf: string;
  portalId: string;
  objectType: 'deals' | 'tickets';
  label: string;
  displayOrder?: number;
  stages: Array<{
    label: string;
    displayOrder: number;
    metadata: { probability?: string; ticketState?: string };
  }>;
}): Promise<Pipeline> {
  if (!opts.csrf) {
    throw new Validation('CSRF token is required');
  }

  const url = new URL(
    `${window.location.origin}/api/crm/v3/pipelines/${opts.objectType}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      label: opts.label,
      displayOrder: opts.displayOrder ?? 0,
      stages: opts.stages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return response.json();
}

export async function updatePipeline(opts: {
  csrf: string;
  portalId: string;
  objectType: 'deals' | 'tickets';
  pipelineId: string;
  label?: string;
  displayOrder?: number;
}): Promise<Pipeline> {
  if (!opts.csrf) {
    throw new Validation('CSRF token is required');
  }

  const url = new URL(
    `${window.location.origin}/api/crm/v3/pipelines/${opts.objectType}/${opts.pipelineId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const body: Record<string, unknown> = {};
  if (opts.label !== undefined) body.label = opts.label;
  if (opts.displayOrder !== undefined) body.displayOrder = opts.displayOrder;

  const response = await fetch(url.toString(), {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return response.json();
}

export async function deletePipeline(opts: {
  csrf: string;
  portalId: string;
  objectType: 'deals' | 'tickets';
  pipelineId: string;
  validateReferencesBeforeDelete?: boolean;
}): Promise<void> {
  if (!opts.csrf) {
    throw new Validation('CSRF token is required');
  }

  const url = new URL(
    `${window.location.origin}/api/crm/v3/pipelines/${opts.objectType}/${opts.pipelineId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  if (opts.validateReferencesBeforeDelete) {
    url.searchParams.set('validateReferencesBeforeDelete', 'true');
  }

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (response.status !== 204 && !response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }
}

export async function createPipelineStage(opts: {
  csrf: string;
  portalId: string;
  objectType: 'deals' | 'tickets';
  pipelineId: string;
  label: string;
  displayOrder: number;
  metadata?: { probability?: string; ticketState?: string };
}): Promise<PipelineStage> {
  if (!opts.csrf) {
    throw new Validation('CSRF token is required');
  }

  const url = new URL(
    `${window.location.origin}/api/crm/v3/pipelines/${opts.objectType}/${opts.pipelineId}/stages`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const body: Record<string, unknown> = {
    label: opts.label,
    displayOrder: opts.displayOrder,
  };
  if (opts.metadata) body.metadata = opts.metadata;

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return response.json();
}

export async function updatePipelineStage(opts: {
  csrf: string;
  portalId: string;
  objectType: 'deals' | 'tickets';
  pipelineId: string;
  stageId: string;
  label?: string;
  displayOrder?: number;
  metadata?: { probability?: string; ticketState?: string };
}): Promise<PipelineStage> {
  if (!opts.csrf) {
    throw new Validation('CSRF token is required');
  }

  const url = new URL(
    `${window.location.origin}/api/crm/v3/pipelines/${opts.objectType}/${opts.pipelineId}/stages/${opts.stageId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const body: Record<string, unknown> = {};
  if (opts.label !== undefined) body.label = opts.label;
  if (opts.displayOrder !== undefined) body.displayOrder = opts.displayOrder;
  if (opts.metadata !== undefined) body.metadata = opts.metadata;

  const response = await fetch(url.toString(), {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return response.json();
}

export async function deletePipelineStage(opts: {
  csrf: string;
  portalId: string;
  objectType: 'deals' | 'tickets';
  pipelineId: string;
  stageId: string;
}): Promise<void> {
  if (!opts.csrf) {
    throw new Validation('CSRF token is required');
  }

  const url = new URL(
    `${window.location.origin}/api/crm/v3/pipelines/${opts.objectType}/${opts.pipelineId}/stages/${opts.stageId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (response.status !== 204 && !response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }
}
