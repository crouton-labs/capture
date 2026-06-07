import type {
  GetContextOutput,
  ListTemplatesInput,
  ListTemplatesOutput,
  GetTemplateInput,
  GetTemplateOutput,
  CreateTemplateInput,
  CreateTemplateOutput,
  UpdateTemplateInput,
  UpdateTemplateOutput,
  AddTemplateRecipientsInput,
  AddTemplateRecipientsOutput,
  GetTemplateRecipientsInput,
  GetTemplateRecipientsOutput,
  AddTemplateTabsInput,
  AddTemplateTabsOutput,
  UploadTemplateDocumentInput,
  UploadTemplateDocumentOutput,
  ListEnvelopesInput,
  ListEnvelopesOutput,
  GetEnvelopeInput,
  GetEnvelopeOutput,
  CreateEnvelopeFromTemplateInput,
  CreateEnvelopeFromTemplateOutput,
  UpdateEnvelopeInput,
  UpdateEnvelopeOutput,
  SendEnvelopeInput,
  SendEnvelopeOutput,
  VoidEnvelopeInput,
  VoidEnvelopeOutput,
  GetEnvelopeRecipientsInput,
  GetEnvelopeRecipientsOutput,
  UpdateEnvelopeRecipientsInput,
  UpdateEnvelopeRecipientsOutput,
  GetEnvelopeDocumentsInput,
  GetEnvelopeDocumentsOutput,
  GetEnvelopeNotificationInput,
  GetEnvelopeNotificationOutput,
  UpdateEnvelopeNotificationInput,
  UpdateEnvelopeNotificationOutput,
  GetEnvelopeCustomFieldsInput,
  GetEnvelopeCustomFieldsOutput,
  CreateEmbeddedSigningUrlInput,
  CreateEmbeddedSigningUrlOutput,
  SignEnvelopeAsCurrentUserInput,
  SignEnvelopeAsCurrentUserOutput,
  CompleteSigningCeremonyInput,
  CompleteSigningCeremonyOutput,
  ListContactsInput,
  ListContactsOutput,
  AddContactsInput,
  AddContactsOutput,
  ListUsersInput,
  ListUsersOutput,
  ListFoldersInput,
  ListFoldersOutput,
} from './schemas';

export * from './schemas';

import { Unauthenticated, NotFound, ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Internal types for DocuSign API responses
// ============================================================================

interface _DocuSignUserDetails {
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  sub?: string;
  user_id?: string;
}

interface _DocuSignSettingsResponse {
  accountId?: string;
  region?: string;
  dsEnvironment?: string;
  account?: { accountId?: string };
}

interface DocuSignTemplateItem {
  templateId: string;
  name?: string;
  description?: string;
  lastModifiedDateTime?: string;
  createdDateTime?: string;
  shared?: string;
  folderId?: string;
  folderName?: string;
  owner?: { userName?: string; email?: string };
  documents?: DocuSignDocument[];
}

interface DocuSignRecipient {
  recipientId: string;
  name?: string;
  email?: string;
  roleName?: string;
  routingOrder?: string;
  status?: string;
  deliveryMethod?: string;
}

interface DocuSignEnvelopeItem {
  envelopeId: string;
  emailSubject?: string;
  emailBlurb?: string;
  status?: string;
  statusChangedDateTime?: string;
  createdDateTime?: string;
  sentDateTime?: string;
  completedDateTime?: string;
  voidedDateTime?: string;
  voidedReason?: string;
}

interface DocuSignDocument {
  documentId: string;
  name?: string;
  type?: string;
  order?: string;
  pages?: DocuSignPage[];
}

interface DocuSignPage {
  pageId?: string;
  sequence?: string;
  height?: string;
  width?: string;
}

interface DocuSignContact {
  contactId?: string;
  name?: string;
  emails?: string[];
  organization?: string;
}

interface DocuSignUser {
  userId?: string;
  userName?: string;
  email?: string;
  userStatus?: string;
  uri?: string;
}

interface DocuSignFolder {
  folderId?: string;
  name?: string;
  type?: string;
  itemCount?: string;
}

interface DocuSignPaginatedResponse<_T> {
  totalSetSize?: string;
  resultSetSize?: string;
  startPosition?: string;
  endPosition?: string;
}

interface DocuSignTemplateListResponse extends DocuSignPaginatedResponse<DocuSignTemplateItem> {
  envelopeTemplates?: DocuSignTemplateItem[];
}

interface DocuSignEnvelopeListResponse extends DocuSignPaginatedResponse<DocuSignEnvelopeItem> {
  envelopes?: DocuSignEnvelopeItem[];
}

interface DocuSignRecipientsResponse {
  signers?: DocuSignRecipient[];
  carbonCopies?: DocuSignRecipient[];
  recipientCount?: string;
}

interface DocuSignDocumentsResponse {
  envelopeId?: string;
  envelopeDocuments?: DocuSignDocument[];
}

interface DocuSignContactsResponse {
  contactList?: DocuSignContact[];
  contacts?: DocuSignContact[];
}

interface DocuSignUsersResponse extends DocuSignPaginatedResponse<DocuSignUser> {
  users?: DocuSignUser[];
}

interface DocuSignFoldersResponse extends DocuSignPaginatedResponse<DocuSignFolder> {
  folders?: DocuSignFolder[];
}

interface DocuSignNotificationResponse {
  reminders: {
    reminderEnabled: string;
    reminderDelay: string;
    reminderFrequency: string;
  };
  expirations: {
    expireEnabled: string;
    expireAfter: string;
    expireWarn: string;
  };
}

interface DocuSignCustomFieldsResponse {
  textCustomFields?: Array<{
    fieldId: string;
    name: string;
    value: string;
    required: string;
    show: string;
  }>;
  listCustomFields?: Array<Record<string, unknown>>;
}

interface DocuSignEnvelopeCreateResponse {
  envelopeId: string;
  status?: string;
  uri?: string;
  statusDateTime?: string;
}

interface DocuSignEnvelopeUpdateResponse {
  envelopeId?: string;
}

interface DocuSignTemplateCreateResponse {
  templateId: string;
  name?: string;
  uri?: string;
}

interface DocuSignTemplateUpdateResponse {
  templateId?: string;
}

interface DocuSignTabPosition {
  documentId: string;
  pageNumber: string;
  xPosition?: string;
  yPosition?: string;
  anchorString?: string;
  anchorXOffset?: string;
  anchorYOffset?: string;
}

interface DocuSignTextTab extends DocuSignTabPosition {
  tabLabel?: string;
  required?: string;
}

interface DocuSignTabsBody {
  signHereTabs?: DocuSignTabPosition[];
  dateSignedTabs?: DocuSignTabPosition[];
  fullNameTabs?: DocuSignTabPosition[];
  companyTabs?: DocuSignTabPosition[];
  titleTabs?: DocuSignTabPosition[];
  textTabs?: DocuSignTextTab[];
}

interface DocuSignEmbeddedSigningResponse {
  url: string;
}

interface DocuSignFullRecipient extends DocuSignRecipient {
  recipientIdGuid?: string;
  userId?: string;
}

interface DocuSignFullRecipientsResponse {
  signers?: DocuSignFullRecipient[];
  carbonCopies?: DocuSignFullRecipient[];
  recipientCount?: string;
}

// ============================================================================
// Window extensions for fetch interception
// ============================================================================

declare const window: Window & {
  __docusignTokenCapture?: {
    token: string | null;
    accountId: string | null;
    region: string | null;
  };
  __origXhrOpen?: typeof XMLHttpRequest.prototype.open;
  __origXhrSetHeader?: typeof XMLHttpRequest.prototype.setRequestHeader;
};

// ============================================================================
// Internal helpers
// ============================================================================

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = window.__docusignTokenCapture?.token;
  if (!token) {
    throw new Unauthenticated(
      'Bearer token not set. Call getContext() first to capture the auth token.',
    );
  }
  const resp = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string>),
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }
  return resp.json() as Promise<T>;
}

function toInt(val: string | undefined | null): number {
  return parseInt(val ?? '0', 10);
}

// ============================================================================
// Context
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  // Step 1: Install XHR interceptor to capture Bearer token from the app's own API calls.
  // DocuSign is an Angular app that uses XMLHttpRequest (not fetch) for API calls.
  // It adds Authorization: Bearer <JWT> to all /api/esign/ requests via Angular HTTP interceptors.
  if (!window.__docusignTokenCapture) {
    window.__docusignTokenCapture = {
      token: null,
      accountId: null,
      region: null,
    };
    const origOpen = window.__origXhrOpen ?? XMLHttpRequest.prototype.open;
    const origSetHeader =
      window.__origXhrSetHeader ?? XMLHttpRequest.prototype.setRequestHeader;
    window.__origXhrOpen = origOpen;
    window.__origXhrSetHeader = origSetHeader;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: [boolean?, string?, string?]
    ) {
      (this as XMLHttpRequest & { __capturedUrl?: string }).__capturedUrl =
        String(url);
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (
      name: string,
      value: string,
    ) {
      if (
        name.toLowerCase() === 'authorization' &&
        value.startsWith('Bearer ')
      ) {
        window.__docusignTokenCapture!.token = value.replace('Bearer ', '');
        const capturedUrl = (
          this as XMLHttpRequest & { __capturedUrl?: string }
        ).__capturedUrl;
        if (capturedUrl) {
          const match = capturedUrl.match(
            /\/api\/esign\/([^/]+)\/restapi\/v2\.1\/accounts\/([^/]+)/,
          );
          if (match) {
            window.__docusignTokenCapture!.region = match[1];
            window.__docusignTokenCapture!.accountId = match[2];
          }
        }
      }
      return origSetHeader.call(this, name, value);
    };
  }

  // Step 2: Get accountId/region from performance entries (page has already made API calls on load)
  let accountId = window.__docusignTokenCapture.accountId;
  let region = window.__docusignTokenCapture.region;

  if (!accountId || !region) {
    const entries = performance.getEntriesByType(
      'resource',
    ) as PerformanceResourceTiming[];
    for (const entry of entries) {
      const match = entry.name.match(
        /\/api\/esign\/([^/]+)\/restapi\/v2\.1\/accounts\/([^/]+)/,
      );
      if (match) {
        region = match[1];
        accountId = match[2];
        break;
      }
    }
  }

  if (!accountId || !region) {
    throw new Unauthenticated(
      'Could not find DocuSign account info. Ensure apps.docusign.com is fully loaded.',
    );
  }

  // Step 3: If no token captured yet, trigger a lightweight API call via SPA navigation.
  // The Angular app will make XHR requests with the Bearer token, and our interceptor catches it.
  let token = window.__docusignTokenCapture.token;

  if (!token) {
    // Trigger Angular SPA navigation to force API calls
    window.history.pushState(null, '', '/send/home');
    window.dispatchEvent(new PopStateEvent('popstate'));
    // Wait for Angular to react and make API calls
    await new Promise((resolve) => setTimeout(resolve, 4000));
    token = window.__docusignTokenCapture.token;
  }

  if (!token) {
    throw new Unauthenticated(
      'Could not capture DocuSign auth token. The page may need to be refreshed. Navigate to apps.docusign.com and try again.',
    );
  }

  const apiBase = `https://apps.docusign.com/api/esign/${region}/restapi/v2.1/accounts/${accountId}`;

  // Step 4: Get user info from the users endpoint (now that we have the Bearer token)
  const usersData = await apiFetch<DocuSignUsersResponse>(`${apiBase}/users`);
  const firstUser = usersData.users?.[0];
  const userName = firstUser?.userName ?? '';
  const email = firstUser?.email ?? '';
  const userId = firstUser?.userId ?? '';

  return { accountId, userId, userName, email, region, apiBase };
}

// ============================================================================
// Templates
// ============================================================================

export async function listTemplates(
  args: ListTemplatesInput,
): Promise<ListTemplatesOutput> {
  const params = new URLSearchParams({
    user_filter: 'owned_by_me',
    start_position: String(args.startPosition ?? 0),
    count: String(args.count ?? 25),
    order: 'desc',
    order_by: 'modified',
    include: 'recipients,favorite_template_status',
    modified_from_date: '2003-01-01T08:00:00.000Z',
  });
  if (args.searchText) {
    params.set('search_text', args.searchText);
  }

  const data = await apiFetch<DocuSignTemplateListResponse>(
    `${args.apiBase}/templates?${params}`,
  );

  return {
    templates: (data.envelopeTemplates ?? []).map((t) => ({
      templateId: t.templateId,
      name: t.name ?? '',
      description: t.description ?? null,
      lastModifiedDateTime: t.lastModifiedDateTime ?? '',
      createdDateTime: t.createdDateTime ?? '',
      shared: t.shared ?? 'false',
      folderId: t.folderId ?? null,
      folderName: t.folderName ?? null,
      owner: {
        userName: t.owner?.userName ?? '',
        email: t.owner?.email ?? '',
      },
    })),
    totalSetSize: toInt(data.totalSetSize),
    resultSetSize: toInt(data.resultSetSize),
    startPosition: toInt(data.startPosition),
  };
}

export async function getTemplate(
  args: GetTemplateInput,
): Promise<GetTemplateOutput> {
  const [template, recipients] = await Promise.all([
    apiFetch<DocuSignTemplateItem>(
      `${args.apiBase}/templates/${args.templateId}`,
    ),
    apiFetch<DocuSignRecipientsResponse>(
      `${args.apiBase}/templates/${args.templateId}/recipients`,
    ),
  ]);

  return {
    templateId: template.templateId,
    name: template.name ?? '',
    description: template.description ?? null,
    documents: (template.documents ?? []).map((d) => ({
      documentId: d.documentId,
      name: d.name ?? '',
      order: d.order ?? '1',
    })),
    recipients: {
      signers: (recipients.signers ?? []).map((s) => ({
        recipientId: s.recipientId,
        roleName: s.roleName ?? '',
        routingOrder: s.routingOrder ?? '1',
        name: s.name ?? '',
        email: s.email ?? '',
      })),
      carbonCopies: (recipients.carbonCopies ?? []).map((c) => ({
        recipientId: c.recipientId,
        roleName: c.roleName ?? '',
        routingOrder: c.routingOrder ?? '1',
        name: c.name ?? '',
        email: c.email ?? '',
      })),
    },
  };
}

export async function createTemplate(
  args: CreateTemplateInput,
): Promise<CreateTemplateOutput> {
  const body: {
    name: string;
    description?: string;
    emailSubject?: string;
    notification: { useAccountDefaults: boolean };
  } = {
    name: args.name,
    notification: { useAccountDefaults: true },
  };
  if (args.description !== undefined) body.description = args.description;
  if (args.emailSubject !== undefined) body.emailSubject = args.emailSubject;

  const data = await apiFetch<DocuSignTemplateCreateResponse>(
    `${args.apiBase}/templates/`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  return {
    templateId: data.templateId,
    name: data.name ?? args.name,
    uri: data.uri ?? '',
  };
}

export async function updateTemplate(
  args: UpdateTemplateInput,
): Promise<UpdateTemplateOutput> {
  const body: { name?: string; description?: string; emailSubject?: string } =
    {};
  if (args.name !== undefined) body.name = args.name;
  if (args.description !== undefined) body.description = args.description;
  if (args.emailSubject !== undefined) body.emailSubject = args.emailSubject;

  const data = await apiFetch<DocuSignTemplateUpdateResponse>(
    `${args.apiBase}/templates/${args.templateId}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );

  return { templateId: data.templateId ?? args.templateId };
}

export async function addTemplateRecipients(
  args: AddTemplateRecipientsInput,
): Promise<AddTemplateRecipientsOutput> {
  const body = {
    signers: args.signers.map((s) => ({
      name: s.name,
      email: s.email,
      roleName: s.roleName,
      routingOrder: s.routingOrder,
      recipientId: s.recipientId,
    })),
  };

  const data = await apiFetch<DocuSignRecipientsResponse>(
    `${args.apiBase}/templates/${args.templateId}/recipients`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  return {
    signers: (data.signers ?? []).map((s) => ({
      recipientId: s.recipientId,
      roleName: s.roleName ?? '',
      routingOrder: s.routingOrder ?? '1',
      name: s.name ?? '',
      email: s.email ?? '',
    })),
  };
}

export async function getTemplateRecipients(
  args: GetTemplateRecipientsInput,
): Promise<GetTemplateRecipientsOutput> {
  const data = await apiFetch<DocuSignRecipientsResponse>(
    `${args.apiBase}/templates/${args.templateId}/recipients`,
  );

  return {
    signers: (data.signers ?? []).map((s) => ({
      recipientId: s.recipientId,
      name: s.name ?? '',
      email: s.email ?? '',
      roleName: s.roleName ?? '',
      routingOrder: s.routingOrder ?? '1',
    })),
    carbonCopies: (data.carbonCopies ?? []).map((c) => ({
      recipientId: c.recipientId,
      name: c.name ?? '',
      email: c.email ?? '',
      roleName: c.roleName ?? '',
      routingOrder: c.routingOrder ?? '1',
    })),
    recipientCount: toInt(data.recipientCount),
  };
}

export async function addTemplateTabs(
  args: AddTemplateTabsInput,
): Promise<AddTemplateTabsOutput> {
  const body: DocuSignTabsBody = {};

  if (args.signHereTabs?.length) {
    body.signHereTabs = args.signHereTabs.map((t) => ({
      documentId: t.documentId,
      pageNumber: t.pageNumber,
      ...(t.xPosition !== undefined && { xPosition: t.xPosition }),
      ...(t.yPosition !== undefined && { yPosition: t.yPosition }),
      ...(t.anchorString !== undefined && { anchorString: t.anchorString }),
      ...(t.anchorXOffset !== undefined && { anchorXOffset: t.anchorXOffset }),
      ...(t.anchorYOffset !== undefined && { anchorYOffset: t.anchorYOffset }),
    }));
  }
  if (args.dateSignedTabs?.length) {
    body.dateSignedTabs = args.dateSignedTabs.map((t) => ({
      documentId: t.documentId,
      pageNumber: t.pageNumber,
      ...(t.xPosition !== undefined && { xPosition: t.xPosition }),
      ...(t.yPosition !== undefined && { yPosition: t.yPosition }),
      ...(t.anchorString !== undefined && { anchorString: t.anchorString }),
      ...(t.anchorXOffset !== undefined && { anchorXOffset: t.anchorXOffset }),
      ...(t.anchorYOffset !== undefined && { anchorYOffset: t.anchorYOffset }),
    }));
  }
  if (args.fullNameTabs?.length) {
    body.fullNameTabs = args.fullNameTabs.map((t) => ({
      documentId: t.documentId,
      pageNumber: t.pageNumber,
      ...(t.xPosition !== undefined && { xPosition: t.xPosition }),
      ...(t.yPosition !== undefined && { yPosition: t.yPosition }),
      ...(t.anchorString !== undefined && { anchorString: t.anchorString }),
      ...(t.anchorXOffset !== undefined && { anchorXOffset: t.anchorXOffset }),
      ...(t.anchorYOffset !== undefined && { anchorYOffset: t.anchorYOffset }),
    }));
  }
  if (args.companyTabs?.length) {
    body.companyTabs = args.companyTabs.map((t) => ({
      documentId: t.documentId,
      pageNumber: t.pageNumber,
      ...(t.xPosition !== undefined && { xPosition: t.xPosition }),
      ...(t.yPosition !== undefined && { yPosition: t.yPosition }),
      ...(t.anchorString !== undefined && { anchorString: t.anchorString }),
      ...(t.anchorXOffset !== undefined && { anchorXOffset: t.anchorXOffset }),
      ...(t.anchorYOffset !== undefined && { anchorYOffset: t.anchorYOffset }),
    }));
  }
  if (args.titleTabs?.length) {
    body.titleTabs = args.titleTabs.map((t) => ({
      documentId: t.documentId,
      pageNumber: t.pageNumber,
      ...(t.xPosition !== undefined && { xPosition: t.xPosition }),
      ...(t.yPosition !== undefined && { yPosition: t.yPosition }),
      ...(t.anchorString !== undefined && { anchorString: t.anchorString }),
      ...(t.anchorXOffset !== undefined && { anchorXOffset: t.anchorXOffset }),
      ...(t.anchorYOffset !== undefined && { anchorYOffset: t.anchorYOffset }),
    }));
  }
  if (args.textTabs?.length) {
    body.textTabs = args.textTabs.map((t) => ({
      documentId: t.documentId,
      pageNumber: t.pageNumber,
      tabLabel: t.tabLabel,
      ...(t.xPosition !== undefined && { xPosition: t.xPosition }),
      ...(t.yPosition !== undefined && { yPosition: t.yPosition }),
      ...(t.anchorString !== undefined && { anchorString: t.anchorString }),
      ...(t.anchorXOffset !== undefined && { anchorXOffset: t.anchorXOffset }),
      ...(t.anchorYOffset !== undefined && { anchorYOffset: t.anchorYOffset }),
      ...(t.required !== undefined && { required: String(t.required) }),
    }));
  }

  await apiFetch<unknown>(
    `${args.apiBase}/templates/${args.templateId}/recipients/${args.recipientId}/tabs`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  const tabsAdded =
    (args.signHereTabs?.length ?? 0) +
    (args.dateSignedTabs?.length ?? 0) +
    (args.fullNameTabs?.length ?? 0) +
    (args.companyTabs?.length ?? 0) +
    (args.titleTabs?.length ?? 0) +
    (args.textTabs?.length ?? 0);

  return { tabsAdded };
}

interface DocuSignDocumentUploadResponse {
  documentId: string;
  documentIdGuid: string;
  name: string;
  uri: string;
  type?: string;
  order?: string;
}

export async function uploadTemplateDocument(
  args: UploadTemplateDocumentInput,
): Promise<UploadTemplateDocumentOutput> {
  const docId = args.documentId ?? '1';

  const body = {
    documents: [
      {
        name: args.name,
        order: 1,
        documentId: docId,
        fileExtension: args.fileExtension,
        documentBase64: args.documentBase64,
      },
    ],
  };

  const data = await apiFetch<DocuSignDocumentUploadResponse>(
    `${args.apiBase}/templates/${args.templateId}/documents/${docId}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );

  return {
    documentId: data.documentId ?? docId,
    documentIdGuid: data.documentIdGuid ?? '',
    name: data.name ?? args.name,
    uri: data.uri ?? '',
  };
}

// ============================================================================
// Envelopes
// ============================================================================

export async function listEnvelopes(
  args: ListEnvelopesInput,
): Promise<ListEnvelopesOutput> {
  const fromDate =
    args.fromDate ?? new Date(Date.now() - 30 * 86400000).toISOString();

  const params = new URLSearchParams({
    from_date: fromDate,
    start_position: String(args.startPosition ?? 0),
    count: String(args.count ?? 25),
    order: 'desc',
    order_by: 'last_modified',
    include: 'recipients',
  });
  if (args.status) {
    params.set('status', args.status);
  }
  if (args.searchText) {
    params.set('search_text', args.searchText);
  }

  const data = await apiFetch<DocuSignEnvelopeListResponse>(
    `${args.apiBase}/envelopes?${params}`,
  );

  return {
    envelopes: (data.envelopes ?? []).map((e) => ({
      envelopeId: e.envelopeId,
      emailSubject: e.emailSubject ?? null,
      status: e.status ?? '',
      statusChangedDateTime: e.statusChangedDateTime ?? '',
      createdDateTime: e.createdDateTime ?? '',
      sentDateTime: e.sentDateTime ?? null,
      completedDateTime: e.completedDateTime ?? null,
    })),
    totalSetSize: toInt(data.totalSetSize),
    resultSetSize: toInt(data.resultSetSize),
    startPosition: toInt(data.startPosition),
  };
}

export async function getEnvelope(
  args: GetEnvelopeInput,
): Promise<GetEnvelopeOutput> {
  const data = await apiFetch<DocuSignEnvelopeItem>(
    `${args.apiBase}/envelopes/${args.envelopeId}`,
  );

  return {
    envelopeId: data.envelopeId,
    emailSubject: data.emailSubject ?? null,
    emailBlurb: data.emailBlurb ?? null,
    status: data.status ?? '',
    statusChangedDateTime: data.statusChangedDateTime ?? '',
    createdDateTime: data.createdDateTime ?? '',
    sentDateTime: data.sentDateTime ?? null,
    completedDateTime: data.completedDateTime ?? null,
    voidedDateTime: data.voidedDateTime ?? null,
    voidedReason: data.voidedReason ?? null,
  };
}

export async function createEnvelopeFromTemplate(
  args: CreateEnvelopeFromTemplateInput,
): Promise<CreateEnvelopeFromTemplateOutput> {
  const body: {
    templateId: string;
    status: string;
    emailSubject?: string;
    emailBlurb?: string;
  } = {
    templateId: args.templateId,
    status: 'created',
  };
  if (args.emailSubject) body.emailSubject = args.emailSubject;
  if (args.emailBlurb) body.emailBlurb = args.emailBlurb;

  const data = await apiFetch<DocuSignEnvelopeCreateResponse>(
    `${args.apiBase}/envelopes/`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  return {
    envelopeId: data.envelopeId,
    status: data.status ?? 'created',
    uri: data.uri ?? '',
  };
}

export async function updateEnvelope(
  args: UpdateEnvelopeInput,
): Promise<UpdateEnvelopeOutput> {
  const body: { emailSubject?: string; emailBlurb?: string } = {};
  if (args.emailSubject !== undefined) body.emailSubject = args.emailSubject;
  if (args.emailBlurb !== undefined) body.emailBlurb = args.emailBlurb;

  const data = await apiFetch<DocuSignEnvelopeUpdateResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );

  return { envelopeId: data.envelopeId ?? args.envelopeId };
}

export async function sendEnvelope(
  args: SendEnvelopeInput,
): Promise<SendEnvelopeOutput> {
  const data = await apiFetch<DocuSignEnvelopeUpdateResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}`,
    { method: 'PUT', body: JSON.stringify({ status: 'sent' }) },
  );

  return { envelopeId: data.envelopeId ?? args.envelopeId };
}

export async function voidEnvelope(
  args: VoidEnvelopeInput,
): Promise<VoidEnvelopeOutput> {
  const data = await apiFetch<DocuSignEnvelopeUpdateResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        status: 'voided',
        voidedReason: args.voidedReason,
      }),
    },
  );

  return { envelopeId: data.envelopeId ?? args.envelopeId };
}

// ============================================================================
// Recipients
// ============================================================================

export async function getEnvelopeRecipients(
  args: GetEnvelopeRecipientsInput,
): Promise<GetEnvelopeRecipientsOutput> {
  const data = await apiFetch<DocuSignRecipientsResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}/recipients`,
  );

  return {
    signers: (data.signers ?? []).map((s) => ({
      recipientId: s.recipientId,
      name: s.name ?? '',
      email: s.email ?? '',
      roleName: s.roleName ?? '',
      routingOrder: s.routingOrder ?? '1',
      status: s.status ?? '',
      deliveryMethod: s.deliveryMethod ?? 'email',
    })),
    carbonCopies: (data.carbonCopies ?? []).map((c) => ({
      recipientId: c.recipientId,
      name: c.name ?? '',
      email: c.email ?? '',
      roleName: c.roleName ?? '',
      routingOrder: c.routingOrder ?? '1',
      status: c.status ?? '',
    })),
    recipientCount: toInt(data.recipientCount),
  };
}

export async function updateEnvelopeRecipients(
  args: UpdateEnvelopeRecipientsInput,
): Promise<UpdateEnvelopeRecipientsOutput> {
  const body: {
    signers: Array<{
      recipientId: string;
      name: string;
      email: string;
      roleName?: string;
    }>;
    carbonCopies?: Array<{
      recipientId: string;
      name: string;
      email: string;
      roleName?: string;
    }>;
  } = {
    signers: args.signers.map((s) => ({
      recipientId: s.recipientId,
      name: s.name,
      email: s.email,
      roleName: s.roleName,
    })),
  };
  if (args.carbonCopies) {
    body.carbonCopies = args.carbonCopies.map((c) => ({
      recipientId: c.recipientId,
      name: c.name,
      email: c.email,
      roleName: c.roleName,
    }));
  }

  await apiFetch<DocuSignRecipientsResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}/recipients`,
    { method: 'PUT', body: JSON.stringify(body) },
  );

  return {
    signers: args.signers.map((s) => ({
      recipientId: s.recipientId,
      name: s.name,
      email: s.email,
    })),
  };
}

// ============================================================================
// Documents
// ============================================================================

export async function getEnvelopeDocuments(
  args: GetEnvelopeDocumentsInput,
): Promise<GetEnvelopeDocumentsOutput> {
  const data = await apiFetch<DocuSignDocumentsResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}/documents`,
  );

  return {
    envelopeId: data.envelopeId ?? args.envelopeId,
    documents: (data.envelopeDocuments ?? []).map((d) => ({
      documentId: d.documentId,
      name: d.name ?? '',
      type: d.type ?? 'content',
      order: d.order ?? '1',
      pages: d.pages
        ? d.pages.map((p) => ({
            pageId: p.pageId ?? '',
            sequence: p.sequence ?? '',
            height: p.height ?? '',
            width: p.width ?? '',
          }))
        : undefined,
    })),
  };
}

// ============================================================================
// Notifications
// ============================================================================

export async function getEnvelopeNotification(
  args: GetEnvelopeNotificationInput,
): Promise<GetEnvelopeNotificationOutput> {
  return apiFetch<DocuSignNotificationResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}/notification`,
  );
}

export async function updateEnvelopeNotification(
  args: UpdateEnvelopeNotificationInput,
): Promise<UpdateEnvelopeNotificationOutput> {
  const body: {
    reminders: Record<string, string>;
    expirations: Record<string, string>;
  } = {
    reminders: {},
    expirations: {},
  };

  if (args.reminderEnabled !== undefined)
    body.reminders.reminderEnabled = String(args.reminderEnabled);
  if (args.reminderDelay !== undefined)
    body.reminders.reminderDelay = String(args.reminderDelay);
  if (args.reminderFrequency !== undefined)
    body.reminders.reminderFrequency = String(args.reminderFrequency);
  if (args.expireEnabled !== undefined)
    body.expirations.expireEnabled = String(args.expireEnabled);
  if (args.expireAfter !== undefined)
    body.expirations.expireAfter = String(args.expireAfter);
  if (args.expireWarn !== undefined)
    body.expirations.expireWarn = String(args.expireWarn);

  return apiFetch<DocuSignNotificationResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}/notification`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

// ============================================================================
// Custom Fields
// ============================================================================

export async function getEnvelopeCustomFields(
  args: GetEnvelopeCustomFieldsInput,
): Promise<GetEnvelopeCustomFieldsOutput> {
  const data = await apiFetch<DocuSignCustomFieldsResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}/custom_fields`,
  );
  return {
    textCustomFields: data.textCustomFields ?? [],
    listCustomFields: data.listCustomFields ?? [],
  };
}

// ============================================================================
// Embedded signing
// ============================================================================

export async function createEmbeddedSigningUrl(
  args: CreateEmbeddedSigningUrlInput,
): Promise<CreateEmbeddedSigningUrlOutput> {
  const body = {
    returnUrl: args.returnUrl,
    authenticationMethod: 'none',
    clientUserId: args.clientUserId,
    userName: args.userName,
    email: args.email,
    recipientId: args.recipientId,
  };

  const data = await apiFetch<DocuSignEmbeddedSigningResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}/views/recipient`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  return { url: data.url };
}

// ============================================================================
// Signing (DANGEROUS: see schema notes)
// ============================================================================

export async function signEnvelopeAsCurrentUser(
  args: SignEnvelopeAsCurrentUserInput,
): Promise<SignEnvelopeAsCurrentUserOutput> {
  // 1. Get full recipient data including recipientIdGuid
  const recipientsData = await apiFetch<DocuSignFullRecipientsResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}/recipients`,
  );

  // 2. Find the recipient matching the current user's email
  const allSigners = recipientsData.signers ?? [];
  const matchingSigner = allSigners.find(
    (s) => s.email?.toLowerCase() === args.signerEmail.toLowerCase(),
  );

  if (!matchingSigner) {
    throw new NotFound(
      `No signer found with email ${args.signerEmail} on envelope ${args.envelopeId}. Available signers: ${allSigners.map((s) => s.email).join(', ')}`,
    );
  }

  const recipientIdGuid = matchingSigner.recipientIdGuid;
  if (!recipientIdGuid) {
    throw new ContractDrift(
      'recipientIdGuid not found in recipient data. The recipient may not have a GUID assigned.',
    );
  }

  // 3. Generate signing URL via POST /views/recipient
  const returnUrl = `https://apps.docusign.com/send/redirect?to=%2Fsend%2Fdocuments%2Fdetails%2F${args.envelopeId}&from=Envelope%20Details&accountId=${args.apiBase.split('/accounts/')[1]}`;
  const body = {
    authenticationMethod: 'Email',
    userId: args.userId,
    returnUrl,
    recipientId: recipientIdGuid,
  };

  const data = await apiFetch<DocuSignEmbeddedSigningResponse>(
    `${args.apiBase}/envelopes/${args.envelopeId}/views/recipient`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  return {
    signingUrl: data.url,
    envelopeId: args.envelopeId,
    recipientName: matchingSigner.name ?? '',
    recipientEmail: matchingSigner.email ?? '',
  };
}

export async function completeSigningCeremony(
  args: CompleteSigningCeremonyInput,
): Promise<CompleteSigningCeremonyOutput> {
  // 1. Extract ti token from current URL (must be on the signing ceremony page)
  const currentUrl = new URL(window.location.href);
  const ti = currentUrl.searchParams.get('ti');
  if (!ti) {
    throw new Validation(
      'Not on a signing ceremony page: no ti parameter found in URL. Navigate to the signing URL first. Current URL: ' +
        window.location.href,
    );
  }

  const region = args.region ?? 'na4';
  const signingBase = `https://apps.docusign.com/api/esign/${region}/Signing`;
  const tiParams = `ti=${ti}&insession=1&fts=1`;

  // 2. Load envelope data to discover tabs
  const envelopeResp = await fetch(`${signingBase}/envelope?${tiParams}`, {
    credentials: 'include',
  });
  if (!envelopeResp.ok) {
    throwForStatus(envelopeResp.status, 'Failed to load signing envelope data');
  }
  const envelopeData = (await envelopeResp.json()) as {
    envelopeId?: string;
    recipient?: { recipientId?: string; status?: string };
    recipComplete?: boolean;
    isViewOnlyMode?: boolean;
    tabs?: Record<
      string,
      {
        id?: string;
        type?: string;
        isSignatureTab?: boolean;
        signatureType?: string;
        status?: string;
        recipientId?: string;
        required?: boolean;
        value?: string;
        tabLabel?: string;
      }
    >;
  };

  if (envelopeData.recipComplete || envelopeData.isViewOnlyMode) {
    throw new Validation(
      'This recipient has already completed signing or is in view-only mode.',
    );
  }

  const currentRecipientId = envelopeData.recipient?.recipientId;
  if (!currentRecipientId) {
    throw new ContractDrift(
      'Could not identify the current recipient from envelope data.',
    );
  }

  // 3. Collect tabs for the current recipient
  // tabs is an object with numeric string keys ("0", "1", ...), each value is a single tab object
  const allTabs = envelopeData.tabs ?? {};
  const signatureTabs: Array<{
    tabId: string;
    tabType: 'signature' | 'initial';
  }> = [];
  const allTabSubmissions: Array<{
    id: string;
    status?: string;
    scale?: number;
    value?: string;
  }> = [];

  for (const tab of Object.values(allTabs)) {
    if (!tab.id || tab.recipientId !== currentRecipientId) continue;

    const tabType = (tab.type ?? '').toLowerCase();
    if (tab.isSignatureTab || tabType === 'signhere') {
      const sigType =
        tab.signatureType?.toLowerCase() === 'initial'
          ? 'initial'
          : 'signature';
      signatureTabs.push({ tabId: tab.id, tabType: sigType });
      allTabSubmissions.push({ id: tab.id, status: 'Signed', scale: 1 });
    } else if (tabType === 'initialhere') {
      signatureTabs.push({ tabId: tab.id, tabType: 'initial' });
      allTabSubmissions.push({ id: tab.id, status: 'Signed', scale: 1 });
    } else if (tabType === 'datesigned' || tabType === 'fullname') {
      allTabSubmissions.push({ id: tab.id, status: 'Signed', scale: 1 });
    } else if (tab.value !== undefined) {
      allTabSubmissions.push({
        id: tab.id,
        value: tab.value,
      });
    }
  }

  if (signatureTabs.length === 0) {
    throw new NotFound(
      'No signature tabs found for the current recipient. The envelope may not require a signature from this user.',
    );
  }

  // 4. Adopt signature for each signature/initial tab
  const firstName = args.signerName.split(' ')[0] ?? args.signerName;
  const lastName = args.signerName.split(' ').slice(1).join(' ') ?? '';
  const initials =
    args.signerInitials ?? `${firstName[0]}${lastName[0] ?? ''}`.toUpperCase();

  for (const sigTab of signatureTabs) {
    const adoptBody = new URLSearchParams({
      method: 'select-style',
      fullname: args.signerName,
      initials,
      tabId: sigTab.tabId,
      font: '7_DocuSign',
      firstName,
      lastName,
      tabType: sigTab.tabType,
    });

    const adoptResp = await fetch(
      `${signingBase}/envelope/adoptsignature?${tiParams}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: adoptBody.toString(),
      },
    );
    if (!adoptResp.ok) {
      throwForStatus(adoptResp.status, `Failed to adopt signature for tab ${sigTab.tabId}`);
    }
  }

  // 5. Submit all tabs as signed
  const tabsResp = await fetch(`${signingBase}/tabs?${tiParams}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tabs: allTabSubmissions,
      tabsToAdd: [],
      tabsToRemove: [],
    }),
  });
  if (!tabsResp.ok) {
    const errText = await tabsResp.text().catch(() => undefined);
    throwForStatus(tabsResp.status, errText);
  }

  // 6. Finish signing
  const envelopeId = envelopeData.envelopeId ?? '';
  const finishResp = await fetch(
    `${signingBase}/envelope_actions/${envelopeId}/finish?${tiParams}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabs: [] }),
    },
  );
  if (!finishResp.ok) {
    const errText = await finishResp.text().catch(() => undefined);
    throwForStatus(finishResp.status, errText);
  }

  return { status: 'completed', envelopeId };
}

// ============================================================================
// Contacts
// ============================================================================

export async function listContacts(
  args: ListContactsInput,
): Promise<ListContactsOutput> {
  const data = await apiFetch<DocuSignContactsResponse>(
    `${args.apiBase}/contacts`,
  );

  const contacts = (data.contactList ?? data.contacts ?? []).map((c) => ({
    contactId: c.contactId ?? '',
    name: c.name ?? '',
    emails: c.emails ?? [],
    organization: c.organization ?? null,
  }));

  return { contacts, totalCount: contacts.length };
}

export async function addContacts(
  args: AddContactsInput,
): Promise<AddContactsOutput> {
  const body = {
    contactList: args.contacts.map((c) => ({
      name: c.name,
      emails: c.emails,
      organization: c.organization,
    })),
  };

  await apiFetch<unknown>(`${args.apiBase}/contacts`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return { contactsAdded: args.contacts.length };
}

// ============================================================================
// Users
// ============================================================================

export async function listUsers(
  args: ListUsersInput,
): Promise<ListUsersOutput> {
  const data = await apiFetch<DocuSignUsersResponse>(`${args.apiBase}/users`);

  return {
    users: (data.users ?? []).map((u) => ({
      userId: u.userId ?? '',
      userName: u.userName ?? '',
      email: u.email ?? '',
      userStatus: u.userStatus ?? '',
      uri: u.uri ?? '',
    })),
    totalSetSize: toInt(data.totalSetSize),
  };
}

// ============================================================================
// Folders
// ============================================================================

export async function listFolders(
  args: ListFoldersInput,
): Promise<ListFoldersOutput> {
  const data = await apiFetch<DocuSignFoldersResponse>(
    `${args.apiBase}/folders`,
  );

  return {
    folders: (data.folders ?? []).map((f) => ({
      folderId: f.folderId ?? '',
      name: f.name ?? '',
      type: f.type ?? null,
      itemCount: f.itemCount ?? null,
    })),
    totalSetSize: toInt(data.totalSetSize),
  };
}
