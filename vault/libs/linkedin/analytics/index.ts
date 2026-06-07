/**
 * LinkedIn Analytics Operations
 *
 * Profile views, engagement analytics, content performance, and audience demographics.
 */

import { linkedinFetch, encodeVars, getQueryId } from '../helpers';
import { ContractDrift, UpstreamError, throwForStatus } from '@vallum/_runtime';
import type {
  GetProfileViewsSummaryOutput,
  GetSocialSellingIndexOutput,
  ListProfileViewersOutput,
  GetCreatorAnalyticsSummaryOutput,
  GetContentAnalyticsOutput,
  GetAudienceDemographicsOutput,
  GetCompanyPageAnalyticsOutput,
  ListCompanyPageViewersOutput,
} from '../schemas';

export async function getProfileViewsSummary(opts: {
  csrf: string;
}): Promise<GetProfileViewsSummaryOutput> {
  interface WvmpResponse {
    included?: Array<{
      $type?: string;
      value?: {
        insightCards?: Array<{
          value?: {
            numViews?: number;
            numViewsChangeInPercentage?: number;
            timeFrame?: string;
            $type?: string;
          };
        }>;
      };
    }>;
  }

  const resp = await linkedinFetch<WvmpResponse>(
    opts.csrf,
    '/voyager/api/identity/wvmpCards',
  );

  let totalViews: number | undefined;
  let changePercentage: number | undefined;
  let timeFrame: string | undefined;

  if (resp.included) {
    for (const entity of resp.included) {
      if (entity.$type?.includes('WvmpCard') && entity.value?.insightCards) {
        for (const card of entity.value.insightCards) {
          if (card.value?.$type?.includes('WvmpSummaryInsightCard')) {
            totalViews = card.value.numViews;
            changePercentage = card.value.numViewsChangeInPercentage;
            timeFrame = card.value.timeFrame;
          }
        }
      }
    }
  }

  return {
    totalViews,
    changePercentage,
    timeFrame,
  };
}

export async function listProfileViewers(opts: {
  csrf: string;
  start?: number;
  count?: number;
}): Promise<ListProfileViewersOutput> {
  const start = opts.start === undefined ? 0 : opts.start;
  const count = opts.count === undefined ? 10 : opts.count;

  interface GraphQLResponse {
    data?: {
      data?: {
        premiumDashAnalyticsObjectByAnalyticsEntity?: {
          elements?: Array<{
            content?: {
              analyticsEntityLockup?: {
                entityLockup?: {
                  title?: { text?: string };
                  subtitle?: { text?: string };
                  caption?: { text?: string };
                  label?: { text?: string };
                  navigationUrl?: string;
                };
                blurred?: boolean;
              };
              promoItem?: unknown;
            };
            style?: string;
          }>;
          paging?: {
            start: number;
            count: number;
            total: number;
          };
        };
      };
    };
    included?: Array<{
      entityUrn?: string;
      $type?: string;
      firstName?: string;
      lastName?: string;
      headline?: string;
      publicIdentifier?: string;
      profilePicture?: unknown;
    }>;
  }

  const vars = {
    start,
    count,
    query: {},
    analyticsEntityUrn: {
      activityUrn: 'urn:li:dummy:-1',
    },
    surfaceType: 'WVMP',
  };

  const encoded = encodeVars(vars);
  const queryId = getQueryId(
    'voyagerPremiumDashAnalyticsObject',
    'analytics-object-union-collection-finder',
  );
  const url = `/voyager/api/graphql?includeWebMetadata=true&variables=${encoded}&queryId=${queryId}`;

  const resp = await linkedinFetch<GraphQLResponse>(opts.csrf, url);

  if (!resp.data?.data?.premiumDashAnalyticsObjectByAnalyticsEntity) {
    throw new ContractDrift(
      'Invalid response from LinkedIn profile viewers API - missing data field',
    );
  }

  const viewerData = resp.data.data.premiumDashAnalyticsObjectByAnalyticsEntity;
  const elements = viewerData.elements;

  if (!elements) {
    throw new ContractDrift(
      'Invalid response from LinkedIn profile viewers API - missing elements',
    );
  }

  const viewers: ListProfileViewersOutput['viewers'] = [];

  const profileMap = new Map<
    string,
    {
      firstName: string;
      lastName: string;
      headline?: string;
      publicIdentifier?: string;
    }
  >();

  if (resp.included) {
    for (const entity of resp.included) {
      if (
        entity.entityUrn &&
        entity.firstName &&
        entity.lastName &&
        (entity.$type ===
          'com.linkedin.voyager.dash.identity.profile.Profile' ||
          entity.$type === 'com.linkedin.voyager.identity.shared.MiniProfile')
      ) {
        profileMap.set(entity.entityUrn, {
          firstName: entity.firstName,
          lastName: entity.lastName,
          headline: entity.headline,
          publicIdentifier: entity.publicIdentifier,
        });
      }
    }
  }

  for (const element of elements) {
    if (element.content?.promoItem) continue;

    const lockup = element.content?.analyticsEntityLockup;
    if (!lockup?.entityLockup) continue;

    const { title, subtitle, caption, label, navigationUrl } =
      lockup.entityLockup;

    let memberId: string | undefined;
    let publicIdentifier: string | undefined;

    if (navigationUrl) {
      const match = navigationUrl.match(/\/in\/([^/]+)/);
      if (match) {
        const segment = match[1];
        if (segment.startsWith('ACo')) {
          memberId = segment;
        } else {
          publicIdentifier = segment;
        }
      }
    }

    const name = title?.text ? title.text : '';
    const headline = subtitle?.text ? subtitle.text : '';
    const viewedAgo = caption?.text ? caption.text : '';
    const connectionDegree = label?.text ? label.text : '';
    const blurred = lockup.blurred === true;

    for (const [urn, profile] of profileMap) {
      const fullName = `${profile.firstName} ${profile.lastName}`.trim();
      if (fullName === name || profile.publicIdentifier === publicIdentifier) {
        publicIdentifier = profile.publicIdentifier;
        if (!memberId) {
          const extracted = urn.split(':').pop();
          if (extracted) {
            memberId = extracted;
          }
        }
        break;
      }
    }

    viewers.push({
      name,
      headline,
      viewedAgo,
      connectionDegree,
      publicIdentifier,
      memberId,
      profileUrl: navigationUrl,
      blurred,
    });
  }

  return {
    viewers,
    paging: {
      start:
        viewerData.paging?.start !== undefined
          ? viewerData.paging.start
          : start,
      count:
        viewerData.paging?.count !== undefined
          ? viewerData.paging.count
          : count,
    },
  };
}

export async function getSocialSellingIndex(opts: {
  csrf: string;
}): Promise<GetSocialSellingIndexOutput> {
  interface SsiSubScore {
    score: number;
    pillar: string;
  }

  interface SsiScore {
    overall: number;
    subScores: SsiSubScore[];
  }

  interface SsiGroupScore {
    rank: number;
    score: SsiScore;
    groupType: string;
    groupSize: number;
    industry?: string;
  }

  interface SsiResponse {
    data?: {
      memberScore: SsiScore;
      groupScore: SsiGroupScore[];
    };
    memberScore?: SsiScore;
    groupScore?: SsiGroupScore[];
  }

  const resp = await linkedinFetch<SsiResponse>(
    opts.csrf,
    'https://www.linkedin.com/sales-api/salesApiSsi',
  );

  const memberScore = resp.data?.memberScore ?? resp.memberScore;
  const groupScore = resp.data?.groupScore ?? resp.groupScore;

  if (!memberScore) {
    throw new UpstreamError(
      'SSI data not available. Ensure you are logged into LinkedIn.',
    );
  }

  const pillarMap: Record<string, number> = {};
  for (const sub of memberScore.subScores) {
    pillarMap[sub.pillar] = sub.score;
  }

  const industryGroup = groupScore?.find((g) => g.groupType === 'INDUSTRY');
  const networkGroup = groupScore?.find((g) => g.groupType === 'NETWORK');

  return {
    score: memberScore.overall,
    pillars: {
      professionalBrand: pillarMap['PROFESSIONAL_BRAND'] ?? 0,
      findRightPeople: pillarMap['FIND_RIGHT_PEOPLE'] ?? 0,
      engageWithInsights: pillarMap['INSIGHT_ENGAGEMENT'] ?? 0,
      buildRelationships: pillarMap['STRONG_RELATIONSHIP'] ?? 0,
    },
    industryComparison: industryGroup
      ? {
          rank: industryGroup.rank,
          averageScore: industryGroup.score.overall,
          industry: industryGroup.industry,
          groupSize: industryGroup.groupSize,
        }
      : undefined,
    networkComparison: networkGroup
      ? {
          rank: networkGroup.rank,
          averageScore: networkGroup.score.overall,
          groupSize: networkGroup.groupSize,
        }
      : undefined,
  };
}

export async function getCreatorAnalyticsSummary(opts: {
  csrf: string;
  memberId: string;
}): Promise<GetCreatorAnalyticsSummaryOutput> {
  const queryId = getQueryId(
    'voyagerFeedDashCreatorExperienceDashboard',
    'get-creator-dashboard',
  );
  const profileUrn = `urn:li:fsd_profile:${opts.memberId}`;
  const url = `/voyager/api/graphql?variables=(profileUrn:${encodeVars(profileUrn)})&queryId=${queryId}`;

  interface AnalyticsPreview {
    creatorAnalyticsType?: string;
    analyticsTitle?: { text?: string };
    description?: { text?: string };
    changeInValue?: number | null;
    changeDateRange?: { text?: string };
    popoverSubtitle?: string;
    navigationUrl?: string;
  }

  interface DashboardSection {
    analyticsSection?: {
      analyticsPreviews?: AnalyticsPreview[];
    };
  }

  interface DashboardResponse {
    data?: {
      data?: {
        feedDashCreatorExperienceDashboard?: {
          section?: DashboardSection[];
        };
      };
    };
  }

  const resp = await linkedinFetch<DashboardResponse>(opts.csrf, url);
  const sections = resp.data?.data?.feedDashCreatorExperienceDashboard?.section;

  if (!sections) {
    throw new ContractDrift(
      'Creator dashboard data not available. Navigate to a LinkedIn page first.',
    );
  }

  const metrics: GetCreatorAnalyticsSummaryOutput['metrics'] = [];

  for (const sec of sections) {
    const previews = sec.analyticsSection?.analyticsPreviews;
    if (!previews) continue;

    for (const preview of previews) {
      metrics.push({
        type: preview.creatorAnalyticsType ?? 'UNKNOWN',
        label: preview.description?.text ?? '',
        value: preview.analyticsTitle?.text ?? '',
        changePercent: preview.changeInValue ?? undefined,
        changePeriod: preview.changeDateRange?.text ?? undefined,
      });
    }
  }

  return { metrics };
}

export async function getContentAnalytics(opts: {
  csrf: string;
  memberId: string;
  timeRange?: string;
  metricType?: string;
}): Promise<GetContentAnalyticsOutput> {
  const timeRange = opts.timeRange ?? 'past_7_days';
  const metricType = opts.metricType ?? 'IMPRESSIONS';
  const profileUrn = `urn:li:fsd_profile:${opts.memberId}`;
  const entityUrn = `urn:li:fsd_edgeInsightsAnalyticsView:(CREATOR_CONTENT,${profileUrn})`;

  const queryId = getQueryId(
    'voyagerPremiumDashLibraView',
    'premium-dash-libra-view-by-target-entity',
  );

  const variables = `(targetEntityUrn:${encodeVars(entityUrn)},product:CREATOR_CONTENT_ANALYTICS,query:(selectedFilters:List((key:resultType,value:List(IMPRESSIONS)),(key:timeRange,value:List(${timeRange})),(key:metricType,value:List(${metricType})))))`;
  const url = `/voyager/api/graphql?variables=${variables}&queryId=${queryId}`;

  interface ListItem {
    description?: { text?: string };
    title?: { text?: string };
    valuePercentageChange?: number;
    valuePercentageDescription?: string;
  }

  interface DataPoint {
    xValue?: string;
    yValue?: number;
    tooltipHeader?: string;
  }

  interface DataSeries {
    yValueUnit?: string;
    points?: DataPoint[];
  }

  interface AnalyticsObject {
    content?: {
      analyticsMiniUpdateItem?: {
        miniUpdate?: {
          entityUrn?: string;
          socialActivityCounts?: {
            numLikes?: number;
            numComments?: number;
          };
        };
      };
    };
  }

  interface LeiaComponent {
    summary?: {
      keyMetrics?: { items?: ListItem[] };
    };
    dataSeriesModule?: {
      dataSeries?: DataSeries[];
    };
    analyticsObjectList?: {
      items?: AnalyticsObject[];
    };
  }

  interface LibraCard {
    title?: { text?: string };
    components?: Array<{
      leiaComponent?: LeiaComponent;
    }>;
  }

  interface LibraViewResponse {
    data?: {
      premiumDashLibraViewByTargetEntity?: {
        elements?: Array<{
          card?: LibraCard[];
        }>;
      };
    };
  }

  // Use plain JSON (not normalized) to get inline card data instead of *card references
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'csrf-token': opts.csrf },
  });
  if (!response.ok) {
    throwForStatus(response.status, `Content analytics API error ${response.status}: ${await response.text().catch(() => undefined)}`);
  }
  const resp: LibraViewResponse = await response.json();
  const cards =
    resp.data?.premiumDashLibraViewByTargetEntity?.elements?.[0]?.card;

  if (!cards || cards.length === 0) {
    throw new UpstreamError(
      'Content analytics not available. Requires LinkedIn Premium or creator mode.',
    );
  }

  // Extract summary metrics from first card
  const summaryCard = cards[0];
  const summaryComp = summaryCard.components?.find(
    (c) => c.leiaComponent?.summary,
  );
  const summaryItems =
    summaryComp?.leiaComponent?.summary?.keyMetrics?.items ?? [];

  const summary: GetContentAnalyticsOutput['summary'] = summaryItems.map(
    (item) => ({
      metric: item.description?.text ?? '',
      value: item.title?.text ?? '',
      changePercent: item.valuePercentageChange,
      changePeriod: item.valuePercentageDescription,
    }),
  );

  // Extract time series data from data series component
  const seriesComp = summaryCard.components?.find(
    (c) => c.leiaComponent?.dataSeriesModule,
  );
  const series = seriesComp?.leiaComponent?.dataSeriesModule?.dataSeries?.[0];
  const timeSeries: GetContentAnalyticsOutput['timeSeries'] = (
    series?.points ?? []
  ).map((dp) => ({
    date: dp.xValue ?? '',
    value: dp.yValue ?? 0,
  }));

  // Extract top posts from the third card (TOP_PERFORMING_POSTS)
  const topPostsCard = cards.find((c) =>
    c.title?.text?.includes('Top performing'),
  );
  const topPostItems =
    topPostsCard?.components?.find((c) => c.leiaComponent?.analyticsObjectList)
      ?.leiaComponent?.analyticsObjectList?.items ?? [];
  const topPosts: GetContentAnalyticsOutput['topPosts'] = topPostItems.map(
    (item) => {
      const mini = item.content?.analyticsMiniUpdateItem?.miniUpdate;
      const activityUrn = mini?.entityUrn;
      // Extract activity ID from URN like "urn:li:fsd_miniUpdate:(urn:li:activity:123,CREATOR_POST_PERFORMANCE)"
      const activityMatch = activityUrn?.match(/activity:(\d+)/);
      return {
        activityId: activityMatch?.[1] ?? '',
        reactions: mini?.socialActivityCounts?.numLikes ?? 0,
        comments: mini?.socialActivityCounts?.numComments ?? 0,
      };
    },
  );

  return {
    timeRange,
    metricType,
    metricUnit: series?.yValueUnit ?? metricType,
    summary,
    timeSeries,
    topPosts,
  };
}

export async function getAudienceDemographics(opts: {
  csrf: string;
  memberId: string;
  timeRange?: string;
}): Promise<GetAudienceDemographicsOutput> {
  const timeRange = opts.timeRange ?? 'past_7_days';
  const profileUrn = `urn:li:fsd_profile:${opts.memberId}`;
  const entityUrn = `urn:li:fsd_edgeInsightsAnalyticsView:(CREATOR_AUDIENCE,${profileUrn})`;

  const queryId = getQueryId(
    'voyagerPremiumDashLibraView',
    'premium-dash-libra-view-by-target-entity',
  );

  const variables = `(targetEntityUrn:${encodeVars(entityUrn)},product:CREATOR_AUDIENCE_ANALYTICS,query:(selectedFilters:List((key:resultType,value:List(AUDIENCES)),(key:timeRange,value:List(${timeRange})))))`;
  const url = `/voyager/api/graphql?variables=${variables}&queryId=${queryId}`;

  interface MeterBar {
    title?: { text?: string };
    subtitle?: { text?: string };
    meterPercent?: number;
    meterFormattedValue?: { text?: string };
  }

  interface MeterBarList {
    meterBars?: MeterBar[];
  }

  interface ListItem {
    description?: { text?: string };
    title?: { text?: string };
    valuePercentageChange?: number;
    valuePercentageDescription?: string;
  }

  interface LibraViewResponse {
    data?: {
      premiumDashLibraViewByTargetEntity?: {
        elements?: Array<{
          card?: Array<{
            title?: { text?: string };
            components?: Array<{
              leiaComponent?: {
                summary?: {
                  keyMetrics?: { items?: ListItem[] };
                };
                customComponent?: {
                  creatorComponent?: {
                    meterBars?: MeterBarList;
                  };
                };
              };
            }>;
          }>;
        }>;
      };
    };
  }

  // Use plain JSON (not normalized) to get inline card data instead of *card references
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'csrf-token': opts.csrf },
  });
  if (!response.ok) {
    throwForStatus(response.status, `Audience demographics API error ${response.status}: ${await response.text().catch(() => undefined)}`);
  }
  const resp: LibraViewResponse = await response.json();
  const cards =
    resp.data?.premiumDashLibraViewByTargetEntity?.elements?.[0]?.card;

  if (!cards || cards.length === 0) {
    throw new UpstreamError(
      'Audience demographics not available. Requires LinkedIn Premium or creator mode.',
    );
  }

  // Extract follower summary from first card
  const summaryCard = cards[0];
  const summaryComp = summaryCard.components?.find(
    (c) => c.leiaComponent?.summary,
  );
  const summaryItems =
    summaryComp?.leiaComponent?.summary?.keyMetrics?.items ?? [];

  const followerSummary: GetAudienceDemographicsOutput['followerSummary'] =
    summaryItems.map((item) => ({
      metric: item.description?.text ?? '',
      value: item.title?.text ?? '',
      changePercent: item.valuePercentageChange,
      changePeriod: item.valuePercentageDescription,
    }));

  // Extract demographics from second card (meter bars)
  const demographicsCard = cards.find((c) =>
    c.title?.text?.includes('demographics'),
  );
  const meterBarsComp = demographicsCard?.components?.find(
    (c) => c.leiaComponent?.customComponent?.creatorComponent?.meterBars,
  );
  const meterBars =
    meterBarsComp?.leiaComponent?.customComponent?.creatorComponent?.meterBars
      ?.meterBars ?? [];

  const demographics: GetAudienceDemographicsOutput['demographics'] =
    meterBars.map((bar) => ({
      category: bar.subtitle?.text ?? '',
      value: bar.title?.text ?? '',
      percentage: bar.meterPercent ?? 0,
    }));

  return {
    timeRange,
    followerSummary,
    demographics,
  };
}

export async function getCompanyPageAnalytics(opts: {
  csrf: string;
  companyId: string;
  surfaceType?: string;
  startTime?: number;
  endTime?: number;
}): Promise<GetCompanyPageAnalyticsOutput> {
  const surfaceType = opts.surfaceType ?? 'ORGANIZATION_VISITORS';
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const startTime = opts.startTime ?? thirtyDaysAgo;
  const endTime = opts.endTime ?? now;

  const queryId = getQueryId(
    'voyagerPremiumDashAnalyticsView',
    'get-premium-dash-analytics-view-by-analytics-entity',
  );

  // Build filters based on surface type
  const filters: string[] = [
    `(key:timeRange,value:List(${startTime},${endTime}))`,
  ];

  if (surfaceType === 'ORGANIZATION_VISITORS') {
    filters.push('(key:resultType,value:List(PAGE_VIEWS))');
    filters.push('(key:pageType,value:List(ALL_PAGES))');
  }

  const companyUrn = `urn:li:fsd_company:${opts.companyId}`;
  const variables = `(analyticsEntityUrn:(company:${encodeVars(companyUrn)}),surfaceType:${surfaceType},query:(selectedFilters:List(${filters.join(',')})))`;
  const url = `/voyager/api/graphql?variables=${variables}&queryId=${queryId}`;

  interface ListItem {
    description?: { text?: string };
    title?: { text?: string };
    valuePercentageChange?: number | null;
    valuePercentageDescription?: string;
  }

  interface CardComponent {
    summary?: { keyMetrics?: { items?: ListItem[] } };
    infoList?: { items?: ListItem[] };
    dataSeriesModule?: {
      dataSeries?: Array<{
        yValueUnit?: string;
        points?: Array<{
          xValue?: string;
          yValue?: number;
          tooltipHeader?: string;
        }>;
      }>;
    };
  }

  interface AnalyticsViewResponse {
    data?: {
      premiumDashAnalyticsViewByAnalyticsEntity?: {
        elements?: Array<{
          title?: { text?: string };
          sections?: Array<{
            card?: Array<{
              title?: { text?: string };
              components?: CardComponent[];
            }>;
          }>;
        }>;
      };
    };
  }

  // Use plain JSON (not normalized) for inline data
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'csrf-token': opts.csrf },
  });
  if (!response.ok) {
    throwForStatus(response.status, `Company analytics API error ${response.status}: ${await response.text().catch(() => undefined)}`);
  }
  const resp: AnalyticsViewResponse = await response.json();
  const element =
    resp.data?.premiumDashAnalyticsViewByAnalyticsEntity?.elements?.[0];

  if (!element) {
    throw new UpstreamError(
      'Company page analytics not available. Ensure you are an admin of the company page.',
    );
  }

  const metrics: GetCompanyPageAnalyticsOutput['metrics'] = [];
  const timeSeries: GetCompanyPageAnalyticsOutput['timeSeries'] = [];

  for (const section of element.sections ?? []) {
    for (const card of section.card ?? []) {
      // Extract metrics from infoList or summary
      const infoItems =
        card.components?.find((c) => c.infoList)?.infoList?.items ??
        card.components?.find((c) => c.summary)?.summary?.keyMetrics?.items ??
        [];

      for (const item of infoItems) {
        metrics.push({
          label: item.description?.text ?? '',
          value: item.title?.text ?? '',
          changePercent: item.valuePercentageChange ?? undefined,
        });
      }

      // Extract time series data
      const series = card.components?.find((c) => c.dataSeriesModule)
        ?.dataSeriesModule?.dataSeries?.[0];
      if (series?.points) {
        for (const point of series.points) {
          timeSeries.push({
            date: point.xValue ?? '',
            value: point.yValue ?? 0,
          });
        }
      }
    }
  }

  return {
    surfaceType,
    title: element.title?.text ?? surfaceType,
    metrics,
    timeSeries,
  };
}

export async function listCompanyPageViewers(opts: {
  csrf: string;
  companyId: string;
  start?: number;
  count?: number;
}): Promise<ListCompanyPageViewersOutput> {
  const start = opts.start ?? 0;

  const queryId = getQueryId(
    'voyagerPremiumDashAnalyticsObject',
    'analytics-object-union-collection-finder',
  );

  const companyUrn = `urn:li:fsd_company:${opts.companyId}`;
  const variables = `(start:${start},query:(),analyticsEntityUrn:(company:${encodeVars(companyUrn)}),surfaceType:ORGANIZATION_VIEWER_OF_THE_DAY)`;
  const url = `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`;

  interface EntityLockup {
    title?: { text?: string };
    subtitle?: { text?: string };
    caption?: { text?: string };
    label?: { text?: string };
    navigationUrl?: string;
  }

  interface InsightItem {
    text?: { text?: string };
  }

  interface ViewerElement {
    content?: {
      analyticsEntityLockup?: {
        entityLockup?: EntityLockup;
        insights?: InsightItem[];
        insightsV2?: InsightItem[];
        blurred?: boolean;
      };
      promoItem?: unknown;
    };
  }

  interface ViewerResponse {
    data?: {
      data?: {
        premiumDashAnalyticsObjectByAnalyticsEntity?: {
          elements?: ViewerElement[];
          paging?: { start: number; count: number; total: number };
        };
      };
    };
  }

  const resp = await linkedinFetch<ViewerResponse>(opts.csrf, url);
  const viewerData =
    resp.data?.data?.premiumDashAnalyticsObjectByAnalyticsEntity;

  if (!viewerData) {
    throw new ContractDrift(
      'Company page visitor data not available. Ensure you are an admin of the company page.',
    );
  }

  const viewers: ListCompanyPageViewersOutput['viewers'] = [];

  for (const element of viewerData.elements ?? []) {
    if (element.content?.promoItem) continue;

    const lockup = element.content?.analyticsEntityLockup;
    if (!lockup?.entityLockup) continue;

    const { title, subtitle, caption, label, navigationUrl } =
      lockup.entityLockup;

    // insightsV2 array on analyticsEntityLockup contains location, industry, and timestamp
    const insights = lockup.insightsV2 ?? lockup.insights ?? [];
    const insightTexts = insights.map((i) => i.text?.text ?? '');

    // Find timestamp insight (starts with "Shown")
    const viewedAgo =
      insightTexts.find((t) => t.startsWith('Shown')) ?? caption?.text ?? '';

    // Location is typically the first insight (city, state format)
    // Industry insight contains "Works in ... industry"
    let location = '';
    let industry = '';
    for (const text of insightTexts) {
      if (text.startsWith('Works in ')) {
        industry = text.replace(/^Works in /, '').replace(/ industry$/, '');
      } else if (!text.startsWith('Shown') && text.length > 0) {
        location = text;
      }
    }

    let memberId: string | undefined;
    let publicIdentifier: string | undefined;

    if (navigationUrl) {
      const match = navigationUrl.match(/\/in\/([^/]+)/);
      if (match) {
        const segment = match[1];
        if (segment.startsWith('ACo')) {
          memberId = segment;
        } else {
          publicIdentifier = segment;
        }
      }
    }

    viewers.push({
      name: title?.text ?? '',
      headline: subtitle?.text ?? '',
      viewedAgo,
      connectionDegree: label?.text ?? '',
      location,
      industry,
      publicIdentifier,
      memberId,
      profileUrl: navigationUrl,
      blurred: lockup.blurred === true,
    });
  }

  return {
    viewers,
    paging: {
      start: viewerData.paging?.start ?? start,
      count: viewerData.paging?.count ?? viewers.length,
      total: viewerData.paging?.total ?? 0,
    },
  };
}
