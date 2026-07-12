/**
 * Structural bounds for page-controlled snapshot strings and arrays.
 *
 * Capture preserves browser evidence. These helpers only enforce output-size
 * caps and filename safety; they never inspect, replace, hash, or withhold a
 * value based on its contents or field identity.
 */

/** Maximum characters retained for a page-controlled artifact string. */
export const MAX_VALUE_LENGTH = 2000;

/**
 * Length-caps a string and reports whether the returned value was truncated.
 * The retained prefix is byte-for-byte identical to the input.
 */
export function capString(value: string, max: number = MAX_VALUE_LENGTH): { value: string; capped: boolean } {
  if (value.length <= max) return { value, capped: false };
  return { value: value.slice(0, max), capped: true };
}

/**
 * Applies the shared artifact-string cap. The value is otherwise unchanged.
 * `opts.max` supplies a tighter field-specific bound when needed.
 */
export function sanitizeString(value: string, opts?: { max?: number }): string {
  return capString(value, opts?.max ?? MAX_VALUE_LENGTH).value;
}

/** Maximum characters in a filename-safe slug segment. */
export const MAX_FILENAME_SLUG_LENGTH = 80;

/**
 * Turns a page-controlled label into one filename-safe path segment by
 * replacing unsafe characters, collapsing/trimming dashes, and applying a
 * length cap. Content that is already filename-safe is preserved verbatim.
 */
export function sanitizeFilenameSlug(value: string, max: number = MAX_FILENAME_SLUG_LENGTH): string {
  const slug = value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > max ? slug.slice(0, max) : slug;
}

/**
 * Caps a page-controlled list and reports the number of omitted entries.
 */
export function capArray<T>(items: readonly T[], max: number): { items: T[]; truncated: number } {
  if (items.length <= max) return { items: [...items], truncated: 0 };
  return { items: items.slice(0, max), truncated: items.length - max };
}
