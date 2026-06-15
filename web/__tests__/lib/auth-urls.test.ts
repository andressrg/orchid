import { describe, it, expect } from 'vitest';
import { resolveAuthUrls } from '@/app/lib/auth-urls';

// resolveAuthUrls is a pure derivation of Better Auth's baseURL + trustedOrigins
// from Vercel's system env vars. The contract that matters:
//  - Production behavior is UNCHANGED: baseURL === BETTER_AUTH_URL.
//  - Previews are served from their own host, so baseURL must be that host
//    (prefer the stable branch alias) AND both the deploy + branch hosts are
//    trusted, so login no longer fails with "Invalid origin".
//  - Never a wildcard origin (would trust arbitrary third-party Vercel apps).
describe('resolveAuthUrls', () => {
  it('production: baseURL stays BETTER_AUTH_URL and prod is trusted', () => {
    const { baseURL, trustedOrigins } = resolveAuthUrls({
      VERCEL_ENV: 'production',
      BETTER_AUTH_URL: 'https://www.orchidkeep.com',
      VERCEL_URL: 'orchid-abc123-frecuenti.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'orchid-web.vercel.app',
    });

    expect(baseURL).toBe('https://www.orchidkeep.com');
    expect(trustedOrigins).toContain('https://www.orchidkeep.com');
  });

  it('preview: baseURL is the branch host; trusts branch, deploy, and prod', () => {
    const { baseURL, trustedOrigins } = resolveAuthUrls({
      VERCEL_ENV: 'preview',
      BETTER_AUTH_URL: 'https://www.orchidkeep.com',
      VERCEL_URL: 'orchid-abc123-frecuenti.vercel.app',
      VERCEL_BRANCH_URL: 'orchid-web-git-branch-frecuenti.vercel.app',
    });

    expect(baseURL).toBe('https://orchid-web-git-branch-frecuenti.vercel.app');
    expect(trustedOrigins).toContain('https://orchid-web-git-branch-frecuenti.vercel.app');
    expect(trustedOrigins).toContain('https://orchid-abc123-frecuenti.vercel.app');
    expect(trustedOrigins).toContain('https://www.orchidkeep.com');
  });

  it('preview without VERCEL_BRANCH_URL: falls back to the deploy host', () => {
    const { baseURL, trustedOrigins } = resolveAuthUrls({
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'orchid-abc123-frecuenti.vercel.app',
    });

    expect(baseURL).toBe('https://orchid-abc123-frecuenti.vercel.app');
    expect(trustedOrigins).toContain('https://orchid-abc123-frecuenti.vercel.app');
  });

  it('local: baseURL is localhost and there are no trusted origins', () => {
    const { baseURL, trustedOrigins } = resolveAuthUrls({});

    expect(baseURL).toBe('http://localhost:3000');
    expect(trustedOrigins).toEqual([]);
  });

  it('never trusts a broad wildcard origin', () => {
    const { trustedOrigins } = resolveAuthUrls({
      VERCEL_ENV: 'preview',
      BETTER_AUTH_URL: 'https://www.orchidkeep.com',
      VERCEL_URL: 'orchid-abc123-frecuenti.vercel.app',
      VERCEL_BRANCH_URL: 'orchid-web-git-branch-frecuenti.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'orchid-web.vercel.app',
    });

    expect(trustedOrigins.some((origin) => origin.includes('*'))).toBe(false);
  });

  it('de-duplicates when prod and deploy hosts resolve to the same origin', () => {
    const { trustedOrigins } = resolveAuthUrls({
      VERCEL_ENV: 'production',
      BETTER_AUTH_URL: 'https://orchid-web.vercel.app',
      VERCEL_URL: 'orchid-web.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'orchid-web.vercel.app',
    });

    expect(trustedOrigins).toEqual(['https://orchid-web.vercel.app']);
  });
});
