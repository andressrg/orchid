'use client';

import { useState, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface CommitFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
  repo: string;
  additions: number;
  deletions: number;
  files: CommitFile[];
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

const fileStatusStyles: Record<string, { classes: string; label: string }> = {
  added: { classes: 'bg-success-muted text-success', label: 'A' },
  modified: { classes: 'bg-warning-muted text-warning', label: 'M' },
  removed: { classes: 'bg-danger/15 text-danger', label: 'D' },
  renamed: { classes: 'bg-accent-muted text-accent', label: 'R' },
};

function FileStatusBadge({ status }: { status: string }) {
  const s = fileStatusStyles[status] || fileStatusStyles.modified;
  return (
    <span
      className={`text-[10px] font-mono font-bold w-4 h-4 flex items-center justify-center rounded ${s.classes}`}
    >
      {s.label}
    </span>
  );
}

function CommitCard({
  commit,
  isExpanded,
  onToggle,
}: {
  commit: Commit;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const firstLine = commit.message.split('\n')[0];
  const totalChanges = commit.additions + commit.deletions;

  return (
    <div className="rounded-lg border transition-colors bg-night-900 border-night-750">
      <div className="px-4 py-3 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start gap-3">
          {/* Commit dot */}
          <div className="mt-1.5 shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-accent" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[13px] font-medium truncate text-night-100">{firstLine}</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-night-400">
              <span className="font-mono">{commit.sha.slice(0, 7)}</span>
              <span>{commit.author}</span>
              <span>{timeAgo(commit.date)}</span>
              <span className="font-mono text-night-300">{commit.repo}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {commit.additions > 0 && (
              <span className="text-[11px] font-mono text-success">+{commit.additions}</span>
            )}
            {commit.deletions > 0 && (
              <span className="text-[11px] font-mono text-danger">−{commit.deletions}</span>
            )}
            {totalChanges > 0 && (
              <div className="flex gap-px ml-1">
                {Array.from({
                  length: Math.min(
                    5,
                    Math.ceil((commit.additions / Math.max(totalChanges, 1)) * 5),
                  ),
                }).map((_, i) => (
                  <div key={`a-${i}`} className="w-1.5 h-1.5 rounded-sm bg-success" />
                ))}
                {Array.from({
                  length: Math.min(
                    5,
                    Math.ceil((commit.deletions / Math.max(totalChanges, 1)) * 5),
                  ),
                }).map((_, i) => (
                  <div key={`d-${i}`} className="w-1.5 h-1.5 rounded-sm bg-danger" />
                ))}
              </div>
            )}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={`text-night-400 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>
        </div>
      </div>

      {isExpanded && commit.files.length > 0 && (
        <div className="px-4 py-3 border-t animate-fade-in border-night-750">
          <div className="space-y-1.5">
            {commit.files.map((file, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <FileStatusBadge status={file.status} />
                <span className="font-mono truncate text-night-300">{file.filename}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-night-400">
                  {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                  {file.additions > 0 && file.deletions > 0 && ' '}
                  {file.deletions > 0 && <span className="text-danger">−{file.deletions}</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-night-750">
            <a
              href={commit.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-medium transition-opacity hover:opacity-80 text-accent"
            >
              View on GitHub →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export function SessionCommits({ sessionId }: { sessionId: string }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/commits`,
          { credentials: 'include' },
        );
        if (!res.ok) throw new Error('Failed to fetch commits');
        const data = await res.json();
        setCommits(data.commits || []);
        if (data.message && (!data.commits || data.commits.length === 0)) {
          setError(data.message);
        }
      } catch {
        setError('Failed to load commits');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="px-6 py-8">
        <div className="space-y-3 max-w-3xl mx-auto">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg h-20 animate-pulse bg-night-900" />
          ))}
        </div>
      </div>
    );
  }

  if (error && commits.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <svg
          width="32"
          height="32"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="mx-auto mb-3 text-night-400"
        >
          <circle cx="8" cy="4" r="2" />
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M8 6v2M6.5 11L7.5 8.5M9.5 11L8.5 8.5" />
        </svg>
        <p className="text-[13px] text-night-300">{error}</p>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <svg
          width="32"
          height="32"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="mx-auto mb-3 text-night-400"
        >
          <circle cx="8" cy="4" r="2" />
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M8 6v2M6.5 11L7.5 8.5M9.5 11L8.5 8.5" />
        </svg>
        <p className="text-[13px] text-night-300">No commits found during this session</p>
      </div>
    );
  }

  const totalAdditions = commits.reduce((s, c) => s + c.additions, 0);
  const totalDeletions = commits.reduce((s, c) => s + c.deletions, 0);
  const repos = [...new Set(commits.map((c) => c.repo))];

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto animate-fade-in">
      {/* Stats bar */}
      <div className="flex items-center gap-4 mb-5 px-4 py-3 rounded-lg border bg-night-900 border-night-750">
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-accent"
          >
            <circle cx="8" cy="4" r="2" />
            <circle cx="4" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <path d="M8 6v2M6.5 11L7.5 8.5M9.5 11L8.5 8.5" />
          </svg>
          <span className="text-[12px] font-medium text-night-100">
            {commits.length} commit{commits.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-[11px] font-mono text-success">+{totalAdditions}</span>
        <span className="text-[11px] font-mono text-danger">−{totalDeletions}</span>
        <div className="ml-auto flex items-center gap-2">
          {repos.map((repo) => (
            <span
              key={repo}
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent-muted text-accent"
            >
              {repo}
            </span>
          ))}
        </div>
      </div>

      {/* Commit list */}
      <div className="space-y-2">
        {commits.map((commit) => (
          <CommitCard
            key={commit.sha}
            commit={commit}
            isExpanded={expandedSha === commit.sha}
            onToggle={() => setExpandedSha(expandedSha === commit.sha ? null : commit.sha)}
          />
        ))}
      </div>
    </div>
  );
}
