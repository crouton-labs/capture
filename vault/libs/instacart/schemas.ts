import { z } from 'zod';

export const libraryDescription =
  'Instacart operations: list retailers, search items and prices at a specific store, add/update/remove items in carts, view carts, list past orders, list addresses, and read offers/coupons. Does not place orders (checkout flow remains manual).';

export const libraryIcon = '/icons/libs/instacart.png';
export const loginUrl = 'https://www.instacart.com/store';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://www.instacart.com/store\` and log in (Google SSO, Apple, or email).
2. Call \`getContext()\` to verify the session and get \`{ userId, email, addressId, postalCode, zoneId }\`.
3. The other functions work against the user's current delivery location (set on Instacart's side). Use \`setLocation\` to change it.

## Key Concepts

- **Retailer**: A store partner (e.g. Costco, Safeway, Target). Identified by either \`id\` (numeric string like \`"648"\`) or \`slug\` (e.g. \`"target"\`). The slug appears in store URLs: \`/store/{slug}\`.
- **Shop**: A specific retailer fulfillment offering — a (retailer × location × service-type) combination. Identified by \`shopId\` (numeric string). One retailer can have multiple shops (e.g. delivery vs pickup, store vs convenience-store warehouse).
- **Cart**: An order-in-progress for one retailer. The user can hold one cart per retailer simultaneously. Cart \`id\` is a long numeric string.
- **Order**: A submitted, billed delivery. Distinct from cart. Identified by \`orderDeliveryId\`.
- **Address ID**: Long numeric string (e.g. \`"20076937051491368"\`). Each saved address has one.
- **Postal code / Zone**: Drive availability. Many queries take \`postalCode\` and \`zoneId\`; \`getContext\` returns the current ones.

## Service Types

- \`DELIVERY\`: home delivery
- \`PICKUP\`: customer picks up at the store

Both are passed as uppercase enum strings.

## Apollo Client Backend

Internally the library calls the page's Apollo GraphQL client (\`window.__APOLLO_CLIENT__\`). Operations use Instacart's persisted-query manifest baked into the loaded JS. Some operations are lazy-loaded — they only become available after the corresponding UI route has been visited at least once in this tab. If a function throws \`"Operation X not loaded — navigate to <page> first"\`, navigate to the suggested URL and retry.

## Presenting Items to the User — Show Pictures

Every item from \`searchItems\`, \`getItem\`, and \`listCarts\` includes an \`imageUrl\`. **Use it.** When you show items to the user, render each as a Markdown image followed by name, retailer, size/details, and price — not as a plain text table. People shop with their eyes; comparing options without seeing the product is bad UX.

Default presentation for a list of items:

\`\`\`markdown
![{name}]({imageUrl})
**{name}** — {retailer or store}
{size or pack}{ • {dietary attrs} if relevant}
\`{priceString}\`{ (was {fullPriceString}) if on sale}
\`\`\`

Comparison shopping (same item across stores, or a small set of finalists) gets the same per-item card treatment in a row — never a markdown table for products with images. Use a table only when items genuinely have no image (rare) or the user explicitly asks for a compact text view.

Single-item lookups (\`getItem\`) get a single card. Long search results (>10) can be filtered down first (talk to the user about what they want) rather than dumping 30+ cards.

## Cart Mutations

Cart mutations are upsert-style: \`addToCart\` / \`updateCartItem\` set the quantity to the value passed (they do not increment from the current quantity). Each retailer has its own cart, and mutations target a retailer by slug. Adding to a retailer's cart will reuse the existing cart or create a new one transparently.

## Cart Review URL — Use the Returned \`reviewUrl\`

Every Cart returned by \`addToCart\`, \`updateCartItem\`, \`removeFromCart\`, \`clearCart\`, and \`listCarts\` includes a \`reviewUrl\` field — the canonical Instacart checkout page that lists every item with quantities and totals. Send the user THAT URL when they ask to review or approve their cart. The format is \`https://www.instacart.com/store/checkout_v4?sid={shopId}\`.

Do NOT construct cart URLs from \`cartId\` (e.g. \`/store/{slug}/carts/{cartId}\`) — that pattern returns 404. Instacart's cart UI is a side panel within the store page; there is no public cart-detail URL. The checkout page (\`reviewUrl\`) is the right place to send the user to review their cart.

## Not Supported

The library does not place orders, change addresses, or change payment methods. After the user opens \`reviewUrl\`, they confirm the order manually on Instacart.
`;

// ============================================================================
// Shared shapes
// ============================================================================

const Image = z.object({
  url: z.string().nullable(),
  altText: z.string().nullable(),
});
export type Image = z.infer<typeof Image>;

const Coordinates = z.object({
  latitude: z.number(),
  longitude: z.number(),
});
export type Coordinates = z.infer<typeof Coordinates>;

// ============================================================================
// getContext
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Verify the user is logged into Instacart and return their identity plus current delivery location. Always call this FIRST.',
  notes:
    "Throws if the user is not logged in, or if the Apollo GraphQL client has not bootstrapped on the page (most common cause: page is still loading). The returned addressId, postalCode, and zoneId reflect Instacart's current delivery target — change it on the site if needed.",
  input: z.object({}),
  output: z.object({
    userId: z.string().describe('Numeric user ID'),
    email: z.string().describe('User email'),
    firstName: z.string().describe('User first name'),
    lastName: z.string().describe('User last name (empty string if not set)'),
    guest: z
      .boolean()
      .describe(
        'Whether this is a guest session. Should be false when logged in.',
      ),
    ordersCount: z.number().describe('Total number of past orders'),
    addressId: z
      .string()
      .nullable()
      .describe('Currently-selected delivery address ID (null if none set)'),
    postalCode: z
      .string()
      .nullable()
      .describe(
        'Currently-selected postal code (drives retailer availability)',
      ),
    zoneId: z
      .string()
      .nullable()
      .describe('Currently-selected delivery zone ID'),
    coordinates: Coordinates.nullable().describe(
      'Lat/lng of the currently-selected delivery address',
    ),
    timeZone: z
      .string()
      .nullable()
      .describe('Timezone of the current zone (e.g. "America/Los_Angeles")'),
    loggedIn: z
      .boolean()
      .describe('Always true when this function returns successfully'),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// listAddresses
// ============================================================================

const Address = z.object({
  id: z.string(),
  streetAddress: z.string(),
  apartmentNumber: z.string().nullable(),
  businessName: z.string().nullable(),
  postalCode: z.string(),
  cityState: z
    .string()
    .nullable()
    .describe('"City, State" string (e.g. "San Francisco, CA")'),
  fullAddress: z
    .string()
    .nullable()
    .describe('Full display address ("Line 1, City, State Postal")'),
  coordinates: Coordinates,
  instructions: z.string().nullable().describe('Delivery instructions'),
  noOrdersAtThisAddress: z
    .boolean()
    .describe('True if the user has never received an order at this address'),
});
export type Address = z.infer<typeof Address>;

export const listAddressesSchema = {
  name: 'listAddresses',
  description: "List all of the user's saved delivery addresses.",
  notes: '',
  input: z.object({}),
  output: z.object({
    addresses: z.array(Address),
  }),
};
export type ListAddressesInput = z.infer<typeof listAddressesSchema.input>;
export type ListAddressesOutput = z.infer<typeof listAddressesSchema.output>;

// ============================================================================
// listRetailers
// ============================================================================

const Retailer = z.object({
  id: z.string().describe('Numeric retailer ID'),
  shopId: z
    .string()
    .nullable()
    .describe(
      "Numeric shop ID for the user's currently-selected service type and location. Pass to searchItems and getShopDetails.",
    ),
  name: z.string(),
  slug: z.string().describe('URL slug, e.g. "target". Use with getRetailer.'),
  logo: Image.nullable(),
  serviceType: z
    .string()
    .nullable()
    .describe('"DELIVERY" or "PICKUP" — the service type for this shop'),
  eta: z
    .string()
    .nullable()
    .describe(
      'Display ETA string (e.g. "45 min", "By 1:00pm"), null if unknown',
    ),
  deliveryFeeString: z
    .string()
    .nullable()
    .describe('Display fee string (e.g. "$3.99", "Free"), null if unknown'),
  pickupAvailable: z.boolean(),
  deliveryAvailable: z.boolean(),
});
export type Retailer = z.infer<typeof Retailer>;

export const listRetailersSchema = {
  name: 'listRetailers',
  description:
    "List the retailers available at the user's current delivery location with their ETAs and fees.",
  notes:
    "Results are scoped to the address selected on Instacart's side. To change the location, use the website to update the delivery address; this lib does not mutate state. The returned ETAs reflect what the user sees on the home page.",
  input: z.object({
    serviceType: z
      .enum(['DELIVERY', 'PICKUP'])
      .optional()
      .default('DELIVERY')
      .describe('"DELIVERY" or "PICKUP" — what kind of fulfillment to list.'),
  }),
  output: z.object({
    retailers: z.array(Retailer),
    postalCode: z.string().nullable(),
  }),
};
export type ListRetailersInput = z.infer<typeof listRetailersSchema.input>;
export type ListRetailersOutput = z.infer<typeof listRetailersSchema.output>;

// ============================================================================
// getRetailer
// ============================================================================

export const getRetailerSchema = {
  name: 'getRetailer',
  description:
    'Resolve a retailer slug (e.g. "target", "costco") to its numeric retailer ID. Use this when you have the URL slug and need the ID for other calls.',
  notes:
    'Slug appears in store URLs: https://www.instacart.com/store/{slug}. Returns the numeric retailer ID, which may be needed by other functions that expect retailerIds.',
  input: z.object({
    slug: z
      .string()
      .describe('Retailer URL slug (e.g. "target", "costco", "safeway")'),
  }),
  output: z.object({
    id: z.string().describe('Numeric retailer ID (e.g. "648" for Target)'),
    slug: z.string(),
  }),
};
export type GetRetailerInput = z.infer<typeof getRetailerSchema.input>;
export type GetRetailerOutput = z.infer<typeof getRetailerSchema.output>;

// ============================================================================
// searchAutosuggestions
// ============================================================================

const Autosuggestion = z.object({
  searchTerm: z.string().describe('Suggested search term'),
  textString: z.string(),
  isNatural: z
    .boolean()
    .describe(
      'True for organic search terms; false for "natural" sponsored suggestions',
    ),
  thumbnailUrl: z.string().nullable(),
  typeVariant: z
    .string()
    .describe(
      "Suggestion category, e.g. 'crossRetailerSearch', 'department', 'brand'",
    ),
});
export type Autosuggestion = z.infer<typeof Autosuggestion>;

export const searchAutosuggestionsSchema = {
  name: 'searchAutosuggestions',
  description:
    'Get autosuggest results for a search query across all retailers available at the current delivery address. Returns suggested search terms (not actual items).',
  notes:
    "Use this to find good search terms before driving the user to a specific retailer's product page. Empty query (or omitted query) returns the user's recent/popular suggestions.",
  input: z.object({
    query: z
      .string()
      .optional()
      .default('')
      .describe('Search query. Empty returns popular/recent suggestions.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe('Max number of suggestions to return.'),
  }),
  output: z.object({
    suggestions: z.array(Autosuggestion),
  }),
};
export type SearchAutosuggestionsInput = z.infer<
  typeof searchAutosuggestionsSchema.input
>;
export type SearchAutosuggestionsOutput = z.infer<
  typeof searchAutosuggestionsSchema.output
>;

// ============================================================================
// searchItems
// ============================================================================

const SearchItem = z.object({
  id: z
    .string()
    .describe(
      'Full item ID (e.g. "items_55-17090545"). Pass to getItem for refetching.',
    ),
  productId: z.string().describe('Numeric product ID (e.g. "17090545")'),
  name: z.string(),
  brandName: z.string().nullable(),
  size: z
    .string()
    .nullable()
    .describe('Pack size string (e.g. "12 oz", "1 lb", "10 ct")'),
  priceString: z
    .string()
    .nullable()
    .describe(
      'Display price (e.g. "$4.99", "$0.33 each (est.)"). Null if unavailable.',
    ),
  priceValue: z
    .number()
    .nullable()
    .describe(
      'Numeric price in dollars (e.g. 4.99). Null when only an estimate string is available.',
    ),
  fullPriceString: z
    .string()
    .nullable()
    .describe(
      'Display original/non-loyalty price (struck-through when there is a discount), null otherwise.',
    ),
  pricePerUnitString: z
    .string()
    .nullable()
    .describe('Unit price (e.g. "$0.62/oz"), null if not shown'),
  available: z.boolean(),
  stockLevel: z
    .string()
    .nullable()
    .describe(
      'Stock indicator ("inStock", "lowStock", "outOfStock") — verbatim from API',
    ),
  imageUrl: z
    .string()
    .nullable()
    .describe(
      'Product image URL. Render this as a Markdown image (`![name](imageUrl)`) when showing the item to the user — do not present items as a plain text table without their picture.',
    ),
  productUrl: z
    .string()
    .nullable()
    .describe(
      'Canonical product page path on instacart.com (e.g. "/store/safeway/products/items_55-X")',
    ),
  dietaryAttributes: z
    .array(z.string())
    .describe(
      'Dietary attribute labels ("Organic", "Vegan", "Gluten-free", etc.). Empty array if none.',
    ),
  promotionLabels: z
    .array(z.string())
    .describe(
      'Active promotion labels (e.g. "Save $0.50", "Buy 2 for $5"). Empty if none.',
    ),
  isSponsored: z
    .boolean()
    .describe('True if this is an ad/sponsored placement vs an organic result'),
  rating: z
    .number()
    .nullable()
    .describe('Average product rating 0–5, null if not rated'),
});
export type SearchItem = z.infer<typeof SearchItem>;

export const searchItemsSchema = {
  name: 'searchItems',
  description:
    'Search for items at a specific retailer by free-text query. Returns matching products with prices, sizes, brands, and availability.',
  notes:
    'Searches the retailer the user is currently allowed to shop (depends on their delivery address). Results are sorted by best match by default. Use orderBy to sort by price. Sponsored placements are mixed in but flagged via isSponsored=true.',
  input: z.object({
    retailerSlug: z
      .string()
      .describe(
        'Retailer URL slug (e.g. "safeway", "costco", "target"). See listRetailers for available retailers at the user\'s location.',
      ),
    query: z
      .string()
      .min(1)
      .describe(
        'Search query (e.g. "oat milk", "ben & jerry\'s", "organic apples")',
      ),
    orderBy: z
      .enum([
        'bestMatch',
        'priceAsc',
        'priceDesc',
        'unitPriceAsc',
        'unitPriceDesc',
      ])
      .optional()
      .default('bestMatch')
      .describe('Sort order. Default "bestMatch".'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(30)
      .describe('Max number of items to return (1-100). Default 30.'),
    serviceType: z
      .enum(['DELIVERY', 'PICKUP'])
      .optional()
      .default('DELIVERY')
      .describe(
        '"DELIVERY" or "PICKUP" — selects the shop variant for the retailer.',
      ),
  }),
  output: z.object({
    items: z.array(SearchItem),
    query: z.string(),
    retailerSlug: z.string(),
    shopId: z.string(),
    postalCode: z.string(),
    totalReturned: z.number().describe('Number of items in the items array'),
  }),
};
export type SearchItemsInput = z.infer<typeof searchItemsSchema.input>;
export type SearchItemsOutput = z.infer<typeof searchItemsSchema.output>;

// ============================================================================
// getItem
// ============================================================================

export const getItemSchema = {
  name: 'getItem',
  description:
    'Get full details for a single Instacart item, including price, size, brand, image, availability, and dietary attributes.',
  notes:
    "Use the itemId returned from searchItems. Pricing is location-scoped to the user's current delivery address, so the same product may show different prices at different shops.",
  input: z.object({
    retailerSlug: z
      .string()
      .describe(
        'Retailer URL slug (e.g. "safeway"). Must be the retailer the item belongs to.',
      ),
    itemId: z
      .string()
      .describe(
        'Full item ID returned by searchItems, e.g. "items_55-17090545".',
      ),
  }),
  output: SearchItem,
};
export type GetItemInput = z.infer<typeof getItemSchema.input>;
export type GetItemOutput = z.infer<typeof getItemSchema.output>;

// ============================================================================
// listCarts
// ============================================================================

const CartItem = z.object({
  id: z.string().describe('Cart item ID'),
  productId: z
    .string()
    .nullable()
    .describe('Underlying product/basket-product ID'),
  name: z.string(),
  imageUrl: z.string().nullable(),
  quantity: z.number().nullable(),
  displayQuantity: z
    .string()
    .nullable()
    .describe('Display quantity string (e.g. "2", "1 lb")'),
  priceString: z
    .string()
    .nullable()
    .describe('Display price string (e.g. "$3.49 each")'),
});
export type CartItem = z.infer<typeof CartItem>;

const Cart = z.object({
  id: z.string().describe('Cart ID'),
  retailerId: z.string(),
  retailerName: z.string(),
  retailerSlug: z.string(),
  retailerLogoUrl: z.string().nullable(),
  itemCount: z.number(),
  items: z.array(CartItem),
  reviewUrl: z
    .string()
    .nullable()
    .describe(
      'URL the user can open to review and check out this cart on instacart.com (the Instacart checkout page, which lists every item with quantities and totals before the user confirms the order). Format: https://www.instacart.com/store/checkout_v4?sid={shopId}. Null if shopId could not be resolved.',
    ),
});
export type Cart = z.infer<typeof Cart>;

export const listCartsSchema = {
  name: 'listCarts',
  description:
    "List the user's active carts. The user has one cart per retailer; this returns all of them.",
  notes:
    'Each cart is restaurant-scoped: one cart per retailer the user has shopped at. itemCount reflects total quantity; items[] lists each product.',
  input: z.object({}),
  output: z.object({
    carts: z.array(Cart),
    totalItemCount: z
      .string()
      .describe(
        'Display string of total items across all carts (e.g. "4" — matches the header badge)',
      ),
  }),
};
export type ListCartsInput = z.infer<typeof listCartsSchema.input>;
export type ListCartsOutput = z.infer<typeof listCartsSchema.output>;

// ============================================================================
// addToCart / updateCartItem / removeFromCart / clearCart
// ============================================================================

export const addToCartSchema = {
  name: 'addToCart',
  description:
    "Add an item to the user's cart at a specific retailer (or set its quantity if it's already there). The mutation is upsert-style: passing quantity=N sets the quantity to N, it does not increment.",
  notes:
    'Instacart maintains one cart per retailer. If the user has no cart at this retailer yet, one is created automatically. To increment from current quantity, call listCarts first to read the current quantity, then call addToCart with quantity = current + delta. To remove an item, use removeFromCart.',
  input: z.object({
    retailerSlug: z
      .string()
      .describe(
        'Retailer URL slug (e.g. "safeway", "costco", "target"). Must be a retailer the user can shop at.',
      ),
    itemId: z
      .string()
      .describe(
        'Full item ID like "items_76-18384280" — use the id returned by searchItems or getItem.',
      ),
    quantity: z
      .number()
      .int()
      .min(1)
      .max(99)
      .optional()
      .default(1)
      .describe(
        "Quantity to set (1-99). Default 1. For weight-priced items (per lb), this is the multiplier on the item's natural increment.",
      ),
  }),
  output: z.object({
    cart: Cart,
    itemAdded: z
      .object({
        itemId: z.string(),
        quantity: z.number(),
      })
      .describe('The item that was added/updated and its final quantity'),
  }),
};
export type AddToCartInput = z.infer<typeof addToCartSchema.input>;
export type AddToCartOutput = z.infer<typeof addToCartSchema.output>;

export const updateCartItemSchema = {
  name: 'updateCartItem',
  description:
    "Update the quantity of an item already in the user's cart at a specific retailer. Sets to the given quantity (does not increment).",
  notes:
    "Quantity must be >=1; to remove the item entirely use removeFromCart. If the item isn't in the cart, this acts the same as addToCart.",
  input: z.object({
    retailerSlug: z.string().describe('Retailer URL slug (e.g. "safeway").'),
    itemId: z.string().describe('Full item ID like "items_76-18384280".'),
    quantity: z
      .number()
      .int()
      .min(1)
      .max(99)
      .describe('New quantity (1-99). To remove, use removeFromCart instead.'),
  }),
  output: z.object({
    cart: Cart,
    itemUpdated: z.object({ itemId: z.string(), quantity: z.number() }),
  }),
};
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema.input>;
export type UpdateCartItemOutput = z.infer<typeof updateCartItemSchema.output>;

export const removeFromCartSchema = {
  name: 'removeFromCart',
  description: "Remove an item from the user's cart at a specific retailer.",
  notes:
    'No-op if the item is not in the cart (server still returns the updated cart).',
  input: z.object({
    retailerSlug: z.string().describe('Retailer URL slug (e.g. "safeway").'),
    itemId: z.string().describe('Full item ID like "items_76-18384280".'),
  }),
  output: z.object({
    cart: Cart,
    itemRemoved: z.string().describe('The itemId that was removed'),
  }),
};
export type RemoveFromCartInput = z.infer<typeof removeFromCartSchema.input>;
export type RemoveFromCartOutput = z.infer<typeof removeFromCartSchema.output>;

export const clearCartSchema = {
  name: 'clearCart',
  description: "Remove all items from the user's cart at a specific retailer.",
  notes:
    'Equivalent to calling removeFromCart on every item in the cart. The cart record itself is preserved (Instacart keeps an empty cart per retailer the user has shopped at).',
  input: z.object({
    retailerSlug: z.string().describe('Retailer URL slug (e.g. "safeway").'),
  }),
  output: z.object({
    cart: Cart,
    removedCount: z.number().describe('How many distinct items were removed'),
  }),
};
export type ClearCartInput = z.infer<typeof clearCartSchema.input>;
export type ClearCartOutput = z.infer<typeof clearCartSchema.output>;

// ============================================================================
// listOrders
// ============================================================================

const Order = z.object({
  id: z.string().describe('Order delivery ID'),
  orderId: z
    .string()
    .nullable()
    .describe('Order ID (may differ from delivery ID)'),
  status: z
    .string()
    .nullable()
    .describe(
      'Status string (e.g. "Delivered", "In progress", "Shopping", "Cancelled")',
    ),
  retailerId: z.string().nullable(),
  retailerName: z.string().nullable(),
  retailerSlug: z.string().nullable(),
  retailerLogoUrl: z.string().nullable(),
  totalString: z
    .string()
    .nullable()
    .describe('Display total (e.g. "$48.32"), null if unavailable'),
  itemCount: z.number().nullable(),
  placedAt: z
    .string()
    .nullable()
    .describe('Display string for when the order was placed'),
  deliveryAt: z
    .string()
    .nullable()
    .describe('Display string for delivery time / window'),
  serviceType: z.string().nullable().describe('"DELIVERY" or "PICKUP"'),
});
export type Order = z.infer<typeof Order>;

export const listOrdersSchema = {
  name: 'listOrders',
  description:
    "List the user's past orders, most recent first. Returns delivery summaries; for full line items navigate to the order detail page on Instacart.",
  notes:
    'Page-based pagination via `numResults`. Returns an empty list if the user has no past orders.',
  input: z.object({
    numResults: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe('How many recent orders to return (1-50).'),
  }),
  output: z.object({
    orders: z.array(Order),
  }),
};
export type ListOrdersInput = z.infer<typeof listOrdersSchema.input>;
export type ListOrdersOutput = z.infer<typeof listOrdersSchema.output>;

// ============================================================================
// getActiveOrderStatuses
// ============================================================================

const ActiveOrderStatusCard = z.object({
  id: z.string(),
  title: z.string().nullable().describe('Card title (e.g. "Order delivered")'),
  subtitle: z
    .string()
    .nullable()
    .describe('Card subtitle (typically retailer + ETA)'),
  statusText: z
    .string()
    .nullable()
    .describe(
      'Display status string (e.g. "Delivered", "Shopping", "On the way")',
    ),
  retailerName: z.string().nullable(),
  retailerLogoUrl: z.string().nullable(),
  deliveryId: z.string().nullable(),
  ctaText: z
    .string()
    .nullable()
    .describe('Primary CTA label (e.g. "Track order")'),
});
export type ActiveOrderStatusCard = z.infer<typeof ActiveOrderStatusCard>;

export const getActiveOrderStatusesSchema = {
  name: 'getActiveOrderStatuses',
  description:
    'List the status cards Instacart shows on the home page for in-progress and recently-completed orders. Useful for "how is my order doing right now".',
  notes:
    'Returns the same cards shown above the home feed. Real-time shopper location is not available via this endpoint; navigate to the order detail page on Instacart for live tracking.',
  input: z.object({
    numResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(10)
      .describe('Max number of status cards to return.'),
  }),
  output: z.object({
    cards: z.array(ActiveOrderStatusCard),
  }),
};
export type GetActiveOrderStatusesInput = z.infer<
  typeof getActiveOrderStatusesSchema.input
>;
export type GetActiveOrderStatusesOutput = z.infer<
  typeof getActiveOrderStatusesSchema.output
>;

// ============================================================================
// listOffers
// ============================================================================

const Offer = z.object({
  id: z.string(),
  title: z.string().nullable().describe('Headline (e.g. "$15 off your order")'),
  description: z.string().nullable(),
  retailerName: z.string().nullable().describe('Retailer the offer applies to'),
  retailerId: z.string().nullable(),
  retailerLogoUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  expirationString: z
    .string()
    .nullable()
    .describe('Display expiration (e.g. "Expires May 20")'),
  ctaText: z.string().nullable(),
});
export type Offer = z.infer<typeof Offer>;

export const listOffersSchema = {
  name: 'listOffers',
  description:
    'List the personalized offers and coupons available to the user on the home page.',
  notes:
    "Returns offers from the home page's 'Offers' surface. Coverage of retailer-specific coupons varies; for retailer-specific deals visit the retailer's page on Instacart.",
  input: z.object({}),
  output: z.object({
    offers: z.array(Offer),
  }),
};
export type ListOffersInput = z.infer<typeof listOffersSchema.input>;
export type ListOffersOutput = z.infer<typeof listOffersSchema.output>;

// ============================================================================
// listDepartments
// ============================================================================

const Department = z.object({
  id: z.string(),
  name: z.string(),
  url: z
    .string()
    .nullable()
    .describe('Path on instacart.com (e.g. "/categories/316-food")'),
  imageUrl: z.string().nullable(),
});
export type Department = z.infer<typeof Department>;

export const listDepartmentsSchema = {
  name: 'listDepartments',
  description:
    "List Instacart's top-level shop departments / verticals (Grocery, Convenience, Alcohol, Retail, etc.). These are the cross-retailer category tabs shown on the home page.",
  notes:
    'Returns the cross-retailer verticals available at the current location. To browse a vertical, navigate the user to its url on instacart.com.',
  input: z.object({}),
  output: z.object({
    departments: z.array(Department),
  }),
};
export type ListDepartmentsInput = z.infer<typeof listDepartmentsSchema.input>;
export type ListDepartmentsOutput = z.infer<
  typeof listDepartmentsSchema.output
>;

// ============================================================================
// allSchemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listAddressesSchema,
  listRetailersSchema,
  getRetailerSchema,
  searchAutosuggestionsSchema,
  searchItemsSchema,
  getItemSchema,
  listCartsSchema,
  addToCartSchema,
  updateCartItemSchema,
  removeFromCartSchema,
  clearCartSchema,
  listOrdersSchema,
  getActiveOrderStatusesSchema,
  listOffersSchema,
  listDepartmentsSchema,
];
