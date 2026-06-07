/**
 * LinkedIn Company Operations
 *
 * Company profiles, following state, and company posts.
 */

import type {
  GetCompanyOutput,
  GetCompanyFollowingStateOutput,
  GetCompanyPostsOutput,
  ListAdminCompaniesOutput,
  GetAvailableActorsOutput,
} from '../schemas';
import { linkedinFetch, buildEntityMap } from '../helpers';
import { NotFound, Validation, ContractDrift } from '@vallum/_runtime';

export async function getCompany(opts: {
  csrf: string;
  identifier: string;
}): Promise<GetCompanyOutput> {
  // Helper to fetch company by universalName
  async function fetchByUniversalName(
    uname: string,
  ): Promise<GetCompanyOutput | null> {
    interface CompanyResponse {
      included?: Array<{
        $type?: string;
        entityUrn?: string;
        name?: string;
        universalName?: string;
        description?: string;
        tagline?: string;
        staffCount?: number;
        staffCountRange?: { start?: number; end?: number };
        '*companyIndustries'?: string[];
        '*followingInfo'?: string;
        logo?: {
          vectorImage?: {
            rootUrl?: string;
            artifacts?: Array<{ fileIdentifyingUrlPathSegment?: string }>;
          };
        };
        followerCount?: number;
        following?: boolean;
        localizedName?: string;
        companyPageUrl?: string;
        companyType?: { localizedName?: string; code?: string };
        foundedOn?: { year?: number; month?: number };
        specialities?: string[];
        paidCompany?: boolean;
        permissions?: { admin?: boolean; landingPageAdmin?: boolean };
        viewerEmployee?: boolean;
        headquarter?: {
          country?: string;
          city?: string;
          geographicArea?: string;
          postalCode?: string;
          line1?: string;
        };
        confirmedLocations?: Array<{
          country?: string;
          city?: string;
          geographicArea?: string;
          postalCode?: string;
          line1?: string;
        }>;
        fundingData?: {
          lastFundingRound?: {
            fundingType?: string;
            moneyRaised?: { amount?: string; currencyCode?: string };
            announcedOn?: { year?: number; month?: number; day?: number };
            leadInvestors?: Array<{ name?: { text?: string } }>;
          };
          numFundingRounds?: number;
          companyCrunchbaseUrl?: string;
        };
      }>;
    }

    const resp = await linkedinFetch<CompanyResponse>(
      opts.csrf,
      `/voyager/api/organization/companies?decorationId=com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-28&q=universalName&universalName=${uname}`,
    );

    if (!resp.included) {
      return null;
    }

    // Find the company matching the universalName
    const companies = resp.included.filter(
      (e) => e.$type?.includes('Company') && e.name,
    );

    if (companies.length === 0) {
      return null;
    }

    // Prefer exact match on universalName
    let companyEntity = companies.find(
      (e) => e.universalName?.toLowerCase() === uname.toLowerCase(),
    );

    // Fall back to company with most data (has staffCount)
    if (!companyEntity) {
      companyEntity = companies.find((e) => e.staffCount);
    }

    if (!companyEntity) {
      companyEntity = companies[0];
    }

    const companyIdParts = companyEntity.entityUrn
      ? companyEntity.entityUrn.split(':')
      : [];
    const companyId =
      companyIdParts.length > 0
        ? companyIdParts[companyIdParts.length - 1]
        : uname;
    const companyUrn = companyEntity.entityUrn
      ? companyEntity.entityUrn
      : `urn:li:fsd_company:${companyId}`;

    // Extract logo URL
    let logoUrl: string | undefined;
    if (companyEntity.logo?.vectorImage) {
      const vi = companyEntity.logo.vectorImage;
      if (vi.rootUrl && vi.artifacts?.[0]) {
        logoUrl = vi.rootUrl + vi.artifacts[0].fileIdentifyingUrlPathSegment;
      }
    }

    // Extract following state
    const followingInfoUrn = companyEntity['*followingInfo'];
    let followingState:
      | { following: boolean; followerCount?: number }
      | undefined;
    if (followingInfoUrn) {
      const followingInfo = resp.included.find(
        (e) => e.entityUrn === followingInfoUrn,
      );
      if (followingInfo) {
        followingState = {
          following: followingInfo.following ?? false,
          followerCount: followingInfo.followerCount,
        };
      }
    }

    // Extract industry
    let industry: string | undefined;
    const industryRefs = companyEntity['*companyIndustries'];
    if (industryRefs && industryRefs.length > 0) {
      const industryEntity = resp.included.find(
        (e) => e.entityUrn === industryRefs[0],
      );
      industry = industryEntity?.localizedName;
    }

    // Extract funding data
    let fundingData: GetCompanyOutput['fundingData'];
    if (companyEntity.fundingData) {
      const fd = companyEntity.fundingData;
      fundingData = {
        lastRoundType: fd.lastFundingRound?.fundingType,
        lastRoundAmount: fd.lastFundingRound?.moneyRaised?.amount,
        lastRoundDate: fd.lastFundingRound?.announcedOn
          ? {
              year: fd.lastFundingRound.announcedOn.year,
              month: fd.lastFundingRound.announcedOn.month,
              day: fd.lastFundingRound.announcedOn.day,
            }
          : undefined,
        leadInvestors: fd.lastFundingRound?.leadInvestors
          ?.map((i) => i.name?.text)
          .filter((n): n is string => !!n),
        numFundingRounds: fd.numFundingRounds,
        crunchbaseUrl: fd.companyCrunchbaseUrl,
      };
    }

    return {
      companyId,
      companyUrn,
      name: companyEntity.name,
      universalName: companyEntity.universalName,
      description: companyEntity.description,
      tagline: companyEntity.tagline,
      staffCount: companyEntity.staffCount,
      staffCountRange: companyEntity.staffCountRange
        ? {
            start: companyEntity.staffCountRange.start,
            end: companyEntity.staffCountRange.end,
          }
        : undefined,
      industry,
      companyUrl: `https://www.linkedin.com/company/${companyEntity.universalName ? companyEntity.universalName : companyId}`,
      website: companyEntity.companyPageUrl,
      logoUrl,
      companyType: companyEntity.companyType?.localizedName,
      foundedOn: companyEntity.foundedOn
        ? {
            year: companyEntity.foundedOn.year,
            month: companyEntity.foundedOn.month,
          }
        : undefined,
      specialities: companyEntity.specialities,
      headquarter: companyEntity.headquarter
        ? {
            country: companyEntity.headquarter.country,
            city: companyEntity.headquarter.city,
            geographicArea: companyEntity.headquarter.geographicArea,
            postalCode: companyEntity.headquarter.postalCode,
            line1: companyEntity.headquarter.line1,
          }
        : undefined,
      fundingData,
      followingState,
      paidCompany: companyEntity.paidCompany ?? false,
      isAdmin: companyEntity.permissions?.admin ?? false,
      viewerEmployee: companyEntity.viewerEmployee ?? false,
    };
  }

  // Helper to add otherCompaniesWithSameName to a result
  async function enrichWithSimilarCompanies(
    result: GetCompanyOutput,
  ): Promise<GetCompanyOutput> {
    if (result.name) {
      try {
        const { searchCompanies } = await import('../search/index.js');
        const similarCompanies = await searchCompanies({
          csrf: opts.csrf,
          keywords: result.name,
          count: 5,
        });
        result.otherCompaniesWithSameName = similarCompanies.results
          .filter((r) => r.companyId !== result.companyId)
          .map((r) => ({
            companyId: r.companyId,
            name: r.name,
            universalName: r.universalName,
            subtitle: r.subtitle,
            companyUrl: r.companyUrl,
          }));
      } catch {
        // Search failed, don't block the main result
      }
    }
    return result;
  }

  // Coerce identifier to string in case runtime passes a number
  const identifier = String(opts.identifier);

  // If identifier looks like a slug (no spaces, lowercase-ish), try direct fetch first
  const looksLikeSlug =
    !identifier.includes(' ') && /^[a-z0-9-]+$/i.test(identifier);

  if (looksLikeSlug) {
    const result = await fetchByUniversalName(identifier.toLowerCase());
    if (result) return enrichWithSimilarCompanies(result);
  }

  // If numeric, also try direct (API accepts numeric IDs too)
  if (!isNaN(parseInt(identifier))) {
    const result = await fetchByUniversalName(identifier);
    if (result) return enrichWithSimilarCompanies(result);
  }

  // Fall back to search
  const { searchCompanies } = await import('../search/index.js');
  const searchResults = await searchCompanies({
    csrf: opts.csrf,
    keywords: identifier,
    count: 1,
  });

  if (searchResults.results.length === 0) {
    throw new NotFound(`No company found matching: ${identifier}`);
  }

  const universalName = searchResults.results[0].universalName
    ? searchResults.results[0].universalName
    : searchResults.results[0].companyId!;
  const result = await fetchByUniversalName(universalName);

  if (!result) {
    throw new NotFound(`Could not fetch company details for: ${identifier}`);
  }

  return enrichWithSimilarCompanies(result);
}

export async function getCompanyFollowingState(opts: {
  csrf: string;
  companyId: string;
}): Promise<GetCompanyFollowingStateOutput> {
  if (!/^\d+$/.test(opts.companyId)) {
    throw new Validation(
      `companyId must be numeric (e.g. "1441"), got "${opts.companyId}". Use getCompany to resolve a universalName to a numeric companyId.`,
    );
  }
  const company = await getCompany({
    csrf: opts.csrf,
    identifier: String(opts.companyId),
  });
  return company.followingState ?? { following: false };
}

export async function updateFollowingState(opts: {
  csrf: string;
  companyId: string;
  following: boolean;
}): Promise<void> {
  if (!/^\d+$/.test(opts.companyId)) {
    throw new Validation(
      `companyId must be numeric (e.g. "1441"), got "${opts.companyId}". Use getCompany to resolve a universalName to a numeric companyId.`,
    );
  }
  const followingStateUrn = `urn:li:fsd_followingState:urn:li:fsd_company:${opts.companyId}`;
  const encodedUrn = encodeURIComponent(followingStateUrn);

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/feed/dash/followingStates/${encodedUrn}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'x-restli-method': 'PARTIAL_UPDATE',
      },
      body: JSON.stringify({
        patch: {
          $set: {
            following: opts.following,
          },
        },
      }),
    },
  );
}

const MAX_COMPANY_POSTS_PAGE = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 500 + Math.floor(Math.random() * 1000);

interface UpdateEntity {
  entityUrn?: string;
  $type?: string;
  commentary?: { text?: { text?: string } };
  '*socialDetail'?: string;
  actor?: {
    urn?: string;
    name?: { text?: string };
    description?: { text?: string };
    subDescription?: { text?: string; accessibilityText?: string };
    navigationContext?: { actionTarget?: string };
  };
  header?: { text?: { text?: string } };
  content?: Record<string, unknown> & { $type?: string };
  resharedUpdate?: { entityUrn?: string } | null;
  '*resharedUpdate'?: string;
  updateMetadata?: { urn?: string; shareUrn?: string };
}

/**
 * Extract image and video URLs from a post's content field.
 *
 * The content object IS the component (ImageComponent, LinkedInVideoComponent, etc.).
 * - Images: content.images[0].attributes[0].vectorImage (rootUrl + artifacts)
 * - Videos: content['*videoPlayMetadata'] is a reference to a VideoPlayMetadata entity
 *   in the included array, resolved via entityMap.
 */
function extractMediaUrls(
  content: Record<string, unknown> | undefined,
  entityMap: Record<string, unknown>,
): {
  imageUrl?: string;
  videoUrl?: string;
} {
  if (!content) return {};

  let imageUrl: string | undefined;
  let videoUrl: string | undefined;

  // Content IS the ImageComponent; images array is directly on content
  const images = content.images as
    | Array<{
        attributes?: Array<{
          vectorImage?: {
            rootUrl?: string;
            artifacts?: Array<{
              width?: number;
              height?: number;
              fileIdentifyingUrlPathSegment?: string;
            }>;
          };
          detailData?: {
            '*imageUrl'?: string;
            imageUrl?: string;
          };
        }>;
      }>
    | undefined;

  if (images?.[0]?.attributes?.[0]) {
    const attr = images[0].attributes[0];
    if (attr.vectorImage?.rootUrl && attr.vectorImage.artifacts?.length) {
      const artifacts = attr.vectorImage.artifacts;
      const largest = artifacts[artifacts.length - 1];
      if (largest.fileIdentifyingUrlPathSegment) {
        imageUrl =
          attr.vectorImage.rootUrl + largest.fileIdentifyingUrlPathSegment;
      }
    }
    if (!imageUrl && attr.detailData) {
      imageUrl = attr.detailData.imageUrl || attr.detailData['*imageUrl'];
    }
  }

  // Content IS the LinkedInVideoComponent; video metadata is a reference
  const videoMetaRef = content['*videoPlayMetadata'] as string | undefined;
  if (videoMetaRef) {
    const videoMeta = entityMap[videoMetaRef] as
      | {
          progressiveStreams?: Array<{
            streamingLocations?: Array<{ url?: string }>;
            width?: number;
          }>;
        }
      | undefined;
    if (videoMeta?.progressiveStreams?.length) {
      const streams = videoMeta.progressiveStreams;
      const largest = streams.reduce((a, b) =>
        (b.width ?? 0) > (a.width ?? 0) ? b : a,
      );
      videoUrl = largest.streamingLocations?.[0]?.url;
    }
  }

  return { imageUrl, videoUrl };
}

interface SocialDetailEntity {
  entityUrn?: string;
  likes?: { paging?: { total?: number } };
  comments?: { paging?: { total?: number } };
  totalShares?: number;
  '*totalSocialActivityCounts'?: string;
  urn?: string;
}

interface SocialActivityCountsEntity {
  numLikes?: number;
  numComments?: number;
  numShares?: number;
}

function parseCompanyPostsPage(resp: {
  data?: { '*elements'?: string[] };
  included?: unknown[];
}): GetCompanyPostsOutput['posts'] {
  const entityMap = buildEntityMap(resp.included);
  const posts: GetCompanyPostsOutput['posts'] = [];

  const elementUrns = resp.data?.['*elements'];
  if (!elementUrns) return posts;

  for (const urn of elementUrns) {
    const entity = entityMap[urn] as UpdateEntity | undefined;
    if (!entity) continue;

    // Skip non-post entities (ads, promos, etc.)
    if (!entity.$type?.includes('UpdateV2')) continue;

    // Get social metrics from referenced socialDetail
    let likesCount: number | undefined;
    let commentsCount: number | undefined;
    let repostsCount: number | undefined;
    let ugcPostUrn: string | undefined;
    const socialDetailRef = entity['*socialDetail'];
    if (socialDetailRef) {
      const socialDetail = entityMap[socialDetailRef] as
        | SocialDetailEntity
        | undefined;
      likesCount = socialDetail?.likes?.paging?.total;
      commentsCount = socialDetail?.comments?.paging?.total;
      repostsCount = socialDetail?.totalShares;
      ugcPostUrn = socialDetail?.urn;

      // Use SocialActivityCounts if available for more accurate likes/comments
      if (socialDetail?.['*totalSocialActivityCounts']) {
        const counts = entityMap[socialDetail['*totalSocialActivityCounts']] as
          | SocialActivityCountsEntity
          | undefined;
        if (counts) {
          if (counts.numLikes !== undefined) likesCount = counts.numLikes;
          if (counts.numComments !== undefined)
            commentsCount = counts.numComments;
          if (counts.numShares !== undefined) repostsCount = counts.numShares;
        }
      }
    }

    // Extract activity URN from the fs_updateV2 entityUrn
    let activityUrn: string | undefined;
    if (entity.entityUrn) {
      const activityMatch = entity.entityUrn.match(/urn:li:activity:(\d+)/);
      if (activityMatch) {
        activityUrn = `urn:li:activity:${activityMatch[1]}`;
      }
    }

    // Extract author info from inline actor object
    let authorName: string | undefined;
    let authorHeadline: string | undefined;
    let authorMemberId: string | undefined;
    let authorVanityName: string | undefined;

    if (entity.actor) {
      authorName = entity.actor.name?.text;
      authorHeadline = entity.actor.description?.text;

      // Extract member ID from actor URN (urn:li:member:12345)
      if (entity.actor.urn) {
        const memberMatch = entity.actor.urn.match(/urn:li:member:(\d+)/);
        if (memberMatch) {
          authorMemberId = memberMatch[1];
        }
      }

      // Extract vanity name from navigation URL (/in/ for members, /company/ for companies)
      if (entity.actor.navigationContext?.actionTarget) {
        const url = entity.actor.navigationContext.actionTarget;
        const memberVanity = url.match(/\/in\/([^/?]+)/);
        const companyVanity = url.match(/\/company\/([^/?]+)/);
        authorVanityName = memberVanity?.[1] ?? companyVanity?.[1];
      }
    }

    // Extract relative time from actor.subDescription
    let relativeTime: string | undefined;
    if (entity.actor?.subDescription) {
      const accessibilityText = entity.actor.subDescription.accessibilityText;
      if (accessibilityText) {
        relativeTime = accessibilityText;
      } else if (entity.actor.subDescription.text) {
        // Parse from display text (e.g., "3w • ")
        const timeMatch = entity.actor.subDescription.text.match(/^(\d+\w+)/);
        if (timeMatch) {
          relativeTime = timeMatch[1];
        }
      }
    }

    // Derive timestamp from activity ID (LinkedIn encodes creation time in the ID)
    let timestamp: number | undefined;
    if (activityUrn) {
      const idStr = activityUrn.split(':').pop();
      if (idStr) {
        // LinkedIn activity IDs use a snowflake-like scheme: top 41 bits = ms since epoch
        const id = BigInt(idStr);
        const ms = Number(id >> 22n);
        if (ms > 1000000000000 && ms < 2000000000000) {
          timestamp = ms;
        }
      }
    }

    // Detect media content from content.$type and extract URLs
    const contentType = entity.content?.$type ?? '';
    const hasImage = contentType.includes('Image');
    const hasVideo = contentType.includes('Video');
    const { imageUrl, videoUrl } = extractMediaUrls(entity.content, entityMap);

    // Detect post type:
    // 1. *resharedUpdate reference → repost with commentary
    // 2. RESHARED in entityUrn or header "reposted" → instant repost
    let postType: 'original' | 'repost' | 'repost_with_commentary' = 'original';
    let originalPostUrn: string | undefined;

    if (entity['*resharedUpdate']) {
      postType = 'repost_with_commentary';
      const origMatch = entity['*resharedUpdate'].match(
        /urn:li:activity:(\d+)/,
      );
      if (origMatch) {
        originalPostUrn = `urn:li:activity:${origMatch[1]}`;
      }
    } else if (
      entity.entityUrn?.includes(',RESHARED,') ||
      (entity.header?.text?.text?.toLowerCase().includes('reposted') ?? false)
    ) {
      postType = 'repost';
    }

    const isRepost = postType !== 'original';

    // Skip promotional/empty entities that lack real post content
    const text = entity.commentary?.text?.text;
    if (!text && !activityUrn && !isRepost && !hasImage && !hasVideo) continue;

    posts.push({
      postUrn: entity.entityUrn,
      activityUrn,
      ugcPostUrn,
      text,
      timestamp,
      relativeTime,
      likesCount,
      commentsCount,
      repostsCount,
      authorName,
      authorHeadline,
      authorMemberId,
      authorVanityName,
      postType,
      isRepost,
      originalPostUrn,
      hasImage,
      hasVideo,
      imageUrl,
      videoUrl,
      postUrl: activityUrn
        ? `https://www.linkedin.com/feed/update/${activityUrn}`
        : undefined,
    });
  }

  return posts;
}

export async function getCompanyPosts(opts: {
  csrf: string;
  companyIdOrUniversalName: string;
  count?: number;
  start?: number;
}): Promise<GetCompanyPostsOutput> {
  const count = opts.count ?? 10;
  const initialStart = opts.start ?? 0;

  // Single request if within server limit
  if (count <= MAX_COMPANY_POSTS_PAGE) {
    const resp = await linkedinFetch<{
      data?: { '*elements'?: string[] };
      included?: unknown[];
    }>(
      opts.csrf,
      `/voyager/api/organization/updatesV2?companyIdOrUniversalName=${opts.companyIdOrUniversalName}&count=${count}&moduleKey=ORGANIZATION_MEMBER_FEED_DESKTOP&q=companyRelevanceFeed&start=${initialStart}`,
    );
    return { posts: parseCompanyPostsPage(resp) };
  }

  // Auto-paginate for counts > 50
  const allPosts: GetCompanyPostsOutput['posts'] = [];
  let start = initialStart;

  while (allPosts.length < count) {
    const pageSize = Math.min(MAX_COMPANY_POSTS_PAGE, count - allPosts.length);

    const resp = await linkedinFetch<{
      data?: { '*elements'?: string[] };
      included?: unknown[];
    }>(
      opts.csrf,
      `/voyager/api/organization/updatesV2?companyIdOrUniversalName=${opts.companyIdOrUniversalName}&count=${pageSize}&moduleKey=ORGANIZATION_MEMBER_FEED_DESKTOP&q=companyRelevanceFeed&start=${start}`,
    );

    const pagePosts = parseCompanyPostsPage(resp);
    if (pagePosts.length === 0) break;

    allPosts.push(...pagePosts);
    start += pageSize;

    if (pagePosts.length < pageSize) break;
    if (allPosts.length >= count) break;

    await sleep(jitter());
  }

  return { posts: allPosts.slice(0, count) };
}

export async function listAdminCompanies(opts: {
  csrf: string;
}): Promise<ListAdminCompaniesOutput> {
  // This endpoint uses a specific queryId for admin-viewable companies that
  // isn't in the standard AMD registry modules
  const queryId =
    'voyagerOrganizationDashCompanies.2fce873504d824e22294f312f718b4c7';

  interface AdminCompanyResponse {
    included?: Array<{
      $type?: string;
      entityUrn?: string;
      name?: string;
      universalName?: string;
      staffCount?: number;
      followerCount?: number;
      url?: string;
      logo?: {
        vectorImage?: {
          rootUrl?: string;
          artifacts?: Array<{ fileIdentifyingUrlPathSegment?: string }>;
        };
      };
    }>;
  }

  const resp = await linkedinFetch<AdminCompanyResponse>(
    opts.csrf,
    `/voyager/api/graphql?includeWebMetadata=true&variables=(count:20,viewerPermissions:(canReadOrganizationUpdateAnalytics:true))&queryId=${queryId}`,
  );

  const companies: ListAdminCompaniesOutput['companies'] = [];

  for (const entity of resp.included ?? []) {
    if (!entity.name || !entity.universalName) continue;

    let logoUrl: string | undefined;
    if (
      entity.logo?.vectorImage?.rootUrl &&
      entity.logo.vectorImage.artifacts?.[0]
    ) {
      logoUrl =
        entity.logo.vectorImage.rootUrl +
        entity.logo.vectorImage.artifacts[0].fileIdentifyingUrlPathSegment;
    }

    companies.push({
      companyId: entity.entityUrn?.split(':').pop() ?? '',
      name: entity.name,
      universalName: entity.universalName,
      staffCount: entity.staffCount,
      followerCount: entity.followerCount,
      logoUrl,
      companyUrl:
        entity.url ??
        `https://www.linkedin.com/company/${entity.universalName}/`,
    });
  }

  return { companies };
}

export async function getAvailableActors(opts: {
  csrf: string;
  memberId: string;
  fullName?: string;
}): Promise<GetAvailableActorsOutput> {
  const adminCompanies = await listAdminCompanies({ csrf: opts.csrf });

  const actors: GetAvailableActorsOutput['actors'] = [
    {
      type: 'personal',
      id: opts.memberId,
      name: opts.fullName ?? 'You',
      urn: `urn:li:fsd_profile:${opts.memberId}`,
    },
  ];

  for (const company of adminCompanies.companies) {
    actors.push({
      type: 'company',
      id: company.companyId,
      name: company.name,
      urn: `urn:li:fsd_company:${company.companyId}`,
      companyUrl: company.companyUrl,
    });
  }

  return { actors };
}
