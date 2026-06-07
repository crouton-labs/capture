/**
 * LinkedIn Connection Operations
 *
 * Managing connections, invitations, and mutual connections.
 */

import { linkedinFetch, searchViaGraphQL, searchViaRest } from '../helpers';
import { NotFound, ContractDrift, UpstreamError, Validation, throwForStatus } from '@vallum/_runtime';
import type {
  GetInvitationsSummaryOutput,
  GetMemberRelationshipOutput,
  ListConnectionRequestsOutput,
  ListInvitationsOutput,
  ListConnectionsOutput,
  ListSentConnectionRequestsOutput,
  SendConnectionRequestOutput,
  WithdrawConnectionRequestOutput,
} from '../schemas';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => {
  // 1-in-10 chance of a longer 4-second pause to appear more human
  if (Math.random() < 0.1) return 4000;
  return 500 + Math.floor(Math.random() * 1000);
};
const MAX_PAGE_SIZE = 10;

export async function listConnections(opts: {
  csrf: string;
  memberId?: string;
  keywords?: string;
  network?: ('F' | 'S')[];
  start?: number;
  count?: number;
}): Promise<ListConnectionsOutput> {
  const initialStart = opts.start ?? 0;
  const count = opts.count ?? 10;

  // Get current user's member ID from context (also provides csrf if not passed)
  const { getContext } = await import('../context.js');
  const currentUserContext = await getContext();
  const currentUserMemberId = currentUserContext.memberId;
  const csrf = opts.csrf || currentUserContext.csrf;

  const isOtherUser = !!opts.memberId && opts.memberId !== currentUserMemberId;

  // For current user's own connections: use the direct dash/connections endpoint
  // which is more reliable than the search-based approach (search can miss connections)
  if (!isOtherUser) {
    return listOwnConnectionsDirect(csrf, {
      keywords: opts.keywords,
      start: initialStart,
      count,
    });
  }

  // Resolve memberId: accepts ACo ID, vanity name, or full name
  let resolvedMemberId: string | undefined;
  let targetProfile:
    | { memberId: string; firstName?: string; lastName?: string }
    | undefined;

  const identifier = opts.memberId!.trim();

  if (identifier.startsWith('ACo')) {
    // ACo member ID; use directly
    resolvedMemberId = identifier;
    try {
      const resp = await linkedinFetch<{
        data?: { firstName?: string; lastName?: string };
      }>(csrf, `/voyager/api/identity/normalizedProfiles/${resolvedMemberId}`);
      targetProfile = {
        memberId: resolvedMemberId,
        firstName: resp.data?.firstName,
        lastName: resp.data?.lastName,
      };
    } catch {
      targetProfile = { memberId: resolvedMemberId };
    }
  } else if (!identifier.includes(' ') && /^[a-z0-9-]+$/i.test(identifier)) {
    // Vanity name (no spaces, URL-safe chars)
    const { getProfileByVanityName } = await import('../profiles/index.js');
    const profile = await getProfileByVanityName({
      csrf,
      vanityName: identifier,
    });
    resolvedMemberId = profile.memberId;
    targetProfile = {
      memberId: profile.memberId,
      firstName: profile.firstName,
      lastName: profile.lastName,
    };
  } else {
    // Full name; resolve via search
    const { searchPeople } = await import('../search/index.js');
    const searchResult = await searchPeople({
      csrf,
      keywords: identifier,
      network: ['F', 'S'],
      count: 5,
    });

    if (searchResult.results.length === 0) {
      throw new NotFound(
        `No person found for "${identifier}". Try a more specific name or use their memberId directly.`,
      );
    }

    const match = searchResult.results[0];
    if (!match.memberId) {
      throw new ContractDrift(
        `Found "${match.name}" but could not resolve their member ID.`,
      );
    }
    resolvedMemberId = match.memberId;
    const nameParts = (match.name ?? '').split(' ');
    targetProfile = {
      memberId: match.memberId,
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(' ') || undefined,
    };
  }

  // Default to both 1st and 2nd degree when browsing someone else's connections
  const networkFilter = opts.network ?? ['F', 'S'];
  // GraphQL required when browsing non-mutual connections (S in network filter);
  // the REST endpoint ignores the S filter and only returns mutual connections.
  const useGraphQL = networkFilter.includes('S');

  const queryParameters: Record<string, string[]> = {
    resultType: ['PEOPLE'],
    network: networkFilter,
  };
  queryParameters.connectionOf = [resolvedMemberId!];

  const searchFn = useGraphQL ? searchViaGraphQL : searchViaRest;

  // Single request if within server limit
  if (count <= MAX_PAGE_SIZE) {
    const parsed = await searchFn(csrf, {
      origin: 'MEMBER_PROFILE_CANNED_SEARCH',
      keywords: opts.keywords,
      queryParameters,
      start: initialStart,
      count,
    });

    return {
      ...(targetProfile ? { targetProfile } : {}),
      results: parsed.results,
      total: parsed.total,
      hasMore: parsed.total
        ? initialStart + parsed.results.length < parsed.total
        : parsed.results.length === count,
    };
  }

  // Auto-paginate for counts > 50
  const allResults: ListConnectionsOutput['results'] = [];
  let total: number | undefined;
  let start = initialStart;

  while (allResults.length < count) {
    const pageSize = Math.min(MAX_PAGE_SIZE, count - allResults.length);

    const page = await searchFn(csrf, {
      origin: 'MEMBER_PROFILE_CANNED_SEARCH',
      keywords: opts.keywords,
      queryParameters,
      start,
      count: pageSize,
    });

    if (total === undefined) {
      total = page.total;
    }

    if (page.results.length === 0) break;

    allResults.push(...page.results);
    start += pageSize;

    if (page.results.length < pageSize) break;
    if (total !== undefined && start >= total) break;
    if (allResults.length >= count) break;

    await sleep(jitter());
  }

  const results = allResults.slice(0, count);

  return {
    ...(targetProfile ? { targetProfile } : {}),
    results,
    total,
    hasMore: total ? initialStart + results.length < total : false,
  };
}

/**
 * List own connections using the direct dash/connections endpoint.
 * More reliable than search-based approach which can miss connections.
 *
 * Note: The dash/connections endpoint ignores the keywords parameter.
 * When keywords are provided, we use searchPeople with network:F filter instead.
 */
async function listOwnConnectionsDirect(
  csrf: string,
  opts: { keywords?: string; start: number; count: number },
): Promise<ListConnectionsOutput> {
  // The dash/connections endpoint ignores keywords; use searchPeople instead
  if (opts.keywords) {
    return listOwnConnectionsBySearch(
      csrf,
      opts as { keywords: string; start: number; count: number },
    );
  }

  interface DashConnectionsResponse {
    data?: {
      paging?: { total?: number; start?: number; count?: number };
      '*elements'?: string[];
    };
    included?: Array<{
      $type?: string;
      entityUrn?: string;
      firstName?: string;
      lastName?: string;
      publicIdentifier?: string;
      headline?: string | { text?: string };
    }>;
  }

  const decorationId =
    'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16';

  const allResults: ListConnectionsOutput['results'] = [];
  let total: number | undefined;
  let start = opts.start;
  const wanted = opts.count;

  while (allResults.length < wanted) {
    const pageSize = Math.min(MAX_PAGE_SIZE, wanted - allResults.length);
    const url = `/voyager/api/relationships/dash/connections?decorationId=${decorationId}&count=${pageSize}&q=search&sortType=RECENTLY_ADDED&start=${start}`;

    const resp = await linkedinFetch<DashConnectionsResponse>(csrf, url);

    if (total === undefined) {
      total = resp.data?.paging?.total;
    }

    const elementUrns = resp.data?.['*elements'] ?? [];
    if (elementUrns.length === 0) break;

    // Build entity map from included array
    const entityMap: Record<string, Record<string, unknown>> = {};
    if (resp.included) {
      for (const entity of resp.included) {
        if (entity.entityUrn) {
          entityMap[entity.entityUrn] = entity as Record<string, unknown>;
        }
      }
    }

    // Extract member IDs from connection URNs and resolve profiles
    for (const connUrn of elementUrns) {
      // connUrn format: urn:li:fsd_connection:ACoXXX
      const memberId = connUrn.split(':').pop();
      if (!memberId) continue;

      // Connection entity may have *connectedMember pointing to profile
      const connEntity = entityMap[connUrn] as
        | {
            '*connectedMember'?: string;
            '*connectedMemberResolutionResult'?: string;
            createdAt?: number;
          }
        | undefined;
      const profileUrn =
        connEntity?.['*connectedMemberResolutionResult'] ??
        connEntity?.['*connectedMember'] ??
        `urn:li:fsd_profile:${memberId}`;
      const profile = entityMap[profileUrn] as
        | {
            firstName?: string;
            lastName?: string;
            publicIdentifier?: string;
            headline?: string | { text?: string };
          }
        | undefined;

      if (!profile) continue;

      const name = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .join(' ');
      const vanityName = profile.publicIdentifier;
      const headline =
        typeof profile.headline === 'string'
          ? profile.headline
          : profile.headline?.text;

      const connectedAt = connEntity?.createdAt;
      let connectedDate: string | undefined;
      let connectedDaysAgo: number | undefined;
      if (connectedAt) {
        const d = new Date(connectedAt);
        connectedDate = d.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
        connectedDaysAgo = Math.floor(
          (Date.now() - connectedAt) / (1000 * 60 * 60 * 24),
        );
      }

      allResults.push({
        memberId,
        name: name || undefined,
        headline,
        vanityName,
        profileUrl: vanityName
          ? `https://www.linkedin.com/in/${vanityName}`
          : undefined,
        connectionDegree: '1st',
        connectedAt,
        connectedDate,
        connectedDaysAgo,
      });
    }

    start += pageSize;
    if (elementUrns.length < pageSize) break;
    if (total !== undefined && start >= total) break;
    if (allResults.length >= wanted) break;

    await sleep(jitter());
  }

  const results = allResults.slice(0, wanted);

  return {
    results,
    total,
    hasMore: total
      ? opts.start + results.length < total
      : results.length === wanted,
  };
}

/**
 * Search own connections by keywords using searchPeople with network:F filter.
 * Used when listOwnConnectionsDirect is called with keywords, since the
 * dash/connections endpoint ignores the keywords parameter.
 */
async function listOwnConnectionsBySearch(
  csrf: string,
  opts: { keywords: string; start: number; count: number },
): Promise<ListConnectionsOutput> {
  const { searchPeople } = await import('../search/index.js');
  const result = await searchPeople({
    csrf,
    keywords: opts.keywords,
    network: ['F'],
    start: opts.start,
    count: opts.count,
  });

  return {
    results: result.results,
    total: result.total,
    hasMore: result.total
      ? opts.start + result.results.length < result.total
      : result.results.length === opts.count,
  };
}

export async function getMemberRelationship(opts: {
  csrf: string;
  memberId: string;
}): Promise<GetMemberRelationshipOutput> {
  let memberId = opts.memberId;

  // Resolve vanity name to member ID if needed
  if (!opts.memberId.startsWith('ACo')) {
    const { getProfileByVanityName } = await import('../profiles/index.js');
    const profile = await getProfileByVanityName({
      csrf: opts.csrf,
      vanityName: opts.memberId,
    });
    memberId = profile.memberId;
  }

  interface MemberRelationshipResponse {
    data?: {
      memberRelationshipUnion?: {
        '*connection'?: string;
        noConnection?: {
          memberDistance?: string;
          invitationUnion?: {
            '*invitation'?: string;
            noInvitation?: unknown;
          };
        };
      };
    };
    included?: Array<{
      entityUrn?: string;
      invitationState?: string;
      invitationType?: string;
      sentTime?: number;
    }>;
  }

  const resp = await linkedinFetch<MemberRelationshipResponse>(
    opts.csrf,
    `/voyager/api/voyagerRelationshipsDashMemberRelationships/${encodeURIComponent(`urn:li:fsd_memberRelationship:${memberId}`)}`,
  );

  const union = resp.data?.memberRelationshipUnion;

  // Already connected (1st degree); field is a URN reference (*connection)
  if (union?.['*connection']) {
    return { memberId, status: 'connected' };
  }

  const noConn = union?.noConnection;
  const distance = noConn?.memberDistance;
  const invRef = noConn?.invitationUnion?.['*invitation'];

  if (invRef) {
    // Has an invitation reference; check direction
    const invitation = resp.included?.find((i) => i.entityUrn === invRef);
    if (invitation?.invitationState === 'PENDING') {
      const status =
        invitation.invitationType === 'SENT'
          ? 'pending_sent'
          : 'pending_received';
      return {
        memberId,
        status: status as 'pending_sent' | 'pending_received',
        invitationUrn: invitation.entityUrn,
        sentTime: invitation.sentTime,
        distance,
      };
    }
  }

  return { memberId, status: 'not_connected', distance };
}

export async function sendConnectionRequest(opts: {
  csrf: string;
  memberId: string;
  customMessage?: string;
}): Promise<SendConnectionRequestOutput> {
  if (!opts.memberId) {
    return {
      success: false,
      error: 'memberId is required; pass a memberId or vanity name',
    };
  }

  let memberId = opts.memberId;
  let recipientName = opts.memberId;

  // Resolve vanity name to member ID if needed
  if (!opts.memberId.startsWith('ACo') && !opts.memberId.startsWith('urn:')) {
    try {
      const { getProfileByVanityName } = await import('../profiles/index.js');
      const profile = await getProfileByVanityName({
        csrf: opts.csrf,
        vanityName: opts.memberId,
      });
      memberId = profile.memberId;
      recipientName =
        [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
        opts.memberId;
    } catch {
      return {
        success: false,
        error: `Could not find profile for: ${opts.memberId}`,
      };
    }
  }

  const recipientUrn = `urn:li:fsd_profile:${memberId}`;

  const body: {
    invitee: { inviteeUnion: { memberProfile: string } };
    customMessage?: string;
  } = {
    invitee: {
      inviteeUnion: {
        memberProfile: recipientUrn,
      },
    },
  };

  if (opts.customMessage) {
    body.customMessage = opts.customMessage.slice(0, 300);
  }

  try {
    interface ConnectionResponse {
      data?: {
        value?: {
          invitationUrn?: string;
          '*invitation'?: string;
        };
      };
    }

    const resp = await linkedinFetch<ConnectionResponse>(
      opts.csrf,
      '/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    return {
      success: true,
      recipient: recipientName,
      recipientUrn,
      invitationUrn:
        resp.data?.value?.invitationUrn ?? resp.data?.value?.['*invitation'],
    };
  } catch (e) {
    const error = e as Error;
    let errorMessage = error.message;

    if (errorMessage.includes('409')) {
      errorMessage = 'Connection request already pending or already connected';
    } else if (errorMessage.includes('403')) {
      errorMessage = 'Rate limited or permission denied. Try again later.';
    }

    return {
      success: false,
      recipient: recipientName,
      recipientUrn,
      error: errorMessage,
    };
  }
}

export async function getInvitationsSummary(opts: {
  csrf: string;
}): Promise<GetInvitationsSummaryOutput> {
  interface SummaryResponse {
    data?: {
      numNewInvitations?: number;
      numPendingInvitations?: number;
    };
  }

  const resp = await linkedinFetch<SummaryResponse>(
    opts.csrf,
    '/voyager/api/relationships/invitationsSummary',
  );

  return {
    numNewInvitations: resp.data?.numNewInvitations ?? 0,
    numPendingInvitations: resp.data?.numPendingInvitations ?? 0,
  };
}

export async function listConnectionRequests(opts: {
  csrf: string;
  start?: number;
  count?: number;
}): Promise<ListConnectionRequestsOutput> {
  const start = opts.start ?? 0;
  const count = opts.count ?? 20;

  interface InvitationResponse {
    data?: {
      '*elements'?: string[];
    };
    included?: Array<{
      entityUrn?: string;
      $type?: string;
      sharedSecret?: string;
      invitationType?: string;
      firstName?: string;
      lastName?: string;
      publicIdentifier?: string;
      '*invitation'?: string;
      '*fromMember'?: string;
      [key: string]: unknown;
    }>;
  }

  const resp = await linkedinFetch<InvitationResponse>(
    opts.csrf,
    `/voyager/api/relationships/invitationViews?includeInsights=true&q=receivedInvitation&start=${start}&count=${count}`,
  );

  // Build entity map from included array for reference resolution
  const entityMap: Record<string, Record<string, unknown>> = {};
  if (resp.included) {
    for (const entity of resp.included) {
      if (entity.entityUrn) {
        entityMap[entity.entityUrn] = entity;
      }
    }
  }

  // Resolve *elements URNs to InvitationView entities
  const elementUrns = resp.data?.['*elements'] ?? [];
  const invitations: ListConnectionRequestsOutput['invitations'] = [];

  for (const urn of elementUrns) {
    const element = entityMap[urn] as Record<string, unknown> | undefined;
    if (!element) continue;

    // Resolve the *invitation reference to the actual Invitation entity
    const invitationUrn = element['*invitation'] as string | undefined;
    if (!invitationUrn) continue;

    const invitation = entityMap[invitationUrn] as
      | Record<string, unknown>
      | undefined;
    if (!invitation) continue;

    // Filter to PENDING connection requests only (skip newsletters etc.)
    if (invitation.invitationType !== 'PENDING') continue;

    const sharedSecret = invitation.sharedSecret as string | undefined;
    if (!sharedSecret) continue;

    // Extract invitationId from the invitation entityUrn
    // e.g. "urn:li:fs_relInvitation:7425393995620540416" -> "7425393995620540416"
    const invEntityUrn = invitation.entityUrn as string | undefined;
    const invitationId = invEntityUrn?.split(':').pop();
    if (!invitationId) continue;

    // Resolve *fromMember on the invitation entity (not the element)
    const fromMemberUrn = invitation['*fromMember'] as string | undefined;
    let fromMemberId: string | undefined;
    let fromName = '';

    let vanityName: string | undefined;
    let headline: string | undefined;
    let profileUrl: string | undefined;

    if (fromMemberUrn) {
      const member = entityMap[fromMemberUrn] as
        | Record<string, unknown>
        | undefined;
      if (member) {
        // Extract memberId from miniProfile entityUrn
        // e.g. "urn:li:fs_miniProfile:ACoAABnp1bg..." -> "ACoAABnp1bg..."
        const memberEntityUrn = member.entityUrn as string | undefined;
        fromMemberId = memberEntityUrn?.split(':').pop();
        fromName = [member.firstName as string, member.lastName as string]
          .filter(Boolean)
          .join(' ');
        vanityName = member.publicIdentifier as string | undefined;
        const rawHeadline = member.headline;
        headline =
          typeof rawHeadline === 'string'
            ? rawHeadline
            : (rawHeadline as { text?: string } | undefined)?.text;
        if (vanityName) {
          profileUrl = `https://www.linkedin.com/in/${vanityName}`;
        }
      }
    }

    // Extract message (personalized note) and sentTime from invitation entity
    const message =
      (invitation.message as string | null | undefined) ?? undefined;
    const sentTime =
      (invitation.sentTime as number | null | undefined) ?? undefined;

    invitations.push({
      invitationId,
      sharedSecret,
      fromMemberId,
      fromName,
      vanityName,
      profileUrl,
      headline,
      message,
      sentTime,
    });
  }

  return { invitations };
}

export async function listInvitations(opts: {
  csrf: string;
  start?: number;
  count?: number;
}): Promise<ListInvitationsOutput> {
  const start = opts.start ?? 0;
  const count = opts.count ?? 20;

  interface InvitationResponse {
    data?: {
      '*elements'?: string[];
    };
    included?: Array<{
      entityUrn?: string;
      $type?: string;
      sharedSecret?: string;
      invitationType?: string | null;
      firstName?: string;
      lastName?: string;
      publicIdentifier?: string;
      '*invitation'?: string;
      '*fromMember'?: string;
      '*genericInvitationView'?: string;
      inviterName?: string;
      title?: { text?: string };
      subtitle?: { text?: string };
      primaryImage?: {
        attributes?: Array<{ '*miniCompany'?: string }>;
      };
      name?: string;
      [key: string]: unknown;
    }>;
  }

  const resp = await linkedinFetch<InvitationResponse>(
    opts.csrf,
    `/voyager/api/relationships/invitationViews?includeInsights=true&q=receivedInvitation&start=${start}&count=${count}`,
  );

  // Build entity map from included array for reference resolution
  const entityMap: Record<string, Record<string, unknown>> = {};
  if (resp.included) {
    for (const entity of resp.included) {
      if (entity.entityUrn) {
        entityMap[entity.entityUrn] = entity;
      }
    }
  }

  // Resolve *elements URNs to InvitationView entities
  const elementUrns = resp.data?.['*elements'] ?? [];
  const invitations: ListInvitationsOutput['invitations'] = [];

  for (const urn of elementUrns) {
    const element = entityMap[urn] as Record<string, unknown> | undefined;
    if (!element) continue;

    // Check for *genericInvitationView (newsletter, page follow, etc.)
    const genericInvitationViewUrn = element['*genericInvitationView'] as
      | string
      | undefined;

    if (genericInvitationViewUrn) {
      // Newsletter/organization invitation
      const genericView = entityMap[genericInvitationViewUrn] as
        | Record<string, unknown>
        | undefined;
      if (!genericView) continue;

      // Get the *invitation reference from the element (not genericView)
      const invitationUrn = element['*invitation'] as string | undefined;
      if (!invitationUrn) continue;

      const invitation = entityMap[invitationUrn] as
        | Record<string, unknown>
        | undefined;
      if (!invitation) continue;

      const sharedSecret = invitation.sharedSecret as string | undefined;
      if (!sharedSecret) continue;

      // Extract invitationId from the invitation entityUrn
      const invEntityUrn = invitation.entityUrn as string | undefined;
      const invitationId = invEntityUrn?.split(':').pop();
      if (!invitationId) continue;

      // Extract newsletter metadata from genericView
      const title = (genericView.title as { text?: string } | undefined)?.text;
      const subtitle = (genericView.subtitle as { text?: string } | undefined)
        ?.text;

      // Resolve company name from *miniCompany reference
      let companyName: string | undefined;
      const primaryImage = genericView.primaryImage as
        | { attributes?: Array<{ '*miniCompany'?: string }> }
        | undefined;
      const miniCompanyUrn = primaryImage?.attributes?.[0]?.['*miniCompany'];
      if (miniCompanyUrn) {
        const company = entityMap[miniCompanyUrn] as
          | Record<string, unknown>
          | undefined;
        companyName = company?.name as string | undefined;
      }

      invitations.push({
        invitationId,
        sharedSecret,
        type: 'newsletter' as const,
        title,
        subtitle,
        companyName,
      });
    } else {
      // Connection invitation
      const invitationUrn = element['*invitation'] as string | undefined;
      if (!invitationUrn) continue;

      const invitation = entityMap[invitationUrn] as
        | Record<string, unknown>
        | undefined;
      if (!invitation) continue;

      // Filter to PENDING connection requests only
      if (invitation.invitationType !== 'PENDING') continue;

      const sharedSecret = invitation.sharedSecret as string | undefined;
      if (!sharedSecret) continue;

      // Extract invitationId from the invitation entityUrn
      const invEntityUrn = invitation.entityUrn as string | undefined;
      const invitationId = invEntityUrn?.split(':').pop();
      if (!invitationId) continue;

      // Resolve *fromMember on the invitation entity
      const fromMemberUrn = invitation['*fromMember'] as string | undefined;
      let fromMemberId: string | undefined;
      let fromName: string | undefined;

      if (fromMemberUrn) {
        const member = entityMap[fromMemberUrn] as
          | Record<string, unknown>
          | undefined;
        if (member) {
          // Extract memberId from miniProfile entityUrn
          const memberEntityUrn = member.entityUrn as string | undefined;
          fromMemberId = memberEntityUrn?.split(':').pop();
          fromName = [member.firstName as string, member.lastName as string]
            .filter(Boolean)
            .join(' ');
        }
      }

      invitations.push({
        invitationId,
        sharedSecret,
        type: 'connection' as const,
        fromMemberId,
        fromName,
      });
    }
  }

  return { invitations };
}

export async function handleInvitationAction(opts: {
  csrf: string;
  invitationId: string;
  profileId?: string;
  validationToken: string;
  action: 'accept' | 'ignore';
  invitationType?: 'connection' | 'newsletter' | 'other';
  firstName?: string;
  lastName?: string;
}): Promise<void> {
  const inviteeActionType =
    opts.action === 'accept'
      ? 'InviteeActionType_ACCEPT'
      : 'InviteeActionType_IGNORE';

  const genericInvitationType =
    opts.invitationType === 'newsletter' || opts.invitationType === 'other'
      ? 'GenericInvitationType_ORGANIZATION'
      : 'GenericInvitationType_CONNECTION';

  // Build payload conditionally based on invitation type
  const payload: Record<string, unknown> = {
    origin: 'InvitationOrigin_INVITATION_MANAGER',
    invitationUrn: { invitationId: opts.invitationId },
    invitationType: genericInvitationType,
    validationToken: opts.validationToken,
    inviteeActionType,
    postActionSentConfigs: [],
  };

  // Only include profile fields for connection invitations
  if (opts.invitationType === 'connection' || !opts.invitationType) {
    if (opts.lastName) payload.lastName = opts.lastName;
    if (opts.firstName) payload.firstName = opts.firstName;
    if (opts.profileId) {
      payload.profileUrn = { profileId: opts.profileId };
    }
  }

  const sduiRequestId =
    'com.linkedin.sdui.requests.mynetwork.addaInvitationAction';

  // Generate a tracking ID (base64 of 16 random bytes), same pattern as withdrawConnectionRequest
  const trackingBytes = new Uint8Array(16);
  crypto.getRandomValues(trackingBytes);
  const trackingId = btoa(String.fromCharCode(...trackingBytes));

  const sduiHeaders: Record<string, string> = {
    'x-li-rsc-stream': 'true',
    'x-li-page-instance-tracking-id': trackingId,
    'x-li-application-instance': 'undefined',
    'x-li-anchor-page-key': 'd_flagship3_people_invitations',
    'x-li-page-instance': `urn:li:page:d_flagship3_people_invitations;${trackingId}`,
    'x-li-track': JSON.stringify({
      clientVersion: '0.0.0',
      mpVersion: '0.0.0',
      osName: 'web',
      timezoneOffset: new Date().getTimezoneOffset() / -60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceFormFactor: 'DESKTOP',
      mpName: 'web',
      displayDensity: window.devicePixelRatio || 2,
      displayWidth: window.screen.width * (window.devicePixelRatio || 2),
      displayHeight: window.screen.height * (window.devicePixelRatio || 2),
    }),
  };

  const screenId =
    'com.linkedin.sdui.flagshipnav.mynetwork.invitations.InvitationManagerReceived';

  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    payload,
    requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' },
  };

  // SDUI endpoint returns RSC streaming, not JSON; use raw fetch
  const response = await fetch(
    `${window.location.origin}/flagship-web/rsc-action/actions/server-request?sduiid=${sduiRequestId}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'csrf-token': opts.csrf,
        ...sduiHeaders,
      },
      body: JSON.stringify({
        requestId: sduiRequestId,
        serverRequest: {
          $type: 'proto.sdui.actions.core.ServerRequest',
          requestId: sduiRequestId,
          requestedArguments,
        },
        isStreaming: false,
        rumPageKey: '',
        isApfcEnabled: false,
        states: [],
        requestedArguments: {
          ...requestedArguments,
          states: [],
          screenId,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, `Invitation action failed: ${response.status} ${body?.slice(0, 500)}`);
  }
}

export async function listSentConnectionRequests(opts: {
  csrf: string;
  start?: number;
  count?: number;
}): Promise<ListSentConnectionRequestsOutput> {
  const initialStart = opts.start ?? 0;
  const count = opts.count ?? 10;
  const SDUI_PAGE_SIZE = 10;

  const allInvitations: ListSentConnectionRequestsOutput['invitations'] = [];
  let start = initialStart;
  let hasMore = true;

  while (allInvitations.length < count) {
    const pageInvitations = await fetchSentInvitationsPage(opts.csrf, start);

    if (pageInvitations.length === 0) {
      hasMore = false;
      break;
    }

    allInvitations.push(...pageInvitations);
    start += SDUI_PAGE_SIZE;

    if (pageInvitations.length < SDUI_PAGE_SIZE) {
      hasMore = false;
      break;
    }

    if (allInvitations.length >= count) break;

    await sleep(jitter());
  }

  const results = allInvitations.slice(0, count);

  return {
    invitations: results,
    hasMore: hasMore && results.length >= count,
  };
}

/**
 * Fetch a single page of sent connection requests via SDUI pagination endpoint.
 * LinkedIn returns pages of 10 in RSC wire format.
 */
async function fetchSentInvitationsPage(
  csrf: string,
  startIndex: number,
): Promise<ListSentConnectionRequestsOutput['invitations']> {
  const trackingBytes = new Uint8Array(16);
  crypto.getRandomValues(trackingBytes);
  const trackingId = btoa(String.fromCharCode(...trackingBytes));

  const payload = {
    startIndex,
    invitationTypeEnum: ['GenericInvitationType_CONNECTION'],
    filterCriteriaEnum: 'FilterCriteria_UNKNOWN',
    invitationDirectionEnum: 'PendingInvitationDirection_SENT',
  };

  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    payload,
    requestedStateKeys: [],
    requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' },
    states: [],
    screenId:
      'com.linkedin.sdui.flagshipnav.mynetwork.invitations.InvitationSentWithType',
  };

  const response = await fetch(
    `${window.location.origin}/flagship-web/rsc-action/actions/pagination?sduiid=com.linkedin.sdui.pagers.mynetwork.invitationsList`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'csrf-token': csrf,
        'x-li-rsc-stream': 'true',
        'x-li-page-instance-tracking-id': trackingId,
        'x-li-anchor-page-key': 'd_flagship3_people_sent_invitations',
        'x-li-page-instance': `urn:li:page:d_flagship3_people_sent_invitations;${trackingId}`,
      },
      body: JSON.stringify({
        pagerId: 'com.linkedin.sdui.pagers.mynetwork.invitationsList',
        clientArguments: requestedArguments,
        paginationRequest: {
          $type: 'proto.sdui.actions.requests.PaginationRequest',
          pagerId: 'com.linkedin.sdui.pagers.mynetwork.invitationsList',
          requestedArguments,
          trigger: {
            $case: 'itemDistanceTrigger',
            itemDistanceTrigger: {
              $type: 'proto.sdui.actions.requests.ItemDistanceTrigger',
              preloadDistance: 3,
              preloadLength: 250,
            },
          },
          retryCount: 2,
        },
      }),
    },
  );

  if (!response.ok) {
    throwForStatus(response.status, `Failed to fetch sent connection requests: ${response.status}. Navigate to /mynetwork/invitation-manager/sent/ first.`);
  }

  const text = await response.text();
  return parseSentInvitationsFromRsc(text);
}

/**
 * Parse sent invitation data from RSC (React Server Components) wire format.
 * Extracts person data from WithdrawConfirmationDialog action payloads embedded
 * in the RSC response. Each person card contains firstName, lastName,
 * inviteeVanityName, profileUrn (ACo format), and invitationId.
 */
function parseSentInvitationsFromRsc(
  rscText: string,
): ListSentConnectionRequestsOutput['invitations'] {
  const invitations: ListSentConnectionRequestsOutput['invitations'] = [];

  // Find all invitation payloads by looking for inviteeVanityName patterns
  // Each person card in the RSC has a withdraw action payload containing all IDs
  const vanityRegex = /"inviteeVanityName"\s*:\s*"([^"]+)"/g;
  let match;

  while ((match = vanityRegex.exec(rscText)) !== null) {
    const pos = match.index;
    // Extract a window around this match to find nearby fields
    const windowStart = Math.max(0, pos - 500);
    const windowEnd = Math.min(rscText.length, pos + 500);
    const window = rscText.substring(windowStart, windowEnd);

    const vanityName = match[1];
    const firstName = window.match(/"firstName"\s*:\s*"([^"]+)"/)?.[1];
    const lastName = window.match(/"lastName"\s*:\s*"([^"]+)"/)?.[1];
    const profileUrn = window.match(/"profileUrn"\s*:\s*"(ACo[^"]+)"/)?.[1];
    const invitationId = window.match(/"invitationId"\s*:\s*"(\d+)"/)?.[1];

    if (invitationId) {
      const name = [firstName, lastName].filter(Boolean).join(' ') || undefined;
      invitations.push({
        invitationId,
        invitationUrn: `urn:li:fsd_invitation:${invitationId}`,
        name,
        memberId: profileUrn,
        vanityName,
        profileUrl: `https://www.linkedin.com/in/${vanityName}/`,
      });
    }
  }

  // Deduplicate by invitationId; each person may appear in both
  // navigation and withdraw action payloads within the RSC response
  const seen = new Set<string>();
  return invitations.filter((inv) => {
    if (seen.has(inv.invitationId)) return false;
    seen.add(inv.invitationId);
    return true;
  });
}

/**
 * Decode numeric member ID from an ACo-prefixed encrypted member ID.
 * ACo IDs are URL-safe base64-encoded binary. The numeric ID is stored
 * as a big-endian uint32 at byte offset 4.
 */
function decodeNumericMemberId(acoId: string): string {
  const b64 = acoId.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  return view.getUint32(4).toString();
}

export async function withdrawConnectionRequest(opts: {
  csrf: string;
  memberId: string;
  invitationUrn: string;
}): Promise<WithdrawConnectionRequestOutput> {
  let resolvedMemberId = opts.memberId;

  // Resolve vanity name to ACo member ID if needed
  if (!opts.memberId.startsWith('ACo') && !opts.memberId.startsWith('urn:')) {
    try {
      const { getProfileByVanityName } = await import('../profiles/index.js');
      const profile = await getProfileByVanityName({
        csrf: opts.csrf,
        vanityName: opts.memberId,
      });
      resolvedMemberId = profile.memberId;
    } catch {
      throw new NotFound(`Could not resolve profile for: ${opts.memberId}`);
    }
  }

  // Extract invitationId from invitationUrn
  // e.g. "urn:li:invitation:7426429324062248961" -> "7426429324062248961"
  const invitationId = opts.invitationUrn.split(':').pop();
  if (!invitationId) {
    throw new Validation(
      `Invalid invitationUrn format: ${opts.invitationUrn}. Expected urn:li:invitation:<id> or urn:li:fsd_invitation:<id>`,
    );
  }

  // Decode the numeric member ID from the ACo-prefixed ID
  const numericMemberId = decodeNumericMemberId(resolvedMemberId);

  const payload: Record<string, unknown> = {
    inviterActionType: 'InviterActionType_WITHDRAW',
    inviteeUrn: { memberId: numericMemberId },
    profileUrn: resolvedMemberId,
    queryName: 'ProfileMemberRelationshipRefreshById',
    firstFiveInviteCount: {
      key: 'guidedFlowNumSentInvites',
      namespace: '',
    },
    guidedFlowUrlandProfileList: {
      key: 'guidedFlowUrlAndPictureList',
      namespace: 'guidedFlowUrlAndPictureListNameSpace',
    },
    invitationType: 'GenericInvitationType_CONNECTION',
    invitationUrn: { invitationId },
  };

  const requestedStateKeys = [
    {
      $type: 'proto.sdui.StateKey',
      value: 'guidedFlowNumSentInvites',
      key: {
        $type: 'proto.sdui.Key',
        value: { $case: 'id', id: 'guidedFlowNumSentInvites' },
      },
      namespace: '',
      isEncrypted: false,
    },
    {
      $type: 'proto.sdui.StateKey',
      value: 'guidedFlowUrlAndPictureList',
      key: {
        $type: 'proto.sdui.Key',
        value: { $case: 'id', id: 'guidedFlowUrlAndPictureList' },
      },
      namespace: 'guidedFlowUrlAndPictureListNameSpace',
      isEncrypted: false,
    },
  ];

  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    payload,
    requestedStateKeys,
    requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' },
  };

  const sduiRequestId =
    'com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation';
  const screenId =
    'com.linkedin.sdui.flagshipnav.mynetwork.invitations.WithdrawConfirmationDialog';

  // Generate a tracking ID (base64 of 16 random bytes)
  const trackingBytes = new Uint8Array(16);
  crypto.getRandomValues(trackingBytes);
  const trackingId = btoa(String.fromCharCode(...trackingBytes));

  const sduiHeaders: Record<string, string> = {
    'x-li-rsc-stream': 'true',
    'x-li-page-instance-tracking-id': trackingId,
    'x-li-application-instance': 'undefined',
    'x-li-anchor-page-key': 'd_flagship3_people_invitations_withdraw_friction',
    'x-li-page-instance': `urn:li:page:d_flagship3_people_invitations_withdraw_friction;${trackingId}`,
    'x-li-track': JSON.stringify({
      clientVersion: '0.0.0',
      mpVersion: '0.0.0',
      osName: 'web',
      timezoneOffset: new Date().getTimezoneOffset() / -60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      deviceFormFactor: 'DESKTOP',
      mpName: 'web',
      displayDensity: window.devicePixelRatio || 2,
      displayWidth: window.screen.width * (window.devicePixelRatio || 2),
      displayHeight: window.screen.height * (window.devicePixelRatio || 2),
    }),
  };

  // SDUI endpoint returns RSC streaming, not JSON; use raw fetch
  const response = await fetch(
    `${window.location.origin}/flagship-web/rsc-action/actions/server-request?sduiid=${sduiRequestId}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'csrf-token': opts.csrf,
        ...sduiHeaders,
      },
      body: JSON.stringify({
        requestId: sduiRequestId,
        serverRequest: {
          $type: 'proto.sdui.actions.core.ServerRequest',
          requestId: sduiRequestId,
          requestedArguments,
        },
        isStreaming: false,
        rumPageKey: '',
        isApfcEnabled: false,
        states: [],
        requestedArguments: {
          ...requestedArguments,
          states: [],
          screenId,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, `Withdraw failed: ${response.status} ${body?.slice(0, 500)}`);
  }

  // Parse RSC response to check for server errors
  const text = await response.text();
  if (text.includes('"Failed to withdraw invitation"')) {
    throw new UpstreamError(
      'LinkedIn rejected the withdraw request. The invitation may have already been withdrawn or expired.',
    );
  }

  return { success: true };
}

export async function removeConnection(opts: {
  csrf: string;
  memberId: string;
}): Promise<void> {
  const connectionUrn = `urn:li:fsd_connection:${opts.memberId}`;

  await linkedinFetch(
    opts.csrf,
    '/voyager/api/voyagerRelationshipsDashMemberRelationships?action=removeFromMyConnections&decorationId=com.linkedin.voyager.dash.deco.relationships.MemberRelationship-21',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionUrn,
      }),
    },
  );
}
