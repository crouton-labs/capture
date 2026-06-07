/**
 * Instacart Library
 *
 * Browser-executable Instacart operations via the page's Apollo GraphQL client.
 * Requires the user to be logged into instacart.com.
 *
 * The library uses `window.__APOLLO_CLIENT__` to issue GraphQL queries against
 * Instacart's persisted-query API. Operation documents are found by name in
 * Apollo's query manager — operations only become available after the relevant
 * UI route has been visited at least once in the tab.
 */

import type {
  GetContextOutput,
  ListAddressesOutput,
  ListRetailersInput,
  ListRetailersOutput,
  GetRetailerInput,
  GetRetailerOutput,
  SearchAutosuggestionsInput,
  SearchAutosuggestionsOutput,
  SearchItemsInput,
  SearchItemsOutput,
  GetItemInput,
  GetItemOutput,
  ListCartsOutput,
  AddToCartInput,
  AddToCartOutput,
  UpdateCartItemInput,
  UpdateCartItemOutput,
  RemoveFromCartInput,
  RemoveFromCartOutput,
  ClearCartInput,
  ClearCartOutput,
  ListOrdersInput,
  ListOrdersOutput,
  GetActiveOrderStatusesInput,
  GetActiveOrderStatusesOutput,
  ListOffersOutput,
  ListDepartmentsOutput,
  Address,
  Retailer,
  Autosuggestion,
  SearchItem,
  Cart,
  CartItem,
  Order,
  ActiveOrderStatusCard,
  Offer,
  Department,
} from './schemas';

export type {
  GetContextOutput,
  ListAddressesOutput,
  ListRetailersOutput,
  GetRetailerOutput,
  SearchAutosuggestionsOutput,
  SearchItemsOutput,
  GetItemOutput,
  ListCartsOutput,
  AddToCartOutput,
  UpdateCartItemOutput,
  RemoveFromCartOutput,
  ClearCartOutput,
  ListOrdersOutput,
  GetActiveOrderStatusesOutput,
  ListOffersOutput,
  ListDepartmentsOutput,
  Address,
  Retailer,
  Autosuggestion,
  SearchItem,
  Cart,
  CartItem,
  Order,
  ActiveOrderStatusCard,
  Offer,
  Department,
};

// ============================================================================
// Apollo client access
// ============================================================================

interface ApolloDoc {
  definitions?: Array<{
    kind?: string;
    operation?: string;
    name?: { value?: string };
  }>;
}

interface ApolloQueryInfo {
  document?: ApolloDoc;
}

interface ApolloQueryManager {
  queries: Map<unknown, ApolloQueryInfo>;
}

interface ApolloClient {
  queryManager: ApolloQueryManager;
  cache: {
    extract: () => Record<string, unknown>;
  };
  query: <T = unknown>(opts: {
    query: ApolloDoc;
    variables?: Record<string, unknown>;
    fetchPolicy?: string;
  }) => Promise<{ data: T; errors?: Array<{ message: string }> }>;
  mutate: <T = unknown>(opts: {
    mutation: ApolloDoc;
    variables?: Record<string, unknown>;
    fetchPolicy?: string;
  }) => Promise<{ data: T; errors?: Array<{ message: string }> }>;
}

declare global {
  interface Window {
    __APOLLO_CLIENT__?: ApolloClient;
  }
}

function getClient(): ApolloClient {
  const c = window.__APOLLO_CLIENT__;
  if (!c) {
    throw new Error(
      `Apollo GraphQL client (window.__APOLLO_CLIENT__) not found. Navigate to https://www.instacart.com/store and wait for the page to finish loading.`,
    );
  }
  return c;
}

interface InstacartLibState {
  docs: Map<string, ApolloDoc>;
}

function getLibState(): InstacartLibState {
  const w = window as Window & { __instacart_lib__?: InstacartLibState };
  if (!w.__instacart_lib__) {
    w.__instacart_lib__ = { docs: new Map() };
  }
  return w.__instacart_lib__;
}

function findOperationDoc(
  client: ApolloClient,
  operationName: string,
): ApolloDoc | null {
  const state = getLibState();
  // Refresh from queryManager — capture any newly-loaded operations into the
  // cache so they survive Apollo's internal observer cleanup.
  for (const [, qi] of client.queryManager.queries) {
    const def = qi.document?.definitions?.[0];
    const name = def?.name?.value;
    if (name && !state.docs.has(name)) {
      state.docs.set(name, qi.document!);
    }
  }
  return state.docs.get(operationName) ?? null;
}

function stubDocFor(
  operationName: string,
  operation: 'query' | 'mutation' = 'query',
): ApolloDoc {
  // Instacart's bundled docs are minimal stubs (only kind/operation/name);
  // the persisted-query link hashes them and the server resolves the real
  // query from its registry. We can construct the same stub by name and
  // bypass the queryManager.queries map entirely.
  return {
    kind: 'Document',
    definitions: [
      {
        kind: 'OperationDefinition',
        operation,
        name: { value: operationName },
      },
    ],
  } as ApolloDoc;
}

async function gqlQuery<T = unknown>(
  operationName: string,
  variables: Record<string, unknown> = {},
  suggestedUrl?: string,
): Promise<T> {
  const client = getClient();
  // Prefer the doc already loaded by the page (so we share Apollo's cache
  // normalization) but fall back to a stub document so the call still works
  // on pages where the operation hasn't been triggered yet.
  const doc =
    findOperationDoc(client, operationName) ?? stubDocFor(operationName);
  void suggestedUrl;

  try {
    const result = await client.query<T>({
      query: doc,
      variables,
      fetchPolicy: 'no-cache',
    });
    if (result.errors && result.errors.length > 0) {
      throw new Error(
        `Instacart GraphQL ${operationName} error: ${result.errors[0].message}`,
      );
    }
    return result.data;
  } catch (e) {
    const err = e as { message?: string; networkError?: { result?: unknown } };
    const detail = err.networkError?.result
      ? ` ${JSON.stringify(err.networkError.result).slice(0, 300)}`
      : '';
    throw new Error(
      `Instacart GraphQL ${operationName} failed: ${err.message || String(e)}${detail}`,
    );
  }
}

async function gqlMutation<T = unknown>(
  operationName: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const client = getClient();
  // Mutations are typically not in qm.queries until the user triggers them
  // via the UI. The stub-doc trick lets us call them directly by name.
  const doc = stubDocFor(operationName, 'mutation');
  try {
    const result = await client.mutate<T>({
      mutation: doc,
      variables,
      fetchPolicy: 'no-cache',
    });
    if (result.errors && result.errors.length > 0) {
      throw new Error(
        `Instacart GraphQL ${operationName} error: ${result.errors[0].message}`,
      );
    }
    return result.data;
  } catch (e) {
    const err = e as { message?: string; networkError?: { result?: unknown } };
    const detail = err.networkError?.result
      ? ` ${JSON.stringify(err.networkError.result).slice(0, 300)}`
      : '';
    throw new Error(
      `Instacart GraphQL ${operationName} failed: ${err.message || String(e)}${detail}`,
    );
  }
}

function readCache<T = unknown>(key: string): T | null {
  const client = getClient();
  const extract = client.cache.extract();
  return (extract[key] as T) ?? null;
}

// ============================================================================
// getContext
// ============================================================================

interface CurrentUserData {
  currentUser?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    guest: boolean;
    ordersCount: number;
  };
}
type CachedCurrentUser = Record<string, CurrentUserData>;

interface LastLocationData {
  lastUserLocation?: {
    addressId: string | null;
    zoneId: string | null;
    postalCode: string | null;
    coordinates?: { latitude: number; longitude: number };
    zone?: { timeZoneName?: string };
  };
}
type CachedLastLocation = Record<string, LastLocationData>;

export async function getContext(): Promise<GetContextOutput> {
  // Prime by reading cache; if missing, kick the queries.
  let user: CurrentUserData['currentUser'] | undefined;
  const userBlob = readCache<CachedCurrentUser>('CurrentUser');
  if (userBlob?.['{}']?.currentUser) {
    user = userBlob['{}']!.currentUser;
  } else {
    const data = await gqlQuery<{
      currentUser: CurrentUserData['currentUser'];
    }>('CurrentUser');
    user = data.currentUser;
  }
  if (!user) {
    throw new Error(
      `Instacart CurrentUser returned no user. Are you logged in?`,
    );
  }
  if (user.guest) {
    throw new Error(
      `Instacart session is a guest session — not logged in. Log in at https://www.instacart.com/store and retry.`,
    );
  }

  let loc: LastLocationData['lastUserLocation'] | null = null;
  const locBlob = readCache<CachedLastLocation>('GetLastUserLocation');
  if (locBlob?.['{}']?.lastUserLocation) {
    loc = locBlob['{}']!.lastUserLocation;
  } else {
    try {
      const data = await gqlQuery<LastLocationData>('GetLastUserLocation');
      loc = data.lastUserLocation ?? null;
    } catch {
      // location is optional context
    }
  }

  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    guest: user.guest,
    ordersCount: typeof user.ordersCount === 'number' ? user.ordersCount : 0,
    addressId: loc?.addressId ?? null,
    postalCode: loc?.postalCode ?? null,
    zoneId: loc?.zoneId ?? null,
    coordinates: loc?.coordinates
      ? {
          latitude: loc.coordinates.latitude,
          longitude: loc.coordinates.longitude,
        }
      : null,
    timeZone: loc?.zone?.timeZoneName ?? null,
    loggedIn: true,
  };
}

// ============================================================================
// listAddresses
// ============================================================================

interface UserAddressesResp {
  userAddresses: Array<{
    id: string;
    businessName: string | null;
    apartmentNumber: string | null;
    streetAddress: string;
    postalCode: string;
    coordinates: { latitude: number; longitude: number };
    viewSection?: {
      lineOneString?: string | null;
      lineTwoString?: string | null;
      cityStateString?: string | null;
    } | null;
    instructions: string | null;
    noOrdersAtThisAddress: boolean;
  }>;
}

export async function listAddresses(): Promise<ListAddressesOutput> {
  const data = await gqlQuery<UserAddressesResp>('UserAddresses');
  return {
    addresses: data.userAddresses.map((a) => ({
      id: a.id,
      streetAddress: a.streetAddress,
      apartmentNumber: a.apartmentNumber,
      businessName: a.businessName,
      postalCode: a.postalCode,
      cityState: a.viewSection?.cityStateString ?? null,
      fullAddress:
        a.viewSection?.lineOneString && a.viewSection?.lineTwoString
          ? `${a.viewSection.lineOneString}, ${a.viewSection.lineTwoString}`
          : null,
      coordinates: {
        latitude: a.coordinates.latitude,
        longitude: a.coordinates.longitude,
      },
      instructions: a.instructions,
      noOrdersAtThisAddress: a.noOrdersAtThisAddress,
    })),
  };
}

// ============================================================================
// listRetailers
// ============================================================================

interface ShopCollectionResp {
  shopCollection: {
    shops: Array<{
      id: string;
      retailer: {
        id: string;
        slug: string;
        name: string;
        logoBackgroundColorHex?: string | null;
        viewSection?: {
          logoImage?: {
            url?: string | null;
            altText?: string | null;
          } | null;
        } | null;
      };
    }>;
  };
}

interface EtaSection {
  homeCondensedEtaString?: string | null;
  condensedEtaString?: string | null;
  etaString?: string | null;
}

interface DeliveryEtaResp {
  getAccurateRetailerEtas: Array<{
    retailerId: string;
    viewSection?: EtaSection | null;
  }>;
}

interface PickupEtaResp {
  pickupEtas: Array<{
    retailerId: string;
    viewSection?: EtaSection | null;
  }>;
}

function bestEtaString(s: EtaSection | null | undefined): string | null {
  if (!s) return null;
  return (
    s.homeCondensedEtaString || s.condensedEtaString || s.etaString || null
  );
}

export async function listRetailers(
  args: ListRetailersInput = {} as ListRetailersInput,
): Promise<ListRetailersOutput> {
  const serviceType = args.serviceType ?? 'DELIVERY';
  const ctx = await getContext();
  if (!ctx.addressId || !ctx.postalCode || !ctx.coordinates) {
    throw new Error(
      `Cannot list retailers — no delivery address selected. Set one on Instacart and retry. addressId=${ctx.addressId} postalCode=${ctx.postalCode}`,
    );
  }

  const data = await gqlQuery<ShopCollectionResp>('ShopCollectionUnscoped', {
    addressId: ctx.addressId,
    postalCode: ctx.postalCode,
    coordinates: ctx.coordinates,
  });
  const shops = data.shopCollection.shops || [];

  // Map of retailerId -> first shopId encountered (for backreference)
  const shopByRetailer: Record<string, string> = {};
  for (const s of shops) {
    if (!shopByRetailer[s.retailer.id]) {
      shopByRetailer[s.retailer.id] = s.id;
    }
  }
  const shopIds = shops.map((s) => s.id);

  // Pull ETAs in parallel
  const etaMap: Record<string, string | null> = {};
  if (serviceType === 'DELIVERY') {
    try {
      const eta = await gqlQuery<DeliveryEtaResp>('GetAccurateRetailerEtas', {
        addressId: ctx.addressId,
        postalCode: ctx.postalCode,
        shopIds,
        retailerIds: [],
        serviceType: 'DELIVERY',
        homeLoadUuid: cryptoUuid(),
      });
      for (const e of eta.getAccurateRetailerEtas) {
        etaMap[e.retailerId] = bestEtaString(e.viewSection);
      }
    } catch {
      // ETAs are best-effort
    }
  } else {
    try {
      const eta = await gqlQuery<PickupEtaResp>(
        'GetAccurateRetailerPickupEtas',
        { shopIds },
      );
      for (const e of eta.pickupEtas) {
        etaMap[e.retailerId] = bestEtaString(e.viewSection);
      }
    } catch {
      // ETAs are best-effort
    }
  }

  // Dedupe by retailer ID, keep first shop encountered.
  const seenRetailers = new Set<string>();
  const retailers: Retailer[] = [];
  for (const s of shops) {
    if (seenRetailers.has(s.retailer.id)) continue;
    seenRetailers.add(s.retailer.id);
    retailers.push({
      id: s.retailer.id,
      shopId: s.id,
      name: s.retailer.name,
      slug: s.retailer.slug,
      logo: s.retailer.viewSection?.logoImage
        ? {
            url: s.retailer.viewSection.logoImage.url ?? null,
            altText: s.retailer.viewSection.logoImage.altText ?? null,
          }
        : null,
      serviceType,
      eta: etaMap[s.retailer.id] ?? null,
      deliveryFeeString: null,
      pickupAvailable: serviceType === 'PICKUP',
      deliveryAvailable: serviceType === 'DELIVERY',
    });
  }

  return { retailers, postalCode: ctx.postalCode };
}

function cryptoUuid(): string {
  // Lightweight v4 uuid; crypto.randomUUID is widely available in modern browsers.
  if (
    typeof crypto !== 'undefined' &&
    typeof (crypto as Crypto).randomUUID === 'function'
  ) {
    return (crypto as Crypto).randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================================
// getRetailer
// ============================================================================

export async function getRetailer(
  args: GetRetailerInput,
): Promise<GetRetailerOutput> {
  // Resolve via the shop collection — same data the home page already
  // fetched. GetRetailerBySlug exists but is a one-shot query Apollo evicts
  // from its observer map, making it unreliable through findOperationDoc.
  const ctx = await getContext();
  if (!ctx.addressId || !ctx.postalCode || !ctx.coordinates) {
    throw new Error(
      `Cannot resolve retailer slug — no delivery address selected.`,
    );
  }
  const data = await gqlQuery<ShopCollectionResp>('ShopCollectionUnscoped', {
    addressId: ctx.addressId,
    postalCode: ctx.postalCode,
    coordinates: ctx.coordinates,
  });
  const match = (data.shopCollection.shops || []).find(
    (s) => s.retailer.slug === args.slug,
  );
  if (!match) {
    throw new Error(
      `Retailer with slug "${args.slug}" is not available at the current location (${ctx.postalCode}).`,
    );
  }
  return { id: match.retailer.id, slug: args.slug };
}

// ============================================================================
// searchAutosuggestions
// ============================================================================

interface CrossRetailerSearchResp {
  crossRetailerSearchAutosuggestions: Array<{
    isNatural: boolean;
    searchTerm: string;
    typeVariant: string;
    textString: string;
    thumbnailImage?: {
      url?: string | null;
    } | null;
  }>;
}

export async function searchAutosuggestions(
  args: SearchAutosuggestionsInput = {} as SearchAutosuggestionsInput,
): Promise<SearchAutosuggestionsOutput> {
  const query = args.query ?? '';
  const limit = args.limit ?? 10;
  const ctx = await getContext();
  if (!ctx.zoneId) {
    throw new Error(
      'Cannot run search — no delivery zone selected. Set a delivery address on Instacart and retry.',
    );
  }
  // Collect retailerIds from cached ShopCollectionUnscoped (we already need it).
  let retailerIds: string[] = [];
  try {
    const sc = readCache<{ [k: string]: ShopCollectionResp }>(
      'ShopCollectionUnscoped',
    );
    if (sc) {
      for (const v of Object.values(sc)) {
        const shops = v?.shopCollection?.shops ?? [];
        retailerIds = Array.from(new Set(shops.map((s) => s.retailer.id)));
        if (retailerIds.length > 0) break;
      }
    }
  } catch {
    // best-effort
  }
  if (retailerIds.length === 0) {
    // Fetch fresh so the autosuggest call has context
    const data = await gqlQuery<ShopCollectionResp>('ShopCollectionUnscoped', {
      addressId: ctx.addressId,
      postalCode: ctx.postalCode,
      coordinates: ctx.coordinates,
    });
    retailerIds = Array.from(
      new Set((data.shopCollection.shops || []).map((s) => s.retailer.id)),
    );
  }

  const data = await gqlQuery<CrossRetailerSearchResp>(
    'CrossRetailerSearchAutosuggestions',
    {
      query,
      limit,
      retailerIds,
      zoneId: ctx.zoneId,
      autosuggestionSessionId: cryptoUuid(),
    },
  );

  return {
    suggestions: (data.crossRetailerSearchAutosuggestions || []).map((s) => ({
      searchTerm: s.searchTerm,
      textString: s.textString,
      isNatural: s.isNatural,
      thumbnailUrl: s.thumbnailImage?.url ?? null,
      typeVariant: s.typeVariant,
    })),
  };
}

// ============================================================================
// searchItems / getItem
// ============================================================================

interface InstacartImage {
  url?: string | null;
  templateUrl?: string | null;
}

interface InstacartItem {
  id: string;
  productId: string;
  name: string;
  brandName?: string | null;
  size?: string | null;
  availability?: {
    available?: boolean | null;
    stockLevel?: string | null;
  } | null;
  productCanonicalUrl?: string | null;
  productRating?: { rating?: number | null } | number | null;
  dietary?: {
    viewSection?: {
      attributesString?: string | null;
      attributeSections?: Array<{ titleString?: string | null }> | null;
    } | null;
  } | null;
  price?: {
    priceValueString?: string | null;
    priceString?: string | null;
    viewSection?: {
      itemPromotions?: Array<{
        viewSection?: { titleString?: string | null } | null;
      }> | null;
      itemCard?: {
        priceString?: string | null;
        priceScreenReaderString?: string | null;
        fullPriceString?: string | null;
        pricePerUnitString?: string | null;
        discountHeaderString?: string | null;
      } | null;
      itemDetails?: {
        priceString?: string | null;
        fullPriceString?: string | null;
        pricePerUnitString?: string | null;
      } | null;
    } | null;
  } | null;
  viewSection?: {
    itemImage?: InstacartImage | null;
    itemTransparentImage?: InstacartImage | null;
  } | null;
}

interface SearchResultsPlacementsResp {
  searchResultsPlacements?: {
    placements?: Array<{
      __typename?: string;
      content?: {
        __typename?: string;
        items?: InstacartItem[] | null;
        itemIds?: string[] | null;
      } | null;
    }> | null;
  } | null;
}

interface ItemsResp {
  items: InstacartItem[];
}

function expandImageUrl(img: InstacartImage | null | undefined): string | null {
  if (!img) return null;
  if (img.url) return img.url;
  if (img.templateUrl) {
    // Instacart serves images via a templated CDN URL with {width=} / {height=}
    // placeholders; pick a sensible default so the URL is directly usable.
    return img.templateUrl
      .replace(/\{width=\}/g, '500')
      .replace(/\{height=\}/g, '500');
  }
  return null;
}

function parsePriceValue(price: InstacartItem['price']): number | null {
  if (!price) return null;
  if (price.priceValueString) {
    const n = parseFloat(price.priceValueString);
    if (!Number.isNaN(n)) return n;
  }
  const ps = price.priceString ?? price.viewSection?.itemCard?.priceString;
  if (ps) {
    const m = ps.match(/\$(\d+(?:\.\d+)?)/);
    if (m) {
      const n = parseFloat(m[1]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function normalizeItem(it: InstacartItem, isSponsored = false): SearchItem {
  const itemCard = it.price?.viewSection?.itemCard;
  const details = it.price?.viewSection?.itemDetails;
  const dietaryAttrs: string[] = [];
  const dietaryString = it.dietary?.viewSection?.attributesString;
  if (dietaryString) {
    for (const s of dietaryString.split(/,\s*/)) {
      const t = s.trim();
      if (t) dietaryAttrs.push(t);
    }
  }
  const attrSections = it.dietary?.viewSection?.attributeSections || [];
  for (const sec of attrSections) {
    if (sec.titleString && !dietaryAttrs.includes(sec.titleString)) {
      dietaryAttrs.push(sec.titleString);
    }
  }
  const promotionLabels: string[] = [];
  for (const p of it.price?.viewSection?.itemPromotions || []) {
    const t = p.viewSection?.titleString;
    if (t) promotionLabels.push(t);
  }
  if (itemCard?.discountHeaderString) {
    promotionLabels.push(itemCard.discountHeaderString);
  }
  let rating: number | null = null;
  if (typeof it.productRating === 'number') {
    rating = it.productRating;
  } else if (
    it.productRating &&
    typeof it.productRating === 'object' &&
    typeof it.productRating.rating === 'number'
  ) {
    rating = it.productRating.rating;
  }
  return {
    id: it.id,
    productId: it.productId ?? String(it.id).split('-').pop() ?? '',
    name: it.name,
    brandName: it.brandName ?? null,
    size: it.size ?? null,
    priceString: itemCard?.priceString ?? it.price?.priceString ?? null,
    priceValue: parsePriceValue(it.price),
    fullPriceString:
      itemCard?.fullPriceString ?? details?.fullPriceString ?? null,
    pricePerUnitString:
      itemCard?.pricePerUnitString ?? details?.pricePerUnitString ?? null,
    available: it.availability?.available ?? true,
    stockLevel: it.availability?.stockLevel ?? null,
    imageUrl: expandImageUrl(it.viewSection?.itemImage),
    productUrl: it.productCanonicalUrl ?? null,
    dietaryAttributes: dietaryAttrs,
    promotionLabels,
    isSponsored,
    rating,
  };
}

async function resolveShop(
  retailerSlug: string,
  serviceType: 'DELIVERY' | 'PICKUP',
): Promise<{
  shopId: string;
  postalCode: string;
  zoneId: string;
  addressId: string;
  coordinates: { latitude: number; longitude: number };
}> {
  const ctx = await getContext();
  if (!ctx.addressId || !ctx.postalCode || !ctx.coordinates || !ctx.zoneId) {
    throw new Error(
      `Cannot resolve retailer location — Instacart needs a delivery address (current: addressId=${ctx.addressId} postalCode=${ctx.postalCode} zoneId=${ctx.zoneId}). Set one on the website and retry.`,
    );
  }
  const data = await gqlQuery<ShopCollectionResp>('ShopCollectionUnscoped', {
    addressId: ctx.addressId,
    postalCode: ctx.postalCode,
    coordinates: ctx.coordinates,
  });
  const shop = (data.shopCollection.shops || []).find(
    (s) => s.retailer.slug === retailerSlug,
  );
  if (!shop) {
    throw new Error(
      `Retailer "${retailerSlug}" is not available at the current Instacart delivery location (${ctx.postalCode}).`,
    );
  }
  // Service type is set globally on Instacart's side; we surface it for the
  // caller's awareness, but the shop returned reflects the user's current
  // service selection. Callers wanting strict pickup vs delivery should set
  // the service type in the UI.
  void serviceType;
  return {
    shopId: shop.id,
    postalCode: ctx.postalCode,
    zoneId: ctx.zoneId,
    addressId: ctx.addressId,
    coordinates: ctx.coordinates,
  };
}

export async function searchItems(
  args: SearchItemsInput,
): Promise<SearchItemsOutput> {
  const orderBy = args.orderBy ?? 'bestMatch';
  const maxResults = args.maxResults ?? 30;
  const serviceType = args.serviceType ?? 'DELIVERY';
  const query = args.query.trim();
  if (!query) {
    throw new Error('searchItems: query is required and must be non-empty.');
  }

  const shop = await resolveShop(args.retailerSlug, serviceType);

  const data = await gqlQuery<SearchResultsPlacementsResp>(
    'SearchResultsPlacements',
    {
      action: null,
      query,
      pageViewId: cryptoUuid(),
      elevatedProductId: null,
      searchSource: 'search',
      filters: [],
      disableReformulation: false,
      disableLlm: false,
      forceInspiration: false,
      orderBy,
      clusterId: null,
      includeDebugInfo: false,
      clusteringStrategy: null,
      contentManagementSearchParams: { itemGridColumnCount: 5 },
      shopId: shop.shopId,
      postalCode: shop.postalCode,
      zoneId: shop.zoneId,
      first: Math.min(maxResults, 50),
    },
  );

  const seen = new Set<string>();
  const collected: SearchItem[] = [];
  for (const p of data.searchResultsPlacements?.placements || []) {
    if (collected.length >= maxResults) break;
    const ct = p.content?.__typename;
    // Item grids are organic results; display-creative placements are ads
    // that occasionally wrap a single product.
    const isSponsored = ct === 'AdsSearchDisplayCreativePlacement';
    const items = p.content?.items || [];
    for (const it of items) {
      if (!it?.id || seen.has(it.id)) continue;
      seen.add(it.id);
      collected.push(normalizeItem(it, isSponsored));
      if (collected.length >= maxResults) break;
    }
  }

  return {
    items: collected,
    query,
    retailerSlug: args.retailerSlug,
    shopId: shop.shopId,
    postalCode: shop.postalCode,
    totalReturned: collected.length,
  };
}

export async function getItem(args: GetItemInput): Promise<GetItemOutput> {
  if (!args.itemId || !args.itemId.startsWith('items_')) {
    throw new Error(
      `getItem: itemId must be an Instacart item ID like "items_55-17090545". Got "${args.itemId}".`,
    );
  }
  const shop = await resolveShop(args.retailerSlug, 'DELIVERY');
  const data = await gqlQuery<ItemsResp>('Items', {
    ids: [args.itemId],
    shopId: shop.shopId,
    postalCode: shop.postalCode,
    zoneId: shop.zoneId,
  });
  const item = data.items?.[0];
  if (!item) {
    throw new Error(
      `Item "${args.itemId}" not found at ${args.retailerSlug} (postalCode=${shop.postalCode}). It may be unavailable at this location.`,
    );
  }
  return normalizeItem(item, false);
}

// ============================================================================
// listCarts
// ============================================================================

interface PersonalActiveCartsResp {
  userCarts: {
    viewSection?: { itemCountString?: string | null } | null;
    carts: Array<{
      id: string;
      itemCount: number;
      retailer: {
        id: string;
        name: string;
        slug: string;
        viewSection?: { logoImage?: { url?: string | null } | null } | null;
      };
      cartItemCollection?: {
        cartItems?: Array<{
          id: string;
          quantity?: number | null;
          unitsOfMeasure?: { display?: string | null } | null;
          priceWithUnitString?: string | null;
          basketProduct?: {
            id: string;
            name: string;
            viewSection?: {
              primaryImage?: { url?: string | null } | null;
              priceString?: string | null;
              displayQuantityString?: string | null;
            } | null;
          } | null;
        }> | null;
      } | null;
    }>;
  };
}

export async function listCarts(): Promise<ListCartsOutput> {
  const data = await gqlQuery<PersonalActiveCartsResp>('PersonalActiveCarts');

  // Resolve shopId for each retailer that has a cart, so we can return a
  // working reviewUrl per cart. ShopCollectionUnscoped is the canonical
  // slug→shop mapping at the user's current delivery location.
  const shopIdBySlug = new Map<string, string>();
  const userCarts = data.userCarts?.carts || [];
  if (userCarts.length > 0) {
    try {
      const ctx = await getContext();
      if (ctx.addressId && ctx.postalCode && ctx.coordinates) {
        const sc = await gqlQuery<ShopCollectionResp>(
          'ShopCollectionUnscoped',
          {
            addressId: ctx.addressId,
            postalCode: ctx.postalCode,
            coordinates: ctx.coordinates,
          },
        );
        for (const s of sc.shopCollection.shops || []) {
          if (!shopIdBySlug.has(s.retailer.slug)) {
            shopIdBySlug.set(s.retailer.slug, s.id);
          }
        }
      }
    } catch {
      // best-effort — reviewUrl will be null for unresolved retailers
    }
  }

  const carts: Cart[] = userCarts.map((c) => ({
    id: c.id,
    retailerId: c.retailer.id,
    retailerName: c.retailer.name,
    retailerSlug: c.retailer.slug,
    retailerLogoUrl: c.retailer.viewSection?.logoImage?.url ?? null,
    itemCount: c.itemCount,
    items: (c.cartItemCollection?.cartItems || []).map((it) => ({
      id: it.id,
      productId: it.basketProduct?.id ?? null,
      name: it.basketProduct?.name ?? '',
      imageUrl: it.basketProduct?.viewSection?.primaryImage?.url ?? null,
      quantity: typeof it.quantity === 'number' ? it.quantity : null,
      displayQuantity:
        it.basketProduct?.viewSection?.displayQuantityString ?? null,
      priceString:
        it.priceWithUnitString ??
        it.basketProduct?.viewSection?.priceString ??
        null,
    })),
    reviewUrl: cartReviewUrl(shopIdBySlug.get(c.retailer.slug) ?? null),
  }));

  return {
    carts,
    totalItemCount: data.userCarts?.viewSection?.itemCountString ?? '0',
  };
}

// ============================================================================
// addToCart / updateCartItem / removeFromCart / clearCart
// ============================================================================

interface UpdateCartItemsMutationResp {
  updateCartItems?: {
    cart?: {
      id?: string;
      itemCount?: number;
      retailerId?: string;
      cartType?: string;
      cartItemCollection?: {
        cartItems?: Array<{
          id: string;
          quantity?: number | null;
          quantityType?: string | null;
          basketProduct?: {
            id: string;
            name: string;
            viewSection?: {
              primaryImage?: { url?: string | null } | null;
              priceString?: string | null;
              displayQuantityString?: string | null;
            } | null;
          } | null;
        }> | null;
      } | null;
    } | null;
  } | null;
}

async function findCartForRetailer(retailerSlug: string): Promise<Cart | null> {
  const all = await listCarts();
  return all.carts.find((c) => c.retailerSlug === retailerSlug) ?? null;
}

function cartReviewUrl(shopId: string | null): string | null {
  if (!shopId) return null;
  return `https://www.instacart.com/store/checkout_v4?sid=${shopId}`;
}

function cartFromMutationResp(
  resp: UpdateCartItemsMutationResp,
  retailerSlug: string,
  shopId: string | null,
  retailerLookup?: { name: string; slug: string; logoUrl: string | null },
): Cart {
  const c = resp.updateCartItems?.cart;
  if (!c) {
    throw new Error(
      `Instacart UpdateCartItemsMutation returned no cart. The mutation may have been rejected silently.`,
    );
  }
  return {
    id: c.id ?? '',
    retailerId: c.retailerId ?? '',
    retailerName: retailerLookup?.name ?? '',
    retailerSlug: retailerLookup?.slug ?? retailerSlug,
    retailerLogoUrl: retailerLookup?.logoUrl ?? null,
    itemCount: c.itemCount ?? 0,
    items: (c.cartItemCollection?.cartItems || []).map((it) => ({
      id: it.id,
      productId: it.basketProduct?.id ?? null,
      name: it.basketProduct?.name ?? '',
      imageUrl: it.basketProduct?.viewSection?.primaryImage?.url ?? null,
      quantity: typeof it.quantity === 'number' ? it.quantity : null,
      displayQuantity:
        it.basketProduct?.viewSection?.displayQuantityString ?? null,
      priceString: it.basketProduct?.viewSection?.priceString ?? null,
    })),
    reviewUrl: cartReviewUrl(shopId),
  };
}

async function applyCartUpdates(
  retailerSlug: string,
  updates: Array<{ itemId: string; quantity: number }>,
): Promise<Cart> {
  // Resolve shopId for the retailer so the returned Cart carries a working
  // reviewUrl. resolveShop is the same helper searchItems uses.
  let shopId: string | null = null;
  try {
    const shop = await resolveShop(retailerSlug, 'DELIVERY');
    shopId = shop.shopId;
  } catch {
    // best-effort — if we can't resolve, the Cart will have reviewUrl=null
  }

  if (updates.length === 0) {
    const existing = await findCartForRetailer(retailerSlug);
    if (!existing) {
      throw new Error(
        `No cart found at retailer "${retailerSlug}" — nothing to update.`,
      );
    }
    return existing;
  }

  const data = await gqlMutation<UpdateCartItemsMutationResp>(
    'UpdateCartItemsMutation',
    {
      cartItemUpdates: updates.map((u) => ({
        itemId: u.itemId,
        quantity: u.quantity,
      })),
      requestTimestamp: Date.now(),
    },
  );

  // Pull retailer display info from listCarts so the returned Cart matches
  // the shape listCarts returns (server response omits retailer.name).
  let retailerLookup:
    | { name: string; slug: string; logoUrl: string | null }
    | undefined;
  try {
    const existing = await findCartForRetailer(retailerSlug);
    if (existing) {
      retailerLookup = {
        name: existing.retailerName,
        slug: existing.retailerSlug,
        logoUrl: existing.retailerLogoUrl,
      };
    }
  } catch {
    // best-effort
  }

  return cartFromMutationResp(data, retailerSlug, shopId, retailerLookup);
}

export async function addToCart(
  args: AddToCartInput,
): Promise<AddToCartOutput> {
  const quantity = args.quantity ?? 1;
  if (!args.itemId.startsWith('items_')) {
    throw new Error(
      `addToCart: itemId must be a full Instacart item ID like "items_76-18384280". Got "${args.itemId}".`,
    );
  }
  if (quantity < 1) {
    throw new Error(
      'addToCart: quantity must be >= 1. Use removeFromCart to remove an item.',
    );
  }
  const cart = await applyCartUpdates(args.retailerSlug, [
    { itemId: args.itemId, quantity },
  ]);
  return { cart, itemAdded: { itemId: args.itemId, quantity } };
}

export async function updateCartItem(
  args: UpdateCartItemInput,
): Promise<UpdateCartItemOutput> {
  if (!args.itemId.startsWith('items_')) {
    throw new Error(
      `updateCartItem: itemId must be a full Instacart item ID like "items_76-18384280". Got "${args.itemId}".`,
    );
  }
  if (args.quantity < 1) {
    throw new Error(
      'updateCartItem: quantity must be >= 1. Use removeFromCart to remove an item.',
    );
  }
  const cart = await applyCartUpdates(args.retailerSlug, [
    { itemId: args.itemId, quantity: args.quantity },
  ]);
  return {
    cart,
    itemUpdated: { itemId: args.itemId, quantity: args.quantity },
  };
}

export async function removeFromCart(
  args: RemoveFromCartInput,
): Promise<RemoveFromCartOutput> {
  if (!args.itemId.startsWith('items_')) {
    throw new Error(
      `removeFromCart: itemId must be a full Instacart item ID like "items_76-18384280". Got "${args.itemId}".`,
    );
  }
  const cart = await applyCartUpdates(args.retailerSlug, [
    { itemId: args.itemId, quantity: 0 },
  ]);
  return { cart, itemRemoved: args.itemId };
}

export async function clearCart(
  args: ClearCartInput,
): Promise<ClearCartOutput> {
  const existing = await findCartForRetailer(args.retailerSlug);
  if (!existing || existing.items.length === 0) {
    return {
      cart: existing ?? {
        id: '',
        retailerId: '',
        retailerName: '',
        retailerSlug: args.retailerSlug,
        retailerLogoUrl: null,
        itemCount: 0,
        items: [],
        reviewUrl: null,
      },
      removedCount: 0,
    };
  }
  const itemIds = existing.items
    .map((it) => it.productId)
    .filter((id): id is string => !!id && id.startsWith('items_'));
  const cart = await applyCartUpdates(
    args.retailerSlug,
    itemIds.map((itemId) => ({ itemId, quantity: 0 })),
  );
  return { cart, removedCount: itemIds.length };
}

// ============================================================================
// listOrders
// ============================================================================

interface OrderDeliveriesConnectionResp {
  orderDeliveriesConnection: {
    nodes: Array<{
      id?: string;
      orderId?: string | null;
      retailer?: {
        id?: string;
        name?: string;
        slug?: string;
        viewSection?: { logoImage?: { url?: string | null } | null } | null;
      } | null;
      viewSection?: {
        statusString?: string | null;
        placedAtString?: string | null;
        deliveryWindowString?: string | null;
        deliveryAtString?: string | null;
        totalString?: string | null;
        itemCountString?: string | null;
      } | null;
      itemCount?: number | null;
      serviceType?: string | null;
    }>;
  };
}

function parseInt0(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

export async function listOrders(
  args: ListOrdersInput = {} as ListOrdersInput,
): Promise<ListOrdersOutput> {
  const numResults = args.numResults ?? 10;
  const data = await gqlQuery<OrderDeliveriesConnectionResp>(
    'OrderDeliveriesConnection',
    { numResults },
  );
  const orders: Order[] = (data.orderDeliveriesConnection?.nodes || []).map(
    (n) => {
      const vs = n.viewSection ?? {};
      return {
        id: n.id ?? '',
        orderId: n.orderId ?? null,
        status: vs.statusString ?? null,
        retailerId: n.retailer?.id ?? null,
        retailerName: n.retailer?.name ?? null,
        retailerSlug: n.retailer?.slug ?? null,
        retailerLogoUrl: n.retailer?.viewSection?.logoImage?.url ?? null,
        totalString: vs.totalString ?? null,
        itemCount:
          typeof n.itemCount === 'number'
            ? n.itemCount
            : parseInt0(vs.itemCountString ?? null),
        placedAt: vs.placedAtString ?? null,
        deliveryAt: vs.deliveryAtString ?? vs.deliveryWindowString ?? null,
        serviceType: n.serviceType ?? null,
      };
    },
  );
  return { orders };
}

// ============================================================================
// getActiveOrderStatuses
// ============================================================================

interface SharedOrderStatusCardsResp {
  sharedOrderStatusCards?: {
    cards?: Array<{
      id: string;
      titleString?: string | null;
      subtitleString?: string | null;
      statusString?: string | null;
      deliveryId?: string | null;
      retailer?: {
        name?: string | null;
        viewSection?: { logoImage?: { url?: string | null } | null } | null;
      } | null;
      ctas?: Array<{ titleString?: string | null }> | null;
    }> | null;
  } | null;
}

export async function getActiveOrderStatuses(
  args: GetActiveOrderStatusesInput = {} as GetActiveOrderStatusesInput,
): Promise<GetActiveOrderStatusesOutput> {
  const numResults = args.numResults ?? 10;
  const data = await gqlQuery<SharedOrderStatusCardsResp>(
    'SharedOrderStatusCards',
    { numResults },
  );
  const cards: ActiveOrderStatusCard[] = (
    data.sharedOrderStatusCards?.cards || []
  ).map((card) => ({
    id: card.id,
    title: card.titleString ?? null,
    subtitle: card.subtitleString ?? null,
    statusText: card.statusString ?? null,
    retailerName: card.retailer?.name ?? null,
    retailerLogoUrl: card.retailer?.viewSection?.logoImage?.url ?? null,
    deliveryId: card.deliveryId ?? null,
    ctaText: card.ctas?.[0]?.titleString ?? null,
  }));
  return { cards };
}

// ============================================================================
// listOffers
// ============================================================================

interface OffersForYouResp {
  offersForYou?: {
    placements?: Array<{
      id: string;
      titleString?: string | null;
      descriptionString?: string | null;
      ctaString?: string | null;
      expirationString?: string | null;
      image?: { url?: string | null } | null;
      retailer?: {
        id?: string;
        name?: string;
        viewSection?: { logoImage?: { url?: string | null } | null } | null;
      } | null;
      viewSection?: {
        titleString?: string | null;
        descriptionString?: string | null;
        expirationString?: string | null;
        ctaString?: string | null;
        primaryImage?: { url?: string | null } | null;
      } | null;
    }> | null;
  } | null;
}

export async function listOffers(): Promise<ListOffersOutput> {
  const data = await gqlQuery<OffersForYouResp>('OffersForYou', {
    surface: 'homeFeed',
  });
  const offers: Offer[] = (data.offersForYou?.placements || []).map((p) => {
    const vs = p.viewSection ?? {};
    return {
      id: p.id,
      title: p.titleString ?? vs.titleString ?? null,
      description: p.descriptionString ?? vs.descriptionString ?? null,
      retailerName: p.retailer?.name ?? null,
      retailerId: p.retailer?.id ?? null,
      retailerLogoUrl: p.retailer?.viewSection?.logoImage?.url ?? null,
      imageUrl: p.image?.url ?? vs.primaryImage?.url ?? null,
      expirationString: p.expirationString ?? vs.expirationString ?? null,
      ctaText: p.ctaString ?? vs.ctaString ?? null,
    };
  });
  return { offers };
}

// ============================================================================
// listDepartments
// ============================================================================

interface HomeTabsResp {
  homeTabs?: Array<{
    id: string;
    filter: string;
    multiRetailerContentPageSlug?: string | null;
    viewSection?: {
      titleString?: string | null;
      iconVariant?: string | null;
      tabImage?: { url?: string | null } | null;
    } | null;
  }> | null;
}

export async function listDepartments(): Promise<ListDepartmentsOutput> {
  const ctx = await getContext();
  if (!ctx.postalCode || !ctx.coordinates) {
    throw new Error(
      'Cannot list departments — no delivery location set. Set a delivery address on Instacart and retry.',
    );
  }
  const data = await gqlQuery<HomeTabsResp>('HomeTabsQuery', {
    postalCode: ctx.postalCode,
    coordinates: ctx.coordinates,
  });
  const seen = new Set<string>();
  const departments: Department[] = [];
  for (const t of data.homeTabs || []) {
    if (seen.has(t.filter)) continue;
    seen.add(t.filter);
    departments.push({
      id: t.filter,
      name: t.viewSection?.titleString ?? t.filter,
      url: t.multiRetailerContentPageSlug
        ? `/store/${t.multiRetailerContentPageSlug}`
        : `/store/?categoryFilter=${t.filter}`,
      imageUrl: t.viewSection?.tabImage?.url ?? null,
    });
  }
  return { departments };
}
