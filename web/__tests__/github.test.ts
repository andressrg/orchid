import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchMergedPrCount, fetchGithubLogin, fetchContributionCalendar } from '@/app/lib/github';

// P7-3: real merged-PR count from the GitHub search API. The public profile's
// `prsMerged` reads this for GitHub-linked users; it must NEVER throw — a
// missing token/login, a non-200, a timeout, or a network error all return
// null so the profile falls back to the commit-count proxy.

interface CapturedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
}

const jsonResponse = (payload: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }) as unknown as Response;

const captureFetch = (response: Response) => {
  const calls: CapturedCall[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
};

describe('fetchMergedPrCount', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries merged PRs by author and returns total_count', async () => {
    const calls = captureFetch(jsonResponse({ total_count: 42 }));

    const count = await fetchMergedPrCount({ login: 'octocat', accessToken: 'gho_token' });

    expect(count).toBe(42);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('https://api.github.com/search/issues');
    // The query is `is:pr is:merged author:octocat`, URL-encoded.
    expect(decodeURIComponent(calls[0].url)).toContain('is:pr is:merged author:octocat');
    expect(calls[0].url).toContain('per_page=1');
    expect(calls[0].headers.Authorization).toBe('Bearer gho_token');
    expect(calls[0].headers.Accept).toBe('application/vnd.github+json');
  });

  it('returns null without calling GitHub when token or login is missing', async () => {
    const calls = captureFetch(jsonResponse({ total_count: 7 }));

    expect(await fetchMergedPrCount({ login: '', accessToken: 'gho_token' })).toBeNull();
    expect(await fetchMergedPrCount({ login: 'octocat', accessToken: '' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null on a non-200 response instead of throwing', async () => {
    captureFetch(jsonResponse({ message: 'Bad credentials' }, 401));

    const count = await fetchMergedPrCount({ login: 'octocat', accessToken: 'bad' });

    expect(count).toBeNull();
  });

  it('returns null when the fetch rejects (network error / abort)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('aborted'))),
    );

    const count = await fetchMergedPrCount({ login: 'octocat', accessToken: 'gho_token' });

    expect(count).toBeNull();
  });

  it('returns null when total_count is not a finite number', async () => {
    captureFetch(jsonResponse({ total_count: 'lots' }));

    const count = await fetchMergedPrCount({ login: 'octocat', accessToken: 'gho_token' });

    expect(count).toBeNull();
  });
});

// Recovers the GitHub login from a token — used when a GitHub account was
// merged into an existing email account (so user.githubLogin is empty).
describe('fetchGithubLogin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns login + id from GitHub /user', async () => {
    const calls = captureFetch(jsonResponse({ login: 'juliankmazo', id: 7906134 }));

    const profile = await fetchGithubLogin({ accessToken: 'gho_token' });

    expect(profile).toEqual({ login: 'juliankmazo', id: '7906134' });
    expect(calls[0].url).toBe('https://api.github.com/user');
    expect(calls[0].headers.Authorization).toBe('Bearer gho_token');
  });

  it('returns null without calling GitHub when the token is missing', async () => {
    const calls = captureFetch(jsonResponse({ login: 'x' }));
    expect(await fetchGithubLogin({ accessToken: '' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null on a non-200, a missing login, or a network error', async () => {
    captureFetch(jsonResponse({ message: 'Bad credentials' }, 401));
    expect(await fetchGithubLogin({ accessToken: 'bad' })).toBeNull();

    captureFetch(jsonResponse({ id: 1 })); // no login
    expect(await fetchGithubLogin({ accessToken: 'gho_token' })).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('aborted'))),
    );
    expect(await fetchGithubLogin({ accessToken: 'gho_token' })).toBeNull();
  });
});

// The real GitHub contribution calendar (the green graph), via GraphQL. The
// public profile's "Shipping activity" heatmap reads this for GitHub-linked
// users; it must NEVER throw — a missing token, a non-200, a GraphQL `errors`
// payload, or a network error all return null so the heatmap falls back to the
// Orchid-session series.

interface CapturedGraphqlCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const captureGraphqlFetch = (response: Response) => {
  const calls: CapturedGraphqlCall[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return Promise.resolve(response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
};

// A GitHub contribution-calendar GraphQL payload with the given weeks.
const calendarPayload = (
  weeks: ReadonlyArray<ReadonlyArray<{ date: string; contributionCount: number }>>,
  totalContributions: number,
) => ({
  data: {
    viewer: {
      contributionsCollection: {
        contributionCalendar: {
          totalContributions,
          weeks: weeks.map((days) => ({ contributionDays: days })),
        },
      },
    },
  },
});

describe('fetchContributionCalendar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the GraphQL query and returns flattened days + total', async () => {
    const calls = captureGraphqlFetch(
      jsonResponse(
        calendarPayload(
          [
            [
              { date: '2026-01-01', contributionCount: 0 },
              { date: '2026-01-02', contributionCount: 3 },
            ],
            [{ date: '2026-01-08', contributionCount: 11 }],
          ],
          14,
        ),
      ),
    );

    const calendar = await fetchContributionCalendar({ accessToken: 'gho_token' });

    expect(calendar).toEqual({
      total: 14,
      days: [
        { day: '2026-01-01', count: 0 },
        { day: '2026-01-02', count: 3 },
        { day: '2026-01-08', count: 11 },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/graphql');
    expect(calls[0].headers.Authorization).toBe('Bearer gho_token');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    // The query asks for the contribution calendar.
    expect(calls[0].body).toContain('contributionCalendar');
    expect(calls[0].body).toContain('contributionCount');
  });

  it('returns null without calling GitHub when the token is missing', async () => {
    const calls = captureGraphqlFetch(jsonResponse(calendarPayload([], 0)));
    expect(await fetchContributionCalendar({ accessToken: '' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null on a GraphQL `errors` payload (HTTP 200)', async () => {
    captureGraphqlFetch(jsonResponse({ errors: [{ message: 'Bad credentials' }] }));
    expect(await fetchContributionCalendar({ accessToken: 'gho_token' })).toBeNull();
  });

  it('returns null on a non-200 response instead of throwing', async () => {
    captureGraphqlFetch(jsonResponse({ message: 'Unauthorized' }, 401));
    expect(await fetchContributionCalendar({ accessToken: 'bad' })).toBeNull();
  });

  it('returns null when the fetch rejects (network error / abort)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('aborted'))),
    );
    expect(await fetchContributionCalendar({ accessToken: 'gho_token' })).toBeNull();
  });
});
