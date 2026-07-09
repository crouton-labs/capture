import { z } from 'zod';

const PAGE_MAX = 100;

export const libraryDescription = 'Public, unauthenticated GitHub reads from api.github.com for users, orgs, repos, search, README, and repository activity data';
export const libraryIcon = '/icons/libs/github.png';
export const loginUrl = 'https://github.com';
export const libraryVisibility = 'public' as const;

export const libraryNotes = `
## Workflow

GitHub public reads are unauthenticated and go directly to https://api.github.com.

1. Use the exact owner/login/repo values from the public GitHub URL.
2. Use list/search functions for collections, and get* functions for single resources.
3. Use getReadme for repository README content; keep it on api.github.com and do not swap to raw.githubusercontent.com.
4. listContributors uses the repository contributor stats endpoint and retries 202 Accepted while GitHub warms the result.
5. listIssues returns the public issues endpoint, which may include pull requests; inspect isPullRequest when you need to separate them.
6. Search endpoints return score plus paging metadata.
`.trim();

export const LoginParam = z.string().min(1).describe('GitHub login / username copied from the public profile or URL.');
export const OwnerParam = z.string().min(1).describe('GitHub owner login copied from a repository URL or API response.');
export const RepoParam = z.string().min(1).describe('GitHub repository name copied from the public repo URL or API response.');
export const OrgParam = z.string().min(1).describe('GitHub organization login copied from the public org URL or API response.');
export const QueryParam = z.string().min(1).describe('GitHub search query string.');

export const PageParam = z.number().int().positive().default(1).describe('1-indexed GitHub page number.');
export const PerPageParam = z.number().int().positive().max(PAGE_MAX).default(30).describe('GitHub page size, up to 100.');
export const IssueStateParam = z.enum(['open', 'closed', 'all']).default('open').describe('GitHub issue state filter.');
export const SortDirectionParam = z.enum(['asc', 'desc']).default('desc').describe('Sort direction for endpoints that support it.');
export const RepoSortParam = z.enum(['best match', 'stars', 'forks', 'help-wanted-issues', 'updated']).default('best match').describe('Repository search sort order.');
export const UserSortParam = z.enum(['best match', 'followers', 'repositories', 'joined']).default('best match').describe('User search sort order.');

const NullableString = z.string().nullable();
const NullableNumber = z.number().nullable();

export const GitHubAccountSchema = z
  .object({
    login: z.string().describe('GitHub login.'),
    id: z.number().int().describe('GitHub numeric id.'),
    nodeId: z.string().describe('GitHub GraphQL node id.'),
    avatarUrl: z.string().url().describe('GitHub avatar URL.'),
    htmlUrl: z.string().url().describe('GitHub profile or org page URL.'),
    apiUrl: z.string().url().describe('GitHub API URL for this account.'),
    type: z.string().describe('GitHub account type, usually User or Organization.'),
    siteAdmin: z.boolean().optional().describe('Whether GitHub marks the account as a site admin, when present.'),
  })
  .passthrough()
  .describe('Common GitHub account identity.');

export const GitHubUserSchema = GitHubAccountSchema.extend({
  name: NullableString.describe('Public display name, when present.'),
  company: NullableString.describe('Public company field, when present.'),
  blog: NullableString.describe('Public blog field, when present.'),
  location: NullableString.describe('Public location field, when present.'),
  email: NullableString.describe('Public email field, when present.'),
  hireable: z.boolean().nullable().describe('Whether GitHub marks the user hireable.'),
  bio: NullableString.describe('Public bio, when present.'),
  twitterUsername: NullableString.describe('Public Twitter/X username, when present.'),
  publicRepos: NullableNumber.describe('Number of public repositories.'),
  publicGists: NullableNumber.describe('Number of public gists.'),
  followers: NullableNumber.describe('Follower count.'),
  following: NullableNumber.describe('Following count.'),
  organizationsUrl: z.string().url().describe('Organizations API URL for this user.'),
  reposUrl: z.string().url().describe('Repos API URL for this user.'),
  eventsUrl: z.string().describe('Events API URL template for this user.'),
  receivedEventsUrl: z.string().url().describe('Received events API URL for this user.'),
  createdAt: z.string().datetime().describe('Account creation timestamp.'),
  updatedAt: z.string().datetime().describe('Last update timestamp.'),
})
  .describe('Normalized GitHub user.');

export const GitHubOrgSchema = GitHubAccountSchema.extend({
  description: NullableString.describe('Public organization description, when present.'),
  name: NullableString.describe('Public organization display name, when present.'),
  company: NullableString.describe('Public company field, when present.'),
  blog: NullableString.describe('Public blog field, when present.'),
  location: NullableString.describe('Public location field, when present.'),
  email: NullableString.describe('Public email field, when present.'),
  twitterUsername: NullableString.describe('Public Twitter/X username, when present.'),
  isVerified: z.boolean().describe('Whether GitHub verifies the organization.'),
  hasOrganizationProjects: z.boolean().describe('Whether the organization has organization projects enabled.'),
  hasRepositoryProjects: z.boolean().describe('Whether the organization has repository projects enabled.'),
  publicRepos: NullableNumber.describe('Number of public repositories.'),
  publicGists: NullableNumber.describe('Number of public gists.'),
  followers: NullableNumber.describe('Follower count.'),
  following: NullableNumber.describe('Following count.'),
  createdAt: z.string().datetime().describe('Organization creation timestamp.'),
  updatedAt: z.string().datetime().describe('Last update timestamp.'),
  archivedAt: NullableString.describe('Archived timestamp, when GitHub includes it.'),
})
  .describe('Normalized GitHub organization.');

export const GitHubRepoOwnerSchema = GitHubAccountSchema.describe('Repository owner account.');

export const GitHubLicenseSchema = z
  .object({
    key: NullableString.describe('License key.'),
    name: NullableString.describe('License name.'),
    spdxId: NullableString.describe('SPDX identifier.'),
    url: NullableString.describe('License URL, when present.'),
    nodeId: NullableString.describe('License node id, when present.'),
  })
  .passthrough()
  .describe('Repository license metadata.');

export const GitHubRepoSchema = z
  .object({
    id: z.number().int().describe('Repository id.'),
    nodeId: z.string().describe('Repository node id.'),
    name: z.string().describe('Repository name.'),
    fullName: z.string().describe('Repository full name owner/repo.'),
    private: z.boolean().describe('Whether the repository is private.'),
    owner: GitHubRepoOwnerSchema.describe('Repository owner account.'),
    htmlUrl: z.string().url().describe('Repository web URL.'),
    apiUrl: z.string().url().describe('Repository API URL.'),
    description: NullableString.describe('Repository description.'),
    fork: z.boolean().describe('Whether the repository is a fork.'),
    defaultBranch: NullableString.describe('Default branch name.'),
    language: NullableString.describe('Primary language.'),
    languagesUrl: z.string().url().describe('Languages API URL.'),
    stargazersCount: NullableNumber.describe('Star count.'),
    watchersCount: NullableNumber.describe('Watcher count.'),
    forksCount: NullableNumber.describe('Fork count.'),
    openIssuesCount: NullableNumber.describe('Open issues count.'),
    topics: z.array(z.string()).describe('Repository topics.'),
    visibility: NullableString.describe('Repository visibility.'),
    archived: z.boolean().describe('Whether the repository is archived.'),
    disabled: z.boolean().describe('Whether the repository is disabled.'),
    homepage: NullableString.describe('Repository homepage URL, when present.'),
    createdAt: z.string().datetime().describe('Repository creation timestamp.'),
    updatedAt: z.string().datetime().describe('Repository last update timestamp.'),
    pushedAt: NullableString.describe('Repository last push timestamp.'),
    hasIssues: z.boolean().describe('Whether issues are enabled.'),
    hasProjects: z.boolean().describe('Whether projects are enabled.'),
    hasDownloads: z.boolean().describe('Whether downloads are enabled.'),
    hasWiki: z.boolean().describe('Whether the wiki is enabled.'),
    hasPages: z.boolean().describe('Whether GitHub Pages is enabled.'),
    isTemplate: z.boolean().describe('Whether the repository is a template.'),
    license: GitHubLicenseSchema.nullable().describe('License metadata, when present.'),
  })
  .passthrough()
  .describe('Normalized GitHub repository.');

export const GitHubSearchRepoSchema = GitHubRepoSchema.extend({
  score: z.number().describe('GitHub search relevance score.'),
}).describe('Repository search result.');

export const GitHubSearchUserSchema = GitHubAccountSchema.extend({
  score: z.number().describe('GitHub search relevance score.'),
}).describe('User search result.');

export const GitHubLabelSchema = z
  .object({
    id: z.number().int().describe('Label id.'),
    nodeId: z.string().describe('Label node id.'),
    url: z.string().url().describe('Label API URL.'),
    name: z.string().describe('Label name.'),
    color: z.string().describe('Label color.'),
    default: z.boolean().describe('Whether the label is a default label.'),
    description: NullableString.describe('Label description.'),
  })
  .passthrough()
  .describe('GitHub label.');

export const GitHubIssueUserSchema = GitHubAccountSchema.describe('Issue or pull-request author account.');

export const GitHubIssueSchema = z
  .object({
    url: z.string().url().describe('Issue API URL.'),
    repositoryUrl: z.string().url().describe('Repository API URL.'),
    htmlUrl: z.string().url().describe('Issue web URL.'),
    id: z.number().int().describe('Issue id.'),
    nodeId: z.string().describe('Issue node id.'),
    number: z.number().int().describe('Issue number.'),
    title: z.string().describe('Issue title.'),
    user: GitHubIssueUserSchema.nullable().describe('Issue author, when GitHub includes it.'),
    labels: z.array(GitHubLabelSchema).describe('Issue labels.'),
    state: z.string().describe('Issue state.'),
    locked: z.boolean().describe('Whether the issue is locked.'),
    comments: z.number().int().describe('Comment count.'),
    createdAt: z.string().datetime().describe('Issue creation timestamp.'),
    updatedAt: z.string().datetime().describe('Issue update timestamp.'),
    closedAt: NullableString.describe('Issue close timestamp.'),
    body: NullableString.describe('Issue body text.'),
    assignee: GitHubIssueUserSchema.nullable().describe('Issue assignee, when present.'),
    assignees: z.array(GitHubIssueUserSchema).describe('Issue assignees.'),
    milestone: z.unknown().nullable().describe('Issue milestone payload, when present.'),
    authorAssociation: z.string().describe('GitHub author association.'),
    stateReason: NullableString.describe('GitHub issue state reason.'),
    activeLockReason: NullableString.describe('Active lock reason, when present.'),
    pullRequestUrl: NullableString.describe('Pull-request API URL when this issue row is a pull request.'),
    isPullRequest: z.boolean().describe('Whether this row represents a pull request.'),
  })
  .passthrough()
  .describe('Normalized GitHub issue or pull request row.');

export const GitHubReleaseAssetSchema = z
  .object({
    id: z.number().int().describe('Asset id.'),
    nodeId: z.string().describe('Asset node id.'),
    name: z.string().describe('Asset name.'),
    label: NullableString.describe('Asset label.'),
    state: z.string().describe('Asset state.'),
    contentType: z.string().describe('Asset content type.'),
    size: z.number().int().describe('Asset size in bytes.'),
    downloadCount: z.number().int().describe('Asset download count.'),
    browserDownloadUrl: NullableString.describe('Browser download URL.'),
    url: z.string().url().describe('Asset API URL.'),
    createdAt: z.string().datetime().describe('Asset creation timestamp.'),
    updatedAt: z.string().datetime().describe('Asset update timestamp.'),
    uploader: GitHubAccountSchema.nullable().describe('Asset uploader, when present.'),
  })
  .passthrough()
  .describe('GitHub release asset.');

export const GitHubReleaseSchema = z
  .object({
    url: z.string().url().describe('Release API URL.'),
    assetsUrl: z.string().url().describe('Release assets API URL.'),
    uploadUrl: z.string().describe('Release asset upload URL template.'),
    htmlUrl: z.string().url().describe('Release web URL.'),
    id: z.number().int().describe('Release id.'),
    author: GitHubAccountSchema.nullable().describe('Release author, when present.'),
    nodeId: z.string().describe('Release node id.'),
    tagName: z.string().describe('Release tag.'),
    targetCommitish: z.string().describe('Target commitish.'),
    name: NullableString.describe('Release name.'),
    draft: z.boolean().describe('Whether the release is a draft.'),
    immutable: z.boolean().describe('Whether the release is immutable.'),
    prerelease: z.boolean().describe('Whether the release is a prerelease.'),
    createdAt: z.string().datetime().describe('Release creation timestamp.'),
    updatedAt: z.string().datetime().describe('Release update timestamp.'),
    publishedAt: NullableString.describe('Release publish timestamp.'),
    assets: z.array(GitHubReleaseAssetSchema).describe('Release assets.'),
    tarballUrl: z.string().url().describe('Tarball download URL.'),
    zipballUrl: z.string().url().describe('Zipball download URL.'),
    body: NullableString.describe('Release notes.'),
    reactions: z.unknown().nullable().describe('Reaction summary payload, when present.'),
  })
  .passthrough()
  .describe('Normalized GitHub release.');

export const GitHubCommitPersonSchema = z
  .object({
    name: z.string().describe('Person name from the commit payload.'),
    email: z.string().describe('Person email from the commit payload.'),
    date: z.string().datetime().describe('Commit author/committer timestamp.'),
    login: NullableString.describe('Linked GitHub login, when present.'),
    id: NullableNumber.describe('Linked GitHub id, when present.'),
    nodeId: NullableString.describe('Linked GitHub node id, when present.'),
    avatarUrl: NullableString.describe('Linked GitHub avatar URL, when present.'),
    htmlUrl: NullableString.describe('Linked GitHub profile URL, when present.'),
    type: NullableString.describe('Linked GitHub account type, when present.'),
    siteAdmin: z.boolean().nullable().describe('Linked GitHub site admin flag, when present.'),
  })
  .passthrough()
  .describe('GitHub commit author or committer.');

export const GitHubCommitParentSchema = z
  .object({
    sha: z.string().describe('Parent commit sha.'),
    url: z.string().url().describe('Parent commit API URL.'),
    htmlUrl: z.string().url().describe('Parent commit web URL.'),
  })
  .passthrough()
  .describe('GitHub commit parent reference.');

export const GitHubCommitSchema = z
  .object({
    sha: z.string().describe('Commit sha.'),
    nodeId: z.string().describe('Commit node id.'),
    htmlUrl: z.string().url().describe('Commit web URL.'),
    apiUrl: z.string().url().describe('Commit API URL.'),
    commit: z
      .object({
        author: GitHubCommitPersonSchema.nullable().describe('Commit author payload.'),
        committer: GitHubCommitPersonSchema.nullable().describe('Commit committer payload.'),
        message: z.string().describe('Commit message.'),
      })
      .passthrough()
      .describe('Nested commit payload.'),
    author: GitHubAccountSchema.nullable().describe('Linked GitHub author account, when present.'),
    committer: GitHubAccountSchema.nullable().describe('Linked GitHub committer account, when present.'),
    parents: z.array(GitHubCommitParentSchema).describe('Parent commits.'),
    commentsUrl: z.string().url().describe('Commit comments API URL.'),
    commentCount: z.number().int().describe('Number of commit comments.'),
  })
  .passthrough()
  .describe('Normalized GitHub commit.');

export const GitHubContributorWeekSchema = z
  .object({
    week: z.number().int().describe('Week timestamp.'),
    additions: z.number().int().describe('Additions for the week.'),
    deletions: z.number().int().describe('Deletions for the week.'),
    commits: z.number().int().describe('Commit count for the week.'),
  })
  .passthrough()
  .describe('Contributor weekly stats bucket.');

export const GitHubContributorStatsSchema = z
  .object({
    author: GitHubAccountSchema.nullable().describe('Contributor account, when GitHub includes one.'),
    total: z.number().int().describe('Total contributions over the stats window.'),
    weeks: z.array(GitHubContributorWeekSchema).describe('Weekly contribution buckets.'),
  })
  .passthrough()
  .describe('Contributor stats row.');

export const GitHubReadmeSchema = z
  .object({
    name: z.string().describe('README file name.'),
    path: z.string().describe('Repository path of the README.'),
    sha: z.string().describe('README blob sha.'),
    size: z.number().int().describe('README size in bytes.'),
    url: z.string().url().describe('README API URL.'),
    htmlUrl: z.string().url().describe('README web URL.'),
    gitUrl: z.string().url().describe('README git URL.'),
    downloadUrl: NullableString.describe('README download URL, usually null for the API response.'),
    type: z.string().describe('Object type.'),
    content: z.string().describe('README base64 content returned by GitHub.'),
    decodedContent: z.string().describe('README decoded UTF-8 content.'),
    encoding: z.string().describe('Content encoding returned by GitHub.'),
    title: z.string().describe('Best-effort heading extracted from the README content.'),
  })
  .passthrough()
  .describe('Decoded GitHub README response.');

export const GitHubPagingSchema = z
  .object({
    page: z.number().int().positive().describe('Current 1-indexed page.'),
    perPage: z.number().int().positive().max(PAGE_MAX).describe('Requested page size.'),
    returned: z.number().int().nonnegative().describe('Number of items returned on this page.'),
    hasNextPage: z.boolean().describe('Whether the API reported another page.'),
    nextPage: z.number().int().positive().nullable().describe('Next page number, or null if none.'),
    totalCount: z.number().int().nonnegative().nullable().describe('Total count when the API provides one.'),
    incompleteResults: z.boolean().nullable().describe('Search incomplete-results flag when the API provides one.'),
  })
  .passthrough()
  .describe('GitHub paging metadata.');

export const getUserSchema = {
  name: 'getUser',
  description: 'Get one public GitHub user profile by login.',
  notes: 'Public GitHub users are fetched directly from api.github.com/users/{login}.',
  input: z.object({ login: LoginParam }),
  output: z.object({ user: GitHubUserSchema }),
};

export const listUserReposSchema = {
  name: 'listUserRepos',
  description: 'List public repositories for one GitHub user.',
  notes: 'Uses api.github.com/users/{login}/repos with standard GitHub paging.',
  input: z.object({ login: LoginParam, page: PageParam.optional(), perPage: PerPageParam.optional() }),
  output: z.object({ login: LoginParam, repositories: z.array(GitHubRepoSchema), paging: GitHubPagingSchema }),
};

export const listOrgsSchema = {
  name: 'listOrgs',
  description: 'List the public organizations a GitHub user belongs to.',
  notes: 'Uses api.github.com/users/{login}/orgs.',
  input: z.object({ login: LoginParam, page: PageParam.optional(), perPage: PerPageParam.optional() }),
  output: z.object({ login: LoginParam, organizations: z.array(GitHubOrgSchema), paging: GitHubPagingSchema }),
};

export const getOrgSchema = {
  name: 'getOrg',
  description: 'Get one public GitHub organization profile by login.',
  notes: 'Uses api.github.com/orgs/{org}.',
  input: z.object({ org: OrgParam }),
  output: z.object({ org: GitHubOrgSchema }),
};

export const listOrgReposSchema = {
  name: 'listOrgRepos',
  description: 'List public repositories for one GitHub organization.',
  notes: 'Uses api.github.com/orgs/{org}/repos with standard GitHub paging.',
  input: z.object({ org: OrgParam, page: PageParam.optional(), perPage: PerPageParam.optional() }),
  output: z.object({ org: OrgParam, repositories: z.array(GitHubRepoSchema), paging: GitHubPagingSchema }),
};

export const getRepoSchema = {
  name: 'getRepo',
  description: 'Get one public GitHub repository by owner and repo name.',
  notes: 'Uses api.github.com/repos/{owner}/{repo}.',
  input: z.object({ owner: OwnerParam, repo: RepoParam }),
  output: z.object({ repo: GitHubRepoSchema }),
};

export const searchReposSchema = {
  name: 'searchRepos',
  description: 'Search public GitHub repositories.',
  notes: 'Uses api.github.com/search/repositories.',
  input: z.object({ query: QueryParam, page: PageParam.optional(), perPage: PerPageParam.optional(), sort: RepoSortParam.optional(), direction: SortDirectionParam.optional() }),
  output: z.object({ query: QueryParam, items: z.array(GitHubSearchRepoSchema), paging: GitHubPagingSchema }),
};

export const searchUsersSchema = {
  name: 'searchUsers',
  description: 'Search public GitHub users.',
  notes: 'Uses api.github.com/search/users.',
  input: z.object({ query: QueryParam, page: PageParam.optional(), perPage: PerPageParam.optional(), sort: UserSortParam.optional(), direction: SortDirectionParam.optional() }),
  output: z.object({ query: QueryParam, items: z.array(GitHubSearchUserSchema), paging: GitHubPagingSchema }),
};

export const getReadmeSchema = {
  name: 'getReadme',
  description: 'Get and decode a repository README from the GitHub API host.',
  notes: 'Uses api.github.com/repos/{owner}/{repo}/readme and decodes the base64 content in-browser.',
  input: z.object({ owner: OwnerParam, repo: RepoParam }),
  output: z.object({ owner: OwnerParam, repo: RepoParam, readme: GitHubReadmeSchema }),
};

export const listContributorsSchema = {
  name: 'listContributors',
  description: 'List contributor stats for a repository.',
  notes: 'Uses api.github.com/repos/{owner}/{repo}/stats/contributors and retries 202 Accepted while GitHub warms the result.',
  input: z.object({ owner: OwnerParam, repo: RepoParam }),
  output: z.object({ owner: OwnerParam, repo: RepoParam, contributors: z.array(GitHubContributorStatsSchema) }),
};

export const listCommitsSchema = {
  name: 'listCommits',
  description: 'List public commits for a repository.',
  notes: 'Uses api.github.com/repos/{owner}/{repo}/commits with paging.',
  input: z.object({ owner: OwnerParam, repo: RepoParam, page: PageParam.optional(), perPage: PerPageParam.optional(), sha: z.string().min(1).optional(), path: z.string().min(1).optional(), author: LoginParam.optional(), since: z.string().min(1).optional(), until: z.string().min(1).optional() }),
  output: z.object({ owner: OwnerParam, repo: RepoParam, commits: z.array(GitHubCommitSchema), paging: GitHubPagingSchema }),
};

export const listLanguagesSchema = {
  name: 'listLanguages',
  description: 'List the language byte totals for a repository.',
  notes: 'Uses api.github.com/repos/{owner}/{repo}/languages.',
  input: z.object({ owner: OwnerParam, repo: RepoParam }),
  output: z.object({ owner: OwnerParam, repo: RepoParam, languages: z.record(z.string(), z.number().int().nonnegative()), totalBytes: z.number().int().nonnegative() }),
};

export const listIssuesSchema = {
  name: 'listIssues',
  description: 'List public issues for a repository.',
  notes: 'Uses api.github.com/repos/{owner}/{repo}/issues. GitHub may return pull requests too; use isPullRequest to separate them.',
  input: z.object({ owner: OwnerParam, repo: RepoParam, page: PageParam.optional(), perPage: PerPageParam.optional(), state: IssueStateParam.optional(), sort: z.enum(['created', 'updated', 'comments']).optional(), direction: SortDirectionParam.optional(), since: z.string().min(1).optional() }),
  output: z.object({ owner: OwnerParam, repo: RepoParam, issues: z.array(GitHubIssueSchema), paging: GitHubPagingSchema }),
};

export const listReleasesSchema = {
  name: 'listReleases',
  description: 'List public releases for a repository.',
  notes: 'Uses api.github.com/repos/{owner}/{repo}/releases.',
  input: z.object({ owner: OwnerParam, repo: RepoParam, page: PageParam.optional(), perPage: PerPageParam.optional() }),
  output: z.object({ owner: OwnerParam, repo: RepoParam, releases: z.array(GitHubReleaseSchema), paging: GitHubPagingSchema }),
};

export const listFollowersSchema = {
  name: 'listFollowers',
  description: 'List public followers for a GitHub user.',
  notes: 'Uses api.github.com/users/{login}/followers with paging.',
  input: z.object({ login: LoginParam, page: PageParam.optional(), perPage: PerPageParam.optional() }),
  output: z.object({ login: LoginParam, followers: z.array(GitHubAccountSchema), paging: GitHubPagingSchema }),
};

export type GitHubAccount = z.infer<typeof GitHubAccountSchema>;
export type GitHubUser = z.infer<typeof GitHubUserSchema>;
export type GitHubOrg = z.infer<typeof GitHubOrgSchema>;
export type GitHubRepo = z.infer<typeof GitHubRepoSchema>;
export type GitHubIssue = z.infer<typeof GitHubIssueSchema>;
export type GitHubRelease = z.infer<typeof GitHubReleaseSchema>;
export type GitHubCommit = z.infer<typeof GitHubCommitSchema>;
export type GitHubContributorStats = z.infer<typeof GitHubContributorStatsSchema>;
export type GitHubReadme = z.infer<typeof GitHubReadmeSchema>;

export type GetUserInput = z.infer<typeof getUserSchema.input>;
export type GetUserOutput = z.infer<typeof getUserSchema.output>;
export type ListUserReposInput = z.infer<typeof listUserReposSchema.input>;
export type ListUserReposOutput = z.infer<typeof listUserReposSchema.output>;
export type ListOrgsInput = z.infer<typeof listOrgsSchema.input>;
export type ListOrgsOutput = z.infer<typeof listOrgsSchema.output>;
export type GetOrgInput = z.infer<typeof getOrgSchema.input>;
export type GetOrgOutput = z.infer<typeof getOrgSchema.output>;
export type ListOrgReposInput = z.infer<typeof listOrgReposSchema.input>;
export type ListOrgReposOutput = z.infer<typeof listOrgReposSchema.output>;
export type GetRepoInput = z.infer<typeof getRepoSchema.input>;
export type GetRepoOutput = z.infer<typeof getRepoSchema.output>;
export type SearchReposInput = z.infer<typeof searchReposSchema.input>;
export type SearchReposOutput = z.infer<typeof searchReposSchema.output>;
export type SearchUsersInput = z.infer<typeof searchUsersSchema.input>;
export type SearchUsersOutput = z.infer<typeof searchUsersSchema.output>;
export type GetReadmeInput = z.infer<typeof getReadmeSchema.input>;
export type GetReadmeOutput = z.infer<typeof getReadmeSchema.output>;
export type ListContributorsInput = z.infer<typeof listContributorsSchema.input>;
export type ListContributorsOutput = z.infer<typeof listContributorsSchema.output>;
export type ListCommitsInput = z.infer<typeof listCommitsSchema.input>;
export type ListCommitsOutput = z.infer<typeof listCommitsSchema.output>;
export type ListLanguagesInput = z.infer<typeof listLanguagesSchema.input>;
export type ListLanguagesOutput = z.infer<typeof listLanguagesSchema.output>;
export type ListIssuesInput = z.infer<typeof listIssuesSchema.input>;
export type ListIssuesOutput = z.infer<typeof listIssuesSchema.output>;
export type ListReleasesInput = z.infer<typeof listReleasesSchema.input>;
export type ListReleasesOutput = z.infer<typeof listReleasesSchema.output>;
export type ListFollowersInput = z.infer<typeof listFollowersSchema.input>;
export type ListFollowersOutput = z.infer<typeof listFollowersSchema.output>;

export const allSchemas = [
  getUserSchema,
  listUserReposSchema,
  listOrgsSchema,
  getOrgSchema,
  listOrgReposSchema,
  getRepoSchema,
  searchReposSchema,
  searchUsersSchema,
  getReadmeSchema,
  listContributorsSchema,
  listCommitsSchema,
  listLanguagesSchema,
  listIssuesSchema,
  listReleasesSchema,
  listFollowersSchema,
];
