/**
 * LinkedIn Profile Operations
 *
 * Profile viewing, enrichment, and activity feed operations.
 */

import type {
  GetMeOutput,
  GetProfileByVanityNameOutput,
  GetFullProfileInput,
  GetFullProfileOutput,
  GetContactInfoOutput,
  GetProfileBadgesOutput,
  DownloadProfilePictureOutput,
} from '../schemas';
import type { FileRef } from '../../files/schemas';
import {
  linkedinFetch,
  buildEntityMap,
  encodeVars,
  getQueryId,
} from '../helpers';
import { ContractDrift, NotFound, UpstreamError, throwForStatus } from '@vallum/_runtime';

interface DateObj {
  month?: number;
  year?: number;
}

interface PositionDescription {
  title: string;
  company: string;
  description: string;
}

interface ParsedProfileCards {
  aboutText?: string;
  positionDescriptions: PositionDescription[];
  educationDetails: Array<{
    schoolName?: string;
    activities?: string;
    description?: string;
  }>;
  volunteering: Array<{
    organization?: string;
    role?: string;
    cause?: string;
    description?: string;
    startDate?: DateObj;
    endDate?: DateObj;
  }>;
  certifications: Array<{
    name?: string;
    issuingOrganization?: string;
    issueDate?: DateObj;
    credentialId?: string;
    credentialUrl?: string;
  }>;
  languages: Array<{ name?: string; proficiency?: string }>;
  courses: Array<{ name?: string; number?: string }>;
  projects: Array<{
    name?: string;
    description?: string;
    url?: string;
    startDate?: DateObj;
    endDate?: DateObj;
  }>;
  publications: Array<{
    title?: string;
    publisher?: string;
    date?: DateObj;
    url?: string;
    description?: string;
  }>;
  honors: Array<{
    title?: string;
    issuer?: string;
    date?: DateObj;
    description?: string;
  }>;
  organizations: Array<{
    name?: string;
    role?: string;
    startDate?: DateObj;
    endDate?: DateObj;
  }>;
  patents: Array<{
    title?: string;
    patentNumber?: string;
    status?: string;
    url?: string;
    description?: string;
    issueDate?: DateObj;
  }>;
  testScores: Array<{ name?: string; score?: string; date?: DateObj }>;
  // for "rich" mode: basic name/headline from profileCards
  firstName?: string;
  lastName?: string;
  headline?: string;
  profilePicture?: string;
}

interface TextViewModel {
  text?: string;
}

interface TextComponent {
  text?: TextViewModel;
}

interface EntityComponent {
  titleV2?: { text?: TextViewModel };
  subtitle?: TextViewModel;
  caption?: TextViewModel;
  metadata?: TextViewModel;
  subComponents?: {
    components?: Array<{
      components?: {
        textComponent?: TextComponent;
        fixedListComponent?: {
          components?: Array<{
            components?: {
              textComponent?: TextComponent;
              entityComponent?: EntityComponent;
            };
          }>;
        };
        insightComponent?: { text?: TextViewModel };
      };
    }>;
  };
  // image for profile picture
  image?: {
    attributes?: Array<{
      detailData?: {
        nonEntityProfilePicture?: {
          vectorImage?: {
            rootUrl?: string;
            artifacts?: Array<{ fileIdentifyingUrlPathSegment?: string }>;
          };
        };
      };
    }>;
  };
}

interface ProfileCardsResponse {
  included?: Array<{
    entityUrn?: string;
    topComponents?: Array<{
      components?: {
        textComponent?: TextComponent;
        entityComponent?: EntityComponent;
        fixedListComponent?: {
          components?: Array<{
            components?: {
              entityComponent?: EntityComponent;
            };
          }>;
        };
      };
    }>;
  }>;
}

function extractTextFromSubComponents(ec: EntityComponent): string | undefined {
  for (const sub of ec.subComponents?.components ?? []) {
    const textComp = sub.components?.textComponent;
    if (textComp?.text?.text) return textComp.text.text;

    const nestedList = sub.components?.fixedListComponent;
    if (nestedList?.components) {
      for (const nested of nestedList.components) {
        const nestedText = nested.components?.textComponent;
        if (nestedText?.text?.text) return nestedText.text.text;
      }
    }
  }
  return undefined;
}

function extractInsightFromSubComponents(
  ec: EntityComponent,
): string | undefined {
  for (const sub of ec.subComponents?.components ?? []) {
    const insight = sub.components?.insightComponent?.text?.text;
    if (insight) return insight;
  }
  return undefined;
}

/**
 * Parse all profile card types from the ProfileCards GraphQL response.
 */
function parseProfileCards(resp: ProfileCardsResponse): ParsedProfileCards {
  const result: ParsedProfileCards = {
    positionDescriptions: [],
    educationDetails: [],
    volunteering: [],
    certifications: [],
    languages: [],
    courses: [],
    projects: [],
    publications: [],
    honors: [],
    organizations: [],
    patents: [],
    testScores: [],
  };

  if (!resp.included) return result;

  for (const entity of resp.included) {
    const urn = entity.entityUrn;
    if (!urn) continue;

    // ABOUT card
    if (urn.includes(',ABOUT,')) {
      for (const comp of entity.topComponents ?? []) {
        const text = comp.components?.textComponent?.text?.text;
        if (text) {
          result.aboutText = text;
          break;
        }
      }
    }

    // TOP_CARD (name, headline, picture)
    if (urn.includes(',TOP_CARD,')) {
      for (const comp of entity.topComponents ?? []) {
        const ec = comp.components?.entityComponent;
        if (!ec) continue;
        const title = ec.titleV2?.text?.text;
        const subtitle = ec.subtitle?.text;
        if (title && !result.firstName) {
          const parts = title.trim().split(/\s+/);
          result.firstName = parts[0];
          result.lastName = parts.slice(1).join(' ') || undefined;
        }
        if (subtitle && !result.headline) result.headline = subtitle;

        // Profile picture
        const attrs = ec.image?.attributes ?? [];
        for (const attr of attrs) {
          const vec = attr.detailData?.nonEntityProfilePicture?.vectorImage;
          if (vec?.rootUrl && vec.artifacts?.length) {
            const largest = vec.artifacts[vec.artifacts.length - 1];
            if (largest.fileIdentifyingUrlPathSegment) {
              result.profilePicture =
                vec.rootUrl + largest.fileIdentifyingUrlPathSegment;
            }
          }
        }
      }
    }

    // EXPERIENCE card
    if (urn.includes(',EXPERIENCE,') && !urn.includes('VOLUNTEERING')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const posComp of fixedList.components) {
          const ec = posComp.components?.entityComponent;
          if (!ec) continue;
          const title = ec.titleV2?.text?.text;
          const company = ec.subtitle?.text;
          if (!title || !company) continue;
          const description = extractTextFromSubComponents(ec);
          if (description) {
            result.positionDescriptions.push({ title, company, description });
          }
        }
      }
    }

    // EDUCATION card
    if (urn.includes(',EDUCATION,')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const eduComp of fixedList.components) {
          const ec = eduComp.components?.entityComponent;
          if (!ec) continue;
          const schoolName = ec.titleV2?.text?.text;
          const description = extractTextFromSubComponents(ec);
          const activities = extractInsightFromSubComponents(ec);
          if (schoolName) {
            result.educationDetails.push({
              schoolName,
              description,
              activities,
            });
          }
        }
      }
    }

    // VOLUNTEERING_EXPERIENCE card
    if (
      urn.includes(',VOLUNTEERING_EXPERIENCE,') ||
      urn.includes(',VOLUNTEERING,')
    ) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const volComp of fixedList.components) {
          const ec = volComp.components?.entityComponent;
          if (!ec) continue;
          const role = ec.titleV2?.text?.text;
          const organization = ec.subtitle?.text;
          const cause = ec.caption?.text ?? ec.metadata?.text;
          const description = extractTextFromSubComponents(ec);
          result.volunteering.push({ role, organization, cause, description });
        }
      }
    }

    // LICENSES_AND_CERTIFICATIONS card
    if (
      urn.includes(',LICENSES_AND_CERTIFICATIONS,') ||
      urn.includes(',CERTIFICATIONS,')
    ) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const certComp of fixedList.components) {
          const ec = certComp.components?.entityComponent;
          if (!ec) continue;
          const name = ec.titleV2?.text?.text;
          const issuingOrganization = ec.subtitle?.text;
          const dateText = ec.caption?.text ?? ec.metadata?.text;
          let issueDate: DateObj | undefined;
          if (dateText) {
            const yearMatch = dateText.match(/\b(\d{4})\b/);
            if (yearMatch) issueDate = { year: parseInt(yearMatch[1]) };
          }
          const credentialText = extractTextFromSubComponents(ec);
          result.certifications.push({
            name,
            issuingOrganization,
            issueDate,
            credentialId: credentialText,
          });
        }
      }
    }

    // LANGUAGES card
    if (urn.includes(',LANGUAGES,')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const langComp of fixedList.components) {
          const ec = langComp.components?.entityComponent;
          if (!ec) continue;
          const name = ec.titleV2?.text?.text;
          const proficiency = ec.subtitle?.text ?? ec.caption?.text;
          if (name) result.languages.push({ name, proficiency });
        }
      }
    }

    // COURSES card
    if (urn.includes(',COURSES,')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const courseComp of fixedList.components) {
          const ec = courseComp.components?.entityComponent;
          if (!ec) continue;
          const name = ec.titleV2?.text?.text;
          const number = ec.subtitle?.text;
          if (name) result.courses.push({ name, number });
        }
      }
    }

    // PROJECTS card
    if (urn.includes(',PROJECTS,')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const projComp of fixedList.components) {
          const ec = projComp.components?.entityComponent;
          if (!ec) continue;
          const name = ec.titleV2?.text?.text;
          const description = extractTextFromSubComponents(ec);
          if (name) result.projects.push({ name, description });
        }
      }
    }

    // PUBLICATIONS card
    if (urn.includes(',PUBLICATIONS,')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const pubComp of fixedList.components) {
          const ec = pubComp.components?.entityComponent;
          if (!ec) continue;
          const title = ec.titleV2?.text?.text;
          const publisher = ec.subtitle?.text;
          const description = extractTextFromSubComponents(ec);
          if (title)
            result.publications.push({ title, publisher, description });
        }
      }
    }

    // HONORS_AND_AWARDS card
    if (urn.includes(',HONORS_AND_AWARDS,') || urn.includes(',HONORS,')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const honorComp of fixedList.components) {
          const ec = honorComp.components?.entityComponent;
          if (!ec) continue;
          const title = ec.titleV2?.text?.text;
          const issuer = ec.subtitle?.text;
          const dateText = ec.caption?.text ?? ec.metadata?.text;
          let date: DateObj | undefined;
          if (dateText) {
            const yearMatch = dateText.match(/\b(\d{4})\b/);
            if (yearMatch) date = { year: parseInt(yearMatch[1]) };
          }
          const description = extractTextFromSubComponents(ec);
          if (title) result.honors.push({ title, issuer, date, description });
        }
      }
    }

    // ORGANIZATIONS card
    if (urn.includes(',ORGANIZATIONS,')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const orgComp of fixedList.components) {
          const ec = orgComp.components?.entityComponent;
          if (!ec) continue;
          const name = ec.titleV2?.text?.text;
          const role = ec.subtitle?.text;
          if (name) result.organizations.push({ name, role });
        }
      }
    }

    // PATENTS card
    if (urn.includes(',PATENTS,')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const patentComp of fixedList.components) {
          const ec = patentComp.components?.entityComponent;
          if (!ec) continue;
          const title = ec.titleV2?.text?.text;
          const patentNumber = ec.subtitle?.text;
          const description = extractTextFromSubComponents(ec);
          if (title) result.patents.push({ title, patentNumber, description });
        }
      }
    }

    // TEST_SCORES card
    if (urn.includes(',TEST_SCORES,')) {
      for (const topComp of entity.topComponents ?? []) {
        const fixedList = topComp.components?.fixedListComponent;
        if (!fixedList?.components) continue;

        for (const scoreComp of fixedList.components) {
          const ec = scoreComp.components?.entityComponent;
          if (!ec) continue;
          const name = ec.titleV2?.text?.text;
          const score = ec.subtitle?.text;
          if (name) result.testScores.push({ name, score });
        }
      }
    }
  }

  return result;
}

/**
 * Fetch profile cards data from LinkedIn's ProfileCards GraphQL endpoint.
 * Returns all available card sections in one call.
 */
async function fetchProfileCards(
  csrf: string,
  memberId: string,
): Promise<ParsedProfileCards> {
  const profileUrn = `urn:li:fsd_profile:${memberId}`;
  const queryId = getQueryId(
    'voyagerIdentityDashProfileCards',
    'profile-cards-by-initial-cards',
  );
  const variables = encodeVars({ profileUrn });

  const empty: ParsedProfileCards = {
    positionDescriptions: [],
    educationDetails: [],
    volunteering: [],
    certifications: [],
    languages: [],
    courses: [],
    projects: [],
    publications: [],
    honors: [],
    organizations: [],
    patents: [],
    testScores: [],
  };

  try {
    const resp = await linkedinFetch<ProfileCardsResponse>(
      csrf,
      `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`,
    );
    return parseProfileCards(resp);
  } catch {
    return empty;
  }
}

interface MeResponse {
  data?: {
    plainId?: number;
    premiumSubscriber?: boolean;
    '*miniProfile'?: string;
  };
  included?: Array<{
    entityUrn?: string;
    firstName?: string;
    lastName?: string;
    occupation?: string;
    publicIdentifier?: string;
    picture?: {
      rootUrl?: string;
      artifacts?: Array<{ fileIdentifyingUrlPathSegment?: string }>;
    };
  }>;
}

export async function getMe(opts: { csrf: string }): Promise<GetMeOutput> {
  const resp = await linkedinFetch<MeResponse>(opts.csrf, '/voyager/api/me');
  const miniProfileUrn = resp.data?.['*miniProfile'];

  if (!miniProfileUrn) {
    throw new ContractDrift('Could not extract miniProfile URN from /me response.');
  }

  const memberId = miniProfileUrn.split(':').pop();
  if (!memberId) {
    throw new ContractDrift(`Could not parse member ID from URN: ${miniProfileUrn}`);
  }

  // Extract actual miniProfile from included array
  const miniProfileEntity = resp.included?.find(
    (e) => e.entityUrn === miniProfileUrn,
  );

  let profilePicture: string | undefined;
  if (
    miniProfileEntity?.picture?.rootUrl &&
    miniProfileEntity.picture.artifacts?.length
  ) {
    const largest =
      miniProfileEntity.picture.artifacts[
        miniProfileEntity.picture.artifacts.length - 1
      ];
    if (largest.fileIdentifyingUrlPathSegment) {
      profilePicture =
        miniProfileEntity.picture.rootUrl +
        largest.fileIdentifyingUrlPathSegment;
    }
  }

  return {
    memberId,
    miniProfile: miniProfileEntity
      ? {
          firstName: miniProfileEntity.firstName,
          lastName: miniProfileEntity.lastName,
          occupation: miniProfileEntity.occupation,
          publicIdentifier: miniProfileEntity.publicIdentifier,
          profilePicture,
        }
      : undefined,
  };
}

export async function getProfileByVanityName(opts: {
  csrf: string;
  vanityName: string;
}): Promise<GetProfileByVanityNameOutput> {
  // Try REST API first (no queryId needed); extract name fields from included array
  interface RestProfileResponse {
    data?: {
      entityUrn?: string;
      firstName?: string;
      lastName?: string;
      headline?: string;
      '*miniProfile'?: string;
    };
    included?: Array<{
      entityUrn?: string;
      firstName?: string;
      lastName?: string;
      headline?: string;
      occupation?: string;
    }>;
  }

  try {
    const resp = await linkedinFetch<RestProfileResponse>(
      opts.csrf,
      `/voyager/api/identity/normalizedProfiles/${opts.vanityName}`,
    );

    // Extract memberId from data or included
    let memberId: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;
    let headline: string | undefined;

    // Check data.entityUrn
    if (resp.data?.entityUrn) {
      const parts = resp.data.entityUrn.split(':');
      memberId = parts[parts.length - 1];
      firstName = resp.data.firstName;
      lastName = resp.data.lastName;
      headline = resp.data.headline;
    }

    // Check included array for profile entity with richer data
    if (resp.included) {
      for (const entity of resp.included) {
        if (
          entity.entityUrn &&
          (entity.entityUrn.includes('fsd_profile:') ||
            entity.entityUrn.includes('fs_normalized_profile:'))
        ) {
          const parts = entity.entityUrn.split(':');
          const id = parts[parts.length - 1];
          if (id) {
            memberId = memberId ?? id;
            firstName = firstName ?? entity.firstName;
            lastName = lastName ?? entity.lastName;
            headline = headline ?? entity.headline ?? entity.occupation;
          }
        }
      }
    }

    if (memberId) {
      return { memberId, firstName, lastName, headline };
    }
  } catch {
    // REST failed, fall through to GraphQL
  }

  // Fall back to GraphQL (needs queryId discovery)
  const queryId = getQueryId('voyagerIdentityDashProfiles');
  const variables = encodeVars({ vanityName: opts.vanityName });

  const resp = await linkedinFetch<{ included?: unknown[] }>(
    opts.csrf,
    `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`,
  );

  // Find profile entity in included
  if (!resp.included) {
    throw new NotFound(
      `No profile data found for vanity name: ${opts.vanityName}`,
    );
  }

  for (const entity of resp.included) {
    const e = entity as {
      entityUrn?: string;
      firstName?: string;
      lastName?: string;
      headline?: string;
    };

    if (e.entityUrn?.startsWith('urn:li:fsd_profile:')) {
      const memberId = e.entityUrn.split(':').pop();
      if (!memberId) continue;

      return {
        memberId,
        firstName: e.firstName,
        lastName: e.lastName,
        headline: e.headline,
      };
    }
  }

  throw new NotFound(`Profile not found for vanity name: ${opts.vanityName}`);
}

export async function getFullProfile(
  opts: GetFullProfileInput,
): Promise<GetFullProfileOutput> {
  if (!opts.memberId) {
    throw new UpstreamError(
      'memberId is required. Pass an ACo... member ID or a vanity name string (e.g., "john-smith"). The parameter key is always "memberId" regardless.',
    );
  }

  const fetchMode: 'full' | 'basic' | 'rich' =
    opts.fetchMode === 'full' || opts.fetchMode === 'rich'
      ? opts.fetchMode
      : 'basic';

  let memberId = opts.memberId;

  // If memberId doesn't look like a member ID, resolve via vanity name.
  // For "rich" mode we still need a proper member ID for the profileCards call.
  if (!opts.memberId.startsWith('ACo')) {
    const profile = await getProfileByVanityName({
      csrf: opts.csrf,
      vanityName: opts.memberId,
    });
    memberId = profile.memberId;
  }

  // ── "rich" mode: profileCards only ──────────────────────────────────────
  if (fetchMode === 'rich') {
    const cards = await fetchProfileCards(opts.csrf, memberId);

    const educations = cards.educationDetails.map((e) => ({
      schoolName: e.schoolName,
      activities: e.activities,
      description: e.description,
    }));

    return {
      memberId,
      firstName: cards.firstName,
      lastName: cards.lastName,
      fullName:
        cards.firstName || cards.lastName
          ? [cards.firstName, cards.lastName].filter(Boolean).join(' ')
          : undefined,
      headline: cards.headline,
      summary: cards.aboutText,
      educations: educations.length > 0 ? educations : undefined,
      positions: cards.positionDescriptions.map((pd) => ({
        title: pd.title,
        companyName: pd.company,
        description: pd.description,
      })),
      volunteering:
        cards.volunteering.length > 0 ? cards.volunteering : undefined,
      certifications:
        cards.certifications.length > 0 ? cards.certifications : undefined,
      languages: cards.languages.length > 0 ? cards.languages : undefined,
      courses: cards.courses.length > 0 ? cards.courses : undefined,
      projects: cards.projects.length > 0 ? cards.projects : undefined,
      publications:
        cards.publications.length > 0 ? cards.publications : undefined,
      honors: cards.honors.length > 0 ? cards.honors : undefined,
      organizations:
        cards.organizations.length > 0 ? cards.organizations : undefined,
      patents: cards.patents.length > 0 ? cards.patents : undefined,
      testScores: cards.testScores.length > 0 ? cards.testScores : undefined,
    };
  }

  // ── "basic" and "full" modes: normalizedProfiles ─────────────────────────
  interface ProfileResponse {
    data?: {
      entityUrn?: string;
      firstName?: string;
      lastName?: string;
      headline?: string;
      publicIdentifier?: string;
      profileUrl?: string;
      distance?: string;
      location?: { locationDisplayName?: string };
      geoLocation?: string;
      mostRecentPosition?: { title?: string; companyName?: string };
      positions?: Array<{
        title?: string;
        companyName?: string;
        company?: string;
        description?: string;
        startedOn?: { month?: number; year?: number };
        endedOn?: { month?: number; year?: number };
        geoLocation?: string;
      }>;
      educations?: Array<{
        schoolName?: string;
        degree?: string;
        fieldOfStudy?: string;
        startedOn?: { year?: number };
        endedOn?: { year?: number };
      }>;
      skills?: string[];
      confirmedEmailAddresses?: string[];
      '*followingInfo'?: string;
    };
    included?: unknown[];
  }

  let resp: ProfileResponse;
  try {
    resp = await linkedinFetch<ProfileResponse>(
      opts.csrf,
      `/voyager/api/identity/normalizedProfiles/${memberId}`,
    );
  } catch (e) {
    const error = e as Error;
    if (
      error.message &&
      (error.message.includes('410') || error.message.includes('404'))
    ) {
      throw new NotFound(
        `Profile not available for member ID: ${memberId}. The profile may have been deactivated or restricted.`,
      );
    }
    throw e;
  }

  const profileData = resp.data;
  if (!profileData) {
    throw new ContractDrift(`No profile data returned for member ID: ${memberId}`);
  }

  const entityMap = buildEntityMap(resp.included);

  // Extract positions
  const positions = profileData.positions
    ? profileData.positions.map((pos) => {
        // API returns "company": "urn:li:fs_normalized_company:XXXXX"
        const companyId = pos.company
          ? pos.company.split(':').pop()
          : undefined;
        return {
          title: pos.title,
          companyName: pos.companyName,
          companyId,
          description: pos.description,
          startDate: pos.startedOn
            ? { month: pos.startedOn.month, year: pos.startedOn.year }
            : undefined,
          endDate: pos.endedOn
            ? { month: pos.endedOn.month, year: pos.endedOn.year }
            : undefined,
          current: !pos.endedOn,
          location: pos.geoLocation
            ? (entityMap[pos.geoLocation] as { localizedName?: string })
                ?.localizedName
            : undefined,
        };
      })
    : [];

  // Extract educations
  const educations = profileData.educations
    ? profileData.educations.map((edu) => ({
        schoolName: edu.schoolName,
        degreeName: edu.degree,
        fieldOfStudy: edu.fieldOfStudy,
        startDate: edu.startedOn?.year
          ? { year: edu.startedOn.year }
          : undefined,
        endDate: edu.endedOn?.year ? { year: edu.endedOn.year } : undefined,
      }))
    : [];

  // Extract skills; API returns flat string array, not objects
  const skills = profileData.skills
    ? profileData.skills.filter(
        (s): s is string => typeof s === 'string' && !!s,
      )
    : [];

  // Fetch email via memberHandles endpoint (works for own profile / SELF).
  const emails: string[] = [];
  if (profileData.distance === 'SELF') {
    try {
      interface MemberHandlesResponse {
        included?: Array<{
          handleDetailUnion?: {
            emailAddress?: { emailAddress?: string; confirmed?: boolean };
          };
          state?: string;
        }>;
      }
      const handles = await linkedinFetch<MemberHandlesResponse>(
        opts.csrf,
        '/voyager/api/voyagerOnboardingDashMemberHandles?primary=true&q=criteria&type=EMAIL',
      );
      if (handles.included) {
        for (const el of handles.included) {
          const email = el.handleDetailUnion?.emailAddress?.emailAddress;
          if (email) emails.push(email);
        }
      }
    } catch {
      // memberHandles not available
    }
  }

  // Extract follower count
  let followerCount: number | undefined;
  const followingInfoRef = profileData['*followingInfo'];
  if (followingInfoRef) {
    const followingInfo = entityMap[followingInfoRef] as
      | { followerCount?: number }
      | undefined;
    followerCount = followingInfo?.followerCount;
  }

  // Extract location
  let location: string | undefined;
  if (profileData.location?.locationDisplayName) {
    location = profileData.location.locationDisplayName;
  } else if (profileData.geoLocation) {
    const geo = entityMap[profileData.geoLocation] as
      | { localizedName?: string; defaultLocalizedName?: string }
      | undefined;
    location = geo?.localizedName
      ? geo.localizedName
      : geo?.defaultLocalizedName;
  }

  // ── "basic" mode: return without profileCards ────────────────────────────
  if (fetchMode === 'basic') {
    return {
      memberId,
      firstName: profileData.firstName,
      lastName: profileData.lastName,
      fullName: [profileData.firstName, profileData.lastName]
        .filter(Boolean)
        .join(' '),
      headline: profileData.headline,
      location,
      distance: profileData.distance,
      followerCount,
      profileUrl: profileData.profileUrl
        ? profileData.profileUrl
        : `https://www.linkedin.com/in/${profileData.publicIdentifier}`,
      currentPosition: profileData.mostRecentPosition
        ? {
            title: profileData.mostRecentPosition.title,
            companyName: profileData.mostRecentPosition.companyName,
          }
        : undefined,
      positions,
      educations,
      skills,
      emails,
    };
  }

  // ── "full" mode: fetch profileCards and merge ────────────────────────────
  const profileCards = await fetchProfileCards(opts.csrf, memberId);

  // Merge position descriptions into positions array by matching title + company
  for (const pos of positions) {
    if (pos.description) continue;
    const match = profileCards.positionDescriptions.find(
      (pd) =>
        pd.title === pos.title &&
        pos.companyName !== undefined &&
        pd.company.startsWith(pos.companyName),
    );
    if (match) {
      pos.description = match.description;
    }
  }

  // Merge education details (activities, description) by school name
  for (const edu of educations) {
    const detail = profileCards.educationDetails.find(
      (d) => d.schoolName === edu.schoolName,
    );
    if (detail) {
      if (detail.activities) {
        (edu as Record<string, unknown>)['activities'] = detail.activities;
      }
      if (detail.description) {
        (edu as Record<string, unknown>)['description'] = detail.description;
      }
    }
  }

  return {
    memberId,
    firstName: profileData.firstName,
    lastName: profileData.lastName,
    fullName: [profileData.firstName, profileData.lastName]
      .filter(Boolean)
      .join(' '),
    headline: profileData.headline,
    summary: profileCards.aboutText,
    location,
    distance: profileData.distance,
    followerCount,
    profileUrl: profileData.profileUrl
      ? profileData.profileUrl
      : `https://www.linkedin.com/in/${profileData.publicIdentifier}`,
    currentPosition: profileData.mostRecentPosition
      ? {
          title: profileData.mostRecentPosition.title,
          companyName: profileData.mostRecentPosition.companyName,
        }
      : undefined,
    positions,
    educations,
    skills,
    emails,
    volunteering:
      profileCards.volunteering.length > 0
        ? profileCards.volunteering
        : undefined,
    certifications:
      profileCards.certifications.length > 0
        ? profileCards.certifications
        : undefined,
    languages:
      profileCards.languages.length > 0 ? profileCards.languages : undefined,
    courses: profileCards.courses.length > 0 ? profileCards.courses : undefined,
    projects:
      profileCards.projects.length > 0 ? profileCards.projects : undefined,
    publications:
      profileCards.publications.length > 0
        ? profileCards.publications
        : undefined,
    honors: profileCards.honors.length > 0 ? profileCards.honors : undefined,
    organizations:
      profileCards.organizations.length > 0
        ? profileCards.organizations
        : undefined,
    patents: profileCards.patents.length > 0 ? profileCards.patents : undefined,
    testScores:
      profileCards.testScores.length > 0 ? profileCards.testScores : undefined,
  };
}

export async function getContactInfo(opts: {
  csrf: string;
  memberId: string;
}): Promise<GetContactInfoOutput> {
  let vanityName = opts.memberId;
  let resolvedMemberId = opts.memberId;

  // If member ID (ACo...), resolve to vanity name first
  if (opts.memberId.startsWith('ACo')) {
    const profile = await getProfileByVanityName({
      csrf: opts.csrf,
      vanityName: opts.memberId,
    });
    // getProfileByVanityName returns memberId; we need the publicIdentifier
    // Fetch it via normalizedProfiles
    const profileResp = await linkedinFetch<{
      data?: { publicIdentifier?: string };
    }>(opts.csrf, `/voyager/api/identity/normalizedProfiles/${opts.memberId}`);
    vanityName = profileResp.data?.publicIdentifier || opts.memberId;
    resolvedMemberId = profile.memberId;
  } else {
    // vanityName provided; resolve member ID
    const profile = await getProfileByVanityName({
      csrf: opts.csrf,
      vanityName: opts.memberId,
    });
    resolvedMemberId = profile.memberId;
  }

  interface ContactInfoProfile {
    entityUrn?: string;
    publicIdentifier?: string;
    emailAddress?: { emailAddress?: string };
    phoneNumbers?: Array<{ phoneNumber?: { number?: string } }>;
    websites?: Array<{ url?: string; category?: string }>;
    twitterHandles?: Array<{ name?: string }>;
    birthDateOn?: { month?: number; day?: number } | null;
    address?: string | null;
    instantMessengers?: Array<{ provider?: string; id?: string }> | null;
  }

  interface ContactInfoResponse {
    data?: {
      '*elements'?: string[];
    };
    included?: Array<ContactInfoProfile & Record<string, unknown>>;
  }

  const resp = await linkedinFetch<ContactInfoResponse>(
    opts.csrf,
    `/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanityName)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.ProfileContactInfo-13`,
  );

  // Resolve profile entity from included array via *elements URN refs
  const elementUrns = resp.data?.['*elements'] || [];
  const profileUrn = elementUrns[0];
  const element = resp.included?.find((e) => e.entityUrn === profileUrn) as
    | ContactInfoProfile
    | undefined;

  if (!element) {
    throw new NotFound(`Profile not found for: ${opts.memberId}`);
  }

  // Extract member ID from entityUrn if available
  if (element.entityUrn) {
    const parts = element.entityUrn.split(':');
    const urnMemberId = parts[parts.length - 1];
    if (urnMemberId) {
      resolvedMemberId = urnMemberId;
    }
  }

  if (element.publicIdentifier) {
    vanityName = element.publicIdentifier;
  }

  const phoneNumbers = element.phoneNumbers
    ?.map((p) => p.phoneNumber?.number)
    .filter((n): n is string => !!n);

  const websites = element.websites
    ?.map((w) => ({
      url: w.url!,
      category: w.category || undefined,
    }))
    .filter((w) => !!w.url);

  const twitterHandles = element.twitterHandles
    ?.map((t) => t.name)
    .filter((n): n is string => !!n);

  const ims = element.instantMessengers
    ?.map((im) => ({
      provider: im.provider!,
      handle: im.id!,
    }))
    .filter((im) => !!im.provider && !!im.handle);

  return {
    memberId: resolvedMemberId,
    vanityName,
    email: element.emailAddress?.emailAddress || undefined,
    phoneNumbers: phoneNumbers?.length ? phoneNumbers : undefined,
    websites: websites?.length ? websites : undefined,
    twitterHandles: twitterHandles?.length ? twitterHandles : undefined,
    birthday:
      element.birthDateOn?.month != null && element.birthDateOn?.day != null
        ? { month: element.birthDateOn.month, day: element.birthDateOn.day }
        : undefined,
    address: element.address || undefined,
    ims: ims?.length ? ims : undefined,
  };
}

export async function getProfileBadges(opts: {
  csrf: string;
  memberId: string;
}): Promise<GetProfileBadgesOutput> {
  let memberId = opts.memberId;

  // Resolve vanity name to member ID if needed
  if (!opts.memberId.startsWith('ACo')) {
    const profile = await getProfileByVanityName({
      csrf: opts.csrf,
      vanityName: opts.memberId,
    });
    memberId = profile.memberId;
  }

  const profileUrn = `urn:li:fsd_profile:${memberId}`;
  const queryId = getQueryId(
    'voyagerIdentityDashOpenToCards',
    'open-to-cards-by-top-card',
  );
  const variables = encodeVars({ profileUrn });

  interface OpenToCardsResponse {
    data?: {
      data?: {
        identityDashOpenToCardsByTopCard?: {
          elements?: Array<{
            card?: {
              enrolledCard?: {
                cardTypeForTracking?: string;
                title?: { text?: string };
                description?: string;
              };
            };
          }>;
        };
      };
    };
  }

  const resp = await linkedinFetch<OpenToCardsResponse>(
    opts.csrf,
    `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`,
  );

  const elements =
    resp.data?.data?.identityDashOpenToCardsByTopCard?.elements ?? [];

  let openToWork = false;
  let hiring = false;
  let openToWorkDetails: { title: string; description: string } | undefined;
  let hiringDetails: { title: string; description: string } | undefined;

  for (const element of elements) {
    const card = element.card?.enrolledCard;
    if (!card?.cardTypeForTracking) continue;

    if (card.cardTypeForTracking === 'CAREER_INTEREST') {
      openToWork = true;
      if (card.title?.text || card.description) {
        openToWorkDetails = {
          title: card.title?.text ?? 'Open to work',
          description: card.description ?? '',
        };
      }
    } else if (card.cardTypeForTracking === 'HIRING_MANAGER') {
      hiring = true;
      if (card.title?.text || card.description) {
        hiringDetails = {
          title: card.title?.text ?? 'Hiring',
          description: card.description ?? '',
        };
      }
    }
  }

  return {
    memberId,
    openToWork,
    hiring,
    openToWorkDetails,
    hiringDetails,
  };
}

declare const window: Window & {
  __vallum_files?: {
    write(
      name: string,
      data: string | ArrayBuffer | Uint8Array | Blob,
    ): Promise<FileRef>;
  };
};

export async function downloadProfilePicture(opts: {
  csrf: string;
  memberId: string;
  size?: 'small' | 'medium' | 'large';
}): Promise<DownloadProfilePictureOutput> {
  let memberId = opts.memberId;
  let vanityName: string | undefined;

  // Resolve vanity name to member ID if needed
  if (!opts.memberId.startsWith('ACo')) {
    vanityName = opts.memberId;
    const profile = await getProfileByVanityName({
      csrf: opts.csrf,
      vanityName: opts.memberId,
    });
    memberId = profile.memberId;
  }

  // Fetch profile to get picture data
  const lookupId = vanityName ?? memberId;

  interface ProfilePictureResponse {
    data?: {
      profilePicture?: {
        rootUrl?: string;
        artifacts?: Array<{
          width?: number;
          height?: number;
          fileIdentifyingUrlPathSegment?: string;
        }>;
      };
      firstName?: string;
      lastName?: string;
      publicIdentifier?: string;
    };
  }

  const resp = await linkedinFetch<ProfilePictureResponse>(
    opts.csrf,
    `/voyager/api/identity/normalizedProfiles/${lookupId}`,
  );

  const pic = resp.data?.profilePicture;
  if (!pic?.rootUrl || !pic.artifacts?.length) {
    return {
      memberId,
      imageUrl: null,
      filePath: null,
      sizeBytes: null,
    };
  }

  // Sort artifacts by size (extracted from the path segment prefix like "800_800/")
  const sorted = [...pic.artifacts].sort((a, b) => {
    const aSize =
      parseInt(
        (a.fileIdentifyingUrlPathSegment ?? '').split('/')[0].split('_')[0],
      ) || 0;
    const bSize =
      parseInt(
        (b.fileIdentifyingUrlPathSegment ?? '').split('/')[0].split('_')[0],
      ) || 0;
    return aSize - bSize;
  });

  // Pick artifact based on requested size
  const size = opts.size ?? 'large';
  let artifact: (typeof sorted)[0];
  if (size === 'small') {
    artifact = sorted[0];
  } else if (size === 'medium') {
    artifact = sorted[Math.floor(sorted.length / 2)];
  } else {
    artifact = sorted[sorted.length - 1];
  }

  if (!artifact.fileIdentifyingUrlPathSegment) {
    return {
      memberId,
      imageUrl: null,
      filePath: null,
      sizeBytes: null,
    };
  }

  const imageUrl = pic.rootUrl + artifact.fileIdentifyingUrlPathSegment;

  // Fetch the image
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) {
    throwForStatus(imgResp.status, `Failed to download profile picture: ${imgResp.status} ${imgResp.statusText}. URL: ${imageUrl}`);
  }

  const arrayBuffer = await imgResp.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Build filename from profile name
  const name = [resp.data?.firstName, resp.data?.lastName]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  const filename = `${name || memberId}-profile-picture.jpg`;

  let filePath: string | null = null;
  if (typeof window !== 'undefined' && window.__vallum_files) {
    const fileRef = await window.__vallum_files.write(filename, bytes);
    filePath = fileRef.path;
  }

  return {
    memberId,
    imageUrl,
    filePath,
    sizeBytes: bytes.length,
  };
}
