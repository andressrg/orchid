'use client';

import { useState } from 'react';

export function CopyLink() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded transition-colors"
      style={{
        background: copied ? 'var(--green-muted)' : 'var(--bg-tertiary)',
        color: copied ? 'var(--green)' : 'var(--text-tertiary)',
      }}
    >
      {copied ? (
        <>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 8l3 3 5-6" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="5" y="5" width="8" height="8" rx="1.5" />
            <path d="M3 11V4a1.5 1.5 0 011.5-1.5H11" />
          </svg>
          Share
        </>
      )}
    </button>
  );
}
