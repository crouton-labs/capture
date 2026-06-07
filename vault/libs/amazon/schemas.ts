import { z } from 'zod';

export const libraryDescription =
  'Amazon e-commerce — search products, manage cart, view orders, manage wishlists, and track subscriptions';

export const libraryIcon = '/icons/libs/amazon.png';
export const loginUrl = 'https://www.amazon.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://www.amazon.com\`
2. Call \`getContext()\` to verify login status
3. Call task functions directly — write operations derive their own CSRF tokens internally

## Auth

Amazon uses cookie-based auth. No OAuth or API key needed — the user must be signed in at amazon.com. Call \`getContext()\` to verify login status before personalized operations. Write operations (addToCart, etc.) fetch required CSRF tokens internally from product pages.

## Bot Detection

Amazon may serve a CAPTCHA page (HTTP 200, title "Robot Check") if automated behavior is detected. If a function throws a CAPTCHA error, wait before retrying.

## Pagination

Search results use page-based pagination: \`page\` parameter (1-indexed, default 1). Each page returns up to 16 organic results.

## Sponsored vs Organic

\`searchProducts()\` marks each result with \`isSponsored\`. Sponsored results appear at the top and interspersed in results. Filter with \`isSponsored: false\` in your logic when the user wants non-ad results.

## Price Parsing

Prices are returned as numbers in USD. Amazon shows different prices based on login status, Prime membership, and Subscribe & Save enrollment. Prices reflect the session context — always call \`getContext()\` first.
`;

// ============================================================================
// Shared
// ============================================================================

export const AsinParam = z
  .string()
  .regex(/^[A-Z0-9]{10}$/)
  .describe(
    'Amazon Standard Identification Number (10-char alphanumeric, e.g. "B0D1XD1ZV3")',
  );

// ============================================================================
// getContext
// ============================================================================

export const GetContextInputSchema = z
  .object({})
  .describe('No parameters required');

export const GetContextOutputSchema = z.object({
  isLoggedIn: z.boolean().describe('Whether the user is signed into Amazon'),
  displayName: z
    .string()
    .nullable()
    .describe(
      'Greeting name shown in nav (e.g. "Bob"). Null if not logged in.',
    ),
  sessionId: z.string().describe('session-id cookie value'),
  ubidMain: z.string().describe('ubid-main cookie value (user browser ID)'),
  origin: z
    .string()
    .describe('Amazon origin URL (e.g. "https://www.amazon.com")'),
});

export type GetContextInput = z.infer<typeof GetContextInputSchema>;
export type GetContextOutput = z.infer<typeof GetContextOutputSchema>;

// ============================================================================
// searchProducts
// ============================================================================

export const SearchProductsInputSchema = z.object({
  query: z
    .string()
    .describe('Search keyword (e.g. "wireless earbuds", "standing desk")'),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe(
      'Page number (1-indexed). Default: 1. Each page returns up to 16 results.',
    ),
  department: z
    .string()
    .optional()
    .describe(
      'Browse node ID to filter by department (e.g. "172282" for Electronics). Get IDs from the department dropdown on amazon.com/s search results.',
    ),
  minPrice: z
    .number()
    .optional()
    .describe('Minimum price filter in USD (e.g. 10 for $10 minimum)'),
  maxPrice: z
    .number()
    .optional()
    .describe('Maximum price filter in USD (e.g. 50 for $50 maximum)'),
  minRating: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .optional()
    .describe(
      'Minimum star rating filter. Valid values: 1, 2, 3, 4 (for 1+, 2+, 3+, 4+ stars)',
    ),
  primeOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe('Filter to Prime-eligible items only. Default: false'),
});

export const ProductSummarySchema = z.object({
  asin: AsinParam,
  title: z.string().describe('Product title'),
  price: z
    .number()
    .nullable()
    .describe('Current price in USD. Null if price not displayed.'),
  priceText: z
    .string()
    .nullable()
    .describe(
      'Raw price string as shown on page (e.g. "$44.99"). Null if not available.',
    ),
  rating: z
    .number()
    .nullable()
    .describe('Average star rating (0–5). Null if no ratings yet.'),
  reviewCount: z
    .number()
    .nullable()
    .describe('Total number of customer ratings. Null if not shown.'),
  isPrime: z.boolean().describe('Whether this item is Prime-eligible'),
  isSponsored: z.boolean().describe('Whether this is a sponsored/ad result'),
  imageUrl: z
    .string()
    .nullable()
    .describe('Product thumbnail image URL. Null if not available.'),
  productUrl: z.string().describe('Full URL to the product detail page'),
});

export const SearchProductsOutputSchema = z.object({
  results: z.array(ProductSummarySchema).describe('List of search results'),
  totalResultsText: z
    .string()
    .nullable()
    .describe(
      'Total results count text as shown on page (e.g. "1-16 of over 2,000 results"). Null if not found.',
    ),
  page: z.number().describe('Current page number'),
  hasNextPage: z
    .boolean()
    .describe(
      'Whether there is a next page of results (based on presence of next page link)',
    ),
});

export type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;
export type SearchProductsOutput = z.infer<typeof SearchProductsOutputSchema>;
export type ProductSummary = z.infer<typeof ProductSummarySchema>;

// ============================================================================
// getProduct
// ============================================================================

export const GetProductInputSchema = z.object({
  asin: AsinParam,
});

export const ProductVariantSchema = z.object({
  asin: z.string().describe('ASIN for this variant'),
  label: z.string().describe('Variant label (e.g. "Black", "128GB", "Large")'),
  isSelected: z
    .boolean()
    .describe('Whether this variant is currently selected'),
  isAvailable: z.boolean().describe('Whether this variant is in stock'),
});

export const GetProductOutputSchema = z.object({
  asin: AsinParam,
  title: z.string().describe('Full product title'),
  price: z
    .number()
    .nullable()
    .describe(
      'Current price in USD. Null if not shown (e.g. sold by third party with "See price in cart").',
    ),
  priceText: z
    .string()
    .nullable()
    .describe('Raw price string (e.g. "$44.99"). Null if not available.'),
  listPrice: z
    .number()
    .nullable()
    .describe('Original/list price before discounts. Null if not shown.'),
  rating: z
    .number()
    .nullable()
    .describe('Average star rating (0–5). Null if no ratings.'),
  reviewCount: z
    .number()
    .nullable()
    .describe('Total number of ratings. Null if not shown.'),
  availability: z
    .string()
    .nullable()
    .describe(
      'Availability text (e.g. "In Stock", "Only 3 left in stock", "Currently unavailable"). Null if not found.',
    ),
  brand: z.string().nullable().describe('Brand name. Null if not shown.'),
  seller: z
    .string()
    .nullable()
    .describe(
      'Seller name (e.g. "Ships from Amazon" or third-party seller). Null if not shown.',
    ),
  isPrime: z.boolean().describe('Whether this item is Prime-eligible'),
  variants: z
    .array(ProductVariantSchema)
    .describe(
      'Product variants (color, size, style, etc.). Empty array if no variants.',
    ),
  imageUrl: z
    .string()
    .nullable()
    .describe('Main product image URL. Null if not found.'),
  productUrl: z.string().describe('Full URL to this product page'),
  features: z
    .array(z.string())
    .describe(
      'Feature bullet points from the product description. Empty array if not found.',
    ),
});

export type GetProductInput = z.infer<typeof GetProductInputSchema>;
export type GetProductOutput = z.infer<typeof GetProductOutputSchema>;

// ============================================================================
// addToCart
// ============================================================================

export const AddToCartInputSchema = z.object({
  asin: AsinParam,
  quantity: z
    .number()
    .int()
    .min(1)
    .max(999)
    .optional()
    .default(1)
    .describe('Quantity to add. Default: 1'),
});

export const AddToCartOutputSchema = z.object({
  success: z
    .boolean()
    .describe('Whether the item was successfully added to cart'),
  asin: AsinParam.describe('ASIN that was added'),
  quantity: z.number().describe('Quantity that was requested'),
});

export type AddToCartInput = z.infer<typeof AddToCartInputSchema>;
export type AddToCartOutput = z.infer<typeof AddToCartOutputSchema>;

// ============================================================================
// getCart
// ============================================================================

export const GetCartInputSchema = z
  .object({})
  .describe('No parameters required');

export const CartItemSchema = z.object({
  asin: z.string().describe('Product ASIN'),
  itemId: z.string().describe('Cart item ID (UUID) used for cart mutations'),
  title: z.string().describe('Product title'),
  price: z
    .number()
    .nullable()
    .describe('Unit price in USD. Null if not parseable.'),
  quantity: z.number().int().describe('Quantity in cart'),
  subtotal: z
    .number()
    .nullable()
    .describe(
      'Line subtotal in USD (price × quantity). Null if not parseable.',
    ),
  isPrime: z.boolean().describe('Whether this item is Prime-eligible'),
  isSavedForLater: z
    .boolean()
    .describe('Whether this item is in the Save for Later section'),
});

export const GetCartOutputSchema = z.object({
  items: z
    .array(CartItemSchema)
    .describe('All items in cart (active) and Save for Later'),
  activeItems: z
    .array(CartItemSchema)
    .describe('Active cart items only (not saved for later)'),
  savedItems: z.array(CartItemSchema).describe('Save for Later items'),
  subtotal: z
    .number()
    .nullable()
    .describe(
      'Cart subtotal for active items in USD. Null if cart is empty or not parseable.',
    ),
  subtotalText: z
    .string()
    .nullable()
    .describe(
      'Raw subtotal string as shown on page (e.g. "$44.99"). Null if not found.',
    ),
  isEmpty: z.boolean().describe('Whether the active cart is empty'),
});

export type GetCartInput = z.infer<typeof GetCartInputSchema>;
export type GetCartOutput = z.infer<typeof GetCartOutputSchema>;
export type CartItem = z.infer<typeof CartItemSchema>;

// ============================================================================
// getOrders
// ============================================================================

export const GetOrdersInputSchema = z.object({
  timeFilter: z
    .string()
    .optional()
    .describe(
      'Time range filter. Valid values: "last30" (last 30 days), "months-3" (past 3 months), "months-6" (past 6 months), "year-YYYY" (specific year, e.g. "year-2024"). Defaults to Amazon\'s current selection if omitted.',
    ),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe(
      'Page number (1-indexed). Default: 1. Each page returns up to 10 orders.',
    ),
});

export const OrderItemSchema = z.object({
  title: z.string().describe('Product title'),
  asin: z.string().describe('Product ASIN, or empty string if not available'),
  quantity: z.number().int().describe('Quantity ordered'),
  price: z
    .number()
    .nullable()
    .describe('Unit price in USD. Null if not shown.'),
  imageUrl: z
    .string()
    .nullable()
    .describe('Product thumbnail URL. Null if not available.'),
});

export const OrderSchema = z.object({
  orderId: z.string().describe('Amazon order ID (e.g. "112-3456789-0123456")'),
  orderDate: z
    .string()
    .describe('Order placement date as text (e.g. "March 2, 2024")'),
  totalAmount: z
    .number()
    .nullable()
    .describe('Order total in USD. Null if not parseable.'),
  totalText: z
    .string()
    .nullable()
    .describe('Raw order total string (e.g. "$44.99"). Null if not shown.'),
  status: z
    .string()
    .nullable()
    .describe(
      'Order status text (e.g. "Delivered", "Shipped"). Null if not shown.',
    ),
  items: z.array(OrderItemSchema).describe('Items in this order'),
});

export const GetOrdersOutputSchema = z.object({
  orders: z.array(OrderSchema).describe('List of orders'),
  page: z.number().describe('Current page number'),
  hasNextPage: z.boolean().describe('Whether there is a next page of orders'),
});

export type GetOrdersInput = z.infer<typeof GetOrdersInputSchema>;
export type GetOrdersOutput = z.infer<typeof GetOrdersOutputSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;

// ============================================================================
// getProductReviews
// ============================================================================

export const GetProductReviewsInputSchema = z.object({
  asin: AsinParam,
  starFilter: z
    .union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ])
    .optional()
    .describe('Filter reviews by star rating (1–5). Omit to get all reviews.'),
  sortBy: z
    .enum(['recent', 'helpful'])
    .optional()
    .describe(
      'Sort order. "recent" = most recent first, "helpful" = most helpful first. Default: helpful.',
    ),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe(
      'Page number (1-indexed). Default: 1. Each page returns up to 10 reviews.',
    ),
});

export const ReviewSchema = z.object({
  rating: z
    .number()
    .nullable()
    .describe('Star rating (1–5). Null if not parseable.'),
  title: z.string().describe('Review title'),
  text: z.string().describe('Review body text'),
  author: z.string().describe('Reviewer display name'),
  date: z
    .string()
    .describe(
      'Review date as shown on page (e.g. "Reviewed in the United States on March 4, 2026")',
    ),
  isVerified: z
    .boolean()
    .describe('Whether this is a "Verified Purchase" review'),
  helpfulVotes: z
    .number()
    .int()
    .nullable()
    .describe('Number of helpful votes. Null if not shown or zero.'),
});

export const GetProductReviewsOutputSchema = z.object({
  reviews: z.array(ReviewSchema).describe('List of customer reviews'),
  page: z.number().describe('Current page number'),
  hasNextPage: z.boolean().describe('Whether there is a next page of reviews'),
});

export type GetProductReviewsInput = z.infer<
  typeof GetProductReviewsInputSchema
>;
export type GetProductReviewsOutput = z.infer<
  typeof GetProductReviewsOutputSchema
>;
export type Review = z.infer<typeof ReviewSchema>;

// ============================================================================
// getLists
// ============================================================================

export const GetListsInputSchema = z
  .object({})
  .describe('No parameters required');

export const WishlistSchema = z.object({
  listId: z.string().describe('Wishlist ID (e.g. "22A6TABH50VRC")'),
  name: z.string().describe('List name'),
  itemCount: z.number().int().describe('Number of items in the list'),
  isDefault: z.boolean().describe('Whether this is the default/first list'),
});

export const GetListsOutputSchema = z.object({
  lists: z.array(WishlistSchema).describe('All user wishlists/registries'),
});

export type GetListsInput = z.infer<typeof GetListsInputSchema>;
export type GetListsOutput = z.infer<typeof GetListsOutputSchema>;
export type Wishlist = z.infer<typeof WishlistSchema>;

// ============================================================================
// createList
// ============================================================================

export const CreateListInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .describe('Name for the new list (1–255 characters)'),
});

export const CreateListOutputSchema = z.object({
  success: z.boolean().describe('Whether the list was created successfully'),
  listId: z.string().describe('ID of the newly created list'),
  name: z.string().describe('Name of the newly created list'),
});

export type CreateListInput = z.infer<typeof CreateListInputSchema>;
export type CreateListOutput = z.infer<typeof CreateListOutputSchema>;

// ============================================================================
// allSchemas (used by build pipeline)
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Verify Amazon login status and extract session cookies. Returns the display name, session identifiers, and origin URL for the authenticated user.',
  notes:
    'Navigate to https://www.amazon.com before calling. Returns isLoggedIn: false if user is not signed in — do not proceed with personalized operations in that case.',
  input: GetContextInputSchema,
  output: GetContextOutputSchema,
};

export const searchProductsSchema = {
  name: 'searchProducts',
  description:
    'Search Amazon products by keyword with optional filters for department, price range, star rating, and Prime eligibility. Returns ASIN, title, price, rating, review count, Prime status, and sponsored flag for each result.',
  notes:
    'Results include both sponsored and organic listings. Check isSponsored on each result to distinguish ad placements. Use page parameter for pagination (16 results per page). Price and rating filters are applied server-side by Amazon. isPrime may not accurately reflect Prime eligibility for all results — Prime badges are rendered client-side.',
  input: SearchProductsInputSchema,
  output: SearchProductsOutputSchema,
};

export const getProductSchema = {
  name: 'getProduct',
  description:
    'Fetch full product details for a given ASIN from the product detail page. Returns title, price, availability, rating, variants, seller, Prime eligibility, and feature bullets.',
  notes:
    'Some fields (price, seller) may be null for products sold exclusively by third-party sellers with dynamic pricing. variants is empty for simple products with no size/color options.',
  input: GetProductInputSchema,
  output: GetProductOutputSchema,
};

export const addToCartSchema = {
  name: 'addToCart',
  description:
    'Add a product to the Amazon cart by ASIN. Fetches the product page to extract pricing and offer details, then submits to cart. Returns success confirmation.',
  notes:
    'Always confirm with the user before adding items. After adding, call getCart() to verify the item appears and confirm the price.',
  input: AddToCartInputSchema,
  output: AddToCartOutputSchema,
};

export const getCartSchema = {
  name: 'getCart',
  description:
    'Fetch current Amazon cart contents including active items and Save for Later items. Returns item details (ASIN, title, price, quantity) and cart subtotal.',
  notes:
    'Returns isEmpty: true when no active cart items. savedItems are shown separately from activeItems. Use itemId from results for cart mutations (remove, update quantity).',
  input: GetCartInputSchema,
  output: GetCartOutputSchema,
};

export const getOrdersSchema = {
  name: 'getOrders',
  description:
    'Fetch Amazon order history. Returns a list of orders with order ID, date, total, status, and line items. Supports time range filters and pagination.',
  notes:
    'Orders are not available for accounts with no purchase history. Use timeFilter to scope results to a specific year or recent window. Each page returns up to 10 orders.',
  input: GetOrdersInputSchema,
  output: GetOrdersOutputSchema,
};

export const getProductReviewsSchema = {
  name: 'getProductReviews',
  description:
    'Fetch customer reviews for a product by ASIN from the Amazon reviews page. Returns rating, title, body text, author, date, verified status, and helpful vote count.',
  notes:
    'Reviews are from the /product-reviews/{ASIN} page. Use starFilter to narrow by star rating (1–5). Use sortBy to order by most recent or most helpful.',
  input: GetProductReviewsInputSchema,
  output: GetProductReviewsOutputSchema,
};

export const getListsSchema = {
  name: 'getLists',
  description:
    'Fetch all wishlists for the authenticated Amazon user. Returns list ID, name, item count, and whether each list is the default list.',
  notes:
    'Requires the user to be logged in. The first list returned is the default/active list. Use the listId to navigate to a specific list.',
  input: GetListsInputSchema,
  output: GetListsOutputSchema,
};

export const createListSchema = {
  name: 'createList',
  description:
    'Create a new Amazon wishlist with a given name. Returns the new list ID and name on success.',
  notes:
    'Confirm with the user before creating a list. After creation, call getLists() to verify the new list appears.',
  input: CreateListInputSchema,
  output: CreateListOutputSchema,
};

export const allSchemas = [
  getContextSchema,
  searchProductsSchema,
  getProductSchema,
  addToCartSchema,
  getCartSchema,
  getOrdersSchema,
  getProductReviewsSchema,
  getListsSchema,
  createListSchema,
];
