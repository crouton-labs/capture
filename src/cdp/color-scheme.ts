import type { CDPClient } from './client.js';

export type ColorScheme = 'dark' | 'light';

type MediaClient = Pick<CDPClient, 'send'>;

export function parseColorScheme(value: string | undefined): ColorScheme | undefined {
  if (value === undefined) return undefined;
  if (value === 'dark' || value === 'light') return value;
  throw new Error('--color-scheme must be dark or light');
}

/** Applies one media-feature override only for the supplied capture operation. */
export async function withAppliedColorScheme<T>(client: MediaClient, colorScheme: ColorScheme | undefined, fn: () => Promise<T>): Promise<T> {
  if (!colorScheme) return fn();
  let ownsMediaOverride = false;
  let primaryFailed = false;
  let primaryError: unknown;
  try {
    // A rejected response does not prove Chrome rejected the request. Claim
    // cleanup responsibility before awaiting it, just as viewport capture does.
    ownsMediaOverride = true;
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: colorScheme }],
    });
    return await fn();
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
    throw error;
  } finally {
    if (ownsMediaOverride) {
      try {
        await client.send('Emulation.setEmulatedMedia', { features: [] });
      } catch (cleanupError) {
        if (primaryFailed) {
          throw new AggregateError(
            [primaryError, cleanupError],
            'Color-scheme capture failed and media-emulation cleanup also failed.',
            { cause: primaryError },
          );
        }
        throw cleanupError;
      }
    }
  }
}
