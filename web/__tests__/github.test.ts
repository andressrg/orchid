import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchMergedPrCount } from '@/app/lib/github';

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
