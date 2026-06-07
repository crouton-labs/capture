/**
 * Vamo Profile
 *
 * Profile-level operations against /api/project/{projectId}/github-profile/{githubId}/...
 * and the global /api/user-top-repo and /api/match-reason endpoints.
 *
 * Auth is cookie-only (HttpOnly); fetch with credentials: 'include'.
 */

import { searchByUsername } from '../search';
import type {
  GetDeveloperProfileInput,
  GetDeveloperProfileOutput,
  GetDeveloperSynopsisInput,
  GetDeveloperSynopsisOutput,
  GetDeveloperInterestsInput,
  GetDeveloperInterestsOutput,
  RevealDeveloperContactsInput,
  RevealDeveloperContactsOutput,
  GetDeveloperTopRepoInput,
  GetDeveloperTopRepoOutput,
  GetMatchReasonInput,
  GetMatchReasonOutput,
  GetDeveloperContributionsInput,
  GetDeveloperContributionsOutput,
} from './schemas';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `${resp.status} ${resp.statusText} on ${url}: ${text.slice(0, 300)}`,
    );
  }
  return (await resp.json()) as T;
}

function profileBase(projectId: string, githubId: string): string {
  return `/api/project/${encodeURIComponent(projectId)}/github-profile/${encodeURIComponent(githubId)}`;
}

export async function getDeveloperProfile(
  args: GetDeveloperProfileInput,
): Promise<GetDeveloperProfileOutput> {
  const result = await searchByUsername({
    projectId: args.projectId,
    username: args.username,
    limit: 1,
  });
  const dev =
    result.seed ??
    result.developers.find(
      (d) =>
        typeof (d as { login?: string }).login === 'string' &&
        (d as { login: string }).login.toLowerCase() ===
          args.username.toLowerCase(),
    ) ??
    result.developers[0];
  if (!dev) {
    throw new Error(
      `getDeveloperProfile: GitHub user "${args.username}" not found`,
    );
  }
  return { developer: dev as Record<string, unknown> };
}

export async function getDeveloperSynopsis(
  args: GetDeveloperSynopsisInput,
): Promise<GetDeveloperSynopsisOutput> {
  return postJson<GetDeveloperSynopsisOutput>(
    `${profileBase(args.projectId, args.githubId)}/synopsis`,
    {},
  );
}

export async function getDeveloperInterests(
  args: GetDeveloperInterestsInput,
): Promise<GetDeveloperInterestsOutput> {
  return postJson<GetDeveloperInterestsOutput>(
    `${profileBase(args.projectId, args.githubId)}/analyze`,
    {},
  );
}

export async function revealDeveloperContacts(
  args: RevealDeveloperContactsInput,
): Promise<RevealDeveloperContactsOutput> {
  return postJson<RevealDeveloperContactsOutput>(
    `${profileBase(args.projectId, args.githubId)}/reveal`,
    {},
  );
}

export async function getDeveloperTopRepo(
  args: GetDeveloperTopRepoInput,
): Promise<GetDeveloperTopRepoOutput> {
  return postJson<GetDeveloperTopRepoOutput>('/api/user-top-repo', {
    githubId: args.githubId,
    excludeNames: args.excludeNames ?? [],
  });
}

export async function getMatchReason(
  args: GetMatchReasonInput,
): Promise<GetMatchReasonOutput> {
  return postJson<GetMatchReasonOutput>(
    `/api/match-reason/${encodeURIComponent(args.githubId)}`,
    {
      query: args.query,
      login: args.login,
      displayName: args.displayName ?? null,
      matchedRepositories: args.matchedRepositories,
    },
  );
}

export async function getDeveloperContributions(
  args: GetDeveloperContributionsInput,
): Promise<GetDeveloperContributionsOutput> {
  const url = `/api/github-profile/${encodeURIComponent(args.githubId)}/heatmap`;
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `getDeveloperContributions ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`,
    );
  }
  return (await resp.json()) as GetDeveloperContributionsOutput;
}
