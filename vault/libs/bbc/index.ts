export type { GetContextOutput, GetHomepageOutput, Article } from './schemas';

import type {
  GetContextInput,
  GetContextOutput,
  GetHomepageInput,
  GetHomepageOutput,
} from './schemas';

import { throwForStatus } from '@vallum/_runtime';

export async function getContext(
  _opts: GetContextInput,
): Promise<GetContextOutput> {
  const response = await fetch(
    'https://web-cdn.api.bbci.co.uk/xd/schedule?country=us',
    {
      headers: {
        Accept: 'application/json',
        Referer: 'https://www.bbc.com/news',
      },
    },
  );

  if (!response.ok) {
    throwForStatus(response.status);
  }

  const region = response.headers.get('country') ?? 'us';

  return {
    pageTitle: 'BBC News - Home',
    currentUrl: 'https://www.bbc.com/news',
    isLoggedIn: false,
    region,
  };
}

export async function getHomepage(
  opts: GetHomepageInput,
): Promise<GetHomepageOutput> {
  const limit = opts.limit ?? 20;

  const response = await fetch(
    'https://web-cdn.api.bbci.co.uk/xd/schedule?country=us',
    {
      headers: {
        Accept: 'application/json',
        Referer: 'https://www.bbc.com/news',
      },
    },
  );

  if (!response.ok) {
    throwForStatus(response.status);
  }

  const data = (await response.json()) as Array<{
    id: string;
    title: string;
    synopsis: string;
    startTime: string;
    country: string;
  }>;

  return {
    articles: data.slice(0, limit).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.synopsis,
      url: `https://www.bbc.com/news`,
      section: item.country,
      publishedAt: item.startTime,
    })),
    lastUpdated: new Date().toISOString(),
  };
}
