/**
 * Salesforce Aura Framework API Client
 *
 * Internal helper for making Aura endpoint calls.
 * Salesforce Lightning uses the Aura framework for all data operations.
 * Direct fetch/XHR to REST API is blocked by Lightning Web Security (LWS).
 */

import { Unauthenticated, ContractDrift, UpstreamError, throwForStatus, Validation } from '@vallum/_runtime';

export interface GraphQLResponse {
  data: Record<string, unknown>;
  errors: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    paths?: string[];
  }>;
  extensions?: Record<string, unknown>;
}

export interface GraphQLMutationResult {
  Id: string;
  [key: string]: unknown;
}

export function extractGraphQLRecord(
  response: GraphQLResponse,
  operationKey: string,
): GraphQLMutationResult {
  if (response.errors && response.errors.length > 0) {
    throw new UpstreamError(
      `Salesforce GraphQL error: ${response.errors.map((e) => e.message).join('; ')}`,
    );
  }

  const uiapi = response.data?.uiapi as Record<string, unknown> | undefined;
  if (!uiapi) {
    throw new ContractDrift('GraphQL response missing uiapi namespace');
  }

  const mutation = uiapi[operationKey] as
    | {
        record?: { Id?: string; [k: string]: unknown };
        Record?: { Id?: string; [k: string]: unknown };
      }
    | undefined;

  const rec = mutation?.record ?? mutation?.Record;
  if (!rec?.Id) {
    throw new ContractDrift(
      `GraphQL mutation ${operationKey} did not return a record with Id`,
    );
  }

  // Flatten { value, displayValue } fields into plain values
  const flat: Record<string, unknown> = { Id: rec.Id };
  for (const [key, val] of Object.entries(rec)) {
    if (key === 'Id') continue;
    if (
      val &&
      typeof val === 'object' &&
      'value' in (val as Record<string, unknown>)
    ) {
      flat[key] = (val as { value: unknown }).value;
    } else {
      flat[key] = val;
    }
  }

  return flat as GraphQLMutationResult;
}

declare const $A: {
  get(name: string): {
    fire(): void;
    setParams(p: Record<string, unknown>): void;
  };
};

export interface AuraContext {
  token: string;
  context: string;
}

export interface AuraAction {
  id: string;
  descriptor: string;
  callingDescriptor: string;
  params: Record<string, unknown>;
}

interface AuraErrorResponse {
  event?: { descriptor?: string };
  exceptionMessage?: string;
  exceptionEvent?: boolean;
}

export interface AuraResponse {
  actions: Array<{
    id: string;
    state: 'SUCCESS' | 'ERROR' | 'INCOMPLETE';
    returnValue: unknown;
    error: Array<{ message: string; stackTrace?: string }>;
  }>;
  context?: unknown;
}

/**
 * Capture the Aura token and context by intercepting an existing XHR request.
 * Triggers a view refresh to force the framework to make a request.
 */
export async function captureAuraContext(): Promise<AuraContext> {
  return new Promise((resolve, reject) => {
    const origSend = XMLHttpRequest.prototype.send;
    const timer = setTimeout(() => {
      XMLHttpRequest.prototype.send = origSend;
      reject(
        new Error('Timed out capturing Aura token. Is the page fully loaded?'),
      );
    }, 15000);

    XMLHttpRequest.prototype.send = function (
      body: Document | XMLHttpRequestBodyInit | null | undefined,
    ) {
      if (body && typeof body === 'string' && body.indexOf('aura.token') >= 0) {
        const tokenMatch = body.match(/aura\.token=([^&]+)/);
        const contextMatch = body.match(/aura\.context=([^&]+)/);
        if (tokenMatch) {
          clearTimeout(timer);
          XMLHttpRequest.prototype.send = origSend;
          resolve({
            token: decodeURIComponent(tokenMatch[1]),
            context: contextMatch ? decodeURIComponent(contextMatch[1]) : '',
          });
        }
      }
      return origSend.call(this, body);
    };

    // Trigger a framework refresh to generate an Aura request.
    // force:refreshView works on Lightning pages but NOT on Setup pages.
    // force:navigateToURL (to the current path) works on both.
    setTimeout(() => {
      try {
        $A.get('e.force:refreshView').fire();
      } catch {
        // ignored; fallback below will handle it
      }
    }, 100);

    // Fallback for Setup pages: trigger a same-page navigation after a short delay
    setTimeout(() => {
      try {
        const evt = $A.get('e.force:navigateToURL');
        evt.setParams({
          url: window.location.pathname,
          isredirect: true,
        });
        evt.fire();
      } catch {
        // The timeout above will handle the failure case
      }
    }, 3000);
  });
}

let actionCounter = 0;

/**
 * Execute one or more Aura actions against the Salesforce backend.
 */
export async function auraRequest(
  ctx: AuraContext,
  actions: AuraAction[],
): Promise<AuraResponse> {
  const descriptorParts = actions
    .map((a) => {
      // serviceComponent://ui.objectmanager.setup.components.aura.controller.FieldsAndRelationshipsDetailListController/ACTION$queryDetails
      // → ui-objectmanager-setup-components-aura-controller.FieldsAndRelationshipsDetailList.queryDetails=1
      const scMatch = a.descriptor.match(
        /^serviceComponent:\/\/(.+)\/ACTION\$([a-zA-Z]+)$/,
      );
      if (scMatch) {
        const fullPath = scMatch[1];
        const segments = fullPath.split('.');
        const controllerName = segments.pop()!.replace(/Controller$/, '');
        const packagePath = segments.join('-');
        return `${packagePath}.${controllerName}.${scMatch[2]}=1`;
      }
      // aura://RecordUiController/ACTION$createRecord → aura.RecordUi.createRecord=1
      const auraMatch = a.descriptor.match(
        /^aura:\/\/([^/]+)\/ACTION\$([a-zA-Z]+)$/,
      );
      if (auraMatch) {
        const name = auraMatch[1].replace(/Controller$/, '');
        return `aura.${name}.${auraMatch[2]}=1`;
      }
      // java://ui.interaction.builder.components.controllers.FlowBuilderController/ACTION$toggleFlowStatus
      // → ui.interaction.builder.components.controllers.FlowBuilderController.toggleFlowStatus=1
      const javaMatch = a.descriptor.match(
        /^java:\/\/(.+)\/ACTION\$([a-zA-Z]+)$/,
      );
      if (javaMatch) {
        const dotPath = javaMatch[1].replace(/\//g, '.');
        return `${dotPath}.${javaMatch[2]}=1`;
      }
      return '';
    })
    .filter(Boolean)
    .join('&');

  const r = ++actionCounter;
  const url = `/aura?r=${r}${descriptorParts ? '&' + descriptorParts : ''}`;

  const body = new URLSearchParams();
  body.append('message', JSON.stringify({ actions }));
  body.append('aura.context', ctx.context);
  body.append('aura.token', ctx.token);

  const resp = await fetch(url, {
    method: 'POST',
    body,
    credentials: 'include',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  let text = await resp.text();
  // Aura responses are wrapped in comment markers.
  // Success: /*{json}*/
  // Error:   */{json}/*ERROR*/
  if (text.startsWith('/*')) text = text.slice(2);
  if (text.startsWith('*/')) text = text.slice(2);
  if (text.endsWith('*/')) text = text.slice(0, -2);
  // Strip trailing error marker if present: /*ERROR
  if (text.endsWith('/*ERROR')) text = text.slice(0, -7);

  const parsed: AuraResponse | AuraErrorResponse = JSON.parse(text);

  // Check for session errors
  if (
    'event' in parsed &&
    parsed.event?.descriptor === 'markup://aura:invalidSession'
  ) {
    throw new Unauthenticated(
      'Salesforce session expired. Refresh the page and call getContext() again.',
    );
  }

  return parsed as AuraResponse;
}

interface AuraExceptionEvent {
  exceptionEvent: true;
  event: {
    attributes: {
      values: {
        error?: { message: string };
        errors?: {
          pageErrors?: Array<{ message: string; statusCode?: string }>;
          fieldErrors?: Record<string, Array<{ message: string }>>;
        };
      };
    };
  };
}

function extractAuraErrorMessage(errors: Array<{ message?: string }>): string {
  if (errors.length === 0) return 'Unknown Aura error';

  const first = errors[0];

  // Standard error shape: { message: "..." }
  if (first.message) return first.message;

  // Exception event shapes (RecordUiController, LeadConvertDesktopController, etc.)
  const asException = first as unknown as Partial<AuraExceptionEvent>;
  if (asException.exceptionEvent) {
    const vals = asException.event?.attributes?.values;

    // RecordUiController shape: { error: { message: "..." } }
    if (vals?.error?.message) return vals.error.message;

    // recordSaveError shape: { errors: { pageErrors: [{ message: "..." }] } }
    const pageErrors = vals?.errors?.pageErrors;
    if (pageErrors && pageErrors.length > 0) return pageErrors[0].message;

    // recordSaveError shape: { errors: { fieldErrors: { FieldName: [{ message: "..." }] } } }
    const fieldErrors = vals?.errors?.fieldErrors;
    if (fieldErrors) {
      const firstField = Object.values(fieldErrors)[0];
      if (firstField && firstField.length > 0) return firstField[0].message;
    }
  }

  return 'Unknown Aura error';
}

/**
 * Execute a single Aura action and return its result.
 */
export async function auraAction(
  ctx: AuraContext,
  descriptor: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const action: AuraAction = {
    id: `${++actionCounter};a`,
    descriptor,
    callingDescriptor: 'UNKNOWN',
    params,
  };

  const response = await auraRequest(ctx, [action]);
  const result = response.actions[0];

  if (!result) {
    throw new ContractDrift(`No response for action: ${descriptor}`);
  }

  if (result.state === 'ERROR') {
    const errors = result.error;
    const msg = extractAuraErrorMessage(errors);
    throw new UpstreamError(`Salesforce error: ${msg}`);
  }

  if (result.state !== 'SUCCESS') {
    throw new UpstreamError(`Aura action state: ${result.state}`);
  }

  return result.returnValue;
}

export function validateString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Validation(`${name} is required and must be a non-empty string.`);
  }
  return value;
}

// Aura descriptor constants for common controllers
export const DESCRIPTORS = {
  // Host config
  getConfigData:
    'serviceComponent://ui.force.components.controllers.hostConfig.HostConfigController/ACTION$getConfigData',
  // Record CRUD via RecordUiController (the reliable approach)
  createRecord: 'aura://RecordUiController/ACTION$createRecord',
  updateRecord: 'aura://RecordUiController/ACTION$updateRecord',
  deleteRecord: 'aura://RecordUiController/ACTION$deleteRecord',
  // Record retrieval
  getRecord:
    'serviceComponent://ui.force.components.controllers.detail.DetailController/ACTION$getRecord',
  getRecordWithFields: 'aura://RecordUiController/ACTION$getRecordWithFields',
  getRecordWithLayouts: 'aura://RecordUiController/ACTION$getRecordWithLayouts',
  // Object metadata
  getObjectInfo: 'aura://RecordUiController/ACTION$getObjectInfo',
  // Picklist values
  getPicklistValues: 'aura://RecordUiController/ACTION$getPicklistValues',
  getPicklistValuesByRecordType:
    'aura://RecordUiController/ACTION$getPicklistValuesByRecordType',
  // List views
  getItems:
    'serviceComponent://ui.force.components.controllers.lists.selectableListDataProvider.SelectableListDataProviderController/ACTION$getItems',
  postListRecordsByName: 'aura://ListUiController/ACTION$postListRecordsByName',
  // Search
  getSuggestions:
    'serviceComponent://ui.search.components.forcesearch.assistant.AssistantSuggestionsDataProviderController/ACTION$getSuggestions',
  // Lead conversion
  convertLeadServer:
    'serviceComponent://ui.lead.runtime.components.controllers.LeadConvertDesktopController/ACTION$convertLeadServer',
  // Flow Builder
  toggleFlowStatus:
    'java://ui.interaction.builder.components.controllers.FlowBuilderController/ACTION$toggleFlowStatus',
  // Activity Timeline
  getActivities:
    'serviceComponent://ui.activities.impl.controllers.ActivityTimelineFixedLayoutController/ACTION$provide',
  // Related Lists
  getRelatedListInfoCollection:
    'aura://RelatedListUiController/ACTION$getRelatedListInfoCollection',
  getRelatedListInfoByApiName:
    'aura://RelatedListUiController/ACTION$getRelatedListInfoByApiName',
  postRelatedListRecords:
    'aura://RelatedListUiController/ACTION$postRelatedListRecords',
  // Object Manager (setup domain)
  getObjectListRecords:
    'serviceComponent://ui.objectmanager.setup.components.aura.controller.ObjectListController/ACTION$getObjectListRecords',
  queryFieldDetails:
    'serviceComponent://ui.objectmanager.setup.components.aura.controller.FieldsAndRelationshipsDetailListController/ACTION$queryDetails',
  // Security Health Check (setup domain)
  getSecurityHealthCheckData:
    'serviceComponent://ui.securityhealth.components.aura.dashboard.controller.SecurityDashboardController/ACTION$getAllData',
  getSecurityHealthCheckProgress:
    'serviceComponent://ui.securityhealth.components.aura.dashboard.controller.SecurityDashboardController/ACTION$getProgressBar',
  // Folder Home (Dashboard/Report folders)
  getFolderRecords:
    'serviceComponent://ui.folder.components.aura.components.controller.FolderHomeController/ACTION$getRecords',
  // List View Data Manager (setup entities like FlowDefinitionView)
  getListViewItems:
    'serviceComponent://ui.force.components.controllers.lists.listViewDataManager.ListViewDataManagerController/ACTION$getItems',
  // Validation Rules (setup domain)
  queryValidationRuleDetails:
    'serviceComponent://ui.objectmanager.setup.components.aura.controller.ValidationRuleDetailListController/ACTION$queryDetails',
  // Chatter Feed
  getChatterFeedModel:
    'serviceComponent://ui.chatter.components.aura.components.forceChatter.chatter.FeedController/ACTION$getModel',
} as const;
