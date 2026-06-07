import type {
  ListPromotionsInput,
  ListPromotionsOutput,
  ListCollectiblesMarketingInput,
  ListCollectiblesMarketingOutput,
  ListGuildStoreSkusInput,
  ListGuildStoreSkusOutput,
  GetCheckoutRecoveryInput,
  GetCheckoutRecoveryOutput,
  CreateUserOfferInput,
  CreateUserOfferOutput,
  GetStorefrontConfigInput,
  GetStorefrontConfigOutput,
  GetStorefrontEligibilityInput,
  GetStorefrontEligibilityOutput,
  StoreSkuListing,
} from '../schemas';
import { discordFetch, buildQuery } from '../helpers';

export async function listPromotions(
  params: ListPromotionsInput,
): Promise<ListPromotionsOutput> {
  const qs = buildQuery({
    locale: params.locale ?? 'en-US',
    platform: params.platform ?? 0,
  });
  const promotions = await discordFetch<ListPromotionsOutput['promotions']>(
    params.token,
    `/promotions${qs}`,
  );
  return { promotions };
}

export async function listCollectiblesMarketing(
  params: ListCollectiblesMarketingInput,
): Promise<ListCollectiblesMarketingOutput> {
  const qs = buildQuery({ platform: params.platform ?? 0 });
  return discordFetch<ListCollectiblesMarketingOutput>(
    params.token,
    `/users/@me/collectibles-marketing${qs}`,
  );
}

export async function getCheckoutRecovery(
  params: GetCheckoutRecoveryInput,
): Promise<GetCheckoutRecoveryOutput> {
  return discordFetch<GetCheckoutRecoveryOutput>(
    params.token,
    '/users/@me/billing/checkout-recovery',
  );
}

export async function createUserOffer(
  params: CreateUserOfferInput,
): Promise<CreateUserOfferOutput> {
  return discordFetch<CreateUserOfferOutput>(
    params.token,
    '/users/@me/billing/user-offer',
    { method: 'POST', body: params.body },
  );
}

export async function getStorefrontConfig(
  params: GetStorefrontConfigInput,
): Promise<GetStorefrontConfigOutput> {
  return discordFetch<GetStorefrontConfigOutput>(
    params.token,
    '/partner-sdk/storefront-config',
  );
}

export async function getStorefrontEligibility(
  params: GetStorefrontEligibilityInput,
): Promise<GetStorefrontEligibilityOutput> {
  return discordFetch<GetStorefrontEligibilityOutput>(
    params.token,
    '/partner-sdk/storefront-eligibility',
  );
}

export async function listGuildStoreSkus(
  params: ListGuildStoreSkusInput,
): Promise<ListGuildStoreSkusOutput> {
  const qs = buildQuery({
    country_code: params.countryCode ?? 'US',
    application_id: params.applicationId,
    guild_id: params.guildId,
  });
  const listings = await discordFetch<StoreSkuListing[]>(
    params.token,
    `/store/published-listings/skus${qs}`,
  );
  return { listings };
}
