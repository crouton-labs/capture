export * from './schemas';

import { Validation, ContractDrift, NotFound, Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';

import type {
  GetContextInput,
  GetContextOutput,
  SearchProductsInput,
  SearchProductsOutput,
  ProductSummary,
  GetProductInput,
  GetProductOutput,
  AddToCartInput,
  AddToCartOutput,
  GetCartInput,
  GetCartOutput,
  CartItem,
  GetOrdersInput,
  GetOrdersOutput,
  Order,
  OrderItem,
  GetProductReviewsInput,
  GetProductReviewsOutput,
  Review,
  GetListsInput,
  GetListsOutput,
  Wishlist,
  CreateListInput,
  CreateListOutput,
} from './schemas';

// ============================================================================
// Helpers
// ============================================================================

function requireAmazon(): void {
  if (!window.location.hostname.includes('amazon.')) {
    throw new Validation(
      `Amazon library requires amazon.com. Current URL: ${window.location.href}`,
    );
  }
}

function checkCaptcha(): void {
  if (document.title.includes('Robot Check')) {
    throw new UpstreamError(
      `Amazon CAPTCHA detected. Bot check triggered. URL: ${window.location.href}`,
    );
  }
}

function parseCookies(): Record<string, string> {
  const cookies: Record<string, string> = {};
  document.cookie.split(';').forEach((c) => {
    const idx = c.indexOf('=');
    if (idx < 0) return;
    const key = c.slice(0, idx).trim();
    const val = c.slice(idx + 1).trim();
    cookies[key] = val;
  });
  return cookies;
}

function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/[\d.]+/);
  if (!match) return null;
  const val = parseFloat(match[0]);
  return isNaN(val) ? null : val;
}

function parseRating(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/^([\d.]+)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return isNaN(val) ? null : val;
}

function parseReviewCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/[\d]+/);
  if (!match) return null;
  const val = parseInt(match[0], 10);
  return isNaN(val) ? null : val;
}

async function fetchPage(url: string): Promise<Document> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throwForStatus(res.status, `Amazon fetch failed: URL: ${url}`);
  }
  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  if (doc.title.includes('Robot Check')) {
    throw new UpstreamError(`Amazon CAPTCHA detected on fetched page. URL: ${url}`);
  }
  return doc;
}

// ============================================================================
// getContext
// ============================================================================

export async function getContext(
  _params: GetContextInput,
): Promise<GetContextOutput> {
  requireAmazon();
  checkCaptcha();

  const cookies = parseCookies();
  const sessionId = cookies['session-id'];
  const ubidMain = cookies['ubid-main'];

  if (!sessionId) {
    throw new Unauthenticated(
      `Amazon: session-id cookie not found. Are you on amazon.com? URL: ${window.location.href}`,
    );
  }
  if (!ubidMain) {
    throw new Unauthenticated(
      `Amazon: ubid-main cookie not found. URL: ${window.location.href}`,
    );
  }

  // Detect login status from nav greeting
  const greetingEl = document.querySelector('#nav-link-accountList-nav-line-1');
  const rawGreeting = greetingEl?.textContent?.trim();
  const greetingText = rawGreeting !== undefined ? rawGreeting : '';
  const isLoggedIn =
    greetingText.startsWith('Hello,') && !greetingText.includes('sign in');
  const trimmedName = isLoggedIn
    ? greetingText.replace(/^Hello,\s*/, '').trim()
    : '';
  const displayName = trimmedName.length > 0 ? trimmedName : null;

  return {
    isLoggedIn,
    displayName,
    sessionId,
    ubidMain,
    origin: window.location.origin,
  };
}

// ============================================================================
// searchProducts
// ============================================================================

function buildSearchUrl(params: SearchProductsInput, origin: string): string {
  const url = new URL(`${origin}/s`);
  url.searchParams.set('k', params.query);
  if (params.page && params.page > 1) {
    url.searchParams.set('page', String(params.page));
  }

  const rhParts: string[] = [];
  if (params.department) {
    rhParts.push(`n:${params.department}`);
  }
  if (params.primeOnly) {
    rhParts.push('p_85:2470955011');
  }
  if (params.minRating) {
    const ratingNodeMap: Record<number, string> = {
      1: '1248882011',
      2: '1248883011',
      3: '1248884011',
      4: '1248909011',
    };
    const nodeId = ratingNodeMap[params.minRating];
    if (nodeId) rhParts.push(`p_72:${nodeId}`);
  }
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    const low =
      params.minPrice !== undefined ? Math.round(params.minPrice * 100) : '';
    const high =
      params.maxPrice !== undefined ? Math.round(params.maxPrice * 100) : '';
    rhParts.push(`p_36:${low}-${high}`);
  }

  if (rhParts.length > 0) {
    url.searchParams.set('rh', rhParts.join(','));
  }

  return url.toString();
}

function parseSearchResult(item: Element, origin: string): ProductSummary {
  const rawAsin = (item as HTMLElement).dataset.asin;
  const asin = rawAsin !== undefined ? rawAsin : '';
  const isSponsored = !!item.querySelector('.puis-sponsored-label-text');
  const titleEl = item.querySelector('h2');
  const rawTitle = titleEl?.textContent?.trim();
  const title = rawTitle !== undefined ? rawTitle : '';
  const priceEl = item.querySelector('.a-price .a-offscreen');
  const priceText = priceEl?.textContent?.trim() ?? null;
  const price = parsePrice(priceText);
  const ratingEl = item.querySelector('.a-icon-alt');
  const rating = parseRating(ratingEl?.textContent);
  const reviewEl = item.querySelector('[aria-label*="ratings"]');
  const reviewCount = parseReviewCount(reviewEl?.getAttribute('aria-label'));
  const isPrime = !!item.querySelector('.a-icon-prime');
  const imgEl = item.querySelector('img.s-image');
  const imageUrl = imgEl?.getAttribute('src') ?? null;

  return {
    asin,
    title,
    price,
    priceText,
    rating,
    reviewCount,
    isPrime,
    isSponsored,
    imageUrl,
    productUrl: `${origin}/dp/${asin}`,
  };
}

export async function searchProducts(
  params: SearchProductsInput,
): Promise<SearchProductsOutput> {
  requireAmazon();
  checkCaptcha();

  const origin = window.location.origin;
  const url = buildSearchUrl(params, origin);
  const doc = await fetchPage(url);

  const resultItems = doc.querySelectorAll(
    '[data-asin][data-component-type="s-search-result"]',
  );

  const results: ProductSummary[] = Array.from(resultItems)
    .filter((item) => (item as HTMLElement).dataset.asin)
    .map((item) => parseSearchResult(item, origin));

  const totalResultsEl = doc.querySelector(
    '.s-result-count, [data-component="s-result-info-bar"]',
  );
  const totalResultsText =
    totalResultsEl?.textContent?.trim() ??
    doc.querySelector('span.a-color-state.a-text-bold')?.textContent?.trim() ??
    null;

  const hasNextPage = !!doc.querySelector(
    '.s-pagination-next:not(.s-pagination-disabled)',
  );

  return {
    results,
    totalResultsText,
    page: params.page ?? 1,
    hasNextPage,
  };
}

// ============================================================================
// getProduct
// ============================================================================

export async function getProduct(
  params: GetProductInput,
): Promise<GetProductOutput> {
  requireAmazon();
  checkCaptcha();

  const origin = window.location.origin;
  const url = `${origin}/dp/${params.asin}`;
  const doc = await fetchPage(url);

  const title = doc.querySelector('#productTitle')?.textContent?.trim();
  if (!title) {
    throw new NotFound(
      `Amazon: Product not found or page structure unexpected for ASIN ${params.asin}. URL: ${url}`,
    );
  }

  // Price — use apex-pricetopay-value without priceToPay class (the one WITH priceToPay has empty offscreen text)
  // Then scope to corePrice_feature_div to skip struck-through list price as fallback
  const corePriceDiv = doc.querySelector('#corePrice_feature_div');
  const priceEl =
    doc.querySelector('.apex-pricetopay-value:not(.priceToPay) .a-offscreen') ??
    corePriceDiv?.querySelector(
      '.a-price:not([data-a-strike="true"]) .a-offscreen',
    ) ??
    doc.querySelector('#priceblock_ourprice') ??
    doc.querySelector('#priceblock_dealprice');
  const rawPriceText = priceEl != null ? priceEl.textContent : null;
  const trimmedPrice = rawPriceText != null ? rawPriceText.trim() : null;
  const priceText = trimmedPrice !== '' ? trimmedPrice : null;
  const price = parsePrice(priceText);

  // List/was price
  const listPriceEl =
    doc.querySelector(
      '.a-price.a-text-price[data-a-strike="true"] .a-offscreen',
    ) ?? doc.querySelector('#listPrice');
  const listPrice = parsePrice(listPriceEl?.textContent?.trim());

  // Rating
  const ratingEl = doc.querySelector('#acrPopover');
  const rating = parseRating(ratingEl?.getAttribute('title'));

  // Review count
  const reviewCountEl = doc.querySelector('#acrCustomerReviewText');
  const reviewCount = parseReviewCount(reviewCountEl?.textContent?.trim());

  // Availability
  const availEl = doc.querySelector('#availability span');
  const availability = availEl?.textContent?.trim() || null;

  // Brand
  const brandEl =
    doc.querySelector('#bylineInfo') ??
    doc.querySelector('.po-brand .po-break-word');
  const brandText = brandEl?.textContent?.trim() ?? null;
  const brand =
    brandText?.replace(/^(Visit the|Brand:|by)\s*/i, '').trim() ?? null;

  // Seller / ships from
  const sellerEl =
    doc.querySelector('#merchant-info a') ??
    doc.querySelector('#sellerProfileTriggerId') ??
    doc.querySelector('#tabular-buybox-truncate-1 span');
  const seller = sellerEl?.textContent?.trim() ?? null;

  // Prime — a-icon-prime is JS-rendered; check delivery block text which contains full Prime messaging
  // #deliveryBlockMessage contains the full delivery text including "Prime members get FREE delivery"
  // Collect text from all delivery block elements since primary slot may omit the Prime mention
  const deliveryIds = [
    '#deliveryBlockMessage',
    '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE',
    '#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE',
  ];
  const deliveryText = deliveryIds
    .map((sel) => {
      const el = doc.querySelector(sel);
      return el != null && el.textContent != null ? el.textContent : '';
    })
    .join(' ');
  const isPrime =
    deliveryText.includes('Prime') || !!doc.querySelector('#prime-logo img');

  // Images
  const imgEl =
    doc.querySelector('#landingImage') ??
    doc.querySelector('#imgBlkFront') ??
    doc.querySelector('#main-image');
  const imageUrl = imgEl?.getAttribute('src') ?? null;

  // Variants
  const variantContainers = doc.querySelectorAll(
    '#variation_color_name li, #variation_size_name li, #variation_style_name li',
  );
  const variants = Array.from(variantContainers).map((li) => {
    const el = li as HTMLElement;
    const isSelected = el.classList.contains('selected');
    const isUnavailable = el.classList.contains('unavailable');
    const asinVal =
      el.dataset.defaultasin !== undefined
        ? el.dataset.defaultasin
        : el.dataset.asin !== undefined
          ? el.dataset.asin
          : '';
    const labelRaw =
      el.querySelector('img')?.getAttribute('alt') ??
      el
        .querySelector('span:not(.twister-unavailable-message-content)')
        ?.textContent?.trim() ??
      el.textContent?.trim();
    const label = labelRaw !== undefined ? labelRaw : '';
    return {
      asin: asinVal,
      label,
      isSelected,
      isAvailable: !isUnavailable,
    };
  });

  // Feature bullets
  const bulletEls = doc.querySelectorAll(
    '#feature-bullets li:not(.aok-hidden) span.a-list-item',
  );
  const features = Array.from(bulletEls)
    .map((el) => el.textContent?.trim())
    .filter((t): t is string => t !== undefined && t.length > 0);

  return {
    asin: params.asin,
    title,
    price,
    priceText,
    listPrice,
    rating,
    reviewCount,
    availability,
    brand,
    seller,
    isPrime,
    variants,
    imageUrl,
    productUrl: url,
    features,
  };
}

// ============================================================================
// addToCart
// ============================================================================

export async function addToCart(
  params: AddToCartInput,
): Promise<AddToCartOutput> {
  requireAmazon();
  checkCaptcha();

  const origin = window.location.origin;
  const qty = params.quantity ?? 1;

  // Step 1: Fetch product page to get offerListingId, CSRF token, and price data
  const productUrl = `${origin}/dp/${params.asin}`;
  const productDoc = await fetchPage(productUrl);

  // Find the add-to-cart form (contains offerListingId and form-specific CSRF)
  const atcForm = productDoc.querySelector<HTMLFormElement>(
    'form[action*="add-to-cart"], form[action*="handle-buy-box"]',
  );
  if (!atcForm) {
    throw new ContractDrift(
      `Amazon addToCart: add-to-cart form not found for ASIN ${params.asin}. Product may be unavailable or sold out. URL: ${productUrl}`,
    );
  }

  // Build form body from existing form fields then override quantity and mode
  const formData = new FormData(atcForm);
  formData.set('quantity', String(qty));
  formData.set('items[0.base][quantity]', String(qty));
  formData.set('isBuyNow', '0');

  const body = new URLSearchParams(
    formData as unknown as Record<string, string>,
  );

  // Step 2: POST to /cart/add-to-cart/ (Amazon's actual JS-driven endpoint)
  const atcUrl = `${origin}/cart/add-to-cart/`;
  const res = await fetch(atcUrl, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: productUrl,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throwForStatus(res.status, `Amazon addToCart failed. ASIN: ${params.asin}. URL: ${atcUrl}`);
  }

  return {
    success: true,
    asin: params.asin,
    quantity: qty,
  };
}

// ============================================================================
// getCart
// ============================================================================

function parseCartItem(item: Element, isSaved: boolean): CartItem {
  const el = item as HTMLElement;
  const asin = el.dataset.asin !== undefined ? el.dataset.asin : '';
  const itemId = el.dataset.itemid !== undefined ? el.dataset.itemid : '';
  const price = parsePrice(
    el.dataset.price !== undefined ? el.dataset.price : null,
  );
  const rawQty =
    el.dataset.quantity !== undefined ? parseInt(el.dataset.quantity, 10) : 1;
  const quantity = isNaN(rawQty) ? 1 : rawQty;
  const isPrime = el.dataset.isprimeasin === '1';

  // Title: .a-truncate-full is present in server-rendered HTML (full, untruncated title text)
  const titleEl =
    item.querySelector('.a-truncate-full') ??
    item.querySelector('a[href*="psc=1"]');
  const rawTitleText = titleEl?.textContent?.trim();
  let title = rawTitleText !== undefined ? rawTitleText : '';

  // Fallback: use URL-decoded name from dataset
  if (!title && el.dataset.name) {
    try {
      title = decodeURIComponent(el.dataset.name.replace(/\+/g, ' '));
    } catch {
      title = el.dataset.name;
    }
  }

  return {
    asin,
    itemId,
    title,
    price,
    quantity: isNaN(quantity) ? 1 : quantity,
    subtotal: price !== null ? price * (isNaN(quantity) ? 1 : quantity) : null,
    isPrime,
    isSavedForLater: isSaved,
  };
}

export async function getCart(_params: GetCartInput): Promise<GetCartOutput> {
  requireAmazon();
  checkCaptcha();

  const url = `${window.location.origin}/gp/cart/view.html`;
  const doc = await fetchPage(url);

  const activeEls = doc.querySelectorAll('[data-asin][data-itemtype="active"]');
  const savedEls = doc.querySelectorAll('[data-asin][data-itemtype="saved"]');

  const activeItems: CartItem[] = Array.from(activeEls)
    .filter((el) => (el as HTMLElement).dataset.asin)
    .map((el) => parseCartItem(el, false));

  const savedItems: CartItem[] = Array.from(savedEls)
    .filter((el) => (el as HTMLElement).dataset.asin)
    .map((el) => parseCartItem(el, true));

  const subtotalEl = doc.querySelector('#sc-subtotal-amount-activecart');
  const subtotalText = subtotalEl?.textContent?.trim() ?? null;
  const subtotal = parsePrice(subtotalText);

  const isEmpty = activeItems.length === 0;

  return {
    items: [...activeItems, ...savedItems],
    activeItems,
    savedItems,
    subtotal,
    subtotalText,
    isEmpty,
  };
}

// ============================================================================
// getOrders
// ============================================================================

function parseOrderItem(el: Element): OrderItem {
  const titleEl = el.querySelector(
    '.yohtmlc-product-title a, .yohtmlc-product-title',
  );
  const titleText = titleEl?.textContent?.trim();
  const title = titleText !== undefined && titleText !== null ? titleText : '';
  const linkEl = el.querySelector('a[href*="/dp/"]');
  const hrefVal = linkEl?.getAttribute('href');
  const href = hrefVal !== null && hrefVal !== undefined ? hrefVal : '';
  const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/);
  const asin = asinMatch ? asinMatch[1] : '';
  const imgEl = el.querySelector('img');
  const imageUrl = imgEl?.getAttribute('src') ?? null;
  const qtyEl = el.querySelector('.item-qty, .yohtmlc-item-quantity');
  const qtyText = qtyEl?.textContent?.replace(/[^0-9]/g, '');
  const rawQty = qtyText ? parseInt(qtyText, 10) : 1;
  const quantity = isNaN(rawQty) ? 1 : rawQty;
  const priceEl = el.querySelector(
    '.yohtmlc-item-price .a-price .a-offscreen, .yohtmlc-item-price',
  );
  const price = parsePrice(priceEl?.textContent?.trim() ?? null);
  return { title, asin, quantity, price, imageUrl };
}

export async function getOrders(
  params: GetOrdersInput,
): Promise<GetOrdersOutput> {
  requireAmazon();
  checkCaptcha();

  const origin = window.location.origin;
  const page = params.page ?? 1;
  const startIndex = (page - 1) * 10;

  const url = new URL(`${origin}/gp/css/order-history`);
  if (params.timeFilter) {
    url.searchParams.set('timeFilter', params.timeFilter);
  }
  if (startIndex > 0) {
    url.searchParams.set('startIndex', String(startIndex));
  }

  const doc = await fetchPage(url.toString());

  const orderCards = doc.querySelectorAll(
    '.order-card, [class*="order-card"], .js-order-card:not([aria-hidden])',
  );

  // Amazon uses .order-card class for order containers on the orders page
  // Also try the shipment/order box structure
  const orderBoxes = doc.querySelectorAll('.a-box-group.order, .order');

  const rawOrders =
    orderCards.length > 0 ? Array.from(orderCards) : Array.from(orderBoxes);

  const orders: Order[] = rawOrders.map((card) => {
    // Order ID: typically in data attribute or link text containing order number pattern
    const orderIdEl = card.querySelector(
      '[class*="order-id"] span, .yohtmlc-order-id span',
    );
    const orderIdRaw = orderIdEl?.textContent?.trim();
    const orderIdText =
      orderIdRaw !== undefined && orderIdRaw !== null ? orderIdRaw : '';
    const orderIdMatch = orderIdText.match(/\d{3}-\d{7}-\d{7}/);
    const orderId = orderIdMatch ? orderIdMatch[0] : '';

    // Order date
    const dateEl = card.querySelector(
      '.order-date-invoice-item, [class*="order-date"]',
    );
    const dateRaw = dateEl?.textContent?.trim();
    const orderDate =
      dateRaw !== undefined && dateRaw !== null
        ? dateRaw.replace(/^Order placed\s*/i, '')
        : '';

    // Order total
    const totalEl = card.querySelector(
      '[class*="order-total"] .value, .order-date-invoice-item ~ .order-date-invoice-item',
    );
    const totalText = totalEl?.textContent?.trim() ?? null;
    const totalAmount = parsePrice(totalText);

    // Status
    const statusEl = card.querySelector(
      '.delivery-box .a-color-success, [class*="delivery-status"], .shipment-top-row .a-size-medium.a-color-base',
    );
    const status = statusEl?.textContent?.trim() ?? null;

    // Items
    const itemEls = card.querySelectorAll(
      '.a-fixed-left-grid, [class*="shipment-info"], .item-box',
    );
    const items: OrderItem[] = Array.from(itemEls).map((el) =>
      parseOrderItem(el),
    );

    return { orderId, orderDate, totalAmount, totalText, status, items };
  });

  const hasNextPage = !!doc.querySelector(
    '.a-pagination .a-last:not(.a-disabled)',
  );

  return { orders, page, hasNextPage };
}

// ============================================================================
// getProductReviews
// ============================================================================

const starFilterMap: Record<number, string> = {
  1: 'one_star',
  2: 'two_star',
  3: 'three_star',
  4: 'four_star',
  5: 'five_star',
};

function parseHelpfulVotes(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/(\d+)/);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  return isNaN(val) ? null : val;
}

function parseReview(el: Element): Review {
  const ratingEl = el.querySelector(
    '[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt',
  );
  const rating = parseRating(ratingEl?.textContent);

  const titleEl = el.querySelector(
    '[data-hook="review-title"] span:not([class])',
  );
  const titleRaw = titleEl?.textContent?.trim();
  const titleFallbackRaw = el
    .querySelector('[data-hook="review-title"]')
    ?.textContent?.trim();
  const title =
    titleRaw !== undefined && titleRaw !== null
      ? titleRaw
      : titleFallbackRaw !== undefined && titleFallbackRaw !== null
        ? titleFallbackRaw
        : '';

  const textEl = el.querySelector('[data-hook="review-body"] span');
  const textRaw = textEl?.textContent?.trim();
  const text = textRaw !== undefined && textRaw !== null ? textRaw : '';

  const authorEl = el.querySelector('.a-profile-name');
  const authorRaw = authorEl?.textContent?.trim();
  const author = authorRaw !== undefined && authorRaw !== null ? authorRaw : '';

  const dateEl = el.querySelector('[data-hook="review-date"]');
  const dateRaw = dateEl?.textContent?.trim();
  const date = dateRaw !== undefined && dateRaw !== null ? dateRaw : '';

  const isVerified = !!el.querySelector('[data-hook="avp-badge"]');

  const helpfulEl = el.querySelector('[data-hook="helpful-vote-statement"]');
  const helpfulVotes = parseHelpfulVotes(helpfulEl?.textContent);

  return { rating, title, text, author, date, isVerified, helpfulVotes };
}

export async function getProductReviews(
  params: GetProductReviewsInput,
): Promise<GetProductReviewsOutput> {
  requireAmazon();
  checkCaptcha();

  const origin = window.location.origin;
  const url = new URL(`${origin}/product-reviews/${params.asin}`);

  if (params.starFilter !== undefined) {
    url.searchParams.set('filterByStar', starFilterMap[params.starFilter]);
  }
  if (params.sortBy) {
    url.searchParams.set('sortBy', params.sortBy);
  }
  const page = params.page ?? 1;
  if (page > 1) {
    url.searchParams.set('pageNumber', String(page));
  }

  const doc = await fetchPage(url.toString());

  const reviewEls = doc.querySelectorAll('[data-hook="review"]');
  if (
    reviewEls.length === 0 &&
    !doc.querySelector('[data-hook="cr-filter-info-review-rating-count"]')
  ) {
    throw new NotFound(
      `Amazon getProductReviews: no reviews found for ASIN ${params.asin}. Product may not exist or have no reviews. URL: ${url.toString()}`,
    );
  }

  const reviews: Review[] = Array.from(reviewEls).map((el) => parseReview(el));

  const hasNextPage = !!doc.querySelector(
    '.a-pagination .a-last:not(.a-disabled)',
  );

  return { reviews, page, hasNextPage };
}

// ============================================================================
// getLists
// ============================================================================

export async function getLists(
  _params: GetListsInput,
): Promise<GetListsOutput> {
  requireAmazon();
  checkCaptcha();

  const origin = window.location.origin;
  const url = `${origin}/hz/wishlist/ls`;
  const doc = await fetchPage(url);

  const listLinks = doc.querySelectorAll('[id^="wl-list-link-"]');
  if (listLinks.length === 0) {
    // User has no lists
    return { lists: [] };
  }

  const lists: Wishlist[] = Array.from(listLinks).map((el, index) => {
    const listId = (el as HTMLElement).id.replace('wl-list-link-', '');
    const titleEl = doc.querySelector(`#wl-list-entry-title-${listId}`);
    const nameRaw = titleEl?.textContent?.trim();
    const name = nameRaw !== undefined && nameRaw !== null ? nameRaw : '';

    // Item count: navigate to the list to get it from #viewItemCount hidden input
    // On the hub page we don't have per-list item counts — default to 0 for non-active lists
    // The active list (first) is shown in the page with its items
    const viewItemCountEl = doc.querySelector('#viewItemCount');
    const countValue =
      index === 0 && viewItemCountEl
        ? (viewItemCountEl as HTMLInputElement).value
        : null;
    const rawCount = countValue ? parseInt(countValue, 10) : 0;
    const itemCount = isNaN(rawCount) ? 0 : rawCount;

    const isDefault = index === 0;
    return { listId, name, itemCount, isDefault };
  });

  return { lists };
}

// ============================================================================
// createList
// ============================================================================

export async function createList(
  params: CreateListInput,
): Promise<CreateListOutput> {
  requireAmazon();
  checkCaptcha();

  const origin = window.location.origin;

  // Step 1: Fetch the create list form to get CSRF token
  const createFormUrl = `${origin}/hz/wishlist/create?isPopover=1&createIngressName=DESKTOP_LIST_OF_LISTS`;
  const formRes = await fetch(createFormUrl, { credentials: 'include' });
  if (!formRes.ok) {
    throwForStatus(formRes.status, `Amazon createList: failed to load create form. URL: ${createFormUrl}`);
  }
  const formHtml = await formRes.text();
  const parser = new DOMParser();
  const formDoc = parser.parseFromString(formHtml, 'text/html');

  const csrfInput = formDoc.querySelector<HTMLInputElement>(
    '#lists-sp-csrf-input-token',
  );
  if (!csrfInput) {
    throw new ContractDrift(
      `Amazon createList: CSRF token not found in create list form. URL: ${createFormUrl}`,
    );
  }
  const csrfToken = csrfInput.value;

  // Step 2: Extract session ID from cookies
  const cookies = parseCookies();
  const sessionId = cookies['session-id'];
  if (!sessionId) {
    throw new Unauthenticated(
      `Amazon createList: session-id cookie not found. URL: ${window.location.href}`,
    );
  }

  // Step 3: POST to /hz/wishlist/create/newlist with CSRF in header (AJAX endpoint)
  const postUrl = `${origin}/hz/wishlist/create/newlist`;
  const body = new URLSearchParams();
  body.set('listName', params.name);
  body.set('sid', sessionId);
  body.set('vendorId', 'website.wishlist.profile');
  body.set('privacyStatus', 'PRIVATE');
  body.set('listType', 'WishList');
  body.set('isJson', 'true');

  const res = await fetch(postUrl, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${origin}/hz/wishlist/ls`,
      'X-Requested-With': 'XMLHttpRequest',
      'anti-csrftoken-a2z': csrfToken,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }

  // Step 4: Parse JSON response for new list ID
  type CreateListResponse = {
    listExternalId: string;
    listName: string;
    hasError: boolean;
    error: string | null;
  };
  const data = (await res.json()) as CreateListResponse;

  if (data.hasError) {
    throw new UpstreamError(
      `Amazon createList: server returned error: ${data.error !== null && data.error !== undefined ? data.error : '(no error detail)'}. URL: ${postUrl}`,
    );
  }

  if (!data.listExternalId) {
    throw new ContractDrift(
      `Amazon createList: response did not contain listExternalId. URL: ${postUrl}`,
    );
  }

  return { success: true, listId: data.listExternalId, name: data.listName };
}
