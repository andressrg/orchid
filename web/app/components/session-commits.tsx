"use client";

import { useState, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || '';

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

function FileStatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string; label: string }> = {
    added: { bg: "var(--green-muted)", text: "var(--green)", label: "A" },
    modified: { bg: "var(--yellow-muted)", text: "var(--yellow)", label: "M" },
    removed: { bg: "rgba(239, 68, 68, 0.15)", text: "var(--red)", label: "D" },
    renamed: { bg: "var(--accent-muted)", text: "var(--accent)", label: "R" },
  };
  const c = colors[status] || colors.modified;
  return (
    <span
      className="text-[10px] font-mono font-bold w-4 h-4 flex items-center justify-center rounded"
      style={{ background: c.bg, color: c.text }}
    >
      {c.label}
    </span>
  );
}

function CommitCard({ commit, isExpanded, onToggle }: { commit: Commit; isExpanded: boolean; onToggle: () => void }) {
  const firstLine = commit.message.split("\n")[0];
  const totalChanges = commit.additions + commit.deletions;

  return (
    <div
      className="rounded-lg border transition-colors"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}
    >
      <div className="px-4 py-3 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start gap-3">
          {/* Commit dot */}
          <div className="mt-1.5 shrink-0">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent)" }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                {firstLine}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              <span className="font-mono">{commit.sha.slice(0, 7)}</span>
              <span>{commit.author}</span>
              <span>{timeAgo(commit.date)}</span>
              <span className="font-mono" style={{ color: "var(--text-secondary)" }}>
                {commit.repo}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {commit.additions > 0 && (
              <span className="text-[11px] font-mono" style={{ color: "var(--green)" }}>
                +{commit.additions}
              </span>
            )}
            {commit.deletions > 0 && (
              <span className="text-[11px] font-mono" style={{ color: "var(--red)" }}>
                −{commit.deletions}
              </span>
            )}
            {totalChanges > 0 && (
              <div className="flex gap-px ml-1">
                {Array.from({ length: Math.min(5, Math.ceil(commit.additions / Math.max(totalChanges, 1) * 5)) }).map((_, i) => (
                  <div key={`a-${i}`} className="w-1.5 h-1.5 rounded-sm" style={{ background: "var(--green)" }} />
                ))}
                {Array.from({ length: Math.min(5, Math.ceil(commit.deletions / Math.max(totalChanges, 1) * 5)) }).map((_, i) => (
                  <div key={`d-${i}`} className="w-1.5 h-1.5 rounded-sm" style={{ background: "var(--red)" }} />
                ))}
              </div>
            )}
            <svg
              width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
              style={{ color: "var(--text-tertiary)", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>
        </div>
      </div>

      {isExpanded && commit.files.length > 0 && (
        <div
          className="px-4 py-3 border-t animate-fade-in"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="space-y-1.5">
            {commit.files.map((file, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <FileStatusBadge status={file.status} />
                <span className="font-mono truncate" style={{ color: "var(--text-secondary)" }}>
                  {file.filename}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {file.additions > 0 && <span style={{ color: "var(--green)" }}>+{file.additions}</span>}
                  {file.additions > 0 && file.deletions > 0 && " "}
                  {file.deletions > 0 && <span style={{ color: "var(--red)" }}>−{file.deletions}</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
            <a
              href={commit.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-medium transition-opacity hover:opacity-80"
              style={{ color: "var(--accent)" }}
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
          { headers: { "X-API-Key": API_KEY } }
        );
        if (!res.ok) throw new Error("Failed to fetch commits");
        const data = await res.json();
        setCommits(data.commits || []);
        if (data.message && (!data.commits || data.commits.length === 0)) {
          setError(data.message);
        }
      } catch {
        setError("Failed to load commits");
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
            <div key={i} className="rounded-lg h-20 animate-pulse" style={{ background: "var(--bg-secondary)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error && commits.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto mb-3" style={{ color: "var(--text-tertiary)" }}>
          <circle cx="8" cy="4" r="2" />
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M8 6v2M6.5 11L7.5 8.5M9.5 11L8.5 8.5" />
        </svg>
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{error}</p>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <svg width="32" height="32" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto mb-3" style={{ color: "var(--text-tertiary)" }}>
          <circle cx="8" cy="4" r="2" />
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M8 6v2M6.5 11L7.5 8.5M9.5 11L8.5 8.5" />
        </svg>
        <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>No commits found during this session</p>
      </div>
    );
  }

  const totalAdditions = commits.reduce((s, c) => s + c.additions, 0);
  const totalDeletions = commits.reduce((s, c) => s + c.deletions, 0);
  const repos = [...new Set(commits.map(c => c.repo))];

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto animate-fade-in">
      {/* Stats bar */}
      <div
        className="flex items-center gap-4 mb-5 px-4 py-3 rounded-lg border"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--accent)" }}>
            <circle cx="8" cy="4" r="2" />
            <circle cx="4" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <path d="M8 6v2M6.5 11L7.5 8.5M9.5 11L8.5 8.5" />
          </svg>
          <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
            {commits.length} commit{commits.length !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="text-[11px] font-mono" style={{ color: "var(--green)" }}>+{totalAdditions}</span>
        <span className="text-[11px] font-mono" style={{ color: "var(--red)" }}>−{totalDeletions}</span>
        <div className="ml-auto flex items-center gap-2">
          {repos.map((repo) => (
            <span
              key={repo}
              className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
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
