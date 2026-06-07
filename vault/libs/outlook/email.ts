/**
 * Outlook Email Operations
 *
 * List, get, send, reply, forward, move, and delete emails via OWA service.svc.
 */

import type {
  ListEmailsInput,
  ListEmailsOutput,
  GetConversationInput,
  GetConversationOutput,
  GetEmailInput,
  GetEmailOutput,
  SendEmailInput,
  SendEmailOutput,
  ReplyToEmailInput,
  ReplyToEmailOutput,
  ForwardEmailInput,
  ForwardEmailOutput,
  MoveEmailInput,
  MoveEmailOutput,
  DeleteEmailInput,
  DeleteEmailOutput,
  MarkEmailReadInput,
  MarkEmailReadOutput,
  FlagEmailInput,
  FlagEmailOutput,
  GetAttachmentInput,
  GetAttachmentOutput,
} from './schemas';
import {
  buildHeaders,
  buildEwsHeader,
  resolveDistinguishedFolderId,
  parseEmailAddress,
} from './helpers';
import { Validation, ContractDrift, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// listEmails
// ============================================================================

/**
 * List email messages from a folder (Inbox by default).
 */
export async function listEmails(
  params: ListEmailsInput,
): Promise<ListEmailsOutput> {
  const {
    auth,
    folderId = 'inbox',
    offset = 0,
    maxCount = 50,
    unreadOnly = false,
    viewFilter,
    sortField,
    sortOrder,
    focusedViewFilter,
    searchQuery,
  } = params;

  if (!auth) {
    throw new Validation(
      'listEmails: auth is required. Call getContext() first and pass the auth object.',
    );
  }

  const parentFolderId = resolveDistinguishedFolderId(folderId);

  // viewFilter takes priority over legacy unreadOnly boolean.
  // When searchQuery is set, ViewFilter must be 'All'; OWA rejects
  // Restriction + ViewFilter in the same request.
  const resolvedViewFilter = searchQuery
    ? 'All'
    : (viewFilter ?? (unreadOnly ? 'Unread' : 'All'));

  // Map focusedViewFilter enum to API integer: All=-1, Focused=0, Other=1
  const focusedViewFilterMap: Record<string, number> = {
    All: -1,
    Focused: 0,
    Other: 1,
  };
  // Also force FocusedViewFilter to All (-1) when searchQuery is set;
  // OWA rejects any view filter alongside Restriction.
  const resolvedFocusedFilter = searchQuery
    ? -1
    : focusedViewFilter != null
      ? (focusedViewFilterMap[focusedViewFilter] ?? -1)
      : -1;

  const body: Record<string, unknown> = {
    __type: 'FindItemJsonRequest:#Exchange',
    Header: {
      __type: 'JsonRequestHeaders:#Exchange',
      RequestServerVersion: 'V2018_01_08',
      TimeZoneContext: {
        __type: 'TimeZoneContext:#Exchange',
        TimeZoneDefinition: {
          __type: 'TimeZoneDefinition:#Exchange',
          Id: auth.timezone,
        },
      },
    },
    Body: {
      __type: 'FindItemRequest:#Exchange',
      ItemShape: {
        __type: 'ItemResponseShape:#Exchange',
        BaseShape: 'IdOnly',
        AdditionalProperties: [
          { __type: 'PropertyUri:#Exchange', FieldURI: 'ItemParentId' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'ConversationId' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'Subject' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'From' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'Preview' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'DateTimeReceived' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'IsRead' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'HasAttachments' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'Importance' },
        ],
      },
      ParentFolderIds: [
        typeof parentFolderId === 'string'
          ? { __type: 'FolderId:#Exchange', Id: parentFolderId }
          : parentFolderId,
      ],
      Traversal: 'Shallow',
      Paging: {
        __type: 'IndexedPageView:#Exchange',
        BasePoint: 'Beginning',
        Offset: offset,
        MaxEntriesReturned: maxCount,
      },
      ViewFilter: resolvedViewFilter,
      SortOrder: [
        {
          __type: 'SortResults:#Exchange',
          Order: sortOrder ?? 'Descending',
          Path: {
            __type: 'PropertyUri:#Exchange',
            FieldURI: sortField ?? 'DateTimeReceived',
          },
        },
      ],
      FocusedViewFilter: resolvedFocusedFilter,
      ShapeName: 'MailListItem',
      IsWarmUpSearch: false,
      ...(searchQuery
        ? {
            Restriction: {
              __type: 'RestrictionType:#Exchange',
              Item: {
                __type: 'Or:#Exchange',
                Items: [
                  {
                    __type: 'Contains:#Exchange',
                    ContainmentMode: 'Substring',
                    ContainmentComparison: 'IgnoreCase',
                    Item: {
                      __type: 'PropertyUri:#Exchange',
                      FieldURI: 'Subject',
                    },
                    Constant: {
                      __type: 'ConstantValueType:#Exchange',
                      Value: searchQuery,
                    },
                  },
                  {
                    __type: 'Contains:#Exchange',
                    ContainmentMode: 'Substring',
                    ContainmentComparison: 'IgnoreCase',
                    Item: {
                      __type: 'PropertyUri:#Exchange',
                      FieldURI: 'Body',
                    },
                    Constant: {
                      __type: 'ConstantValueType:#Exchange',
                      Value: searchQuery,
                    },
                  },
                  {
                    __type: 'Contains:#Exchange',
                    ContainmentMode: 'Substring',
                    ContainmentComparison: 'IgnoreCase',
                    Item: {
                      __type: 'PropertyUri:#Exchange',
                      FieldURI: 'Sender',
                    },
                    Constant: {
                      __type: 'ConstantValueType:#Exchange',
                      Value: searchQuery,
                    },
                  },
                ],
              },
            },
          }
        : {}),
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=FindItem&app=Mail`;
  const headers = buildHeaders(auth, 'FindItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    return { emails: [], totalCount: 0, moreAvailable: false };
  }

  const findResult = responseItems[0];
  if (findResult.ResponseClass === 'Error') {
    throw new ContractDrift(
      `FindItem error: ${findResult.ResponseCode} - ${findResult.MessageText || 'Unknown'}`,
    );
  }

  const rootFolder = findResult.RootFolder;
  const items = rootFolder?.Items || [];
  const totalItemsInView = rootFolder?.TotalItemsInView ?? 0;
  const includesLastItem = rootFolder?.IncludesLastItemInRange ?? true;

  const emails = items.map((item: Record<string, unknown>) => {
    const from = item.From as Record<string, unknown> | undefined;
    const fromMailbox = from?.Mailbox as Record<string, unknown> | undefined;
    const flag = item.Flag as Record<string, unknown> | undefined;

    return {
      itemId: (item.ItemId as Record<string, string>)?.Id || '',
      conversationId: (item.ConversationId as Record<string, string>)?.Id || '',
      subject: (item.Subject as string) || '',
      from: fromMailbox
        ? parseEmailAddress(fromMailbox)
        : { name: '', email: '' },
      displayTo: (item.DisplayTo as string) || '',
      preview: (item.Preview as string) || '',
      receivedAt: (item.DateTimeReceived as string) || '',
      sentAt: (item.DateTimeSent as string) || '',
      isRead: (item.IsRead as boolean) ?? true,
      isDraft: (item.IsDraft as boolean) ?? false,
      hasAttachments: (item.HasAttachments as boolean) ?? false,
      importance: (item.Importance as string) || 'Normal',
      flagStatus: (flag?.FlagStatus as string) || 'NotFlagged',
      inferenceClassification:
        (item.InferenceClassification as string) || 'Focused',
    };
  });

  return {
    emails,
    totalCount: totalItemsInView,
    moreAvailable: !includesLastItem,
  };
}

// ============================================================================
// getConversation
// ============================================================================

/**
 * Get all messages in a conversation thread by conversation ID.
 */
export async function getConversation(
  params: GetConversationInput,
): Promise<GetConversationOutput> {
  const { auth, conversationId, maxItems = 100 } = params;

  if (!auth) {
    throw new Validation(
      'getConversation: auth is required. Call getContext() first and pass the auth object.',
    );
  }

  if (!conversationId) {
    throw new Validation(
      'getConversation: conversationId is required. Get it from listEmails or getEmail.',
    );
  }

  const body = {
    __type: 'GetConversationItemsJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'GetConversationItemsRequest:#Exchange',
      Conversations: [
        {
          __type: 'ConversationRequest:#Exchange',
          ConversationId: {
            __type: 'ItemId:#Exchange',
            Id: conversationId,
          },
        },
      ],
      ItemShape: {
        __type: 'ItemResponseShape:#Exchange',
        BaseShape: 'IdOnly',
        AdditionalProperties: [
          { __type: 'PropertyUri:#Exchange', FieldURI: 'ItemParentId' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'ConversationId' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'Subject' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'From' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'DisplayTo' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'Preview' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'DateTimeReceived' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'DateTimeSent' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'IsRead' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'IsDraft' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'HasAttachments' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'Importance' },
          { __type: 'PropertyUri:#Exchange', FieldURI: 'Flag' },
          {
            __type: 'PropertyUri:#Exchange',
            FieldURI: 'InferenceClassification',
          },
        ],
      },
      FoldersToIgnore: [],
      MaxItemsToReturn: maxItems,
      SortOrder: 'DateOrderAscending',
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=GetConversationItems&app=Mail`;
  const headers = buildHeaders(auth, 'GetConversationItems');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    return { conversationId, messages: [] };
  }

  const convResult = responseItems[0];
  if (convResult.ResponseClass === 'Error') {
    throw new ContractDrift(
      `getConversation error: ${convResult.ResponseCode} - ${convResult.MessageText || 'Unknown'}`,
    );
  }

  // GetConversationItems returns Conversation.ConversationNodes[].Items[]
  const conversation = convResult.Conversation;
  const nodes = conversation?.ConversationNodes || [];

  const messages: GetConversationOutput['messages'] = [];

  for (const node of nodes) {
    const nodeItems = node?.Items || [];
    for (const item of nodeItems as Array<Record<string, unknown>>) {
      const from = item.From as Record<string, unknown> | undefined;
      const fromMailbox = from?.Mailbox as Record<string, unknown> | undefined;
      const flag = item.Flag as Record<string, unknown> | undefined;

      messages.push({
        itemId: (item.ItemId as Record<string, string>)?.Id || '',
        conversationId:
          (item.ConversationId as Record<string, string>)?.Id || '',
        subject: (item.Subject as string) || '',
        from: fromMailbox
          ? parseEmailAddress(fromMailbox)
          : { name: '', email: '' },
        displayTo: (item.DisplayTo as string) || '',
        preview: (item.Preview as string) || '',
        receivedAt: (item.DateTimeReceived as string) || '',
        sentAt: (item.DateTimeSent as string) || '',
        isRead: (item.IsRead as boolean) ?? true,
        isDraft: (item.IsDraft as boolean) ?? false,
        hasAttachments: (item.HasAttachments as boolean) ?? false,
        importance: (item.Importance as string) || 'Normal',
        flagStatus: (flag?.FlagStatus as string) || 'NotFlagged',
        inferenceClassification:
          (item.InferenceClassification as string) || 'Focused',
      });
    }
  }

  return { conversationId, messages };
}

// ============================================================================
// getEmail
// ============================================================================

/**
 * Get full content of a single email by its item ID.
 */
export async function getEmail(params: GetEmailInput): Promise<GetEmailOutput> {
  const {
    auth,
    itemId,
    bodyType = 'HTML',
    filterHtmlContent,
    addBlankTargetToLinks,
    blockExternalImages,
    includeMimeContent,
    maximumBodySize,
    inlineImageUrlTemplate,
  } = params;

  if (!auth) {
    throw new Validation(
      'getEmail: auth is required. Call getContext() first and pass the auth object.',
    );
  }

  if (!itemId) {
    throw new Validation(
      'getEmail: itemId is required. Pass the item ID from listEmails.',
    );
  }

  const validBodyTypes = ['HTML', 'Text', 'Best'];
  if (!validBodyTypes.includes(bodyType)) {
    throw new Validation(
      `getEmail: bodyType must be one of: ${validBodyTypes.join(', ')}. Got "${bodyType}".`,
    );
  }

  const itemShape: Record<string, unknown> = {
    __type: 'ItemResponseShape:#Exchange',
    BaseShape: 'IdOnly',
    AdditionalProperties: [
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Subject' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'From' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'ToRecipients' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'CcRecipients' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'BccRecipients' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Body' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'UniqueBody' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'ConversationId' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'DateTimeReceived' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'DateTimeSent' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'IsRead' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'HasAttachments' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Attachments' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Importance' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Categories' },
    ],
    BodyType: bodyType,
  };

  if (filterHtmlContent != null)
    itemShape.FilterHtmlContent = filterHtmlContent;
  if (addBlankTargetToLinks != null)
    itemShape.AddBlankTargetToLinks = addBlankTargetToLinks;
  if (blockExternalImages != null)
    itemShape.BlockExternalImages = blockExternalImages;
  if (includeMimeContent != null)
    itemShape.IncludeMimeContent = includeMimeContent;
  if (maximumBodySize != null) itemShape.MaximumBodySize = maximumBodySize;
  if (inlineImageUrlTemplate != null)
    itemShape.InlineImageUrlTemplate = inlineImageUrlTemplate;

  const body: Record<string, unknown> = {
    __type: 'GetItemJsonRequest:#Exchange',
    Header: {
      __type: 'JsonRequestHeaders:#Exchange',
      RequestServerVersion: 'V2018_01_08',
      TimeZoneContext: {
        __type: 'TimeZoneContext:#Exchange',
        TimeZoneDefinition: {
          __type: 'TimeZoneDefinition:#Exchange',
          Id: auth.timezone,
        },
      },
    },
    Body: {
      __type: 'GetItemRequest:#Exchange',
      ItemShape: itemShape,
      ItemIds: [
        {
          __type: 'ItemId:#Exchange',
          Id: itemId,
        },
      ],
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=GetItem&app=Mail`;
  const headers = buildHeaders(auth, 'GetItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    throw new ContractDrift(`GetItem returned no items for ID: ${itemId}`);
  }

  const result = responseItems[0];
  if (result.ResponseClass === 'Error') {
    throw new ContractDrift(
      `GetItem error: ${result.ResponseCode} - ${result.MessageText || 'Unknown'}`,
    );
  }

  const item = result.Items?.[0] || result;

  const from = item.From as Record<string, unknown> | undefined;
  const fromMailbox = from?.Mailbox as Record<string, unknown> | undefined;
  const toRecipients =
    (item.ToRecipients as Array<Record<string, unknown>>) || [];
  const ccRecipients =
    (item.CcRecipients as Array<Record<string, unknown>>) || [];
  const bccRecipients =
    (item.BccRecipients as Array<Record<string, unknown>>) || [];
  const bodyObj = item.Body as Record<string, unknown> | undefined;

  // Extract plain text from body
  const bodyValue = (bodyObj?.Value as string) || '';
  let bodyText: string;
  if (bodyType === 'Text') {
    bodyText = bodyValue;
  } else {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = bodyValue;
    bodyText = tempDiv.textContent || tempDiv.innerText || '';
  }

  const output: Record<string, unknown> = {
    itemId: (item.ItemId as Record<string, string>)?.Id || itemId,
    conversationId: (item.ConversationId as Record<string, string>)?.Id || '',
    subject: (item.Subject as string) || '',
    from: fromMailbox
      ? parseEmailAddress(fromMailbox)
      : { name: '', email: '' },
    toRecipients: toRecipients.map((r: Record<string, unknown>) => {
      const mailbox = r.Mailbox as Record<string, unknown> | undefined;
      return mailbox ? parseEmailAddress(mailbox) : parseEmailAddress(r);
    }),
    ccRecipients: ccRecipients.map((r: Record<string, unknown>) => {
      const mailbox = r.Mailbox as Record<string, unknown> | undefined;
      return mailbox ? parseEmailAddress(mailbox) : parseEmailAddress(r);
    }),
    bccRecipients: bccRecipients.map((r: Record<string, unknown>) => {
      const mailbox = r.Mailbox as Record<string, unknown> | undefined;
      return mailbox ? parseEmailAddress(mailbox) : parseEmailAddress(r);
    }),
    body: bodyValue,
    bodyText,
    receivedAt: (item.DateTimeReceived as string) || '',
    sentAt: (item.DateTimeSent as string) || '',
    isRead: (item.IsRead as boolean) ?? true,
    hasAttachments: (item.HasAttachments as boolean) ?? false,
    importance: (item.Importance as string) || 'Normal',
    categories: (item.Categories as string[]) || [],
  };

  // Parse attachment metadata
  const rawAttachments =
    (item.Attachments as Array<Record<string, unknown>>) || [];
  output.attachments = rawAttachments.map((att: Record<string, unknown>) => ({
    attachmentId: (att.AttachmentId as Record<string, string>)?.Id || '',
    name: (att.Name as string) || '',
    contentType: (att.ContentType as string) || 'application/octet-stream',
    size: (att.Size as number) || 0,
    isInline: (att.IsInline as boolean) ?? false,
    contentId: (att.ContentId as string) || '',
    lastModifiedTime: (att.LastModifiedTime as string) || '',
  }));

  // Include MIME content if requested and present
  const mimeContent = item.MimeContent as Record<string, unknown> | undefined;
  if (mimeContent?.Value) {
    output.mimeContent = {
      characterSet: (mimeContent.CharacterSet as string) || 'UTF-8',
      value: mimeContent.Value as string,
    };
  }

  // Always include truncation flag; OWA returns it on every Body regardless
  // of whether maximumBodySize was set (defaults to false)
  output.isTruncated = (bodyObj?.IsTruncated as boolean) ?? false;

  return output as GetEmailOutput;
}

// ============================================================================
// sendEmail
// ============================================================================

/**
 * Compose and send a new email.
 */
export async function sendEmail(
  params: SendEmailInput,
): Promise<SendEmailOutput> {
  const {
    auth,
    to,
    cc,
    bcc,
    subject,
    body: emailBody,
    bodyType,
    importance,
    sensitivity,
    isReadReceiptRequested,
    isDeliveryReceiptRequested,
    replyTo,
    categories,
    attachments,
    saveAsDraft = false,
  } = params;

  const toRecipients = to.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const ccRecipients = cc?.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const bccRecipients = bcc?.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const replyToRecipients = replyTo?.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const message: Record<string, unknown> = {
    __type: 'Message:#Exchange',
    Subject: subject,
    Body: {
      __type: 'BodyContentType:#Exchange',
      BodyType: bodyType ?? 'HTML',
      Value: emailBody,
    },
    ToRecipients: toRecipients,
    Importance: importance ?? 'Normal',
  };

  if (ccRecipients && ccRecipients.length > 0) {
    message.CcRecipients = ccRecipients;
  }
  if (bccRecipients && bccRecipients.length > 0) {
    message.BccRecipients = bccRecipients;
  }
  if (sensitivity != null) {
    message.Sensitivity = sensitivity;
  }
  if (isReadReceiptRequested != null) {
    message.IsReadReceiptRequested = isReadReceiptRequested;
  }
  if (isDeliveryReceiptRequested != null) {
    message.IsDeliveryReceiptRequested = isDeliveryReceiptRequested;
  }
  if (replyToRecipients && replyToRecipients.length > 0) {
    message.ReplyTo = replyToRecipients;
  }
  if (categories && categories.length > 0) {
    message.Categories = categories;
  }
  if (attachments && attachments.length > 0) {
    message.Attachments = attachments.map((att) => ({
      __type: 'FileAttachment:#Exchange',
      Name: att.name,
      ContentType: att.contentType,
      Content: att.content,
      IsInline: att.isInline ?? false,
    }));
  }

  const requestBody: Record<string, unknown> = {
    __type: 'CreateItemJsonRequest:#Exchange',
    Header: {
      __type: 'JsonRequestHeaders:#Exchange',
      RequestServerVersion: 'V2018_01_08',
      TimeZoneContext: {
        __type: 'TimeZoneContext:#Exchange',
        TimeZoneDefinition: {
          __type: 'TimeZoneDefinition:#Exchange',
          Id: auth.timezone,
        },
      },
    },
    Body: {
      __type: 'CreateItemRequest:#Exchange',
      MessageDisposition: saveAsDraft ? 'SaveOnly' : 'SendAndSaveCopy',
      Items: [message],
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=CreateItem&app=Mail`;
  const headers = buildHeaders(auth, 'CreateItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (Array.isArray(responseItems) && responseItems.length > 0) {
    const first = responseItems[0];
    if (first.ResponseClass === 'Error') {
      throw new ContractDrift(
        `SendEmail error: ${first.ResponseCode} - ${first.MessageText || 'Unknown'}`,
      );
    }

    const sentItem = first.Items?.[0];
    const sentItemId = sentItem?.ItemId?.Id || '';

    return {
      success: true,
      itemId: sentItemId,
    };
  }

  // Some CreateItem responses for send don't return item details
  return {
    success: true,
    itemId: '',
  };
}

// ============================================================================
// replyToEmail
// ============================================================================

/**
 * Reply to an existing email.
 *
 * Internally fetches the item's ChangeKey first; EWS requires it for
 * ReplyToItem's ReferenceItemId when setting extra properties.
 */
export async function replyToEmail(
  params: ReplyToEmailInput,
): Promise<ReplyToEmailOutput> {
  const {
    auth,
    itemId,
    body: replyBody,
    replyAll = false,
    cc,
    bcc,
    subject,
    importance,
    sensitivity,
    bodyType = 'HTML',
    isReadReceiptRequested,
    isDeliveryReceiptRequested,
    to,
    categories,
    replyTo,
    saveAsDraft = false,
    from,
    inReplyTo,
    disallowReactions,
    deferredSendTime,
    flagStatus,
    flagStartDate,
    flagDueDate,
    reminderIsSet,
    reminderDueBy,
    internetMessageId,
    savedItemFolderId,
  } = params;

  if (!auth) {
    throw new Validation(
      'replyToEmail: auth is required. Call getContext() first and pass the auth object.',
    );
  }

  if (!itemId) {
    throw new Validation(
      'replyToEmail: itemId is required. Pass the item ID from listEmails or getEmail.',
    );
  }

  if (replyBody == null) {
    throw new Validation(
      'replyToEmail: body is required. Pass the reply message body text.',
    );
  }

  const origin = window.location.origin;

  // Step 1: Fetch ChangeKey via GetItem (required for ReplyToItem with extra properties)
  const getItemBody = {
    __type: 'GetItemJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'GetItemRequest:#Exchange',
      ItemShape: {
        __type: 'ItemResponseShape:#Exchange',
        BaseShape: 'IdOnly',
      },
      ItemIds: [{ __type: 'ItemId:#Exchange', Id: itemId }],
    },
  };

  const getUrl = `${origin}/owa/0/service.svc?action=GetItem&app=Mail`;
  const getResp = await fetch(getUrl, {
    method: 'POST',
    headers: buildHeaders(auth, 'GetItem'),
    body: JSON.stringify(getItemBody),
    credentials: 'include',
  });

  if (!getResp.ok) throwForStatus(getResp.status, await getResp.text().catch(() => undefined));

  const getData = await getResp.json();
  const getItems = getData?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(getItems) || getItems.length === 0) {
    throw new ContractDrift(
      `replyToEmail: GetItem returned no items for ID: ${itemId}`,
    );
  }
  const getResult = getItems[0];
  if (getResult.ResponseClass === 'Error') {
    throw new ContractDrift(
      `replyToEmail: GetItem error: ${getResult.ResponseCode} - ${getResult.MessageText || 'Unknown'}`,
    );
  }

  const fetchedItem = getResult.Items?.[0] ?? getResult;
  const changeKey = (fetchedItem.ItemId as Record<string, string>)?.ChangeKey;
  if (!changeKey) {
    throw new ContractDrift('replyToEmail: ChangeKey not found on item');
  }

  // Step 2: Build the reply item
  const toRecipients = to?.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const ccRecipients = cc?.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const bccRecipients = bcc?.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const replyToRecipients = replyTo?.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const replyItem: Record<string, unknown> = {
    __type: replyAll ? 'ReplyAllToItem:#Exchange' : 'ReplyToItem:#Exchange',
    ReferenceItemId: {
      __type: 'ItemId:#Exchange',
      Id: itemId,
      ChangeKey: changeKey,
    },
    NewBodyContent: {
      __type: 'BodyContentType:#Exchange',
      BodyType: bodyType,
      Value: replyBody,
    },
  };

  if (toRecipients && toRecipients.length > 0) {
    replyItem.ToRecipients = toRecipients;
  }
  if (ccRecipients && ccRecipients.length > 0) {
    replyItem.CcRecipients = ccRecipients;
  }
  if (bccRecipients && bccRecipients.length > 0) {
    replyItem.BccRecipients = bccRecipients;
  }
  if (subject != null) {
    replyItem.Subject = subject;
  }
  if (importance != null) {
    replyItem.Importance = importance;
  }
  if (sensitivity != null) {
    replyItem.Sensitivity = sensitivity;
  }
  if (isReadReceiptRequested != null) {
    replyItem.IsReadReceiptRequested = isReadReceiptRequested;
  }
  if (isDeliveryReceiptRequested != null) {
    replyItem.IsDeliveryReceiptRequested = isDeliveryReceiptRequested;
  }
  if (categories && categories.length > 0) {
    replyItem.Categories = categories;
  }
  if (replyToRecipients && replyToRecipients.length > 0) {
    replyItem.ReplyTo = replyToRecipients;
  }
  if (from != null) {
    replyItem.From = {
      __type: 'SingleRecipientType:#Exchange',
      Mailbox: {
        __type: 'Mailbox:#Exchange',
        EmailAddress: from,
        MailboxType: 'OneOff',
      },
    };
  }
  if (inReplyTo != null) {
    replyItem.InReplyTo = inReplyTo;
  }
  const extendedProps: Record<string, unknown>[] = [];
  if (disallowReactions) {
    extendedProps.push({
      ExtendedFieldURI: {
        __type: 'PathToExtendedFieldType:#Exchange',
        DistinguishedPropertySetId: 'InternetHeaders',
        PropertyName: 'x-ms-reactions',
        PropertyType: 'String',
      },
      Value: 'disallow',
    });
  }
  if (deferredSendTime) {
    extendedProps.push({
      ExtendedFieldURI: {
        __type: 'PathToExtendedFieldType:#Exchange',
        PropertyTag: '0x3FEF',
        PropertyType: 'SystemTime',
      },
      Value: deferredSendTime,
    });
  }
  if (extendedProps.length > 0) {
    replyItem.ExtendedProperty = extendedProps;
  }
  if (flagStatus != null) {
    const flag: Record<string, unknown> = {
      __type: 'FlagType:#Exchange',
      FlagStatus: flagStatus,
    };
    if (flagStartDate != null) flag.StartDate = flagStartDate;
    if (flagDueDate != null) flag.DueDate = flagDueDate;
    replyItem.Flag = flag;
  }
  if (reminderIsSet != null) {
    replyItem.ReminderIsSet = reminderIsSet;
  }
  if (reminderDueBy != null) {
    replyItem.ReminderDueBy = reminderDueBy;
  }
  if (internetMessageId != null) {
    replyItem.InternetMessageId = internetMessageId;
  }

  const createItemBody: Record<string, unknown> = {
    __type: 'CreateItemRequest:#Exchange',
    MessageDisposition: saveAsDraft ? 'SaveOnly' : 'SendAndSaveCopy',
    Items: [replyItem],
  };
  if (savedItemFolderId != null) {
    const resolvedFolder = resolveDistinguishedFolderId(savedItemFolderId);
    createItemBody.SavedItemFolderId = {
      __type: 'TargetFolderId:#Exchange',
      BaseFolderId:
        typeof resolvedFolder === 'string'
          ? { __type: 'FolderId:#Exchange', Id: resolvedFolder }
          : resolvedFolder,
    };
  }

  const requestBody: Record<string, unknown> = {
    __type: 'CreateItemJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: createItemBody,
  };

  const url = `${origin}/owa/0/service.svc?action=CreateItem&app=Mail`;
  const headers = buildHeaders(auth, 'CreateItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (Array.isArray(responseItems) && responseItems.length > 0) {
    const first = responseItems[0];
    if (first.ResponseClass === 'Error') {
      const msg = first.MessageText as string | undefined;
      throw new ContractDrift(
        `replyToEmail error: ${first.ResponseCode}${msg ? ` - ${msg}` : ''}`,
      );
    }

    let replyItemId = '';
    if (
      Array.isArray(first.Items) &&
      first.Items.length > 0 &&
      first.Items[0] != null
    ) {
      const itemObj = (first.Items[0] as Record<string, unknown>).ItemId as
        | Record<string, string>
        | undefined;
      if (itemObj?.Id) replyItemId = itemObj.Id;
    }

    return {
      success: true,
      itemId: replyItemId,
    };
  }

  return {
    success: true,
    itemId: '',
  };
}

// ============================================================================
// forwardEmail
// ============================================================================

/**
 * Forward an existing email to new recipients.
 *
 * Internally fetches the item's ChangeKey first; EWS requires it for
 * ForwardItem's ReferenceItemId.
 */
export async function forwardEmail(
  params: ForwardEmailInput,
): Promise<ForwardEmailOutput> {
  const {
    auth,
    itemId,
    to,
    cc,
    bcc,
    additionalBody = '',
    subject,
    importance,
    bodyType = 'HTML',
    isReadReceiptRequested,
    isDeliveryReceiptRequested,
    saveAsDraft = false,
  } = params;

  if (!auth) {
    throw new Validation(
      'forwardEmail: auth is required. Call getContext() first and pass the auth object.',
    );
  }

  if (!itemId) {
    throw new Validation(
      'forwardEmail: itemId is required. Pass the item ID from listEmails or getEmail.',
    );
  }

  if (!to || !Array.isArray(to)) {
    throw new Validation(
      'forwardEmail: to is required. Pass an array of recipient email addresses.',
    );
  }

  const origin = window.location.origin;

  // Step 1: Fetch ChangeKey via GetItem (required for ForwardItem)
  const getItemBody = {
    __type: 'GetItemJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'GetItemRequest:#Exchange',
      ItemShape: {
        __type: 'ItemResponseShape:#Exchange',
        BaseShape: 'IdOnly',
      },
      ItemIds: [{ __type: 'ItemId:#Exchange', Id: itemId }],
    },
  };

  const getUrl = `${origin}/owa/0/service.svc?action=GetItem&app=Mail`;
  const getResp = await fetch(getUrl, {
    method: 'POST',
    headers: buildHeaders(auth, 'GetItem'),
    body: JSON.stringify(getItemBody),
    credentials: 'include',
  });

  if (!getResp.ok) throwForStatus(getResp.status, await getResp.text().catch(() => undefined));

  const getData = await getResp.json();
  const getItems = getData?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(getItems) || getItems.length === 0) {
    throw new ContractDrift(
      `forwardEmail: GetItem returned no items for ID: ${itemId}`,
    );
  }
  const getResult = getItems[0];
  if (getResult.ResponseClass === 'Error') {
    throw new ContractDrift(
      `forwardEmail: GetItem error: ${getResult.ResponseCode} - ${getResult.MessageText || 'Unknown'}`,
    );
  }

  const fetchedItem = getResult.Items?.[0] ?? getResult;
  const changeKey = (fetchedItem.ItemId as Record<string, string>)?.ChangeKey;
  if (!changeKey) {
    throw new ContractDrift('forwardEmail: ChangeKey not found on item');
  }

  // Step 2: Build and send the forward request
  const toRecipients = to.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const ccRecipients = cc?.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const bccRecipients = bcc?.map((email) => ({
    __type: 'Mailbox:#Exchange',
    EmailAddress: email,
    MailboxType: 'OneOff',
  }));

  const forwardItem: Record<string, unknown> = {
    __type: 'ForwardItem:#Exchange',
    ReferenceItemId: {
      __type: 'ItemId:#Exchange',
      Id: itemId,
      ChangeKey: changeKey,
    },
    NewBodyContent: {
      __type: 'BodyContentType:#Exchange',
      BodyType: bodyType,
      Value: additionalBody,
    },
    ToRecipients: toRecipients,
  };

  if (ccRecipients && ccRecipients.length > 0) {
    forwardItem.CcRecipients = ccRecipients;
  }
  if (bccRecipients && bccRecipients.length > 0) {
    forwardItem.BccRecipients = bccRecipients;
  }
  if (subject != null) {
    forwardItem.Subject = subject;
  }
  if (importance != null) {
    forwardItem.Importance = importance;
  }
  if (isReadReceiptRequested != null) {
    forwardItem.IsReadReceiptRequested = isReadReceiptRequested;
  }
  if (isDeliveryReceiptRequested != null) {
    forwardItem.IsDeliveryReceiptRequested = isDeliveryReceiptRequested;
  }

  const requestBody: Record<string, unknown> = {
    __type: 'CreateItemJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'CreateItemRequest:#Exchange',
      MessageDisposition: saveAsDraft ? 'SaveOnly' : 'SendAndSaveCopy',
      Items: [forwardItem],
    },
  };

  const url = `${origin}/owa/0/service.svc?action=CreateItem&app=Mail`;
  const headers = buildHeaders(auth, 'CreateItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (Array.isArray(responseItems) && responseItems.length > 0) {
    const first = responseItems[0];
    if (first.ResponseClass === 'Error') {
      const msg = first.MessageText as string | undefined;
      throw new ContractDrift(
        `forwardEmail error: ${first.ResponseCode}${msg ? ` - ${msg}` : ''}`,
      );
    }

    let sentItemId = '';
    if (
      Array.isArray(first.Items) &&
      first.Items.length > 0 &&
      first.Items[0] != null
    ) {
      const itemObj = (first.Items[0] as Record<string, unknown>).ItemId as
        | Record<string, string>
        | undefined;
      if (itemObj?.Id) sentItemId = itemObj.Id;
    }
    return { success: true, itemId: sentItemId };
  }

  return { success: true, itemId: '' };
}

// ============================================================================
// moveEmail
// ============================================================================

/**
 * Move one or more emails to a different folder.
 */
export async function moveEmail(
  params: MoveEmailInput,
): Promise<MoveEmailOutput> {
  const { auth, itemIds, destinationFolderId, returnNewItemIds } = params;

  if (!auth) {
    throw new Validation(
      'moveEmail: auth is required. Call getContext() first and pass the auth object.',
    );
  }

  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    throw new Validation(
      'moveEmail: itemIds is required and must be a non-empty array of email item IDs.',
    );
  }

  if (!destinationFolderId) {
    throw new Validation(
      'moveEmail: destinationFolderId is required. Use a well-known name (inbox, drafts, sentitems, deleteditems, junkemail, archive) or a folder ID from listFolders.',
    );
  }

  const resolvedFolder = resolveDistinguishedFolderId(destinationFolderId);
  const baseFolderId =
    typeof resolvedFolder === 'string'
      ? { __type: 'FolderId:#Exchange', Id: resolvedFolder }
      : resolvedFolder;

  const itemIdObjects = itemIds.map((id) => ({
    __type: 'ItemId:#Exchange',
    Id: id,
  }));

  const moveItemBody: Record<string, unknown> = {
    __type: 'MoveItemRequest:#Exchange',
    ToFolderId: {
      __type: 'TargetFolderId:#Exchange',
      BaseFolderId: baseFolderId,
    },
    ItemIds: itemIdObjects,
  };

  if (returnNewItemIds != null) {
    moveItemBody.ReturnNewItemIds = returnNewItemIds;
  }

  const requestBody: Record<string, unknown> = {
    __type: 'MoveItemJsonRequest:#Exchange',
    Header: {
      __type: 'JsonRequestHeaders:#Exchange',
      RequestServerVersion: 'V2018_01_08',
      TimeZoneContext: {
        __type: 'TimeZoneContext:#Exchange',
        TimeZoneDefinition: {
          __type: 'TimeZoneDefinition:#Exchange',
          Id: auth.timezone,
        },
      },
    },
    Body: moveItemBody,
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=MoveItem&app=Mail`;
  const headers = buildHeaders(auth, 'MoveItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    throw new ContractDrift('moveEmail: No response items returned from MoveItem');
  }

  const movedItemIds: string[] = [];
  for (const item of responseItems) {
    if (item.ResponseClass === 'Error') {
      const msg = item.MessageText as string | undefined;
      throw new ContractDrift(
        `moveEmail error: ${item.ResponseCode}${msg ? ` - ${msg}` : ''}`,
      );
    }
    if (Array.isArray(item.Items) && item.Items.length > 0) {
      const itemObj = (item.Items[0] as Record<string, unknown>).ItemId as
        | Record<string, string>
        | undefined;
      if (itemObj?.Id) movedItemIds.push(itemObj.Id);
    }
  }

  return { success: true, movedItemIds };
}

// ============================================================================
// deleteEmail
// ============================================================================

/**
 * Delete one or more emails (move to Deleted Items by default, or permanent delete).
 */
export async function deleteEmail(
  params: DeleteEmailInput,
): Promise<DeleteEmailOutput> {
  const {
    auth,
    itemIds,
    deleteType = 'MoveToDeletedItems',
    suppressReadReceipts,
    sendMeetingCancellations,
    affectedTaskOccurrences,
  } = params;

  const itemIdObjects = itemIds.map((id) => ({
    __type: 'ItemId:#Exchange',
    Id: id,
  }));

  const deleteBody: Record<string, unknown> = {
    __type: 'DeleteItemRequest:#Exchange',
    DeleteType: deleteType,
    ItemIds: itemIdObjects,
  };

  if (suppressReadReceipts != null) {
    deleteBody.SuppressReadReceipts = suppressReadReceipts;
  }
  if (sendMeetingCancellations != null) {
    deleteBody.SendMeetingCancellations = sendMeetingCancellations;
  }
  if (affectedTaskOccurrences != null) {
    deleteBody.AffectedTaskOccurrences = affectedTaskOccurrences;
  }

  const requestBody: Record<string, unknown> = {
    __type: 'DeleteItemJsonRequest:#Exchange',
    Header: {
      __type: 'JsonRequestHeaders:#Exchange',
      RequestServerVersion: 'V2018_01_08',
      TimeZoneContext: {
        __type: 'TimeZoneContext:#Exchange',
        TimeZoneDefinition: {
          __type: 'TimeZoneDefinition:#Exchange',
          Id: auth.timezone,
        },
      },
    },
    Body: deleteBody,
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=DeleteItem&app=Mail`;
  const headers = buildHeaders(auth, 'DeleteItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (Array.isArray(responseItems)) {
    for (const item of responseItems) {
      if (item.ResponseClass === 'Error') {
        throw new ContractDrift(
          `deleteEmail error: ${item.ResponseCode}${item.MessageText ? ` - ${item.MessageText as string}` : ''}`,
        );
      }
    }
  }

  return { success: true };
}

// ============================================================================
// markEmailRead
// ============================================================================

/**
 * Mark one or more emails as read or unread.
 */
export async function markEmailRead(
  params: MarkEmailReadInput,
): Promise<MarkEmailReadOutput> {
  const { auth, itemIds, isRead, suppressReadReceipts } = params;

  const itemChanges = itemIds.map((id) => ({
    __type: 'ItemChange:#Exchange',
    ItemId: { __type: 'ItemId:#Exchange', Id: id },
    Updates: [
      {
        __type: 'SetItemField:#Exchange',
        Item: {
          __type: 'Message:#Exchange',
          IsRead: isRead,
        },
        Path: {
          __type: 'PropertyUri:#Exchange',
          FieldURI: 'IsRead',
        },
      },
    ],
  }));

  const updateBody: Record<string, unknown> = {
    __type: 'UpdateItemRequest:#Exchange',
    ItemChanges: itemChanges,
    ConflictResolution: 'AlwaysOverwrite',
    MessageDisposition: 'SaveOnly',
  };

  if (suppressReadReceipts != null) {
    updateBody.SuppressReadReceipts = suppressReadReceipts;
  }

  const requestBody: Record<string, unknown> = {
    __type: 'UpdateItemJsonRequest:#Exchange',
    Header: {
      __type: 'JsonRequestHeaders:#Exchange',
      RequestServerVersion: 'V2018_01_08',
      TimeZoneContext: {
        __type: 'TimeZoneContext:#Exchange',
        TimeZoneDefinition: {
          __type: 'TimeZoneDefinition:#Exchange',
          Id: auth.timezone,
        },
      },
    },
    Body: updateBody,
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=UpdateItem&app=Mail`;
  const headers = buildHeaders(auth, 'UpdateItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (Array.isArray(responseItems)) {
    for (const item of responseItems) {
      if (item.ResponseClass === 'Error') {
        throw new ContractDrift(
          `markEmailRead error: ${item.ResponseCode}${item.MessageText ? ` - ${item.MessageText as string}` : ''}`,
        );
      }
    }
  }

  return { success: true };
}

// ============================================================================
// flagEmail
// ============================================================================

/**
 * Flag or unflag one or more emails.
 */
export async function flagEmail(
  params: FlagEmailInput,
): Promise<FlagEmailOutput> {
  const { auth, itemIds, flagStatus, startDate, dueDate, completeDate } =
    params;

  if (!auth) {
    throw new Validation(
      'flagEmail: auth is required. Call getContext() first and pass the auth object.',
    );
  }

  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    throw new Validation(
      'flagEmail: itemIds is required and must be a non-empty array of email item IDs.',
    );
  }

  if (!flagStatus) {
    throw new Validation(
      'flagEmail: flagStatus is required. Use "Flagged", "Complete", or "NotFlagged".',
    );
  }

  const validStatuses = ['Flagged', 'Complete', 'NotFlagged'];
  if (!validStatuses.includes(flagStatus)) {
    throw new Validation(
      `flagEmail: flagStatus must be one of: ${validStatuses.join(', ')}. Got "${flagStatus}".`,
    );
  }

  const itemChanges = itemIds.map((id) => {
    const flag: Record<string, unknown> = {
      __type: 'FlagType:#Exchange',
      FlagStatus: flagStatus,
    };

    if (startDate != null) flag.StartDate = startDate;
    if (dueDate != null) flag.DueDate = dueDate;
    if (completeDate != null) flag.CompleteDate = completeDate;

    return {
      __type: 'ItemChange:#Exchange',
      ItemId: { __type: 'ItemId:#Exchange', Id: id },
      Updates: [
        {
          __type: 'SetItemField:#Exchange',
          Item: {
            __type: 'Message:#Exchange',
            Flag: flag,
          },
          Path: {
            __type: 'PropertyUri:#Exchange',
            FieldURI: 'Flag',
          },
        },
      ],
    };
  });

  const requestBody: Record<string, unknown> = {
    __type: 'UpdateItemJsonRequest:#Exchange',
    Header: {
      __type: 'JsonRequestHeaders:#Exchange',
      RequestServerVersion: 'V2018_01_08',
      TimeZoneContext: {
        __type: 'TimeZoneContext:#Exchange',
        TimeZoneDefinition: {
          __type: 'TimeZoneDefinition:#Exchange',
          Id: auth.timezone,
        },
      },
    },
    Body: {
      __type: 'UpdateItemRequest:#Exchange',
      ItemChanges: itemChanges,
      ConflictResolution: 'AlwaysOverwrite',
      MessageDisposition: 'SaveOnly',
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=UpdateItem&app=Mail`;
  const headers = buildHeaders(auth, 'UpdateItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (Array.isArray(responseItems)) {
    for (const item of responseItems) {
      if (item.ResponseClass === 'Error') {
        throw new ContractDrift(
          `flagEmail error: ${item.ResponseCode}${item.MessageText ? ` - ${item.MessageText as string}` : ''}`,
        );
      }
    }
  }

  return { success: true };
}

// ============================================================================
// getAttachment
// ============================================================================

/**
 * Download the content of an email attachment by its attachment ID.
 */
export async function getAttachment(
  params: GetAttachmentInput,
): Promise<GetAttachmentOutput> {
  const { auth, attachmentId } = params;

  if (!auth) {
    throw new Validation(
      'getAttachment: auth is required. Call getContext() first and pass the auth object.',
    );
  }

  if (!attachmentId) {
    throw new Validation(
      'getAttachment: attachmentId is required. Get it from getEmail().attachments[].attachmentId.',
    );
  }

  const body = {
    __type: 'GetAttachmentJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'GetAttachmentRequest:#Exchange',
      AttachmentIds: [
        {
          __type: 'AttachmentIdType:#Exchange',
          Id: attachmentId,
        },
      ],
      IncludeMimeContent: false,
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=GetAttachment&app=Mail`;
  const headers = buildHeaders(auth, 'GetAttachment');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    throw new ContractDrift(
      `getAttachment: GetAttachment returned no items for ID: ${attachmentId}`,
    );
  }

  const result = responseItems[0];
  if (result.ResponseClass === 'Error') {
    throw new ContractDrift(
      `getAttachment error: ${result.ResponseCode} - ${(result.MessageText as string) || 'Unknown'}`,
    );
  }

  const attachmentArr = result.Attachments as
    | Array<Record<string, unknown>>
    | undefined;
  if (!attachmentArr || attachmentArr.length === 0) {
    throw new ContractDrift(
      `getAttachment: No attachment data returned for ID: ${attachmentId}`,
    );
  }

  const att = attachmentArr[0];
  const content = (att.Content as string) || '';
  const name = (att.Name as string) || '';
  const contentType = (att.ContentType as string) || 'application/octet-stream';
  const size = (att.Size as number) || content.length;

  return {
    name,
    contentType,
    content,
    size,
  };
}
