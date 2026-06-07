/**
 * DoorDash Library
 *
 * Browser-executable DoorDash operations via GraphQL API.
 * Requires user to be logged into DoorDash.
 */

import type {
  GetContextOutput,
  SearchStoresInput,
  SearchStoresOutput,
  GetStoreMenuInput,
  GetStoreMenuOutput,
  GetItemDetailsInput,
  GetItemDetailsOutput,
  GetStoreFeedInput,
  GetStoreFeedOutput,
  StoreFeedCarousel,
  GetStoreDetailsInput,
  GetStoreDetailsOutput,
  GetStoreReviewsInput,
  GetStoreReviewsOutput,
  GetSavedStoresInput,
  GetSavedStoresOutput,
  SaveStoreInput,
  SaveStoreOutput,
  UnsaveStoreInput,
  UnsaveStoreOutput,
  ListOrdersInput,
  ListOrdersOutput,
  GetOrderInput,
  GetOrderOutput,
  TrackOrderInput,
  TrackOrderOutput,
  ReorderInput,
  ReorderOutput,
  GetCartInput,
  GetCartOutput,
  AddToCartInput,
  AddToCartOutput,
  RemoveFromCartInput,
  RemoveFromCartOutput,
  UpdateCartItemInput,
  UpdateCartItemOutput,
  ApplyPromoCodeInput,
  ApplyPromoCodeOutput,
  RemovePromoCodeInput,
  RemovePromoCodeOutput,
  ListAddressesInput,
  ListAddressesOutput,
  AddAddressInput,
  AddAddressOutput,
  UpdateAddressInput,
  UpdateAddressOutput,
  DeleteAddressInput,
  DeleteAddressOutput,
  ListPaymentMethodsInput,
  ListPaymentMethodsOutput,
  GetCreditsBalanceInput,
  GetCreditsBalanceOutput,
  GetDashPassStatusInput,
  GetDashPassStatusOutput,
  Address,
  RateOrderInput,
  RateOrderOutput,
  ReportIssueInput,
  ReportIssueOutput,
  GetIssueStatusInput,
  GetIssueStatusOutput,
  GetAvailablePromotionsInput,
  GetAvailablePromotionsOutput,
  RedeemGiftCardInput,
  RedeemGiftCardOutput,
  CreateGroupOrderInput,
  CreateGroupOrderOutput,
  GetGroupOrderInput,
  GetGroupOrderOutput,
} from './schemas';

// Re-export types
export type {
  GetContextOutput,
  SearchStoresOutput,
  GetStoreMenuOutput,
  GetItemDetailsOutput,
  GetStoreFeedOutput,
  StoreFeedCarousel,
  GetStoreDetailsOutput,
  GetStoreReviewsOutput,
  GetSavedStoresOutput,
  SaveStoreOutput,
  UnsaveStoreOutput,
  ListOrdersOutput,
  GetOrderOutput,
  TrackOrderOutput,
  ReorderOutput,
  GetCartOutput,
  AddToCartOutput,
  RemoveFromCartOutput,
  UpdateCartItemOutput,
  ApplyPromoCodeOutput,
  RemovePromoCodeOutput,
  ListAddressesOutput,
  AddAddressOutput,
  UpdateAddressOutput,
  DeleteAddressOutput,
  ListPaymentMethodsOutput,
  GetCreditsBalanceOutput,
  GetDashPassStatusOutput,
  Address,
  RateOrderOutput,
  ReportIssueOutput,
  GetIssueStatusOutput,
  GetAvailablePromotionsOutput,
  RedeemGiftCardOutput,
  CreateGroupOrderOutput,
  GetGroupOrderOutput,
};

import { Validation, ContractDrift, NotFound, Unauthenticated, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Helpers
// ============================================================================

function getCookie(name: string): string | undefined {
  const match = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.split('=').slice(1).join('=') : undefined;
}

function getRequiredHeaders(csrf: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-csrftoken': csrf,
    'x-channel-id': 'marketplace',
    'x-experience-id': 'doordash',
    'apollographql-client-name': '@doordash/app-consumer-production-ssr-client',
    'apollographql-client-version': '3.0',
  };
}

async function graphql<T>(
  csrf: string,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const origin = window.location.origin;
  const url = `${origin}/graphql/${operationName}?operation=${operationName}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...getRequiredHeaders(csrf), ...extraHeaders },
    body: JSON.stringify({ operationName, variables, query }),
    credentials: 'include',
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const json = await resp.json();
  if (json.errors && json.errors.length > 0) {
    throw new ContractDrift(
      `DoorDash GraphQL ${operationName} error: ${JSON.stringify(json.errors[0])}`,
    );
  }

  return json.data as T;
}

// ============================================================================
// getContext
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  const csrf = getCookie('csrf_token');
  if (!csrf) {
    throw new Unauthenticated(
      `CSRF token not found in cookies. URL: ${window.location.href}`,
    );
  }

  const loggedIn = getCookie('dd_cx_logged_in') === 'true';
  if (!loggedIn) {
    throw new Unauthenticated(
      `User is not logged in to DoorDash. URL: ${window.location.href}`,
    );
  }

  const consumerId = getCookie('ajs_user_id') || '';
  const marketId = getCookie('dd_market_id') || '';
  const locale = getCookie('dd_locale') || 'en-US';
  const deviceId = getCookie('dd_device_id') || '';
  const sessionId = getCookie('dd_session_id') || '';
  const deviceSessionId = getCookie('dd_device_session_id') || '';
  const lastLoginMethod = getCookie('dd_last_login_method') || '';
  const lastLoginAction = getCookie('dd_last_login_action') || '';

  return {
    csrf,
    consumerId,
    loggedIn,
    marketId,
    locale,
    deviceId,
    sessionId,
    deviceSessionId,
    lastLoginMethod,
    lastLoginAction,
  };
}

// ============================================================================
// searchStores
// ============================================================================

const AUTOCOMPLETE_QUERY = `query autocompleteFacetFeed($query: String!, $serializedBundleGlobalSearchContext: String) {
  autocompleteFacetFeed(
    query: $query
    serializedBundleGlobalSearchContext: $serializedBundleGlobalSearchContext
  ) {
    body {
      id
      body {
        id
        component {
          id
          category
          __typename
        }
        text {
          title
          subtitle
          __typename
        }
        images {
          icon {
            local
            __typename
          }
          __typename
        }
        events {
          click {
            name
            data
            __typename
          }
          __typename
        }
        custom
        __typename
      }
      __typename
    }
    __typename
  }
}`;

const AUTOCOMPLETE_HEADERS: Record<string, string> = {
  'x-facets-feature-item-carousel': 'true',
  'x-facets-version': '4.0.0',
  'x-facets-entry': 'autocomplete',
  'x-facets-platform': 'desktop',
  'x-facets-feature-grid-standard': 'true',
  'x-facets-feature-no-tile': 'true',
  'x-facets-feature-backend-driven-badges': 'true',
  'x-facets-feature-store-carousel-redesign-round-1': 'treatmentVariant2',
  'x-facets-feature-store-cell-redesign-round-3': 'treatmentVariant3',
  'x-facets-feature-cuisine-filter-v2': 'true',
  'x-facets-feature-row-card-container': 'true',
  'x-facets-feature-item-steppers': 'true',
  'x-facets-feature-tall-logo-carousel': 'true',
  'x-facets-feature-logo-merchandising': 'true',
};

interface FacetItem {
  id: string | null;
  component: { id: string; category: string } | null;
  text: { title: string | null; subtitle: string | null } | null;
  custom: string | null;
  events: {
    click: { name: string; data: string } | null;
  } | null;
}

interface AutocompleteResponse {
  autocompleteFacetFeed: {
    body: Array<{
      id: string | null;
      body: FacetItem[];
    }>;
  };
}

export async function searchStores(
  input: SearchStoresInput,
): Promise<SearchStoresOutput> {
  const variables: Record<string, unknown> = { query: input.query };
  if (input.serializedBundleGlobalSearchContext !== undefined) {
    variables.serializedBundleGlobalSearchContext =
      input.serializedBundleGlobalSearchContext;
  }
  const data = await graphql<AutocompleteResponse>(
    input.csrf,
    'autocompleteFacetFeed',
    AUTOCOMPLETE_QUERY,
    variables,
    AUTOCOMPLETE_HEADERS,
  );

  const stores: SearchStoresOutput['stores'] = [];
  const suggestions: string[] = [];

  const body = data.autocompleteFacetFeed?.body || [];
  for (const section of body) {
    for (const item of section.body || []) {
      if (!item.text?.title) continue;

      let customData: Record<string, unknown> = {};
      if (item.custom) {
        try {
          customData = JSON.parse(item.custom);
        } catch {
          // ignore parse errors
        }
      }

      if (
        customData.result_type === 'STORE' &&
        typeof customData.store_id === 'string'
      ) {
        const rating = customData.rating as
          | { average: number; count_display_string: string }
          | undefined;
        stores.push({
          storeId: customData.store_id,
          name: item.text.title,
          rating: rating
            ? {
                average: rating.average,
                countDisplay: rating.count_display_string || '',
              }
            : null,
          resultType: 'STORE',
        });
      } else if (
        !customData.result_type ||
        customData.result_type !== 'STORE'
      ) {
        suggestions.push(item.text.title);
      }
    }
  }

  return { stores, suggestions };
}

// ============================================================================
// getStoreMenu
// ============================================================================

const STOREPAGE_FEED_QUERY = `query storepageFeed($storeId: ID!, $menuId: ID, $isMerchantPreview: Boolean, $fulfillmentType: FulfillmentType, $cursor: String, $scheduledTime: String, $entryPoint: StoreEntryPoint) {
  storepageFeed(storeId: $storeId, menuId: $menuId, isMerchantPreview: $isMerchantPreview, fulfillmentType: $fulfillmentType, cursor: $cursor, scheduledTime: $scheduledTime, entryPoint: $entryPoint) {
    storeHeader {
      id
      name
      description
      priceRange
      priceRangeDisplayString
      offersDelivery
      offersPickup
      offersScheduling
      isDashpassPartner
      address { displayAddress __typename }
      deliveryFeeLayout { title displayDeliveryFee __typename }
      deliveryTimeLayout { title __typename }
      ratings { numRatings numRatingsDisplayString averageRating isNewlyAdded __typename }
      status {
        delivery { isAvailable minutes __typename }
        pickup { isAvailable minutes __typename }
        __typename
      }
      __typename
    }
    mxInfo {
      website
      phoneno
      operationInfo {
        operationStatusInfo { description operationStatus __typename }
        storeOperationHourInfo {
          operationSchedule { dayOfWeek timeSlotList __typename }
          __typename
        }
        __typename
      }
      __typename
    }
    menuBook {
      id
      name
      displayOpenHours
      menuCategories { id name numItems __typename }
      __typename
    }
    itemLists {
      id
      name
      description
      items {
        id
        name
        description
        displayPrice
        displayStrikethroughPrice
        imageUrl
        ratingDisplayString
        badges { title __typename }
        quickAddContext { isEligible __typename }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

interface StorepageFeedResponse {
  storepageFeed: {
    storeHeader: {
      id: string;
      name: string;
      description: string;
      priceRange: number;
      priceRangeDisplayString: string;
      offersDelivery: boolean;
      offersPickup: boolean;
      offersScheduling: boolean;
      isDashpassPartner: boolean;
      address: { displayAddress: string } | null;
      deliveryFeeLayout: {
        title: string | null;
        displayDeliveryFee: string | null;
      } | null;
      deliveryTimeLayout: { title: string | null } | null;
      ratings: {
        numRatings: number;
        numRatingsDisplayString: string;
        averageRating: number;
        isNewlyAdded: boolean;
      } | null;
      status: {
        delivery: { isAvailable: boolean; minutes: number | null };
        pickup: { isAvailable: boolean; minutes: number | null };
      } | null;
    };
    mxInfo: {
      website: string | null;
      phoneno: string | null;
      operationInfo: {
        operationStatusInfo: {
          description: string;
          operationStatus: string;
        } | null;
        storeOperationHourInfo: {
          operationSchedule: Array<{
            dayOfWeek: string;
            timeSlotList: string[];
          }>;
        } | null;
      } | null;
    } | null;
    menuBook: {
      id: string;
      name: string;
      displayOpenHours: string;
      menuCategories: Array<{
        id: string;
        name: string;
        numItems: number;
      }>;
    };
    itemLists: Array<{
      id: string;
      name: string;
      description: string | null;
      items: Array<{
        id: string;
        name: string;
        description: string;
        displayPrice: string;
        displayStrikethroughPrice: string;
        imageUrl: string | null;
        ratingDisplayString: string | null;
        badges: Array<{ title: string }> | null;
        quickAddContext: { isEligible: boolean } | null;
      }>;
    }>;
  };
}

function parseStorepageFeedHeader(
  feed: StorepageFeedResponse['storepageFeed'],
): GetStoreMenuOutput['store'] {
  const header = feed.storeHeader;
  const mx = feed.mxInfo;
  const opInfo = mx?.operationInfo;

  return {
    id: header.id,
    name: header.name,
    description: header.description,
    priceRange: header.priceRange,
    priceRangeDisplay: header.priceRangeDisplayString,
    address: header.address?.displayAddress || '',
    rating: header.ratings
      ? {
          average: header.ratings.averageRating,
          count: header.ratings.numRatings,
          countDisplay: header.ratings.numRatingsDisplayString,
          isNew: header.ratings.isNewlyAdded,
        }
      : null,
    deliveryFee:
      header.deliveryFeeLayout?.title ||
      header.deliveryFeeLayout?.displayDeliveryFee ||
      null,
    deliveryTime: header.deliveryTimeLayout?.title || null,
    isDashpassPartner: header.isDashpassPartner,
    offersPickup: header.offersPickup,
    offersDelivery: header.offersDelivery,
    offersScheduling: header.offersScheduling,
    operationStatus: opInfo?.operationStatusInfo?.description || null,
    hours: (opInfo?.storeOperationHourInfo?.operationSchedule || []).map(
      (s) => ({
        day: s.dayOfWeek,
        times: s.timeSlotList,
      }),
    ),
    phone: mx?.phoneno || null,
    website: mx?.website || null,
  };
}

export async function getStoreMenu(
  input: GetStoreMenuInput,
): Promise<GetStoreMenuOutput> {
  const data = await graphql<StorepageFeedResponse>(
    input.csrf,
    'storepageFeed',
    STOREPAGE_FEED_QUERY,
    {
      storeId: input.storeId,
      menuId: input.menuId || null,
      isMerchantPreview: false,
      fulfillmentType: input.fulfillmentType || 'Delivery',
      cursor: null,
      scheduledTime: input.scheduledTime || null,
      entryPoint: input.entryPoint || 'Unspecified',
    },
  );

  const feed = data.storepageFeed;

  const categories = feed.itemLists.map((list) => ({
    id: list.id,
    name: list.name,
    description: list.description || null,
    items: (list.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description || '',
      displayPrice: item.displayPrice,
      imageUrl: item.imageUrl || null,
      ratingDisplayString: item.ratingDisplayString || null,
      badges: (item.badges || [])
        .map((b) => b.title)
        .filter((t): t is string => !!t),
      isQuickAddEligible: item.quickAddContext?.isEligible || false,
    })),
  }));

  return {
    store: parseStorepageFeedHeader(feed),
    menuId: feed.menuBook.id,
    categories,
    menuName: feed.menuBook.name,
  };
}

// ============================================================================
// getItemDetails
// ============================================================================

const ITEM_PAGE_QUERY = `query itemPage(
  $storeId: ID!
  $itemId: ID!
  $consumerId: ID
  $isMerchantPreview: Boolean
  $isNested: Boolean!
  $fulfillmentType: FulfillmentType
  $shouldFetchPresetCarousels: Boolean!
  $shouldFetchStoreLiteData: Boolean!
  $cursorContext: ItemPageCursorContextInput
) {
  itemPage(
    storeId: $storeId
    itemId: $itemId
    consumerId: $consumerId
    isMerchantPreview: $isMerchantPreview
    fulfillmentType: $fulfillmentType
    cursorContext: $cursorContext
  ) {
    itemHeader @skip(if: $isNested) {
      id
      name
      displayString
      unitAmount
      currency
      decimalPlaces
      description
      imgUrl
      menuId
      caloricInfoDisplayString
      reviewData {
        ratingDisplayString
        reviewCount
      }
      specialInstructionsMaxLength
      quantityLimit
      minAgeRequirement
      foodAlcoholConstraint
      storeLiteData @include(if: $shouldFetchStoreLiteData) {
        id
      }
    }
    optionLists {
      type
      id
      name
      subtitle
      selectionNode
      minNumOptions
      maxNumOptions
      minAggregateOptionsQuantity
      maxAggregateOptionsQuantity
      numFreeOptions
      isOptional
      options {
        id
        name
        unitAmount
        currency
        displayString
        decimalPlaces
        caloricInfoDisplayString
        chargeAbove
        defaultQuantity
        nestedExtrasList {
          type
          id
          name
          subtitle
          selectionNode
          minNumOptions
          maxNumOptions
          numFreeOptions
          isOptional
          options {
            id
            name
            unitAmount
            currency
            displayString
            decimalPlaces
            caloricInfoDisplayString
            chargeAbove
            defaultQuantity
            nestedExtrasList {
              type
              id
              name
              subtitle
              selectionNode
              minNumOptions
              maxNumOptions
              numFreeOptions
              isOptional
              options {
                id
                name
                unitAmount
                currency
                displayString
                decimalPlaces
                caloricInfoDisplayString
              }
            }
          }
        }
      }
    }
    presetCarousels @include(if: $shouldFetchPresetCarousels) {
      name
    }
    itemType @skip(if: $isNested)
    itemPreferences {
      id
      title
      specialInstructions {
        title
        characterMaxLength
        isEnabled
        placeholderText
      }
    }
  }
}`;

interface ItemPageOptionL3 {
  id: string;
  name: string;
  unitAmount: number;
  currency: string;
  displayString: string;
  decimalPlaces: number;
  caloricInfoDisplayString: string;
}

interface ItemPageOptionListL3 {
  type: string;
  id: string;
  name: string;
  subtitle: string;
  selectionNode: string;
  minNumOptions: number;
  maxNumOptions: number;
  numFreeOptions: number;
  isOptional: boolean;
  options: ItemPageOptionL3[];
}

interface ItemPageOptionL2 {
  id: string;
  name: string;
  unitAmount: number;
  currency: string;
  displayString: string;
  decimalPlaces: number;
  caloricInfoDisplayString: string;
  chargeAbove: number;
  defaultQuantity: number;
  nestedExtrasList: ItemPageOptionListL3[];
}

interface ItemPageOptionListL2 {
  type: string;
  id: string;
  name: string;
  subtitle: string;
  selectionNode: string;
  minNumOptions: number;
  maxNumOptions: number;
  numFreeOptions: number;
  isOptional: boolean;
  options: ItemPageOptionL2[];
}

interface ItemPageOption {
  id: string;
  name: string;
  unitAmount: number;
  currency: string;
  displayString: string;
  decimalPlaces: number;
  caloricInfoDisplayString: string;
  chargeAbove: number;
  defaultQuantity: number;
  nestedExtrasList: ItemPageOptionListL2[];
}

interface ItemPageOptionList {
  type: string;
  id: string;
  name: string;
  subtitle: string;
  selectionNode: string;
  minNumOptions: number;
  maxNumOptions: number;
  minAggregateOptionsQuantity: number | null;
  maxAggregateOptionsQuantity: number | null;
  numFreeOptions: number;
  isOptional: boolean;
  options: ItemPageOption[];
}

interface ItemPageResponse {
  itemPage: {
    itemHeader: {
      id: string;
      name: string;
      displayString: string;
      unitAmount: number;
      currency: string;
      decimalPlaces: number;
      description: string;
      imgUrl: string;
      menuId: string;
      caloricInfoDisplayString: string;
      reviewData: {
        ratingDisplayString: string;
        reviewCount: string;
      };
      specialInstructionsMaxLength: number;
      quantityLimit: number;
    };
    optionLists: ItemPageOptionList[];
    itemType: string;
    itemPreferences: {
      id: string;
      title: string;
      specialInstructions: {
        title: string;
        characterMaxLength: number;
        isEnabled: boolean;
        placeholderText: string;
      };
    };
  };
}

type OutputOptionList = GetItemDetailsOutput['optionLists'][0];
type OutputOption = OutputOptionList['options'][0];
type OutputOptionListL2 = OutputOption['nestedExtrasList'][0];
type OutputOptionL2 = OutputOptionListL2['options'][0];
type OutputOptionListL3 = OutputOptionL2['nestedExtrasList'][0];
type OutputOptionL3 = OutputOptionListL3['options'][0];

function mapOptionL3(opt: ItemPageOptionL3): OutputOptionL3 {
  return {
    id: opt.id,
    name: opt.name,
    unitAmount: opt.unitAmount,
    currency: opt.currency,
    displayString: opt.displayString,
    decimalPlaces: opt.decimalPlaces,
    caloricInfoDisplayString: opt.caloricInfoDisplayString || '',
  };
}

function mapOptionListL3(list: ItemPageOptionListL3): OutputOptionListL3 {
  return {
    type: list.type,
    id: list.id,
    name: list.name,
    subtitle: list.subtitle || '',
    selectionNode: list.selectionNode,
    minNumOptions: list.minNumOptions,
    maxNumOptions: list.maxNumOptions,
    numFreeOptions: list.numFreeOptions,
    isOptional: list.isOptional,
    options: (list.options || []).map(mapOptionL3),
  };
}

function mapOptionL2(opt: ItemPageOptionL2): OutputOptionL2 {
  return {
    id: opt.id,
    name: opt.name,
    unitAmount: opt.unitAmount,
    currency: opt.currency,
    displayString: opt.displayString,
    decimalPlaces: opt.decimalPlaces,
    caloricInfoDisplayString: opt.caloricInfoDisplayString || '',
    chargeAbove: opt.chargeAbove ?? 0,
    defaultQuantity: opt.defaultQuantity ?? 0,
    nestedExtrasList: (opt.nestedExtrasList || []).map(mapOptionListL3),
  };
}

function mapOptionListL2(list: ItemPageOptionListL2): OutputOptionListL2 {
  return {
    type: list.type,
    id: list.id,
    name: list.name,
    subtitle: list.subtitle || '',
    selectionNode: list.selectionNode,
    minNumOptions: list.minNumOptions,
    maxNumOptions: list.maxNumOptions,
    numFreeOptions: list.numFreeOptions,
    isOptional: list.isOptional,
    options: (list.options || []).map(mapOptionL2),
  };
}

function mapOption(opt: ItemPageOption): OutputOption {
  return {
    id: opt.id,
    name: opt.name,
    unitAmount: opt.unitAmount,
    currency: opt.currency,
    displayString: opt.displayString,
    decimalPlaces: opt.decimalPlaces,
    caloricInfoDisplayString: opt.caloricInfoDisplayString || '',
    chargeAbove: opt.chargeAbove ?? 0,
    defaultQuantity: opt.defaultQuantity ?? 0,
    nestedExtrasList: (opt.nestedExtrasList || []).map(mapOptionListL2),
  };
}

function mapOptionList(
  list: ItemPageOptionList,
): GetItemDetailsOutput['optionLists'][0] {
  return {
    type: list.type,
    id: list.id,
    name: list.name,
    subtitle: list.subtitle || '',
    selectionNode: list.selectionNode,
    minNumOptions: list.minNumOptions,
    maxNumOptions: list.maxNumOptions,
    minAggregateOptionsQuantity: list.minAggregateOptionsQuantity ?? null,
    maxAggregateOptionsQuantity: list.maxAggregateOptionsQuantity ?? null,
    numFreeOptions: list.numFreeOptions,
    isOptional: list.isOptional,
    options: (list.options || []).map(mapOption),
  };
}

export async function getItemDetails(
  input: GetItemDetailsInput,
): Promise<GetItemDetailsOutput> {
  const data = await graphql<ItemPageResponse>(
    input.csrf,
    'itemPage',
    ITEM_PAGE_QUERY,
    {
      storeId: input.storeId,
      itemId: input.itemId,
      isNested: false,
      fulfillmentType: 'Delivery',
      shouldFetchPresetCarousels: false,
      shouldFetchStoreLiteData: false,
    },
  );

  const page = data.itemPage;
  if (!page?.itemHeader) {
    throw new NotFound(
      `Item not found: storeId=${input.storeId}, itemId=${input.itemId}. URL: ${window.location.href}`,
    );
  }

  const header = page.itemHeader;
  const allLists = page.optionLists || [];

  const optionLists = allLists
    .filter((l) => l.type === 'extra_option')
    .map(mapOptionList);

  const recommendedAddOns = allLists
    .filter((l) => l.type === 'item')
    .map(mapOptionList);

  const prefs = page.itemPreferences?.specialInstructions;

  return {
    name: header.name,
    price: {
      unitAmount: header.unitAmount,
      currency: header.currency,
      decimalPlaces: header.decimalPlaces,
      displayString: header.displayString,
    },
    description: header.description || '',
    imgUrl: header.imgUrl || '',
    menuId: header.menuId,
    caloricInfoDisplayString: header.caloricInfoDisplayString || '',
    reviewRating: header.reviewData?.ratingDisplayString || '',
    specialInstructionsMaxLength: header.specialInstructionsMaxLength ?? 0,
    quantityLimit: header.quantityLimit ?? 0,
    itemType: page.itemType || '',
    optionLists,
    recommendedAddOns,
    specialInstructions: {
      isEnabled: prefs?.isEnabled ?? false,
      characterMaxLength: prefs?.characterMaxLength ?? 0,
      placeholderText: prefs?.placeholderText || '',
    },
  };
}

// ============================================================================
// getStoreFeed
// ============================================================================

const HOMEPAGE_FEED_HEADERS: Record<string, string> = {
  'x-facets-feature-item-carousel': 'true',
  'x-facets-version': '4.0.0',
  'x-facets-entry': 'homepage',
  'x-facets-platform': 'desktop',
  'x-facets-feature-grid-standard': 'true',
  'x-facets-feature-no-tile': 'true',
  'x-facets-feature-backend-driven-badges': 'true',
  'x-facets-feature-store-carousel-redesign-round-1': 'treatmentVariant2',
  'x-facets-feature-store-cell-redesign-round-3': 'treatmentVariant3',
};

const HOMEPAGE_FEED_QUERY = `query homePageFacetFeed($filterQuery: String, $displayHeader: Boolean, $isDebug: Boolean, $cuisineFilterVerticalIds: String) {
  homePageFacetFeed(filterQuery: $filterQuery, displayHeader: $displayHeader, isDebug: $isDebug, cuisineFilterVerticalIds: $cuisineFilterVerticalIds) {
    body {
      id
      body {
        id
        component {
          id
          category
          __typename
        }
        text {
          title
          subtitle
          __typename
        }
        images {
          main {
            uri
            __typename
          }
          __typename
        }
        custom
        childrenCount
        __typename
      }
      __typename
    }
    __typename
  }
}`;

interface HomePageFeedItem {
  id: string | null;
  component: { id: string; category: string } | null;
  text: { title: string | null; subtitle: string | null } | null;
  images: { main: { uri: string } | null } | null;
  custom: string | null;
  childrenCount: number | null;
}

interface HomePageFeedSection {
  id: string | null;
  body: HomePageFeedItem[];
}

interface HomePageFeedResponse {
  homePageFacetFeed: {
    body: HomePageFeedSection[];
  };
}

function parseCardStoreCustom(
  custom: string | null,
  text: { title: string | null; subtitle: string | null } | null,
): {
  storeId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  rating: { average: number; countDisplay: string } | null;
  deliveryFee: string | null;
  deliveryTime: string | null;
  isDashpassPartner: boolean;
} | null {
  if (!custom) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(custom);
  } catch {
    return null;
  }

  const storeId = data.store_id as string | undefined;
  if (!storeId) return null;

  // Image from window_shopping cover (preferred) or first card
  const windowShopping = data.window_shopping as
    | {
        cover?: { image?: { remote?: { uri?: string } } };
        cards?: Array<{ image?: { remote?: { uri?: string } } }>;
      }
    | undefined;
  const imageUrl =
    windowShopping?.cover?.image?.remote?.uri ||
    windowShopping?.cards?.[0]?.image?.remote?.uri ||
    null;

  // Rating from custom.rating
  const ratingData = data.rating as
    | { average_rating?: number; display_num_ratings?: string }
    | undefined;
  const rating =
    ratingData?.average_rating != null
      ? {
          average: ratingData.average_rating,
          countDisplay: ratingData.display_num_ratings || '',
        }
      : null;

  // DashPass from badges
  const badges = data.badges as Array<{ is_dashpass?: boolean }> | undefined;
  const isDashpassPartner = (badges || []).some((b) => b.is_dashpass === true);

  return {
    storeId,
    name: text?.title || '',
    description: text?.subtitle || '',
    imageUrl,
    rating,
    deliveryFee: null,
    deliveryTime: null,
    isDashpassPartner,
  };
}

export async function getStoreFeed(
  input: GetStoreFeedInput,
): Promise<GetStoreFeedOutput> {
  const csrf = input.csrf || getCookie('csrf_token') || '';

  // Build filterQuery from discrete params if filterQuery not provided directly
  let composedFilterQuery = input.filterQuery;
  if (composedFilterQuery === undefined) {
    const params: string[] = [];
    if (input.dashpassOnly) params.push('dashpass_eligible=true');
    if (input.freeDelivery) params.push('delivery_fee=0');
    if (input.dealsOnly) params.push('offer_type=deals-fill');
    if (input.maxEta !== undefined) params.push(`eta=${input.maxEta}`);
    if (input.minStarRating !== undefined)
      params.push(`star_rating=${input.minStarRating}`);
    if (input.priceRange !== undefined)
      params.push(`price_range=${input.priceRange}`);
    if (input.pickup) params.push('pickup=true');
    if (input.cuisine !== undefined) params.push(`cuisine=${input.cuisine}`);
    if (input.sortBy !== undefined) params.push(`sortBy=${input.sortBy}`);
    if (input.maxDeliveryFeeCents !== undefined)
      params.push(`delivery_fee=${input.maxDeliveryFeeCents}`);
    if (input.maxItemPriceCents !== undefined)
      params.push(`item_price=${input.maxItemPriceCents}`);
    if (params.length > 0) composedFilterQuery = '?' + params.join('&');
  }

  const variables: Record<string, unknown> = {};
  if (composedFilterQuery !== undefined) {
    variables.filterQuery = composedFilterQuery;
  }
  if (input.displayHeader !== undefined)
    variables.displayHeader = input.displayHeader;
  if (input.isDebug !== undefined) variables.isDebug = input.isDebug;
  if (input.cuisineFilterVerticalIds !== undefined)
    variables.cuisineFilterVerticalIds = input.cuisineFilterVerticalIds;

  const data = await graphql<HomePageFeedResponse>(
    csrf,
    'homePageFacetFeed',
    HOMEPAGE_FEED_QUERY,
    variables,
    HOMEPAGE_FEED_HEADERS,
  );

  // Find the store_feed section (contains carousels and store cards)
  const sections = data.homePageFacetFeed?.body || [];
  const storeFeedSection = sections.find((s) => s.id === 'store_feed');
  const items = storeFeedSection?.body || [];

  const carousels: StoreFeedCarousel[] = [];
  // Stores accumulate here until a carousel footer (carousel.standard:store_carousel:*)
  // closes the group. The footer appears AFTER the stores it belongs to.
  let pendingStores: StoreFeedCarousel['stores'] = [];
  // Pickup and other flat-list feeds use row.store items with no carousel footer
  const flatStores: StoreFeedCarousel['stores'] = [];

  for (const item of items) {
    const componentId = item.component?.id || '';
    const itemId = item.id || '';

    if (componentId === 'card.store') {
      const store = parseCardStoreCustom(item.custom, item.text);
      if (store) {
        pendingStores.push(store);
      }
    } else if (
      componentId === 'carousel.standard' &&
      itemId.includes('store_carousel')
    ) {
      // Carousel footer: close the pending group with this title
      if (pendingStores.length > 0) {
        carousels.push({
          id: itemId,
          title: item.text?.title || '',
          subtitle: item.text?.subtitle || null,
          stores: pendingStores,
        });
        pendingStores = [];
      }
    } else if (componentId === 'row.store') {
      // Pickup feed returns a flat row.store list with no carousel footer
      const store = parseCardStoreCustom(item.custom, item.text);
      if (store) {
        flatStores.push(store);
      }
    }
  }

  // Any remaining pending stores have no carousel footer; wrap in a default carousel
  if (pendingStores.length > 0) {
    carousels.push({
      id: 'recommended',
      title: 'Recommended',
      subtitle: null,
      stores: pendingStores,
    });
  }

  // If the response was a flat row.store list (filtered feed), wrap in a single carousel
  if (flatStores.length > 0 && carousels.length === 0) {
    const isPickup =
      typeof composedFilterQuery === 'string' &&
      composedFilterQuery.includes('pickup=true');
    carousels.push({
      id: isPickup ? 'pickup_feed' : 'filtered_results',
      title: isPickup ? 'Pickup Near You' : 'Filtered Stores',
      subtitle: null,
      stores: flatStores,
    });
  }

  // The homePageFacetFeed response does not include a per-store DashPass indicator.
  // When the dashpass_eligible filter is active, all returned stores are DashPass partners
  // by definition; the server-side filter guarantees it.
  const isDashpassFiltered =
    input.dashpassOnly === true ||
    (typeof composedFilterQuery === 'string' &&
      composedFilterQuery.includes('dashpass_eligible'));
  if (isDashpassFiltered) {
    for (const carousel of carousels) {
      for (const store of carousel.stores) {
        store.isDashpassPartner = true;
      }
    }
  }

  return { carousels };
}

// ============================================================================
// getStoreDetails
// ============================================================================

export async function getStoreDetails(
  input: GetStoreDetailsInput,
): Promise<GetStoreDetailsOutput> {
  const data = await graphql<StorepageFeedResponse>(
    input.csrf,
    'storepageFeed',
    STOREPAGE_FEED_QUERY,
    {
      storeId: input.storeId,
      menuId: null,
      isMerchantPreview: false,
      fulfillmentType: input.fulfillmentType || 'Delivery',
      cursor: null,
      scheduledTime: input.scheduledTime || null,
      entryPoint: input.entryPoint || 'Unspecified',
    },
  );

  const header = data.storepageFeed.storeHeader;
  const mx = data.storepageFeed.mxInfo;
  const opInfo = mx?.operationInfo;

  return {
    store: {
      id: header.id,
      name: header.name,
      description: header.description,
      priceRange: header.priceRange,
      priceRangeDisplay: header.priceRangeDisplayString,
      address: header.address?.displayAddress || '',
      rating: header.ratings
        ? {
            average: header.ratings.averageRating,
            count: header.ratings.numRatings,
            countDisplay: header.ratings.numRatingsDisplayString,
            isNew: header.ratings.isNewlyAdded,
          }
        : null,
      deliveryFee:
        header.deliveryFeeLayout?.title ||
        header.deliveryFeeLayout?.displayDeliveryFee ||
        null,
      deliveryTime: header.deliveryTimeLayout?.title || null,
      isDashpassPartner: header.isDashpassPartner,
      offersPickup: header.offersPickup,
      offersDelivery: header.offersDelivery,
      offersScheduling: header.offersScheduling,
      operationStatus: opInfo?.operationStatusInfo?.description || null,
      hours: (opInfo?.storeOperationHourInfo?.operationSchedule || []).map(
        (s) => ({
          day: s.dayOfWeek,
          times: s.timeSlotList,
        }),
      ),
      phone: mx?.phoneno || null,
      website: mx?.website || null,
    },
  };
}

// ============================================================================
// getStoreReviews
// ============================================================================

const STORE_REVIEWS_QUERY = `query getRatingsReviewsPage($target: ConsumerRatingTargetInput!, $limit: Int, $offset: String) {
  getRatingsReviewsPage(
    target: $target
    limit: $limit
    offset: $offset
  ) {
    result {
      reviewsList {
        consumerReviewUuid
        reviewerDisplayName
        numStars
        reviewText
        reviewedAt
        isVerified
        helpfulCount
        taggedItems {
          name
          __typename
        }
        itemsList {
          name
          __typename
        }
        ratingTag {
          ratingTitle
          __typename
        }
        __typename
      }
      limit
      offset
      totalReviews
      __typename
    }
    __typename
  }
}`;

interface StoreReviewsResponse {
  getRatingsReviewsPage: {
    result: {
      reviewsList: Array<{
        consumerReviewUuid: string;
        reviewerDisplayName: string | null;
        numStars: number;
        reviewText: string;
        reviewedAt: string;
        isVerified: boolean;
        helpfulCount: number;
        taggedItems: Array<{ name: string }> | null;
        itemsList: Array<{ name: string }> | null;
        ratingTag: { ratingTitle: string } | null;
      }>;
      limit: number;
      offset: string;
      totalReviews: string;
    };
  };
}

export async function getStoreReviews(
  input: GetStoreReviewsInput,
): Promise<GetStoreReviewsOutput> {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 10;

  const data = await graphql<StoreReviewsResponse>(
    input.csrf,
    'getRatingsReviewsPage',
    STORE_REVIEWS_QUERY,
    {
      target: { targetId: parseInt(input.storeId, 10), targetType: 1 },
      offset: String(offset),
      limit,
    },
  );

  const result = data.getRatingsReviewsPage.result;
  const totalReviews = parseInt(result.totalReviews, 10) || 0;
  const nextOffsetNum = parseInt(result.offset, 10);
  const hasMore = nextOffsetNum < totalReviews;

  return {
    reviews: (result.reviewsList || []).map((r) => {
      const items = [
        ...(r.itemsList || []).map((item) => item.name),
        ...(r.taggedItems || []).map((item) => item.name),
      ].filter((v, i, a) => a.indexOf(v) === i);
      return {
        id: r.consumerReviewUuid,
        rating: r.numStars,
        text: r.reviewText || '',
        createdAt: r.reviewedAt,
        deliveryRating: null,
        orderItems: items,
        isVerified: r.isVerified,
        helpfulCount: r.helpfulCount,
        ratingTitle: r.ratingTag?.ratingTitle ?? null,
        reviewerDisplayName: r.reviewerDisplayName ?? null,
      };
    }),
    totalCount: totalReviews,
    averageRating: null,
    nextOffset: hasMore ? nextOffsetNum : null,
  };
}

// ============================================================================
// getSavedStores
// ============================================================================

const SAVED_STORES_QUERY = `query savedStoresFacetFeed($cursor: String) {
  savedStoresFacetFeed(cursor: $cursor) {
    body {
      id
      body {
        id
        component { id category __typename }
        text {
          title
          description
          accessory
          custom { key value __typename }
          __typename
        }
        images {
          main { uri local style __typename }
          accessory { uri local style __typename }
          __typename
        }
        custom
        events { click { name data __typename } __typename }
        __typename
      }
      __typename
    }
    page {
      next { name data __typename }
      __typename
    }
    logging
    __typename
  }
}`;

interface SavedStoresFacetItem {
  id: string;
  component: { id: string; category: string } | null;
  text: {
    title: string | null;
    description: string | null;
    accessory: string | null;
    custom: Array<{ key: string; value: string }> | null;
  } | null;
  images: {
    main: {
      uri: string | null;
      local: string | null;
      style: string | null;
    } | null;
    accessory: {
      uri: string | null;
      local: string | null;
      style: string | null;
    } | null;
  } | null;
  custom: string | null;
  events: { click: { name: string; data: string } | null } | null;
}

interface SavedStoresFacetFeedResponse {
  savedStoresFacetFeed: {
    body: Array<{
      id: string;
      body: SavedStoresFacetItem[];
    }>;
    page: {
      next: { name: string | null; data: string | null };
    };
    logging: string | null;
  };
}

export async function getSavedStores(
  input: GetSavedStoresInput,
): Promise<GetSavedStoresOutput> {
  const data = await graphql<SavedStoresFacetFeedResponse>(
    input.csrf,
    'savedStoresFacetFeed',
    SAVED_STORES_QUERY,
    { cursor: input.cursor ?? '' },
  );

  const sections = data.savedStoresFacetFeed?.body || [];
  const stores: GetSavedStoresOutput['stores'] = [];

  for (const section of sections) {
    for (const item of section.body || []) {
      if (item.component?.id !== 'row.store') continue;

      // Extract store ID from id format "row.store:{storeId}:{position}"
      const idParts = item.id.split(':');
      const storeId = idParts[1] || '';

      // Parse custom JSON for rating, store_id, badges, availability
      let customData: {
        rating?: { average_rating: number; display_num_ratings: string };
        store_id?: string;
        badges?: Array<{
          text?: string;
          type?: string;
          background_color?: string;
        }>;
        is_currently_available?: boolean;
      } = {};
      if (item.custom) {
        try {
          customData = JSON.parse(item.custom);
        } catch {
          // ignore parse errors
        }
      }

      const textCustom = item.text?.custom || [];
      const deliveryFee =
        textCustom.find((c) => c.key === 'delivery_fee_string')?.value || null;
      const etaDisplay =
        textCustom.find((c) => c.key === 'eta_display_string')?.value || null;

      const badges = Array.isArray(customData.badges)
        ? (customData.badges as Array<{ text?: string }>)
            .map((b) => b.text || '')
            .filter((t) => !!t)
        : [];

      stores.push({
        storeId: customData.store_id || storeId,
        name: item.text?.title || '',
        description: item.text?.description || '',
        imageUrl: item.images?.main?.uri || null,
        rating: customData.rating
          ? {
              average: customData.rating.average_rating,
              countDisplay: customData.rating.display_num_ratings || '',
            }
          : null,
        deliveryFee,
        deliveryTime: etaDisplay,
        isDashpassPartner: item.images?.accessory?.local === 'dashpass-badge',
        operationStatus: item.text?.accessory || null,
        badges,
        isCurrentlyAvailable: customData.is_currently_available ?? true,
      });
    }
  }

  const nextCursor = data.savedStoresFacetFeed?.page?.next?.data ?? null;

  return { stores, nextCursor };
}

// ============================================================================
// saveStore
// ============================================================================

const BOOKMARK_STORE_MUTATION = `mutation bookmarkStore($storeId: ID!) {
  bookmarkStore(storeId: $storeId)
}`;

interface BookmarkStoreResponse {
  bookmarkStore: boolean;
}

export async function saveStore(
  input: SaveStoreInput,
): Promise<SaveStoreOutput> {
  const data = await graphql<BookmarkStoreResponse>(
    input.csrf,
    'bookmarkStore',
    BOOKMARK_STORE_MUTATION,
    { storeId: input.storeId },
  );

  return { success: data.bookmarkStore ?? false };
}

// ============================================================================
// unsaveStore
// ============================================================================

const UNBOOKMARK_STORE_MUTATION = `mutation unbookmarkStore($storeId: ID!) {
  unbookmarkStore(storeId: $storeId)
}`;

interface UnbookmarkStoreResponse {
  unbookmarkStore: boolean;
}

export async function unsaveStore(
  input: UnsaveStoreInput,
): Promise<UnsaveStoreOutput> {
  const csrf = getCookie('csrf_token') || '';
  const data = await graphql<UnbookmarkStoreResponse>(
    csrf,
    'unbookmarkStore',
    UNBOOKMARK_STORE_MUTATION,
    { storeId: input.storeId },
  );

  return { success: data.unbookmarkStore ?? false };
}

// ============================================================================
// listOrders
// ============================================================================

const LIST_ORDERS_QUERY = `query getConsumerOrdersWithDetails($offset: Int!, $limit: Int!, $includeCancelled: Boolean, $orderFilterType: OrderFilterType) {
  getConsumerOrdersWithDetails(offset: $offset, limit: $limit, includeCancelled: $includeCancelled, orderFilterType: $orderFilterType) {
    id
    orderUuid
    createdAt
    cancelledAt
    fulfilledAt
    fulfillmentType
    deliveryAddress {
      id
      formattedAddress
      __typename
    }
    grandTotal {
      displayString
      unitAmount
      currency
      __typename
    }
    store {
      id
      name
      __typename
    }
    orders {
      id
      items {
        id
        name
        quantity
        originalItemPrice
        specialInstructions
        __typename
      }
      __typename
    }
    __typename
  }
}`;

const VALID_ORDER_FILTER_TYPES = new Set([
  'ORDER_FILTER_TYPE_PERSONAL',
  'ORDER_FILTER_TYPE_BUSINESS',
  'ORDER_FILTER_TYPE_UNSPECIFIED',
]);

interface ListOrdersGqlResponse {
  getConsumerOrdersWithDetails: Array<{
    id: string;
    orderUuid: string;
    createdAt: string;
    cancelledAt: string | null;
    fulfilledAt: string | null;
    fulfillmentType: string | null;
    deliveryAddress: { id: string; formattedAddress: string } | null;
    grandTotal: { displayString: string; unitAmount: number; currency: string };
    store: { id: string; name: string };
    orders: Array<{
      items: Array<{
        id: string;
        name: string;
        quantity: number;
        originalItemPrice: number | null;
        specialInstructions: string | null;
      }>;
    }>;
  }>;
}

export async function listOrders(
  input: ListOrdersInput,
): Promise<ListOrdersOutput> {
  const csrf = input.csrf || getCookie('csrf_token');
  if (!csrf) {
    throw new Unauthenticated(
      `listOrders: CSRF token not found. Call getContext() first or navigate to doordash.com. URL: ${window.location.href}`,
    );
  }

  if (
    input.orderFilterType &&
    !VALID_ORDER_FILTER_TYPES.has(input.orderFilterType)
  ) {
    throw new Validation(
      `listOrders: invalid orderFilterType "${input.orderFilterType}". Must be one of: ${Array.from(VALID_ORDER_FILTER_TYPES).join(', ')}`,
    );
  }

  const limit = input.limit ?? 10;
  const offset = input.offset ?? 0;

  const variables: Record<string, unknown> = {
    offset,
    limit: limit + 1, // fetch one extra to detect hasMore
    includeCancelled: input.includeCancelled ?? true,
  };

  if (input.orderFilterType) {
    variables.orderFilterType = input.orderFilterType;
  }

  const data = await graphql<ListOrdersGqlResponse>(
    csrf,
    'getConsumerOrdersWithDetails',
    LIST_ORDERS_QUERY,
    variables,
  );

  const rawOrders = data.getConsumerOrdersWithDetails || [];
  const hasMore = rawOrders.length > limit;
  const ordersPage = hasMore ? rawOrders.slice(0, limit) : rawOrders;

  const orders = ordersPage.map((order) => {
    const items = (order.orders || []).flatMap((sub) =>
      (sub.items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: formatCents(item.originalItemPrice),
        specialInstructions: item.specialInstructions ?? null,
      })),
    );

    const status = order.cancelledAt
      ? 'CANCELLED'
      : order.fulfilledAt
        ? 'DELIVERED'
        : 'ACTIVE';

    return {
      id: order.id,
      orderUuid: order.orderUuid,
      storeName: order.store?.name || '',
      storeId: order.store?.id || '',
      createdAt: order.createdAt,
      grandTotal: order.grandTotal?.displayString || '',
      status,
      deliveryAddress: order.deliveryAddress?.formattedAddress ?? null,
      items,
    };
  });

  return { orders, hasMore };
}

// ============================================================================
// getOrder
// ============================================================================

// NOTE: DoorDash uses `consumerOrders`/`getConsumerOrdersPostCheckout` for
// order detail pages. The previously-used `getOrderDetails` field no longer
// exists on the DoorDash GraphQL schema.
const GET_ORDER_QUERY = `query consumerOrders($orderCartId: ID!) {
  getConsumerOrdersPostCheckout(orderCartId: $orderCartId) {
    storeId
    consumerId
    groupCart
    orderUuid
    isGift
    isRetail
    submittedAt
    subtotal
    totalCharged
    tipAmount
    cateringOrderType
    cateringInfo {
      cancelOrderInAdvanceInSeconds
      __typename
    }
    customerSupportProvider
    shoppingProtocol
    orders {
      id
      orderItems {
        id
        name
        displayString {
          originalUnitPrice
          finalUnitPrice
          __typename
        }
        price
        description
        quantity
        purchaseType
        requestedQuantity {
          discreteQuantity {
            quantity
            unit
            __typename
          }
          continuousQuantity {
            quantity
            unit
            __typename
          }
          __typename
        }
        fulfillQuantity {
          discreteQuantity {
            quantity
            unit
            __typename
          }
          continuousQuantity {
            quantity
            unit
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    delivery {
      actualDeliveryTime
      deliveryUuid
      isAsap
      fulfillmentType
      isConsumerPickup
      createdAt
      source
      __typename
    }
    store {
      id
      name
      phoneNumber
      customerArrivedPickupInstructions
      address {
        printableAddress
        state
        countryShortname
        __typename
      }
      business {
        id
        name
        __typename
      }
      __typename
    }
    proofOfDelivery {
      type
      pinCode
      __typename
    }
    orderConfig {
      groupOrderType
      orderProfileType
      groupCartSource
      mealTrainOrderDetails {
        mealTrainName
        __typename
      }
      __typename
    }
    __typename
  }
}`;

interface GetOrderGqlResponse {
  getConsumerOrdersPostCheckout: {
    storeId: string;
    consumerId: string | null;
    groupCart: boolean | null;
    orderUuid: string;
    isGift: boolean | null;
    isRetail: boolean | null;
    submittedAt: string | null;
    subtotal: number | null;
    totalCharged: number | null;
    tipAmount: number | null;
    cateringOrderType: string | null;
    cateringInfo: { cancelOrderInAdvanceInSeconds: number | null } | null;
    customerSupportProvider: string | null;
    shoppingProtocol: string | null;
    orders: Array<{
      id: string;
      orderItems: Array<{
        id: string;
        name: string;
        displayString: {
          originalUnitPrice: string | null;
          finalUnitPrice: string | null;
        } | null;
        price: number | null;
        description: string | null;
        quantity: number;
        purchaseType: string | null;
        requestedQuantity: {
          discreteQuantity: { quantity: number; unit: string } | null;
          continuousQuantity: { quantity: number; unit: string } | null;
        } | null;
        fulfillQuantity: {
          discreteQuantity: { quantity: number; unit: string } | null;
          continuousQuantity: { quantity: number; unit: string } | null;
        } | null;
      }>;
    }>;
    delivery: {
      actualDeliveryTime: string | null;
      deliveryUuid: string | null;
      isAsap: boolean | null;
      fulfillmentType: string | null;
      isConsumerPickup: boolean | null;
      createdAt: string | null;
      source: string | null;
    } | null;
    store: {
      id: string;
      name: string;
      phoneNumber: string | null;
      customerArrivedPickupInstructions: string | null;
      address: {
        printableAddress: string;
        state: string | null;
        countryShortname: string | null;
      } | null;
      business: { id: string; name: string } | null;
    } | null;
    proofOfDelivery: {
      type: string | null;
      pinCode: string | null;
    } | null;
    orderConfig: {
      groupOrderType: string | null;
      orderProfileType: string | null;
      groupCartSource: string | null;
      mealTrainOrderDetails: { mealTrainName: string | null } | null;
    } | null;
  } | null;
}

function formatCents(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

export async function getOrder(input: GetOrderInput): Promise<GetOrderOutput> {
  const csrf = input.csrf;
  if (!csrf) {
    throw new Unauthenticated(`CSRF token is required. URL: ${window.location.href}`);
  }
  if (!input.orderUuid) {
    throw new Validation(
      `getOrder: orderUuid is required. URL: ${window.location.href}`,
    );
  }

  const data = await graphql<GetOrderGqlResponse>(
    csrf,
    'consumerOrders',
    GET_ORDER_QUERY,
    { orderCartId: input.orderUuid },
  );

  const order = data.getConsumerOrdersPostCheckout;
  if (!order) {
    throw new NotFound(
      `Order not found: ${input.orderUuid}. URL: ${window.location.href}`,
    );
  }

  const items = (order.orders || []).flatMap((sub) =>
    (sub.orderItems || []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price:
        item.displayString?.finalUnitPrice ?? formatCents(item.price) ?? null,
      specialInstructions: null,
      requestedQuantity: item.requestedQuantity ?? null,
      fulfillQuantity: item.fulfillQuantity ?? null,
    })),
  );

  return {
    orderUuid: order.orderUuid,
    storeName: order.store?.name || '',
    storeId: order.storeId || order.store?.id || '',
    createdAt: order.delivery?.createdAt || order.submittedAt || '',
    deliveredAt: order.delivery?.actualDeliveryTime ?? null,
    storeAddress: order.store?.address?.printableAddress ?? null,
    items,
    subtotal: formatCents(order.subtotal),
    grandTotal: formatCents(order.totalCharged) ?? '',
    tip: formatCents(order.tipAmount),
    isGift: order.isGift ?? null,
    isRetail: order.isRetail ?? null,
    submittedAt: order.submittedAt ?? null,
    fulfillmentType: order.delivery?.fulfillmentType ?? null,
    isConsumerPickup: order.delivery?.isConsumerPickup ?? null,
    proofOfDeliveryPin: order.proofOfDelivery?.pinCode ?? null,
    deliveryUuid: order.delivery?.deliveryUuid ?? null,
  };
}

// ============================================================================
// trackOrder
// ============================================================================
//
// NOTE: The getOrderTrackingDetails GraphQL operation was removed from DoorDash's
// schema. Real-time tracking (dasher location, ETA) now requires DoorDash's UG
// (Unified Gateway) client SDK which is not accessible via plain fetch.
// This implementation derives order status from getConsumerOrdersWithDetails.

export async function trackOrder(
  input: TrackOrderInput,
): Promise<TrackOrderOutput> {
  const csrf = input.csrf;
  if (!csrf) {
    throw new Unauthenticated(`CSRF token is required. URL: ${window.location.href}`);
  }
  if (!input.orderUuid) {
    throw new Validation(
      `trackOrder: orderUuid is required. URL: ${window.location.href}`,
    );
  }

  // Fetch recent orders to find the matching UUID.
  // getConsumerOrdersWithDetails does not support filtering by UUID; we fetch
  // a batch and search. Fetch 50 to cover most use cases (users typically track
  // recent orders).
  const data = await graphql<ListOrdersGqlResponse>(
    csrf,
    'getConsumerOrdersWithDetails',
    LIST_ORDERS_QUERY,
    { offset: 0, limit: 50, includeCancelled: true },
  );

  const rawOrders = data.getConsumerOrdersWithDetails || [];
  const order = rawOrders.find((o) => o.orderUuid === input.orderUuid);

  if (!order) {
    throw new NotFound(
      `trackOrder: Order not found: ${input.orderUuid}. URL: ${window.location.href}`,
    );
  }

  const status = order.cancelledAt
    ? 'CANCELLED'
    : order.fulfilledAt
      ? 'DELIVERED'
      : 'ACTIVE';

  return {
    orderUuid: order.orderUuid,
    status,
    // Real-time ETA and dasher info require DoorDash's UG API (not accessible
    // via fetch). These fields are always null.
    estimatedDeliveryTime: null,
    dasherLocation: null,
    dasher: null,
    statusMessage: null,
    storeName: order.store?.name || '',
  };
}

// ============================================================================
// reorder
// ============================================================================

// reorderCart was removed from DoorDash's schema. The replacement is
// reorderOrder which returns ReorderOrderResponse with success + cartUuid.
const REORDER_QUERY = `mutation reorderOrder($orderUuid: ID!) {
  reorderOrder(orderUuid: $orderUuid) {
    success
    cartUuid
    __typename
  }
}`;

interface ReorderGqlResponse {
  reorderOrder: {
    success: boolean;
    cartUuid: string | null;
  } | null;
}

export async function reorder(input: ReorderInput): Promise<ReorderOutput> {
  const csrf = input.csrf || getCookie('csrf_token');
  if (!csrf) {
    throw new Unauthenticated(
      `reorder: CSRF token not found. Call getContext() first or navigate to doordash.com. URL: ${window.location.href}`,
    );
  }

  if (!input.orderUuid) {
    throw new Validation(
      `reorder: orderUuid is required. Provide a valid order UUID from listOrders().`,
    );
  }

  const data = await graphql<ReorderGqlResponse>(
    csrf,
    'reorderOrder',
    REORDER_QUERY,
    { orderUuid: input.orderUuid },
  );

  const result = data.reorderOrder;

  return {
    success: result?.success ?? false,
    cartUuid: result?.cartUuid ?? null,
  };
}

// ============================================================================
// getCart
// ============================================================================

// consumerOrderCart returns the active cart. DoorDash only allows one active
// cart at a time. The `cart` query field was removed from DoorDash's schema --
// use consumerOrderCart instead.
const GET_CART_QUERY = `query consumerOrderCart {
  consumerOrderCart {
    id
    subtotal
    total
    totalBeforeDiscountsAndCredits
    fulfillmentType
    isConsumerPickup
    groupCart
    groupCartType
    groupCartSource
    cartStatusType
    cartType
    currencyCode
    offersDelivery
    offersPickup
    isCatering
    isSameStoreCatering
    isBundle
    bundleType
    isConvenienceCart
    isPrescriptionDelivery
    isMerchantShipping
    shortenedUrl
    urlCode
    submittedAt
    scheduledDeliveryAvailable
    isOutsideDeliveryRegion
    outOfStockMenuItemIds
    restaurant {
      id
      name
      business {
        id
        name
        __typename
      }
      __typename
    }
    orders {
      id
      orderItems {
        id
        quantity
        specialInstructions
        priceOfTotalQuantity
        singlePrice
        item {
          id
          name
          __typename
        }
        options {
          id
          name
          price
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

interface CartOrderItem {
  id: string;
  quantity: number;
  specialInstructions: string | null;
  priceOfTotalQuantity: number;
  singlePrice: number | null;
  item: { id: string; name: string };
  options: Array<{ id: string; name: string; price: number | null }>;
}

interface CartResponse {
  consumerOrderCart: {
    id: string;
    subtotal: number;
    total: number | null;
    totalBeforeDiscountsAndCredits: number | null;
    fulfillmentType: string;
    isConsumerPickup: boolean;
    groupCart: boolean;
    groupCartType: string | null;
    groupCartSource: string | null;
    cartStatusType: string | null;
    cartType: string | null;
    currencyCode: string | null;
    offersDelivery: boolean;
    offersPickup: boolean;
    isCatering: boolean;
    isSameStoreCatering: boolean;
    isBundle: boolean;
    bundleType: string | null;
    isConvenienceCart: boolean;
    isPrescriptionDelivery: boolean;
    isMerchantShipping: boolean;
    shortenedUrl: string | null;
    urlCode: string | null;
    submittedAt: string | null;
    scheduledDeliveryAvailable: boolean | null;
    isOutsideDeliveryRegion: boolean | null;
    outOfStockMenuItemIds: string[] | null;
    restaurant: {
      id: string;
      name: string | null;
      business: { id: string; name: string } | null;
    } | null;
    orders: Array<{
      id: string;
      orderItems: CartOrderItem[];
    }>;
  } | null;
}

export async function getCart(_input: GetCartInput): Promise<GetCartOutput> {
  const csrf = getCookie('csrf_token') || '';
  const data = await graphql<CartResponse>(
    csrf,
    'consumerOrderCart',
    GET_CART_QUERY,
    {},
  );

  const cart = data.consumerOrderCart;
  if (!cart) {
    throw new NotFound(
      'getCart: No active cart found. Add items to a store first.',
    );
  }

  const storeName =
    cart.restaurant?.business?.name || cart.restaurant?.name || '';

  const allItems = cart.orders.flatMap((order) =>
    order.orderItems.map((oi) => {
      const unitPriceCents =
        oi.singlePrice !== null
          ? oi.singlePrice
          : Math.round(oi.priceOfTotalQuantity / oi.quantity);
      return {
        cartItemId: oi.id,
        itemId: oi.item.id,
        name: oi.item.name,
        quantity: oi.quantity,
        unitPrice: formatCents(unitPriceCents) || '$0.00',
        totalPrice: formatCents(oi.priceOfTotalQuantity) || '$0.00',
        specialInstructions: oi.specialInstructions,
        selectedOptions: oi.options.map((opt) => ({
          optionId: opt.id,
          name: opt.name,
          price: opt.price !== null ? `$${opt.price.toFixed(2)}` : null,
        })),
      };
    }),
  );

  return {
    storeId: cart.restaurant?.id || '',
    storeName,
    items: allItems,
    fees: {
      subtotal: formatCents(cart.subtotal) || '$0.00',
      deliveryFee: null,
      serviceFee: null,
      tax: null,
      discount: null,
      total: formatCents(cart.subtotal) || '$0.00',
    },
    promoCode: null,
    fulfillmentType: cart.fulfillmentType,
    deliveryAddress: null,
    isPickup: cart.isConsumerPickup,
    isGroupCart: cart.groupCart,
    groupCartType: cart.groupCartType ?? null,
    groupCartSource: cart.groupCartSource ?? null,
    cartStatus: cart.cartStatusType ?? null,
    cartType: cart.cartType ?? null,
    currencyCode: cart.currencyCode ?? null,
    offersDelivery: cart.offersDelivery,
    offersPickup: cart.offersPickup,
    isCatering: cart.isCatering,
    isSameStoreCatering: cart.isSameStoreCatering,
    isBundle: cart.isBundle,
    bundleType: cart.bundleType ?? null,
    isConvenienceCart: cart.isConvenienceCart,
    isPrescriptionDelivery: cart.isPrescriptionDelivery,
    isMerchantShipping: cart.isMerchantShipping,
    shortenedUrl: cart.shortenedUrl ?? null,
    urlCode: cart.urlCode ?? null,
    submittedAt: cart.submittedAt ?? null,
    scheduledDeliveryAvailable: cart.scheduledDeliveryAvailable ?? null,
    isOutsideDeliveryRegion: cart.isOutsideDeliveryRegion ?? null,
    outOfStockMenuItemIds: cart.outOfStockMenuItemIds ?? null,
    totalCents: cart.total ?? null,
    totalBeforeDiscountsCents: cart.totalBeforeDiscountsAndCredits ?? null,
  };
}

// ============================================================================
// addToCart
// ============================================================================

const ADD_TO_CART_MUTATION = `mutation addCartItemV2($addCartItemInput: AddCartItemInput!, $fulfillmentContext: FulfillmentContextInput!, $shouldKeepOnlyOneActiveCart: Boolean, $returnCartFromOrderService: Boolean) {
  addCartItemV2(addCartItemInput: $addCartItemInput, fulfillmentContext: $fulfillmentContext, shouldKeepOnlyOneActiveCart: $shouldKeepOnlyOneActiveCart, returnCartFromOrderService: $returnCartFromOrderService) {
    id
    subtotal
    orders {
      id
      orderItems {
        id
        item {
          id
          name
          __typename
        }
        quantity
        specialInstructions
        __typename
      }
      __typename
    }
    __typename
  }
}`;

interface AddItemResponse {
  addCartItemV2: {
    id: string;
    subtotal: number;
    orders: Array<{
      id: string;
      orderItems: Array<{
        id: string;
        item: { id: string; name: string };
        quantity: number;
        specialInstructions: string | null;
      }>;
    }>;
  };
}

function parseDisplayPriceToCents(displayPrice: string): number {
  const cleaned = displayPrice.replace(/[^0-9.]/g, '');
  const dollars = parseFloat(cleaned);
  if (isNaN(dollars)) return 0;
  return Math.round(dollars * 100);
}

export async function addToCart(
  input: AddToCartInput,
): Promise<AddToCartOutput> {
  const quantity = input.quantity || 1;
  const unitPrice = parseDisplayPriceToCents(input.displayPrice);

  const nestedOptions = (input.options || []).map((opt) => ({
    id: opt.optionId,
    quantity: opt.quantity || 1,
    options: [],
  }));

  const variables = {
    addCartItemInput: {
      cartId: '',
      storeId: input.storeId,
      menuId: input.menuId,
      itemId: input.itemId,
      itemName: input.itemName,
      itemDescription: '',
      unitPrice,
      currency: 'USD',
      quantity,
      nestedOptions: JSON.stringify(nestedOptions),
      specialInstructions: input.specialInstructions || undefined,
      substitutionPreference: 'substitute',
    },
    fulfillmentContext: {
      fulfillmentType: 'Delivery',
      shouldUpdateFulfillment: false,
    },
    shouldKeepOnlyOneActiveCart: true,
    returnCartFromOrderService: false,
  };

  const data = await graphql<AddItemResponse>(
    input.csrf,
    'addCartItemV2',
    ADD_TO_CART_MUTATION,
    variables,
  );

  const cart = data.addCartItemV2;
  const allItems = cart.orders?.[0]?.orderItems || [];
  const addedItem =
    [...allItems].reverse().find((item) => item.item.id === input.itemId) ||
    allItems[allItems.length - 1];

  const resolvedQuantity = addedItem?.quantity || quantity;
  const lineTotalCents = unitPrice * resolvedQuantity;
  const totalPrice = `$${(lineTotalCents / 100).toFixed(2)}`;
  const cartTotal = `$${((cart.subtotal || 0) / 100).toFixed(2)}`;

  return {
    cartItemId: addedItem?.id || '',
    itemName: input.itemName,
    quantity: resolvedQuantity,
    totalPrice,
    cartTotal,
  };
}

// ============================================================================
// removeFromCart
// ============================================================================

const REMOVE_FROM_CART_MUTATION = `mutation removeCartItem($cartId: ID!, $itemId: ID!, $returnCartFromOrderService: Boolean, $monitoringContext: MonitoringContextInput, $cartContext: CartContextInput) {
  removeCartItemV2(
    cartId: $cartId
    itemId: $itemId
    returnCartFromOrderService: $returnCartFromOrderService
    monitoringContext: $monitoringContext
    cartContext: $cartContext
  ) {
    id
    subtotal
    orders {
      id
      orderItems {
        id
        __typename
      }
      __typename
    }
    __typename
  }
}`;

interface RemoveItemResponse {
  removeCartItemV2: {
    id: string;
    subtotal: number;
    orders: Array<{
      id: string;
      orderItems: Array<{ id: string }>;
    }>;
  } | null;
}

export async function removeFromCart(
  input: RemoveFromCartInput,
): Promise<RemoveFromCartOutput> {
  const csrf = input.csrf || getCookie('csrf_token') || '';
  // Fetch cart first to (a) get cartId needed by the mutation, and (b) verify
  // the item actually exists. removeCartItemV2 is idempotent; it silently
  // accepts unknown itemIds and returns the unchanged cart, so we must check
  // presence ourselves before calling.
  const cartData = await graphql<{
    consumerOrderCart: {
      id: string;
      subtotal: number;
      groupCart: boolean;
      urlCode: string | null;
      orders: Array<{ id: string; orderItems: Array<{ id: string }> }>;
    } | null;
  }>(
    csrf,
    'consumerOrderCart',
    `
      query consumerOrderCart {
        consumerOrderCart {
          id
          subtotal
          groupCart
          urlCode
          orders {
            id
            orderItems {
              id
              __typename
            }
            __typename
          }
        }
      }
    `,
    {},
  );
  const cart = cartData.consumerOrderCart;
  if (!cart) {
    return { removed: false, cartTotal: null, itemCount: 0 };
  }

  const allItemsBefore = cart.orders.flatMap((o) => o.orderItems);
  const itemExists = allItemsBefore.some(
    (item) => item.id === input.cartItemId,
  );

  if (!itemExists) {
    // Item is not in the cart; return false without mutating
    const itemCount = allItemsBefore.length;
    return {
      removed: false,
      cartTotal: itemCount > 0 ? formatCents(cart.subtotal) : null,
      itemCount,
    };
  }

  // For group carts the API expects urlCode || id as the cartId
  const cartId = cart.groupCart ? cart.urlCode || cart.id : cart.id;

  const variables = {
    cartId,
    itemId: input.cartItemId,
    returnCartFromOrderService: false,
    monitoringContext: { isGroup: cart.groupCart || false },
    cartContext: { deleteBundleCarts: input.deleteBundleCarts ?? false },
  };

  const data = await graphql<RemoveItemResponse>(
    csrf,
    'removeCartItem',
    REMOVE_FROM_CART_MUTATION,
    variables,
  );

  const result = data.removeCartItemV2;
  const allItems = (result?.orders ?? []).flatMap((o) => o.orderItems);
  const itemCount = allItems.length;
  return {
    removed: true,
    cartTotal: itemCount > 0 ? formatCents(result?.subtotal ?? null) : null,
    itemCount,
  };
}

// ============================================================================
// updateCartItem
// ============================================================================

// updateItemInCart was removed from DoorDash's GraphQL schema.
// Replacement: updateCartItemV2 with UpdateCartItemInput (requires cartId,
// storeId, itemId (fetched internally via consumerOrderCart).
const UPDATE_CART_ITEM_MUTATION = `mutation updateCartItemV2($updateCartItemInput: UpdateCartItemInput!, $fulfillmentContext: FulfillmentContextInput!, $returnCartFromOrderService: Boolean, $shouldKeepOnlyOneActiveCart: Boolean, $cartContextFilter: CartContextV2) {
  updateCartItemV2(updateCartItemInput: $updateCartItemInput, fulfillmentContext: $fulfillmentContext, returnCartFromOrderService: $returnCartFromOrderService, shouldKeepOnlyOneActiveCart: $shouldKeepOnlyOneActiveCart, cartContextFilter: $cartContextFilter) {
    id
    subtotal
    orders {
      id
      orderItems {
        id
        quantity
        priceOfTotalQuantity
        __typename
      }
      __typename
    }
    __typename
  }
}`;

interface UpdateItemResponse {
  updateCartItemV2: {
    id: string;
    subtotal: number | null;
    orders: Array<{
      id: string;
      orderItems: Array<{
        id: string;
        quantity: number;
        priceOfTotalQuantity: number;
      }>;
    }> | null;
  } | null;
}

export async function updateCartItem(
  input: UpdateCartItemInput,
): Promise<UpdateCartItemOutput> {
  const csrf = input.csrf || getCookie('csrf_token') || '';

  // Fetch cart to resolve cartId, storeId, menuId, and itemId (menu item ID)
  // required by updateCartItemV2 but not exposed in the caller's schema.
  const cartData = await graphql<{
    consumerOrderCart: {
      id: string;
      subtotal: number;
      groupCart: boolean;
      urlCode: string | null;
      restaurant: { id: string } | null;
      menu: { id: string } | null;
      orders: Array<{
        id: string;
        orderItems: Array<{ id: string; item: { id: string } }>;
      }>;
    } | null;
  }>(
    csrf,
    'consumerOrderCart',
    `
      query consumerOrderCart {
        consumerOrderCart {
          id
          subtotal
          groupCart
          urlCode
          restaurant {
            id
            __typename
          }
          menu {
            id
            __typename
          }
          orders {
            id
            orderItems {
              id
              item {
                id
                __typename
              }
              __typename
            }
            __typename
          }
        }
      }
    `,
    {},
  );

  const cart = cartData.consumerOrderCart;
  if (!cart) {
    throw new NotFound('updateCartItem: No active cart found.');
  }

  const cartId = cart.groupCart ? cart.urlCode || cart.id : cart.id;
  const storeId = cart.restaurant?.id;
  if (!storeId) {
    throw new ContractDrift('updateCartItem: Cart has no associated store.');
  }

  const allOrderItems = cart.orders.flatMap((o) => o.orderItems);
  const targetOrderItem = allOrderItems.find(
    (oi) => oi.id === input.cartItemId,
  );
  if (!targetOrderItem) {
    throw new NotFound(
      `updateCartItem: Cart item ${input.cartItemId} not found in current cart.`,
    );
  }
  const menuItemId = targetOrderItem.item.id;
  const menuId = cart.menu?.id;

  const nestedOptions = (input.options || []).map((opt) => ({
    id: opt.optionId,
    quantity: opt.quantity || 1,
    options: [],
  }));

  const variables: Record<string, unknown> = {
    updateCartItemInput: {
      cartId,
      storeId,
      itemId: menuItemId,
      quantity: input.quantity ?? 1,
      cartItemId: input.cartItemId,
      ...(menuId && { menuId }),
      ...(input.specialInstructions !== undefined && {
        specialInstructions: input.specialInstructions,
      }),
      ...(input.substitutionPreference && {
        substitutionPreference: input.substitutionPreference,
      }),
      ...(input.options && {
        nestedOptions: JSON.stringify(nestedOptions),
      }),
      ...(input.itemName !== undefined && { itemName: input.itemName }),
      ...(input.itemDescription !== undefined && {
        itemDescription: input.itemDescription,
      }),
      ...(input.unitPrice !== undefined && { unitPrice: input.unitPrice }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.purchaseTypeOptions !== undefined && {
        purchaseTypeOptions: input.purchaseTypeOptions,
      }),
      ...(input.isAdsItem !== undefined && { isAdsItem: input.isAdsItem }),
      ...(input.isBundle !== undefined && { isBundle: input.isBundle }),
      ...(input.bundleType !== undefined && { bundleType: input.bundleType }),
      ...(input.cartFilter !== undefined && { cartFilter: input.cartFilter }),
    },
    fulfillmentContext: {
      shouldUpdateFulfillment: input.fulfillmentType !== undefined,
      fulfillmentType: input.fulfillmentType ?? 'Delivery',
    },
    returnCartFromOrderService: input.returnCartFromOrderService ?? false,
    ...(input.shouldKeepOnlyOneActiveCart !== undefined && {
      shouldKeepOnlyOneActiveCart: input.shouldKeepOnlyOneActiveCart,
    }),
  };

  const data = await graphql<UpdateItemResponse>(
    csrf,
    'updateCartItemV2',
    UPDATE_CART_ITEM_MUTATION,
    variables,
  );

  const updatedCart = data.updateCartItemV2;
  if (!updatedCart) {
    throw new ContractDrift('updateCartItem: Server returned null after update.');
  }

  // When quantity=0 removes the last item, server returns orders: null, subtotal: null
  const allItems = (updatedCart.orders ?? []).flatMap((o) => o.orderItems);
  const updatedItem = allItems.find((oi) => oi.id === input.cartItemId);
  const updatedQty = updatedItem?.quantity ?? input.quantity ?? 0;
  const totalPriceCents = updatedItem?.priceOfTotalQuantity ?? 0;

  return {
    cartItemId: input.cartItemId,
    quantity: updatedQty,
    totalPrice: formatCents(totalPriceCents) || '$0.00',
    cartTotal: formatCents(updatedCart.subtotal ?? 0) || '$0.00',
  };
}

// ============================================================================
// applyPromoCode
// ============================================================================

const APPLY_PROMO_MUTATION = `mutation addPromoCodeV2($promoCode: String!, $orderCartId: String, $storeId: String, $isCardPayment: Boolean) {
  addPromoCodeV2(
    promoCode: $promoCode
    orderCartId: $orderCartId
    storeId: $storeId
    isCardPayment: $isCardPayment
  )
}`;

interface _ApplyPromoResponse {
  addPromoCodeV2: boolean;
}

export async function applyPromoCode(
  input: ApplyPromoCodeInput,
): Promise<ApplyPromoCodeOutput> {
  const variables: Record<string, unknown> = {
    promoCode: input.promoCode,
    isCardPayment: false,
  };

  const operationName = 'addPromoCodeV2';
  const origin = window.location.origin;
  const url = `${origin}/graphql/${operationName}?operation=${operationName}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: getRequiredHeaders(input.csrf),
    body: JSON.stringify({
      operationName,
      variables,
      query: APPLY_PROMO_MUTATION,
    }),
    credentials: 'include',
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const json = await resp.json();

  if (json.errors && json.errors.length > 0) {
    return {
      applied: false,
      promoCode: input.promoCode,
      discountAmount: null,
      cartTotal: '',
      message: json.errors[0].message,
    };
  }

  return {
    applied: json.data?.addPromoCodeV2 === true,
    promoCode: input.promoCode,
    discountAmount: null,
    cartTotal: '',
    message: null,
  };
}

// ============================================================================
// removePromoCode
// ============================================================================

const REMOVE_PROMO_MUTATION = `mutation removePromoCode($promoCode: String!, $orderCartId: String!) {
  removePromoCode(promoCode: $promoCode, orderCartId: $orderCartId) {
    id
    total
    subtotal
    __typename
  }
}`;

const REMOVE_PROMO_PREFETCH_QUERY = `query consumerOrderCart {
  consumerOrderCart {
    id
    consumerPromotion {
      code
      __typename
    }
    __typename
  }
}`;

const REMOVE_PROMO_PREFETCH_BY_ID_QUERY = `query orderCart($orderCartId: ID!) {
  orderCart(id: $orderCartId) {
    id
    consumerPromotion {
      code
      __typename
    }
    __typename
  }
}`;

interface RemovePromoPrefetchResponse {
  consumerOrderCart: {
    id: string;
    consumerPromotion: Array<{ code: string }> | null;
  } | null;
}

interface RemovePromoPrefetchByIdResponse {
  orderCart: {
    id: string;
    consumerPromotion: Array<{ code: string }> | null;
  } | null;
}

interface RemovePromoResponse {
  removePromoCode: {
    id: string;
    total: number | null;
    subtotal: number | null;
  } | null;
}

export async function removePromoCode(
  input: RemovePromoCodeInput,
): Promise<RemovePromoCodeOutput> {
  const csrf = input.csrf || getCookie('csrf_token') || '';

  let orderCartId = input.orderCartId || null;
  let appliedCodes: string[] = [];

  if (orderCartId) {
    const prefetch = await graphql<RemovePromoPrefetchByIdResponse>(
      csrf,
      'orderCart',
      REMOVE_PROMO_PREFETCH_BY_ID_QUERY,
      { orderCartId },
    );
    const cart = prefetch.orderCart;
    if (!cart) {
      throw new NotFound(
        `removePromoCode: Cart not found for orderCartId=${orderCartId}`,
      );
    }
    appliedCodes = (cart.consumerPromotion || []).map((p) =>
      p.code.toUpperCase(),
    );
  } else {
    const prefetch = await graphql<RemovePromoPrefetchResponse>(
      csrf,
      'consumerOrderCart',
      REMOVE_PROMO_PREFETCH_QUERY,
      {},
    );
    const cart = prefetch.consumerOrderCart;
    if (!cart) {
      throw new NotFound(
        'removePromoCode: No active cart found. Add items to a store first.',
      );
    }
    orderCartId = cart.id;
    appliedCodes = (cart.consumerPromotion || []).map((p) =>
      p.code.toUpperCase(),
    );
  }

  if (!appliedCodes.includes(input.promoCode.toUpperCase())) {
    return { removed: false, cartTotal: null };
  }

  const data = await graphql<RemovePromoResponse>(
    csrf,
    'removePromoCode',
    REMOVE_PROMO_MUTATION,
    { promoCode: input.promoCode, orderCartId },
  );

  const cart = data.removePromoCode;
  return {
    removed: cart !== null,
    cartTotal: cart?.total != null ? String(cart.total) : null,
  };
}

// ============================================================================
// listAddresses
// ============================================================================

const GET_AVAILABLE_ADDRESSES_QUERY = `query getAvailableAddresses {
  getAvailableAddresses {
    id
    addressId
    street
    subpremise
    city
    state
    zipCode
    country
    lat
    lng
    manualLat
    manualLng
    driverInstructions
    printableAddress
    addressLinkType
    buildingName
    entryCode
    personalAddressLabel {
      labelIcon
      labelName
    }
    dropoffPreferences {
      allPreferences {
        optionId
        isDefault
        instructions
      }
    }
    __typename
  }
}`;

interface GetAvailableAddressesResponse {
  getAvailableAddresses: Array<{
    id: string;
    addressId: string;
    street: string;
    subpremise: string | null;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    lat: number | null;
    lng: number | null;
    manualLat: number | null;
    manualLng: number | null;
    driverInstructions: string | null;
    printableAddress: string;
    addressLinkType: string;
    buildingName: string | null;
    entryCode: string | null;
    personalAddressLabel: { labelIcon: string; labelName: string } | null;
    dropoffPreferences: {
      allPreferences: Array<{
        optionId: string;
        isDefault: boolean;
        instructions: string;
      }>;
    } | null;
  }>;
}

function mapAddress(addr: {
  id: string;
  addressId: string;
  street: string;
  subpremise: string | null;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  lat: number | null;
  lng: number | null;
  manualLat: number | null;
  manualLng: number | null;
  driverInstructions: string | null;
  printableAddress: string;
  addressLinkType: string;
  buildingName?: string | null;
  entryCode?: string | null;
  personalAddressLabel?: { labelIcon: string; labelName: string } | null;
  dropoffPreferences?: {
    allPreferences: Array<{
      optionId: string;
      isDefault: boolean;
      instructions: string;
    }>;
  } | null;
}): Address {
  // Get delivery instructions from the active (isDefault=true) dropoff preference
  const activePreference = addr.dropoffPreferences?.allPreferences?.find(
    (p) => p.isDefault,
  );
  const deliveryInstructions =
    activePreference?.instructions || addr.driverInstructions || null;

  return {
    id: addr.id,
    addressId: addr.addressId,
    street: addr.street,
    subpremise: addr.subpremise || null,
    city: addr.city,
    state: addr.state,
    zipCode: addr.zipCode,
    country: addr.country,
    label: addr.personalAddressLabel?.labelName || null,
    deliveryInstructions: deliveryInstructions || null,
    isDefault: false,
    lat: addr.lat ?? null,
    lng: addr.lng ?? null,
    manualLat: addr.manualLat ?? null,
    manualLng: addr.manualLng ?? null,
    printableAddress: addr.printableAddress,
    addressLinkType: addr.addressLinkType,
    buildingName: addr.buildingName || null,
    entryCode: addr.entryCode || null,
  };
}

export async function listAddresses(
  input: ListAddressesInput,
): Promise<ListAddressesOutput> {
  if (!input.csrf) {
    throw new Unauthenticated(
      `CSRF token is required. Call getContext() first. URL: ${window.location.href}`,
    );
  }

  const data = await graphql<GetAvailableAddressesResponse>(
    input.csrf,
    'getAvailableAddresses',
    GET_AVAILABLE_ADDRESSES_QUERY,
    {},
  );

  const addresses = (data.getAvailableAddresses || []).map(mapAddress);

  return { addresses };
}

// ============================================================================
// addAddress
// ============================================================================

const ADD_CONSUMER_ADDRESS_MUTATION = `mutation addConsumerAddress(
  $lat: Float!,
  $lng: Float!,
  $city: String!,
  $state: String!,
  $zipCode: String!,
  $printableAddress: String!,
  $shortname: String!,
  $googlePlaceId: String!,
  $subpremise: String,
  $driverInstructions: String
) {
  addConsumerAddress(
    lat: $lat,
    lng: $lng,
    city: $city,
    state: $state,
    zipCode: $zipCode,
    printableAddress: $printableAddress,
    shortname: $shortname,
    googlePlaceId: $googlePlaceId,
    subpremise: $subpremise,
    driverInstructions: $driverInstructions
  ) {
    id
    __typename
  }
}`;

interface AddConsumerAddressResponse {
  addConsumerAddress: {
    id: string;
    __typename: string;
  };
}

interface GeoAutocompleteResponse {
  predictions: Array<{
    lat: number;
    lng: number;
    formatted_address: string;
    formatted_address_short: string;
    source_place_id: string;
    postal_code: string;
    administrative_area_level1: string;
    locality: string;
    street_address: string;
  }>;
}

export async function addAddress(
  input: AddAddressInput,
): Promise<AddAddressOutput> {
  if (!input.csrf) {
    throw new Unauthenticated(
      `CSRF token is required. Call getContext() first. URL: ${window.location.href}`,
    );
  }

  if (!input.street || !input.street.trim()) {
    throw new Validation('addAddress: street is required and cannot be empty');
  }

  // Runtime enum validation (TypeScript types are stripped in browser context)
  if (input.label !== undefined) {
    const validLabels = ['Home', 'Work', 'Other'];
    if (!validLabels.includes(input.label)) {
      throw new Validation(
        `addAddress: invalid label "${input.label}". Must be one of: ${validLabels.join(', ')}`,
      );
    }
  }

  // Step 1: Geocode address using DoorDash's internal geo-intelligence API
  const query = [
    input.street,
    input.subpremise,
    input.city,
    input.state,
    input.zipCode,
  ]
    .filter(Boolean)
    .join(' ');

  const getCookie = (name: string): string => {
    const match = document.cookie.match(
      new RegExp('(?:^|; )' + name + '=([^;]*)'),
    );
    return match ? decodeURIComponent(match[1]) : '';
  };
  const ddIds = JSON.stringify({
    dd_device_id: getCookie('dd_device_id'),
    dd_session_id: getCookie('dd_session_id'),
  });

  const geoRes = await fetch(
    `/unified-gateway/geo-intelligence/v2/address/autocomplete?input_address=${encodeURIComponent(query)}&autocomplete_type=AUTOCOMPLETE_TYPE_V2_UNSPECIFIED`,
    {
      headers: {
        'x-unified-gateway-generated-source': 'v1',
        'dd-ids': ddIds,
        'X-Experience-Id': 'doordash',
      },
      credentials: 'include',
    },
  );

  if (!geoRes.ok) {
    throwForStatus(geoRes.status);
  }

  const geoData: GeoAutocompleteResponse = await geoRes.json();

  if (!geoData.predictions || geoData.predictions.length === 0) {
    throw new NotFound(
      `Address not found: "${query}". Try a more specific address.`,
    );
  }

  const prediction = geoData.predictions[0];

  // Step 2: Add address via GraphQL mutation with individual top-level args
  await graphql<AddConsumerAddressResponse>(
    input.csrf,
    'addConsumerAddress',
    ADD_CONSUMER_ADDRESS_MUTATION,
    {
      lat: prediction.lat,
      lng: prediction.lng,
      city: prediction.locality || input.city,
      state: prediction.administrative_area_level1 || input.state,
      zipCode: prediction.postal_code || input.zipCode,
      printableAddress: prediction.formatted_address,
      shortname: prediction.formatted_address_short,
      googlePlaceId: prediction.source_place_id,
      ...(input.subpremise ? { subpremise: input.subpremise } : {}),
      ...(input.deliveryInstructions
        ? { driverInstructions: input.deliveryInstructions }
        : {}),
    },
  );

  // Step 3: Retrieve the newly added address from getAvailableAddresses
  const addrData = await graphql<GetAvailableAddressesResponse>(
    input.csrf,
    'getAvailableAddresses',
    GET_AVAILABLE_ADDRESSES_QUERY,
    {},
  );

  const available = addrData.getAvailableAddresses || [];

  const normalizeStr = (s: string) => s.toLowerCase().trim();
  const targetCity = normalizeStr(prediction.locality || input.city);
  const targetZip = (prediction.postal_code || input.zipCode).trim();

  const newAddr =
    available.find(
      (a) =>
        normalizeStr(a.city) === targetCity &&
        a.zipCode.trim() === targetZip &&
        normalizeStr(a.street).includes(normalizeStr(input.street)),
    ) || available[available.length - 1];

  if (!newAddr) {
    throw new ContractDrift('Address was added but could not be retrieved.');
  }

  // Step 4: If label is provided, call the unified-gateway links endpoint to attach it.
  // Discovered from HAR: POST /unified-gateway/cx/addresses/v1/links
  if (input.label) {
    const labelTypeMap: Record<string, string> = {
      Home: 'HOME',
      Work: 'WORK',
      Other: 'OTHER',
    };

    // DoorDash encodes type IDs as base64 of `v1\x00{"type":"TYPE_NAME"}`
    const encodeTypeId = (typeName: string): string =>
      btoa('v1\x00{"type":"' + typeName + '"}').replace(/=+$/, '');

    const labelTypeKey = labelTypeMap[input.label] || 'NONE';

    const leaveOptionId = 'CAIaATI';
    const meetOptionId = 'CAEaATE';
    const subOptionId = 'CAE';
    const dropoffPreferences = [
      {
        option_id: leaveOptionId,
        sub_option_id: subOptionId,
        is_default: true,
      },
      {
        option_id: meetOptionId,
        sub_option_id: subOptionId,
        is_default: false,
      },
    ];

    const linksRes = await fetch(
      `${window.location.origin}/unified-gateway/cx/addresses/v1/links`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-unified-gateway-generated-source': 'v1',
          'dd-ids': ddIds,
          'X-Experience-Id': 'doordash',
        },
        credentials: 'include',
        body: JSON.stringify({
          address_id: newAddr.addressId,
          dropoff_preferences: dropoffPreferences,
          label: { label_type_id: encodeTypeId(labelTypeKey) },
          link_type: 'ADDRESS_LINK_TYPE_UNSPECIFIED',
          address_type_id: encodeTypeId('OTHER'),
          address_field_values: {
            subpremise: input.subpremise || '',
            entry_code: '',
            building_name: '',
          },
        }),
      },
    );
    if (!linksRes.ok) {
      const text = await linksRes.text().catch(() => undefined);
      throwForStatus(linksRes.status, text);
    }
  }

  return {
    address: {
      id: newAddr.id,
      addressId: newAddr.addressId,
      street: newAddr.street,
      subpremise: newAddr.subpremise || null,
      city: newAddr.city,
      state: newAddr.state,
      zipCode: newAddr.zipCode,
      country: newAddr.country,
      label: input.label || null,
      deliveryInstructions: input.deliveryInstructions || null,
      isDefault: false,
      lat: newAddr.lat ?? null,
      lng: newAddr.lng ?? null,
      manualLat: newAddr.manualLat ?? null,
      manualLng: newAddr.manualLng ?? null,
      printableAddress: newAddr.printableAddress,
      addressLinkType: newAddr.addressLinkType,
      buildingName: newAddr.buildingName ?? null,
      entryCode: newAddr.entryCode ?? null,
    },
  };
}

// ============================================================================
// updateAddress
// ============================================================================

// Opaque address_type_id values (base64-encoded protobuf: v1\x00{"type":"TYPE"})
const ADDRESS_TYPE_IDS: Record<string, string> = {
  House: 'djEAeyJ0eXBlIjoiSE9VU0UifQ',
  Apartment: 'djEAeyJ0eXBlIjoiQVBBUlRNRU5UIn0',
  Hotel: 'djEAeyJ0eXBlIjoiSE9URUwifQ',
  Office: 'djEAeyJ0eXBlIjoiT0ZGSUNFIn0',
  Other: 'djEAeyJ0eXBlIjoiT1RIRVIifQ',
  None: 'djEAeyJ0eXBlIjoiTk9ORSJ9',
};

// Opaque label_type_id values (same encoding pattern)
const LABEL_TYPE_IDS: Record<string, string> = {
  Home: 'djEAeyJ0eXBlIjoiSE9NRSJ9',
  Work: 'djEAeyJ0eXBlIjoiV09SSyJ9',
  None: 'djEAeyJ0eXBlIjoiTk9ORSJ9',
};

// Dropoff option IDs (base64-encoded protobuf)
// optionId "2" = Leave at door, optionId "1" = Meet at door
const DROPOFF_OPTION_LEAVE_AT_DOOR = 'CAIaATI';
const DROPOFF_OPTION_MEET_AT_DOOR = 'CAEaATE';

export async function updateAddress(
  input: UpdateAddressInput,
): Promise<UpdateAddressOutput> {
  if (!input.csrf) {
    throw new Unauthenticated(
      `CSRF token is required. Call getContext() first. URL: ${window.location.href}`,
    );
  }

  if (!input.addressId) {
    throw new Validation(
      'updateAddress: addressId is required; get it from listAddresses (the id field)',
    );
  }

  const VALID_LABELS = ['Home', 'Work', 'None'];
  if (input.label !== undefined && !VALID_LABELS.includes(input.label)) {
    throw new Validation(
      `updateAddress: invalid label "${input.label}"; must be one of: ${VALID_LABELS.join(', ')}`,
    );
  }

  const VALID_ADDRESS_TYPES = [
    'House',
    'Apartment',
    'Hotel',
    'Office',
    'Other',
    'None',
  ];
  if (
    input.addressType !== undefined &&
    !VALID_ADDRESS_TYPES.includes(input.addressType)
  ) {
    throw new Validation(
      `updateAddress: invalid addressType "${input.addressType}"; must be one of: ${VALID_ADDRESS_TYPES.join(', ')}`,
    );
  }

  const patchBody: Record<string, unknown> = {
    experience: 'DOORDASH',
  };

  // Address type
  if (input.addressType !== undefined) {
    patchBody.address_type_id =
      ADDRESS_TYPE_IDS[input.addressType] ?? ADDRESS_TYPE_IDS.None;
  }

  // Label
  if (input.label !== undefined) {
    patchBody.label = {
      label_type_id: LABEL_TYPE_IDS[input.label] ?? LABEL_TYPE_IDS.None,
    };
  }

  // Address field values (subpremise, entry_code, building_name, business_name)
  const fieldValues: Record<string, string> = {};
  if (input.subpremise !== undefined) fieldValues.subpremise = input.subpremise;
  if (input.entryCode !== undefined) fieldValues.entry_code = input.entryCode;
  if (input.buildingName !== undefined)
    fieldValues.building_name = input.buildingName;
  if (input.businessName !== undefined)
    fieldValues.business_name = input.businessName;
  if (Object.keys(fieldValues).length > 0) {
    patchBody.address_field_values = fieldValues;
  }

  // Dropoff preferences + delivery instructions
  if (
    input.dropoffPreference !== undefined ||
    input.deliveryInstructions !== undefined
  ) {
    const leaveAtDoor = input.dropoffPreference !== 'meet_at_door';
    const instructions = input.deliveryInstructions ?? '';
    patchBody.dropoff_preferences = [
      {
        option_id: DROPOFF_OPTION_LEAVE_AT_DOOR,
        is_default: leaveAtDoor,
        instructions: leaveAtDoor ? instructions : '',
      },
      {
        option_id: DROPOFF_OPTION_MEET_AT_DOOR,
        is_default: !leaveAtDoor,
        instructions: !leaveAtDoor ? instructions : '',
      },
    ];
  }

  const resp = await fetch(
    `${window.location.origin}/unified-gateway/cx/addresses/v1/links/${input.addressId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-csrftoken': input.csrf,
        'x-experience-id': 'doordash',
        'x-unified-gateway-generated-source': 'v1',
        'apollographql-client-name':
          '@doordash/app-consumer-production-ssr-client',
        'apollographql-client-version': '3.0',
      },
      body: JSON.stringify(patchBody),
      credentials: 'include',
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  // Fetch the updated address list and return the matching address
  const addrData = await graphql<GetAvailableAddressesResponse>(
    input.csrf,
    'getAvailableAddresses',
    GET_AVAILABLE_ADDRESSES_QUERY,
    {},
  );

  const updatedAddr = (addrData.getAvailableAddresses || []).find(
    (a) => a.id === input.addressId,
  );

  if (!updatedAddr) {
    throw new ContractDrift(
      `updateAddress: address ${input.addressId} not found after update`,
    );
  }

  return { address: mapAddress(updatedAddr) };
}

// ============================================================================
// deleteAddress
// ============================================================================

const REMOVE_CONSUMER_ADDRESS_V2_MUTATION = `mutation removeConsumerAddressV2($defaultAddressId: ID!) {
  removeConsumerAddressV2(defaultAddressId: $defaultAddressId) {
    defaultAddress {
      id
      addressId
      street
      subpremise
      city
      state
      zipCode
      country
      lat
      lng
      __typename
    }
    availableAddresses {
      id
      addressId
      street
      subpremise
      city
      state
      zipCode
      country
      lat
      lng
      __typename
    }
    __typename
  }
}`;

interface RemoveConsumerAddressV2Response {
  removeConsumerAddressV2: {
    defaultAddress: {
      id: string;
      addressId: string;
      street: string;
      subpremise: string | null;
      city: string;
      state: string;
      zipCode: string;
      country: string;
      lat: number | null;
      lng: number | null;
    } | null;
    availableAddresses: Array<{
      id: string;
      addressId: string;
      street: string;
      subpremise: string | null;
      city: string;
      state: string;
      zipCode: string;
      country: string;
      lat: number | null;
      lng: number | null;
    }>;
  };
}

export async function deleteAddress(
  input: DeleteAddressInput,
): Promise<DeleteAddressOutput> {
  if (!input.csrf) {
    throw new Unauthenticated(
      `CSRF token is required. Call getContext() first. URL: ${window.location.href}`,
    );
  }

  const data = await graphql<RemoveConsumerAddressV2Response>(
    input.csrf,
    'removeConsumerAddressV2',
    REMOVE_CONSUMER_ADDRESS_V2_MUTATION,
    { defaultAddressId: input.addressId },
  );

  const result = data.removeConsumerAddressV2;

  return {
    success: true,
    defaultAddress: result.defaultAddress
      ? {
          id: result.defaultAddress.id,
          addressId: result.defaultAddress.addressId,
          street: result.defaultAddress.street,
          subpremise: result.defaultAddress.subpremise ?? null,
          city: result.defaultAddress.city,
          state: result.defaultAddress.state,
          zipCode: result.defaultAddress.zipCode,
          country: result.defaultAddress.country,
          lat: result.defaultAddress.lat ?? null,
          lng: result.defaultAddress.lng ?? null,
        }
      : null,
    availableAddresses: (result.availableAddresses ?? []).map((a) => ({
      id: a.id,
      addressId: a.addressId,
      street: a.street,
      subpremise: a.subpremise ?? null,
      city: a.city,
      state: a.state,
      zipCode: a.zipCode,
      country: a.country,
      lat: a.lat ?? null,
      lng: a.lng ?? null,
    })),
  };
}

// ============================================================================
// listPaymentMethods
// ============================================================================

const GET_PAYMENT_METHOD_LIST_QUERY = `query paymentMethodQuery {
  getPaymentMethodList {
    id
    type
    last4
    expMonth
    expYear
    isDefault
    paymentMethodUuid
    paymentMethodType
    paymentTags
    card {
      brand
      last4
      expMonth
      expYear
      country
      iin
      __typename
    }
    __typename
  }
}`;

interface GetPaymentMethodListResponse {
  getPaymentMethodList: Array<{
    id: string;
    type: string;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    isDefault: boolean;
    paymentMethodUuid: string | null;
    paymentMethodType: string | null;
    paymentTags: string[];
    card: {
      brand: string | null;
      last4: string | null;
      expMonth: number | null;
      expYear: number | null;
      country: string | null;
      iin: string | null;
    } | null;
  }>;
}

export async function listPaymentMethods(
  input: ListPaymentMethodsInput,
): Promise<ListPaymentMethodsOutput> {
  const csrf = input.csrf || getCookie('csrf_token');
  if (!csrf) {
    throw new Unauthenticated(
      `listPaymentMethods: CSRF token not found. Call getContext() first or navigate to doordash.com. URL: ${window.location.href}`,
    );
  }

  const data = await graphql<GetPaymentMethodListResponse>(
    csrf,
    'paymentMethodQuery',
    GET_PAYMENT_METHOD_LIST_QUERY,
    {},
  );

  const paymentMethods = (data.getPaymentMethodList || []).map((pm) => ({
    id: pm.id,
    type: pm.type,
    last4: pm.last4 || null,
    expMonth: pm.expMonth ?? null,
    expYear: pm.expYear ?? null,
    isDefault: pm.isDefault,
    paymentMethodUuid: pm.paymentMethodUuid || null,
    paymentMethodType: pm.paymentMethodType || null,
    paymentTags: pm.paymentTags || [],
    card: pm.card
      ? {
          brand: pm.card.brand || null,
          last4: pm.card.last4 || null,
          expMonth: pm.card.expMonth ?? null,
          expYear: pm.card.expYear ?? null,
          country: pm.card.country || null,
          iin: pm.card.iin || null,
        }
      : null,
  }));

  return { paymentMethods };
}

// ============================================================================
// getCreditsBalance
// ============================================================================

const GET_CONSUMER_ACCOUNT_CREDITS_QUERY = `query getConsumerAccountCredits {
  getConsumerAccountCredits {
    accountCredits
    __typename
  }
}`;

interface GetConsumerAccountCreditsResponse {
  getConsumerAccountCredits: {
    accountCredits: number;
  };
}

export async function getCreditsBalance(
  input: GetCreditsBalanceInput,
): Promise<GetCreditsBalanceOutput> {
  const csrf = input.csrf || getCookie('csrf_token');
  if (!csrf) {
    throw new Unauthenticated(
      `getCreditsBalance: CSRF token not found. Call getContext() first or navigate to doordash.com. URL: ${window.location.href}`,
    );
  }

  const data = await graphql<GetConsumerAccountCreditsResponse>(
    csrf,
    'getConsumerAccountCredits',
    GET_CONSUMER_ACCOUNT_CREDITS_QUERY,
    {},
  );

  const accountCredits = data.getConsumerAccountCredits.accountCredits;
  const dollars = (accountCredits / 100).toFixed(2);

  return {
    balance: `$${dollars}`,
    balanceCents: accountCredits,
  };
}

// ============================================================================
// getDashPassStatus
// ============================================================================

const GET_DASHPASS_STATUS_QUERY = `query subscriptionInformation {
  subscriptionInformation {
    subscriptionInfo {
      id
      subscriptionStatus
      endTime
      startTime
      canPause
      resumeDate
      subscriptionPlan {
        id
        fee {
          unitAmount
          displayString
        }
        recurrenceIntervalType
        billingProvider
      }
      lastMonthSavingsMonetaryFields {
        unitAmount
        displayString
      }
    }
  }
}`;

interface GetDashPassStatusResponse {
  subscriptionInformation: {
    subscriptionInfo: {
      id: string;
      subscriptionStatus: string;
      endTime: string | null;
      startTime: string | null;
      canPause: boolean | null;
      resumeDate: string | null;
      subscriptionPlan: {
        id: string;
        fee: { unitAmount: number | null; displayString: string | null };
        recurrenceIntervalType: string | null;
        billingProvider: string | null;
      } | null;
      lastMonthSavingsMonetaryFields: {
        unitAmount: number | null;
        displayString: string | null;
      } | null;
    } | null;
  } | null;
}

export async function getDashPassStatus(
  input: GetDashPassStatusInput,
): Promise<GetDashPassStatusOutput> {
  const csrf = input.csrf || getCookie('csrf_token');
  if (!csrf) {
    throw new Unauthenticated(
      `getDashPassStatus: CSRF token not found. Call getContext() first or navigate to doordash.com. URL: ${window.location.href}`,
    );
  }

  const data = await graphql<GetDashPassStatusResponse>(
    csrf,
    'subscriptionInformation',
    GET_DASHPASS_STATUS_QUERY,
    {},
  );

  const info = data.subscriptionInformation?.subscriptionInfo;
  const subscriptionStatus = info?.subscriptionStatus ?? 'does_not_exist';
  const isActive =
    subscriptionStatus !== 'does_not_exist' &&
    subscriptionStatus !== 'inactive';
  const planType =
    info?.subscriptionPlan?.recurrenceIntervalType &&
    info.subscriptionPlan.recurrenceIntervalType !== 'undefined'
      ? info.subscriptionPlan.recurrenceIntervalType
      : null;
  return {
    isActive,
    planType,
    renewalDate: info?.endTime ?? null,
    trialEndDate: null,
    benefits: [],
    monthlyPrice: info?.subscriptionPlan?.fee?.displayString ?? null,
    subscriptionStatus,
    startTime: info?.startTime ?? null,
    lastMonthSavings:
      info?.lastMonthSavingsMonetaryFields?.displayString ?? null,
    canPause: info?.canPause ?? null,
    resumeDate: info?.resumeDate ?? null,
  };
}

// ============================================================================
// rateOrder
// ============================================================================

const RATING_VALUE_MAP: Record<number, string> = {
  1: 'RATING_VALUE_ONE',
  2: 'RATING_VALUE_TWO',
  3: 'RATING_VALUE_THREE',
  4: 'RATING_VALUE_FOUR',
  5: 'RATING_VALUE_FIVE',
};

const CREATE_CONSUMER_RATING_MUTATION = `mutation createConsumerRating($orderUuid: ID, $consumerRatingList: [ConsumerRatingInput], $testing: Boolean) {
  createConsumerRating(orderUuid: $orderUuid, consumerRatingList: $consumerRatingList, testing: $testing) {
    success
    error {
      errorCode
      errorMessage
    }
    __typename
  }
}`;

interface CreateConsumerRatingResponse {
  createConsumerRating: {
    success: boolean;
    error: { errorCode: string; errorMessage: string } | null;
  };
}

export async function rateOrder(
  input: RateOrderInput,
): Promise<RateOrderOutput> {
  if (!input.csrf) {
    throw new Unauthenticated(
      `CSRF token is required. Call getContext() first. URL: ${window.location.href}`,
    );
  }

  if (!input.orderUuid) {
    throw new Validation(`rateOrder: orderUuid is required`);
  }

  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(input.orderUuid)) {
    throw new Validation(
      `rateOrder: orderUuid must be UUID format, got "${input.orderUuid}"`,
    );
  }

  const ratingValue = RATING_VALUE_MAP[input.rating];
  if (!ratingValue) {
    throw new Validation(`rateOrder: invalid rating ${input.rating}, must be 1-5`);
  }

  const consumerRatingList: Record<string, unknown>[] = [
    {
      target: { targetId: 0, targetType: 1 },
      starRating: input.rating,
      reviewText: input.feedback ?? '',
      displayStatusNew: 'REVIEW_DISPLAY_STATUS_PUBLIC',
      markedUpReviewText: '',
      tagList: [],
      ratingInfo: {
        ratingType: 'RATING_TYPE_STAR_RATING',
        ratingValue,
      },
    },
  ];

  if (input.deliveryRating !== undefined && input.deliveryRating !== null) {
    const deliveryRatingValue = RATING_VALUE_MAP[input.deliveryRating];
    if (!deliveryRatingValue) {
      throw new Validation(
        `rateOrder: invalid deliveryRating ${input.deliveryRating}, must be 1-5`,
      );
    }
    consumerRatingList.push({
      target: { targetId: 0, targetType: 2 },
      starRating: input.deliveryRating,
      reviewText: '',
      displayStatusNew: 'REVIEW_DISPLAY_STATUS_PUBLIC',
      markedUpReviewText: '',
      tagList: [],
      ratingInfo: {
        ratingType: 'RATING_TYPE_STAR_RATING',
        ratingValue: deliveryRatingValue,
      },
    });
  }

  const data = await graphql<CreateConsumerRatingResponse>(
    input.csrf,
    'createConsumerRating',
    CREATE_CONSUMER_RATING_MUTATION,
    {
      orderUuid: input.orderUuid,
      consumerRatingList,
      testing: false,
    },
  );

  const result = data.createConsumerRating;
  return {
    success: result.success,
    errorCode: result.error?.errorCode ?? undefined,
    errorMessage: result.error?.errorMessage ?? undefined,
  };
}

// ============================================================================
// reportIssue
// ============================================================================
// NOTE: DoorDash removed the reportOrderIssue GraphQL mutation. Issue creation
// is handled through DoorDash's in-app help system at /orders/help or
// /help/orders/{orderUuid} when an order UUID is provided.

export async function reportIssue(
  input: ReportIssueInput,
): Promise<ReportIssueOutput> {
  // DoorDash's in-app help flow: order-specific help page when UUID is given,
  // otherwise the general order help landing page.
  const helpUrl = input.orderUuid
    ? `${window.location.origin}/help/orders/${input.orderUuid}`
    : `${window.location.origin}/orders/help`;
  window.open(helpUrl, '_blank');
  return {
    helpUrl,
    opened: true,
    message:
      'DoorDash no longer provides an API for issue creation. The help page has been opened for the user to submit their issue.',
  };
}

// ============================================================================
// getIssueStatus
// ============================================================================

// getOrderIssueStatus was removed from DoorDash's GraphQL schema.
// Issue status is now checked via cnrReviewDetails (Credits and Refunds review).
const CNR_REVIEW_DETAILS_QUERY = `query cnrReviewDetails($deliveryUuidList: [ID!]!) {
  cnrReviewDetails(deliveryUuids: $deliveryUuidList) {
    deliveryUuid
    status
    caseCreatedAt
    caseExpiredAt
    caseReviewedAt
  }
}`;

interface CnrReviewDetailsResponse {
  cnrReviewDetails: Array<{
    deliveryUuid: string;
    status: string | null;
    caseCreatedAt: string | null;
    caseExpiredAt: string | null;
    caseReviewedAt: string | null;
  }>;
}

export async function getIssueStatus(
  input: GetIssueStatusInput,
): Promise<GetIssueStatusOutput> {
  if (!input.csrf) {
    throw new Unauthenticated(
      `CSRF token is required. Call getContext() first. URL: ${window.location.href}`,
    );
  }

  const uuids = input.deliveryUuids
    ? [input.deliveryUuid, ...input.deliveryUuids]
    : [input.deliveryUuid];

  const rawData = await graphql<CnrReviewDetailsResponse>(
    input.csrf,
    'cnrReviewDetails',
    CNR_REVIEW_DETAILS_QUERY,
    { deliveryUuidList: uuids },
  );

  const reviews = rawData.cnrReviewDetails;
  const reviewMap = new Map(reviews.map((r) => [r.deliveryUuid, r]));
  const primaryReview = reviewMap.get(input.deliveryUuid) ?? null;

  const result: GetIssueStatusOutput = {
    deliveryUuid: input.deliveryUuid,
    status: (primaryReview?.status as GetIssueStatusOutput['status']) ?? null,
    caseCreatedAt: primaryReview?.caseCreatedAt ?? null,
    caseExpiredAt: primaryReview?.caseExpiredAt ?? null,
    caseReviewedAt: primaryReview?.caseReviewedAt ?? null,
  };

  if (input.deliveryUuids) {
    result.allResults = uuids.map((uuid) => {
      const r = reviewMap.get(uuid) ?? null;
      return {
        deliveryUuid: uuid,
        status: (r?.status as GetIssueStatusOutput['status']) ?? null,
        caseCreatedAt: r?.caseCreatedAt ?? null,
        caseExpiredAt: r?.caseExpiredAt ?? null,
        caseReviewedAt: r?.caseReviewedAt ?? null,
      };
    });
  }

  return result;
}

// ============================================================================
// getAvailablePromotions
// ============================================================================

// getConsumerPromotions was removed from DoorDash's GraphQL schema.
// Promotions are fetched via the checkout operation with orderCartId.
// consumerOrderCart is used first to get the cart UUID if not provided.
const GET_CART_ID_QUERY = `query consumerOrderCart {
  consumerOrderCart {
    id
    __typename
  }
}`;

const GET_CHECKOUT_PROMOTIONS_QUERY = `query checkout($orderCartId: ID!) {
  orderCart(id: $orderCartId) {
    id
    consumerPromotion {
      code
      campaignId
      adGroupId
      adId
      maxApplicableDeliveryCount
      description
      title
      featuredOnApp
      expiration
      target
      disabledDisplaySurface
      __typename
    }
    allConsumerPromotion {
      code
      campaignId
      adGroupId
      adId
      maxApplicableDeliveryCount
      description
      title
      featuredOnApp
      expiration
      target
      disabledDisplaySurface
      __typename
    }
    __typename
  }
}`;

interface CartPromotionItem {
  code: string | null;
  campaignId: string;
  adGroupId: string | null;
  adId: string | null;
  maxApplicableDeliveryCount: number | null;
  description: string | null;
  title: string;
  featuredOnApp: boolean | null;
  expiration: string | null;
  target: number | null;
  disabledDisplaySurface: string[] | null;
}

interface CartIdResponse {
  consumerOrderCart: { id: string } | null;
}

interface CheckoutPromotionsResponse {
  orderCart: {
    id: string;
    consumerPromotion: CartPromotionItem[] | null;
    allConsumerPromotion: CartPromotionItem[] | null;
  } | null;
}

export async function getAvailablePromotions(
  input: GetAvailablePromotionsInput,
): Promise<GetAvailablePromotionsOutput> {
  const csrf = input.csrf || getCookie('csrf_token') || '';

  let cartId = input.cartId || null;

  if (!cartId) {
    const cartData = await graphql<CartIdResponse>(
      csrf,
      'consumerOrderCart',
      GET_CART_ID_QUERY,
      {},
    );
    cartId = cartData.consumerOrderCart?.id || null;
  }

  const hasActiveCart = cartId !== null;

  if (!cartId) {
    return { promotions: [], appliedPromotions: [], hasActiveCart };
  }

  const data = await graphql<CheckoutPromotionsResponse>(
    csrf,
    'checkout',
    GET_CHECKOUT_PROMOTIONS_QUERY,
    { orderCartId: cartId },
  );

  const mapPromotion = (p: CartPromotionItem) => ({
    id: p.campaignId,
    title: p.title,
    description: p.description || null,
    code: p.code || null,
    expiration: p.expiration || null,
    featuredOnApp: p.featuredOnApp ?? null,
    maxApplicableDeliveryCount: p.maxApplicableDeliveryCount ?? null,
    target: p.target || null,
    disabledDisplaySurface: p.disabledDisplaySurface || null,
    adGroupId: p.adGroupId || null,
    adId: p.adId || null,
  });

  const promotions = (data.orderCart?.allConsumerPromotion || []).map(
    mapPromotion,
  );
  const appliedPromotions = (data.orderCart?.consumerPromotion || []).map(
    mapPromotion,
  );

  return { promotions, appliedPromotions, hasActiveCart };
}

// ============================================================================
// redeemGiftCard
// ============================================================================

const REDEEM_GIFT_CARD_MUTATION = `mutation redeemGift($giftPin: String!, $supportsCrossCountryDialog: Boolean!, $isCrossCountryConfirmation: Boolean!, $consumerId: Int, $consumerIdString: String, $countryCode: String) {
  redeemGift(giftPin: $giftPin, supportsCrossCountryDialog: $supportsCrossCountryDialog, isCrossCountryConfirmation: $isCrossCountryConfirmation, consumerId: $consumerId, consumerIdString: $consumerIdString, countryCode: $countryCode) {
    userCountry
    code
    country
    redeemed
    giftCardRedeemMonetaryFields {
      currency
      displayString
      unitAmount
      decimalPlaces
    }
    __typename
  }
}`;

interface RedeemGiftCardResponse {
  redeemGift: {
    userCountry: string | null;
    code: string | null;
    country: string | null;
    redeemed: boolean;
    giftCardRedeemMonetaryFields: {
      currency: string;
      displayString: string;
      unitAmount: number;
      decimalPlaces: number;
    } | null;
  };
}

export async function redeemGiftCard(
  input: RedeemGiftCardInput,
): Promise<RedeemGiftCardOutput> {
  if (!input.csrf) {
    throw new Unauthenticated(
      `CSRF token is required. Call getContext() first. URL: ${window.location.href}`,
    );
  }

  const origin = window.location.origin;
  const url = `${origin}/graphql/redeemGift?operation=redeemGift`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: getRequiredHeaders(input.csrf),
    body: JSON.stringify({
      operationName: 'redeemGift',
      variables: {
        giftPin: input.giftPin,
        supportsCrossCountryDialog: input.supportsCrossCountryDialog ?? true,
        isCrossCountryConfirmation: input.isCrossCountryConfirmation ?? false,
        consumerId: input.consumerId,
        consumerIdString: input.consumerIdString,
        countryCode: input.countryCode,
      },
      query: REDEEM_GIFT_CARD_MUTATION,
    }),
    credentials: 'include',
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const json = await resp.json();

  // Success or soft-failure returned in data (redeemed: false + code)
  if (json.data?.redeemGift) {
    const result = json.data.redeemGift as RedeemGiftCardResponse['redeemGift'];
    const monetary = result.giftCardRedeemMonetaryFields;
    return {
      redeemed: result.redeemed,
      amountAdded: monetary?.displayString,
      currency: monetary?.currency,
      unitAmount: monetary?.unitAmount,
      decimalPlaces: monetary?.decimalPlaces,
      userCountry: result.userCountry ?? undefined,
      giftCardCountry: result.country ?? undefined,
      code: result.code ?? undefined,
    };
  }

  // GraphQL errors (invalid PIN, cross-country mismatch, MFA required, etc.)
  // Extract the code from the first error and return the documented soft-failure shape.
  if (json.errors && json.errors.length > 0) {
    const err = json.errors[0] as {
      message?: string;
      code?: string;
      extensions?: { code?: string; errorCode?: string };
    };
    const code =
      err.extensions?.code ??
      err.extensions?.errorCode ??
      err.code ??
      err.message ??
      undefined;
    return { redeemed: false, code };
  }

  throw new ContractDrift(`redeemGiftCard: unexpected response shape from ${url}`);
}

// ============================================================================
// createGroupOrder
// ============================================================================

// DoorDash group orders are implemented via "group carts". The real mutation is
// createGroupCart. The invite link is in `shortenedUrl` (not `urlCode`, which
// is always null).

const CREATE_GROUP_CART_MUTATION = `mutation createGroupCart($maxIndividualCost: Int, $menu: String!, $restaurant: String!, $storeName: String, $groupCartType: GroupCartType, $fulfillmentType: FulfillmentType) {
  createGroupCart(
    maxIndividualCost: $maxIndividualCost
    menu: $menu
    restaurant: $restaurant
    storeName: $storeName
    groupCartType: $groupCartType
    fulfillmentType: $fulfillmentType
  ) {
    id
    shortenedUrl
    __typename
  }
}`;

const FETCH_GROUP_CART_QUERY = `query groupCart($id: ID!) {
  orderCart(id: $id) {
    id
    shortenedUrl
    groupCartType
    restaurant {
      id
      name
      __typename
    }
    __typename
  }
}`;

interface CreateGroupCartResponse {
  createGroupCart: {
    id: string;
    shortenedUrl: string | null;
  };
}

interface FetchGroupCartResponse {
  orderCart: {
    id: string;
    shortenedUrl: string | null;
    groupCartType: string;
    restaurant: { id: string; name: string } | null;
  } | null;
}

export async function createGroupOrder(
  input: CreateGroupOrderInput,
): Promise<CreateGroupOrderOutput> {
  if (!input.csrf) {
    throw new Unauthenticated(
      `createGroupOrder: CSRF token is required. Call getContext() first. URL: ${window.location.href}`,
    );
  }

  const variables: Record<string, unknown> = {
    menu: input.menuId,
    restaurant: input.storeId,
    groupCartType: input.groupCartType || 'GROUP_CART_TYPE_CREATOR_PAYS_ALL',
    fulfillmentType: input.fulfillmentType || 'Delivery',
  };
  if (input.storeName !== undefined) variables.storeName = input.storeName;
  if (input.maxIndividualCost !== undefined)
    variables.maxIndividualCost = input.maxIndividualCost;

  const data = await graphql<CreateGroupCartResponse>(
    input.csrf,
    'createGroupCart',
    CREATE_GROUP_CART_MUTATION,
    variables,
  );

  const cart = data.createGroupCart;
  if (!cart?.id) {
    throw new ContractDrift(
      `createGroupOrder: createGroupCart returned no cart ID. URL: ${window.location.href}`,
    );
  }

  // shortenedUrl is the shareable invite link. If not returned by create
  // mutation, fetch the cart to get it.
  let inviteLink = cart.shortenedUrl;
  let storeName = input.storeName || '';
  const groupCartType =
    input.groupCartType || 'GROUP_CART_TYPE_CREATOR_PAYS_ALL';

  if (!inviteLink || !storeName) {
    const cartData = await graphql<FetchGroupCartResponse>(
      input.csrf,
      'groupCart',
      FETCH_GROUP_CART_QUERY,
      { id: cart.id },
    );
    if (cartData.orderCart) {
      inviteLink = inviteLink || cartData.orderCart.shortenedUrl;
      storeName = storeName || cartData.orderCart.restaurant?.name || '';
    }
  }

  return {
    cartId: cart.id,
    inviteLink: inviteLink || null,
    storeName,
    groupCartType,
  };
}

// ============================================================================
// getGroupOrder
// ============================================================================

// getGroupOrder uses getGroupCart(cartId); the old getGroupOrder operation was
// removed from DoorDash's schema. getGroupCart returns OrderCart with group cart
// metadata. The old group-order-specific fields (participants, deadline, status,
// totalAmount) no longer exist; use cartStatusType and shortenedUrl instead.
const GET_GROUP_ORDER_QUERY = `query getGroupCart($cartId: ID!) {
  getGroupCart(cartId: $cartId) {
    id
    shortenedUrl
    groupCart
    groupCartType
    groupCartSource
    cartStatusType
    cartType
    fulfillmentType
    isConsumerPickup
    subtotal
    total
    maxIndividualCost
    specialInstructions
    createdAt
    updatedAt
    urlCode
    tipAmount
    deliveryFee
    scheduledDeliveryAvailable
    selfDeliveryType
    menu {
      id
      name
      __typename
    }
    restaurant {
      id
      name
      __typename
    }
    orders {
      id
      consumer {
        id
        firstName
        lastName
        __typename
      }
      orderItems {
        id
        quantity
        item {
          id
          name
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

interface GetGroupOrderResponse {
  getGroupCart: {
    id: string;
    shortenedUrl: string | null;
    groupCart: boolean | null;
    groupCartType: string | null;
    groupCartSource: string | null;
    cartStatusType: string | null;
    cartType: string | null;
    fulfillmentType: string | null;
    isConsumerPickup: boolean | null;
    subtotal: number;
    total: number | null;
    maxIndividualCost: string | null;
    specialInstructions: string | null;
    createdAt: number | null;
    updatedAt: number | null;
    urlCode: string | null;
    tipAmount: number | null;
    deliveryFee: number | null;
    scheduledDeliveryAvailable: boolean | null;
    selfDeliveryType: string | null;
    menu: { id: string; name: string | null } | null;
    restaurant: { id: string; name: string | null } | null;
    orders: Array<{
      id: string;
      consumer: {
        id: string;
        firstName: string | null;
        lastName: string | null;
      } | null;
      orderItems: Array<{
        id: string;
        quantity: number;
        item: { id: string; name: string };
      }>;
    }>;
  };
}

export async function getGroupOrder(
  input: GetGroupOrderInput,
): Promise<GetGroupOrderOutput> {
  if (!input.csrf) {
    throw new Unauthenticated(
      `CSRF token is required. Call getContext() first. URL: ${window.location.href}`,
    );
  }

  if (!input.groupOrderId || !input.groupOrderId.trim()) {
    throw new Validation(
      `getGroupOrder: groupOrderId must be a non-empty UUID string, got: ${JSON.stringify(input.groupOrderId)}`,
    );
  }

  const data = await graphql<GetGroupOrderResponse>(
    input.csrf,
    'getGroupCart',
    GET_GROUP_ORDER_QUERY,
    { cartId: input.groupOrderId },
  );

  const cart = data.getGroupCart;

  if (cart.cartStatusType === null && cart.groupCart === null) {
    throw new NotFound(
      `getGroupOrder: Cart not found: "${input.groupOrderId}". The cart ID may be invalid or expired.`,
    );
  }

  return {
    groupOrderId: cart.id,
    shortenedUrl: cart.shortenedUrl,
    groupCartType: cart.groupCartType,
    groupCartSource: cart.groupCartSource,
    cartStatusType: cart.cartStatusType,
    cartType: cart.cartType,
    fulfillmentType: cart.fulfillmentType,
    isConsumerPickup: cart.isConsumerPickup,
    subtotal: cart.subtotal,
    total: cart.total,
    maxIndividualCost: cart.maxIndividualCost
      ? parseInt(cart.maxIndividualCost, 10)
      : null,
    specialInstructions: cart.specialInstructions,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
    urlCode: cart.urlCode,
    tipAmount: cart.tipAmount,
    deliveryFee: cart.deliveryFee,
    scheduledDeliveryAvailable: cart.scheduledDeliveryAvailable,
    selfDeliveryType: cart.selfDeliveryType,
    menu: cart.menu ? { id: cart.menu.id, name: cart.menu.name } : null,
    restaurant: cart.restaurant
      ? { id: cart.restaurant.id, name: cart.restaurant.name }
      : null,
    orders: (cart.orders || []).map((o) => ({
      id: o.id,
      consumer: o.consumer
        ? {
            id: o.consumer.id,
            firstName: o.consumer.firstName,
            lastName: o.consumer.lastName,
          }
        : null,
      orderItems: (o.orderItems || []).map((item) => ({
        id: item.id,
        quantity: item.quantity,
        itemName: item.item?.name ?? '',
      })),
    })),
  };
}
