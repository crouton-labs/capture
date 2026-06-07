import { z } from 'zod';

export const libraryDescription =
  'DoorDash operations: search restaurants, browse menus, view orders, manage cart, and account settings';

export const libraryIcon = '/icons/libs/doordash.png';
export const loginUrl = 'https://www.doordash.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://www.doordash.com\`
2. Call \`getContext()\` to get \`{ csrf, consumerId, loggedIn }\`
3. Pass \`csrf\` to all subsequent function calls

## Key Concepts

- **Store ID**: Numeric identifier for a restaurant/store. Found in store page URLs: \`/store/{slug}-{storeId}/{menuId}/\`
- **Menu ID**: Numeric identifier for a store's menu. A store can have multiple menus (e.g., "All Day", "Lunch").
- **Item ID**: Numeric identifier for a menu item within a store.
- **Cart Item ID**: Unique identifier for a line item in the cart. Use for removeFromCart/updateCartItem.
- **Order UUID**: UUID format identifier for an order. Use for getOrder/trackOrder/reorder.
- **Fulfillment Type**: "Delivery" or "Pickup"; affects available items, pricing, and time estimates.
- **DashPass**: $9.99/mo subscription for $0 delivery fees on eligible orders. \`isDashpassPartner\` on stores indicates eligibility.
- **Item Customizations**: Items with \`isQuickAddEligible=false\` (from getStoreMenu) require customization options. Call \`getItemDetails\` to discover available option groups and their selection constraints before adding to cart.

## Pagination

Offset-based: \`offset\` (0-indexed) + \`limit\` (page size).

## Search Limitations

Search returns autocomplete-style results with store name, ID, and rating only. For full store details (menu, hours, fees), fetch the store menu using the store ID from search results.
`;

// ============================================================================
// Shared Params
// ============================================================================

export const CsrfParam = z
  .string()
  .describe(
    'CSRF token from getContext().csrf. Pass exactly as returned; do not modify.',
  );

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get CSRF token and consumer ID for DoorDash API calls. Verifies the user is logged in.',
  notes:
    'Call FIRST before any other DoorDash operations. The csrf token is required for all subsequent calls.',
  input: z.object({}),
  output: z.object({
    csrf: z.string().describe('CSRF token for API authentication'),
    consumerId: z
      .string()
      .describe('Numeric consumer ID for the logged-in user'),
    loggedIn: z.boolean().describe('Whether the user is logged in'),
    marketId: z.string().describe('Market/region ID'),
    locale: z.string().describe('User locale (e.g., "en-US")'),
    deviceId: z
      .string()
      .describe(
        'Device fingerprint ID (format: dx_...). Sent automatically via cookies on all requests.',
      ),
    sessionId: z
      .string()
      .describe(
        'Session ID (format: sx_...). Sent automatically via cookies on all requests.',
      ),
    deviceSessionId: z
      .string()
      .describe(
        'Device-session UUID (format: UUID). Complements sessionId as an additional session identifier.',
      ),
    lastLoginMethod: z
      .string()
      .describe(
        'Auth provider used to log in (e.g., "Google", "Apple", "Email").',
      ),
    lastLoginAction: z
      .string()
      .describe('Whether the last auth event was a "Login" or "Signup".'),
  }),
};

export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Search
// ============================================================================

const SearchStoreResult = z.object({
  storeId: z.string().describe('Numeric store ID'),
  name: z.string().describe('Store name'),
  rating: z
    .object({
      average: z.number().describe('Average rating (0-5 scale)'),
      countDisplay: z
        .string()
        .describe('Rating count display (e.g., "(500+)")'),
    })
    .nullable()
    .describe('Store rating, null if not available'),
  resultType: z
    .string()
    .describe('Result type: "STORE" for restaurants, "text" for suggestions'),
});

export type SearchStoreResult = z.infer<typeof SearchStoreResult>;

export const searchStoresSchema = {
  name: 'searchStores',
  description:
    'Search for restaurants and stores by query string. Returns store names, IDs, and ratings from autocomplete results.',
  notes:
    'Returns autocomplete-style results. Matching is strict on exact name; "Broadway Tacos" won\'t match "Broadway Taco and Grill". If no results, try variants in parallel: singular/plural forms, drop suffixes like "and Grill", and partial name matches. For full store details including menu, hours, and fees, call getStoreMenu with the storeId from results.',
  input: z.object({
    csrf: CsrfParam,
    query: z.string().describe('Search query (e.g., "pizza", "Thai food")'),
    serializedBundleGlobalSearchContext: z
      .string()
      .optional()
      .describe(
        'Serialized JSON search context for scoping results (e.g., fulfillment type, market). Advanced use only; leave unset for default behavior.',
      ),
  }),
  output: z.object({
    stores: z
      .array(SearchStoreResult)
      .describe('Store results matching the query'),
    suggestions: z
      .array(z.string())
      .describe('Text search suggestions for refining the query'),
  }),
};

export type SearchStoresInput = z.infer<typeof searchStoresSchema.input>;
export type SearchStoresOutput = z.infer<typeof searchStoresSchema.output>;

// ============================================================================
// Store Menu
// ============================================================================

const MenuItem = z.object({
  id: z.string().describe('Numeric item ID'),
  name: z.string().describe('Item name'),
  description: z.string().describe('Item description'),
  displayPrice: z.string().describe('Formatted price string (e.g., "$18.45")'),
  imageUrl: z.string().nullable().describe('Item image URL'),
  ratingDisplayString: z
    .string()
    .nullable()
    .describe('Rating display (e.g., "91% (24)")'),
  badges: z
    .array(z.string())
    .describe('Badge labels (e.g., "#1 Most liked", "Customer favorite")'),
  isQuickAddEligible: z
    .boolean()
    .describe('Whether the item can be added without customization'),
});

export type MenuItem = z.infer<typeof MenuItem>;

const MenuCategory = z.object({
  id: z.string().describe('Category ID'),
  name: z.string().describe('Category name (e.g., "Most Ordered", "Pizzas")'),
  description: z
    .string()
    .nullable()
    .describe('Category description if available'),
  items: z.array(MenuItem).describe('Items in this category'),
});

export type MenuCategory = z.infer<typeof MenuCategory>;

const StoreDetails = z.object({
  id: z.string().describe('Store ID'),
  name: z.string().describe('Store name'),
  description: z.string().describe('Store description/cuisine type'),
  priceRange: z.number().describe('Price range (1-4, where 1 = cheapest)'),
  priceRangeDisplay: z.string().describe('Price range display (e.g., "$$")'),
  address: z.string().describe('Full display address'),
  rating: z
    .object({
      average: z.number().describe('Average rating (0-5)'),
      count: z.number().describe('Total number of ratings'),
      countDisplay: z
        .string()
        .describe('Rating count display (e.g., "(500+)")'),
      isNew: z.boolean().describe('Whether the store is newly added'),
    })
    .nullable()
    .describe('Store ratings'),
  deliveryFee: z
    .string()
    .nullable()
    .describe('Delivery fee display (e.g., "$0 delivery fee")'),
  deliveryTime: z
    .string()
    .nullable()
    .describe('Estimated delivery time (e.g., "23 min")'),
  isDashpassPartner: z
    .boolean()
    .describe('Whether DashPass applies to this store'),
  offersPickup: z.boolean().describe('Whether pickup is available'),
  offersDelivery: z.boolean().describe('Whether delivery is available'),
  offersScheduling: z
    .boolean()
    .describe('Whether scheduled orders are supported'),
  operationStatus: z
    .string()
    .nullable()
    .describe(
      'Current status (e.g., "Accepting DoorDash orders until 6:15 PM")',
    ),
  hours: z
    .array(
      z.object({
        day: z.string().describe('Day of week'),
        times: z.array(z.string()).describe('Time slots'),
      }),
    )
    .describe('Store operation hours by day'),
  phone: z.string().nullable().describe('Store phone number'),
  website: z.string().nullable().describe('Store website URL'),
});

export type StoreDetails = z.infer<typeof StoreDetails>;

export const getStoreMenuSchema = {
  name: 'getStoreMenu',
  description:
    'Get the full menu and store details for a specific restaurant by store ID. Returns menu categories with items including prices, descriptions, and ratings.',
  notes:
    'Store ID is numeric (e.g., "885998"). Find it from searchStores results or from the store page URL: /store/{slug}-{storeId}/{menuId}/. Menu ID is optional; omit to get the default menu.',
  input: z.object({
    csrf: CsrfParam,
    storeId: z.string().describe('Numeric store ID'),
    menuId: z
      .string()
      .optional()
      .describe('Specific menu ID. Omit to get the default menu.'),
    fulfillmentType: z
      .enum(['Delivery', 'Pickup'])
      .optional()
      .default('Delivery')
      .describe('Delivery or Pickup; affects available items and pricing'),
    scheduledTime: z
      .string()
      .optional()
      .describe(
        'ISO 8601 datetime string for scheduled orders (e.g., "2024-03-08T18:00:00.000Z"). Only applicable when the store offersScheduling. Omit for ASAP delivery.',
      ),
    entryPoint: z
      .enum(['Unspecified', 'External'])
      .optional()
      .describe(
        'Store entry point context. "External" when navigating from an external source. Defaults to "Unspecified".',
      ),
  }),
  output: z.object({
    store: StoreDetails,
    menuId: z
      .string()
      .describe(
        'Numeric menu ID for this menu. Pass to addToCart when adding items from this menu.',
      ),
    categories: z.array(MenuCategory).describe('Menu categories with items'),
    menuName: z.string().describe('Menu name (e.g., "All Day", "Full Menu")'),
  }),
};

export type GetStoreMenuInput = z.infer<typeof getStoreMenuSchema.input>;
export type GetStoreMenuOutput = z.infer<typeof getStoreMenuSchema.output>;

// ============================================================================
// Item Details
// ============================================================================

const ItemDetailPrice = z.object({
  unitAmount: z
    .number()
    .describe('Price in smallest currency unit (e.g., cents)'),
  currency: z.string().describe('Currency code (e.g., "USD")'),
  decimalPlaces: z.number().describe('Decimal places for display'),
  displayString: z.string().describe('Formatted price string (e.g., "+$7.49")'),
});

const ItemDetailOptionL3 = z.object({
  id: z.string().describe('Option ID: use as optionId in addToCart'),
  name: z.string().describe('Option name'),
  unitAmount: z.number().describe('Price in cents (0 = free)'),
  currency: z.string().describe('Currency code'),
  displayString: z.string().describe('Formatted price (empty string if free)'),
  decimalPlaces: z.number().describe('Decimal places'),
  caloricInfoDisplayString: z
    .string()
    .describe('Calorie info (e.g., "45 cal")'),
});

const ItemDetailOptionListL3 = z.object({
  type: z
    .string()
    .describe('"extra_option" for customizations, "item" for upsells'),
  id: z.string().describe('Option list ID'),
  name: z.string().describe('Group name (e.g., "Choose Toppings")'),
  subtitle: z.string().describe('Selection hint (e.g., "Select 1")'),
  selectionNode: z.string().describe('"single_select" or "multi_select"'),
  minNumOptions: z
    .number()
    .describe('Minimum selections required (0 = optional)'),
  maxNumOptions: z.number().describe('Maximum selections allowed'),
  numFreeOptions: z
    .number()
    .describe('Number of free options before charges apply'),
  isOptional: z.boolean().describe('false = required selection'),
  options: z.array(ItemDetailOptionL3).describe('Available options'),
});

const ItemDetailOptionL2 = z.object({
  id: z.string().describe('Option ID: use as optionId in addToCart'),
  name: z.string().describe('Option name'),
  unitAmount: z.number().describe('Price in cents (0 = free)'),
  currency: z.string().describe('Currency code'),
  displayString: z.string().describe('Formatted price (empty string if free)'),
  decimalPlaces: z.number().describe('Decimal places'),
  caloricInfoDisplayString: z
    .string()
    .describe('Calorie info (e.g., "45 cal")'),
  chargeAbove: z
    .number()
    .describe(
      'Number of free selections before extra charges apply (0 = always charged)',
    ),
  defaultQuantity: z.number().describe('Default selection quantity (0 or 1)'),
  nestedExtrasList: z
    .array(ItemDetailOptionListL3)
    .describe('Level 3 nested option groups'),
});

const ItemDetailOptionListL2 = z.object({
  type: z
    .string()
    .describe('"extra_option" for customizations, "item" for upsells'),
  id: z.string().describe('Option list ID'),
  name: z.string().describe('Group name'),
  subtitle: z.string().describe('Selection hint'),
  selectionNode: z.string().describe('"single_select" or "multi_select"'),
  minNumOptions: z.number().describe('Minimum selections required'),
  maxNumOptions: z.number().describe('Maximum selections allowed'),
  numFreeOptions: z
    .number()
    .describe('Number of free options before charges apply'),
  isOptional: z.boolean().describe('false = required selection'),
  options: z.array(ItemDetailOptionL2).describe('Available options'),
});

const ItemDetailOption = z.object({
  id: z.string().describe('Option ID: use as optionId in addToCart'),
  name: z.string().describe('Option name'),
  unitAmount: z.number().describe('Price in cents (0 = free)'),
  currency: z.string().describe('Currency code'),
  displayString: z.string().describe('Formatted price (empty string if free)'),
  decimalPlaces: z.number().describe('Decimal places'),
  caloricInfoDisplayString: z
    .string()
    .describe('Calorie info (e.g., "45 cal")'),
  chargeAbove: z
    .number()
    .describe(
      'Number of free selections before extra charges apply (0 = always charged)',
    ),
  defaultQuantity: z.number().describe('Default selection quantity (0 or 1)'),
  nestedExtrasList: z
    .array(ItemDetailOptionListL2)
    .describe('Level 2 nested option groups'),
});

const ItemDetailOptionList = z.object({
  type: z
    .string()
    .describe('"extra_option" for customizations, "item" for upsells'),
  id: z.string().describe('Option list ID'),
  name: z.string().describe('Group name (e.g., "Select Sauce 1/2")'),
  subtitle: z
    .string()
    .describe('Selection hint (e.g., "Select 1", "Choose up to 5")'),
  selectionNode: z.string().describe('"single_select" or "multi_select"'),
  minNumOptions: z
    .number()
    .describe('Minimum selections required (0 = optional, 1+ = required)'),
  maxNumOptions: z.number().describe('Maximum selections allowed'),
  minAggregateOptionsQuantity: z
    .number()
    .nullable()
    .describe(
      'Minimum total quantity across all options in this group (null = no aggregate min)',
    ),
  maxAggregateOptionsQuantity: z
    .number()
    .nullable()
    .describe(
      'Maximum total quantity across all options in this group (null = no aggregate max)',
    ),
  numFreeOptions: z
    .number()
    .describe('Number of free options before charges apply'),
  isOptional: z.boolean().describe('false = REQUIRED selection'),
  options: z
    .array(ItemDetailOption)
    .describe('Available options to choose from'),
});

export const getItemDetailsSchema = {
  name: 'getItemDetails',
  description:
    'Get item customization details including available options (sizes, toppings, sauces, etc.) and selection constraints. Use option IDs from the response to build addToCart option arrays for non-quick-add items.',
  notes:
    'Get item IDs from getStoreMenu categories[].items[].id. Returns customization groups (optionLists) with selectable options. Each option\'s id is the optionId used in addToCart\'s options array. Groups with isOptional=false and type="extra_option" are required selections.',
  input: z.object({
    csrf: CsrfParam,
    storeId: z.string().describe('Store ID from getStoreMenu'),
    itemId: z
      .string()
      .describe('Item ID from getStoreMenu categories[].items[].id'),
  }),
  output: z.object({
    name: z.string().describe('Item name'),
    price: ItemDetailPrice.describe('Item price'),
    description: z.string().describe('Item description'),
    imgUrl: z.string().describe('Item image URL'),
    menuId: z.string().describe('Menu ID (pass to addToCart)'),
    caloricInfoDisplayString: z
      .string()
      .describe('Calorie info (e.g., "410 cal")'),
    reviewRating: z.string().describe('Rating string (e.g., "82% (201)")'),
    specialInstructionsMaxLength: z
      .number()
      .describe('Max special instructions length (0 = disabled)'),
    quantityLimit: z.number().describe('Max quantity per order (0 = no limit)'),
    itemType: z
      .string()
      .describe('Item type: "HAS_NESTED_OPTIONS", "NO_OPTIONS", etc.'),
    optionLists: z
      .array(ItemDetailOptionList)
      .describe(
        'Customization groups (type="extra_option" only). Required groups have isOptional=false.',
      ),
    recommendedAddOns: z
      .array(ItemDetailOptionList)
      .describe(
        'Recommended add-on items (type="item"). Optional upsells like desserts, beverages.',
      ),
    specialInstructions: z
      .object({
        isEnabled: z
          .boolean()
          .describe('Whether special instructions are accepted'),
        characterMaxLength: z
          .number()
          .describe('Max character length (0 = no limit or disabled)'),
        placeholderText: z
          .string()
          .describe('Placeholder text for the instructions field'),
      })
      .describe('Special instructions configuration'),
  }),
};

export type GetItemDetailsInput = z.infer<typeof getItemDetailsSchema.input>;
export type GetItemDetailsOutput = z.infer<typeof getItemDetailsSchema.output>;

// ============================================================================
// Store Feed
// ============================================================================

const StoreFeedItem = z.object({
  storeId: z.string().describe('Numeric store ID'),
  name: z.string().describe('Store name'),
  description: z
    .string()
    .describe('Cuisine type or description. Commonly empty string "".'),
  imageUrl: z.string().nullable().describe('Store header image URL'),
  rating: z
    .object({
      average: z.number().describe('Average rating (0-5)'),
      countDisplay: z
        .string()
        .describe('Rating count display (e.g., "(500+)")'),
    })
    .nullable()
    .describe('Store rating. Null for stores with insufficient reviews.'),
  deliveryFee: z
    .string()
    .nullable()
    .describe(
      'Delivery fee display (e.g., "$0 delivery fee"). Null for most stores in this feed; use getStoreDetails for accurate fee info.',
    ),
  deliveryTime: z
    .string()
    .nullable()
    .describe(
      'Estimated delivery time (e.g., "23 min"). Null for most stores in this feed; use getStoreDetails for accurate time info.',
    ),
  isDashpassPartner: z
    .boolean()
    .describe(
      'Whether DashPass applies to this store. True only when dashpassOnly=true filter was used (the feed API does not return per-store DashPass status otherwise).',
    ),
});

export type StoreFeedItem = z.infer<typeof StoreFeedItem>;

const StoreFeedCarousel = z.object({
  id: z.string().describe('Carousel section ID'),
  title: z
    .string()
    .describe('Carousel title (e.g., "Fastest Near You", "Top Rated")'),
  subtitle: z.string().nullable().describe('Carousel subtitle if present'),
  stores: z.array(StoreFeedItem).describe('Stores in this carousel'),
});

export type StoreFeedCarousel = z.infer<typeof StoreFeedCarousel>;

export const getStoreFeedSchema = {
  name: 'getStoreFeed',
  description:
    "Get the home feed of recommended stores for the user's current delivery address. Returns categorized carousels like fastest delivery, cheapest, top rated, and deals.",
  notes:
    "Returns stores for the user's currently set delivery address. Change address on doordash.com to see different results. With filterQuery='?pickup=true', returns a single carousel named 'Pickup Near You' with a flat list of nearby pickup stores. When any filter param is used, the response returns a flat list of stores (no carousels) instead of the grouped carousel view.",
  input: z.object({
    csrf: z
      .string()
      .optional()
      .describe(
        'CSRF token from getContext().csrf. Optional; this read-only endpoint does not require CSRF validation.',
      ),
    filterQuery: z
      .string()
      .optional()
      .describe(
        'Raw URL query string to filter results (e.g., "?pickup=true" for pickup stores, "?dashpass_eligible=true" for DashPass stores). Use the dedicated filter params below instead for typed access. Omit for default delivery feed.',
      ),
    dashpassOnly: z
      .boolean()
      .optional()
      .describe(
        'Filter to DashPass partner stores only. Maps to filterQuery param: dashpass_eligible=true.',
      ),
    freeDelivery: z
      .boolean()
      .optional()
      .describe(
        'Filter to stores with $0 delivery fee (includes non-DashPass stores with free delivery). Maps to filterQuery param: delivery_fee=0.',
      ),
    dealsOnly: z
      .boolean()
      .optional()
      .describe(
        'Filter to stores with active deals or promotions. Maps to filterQuery param: offer_type=deals-fill.',
      ),
    maxEta: z
      .number()
      .optional()
      .describe(
        'Maximum delivery ETA in minutes. Only stores with estimated delivery time ≤ this value are returned. Common values: 15, 20, 30, 45, 60. Maps to filterQuery param: eta=N.',
      ),
    minStarRating: z
      .number()
      .optional()
      .describe(
        'Minimum store star rating (1-5). Only stores with average rating ≥ this value are returned. Common values: 3, 4, 4.5. Maps to filterQuery param: star_rating=N.',
      ),
    priceRange: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe(
        'Filter to stores in a specific price range tier. 1=$, 2=$$, 3=$$$, 4=$$$$. Maps to filterQuery param: price_range=N.',
      ),
    pickup: z
      .boolean()
      .optional()
      .describe(
        'Switch to pickup mode. Returns nearby stores available for pickup instead of delivery. Maps to filterQuery param: pickup=true.',
      ),
    cuisine: z
      .string()
      .optional()
      .describe(
        'Filter to stores serving a specific cuisine type. Example values: "Pizza", "Sushi", "Thai", "Italian", "Burgers", "Chinese", "Indian", "Mexican". Maps to filterQuery param: cuisine=NAME.',
      ),
    sortBy: z
      .enum(['delivery_time', 'relevance'])
      .optional()
      .describe(
        'Sort results by the given criterion. "delivery_time"=fastest delivery first, "relevance"=default DoorDash ranking. Maps to filterQuery param: sortBy=VALUE.',
      ),
    maxDeliveryFeeCents: z
      .number()
      .int()
      .optional()
      .describe(
        'Maximum delivery fee in cents (e.g., 200 = $2.00, 0 = free delivery). Filters to stores with delivery fee at or below this value. Use freeDelivery=true as a convenience alias for maxDeliveryFeeCents=0. Maps to filterQuery param: delivery_fee=N.',
      ),
    maxItemPriceCents: z
      .number()
      .int()
      .optional()
      .describe(
        'Maximum item price in cents. Filters to stores that have at least one item at or below this price (e.g., 1000 = $10.00). Maps to filterQuery param: item_price=N.',
      ),
    displayHeader: z
      .boolean()
      .optional()
      .describe(
        'Whether to include a display header section in the response. When true, the response may include an additional header component. Passed directly as a GraphQL variable; not part of filterQuery.',
      ),
    isDebug: z
      .boolean()
      .optional()
      .describe(
        'Enable debug mode for the feed response. Passed directly as a GraphQL variable; not part of filterQuery.',
      ),
    cuisineFilterVerticalIds: z
      .string()
      .optional()
      .describe(
        'Comma-separated vertical IDs to scope the cuisine filter pills shown in the response. E.g., "1" = Restaurants only, "2" = Grocery only, "1,2" = both. Passed directly as a GraphQL variable; not part of filterQuery.',
      ),
  }),
  output: z.object({
    carousels: z
      .array(StoreFeedCarousel)
      .describe(
        'Store carousels organized by category (fastest, cheapest, top rated, etc.). When filterQuery="?pickup=true", returns a single carousel with id "pickup_feed".',
      ),
  }),
};

export type GetStoreFeedInput = z.infer<typeof getStoreFeedSchema.input>;
export type GetStoreFeedOutput = z.infer<typeof getStoreFeedSchema.output>;

// ============================================================================
// Store Details
// ============================================================================

const StoreDetailsResult = z.object({
  id: z.string().describe('Store ID'),
  name: z.string().describe('Store name'),
  description: z.string().describe('Store description/cuisine type'),
  priceRange: z.number().describe('Price range (1-4, where 1 = cheapest)'),
  priceRangeDisplay: z.string().describe('Price range display (e.g., "$$")'),
  address: z.string().describe('Full display address'),
  rating: z
    .object({
      average: z.number().describe('Average rating (0-5)'),
      count: z.number().describe('Total number of ratings'),
      countDisplay: z
        .string()
        .describe('Rating count display (e.g., "(500+)")'),
      isNew: z.boolean().describe('Whether the store is newly added'),
    })
    .nullable()
    .describe('Store ratings'),
  deliveryFee: z
    .string()
    .nullable()
    .describe('Delivery fee display (e.g., "$0 delivery fee")'),
  deliveryTime: z
    .string()
    .nullable()
    .describe('Estimated delivery time (e.g., "23 min")'),
  isDashpassPartner: z
    .boolean()
    .describe('Whether DashPass applies to this store'),
  offersPickup: z.boolean().describe('Whether pickup is available'),
  offersDelivery: z.boolean().describe('Whether delivery is available'),
  offersScheduling: z
    .boolean()
    .describe('Whether scheduled orders are supported'),
  operationStatus: z
    .string()
    .nullable()
    .describe(
      'Current status (e.g., "Accepting DoorDash orders until 6:15 PM")',
    ),
  hours: z
    .array(
      z.object({
        day: z.string().describe('Day of week'),
        times: z.array(z.string()).describe('Time slots'),
      }),
    )
    .describe('Store operation hours by day'),
  phone: z.string().nullable().describe('Store phone number'),
  website: z.string().nullable().describe('Store website URL'),
});

export type StoreDetailsResult = z.infer<typeof StoreDetailsResult>;

export const getStoreDetailsSchema = {
  name: 'getStoreDetails',
  description:
    'Get detailed store information: hours, address, ratings, delivery fees, DashPass eligibility, and operation status. Does not include the menu.',
  notes:
    'Store ID is numeric (e.g., "885998"). Find it from searchStores results or store page URLs: /store/{slug}-{storeId}/{menuId}/. For menu items, use getStoreMenu instead.',
  input: z.object({
    csrf: CsrfParam,
    storeId: z.string().describe('Numeric store ID'),
    fulfillmentType: z
      .enum(['Delivery', 'Pickup'])
      .optional()
      .default('Delivery')
      .describe('Affects delivery fee and time estimates'),
    scheduledTime: z
      .string()
      .optional()
      .describe(
        'ISO 8601 datetime string for a scheduled order (e.g., "2024-03-08T18:00:00.000Z"). Affects delivery time estimates. Only applicable when the store offersScheduling. Omit for ASAP.',
      ),
    entryPoint: z
      .enum(['Unspecified', 'External'])
      .optional()
      .describe(
        'Store entry point context. "External" when navigating from an external source. Defaults to "Unspecified".',
      ),
  }),
  output: z.object({
    store: StoreDetailsResult,
  }),
};

export type GetStoreDetailsInput = z.infer<typeof getStoreDetailsSchema.input>;
export type GetStoreDetailsOutput = z.infer<
  typeof getStoreDetailsSchema.output
>;

// ============================================================================
// Store Reviews
// ============================================================================

const StoreReview = z.object({
  id: z.string().describe('Review UUID'),
  rating: z.number().describe('Star rating (1-5)'),
  text: z.string().describe('Review text'),
  createdAt: z.string().describe('Review date (ISO 8601)'),
  deliveryRating: z
    .number()
    .nullable()
    .describe(
      'Delivery-specific rating if provided (legacy field, may be null)',
    ),
  orderItems: z
    .array(z.string())
    .describe('Names of items ordered in the reviewed order'),
  isVerified: z
    .boolean()
    .describe('Whether the review is from a verified order'),
  helpfulCount: z
    .number()
    .describe('Number of users who marked this review as helpful'),
  ratingTitle: z
    .string()
    .nullable()
    .describe(
      'Sentiment label for the review (e.g., "Loved", "Liked", "Disliked")',
    ),
  reviewerDisplayName: z.string().nullable().describe('Reviewer display name'),
});

export type StoreReview = z.infer<typeof StoreReview>;

export const getStoreReviewsSchema = {
  name: 'getStoreReviews',
  description:
    'Get customer reviews for a store. Returns individual reviews with ratings, text, sentiment, and items ordered.',
  notes:
    'Paginate with offset/limit. Default limit is 10. Reviews are sorted by most recent. Uses DoorDash getRatingsReviewsPage API.',
  input: z.object({
    csrf: CsrfParam,
    storeId: z.string().describe('Numeric store ID'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe(
        'Pagination offset (0-indexed). Pass nextOffset from previous response to get the next page.',
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Number of reviews to return'),
  }),
  output: z.object({
    reviews: z.array(StoreReview).describe('Customer reviews'),
    totalCount: z.number().describe('Total number of reviews available'),
    averageRating: z
      .number()
      .nullable()
      .describe(
        'Store average rating (not returned by reviews API; fetch via getStoreDetails if needed)',
      ),
    nextOffset: z
      .number()
      .nullable()
      .describe(
        'Offset to use for the next page of reviews. Null if no more reviews.',
      ),
  }),
};

export type GetStoreReviewsInput = z.infer<typeof getStoreReviewsSchema.input>;
export type GetStoreReviewsOutput = z.infer<
  typeof getStoreReviewsSchema.output
>;

// ============================================================================
// Saved Stores
// ============================================================================

const SavedStore = z.object({
  storeId: z.string().describe('Numeric store ID'),
  name: z.string().describe('Store name'),
  description: z.string().describe('Cuisine type or description'),
  imageUrl: z.string().nullable().describe('Store header image URL'),
  rating: z
    .object({
      average: z.number().describe('Average rating (0-5)'),
      countDisplay: z.string().describe('Rating count display'),
    })
    .nullable()
    .describe('Store rating'),
  deliveryFee: z.string().nullable().describe('Delivery fee display'),
  deliveryTime: z
    .string()
    .nullable()
    .describe(
      'Distance and estimated delivery time combined (e.g., "1.7 mi • 38 min")',
    ),
  isDashpassPartner: z.boolean().describe('Whether DashPass applies'),
  operationStatus: z
    .string()
    .nullable()
    .describe(
      'Current store operation status (e.g., "Accepts orders until 3:25 PM")',
    ),
  badges: z
    .array(z.string())
    .describe('Promotional badge labels (e.g., "20% off on $50+")'),
  isCurrentlyAvailable: z
    .boolean()
    .describe('Whether the store is currently accepting orders'),
});

export type SavedStore = z.infer<typeof SavedStore>;

export const getSavedStoresSchema = {
  name: 'getSavedStores',
  description:
    'Get the list of stores the user has saved/favorited for quick access.',
  notes:
    'Cursor-based pagination: pass `nextCursor` from a previous response as `cursor` to fetch the next page. Empty string or omitted fetches the first page.',
  input: z.object({
    csrf: CsrfParam,
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor. Pass `nextCursor` from previous response to get the next page. Omit or pass empty string for the first page.',
      ),
  }),
  output: z.object({
    stores: z.array(SavedStore).describe('Saved/favorited stores'),
    nextCursor: z
      .string()
      .nullable()
      .describe(
        'Cursor for the next page of results. Null when all saved stores have been returned.',
      ),
  }),
};

export type GetSavedStoresInput = z.infer<typeof getSavedStoresSchema.input>;
export type GetSavedStoresOutput = z.infer<typeof getSavedStoresSchema.output>;

export const saveStoreSchema = {
  name: 'saveStore',
  description:
    'Save/favorite a store for quick access from the saved stores list.',
  notes:
    'Uses the DoorDash bookmarkStore GraphQL mutation internally. The mutation only accepts storeId; no additional parameters are supported.',
  input: z.object({
    csrf: CsrfParam,
    storeId: z.string().describe('Numeric store ID to save'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the store was saved successfully'),
  }),
};

export type SaveStoreInput = z.infer<typeof saveStoreSchema.input>;
export type SaveStoreOutput = z.infer<typeof saveStoreSchema.output>;

export const unsaveStoreSchema = {
  name: 'unsaveStore',
  description: 'Remove a store from the saved/favorites list.',
  notes:
    'Uses the DoorDash unbookmarkStore GraphQL mutation internally. No CSRF token required; authentication uses browser session cookies automatically.',
  input: z.object({
    storeId: z.string().describe('Numeric store ID to remove from saved'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the store was removed successfully'),
  }),
};

export type UnsaveStoreInput = z.infer<typeof unsaveStoreSchema.input>;
export type UnsaveStoreOutput = z.infer<typeof unsaveStoreSchema.output>;

// ============================================================================
// Orders
// ============================================================================

const OrderItem = z.object({
  name: z.string().describe('Item name'),
  quantity: z.number().describe('Quantity ordered'),
  price: z.string().nullable().describe('Formatted price (e.g., "$12.99")'),
  specialInstructions: z
    .string()
    .nullable()
    .describe('Special instructions for the item'),
});

export type OrderItem = z.infer<typeof OrderItem>;

const OrderSummary = z.object({
  id: z.string().describe('Internal order ID'),
  orderUuid: z
    .string()
    .describe('Order UUID: use for getOrder/trackOrder/reorder'),
  storeName: z.string().describe('Restaurant/store name'),
  storeId: z.string().describe('Store ID'),
  createdAt: z.string().describe('Order creation timestamp (ISO 8601)'),
  grandTotal: z.string().describe('Formatted grand total (e.g., "$45.67")'),
  status: z.string().describe('Order status (e.g., "DELIVERED", "CANCELLED")'),
  deliveryAddress: z.string().nullable().describe('Delivery address'),
  items: z.array(OrderItem).describe('Items in this order'),
});

export type OrderSummary = z.infer<typeof OrderSummary>;

export const listOrdersSchema = {
  name: 'listOrders',
  description:
    'Get order history with store names, items, totals, dates, and status. Supports pagination and filtering by order status.',
  notes:
    'Returns most recent orders first. Use orderUuid from results to call getOrder, trackOrder, or reorder.',
  input: z.object({
    csrf: CsrfParam.optional().describe(
      'CSRF token from getContext().csrf. If omitted, auto-detected from browser cookies.',
    ),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (0-indexed)'),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Number of orders to return (max ~20)'),
    includeCancelled: z
      .boolean()
      .optional()
      .default(true)
      .describe('Whether to include cancelled orders'),
    orderFilterType: z
      .enum([
        'ORDER_FILTER_TYPE_PERSONAL',
        'ORDER_FILTER_TYPE_BUSINESS',
        'ORDER_FILTER_TYPE_UNSPECIFIED',
      ])
      .optional()
      .describe(
        'Filter by order account type. ORDER_FILTER_TYPE_PERSONAL = personal orders only, ORDER_FILTER_TYPE_BUSINESS = DoorDash for Business orders only, ORDER_FILTER_TYPE_UNSPECIFIED = all orders (default behavior when omitted)',
      ),
  }),
  output: z.object({
    orders: z.array(OrderSummary).describe('Order history'),
    hasMore: z.boolean().describe('Whether more orders exist beyond this page'),
  }),
};

export type ListOrdersInput = z.infer<typeof listOrdersSchema.input>;
export type ListOrdersOutput = z.infer<typeof listOrdersSchema.output>;

const _OrderFee = z.object({
  name: z.string().describe('Fee name (e.g., "Delivery Fee", "Service Fee")'),
  amount: z.string().describe('Formatted fee amount (e.g., "$3.99")'),
});

const DasherInfo = z.object({
  firstName: z.string().nullable().describe('Dasher first name'),
  profileImageUrl: z.string().nullable().describe('Dasher profile image URL'),
  rating: z.number().nullable().describe('Dasher rating'),
});

export const getOrderSchema = {
  name: 'getOrder',
  description:
    'Get full details for a single order: items with prices, fulfillment type, and all timestamps. Uses the DoorDash consumerOrders/getConsumerOrdersPostCheckout API.',
  notes:
    'Use orderUuid from listOrders results. This endpoint does not return order status, fees breakdown, dasher info, delivery address, or item special instructions; use listOrders for status, delivery address, and special instructions; trackOrder for live dasher info.',
  input: z.object({
    csrf: CsrfParam,
    orderUuid: z.string().describe('Order UUID from listOrders'),
  }),
  output: z.object({
    orderUuid: z.string().describe('Order UUID'),
    storeName: z.string().describe('Restaurant/store name'),
    storeId: z.string().describe('Store ID'),
    createdAt: z.string().describe('Order creation timestamp (ISO 8601)'),
    deliveredAt: z
      .string()
      .nullable()
      .describe('Actual delivery completion timestamp (ISO 8601)'),
    storeAddress: z
      .string()
      .nullable()
      .describe(
        'Store/restaurant address (printable format). This is the store location, NOT the delivery address. Use listOrders to get the delivery address.',
      ),
    items: z.array(OrderItem).describe('Ordered items'),
    subtotal: z
      .string()
      .nullable()
      .describe('Subtotal before fees (e.g., "$24.99")'),
    grandTotal: z.string().describe('Grand total charged (e.g., "$32.50")'),
    tip: z.string().nullable().describe('Tip amount (e.g., "$4.00")'),
    isGift: z
      .boolean()
      .nullable()
      .describe('Whether the order was placed as a gift'),
    isRetail: z
      .boolean()
      .nullable()
      .describe('Whether the order was a retail/DashMart order'),
    submittedAt: z
      .string()
      .nullable()
      .describe('Order submission timestamp (ISO 8601)'),
    fulfillmentType: z
      .string()
      .nullable()
      .describe(
        'Fulfillment type from the delivery record (e.g., "DELIVERY", "PICKUP")',
      ),
    isConsumerPickup: z
      .boolean()
      .nullable()
      .describe('Whether the order was a consumer pickup (vs delivery)'),
    proofOfDeliveryPin: z
      .string()
      .nullable()
      .describe(
        'PIN code for proof of delivery (used for PIN-protected deliveries)',
      ),
    deliveryUuid: z
      .string()
      .nullable()
      .describe(
        'Delivery UUID: pass to getIssueStatus to check CNR (Credits and Refunds) status',
      ),
  }),
};

export type GetOrderInput = z.infer<typeof getOrderSchema.input>;
export type GetOrderOutput = z.infer<typeof getOrderSchema.output>;

export const trackOrderSchema = {
  name: 'trackOrder',
  description:
    'Get order status for an order by UUID: returns ACTIVE, DELIVERED, or CANCELLED. Looks up the order in recent order history (up to 50 most recent).',
  notes:
    'Real-time tracking (dasher location, ETA, statusMessage) is not available; DoorDash removed the tracking API and replaced it with an SDK-based system not accessible via fetch. Those fields always return null. Works for recent orders (up to 50 most recent). For delivery address and item details, use listOrders or getOrder instead. If "Order not found" is returned unexpectedly, the CSRF token may be stale; call getContext() to refresh it.',
  input: z.object({
    csrf: CsrfParam,
    orderUuid: z.string().describe('Order UUID from listOrders'),
  }),
  output: z.object({
    orderUuid: z.string().describe('Order UUID'),
    status: z
      .string()
      .describe(
        'Order status: "ACTIVE" (order in progress, not yet delivered or cancelled), "DELIVERED" (order completed successfully), or "CANCELLED" (order was cancelled)',
      ),
    estimatedDeliveryTime: z
      .string()
      .nullable()
      .describe('ETA for delivery (ISO 8601)'),
    dasherLocation: z
      .object({
        lat: z.number().describe('Dasher latitude'),
        lng: z.number().describe('Dasher longitude'),
      })
      .nullable()
      .describe('Dasher current location (null if not yet assigned)'),
    dasher: DasherInfo.nullable().describe('Dasher info'),
    statusMessage: z
      .string()
      .nullable()
      .describe(
        'Human-readable status message (e.g., "Your Dasher is on the way")',
      ),
    storeName: z.string().describe('Restaurant/store name'),
  }),
};

export type TrackOrderInput = z.infer<typeof trackOrderSchema.input>;
export type TrackOrderOutput = z.infer<typeof trackOrderSchema.output>;

export const reorderSchema = {
  name: 'reorder',
  description:
    'Reorder a previous order by UUID. Recreates the previous order as a new cart.',
  notes:
    'Uses orderUuid from listOrders. Creates a new cart; does not place the order. User still needs to checkout. cartUuid can be used to build the cart URL: /cart/{cartUuid}.',
  input: z.object({
    csrf: CsrfParam.optional().describe(
      'CSRF token from getContext().csrf. If omitted, auto-detected from browser cookies.',
    ),
    orderUuid: z.string().describe('Order UUID to reorder'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reorder cart was created'),
    cartUuid: z
      .string()
      .nullable()
      .describe(
        'UUID of the newly created cart. Build URL as /cart/{cartUuid}',
      ),
  }),
};

export type ReorderInput = z.infer<typeof reorderSchema.input>;
export type ReorderOutput = z.infer<typeof reorderSchema.output>;

// ============================================================================
// Cart
// ============================================================================

const CartItemOption = z.object({
  optionId: z.string().describe('Option ID from the item customization group'),
  name: z.string().describe('Option name (e.g., "Extra Cheese", "Large")'),
  price: z
    .string()
    .nullable()
    .describe('Additional price for this option (e.g., "$1.50"), null if free'),
});

const CartItem = z.object({
  cartItemId: z
    .string()
    .describe(
      'Unique cart line item ID. Use this for removeFromCart/updateCartItem.',
    ),
  itemId: z.string().describe('Menu item ID (from getStoreMenu results)'),
  name: z.string().describe('Item name'),
  quantity: z.number().describe('Quantity of this item'),
  unitPrice: z.string().describe('Price per unit (e.g., "$12.99")'),
  totalPrice: z
    .string()
    .describe('Total price for this line (qty * unit + options)'),
  specialInstructions: z
    .string()
    .nullable()
    .describe('Special instructions for this item'),
  selectedOptions: z
    .array(CartItemOption)
    .describe('Selected customization options'),
});

const CartFees = z.object({
  subtotal: z.string().describe('Subtotal before fees (e.g., "$25.98")'),
  deliveryFee: z
    .string()
    .nullable()
    .describe('Delivery fee (e.g., "$3.99"), null for pickup'),
  serviceFee: z.string().nullable().describe('Service fee (e.g., "$4.12")'),
  tax: z.string().nullable().describe('Estimated tax'),
  discount: z
    .string()
    .nullable()
    .describe('Discount amount if promo applied (e.g., "-$5.00")'),
  total: z.string().describe('Estimated total after all fees and discounts'),
});

export const getCartSchema = {
  name: 'getCart',
  description:
    'Get the current cart contents including items, quantities, and subtotal.',
  notes:
    'Returns the single active cart (DoorDash allows one active cart at a time via consumerOrderCart). ' +
    'fees.deliveryFee, fees.serviceFee, fees.tax, fees.discount, promoCode, and deliveryAddress are ' +
    'always null; these are only available after a delivery address is set during checkout. ' +
    'fees.subtotal and fees.total both reflect the items subtotal. ' +
    'fulfillmentType returns "Any" when not yet set.',
  input: z.object({}),
  output: z.object({
    storeId: z.string().describe('Store ID this cart belongs to'),
    storeName: z.string().describe('Store name'),
    items: z.array(CartItem).describe('Items currently in the cart'),
    fees: CartFees.describe(
      'Fee breakdown. Only subtotal and total are populated; other fees are null until checkout.',
    ),
    promoCode: z
      .string()
      .nullable()
      .describe('Always null; promo codes are not available via this endpoint'),
    fulfillmentType: z
      .string()
      .describe(
        'Fulfillment type ("Delivery", "Pickup", or "Any" when not yet set)',
      ),
    deliveryAddress: z
      .string()
      .nullable()
      .describe('Always null; delivery address is set during checkout'),
    isPickup: z.boolean().describe('Whether this is a pickup order'),
    isGroupCart: z.boolean().describe('Whether this is a group cart'),
    groupCartType: z
      .string()
      .nullable()
      .describe('Group cart type if applicable'),
    cartStatus: z.string().nullable().describe('Cart status type'),
    cartType: z
      .string()
      .nullable()
      .describe(
        'Cart type (e.g., "CART_TYPE_STORE_CART", "CART_TYPE_GROUP_CART")',
      ),
    currencyCode: z.string().nullable().describe('Currency code (e.g., "USD")'),
    offersDelivery: z.boolean().describe('Whether delivery is available'),
    offersPickup: z.boolean().describe('Whether pickup is available'),
    isCatering: z.boolean().describe('Whether this is a catering order'),
    isSameStoreCatering: z
      .boolean()
      .describe('Whether this is a same-store catering order'),
    isBundle: z.boolean().describe('Whether this is a bundle order'),
    bundleType: z.string().nullable().describe('Bundle type if applicable'),
    isConvenienceCart: z
      .boolean()
      .describe('Whether this is a convenience store cart'),
    isPrescriptionDelivery: z
      .boolean()
      .describe('Whether this is a prescription delivery'),
    isMerchantShipping: z
      .boolean()
      .describe('Whether this uses merchant shipping'),
    shortenedUrl: z
      .string()
      .nullable()
      .describe('Shortened shareable URL (populated for group carts)'),
    urlCode: z
      .string()
      .nullable()
      .describe('URL code for the cart (populated for group carts)'),
    submittedAt: z
      .string()
      .nullable()
      .describe('ISO timestamp when the cart was submitted, null if pending'),
    scheduledDeliveryAvailable: z
      .boolean()
      .nullable()
      .describe('Whether scheduled delivery is available for this cart'),
    isOutsideDeliveryRegion: z
      .boolean()
      .nullable()
      .describe('Whether the delivery address is outside the delivery region'),
    outOfStockMenuItemIds: z
      .array(z.string())
      .nullable()
      .describe('Item IDs of menu items that are currently out of stock'),
    groupCartSource: z
      .string()
      .nullable()
      .describe(
        'Group cart source (e.g., "GROUP_CART_SOURCE_UNSPECIFIED", "GROUP_CART_SOURCE_CONSUMER")',
      ),
    totalCents: z
      .number()
      .nullable()
      .describe(
        'Total cart amount in cents including fees (null until checkout with delivery address)',
      ),
    totalBeforeDiscountsCents: z
      .number()
      .nullable()
      .describe(
        'Total before discounts and credits in cents (null until checkout)',
      ),
  }),
};

export type GetCartInput = z.infer<typeof getCartSchema.input>;
export type GetCartOutput = z.infer<typeof getCartSchema.output>;

const AddToCartOption = z.object({
  optionId: z
    .string()
    .describe('Option ID from getItemDetails optionLists[].options[].id'),
  quantity: z
    .number()
    .optional()
    .default(1)
    .describe('Quantity of this option (default 1)'),
});

export const addToCartSchema = {
  name: 'addToCart',
  description:
    'Add a menu item to the cart with optional customizations. Item IDs come from getStoreMenu results.',
  notes:
    'Item IDs, itemName, and displayPrice are from getStoreMenu categories[].items[] fields. menuId is from getStoreMenu().menuId. Both storeId and menuId are required. For items with required customizations (isQuickAddEligible=false), call getItemDetails first to discover available options. Use option IDs from getItemDetails optionLists[].options[].id as the optionId in the options array.',
  input: z.object({
    csrf: CsrfParam,
    storeId: z.string().describe('Store ID (from getStoreMenu)'),
    menuId: z
      .string()
      .describe(
        'Menu ID (from getStoreMenu().menuId). Required by the DoorDash API.',
      ),
    itemId: z.string().describe('Menu item ID (from getStoreMenu results)'),
    itemName: z
      .string()
      .describe('Item name from getStoreMenu categories[].items[].name'),
    displayPrice: z
      .string()
      .describe(
        'Item price string from getStoreMenu categories[].items[].displayPrice (e.g., "$12.10")',
      ),
    quantity: z
      .number()
      .optional()
      .default(1)
      .describe('Quantity to add (default 1)'),
    options: z
      .array(AddToCartOption)
      .optional()
      .describe(
        'Customization options. Required for items where isQuickAddEligible is false.',
      ),
    specialInstructions: z
      .string()
      .optional()
      .describe('Special instructions for this item (e.g., "no onions")'),
  }),
  output: z.object({
    cartItemId: z
      .string()
      .describe('Cart line item ID for the newly added item'),
    itemName: z.string().describe('Name of the item added'),
    quantity: z.number().describe('Quantity added'),
    totalPrice: z.string().describe('Total price for this line item'),
    cartTotal: z.string().describe('Updated cart total after adding'),
  }),
};

export type AddToCartInput = z.infer<typeof addToCartSchema.input>;
export type AddToCartOutput = z.infer<typeof addToCartSchema.output>;

export const removeFromCartSchema = {
  name: 'removeFromCart',
  description: 'Remove an item from the cart by its cart item ID.',
  notes:
    'Use cartItemId from getCart results. Returns removed:false (without mutation) if the cartItemId is not found in the current cart or if no cart is active; handles stale IDs and retries safely. Removing the last item empties the cart.',
  input: z.object({
    csrf: CsrfParam.optional().describe(
      'CSRF token from getContext().csrf. If omitted, auto-detected from browser cookies.',
    ),
    cartItemId: z
      .string()
      .describe('Cart line item ID (from getCart items[].cartItemId)'),
    deleteBundleCarts: z
      .boolean()
      .optional()
      .describe(
        'When true, also deletes any associated bundle/double-dash secondary store carts alongside this item. Default false.',
      ),
  }),
  output: z.object({
    removed: z.boolean().describe('Whether the item was successfully removed'),
    cartTotal: z
      .string()
      .nullable()
      .describe('Updated cart total, null if cart is now empty'),
    itemCount: z.number().describe('Number of items remaining in cart'),
  }),
};

export type RemoveFromCartInput = z.infer<typeof removeFromCartSchema.input>;
export type RemoveFromCartOutput = z.infer<typeof removeFromCartSchema.output>;

export const updateCartItemSchema = {
  name: 'updateCartItem',
  description:
    'Update quantity or customizations for an item already in the cart.',
  notes:
    'Use cartItemId from getCart results. Set quantity to 0 to remove the item. Internally fetches the cart to resolve storeId, cartId, and itemId required by the updateCartItemV2 API.',
  input: z.object({
    csrf: CsrfParam.optional().describe(
      'CSRF token from getContext().csrf. If omitted, auto-detected from browser cookies.',
    ),
    cartItemId: z
      .string()
      .describe('Cart line item ID (from getCart items[].cartItemId)'),
    quantity: z
      .number()
      .optional()
      .describe('New quantity. Set to 0 to remove the item.'),
    options: z
      .array(AddToCartOption)
      .optional()
      .describe('Updated customization options. Replaces all current options.'),
    specialInstructions: z
      .string()
      .optional()
      .describe('Updated special instructions'),
    substitutionPreference: z
      .enum(['substitute', 'refund'])
      .optional()
      .describe(
        'What to do if the item is unavailable: "substitute" (replace with similar item), "refund" (refund the item). Defaults to "substitute".',
      ),
    fulfillmentType: z
      .enum(['Delivery', 'Pickup'])
      .optional()
      .describe(
        'Fulfillment type for the cart. Defaults to "Delivery". Use "Pickup" to switch the cart to a pickup order.',
      ),
    itemName: z
      .string()
      .optional()
      .describe(
        'Item name. Used to keep cart metadata consistent with the menu. Typically matches the name returned by getStoreMenu.',
      ),
    itemDescription: z
      .string()
      .optional()
      .describe(
        'Item description. Optional metadata field forwarded to the updateCartItemV2 API.',
      ),
    unitPrice: z
      .number()
      .optional()
      .describe(
        'Unit price in cents (e.g., 339 for $3.39). Forwarded to updateCartItemV2 for cart pricing consistency.',
      ),
    currency: z
      .string()
      .optional()
      .describe(
        'Currency code (e.g., "USD"). Defaults to "USD" when unitPrice is provided.',
      ),
    purchaseTypeOptions: z
      .object({
        purchaseType: z
          .enum([
            'PURCHASE_TYPE_UNSPECIFIED',
            'PURCHASE_TYPE_UNIT',
            'PURCHASE_TYPE_MEASUREMENT',
            'PURCHASE_TYPE_UNIT_TO_MEASUREMENT',
            'PURCHASE_TYPE_DYNAMIC_PRICE',
          ])
          .describe(
            'How the item is sold. PURCHASE_TYPE_UNIT for regular items; PURCHASE_TYPE_MEASUREMENT for items sold by weight/volume (e.g., deli items).',
          ),
        continuousQuantity: z
          .number()
          .describe(
            'Quantity for measurement-based items (e.g., 1.5 for 1.5 lbs). Set to 0 for unit-based items.',
          ),
        unit: z
          .string()
          .nullable()
          .describe(
            'Display unit string (e.g., "lb", "oz", "qty"). Null for unit-based items.',
          ),
        estimatedPricingDescription: z
          .string()
          .optional()
          .describe(
            'Pricing description shown for measurement-based items (e.g., "~$4.50/lb").',
          ),
      })
      .optional()
      .describe(
        'Purchase type options for items sold by weight or measurement. For regular unit-based items, omit this field; the API defaults to PURCHASE_TYPE_UNIT.',
      ),
    isAdsItem: z
      .boolean()
      .optional()
      .describe('Whether this item was added from a sponsored/ad placement.'),
    isBundle: z
      .boolean()
      .optional()
      .describe('Whether this item is a bundle (e.g., meal bundle).'),
    bundleType: z
      .string()
      .nullable()
      .optional()
      .describe('Bundle type identifier when isBundle is true.'),
    cartFilter: z
      .object({
        shouldIncludeSubmitted: z
          .boolean()
          .describe(
            'Whether to include already-submitted orders in the cart context.',
          ),
      })
      .optional()
      .describe('Cart filter options forwarded to the updateCartItemV2 API.'),
    shouldKeepOnlyOneActiveCart: z
      .boolean()
      .optional()
      .describe(
        'When true, any other active carts are cleared after this update. Used to enforce single-cart behavior.',
      ),
    returnCartFromOrderService: z
      .boolean()
      .optional()
      .describe(
        'When true, the response cart is fetched from the order service instead of the cart service. Defaults to false.',
      ),
  }),
  output: z.object({
    cartItemId: z.string().describe('Cart line item ID that was updated'),
    quantity: z.number().describe('Updated quantity'),
    totalPrice: z.string().describe('Updated line item total'),
    cartTotal: z.string().describe('Updated cart total'),
  }),
};

export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema.input>;
export type UpdateCartItemOutput = z.infer<typeof updateCartItemSchema.output>;

export const applyPromoCodeSchema = {
  name: 'applyPromoCode',
  description:
    'Apply a promotional code to the current cart. Returns updated pricing with discount.',
  notes:
    'Only one promo code can be active at a time. Applying a new one replaces the existing one.',
  input: z.object({
    csrf: CsrfParam,
    promoCode: z.string().describe('Promotional code to apply'),
  }),
  output: z.object({
    applied: z
      .boolean()
      .describe('Whether the promo code was successfully applied'),
    promoCode: z.string().describe('The promo code that was applied'),
    discountAmount: z
      .string()
      .nullable()
      .describe('Discount amount (e.g., "-$5.00"), null if invalid code'),
    cartTotal: z.string().describe('Updated cart total after discount'),
    message: z
      .string()
      .nullable()
      .describe('Success or error message from DoorDash'),
  }),
};

export type ApplyPromoCodeInput = z.infer<typeof applyPromoCodeSchema.input>;
export type ApplyPromoCodeOutput = z.infer<typeof applyPromoCodeSchema.output>;

export const removePromoCodeSchema = {
  name: 'removePromoCode',
  description: 'Remove an applied promo code from the cart.',
  notes:
    'Uses the removePromoCode GraphQL mutation (replaces removed removePromotionFromCart). If orderCartId is not provided, the active cart ID is fetched automatically.',
  input: z.object({
    csrf: CsrfParam,
    promoCode: z.string().describe('The promo code to remove from the cart'),
    orderCartId: z
      .string()
      .optional()
      .describe(
        'The order cart ID to remove the promo code from. If omitted, the active cart ID is fetched automatically from the current session.',
      ),
  }),
  output: z.object({
    removed: z
      .boolean()
      .describe(
        'Whether the promo code was present on the cart and successfully removed. False means the code was not applied to this cart; nothing was changed.',
      ),
    cartTotal: z
      .string()
      .nullable()
      .describe(
        'Updated cart total as a float string (e.g. "1333" = $13.33). Includes delivery fees and taxes; will differ from the subtotal shown by getCart. Null if removed was false or cart was not returned.',
      ),
  }),
};

export type RemovePromoCodeInput = z.infer<typeof removePromoCodeSchema.input>;
export type RemovePromoCodeOutput = z.infer<
  typeof removePromoCodeSchema.output
>;

// ============================================================================
// Account
// ============================================================================

const Address = z.object({
  id: z.string().describe('Address ID (consumer address link ID)'),
  addressId: z
    .string()
    .describe('Underlying address entity ID (distinct from id)'),
  street: z.string().describe('Street address (e.g., "123 Main St")'),
  subpremise: z
    .string()
    .nullable()
    .describe('Apartment, suite, unit (e.g., "Apt 4B"). Null if not set.'),
  city: z.string().describe('City name'),
  state: z.string().describe('State code (e.g., "CA")'),
  zipCode: z.string().describe('ZIP/postal code'),
  country: z
    .string()
    .describe('Country full name (e.g., "United States"), not a country code'),
  label: z
    .string()
    .nullable()
    .describe('Address label (e.g., "Home", "Work"). Null if no label is set.'),
  deliveryInstructions: z
    .string()
    .nullable()
    .describe(
      'Delivery instructions for the driver, from the active dropoff preference. Null if not set.',
    ),
  isDefault: z
    .boolean()
    .describe(
      'Always false; DoorDash API does not expose a default address flag.',
    ),
  lat: z.number().nullable().describe('Latitude coordinate'),
  lng: z.number().nullable().describe('Longitude coordinate'),
  manualLat: z
    .number()
    .nullable()
    .describe('Manually overridden latitude (null if not overridden)'),
  manualLng: z
    .number()
    .nullable()
    .describe('Manually overridden longitude (null if not overridden)'),
  printableAddress: z
    .string()
    .describe(
      'Full formatted address string (e.g., "350 5th Ave, New York, NY 10118, USA")',
    ),
  addressLinkType: z
    .string()
    .describe(
      'Address link type from DoorDash (e.g., "ADDRESS_LINK_TYPE_UNSPECIFIED")',
    ),
  buildingName: z
    .string()
    .nullable()
    .describe(
      'Building name (only populated for Apartment, Hotel, Other address types). Null if not set or address type does not support it.',
    ),
  entryCode: z
    .string()
    .nullable()
    .describe(
      'Entry code or gate code. Null if not set, or if the address type is House/None (those types do not persist entry codes).',
    ),
});

export type Address = z.infer<typeof Address>;

export const listAddressesSchema = {
  name: 'listAddresses',
  description:
    'Get all saved delivery addresses with labels (Home, Work, etc.) and delivery instructions.',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    addresses: z.array(Address).describe('All saved delivery addresses'),
  }),
};

export type ListAddressesInput = z.infer<typeof listAddressesSchema.input>;
export type ListAddressesOutput = z.infer<typeof listAddressesSchema.output>;

export const addAddressSchema = {
  name: 'addAddress',
  description:
    'Add a new delivery address with label and delivery instructions.',
  notes:
    'The address must be a valid street address. DoorDash geocodes and validates it server-side. Supported countries: US, CA, AU, NZ.',
  input: z.object({
    csrf: CsrfParam,
    street: z.string().describe('Street address (e.g., "123 Main St")'),
    subpremise: z
      .string()
      .optional()
      .describe('Apartment, suite, unit (e.g., "Apt 4B")'),
    city: z.string().describe('City name'),
    state: z.string().describe('State/province code (e.g., "CA")'),
    zipCode: z.string().describe('ZIP/postal code'),
    country: z
      .enum(['US', 'CA', 'AU', 'NZ'])
      .optional()
      .describe(
        'Country code. Defaults to "US". Supported values: "US" (United States), "CA" (Canada), "AU" (Australia), "NZ" (New Zealand).',
      ),
    label: z
      .string()
      .optional()
      .describe('Label for the address (e.g., "Home", "Work", "Office")'),
    deliveryInstructions: z
      .string()
      .optional()
      .describe('Instructions for the delivery driver'),
  }),
  output: z.object({
    address: Address.describe('The newly created address'),
  }),
};

export type AddAddressInput = z.infer<typeof addAddressSchema.input>;
export type AddAddressOutput = z.infer<typeof addAddressSchema.output>;

export const updateAddressSchema = {
  name: 'updateAddress',
  description: 'Update an existing saved delivery address.',
  notes:
    'Get the addressId from listAddresses (use the id field). Uses PATCH /unified-gateway/cx/addresses/v1/links/{id}. Street/city/state/zipCode changes are not supported; delete and re-add to change those. All other fields are optional; only provided fields are updated. IMPORTANT: subpremise, entryCode, and buildingName are silently discarded by the API for None address types (the API returns 200 OK with no error). These fields only persist when addressType is Apartment, Hotel, or Other (and entryCode also persists for House). To set subpremise or buildingName on a None/default address, also set addressType to "Apartment" or "Other" in the same call. addressType and businessName have no output representation; the returned address does not include those fields. Invalid values for label or addressType are silently ignored by the API; the function throws an error upfront to prevent silent failures.',
  input: z.object({
    csrf: CsrfParam,
    addressId: z
      .string()
      .describe(
        'Address ID from listAddresses (the id field, i.e. consumer_address_link_id)',
      ),
    street: z
      .string()
      .optional()
      .describe(
        'Not supported in the current API; ignored. Delete and re-add to change street.',
      ),
    subpremise: z
      .string()
      .optional()
      .describe(
        'Apartment/suite/unit number (e.g., "Apt 4B"). WARNING: Only persists when addressType is Apartment, Hotel, or Other. For None or House addresses, the API returns 200 OK but silently discards this value; there is no error. To set a subpremise on a default (None) or house address, you must also set addressType to "Apartment", "Hotel", or "Other" in the same call.',
      ),
    city: z
      .string()
      .optional()
      .describe(
        'Not supported in the current API; ignored. Delete and re-add to change city.',
      ),
    state: z
      .string()
      .optional()
      .describe('Not supported in the current API; ignored.'),
    zipCode: z
      .string()
      .optional()
      .describe('Not supported in the current API; ignored.'),
    label: z
      .enum(['Home', 'Work', 'None'])
      .optional()
      .describe(
        'Label for the address: "Home", "Work", or "None" to clear the label',
      ),
    deliveryInstructions: z
      .string()
      .optional()
      .describe(
        'Delivery instructions for the driver. Included with the dropoff preference (defaults to leave_at_door if dropoffPreference not specified).',
      ),
    entryCode: z
      .string()
      .optional()
      .describe(
        'Entry code or gate code (e.g., "#1234"). WARNING: Only persists for Apartment, Hotel, House, and Other address types. For None addresses, the API returns 200 OK but silently discards this value; there is no error. If the address has a None (default) type and you need to set an entry code, you must also set addressType to "House", "Apartment", or "Other" in the same call.',
      ),
    buildingName: z
      .string()
      .optional()
      .describe(
        'Building name (e.g., "The Grand"). Only persists when addressType is Apartment, Hotel, or Other. Silently discarded on House or None addresses.',
      ),
    businessName: z
      .string()
      .optional()
      .describe(
        'Business name (used for Office address type). Note: businessName has no corresponding output field; it cannot be read back from the returned address. It is write-only.',
      ),
    addressType: z
      .enum(['House', 'Apartment', 'Hotel', 'Office', 'Other', 'None'])
      .optional()
      .describe(
        'Type of the address: "House" (single family home), "Apartment" (multi-unit), "Hotel", "Office" (business), "Other", or "None". Note: addressType has no corresponding output field; the returned address does not include a type field, so you cannot confirm the change from the response.',
      ),
    dropoffPreference: z
      .enum(['leave_at_door', 'meet_at_door'])
      .optional()
      .describe(
        'Delivery drop-off preference: "leave_at_door" (contactless, default) or "meet_at_door"',
      ),
  }),
  output: z.object({
    address: Address.describe('The updated address'),
  }),
};

export type UpdateAddressInput = z.infer<typeof updateAddressSchema.input>;
export type UpdateAddressOutput = z.infer<typeof updateAddressSchema.output>;

const DeletedAddressInfo = z.object({
  id: z
    .string()
    .describe('Address record ID (the defaultAddressId used for deletion)'),
  addressId: z.string().describe('Secondary address ID'),
  street: z.string().describe('Street address'),
  subpremise: z
    .string()
    .nullable()
    .describe('Apartment, suite, or unit; empty string "" when not set'),
  city: z.string().describe('City'),
  state: z.string().describe('State code (e.g., "CA", "NY")'),
  zipCode: z.string().describe('ZIP code'),
  country: z
    .string()
    .describe('Full country name (e.g., "United States"), not a country code'),
  lat: z.number().nullable().describe('Latitude'),
  lng: z.number().nullable().describe('Longitude'),
});

export const deleteAddressSchema = {
  name: 'deleteAddress',
  description: 'Remove a saved delivery address.',
  notes:
    'Get the address ID from listAddresses. Cannot delete the default address; set a different default first if needed. Uses the removeConsumerAddressV2 GraphQL mutation.',
  input: z.object({
    csrf: CsrfParam,
    addressId: z
      .string()
      .describe(
        'Address ID to delete (the id field from listAddresses results)',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the address was successfully deleted'),
    defaultAddress: DeletedAddressInfo.nullable().describe(
      'The new default address after deletion, or null if no addresses remain',
    ),
    availableAddresses: z
      .array(DeletedAddressInfo)
      .describe('All remaining saved addresses after deletion'),
  }),
};

export type DeleteAddressInput = z.infer<typeof deleteAddressSchema.input>;
export type DeleteAddressOutput = z.infer<typeof deleteAddressSchema.output>;

const PaymentMethodCard = z.object({
  brand: z
    .string()
    .nullable()
    .describe('Card brand (e.g., "Visa", "Mastercard", "American Express")'),
  last4: z.string().nullable().describe('Last 4 digits of card number'),
  expMonth: z.number().nullable().describe('Card expiration month (1-12)'),
  expYear: z.number().nullable().describe('Card expiration year (e.g., 2027)'),
  country: z
    .string()
    .nullable()
    .describe('Card issuing country code (e.g., "US")'),
  iin: z
    .string()
    .nullable()
    .describe('Issuer Identification Number: first 6 digits of card number'),
});

const PaymentMethod = z.object({
  id: z.string().describe('Payment method ID'),
  type: z
    .string()
    .describe(
      'Payment type (e.g., "CREDIT_CARD", "DEBIT_CARD", "PAYPAL", "APPLE_PAY", "GOOGLE_PAY")',
    ),
  last4: z
    .string()
    .nullable()
    .describe('Last 4 digits of card number, null for non-card methods'),
  expMonth: z
    .number()
    .nullable()
    .describe('Card expiration month (1-12), null for non-card methods'),
  expYear: z
    .number()
    .nullable()
    .describe('Card expiration year (e.g., 2027), null for non-card methods'),
  isDefault: z.boolean().describe('Whether this is the default payment method'),
  paymentMethodUuid: z
    .string()
    .nullable()
    .describe('UUID for this payment method'),
  paymentMethodType: z
    .string()
    .nullable()
    .describe('Payment method type string'),
  paymentTags: z
    .array(z.string())
    .describe(
      'Tags associated with this payment method (e.g., HSA/FSA eligibility)',
    ),
  card: PaymentMethodCard.nullable().describe(
    'Card details sub-object, null for non-card payment methods',
  ),
});

export type PaymentMethodCard = z.infer<typeof PaymentMethodCard>;
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const listPaymentMethodsSchema = {
  name: 'listPaymentMethods',
  description:
    'Get all saved payment methods including cards, PayPal, Apple Pay, and other linked accounts.',
  notes:
    'Read-only; listing payment methods only. Adding/removing payment methods requires the full checkout flow. Uses the paymentMethodQuery GraphQL operation (getPaymentMethodList field). The older consumerPaymentCards operation returns 503 and is no longer functional.',
  input: z.object({
    csrf: CsrfParam.optional().describe(
      'CSRF token from getContext().csrf. If omitted, auto-detected from browser cookies.',
    ),
  }),
  output: z.object({
    paymentMethods: z
      .array(PaymentMethod)
      .describe('All saved payment methods'),
  }),
};

export type ListPaymentMethodsInput = z.infer<
  typeof listPaymentMethodsSchema.input
>;
export type ListPaymentMethodsOutput = z.infer<
  typeof listPaymentMethodsSchema.output
>;

export const getCreditsBalanceSchema = {
  name: 'getCreditsBalance',
  description:
    'Get the current DoorDash account credits balance. This reflects all redeemable credits including redeemed gift card value; there is no separate gift card balance field.',
  notes: '',
  input: z.object({
    csrf: CsrfParam.optional().describe(
      'CSRF token from getContext().csrf. If omitted, auto-detected from browser cookies.',
    ),
  }),
  output: z.object({
    balance: z
      .string()
      .describe('Credits balance as formatted string (e.g., "$25.00")'),
    balanceCents: z.number().describe('Credits balance in cents (e.g., 2500)'),
  }),
};

export type GetCreditsBalanceInput = z.infer<
  typeof getCreditsBalanceSchema.input
>;
export type GetCreditsBalanceOutput = z.infer<
  typeof getCreditsBalanceSchema.output
>;

export const getDashPassStatusSchema = {
  name: 'getDashPassStatus',
  description:
    'Get current DashPass subscription status: active/inactive, renewal date, plan type, and benefits summary.',
  notes:
    "Uses the `subscriptionInformation` GraphQL query (the old `getDashPassStatus` field was removed from DoorDash's schema). Data is SSR on the /dashpass/ page; no client-side call on page load. `benefits` and `trialEndDate` are always empty/null in the current API.",
  input: z.object({
    csrf: CsrfParam.optional().describe(
      'CSRF token from getContext().csrf. If omitted, auto-detected from browser cookies.',
    ),
  }),
  output: z.object({
    isActive: z
      .boolean()
      .describe('Whether DashPass subscription is currently active'),
    planType: z
      .string()
      .nullable()
      .describe(
        'Billing recurrence interval (e.g., "MONTHLY", "ANNUAL"), null if inactive',
      ),
    renewalDate: z
      .string()
      .nullable()
      .describe(
        'Subscription end/renewal date as ISO string, null if inactive',
      ),
    trialEndDate: z
      .string()
      .nullable()
      .describe('Always null; trial end date is no longer returned by the API'),
    benefits: z
      .array(z.string())
      .describe('Always empty; benefits list is no longer returned by the API'),
    monthlyPrice: z
      .string()
      .nullable()
      .describe('Plan fee display string (e.g., "$9.99/mo"), null if inactive'),
    subscriptionStatus: z
      .string()
      .describe(
        'Raw subscription status from API (e.g., "active", "does_not_exist", "inactive", "paused")',
      ),
    startTime: z
      .string()
      .nullable()
      .describe('Subscription start date as ISO string, null if inactive'),
    lastMonthSavings: z
      .string()
      .nullable()
      .describe(
        'Display string of savings from DashPass last month (e.g., "$12.50"), null if none',
      ),
    canPause: z
      .boolean()
      .nullable()
      .describe('Whether the subscription can be paused, null if inactive'),
    resumeDate: z
      .string()
      .nullable()
      .describe(
        'ISO date when a paused subscription resumes, null if not paused',
      ),
  }),
};

export type GetDashPassStatusInput = z.infer<
  typeof getDashPassStatusSchema.input
>;
export type GetDashPassStatusOutput = z.infer<
  typeof getDashPassStatusSchema.output
>;

// ============================================================================
// Misc (ratings, issues, promotions, gift cards, group orders)
// ============================================================================

export const rateOrderSchema = {
  name: 'rateOrder',
  description:
    'Rate a completed delivery order with star rating and optional feedback.',
  notes:
    'Only works for completed orders. Get orderUuid from listOrders results.',
  input: z.object({
    csrf: CsrfParam,
    orderUuid: z
      .string()
      .uuid()
      .describe('Order UUID from order history (UUID format)'),
    rating: z
      .number()
      .min(1)
      .max(5)
      .describe('Star rating from 1 (poor) to 5 (excellent)'),
    feedback: z
      .string()
      .optional()
      .describe('Optional text feedback about the order'),
    deliveryRating: z
      .number()
      .min(1)
      .max(5)
      .optional()
      .describe('Separate star rating for the delivery experience (1-5)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the rating was submitted'),
    errorCode: z
      .string()
      .optional()
      .describe('Error code from DoorDash when success is false'),
    errorMessage: z
      .string()
      .optional()
      .describe(
        'Human-readable error message from DoorDash when success is false',
      ),
  }),
};

export type RateOrderInput = z.infer<typeof rateOrderSchema.input>;
export type RateOrderOutput = z.infer<typeof rateOrderSchema.output>;

export const reportIssueSchema = {
  name: 'reportIssue',
  description:
    "Open DoorDash's in-app help page so the user can report an issue with an order. DoorDash removed the reportOrderIssue API; there is no programmatic way to create a CNR case. This function opens the help page in a new tab.",
  notes:
    'DoorDash removed the reportOrderIssue GraphQL mutation. This function opens /help/orders/{orderUuid} (order-specific) or /orders/help (general) in a new tab. There is no programmatic API to create CNR (Credits and Refunds) cases. To check the STATUS of an existing issue, use getIssueStatus with the delivery UUID.',
  input: z.object({
    orderUuid: z
      .string()
      .optional()
      .describe(
        'Order UUID from order history (UUID format). When provided, opens the order-specific help page. When omitted, opens the general help landing page.',
      ),
  }),
  output: z.object({
    helpUrl: z.string().describe('Actual URL of the help page that was opened'),
    opened: z
      .boolean()
      .describe('Whether the help page was opened in a new tab'),
    message: z
      .string()
      .describe(
        'Explanation that the user must complete the issue report manually in the opened page',
      ),
  }),
};

export type ReportIssueInput = z.infer<typeof reportIssueSchema.input>;
export type ReportIssueOutput = z.infer<typeof reportIssueSchema.output>;

const CnrReviewResult = z.object({
  deliveryUuid: z.string().describe('Delivery UUID'),
  status: z
    .enum(['APPROVED', 'DENIED', 'IN_REVIEW'])
    .nullable()
    .describe(
      'CNR review status: APPROVED = refund/credit issued, DENIED = request declined, IN_REVIEW = pending review. Null if no active CNR case.',
    ),
  caseCreatedAt: z
    .string()
    .nullable()
    .describe('ISO timestamp when the CNR case was opened'),
  caseExpiredAt: z
    .string()
    .nullable()
    .describe('ISO timestamp when the case expired, null if not expired'),
  caseReviewedAt: z
    .string()
    .nullable()
    .describe('ISO timestamp when the case was reviewed, null if pending'),
});

export const getIssueStatusSchema = {
  name: 'getIssueStatus',
  description:
    "Check the CNR (Credits and Refunds) review status for a delivered order. Uses cnrReviewDetails API; the old getOrderIssueStatus operation was removed from DoorDash's schema.",
  notes:
    'Get deliveryUuid from getOrder (deliveryUuid field). Throws INVALID_ARGUMENT if deliveryUuid is not valid UUID format. Throws NOT_FOUND if the delivery UUID does not exist; only pass UUIDs from real orders. Returns null status fields when the UUID exists but has no active CNR case. Use deliveryUuids to batch-check multiple orders in a single API call; allResults will contain one entry per UUID (including deliveryUuid) with null fields for any UUID that has no CNR case.',
  input: z.object({
    csrf: CsrfParam,
    deliveryUuid: z
      .string()
      .describe(
        'Delivery UUID for the order: get from getOrder (deliveryUuid field)',
      ),
    deliveryUuids: z
      .array(z.string())
      .optional()
      .describe(
        'Additional delivery UUIDs to batch-check alongside deliveryUuid in a single API call. The cnrReviewDetails API accepts an array; use this to check multiple orders at once. Results for all UUIDs appear in allResults.',
      ),
  }),
  output: z.object({
    deliveryUuid: z.string().describe('Delivery UUID'),
    status: z
      .enum(['APPROVED', 'DENIED', 'IN_REVIEW'])
      .nullable()
      .describe(
        'CNR review status: APPROVED = refund/credit issued, DENIED = request declined, IN_REVIEW = pending review. Null if no active CNR case.',
      ),
    caseCreatedAt: z
      .string()
      .nullable()
      .describe('ISO timestamp when the CNR case was opened'),
    caseExpiredAt: z
      .string()
      .nullable()
      .describe('ISO timestamp when the case expired, null if not expired'),
    caseReviewedAt: z
      .string()
      .nullable()
      .describe('ISO timestamp when the case was reviewed, null if pending'),
    allResults: z
      .array(CnrReviewResult)
      .optional()
      .describe(
        'All CNR review results when deliveryUuids batch param is provided. Includes results for deliveryUuid and all additional deliveryUuids. Only populated when deliveryUuids input param is used.',
      ),
  }),
};

export type GetIssueStatusInput = z.infer<typeof getIssueStatusSchema.input>;
export type GetIssueStatusOutput = z.infer<typeof getIssueStatusSchema.output>;

const Promotion = z.object({
  id: z.string().describe('Campaign ID (unique promotion identifier)'),
  title: z
    .string()
    .describe('Promotion title (e.g., "20% off your next order")'),
  description: z
    .string()
    .nullable()
    .describe('Promotion details and conditions'),
  code: z
    .string()
    .nullable()
    .describe('Promo code if applicable, null for auto-applied promotions'),
  expiration: z
    .string()
    .nullable()
    .describe(
      'Expiration date as "MM/DD/YYYY" string (e.g., "03/03/2124"), null if no expiry',
    ),
  featuredOnApp: z
    .boolean()
    .nullable()
    .describe('Whether the promotion is featured/highlighted on app'),
  maxApplicableDeliveryCount: z
    .number()
    .nullable()
    .describe(
      'Maximum number of deliveries this promotion can be applied to, null if unlimited',
    ),
  target: z
    .number()
    .nullable()
    .describe(
      'Promotion target/eligibility type (integer enum value from DoorDash internal system), null if not applicable',
    ),
  disabledDisplaySurface: z
    .array(z.string())
    .nullable()
    .describe(
      'Surfaces where the promotion display is disabled (empty array if visible everywhere), null when not applicable',
    ),
  adGroupId: z
    .string()
    .nullable()
    .describe('Ad group ID (internal DoorDash ad system identifier)'),
  adId: z
    .string()
    .nullable()
    .describe('Ad ID (internal DoorDash ad system identifier)'),
});

export type Promotion = z.infer<typeof Promotion>;

export const getAvailablePromotionsSchema = {
  name: 'getAvailablePromotions',
  description:
    'Get current available promotions, deals, and promo codes for the user.',
  notes:
    'Fetches promotions from the active cart via the checkout GraphQL operation (POST /graphql/checkout). The old getConsumerPromotions GraphQL operation was removed by DoorDash; promotions are now cart-scoped. If hasActiveCart is false, no cart exists and promotions cannot be determined. If hasActiveCart is true and promotions is empty, the user has a cart but no promotions are currently available. promotions contains all available promos; appliedPromotions contains only the currently applied ones.',
  input: z.object({
    csrf: CsrfParam,
    cartId: z
      .string()
      .optional()
      .describe(
        'Order cart UUID (e.g. "1747d058-e273-41ee-901a-730f4ac5aff0"). If not provided, fetched automatically via consumerOrderCart.',
      ),
  }),
  output: z.object({
    promotions: z
      .array(Promotion)
      .describe('All available promotions and deals for the active cart'),
    appliedPromotions: z
      .array(Promotion)
      .describe('Promotions currently applied/active on the cart'),
    hasActiveCart: z
      .boolean()
      .describe(
        'Whether the user has an active cart. When false, promotions is always empty because promotions are cart-scoped.',
      ),
  }),
};

export type GetAvailablePromotionsInput = z.infer<
  typeof getAvailablePromotionsSchema.input
>;
export type GetAvailablePromotionsOutput = z.infer<
  typeof getAvailablePromotionsSchema.output
>;

export const redeemGiftCardSchema = {
  name: 'redeemGiftCard',
  description:
    'Redeem a DoorDash gift card code to add credits to the account balance.',
  notes:
    'Uses the redeemGift GraphQL mutation. giftPin is the gift card code (typically 16 chars). On failure (invalid PIN, cross-country mismatch, MFA required) the function returns { redeemed: false, code } rather than throwing; always check redeemed before treating the result as success. Known code values: "BAD_USER_INPUT" (invalid or already-redeemed PIN), "CROSS_COUNTRY_MISMATCH" (gift card country differs from user country; retry with isCrossCountryConfirmation: true). IMPORTANT: Do NOT pass consumerId; the GraphQL mutation declares it as Int (32-bit signed, max 2,147,483,647), but real DoorDash consumer IDs (from getContext()) far exceed this limit and will cause HTTP 400. Use consumerIdString instead if a consumer ID is needed.',
  input: z.object({
    csrf: CsrfParam,
    giftPin: z
      .string()
      .describe('Gift card PIN/code to redeem (e.g., "ABCD1234EFGH5678")'),
    supportsCrossCountryDialog: z
      .boolean()
      .optional()
      .describe(
        'Whether the client supports the cross-country confirmation dialog. Defaults to true.',
      ),
    isCrossCountryConfirmation: z
      .boolean()
      .optional()
      .describe(
        'Set to true when the user explicitly confirms redeeming a gift card from a different country. Defaults to false.',
      ),
    consumerId: z
      .number()
      .int()
      .max(2147483647)
      .optional()
      .describe(
        'AVOID: GraphQL Int is 32-bit signed (max 2,147,483,647). Real DoorDash consumer IDs exceed this limit and will cause HTTP 400. Use consumerIdString instead.',
      ),
    consumerIdString: z
      .string()
      .optional()
      .describe(
        'Consumer ID as a string. Use this (not consumerId) when passing the consumer ID from getContext(); real account IDs exceed the Int32 max of 2,147,483,647.',
      ),
    countryCode: z
      .string()
      .optional()
      .describe('User country code (e.g., "US"). Defaults to current locale.'),
  }),
  output: z.object({
    redeemed: z
      .boolean()
      .describe('Whether the gift card was successfully redeemed'),
    amountAdded: z
      .string()
      .optional()
      .describe('Formatted amount credited to account (e.g., "$25.00")'),
    currency: z
      .string()
      .optional()
      .describe('Currency code for the credited amount (e.g., "USD")'),
    unitAmount: z
      .number()
      .optional()
      .describe('Amount credited in smallest currency unit (e.g., cents)'),
    decimalPlaces: z
      .number()
      .optional()
      .describe('Decimal places for the unitAmount'),
    userCountry: z.string().optional().describe("User's country code"),
    giftCardCountry: z
      .string()
      .optional()
      .describe(
        "Gift card's country code; differs from userCountry on cross-country attempts",
      ),
    code: z
      .string()
      .optional()
      .describe('Status or error code returned by the server'),
  }),
};

export type RedeemGiftCardInput = z.infer<typeof redeemGiftCardSchema.input>;
export type RedeemGiftCardOutput = z.infer<typeof redeemGiftCardSchema.output>;

export const createGroupOrderSchema = {
  name: 'createGroupOrder',
  description:
    'Create a group order (group cart) for a store that others can join and add their items to.',
  notes:
    'DoorDash group orders are implemented as group carts. The creator pays for the full order by default. Share the inviteLink with participants. Get storeId and menuId from getStoreMenu results or the store page URL (/store/{slug}-{storeId}/{menuId}/).',
  input: z.object({
    csrf: CsrfParam,
    storeId: z
      .string()
      .describe(
        'Numeric store/restaurant ID (e.g., "24268499"). From getStoreMenu or store page URL.',
      ),
    menuId: z
      .string()
      .describe(
        'Numeric menu ID (e.g., "49711"). From getStoreMenu or store page URL.',
      ),
    storeName: z
      .string()
      .optional()
      .describe('Display name of the store (optional, for convenience).'),
    maxIndividualCost: z
      .number()
      .int()
      .optional()
      .describe(
        'Per-person spending limit in cents (e.g., 2000 = $20). Omit or null for no limit.',
      ),
    fulfillmentType: z
      .enum(['Delivery', 'Pickup'])
      .optional()
      .default('Delivery')
      .describe('Delivery or Pickup. Defaults to Delivery.'),
    groupCartType: z
      .enum(['GROUP_CART_TYPE_CREATOR_PAYS_ALL'])
      .optional()
      .default('GROUP_CART_TYPE_CREATOR_PAYS_ALL')
      .describe(
        'Payment type. Currently only GROUP_CART_TYPE_CREATOR_PAYS_ALL is supported (one person pays for all participants).',
      ),
  }),
  output: z.object({
    cartId: z
      .string()
      .describe(
        'Cart UUID for this group order. Use to view the cart at /cart/{cartId}.',
      ),
    inviteLink: z
      .string()
      .nullable()
      .describe(
        'Shareable shortened URL for participants to join (e.g., "https://drd.sh/cart/..."). Share this link with everyone who should add items.',
      ),
    storeName: z.string().describe('Name of the store the group order is at.'),
    groupCartType: z
      .string()
      .describe(
        'Payment type: "GROUP_CART_TYPE_CREATOR_PAYS_ALL" or "GROUP_CART_TYPE_EACH_PAYS_OWN".',
      ),
  }),
};

export type CreateGroupOrderInput = z.infer<
  typeof createGroupOrderSchema.input
>;
export type CreateGroupOrderOutput = z.infer<
  typeof createGroupOrderSchema.output
>;

const GroupOrderParticipant = z.object({
  name: z.string().describe('Participant display name'),
  itemCount: z.number().describe('Number of items added'),
  subtotal: z.string().describe('Participant subtotal (e.g., "$18.50")'),
  hasSubmitted: z
    .boolean()
    .describe('Whether the participant has finalized their items'),
});

export type GroupOrderParticipant = z.infer<typeof GroupOrderParticipant>;

export const getGroupOrderSchema = {
  name: 'getGroupOrder',
  description:
    "Get details of a group cart by cart ID. Uses getGroupCart internally; the old getGroupOrder operation was removed from DoorDash's API. Returns cart metadata including status, invite link, and orders.",
  notes:
    'Pass the cart UUID from createGroupOrder as groupOrderId. The old group-order-specific fields (participants list, deadline, totalAmount string, storeName) no longer exist in the API; use cartStatusType for status and shortenedUrl for the invite link.',
  input: z.object({
    csrf: CsrfParam,
    groupOrderId: z
      .string()
      .describe(
        'Group cart UUID from createGroupOrder (maps to cartId in getGroupCart)',
      ),
  }),
  output: z.object({
    groupOrderId: z.string().describe('Group cart UUID'),
    shortenedUrl: z
      .string()
      .nullable()
      .describe('Shareable invite link (e.g., "https://drd.sh/cart/...")'),
    groupCartType: z
      .string()
      .nullable()
      .describe(
        'Group cart type: "GROUP_CART_TYPE_CREATOR_PAYS_ALL" (one person pays), "GROUP_CART_TYPE_SPLIT_BILL" (each pays own; replaces deprecated EACH_PAYS_OWN), "GROUP_CART_TYPE_CART_TOPPER", or "GROUP_CART_TYPE_UNSPECIFIED"',
      ),
    groupCartSource: z
      .string()
      .nullable()
      .describe('Group cart source (e.g., "GROUP_CART_SOURCE_UNSPECIFIED")'),
    cartStatusType: z
      .string()
      .nullable()
      .describe('Cart status (e.g., "CART_STATUS_TYPE_ACTIVE")'),
    cartType: z
      .string()
      .nullable()
      .describe('Cart type (e.g., "CART_TYPE_STORE_CART")'),
    fulfillmentType: z
      .string()
      .nullable()
      .describe('Fulfillment type: "Delivery", "Pickup", or "Any"'),
    isConsumerPickup: z
      .boolean()
      .nullable()
      .describe('Whether the order is a consumer pickup'),
    subtotal: z
      .number()
      .nullable()
      .describe(
        'Cart subtotal in cents (null if cart is not found or not yet populated)',
      ),
    total: z
      .number()
      .nullable()
      .describe('Cart total in cents (null if not finalized)'),
    maxIndividualCost: z
      .number()
      .nullable()
      .describe(
        'Per-participant spending limit in cents (0 means no limit; set via createGroupOrder maxIndividualCost)',
      ),
    specialInstructions: z
      .string()
      .nullable()
      .describe('Special instructions or notes for the group cart'),
    createdAt: z
      .number()
      .nullable()
      .describe('Cart creation timestamp in milliseconds since epoch'),
    updatedAt: z
      .number()
      .nullable()
      .describe('Last update timestamp in milliseconds since epoch'),
    urlCode: z
      .string()
      .nullable()
      .describe(
        'URL code for the cart; returns the cart UUID (same as groupOrderId)',
      ),
    tipAmount: z
      .number()
      .nullable()
      .describe('Tip amount in cents (null if not yet set)'),
    deliveryFee: z
      .number()
      .nullable()
      .describe('Delivery fee in cents (null if not yet calculated)'),
    scheduledDeliveryAvailable: z
      .boolean()
      .nullable()
      .describe('Whether scheduled delivery is available for this cart'),
    selfDeliveryType: z
      .string()
      .nullable()
      .describe('Self-delivery type (null for standard delivery)'),
    menu: z
      .object({
        id: z.string().describe('Menu ID associated with this group cart'),
        name: z.string().nullable().describe('Menu name'),
      })
      .nullable()
      .describe('Menu associated with this group cart'),
    restaurant: z
      .object({
        id: z.string().describe('Restaurant/store ID'),
        name: z.string().nullable().describe('Restaurant name'),
      })
      .nullable()
      .describe('Restaurant associated with this cart'),
    orders: z
      .array(
        z.object({
          id: z.string().describe('Order ID'),
          consumer: z
            .object({
              id: z.string().describe('Consumer/participant ID'),
              firstName: z
                .string()
                .nullable()
                .describe('Participant first name'),
              lastName: z.string().nullable().describe('Participant last name'),
            })
            .nullable()
            .describe('The participant who placed this sub-order'),
          orderItems: z
            .array(
              z.object({
                id: z.string().describe('Order item ID'),
                quantity: z.number().describe('Item quantity'),
                itemName: z.string().describe('Menu item name'),
              }),
            )
            .describe('Items in this order'),
        }),
      )
      .describe('Orders in this group cart'),
  }),
};

export type GetGroupOrderInput = z.infer<typeof getGroupOrderSchema.input>;
export type GetGroupOrderOutput = z.infer<typeof getGroupOrderSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  searchStoresSchema,
  getStoreMenuSchema,
  getItemDetailsSchema,
  getStoreFeedSchema,
  getStoreDetailsSchema,
  getStoreReviewsSchema,
  getSavedStoresSchema,
  saveStoreSchema,
  unsaveStoreSchema,
  listOrdersSchema,
  getOrderSchema,
  trackOrderSchema,
  reorderSchema,
  getCartSchema,
  addToCartSchema,
  removeFromCartSchema,
  updateCartItemSchema,
  applyPromoCodeSchema,
  removePromoCodeSchema,
  listAddressesSchema,
  addAddressSchema,
  updateAddressSchema,
  deleteAddressSchema,
  listPaymentMethodsSchema,
  getCreditsBalanceSchema,
  getDashPassStatusSchema,
  rateOrderSchema,
  reportIssueSchema,
  getIssueStatusSchema,
  getAvailablePromotionsSchema,
  redeemGiftCardSchema,
  createGroupOrderSchema,
  getGroupOrderSchema,
];
