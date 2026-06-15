import Link from 'next/link';
import { Suspense } from 'react';
import { timeAgo, formatDuration } from '@/app/lib/api';
import { friendlyUserName } from '@/app/lib/display';
import { getServerAuth } from '@/app/lib/server-auth';
import { getSessionById } from '@/app/lib/queries';
import { LiveRefresh } from '@/app/components/live-refresh';
import { AISummary } from '@/app/components/ai-summary';
import { ShareSession } from '@/app/components/share-session';
import { SessionTabs } from '@/app/components/session-tabs';
import { SessionConversation, ConversationSkeleton } from './session-conversation';

function MetadataItem({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[10px] uppercase font-medium tracking-wider mb-0.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </div>
      <div
        className="text-[12px] font-mono"
        style={{ color: accent ? 'var(--accent)' : 'var(--text-secondary)' }}
      >
        {value}
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamSlug: string; id: string }>;
  searchParams: Promise<{ turn?: string }>;
}) {
  const { teamSlug, id } = await params;
  const { turn } = await searchParams;
  const highlightTurn = turn ? parseInt(turn, 10) : null;

  const serverAuth = await getServerAuth(teamSlug);
  if (!serverAuth) return null;

  const session = await getSessionById({
    sessionId: decodeURIComponent(id),
    teamId: serverAuth.teamId,
    userId: serverAuth.userId,
  });
  if (!session) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Session not found
          </p>
          <Link
            href={`/t/${teamSlug}/dashboard`}
            className="text-sm underline"
            style={{ color: 'var(--accent)' }}
          >
            Back to sessions
          </Link>
        </div>
      </div>
    );
  }

  const isActive = session.status === 'active';
  const userName = friendlyUserName(session.user_name, session.user_email);
  const messageCount = session.message_count;

  return (
    <div className="animate-fade-in">
      {isActive && <LiveRefresh />}

      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center gap-3 px-6 h-[52px] border-b backdrop-blur-sm"
        style={{
          background: 'rgba(10, 10, 15, 0.85)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <Link
          href={`/t/${teamSlug}/dashboard`}
          className="flex items-center gap-1 text-[12px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M10 4l-4 4 4 4" />
          </svg>
          Sessions
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span className="text-[13px] font-medium truncate">{session.id}</span>
        {isActive && (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{
              background: 'var(--green-muted)',
              color: 'var(--green)',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
              style={{ background: 'var(--green)' }}
            />
            Live
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {session.git_remotes &&
            session.git_remotes.length > 0 &&
            (() => {
              const repoName =
                session.git_remotes[0]
                  .split('/')
                  .pop()
                  ?.replace(/\.git$/, '') || '';
              return repoName ? (
                <Link
                  href={`/t/${teamSlug}/decisions?repo=${encodeURIComponent(repoName)}`}
                  className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-opacity hover:opacity-80"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--accent)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  🧠 Decision Log
                </Link>
              ) : null;
            })()}
          <ShareSession sessionId={session.id} isOwner={session.is_owner} />
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {messageCount} turns
          </span>
        </div>
      </header>

      {/* Session metadata */}
      <div
        className="px-6 py-4 border-b grid grid-cols-2 md:grid-cols-4 gap-4"
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <MetadataItem label="User" value={`${userName} <${session.user_email || 'unknown'}>`} />
        <MetadataItem label="Branch" value={session.branch || 'unknown'} accent />
        <MetadataItem label="Directory" value={session.working_dir || 'unknown'} />
        <MetadataItem
          label="Duration"
          value={
            session.started_at && session.updated_at
              ? formatDuration(session.started_at, session.updated_at)
              : 'unknown'
          }
        />
        <MetadataItem label="Tool" value={session.tool || 'unknown'} />
        <MetadataItem label="Messages" value={`${messageCount} turns`} />
        <MetadataItem
          label="Started"
          value={session.started_at ? new Date(session.started_at).toLocaleString() : 'unknown'}
        />
        <MetadataItem
          label="Last Update"
          value={session.updated_at ? timeAgo(session.updated_at) : 'unknown'}
        />
      </div>

      {/* Git remotes */}
      {session.git_remotes && session.git_remotes.length > 0 && (
        <div
          className="px-6 py-2.5 border-b flex items-center gap-2"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-secondary)' }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <circle cx="8" cy="4" r="2" />
            <circle cx="4" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <path d="M8 6v2M6.5 11L7.5 8.5M9.5 11L8.5 8.5" />
          </svg>
          <div className="flex flex-wrap gap-2">
            {session.git_remotes.map((remote: string, i: number) => {
              const isGithub = remote.includes('github.com');
              const url = isGithub
                ? remote.replace(/\.git$/, '').replace('git@github.com:', 'https://github.com/')
                : null;
              return url ? (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono px-2 py-0.5 rounded transition-colors hover:opacity-80"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}
                >
                  {remote}
                </a>
              ) : (
                <span
                  key={i}
                  className="text-[11px] font-mono px-2 py-0.5 rounded"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
                >
                  {remote}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Summary — server-rendered instantly when already generated on session
          end; falls back to click-to-generate for sessions with no stored summary. */}
      <AISummary sessionId={session.id} initialSummary={session.summary} />

      {/* Tabbed content: Conversation, Commits, Chat. The conversation body is
          streamed in via Suspense so this metadata shell paints without waiting
          on the (potentially large) transcript read. */}
      <SessionTabs
        sessionId={session.id}
        conversation={
          <Suspense fallback={<ConversationSkeleton />}>
            <SessionConversation
              sessionId={session.id}
              teamId={serverAuth.teamId}
              userId={serverAuth.userId}
              userName={userName}
              isActive={isActive}
              highlightTurn={highlightTurn}
            />
          </Suspense>
        }
      />
    </div>
  );
}
