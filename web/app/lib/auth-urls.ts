// Pure URL resolution for Better Auth. Kept free of db/resend imports so it is
// trivially unit-testable from environment alone.
//
// Why this exists: Vercel preview deployments serve the app from a per-deploy
// host (and a stable git-branch alias) that differ from the canonical
// production domain. Better Auth rejects any request whose Origin is not the
// configured `baseURL` or in `trustedOrigins` with "Invalid origin", so every
// preview login fails. We derive both `baseURL` (the deployment's own host so
// the auth flow stays same-origin on previews) and `trustedOrigins` (the exact
// set of Vercel-controlled hosts that may legitimately serve this app) from
// Vercel's system env vars.
//
// SECURITY: trustedOrigins only ever contains exact, Vercel-controlled origins
// for THIS deployment (prod domain, this deploy's host, this branch's alias).
// Never a wildcard like `https://*.vercel.app` — that would trust arbitrary
// third-party Vercel apps and open the door to CSRF / origin-spoofing.

export interface AuthUrlEnv {
  readonly BETTER_AUTH_URL?: string;
  readonly VERCEL_ENV?: string;
  readonly VERCEL_URL?: string;
  readonly VERCEL_BRANCH_URL?: string;
  readonly VERCEL_PROJECT_PRODUCTION_URL?: string;
}

export interface ResolvedAuthUrls {
  readonly baseURL: string;
  readonly trustedOrigins: readonly string[];
}

const LOCALHOST = 'http://localhost:3000';

// Vercel system env vars expose bare hosts (no scheme); an explicit
// BETTER_AUTH_URL may already include one. Add https:// only when absent.
const toHttpsOrigin = (hostOrUrl: string): string =>
  /^https?:\/\//.test(hostOrUrl) ? hostOrUrl : `https://${hostOrUrl}`;

const originFromHost = (host: string | undefined): string | undefined =>
  host ? toHttpsOrigin(host) : undefined;

export const resolveAuthUrls = (env: AuthUrlEnv): ResolvedAuthUrls => {
  // Canonical production origin: an explicit override wins, otherwise Vercel's
  // production-domain host. In production this keeps baseURL === BETTER_AUTH_URL.
  const prodURL =
    (env.BETTER_AUTH_URL && toHttpsOrigin(env.BETTER_AUTH_URL)) ??
    originFromHost(env.VERCEL_PROJECT_PRODUCTION_URL);
  // This specific deploy's immutable host (e.g. orchid-abc123-frecuenti.vercel.app).
  const deployURL = originFromHost(env.VERCEL_URL);
  // The stable per-branch alias (e.g. orchid-web-git-branch-frecuenti.vercel.app).
  const branchURL = originFromHost(env.VERCEL_BRANCH_URL);

  // On previews, the app is served from its own host, so baseURL must be that
  // host (prefer the stable branch alias) to keep the auth flow same-origin.
  // Everywhere else, baseURL stays the canonical production origin (unchanged).
  const baseURL =
    env.VERCEL_ENV === 'preview'
      ? (branchURL ?? deployURL ?? prodURL ?? LOCALHOST)
      : (prodURL ?? deployURL ?? LOCALHOST);

  // Trust exactly the defined, Vercel-controlled origins for this deployment,
  // de-duplicated. No wildcards.
  const candidates: readonly (string | undefined)[] = [prodURL, deployURL, branchURL];
  const trustedOrigins = candidates.reduce<readonly string[]>(
    (acc, origin) => (origin && !acc.includes(origin) ? [...acc, origin] : acc),
    [],
  );

  return { baseURL, trustedOrigins };
};
