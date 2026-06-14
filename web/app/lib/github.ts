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
