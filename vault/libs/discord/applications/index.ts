import type {
  Application,
  Entitlement,
  ListApplicationsInput,
  ListApplicationsOutput,
  ListOauthTokensInput,
  ListOauthTokensOutput,
  ListApplicationEntitlementsInput,
  ListApplicationEntitlementsOutput,
  ListEntitlementsInput,
  ListEntitlementsOutput,
  ListGamesInput,
  ListGamesOutput,
  ListGameExclusionsInput,
  ListGameExclusionsOutput,
} from '../schemas';
import { discordFetch, buildQuery } from '../helpers';

export async function listApplications(
  params: ListApplicationsInput,
): Promise<ListApplicationsOutput> {
  const qs = buildQuery({ application_ids: params.applicationIds });
  const applications = await discordFetch<Application[]>(
    params.token,
    `/applications/public${qs}`,
  );
  return { applications };
}

export async function listOauthTokens(
  params: ListOauthTokensInput,
): Promise<ListOauthTokensOutput> {
  const qs = buildQuery({ application_ids: params.applicationId });
  const tokens = await discordFetch<unknown[]>(
    params.token,
    `/oauth2/tokens${qs}`,
  );
  return { tokens };
}

export async function listApplicationEntitlements(
  params: ListApplicationEntitlementsInput,
): Promise<ListApplicationEntitlementsOutput> {
  const qs = buildQuery({ exclude_consumed: params.excludeConsumed ?? true });
  const entitlements = await discordFetch<Entitlement[]>(
    params.token,
    `/users/@me/applications/${params.applicationId}/entitlements${qs}`,
  );
  return { entitlements };
}

export async function listEntitlements(
  params: ListEntitlementsInput,
): Promise<ListEntitlementsOutput> {
  const qs = buildQuery({
    entitlement_type:
      params.entitlementType === undefined ? 11 : params.entitlementType,
    with_sku: params.withSku ?? false,
    with_application: params.withApplication ?? false,
    exclude_ended: params.excludeEnded ?? true,
  });
  const entitlements = await discordFetch<Entitlement[]>(
    params.token,
    `/users/@me/entitlements${qs}`,
  );
  return { entitlements };
}

export async function listGames(
  params: ListGamesInput,
): Promise<ListGamesOutput> {
  const qs = buildQuery({
    game_ids: params.gameIds,
    with_supplemental_data: params.withSupplementalData ?? true,
  });
  const games = await discordFetch<ListGamesOutput['games']>(
    params.token,
    `/games${qs}`,
  );
  return { games };
}

export async function listGameExclusions(
  params: ListGameExclusionsInput,
): Promise<ListGameExclusionsOutput> {
  return discordFetch<ListGameExclusionsOutput>(
    params.token,
    '/games/detectable/exclusions',
  );
}
