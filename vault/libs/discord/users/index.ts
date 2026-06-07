import type {
  GetUserProfileInput,
  GetUserProfileOutput,
  GetInboxInput,
  GetInboxOutput,
  ListBillingSubscriptionsInput,
  ListBillingSubscriptionsOutput,
  ListMfaCredentialsInput,
  ListMfaCredentialsOutput,
  ListPaymentSourcesInput,
  ListPaymentSourcesOutput,
  ListUnclaimedGamesInput,
  ListUnclaimedGamesOutput,
  GetReferralEligibilityInput,
  GetReferralEligibilityOutput,
  GetUserSettingsInput,
  GetUserSettingsOutput,
  PaymentSource,
  Subscription,
  UpdateUserSettingsInput,
  UpdateUserSettingsOutput,
} from '../schemas';
import { discordFetch, buildQuery, awaitCapturedFingerprint } from '../helpers';

export async function getUserProfile(
  params: GetUserProfileInput,
): Promise<GetUserProfileOutput> {
  const { token, userId } = params;
  const type = params.type ?? 'sidebar';
  // Match Discord's UI param defaults per profile type: popout flips
  // with_mutual_friends and with_mutual_friends_count from the sidebar pair.
  const popout = type === 'popout';
  const fingerprint = await awaitCapturedFingerprint();
  const qs = buildQuery({
    type,
    with_mutual_guilds: params.withMutualGuilds ?? true,
    with_mutual_friends: params.withMutualFriends ?? popout,
    with_mutual_friends_count: params.withMutualFriendsCount ?? !popout,
    guild_id: params.guildId,
  });
  return discordFetch<GetUserProfileOutput>(
    token,
    `/users/${userId}/profile${qs}`,
    { headers: { ...fingerprint } },
  );
}

export async function getInbox(params: GetInboxInput): Promise<GetInboxOutput> {
  const qs = buildQuery({ for_game_profile: false, feature: 'inbox' });
  return discordFetch<GetInboxOutput>(
    params.token,
    `/content-inventory/users/@me${qs}`,
  );
}

export async function listMfaCredentials(
  params: ListMfaCredentialsInput,
): Promise<ListMfaCredentialsOutput> {
  const credentials = await discordFetch<
    ListMfaCredentialsOutput['credentials']
  >(params.token, '/users/@me/mfa/webauthn/credentials');
  return { credentials };
}

export async function getReferralEligibility(
  params: GetReferralEligibilityInput,
): Promise<GetReferralEligibilityOutput> {
  // Discord returns HTTP 404 with `{code: 0, message: "404: Not Found"}` for users
  // who aren't enrolled in the referral program. That's an expected outcome, not an error.
  return discordFetch<GetReferralEligibilityOutput>(
    params.token,
    '/users/@me/referrals/eligibility',
    { tolerateStatuses: [404] },
  );
}

export async function getUserSettings(
  params: GetUserSettingsInput,
): Promise<GetUserSettingsOutput> {
  const { token, version } = params;
  return discordFetch<GetUserSettingsOutput>(
    token,
    `/users/@me/settings-proto/${version}`,
  );
}

export async function updateUserSettings(
  params: UpdateUserSettingsInput,
): Promise<UpdateUserSettingsOutput> {
  const { token, settings } = params;
  return discordFetch<UpdateUserSettingsOutput>(
    token,
    '/users/@me/settings-proto/1',
    { method: 'PATCH', body: { settings } },
  );
}

export async function listUnclaimedGames(
  params: ListUnclaimedGamesInput,
): Promise<ListUnclaimedGamesOutput> {
  return discordFetch<ListUnclaimedGamesOutput>(
    params.token,
    '/users/@me/unclaimed-games',
  );
}

export async function listPaymentSources(
  params: ListPaymentSourcesInput,
): Promise<ListPaymentSourcesOutput> {
  const paymentSources = await discordFetch<PaymentSource[]>(
    params.token,
    '/users/@me/billing/payment-sources',
  );
  return { paymentSources };
}

export async function listBillingSubscriptions(
  params: ListBillingSubscriptionsInput,
): Promise<ListBillingSubscriptionsOutput> {
  const qs = buildQuery({ sync_level: params.syncLevel ?? 2 });
  const subscriptions = await discordFetch<Subscription[]>(
    params.token,
    `/users/@me/billing/subscriptions${qs}`,
  );
  return { subscriptions };
}
