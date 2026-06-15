'use client';

import { useState } from 'react';

// Share row for the public efficiency profile (P7-5). A compact, Linear-clean
// "Share" cluster rendered near the headline: X/Twitter, LinkedIn, and Copy
// link. The profile is public, so it's owner/visitor-agnostic — always shown.
//
// No useEffect: the copy confirmation is driven by an event handler + a single
// setTimeout reset. The profile URL is the canonical absolute URL, read from
// window.location on the client (the component is client-side).

export type SharePlatform = 'x' | 'linkedin';

// Pure builder for the intent URLs. Encodes both the share text and the profile
// URL with encodeURIComponent so query-special characters (?, &, spaces) in
// either round-trip safely with no double-encoding and no injection.
//   X:        twitter.com/intent/tweet?text=<enc>&url=<enc>
//   LinkedIn: linkedin.com/sharing/share-offsite/?url=<enc>
export function buildShareUrls({
  platform,
  profileUrl,
  text,
}: {
  readonly platform: SharePlatform;
  readonly profileUrl: string;
  readonly text: string;
}): string {
  const encodedUrl = encodeURIComponent(profileUrl);
  return platform === 'x'
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodedUrl}`
    : `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
}

// The brag, derived from the page-supplied headline (e.g. "3.4 PRs / million
// tokens" or "12 PRs merged"). Centralized so the share text is identical
// across X and LinkedIn (LinkedIn ignores text, but the helper stays the single
// source of truth and keeps it test-covered).
export function buildShareText(headline: string): string {
  return `I ship ${headline} on Orchid 🌸`;
}

// The canonical absolute profile URL. Read from the live page so previews,
// localhost, and prod all share the URL the visitor is actually on.
const currentProfileUrl = (): string => (typeof window === 'undefined' ? '' : window.location.href);

const openShare = ({
  platform,
  headline,
}: {
  readonly platform: SharePlatform;
  readonly headline: string;
}): void => {
  const url = buildShareUrls({
    platform,
    profileUrl: currentProfileUrl(),
    text: buildShareText(headline),
  });
  window.open(url, '_blank', 'noopener,noreferrer');
};

function ShareIconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-md transition-colors"
      style={{
        background: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {children}
    </button>
  );
}

export function ShareProfile({
  handle,
  headline,
}: {
  readonly handle: string;
  readonly headline: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(currentProfileUrl());
      setCopied(true);
      // Single timer resets the confirmation; no useEffect / listener.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — the URL is still in the address bar; nothing to surface.
    }
  }

  return (
    <div
      className="profile-share flex items-center gap-2"
      aria-label={`Share ${handle}'s Orchid profile`}
    >
      <span className="text-[12px] font-medium pr-0.5" style={{ color: 'var(--text-tertiary)' }}>
        Share
      </span>

      <ShareIconButton label="Share on X" onClick={() => openShare({ platform: 'x', headline })}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        X
      </ShareIconButton>

      <ShareIconButton
        label="Share on LinkedIn"
        onClick={() => openShare({ platform: 'linkedin', headline })}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.07 2.07 0 110-4.14 2.07 2.07 0 010 4.14zM7.12 20.45H3.55V9h3.57zM22.22 0H1.77C.8 0 0 .77 0 1.73v20.54C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
        </svg>
        LinkedIn
      </ShareIconButton>

      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy profile link"
        className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-md transition-colors"
        style={{
          background: copied ? 'var(--green-muted)' : 'var(--bg-tertiary)',
          color: copied ? 'var(--green)' : 'var(--text-secondary)',
          border: copied ? '1px solid rgba(62, 207, 113, 0.3)' : '1px solid var(--border-subtle)',
        }}
      >
        {copied ? (
          <>
            <svg
              width="13"
              height="13"
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
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M6.5 9.5l3-3M7 5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11l-1 1a2.5 2.5 0 01-3.5-3.5l1-1" />
            </svg>
            Copy link
          </>
        )}
      </button>
    </div>
  );
}
