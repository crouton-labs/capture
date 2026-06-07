export type {
  GetContextInput,
  GetContextOutput,
  ListCallsInput,
  ListCallsOutput,
  GetCallTranscriptInput,
  GetCallTranscriptOutput,
  AskCallQuestionInput,
  AskCallQuestionOutput,
  GetCallInput,
  GetCallOutput,
  GetCallSpotlightInput,
  GetCallSpotlightOutput,
  ListAccountsInput,
  ListAccountsOutput,
  GetAccountInput,
  GetAccountOutput,
  ListPeopleInput,
  ListPeopleOutput,
  ListUsersInput,
  ListUsersOutput,
  ListDealsInput,
  ListDealsOutput,
  GetDealActivitiesInput,
  GetDealActivitiesOutput,
  GetForecastBoardsInput,
  GetForecastBoardsOutput,
  GetForecastInput,
  GetForecastOutput,
  ListFlowsInput,
  ListFlowsOutput,
  GetTeamStatsInput,
  GetTeamStatsOutput,
  ListSmartTrackersInput,
  ListSmartTrackersOutput,
} from './schemas';

import type {
  GetContextInput,
  GetContextOutput,
  ListCallsInput,
  ListCallsOutput,
  GetCallTranscriptInput,
  GetCallTranscriptOutput,
  AskCallQuestionInput,
  AskCallQuestionOutput,
  GetCallInput,
  GetCallOutput,
  GetCallSpotlightInput,
  GetCallSpotlightOutput,
  ListAccountsInput,
  ListAccountsOutput,
  GetAccountInput,
  GetAccountOutput,
  ListPeopleInput,
  ListPeopleOutput,
  ListUsersInput,
  ListUsersOutput,
  ListDealsInput,
  ListDealsOutput,
  GetDealActivitiesInput,
  GetDealActivitiesOutput,
  GetForecastBoardsInput,
  GetForecastBoardsOutput,
  GetForecastInput,
  GetForecastOutput,
  ListFlowsInput,
  ListFlowsOutput,
  GetTeamStatsInput,
  GetTeamStatsOutput,
  ListSmartTrackersInput,
  ListSmartTrackersOutput,
} from './schemas';

import { Validation, ContractDrift, Unauthenticated, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Helpers
// ============================================================================

interface GongWorkspace {
  id: string;
  name: string;
}

interface GongNavigationProperties {
  currentWorkspace: GongWorkspace & {
    isRecruiting?: boolean;
  };
  workspaces: GongWorkspace[];
  impersonationSettings?: {
    companyName?: string;
    companyId?: string;
  };
}

function getNavigationProperties(): GongNavigationProperties {
  const nav = (
    window as unknown as { GongNavigationProperties?: GongNavigationProperties }
  ).GongNavigationProperties;
  if (!nav) {
    throw new ContractDrift(
      `GongNavigationProperties not found. URL: ${window.location.href}`,
    );
  }
  return nav;
}

function getWorkspaceId(): string {
  return getNavigationProperties().currentWorkspace.id;
}

async function fetchCsrf(): Promise<string> {
  const resp = await fetch('/ajax/common/rtkn', {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }
  const data = (await resp.json()) as { token: string };
  return data.token;
}

function gongHeaders(csrf: string): Record<string, string> {
  return {
    'X-CSRF-TOKEN': csrf,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json; charset=utf-8',
    'Content-Type': 'application/json',
  };
}

// ============================================================================
// getContext
// ============================================================================

export async function getContext(
  _params: GetContextInput,
): Promise<GetContextOutput> {
  const csrf = await fetchCsrf();
  const nav = getNavigationProperties();
  const workspaceId = nav.currentWorkspace.id;
  const workspaceName = nav.currentWorkspace.name;

  // Get userId from JWT payload
  const parts = csrf.split('.');
  if (parts.length !== 3) {
    throw new ContractDrift('CSRF token is not a valid JWT');
  }
  const payload = JSON.parse(atob(parts[1])) as { userId: string };
  const userId = payload.userId;

  // Get companyId from nav properties or Segment cookie
  const companyId =
    nav.impersonationSettings?.companyId ||
    (() => {
      const match = document.cookie.match(/ajs_group_id=([^;]+)/);
      if (!match) {
        throw new Unauthenticated(
          `getContext: company ID not found. URL: ${window.location.href}`,
        );
      }
      return decodeURIComponent(match[1]);
    })();

  const companyName = nav.impersonationSettings?.companyName || undefined;
  const workspaces =
    nav.workspaces?.length > 1
      ? nav.workspaces.map((w) => ({ id: w.id, name: w.name }))
      : undefined;
  const isRecruiting = nav.currentWorkspace.isRecruiting ?? undefined;

  return {
    workspaceId,
    companyId,
    userId,
    workspaceName,
    companyName,
    workspaces,
    isRecruiting,
  };
}

// ============================================================================
// listCalls
// ============================================================================

export async function listCalls(
  params: ListCallsInput,
): Promise<ListCallsOutput> {
  const { searchText = '', offset = 0, pageSize = 25 } = params;
  const csrf = await fetchCsrf();
  const workspaceId = getWorkspaceId();

  const url = `/conversations/ajax/results?workspace-id=${workspaceId}`;

  const searchJson: Record<string, unknown> = {};
  if (searchText) {
    searchJson.search = {
      type: 'And',
      filters: [
        {
          type: 'SearchPhrase',
          text: searchText,
          searchScope: 'ANYONE',
          timing: null,
          attributes: null,
          negative: false,
          applyStemming: false,
        },
      ],
    };
  }
  if (params.sortField && params.sortField !== 'date') {
    searchJson.sort = [
      {
        type: 'ByField',
        name: params.sortField,
        ascending: params.sortAscending ?? false,
      },
    ];
  } else if (params.sortField === 'date' && params.sortAscending === true) {
    // Date descending is the default; only send sort when ascending
    searchJson.sort = [
      { type: 'ByField', name: 'callStartTime', ascending: true },
    ];
  }

  const body: Record<string, unknown> = {
    pageSize,
    callsOffset: offset,
    callsSearchJson: JSON.stringify(searchJson),
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: gongHeaders(csrf),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    numOfTotalItemsContainingSearchTerm: number;
    numOfTotalItemsThatPassedFilter: number;
    items: Array<{
      id: string;
      userTimezoneActivityTime: string;
      duration: number;
      language?: string;
      isPrivate?: boolean;
      participants: Array<{
        appUserId: string | null;
        name: string;
        email?: string;
        title?: string;
        affiliation: string;
      }>;
      topics?: Array<{ name: string; coveragePercent: number }>;
      [key: string]: unknown;
    }>;
  };

  const calls = (data.items ?? []).map((item) => ({
    id: String(item.id),
    title: ((item as Record<string, unknown>).title as string) ?? '',
    activityTime: item.userTimezoneActivityTime,
    duration: item.duration,
    language: item.language,
    participants: (item.participants ?? []).map((p) => ({
      id: p.appUserId,
      name: p.name,
      email: p.email,
      title: p.title,
      affiliation: p.affiliation as 'COMPANY' | 'NON_COMPANY',
    })),
    topics: (item.topics ?? []).map((t) => ({
      name: t.name,
      coveragePercent: t.coveragePercent,
    })),
    isPrivate: item.isPrivate,
  }));

  return {
    calls,
    totalCount: data.numOfTotalItemsContainingSearchTerm,
    filteredCount: data.numOfTotalItemsThatPassedFilter,
  };
}

// ============================================================================
// getCallTranscript
// ============================================================================

export async function getCallTranscript(
  params: GetCallTranscriptInput,
): Promise<GetCallTranscriptOutput> {
  const { callId, language } = params;

  let url = `/call/detailed-transcript?call-id=${callId}`;
  if (language) {
    url += `&language=${encodeURIComponent(language)}`;
  }
  const resp = await fetch(url, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json; charset=utf-8',
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    callId: string;
    callTitle: string;
    callCustomers: string;
    callOrganizerName?: string;
    callMeetingProvider?: string;
    durationHours?: number;
    durationMinutes?: number;
    monologues: Array<{
      speakerId: string;
      speakerName: string;
      text: string;
      timestamp: number;
      timestampStr: string;
      startingTopic: string | null;
      endingTopic: string | null;
    }>;
    topics: Array<{
      name: string;
      start: string;
      firstOfTopic: boolean;
    }>;
    companyParticipants: Array<{
      fullName: string;
      companyName?: string;
      title?: string;
    }>;
    customerParticipants: Record<
      string,
      Array<{ fullName: string; companyName?: string; title?: string }>
    >;
    unknownParticipants?: Array<{
      fullName: string;
      companyName?: string;
      title?: string;
    }>;
    language?: string;
    languageDisplayName?: string;
    canBeTranslated?: boolean;
    isInHouseTranscript?: boolean;
    translationDetails?: {
      originalLanguage: string;
      originalLanguageDisplayName: string;
      targetLanguage: string;
      targetLanguageDisplayName: string;
      translationSucceeded: boolean;
      isTranslatedByDefault: boolean;
    } | null;
  };

  // Flatten customerParticipants from Record<companyName, participant[]> to flat array
  const customerList: Array<{
    fullName: string;
    companyName?: string;
    title?: string;
  }> = [];
  for (const participants of Object.values(data.customerParticipants ?? {})) {
    for (const p of participants) {
      customerList.push(p);
    }
  }

  return {
    callId, // Use input param: raw response has unquoted numeric callId that loses precision in JSON.parse
    callTitle: data.callTitle,
    callCustomers: data.callCustomers,
    callOrganizerName: data.callOrganizerName,
    callMeetingProvider: data.callMeetingProvider,
    durationMinutes: data.durationMinutes,
    durationHours: data.durationHours,
    monologues: (data.monologues ?? []).map((m) => ({
      speakerId: String(m.speakerId),
      speakerName: m.speakerName,
      text: m.text,
      timestamp: m.timestamp,
      timestampStr: m.timestampStr,
      startingTopic: m.startingTopic,
      endingTopic: m.endingTopic,
    })),
    topics: (data.topics ?? [])
      .filter((t) => t.firstOfTopic)
      .map((t) => ({
        name: t.name,
        start: t.start,
      })),
    companyParticipants: (data.companyParticipants ?? []).map((p) => ({
      fullName: p.fullName,
      companyName: p.companyName,
      title: p.title,
    })),
    customerParticipants: customerList.map((p) => ({
      fullName: p.fullName,
      companyName: p.companyName,
      title: p.title,
    })),
    unknownParticipants: data.unknownParticipants?.length
      ? data.unknownParticipants.map((p) => ({
          fullName: p.fullName,
          companyName: p.companyName,
          title: p.title,
        }))
      : undefined,
    language: data.language,
    languageDisplayName: data.languageDisplayName,
    canBeTranslated: data.canBeTranslated,
    isInHouseTranscript: data.isInHouseTranscript,
    translationDetails: data.translationDetails
      ? {
          originalLanguage: data.translationDetails.originalLanguage,
          originalLanguageDisplayName:
            data.translationDetails.originalLanguageDisplayName,
          targetLanguage: data.translationDetails.targetLanguage,
          targetLanguageDisplayName:
            data.translationDetails.targetLanguageDisplayName,
          translationSucceeded: data.translationDetails.translationSucceeded,
          isTranslatedByDefault: data.translationDetails.isTranslatedByDefault,
        }
      : undefined,
  };
}

// ============================================================================
// askCallQuestion
// ============================================================================

export async function askCallQuestion(
  params: AskCallQuestionInput,
): Promise<AskCallQuestionOutput> {
  const { callId, question, externalCallToken } = params;

  if (!callId) {
    throw new Validation('askCallQuestion: callId is required');
  }
  if (!question) {
    throw new Validation('askCallQuestion: question is required');
  }

  const csrf = await fetchCsrf();

  // Ask the question via v2 endpoint (chat-style messages array)
  const tkn = externalCallToken ?? '';
  const askUrl = `/ajax/ask-me-anything/get-and-store-answer-v2?call-id=${callId}&tkn=${encodeURIComponent(tkn)}`;
  const askResp = await fetch(askUrl, {
    method: 'POST',
    headers: gongHeaders(csrf),
    body: JSON.stringify([{ role: 'user', content: question }]),
  });

  if (!askResp.ok) {
    const body = await askResp.text().catch(() => undefined);
    throwForStatus(askResp.status, body);
  }

  const result = (await askResp.json()) as {
    questionId: string;
    status?: string;
    questions: Array<{
      id: string;
      question: string;
      answer?: string;
      answerHtml?: string;
      hash?: string;
      evidenceMonologuesStartTime?: number[];
    }>;
  };

  const latest = result.questions?.find((q) => q.id === result.questionId);

  // Get suggested questions and recent questions from get-call-data
  const dataUrl = `/ajax/ask-me-anything/get-call-data?call-id=${callId}&tkn=${encodeURIComponent(tkn)}`;
  const dataResp = await fetch(dataUrl, {
    headers: gongHeaders(csrf),
  });

  let suggestedQuestions: string[] | undefined;
  let recentQuestions: Array<{ hash: string; question: string }> | undefined;
  if (dataResp.ok) {
    const data = (await dataResp.json()) as {
      suggestedQuestions?: string[];
      recentQuestions?: Array<{ hash: string; question: string }>;
    };
    suggestedQuestions = data.suggestedQuestions;
    recentQuestions = data.recentQuestions?.length
      ? data.recentQuestions.map((q) => ({
          hash: q.hash,
          question: q.question,
        }))
      : undefined;
  }

  return {
    answer: latest?.answer ?? '',
    answerHtml: latest?.answerHtml ?? undefined,
    status: (result.status as AskCallQuestionOutput['status']) ?? undefined,
    questionId: result.questionId ?? undefined,
    hash: latest?.hash ?? undefined,
    evidenceTimestamps: latest?.evidenceMonologuesStartTime,
    suggestedQuestions,
    recentQuestions,
  };
}

// ============================================================================
// getCall
// ============================================================================

const GET_HEADERS = {
  'X-Requested-With': 'XMLHttpRequest',
  Accept: 'application/json; charset=utf-8',
};

export async function getCall(params: GetCallInput): Promise<GetCallOutput> {
  const { callId, language, shouldRegenerate } = params;

  let transcriptUrl = `/call/detailed-transcript?call-id=${callId}`;
  if (language) {
    transcriptUrl += `&language=${encodeURIComponent(language)}`;
  }
  const regenerate = shouldRegenerate === true ? 'true' : 'false';
  const spotlightUrl = `/ajax/get-call-spotlight?call-id=${callId}&token=&should-regenerate=${regenerate}`;

  const [transcriptResp, spotlightResp] = await Promise.all([
    fetch(transcriptUrl, { headers: GET_HEADERS }),
    fetch(spotlightUrl, { headers: GET_HEADERS }),
  ]);

  if (!transcriptResp.ok) {
    const body = await transcriptResp.text().catch(() => undefined);
    throwForStatus(transcriptResp.status, body);
  }
  if (!spotlightResp.ok) {
    const body = await spotlightResp.text().catch(() => undefined);
    throwForStatus(spotlightResp.status, body);
  }

  const transcript = (await transcriptResp.json()) as {
    callId: string;
    callTitle: string;
    callCustomers: string;
    topics: Array<{ name: string; start: string; firstOfTopic: boolean }>;
    companyParticipants: Array<{
      fullName: string;
      companyName?: string;
      title?: string;
    }>;
    customerParticipants: Record<
      string,
      Array<{ fullName: string; companyName?: string; title?: string }>
    >;
    language?: string;
    translationDetails?: {
      originalLanguage: string;
      originalLanguageDisplayName: string;
      targetLanguage: string;
      targetLanguageDisplayName: string;
      translationSucceeded: boolean;
      isTranslatedByDefault: boolean;
    } | null;
  };

  const spotlight = (await spotlightResp.json()) as {
    status: string;
    callHighlights?: {
      brief?: string;
      generatedTitle?: string;
      keypoints?: {
        highlights: Array<{ text: string; monologueStartTime: number }>;
      };
      highlights?: Array<{
        type: string;
        highlights: Array<{ text: string; monologueStartTime: number }>;
      }>;
    };
  };

  const companyParticipants = (transcript.companyParticipants ?? []).map(
    (p) => ({
      fullName: p.fullName,
      companyName: p.companyName,
      title: p.title,
      affiliation: 'COMPANY' as const,
    }),
  );

  const customerParticipants: Array<{
    fullName: string;
    companyName?: string;
    title?: string;
    affiliation: 'NON_COMPANY';
  }> = [];
  for (const group of Object.values(transcript.customerParticipants ?? {})) {
    for (const p of group) {
      customerParticipants.push({
        fullName: p.fullName,
        companyName: p.companyName,
        title: p.title,
        affiliation: 'NON_COMPANY',
      });
    }
  }

  const ch = spotlight.callHighlights;

  const nextStepsSection = ch?.highlights?.find((h) => h.type === 'NEXT_STEPS');
  const actionItems = (nextStepsSection?.highlights ?? []).map((h) => ({
    text: h.text,
    monologueStartTime: h.monologueStartTime,
  }));

  const keyPoints = (ch?.keypoints?.highlights ?? []).map((h) => ({
    text: h.text,
    monologueStartTime: h.monologueStartTime,
  }));

  return {
    callId, // Use input param: raw response has unquoted numeric callId that loses precision in JSON.parse
    title: transcript.callTitle,
    callCustomers: transcript.callCustomers,
    participants: [...companyParticipants, ...customerParticipants],
    topics: (transcript.topics ?? [])
      .filter((t) => t.firstOfTopic)
      .map((t) => ({ name: t.name, start: t.start })),
    aiSummary: ch?.brief ?? undefined,
    generatedTitle: ch?.generatedTitle ?? undefined,
    actionItems,
    keyPoints,
    language: transcript.language,
    translationDetails: transcript.translationDetails
      ? {
          originalLanguage: transcript.translationDetails.originalLanguage,
          originalLanguageDisplayName:
            transcript.translationDetails.originalLanguageDisplayName,
          targetLanguage: transcript.translationDetails.targetLanguage,
          targetLanguageDisplayName:
            transcript.translationDetails.targetLanguageDisplayName,
          translationSucceeded:
            transcript.translationDetails.translationSucceeded,
          isTranslatedByDefault:
            transcript.translationDetails.isTranslatedByDefault,
        }
      : undefined,
  };
}

// ============================================================================
// getCallSpotlight
// ============================================================================

export async function getCallSpotlight(
  params: GetCallSpotlightInput,
): Promise<GetCallSpotlightOutput> {
  const { callId, shouldRegenerate, externalCallToken } = params;

  const regenerate = shouldRegenerate === true ? 'true' : 'false';
  const tkn = externalCallToken ?? '';
  const url = `/ajax/get-call-spotlight?call-id=${callId}&token=${encodeURIComponent(tkn)}&should-regenerate=${regenerate}`;
  const resp = await fetch(url, { headers: GET_HEADERS });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    status: string;
    language?: string;
    callHighlights?: {
      brief?: string;
      generatedTitle?: string;
      notes?: Array<{ text: string; monologueStartTime: number }>;
      keypoints?: {
        highlights: Array<{ text: string; monologueStartTime: number }>;
      };
      highlights?: Array<{
        type: string;
        highlights: Array<{ text: string; monologueStartTime: number }>;
      }>;
      quickRead?: {
        chapters: Array<{
          title: string;
          startTime: number;
          duration: number;
          highlights: Array<{ text: string; monologueStartTime: number }>;
        }>;
      };
    };
  };

  if (!data.callHighlights) {
    throw new ContractDrift(
      `getCallSpotlight: spotlight not available (status: ${data.status}). URL: ${url}`,
    );
  }

  const ch = data.callHighlights;
  const nextStepsSection = (ch.highlights ?? []).find(
    (h) => h.type === 'NEXT_STEPS',
  );

  return {
    status: data.status,
    brief: ch.brief,
    generatedTitle: ch.generatedTitle,
    notes: (ch.notes ?? []).map((n) => ({
      text: n.text,
      monologueStartTime: n.monologueStartTime,
    })),
    keyPoints: (ch.keypoints?.highlights ?? []).map((h) => ({
      text: h.text,
      monologueStartTime: h.monologueStartTime,
    })),
    nextSteps: (nextStepsSection?.highlights ?? []).map((h) => ({
      text: h.text,
      monologueStartTime: h.monologueStartTime,
    })),
    chapters: (ch.quickRead?.chapters ?? []).map((c) => ({
      title: c.title,
      startTime: c.startTime,
      duration: c.duration,
      highlights: (c.highlights ?? []).map((h) => ({
        text: h.text,
        monologueStartTime: h.monologueStartTime,
      })),
    })),
    language: data.language,
  };
}

// ============================================================================
// listAccounts
// ============================================================================

export async function listAccounts(
  params: ListAccountsInput,
): Promise<ListAccountsOutput> {
  const { searchText, sortField, sortFieldType, sortDirection } = params;
  const csrf = await fetchCsrf();
  const workspaceId = getWorkspaceId();

  const searchParam = searchText
    ? `&search-keyword=${encodeURIComponent(searchText)}`
    : '';
  const url = `/engagewebapi/ajax/filter-accounts?workspace-id=${workspaceId}${searchParam}&page-number=1`;

  const sort: Record<string, unknown> = {
    fieldName: sortField ?? 'LastActivityDate',
    crmObjectType: 'ACCOUNT',
    direction: sortDirection ?? 'ASC',
  };
  if (sortFieldType) {
    sort.fieldType = sortFieldType;
  }

  const body = {
    filter: { type: 'and' as const, operands: [] as unknown[] },
    sort,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: gongHeaders(csrf),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    filteredCrmObjectsList: Array<{
      companyName: string;
      companyIdentifier?: string;
      crmAccount?: {
        crmId?: string;
        gongId?: string;
        crmObjectPageUrl?: string;
      };
      ownerFullName?: string | null;
      website?: string;
      createdDate?: string | null;
    }>;
    totalAccountsNumber?: string;
  };

  const accounts = (data.filteredCrmObjectsList ?? []).map((item) => ({
    companyName: item.companyName,
    companyIdentifier: item.companyIdentifier || undefined,
    gongId: item.crmAccount?.gongId,
    crmId: item.crmAccount?.crmId,
    crmObjectPageUrl: item.crmAccount?.crmObjectPageUrl,
    ownerFullName: item.ownerFullName || undefined,
    website: item.website || undefined,
    createdDate: item.createdDate || undefined,
  }));

  const totalCount = data.totalAccountsNumber
    ? parseInt(data.totalAccountsNumber, 10)
    : accounts.length;

  return { accounts, totalCount };
}

// ============================================================================
// getAccount
// ============================================================================

export async function getAccount(
  params: GetAccountInput,
): Promise<GetAccountOutput | null> {
  const { accountName, accountCrmId, sortField, sortDirection } = params;
  const workspaceId = getWorkspaceId();

  // Direct lookup by CRM ID via dedicated endpoint
  if (accountCrmId) {
    const url = `/engagewebapi/ajax/prospecting/account?workspace-id=${workspaceId}&account-crm-id=${encodeURIComponent(accountCrmId)}`;
    const resp = await fetch(url, { headers: GET_HEADERS });

    if (!resp.ok) {
      const body = await resp.text().catch(() => undefined);
      throwForStatus(resp.status, body);
    }

    const match = (await resp.json()) as {
      companyName: string | null;
      companyIdentifier?: string | null;
      crmAccount?: {
        crmId?: string;
        gongId?: string;
        crmObjectPageUrl?: string;
      } | null;
      createdDate?: string | null;
      ownerFullName?: string | null;
      website?: string | null;
    };

    if (!match.companyName) {
      return null;
    }

    return {
      companyName: match.companyName,
      companyIdentifier: match.companyIdentifier || undefined,
      gongId: match.crmAccount?.gongId,
      crmId: match.crmAccount?.crmId,
      crmObjectPageUrl: match.crmAccount?.crmObjectPageUrl,
      createdDate: match.createdDate || undefined,
      ownerFullName: match.ownerFullName || undefined,
      website: match.website || undefined,
    };
  }

  // Name search via filter-accounts endpoint
  if (!accountName) {
    throw new Validation(
      'getAccount: either accountName or accountCrmId must be provided.',
    );
  }

  const csrf = await fetchCsrf();
  const url = `/engagewebapi/ajax/filter-accounts?workspace-id=${workspaceId}&search-keyword=${encodeURIComponent(accountName)}&page-number=1`;
  const body = {
    filter: { type: 'and', operands: [] },
    sort: {
      fieldName: sortField ?? 'ACCOUNT_NAME',
      crmObjectType: 'ACCOUNT',
      direction: sortDirection ?? 'ASC',
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: gongHeaders(csrf),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    filteredCrmObjectsList: Array<{
      companyName: string;
      companyIdentifier?: string;
      crmAccount?: {
        crmId?: string;
        gongId?: string;
        crmObjectPageUrl?: string;
      };
      createdDate?: string | null;
      ownerFullName?: string | null;
      website?: string;
    }>;
  };

  const accounts = data.filteredCrmObjectsList ?? [];
  const needle = accountName.toLowerCase();
  const match =
    accounts.find((a) => a.companyName.toLowerCase() === needle) ??
    accounts.find((a) => a.companyName.toLowerCase().includes(needle));

  if (!match) {
    return null;
  }

  return {
    companyName: match.companyName,
    companyIdentifier: match.companyIdentifier || undefined,
    gongId: match.crmAccount?.gongId,
    crmId: match.crmAccount?.crmId,
    crmObjectPageUrl: match.crmAccount?.crmObjectPageUrl,
    createdDate: match.createdDate || undefined,
    ownerFullName: match.ownerFullName || undefined,
    website: match.website || undefined,
  };
}

// ============================================================================
// listPeople
// ============================================================================

export async function listPeople(
  params: ListPeopleInput,
): Promise<ListPeopleOutput> {
  const {
    searchText,
    entityType = 'contact',
    pageNumber = 1,
    pageSize = 100,
    sortField,
    sortDirection,
    flowName,
  } = params;
  const csrf = await fetchCsrf();
  const workspaceId = getWorkspaceId();

  const searchParam = searchText
    ? `&search-keyword=${encodeURIComponent(searchText)}`
    : '';
  const url = `/engagewebapi/ajax/filter-people?workspace-id=${workspaceId}&page-number=${pageNumber}&page-size=${pageSize}${searchParam}`;

  const assigneeFieldId =
    entityType === 'lead'
      ? 'user.gong_LeadAssignee'
      : 'user.gong_AccountAssignee';

  const filterOperands: Array<Record<string, unknown>> = [
    {
      type: 'filter',
      operator: 'equals',
      values: [],
      fieldRef: { type: 'entity-field', fieldId: assigneeFieldId },
    },
  ];

  if (flowName) {
    filterOperands.push({
      type: 'filter',
      operator: 'equals',
      values: [{ type: 'constant', value: flowName, valueType: 'string' }],
      fieldRef: { type: 'entity-field', fieldId: 'flow.gong_FlowName' },
      sticky: false,
    });
  }

  const engageGQLFilterRequest: Record<string, unknown> = {
    filter: {
      type: 'and',
      operands: filterOperands,
    },
  };
  if (sortField) {
    engageGQLFilterRequest.sort = {
      fieldName: sortField,
      crmObjectType: entityType === 'lead' ? 'LEAD' : 'CONTACT',
      direction: sortDirection ?? 'DESC',
    };
  }

  const body = {
    engageGQLFilterRequest,
    requestedFields: {},
    entityType,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: gongHeaders(csrf),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    filteredCrmObjectsList: Array<{
      name?: string;
      firstName?: string;
      lastName?: string;
      emails?: string[];
      title?: string;
      imageUrl?: string;
      crmId?: string;
      crmType?: string;
      gongId?: string;
      timezone?: string;
      city?: string;
      state?: string;
      country?: string;
      companyName?: string;
      linkedInUrl?: string;
      crmUrl?: string;
      crmAccountId?: string;
      gongAccountId?: string;
      isLead?: boolean;
      personPhoneNumbers?: Array<{
        raw?: string;
        normalized?: string;
        extension?: string;
        country_code?: number;
        label?: string | null;
      }>;
    }>;
    totalCount?: number | string;
    pageNumber?: number;
    pageSize?: number;
  };

  const people = (data.filteredCrmObjectsList ?? []).map((item) => {
    const name =
      item.name ?? [item.firstName, item.lastName].filter(Boolean).join(' ');
    const phoneNumbers = (item.personPhoneNumbers ?? [])
      .map((p) => p.normalized || p.raw || '')
      .filter(Boolean);
    return {
      name: name || '',
      firstName: item.firstName || undefined,
      lastName: item.lastName || undefined,
      emails: item.emails ?? [],
      title: item.title || undefined,
      gongId: item.gongId || undefined,
      crmId: item.crmId || undefined,
      crmType: item.crmType || undefined,
      crmUrl: item.crmUrl || undefined,
      timezone: item.timezone || undefined,
      city: item.city || undefined,
      state: item.state || undefined,
      country: item.country || undefined,
      companyName: item.companyName || undefined,
      linkedInUrl: item.linkedInUrl || undefined,
      crmAccountId: item.crmAccountId || undefined,
      gongAccountId: item.gongAccountId || undefined,
      isLead: item.isLead,
      imageUrl: item.imageUrl || undefined,
      phoneNumbers: phoneNumbers.length ? phoneNumbers : undefined,
    };
  });

  // Server returns totalCount: "0" when search-keyword is used, even if results exist.
  // Fall back to people.length when totalCount is 0 but we have results.
  const rawTotalCount =
    data.totalCount != null
      ? typeof data.totalCount === 'string'
        ? parseInt(data.totalCount, 10)
        : data.totalCount
      : people.length;
  const totalCount =
    rawTotalCount === 0 && people.length > 0 ? people.length : rawTotalCount;

  return {
    people,
    totalCount,
    pageNumber: data.pageNumber ?? pageNumber,
    pageSize: data.pageSize ?? pageSize,
  };
}

// ============================================================================
// listUsers
// ============================================================================

export async function listUsers(
  _params: ListUsersInput,
): Promise<ListUsersOutput> {
  const workspaceId = getWorkspaceId();

  const url = `/engagewebapi/ajax/engage/users?workspace-id=${workspaceId}`;
  const resp = await fetch(url, { headers: GET_HEADERS });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    users: Array<{
      appUserId: string;
      managerId?: string | null;
      emailAddress: string;
      firstName: string;
      lastName: string;
      title?: string | null;
      companyID?: string | null;
      companyName?: string | null;
      active: boolean;
      manager?: boolean;
      permitted?: boolean | null;
      imageUrl?: string | null;
    }>;
  };

  return {
    users: (data.users ?? []).map((u) => ({
      appUserId: String(u.appUserId),
      managerId:
        u.managerId && u.managerId !== '0' ? String(u.managerId) : undefined,
      emailAddress: u.emailAddress,
      firstName: u.firstName,
      lastName: u.lastName,
      title: u.title || undefined,
      companyID: u.companyID ? String(u.companyID) : undefined,
      companyName: u.companyName || undefined,
      active: u.active,
      manager: u.manager,
      permitted: u.permitted ?? undefined,
      imageUrl: u.imageUrl || undefined,
    })),
  };
}

// ============================================================================
// listDeals
// ============================================================================

export async function listDeals(
  params: ListDealsInput,
): Promise<ListDealsOutput> {
  const {
    period = 'CLOSING_THIS_QUARTER',
    sortField = 'DealActivity',
    sortOrder = 'DESC',
    pageSize = 200,
    pageFrom = 0,
    viewingCurrency = 'USD',
    activeDealsRollupTabIndex = 0,
  } = params;
  const csrf = await fetchCsrf();
  const workspaceId = getWorkspaceId();

  let boardId = params.boardId;
  let boardName = '';

  if (!boardId) {
    const boardsUrl = `/dealswebapi/ajax/deals/user-boards?workspace-id=${workspaceId}`;
    const boardsResp = await fetch(boardsUrl, {
      headers: gongHeaders(csrf),
    });
    if (!boardsResp.ok) {
      const body = await boardsResp.text().catch(() => undefined);
      throwForStatus(boardsResp.status, body);
    }
    const boardsData = (await boardsResp.json()) as {
      allBoards: Array<{ id: string; name: string; [key: string]: unknown }>;
    };
    if (!boardsData.allBoards?.length) {
      throw new ContractDrift(`listDeals: no boards found. URL: ${boardsUrl}`);
    }
    boardId = boardsData.allBoards[0].id;
    boardName = boardsData.allBoards[0].name;
  }

  // Extract userId from CSRF JWT to populate owner filter
  const parts = csrf.split('.');
  let userId = '';
  if (parts.length === 3) {
    const payload = JSON.parse(atob(parts[1])) as { userId?: string };
    userId = payload.userId ?? '';
  }

  const currency = encodeURIComponent(viewingCurrency);
  const dealsUrl = `/dealswebapi/ajax/deals/get-board-deals?viewing-currency=${currency}&workspace-id=${workspaceId}&board-id=${boardId}`;
  const dealsBody = {
    dealQueryOverrides: {
      ownerFilter: { userIds: userId ? [userId] : [], teamIds: [] },
      closeDateFilter: { period },
      warningsFilter: [],
      managerContextFilter: [],
      territoryIds: [],
      sortByField: {
        field: { type: 'RegularField', name: sortField },
        order: sortOrder,
      },
      activeDealsRollupTabIndex,
      additionalFields: [],
      accountId: null,
      pagination: { size: pageSize, from: pageFrom },
    },
    reportFilterRequest: null,
  };

  const dealsResp = await fetch(dealsUrl, {
    method: 'POST',
    headers: gongHeaders(csrf),
    body: JSON.stringify(dealsBody),
  });
  if (!dealsResp.ok) {
    const body = await dealsResp.text().catch(() => undefined);
    throwForStatus(dealsResp.status, body);
  }

  const dealsData = (await dealsResp.json()) as {
    dealList: Array<{
      dealId: string;
      dealName: string;
      dealValue: number | null;
      stage: string;
      closeDate: { y: number; m: number; d: number } | null;
      accountName: string | null;
      accountId: string | null;
      ownerAppuserId: string | null;
      crmId: string | null;
      urlToCrm: string | null;
      status: string | null;
      probability: number | null;
    }>;
    boardName: string;
    totals: {
      totalCount: number;
      totalValue: number;
    };
  };

  const deals = (dealsData.dealList ?? []).map((d) => {
    let closeDateStr: string | null = null;
    if (d.closeDate) {
      const cd = d.closeDate;
      closeDateStr = `${cd.y}-${String(cd.m + 1).padStart(2, '0')}-${String(cd.d).padStart(2, '0')}`;
    }
    return {
      id: String(d.dealId),
      name: d.dealName,
      amount: d.dealValue ?? null,
      stage: d.stage,
      closeDate: closeDateStr,
      accountName: d.accountName ?? null,
      accountId: d.accountId ? String(d.accountId) : null,
      ownerId: d.ownerAppuserId ? String(d.ownerAppuserId) : null,
      crmId: d.crmId || undefined,
      urlToCrm: d.urlToCrm || undefined,
      status: d.status || undefined,
      probability: d.probability ?? undefined,
    };
  });

  return {
    boardId,
    boardName: dealsData.boardName || boardName,
    deals,
    totalCount: dealsData.totals?.totalCount ?? deals.length,
  };
}

// ============================================================================
// getDealActivities
// ============================================================================

export async function getDealActivities(
  params: GetDealActivitiesInput,
): Promise<GetDealActivitiesOutput> {
  const { dealId, pageSize } = params;
  const workspaceId = getWorkspaceId();

  let url = `/engagewebapi/ajax/ae-home/get-activities-by-deal?workspace-id=${workspaceId}&deal-id=${dealId}`;
  if (pageSize != null) {
    url += `&page-size=${pageSize}`;
  }
  const resp = await fetch(url, { headers: GET_HEADERS });
  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    pagination: { totalNew: number | string; totalFound: number | string };
    activities: Array<{
      activityType: string;
      activityDirection: string | null;
      activityDateTime: {
        es: number;
        t: string;
        z: string;
        [key: string]: unknown;
      };
      activityId: string;
      activityTitle: string | null;
      activitySubTitle?: string;
      dealId?: string;
      dealAmount?: number | null;
      accountId?: string;
      fromDisplayName?: string;
      fromTitle?: string | null;
      isNew?: boolean;
      dealName?: string;
      accountName?: string;
    }>;
  };

  const activities = (data.activities ?? []).map((a) => {
    const dt = a.activityDateTime;
    return {
      activityType: a.activityType,
      activityDirection: a.activityDirection ?? null,
      activityDateTime: dt.z ? `${dt.t} ${dt.z}` : dt.t,
      activityDateEpoch: dt.es,
      activityId: String(a.activityId),
      activityTitle: a.activityTitle ?? null,
      activitySubTitle: a.activitySubTitle || undefined,
      dealId: a.dealId ? String(a.dealId) : undefined,
      dealAmount: a.dealAmount ?? undefined,
      accountId: a.accountId ? String(a.accountId) : undefined,
      fromDisplayName: a.fromDisplayName || undefined,
      fromTitle: a.fromTitle ?? undefined,
      isNew: a.isNew,
      dealName: a.dealName || undefined,
      accountName: a.accountName || undefined,
    };
  });

  const totalFound =
    typeof data.pagination?.totalFound === 'string'
      ? parseInt(data.pagination.totalFound, 10)
      : (data.pagination?.totalFound ?? activities.length);
  const totalNew =
    typeof data.pagination?.totalNew === 'string'
      ? parseInt(data.pagination.totalNew, 10)
      : (data.pagination?.totalNew ?? 0);

  return {
    activities,
    totalFound,
    totalNew,
  };
}

// ============================================================================
// getForecastBoards
// ============================================================================

export async function getForecastBoards(
  params: GetForecastBoardsInput,
): Promise<GetForecastBoardsOutput> {
  const workspaceId = getWorkspaceId();

  let url = `/forecastwebapi/deals/forecast/init?workspace-id=${workspaceId}`;
  if (params.forecastBoardId) {
    url += `&forecast-board-id=${encodeURIComponent(params.forecastBoardId)}`;
  }
  const resp = await fetch(url, { headers: GET_HEADERS });
  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const raw = (await resp.json()) as {
    data: {
      setup: {
        boardId: string;
        boardName: string;
        shadowBoardId: string | null;
        categories: Array<{
          id: string;
          label: string;
          index: number;
        }>;
        [key: string]: unknown;
      };
      selectedPeriod: {
        id: string;
        parentId?: string;
        type: string;
        value: number;
        year: number;
        fiscalYear: number;
        label: string;
        isCurrent?: boolean;
        isOver?: boolean;
      };
      periodOptions: Array<{
        id: string;
        parentId?: string;
        type: string;
        value: number;
        year: number;
        fiscalYear: number;
        label: string;
        isCurrent?: boolean;
        isOver?: boolean;
      }>;
      allBoards: Array<{
        boardId: string;
        boardName: string;
        shadowBoardId: string | null;
      }>;
    };
  };

  const setup = raw.data.setup;
  const selectedPeriod = raw.data.selectedPeriod;

  return {
    boardId: setup.boardId,
    boardName: setup.boardName,
    shadowBoardId: setup.shadowBoardId ?? null,
    periods: (raw.data.periodOptions ?? []).map((p) => ({
      id: String(p.id),
      parentId: p.parentId || undefined,
      type: p.type,
      value: p.value,
      year: p.year,
      fiscalYear: p.fiscalYear,
      label: p.label,
      isCurrent: p.isCurrent ?? undefined,
      isOver: p.isOver ?? undefined,
    })),
    currentPeriod: {
      id: String(selectedPeriod.id),
      parentId: selectedPeriod.parentId || undefined,
      type: selectedPeriod.type,
      value: selectedPeriod.value,
      year: selectedPeriod.year,
      fiscalYear: selectedPeriod.fiscalYear,
      label: selectedPeriod.label,
      isCurrent: selectedPeriod.isCurrent ?? undefined,
      isOver: selectedPeriod.isOver ?? undefined,
    },
    forecastCategories: (setup.categories ?? []).map((c) => ({
      id: String(c.id),
      name: c.label,
      order: c.index,
    })),
    allBoards: (raw.data.allBoards ?? []).map((b) => ({
      boardId: String(b.boardId),
      boardName: b.boardName,
      shadowBoardId: b.shadowBoardId ? String(b.shadowBoardId) : null,
    })),
  };
}

// ============================================================================
// getForecast
// ============================================================================

export async function getForecast(
  params: GetForecastInput,
): Promise<GetForecastOutput> {
  if (!params.boardId) {
    throw new Validation(
      'getForecast: boardId is required. Call getForecastBoards first and pass the shadowBoardId as boardId.',
    );
  }
  const {
    boardId,
    period = 'CLOSING_THIS_QUARTER',
    closeDateFrom,
    closeDateTo,
    viewingCurrency = 'USD',
    sortField = 'DealActivity',
    sortOrder = 'DESC',
    activeDealsRollupTabIndex = 0,
    paginationSize = 200,
    paginationFrom = 0,
    ownerUserIds,
    ownerTeamIds,
    accountId,
    territoryIds,
    adHocFilters,
  } = params;
  const csrf = await fetchCsrf();
  const workspaceId = getWorkspaceId();

  // Determine owner filter: explicit params override current-user default
  let resolvedUserIds: string[];
  let resolvedTeamIds: string[];
  if (ownerUserIds !== undefined || ownerTeamIds !== undefined) {
    resolvedUserIds = ownerUserIds ?? [];
    resolvedTeamIds = ownerTeamIds ?? [];
  } else {
    // Default: current user from CSRF JWT
    const jwtParts = csrf.split('.');
    let forecastUserId = '';
    if (jwtParts.length === 3) {
      const jwtPayload = JSON.parse(atob(jwtParts[1])) as { userId?: string };
      forecastUserId = jwtPayload.userId ?? '';
    }
    resolvedUserIds = forecastUserId ? [forecastUserId] : [];
    resolvedTeamIds = [];
  }

  const currency = encodeURIComponent(viewingCurrency);

  // Build closeDateFilter: include from/to when period is CLOSING_CUSTOM_RANGE
  const closeDateFilter: Record<string, string> = { period };
  if (period === 'CLOSING_CUSTOM_RANGE') {
    if (closeDateFrom) closeDateFilter.from = closeDateFrom;
    if (closeDateTo) closeDateFilter.to = closeDateTo;
  }

  const sharedOverrides: Record<string, unknown> = {
    ownerFilter: {
      userIds: resolvedUserIds,
      teamIds: resolvedTeamIds,
    },
    closeDateFilter,
    warningsFilter: [],
    managerContextFilter: [],
    accountId: accountId ?? null,
    territoryIds: territoryIds ?? [],
    additionalFields: [],
  };
  if (adHocFilters) {
    sharedOverrides.adHocFilters = adHocFilters;
  }

  const dealsBody = {
    dealQueryOverrides: {
      ...sharedOverrides,
      sortByField: {
        field: { type: 'RegularField', name: sortField },
        order: sortOrder,
      },
      activeDealsRollupTabIndex,
      pagination: { size: paginationSize, from: paginationFrom },
    },
    reportFilterRequest: null,
  };

  const totalsBody = {
    dealQueryOverrides: sharedOverrides,
  };

  const dealsUrl = `/dealswebapi/ajax/deals/get-board-deals?viewing-currency=${currency}&workspace-id=${workspaceId}&board-id=${boardId}`;
  const totalsUrl = `/dealswebapi/ajax/deals/get-board-totals?viewing-currency=${currency}&workspace-id=${workspaceId}&board-id=${boardId}`;

  const [dealsResp, totalsResp] = await Promise.all([
    fetch(dealsUrl, {
      method: 'POST',
      headers: gongHeaders(csrf),
      body: JSON.stringify(dealsBody),
    }),
    fetch(totalsUrl, {
      method: 'POST',
      headers: gongHeaders(csrf),
      body: JSON.stringify(totalsBody),
    }),
  ]);

  if (!dealsResp.ok) {
    const body = await dealsResp.text().catch(() => undefined);
    throwForStatus(dealsResp.status, body);
  }
  if (!totalsResp.ok) {
    const body = await totalsResp.text().catch(() => undefined);
    throwForStatus(totalsResp.status, body);
  }

  const dealsData = (await dealsResp.json()) as {
    dealList: Array<{
      dealId: string;
      dealName: string;
      dealValue: number | null;
      stage: string;
      closeDate: { y: number; m: number; d: number } | null;
      accountName: string | null;
      accountId: string | null;
      ownerAppuserId: string | null;
      crmId: string | null;
      urlToCrm: string | null;
      status: string | null;
      probability: number | null;
    }>;
    totals: {
      totalCount: number;
      totalValue: number;
    };
  };

  const totalsData = (await totalsResp.json()) as {
    data: {
      rollupTabs: Array<{
        index: number;
        label: string;
        type: string;
        totalAmountValue: number;
        totalCount: number;
        warningsAmountValue?: number;
        warningsCount?: number;
      }>;
    };
  };

  const deals = (dealsData.dealList ?? []).map((d) => {
    let closeDateStr: string | null = null;
    if (d.closeDate) {
      const cd = d.closeDate;
      closeDateStr = `${cd.y}-${String(cd.m + 1).padStart(2, '0')}-${String(cd.d).padStart(2, '0')}`;
    }
    return {
      id: String(d.dealId),
      name: d.dealName,
      amount: d.dealValue ?? null,
      stage: d.stage,
      closeDate: closeDateStr,
      accountName: d.accountName ?? null,
      accountId: d.accountId ? String(d.accountId) : null,
      ownerId: d.ownerAppuserId ? String(d.ownerAppuserId) : null,
      crmId: d.crmId || undefined,
      urlToCrm: d.urlToCrm || undefined,
      status: d.status || undefined,
      probability: d.probability ?? undefined,
    };
  });

  const rollupTabs = (totalsData.data?.rollupTabs ?? []).map((t) => ({
    index: t.index,
    label: t.label,
    type: t.type,
    totalAmountValue: t.totalAmountValue,
    totalCount: t.totalCount,
    warningsAmountValue: t.warningsAmountValue,
    warningsCount: t.warningsCount,
  }));

  const totalCount = dealsData.totals?.totalCount ?? deals.length;

  return {
    deals,
    rollupTabs,
    totalCount,
  };
}

// ============================================================================
// listFlows
// ============================================================================

export async function listFlows(
  params: ListFlowsInput,
): Promise<ListFlowsOutput> {
  const workspaceId = getWorkspaceId();
  const enabledOnly = params.getEnabledOnly === true ? 'true' : 'false';
  const url = `/engagewebapi/ajax/sequences/get-sequence-tree?workspace-id=${workspaceId}&get-enabled-only=${enabledOnly}`;

  const resp = await fetch(url, { headers: GET_HEADERS });
  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    items: Array<{
      id: string;
      name: string;
      createdBy: string;
      createdByFullName: string | null;
      lastUpdatedBy: string;
      lastUpdatedByFullName?: string | null;
      isDeleted: boolean;
      visibility: 'COMPANY' | 'PERSONAL';
      createDate: string;
      lastUpdateDate: string;
      folderId?: string | null;
      enabled?: boolean;
      hasAttachments?: boolean;
      description?: string | null;
      rulesetId?: string | null;
      includeUnsubscribeLink?: boolean;
      exclusive?: boolean;
      isOOBSequence?: boolean;
    }>;
    sequenceToUsageData?: Record<
      string,
      {
        currentUsage?: number;
        totalUsage?: number;
        completedCount?: number;
        totalSteps?: number;
        totalDays?: number;
      }
    >;
  };

  const usageData = data.sequenceToUsageData ?? {};

  const flows = (data.items ?? [])
    .filter((item) => !item.isDeleted)
    .map((item) => {
      const usage = usageData[item.id];
      return {
        id: String(item.id),
        name: item.name,
        createdBy: String(item.createdBy),
        createdByFullName: item.createdByFullName ?? null,
        lastUpdatedBy: String(item.lastUpdatedBy),
        lastUpdatedByFullName: item.lastUpdatedByFullName || undefined,
        visibility: item.visibility,
        createDate: item.createDate,
        lastUpdateDate: item.lastUpdateDate,
        folderId: item.folderId ? String(item.folderId) : undefined,
        enabled: item.enabled,
        hasAttachments: item.hasAttachments,
        description: item.description || undefined,
        rulesetId: item.rulesetId ? String(item.rulesetId) : undefined,
        includeUnsubscribeLink: item.includeUnsubscribeLink,
        exclusive: item.exclusive,
        isOOBSequence: item.isOOBSequence,
        currentUsage: usage?.currentUsage,
        totalUsage: usage?.totalUsage,
        completedCount: usage?.completedCount,
        totalSteps: usage?.totalSteps,
        totalDays: usage?.totalDays,
      };
    });

  return { flows };
}

// ============================================================================
// getTeamStats
// ============================================================================

export async function getTeamStats(
  params: GetTeamStatsInput,
): Promise<GetTeamStatsOutput> {
  const {
    metric,
    category = 'activity',
    teamLeaderId,
    dateRangeType = 'LAST_30_DAYS',
    from = '',
    to = '',
    callFilter = 'ALL_CALLS',
    withParticipant = false,
    groupingMode = 'ROLLUP',
  } = params;

  const csrf = await fetchCsrf();
  const workspaceId = getWorkspaceId();

  const nav = getNavigationProperties();
  const companyId =
    nav.impersonationSettings?.companyId ||
    (() => {
      const match = document.cookie.match(/ajs_group_id=([^;]+)/);
      if (!match) {
        throw new Unauthenticated(
          `getTeamStats: company ID not found. URL: ${window.location.href}`,
        );
      }
      return decodeURIComponent(match[1]);
    })();

  const body: Record<string, unknown> = {
    companyId,
    workspaceId,
    category,
    dateRangeType,
    from,
    to,
    callFilter,
    teamLeaderIds: [teamLeaderId],
    salesCoachOn: true,
    withParticipant,
    groupingMode,
    scorecardFilter: null,
  };

  const qp = `company-id=${companyId}&workspace-id=${workspaceId}&hierarchy-id=1`;
  const aggUrl = `/stats/ajax/v2/team/${category}/aggregated/${metric}?${qp}`;
  const usersUrl = `/stats/ajax/v2/team/${category}/users/${metric}?offset=0&limit=100&sorted-by=${metric}&sort-direction=DESC&${qp}`;

  const [aggResp, usersResp] = await Promise.all([
    fetch(aggUrl, {
      method: 'POST',
      headers: gongHeaders(csrf),
      body: JSON.stringify(body),
    }),
    fetch(usersUrl, {
      method: 'POST',
      headers: gongHeaders(csrf),
      body: JSON.stringify(body),
    }),
  ]);

  if (!aggResp.ok) {
    const body = await aggResp.text().catch(() => undefined);
    throwForStatus(aggResp.status, body);
  }
  if (!usersResp.ok) {
    const body = await usersResp.text().catch(() => undefined);
    throwForStatus(usersResp.status, body);
  }

  const agg = (await aggResp.json()) as {
    key: string;
    value: number | null;
    displayFormat: string | null;
    numberOfCalls: number | null;
    numberOfIgnoredCalls: number | null;
  };

  const users = (await usersResp.json()) as {
    perUserMetrics: Array<{
      id: string;
      userConcealed: boolean;
      value: number | null;
      displayFormat: string | null;
      numberOfCalls: number | null;
      noData: boolean;
    }>;
  };

  return {
    metric,
    value: agg.value,
    displayFormat: agg.displayFormat,
    numberOfCalls: agg.numberOfCalls,
    perUser: (users.perUserMetrics ?? []).map((u) => ({
      userId: String(u.id),
      value: u.value,
      displayFormat: u.displayFormat,
      numberOfCalls: u.numberOfCalls,
      noData: u.noData,
    })),
  };
}

// ============================================================================
// listSmartTrackers
// ============================================================================

export async function listSmartTrackers(
  params: ListSmartTrackersInput,
): Promise<ListSmartTrackersOutput> {
  const workspaceId = getWorkspaceId();

  // Runtime guard: Zod enum validation does not run in CDP context
  const rawType = (params as { trackerType?: unknown }).trackerType;
  const trackerTypeStr = rawType !== undefined ? String(rawType) : 'smart';
  if (trackerTypeStr !== 'smart' && trackerTypeStr !== 'keyword') {
    throw new Validation(
      `listSmartTrackers: invalid trackerType "${trackerTypeStr}". Must be "smart" or "keyword".`,
    );
  }
  const trackerType = trackerTypeStr as 'smart' | 'keyword';

  const filterName =
    trackerType === 'keyword' ? 'SearchTracker' : 'SearchSmartTracker';
  const url = `/conversations/ajax/picklist-filter-data?workspace-id=${workspaceId}&filter-name=${filterName}`;

  const resp = await fetch(url, { headers: GET_HEADERS });
  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    options: Array<{
      id: string;
      // Smart tracker fields
      title?: string;
      description?: string;
      smartTrackerType?: string;
      modelStatus?: string;
      searchScope?: string;
      enabledForEmails?: boolean;
      hidden?: boolean;
      createdBy?: string | null;
      createdByUserName?: string | null;
      appliedSince?: string;
      examples?: string[];
      modelId?: number;
      modelIntentInstructions?: {
        question: string;
        additionalContext: string | null;
        searchScope: string;
      };
      // Keyword tracker fields
      name?: string;
      definition?: Array<{
        language: string;
        applyStemming: boolean;
        phrases: string[];
      }>;
      scopes?: {
        searchScope?: string | null;
      };
      activityTypes?: Array<{
        activityType: string;
        enabled: boolean;
      }>;
    }>;
  };

  const options = data.options ?? [];

  if (trackerType === 'keyword') {
    return {
      smartTrackers: options.map((t) => {
        const phrases = (t.definition ?? []).flatMap((d) => d.phrases);
        return {
          id: String(t.id),
          title: t.name ?? '',
          description: phrases.length
            ? `Tracks phrases: ${phrases.slice(0, 5).join(', ')}${phrases.length > 5 ? ` (+${phrases.length - 5} more)` : ''}`
            : '',
          searchScope:
            (t.scopes?.searchScope as
              | 'ANYONE'
              | 'COMPANY'
              | 'NON_COMPANY'
              | undefined) ?? undefined,
          phrases,
          activityTypes: t.activityTypes?.length
            ? t.activityTypes.map((a) => ({
                activityType: a.activityType as 'CALL' | 'EMAIL',
                enabled: a.enabled,
              }))
            : undefined,
        };
      }),
    };
  }

  return {
    smartTrackers: options.map((t) => ({
      id: String(t.id),
      title: t.title ?? '',
      description: t.description ?? '',
      smartTrackerType: t.smartTrackerType,
      modelStatus: t.modelStatus as
        | 'PUBLISHED'
        | 'DRAFT'
        | 'TRAINING'
        | undefined,
      searchScope: t.searchScope as
        | 'ANYONE'
        | 'COMPANY'
        | 'NON_COMPANY'
        | undefined,
      enabledForEmails: t.enabledForEmails,
      hidden: t.hidden,
      createdBy: t.createdBy ?? null,
      createdByUserName: t.createdByUserName ?? null,
      appliedSince: t.appliedSince,
      examples: t.examples?.length ? t.examples : undefined,
      modelId: t.modelId,
      modelIntentInstructions: t.modelIntentInstructions
        ? {
            question: t.modelIntentInstructions.question,
            additionalContext: t.modelIntentInstructions.additionalContext,
            searchScope: t.modelIntentInstructions.searchScope as
              | 'ANYONE'
              | 'COMPANY'
              | 'NON_COMPANY',
          }
        : undefined,
    })),
  };
}
