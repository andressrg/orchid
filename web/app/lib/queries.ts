import { eq, and, desc, sql, ilike } from 'drizzle-orm';
import { db } from './db';
import { orchidSession, organization, member } from './schema';

// Resolve team ID from slug + user membership
export async function resolveTeamId(teamSlug: string, userId: string): Promise<string | null> {
  const [team] = await db
    .select({ id: organization.id })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(organization.slug, teamSlug), eq(member.userId, userId)));
  return team?.id || null;
}

// Get user's first team slug
export async function getFirstTeamSlug(userId: string): Promise<string | null> {
  const [team] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(member.createdAt)
    .limit(1);
  return team?.slug || null;
}

// Get all teams for a user
export async function getUserTeams(userId: string) {
  return db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(organization.name);
}

// List sessions for a team (returns API-compatible format)
export async function listSessions(teamId: string) {
  const rows = await db
    .select({
      id: orchidSession.id,
      user_name: orchidSession.userName,
      user_email: orchidSession.userEmail,
      working_dir: orchidSession.workingDir,
      git_remotes: orchidSession.gitRemotes,
      branch: orchidSession.branch,
      tool: orchidSession.tool,
      started_at: orchidSession.startedAt,
      updated_at: orchidSession.updatedAt,
      status: orchidSession.status,
      message_count: orchidSession.messageCount,
    })
    .from(orchidSession)
    .where(eq(orchidSession.teamId, teamId))
    .orderBy(desc(orchidSession.startedAt));

  return rows.map((r) => ({
    ...r,
    user_name: r.user_name || '',
    user_email: r.user_email || '',
    working_dir: r.working_dir || '',
    branch: r.branch || '',
    tool: r.tool || '',
    started_at: r.started_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    message_count: r.message_count || 0,
  }));
}

// Get stats for a team
export async function getTeamStats(teamId: string) {
  const [stats] = await db
    .select({
      total_sessions: sql<string>`count(*)`,
      active_sessions: sql<string>`count(*) filter (where ${orchidSession.status} = 'active')`,
      unique_users: sql<string>`count(distinct ${orchidSession.userName})`,
      first_session: sql<string>`min(${orchidSession.startedAt})`,
      last_activity: sql<string>`max(${orchidSession.updatedAt})`,
    })
    .from(orchidSession)
    .where(eq(orchidSession.teamId, teamId));
  return stats;
}

// Get a single session (scoped to team)
// Session metadata only — deliberately does NOT select the (potentially huge)
// transcript TEXT column, so the detail page's metadata paint stays off the
// JSONL read path. The conversation body is fetched separately via
// `getSessionTranscriptById` (streamed in after the metadata renders).
export async function getSessionById(sessionId: string, teamId: string) {
  const [row] = await db
    .select({
      id: orchidSession.id,
      userName: orchidSession.userName,
      userEmail: orchidSession.userEmail,
      workingDir: orchidSession.workingDir,
      gitRemotes: orchidSession.gitRemotes,
      branch: orchidSession.branch,
      tool: orchidSession.tool,
      startedAt: orchidSession.startedAt,
      updatedAt: orchidSession.updatedAt,
      status: orchidSession.status,
      messageCount: orchidSession.messageCount,
    })
    .from(orchidSession)
    .where(and(eq(orchidSession.id, sessionId), eq(orchidSession.teamId, teamId)));
  if (!row) return null;
  return {
    id: row.id,
    user_name: row.userName || '',
    user_email: row.userEmail || '',
    working_dir: row.workingDir || '',
    git_remotes: (row.gitRemotes as string[]) || [],
    branch: row.branch || '',
    tool: row.tool || '',
    started_at: row.startedAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    status: row.status,
    message_count: row.messageCount || 0,
  };
}

// Dedicated transcript fetch — selects ONLY the transcript body for one scoped
// session. Kept separate from `getSessionById` so metadata reads never pull the
// JSONL. Returns null when the session doesn't exist / isn't in the team.
export async function getSessionTranscriptById(
  sessionId: string,
  teamId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ transcript: orchidSession.transcript })
    .from(orchidSession)
    .where(and(eq(orchidSession.id, sessionId), eq(orchidSession.teamId, teamId)));
  if (!row) return null;
  return row.transcript || '';
}

// Search sessions
export async function searchSessions(teamId: string, query: string) {
  const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
  return db
    .select({
      id: orchidSession.id,
      user_name: orchidSession.userName,
      user_email: orchidSession.userEmail,
      working_dir: orchidSession.workingDir,
      branch: orchidSession.branch,
      started_at: orchidSession.startedAt,
      updated_at: orchidSession.updatedAt,
      status: orchidSession.status,
      message_count: orchidSession.messageCount,
    })
    .from(orchidSession)
    .where(and(eq(orchidSession.teamId, teamId), ilike(orchidSession.transcript, `%${escaped}%`)))
    .orderBy(desc(orchidSession.startedAt));
}
