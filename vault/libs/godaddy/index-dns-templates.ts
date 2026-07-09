/**
 * GoDaddy DNS templates — reusable sets of DNS records and their per-record CRUD.
 *
 * All endpoints live on the DNS host (domdns.api.godaddy.com), scoped by the
 * signed-in customerId. Context is implicit: customerId is read from the
 * session, never passed in.
 */

import {
  dccFetch,
  getCustomerId,
  paginatePage,
  DOMDNS_API,
  Validation,
  ContractDrift,
} from './_shared';
import type {
  ListDnsTemplatesOutput,
  GetDnsTemplateOutput,
  CreateDnsTemplateOutput,
  UpdateDnsTemplateOutput,
  DeleteDnsTemplateOutput,
  ApplyDnsTemplateOutput,
  AddTemplateRecordOutput,
  UpdateTemplateRecordOutput,
  DeleteTemplateRecordOutput,
  DnsTemplateSummary,
  DnsTemplateRecord,
  DnsTemplateRecordInput,
} from './schemas-dns-templates';

export type {
  ListDnsTemplatesOutput,
  GetDnsTemplateOutput,
  CreateDnsTemplateOutput,
  UpdateDnsTemplateOutput,
  DeleteDnsTemplateOutput,
  ApplyDnsTemplateOutput,
  AddTemplateRecordOutput,
  UpdateTemplateRecordOutput,
  DeleteTemplateRecordOutput,
  DnsTemplateSummary,
  DnsTemplateRecord,
  DnsTemplateRecordInput,
} from './schemas-dns-templates';

type Obj = Record<string, unknown>;

/** Pull the first array found under any of `keys` (or a top-level array) from a response body. */
function pickArray(body: unknown, keys: string[]): Obj[] {
  if (Array.isArray(body)) return body as Obj[];
  if (body && typeof body === 'object') {
    for (const k of keys) {
      const v = (body as Obj)[k];
      if (Array.isArray(v)) return v as Obj[];
    }
  }
  return [];
}

/** Template metadata from a single-template response, with the record/paging envelopes stripped. */
function templateMetaFrom(body: unknown): Obj {
  const o =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Obj)
      : {};
  const t =
    o.template && typeof o.template === 'object' ? (o.template as Obj) : o;
  const meta: Obj = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === 'records' || k === 'recordList' || k === 'pagination') continue;
    meta[k] = v;
  }
  return meta;
}

/** Records array from a single-template response (records may sit at the root or under `template`). */
function recordsFrom(body: unknown): Obj[] {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const o = body as Obj;
    const inner =
      o.template && typeof o.template === 'object' ? (o.template as Obj) : o;
    return pickArray(inner, ['records', 'recordList']);
  }
  return pickArray(body, ['records', 'recordList']);
}

// ============================================================================
// listDnsTemplates
// ============================================================================

export async function listDnsTemplates(): Promise<ListDnsTemplatesOutput> {
  const cid = getCustomerId();
  const body = await dccFetch<unknown>(
    `${DOMDNS_API}/v1/customers/${cid}/templates`,
  );
  const templates = pickArray(body, ['templates', 'templateList']);
  return {
    templates: templates as unknown as DnsTemplateSummary[],
    total: templates.length,
  };
}

// ============================================================================
// getDnsTemplate
// ============================================================================

export async function getDnsTemplate(args: {
  templateId: string | number;
  count?: number;
}): Promise<GetDnsTemplateOutput> {
  if (!args.templateId)
    throw new Validation('getDnsTemplate requires templateId.');
  const cid = getCustomerId();
  const id = encodeURIComponent(args.templateId);

  let meta: Obj = {};
  const records = await paginatePage<Obj>(async (pageNumber, pageSize) => {
    const body = await dccFetch<unknown>(
      `${DOMDNS_API}/v1/customers/${cid}/templates/${id}?pageSize=${pageSize}&pageNumber=${pageNumber}`,
    );
    if (pageNumber === 1) meta = templateMetaFrom(body);
    return recordsFrom(body);
  }, args.count);

  const template = {
    templateId: args.templateId,
    ...meta,
  } as unknown as DnsTemplateSummary;
  return {
    template,
    records: records as unknown as DnsTemplateRecord[],
    total: records.length,
  };
}

// ============================================================================
// createDnsTemplate
// ============================================================================

export async function createDnsTemplate(args: {
  name: string;
  description?: string;
  records?: DnsTemplateRecordInput[];
}): Promise<CreateDnsTemplateOutput> {
  if (!args.name)
    throw new Validation('createDnsTemplate requires a template name.');
  const cid = getCustomerId();
  const body: Obj = { name: args.name };
  if (args.description !== undefined) body.description = args.description;

  const resp = await dccFetch<Obj>(
    `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${encodeURIComponent(args.name)}`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  const templateId = (resp?.id as number | string | undefined) ?? undefined;

  if (args.records?.length) {
    if (templateId == null) {
      throw new ContractDrift(
        'createDnsTemplate: API did not return a templateId; cannot add records.',
      );
    }
    const encodedId = encodeURIComponent(templateId);
    for (const record of args.records) {
      const { type, ...rest } = record as DnsTemplateRecordInput & {
        type?: string;
      };
      const payload: Obj = { ...rest };
      if (type !== undefined) payload.rtype = type;
      if (typeof payload.flags === 'number')
        payload.flags = String(payload.flags);
      await dccFetch<Obj>(
        `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${encodedId}/records`,
        { method: 'POST', body: JSON.stringify(payload) },
      );
    }
  }

  const template = {
    templateName: args.name,
    name: args.name,
    templateId,
    recordCount: args.records?.length ?? 0,
  } as unknown as DnsTemplateSummary;
  return { template };
}

// ============================================================================
// updateDnsTemplate
// ============================================================================

export async function updateDnsTemplate(args: {
  templateId: string | number;
  name?: string;
  records?: DnsTemplateRecordInput[];
}): Promise<UpdateDnsTemplateOutput> {
  if (!args.templateId)
    throw new Validation('updateDnsTemplate requires templateId.');
  if (args.name === undefined && args.records === undefined) {
    throw new Validation(
      'updateDnsTemplate requires at least one field to update (name or records).',
    );
  }
  const cid = getCustomerId();
  const id = encodeURIComponent(args.templateId);

  // Fetch current template to get the name (required for PATCH) and existing records.
  let currentMeta: Obj = {};
  const currentRecords = await paginatePage<Obj>(
    async (pageNumber, pageSize) => {
      const body = await dccFetch<unknown>(
        `${DOMDNS_API}/v1/customers/${cid}/templates/${id}?pageSize=${pageSize}&pageNumber=${pageNumber}`,
      );
      if (pageNumber === 1) currentMeta = templateMetaFrom(body);
      return recordsFrom(body);
    },
  );

  const name =
    args.name ??
    (currentMeta.templateName as string | undefined) ??
    (currentMeta.name as string | undefined);
  if (!name) {
    throw new ContractDrift(
      `updateDnsTemplate: could not resolve current template name for id ${args.templateId}.`,
    );
  }

  // PATCH name only — the endpoint silently ignores records in the body.
  const resp = await dccFetch<Obj>(
    `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${id}`,
    { method: 'PATCH', body: JSON.stringify({ name }) },
  );

  // Replace records: create new records first, then delete old ones.
  // Creating before deleting preserves original records if any new record fails.
  if (args.records !== undefined) {
    const newRecordIds: string[] = [];
    try {
      for (const record of args.records) {
        const { type, ...rest } = record as DnsTemplateRecordInput & {
          type?: string;
        };
        const payload: Obj = { ...rest };
        if (type !== undefined) payload.rtype = type;
        if (typeof payload.flags === 'number')
          payload.flags = String(payload.flags);
        const createResp = await dccFetch<Obj>(
          `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${id}/records`,
          { method: 'POST', body: JSON.stringify(payload) },
        );
        const newId = (createResp?.guid ??
          createResp?.id ??
          createResp?.recordId) as string | undefined;
        if (newId) newRecordIds.push(String(newId));
      }
    } catch (err) {
      // Rollback: delete any new records already created so template is unchanged.
      for (const newId of newRecordIds) {
        try {
          await dccFetch<unknown>(
            `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${id}/records/${encodeURIComponent(newId)}`,
            { method: 'DELETE' },
          );
        } catch {
          // Best-effort rollback; surface the original error, not cleanup failures.
        }
      }
      throw err;
    }
    // All new records created successfully — now remove old ones.
    for (const record of currentRecords) {
      const recordId = (record.guid ?? record.recordId) as string | undefined;
      if (recordId) {
        await dccFetch<unknown>(
          `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${id}/records/${encodeURIComponent(recordId)}`,
          { method: 'DELETE' },
        );
      }
    }
  }

  const template = {
    templateId: String(resp?.id ?? args.templateId),
    id: resp?.id,
    name: resp?.name ?? name,
  } as unknown as DnsTemplateSummary;
  return { template };
}

// ============================================================================
// deleteDnsTemplate
// ============================================================================

export async function deleteDnsTemplate(args: {
  templateId: string | number;
}): Promise<DeleteDnsTemplateOutput> {
  if (!args.templateId)
    throw new Validation('deleteDnsTemplate requires templateId.');
  const cid = getCustomerId();
  await dccFetch<unknown>(
    `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${encodeURIComponent(args.templateId)}`,
    { method: 'DELETE' },
  );
  return { deleted: true, templateId: args.templateId };
}

// ============================================================================
// applyDnsTemplate
// ============================================================================

export async function applyDnsTemplate(args: {
  templateId: string | number;
  domainName: string;
  domainNames?: string[];
  append?: boolean;
}): Promise<ApplyDnsTemplateOutput> {
  if (!args.templateId)
    throw new Validation('applyDnsTemplate requires templateId.');
  if (!args.domainName)
    throw new Validation('applyDnsTemplate requires domainName.');
  const cid = getCustomerId();
  const domainList = [args.domainName, ...(args.domainNames ?? [])];
  const appendParam = args.append != null ? `?append=${args.append}` : '';
  await dccFetch<unknown>(
    `${DOMDNS_API}/v1/customers/${cid}/templates/${encodeURIComponent(args.templateId)}/apply${appendParam}`,
    { method: 'POST', body: JSON.stringify({ domainList }) },
  );
  return {
    applied: true,
    templateId: args.templateId,
    domainName: args.domainName,
    domainNames: domainList,
  };
}

// ============================================================================
// addTemplateRecord
// ============================================================================

export async function addTemplateRecord(args: {
  templateId: string | number;
  record: DnsTemplateRecordInput;
}): Promise<AddTemplateRecordOutput> {
  if (!args.templateId)
    throw new Validation('addTemplateRecord requires templateId.');
  if (!args.record)
    throw new Validation('addTemplateRecord requires a record.');
  const cid = getCustomerId();
  const { type, ...rest } = args.record as DnsTemplateRecordInput & {
    type?: string;
  };
  const payload: Obj = { ...rest };
  if (type !== undefined) payload.rtype = type;
  if (typeof payload.flags === 'number') payload.flags = String(payload.flags);
  const resp = await dccFetch<Obj>(
    `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${encodeURIComponent(args.templateId)}/records`,
    { method: 'POST', body: JSON.stringify(payload) },
  );

  let apiRecord: Obj;
  if (resp && resp.guid) {
    apiRecord = resp;
  } else {
    // API returns empty body for some record types (CNAME, MX, SRV, etc.).
    // Read back the template to get the server-assigned guid and other fields.
    const templateBody = await dccFetch<unknown>(
      `${DOMDNS_API}/v1/customers/${cid}/templates/${encodeURIComponent(args.templateId)}?pageSize=500&pageNumber=1`,
    );
    const allRecords = recordsFrom(templateBody);
    const inputName = (payload.name ?? args.record.name) as string | undefined;
    const inputRtype = (type ?? (args.record as Obj).type) as
      | string
      | undefined;
    const match = [...allRecords]
      .reverse()
      .find(
        (r) =>
          (!inputRtype ||
            String(r.rtype ?? '').toUpperCase() ===
              String(inputRtype).toUpperCase()) &&
          (!inputName || r.name === inputName),
      );
    if (!match) {
      throw new ContractDrift(
        `addTemplateRecord: record was created but could not be found in template ${args.templateId} after POST.`,
      );
    }
    apiRecord = match;
  }

  const record = {
    ...args.record,
    ...apiRecord,
  } as unknown as DnsTemplateRecord;
  return { record };
}

// ============================================================================
// updateTemplateRecord
// ============================================================================

export async function updateTemplateRecord(args: {
  templateId: string | number;
  recordId: string;
  record: DnsTemplateRecordInput;
}): Promise<UpdateTemplateRecordOutput> {
  if (!args.templateId)
    throw new Validation('updateTemplateRecord requires templateId.');
  if (!args.recordId)
    throw new Validation('updateTemplateRecord requires recordId.');
  if (!args.record)
    throw new Validation('updateTemplateRecord requires a record.');
  const cid = getCustomerId();
  const { type, ...rest } = args.record as DnsTemplateRecordInput & {
    type?: string;
  };
  const payload: Obj = { ...rest };
  if (type !== undefined) payload.rtype = type;
  payload.guid = args.recordId;
  if (typeof payload.flags === 'number') payload.flags = String(payload.flags);
  const resp = await dccFetch<Obj>(
    `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${encodeURIComponent(args.templateId)}/records/${encodeURIComponent(args.recordId)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  );
  const record = {
    ...args.record,
    ...(resp ?? {}),
  } as unknown as DnsTemplateRecord;
  return { record };
}

// ============================================================================
// deleteTemplateRecord
// ============================================================================

export async function deleteTemplateRecord(args: {
  templateId: string | number;
  recordId: string;
}): Promise<DeleteTemplateRecordOutput> {
  if (!args.templateId)
    throw new Validation('deleteTemplateRecord requires templateId.');
  if (!args.recordId)
    throw new Validation('deleteTemplateRecord requires recordId.');
  const cid = getCustomerId();
  await dccFetch<unknown>(
    `${DOMDNS_API}/v1/customers/${cid}/userDNSTemplate/${encodeURIComponent(args.templateId)}/records/${encodeURIComponent(args.recordId)}`,
    { method: 'DELETE' },
  );
  return {
    deleted: true,
    templateId: args.templateId,
    recordId: args.recordId,
  };
}
