export interface Viewport {
  readonly width: number;
  readonly height: number;
}

const VIEWPORT_PATTERN = /^([1-9]\d*)x([1-9]\d*)$/;

/** Parses the one viewport grammar used by every live capture command. */
export function parseViewport(value: string): Viewport {
  const match = VIEWPORT_PATTERN.exec(value);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (Number.isSafeInteger(width) && Number.isSafeInteger(height)) {
      return { width, height };
    }
  }
  throw new Error(`--viewport must match <positive-safe-int>x<positive-safe-int> using lowercase x with no whitespace; received "${value}"`);
}
