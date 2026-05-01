'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { type Session, timeAgo } from '@/app/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

function extractTitle(session: { working_dir?: string; branch?: string }): string {
  const branch = session.branch || '';
  if (branch && branch !== 'main' && branch !== 'master' && branch !== 'detached') {
    return branch
      .replace(/^(feature|fix|refactor|chore|feat)\//i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const dir = session.working_dir || '';
  return dir.split('/').pop() || 'Untitled Session';
}

export default function SearchPage({ params }: { params: Promise<{ teamSlug: string }> }) {
  const { teamSlug } = use(params);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Session[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/sessions?q=${encodeURIComponent(query)}&team=${encodeURIComponent(teamSlug)}`,
        { credentials: 'include' },
      );
      const data = await res.json();
      setResults(data);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <header
        className="sticky top-0 z-10 flex items-center px-6 h-[52px] border-b backdrop-blur-sm"
        style={{
          background: 'rgba(10, 10, 15, 0.8)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <h1 className="text-sm font-semibold">Search Conversations</h1>
      </header>

      <div className="px-6 py-6 max-w-2xl">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <circle cx="7" cy="7" r="4" />
              <path d="M10 10l3 3" />
            </svg>
            <input
              type="text"
              placeholder="Search across all conversations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-lg text-[13px] border outline-none focus:ring-1 transition-all"
              style={{
                background: 'var(--bg-secondary)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2.5 rounded-lg text-[13px] font-medium transition-colors"
            style={{
              background: 'var(--accent)',
              color: 'white',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        <div className="mt-6">
          {searched && results.length === 0 && (
            <p className="text-[13px] text-center py-8" style={{ color: 'var(--text-secondary)' }}>
              No conversations matching &quot;{query}&quot;
            </p>
          )}
          {results.length > 0 && (
            <div>
              <div className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
                {results.length} result{results.length !== 1 ? 's' : ''}
              </div>
              <div className="space-y-1">
                {results.map((session) => (
                  <Link
                    key={session.id}
                    href={`/t/${teamSlug}/sessions/${encodeURIComponent(session.id)}`}
                    className="flex items-center gap-3 px-3 py-3 rounded-lg transition-colors"
                    style={{ background: 'transparent' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[13px] font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {extractTitle(session)}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        {session.user_name} &middot; {session.branch} &middot;{' '}
                        {timeAgo(session.updated_at)}
                      </div>
                    </div>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        background:
                          session.status === 'active' ? 'var(--green-muted)' : 'var(--bg-tertiary)',
                        color:
                          session.status === 'active' ? 'var(--green)' : 'var(--text-tertiary)',
                      }}
                    >
                      {session.status}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {!searched && (
            <div className="text-center py-12" style={{ color: 'var(--text-tertiary)' }}>
              <p className="text-[13px]">Search across all AI conversations.</p>
              <p className="text-[11px] mt-2">
                Find discussions about specific decisions, tradeoffs, or features.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 justify-center">
                {['authentication', 'WebSocket', 'payment', 'database', 'CI pipeline'].map(
                  (term) => (
                    <button
                      key={term}
                      className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                      style={{
                        borderColor: 'var(--border)',
                        color: 'var(--text-secondary)',
                      }}
                      onClick={() => {
                        setQuery(term);
                        // Auto-search after setting query
                        (async () => {
                          setLoading(true);
                          try {
                            const res = await fetch(
                              `${API_URL}/api/sessions?q=${encodeURIComponent(term)}&team=${encodeURIComponent(teamSlug)}`,
                              { credentials: 'include' },
                            );
                            const data = await res.json();
                            setResults(data);
                            setSearched(true);
                          } catch {
                            setResults([]);
                            setSearched(true);
                          } finally {
                            setLoading(false);
                          }
                        })();
                      }}
                    >
                      {term}
                    </button>
                  ),
                )}
              </div>
              <p className="text-[10px] mt-4" style={{ color: 'var(--text-tertiary)' }}>
                Tip: Press{' '}
                <kbd
                  className="px-1 py-0.5 rounded text-[9px]"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                >
                  /
                </kbd>{' '}
                from anywhere to jump to search
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
