'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// The grant shape returned by GET /api/sessions/:id/shares — the UI's contract
// with the P1-3 backend. Readonly: the list is only ever derived, never mutated.
interface ShareGrant {
  readonly grantee_user_id: string;
  readonly grantee_email: string;
  readonly grantee_name: string | null;
  readonly capability: string;
  readonly expires_at: string | null;
  readonly created_at: string;
}

interface SharesResponse {
  readonly shares: readonly ShareGrant[];
}

interface ApiError {
  readonly error?: string;
}

// Fetch the current grants for a session. Owner-only on the backend; callers
// only invoke it when isOwner. Returns [] on any failure so the popover still
// renders (the inline error surfaces separately on write actions).
async function fetchShares(sessionId: string): Promise<readonly ShareGrant[]> {
  try {
    const res = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/shares`, {
      credentials: 'include',
    });
    if (!res.ok) return [];
    const data = (await res.json()) as SharesResponse;
    return data.shares ?? [];
  } catch {
    return [];
  }
}

// Prefer the display name, fall back to the email. The list always has an email.
const granteeLabel = (grant: ShareGrant): string =>
  grant.grantee_name?.trim() || grant.grantee_email;

function CopyLinkAction() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard denied — nothing to surface, the link is in the URL bar.
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 w-full text-[12px] px-2 py-1.5 rounded transition-colors"
      style={{
        background: copied ? 'var(--green-muted)' : 'var(--bg-tertiary)',
        color: copied ? 'var(--green)' : 'var(--text-secondary)',
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
          Link copied
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
  );
}

export function ShareSession({
  sessionId,
  isOwner,
}: {
  readonly sessionId: string;
  readonly isOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<readonly ShareGrant[]>([]);
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening the popover is the event handler that loads the grants (NO useEffect).
  async function togglePopover() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError(null);
    if (isOwner) {
      const loaded = await fetchShares(sessionId);
      setShares(loaded);
    }
  }

  async function handleInvite() {
    const granteeEmail = email.trim();
    if (granteeEmail === '' || inviting) return;
    setInviting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granteeEmail }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiError;
        setError(data.error || 'Could not share — try again.');
        return;
      }
      // The POST returns the grant row but not the grantee identity fields, so
      // refetch the list to get email/name for display. Derive a new array.
      const refreshed = await fetchShares(sessionId);
      setShares(refreshed);
      setEmail('');
    } catch {
      setError('Network error — try again.');
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(granteeUserId: string) {
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/share/${encodeURIComponent(granteeUserId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiError;
        setError(data.error || 'Could not remove access.');
        return;
      }
      // Drop the revoked grant — new array, no mutation.
      setShares((current) => current.filter((grant) => grant.grantee_user_id !== granteeUserId));
    } catch {
      setError('Network error — try again.');
    }
  }

  return (
    <div className="relative">
      <button
        onClick={togglePopover}
        className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded transition-colors"
        style={{
          background: open ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
          color: open ? 'var(--accent)' : 'var(--text-tertiary)',
        }}
      >
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
      </button>

      {open && (
        <>
          {/* Click-away backdrop — closes the popover without a useEffect-based
              document listener. */}
          <button
            aria-label="Close share menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
            style={{ background: 'transparent' }}
          />
          <div
            className="absolute right-0 mt-2 z-50 w-[280px] rounded-lg p-3 animate-fade-in"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45)',
            }}
          >
            {isOwner ? (
              <>
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className="text-[12px] font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Share session
                  </span>
                  <button
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                    className="text-[14px] leading-none transition-opacity hover:opacity-70"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    ×
                  </button>
                </div>
                <p className="text-[11px] mb-2.5" style={{ color: 'var(--text-tertiary)' }}>
                  Invite a teammate by email
                </p>

                <div className="flex items-center gap-1.5 mb-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleInvite();
                    }}
                    placeholder="teammate@example.com"
                    className="flex-1 text-[12px] px-2 py-1.5 rounded outline-none"
                    style={{
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  />
                  <button
                    onClick={handleInvite}
                    disabled={inviting || email.trim() === ''}
                    className="text-[12px] font-medium px-2.5 py-1.5 rounded transition-colors disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    {inviting ? '…' : 'Invite'}
                  </button>
                </div>

                {error && (
                  <p className="text-[11px] mb-2" style={{ color: 'var(--red)' }}>
                    {error}
                  </p>
                )}

                <div className="flex flex-col gap-1 mb-2.5">
                  {shares.length === 0 ? (
                    <p className="text-[11px] py-1" style={{ color: 'var(--text-tertiary)' }}>
                      No one yet — invite a teammate above.
                    </p>
                  ) : (
                    shares.map((grant) => (
                      <div
                        key={grant.grantee_user_id}
                        className="flex items-center justify-between gap-2 px-2 py-1 rounded"
                        style={{ background: 'var(--bg-tertiary)' }}
                      >
                        <span
                          className="text-[12px] truncate"
                          style={{ color: 'var(--text-secondary)' }}
                          title={grant.grantee_email}
                        >
                          {granteeLabel(grant)}
                        </span>
                        <button
                          aria-label={`Remove ${granteeLabel(grant)}`}
                          onClick={() => handleRemove(grant.grantee_user_id)}
                          className="text-[11px] shrink-0 transition-opacity hover:opacity-70"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="h-px mb-2.5" style={{ background: 'var(--border-subtle)' }} />
                <CopyLinkAction />
              </>
            ) : (
              <CopyLinkAction />
            )}
          </div>
        </>
      )}
    </div>
  );
}
