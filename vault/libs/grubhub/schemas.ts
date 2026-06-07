import { z } from 'zod';

export const libraryDescription =
  'Grubhub operations: search restaurants, browse menus, manage a cart, attach payment, place pickup or delivery orders, and track order status.';

export const libraryIcon = '/icons/libs/grubhub.png';
export const loginUrl = 'https://www.grubhub.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://www.grubhub.com\` and log in (Google SSO, email, or Apple).
2. Call \`getContext()\` to get the diner's \`dinerId\` (used by \`listAddresses\`, \`listFavorites\`, \`listPaymentMethods\`, \`getOrder\`, \`trackOrder\`).
3. **Pick a primary cart** (see "Primary Cart" below) — either \`createCart\` (start fresh, purges any existing carts) or \`adoptCart({ cartId })\` after inspecting \`listCarts\`.
4. To order: \`searchRestaurants\` → \`getMenu\` / \`getMenuItem\` → \`addToCart\` → (for pickup) \`setPickupLocation\` + \`setPickupInfo\` / (for delivery) \`setDeliveryLocation\` + \`setDeliveryInfo\` → (optional) \`setCartTip\` → \`listPaymentMethods\` → \`attachPaymentToCart\` → \`getCheckoutSummary\` → \`getOrderContact\` and confirm with diner → \`placeOrder\` → \`getOrder\` / \`trackOrder\`.

## Primary Cart

The web UI only ever shows one active cart, but the Grubhub backend lets a diner hold multiple. The library enforces the UI's single-cart model: every conversation picks one "primary" cart and every mutating call asserts that \`listCarts\` is exactly \`[primary]\`. Orphan carts are silently deleted; if the primary itself disappears (which is what submission looks like), the library refuses to proceed and points you at \`getOrder\` to resolve the existing order — this prevents rebuild-and-resubmit double orders.

First use in a conversation:
1. Call \`listCarts\`. If there are existing carts, summarize each (\`restaurantIds\`, \`lineCount\`, \`subtotalCents\`) and ask the diner whether to continue from one or start over.
2. On "continue", call \`adoptCart({ cartId })\` — the library purges the others and records the picked one as primary.
3. On "start fresh", call \`createCart\` — the library purges every existing cart and creates a new primary.

After that, pass the primary cartId to every cart function. Using a cartId that isn't the primary will throw. After a successful \`placeOrder\`, the primary is cleared and the next order must start a new cart cycle.

## Confirming Intent

Ordering is an interactive flow with mandatory gates. Each gate below MUST be resolved with the diner before the referenced function is called. Do not infer, default, or batch past a gate.

1. **Always ask: delivery or pickup?** Ask at the start of every ordering session, even if the diner's phrasing seems to imply one. The answer gates \`searchRestaurants\`, \`getMenu\`, \`getMenuItem\`, \`getRestaurant\`, and the cart-location calls.
2. **Always locate the diner from Grubhub's saved addresses first, then confirm.** Before \`searchRestaurants\`, call \`getContext\` (for \`dinerId\`) then \`listAddresses\`. Present the saved addresses to the diner and have them pick one — read the full street address back and get an explicit "yes, that's right" before proceeding, even when there is only one saved address. Only if the diner has no saved addresses, or explicitly wants a different location, ask them for an address and geocode it in-session. Never reuse coordinates from prior conversation, session memory, or a city inferred from the diner's phrasing.
3. **Always confirm the restaurant.** After \`searchRestaurants\`, present candidates with **name and full street address** and get the diner's explicit pick. Chains have multiple locations; "Chipotle" is not enough.
4. **Do not auto-pull the menu.** \`getMenu\` and \`getRestaurant\` run only after the diner has named a specific restaurant from the search results. Never chain \`searchRestaurants\` → \`getMenu\` in one step.
5. **Always walk through every choice category, including nested ones.** Before every \`addToCart\` call, fetch \`getMenuItem\` and present **every** entry in \`choiceCategories\` to the diner — both required (\`minChoices >= 1\`) and optional (\`minChoices: 0\`). When a picked option has non-empty \`childCategories\` (e.g. picking a filling exposes nested Rice/Beans/Toppings categories), recurse into those and collect the diner's picks the same way. Pass nested selections via \`childOptions\` on the parent option in \`addToCart\` — keep the tree; do not flatten it. Do not silently skip optional categories. The only exception is when the diner has explicitly said to skip options or use defaults for this order.
6. **Confirm the cart before mutating.** Before the first cart mutation in a conversation, call \`listCarts\` and, if any existing carts are present, ask the diner whether to continue from one (\`adoptCart\`) or start fresh (\`createCart\`). The library will not let you mutate without a primary cart set.
7. **Totals before submit.** \`placeOrder\` charges real money. Call \`getCheckoutSummary\` and read the total, fees, and tip back to the diner before submitting.
8. **Confirm contact info before leaving checkout.** Call \`getOrderContact\` for both pickup and delivery orders and read the name and phone back to the diner — pickup restaurants use them to identify the diner, and delivery couriers use the phone to reach the door. If either is wrong, call \`setOrderContactName\` or \`setOrderContactPhone\` before \`placeOrder\`.
9. **If a cart call says the primary is missing, stop.** That means the cart was almost certainly already submitted. Call \`getOrder({ cartIdOrOrderUuid: <primary> })\` and surface the existing order; never rebuild into a fresh cart without confirming, or you will double-charge.

## Key Concepts

- **dinerId**: UUID identifying the logged-in user. Returned by \`getContext\`.
- **restaurantId**: Numeric string identifying a restaurant (e.g. "2070631").
- **menuItemId**: Numeric string identifying a menu item within a restaurant.
- **cartId**: Base64-like string identifying an active cart. Each cart belongs to a single restaurant.
- **cartLineId**: Identifier for a line item within a cart. Use for \`removeFromCart\`.
- **orderUuid**: UUID assigned when an order is placed. Distinct from cartId. Use for \`trackOrder\`.
- **paymentMethodId**: Identifier for a saved payment method, returned by \`listPaymentMethods\`.
- **Location**: Coordinates are passed as separate \`latitude\` / \`longitude\` decimals. Internally they are serialized as WKT \`POINT(lng lat)\`; the library handles this conversion.
- **Fulfillment type**: Either "delivery" or "pickup", a per-cart choice. The endpoints used differ between modes (\`incomplete_delivery\` vs \`incomplete_pickup\`, \`delivery_info\` vs \`pickup_info\`). Both modes need finalized contact info before checkout: pickup via \`setPickupInfo\`, delivery via \`setDeliveryInfo\` (full street address + contact).

## 3D Secure

The first order on a payment card often requires 3D Secure verification. \`placeOrder\` detects this and throws with a clear message; the user must complete the 3DS challenge in the browser once, after which subsequent orders on that card succeed without a challenge.

## Pagination

Page-based: \`pageNum\` (1-indexed) + \`pageSize\`.
`;

// ============================================================================
// getContext
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    "Get the logged-in diner's ID and profile. Verifies the user is authenticated.",
  notes:
    'Call FIRST. The returned dinerId is required by listAddresses, listFavorites, listPaymentMethods, getOrder, and trackOrder.',
  input: z.object({}),
  output: z.object({
    dinerId: z
      .string()
      .describe('UUID of the logged-in diner (also called ud_id)'),
    email: z.string().describe('Diner email'),
    firstName: z.string().describe('Diner first name'),
    lastName: z.string().describe('Diner last name'),
    phone: z.string().nullable().describe('Diner phone, null if not set'),
    brand: z.string().describe('Account brand (typically "GRUBHUB")'),
    loggedIn: z
      .boolean()
      .describe('Always true when this function returns successfully'),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// searchRestaurants
// ============================================================================

const SearchRestaurantResult = z.object({
  restaurantId: z.string().describe('Numeric restaurant ID'),
  name: z.string(),
  logo: z.string().nullable().describe('Logo image URL'),
  rating: z
    .object({
      count: z.number().describe('Total rating count'),
      average: z.number().describe('Actual average rating (0-5)'),
    })
    .nullable(),
  priceRating: z
    .number()
    .nullable()
    .describe('Price level, 1 (cheapest) to 4 (priciest)'),
  cuisines: z.array(z.string()),
  address: z
    .object({
      streetAddress: z.string().nullable(),
      city: z.string().nullable(),
      region: z.string().nullable(),
      postalCode: z.string().nullable(),
      latitude: z.string().nullable(),
      longitude: z.string().nullable(),
    })
    .nullable(),
  phoneNumber: z.string().nullable(),
  distanceMiles: z
    .number()
    .nullable()
    .describe('Straight-line distance in miles'),
  deliveryFeeCents: z.number().nullable().describe('Delivery fee in cents'),
  deliveryMinimumCents: z
    .number()
    .nullable()
    .describe('Minimum order total required for delivery, in cents'),
  deliveryTimeEstimateMinutes: z
    .number()
    .nullable()
    .describe('Single-value delivery time estimate'),
  deliveryTimeRangeMinutes: z
    .object({ lower: z.number(), upper: z.number() })
    .nullable(),
  supportsDelivery: z.boolean(),
  supportsPickup: z.boolean(),
  open: z.boolean(),
});

export const searchRestaurantsSchema = {
  name: 'searchRestaurants',
  description:
    'Search restaurants near a location. Returns names, ratings, fees, delivery estimates, and cuisines.',
  notes:
    'Present results (name + full street address) to the diner and get an explicit restaurant pick before calling getMenu or getRestaurant — do not auto-chain into the menu. Chains have multiple locations. Pagination is page-based; first page is 1.',
  input: z.object({
    latitude: z
      .number()
      .describe(
        "Diner's latitude (decimal degrees). Get from listAddresses first (diner picks a saved address); only fall back to asking the diner and geocoding in-session if they have no saved addresses or want a different location. Confirm the full address with the diner before calling. Never reuse coordinates from prior conversation or infer from a city name.",
      ),
    longitude: z
      .number()
      .describe(
        "Diner's longitude (decimal degrees). Same sourcing rules as latitude.",
      ),
    orderMethod: z
      .enum(['delivery', 'pickup'])
      .describe(
        'Fulfillment mode to filter by. REQUIRED — always confirm with the diner before calling; do not default.',
      ),
    sort: z
      .enum([
        'default',
        'distance',
        'delivery_estimate',
        'avg_rating',
        'price',
        'price_desc',
      ])
      .default('default')
      .describe('Sort order. "default" is Grubhub recommended.'),
    pageNum: z.number().default(1).describe('1-indexed page number'),
    pageSize: z.number().default(20).describe('Results per page'),
    query: z
      .string()
      .optional()
      .describe('Free-text query to narrow results (optional)'),
  }),
  output: z.object({
    results: z.array(SearchRestaurantResult),
    totalResults: z.number(),
    currentPage: z.number(),
    totalPages: z.number(),
  }),
};
export type SearchRestaurantsInput = z.infer<
  typeof searchRestaurantsSchema.input
>;
export type SearchRestaurantsOutput = z.infer<
  typeof searchRestaurantsSchema.output
>;

// ============================================================================
// getRestaurant
// ============================================================================

export const getRestaurantSchema = {
  name: 'getRestaurant',
  description:
    "Get a restaurant's profile: address, cuisines, rating, fees, hours, tipping defaults.",
  notes: '',
  input: z.object({
    restaurantId: z.string().describe('Numeric restaurant ID'),
    latitude: z
      .number()
      .describe('Diner latitude for fee / availability calculation'),
    longitude: z.number().describe('Diner longitude'),
    orderMethod: z
      .enum(['delivery', 'pickup'])
      .describe(
        'Fulfillment mode. REQUIRED — always confirm with the diner before calling; do not default.',
      ),
  }),
  output: z.object({
    restaurantId: z.string(),
    name: z.string(),
    address: z
      .object({
        streetAddress: z.string().nullable(),
        city: z.string().nullable(),
        region: z.string().nullable(),
        postalCode: z.string().nullable(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
      })
      .nullable(),
    cuisines: z.array(z.string()),
    priceRating: z.number().nullable(),
    rating: z.object({ count: z.number(), average: z.number() }).nullable(),
    logoUrl: z.string().nullable(),
    deliveryFeeCents: z.number().nullable(),
    orderMinimumCents: z.number().nullable(),
    salesTaxRate: z
      .number()
      .nullable()
      .describe('Sales tax as a percentage (e.g. 11.3 means 11.3%)'),
    deliveryEstimateMinutes: z.number().nullable(),
    pickupEstimateMinutes: z.number().nullable(),
    supportsOnlineOrdering: z.boolean(),
    supportsPickup: z.boolean(),
    currentlyOpen: z.boolean(),
    openForDelivery: z.boolean(),
    openForPickup: z.boolean(),
    defaultTipPercent: z.number().nullable(),
    minimumTipPercent: z.number().nullable(),
    phoneNumber: z.string().nullable(),
  }),
};
export type GetRestaurantInput = z.infer<typeof getRestaurantSchema.input>;
export type GetRestaurantOutput = z.infer<typeof getRestaurantSchema.output>;

// ============================================================================
// getMenu
// ============================================================================

const MenuItemSummary = z.object({
  menuItemId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().nullable(),
  priceDisplay: z.string().nullable(),
  available: z.boolean(),
  popular: z.boolean(),
  hasCustomizations: z
    .boolean()
    .describe(
      'True when the item has required or optional choice categories. Call getMenuItem to see them.',
    ),
  imageUrl: z.string().nullable(),
});

const MenuCategory = z.object({
  categoryId: z.string().nullable(),
  name: z.string(),
  items: z.array(MenuItemSummary),
});

export const getMenuSchema = {
  name: 'getMenu',
  description:
    "Get a restaurant's menu organized by category. Returns item summaries; call getMenuItem for modifiers/options.",
  notes:
    'Menu structure depends on the restaurant. If a category has many items or this returns empty, the UI may lazy-load items via getMenuItem. Use popular items and categories as entry points.',
  input: z.object({
    restaurantId: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    orderMethod: z
      .enum(['delivery', 'pickup'])
      .describe(
        'Fulfillment mode. REQUIRED — always confirm with the diner before calling; do not default.',
      ),
  }),
  output: z.object({
    restaurantId: z.string(),
    restaurantName: z.string(),
    categories: z.array(MenuCategory),
    flatItems: z
      .array(MenuItemSummary)
      .describe(
        'All menu items flattened (convenience; same items as in `categories`).',
      ),
  }),
};
export type GetMenuInput = z.infer<typeof getMenuSchema.input>;
export type GetMenuOutput = z.infer<typeof getMenuSchema.output>;

// ============================================================================
// getMenuItem
// ============================================================================

type ChoiceOptionShape = {
  optionId: string;
  name: string;
  priceCents: number;
  priceDisplay: string | null;
  tagList: string[];
  childCategories: ChoiceCategoryShape[];
};

type ChoiceCategoryShape = {
  choiceCategoryId: string;
  name: string;
  minChoices: number;
  maxChoices: number;
  options: ChoiceOptionShape[];
};

const ChoiceOption: z.ZodType<ChoiceOptionShape> = z.lazy(() =>
  z.object({
    optionId: z
      .string()
      .describe(
        'Option ID. Pass this as `optionId` in addToCart.options[] to include this choice.',
      ),
    name: z.string(),
    priceCents: z.number(),
    priceDisplay: z.string().nullable(),
    tagList: z.array(z.string()),
    childCategories: z
      .array(ChoiceCategory)
      .describe(
        'Nested choice categories that become selectable when this option is chosen (e.g. picking "Chicken Bowl" reveals Rice, Beans, and Toppings categories). Empty if this is a leaf option. Walk each nested category the same way as top-level ones and pass selections via `childOptions` in addToCart.',
      ),
  }),
);

const ChoiceCategory: z.ZodType<ChoiceCategoryShape> = z.lazy(() =>
  z.object({
    choiceCategoryId: z.string(),
    name: z.string(),
    minChoices: z
      .number()
      .describe(
        'Minimum number of options the diner must pick (0 = optional category)',
      ),
    maxChoices: z
      .number()
      .describe('Maximum number of options the diner may pick'),
    options: z.array(ChoiceOption),
  }),
);

export const getMenuItemSchema = {
  name: 'getMenuItem',
  description:
    'Get full detail for a single menu item including customization/modifier groups (choice categories).',
  notes:
    "Use choice_category_list entries to build the `options` array for addToCart. Required categories have minChoices >= 1; collect the diner's selections from options[].optionId.",
  input: z.object({
    restaurantId: z.string(),
    menuItemId: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    orderMethod: z
      .enum(['delivery', 'pickup'])
      .describe(
        'Fulfillment mode. REQUIRED — always confirm with the diner before calling; do not default.',
      ),
  }),
  output: z.object({
    menuItemId: z.string(),
    restaurantId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    priceCents: z.number(),
    priceDisplay: z.string().nullable(),
    minPriceCents: z.number().nullable(),
    maxPriceCents: z.number().nullable(),
    available: z.boolean(),
    popular: z.boolean(),
    categoryId: z.string().nullable(),
    categoryName: z.string().nullable(),
    imageUrl: z.string().nullable(),
    choiceCategories: z.array(ChoiceCategory),
  }),
};
export type GetMenuItemInput = z.infer<typeof getMenuItemSchema.input>;
export type GetMenuItemOutput = z.infer<typeof getMenuItemSchema.output>;

// ============================================================================
// getRestaurantReviews
// ============================================================================

const Review = z.object({
  reviewId: z.string().nullable(),
  rating: z.number().nullable(),
  reviewText: z.string().nullable(),
  dinerName: z.string().nullable(),
  reviewedAt: z.string().nullable().describe('ISO timestamp'),
});

export const getRestaurantReviewsSchema = {
  name: 'getRestaurantReviews',
  description: 'Get paginated customer reviews for a restaurant.',
  notes: '',
  input: z.object({
    restaurantId: z.string(),
    pageNum: z.number().default(1),
    pageSize: z.number().default(20),
  }),
  output: z.object({
    reviews: z.array(Review),
    totalReviews: z.number(),
    currentPage: z.number(),
    totalPages: z.number(),
  }),
};
export type GetRestaurantReviewsInput = z.infer<
  typeof getRestaurantReviewsSchema.input
>;
export type GetRestaurantReviewsOutput = z.infer<
  typeof getRestaurantReviewsSchema.output
>;

// ============================================================================
// listFavorites
// ============================================================================

export const listFavoritesSchema = {
  name: 'listFavorites',
  description: "Get the diner's favorited restaurants.",
  notes: '',
  input: z.object({
    dinerId: z.string().describe('From getContext().dinerId'),
  }),
  output: z.object({
    favorites: z.array(
      z.object({
        restaurantId: z.string(),
        name: z.string().nullable(),
        logoUrl: z.string().nullable(),
      }),
    ),
  }),
};
export type ListFavoritesInput = z.infer<typeof listFavoritesSchema.input>;
export type ListFavoritesOutput = z.infer<typeof listFavoritesSchema.output>;

// ============================================================================
// listAddresses
// ============================================================================

const Address = z.object({
  addressId: z.string(),
  label: z.string().nullable().describe('Label like "Home", "Work"'),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  phone: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  pickupInstructions: z.string().nullable(),
});

export const listAddressesSchema = {
  name: 'listAddresses',
  description: "Get the diner's saved delivery addresses.",
  notes: '',
  input: z.object({
    dinerId: z.string().describe('From getContext().dinerId'),
  }),
  output: z.object({
    addresses: z.array(Address),
  }),
};
export type ListAddressesInput = z.infer<typeof listAddressesSchema.input>;
export type ListAddressesOutput = z.infer<typeof listAddressesSchema.output>;

// ============================================================================
// getHomeAddress
// ============================================================================

export const getHomeAddressSchema = {
  name: 'getHomeAddress',
  description:
    'Get the diner\'s home address — the saved address labeled "home". Returns latitude/longitude as decimals ready to pass directly to searchRestaurants.',
  notes:
    'Throws if the diner has no address labeled "home". Match is case-insensitive on the label.',
  input: z.object({
    dinerId: z.string().describe('From getContext().dinerId'),
  }),
  output: z.object({
    addressId: z.string(),
    label: z.string(),
    streetAddress: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
    phone: z.string().nullable(),
    latitude: z
      .number()
      .describe('Decimal degrees. Pass directly to searchRestaurants.'),
    longitude: z
      .number()
      .describe('Decimal degrees. Pass directly to searchRestaurants.'),
  }),
};
export type GetHomeAddressInput = z.infer<typeof getHomeAddressSchema.input>;
export type GetHomeAddressOutput = z.infer<typeof getHomeAddressSchema.output>;

// ============================================================================
// Carts
// ============================================================================

type CartLineOptionShape = {
  optionId: string;
  name: string;
  priceCents: number;
  quantity: number;
  childOptions: CartLineOptionShape[];
};

const CartLineOption: z.ZodType<CartLineOptionShape> = z.lazy(() =>
  z.object({
    optionId: z.string(),
    name: z.string(),
    priceCents: z.number(),
    quantity: z.number(),
    childOptions: z
      .array(CartLineOption)
      .describe(
        'Nested selections under this option (e.g. rice/beans/toppings picked for a bowl filling). Empty for leaf options.',
      ),
  }),
);

const CartLine = z.object({
  cartLineId: z.string(),
  menuItemId: z.string(),
  name: z.string(),
  quantity: z.number(),
  specialInstructions: z.string().describe('Empty string if none.'),
  lineTotalCents: z
    .number()
    .describe('Total cents for this line (price × quantity incl. options)'),
  options: z.array(CartLineOption),
});

const CartSummary = z.object({
  cartId: z.string(),
  state: z
    .string()
    .describe('Cart state: "ACTIVE", "READY_FOR_CHECKOUT", etc.'),
  fulfillmentType: z
    .string()
    .describe(
      'Current fulfillment: "DELIVERY", "PICKUP", "INCOMPLETE_DELIVERY", "INCOMPLETE_PICKUP", or empty',
    ),
  restaurantIds: z.array(z.string()),
  subtotalCents: z.number().nullable(),
  totalCents: z
    .number()
    .nullable()
    .describe(
      'Total charges including fees + tax. Null until bill is computed.',
    ),
  lines: z.array(CartLine),
  currency: z.string(),
});

export const createCartSchema = {
  name: 'createCart',
  description:
    "Start a fresh cart: delete every existing active cart for the diner, POST a new one, and record it as the conversation's primary cart. Use when the diner wants to start over. To continue from an existing cart surfaced by listCarts, use adoptCart instead.",
  notes:
    'Destructive: purges every active cart before creating the new one. Confirm with the diner first if listCarts returned non-empty carts. The returned cartId is the primary for the rest of the conversation; all mutating functions must receive it.',
  input: z.object({}),
  output: z.object({
    cartId: z
      .string()
      .describe("The new cart's id. This is now the primary cart."),
  }),
};
export type CreateCartInput = z.infer<typeof createCartSchema.input>;
export type CreateCartOutput = z.infer<typeof createCartSchema.output>;

export const adoptCartSchema = {
  name: 'adoptCart',
  description:
    "Continue from an existing cart: record the given cartId as the conversation's primary cart and delete every other active cart. Use after listCarts surfaces a bag the diner wants to keep.",
  notes:
    'The cartId must appear in listCarts. All other active carts are deleted. Subsequent cart functions must receive the adopted cartId.',
  input: z.object({
    cartId: z
      .string()
      .describe('Cart to adopt as primary. Must come from listCarts.'),
  }),
  output: z.object({
    cartId: z.string().describe("The adopted cart's id. Now the primary cart."),
  }),
};
export type AdoptCartInput = z.infer<typeof adoptCartSchema.input>;
export type AdoptCartOutput = z.infer<typeof adoptCartSchema.output>;

const ListCartsCartSummary = z.object({
  cartId: z.string(),
  isPrimary: z
    .boolean()
    .describe(
      "True if this cart is the conversation's primary. Only one cart is primary at a time; primary is set by createCart or adoptCart and cleared on successful placeOrder.",
    ),
  state: z
    .string()
    .describe(
      'Cart state: "ACTIVE", "READY_FOR_CHECKOUT", etc. Empty string if unknown.',
    ),
  fulfillmentType: z
    .string()
    .describe(
      'Current fulfillment: "DELIVERY", "PICKUP", "INCOMPLETE_DELIVERY", "INCOMPLETE_PICKUP", or empty.',
    ),
  restaurantIds: z.array(z.string()),
  lineCount: z.number().describe('Number of line items in the cart.'),
  subtotalCents: z
    .number()
    .nullable()
    .describe('Subtotal in cents. Null until bill is computed.'),
});

export const listCartsSchema = {
  name: 'listCarts',
  description:
    "List the diner's active (un-submitted) carts with enough detail to present to the diner (restaurants, line count, subtotal). Call before the first cart mutation in a conversation to decide between adoptCart (continue) and createCart (start fresh).",
  notes:
    'Safe to call any time. Also used internally by mutating functions to verify the primary-cart invariant; if extras appear mid-flow they are purged automatically.',
  input: z.object({}),
  output: z.object({
    carts: z.array(ListCartsCartSummary),
  }),
};
export type ListCartsInput = z.infer<typeof listCartsSchema.input>;
export type ListCartsOutput = z.infer<typeof listCartsSchema.output>;

export const getCartSchema = {
  name: 'getCart',
  description:
    'Read the current state of a cart (contents, fulfillment type, state).',
  notes:
    'For fees, taxes, and total, call getCheckoutSummary instead — those values are null on the bare cart until the bill is computed.',
  input: z.object({
    cartId: z.string(),
  }),
  output: CartSummary,
};
export type GetCartInput = z.infer<typeof getCartSchema.input>;
export type GetCartOutput = z.infer<typeof getCartSchema.output>;

export const setDeliveryLocationSchema = {
  name: 'setDeliveryLocation',
  description:
    'Set the preliminary delivery location (lat/lng only) for a cart. Use early in the flow when the diner has only picked a restaurant but not yet confirmed a full address.',
  notes:
    'This writes "incomplete" delivery info (coordinates only). Before placeOrder, finalize with setDeliveryInfo to attach the full street address + contact info — without setDeliveryInfo the bill will not reach READY_FOR_CHECKOUT.',
  input: z.object({
    cartId: z.string(),
    latitude: z.number(),
    longitude: z.number(),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type SetDeliveryLocationInput = z.infer<
  typeof setDeliveryLocationSchema.input
>;
export type SetDeliveryLocationOutput = z.infer<
  typeof setDeliveryLocationSchema.output
>;

export const setPickupLocationSchema = {
  name: 'setPickupLocation',
  description:
    "Set the pickup location reference (diner's geo) for a cart. Use for pickup orders before checkout.",
  notes: '',
  input: z.object({
    cartId: z.string(),
    latitude: z.number(),
    longitude: z.number(),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type SetPickupLocationInput = z.infer<
  typeof setPickupLocationSchema.input
>;
export type SetPickupLocationOutput = z.infer<
  typeof setPickupLocationSchema.output
>;

export const setPickupInfoSchema = {
  name: 'setPickupInfo',
  description:
    'Set the pickup contact info (name, email, phone) on a cart. Required before a pickup order can be checked out.',
  notes:
    'greenIndicated=true opts out of utensils/plasticware ("green" option). pickupInstructions is an optional note to the restaurant.',
  input: z.object({
    cartId: z.string(),
    name: z.string().describe('Contact name to give to the restaurant'),
    email: z.string(),
    phone: z.string().describe('Phone in (###) ###-#### or equivalent'),
    greenIndicated: z.boolean().default(false),
    pickupInstructions: z.string().nullable().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type SetPickupInfoInput = z.infer<typeof setPickupInfoSchema.input>;
export type SetPickupInfoOutput = z.infer<typeof setPickupInfoSchema.output>;

export const setDeliveryInfoSchema = {
  name: 'setDeliveryInfo',
  description:
    'Finalize delivery details on a cart: full street address, coordinates, contact info (name/email/phone), and delivery speed. Required before a delivery order can be checked out — the delivery counterpart to setPickupInfo.',
  notes:
    'Required before placeOrder for delivery carts; without it the bill will not reach READY_FOR_CHECKOUT. Address fields typically come from listAddresses (use the diner\'s picked saved address). deliveryEtaType: "STANDARD_DELIVERY" is the default free tier; "PRIORITY_DELIVERY" is a paid faster tier (its fee appears in getCheckoutSummary.ordering_info.real_time_eta.eta_options). greenIndicated=true opts out of utensils. deliveryInstructions is an optional note to the courier ("leave at door", etc.).',
  input: z.object({
    cartId: z.string(),
    streetAddress: z
      .string()
      .describe(
        'Street address line, e.g. "6200 Heather Dr". Comes from listAddresses.addressLine1.',
      ),
    city: z.string().describe('Locality, e.g. "Blacksburg"'),
    state: z.string().describe('Administrative area / state code, e.g. "VA"'),
    postalCode: z.string().describe('ZIP or postal code, e.g. "24060"'),
    country: z
      .string()
      .default('US')
      .describe('Region code. Defaults to "US".'),
    latitude: z.number().describe('Decimal degrees'),
    longitude: z.number().describe('Decimal degrees'),
    crossStreets: z
      .string()
      .nullable()
      .optional()
      .describe('Cross-street note, rarely populated. Defaults to empty.'),
    name: z.string().describe('Contact name to give to the courier/restaurant'),
    email: z.string(),
    phone: z.string().describe('Phone in (###) ###-#### or equivalent'),
    greenIndicated: z
      .boolean()
      .default(false)
      .describe('True = opt out of utensils/plasticware ("green" option).'),
    deliveryEtaType: z
      .enum(['STANDARD_DELIVERY', 'PRIORITY_DELIVERY'])
      .default('STANDARD_DELIVERY')
      .describe(
        'Delivery speed tier. "PRIORITY_DELIVERY" adds a surcharge; confirm with the diner before picking non-default.',
      ),
    deliveryInstructions: z
      .string()
      .nullable()
      .optional()
      .describe('Optional note to the courier (e.g. "leave at door").'),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type SetDeliveryInfoInput = z.infer<typeof setDeliveryInfoSchema.input>;
export type SetDeliveryInfoOutput = z.infer<
  typeof setDeliveryInfoSchema.output
>;

export const setCartTipSchema = {
  name: 'setCartTip',
  description:
    'Set the tip on a cart. Amount is in integer cents. Updates getCheckoutSummary.tipCents.',
  notes:
    'Confirm the tip amount with the diner before calling. Default type "INCLUDE_IN_BILL" charges the tip as part of the order total (the normal case for web checkout).',
  input: z.object({
    cartId: z.string(),
    amountCents: z
      .number()
      .describe(
        'Tip amount in integer cents (e.g. 154 = $1.54). Pass 0 to clear.',
      ),
    type: z
      .enum(['INCLUDE_IN_BILL', 'CASH'])
      .default('INCLUDE_IN_BILL')
      .describe(
        '"INCLUDE_IN_BILL" charges the tip through the attached payment method. "CASH" indicates tip-in-cash-at-pickup (pickup only).',
      ),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type SetCartTipInput = z.infer<typeof setCartTipSchema.input>;
export type SetCartTipOutput = z.infer<typeof setCartTipSchema.output>;

export const listDeliveryTimesSchema = {
  name: 'listDeliveryTimes',
  description:
    "Get the available scheduled delivery (or pickup) time slots for a restaurant at a given location. Returns slots grouped by date, in the restaurant's local time zone.",
  notes:
    'Only needed for scheduled orders. ASAP delivery does not require this call. `timeZone` is the restaurant\'s IANA zone (e.g. "America/New_York") — source it from getRestaurant if you don\'t already have it. `endDateTime` caps the window (typically end-of-day a few days out). Slots are presented in LOCAL time without a UTC offset; convert using `timeZone` before displaying to the diner.',
  input: z.object({
    restaurantId: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    orderMethod: z
      .enum(['delivery', 'pickup'])
      .describe(
        'Which set of slots to return; matches the cart fulfillment mode.',
      ),
    timeZone: z
      .string()
      .describe('IANA timezone of the restaurant, e.g. "America/New_York".'),
    endDateTime: z
      .string()
      .describe(
        'ISO timestamp in UTC capping the time window (e.g. end of day 3 days from now).',
      ),
    intervalMinutes: z
      .number()
      .default(15)
      .describe('Granularity of returned slots in minutes.'),
    orderSizeUsd: z
      .number()
      .default(0)
      .describe(
        'Cart subtotal in dollars. Used by backend for ETA calibration; 0 is acceptable.',
      ),
  }),
  output: z.object({
    timeZone: z.string(),
    days: z.array(
      z.object({
        date: z
          .string()
          .describe("YYYY-MM-DD in the restaurant's local time zone"),
        slots: z.array(
          z.object({
            hour: z.number().describe('0-23, local time'),
            minute: z.number().describe('0, 15, 30, 45 typically'),
            localTime: z
              .string()
              .describe(
                'Combined "YYYY-MM-DDTHH:MM:00" local-time string (no offset).',
              ),
            dst: z
              .boolean()
              .describe('True if daylight saving is in effect on this slot.'),
          }),
        ),
      }),
    ),
  }),
};
export type ListDeliveryTimesInput = z.infer<
  typeof listDeliveryTimesSchema.input
>;
export type ListDeliveryTimesOutput = z.infer<
  typeof listDeliveryTimesSchema.output
>;

// ============================================================================
// Order Contact Info (name / phone)
// ============================================================================

const OrderContact = z.object({
  name: z.string().describe('Contact name on the cart'),
  phone: z.string().describe('Contact phone on the cart'),
  email: z.string().describe('Contact email on the cart'),
});

export const getOrderContactSchema = {
  name: 'getOrderContact',
  description:
    'Read the current contact info (name, phone, email) attached to a cart. Works for both pickup and delivery carts. Call before placeOrder so the diner can confirm or edit.',
  notes:
    'Throws if contact info has not been set yet: call setPickupInfo (pickup) or setDeliveryInfo (delivery) first.',
  input: z.object({
    cartId: z.string(),
  }),
  output: OrderContact,
};
export type GetOrderContactInput = z.infer<typeof getOrderContactSchema.input>;
export type GetOrderContactOutput = z.infer<
  typeof getOrderContactSchema.output
>;

export const setOrderContactNameSchema = {
  name: 'setOrderContactName',
  description:
    'Update the contact name on a cart (pickup or delivery). Preserves the rest of the cart contact state (phone, email, instructions, green-indicated, and — for delivery — address and ETA tier).',
  notes:
    'Requires contact info to already exist on the cart (call setPickupInfo or setDeliveryInfo first on a new cart).',
  input: z.object({
    cartId: z.string(),
    name: z.string().describe('New contact name to give to the restaurant'),
  }),
  output: OrderContact,
};
export type SetOrderContactNameInput = z.infer<
  typeof setOrderContactNameSchema.input
>;
export type SetOrderContactNameOutput = z.infer<
  typeof setOrderContactNameSchema.output
>;

export const setOrderContactPhoneSchema = {
  name: 'setOrderContactPhone',
  description:
    'Update the contact phone on a cart (pickup or delivery). Preserves the rest of the cart contact state (name, email, instructions, green-indicated, and — for delivery — address and ETA tier).',
  notes:
    'Requires contact info to already exist on the cart (call setPickupInfo or setDeliveryInfo first on a new cart). Accepts any string the restaurant/courier will dial; prefer "(###) ###-####".',
  input: z.object({
    cartId: z.string(),
    phone: z.string().describe('New contact phone number'),
  }),
  output: OrderContact,
};
export type SetOrderContactPhoneInput = z.infer<
  typeof setOrderContactPhoneSchema.input
>;
export type SetOrderContactPhoneOutput = z.infer<
  typeof setOrderContactPhoneSchema.output
>;

type AddToCartOptionShape = {
  optionId: string;
  quantity?: number;
  childOptions?: AddToCartOptionShape[];
};

const AddToCartOption: z.ZodType<AddToCartOptionShape> = z.lazy(() =>
  z.object({
    optionId: z
      .string()
      .describe(
        'Numeric option ID from getMenuItem.choiceCategories[].options[].optionId',
      ),
    quantity: z.number().default(1),
    childOptions: z
      .array(AddToCartOption)
      .default([])
      .describe(
        "Nested selections for this option. Mirror the tree from getMenuItem: if the picked option has non-empty `childCategories`, walk each nested category and add the diner's picks here. Leaf options use an empty array.",
      ),
  }),
);

export const addToCartSchema = {
  name: 'addToCart',
  description:
    'Add a menu item to a cart with optional customizations (modifier options).',
  notes:
    'Call getMenuItem first and walk the diner through EVERY choice category — required (minChoices >= 1) AND optional (minChoices: 0). Do not silently skip optional categories or assume defaults. The only exception is when the diner has explicitly said to skip options for this order. Options come from getMenuItem.choiceCategories[].options[].optionId. When a picked option has non-empty `childCategories` (e.g. a "Chicken Bowl" filling that has Rice / Beans / Toppings underneath), walk those nested categories the same way and pass the diner\'s picks via `childOptions` on the parent option — the tree must mirror the menu, not be flattened. Each cart belongs to a single restaurant. The server prices the line; no client-side total is needed. To read the updated bag (subtotal, tax, total) after adding, call getCart. Idempotent: if a line with the same menuItemId, full option tree, and specialInstructions already exists in the cart, returns that existing line with alreadyExists=true instead of duplicating. To order multiple of an item, use quantity rather than multiple addToCart calls.',
  input: z.object({
    cartId: z.string(),
    restaurantId: z.string(),
    menuItemId: z.string(),
    quantity: z.number().default(1),
    options: z
      .array(AddToCartOption)
      .default([])
      .describe(
        'Selected modifier options (required and optional). Recursive: each option may carry its own `childOptions` to represent nested choice categories (e.g. filling → rice/beans/toppings).',
      ),
    specialInstructions: z.string().optional(),
  }),
  output: z.object({
    cartLineId: z.string(),
    alreadyExists: z.boolean(),
  }),
};
export type AddToCartInput = z.infer<typeof addToCartSchema.input>;
export type AddToCartOutput = z.infer<typeof addToCartSchema.output>;

export const syncCartUISchema = {
  name: 'syncCartUI',
  description:
    'Reload the current Grubhub page so the web UI picks up a cart created via the library. On page load the SPA calls GET /carts and binds whatever active cart it finds; this function triggers that path by reloading.',
  notes:
    "If the cart's fulfillment is still INCOMPLETE_PICKUP or INCOMPLETE_DELIVERY, the UI bag may still display empty until you call setPickupInfo (for pickup) or finalize a delivery address. Navigate the user to the restaurant's page before or after this call so the page-level cart view matches.",
  input: z.object({
    cartId: z
      .string()
      .describe(
        'The cartId to verify before reloading. Fetched to confirm the server still has it active.',
      ),
  }),
  output: z.object({
    cartId: z.string(),
    restaurantId: z.string().nullable(),
    reloaded: z.boolean(),
  }),
};
export type SyncCartUIInput = z.infer<typeof syncCartUISchema.input>;
export type SyncCartUIOutput = z.infer<typeof syncCartUISchema.output>;

export const deleteCartSchema = {
  name: 'deleteCart',
  description:
    'Delete an entire cart. Rarely needed in normal flow — createCart and adoptCart already clean up other carts automatically. Use only when you need to abandon the primary cart without starting a new one.',
  notes:
    "Irreversible. Does not affect submitted orders; only deletes active (un-submitted) carts. If the deleted cart is the primary, the conversation's primary is cleared; the next cart mutation will require a fresh createCart or adoptCart.",
  input: z.object({
    cartId: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type DeleteCartInput = z.infer<typeof deleteCartSchema.input>;
export type DeleteCartOutput = z.infer<typeof deleteCartSchema.output>;

export const removeFromCartSchema = {
  name: 'removeFromCart',
  description: 'Remove a line item from a cart.',
  notes: '',
  input: z.object({
    cartId: z.string(),
    cartLineId: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type RemoveFromCartInput = z.infer<typeof removeFromCartSchema.input>;
export type RemoveFromCartOutput = z.infer<typeof removeFromCartSchema.output>;

// ============================================================================
// Checkout
// ============================================================================

const PaymentMethod = z.object({
  paymentMethodId: z.string(),
  type: z
    .enum([
      'CREDIT_CARD',
      'PAYPAL',
      'VENMO',
      'AMAZON_PAY',
      'CASH_APP',
      'AMEX_EXPRESS',
    ])
    .describe('Payment method type'),
  brand: z
    .string()
    .nullable()
    .describe(
      'Credit card brand (Visa, MasterCard, etc.) or null for non-cards',
    ),
  last4: z.string().nullable(),
  expiration: z
    .object({
      month: z.number(),
      year: z.number(),
      expired: z.boolean(),
    })
    .nullable(),
  zipCode: z.string().nullable(),
});

export const listPaymentMethodsSchema = {
  name: 'listPaymentMethods',
  description:
    "Get the diner's saved payment methods (credit cards, PayPal, Venmo, Amazon Pay, Cash App).",
  notes: '',
  input: z.object({
    dinerId: z.string().describe('From getContext().dinerId'),
  }),
  output: z.object({
    paymentMethods: z.array(PaymentMethod),
  }),
};
export type ListPaymentMethodsInput = z.infer<
  typeof listPaymentMethodsSchema.input
>;
export type ListPaymentMethodsOutput = z.infer<
  typeof listPaymentMethodsSchema.output
>;

export const attachPaymentToCartSchema = {
  name: 'attachPaymentToCart',
  description:
    'Attach a saved payment method to a cart in preparation for checkout.',
  notes:
    'Required before placeOrder. For carts with a zero total (e.g., fully covered by credits), this may still be required. If the first order on a card, the subsequent placeOrder will trigger 3D Secure.',
  input: z.object({
    cartId: z.string(),
    paymentMethodId: z.string().describe('From listPaymentMethods'),
    type: z
      .enum([
        'CREDIT_CARD',
        'PAYPAL',
        'VENMO',
        'AMAZON_PAY',
        'CASH_APP',
        'AMEX_EXPRESS',
      ])
      .default('CREDIT_CARD'),
  }),
  output: z.object({
    cartPaymentId: z.string(),
  }),
};
export type AttachPaymentToCartInput = z.infer<
  typeof attachPaymentToCartSchema.input
>;
export type AttachPaymentToCartOutput = z.infer<
  typeof attachPaymentToCartSchema.output
>;

const BillLine = z.object({
  cartLineId: z.string(),
  menuItemId: z.string(),
  name: z.string(),
  quantity: z.number(),
  dinerTotalCents: z.number(),
  options: z.array(CartLineOption),
});

export const getCheckoutSummarySchema = {
  name: 'getCheckoutSummary',
  description:
    'Fetch the computed bill for a cart (subtotal, fees, taxes, tip, total) and the checkout token required by placeOrder.',
  notes:
    'Returns state: "READY_FOR_CHECKOUT" when submittable. If validationErrors is non-empty, placeOrder will fail; fix before calling. The checkoutToken is short-lived; call this immediately before placeOrder.',
  input: z.object({
    cartId: z.string(),
  }),
  output: z.object({
    cartId: z.string(),
    state: z.string(),
    checkoutToken: z
      .string()
      .nullable()
      .describe(
        'Opaque token required by placeOrder. Null if the cart is not ready.',
      ),
    readyForCheckout: z.boolean(),
    subtotalCents: z.number().nullable(),
    totalCents: z.number().nullable(),
    taxTotalCents: z.number().nullable(),
    tipCents: z.number().nullable(),
    creditsAppliedCents: z.number().nullable(),
    lines: z.array(BillLine),
    validationErrors: z.array(
      z.object({ code: z.string().nullable(), message: z.string().nullable() }),
    ),
    currency: z.string(),
  }),
};
export type GetCheckoutSummaryInput = z.infer<
  typeof getCheckoutSummarySchema.input
>;
export type GetCheckoutSummaryOutput = z.infer<
  typeof getCheckoutSummarySchema.output
>;

export const placeOrderSchema = {
  name: 'placeOrder',
  description:
    'Submit a cart and charge the attached payment method. Places a real order with the restaurant.',
  notes:
    '**Charges real money.** Required prerequisites: addToCart has been called; pickup carts have setPickupLocation + setPickupInfo; delivery carts have setDeliveryLocation + setDeliveryInfo; a payment method is attached (attachPaymentToCart); and getCheckoutSummary has returned state: "READY_FOR_CHECKOUT" with a checkoutToken. If the payment card has never been 3DS-verified, this throws with a "3DS verification required" message; the diner must complete the challenge in the browser once, then retry.',
  input: z.object({
    cartId: z.string(),
    checkoutToken: z
      .string()
      .describe(
        'From getCheckoutSummary().checkoutToken — fetch fresh immediately before calling',
      ),
  }),
  output: z.object({
    cartId: z.string(),
    orderUuid: z
      .string()
      .nullable()
      .describe(
        'UUID of the submitted order. May be null immediately after checkout; call getOrder with the cartId to resolve.',
      ),
    submitted: z.boolean(),
    fulfillmentType: z.string().describe('"PICKUP" or "DELIVERY"'),
    estimatedReadyAt: z.string().nullable().describe('ISO timestamp'),
  }),
};
export type PlaceOrderInput = z.infer<typeof placeOrderSchema.input>;
export type PlaceOrderOutput = z.infer<typeof placeOrderSchema.output>;

// ============================================================================
// Orders
// ============================================================================

const OrderLineItem = z.object({
  menuItemId: z.string(),
  name: z.string(),
  quantity: z.number(),
  dinerTotalCents: z.number(),
  options: z.array(CartLineOption),
});

export const getOrderSchema = {
  name: 'getOrder',
  description:
    'Get full detail for a submitted order (items, fees, restaurant info). Accepts either a cartId or an orderUuid.',
  notes:
    'Useful immediately after placeOrder to resolve the orderUuid (pass the cartId and read result.orderUuid).',
  input: z.object({
    dinerId: z.string().describe('From getContext().dinerId'),
    cartIdOrOrderUuid: z
      .string()
      .describe(
        'Either the cartId from placeOrder or the orderUuid once known',
      ),
  }),
  output: z.object({
    orderUuid: z.string(),
    timePlaced: z.string().nullable().describe('ISO timestamp'),
    whenFor: z
      .string()
      .nullable()
      .describe('ISO timestamp of estimated/scheduled fulfillment time'),
    fulfillmentType: z.string(),
    totalCents: z.number().nullable(),
    subtotalCents: z.number().nullable(),
    tipCents: z.number().nullable(),
    items: z.array(OrderLineItem),
    restaurant: z.object({
      restaurantId: z.string().nullable(),
      name: z.string().nullable(),
    }),
  }),
};
export type GetOrderInput = z.infer<typeof getOrderSchema.input>;
export type GetOrderOutput = z.infer<typeof getOrderSchema.output>;

export const trackOrderSchema = {
  name: 'trackOrder',
  description:
    'Get live status for an in-progress order: state, ETA window, elapsed events.',
  notes:
    'For pickup orders, tracking covers restaurant preparation (ORDER_SENT → ORDER_CONFIRMED → ORDER_READY). For delivery, additional dasher/courier events appear in deliveryEvents.',
  input: z.object({
    dinerId: z.string().describe('From getContext().dinerId'),
    orderUuid: z.string().describe('From getOrder().orderUuid'),
  }),
  output: z.object({
    orderUuid: z.string(),
    state: z
      .string()
      .describe('Tracking state (e.g. "ORDER_SENT", "ORDER_CONFIRMED")'),
    fulfillmentType: z.string(),
    etaState: z.string().describe('"ON_TIME", "LATE", etc.'),
    etaStartTime: z
      .string()
      .nullable()
      .describe('ISO timestamp — earliest ready/arrival'),
    etaEndTime: z
      .string()
      .nullable()
      .describe('ISO timestamp — latest ready/arrival'),
    expectedDeliveryTime: z
      .string()
      .nullable()
      .describe('ISO timestamp — single-point estimate'),
    orderEvents: z.array(
      z.object({
        type: z.string(),
        eventTime: z.string(),
      }),
    ),
    deliveryEvents: z.array(
      z.object({
        type: z.string(),
        eventTime: z.string(),
      }),
    ),
    tipCents: z.number().nullable(),
  }),
};
export type TrackOrderInput = z.infer<typeof trackOrderSchema.input>;
export type TrackOrderOutput = z.infer<typeof trackOrderSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  searchRestaurantsSchema,
  getRestaurantSchema,
  getMenuSchema,
  getMenuItemSchema,
  getRestaurantReviewsSchema,
  listFavoritesSchema,
  listAddressesSchema,
  getHomeAddressSchema,
  createCartSchema,
  adoptCartSchema,
  listCartsSchema,
  getCartSchema,
  setDeliveryLocationSchema,
  setPickupLocationSchema,
  setPickupInfoSchema,
  setDeliveryInfoSchema,
  setCartTipSchema,
  listDeliveryTimesSchema,
  getOrderContactSchema,
  setOrderContactNameSchema,
  setOrderContactPhoneSchema,
  addToCartSchema,
  removeFromCartSchema,
  deleteCartSchema,
  syncCartUISchema,
  listPaymentMethodsSchema,
  attachPaymentToCartSchema,
  getCheckoutSummarySchema,
  placeOrderSchema,
  getOrderSchema,
  trackOrderSchema,
];
