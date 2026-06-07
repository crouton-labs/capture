/**
 * Grubhub Library
 *
 * Browser-executable Grubhub operations via REST API.
 * Requires the diner to be logged into grubhub.com; in-page fetch carries
 * session cookies and the PerimeterX anti-bot header automatically.
 */

import type {
  GetContextInput,
  GetContextOutput,
  SearchRestaurantsInput,
  SearchRestaurantsOutput,
  GetRestaurantInput,
  GetRestaurantOutput,
  GetMenuInput,
  GetMenuOutput,
  GetMenuItemInput,
  GetMenuItemOutput,
  GetRestaurantReviewsInput,
  GetRestaurantReviewsOutput,
  ListFavoritesInput,
  ListFavoritesOutput,
  ListAddressesInput,
  ListAddressesOutput,
  GetHomeAddressInput,
  GetHomeAddressOutput,
  CreateCartInput,
  CreateCartOutput,
  AdoptCartInput,
  AdoptCartOutput,
  ListCartsInput,
  ListCartsOutput,
  GetCartInput,
  GetCartOutput,
  SetDeliveryLocationInput,
  SetDeliveryLocationOutput,
  SetPickupLocationInput,
  SetPickupLocationOutput,
  SetPickupInfoInput,
  SetPickupInfoOutput,
  SetDeliveryInfoInput,
  SetDeliveryInfoOutput,
  SetCartTipInput,
  SetCartTipOutput,
  ListDeliveryTimesInput,
  ListDeliveryTimesOutput,
  GetOrderContactInput,
  GetOrderContactOutput,
  SetOrderContactNameInput,
  SetOrderContactNameOutput,
  SetOrderContactPhoneInput,
  SetOrderContactPhoneOutput,
  AddToCartInput,
  AddToCartOutput,
  RemoveFromCartInput,
  RemoveFromCartOutput,
  DeleteCartInput,
  DeleteCartOutput,
  SyncCartUIInput,
  SyncCartUIOutput,
  ListPaymentMethodsInput,
  ListPaymentMethodsOutput,
  AttachPaymentToCartInput,
  AttachPaymentToCartOutput,
  GetCheckoutSummaryInput,
  GetCheckoutSummaryOutput,
  PlaceOrderInput,
  PlaceOrderOutput,
  GetOrderInput,
  GetOrderOutput,
  TrackOrderInput,
  TrackOrderOutput,
} from './schemas';

import { Validation, ContractDrift, NotFound, Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';

export type {
  GetContextOutput,
  SearchRestaurantsOutput,
  GetRestaurantOutput,
  GetMenuOutput,
  GetMenuItemOutput,
  GetRestaurantReviewsOutput,
  ListFavoritesOutput,
  ListAddressesOutput,
  GetHomeAddressOutput,
  CreateCartOutput,
  AdoptCartOutput,
  ListCartsOutput,
  GetCartOutput,
  SetDeliveryLocationOutput,
  SetPickupLocationOutput,
  SetPickupInfoOutput,
  SetDeliveryInfoOutput,
  SetCartTipOutput,
  ListDeliveryTimesOutput,
  GetOrderContactOutput,
  SetOrderContactNameOutput,
  SetOrderContactPhoneOutput,
  AddToCartOutput,
  RemoveFromCartOutput,
  DeleteCartOutput,
  SyncCartUIOutput,
  ListPaymentMethodsOutput,
  AttachPaymentToCartOutput,
  GetCheckoutSummaryOutput,
  PlaceOrderOutput,
  GetOrderOutput,
  TrackOrderOutput,
};

// ============================================================================
// Helpers
// ============================================================================

const API_BASE = 'https://api-gtm.grubhub.com';

function ghFeatures(): string {
  const ua = navigator.userAgent || '';
  // Match the UI: 0=pc;1=@grubhubprod/order-taking-client-sdk 16.6.6;3=<browser>;
  let browser = 'Edge 147.0.0.0';
  const edgeMatch = ua.match(/Edg\/(\d+\.\d+\.\d+\.\d+)/);
  const chromeMatch = ua.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;
  return `0=pc;1=@grubhubprod/order-taking-client-sdk 16.6.6;3=${browser};`;
}

function standardHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-gh-features': ghFeatures(),
  };
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  let url = `${API_BASE}${path}`;
  if (opts.query) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    if (parts.length > 0)
      url += (url.includes('?') ? '&' : '?') + parts.join('&');
  }

  const resp = await fetch(url, {
    method,
    credentials: 'include',
    headers: standardHeaders(),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (resp.status === 204) {
    return undefined as T;
  }

  // Specific handling for 463 is done inline at placeOrder; here we let it
  // surface as an error with the response body attached.
  if (!resp.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await resp.text();
    } catch {
      // ignore
    }
    throwForStatus(resp.status, bodyText);
  }

  return (await resp.json()) as T;
}

function wkt(lat: number, lng: number): string {
  return `POINT(${lng} ${lat})`;
}

function centsFromMoney(
  m: { amount?: number | null } | null | undefined,
): number | null {
  if (!m) return null;
  return typeof m.amount === 'number' ? m.amount : null;
}

function styledText(
  m: { styled_text?: { text?: string | null } | null } | null | undefined,
): string | null {
  if (!m) return null;
  return m.styled_text?.text ?? null;
}

// ============================================================================
// Primary Cart Tracking
// ============================================================================
//
// The Grubhub backend lets a diner hold multiple active carts; the web UI only
// ever exposes one. We mirror the UI model: a conversation picks a single
// "primary" cart and every mutating function asserts that `listCarts` is
// exactly `[primary]`. Orphan carts the server may accumulate (e.g. after an
// interrupted checkout or a cross-session artifact) are silently deleted on
// the next guarded call. If the primary itself disappears between calls —
// which is what submission looks like from the caller's side — the library
// refuses to proceed and tells the caller to resolve via getOrder. Without
// this, a disappeared primary triggered a "fresh cart" fallback that placed a
// duplicate real-money order.

const PRIMARY_CART_KEY = 'grubhub_primary_cart_id';

function getPrimaryCartId(): string | null {
  try {
    return sessionStorage.getItem(PRIMARY_CART_KEY);
  } catch {
    return null;
  }
}

function setPrimaryCartId(cartId: string): void {
  try {
    sessionStorage.setItem(PRIMARY_CART_KEY, cartId);
  } catch {
    // sessionStorage unavailable; invariant checks still run against the
    // server but cross-call primary tracking degrades to best-effort.
  }
}

function clearPrimaryCartId(): void {
  try {
    sessionStorage.removeItem(PRIMARY_CART_KEY);
  } catch {
    // ignore
  }
}

interface CartsIndexResponse {
  carts: Record<string, unknown>;
}

async function listActiveCartIds(): Promise<string[]> {
  const data = await apiFetch<CartsIndexResponse>('/carts');
  return Object.keys(data.carts ?? {});
}

async function purgeCart(cartId: string): Promise<void> {
  try {
    await apiFetch<void>(`/carts/${cartId}`, { method: 'DELETE' });
  } catch {
    // Best-effort. A failed orphan purge is not fatal to the current op;
    // the next guarded call will see it again and retry.
  }
}

async function enforcePrimaryInvariant(primary: string): Promise<void> {
  const ids = await listActiveCartIds();
  if (!ids.includes(primary)) {
    throw new UpstreamError(
      `Grubhub primary cart ${primary} is no longer in the active cart list ` +
        `(listCarts returned: [${ids.join(', ') || 'empty'}]). This usually ` +
        `means the cart was already submitted. Call getOrder({ cartIdOrOrderUuid: "${primary}" }) ` +
        `to resolve the existing order and surface it to the diner. ` +
        `Do NOT create a new cart or rebuild the order without confirming — ` +
        `you will double-charge.`,
    );
  }
  const extras = ids.filter((id) => id !== primary);
  for (const id of extras) {
    await purgeCart(id);
  }
}

async function requirePrimaryCart(cartId: string): Promise<void> {
  const primary = getPrimaryCartId();
  if (!primary) {
    throw new Validation(
      `No primary cart is set for this conversation. Call listCarts to see ` +
        `existing active carts, then either adoptCart({ cartId }) to ` +
        `continue from one or createCart({}) to start fresh. Received cartId: ${cartId}.`,
    );
  }
  if (cartId !== primary) {
    throw new Validation(
      `cartId "${cartId}" does not match this conversation's primary cart "${primary}". ` +
        `Only the primary cart is operated on per conversation. Use the cartId ` +
        `returned by adoptCart or createCart.`,
    );
  }
  await enforcePrimaryInvariant(primary);
}

// ============================================================================
// getContext
// ============================================================================

interface SessionResponse {
  credential: {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    brand: string | null;
    phone: string | null;
    ud_id: string | null;
  } | null;
}

export async function getContext(
  _input?: GetContextInput,
): Promise<GetContextOutput> {
  const data = await apiFetch<SessionResponse>('/session');
  const c = data.credential;
  if (!c || !c.ud_id) {
    throw new Unauthenticated(
      `Grubhub session missing credential.ud_id. User may not be logged in. URL: ${window.location.href}`,
    );
  }
  return {
    dinerId: c.ud_id,
    email: c.email ?? '',
    firstName: c.first_name ?? '',
    lastName: c.last_name ?? '',
    phone: c.phone,
    brand: c.brand ?? 'GRUBHUB',
    loggedIn: true,
  };
}

// ============================================================================
// searchRestaurants
// ============================================================================

interface SearchListingResponse {
  listing_id: string;
  stats: {
    total_results: number;
    result_count: number;
    page_size: number;
    total_hits: number;
  };
  pager: { total_pages: number; current_page: number };
  results: Array<{
    restaurant_id: string;
    name: string;
    logo: string | null;
    ratings: {
      rating_count: number;
      rating_value: string | null;
      actual_rating_value: number | null;
    } | null;
    delivery_fee: { price: number; currency: string } | null;
    delivery_minimum: { price: number; currency: string } | null;
    cuisines: string[];
    phone_number: { country_code: string; phone_number: string | null } | null;
    address: {
      street_address: string | null;
      address_locality: string | null;
      address_region: string | null;
      postal_code: string | null;
      latitude: string | null;
      longitude: string | null;
    } | null;
    price_rating: number | null;
    distance_from_location: string | null;
    delivery_time_estimate: number | null;
    delivery_time_estimate_lower_bound: number | null;
    delivery_time_estimate_upper_bound: number | null;
    pickup: boolean;
    delivery: boolean;
    open: boolean;
  }>;
}

export async function searchRestaurants(
  input: SearchRestaurantsInput,
): Promise<SearchRestaurantsOutput> {
  const data = await apiFetch<SearchListingResponse>(
    '/restaurants/search/search_listing',
    {
      query: {
        orderMethod: input.orderMethod,
        locationMode: input.orderMethod.toUpperCase(),
        facetSet: 'umamiV6',
        location: wkt(input.latitude, input.longitude),
        preciseLocation: true,
        pageNum: input.pageNum,
        pageSize: input.pageSize,
        sorts: input.sort,
        sortSetId: 'umamiV3',
        hideHateos: true,
        searchMetrics: true,
        countOmittingTimes: true,
        sponsoredSize: 0,
        searchTerm: input.query,
      },
    },
  );

  return {
    results: data.results.map((r) => ({
      restaurantId: r.restaurant_id,
      name: r.name,
      logo: r.logo,
      rating:
        r.ratings && typeof r.ratings.actual_rating_value === 'number'
          ? {
              count: r.ratings.rating_count,
              average: r.ratings.actual_rating_value,
            }
          : null,
      priceRating: r.price_rating,
      cuisines: r.cuisines ?? [],
      address: r.address
        ? {
            streetAddress: r.address.street_address,
            city: r.address.address_locality,
            region: r.address.address_region,
            postalCode: r.address.postal_code,
            latitude: r.address.latitude,
            longitude: r.address.longitude,
          }
        : null,
      phoneNumber: r.phone_number?.phone_number ?? null,
      distanceMiles:
        typeof r.distance_from_location === 'string'
          ? parseFloat(r.distance_from_location)
          : null,
      deliveryFeeCents: r.delivery_fee ? r.delivery_fee.price : null,
      deliveryMinimumCents: r.delivery_minimum
        ? r.delivery_minimum.price
        : null,
      deliveryTimeEstimateMinutes: r.delivery_time_estimate,
      deliveryTimeRangeMinutes:
        typeof r.delivery_time_estimate_lower_bound === 'number' &&
        typeof r.delivery_time_estimate_upper_bound === 'number'
          ? {
              lower: r.delivery_time_estimate_lower_bound,
              upper: r.delivery_time_estimate_upper_bound,
            }
          : null,
      supportsDelivery: r.delivery,
      supportsPickup: r.pickup,
      open: r.open,
    })),
    totalResults: data.stats.total_results,
    currentPage: data.pager.current_page,
    totalPages: data.pager.total_pages,
  };
}

// ============================================================================
// getRestaurant + getMenu (share endpoint)
// ============================================================================

interface RestaurantResponse {
  restaurant_availability: {
    restaurant_id: string;
    delivery_fee: { amount: number; currency: string } | null;
    order_minimum: { amount: number } | null;
    sales_tax: number | null;
    open: boolean;
    open_delivery: boolean;
    open_pickup: boolean;
    delivery_estimate: number | null;
    pickup_estimate: number | null;
    available_for_delivery: boolean;
    available_for_pickup: boolean;
  } | null;
  restaurant: {
    id: string;
    name: string;
    address: {
      street_address: string | null;
      locality: string | null;
      region: string | null;
      postal_code: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
    cuisines: string[];
    price_rating: number | null;
    rating: { rating_count?: number; actual_rating_value?: number } | null;
    logo: string | null;
    online_ordering_available: boolean;
    pickup_offered: boolean;
    minimum_tip_percent: number | null;
    default_tip_percent: number | null;
    phone_number_for_delivery: string | null;
    menu_category_list?: Array<{
      id?: string;
      name: string;
      menu_item_list?: Array<MenuItemRaw>;
    }>;
    menu_items?: Array<MenuItemRaw>;
  } | null;
  menu_items?: Array<MenuItemRaw>;
}

interface MenuItemRaw {
  id: string;
  name: string;
  description: string | null;
  price: {
    amount: number;
    currency: string;
    styled_text?: { text: string } | null;
  } | null;
  available: boolean;
  popular?: boolean;
  choice_category_list?: unknown[];
  media_image?: {
    base_url?: string;
    public_id?: string;
    format?: string;
  } | null;
  menu_category_id?: string | null;
  menu_category_name?: string | null;
}

async function fetchRestaurantRaw(
  restaurantId: string,
  latitude: number,
  longitude: number,
  orderMethod: 'delivery' | 'pickup',
  includeMenu: boolean,
): Promise<RestaurantResponse> {
  return apiFetch<RestaurantResponse>(`/restaurants/${restaurantId}`, {
    query: {
      hideChoiceCategories: includeMenu ? false : true,
      hideMenuItems: includeMenu ? false : true,
      version: 4,
      variationId: 'rtpFreeItems',
      orderType: 'standard',
      hideUnavailableMenuItems: true,
      location: wkt(latitude, longitude),
      locationMode: orderMethod,
    },
  });
}

export async function getRestaurant(
  input: GetRestaurantInput,
): Promise<GetRestaurantOutput> {
  const data = await fetchRestaurantRaw(
    input.restaurantId,
    input.latitude,
    input.longitude,
    input.orderMethod,
    false,
  );
  const r = data.restaurant;
  const a = data.restaurant_availability;
  if (!r) {
    throw new NotFound(
      `Grubhub restaurant ${input.restaurantId} not found or no data returned.`,
    );
  }
  return {
    restaurantId: r.id,
    name: r.name,
    address: r.address
      ? {
          streetAddress: r.address.street_address,
          city: r.address.locality,
          region: r.address.region,
          postalCode: r.address.postal_code,
          latitude: r.address.latitude,
          longitude: r.address.longitude,
        }
      : null,
    cuisines: r.cuisines ?? [],
    priceRating: r.price_rating,
    rating:
      r.rating && typeof r.rating.actual_rating_value === 'number'
        ? {
            count: r.rating.rating_count ?? 0,
            average: r.rating.actual_rating_value,
          }
        : null,
    logoUrl: r.logo,
    deliveryFeeCents: a?.delivery_fee ? a.delivery_fee.amount : null,
    orderMinimumCents: a?.order_minimum ? a.order_minimum.amount : null,
    salesTaxRate: a?.sales_tax ?? null,
    deliveryEstimateMinutes: a?.delivery_estimate ?? null,
    pickupEstimateMinutes: a?.pickup_estimate ?? null,
    supportsOnlineOrdering: r.online_ordering_available,
    supportsPickup: r.pickup_offered,
    currentlyOpen: a?.open ?? false,
    openForDelivery: a?.open_delivery ?? false,
    openForPickup: a?.open_pickup ?? false,
    defaultTipPercent: r.default_tip_percent,
    minimumTipPercent: r.minimum_tip_percent,
    phoneNumber: r.phone_number_for_delivery,
  };
}

function mediaImageUrl(m: MenuItemRaw['media_image']): string | null {
  if (!m || !m.base_url || !m.public_id) return null;
  const fmt = m.format ?? 'jpg';
  return `${m.base_url}${m.public_id}.${fmt}`;
}

function summarizeMenuItem(
  it: MenuItemRaw,
): GetMenuOutput['flatItems'][number] {
  return {
    menuItemId: it.id,
    name: it.name,
    description: it.description,
    priceCents: centsFromMoney(it.price),
    priceDisplay: styledText(it.price),
    available: it.available,
    popular: it.popular ?? false,
    hasCustomizations:
      Array.isArray(it.choice_category_list) &&
      it.choice_category_list.length > 0,
    imageUrl: mediaImageUrl(it.media_image),
  };
}

export async function getMenu(input: GetMenuInput): Promise<GetMenuOutput> {
  const data = await fetchRestaurantRaw(
    input.restaurantId,
    input.latitude,
    input.longitude,
    input.orderMethod,
    true,
  );
  const r = data.restaurant;
  if (!r) {
    throw new NotFound(
      `Grubhub restaurant ${input.restaurantId} not found or no data returned.`,
    );
  }

  const categories: GetMenuOutput['categories'] = [];
  const flatItems: GetMenuOutput['flatItems'] = [];

  // Primary shape: restaurant.menu_category_list with menu_item_list per category
  if (Array.isArray(r.menu_category_list) && r.menu_category_list.length > 0) {
    for (const cat of r.menu_category_list) {
      const items = (cat.menu_item_list ?? []).map(summarizeMenuItem);
      categories.push({
        categoryId: cat.id ?? null,
        name: cat.name,
        items,
      });
      flatItems.push(...items);
    }
  } else {
    // Fallback: flat menu_items at the restaurant level or the response level.
    // Group by menu_category_name when available.
    const allItems = [
      ...(Array.isArray(r.menu_items) ? r.menu_items : []),
      ...(Array.isArray(data.menu_items) ? data.menu_items : []),
    ];
    const byCategory = new Map<
      string,
      { id: string | null; items: typeof flatItems }
    >();
    for (const raw of allItems) {
      const summary = summarizeMenuItem(raw);
      flatItems.push(summary);
      const catName = raw.menu_category_name ?? 'Menu';
      const catId = raw.menu_category_id ?? null;
      if (!byCategory.has(catName))
        byCategory.set(catName, { id: catId, items: [] });
      byCategory.get(catName)!.items.push(summary);
    }
    for (const [name, { id, items }] of byCategory) {
      categories.push({ categoryId: id, name, items });
    }
  }

  return {
    restaurantId: r.id,
    restaurantName: r.name,
    categories,
    flatItems,
  };
}

// ============================================================================
// getMenuItem
// ============================================================================

interface ChoiceCategoryRaw {
  id: string;
  name: string;
  min_choice_options: number;
  max_choice_options: number;
  choice_option_list: Array<ChoiceOptionRaw>;
}

interface ChoiceOptionRaw {
  id: string | number;
  description: string;
  price: {
    amount: number;
    currency: string;
    styled_text?: { text: string } | null;
  } | null;
  tag_list?: Array<{ name?: string }>;
  // Grubhub nests further modifier groups under an option using the SAME field
  // name as the top-level list — `choice_category_list`, not a `child_` variant.
  choice_category_list?: Array<ChoiceCategoryRaw>;
}

interface MenuItemDetailResponse {
  id: string;
  restaurant_id: number | string;
  menu_category_id: string | null;
  menu_category_name: string | null;
  name: string;
  description: string | null;
  price: {
    amount: number;
    currency: string;
    styled_text?: { text: string } | null;
  };
  minimum_price_variation: { amount: number } | null;
  maximum_price_variation: { amount: number } | null;
  available: boolean;
  popular?: boolean;
  media_image?: MenuItemRaw['media_image'];
  choice_category_list: Array<ChoiceCategoryRaw>;
}

type ChoiceCategoryOut = GetMenuItemOutput['choiceCategories'][number];
type ChoiceOptionOut = ChoiceCategoryOut['options'][number];

function mapChoiceOption(opt: ChoiceOptionRaw): ChoiceOptionOut {
  return {
    optionId: String(opt.id),
    name: opt.description,
    priceCents: opt.price?.amount ?? 0,
    priceDisplay: styledText(opt.price),
    tagList: (opt.tag_list ?? [])
      .map((t) => t.name)
      .filter((n): n is string => typeof n === 'string'),
    childCategories: (opt.choice_category_list ?? []).map(mapChoiceCategory),
  };
}

function mapChoiceCategory(cat: ChoiceCategoryRaw): ChoiceCategoryOut {
  return {
    choiceCategoryId: cat.id,
    name: cat.name,
    minChoices: cat.min_choice_options,
    maxChoices: cat.max_choice_options,
    options: cat.choice_option_list.map(mapChoiceOption),
  };
}

export async function getMenuItem(
  input: GetMenuItemInput,
): Promise<GetMenuItemOutput> {
  const data = await apiFetch<MenuItemDetailResponse>(
    `/restaurants/${input.restaurantId}/menu_items/${input.menuItemId}`,
    {
      query: {
        time: Date.now(),
        hideUnavailableMenuItems: true,
        orderType: 'standard',
        locationMode: input.orderMethod.toUpperCase(),
        version: 4,
        includeWeightedItemsData: true,
        location: wkt(input.latitude, input.longitude),
        yelpImageVariant: 'YELP_MENU_ITEM_IMAGE',
      },
    },
  );

  return {
    menuItemId: data.id,
    restaurantId: String(data.restaurant_id),
    name: data.name,
    description: data.description,
    priceCents: data.price.amount,
    priceDisplay: styledText(data.price),
    minPriceCents: data.minimum_price_variation?.amount ?? null,
    maxPriceCents: data.maximum_price_variation?.amount ?? null,
    available: data.available,
    popular: data.popular ?? false,
    categoryId: data.menu_category_id,
    categoryName: data.menu_category_name,
    imageUrl: mediaImageUrl(data.media_image),
    choiceCategories: data.choice_category_list.map(mapChoiceCategory),
  };
}

// ============================================================================
// getRestaurantReviews
// ============================================================================

interface ReviewsResponse {
  results?: Array<{
    id?: string | null;
    rating?: number | null;
    review?: string | null;
    diner_name?: string | null;
    time_created?: string | null;
  }>;
  stats?: { total_results?: number };
  pager?: { current_page?: number; total_pages?: number };
}

export async function getRestaurantReviews(
  input: GetRestaurantReviewsInput,
): Promise<GetRestaurantReviewsOutput> {
  const data = await apiFetch<ReviewsResponse>(
    `/ratings/search/restaurant/${input.restaurantId}`,
    {
      query: {
        pageNum: input.pageNum,
        pageSize: input.pageSize,
        brand: 'GRUBHUB',
      },
    },
  );

  return {
    reviews: (data.results ?? []).map((r) => ({
      reviewId: r.id ?? null,
      rating: typeof r.rating === 'number' ? r.rating : null,
      reviewText: r.review ?? null,
      dinerName: r.diner_name ?? null,
      reviewedAt: r.time_created ?? null,
    })),
    totalReviews: data.stats?.total_results ?? 0,
    currentPage: data.pager?.current_page ?? input.pageNum,
    totalPages: data.pager?.total_pages ?? 1,
  };
}

// ============================================================================
// listFavorites
// ============================================================================

interface FavoritesResponse {
  favorites?: Array<{
    restaurant_id?: string;
    restaurantId?: string;
    name?: string | null;
    logo?: string | null;
  }>;
  results?: Array<{
    restaurant_id?: string;
    name?: string | null;
    logo?: string | null;
  }>;
}

export async function listFavorites(
  input: ListFavoritesInput,
): Promise<ListFavoritesOutput> {
  const data = await apiFetch<FavoritesResponse>(
    `/diners/${input.dinerId}/favorites/restaurants`,
  );
  const rows = data.favorites ?? data.results ?? [];
  return {
    favorites: rows.map((f) => ({
      restaurantId: String(
        (f as { restaurant_id?: string; restaurantId?: string })
          .restaurant_id ??
          (f as { restaurantId?: string }).restaurantId ??
          '',
      ),
      name: f.name ?? null,
      logoUrl: f.logo ?? null,
    })),
  };
}

// ============================================================================
// listAddresses
// ============================================================================

interface AddressesResponse {
  diner_id: string;
  diner_addresses: Array<{
    id: string;
    label?: string | null;
    address_1?: string | null;
    address_2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    phone?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    pickup_instructions?: string | null;
  }>;
}

export async function listAddresses(
  input: ListAddressesInput,
): Promise<ListAddressesOutput> {
  const data = await apiFetch<AddressesResponse>(
    `/diners/${input.dinerId}/addresses`,
  );
  return {
    addresses: (data.diner_addresses ?? []).map((a) => ({
      addressId: a.id,
      label: a.label ?? null,
      addressLine1: a.address_1 ?? null,
      addressLine2: a.address_2 ?? null,
      city: a.city ?? null,
      state: a.state ?? null,
      zip: a.zip ?? null,
      phone: a.phone ?? null,
      latitude: a.latitude ?? null,
      longitude: a.longitude ?? null,
      pickupInstructions: a.pickup_instructions ?? null,
    })),
  };
}

// ============================================================================
// getHomeAddress
// ============================================================================

interface HomeAddressResponse {
  diner_id: string;
  diner_addresses: Array<{
    id: string;
    label?: string | null;
    phone?: string | null;
    street_address1?: string | null;
    address_country?: string | null;
    address_locality?: string | null;
    address_region?: string | null;
    postal_code?: string | null;
    latitude?: string | number | null;
    longitude?: string | number | null;
  }>;
}

export async function getHomeAddress(
  input: GetHomeAddressInput,
): Promise<GetHomeAddressOutput> {
  const data = await apiFetch<HomeAddressResponse>(
    `/diners/${input.dinerId}/addresses`,
  );
  const addresses = data.diner_addresses ?? [];
  const home = addresses.find((a) => (a.label ?? '').toLowerCase() === 'home');
  if (!home) {
    const labels = addresses.map((a) => a.label ?? '(unlabeled)').join(', ');
    throw new NotFound(
      `No saved address labeled "home". Saved labels: [${labels}].`,
    );
  }
  const lat =
    typeof home.latitude === 'string'
      ? parseFloat(home.latitude)
      : (home.latitude ?? NaN);
  const lng =
    typeof home.longitude === 'string'
      ? parseFloat(home.longitude)
      : (home.longitude ?? NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ContractDrift(
      `Home address missing coordinates. addressId: ${home.id}, latitude: ${String(home.latitude)}, longitude: ${String(home.longitude)}.`,
    );
  }
  return {
    addressId: home.id,
    label: home.label ?? 'home',
    streetAddress: home.street_address1 ?? '',
    city: home.address_locality ?? '',
    state: home.address_region ?? '',
    postalCode: home.postal_code ?? '',
    country: home.address_country ?? '',
    phone: home.phone ?? null,
    latitude: lat,
    longitude: lng,
  };
}

// ============================================================================
// Cart CRUD
// ============================================================================

interface CreateCartResponse {
  id: string;
  uri: string;
  already_exists: boolean;
}

// Experiments the Grubhub web UI declares when creating a cart. Servers may
// flag cart capabilities based on this list, and the UI may filter `GET /carts`
// results against capabilities it expects. Copied verbatim from captured HAR.
const UI_CART_EXPERIMENTS = [
  'IGNORE_MINIMUM_TIP_REQUIREMENT',
  'LINEOPTION_ENHANCEMENTS',
  'ENABLE_BUNDLED_ORDER_PAYMENTS',
  'ROBOT_DELIVERY',
  'DRONE_DELIVERY',
];

function buildAffiliateId(): string {
  // The UI sends `<landing-path+search>##GRUBHUB##<referrer>` as affiliate.id.
  // Matching the UI's format keeps the cart recognized by the bag picker.
  try {
    const path =
      (window.location.pathname || '/') + (window.location.search || '');
    const ref = document.referrer || '';
    return `${path}##GRUBHUB##${ref}`;
  } catch {
    return '/##GRUBHUB##';
  }
}

export async function createCart(
  _input?: CreateCartInput,
): Promise<CreateCartOutput> {
  // Start-fresh path: purge every existing active cart, POST a new one, and
  // record it as the conversation's primary. Callers who want to continue
  // from a cart surfaced by listCarts should use adoptCart instead.
  const existingIds = await listActiveCartIds();
  for (const id of existingIds) {
    await purgeCart(id);
  }

  const data = await apiFetch<CreateCartResponse>('/carts', {
    method: 'POST',
    body: {
      brand: 'GRUBHUB',
      experiments: UI_CART_EXPERIMENTS,
      cart_attributes: [],
      affiliate: { id: buildAffiliateId(), type: 'CLASSIC' },
    },
  });
  setPrimaryCartId(data.id);
  return { cartId: data.id };
}

export async function adoptCart(
  input: AdoptCartInput,
): Promise<AdoptCartOutput> {
  // Continue-from-existing path: verify the cart is live, delete every other
  // active cart, and record this one as the conversation's primary.
  const ids = await listActiveCartIds();
  if (!ids.includes(input.cartId)) {
    throw new NotFound(
      `Cannot adopt cart "${input.cartId}" — it is not in the active cart list ` +
        `(got: [${ids.join(', ') || 'empty'}]). Call listCarts to see what's available, ` +
        `or call createCart to start a fresh cart.`,
    );
  }
  const extras = ids.filter((id) => id !== input.cartId);
  for (const id of extras) {
    await purgeCart(id);
  }
  setPrimaryCartId(input.cartId);
  return { cartId: input.cartId };
}

export async function listCarts(
  _input?: ListCartsInput,
): Promise<ListCartsOutput> {
  // Return rich summaries so the caller can present existing carts to the
  // diner ("you have a bag at X with N items") before calling adoptCart /
  // createCart. The /carts index response shape is underspecified, so we
  // fetch each cart's detail individually — reliable at the cost of one
  // extra GET per active cart.
  const ids = await listActiveCartIds();
  const primary = getPrimaryCartId();

  const carts = await Promise.all(
    ids.map(async (cartId) => {
      const detail = await fetchCartDetail(cartId);
      return {
        cartId,
        isPrimary: cartId === primary,
        state: detail.state,
        fulfillmentType: detail.fulfillmentType,
        restaurantIds: detail.restaurantIds,
        lineCount: detail.lines.length,
        subtotalCents: detail.subtotalCents,
      };
    }),
  );

  return { carts };
}

interface CartDetailResponse {
  id: string;
  currency: string;
  state: string;
  fulfillment_info: {
    type: string;
  } | null;
  restaurant_ids: string[];
  charges: {
    lines?: {
      diner_total?: number | null;
      line_items?: Array<CartLineRaw>;
    } | null;
    subtotal?: { amount?: number } | null;
    diner_total?: { amount?: number } | null;
  } | null;
}

interface CartOptionRaw {
  id: string | number;
  name: string;
  price?: number | null;
  quantity?: number;
  child_options?: Array<CartOptionRaw>;
}

interface CartLineRaw {
  id: string;
  menu_item_id: string;
  name: string;
  quantity: number;
  special_instructions?: string | null;
  diner_total?: number | null;
  options?: Array<CartOptionRaw>;
}

type CartLineOptionOut = GetCartOutput['lines'][number]['options'][number];

function mapCartOption(o: CartOptionRaw): CartLineOptionOut {
  return {
    optionId: String(o.id),
    name: o.name,
    priceCents: typeof o.price === 'number' ? o.price : 0,
    quantity: o.quantity ?? 1,
    childOptions: (o.child_options ?? []).map(mapCartOption),
  };
}

function mapCartLines(
  lines: CartLineRaw[] | null | undefined,
): GetCartOutput['lines'] {
  return (lines ?? []).map((ln) => ({
    cartLineId: ln.id,
    menuItemId: ln.menu_item_id,
    name: ln.name,
    quantity: ln.quantity,
    specialInstructions: ln.special_instructions ?? '',
    lineTotalCents: typeof ln.diner_total === 'number' ? ln.diner_total : 0,
    options: (ln.options ?? []).map(mapCartOption),
  }));
}

interface OptionSig {
  optionId: string;
  quantity?: number;
  childOptions?:
    | OptionSig[]
    | { optionId: string; quantity: number; childOptions: OptionSig[] }[];
}

function optionSignature(opts: OptionSig[] | undefined): string {
  if (!opts || opts.length === 0) return '';
  return opts
    .map(
      (o) =>
        `${o.optionId}:${o.quantity ?? 1}(${optionSignature(
          (o.childOptions ?? []) as OptionSig[],
        )})`,
    )
    .sort()
    .join(',');
}

function cartLineSignature(
  menuItemId: string,
  options: OptionSig[],
  specialInstructions?: string | null,
): string {
  return `${menuItemId}|${optionSignature(options)}|${specialInstructions ?? ''}`;
}

async function fetchCartDetail(cartId: string): Promise<GetCartOutput> {
  const data = await apiFetch<CartDetailResponse>(`/carts/${cartId}`);
  const lines = data.charges?.lines?.line_items ?? [];
  return {
    cartId: data.id,
    state: data.state,
    fulfillmentType: data.fulfillment_info?.type ?? '',
    restaurantIds: data.restaurant_ids ?? [],
    subtotalCents:
      data.charges?.subtotal?.amount ??
      data.charges?.lines?.diner_total ??
      null,
    totalCents: data.charges?.diner_total?.amount ?? null,
    lines: mapCartLines(lines),
    currency: data.currency ?? 'USD',
  };
}

export async function getCart(input: GetCartInput): Promise<GetCartOutput> {
  await requirePrimaryCart(input.cartId);
  return fetchCartDetail(input.cartId);
}

export async function setDeliveryLocation(
  input: SetDeliveryLocationInput,
): Promise<SetDeliveryLocationOutput> {
  await requirePrimaryCart(input.cartId);
  await apiFetch<void>(`/carts/${input.cartId}/incomplete_delivery`, {
    method: 'PUT',
    body: {
      latitude: String(input.latitude),
      longitude: String(input.longitude),
    },
  });
  return { ok: true };
}

export async function setPickupLocation(
  input: SetPickupLocationInput,
): Promise<SetPickupLocationOutput> {
  await requirePrimaryCart(input.cartId);
  await apiFetch<void>(`/carts/${input.cartId}/incomplete_pickup`, {
    method: 'PUT',
    body: {
      latitude: String(input.latitude),
      longitude: String(input.longitude),
    },
  });
  return { ok: true };
}

export async function setPickupInfo(
  input: SetPickupInfoInput,
): Promise<SetPickupInfoOutput> {
  await requirePrimaryCart(input.cartId);
  await apiFetch<void>(`/carts/${input.cartId}/pickup_info`, {
    method: 'PUT',
    body: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      green_indicated: input.greenIndicated ?? false,
      pickup_instructions: input.pickupInstructions ?? null,
      handoff_options: [],
    },
  });
  return { ok: true };
}

export async function setDeliveryInfo(
  input: SetDeliveryInfoInput,
): Promise<SetDeliveryInfoOutput> {
  await requirePrimaryCart(input.cartId);
  await apiFetch<void>(`/carts/${input.cartId}/delivery_info`, {
    method: 'PUT',
    body: {
      address: {
        region_code: input.country ?? 'US',
        address_lines: [input.streetAddress],
        coordinates: {
          latitude: String(input.latitude),
          longitude: String(input.longitude),
        },
        administrative_area: input.state,
        locality: input.city,
        postal_code: input.postalCode,
        cross_streets: input.crossStreets ?? '',
      },
      green_indicated: input.greenIndicated ?? false,
      delivery_eta_type: input.deliveryEtaType ?? 'STANDARD_DELIVERY',
      handoff_options: [],
      delivery_instructions: input.deliveryInstructions ?? '',
      name: input.name,
      email: input.email,
      phone: input.phone,
    },
  });
  return { ok: true };
}

export async function setCartTip(
  input: SetCartTipInput,
): Promise<SetCartTipOutput> {
  await requirePrimaryCart(input.cartId);
  await apiFetch<void>(`/carts/${input.cartId}/tip`, {
    method: 'POST',
    body: {
      amount: input.amountCents,
      type: input.type ?? 'INCLUDE_IN_BILL',
    },
  });
  return { ok: true };
}

// ============================================================================
// Order Contact Info (name / phone)
// ============================================================================

interface DeliveryAddressRaw {
  region_code?: string | null;
  address_lines?: string[] | null;
  coordinates?: {
    latitude?: string | number | null;
    longitude?: string | number | null;
  } | null;
  administrative_area?: string | null;
  locality?: string | null;
  postal_code?: string | null;
  cross_streets?: string | null;
}

interface CartBillResponse {
  id: string;
  fulfillment_info?: {
    type?: string | null;
    pickup_info?: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      pickup_instructions?: string | null;
      green_indicated?: boolean | null;
      handoff_options?: unknown[] | null;
    } | null;
    delivery_info?: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      delivery_instructions?: string | null;
      delivery_eta_type?: string | null;
      green_indicated?: boolean | null;
      handoff_options?: unknown[] | null;
      address?: DeliveryAddressRaw | null;
    } | null;
  } | null;
}

type CartContactState =
  | {
      fulfillmentType: 'PICKUP';
      name: string;
      phone: string;
      email: string;
      greenIndicated: boolean;
      handoffOptions: unknown[];
      pickupInstructions: string | null;
    }
  | {
      fulfillmentType: 'DELIVERY';
      name: string;
      phone: string;
      email: string;
      greenIndicated: boolean;
      handoffOptions: unknown[];
      deliveryInstructions: string;
      deliveryEtaType: string;
      address: DeliveryAddressRaw;
    };

async function readCartContact(cartId: string): Promise<CartContactState> {
  const bill = await apiFetch<CartBillResponse>(`/carts/${cartId}/bill`);
  const fulfillmentType = bill.fulfillment_info?.type ?? '';

  if (fulfillmentType === 'PICKUP') {
    const pi = bill.fulfillment_info?.pickup_info;
    if (!pi || pi.name == null || pi.phone == null || pi.email == null) {
      throw new Validation(
        `Cart ${cartId} has no pickup contact info set. Call setPickupInfo first.`,
      );
    }
    return {
      fulfillmentType: 'PICKUP',
      name: pi.name,
      phone: pi.phone,
      email: pi.email,
      pickupInstructions: pi.pickup_instructions ?? null,
      greenIndicated: pi.green_indicated ?? false,
      handoffOptions: pi.handoff_options ?? [],
    };
  }

  if (fulfillmentType === 'DELIVERY') {
    const di = bill.fulfillment_info?.delivery_info;
    if (
      !di ||
      di.name == null ||
      di.phone == null ||
      di.email == null ||
      !di.address
    ) {
      throw new Validation(
        `Cart ${cartId} has no delivery contact/address set. Call setDeliveryInfo first.`,
      );
    }
    return {
      fulfillmentType: 'DELIVERY',
      name: di.name,
      phone: di.phone,
      email: di.email,
      deliveryInstructions: di.delivery_instructions ?? '',
      deliveryEtaType: di.delivery_eta_type ?? 'STANDARD_DELIVERY',
      greenIndicated: di.green_indicated ?? false,
      handoffOptions: di.handoff_options ?? [],
      address: di.address,
    };
  }

  throw new Validation(
    `Cart ${cartId} fulfillment type is "${fulfillmentType || 'unset'}", expected "PICKUP" or "DELIVERY". ` +
      `Call setPickupInfo (pickup) or setDeliveryInfo (delivery) to finalize the cart first.`,
  );
}

async function writeCartContact(
  cartId: string,
  next: CartContactState,
): Promise<void> {
  if (next.fulfillmentType === 'PICKUP') {
    await apiFetch<void>(`/carts/${cartId}/pickup_info`, {
      method: 'PUT',
      body: {
        name: next.name,
        email: next.email,
        phone: next.phone,
        green_indicated: next.greenIndicated,
        pickup_instructions: next.pickupInstructions,
        handoff_options: next.handoffOptions,
      },
    });
    return;
  }
  await apiFetch<void>(`/carts/${cartId}/delivery_info`, {
    method: 'PUT',
    body: {
      address: next.address,
      green_indicated: next.greenIndicated,
      delivery_eta_type: next.deliveryEtaType,
      handoff_options: next.handoffOptions,
      delivery_instructions: next.deliveryInstructions,
      name: next.name,
      email: next.email,
      phone: next.phone,
    },
  });
}

export async function getOrderContact(
  input: GetOrderContactInput,
): Promise<GetOrderContactOutput> {
  await requirePrimaryCart(input.cartId);
  const c = await readCartContact(input.cartId);
  return { name: c.name, phone: c.phone, email: c.email };
}

export async function setOrderContactName(
  input: SetOrderContactNameInput,
): Promise<SetOrderContactNameOutput> {
  await requirePrimaryCart(input.cartId);
  const c = await readCartContact(input.cartId);
  await writeCartContact(input.cartId, { ...c, name: input.name });
  return { name: input.name, phone: c.phone, email: c.email };
}

export async function setOrderContactPhone(
  input: SetOrderContactPhoneInput,
): Promise<SetOrderContactPhoneOutput> {
  await requirePrimaryCart(input.cartId);
  const c = await readCartContact(input.cartId);
  await writeCartContact(input.cartId, { ...c, phone: input.phone });
  return { name: c.name, phone: input.phone, email: c.email };
}

interface AddLineResponse {
  id: string;
  uri: string;
  already_exists: boolean;
}

type AddToCartOptionInput = AddToCartInput['options'][number];

interface CartLinePostOption {
  id: number;
  quantity: number;
  child_options: CartLinePostOption[];
  sub_option_ids: number[];
}

function descendantOptionIds(opt: AddToCartOptionInput): number[] {
  const ids: number[] = [];
  for (const child of opt.childOptions ?? []) {
    ids.push(Number(child.optionId), ...descendantOptionIds(child));
  }
  return ids;
}

function buildPostOption(opt: AddToCartOptionInput): CartLinePostOption {
  return {
    id: Number(opt.optionId),
    quantity: opt.quantity ?? 1,
    child_options: (opt.childOptions ?? []).map(buildPostOption),
    sub_option_ids: descendantOptionIds(opt),
  };
}

export async function addToCart(
  input: AddToCartInput,
): Promise<AddToCartOutput> {
  await requirePrimaryCart(input.cartId);
  const signature = cartLineSignature(
    input.menuItemId,
    input.options ?? [],
    input.specialInstructions,
  );
  const existingCart = await fetchCartDetail(input.cartId);
  const duplicate = existingCart.lines.find(
    (ln) =>
      cartLineSignature(ln.menuItemId, ln.options, ln.specialInstructions) ===
      signature,
  );
  if (duplicate) {
    return { cartLineId: duplicate.cartLineId, alreadyExists: true };
  }

  const data = await apiFetch<AddLineResponse>(`/carts/${input.cartId}/lines`, {
    method: 'POST',
    body: {
      menu_item_id: input.menuItemId,
      brand: 'GRUBHUB',
      experiments: ['LINEOPTION_ENHANCEMENTS'],
      quantity: input.quantity ?? 1,
      special_instructions: input.specialInstructions ?? '',
      options: (input.options ?? []).map(buildPostOption),
      cost: 0,
      restaurant_id: input.restaurantId,
      popular: false,
      isBadged: false,
      source: 'restaurant menu section_other menu categories',
    },
  });

  return {
    cartLineId: data.id,
    alreadyExists: data.already_exists,
  };
}

export async function removeFromCart(
  input: RemoveFromCartInput,
): Promise<RemoveFromCartOutput> {
  await requirePrimaryCart(input.cartId);
  await apiFetch<void>(`/carts/${input.cartId}/lines/${input.cartLineId}`, {
    method: 'DELETE',
  });
  return { ok: true };
}

export async function deleteCart(
  input: DeleteCartInput,
): Promise<DeleteCartOutput> {
  await apiFetch<void>(`/carts/${input.cartId}`, { method: 'DELETE' });
  if (getPrimaryCartId() === input.cartId) {
    clearPrimaryCartId();
  }
  return { ok: true };
}

export async function syncCartUI(
  input: SyncCartUIInput,
): Promise<SyncCartUIOutput> {
  await requirePrimaryCart(input.cartId);
  const cart = await fetchCartDetail(input.cartId);
  const restaurantId = cart.restaurantIds[0] ?? null;

  setTimeout(() => window.location.reload(), 100);

  return {
    cartId: input.cartId,
    restaurantId,
    reloaded: true,
  };
}

// ============================================================================
// Checkout
// ============================================================================

interface PaymentsResponse {
  credit_cards?: Array<{
    id: string;
    credit_card_type: string;
    credit_card_last4: string | null;
    expiration_month: number | null;
    expiration_year: number | null;
    expired: boolean;
    zip_code: string | null;
  }>;
  paypals?: Array<{ id: string; email?: string | null }>;
  venmo_pays?: Array<{ id: string; username?: string | null }>;
  amazon_pays?: Array<{ id: string }>;
  cash_apps?: Array<{ id: string }>;
  amex_express_cards?: Array<{ id: string; last4?: string | null }>;
}

export async function listPaymentMethods(
  input: ListPaymentMethodsInput,
): Promise<ListPaymentMethodsOutput> {
  const data = await apiFetch<PaymentsResponse>(
    `/payments/${input.dinerId}/payments`,
  );
  const methods: ListPaymentMethodsOutput['paymentMethods'] = [];

  for (const c of data.credit_cards ?? []) {
    methods.push({
      paymentMethodId: c.id,
      type: 'CREDIT_CARD',
      brand: c.credit_card_type,
      last4: c.credit_card_last4,
      expiration:
        c.expiration_month && c.expiration_year
          ? {
              month: c.expiration_month,
              year: c.expiration_year,
              expired: c.expired,
            }
          : null,
      zipCode: c.zip_code,
    });
  }
  for (const p of data.paypals ?? []) {
    methods.push({
      paymentMethodId: p.id,
      type: 'PAYPAL',
      brand: null,
      last4: null,
      expiration: null,
      zipCode: null,
    });
  }
  for (const v of data.venmo_pays ?? []) {
    methods.push({
      paymentMethodId: v.id,
      type: 'VENMO',
      brand: null,
      last4: null,
      expiration: null,
      zipCode: null,
    });
  }
  for (const a of data.amazon_pays ?? []) {
    methods.push({
      paymentMethodId: a.id,
      type: 'AMAZON_PAY',
      brand: null,
      last4: null,
      expiration: null,
      zipCode: null,
    });
  }
  for (const ca of data.cash_apps ?? []) {
    methods.push({
      paymentMethodId: ca.id,
      type: 'CASH_APP',
      brand: null,
      last4: null,
      expiration: null,
      zipCode: null,
    });
  }
  for (const amx of data.amex_express_cards ?? []) {
    methods.push({
      paymentMethodId: amx.id,
      type: 'AMEX_EXPRESS',
      brand: 'American Express',
      last4: amx.last4 ?? null,
      expiration: null,
      zipCode: null,
    });
  }

  return { paymentMethods: methods };
}

interface AttachPaymentResponse {
  id: string;
  uri: string;
  already_exists: boolean;
}

function readAccertifyFingerprint(): {
  ubaId: string;
  sessionId: string;
} {
  const cookieMatch = document.cookie.match(/(?:^|;\s*)_bcnctkn=([a-f0-9]+)/i);
  const ubaId = cookieMatch?.[1] ?? '';
  const sessionId = window.sessionStorage.getItem('_bcnbsid') ?? '';
  if (!ubaId || !sessionId) {
    throw new UpstreamError(
      `Accertify fingerprint unavailable (ubaId=${ubaId ? 'ok' : 'missing'}, sessionId=${sessionId ? 'ok' : 'missing'}). URL: ${window.location.href}`,
    );
  }
  return { ubaId, sessionId };
}

export async function attachPaymentToCart(
  input: AttachPaymentToCartInput,
): Promise<AttachPaymentToCartOutput> {
  await requirePrimaryCart(input.cartId);
  const { ubaId, sessionId } = readAccertifyFingerprint();
  const data = await apiFetch<AttachPaymentResponse>(
    `/carts/${input.cartId}/payments`,
    {
      method: 'POST',
      body: {
        type: input.type,
        payment_id: input.paymentMethodId,
        metadata: {
          ACCERTIFY_UBA_ID: ubaId,
          ACCERTIFY_UBA_SESSION_ID: sessionId,
          ACCERTIFY_UBA_EVENTS: '',
        },
      },
    },
  );
  return { cartPaymentId: data.id };
}

interface BillResponse {
  id: string;
  currency: string;
  state: string;
  checkout_token?: string | null;
  validation_errors?: Array<{ code?: string | null; message?: string | null }>;
  charges?: {
    lines?: {
      diner_total?: number | null;
      line_items?: Array<CartLineRaw>;
    } | null;
    subtotal?: { amount?: number } | null;
    diner_total?: { amount?: number } | null;
    tax_total?: { amount?: number } | null;
    tip?: { amount?: number } | null;
    diner_credit?: { amount?: number } | null;
  } | null;
  balance?: number | null;
}

export async function getCheckoutSummary(
  input: GetCheckoutSummaryInput,
): Promise<GetCheckoutSummaryOutput> {
  await requirePrimaryCart(input.cartId);
  const data = await apiFetch<BillResponse>(`/carts/${input.cartId}/bill`);
  const lineItems = data.charges?.lines?.line_items ?? [];

  return {
    cartId: data.id,
    state: data.state,
    checkoutToken: data.checkout_token ?? null,
    readyForCheckout: data.state === 'READY_FOR_CHECKOUT',
    subtotalCents:
      data.charges?.subtotal?.amount ??
      data.charges?.lines?.diner_total ??
      null,
    totalCents: data.charges?.diner_total?.amount ?? null,
    taxTotalCents: data.charges?.tax_total?.amount ?? null,
    tipCents: data.charges?.tip?.amount ?? null,
    creditsAppliedCents: data.charges?.diner_credit?.amount ?? null,
    lines: lineItems.map((ln) => ({
      cartLineId: ln.id,
      menuItemId: ln.menu_item_id,
      name: ln.name,
      quantity: ln.quantity,
      dinerTotalCents: typeof ln.diner_total === 'number' ? ln.diner_total : 0,
      options: (ln.options ?? []).map(mapCartOption),
    })),
    validationErrors: (data.validation_errors ?? []).map((v) => ({
      code: v.code ?? null,
      message: v.message ?? null,
    })),
    currency: data.currency ?? 'USD',
  };
}

interface CheckoutResponse {
  id: string;
  fulfillment_info?: {
    type?: string;
  } | null;
  when_for?: string | null;
}

interface ThreeDSResponse {
  verify_methods?: {
    THREE_D_SECURE?: {
      CARDHOLDER_FIRST_NAME?: string;
      CLIENT_TOKEN?: string;
    };
  };
}

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderOutput> {
  await requirePrimaryCart(input.cartId);
  const url = `${API_BASE}/carts/${input.cartId}/checkout`;
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: standardHeaders(),
    body: JSON.stringify({ checkout_token: input.checkoutToken }),
  });

  if (resp.status === 463) {
    let body: ThreeDSResponse = {};
    try {
      body = (await resp.json()) as ThreeDSResponse;
    } catch {
      // ignore
    }
    const cardholder =
      body.verify_methods?.THREE_D_SECURE?.CARDHOLDER_FIRST_NAME ?? '';
    throw new UpstreamError(
      `3DS verification required for this payment card${cardholder ? ` (${cardholder})` : ''}. ` +
        `Grubhub requires a one-time 3D Secure challenge for new cards. ` +
        `Complete checkout manually in the browser once, then retry this order. ` +
        `Subsequent orders on the same card will not require a challenge.`,
    );
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, bodyText);
  }

  const data = (await resp.json()) as CheckoutResponse;
  // Submitted cart is consumed. Clear primary so the next order cycle must
  // start with a fresh adoptCart / createCart call rather than silently
  // reusing the (now-gone) cartId.
  clearPrimaryCartId();
  return {
    cartId: data.id,
    orderUuid: null, // resolved by subsequent getOrder call with the cartId
    submitted: true,
    fulfillmentType: data.fulfillment_info?.type ?? '',
    estimatedReadyAt: data.when_for ?? null,
  };
}

// ============================================================================
// listDeliveryTimes
// ============================================================================

interface TimepickerResponse {
  delivery_times: Record<
    string,
    Array<{ hour: number; intervals: number[]; dst: boolean }>
  > | null;
  pickup_times: Record<
    string,
    Array<{ hour: number; intervals: number[]; dst: boolean }>
  > | null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export async function listDeliveryTimes(
  input: ListDeliveryTimesInput,
): Promise<ListDeliveryTimesOutput> {
  const data = await apiFetch<TimepickerResponse>(
    `/restaurants/v4/timepicker/${input.restaurantId}`,
    {
      method: 'POST',
      query: {
        orderType: 'standard',
        locationMode: input.orderMethod.toUpperCase(),
        location: wkt(input.latitude, input.longitude),
      },
      body: {
        time_zone: input.timeZone,
        end_date_time: input.endDateTime,
        interval_in_minutes: input.intervalMinutes ?? 15,
        order_size: input.orderSizeUsd ?? 0,
      },
    },
  );

  const byDate =
    input.orderMethod === 'delivery' ? data.delivery_times : data.pickup_times;
  const days: ListDeliveryTimesOutput['days'] = [];
  for (const [date, hours] of Object.entries(byDate ?? {})) {
    const slots: ListDeliveryTimesOutput['days'][number]['slots'] = [];
    for (const h of hours) {
      for (const m of h.intervals) {
        slots.push({
          hour: h.hour,
          minute: m,
          localTime: `${date}T${pad2(h.hour)}:${pad2(m)}:00`,
          dst: h.dst,
        });
      }
    }
    days.push({ date, slots });
  }
  return { timeZone: input.timeZone, days };
}

// ============================================================================
// Orders
// ============================================================================

interface OrderHistoryResponse {
  result?: {
    id: string;
    group_id?: string;
    time_placed?: string | null;
    when_for?: string | null;
    fulfillment_info?: { type?: string } | null;
    charges?: {
      lines?: {
        line_items?: Array<{
          line_uuid?: string;
          menu_item_id: string;
          name: string;
          quantity: number;
          diner_total?: number | null;
          options?: Array<CartOptionRaw>;
        }>;
      } | null;
      diner_total?: { amount?: number } | null;
      subtotal?: { amount?: number } | null;
      tip?: { amount?: number } | null;
    } | null;
    restaurants?: Array<{ id?: string; name?: string | null }>;
    restaurant?: { id?: string; name?: string | null };
  };
}

export async function getOrder(input: GetOrderInput): Promise<GetOrderOutput> {
  const data = await apiFetch<OrderHistoryResponse>(
    `/diners/${input.dinerId}/order-history/${input.cartIdOrOrderUuid}`,
  );
  const r = data.result;
  if (!r) {
    throw new NotFound(
      `Grubhub order not found for ${input.cartIdOrOrderUuid}. Ensure the order was submitted successfully.`,
    );
  }
  const restaurant = r.restaurants?.[0] ?? r.restaurant ?? {};
  return {
    orderUuid: r.id,
    timePlaced: r.time_placed ?? null,
    whenFor: r.when_for ?? null,
    fulfillmentType: r.fulfillment_info?.type ?? '',
    totalCents: r.charges?.diner_total?.amount ?? null,
    subtotalCents: r.charges?.subtotal?.amount ?? null,
    tipCents: r.charges?.tip?.amount ?? null,
    items: (r.charges?.lines?.line_items ?? []).map((it) => ({
      menuItemId: it.menu_item_id,
      name: it.name,
      quantity: it.quantity,
      dinerTotalCents: typeof it.diner_total === 'number' ? it.diner_total : 0,
      options: (it.options ?? []).map(mapCartOption),
    })),
    restaurant: {
      restaurantId: restaurant.id ? String(restaurant.id) : null,
      name: restaurant.name ?? null,
    },
  };
}

interface OrderStatusResponse {
  order_id: string;
  order_tracking: { state: string; type: string };
  estimate_start_time?: string | null;
  estimate_end_time?: string | null;
  expected_delivery_time?: string | null;
  current_eta_state?: string | null;
  order_events?: Array<{ type: string; event_time: string }>;
  delivery_events?: Array<{ type: string; event_time: string }>;
  tip_info?: { amount?: number } | null;
}

export async function trackOrder(
  input: TrackOrderInput,
): Promise<TrackOrderOutput> {
  const data = await apiFetch<OrderStatusResponse>(
    `/diners/${input.dinerId}/orders/${input.orderUuid}/order-status`,
    {
      query: {
        variation_id:
          'courierDropoffArrived,courierIsArriving,expected_delivery_path_v2,use_new_order_status',
      },
    },
  );
  const mapEvents = (
    events: Array<{ type: string; event_time: string }> | undefined,
  ): Array<{ type: string; eventTime: string }> =>
    (events ?? []).map((e) => ({ type: e.type, eventTime: e.event_time }));

  return {
    orderUuid: data.order_id,
    state: data.order_tracking.state,
    fulfillmentType: data.order_tracking.type,
    etaState: data.current_eta_state ?? '',
    etaStartTime: data.estimate_start_time ?? null,
    etaEndTime: data.estimate_end_time ?? null,
    expectedDeliveryTime: data.expected_delivery_time ?? null,
    orderEvents: mapEvents(data.order_events),
    deliveryEvents: mapEvents(data.delivery_events),
    tipCents: data.tip_info?.amount ?? null,
  };
}
