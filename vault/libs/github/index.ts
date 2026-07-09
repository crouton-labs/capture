import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

export type {
  GitHubCommit,
  GitHubContributorStats,
  GitHubIssue,
  GitHubOrg,
  GitHubReadme,
  GitHubRepo,
  GitHubUser,
  GetOrgInput,
  GetOrgOutput,
  GetReadmeInput,
  GetReadmeOutput,
  GetRepoInput,
  GetRepoOutput,
  GetUserInput,
  GetUserOutput,
  ListCommitsInput,
  ListCommitsOutput,
  ListContributorsInput,
  ListContributorsOutput,
  ListFollowersInput,
  ListFollowersOutput,
  ListIssuesInput,
  ListIssuesOutput,
  ListLanguagesInput,
  ListLanguagesOutput,
  ListOrgsInput,
  ListOrgsOutput,
  ListOrgReposInput,
  ListOrgReposOutput,
  ListReleasesInput,
  ListReleasesOutput,
  ListUserReposInput,
  ListUserReposOutput,
  SearchReposInput,
  SearchReposOutput,
  SearchUsersInput,
  SearchUsersOutput,
} from './schemas';

import type {
  GitHubCommit,
  GitHubContributorStats,
  GitHubIssue,
  GitHubOrg,
  GitHubReadme,
  GitHubRepo,
  GitHubUser,
  GetOrgInput,
  GetOrgOutput,
  GetReadmeInput,
  GetReadmeOutput,
  GetRepoInput,
  GetRepoOutput,
  GetUserInput,
  GetUserOutput,
  ListCommitsInput,
  ListCommitsOutput,
  ListContributorsInput,
  ListContributorsOutput,
  ListFollowersInput,
  ListFollowersOutput,
  ListIssuesInput,
  ListIssuesOutput,
  ListLanguagesInput,
  ListLanguagesOutput,
  ListOrgsInput,
  ListOrgsOutput,
  ListOrgReposInput,
  ListOrgReposOutput,
  ListReleasesInput,
  ListReleasesOutput,
  ListUserReposInput,
  ListUserReposOutput,
  SearchReposInput,
  SearchReposOutput,
  SearchUsersInput,
  SearchUsersOutput,
} from './schemas';

const API_ORIGIN = 'https://api.github.com';
const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

type RawObject = Record<string, unknown>;

type RequestResult = { status: number; statusText: string; headers: Headers; text: string };

function requiredText(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new ContractDrift(`${context} must be a string`);
  }
  const text = value.trim();
  if (!text) {
    throw new ContractDrift(`${context} must be a non-empty string`);
  }
  return text;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ContractDrift('Optional GitHub text field must be a string when present');
  }
  return value;
}

function boolValue(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ContractDrift(`${context} must be a boolean`);
  }
  return value;
}

function optionalBool(value: unknown, context: string): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'boolean') {
    throw new ContractDrift(`${context} must be a boolean when present`);
  }
  return value;
}

function numberValue(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContractDrift(`${context} must be a number`);
  }
  return value;
}

function intValue(value: unknown, context: string): number {
  const n = numberValue(value, context);
  if (!Number.isInteger(n)) {
    throw new ContractDrift(`${context} must be an integer`);
  }
  return n;
}

function arrayValue(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ContractDrift(`${context} must be an array`);
  }
  return value;
}

function objectValue(value: unknown, context: string): RawObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractDrift(`${context} must be an object`);
  }
  return value as RawObject;
}

function trim(value: string): string {
  return value.trim();
}

function normalizePage(page?: number): number {
  if (page === undefined) {
    return 1;
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new Validation(`page must be a positive integer. Current value: ${String(page)}`);
  }
  return page;
}

function normalizePerPage(perPage?: number): number {
  if (perPage === undefined) {
    return 30;
  }
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
    throw new Validation(`perPage must be an integer between 1 and 100. Current value: ${String(perPage)}`);
  }
  return perPage;
}

function normalizeLogin(value: string, label: string): string {
  const text = trim(value);
  if (!text) {
    throw new Validation(`${label} is required`);
  }
  return text;
}

function repoUrl(owner: string, repo: string, suffix = ''): string {
  return `${API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

function userUrl(login: string, suffix = ''): string {
  return `${API_ORIGIN}/users/${encodeURIComponent(login)}${suffix}`;
}

function orgUrl(org: string, suffix = ''): string {
  return `${API_ORIGIN}/orgs/${encodeURIComponent(org)}${suffix}`;
}

async function fetchResponse(url: string, init: RequestInit): Promise<RequestResult> {
  const response = await fetch(url, {
    ...init,
    credentials: 'omit',
    headers: {
      ...API_HEADERS,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text().catch(() => '');
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    text,
  };
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const result = await fetchResponse(url, init);
  if (!result.text) {
    if (result.status >= 200 && result.status < 300) {
      return null;
    }
    throwForStatus(result.status, `GitHub request failed. URL: ${url} Status: ${result.status} ${result.statusText}`);
  }
  if (result.status >= 200 && result.status < 300) {
    try {
      return JSON.parse(result.text) as unknown;
    } catch {
      throw new ContractDrift(`GitHub returned non-JSON content. URL: ${url} Body: ${result.text.slice(0, 500)}`);
    }
  }
  throwForStatus(result.status, `GitHub request failed. URL: ${url} Status: ${result.status} ${result.statusText}. Body: ${result.text.slice(0, 500)}`);
}

function parseLinkHeader(value: string | null): Record<string, string> {
  if (!value) {
    return {};
  }
  const links: Record<string, string> = {};
  for (const part of value.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      links[match[2]] = match[1];
    }
  }
  return links;
}

function nextPageFromLinks(linkHeader: string | null): number | null {
  const next = parseLinkHeader(linkHeader).next;
  if (!next) {
    return null;
  }
  try {
    return Number(new URL(next).searchParams.get('page')) || null;
  } catch {
    return null;
  }
}

function pagingFromArray(page: number, perPage: number, returned: number, linkHeader: string | null, totalCount: number | null = null, incompleteResults: boolean | null = null) {
  const nextPage = nextPageFromLinks(linkHeader);
  const hasNextPage = nextPage !== null ? true : returned === perPage;
  return {
    page,
    perPage,
    returned,
    hasNextPage,
    nextPage: nextPage ?? (hasNextPage ? page + 1 : null),
    totalCount,
    incompleteResults,
  };
}

function normalizeAccount(raw: unknown, context: string): import('./schemas').GitHubAccount {
  const obj = objectValue(raw, context);
  return {
    login: requiredText(obj.login, `${context}.login`),
    id: intValue(obj.id, `${context}.id`),
    nodeId: requiredText(obj.node_id ?? obj.nodeId, `${context}.node_id`),
    avatarUrl: requiredText(obj.avatar_url ?? obj.avatarUrl, `${context}.avatar_url`),
    htmlUrl: requiredText(obj.html_url ?? obj.htmlUrl, `${context}.html_url`),
    apiUrl: requiredText(obj.url, `${context}.url`),
    type: requiredText(obj.type, `${context}.type`),
    siteAdmin: optionalBool(obj.site_admin ?? obj.siteAdmin, `${context}.site_admin`) ?? false,
  };
}

function normalizeUser(raw: unknown, context: string): GitHubUser {
  const account = normalizeAccount(raw, context);
  const obj = objectValue(raw, context);
  return {
    ...account,
    name: optionalText(obj.name),
    company: optionalText(obj.company),
    blog: optionalText(obj.blog),
    location: optionalText(obj.location),
    email: optionalText(obj.email),
    hireable: optionalBool(obj.hireable, `${context}.hireable`),
    bio: optionalText(obj.bio),
    twitterUsername: optionalText(obj.twitter_username ?? obj.twitterUsername),
    publicRepos: typeof obj.public_repos === 'number' ? obj.public_repos : null,
    publicGists: typeof obj.public_gists === 'number' ? obj.public_gists : null,
    followers: typeof obj.followers === 'number' ? obj.followers : null,
    following: typeof obj.following === 'number' ? obj.following : null,
    organizationsUrl: requiredText(obj.organizations_url, `${context}.organizations_url`),
    reposUrl: requiredText(obj.repos_url, `${context}.repos_url`),
    eventsUrl: requiredText(obj.events_url, `${context}.events_url`),
    receivedEventsUrl: requiredText(obj.received_events_url, `${context}.received_events_url`),
    createdAt: requiredText(obj.created_at, `${context}.created_at`),
    updatedAt: requiredText(obj.updated_at, `${context}.updated_at`),
  };
}

function normalizeOrg(raw: unknown, context: string): GitHubOrg {
  const obj = objectValue(raw, context);
  return {
    login: requiredText(obj.login, `${context}.login`),
    id: intValue(obj.id, `${context}.id`),
    nodeId: requiredText(obj.node_id ?? obj.nodeId, `${context}.node_id`),
    avatarUrl: requiredText(obj.avatar_url ?? obj.avatarUrl, `${context}.avatar_url`),
    htmlUrl: requiredText(obj.html_url ?? obj.htmlUrl, `${context}.html_url`),
    apiUrl: requiredText(obj.url, `${context}.url`),
    type: requiredText(obj.type, `${context}.type`),
    siteAdmin: optionalBool(obj.site_admin ?? obj.siteAdmin, `${context}.site_admin`) ?? false,
    description: optionalText(obj.description),
    name: optionalText(obj.name),
    company: optionalText(obj.company),
    blog: optionalText(obj.blog),
    location: optionalText(obj.location),
    email: optionalText(obj.email),
    twitterUsername: optionalText(obj.twitter_username ?? obj.twitterUsername),
    isVerified: boolValue(obj.is_verified ?? obj.isVerified, `${context}.is_verified`),
    hasOrganizationProjects: boolValue(obj.has_organization_projects ?? obj.hasOrganizationProjects, `${context}.has_organization_projects`),
    hasRepositoryProjects: boolValue(obj.has_repository_projects ?? obj.hasRepositoryProjects, `${context}.has_repository_projects`),
    publicRepos: typeof obj.public_repos === 'number' ? obj.public_repos : null,
    publicGists: typeof obj.public_gists === 'number' ? obj.public_gists : null,
    followers: typeof obj.followers === 'number' ? obj.followers : null,
    following: typeof obj.following === 'number' ? obj.following : null,
    createdAt: requiredText(obj.created_at, `${context}.created_at`),
    updatedAt: requiredText(obj.updated_at, `${context}.updated_at`),
    archivedAt: optionalText(obj.archived_at ?? obj.archivedAt),
  };
}

function normalizeRepo(raw: unknown, context: string): GitHubRepo {
  const obj = objectValue(raw, context);
  return {
    id: intValue(obj.id, `${context}.id`),
    nodeId: requiredText(obj.node_id ?? obj.nodeId, `${context}.node_id`),
    name: requiredText(obj.name, `${context}.name`),
    fullName: requiredText(obj.full_name ?? obj.fullName, `${context}.full_name`),
    private: boolValue(obj.private, `${context}.private`),
    owner: normalizeAccount(obj.owner, `${context}.owner`),
    htmlUrl: requiredText(obj.html_url ?? obj.htmlUrl, `${context}.html_url`),
    apiUrl: requiredText(obj.url, `${context}.url`),
    description: optionalText(obj.description),
    fork: boolValue(obj.fork, `${context}.fork`),
    defaultBranch: optionalText(obj.default_branch ?? obj.defaultBranch),
    language: optionalText(obj.language),
    languagesUrl: requiredText(obj.languages_url ?? obj.languagesUrl, `${context}.languages_url`),
    stargazersCount: typeof obj.stargazers_count === 'number' ? obj.stargazers_count : null,
    watchersCount: typeof obj.watchers_count === 'number' ? obj.watchers_count : null,
    forksCount: typeof obj.forks_count === 'number' ? obj.forks_count : null,
    openIssuesCount: typeof obj.open_issues_count === 'number' ? obj.open_issues_count : null,
    topics: Array.isArray(obj.topics) ? obj.topics.map((item, index) => requiredText(item, `${context}.topics[${index}]`)) : [],
    visibility: optionalText(obj.visibility),
    archived: boolValue(obj.archived, `${context}.archived`),
    disabled: boolValue(obj.disabled, `${context}.disabled`),
    homepage: optionalText(obj.homepage),
    createdAt: requiredText(obj.created_at, `${context}.created_at`),
    updatedAt: requiredText(obj.updated_at, `${context}.updated_at`),
    pushedAt: optionalText(obj.pushed_at ?? obj.pushedAt),
    hasIssues: boolValue(obj.has_issues ?? obj.hasIssues, `${context}.has_issues`),
    hasProjects: boolValue(obj.has_projects ?? obj.hasProjects, `${context}.has_projects`),
    hasDownloads: boolValue(obj.has_downloads ?? obj.hasDownloads, `${context}.has_downloads`),
    hasWiki: boolValue(obj.has_wiki ?? obj.hasWiki, `${context}.has_wiki`),
    hasPages: boolValue(obj.has_pages ?? obj.hasPages, `${context}.has_pages`),
    isTemplate: boolValue(obj.is_template ?? obj.isTemplate, `${context}.is_template`),
    license: obj.license === null || obj.license === undefined ? null : {
      key: optionalText(objectValue(obj.license, `${context}.license`).key),
      name: optionalText(objectValue(obj.license, `${context}.license`).name),
      spdxId: optionalText(objectValue(obj.license, `${context}.license`).spdx_id ?? objectValue(obj.license, `${context}.license`).spdxId),
      url: optionalText(objectValue(obj.license, `${context}.license`).url),
      nodeId: optionalText(objectValue(obj.license, `${context}.license`).node_id ?? objectValue(obj.license, `${context}.license`).nodeId),
    },
  };
}

function normalizeIssue(raw: unknown, context: string): GitHubIssue {
  const obj = objectValue(raw, context);
  const pullRequest = obj.pull_request && typeof obj.pull_request === 'object' ? (obj.pull_request as RawObject) : null;
  const assignees = Array.isArray(obj.assignees) ? obj.assignees.map((item, index) => normalizeAccount(item, `${context}.assignees[${index}]`)) : [];
  const labels = Array.isArray(obj.labels)
    ? obj.labels.map((label, index) => {
        const l = objectValue(label, `${context}.labels[${index}]`);
        return {
          id: intValue(l.id, `${context}.labels[${index}].id`),
          nodeId: requiredText(l.node_id ?? l.nodeId, `${context}.labels[${index}].node_id`),
          url: requiredText(l.url, `${context}.labels[${index}].url`),
          name: requiredText(l.name, `${context}.labels[${index}].name`),
          color: requiredText(l.color, `${context}.labels[${index}].color`),
          default: boolValue(l.default, `${context}.labels[${index}].default`),
          description: optionalText(l.description),
        };
      })
    : [];

  return {
    url: requiredText(obj.url, `${context}.url`),
    repositoryUrl: requiredText(obj.repository_url ?? obj.repositoryUrl, `${context}.repository_url`),
    htmlUrl: requiredText(obj.html_url ?? obj.htmlUrl, `${context}.html_url`),
    id: intValue(obj.id, `${context}.id`),
    nodeId: requiredText(obj.node_id ?? obj.nodeId, `${context}.node_id`),
    number: intValue(obj.number, `${context}.number`),
    title: requiredText(obj.title, `${context}.title`),
    user: obj.user ? normalizeAccount(obj.user, `${context}.user`) : null,
    labels,
    state: requiredText(obj.state, `${context}.state`),
    locked: boolValue(obj.locked, `${context}.locked`),
    comments: intValue(obj.comments, `${context}.comments`),
    createdAt: requiredText(obj.created_at, `${context}.created_at`),
    updatedAt: requiredText(obj.updated_at, `${context}.updated_at`),
    closedAt: optionalText(obj.closed_at ?? obj.closedAt),
    body: optionalText(obj.body),
    assignee: obj.assignee ? normalizeAccount(obj.assignee, `${context}.assignee`) : null,
    assignees,
    milestone: obj.milestone ?? null,
    authorAssociation: requiredText(obj.author_association ?? obj.authorAssociation, `${context}.author_association`),
    stateReason: optionalText(obj.state_reason ?? obj.stateReason),
    activeLockReason: optionalText(obj.active_lock_reason ?? obj.activeLockReason),
    pullRequestUrl: pullRequest ? optionalText(pullRequest.url ?? pullRequest.html_url ?? pullRequest.htmlUrl) ?? requiredText(String(pullRequest.url ?? ''), `${context}.pull_request.url`) : null,
    isPullRequest: Boolean(pullRequest),
  };
}

function normalizeRelease(raw: unknown, context: string) {
  const obj = objectValue(raw, context);
  const assets = Array.isArray(obj.assets)
    ? obj.assets.map((asset, index) => {
        const a = objectValue(asset, `${context}.assets[${index}]`);
        return {
          id: intValue(a.id, `${context}.assets[${index}].id`),
          nodeId: requiredText(a.node_id ?? a.nodeId, `${context}.assets[${index}].node_id`),
          name: requiredText(a.name, `${context}.assets[${index}].name`),
          label: optionalText(a.label),
          state: requiredText(a.state, `${context}.assets[${index}].state`),
          contentType: requiredText(a.content_type ?? a.contentType, `${context}.assets[${index}].content_type`),
          size: intValue(a.size, `${context}.assets[${index}].size`),
          downloadCount: intValue(a.download_count ?? a.downloadCount, `${context}.assets[${index}].download_count`),
          browserDownloadUrl: optionalText(a.browser_download_url ?? a.browserDownloadUrl),
          url: requiredText(a.url, `${context}.assets[${index}].url`),
          createdAt: requiredText(a.created_at, `${context}.assets[${index}].created_at`),
          updatedAt: requiredText(a.updated_at, `${context}.assets[${index}].updated_at`),
          uploader: a.uploader ? normalizeAccount(a.uploader, `${context}.assets[${index}].uploader`) : null,
        };
      })
    : [];

  return {
    url: requiredText(obj.url, `${context}.url`),
    assetsUrl: requiredText(obj.assets_url ?? obj.assetsUrl, `${context}.assets_url`),
    uploadUrl: requiredText(obj.upload_url ?? obj.uploadUrl, `${context}.upload_url`),
    htmlUrl: requiredText(obj.html_url ?? obj.htmlUrl, `${context}.html_url`),
    id: intValue(obj.id, `${context}.id`),
    author: obj.author ? normalizeAccount(obj.author, `${context}.author`) : null,
    nodeId: requiredText(obj.node_id ?? obj.nodeId, `${context}.node_id`),
    tagName: requiredText(obj.tag_name ?? obj.tagName, `${context}.tag_name`),
    targetCommitish: requiredText(obj.target_commitish ?? obj.targetCommitish, `${context}.target_commitish`),
    name: optionalText(obj.name),
    draft: boolValue(obj.draft, `${context}.draft`),
    immutable: boolValue(obj.immutable, `${context}.immutable`),
    prerelease: boolValue(obj.prerelease, `${context}.prerelease`),
    createdAt: requiredText(obj.created_at, `${context}.created_at`),
    updatedAt: requiredText(obj.updated_at, `${context}.updated_at`),
    publishedAt: optionalText(obj.published_at ?? obj.publishedAt),
    assets,
    tarballUrl: requiredText(obj.tarball_url ?? obj.tarballUrl, `${context}.tarball_url`),
    zipballUrl: requiredText(obj.zipball_url ?? obj.zipballUrl, `${context}.zipball_url`),
    body: optionalText(obj.body),
    reactions: obj.reactions ?? null,
  };
}

function normalizeCommit(raw: unknown, context: string): GitHubCommit {
  const obj = objectValue(raw, context);
  const commit = objectValue(obj.commit, `${context}.commit`);
  const commitAuthor = commit.author ? objectValue(commit.author, `${context}.commit.author`) : null;
  const commitCommitter = commit.committer ? objectValue(commit.committer, `${context}.commit.committer`) : null;
  const parents = Array.isArray(obj.parents)
    ? obj.parents.map((parent, index) => {
        const p = objectValue(parent, `${context}.parents[${index}]`);
        return {
          sha: requiredText(p.sha, `${context}.parents[${index}].sha`),
          url: requiredText(p.url, `${context}.parents[${index}].url`),
          htmlUrl: requiredText(p.html_url ?? p.htmlUrl, `${context}.parents[${index}].html_url`),
        };
      })
    : [];

  return {
    sha: requiredText(obj.sha, `${context}.sha`),
    nodeId: requiredText(obj.node_id ?? obj.nodeId, `${context}.node_id`),
    htmlUrl: requiredText(obj.html_url ?? obj.htmlUrl, `${context}.html_url`),
    apiUrl: requiredText(obj.url, `${context}.url`),
    commit: {
      author: commitAuthor
        ? {
            name: requiredText(commitAuthor.name, `${context}.commit.author.name`),
            email: requiredText(commitAuthor.email, `${context}.commit.author.email`),
            date: requiredText(commitAuthor.date, `${context}.commit.author.date`),
            login: optionalText(commitAuthor.login),
            id: typeof commitAuthor.id === 'number' ? commitAuthor.id : null,
            nodeId: optionalText(commitAuthor.node_id ?? commitAuthor.nodeId),
            avatarUrl: optionalText(commitAuthor.avatar_url ?? commitAuthor.avatarUrl),
            htmlUrl: optionalText(commitAuthor.html_url ?? commitAuthor.htmlUrl),
            type: optionalText(commitAuthor.type),
            siteAdmin: optionalBool(commitAuthor.site_admin ?? commitAuthor.siteAdmin, `${context}.commit.author.site_admin`),
          }
        : null,
      committer: commitCommitter
        ? {
            name: requiredText(commitCommitter.name, `${context}.commit.committer.name`),
            email: requiredText(commitCommitter.email, `${context}.commit.committer.email`),
            date: requiredText(commitCommitter.date, `${context}.commit.committer.date`),
            login: optionalText(commitCommitter.login),
            id: typeof commitCommitter.id === 'number' ? commitCommitter.id : null,
            nodeId: optionalText(commitCommitter.node_id ?? commitCommitter.nodeId),
            avatarUrl: optionalText(commitCommitter.avatar_url ?? commitCommitter.avatarUrl),
            htmlUrl: optionalText(commitCommitter.html_url ?? commitCommitter.htmlUrl),
            type: optionalText(commitCommitter.type),
            siteAdmin: optionalBool(commitCommitter.site_admin ?? commitCommitter.siteAdmin, `${context}.commit.committer.site_admin`),
          }
        : null,
      message: requiredText(commit.message, `${context}.commit.message`),
    },
    author: obj.author ? normalizeAccount(obj.author, `${context}.author`) : null,
    committer: obj.committer ? normalizeAccount(obj.committer, `${context}.committer`) : null,
    parents,
    commentsUrl: requiredText(obj.comments_url ?? obj.commentsUrl, `${context}.comments_url`),
    commentCount: intValue(obj.comment_count ?? obj.commentCount, `${context}.comment_count`),
  };
}

function normalizeContributor(raw: unknown, context: string): GitHubContributorStats {
  const obj = objectValue(raw, context);
  const author = obj.author ? normalizeAccount(obj.author, `${context}.author`) : null;
  return {
    author,
    total: intValue(obj.total, `${context}.total`),
    weeks: arrayValue(obj.weeks, `${context}.weeks`).map((week, index) => {
      const w = objectValue(week, `${context}.weeks[${index}]`);
      return {
        week: intValue(w.w, `${context}.weeks[${index}].w`),
        additions: intValue(w.a, `${context}.weeks[${index}].a`),
        deletions: intValue(w.d, `${context}.weeks[${index}].d`),
        commits: intValue(w.c, `${context}.weeks[${index}].c`),
      };
    }),
  };
}

function decodeReadmeContent(content: string): string {
  const compact = content.replace(/\s+/g, '');
  if (!compact) {
    return '';
  }
  if (typeof atob === 'function') {
    return atob(compact);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(compact, 'base64').toString('utf8');
  }
  throw new ContractDrift('No base64 decoder available for GitHub README content');
}

function readmeTitle(decodedContent: string, repo: string): string {
  const heading = decodedContent.split(/\r?\n/).find((line) => line.trim().startsWith('# '));
  if (heading) {
    return heading.replace(/^#\s+/, '').trim();
  }
  return repo;
}

function normalizeReadme(raw: unknown, repo: string, context: string): GitHubReadme {
  const obj = objectValue(raw, context);
  const content = requiredText(obj.content, `${context}.content`);
  const decodedContent = decodeReadmeContent(content);
  return {
    name: requiredText(obj.name, `${context}.name`),
    path: requiredText(obj.path, `${context}.path`),
    sha: requiredText(obj.sha, `${context}.sha`),
    size: intValue(obj.size, `${context}.size`),
    url: requiredText(obj.url, `${context}.url`),
    htmlUrl: requiredText(obj.html_url ?? obj.htmlUrl, `${context}.html_url`),
    gitUrl: requiredText(obj.git_url ?? obj.gitUrl, `${context}.git_url`),
    downloadUrl: optionalText(obj.download_url ?? obj.downloadUrl),
    type: requiredText(obj.type, `${context}.type`),
    content,
    decodedContent,
    encoding: requiredText(obj.encoding, `${context}.encoding`),
    title: readmeTitle(decodedContent, repo),
  };
}

function buildPaging(page: number, perPage: number, returned: number, linkHeader: string | null, totalCount: number | null = null, incompleteResults: boolean | null = null) {
  return pagingFromArray(page, perPage, returned, linkHeader, totalCount, incompleteResults);
}

async function getJson(url: string, init: RequestInit): Promise<{ body: unknown; headers: Headers }> {
  const response = await fetchResponse(url, init);
  if (response.status >= 200 && response.status < 300) {
    if (!response.text) {
      return { body: null, headers: response.headers };
    }
    try {
      return { body: JSON.parse(response.text) as unknown, headers: response.headers };
    } catch {
      throw new ContractDrift(`GitHub returned non-JSON content. URL: ${url} Body: ${response.text.slice(0, 500)}`);
    }
  }
  throwForStatus(response.status, `GitHub request failed. URL: ${url} Status: ${response.status} ${response.statusText}. Body: ${response.text.slice(0, 500)}`);
}

async function getStatsContributors(url: string): Promise<{ body: unknown; headers: Headers }> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetchResponse(url, { method: 'GET' });
    if (response.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (response.status >= 200 && response.status < 300) {
      if (!response.text) {
        return { body: null, headers: response.headers };
      }
      try {
        return { body: JSON.parse(response.text) as unknown, headers: response.headers };
      } catch {
        throw new ContractDrift(`GitHub returned non-JSON content. URL: ${url} Body: ${response.text.slice(0, 500)}`);
      }
    }
    throwForStatus(response.status, `GitHub request failed. URL: ${url} Status: ${response.status} ${response.statusText}. Body: ${response.text.slice(0, 500)}`);
  }
  throw new ContractDrift(`GitHub stats contributors never left 202 Accepted. URL: ${url}`);
}

export async function getUser(opts: GetUserInput): Promise<GetUserOutput> {
  const login = normalizeLogin(opts.login, 'login');
  const { body } = await getJson(userUrl(login), { method: 'GET' });
  return { user: normalizeUser(body, 'GitHub user') };
}

export async function listUserRepos(opts: ListUserReposInput): Promise<ListUserReposOutput> {
  const login = normalizeLogin(opts.login, 'login');
  const page = normalizePage(opts.page);
  const perPage = normalizePerPage(opts.perPage);
  const url = `${userUrl(login, '/repos')}?page=${page}&per_page=${perPage}`;
  const { body, headers } = await getJson(url, { method: 'GET' });
  const repositories = arrayValue(body, 'GitHub user repos').map((item, index) => normalizeRepo(item, `GitHub user repos[${index}]`));
  return {
    login,
    repositories,
    paging: buildPaging(page, perPage, repositories.length, headers.get('link')),
  };
}

export async function listOrgs(opts: ListOrgsInput): Promise<ListOrgsOutput> {
  const login = normalizeLogin(opts.login, 'login');
  const page = normalizePage(opts.page);
  const perPage = normalizePerPage(opts.perPage);
  const url = `${userUrl(login, '/orgs')}?page=${page}&per_page=${perPage}`;
  const { body, headers } = await getJson(url, { method: 'GET' });
  const organizations = arrayValue(body, 'GitHub user orgs').map((item, index) => normalizeOrg(item, `GitHub user orgs[${index}]`));
  return {
    login,
    organizations,
    paging: buildPaging(page, perPage, organizations.length, headers.get('link')),
  };
}

export async function getOrg(opts: GetOrgInput): Promise<GetOrgOutput> {
  const org = normalizeLogin(opts.org, 'org');
  const { body } = await getJson(orgUrl(org), { method: 'GET' });
  return { org: normalizeOrg(body, 'GitHub org') };
}

export async function listOrgRepos(opts: ListOrgReposInput): Promise<ListOrgReposOutput> {
  const org = normalizeLogin(opts.org, 'org');
  const page = normalizePage(opts.page);
  const perPage = normalizePerPage(opts.perPage);
  const url = `${orgUrl(org, '/repos')}?page=${page}&per_page=${perPage}`;
  const { body, headers } = await getJson(url, { method: 'GET' });
  const repositories = arrayValue(body, 'GitHub org repos').map((item, index) => normalizeRepo(item, `GitHub org repos[${index}]`));
  return {
    org,
    repositories,
    paging: buildPaging(page, perPage, repositories.length, headers.get('link')),
  };
}

export async function getRepo(opts: GetRepoInput): Promise<GetRepoOutput> {
  const owner = normalizeLogin(opts.owner, 'owner');
  const repo = normalizeLogin(opts.repo, 'repo');
  const { body } = await getJson(repoUrl(owner, repo), { method: 'GET' });
  return { repo: normalizeRepo(body, 'GitHub repo') };
}

export async function searchRepos(opts: SearchReposInput): Promise<SearchReposOutput> {
  const query = requiredText(opts.query, 'query');
  const page = normalizePage(opts.page);
  const perPage = normalizePerPage(opts.perPage);
  const params = new URLSearchParams({ q: query, page: String(page), per_page: String(perPage) });
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.direction) params.set('order', opts.direction);
  const { body, headers } = await getJson(`${API_ORIGIN}/search/repositories?${params.toString()}`, { method: 'GET' });
  const raw = objectValue(body, 'GitHub search repositories response');
  const items = arrayValue(raw.items, 'GitHub search repositories response.items').map((item, index) => {
    const repo = normalizeRepo(item, `GitHub search repositories response.items[${index}]`);
    const obj = objectValue(item, `GitHub search repositories response.items[${index}]`);
    return { ...repo, score: numberValue(obj.score, `GitHub search repositories response.items[${index}].score`) };
  });
  const totalCount = intValue(raw.total_count, 'GitHub search repositories response.total_count');
  const incompleteResults = boolValue(raw.incomplete_results, 'GitHub search repositories response.incomplete_results');
  return {
    query,
    items,
    paging: buildPaging(page, perPage, items.length, headers.get('link'), totalCount, incompleteResults),
  };
}

export async function searchUsers(opts: SearchUsersInput): Promise<SearchUsersOutput> {
  const query = requiredText(opts.query, 'query');
  const page = normalizePage(opts.page);
  const perPage = normalizePerPage(opts.perPage);
  const params = new URLSearchParams({ q: query, page: String(page), per_page: String(perPage) });
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.direction) params.set('order', opts.direction);
  const { body, headers } = await getJson(`${API_ORIGIN}/search/users?${params.toString()}`, { method: 'GET' });
  const raw = objectValue(body, 'GitHub search users response');
  const items = arrayValue(raw.items, 'GitHub search users response.items').map((item, index) => {
    const user = normalizeAccount(item, `GitHub search users response.items[${index}]`);
    const obj = objectValue(item, `GitHub search users response.items[${index}]`);
    return { ...user, score: numberValue(obj.score, `GitHub search users response.items[${index}].score`) };
  });
  const totalCount = intValue(raw.total_count, 'GitHub search users response.total_count');
  const incompleteResults = boolValue(raw.incomplete_results, 'GitHub search users response.incomplete_results');
  return {
    query,
    items,
    paging: buildPaging(page, perPage, items.length, headers.get('link'), totalCount, incompleteResults),
  };
}

export async function getReadme(opts: GetReadmeInput): Promise<GetReadmeOutput> {
  const owner = normalizeLogin(opts.owner, 'owner');
  const repo = normalizeLogin(opts.repo, 'repo');
  const { body } = await getJson(repoUrl(owner, repo, '/readme'), { method: 'GET' });
  return { owner, repo, readme: normalizeReadme(body, repo, 'GitHub readme') };
}

export async function listContributors(opts: ListContributorsInput): Promise<ListContributorsOutput> {
  const owner = normalizeLogin(opts.owner, 'owner');
  const repo = normalizeLogin(opts.repo, 'repo');
  const { body } = await getStatsContributors(repoUrl(owner, repo, '/stats/contributors'));
  const contributors = arrayValue(body, 'GitHub stats contributors').map((item, index) => normalizeContributor(item, `GitHub stats contributors[${index}]`));
  return { owner, repo, contributors };
}

export async function listCommits(opts: ListCommitsInput): Promise<ListCommitsOutput> {
  const owner = normalizeLogin(opts.owner, 'owner');
  const repo = normalizeLogin(opts.repo, 'repo');
  const page = normalizePage(opts.page);
  const perPage = normalizePerPage(opts.perPage);
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (opts.sha) params.set('sha', trim(opts.sha));
  if (opts.path) params.set('path', trim(opts.path));
  if (opts.author) params.set('author', trim(opts.author));
  if (opts.since) params.set('since', trim(opts.since));
  if (opts.until) params.set('until', trim(opts.until));
  const { body, headers } = await getJson(`${repoUrl(owner, repo, '/commits')}?${params.toString()}`, { method: 'GET' });
  const commits = arrayValue(body, 'GitHub commits').map((item, index) => normalizeCommit(item, `GitHub commits[${index}]`));
  return {
    owner,
    repo,
    commits,
    paging: buildPaging(page, perPage, commits.length, headers.get('link')),
  };
}

export async function listLanguages(opts: ListLanguagesInput): Promise<ListLanguagesOutput> {
  const owner = normalizeLogin(opts.owner, 'owner');
  const repo = normalizeLogin(opts.repo, 'repo');
  const { body } = await getJson(repoUrl(owner, repo, '/languages'), { method: 'GET' });
  const raw = objectValue(body, 'GitHub languages response');
  const languages: Record<string, number> = {};
  let totalBytes = 0;
  for (const [key, value] of Object.entries(raw)) {
    const bytes = intValue(value, `GitHub languages response.${key}`);
    languages[key] = bytes;
    totalBytes += bytes;
  }
  return { owner, repo, languages, totalBytes };
}

export async function listIssues(opts: ListIssuesInput): Promise<ListIssuesOutput> {
  const owner = normalizeLogin(opts.owner, 'owner');
  const repo = normalizeLogin(opts.repo, 'repo');
  const page = normalizePage(opts.page);
  const perPage = normalizePerPage(opts.perPage);
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (opts.state) params.set('state', opts.state);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.direction) params.set('direction', opts.direction);
  if (opts.since) params.set('since', trim(opts.since));
  const { body, headers } = await getJson(`${repoUrl(owner, repo, '/issues')}?${params.toString()}`, { method: 'GET' });
  const issues = arrayValue(body, 'GitHub issues').map((item, index) => normalizeIssue(item, `GitHub issues[${index}]`));
  return {
    owner,
    repo,
    issues,
    paging: buildPaging(page, perPage, issues.length, headers.get('link')),
  };
}

export async function listReleases(opts: ListReleasesInput): Promise<ListReleasesOutput> {
  const owner = normalizeLogin(opts.owner, 'owner');
  const repo = normalizeLogin(opts.repo, 'repo');
  const page = normalizePage(opts.page);
  const perPage = normalizePerPage(opts.perPage);
  const { body, headers } = await getJson(`${repoUrl(owner, repo, '/releases')}?page=${page}&per_page=${perPage}`, { method: 'GET' });
  const releases = arrayValue(body, 'GitHub releases').map((item, index) => normalizeRelease(item, `GitHub releases[${index}]`));
  return {
    owner,
    repo,
    releases,
    paging: buildPaging(page, perPage, releases.length, headers.get('link')),
  };
}

export async function listFollowers(opts: ListFollowersInput): Promise<ListFollowersOutput> {
  const login = normalizeLogin(opts.login, 'login');
  const page = normalizePage(opts.page);
  const perPage = normalizePerPage(opts.perPage);
  const { body, headers } = await getJson(`${userUrl(login, '/followers')}?page=${page}&per_page=${perPage}`, { method: 'GET' });
  const followers = arrayValue(body, 'GitHub followers').map((item, index) => normalizeAccount(item, `GitHub followers[${index}]`));
  return {
    login,
    followers,
    paging: buildPaging(page, perPage, followers.length, headers.get('link')),
  };
}
