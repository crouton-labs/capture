import { getViewerUserId, graphql } from './helpers';
import type {
  ListMarketplaceFeedInput,
  GetMarketplaceListingInput,
  GetMarketplaceListingImagesInput,
  SaveMarketplaceListingInput,
  UnsaveMarketplaceListingInput,
  ListMarketplaceNotificationsInput,
  GetMarketplaceCategoriesInput,
  GetMarketplaceBadgeCountInput,
  MarketplaceResponse,
} from './schemas-marketplace';

export async function listMarketplaceFeed(
  params: ListMarketplaceFeedInput,
): Promise<MarketplaceResponse> {
  const userId = getViewerUserId();
  return graphql<MarketplaceResponse>(
    userId,
    '26378026188555471',
    'MarketplaceCometBrowseFeedLightContainerQuery',
    {
      buyLocation: params.buyLocation,
      count: params.count,
      cursor: params.cursor ?? null,
      imageWidth: 256,
      mediaType: 'image/jpeg',
      radius: params.radius,
      scale: 1,
      shouldIncludeStory: false,
      sizing: 'cover-fill-cropped',
      useSDFPath: true,
      __relay_internal__pv__MarketplaceCometAdmodulerelayprovider: true,
    },
    { routeName: 'comet.fbweb.CometMarketplaceRoot.react' },
  );
}

export async function getMarketplaceListing(
  params: GetMarketplaceListingInput,
): Promise<MarketplaceResponse> {
  const userId = getViewerUserId();
  return graphql<MarketplaceResponse>(
    userId,
    '35755258257406018',
    'MarketplacePDPContainerQuery',
    {
      enableJobEmployerActionBar: false,
      enableJobSeekerActionBar: false,
      feedbackSource: 56,
      feedLocation: 'MARKETPLACE_MEGAMALL',
      referralCode: 'marketplace_top_picks',
      referralSurfaceString: 'browse_tab',
      scale: 1,
      targetId: params.targetId,
      useDefaultActor: false,
    },
    { routeName: 'comet.fbweb.CometMarketplacePermalinkRoute' },
  );
}

export async function getMarketplaceListingImages(
  params: GetMarketplaceListingImagesInput,
): Promise<MarketplaceResponse> {
  const userId = getViewerUserId();
  return graphql<MarketplaceResponse>(
    userId,
    '10059604367394414',
    'MarketplacePDPC2CMediaViewerWithImagesQuery',
    { targetId: params.targetId },
  );
}

export async function saveMarketplaceListing(
  params: SaveMarketplaceListingInput,
): Promise<MarketplaceResponse> {
  const userId = getViewerUserId();
  return graphql<MarketplaceResponse>(
    userId,
    '9587699291311838',
    'useCometMarketplaceSaveAsStoryMutation',
    {
      input: {
        actor_id: userId,
        save_mechanism: 'SAVED_ADD',
        save_surface: 'MARKETPLACE_PRODUCT_DETAILS',
        story_id: params.storyId,
      },
    },
  );
}

export async function unsaveMarketplaceListing(
  params: UnsaveMarketplaceListingInput,
): Promise<MarketplaceResponse> {
  const userId = getViewerUserId();
  return graphql<MarketplaceResponse>(
    userId,
    '24145675458439589',
    'useCometMarketplaceUnsaveAsStoryMutation',
    {
      input: {
        actor_id: userId,
        save_mechanism: 'SAVED_ADD',
        save_surface: 'MARKETPLACE_PRODUCT_DETAILS',
        story_id: params.storyId,
      },
    },
  );
}

export async function listMarketplaceNotifications(
  _params: ListMarketplaceNotificationsInput,
): Promise<MarketplaceResponse> {
  const userId = getViewerUserId();
  return graphql<MarketplaceResponse>(
    userId,
    '34445319445083085',
    'CometMarketplaceNotificationsListContainerQuery',
    { isCOBMOB: false, scale: 1 },
  );
}

export async function getMarketplaceCategories(
  params: GetMarketplaceCategoriesInput,
): Promise<MarketplaceResponse> {
  const userId = getViewerUserId();
  return graphql<MarketplaceResponse>(
    userId,
    '24640314145552071',
    'CometMarketplaceLeftRailNavigationContainerQuery',
    {
      buyLocation: params.buyLocation,
      category_ranking_enabled: false,
      hide_l2_cats: true,
    },
  );
}

export async function getMarketplaceBadgeCount(
  _params: GetMarketplaceBadgeCountInput,
): Promise<MarketplaceResponse> {
  const userId = getViewerUserId();
  return graphql<MarketplaceResponse>(
    userId,
    '9094296764003442',
    'useCometMarketplaceBadgeCountQuery',
    {},
  );
}
