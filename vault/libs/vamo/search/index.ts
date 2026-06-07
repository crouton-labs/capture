/**
 * Vamo Search
 *
 * Three flavors of developer search, all backed by
 * `GET /api/project/{projectId}/search-developers` (NDJSON stream).
 *
 * The endpoint validates `mode` against the literal set
 * `"skills" | "username" | "repo"`. Other params (`query`, `language`,
 * `location`, `professional`, `rawQuery`) are accepted as URL query string.
 * There is no separate pagination request — the stream delivers everything
 * in one response.
 *
 * Sort is applied client-side after the stream — the server ignores `sort`.
 */

import type {
  SearchBySkillsInput,
  SearchBySkillsOutput,
  SearchByUsernameInput,
  SearchByUsernameOutput,
  SearchByRepoInput,
  SearchByRepoOutput,
} from './schemas';

const DEFAULT_LIMIT = 100;

interface StreamEvent {
  type?: string;
  count?: number;
  hasMore?: boolean;
  totalCount?: number;
  cached?: boolean;
  query?: string;
  mode?: string;
  seed?: { login: string };
  isLanguageOnly?: boolean;
  cleanedSearchQuery?: string;
  extractedLocation?: string[];
  professional?: unknown;
  focusAreas?: unknown[];
  languages?: string[];
  badge?: string;
  id?: string;
  githubId?: string;
}

interface DeveloperRecord {
  id?: string;
  githubId?: string;
  login?: string;
  badge?: string;
  embeddedAt?: string;
  updatedAt?: string;
  ownerDevrank?: { crackedScore?: number } | null;
  matchScore?: { total?: number } | null;
  matchedRepositories?: Array<{ stargazerCount?: number }>;
  owns?: { edges?: Array<{ stargazerCount?: number }> };
  [key: string]: unknown;
}

interface StreamConsumeResult {
  developers: DeveloperRecord[];
  totalCount: number;
  hasMore: boolean;
  cached: boolean;
  extraction?: unknown;
  seed?: DeveloperRecord;
}

interface ProfessionalFilter {
  experienceTier?: 'junior' | 'senior' | null;
  companies?: string[] | null;
  companyIntent?: string | null;
  schools?: string[] | null;
  titles?: string[] | null;
}

type SortKey = 'relevant' | 'active' | 'stars' | 'cracked';

/**
 * Read NDJSON until either the stream ends, the metadata terminator arrives,
 * or we have collected `limit` developers. Cancels the response so the
 * server can stop generating.
 */
async function consumeStream(
  resp: Response,
  limit: number,
): Promise<StreamConsumeResult> {
  if (!resp.ok || !resp.body) {
    const body = await resp.text();
    throw new Error(
      `Vamo search ${resp.status} ${resp.statusText}: ${body.slice(0, 300)}`,
    );
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const developers: DeveloperRecord[] = [];
  let totalCount = 0;
  let hasMore = false;
  let cached = false;
  let extraction: unknown | undefined;
  let seed: DeveloperRecord | undefined;
  let metadataSeen = false;
  let cancelledForLimit = false;
  let lastCountTotal = 0;

  const handleObject = (obj: StreamEvent & Record<string, unknown>): void => {
    if (obj.type === 'started') {
      if (obj.cached !== undefined) cached = Boolean(obj.cached);
      return;
    }
    if (obj.type === 'extraction') {
      extraction = obj;
      return;
    }
    if (obj.type === 'count') {
      if (typeof obj.count === 'number') lastCountTotal = obj.count;
      if (typeof obj.hasMore === 'boolean') hasMore = obj.hasMore;
      return;
    }
    if (obj.type === 'metadata') {
      if (typeof obj.totalCount === 'number') totalCount = obj.totalCount;
      if (typeof obj.hasMore === 'boolean') hasMore = obj.hasMore;
      metadataSeen = true;
      return;
    }
    if (obj.id && obj.githubId) {
      const dev = obj as DeveloperRecord;
      if (dev.badge === 'seed') seed = dev;
      developers.push(dev);
    }
  };

  const flushBuffer = (final: boolean): boolean => {
    const lines = buffer.split('\n');
    buffer = final ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj: (StreamEvent & Record<string, unknown>) | null = null;
      try {
        obj = JSON.parse(line) as StreamEvent & Record<string, unknown>;
      } catch {
        continue;
      }
      handleObject(obj);
      if (limit > 0 && developers.length >= limit) {
        cancelledForLimit = true;
        return true;
      }
      if (metadataSeen) return true;
    }
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      flushBuffer(true);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (flushBuffer(false)) {
      try {
        await reader.cancel();
      } catch {
        // stream already closed; safe to ignore
      }
      break;
    }
  }

  if (cancelledForLimit) {
    hasMore = true;
    totalCount = Math.max(lastCountTotal, developers.length);
  } else if (!metadataSeen) {
    totalCount = Math.max(lastCountTotal, developers.length);
  }
  if (totalCount === 0) totalCount = developers.length;

  return { developers, totalCount, hasMore, cached, extraction, seed };
}

function devLocationString(
  d: DeveloperRecord & {
    location?: string | null;
    resolvedCity?: string | null;
    resolvedState?: string | null;
    resolvedCountry?: string | null;
  },
): string {
  return [d.location, d.resolvedCity, d.resolvedState, d.resolvedCountry]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' | ')
    .toLowerCase();
}

function applyClientSideFilters(
  developers: DeveloperRecord[],
  args: {
    location?: string;
    professional?: ProfessionalFilter;
  },
): DeveloperRecord[] {
  let out = developers;

  if (args.location && args.location.trim()) {
    const needle = args.location.trim().toLowerCase();
    out = out.filter((d) => {
      // Always keep the seed even if it doesn't match — caller asked for it.
      if (d.badge === 'seed') return true;
      return devLocationString(d).includes(needle);
    });
  }

  const p = args.professional;
  if (p) {
    const tier = p.experienceTier;
    const companies = (p.companies ?? []).map((c) => c.toLowerCase());
    const schools = (p.schools ?? []).map((s) => s.toLowerCase());
    const titles = (p.titles ?? []).map((t) => t.toLowerCase());
    const requireSomething =
      Boolean(tier) ||
      companies.length > 0 ||
      schools.length > 0 ||
      titles.length > 0;
    if (requireSomething) {
      out = out.filter((d) => {
        if (d.badge === 'seed') return true;
        const hasLI = (d as { hasLinkedIn?: boolean }).hasLinkedIn === true;
        if (!hasLI) return false;
        // We don't have full LinkedIn experience array on the search-result
        // shape, so honor what we do have:
        const sen = (
          (d as { linkedinSeniority?: string | null }).linkedinSeniority ?? ''
        ).toLowerCase();
        if (tier === 'senior') {
          // Server-side "senior" buckets these labels in:
          if (
            sen &&
            !['junior', 'student', 'entry', 'intern'].some((k) =>
              sen.includes(k),
            )
          ) {
            // accept
          } else if (sen) {
            return false;
          }
        }
        if (tier === 'junior') {
          if (
            !sen ||
            !['junior', 'student', 'entry', 'intern'].some((k) =>
              sen.includes(k),
            )
          )
            return false;
        }
        // Companies / schools / titles can't be reliably checked client-side
        // because the search-result shape only has `company` (free-text from
        // the GitHub profile, not LinkedIn). Document this in libraryNotes.
        return true;
      });
    }
  }

  return out;
}

function totalStars(d: DeveloperRecord): number {
  let total = 0;
  for (const repo of d.matchedRepositories ?? []) {
    if (typeof repo.stargazerCount === 'number') total += repo.stargazerCount;
  }
  for (const edge of d.owns?.edges ?? []) {
    if (typeof edge.stargazerCount === 'number') total += edge.stargazerCount;
  }
  return total;
}

function activityTimestamp(d: DeveloperRecord): number {
  const t = d.embeddedAt ?? d.updatedAt;
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function sortDevelopers(
  developers: DeveloperRecord[],
  sort: SortKey,
): DeveloperRecord[] {
  if (sort === 'relevant') return developers;
  // Always keep the seed (if any) at the top — that's what Vamo's UI does.
  const seedIdx = developers.findIndex((d) => d.badge === 'seed');
  const seed = seedIdx >= 0 ? developers[seedIdx] : null;
  const rest =
    seedIdx >= 0
      ? [...developers.slice(0, seedIdx), ...developers.slice(seedIdx + 1)]
      : [...developers];

  const score = (d: DeveloperRecord): number => {
    if (sort === 'stars') return totalStars(d);
    if (sort === 'cracked') return d.ownerDevrank?.crackedScore ?? -1;
    return activityTimestamp(d);
  };
  rest.sort((a, b) => score(b) - score(a));
  return seed ? [seed, ...rest] : rest;
}

function buildSearchUrl(
  projectId: string,
  params: Record<string, string>,
): string {
  const search = new URLSearchParams(params);
  return `/api/project/${encodeURIComponent(projectId)}/search-developers?${search.toString()}`;
}

function applyFilterParams(
  params: Record<string, string>,
  args: {
    location?: string;
    professional?: ProfessionalFilter;
  },
): void {
  if (args.location && args.location.trim()) {
    params.location = args.location.trim();
  }
  if (args.professional) {
    const p = args.professional;
    const hasAny =
      p.experienceTier ||
      (p.companies && p.companies.length) ||
      (p.schools && p.schools.length) ||
      (p.titles && p.titles.length);
    if (hasAny) {
      params.professional = JSON.stringify({
        experienceTier: p.experienceTier ?? null,
        companies: p.companies && p.companies.length ? p.companies : null,
        companyIntent: p.companyIntent ?? 'any',
        schools: p.schools && p.schools.length ? p.schools : null,
        titles: p.titles && p.titles.length ? p.titles : null,
      });
    }
  }
}

async function runSearch(
  projectId: string,
  params: Record<string, string>,
  limit: number,
): Promise<StreamConsumeResult> {
  const url = buildSearchUrl(projectId, params);
  const resp = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/x-ndjson, application/json' },
  });
  return consumeStream(resp, limit);
}

export async function searchBySkills(
  args: SearchBySkillsInput,
): Promise<SearchBySkillsOutput> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const sort: SortKey = args.sort ?? 'relevant';
  const params: Record<string, string> = {
    query: args.query,
    rawQuery: args.query,
    mode: 'skills',
  };
  if (args.languages && args.languages.length) {
    params.language = args.languages.join(',');
  }
  applyFilterParams(params, args);
  const result = await runSearch(args.projectId, params, limit);
  result.developers = sortDevelopers(result.developers, sort);
  return result as unknown as SearchBySkillsOutput;
}

export async function searchByUsername(
  args: SearchByUsernameInput,
): Promise<SearchByUsernameOutput> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const sort: SortKey = args.sort ?? 'relevant';
  const username = args.username.replace(/^@/, '').trim();
  if (!username) throw new Error('searchByUsername: username is required');
  const params: Record<string, string> = {
    query: username,
    mode: 'username',
  };
  // Server ignores location/professional in username mode — over-fetch and
  // filter locally so the lib's filter surface is uniform across modes.
  const overFetch =
    args.location || args.professional ? Math.max(limit * 4, 200) : limit;
  const result = await runSearch(args.projectId, params, overFetch);
  result.developers = applyClientSideFilters(result.developers, args);
  result.developers = sortDevelopers(result.developers, sort);
  if (limit > 0 && result.developers.length > limit) {
    result.developers = result.developers.slice(0, limit);
  }
  return result as unknown as SearchByUsernameOutput;
}

export async function searchByRepo(
  args: SearchByRepoInput,
): Promise<SearchByRepoOutput> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const sort: SortKey = args.sort ?? 'relevant';
  let repoUrl = args.repoUrl.trim();
  if (!repoUrl) throw new Error('searchByRepo: repoUrl is required');
  if (!/^https?:\/\//i.test(repoUrl)) {
    repoUrl = `https://github.com/${repoUrl.replace(/^\/+/, '')}`;
  }
  const params: Record<string, string> = {
    query: repoUrl,
    mode: 'repo',
  };
  const overFetch =
    args.location || args.professional ? Math.max(limit * 4, 200) : limit;
  const result = await runSearch(args.projectId, params, overFetch);
  result.developers = applyClientSideFilters(result.developers, args);
  result.developers = sortDevelopers(result.developers, sort);
  if (limit > 0 && result.developers.length > limit) {
    result.developers = result.developers.slice(0, limit);
  }
  return result as unknown as SearchByRepoOutput;
}
