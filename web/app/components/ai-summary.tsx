"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://24.144.97.81:3000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "orchid-poc-api-key-2024";

export function AISummary({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function loadSummary() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `${API_URL}/sessions/${encodeURIComponent(sessionId)}/summary`,
        { headers: { "X-API-Key": API_KEY } }
      );
      if (!res.ok) throw new Error("Failed");
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
        className="mx-6 mt-4 mb-0 p-3 rounded-lg border cursor-pointer transition-colors"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border-subtle)",
        }}
        onClick={loadSummary}
      >
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--orchid-pink)" }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 2v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="8" cy="8" r="6" />
          </svg>
          <span className="font-medium">Generate AI Summary</span>
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Click to analyze this conversation
          </span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="mx-6 mt-4 mb-0 p-3 rounded-lg border"
        style={{
          background: "var(--orchid-pink-muted)",
          borderColor: "var(--orchid-pink)",
        }}
      >
        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--orchid-pink)" }}>
          <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span className="font-medium">Generating summary...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-6 mt-4 mb-0 p-4 rounded-lg border animate-fade-in"
      style={{
        background: "var(--orchid-pink-muted)",
        borderColor: "var(--orchid-pink)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--orchid-pink)" }}>
          <path d="M8 2v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="8" cy="8" r="6" />
        </svg>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--orchid-pink)" }}>
          AI Summary
        </span>
      </div>
      <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
        {summary}
      </p>
    </div>
  );
}
