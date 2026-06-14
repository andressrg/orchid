'use client';

import { useState } from 'react';
import { authClient } from '@/app/lib/auth-client';
import type { GithubLinkState } from '@/app/lib/queries';

const githubMark = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

// "Link GitHub" merges a GitHub login into the *currently logged-in* Orchid
// user. `linkSocial` hits Better Auth's POST /api/auth/link-social, which (with
// the session) returns a GitHub authorize URL; on the callback the GitHub
// account row is attached to this same user — no duplicate account, even when
// the GitHub email differs from the Orchid email (`allowDifferentEmails`).
export function ConnectedAccounts({
  github,
  callbackPath,
}: {
  github: GithubLinkState;
  callbackPath: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function linkGithub() {
    setLoading(true);
    setError('');
    const result = await authClient.linkSocial({ provider: 'github', callbackURL: callbackPath });
    // On success Better Auth redirects the browser to GitHub; only reachable on error.
    if (result.error) {
      setError(result.error.message || 'Could not start GitHub linking');
      setLoading(false);
    }
  }

  async function unlinkGithub() {
    setLoading(true);
    setError('');
    const result = await authClient.unlinkAccount({ providerId: 'github' });
    if (result.error) {
      setError(result.error.message || 'Could not unlink GitHub');
      setLoading(false);
    } else {
      window.location.reload();
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1">Connected accounts</h1>
      <p className="text-sm text-neutral-400 mb-6">
        Merge your GitHub login into this Orchid account so your merged-PR stats and{' '}
        <code className="text-violet-400">/u/&lt;github-login&gt;</code> profile resolve.
      </p>

      <div className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-neutral-300">{githubMark}</span>
          <div>
            <div className="text-sm font-medium text-white">GitHub</div>
            {github.linked ? (
              <div className="text-xs text-neutral-500">
                {github.githubLogin ? (
                  <>
                    Connected as <span className="text-neutral-300">@{github.githubLogin}</span>
                  </>
                ) : (
                  'Connected'
                )}
              </div>
            ) : (
              <div className="text-xs text-neutral-500">Not connected</div>
            )}
          </div>
        </div>

        {github.linked ? (
          <button
            type="button"
            onClick={unlinkGithub}
            disabled={loading}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
          >
            {loading ? 'Working…' : 'Unlink'}
          </button>
        ) : (
          <button
            type="button"
            onClick={linkGithub}
            disabled={loading}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {loading ? 'Connecting…' : 'Link GitHub'}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
