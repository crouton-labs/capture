export const LIVE_CHROME = process.env.CAPTURE_LIVE_CHROME === '1';
export const liveChromeOpts = { skip: LIVE_CHROME ? false : 'real-Chrome live case — runs under npm run test:live (option-(c) environment ruling)' } as const;
