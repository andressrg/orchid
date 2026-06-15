'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export function AISummary({
  sessionId,
  initialSummary,
}: {
  sessionId: string;
  initialSummary?: string | null;
}) {
  // Seed from the server-rendered summary (generated on session end) so a
  // finished session shows its summary instantly — no click, no fetch. Falls
  // back to click-to-generate when there's no stored summary.
  const [summary, setSummary] = useState<string | null>(initialSummary ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function loadSummary() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/summary`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setSummary(data.summary);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  if (error) return null;

  if (!summary && !loading) {
    return (
      <div
        className="mx-6 mt-4 mb-0 p-3 rounded-lg border cursor-pointer transition-colors bg-night-900 border-night-750"
        onClick={loadSummary}
      >
        <div className="flex items-center gap-2 text-[12px] text-orchid">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M8 2v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="8" cy="8" r="6" />
          </svg>
          <span className="font-medium">Generate AI Summary</span>
          <span className="text-[11px] text-night-400">Click to analyze this conversation</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-6 mt-4 mb-0 p-3 rounded-lg border bg-orchid-muted border-orchid">
        <div className="flex items-center gap-2 text-[12px] text-orchid">
          <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span className="font-medium">Generating summary...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-6 mt-4 mb-0 p-4 rounded-lg border animate-fade-in bg-orchid-muted border-orchid">
      <div className="flex items-center gap-2 mb-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-orchid"
        >
          <path d="M8 2v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="8" cy="8" r="6" />
        </svg>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-orchid">
          AI Summary
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-night-100">{summary}</p>
    </div>
  );
}
