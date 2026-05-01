'use client';

import { useState } from 'react';
import useSWR from 'swr';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used: string | null;
  expires_at: string | null;
  created_at: string;
}

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : []));

export default function TokensPage() {
  const { data: tokens = [], mutate } = useSWR<ApiKey[]>('/api/tokens', fetcher);
  const [newTokenName, setNewTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    if (!newTokenName.trim()) return;
    setLoading(true);

    const res = await fetch('/api/tokens', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTokenName }),
    });

    if (res.ok) {
      const data = await res.json();
      setCreatedToken(data.token);
      setNewTokenName('');
      mutate();
    }
    setLoading(false);
  }

  async function deleteToken(id: string) {
    const res = await fetch(`/api/tokens/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) mutate();
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1">Personal Access Tokens</h1>
      <p className="text-sm text-neutral-400 mb-6">
        Use tokens to authenticate the Orchid CLI. Run{' '}
        <code className="text-violet-400">orchid login</code> and paste your token.
      </p>

      {createdToken && (
        <div className="mb-6 rounded-md border border-green-800 bg-green-950 p-4">
          <p className="text-sm text-green-300 mb-2">
            Token created. Copy it now — you won&apos;t see it again.
          </p>
          <code className="block text-sm text-green-200 bg-green-900 rounded px-3 py-2 font-mono break-all">
            {createdToken}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(createdToken);
            }}
            className="mt-2 text-xs text-green-400 hover:text-green-300"
          >
            Copy to clipboard
          </button>
        </div>
      )}

      <form onSubmit={createToken} className="flex gap-2 mb-8">
        <input
          type="text"
          value={newTokenName}
          onChange={(e) => setNewTokenName(e.target.value)}
          placeholder="Token name (e.g. laptop, ci)"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-violet-500 focus:outline-none"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {tokens.length === 0 ? (
        <p className="text-sm text-neutral-500">No tokens yet.</p>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium text-white">{t.name}</div>
                <div className="text-xs text-neutral-500">
                  {t.key_prefix}... &middot; Created {new Date(t.created_at).toLocaleDateString()}
                  {t.last_used && (
                    <> &middot; Last used {new Date(t.last_used).toLocaleDateString()}</>
                  )}
                </div>
              </div>
              <button
                onClick={() => deleteToken(t.id)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
