import Link from 'next/link';
import { getSessions, getStats, timeAgo } from '@/app/lib/api';
import { LiveRefresh } from '@/app/components/live-refresh';

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{
        background: isActive ? "var(--green-muted)" : "var(--bg-tertiary)",
        color: isActive ? "var(--green)" : "var(--text-tertiary)",
      }}
    >
      {isActive && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
          style={{ background: "var(--green)" }}
        />
      )}
      {isActive ? "Live" : "Done"}
    </span>
  );
}

function UserAvatar({ name }: { name: string }) {
  const initial = (name || "?")[0].toUpperCase();
  const colors: Record<string, string> = {
    A: "#7c5bf5",
    B: "#3ecf71",
    C: "#f5c542",
    D: "#ef4444",
    E: "#da70d6",
    J: "#3b82f6",
    T: "#8b8b9e",
  };
  const bg = colors[initial] || "#7c5bf5";

  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
      style={{ background: `${bg}22`, color: bg }}
    >
      {initial}
    </div>
  );
}

function extractTitle(session: { working_dir?: string; branch?: string }): string {
  const branch = session.branch || "";
  if (branch && branch !== "main" && branch !== "master" && branch !== "detached") {
    return branch
      .replace(/^(feature|fix|refactor|chore|feat)\//i, "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const dir = session.working_dir || "";
  return dir.split("/").pop() || "Untitled Session";
}

export const dynamic = "force-dynamic";

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ teamSlug: string }>;
}) {
  const { teamSlug } = await params;

  let sessions: Awaited<ReturnType<typeof getSessions>> = [];
  let stats: Awaited<ReturnType<typeof getStats>> = {
    total_sessions: '0',
    active_sessions: '0',
    unique_users: '0',
    first_session: '',
    last_activity: '',
  };

  try {
    sessions = await getSessions(teamSlug);
  } catch {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ color: "var(--text-secondary)" }}>
          <p className="text-lg font-medium mb-2" style={{ color: "var(--text-primary)" }}>
            Unable to connect to Orchid server
          </p>
          <p className="text-sm">Make sure the server is running and accessible.</p>
        </div>
      </div>
    );
  }

  try {
    stats = await getStats(teamSlug);
  } catch {
    stats.total_sessions = String(sessions.length);
    stats.active_sessions = String(sessions.filter((s) => s.status === "active").length);
    const users = new Set(sessions.map((s) => s.user_name));
    stats.unique_users = String(users.size);
  }

  const activeSessions = sessions.filter((s) => s.status === "active");
  const doneSessions = sessions.filter((s) => s.status !== "active");
  // Sort: active sessions first, then done sessions by date
  const sortedSessions = [...activeSessions, ...doneSessions];

  return (
    <div className="animate-fade-in">
      <LiveRefresh interval={15000} />
      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-6 h-[52px] border-b backdrop-blur-sm"
        style={{
          background: "rgba(10, 10, 15, 0.8)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">Sessions</h1>
          <span
            className="text-[11px] px-1.5 py-0.5 rounded"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
            }}
          >
            {stats.total_sessions}
          </span>
          {activeSessions.length > 0 && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1"
              style={{
                background: "var(--green-muted)",
                color: "var(--green)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: "var(--green)" }} />
              {activeSessions.length} live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {stats.unique_users} users
        </div>
      </header>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-3 px-6 py-4">
        {[
          { label: "Total Sessions", value: stats.total_sessions },
          { label: "Active Now", value: stats.active_sessions, accent: Number(stats.active_sessions) > 0 },
          { label: "Team Members", value: stats.unique_users },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg p-3 border"
            style={{
              background: "var(--bg-secondary)",
              borderColor: stat.accent ? "var(--green)" : "var(--border-subtle)",
            }}
          >
            <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-tertiary)" }}>
              {stat.label}
            </div>
            <div
              className="text-xl font-semibold"
              style={{ color: stat.accent ? "var(--green)" : "var(--text-primary)" }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Session list */}
      <div className="px-6">
        {sessions.length === 0 ? (
          <div className="text-center py-16" style={{ color: "var(--text-secondary)" }}>
            <p className="text-sm">
              No sessions yet. Run{" "}
              <code
                className="font-mono px-1.5 py-0.5 rounded"
                style={{ background: "var(--bg-tertiary)" }}
              >
                orchid claude
              </code>{" "}
              to capture your first conversation.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {activeSessions.length > 0 && (
              <div className="flex items-center gap-2 py-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: "var(--green)" }} />
                <span className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: "var(--green)" }}>
                  Active Sessions
                </span>
              </div>
            )}
            {sortedSessions.map((session, i) => {
              // Show "Recent" separator when we transition from active to done
              const prevSession = i > 0 ? sortedSessions[i - 1] : null;
              const showRecentSeparator = prevSession?.status === "active" && session.status !== "active";

              return (
              <div key={session.id}>
              {showRecentSeparator && (
                <div className="flex items-center gap-2 py-2 mt-2 mb-1">
                  <span className="text-[10px] uppercase font-semibold tracking-wider" style={{ color: "var(--text-tertiary)" }}>
                    Recent
                  </span>
                  <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} />
                </div>
              )}
              <Link
                href={`/t/${teamSlug}/sessions/${encodeURIComponent(session.id)}`}
                className="session-row flex items-center gap-4 px-3 py-3 -mx-3 rounded-lg transition-colors group"
                style={{
                  borderBottom:
                    i < sessions.length - 1
                      ? "1px solid var(--border-subtle)"
                      : undefined,
                }}
              >
                <UserAvatar name={session.user_name} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="text-[13px] font-medium truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {extractTitle(session)}
                    </span>
                    <StatusBadge status={session.status} />
                  </div>
                  <div
                    className="flex items-center gap-2 text-[11px]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    <span>{session.user_name}</span>
                    <span>&middot;</span>
                    <span className="font-mono">{session.branch}</span>
                    {session.message_count != null && session.message_count > 0 && (
                      <>
                        <span>&middot;</span>
                        <span>{session.message_count} msgs</span>
                      </>
                    )}
                    {session.working_dir && (
                      <>
                        <span>&middot;</span>
                        <span>{session.working_dir.split("/").pop()}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {timeAgo(session.updated_at || session.started_at)}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {session.tool || "claude"}
                  </div>
                </div>

                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </Link>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
