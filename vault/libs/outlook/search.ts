/**
 * Outlook Search, Categories & Settings
 *
 * searchMail: Substrate Search Service full-text search.
 * listCategories: EWS FindCategoryDetails via service.svc.
 * getSettings: OutlookOptions REST endpoint.
 */

import type {
  OutlookAuth,
  SearchMailInput,
  SearchMailOutput,
  ListCategoriesInput,
  ListCategoriesOutput,
  GetSettingsInput,
  GetSettingsOutput,
} from './schemas';
import { buildHeaders, buildEwsHeader } from './helpers';
import { getContext } from './auth';
import { ContractDrift, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Local Helpers
// ============================================================================

/** Safely extract a string from an unknown value. Returns empty string if not a string. */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Safely extract a number from an unknown value. Returns 0 if not a number. */
function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** Safely extract a boolean from an unknown value. Returns provided fallback if not a boolean. */
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Build headers for non-service.svc REST endpoints (Substrate Search, OutlookOptions).
 */
function buildRestHeaders(auth: OutlookAuth): Record<string, string> {
  const headers: Record<string, string> = {
    'x-anchormailbox': auth.anchorMailbox,
    'x-owa-sessionid': auth.sessionId,
    'x-owa-correlationid': auth.correlationId,
    'content-type': 'application/json; charset=utf-8',
  };

  if (auth.authorization) {
    headers.authorization = auth.authorization;
  }

  return headers;
}

// ============================================================================
// searchMail
// ============================================================================

/**
 * Execute a full-text search across mail messages via the Substrate Search Service.
 */
export async function searchMail(
  params: SearchMailInput,
): Promise<SearchMailOutput> {
  const {
    query,
    size = 25,
    sortField = 'Time',
    sortDirection = 'Desc',
    entityType = 'Message',
    folderId,
    enableTopResults = false,
    topResultsCount,
    enableQueryAlterations = false,
    dateStart,
    dateEnd,
  } = params;

  let auth = params.auth;
  if (!auth) {
    const ctx = await getContext();
    auth = ctx.auth;
  }

  const origin = window.location.origin;
  const url = `${origin}/searchservice/api/v2/query`;
  const headers = buildRestHeaders(auth);

  // Build sort array; when using Score sort with top results, include count
  const sort: Array<Record<string, unknown>> = [];
  if (enableTopResults && sortField === 'Score' && topResultsCount) {
    sort.push({
      Field: 'Score',
      SortDirection: sortDirection,
      Count: topResultsCount,
    });
    sort.push({ Field: 'Time', SortDirection: 'Desc' });
  } else {
    sort.push({ Field: sortField, SortDirection: sortDirection });
  }

  // Build folder filter; default searches msgfolderroot + DeletedItems
  const folderFilter: Record<string, unknown> = folderId
    ? {
        Or: [
          { Term: { FolderId: folderId } },
          { Term: { DistinguishedFolderName: 'DeletedItems' } },
        ],
      }
    : {
        Or: [
          { Term: { DistinguishedFolderName: 'msgfolderroot' } },
          { Term: { DistinguishedFolderName: 'DeletedItems' } },
        ],
      };

  // When date range is specified, wrap folder + date filters in an And compound
  let filter: Record<string, unknown>;
  if (dateStart || dateEnd) {
    const range: Record<string, string> = {};
    if (dateStart) range.gte = dateStart;
    if (dateEnd) range.lte = dateEnd;
    filter = {
      And: [{ Range: { received: range } }, folderFilter],
    };
  } else {
    filter = folderFilter;
  }

  const entityRequest: Record<string, unknown> = {
    Query: { QueryString: query },
    EntityType: entityType,
    ContentSources: ['Exchange'],
    Filter: filter,
    From: 0,
    Size: size,
    Sort: sort,
    RefiningQueries: null,
    EnableTopResults: enableTopResults,
  };

  if (enableTopResults && topResultsCount) {
    entityRequest.TopResultsCount = topResultsCount;
  }

  const requestBody: Record<string, unknown> = {
    Cvid: auth.correlationId,
    Scenario: { Name: 'owa.react' },
    TimeZone: auth.timezone,
    TextDecorations: 'Off',
    EntityRequests: [entityRequest],
  };

  if (enableQueryAlterations) {
    requestBody.QueryAlterationOptions = {
      EnableSuggestion: true,
      EnableAlteration: true,
      SupportedRecourseDisplayTypes: [
        'Suggestion',
        'NoResultModification',
        'NoResultFolderRefinerModification',
        'NoRequeryModification',
        'Modification',
      ],
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  // Substrate Search response: { EntitySets: [{ EntityType, ResultSets: [{ Results, Total }] }] }
  const entitySets = data?.EntitySets as
    | Array<Record<string, unknown>>
    | undefined;
  if (!Array.isArray(entitySets) || entitySets.length === 0) {
    return { results: [], totalCount: 0 };
  }

  // EntityType field may be at EntitySets[].EntityType or EntitySets[].Type
  const messageSet =
    entitySets.find(
      (es) => es.EntityType === entityType || es.Type === entityType,
    ) || entitySets[0];
  if (!messageSet) {
    return { results: [], totalCount: 0 };
  }

  const resultSets = messageSet.ResultSets as Array<Record<string, unknown>>;
  if (!Array.isArray(resultSets) || resultSets.length === 0) {
    return { results: [], totalCount: 0 };
  }

  const firstSet = resultSets[0];
  if (!Array.isArray(firstSet.Results)) {
    return { results: [], totalCount: 0 };
  }

  const hits = firstSet.Results as Array<Record<string, unknown>>;
  const totalCount = num(firstSet.Total);

  const results = hits.map((hit: Record<string, unknown>) => {
    const source =
      typeof hit.Source === 'object' && hit.Source !== null
        ? (hit.Source as Record<string, unknown>)
        : {};

    // From field structure differs: Conversation uses {EmailAddress: {Name, Address}}, Message uses {Name, EmailAddress}
    const fromObj =
      typeof source.From === 'object' && source.From !== null
        ? (source.From as Record<string, unknown>)
        : {};
    const emailAddr =
      typeof fromObj.EmailAddress === 'object' && fromObj.EmailAddress !== null
        ? (fromObj.EmailAddress as Record<string, unknown>)
        : null;
    const senderName = emailAddr ? str(emailAddr.Name) : str(fromObj.Name);
    const senderEmail = emailAddr
      ? str(emailAddr.Address)
      : str(fromObj.EmailAddress);

    // HitHighlightedSummary at the hit level takes priority over Source.Preview
    const preview = hit.HitHighlightedSummary
      ? str(hit.HitHighlightedSummary)
      : hit.HitHighlights
        ? str(hit.HitHighlights)
        : str(source.Preview);

    // ItemId/ConversationId may be strings or objects with .Id
    const rawItemId = source.ImmutableId || source.ItemId;
    const itemId =
      typeof rawItemId === 'object' && rawItemId !== null
        ? str((rawItemId as Record<string, unknown>).Id)
        : str(rawItemId);
    const rawConvId = source.ConversationId;
    const conversationId =
      typeof rawConvId === 'object' && rawConvId !== null
        ? str((rawConvId as Record<string, unknown>).Id)
        : str(rawConvId);

    // Subject field: Conversation uses ConversationTopic, Message uses Subject
    const subject = str(source.ConversationTopic || source.Subject);

    // Date: Conversation uses LastDeliveryTime, Message uses DateTimeReceived
    const receivedAt = str(source.LastDeliveryTime || source.DateTimeReceived);

    return {
      itemId,
      conversationId,
      subject,
      from: {
        name: senderName,
        email: senderEmail,
      },
      preview,
      receivedAt,
      isRead: bool(source.IsRead, false),
      hasAttachments: bool(source.HasAttachments, false),
      importance: str(source.Importance) || 'Normal',
      isDraft: bool(source.IsDraft, false),
      folderName: str(source.ParentFolderDisplayName),
    };
  });

  return {
    results,
    totalCount,
  };
}

// ============================================================================
// listCategories
// ============================================================================

/**
 * List all mail category labels and their colors.
 */
export async function listCategories(
  params: ListCategoriesInput,
): Promise<ListCategoriesOutput> {
  let auth: OutlookAuth | undefined = params.auth;
  if (!auth) {
    const ctx = await getContext();
    auth = ctx.auth;
  }

  const body = {
    __type: 'FindCategoryDetailsJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'FindCategoryDetailsRequest:#Exchange',
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=FindCategoryDetails&app=Mail`;
  const headers = buildHeaders(auth, 'FindCategoryDetails');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  // FindCategoryDetails response: { Body: { CategoryDetailsList, EstimatedRowCount, IsSearchFolderReady, ResponseCode, ResponseClass } }
  const respBody = data?.Body as Record<string, unknown> | undefined;
  if (!respBody) {
    return { categories: [], estimatedRowCount: 0, isSearchFolderReady: false };
  }

  if (respBody.ResponseClass === 'Error') {
    throw new ContractDrift(
      `FindCategoryDetails error: ${str(respBody.ResponseCode)} - ${str(respBody.MessageText)}`,
    );
  }

  const categoryDetailsList = Array.isArray(respBody.CategoryDetailsList)
    ? (respBody.CategoryDetailsList as Array<Record<string, unknown>>)
    : [];

  const categories = categoryDetailsList.map(
    (cat: Record<string, unknown>) => ({
      name: str(cat.Category),
      itemCount: num(cat.ItemCount),
      unreadCount: num(cat.UnreadCount),
    }),
  );

  return {
    categories,
    estimatedRowCount: num(respBody.EstimatedRowCount),
    isSearchFolderReady: bool(respBody.IsSearchFolderReady, false),
  };
}

// ============================================================================
// getSettings
// ============================================================================

/**
 * Retrieve user preferences and Outlook options via the OutlookOptions REST endpoint.
 *
 * The endpoint returns { options: [...] } where each item has an itemClass
 * identifying its category (MailLayout, CalendarSurfaceOptions, Commanding, etc.).
 */
export async function getSettings(
  params: GetSettingsInput,
): Promise<GetSettingsOutput> {
  let auth: OutlookAuth | undefined = params.auth;
  if (!auth) {
    const ctx = await getContext();
    auth = ctx.auth;
  }

  const origin = window.location.origin;
  const url = `${origin}/ows/v1.0/OutlookOptions`;
  const headers = buildRestHeaders(auth);

  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = (await response.json()) as Record<string, unknown>;

  if (!data || typeof data !== 'object') {
    throw new ContractDrift(
      `getSettings: Unexpected response shape from ${url}. Got: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  const optionsArray = data.options as
    | Array<Record<string, unknown>>
    | undefined;

  if (!Array.isArray(optionsArray)) {
    throw new ContractDrift(
      `getSettings: Response does not contain expected options array. Keys present: ${Object.keys(data).slice(0, 20).join(', ')}`,
    );
  }

  // Index options by itemClass for easy lookup
  const byClass: Record<string, Record<string, unknown>> = {};
  for (const opt of optionsArray) {
    const itemClass = opt.itemClass as string | undefined;
    if (itemClass) {
      byClass[itemClass] = opt;
    }
  }

  const result: Record<string, unknown> = {};

  // MailLayout
  const ml = byClass['MailLayout'];
  if (ml) {
    result.mailLayout = {
      useSingleLineMessageListWithRightReadingPane: bool(
        ml.useSingleLineMessageListWithRightReadingPane,
        true,
      ),
      animationPreference: num(ml.animationPreference),
    };
  }

  // CalendarSurfaceOptions
  const cs = byClass['CalendarSurfaceOptions'];
  if (cs) {
    result.calendarSurface = {
      agendaPaneIsClosed: bool(cs.agendaPaneIsClosed, false),
      numDaysInDayRange: num(cs.numDaysInDayRange),
      lastKnownRoamingTimeZone: str(cs.lastKnownRoamingTimeZone),
      roamingTimeZoneNotificationsIsDisabled: bool(
        cs.roamingTimeZoneNotificationsIsDisabled,
        false,
      ),
      workLifeView: num(cs.workLifeView),
      timeScaleSetting: num(cs.timeScaleSetting),
      isDynamicColumnWidthEnabled: bool(cs.isDynamicColumnWidthEnabled, true),
      currentSavedViewId: cs.currentSavedViewId as string | null,
      allDayWellHeight: num(cs.allDayWellHeight),
      roamingTimeZoneTeachingMomentDisplayed: bool(
        cs.roamingTimeZoneTeachingMomentDisplayed,
        false,
      ),
      bannedRoamingTimeZone: cs.bannedRoamingTimeZone as string | null,
    };
  }

  // Commanding
  const cmd = byClass['Commanding'];
  if (cmd) {
    result.commanding = {
      shyRibbon: bool(cmd.shyRibbon, false),
      viewMode: num(cmd.viewMode),
    };
  }

  // CalendarSurfaceAddins
  const csa = byClass['CalendarSurfaceAddins'];
  if (csa && Array.isArray(csa.calendarSurfaceAddins)) {
    result.calendarSurfaceAddins = csa.calendarSurfaceAddins as string[];
  }

  // MentionEventNotifications
  const men = byClass['MentionEventNotifications'];
  if (men) {
    result.mentionEventNotifications = {
      enabled: bool(men.enabled, true),
    };
  }

  // WebPushNotifications
  const wpn = byClass['WebPushNotifications'];
  if (wpn) {
    result.webPushNotifications = {
      enabled: bool(wpn.enabled, false),
      enabledTimeInUTCMs: wpn.enabledTimeInUTCMs as number | null,
    };
  }

  // PremiumStatusInPrimarySettings
  const ps = byClass['PremiumStatusInPrimarySettings'];
  if (ps) {
    result.premiumStatus = {
      overallPremiumStatusBit: num(ps.overallPremiumStatusBit),
      licenseAccountIsPremium: bool(ps.licenseAccountIsPremium, false),
    };
  }

  // IsBusinessConsumer
  const ibc = byClass['IsBusinessConsumer'];
  if (ibc) {
    result.isBusinessConsumer = bool(ibc.isBusinessConsumer, false);
  }

  return result as GetSettingsOutput;
}
