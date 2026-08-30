import { type ParsedArgs } from '../cdp/types.js';

/** Select the final stdout record set after a leaf has applied its own semantic filters and stable ordering. */
export function selectRecords<T>(records: readonly T[], parsed: Pick<ParsedArgs, 'limit'>, defaultLimit: number): T[] {
  return records.slice(0, parsed.limit ?? defaultLimit);
}
