/**
 * HubSpot Reporting Operations
 *
 * Dashboard and report listing, retrieval, and execution.
 */

import type {
  ListReportsInput,
  ListReportsOutput,
  GetReportInput,
  GetReportOutput,
  RunReportInput,
  RunReportOutput,
  CreateReportInput,
  CreateReportOutput,
  UpdateReportInput,
  UpdateReportOutput,
  DeleteReportInput,
  DeleteReportOutput,
} from '../schemas';
import { ContractDrift, UpstreamError, Validation, throwForStatus } from '@vallum/_runtime';

export interface Dashboard {
  id: string;
  title: string;
  description?: string;
  [key: string]: unknown;
}

export async function listDashboards(opts: {
  csrf: string;
  portalId: string;
}): Promise<{
  offset: number;
  limit: number;
  total: number;
  dashboards: Dashboard[];
}> {
  const url = new URL(`${window.location.origin}/api/dashboard/v2/dashboard`);
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  return {
    offset: data.offset ?? 0,
    limit: data.limit ?? 0,
    total: data.total ?? 0,
    dashboards: data.dashboards ?? [],
  };
}

export async function getDashboard(opts: {
  csrf: string;
  portalId: string;
  dashboardId: string;
}): Promise<Dashboard> {
  const url = new URL(
    `${window.location.origin}/api/dashboard/v2/dashboard/${opts.dashboardId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  return data as Dashboard;
}

export async function listReports(
  opts: ListReportsInput,
): Promise<ListReportsOutput> {
  const url = new URL(`${window.location.origin}/api/dashboard/v2/reports`);
  url.searchParams.set('portalId', opts.portalId);
  if (opts.limit !== undefined)
    url.searchParams.set('limit', String(opts.limit));
  if (opts.offset !== undefined)
    url.searchParams.set('offset', String(opts.offset));
  if (opts.search !== undefined) url.searchParams.set('search', opts.search);
  if (opts.sort !== undefined) url.searchParams.set('sort', opts.sort);
  if (opts.dashboardId !== undefined)
    url.searchParams.set('dashboardId', opts.dashboardId);
  if (opts.sortBy !== undefined) url.searchParams.set('sortBy', opts.sortBy);
  if (opts.sortOrder !== undefined)
    url.searchParams.set('sortOrder', opts.sortOrder);
  if (opts.updatedAtStartDate !== undefined)
    url.searchParams.set('updatedAtStartDate', String(opts.updatedAtStartDate));
  if (opts.updatedAtEndDate !== undefined)
    url.searchParams.set('updatedAtEndDate', String(opts.updatedAtEndDate));
  if (opts.favorite !== undefined)
    url.searchParams.set('favorite', String(opts.favorite));
  if (opts.inDashboard !== undefined)
    url.searchParams.set('inDashboard', String(opts.inDashboard));
  if (opts.reportOwnerId !== undefined)
    url.searchParams.set('reportOwnerId', opts.reportOwnerId);
  if (opts.accessClassification !== undefined)
    url.searchParams.set('accessClassification', opts.accessClassification);
  if (opts.customReports !== undefined)
    url.searchParams.set('customReports', String(opts.customReports));
  if (opts.source !== undefined) url.searchParams.set('source', opts.source);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  return {
    offset: data.offset ?? 0,
    limit: data.limit ?? 0,
    total: data.total ?? 0,
    reports: (data.reports ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      name: r.name,
      chartType: r.chartType,
      source: r.source,
      reportKind: r.reportKind,
      dataType: (r.config as Record<string, unknown>)?.dataType ?? r.dataType,
      configType:
        (r.config as Record<string, unknown>)?.configType ?? r.configType,
      active: r.active,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastViewedAt: (r.lastViewedAt as number) ?? null,
      dashboardId: r.dashboardId ?? null,
      dashboardName: r.dashboardName ?? null,
      reportOwnerId: r.reportOwnerId,
      reportOwnerName: r.reportOwnerName,
      accessClassification: r.accessClassification ?? 'NONE',
      favorite: r.favorite,
      template:
        (r.config as Record<string, unknown>)?.template ?? r.template ?? null,
      totalViews: r.totalViews ?? 0,
    })),
  };
}

export async function getReport(
  opts: GetReportInput,
): Promise<GetReportOutput> {
  if (!opts.reportId) {
    throw new Validation('getReport: reportId is required');
  }

  const url = new URL(
    `${window.location.origin}/api/dashboard/v2/reports/${opts.reportId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  data.id = String(data.id);
  return data;
}

export async function runReport(
  opts: RunReportInput,
): Promise<RunReportOutput> {
  if (!opts.reportId && !opts.config) {
    throw new Validation('runReport requires either reportId or config');
  }

  const timeoutMs = opts.timeoutMs ?? 30000;

  let config: Record<string, unknown>;
  if (opts.config) {
    config = opts.config;
  } else {
    const report = await getReport({
      csrf: opts.csrf,
      portalId: opts.portalId,
      reportId: opts.reportId as string,
    });
    if (report.chartType === 'CUSTOM') {
      throw new Validation(
        `runReport: report "${report.name}" (id: ${opts.reportId}) has chartType "CUSTOM" which is not supported by the async resolve endpoint. Use standard AGGREGATION, TIME_SERIES, or MULTI_CONFIG report types.`,
      );
    }
    config = report.config as Record<string, unknown>;
  }

  const startUrl = new URL(
    `${window.location.origin}/api/reporting/v3/dataset/resolve/async`,
  );
  startUrl.searchParams.set('portalId', opts.portalId);

  const startResponse = await fetch(startUrl.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      config,
      ...(opts.reportOptions !== undefined && {
        reportOptions: opts.reportOptions,
      }),
      ...(opts.dashboardId !== undefined && { dashboardId: opts.dashboardId }),
      ...(opts.insightParams !== undefined && {
        insightParams: opts.insightParams,
      }),
    }),
  });

  if (!startResponse.ok) throwForStatus(startResponse.status, await startResponse.text().catch(() => undefined));

  const { id: taskId } = await startResponse.json();

  if (!taskId) {
    throw new ContractDrift(
      'runReport: no taskId returned from async report execution',
    );
  }

  const pollUrl = new URL(
    `${window.location.origin}/api/reporting/v3/dataset/resolve/async/${taskId}`,
  );
  pollUrl.searchParams.set('portalId', opts.portalId);

  const deadline = Date.now() + timeoutMs;
  let pollInterval = 250;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(pollInterval * 2, 2000);

    const pollResponse = await fetch(pollUrl.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'x-hubspot-csrf-hubspotapi': opts.csrf,
      },
    });

    if (!pollResponse.ok) throwForStatus(pollResponse.status, await pollResponse.text().catch(() => undefined));

    const task = await pollResponse.json();

    if (task.taskStatus === 'COMPLETED') {
      const primary = task.result?.primaryDataSet;
      const compare = task.result?.compareDataSet;

      return {
        data: primary?.data ?? [],
        header: primary?.header ?? {},
        ...(compare
          ? {
              compareData: compare.data ?? [],
              compareHeader: compare.header ?? {},
            }
          : {}),
      };
    }

    if (task.taskStatus === 'FAILED' || task.taskStatus === 'ERROR') {
      throw new UpstreamError(
        `runReport: report execution failed with status: ${task.taskStatus}`,
      );
    }
  }

  throw new UpstreamError(`Report execution timed out after ${timeoutMs}ms`);
}

export async function createReport(
  opts: CreateReportInput,
): Promise<CreateReportOutput> {
  const { csrf, portalId, name, chartType, config } = opts;

  if (!name) throw new Validation('createReport: name is required');
  if (!config) throw new Validation('createReport: config is required');

  const url = new URL(`${window.location.origin}/api/dashboard/v2/reports`);
  url.searchParams.set('portalId', portalId);

  const body: Record<string, unknown> = {
    name,
    chartType: chartType ?? 'COLUMN',
    config,
  };

  if (opts.description !== undefined)
    body.displayParams = { description: opts.description };
  if (opts.dashboardId !== undefined) body.dashboardId = opts.dashboardId;
  if (opts.accessClassification !== undefined)
    body.accessClassification = opts.accessClassification;

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': csrf,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();
  data.id = String(data.id);
  return data;
}

export async function updateReport(
  opts: UpdateReportInput,
): Promise<UpdateReportOutput> {
  const { csrf, portalId, reportId } = opts;

  if (!reportId) throw new Validation('updateReport: reportId is required');

  // Fetch the existing report first (PUT requires full object)
  const existing = await getReport({ csrf, portalId, reportId });

  // Merge updates
  const merged: Record<string, unknown> = { ...existing };
  if (opts.name !== undefined) merged.name = opts.name;
  if (opts.chartType !== undefined) merged.chartType = opts.chartType;
  if (opts.description !== undefined) merged.description = opts.description;
  if (opts.config !== undefined) merged.config = opts.config;
  if (opts.dashboardId !== undefined) merged.dashboardId = opts.dashboardId;

  const url = new URL(
    `${window.location.origin}/api/dashboard/v2/reports/${reportId}`,
  );
  url.searchParams.set('portalId', portalId);

  const response = await fetch(url.toString(), {
    method: 'PUT',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': csrf,
    },
    body: JSON.stringify(merged),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();
  data.id = String(data.id);
  return data;
}

export async function deleteReport(
  opts: DeleteReportInput,
): Promise<DeleteReportOutput> {
  const { csrf, portalId, reportId } = opts;

  if (!reportId) throw new Validation('deleteReport: reportId is required');

  const url = new URL(
    `${window.location.origin}/api/dashboard/v2/reports/${reportId}`,
  );
  url.searchParams.set('portalId', portalId);

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': csrf,
    },
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  return { success: true };
}
