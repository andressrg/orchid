/**
 * GitHub REST helpers for the public efficiency profile (P7-3).
 *
 * The only call we need server-side: how many PRs a GitHub user has *merged*.
 * GitHub's search API answers this directly — `is:pr is:merged author:<login>`
 * — and we read only `total_count` (per_page=1 so no PR bodies are fetched).
 *
 * Hard rule (AGENTS.md): the public `/u/<handle>` page must NEVER block on a
 * slow or failed GitHub call. So this never throws — it returns `null` on a
 * missing token/login, a non-200, a timeout (~3s), or any network error — and
 * the caller falls back to the commit-count proxy.
 */

// GitHub's search/issues response — we read only the count.
interface GithubSearchResponse {
  readonly total_count: number;
}

interface FetchMergedPrCountParams {
  readonly login: string;
  readonly accessToken: string;
  // Abort budget so the public page never waits on GitHub. Default 3s.
  readonly timeoutMs?: number;
}

const GITHUB_SEARCH_ISSUES_URL = 'https://api.github.com/search/issues';
const DEFAULT_TIMEOUT_MS = 3000;

const isFiniteCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Count of merged PRs authored by `login`, via the GitHub search API. Returns
 * `null` when it can't be determined (no token/login, non-200, timeout, error)
 * — the profile then degrades to the commit-count proxy. Never throws.
 */
export async function fetchMergedPrCount({
  login,
  accessToken,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: FetchMergedPrCountParams): Promise<number | null> {
  if (!login || !accessToken) return null;

  const query = `is:pr is:merged author:${login}`;
  const url = `${GITHUB_SEARCH_ISSUES_URL}?q=${encodeURIComponent(query)}&per_page=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const result = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'orchid',
    },
    signal: controller.signal,
  })
    .then(async (response): Promise<number | null> => {
      if (!response.ok) return null;
      const data = (await response.json()) as GithubSearchResponse;
      return isFiniteCount(data.total_count) ? data.total_count : null;
    })
    .catch((): null => null)
    .finally(() => clearTimeout(timer));

  return result;
}

// GitHub's /user response — we read only login + numeric id.
interface GithubUserResponse {
  readonly login?: string;
  readonly id?: number;
}

const GITHUB_USER_URL = 'https://api.github.com/user';

/**
 * Resolve the authenticated GitHub user's login + id from an access token.
 * Recovers the login when a GitHub account was LINKED to an existing Orchid
 * user — Better Auth runs `mapProfileToUser` only on user creation, not on
 * link, so `user.githubLogin` can be empty for a merged account. Same hard
 * rule: returns `null` on missing token / non-200 / timeout / error, never
 * throws.
 */
export async function fetchGithubLogin({
  accessToken,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  readonly accessToken: string;
  readonly timeoutMs?: number;
}): Promise<{ readonly login: string; readonly id: string } | null> {
  if (!accessToken) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'orchid',
    },
    signal: controller.signal,
  })
    .then(async (response): Promise<{ readonly login: string; readonly id: string } | null> => {
      if (!response.ok) return null;
      const data = (await response.json()) as GithubUserResponse;
      return typeof data.login === 'string' && data.login.length > 0
        ? { login: data.login, id: data.id != null ? String(data.id) : '' }
        : null;
    })
    .catch((): null => null)
    .finally(() => clearTimeout(timer));
}

// ── Contribution calendar (the real GitHub "green graph") ──
//
// The public profile's "Shipping activity" heatmap should mirror the user's
// actual GitHub contribution calendar — their full-year green graph — not just
// the ~weeks they've used Orchid. GitHub only exposes the calendar via GraphQL,
// so this is the one GraphQL call we make. `viewer` is the token owner, so no
// login is needed; the `read:user` scope the app already requests covers the
// calendar. Same hard rule as the REST helpers: timeout-bounded (~4s), never
// throws — a missing token, a non-200, GraphQL `errors`, or a parse failure all
// return `null` so the heatmap falls back to the Orchid-session series.

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const CALENDAR_TIMEOUT_MS = 4000;

const CONTRIBUTION_CALENDAR_QUERY = `query { viewer { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`;

// The slice of GitHub's GraphQL response we read. The `?` chain below tolerates
// any missing layer (degrades to `null`) without widening to `any`/`unknown`.
interface GithubContributionDay {
  readonly date?: string;
  readonly contributionCount?: number;
}
interface GithubContributionWeek {
  readonly contributionDays?: ReadonlyArray<GithubContributionDay>;
}
interface GithubGraphqlError {
  readonly message?: string;
}
interface GithubCalendarResponse {
  readonly data?: {
    readonly viewer?: {
      readonly contributionsCollection?: {
        readonly contributionCalendar?: {
          readonly totalContributions?: number;
          readonly weeks?: ReadonlyArray<GithubContributionWeek>;
        };
      };
    };
  };
  // Present (non-empty) when the query failed at the GraphQL layer (HTTP 200).
  readonly errors?: ReadonlyArray<GithubGraphqlError>;
}

export interface ContributionCalendar {
  readonly days: ReadonlyArray<{ readonly day: string; readonly count: number }>;
  readonly total: number;
}

/**
 * The token owner's GitHub contribution calendar (the green graph), via the
 * GitHub GraphQL API. Returns one `{ day, count }` per calendar day plus the
 * `total`, or `null` when it can't be determined (no token, non-200, GraphQL
 * `errors`, or parse failure) — the heatmap then falls back to Orchid sessions.
 * Never throws.
 */
export async function fetchContributionCalendar({
  accessToken,
  timeoutMs = CALENDAR_TIMEOUT_MS,
}: {
  readonly accessToken: string;
  readonly timeoutMs?: number;
}): Promise<ContributionCalendar | null> {
  if (!accessToken) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'orchid',
    },
    body: JSON.stringify({ query: CONTRIBUTION_CALENDAR_QUERY }),
    signal: controller.signal,
  })
    .then(async (response): Promise<ContributionCalendar | null> => {
      if (!response.ok) return null;
      const body = (await response.json()) as GithubCalendarResponse;
      // A GraphQL error surfaces as HTTP 200 with a non-empty `errors` array.
      if (Array.isArray(body.errors) && body.errors.length > 0) return null;
      const calendar = body.data?.viewer?.contributionsCollection?.contributionCalendar;
      if (!calendar) return null;

      const days = (calendar.weeks ?? []).flatMap((week) =>
        (week.contributionDays ?? [])
          .filter(
            (entry): entry is { date: string; contributionCount: number } =>
              typeof entry.date === 'string' && isFiniteCount(entry.contributionCount),
          )
          .map((entry) => ({ day: entry.date, count: entry.contributionCount })),
      );

      return {
        days,
        total: isFiniteCount(calendar.totalContributions) ? calendar.totalContributions : 0,
      };
    })
    .catch((): null => null)
    .finally(() => clearTimeout(timer));
}
