import { timeAgo } from '@/app/lib/api';
import { getServerAuth } from '@/app/lib/server-auth';
import { listSessions } from '@/app/lib/queries';
import Link from 'next/link';

export const dynamic = "force-dynamic";

function UserCard({
  name,
  sessions,
  color,
  teamSlug,
}: {
  name: string;
  sessions: Array<{ id: string; branch: string; status: string; updated_at: string; tool: string }>;
  color: string;
  teamSlug: string;
}) {
  const active = sessions.filter((s) => s.status === "active").length;

  return (
    <div
      className="rounded-lg border p-4 animate-fade-in"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold"
          style={{ background: `${color}22`, color }}
        >
          {name[0]?.toUpperCase() || "?"}
        </div>
        <div>
          <div className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {name}
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            {active > 0 && (
              <span style={{ color: "var(--green)" }}> &middot; {active} active</span>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {sessions.slice(0, 5).map((s) => (
          <Link
            key={s.id}
            href={`/t/${teamSlug}/sessions/${encodeURIComponent(s.id)}`}
            className="flex items-center gap-2 text-[11px] px-2 py-1 rounded transition-colors session-row"
          >
            {s.status === "active" ? (
              <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: "var(--green)" }} />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--text-tertiary)" }} />
            )}
            <span className="font-mono truncate" style={{ color: "var(--text-secondary)" }}>
              {s.branch}
            </span>
            <span className="ml-auto shrink-0" style={{ color: "var(--text-tertiary)" }}>
              {timeAgo(s.updated_at)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ teamSlug: string }>;
}) {
  const { teamSlug } = await params;

  const serverAuth = await getServerAuth(teamSlug);
  if (!serverAuth) return null;

  const sessions = await listSessions(serverAuth.teamId);

  // Group by user
  const byUser = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const name = s.user_name || "unknown";
    if (!byUser.has(name)) byUser.set(name, []);
    byUser.get(name)!.push(s);
  }

  const colors = ["#7c5bf5", "#3b82f6", "#3ecf71", "#f5c542", "#da70d6", "#ef4444"];
  const users = Array.from(byUser.entries()).map(([name, sessions], i) => ({
    name,
    sessions,
    color: colors[i % colors.length],
  }));

  // Activity stats
  const totalSessions = sessions.length;
  const activeSessions = sessions.filter((s) => s.status === "active").length;
  const uniqueRepos = new Set(sessions.flatMap((s) => s.git_remotes || [])).size;
  const uniqueBranches = new Set(sessions.map((s) => s.branch).filter(Boolean)).size;

  return (
    <div className="animate-fade-in">
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-6 h-[52px] border-b backdrop-blur-sm"
        style={{
          background: "rgba(10, 10, 15, 0.8)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <h1 className="text-sm font-semibold">Team Activity</h1>
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {users.length} team member{users.length !== 1 ? "s" : ""}
        </span>
      </header>

      {/* Activity overview */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4">
        {[
          { label: "Sessions", value: totalSessions },
          { label: "Active Now", value: activeSessions, accent: activeSessions > 0 },
          { label: "Repos", value: uniqueRepos },
          { label: "Branches", value: uniqueBranches },
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

      {/* User cards */}
      <div className="px-6 pb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map((user) => (
          <UserCard key={user.name} {...user} teamSlug={teamSlug} />
        ))}
      </div>
    </div>
  );
}
