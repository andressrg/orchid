import { eq, and, or, desc, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { orchidSession, organization, member, user, sessionCommit } from './schema';
import { transcriptMatches, transcriptRank } from './fts';

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
      input_tokens: orchidSession.inputTokens,
      output_tokens: orchidSession.outputTokens,
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
    input_tokens: r.input_tokens || 0,
    output_tokens: r.output_tokens || 0,
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
      inputTokens: orchidSession.inputTokens,
      outputTokens: orchidSession.outputTokens,
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
    input_tokens: row.inputTokens || 0,
    output_tokens: row.outputTokens || 0,
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

// Search sessions — Postgres full-text search over the transcript.
//
// Matches with `websearch_to_tsquery('english', …)` against the STORED
// `transcript_search` tsvector (GIN-indexed), ranks by `ts_rank` DESC, and
// breaks ties by most-recent. `websearch_to_tsquery` tolerates arbitrary input
// (quotes, `or`, `-`, stray operators) without throwing, so malformed queries
// degrade to "no matches" rather than a 500. The result shape is unchanged from
// the previous `ilike` implementation.
export async function searchSessions(teamId: string, query: string) {
  const rank: SQL<number> = transcriptRank(query);
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
    .where(and(eq(orchidSession.teamId, teamId), transcriptMatches(query)))
    .orderBy(desc(rank), desc(orchidSession.startedAt));
}

// ── Public efficiency profile (P7-4) ──
//
// A PUBLIC, shareable `/u/<handle>` profile. Renders ONLY aggregate, public-safe
// stats — never transcript bodies or any private session content.
//
// Handle resolution: users do not have a public-handle column yet (that arrives
// with GitHub handles in P7-1). Until then a handle is resolved against existing
// `user` data, trying in order: the slugified display name (`julian-mazo`), the
// email local-part (`julian`), then the raw user id. Structured so a real
// `user.handle` column can become the primary lookup later without touching the
// page.
//
// Headline metric — the Orchid Efficiency Score: PRs merged ÷ tokens spent,
// expressed as "PRs shipped per million tokens" (PR/MTok) so the raw ratio
// reads as a postable, gamifiable number (e.g. `3.4`) instead of `0.0000034`.
// Higher = more shipped per token burned. The score carries a tier label
// (Warming up → Lean → Efficient → Elite → Legendary) for the brag.
//
// Two columns the score wants — merged-PR count and tokens spent — are not in
// `schema.ts` yet (they arrive with P7-1 GitHub linking and P7-2 token capture).
// So the profile NEVER references non-existent columns: it computes both from
// data that exists today via two single swap points —
//   • `prsMerged`   ← commit count (a shipped commit ≈ a shipped PR for now).
//   • `tokensSpent` ← estimated from `message_count` (`TOKENS_PER_MESSAGE`),
//                     flagged `tokensEstimated: true`.
// Replace those two derivations with the real columns when they land and the
// whole score, tiers, and graceful-degradation UI keep working unchanged.
//
// Graceful degradation: when tokens are unknown the headline falls back to a
// PRs-only view; when PRs are zero it shows the tokens-burned view. The mode is
// reported as `headlineMode` so the page renders the right shape.

// A coding turn averages on the order of a few thousand tokens once tool
// results, file reads, and the prompt are counted. This single constant is the
// estimate's only knob; real per-session token totals replace it in P7-2.
export const TOKENS_PER_MESSAGE = 2500;

export type HeadlineMode = 'efficiency' | 'prs-only' | 'tokens-only' | 'empty';

export interface PublicProfileIdentity {
  readonly handle: string;
  readonly displayName: string;
  readonly userId: string;
  readonly userEmail: string | null;
  readonly avatarInitial: string;
}

export interface ProfileDayActivity {
  readonly day: string; // YYYY-MM-DD
  readonly sessions: number;
  readonly commits: number;
}

export interface EfficiencyTier {
  readonly label: string;
  readonly min: number; // PR/MTok threshold (inclusive) to reach this tier.
}

export interface PublicEfficiencyProfile {
  readonly identity: PublicProfileIdentity;
  readonly totalSessions: number;
  readonly totalCommits: number;
  readonly prsMerged: number; // shipped PRs (commit count proxy until P7-1).
  readonly tokensSpent: number; // tokens burned (estimated until P7-2).
  readonly tokensEstimated: boolean;
  readonly activeDays: number;
  readonly firstActiveDay: string | null;
  readonly lastActiveDay: string | null;
  // The Efficiency Score: PRs shipped per million tokens.
  readonly headlineMode: HeadlineMode;
  readonly score: number; // PR / MTok, rounded; 0 when not computable.
  readonly tier: EfficiencyTier;
  readonly days: readonly ProfileDayActivity[];
}

// Tiers for the gamified score, evaluated high→low. Thresholds are PR/MTok.
export const EFFICIENCY_TIERS: readonly EfficiencyTier[] = [
  { label: 'Legendary', min: 8 },
  { label: 'Elite', min: 4 },
  { label: 'Efficient', min: 2 },
  { label: 'Lean', min: 0.75 },
  { label: 'Warming up', min: 0 },
];

export function efficiencyTierForScore(score: number): EfficiencyTier {
  return (
    EFFICIENCY_TIERS.find((tier) => score >= tier.min) ??
    EFFICIENCY_TIERS[EFFICIENCY_TIERS.length - 1]
  );
}

// Lower-cased, dash-separated slug. `Julian Mazo` → `julian-mazo`.
export function slugifyHandle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const emailLocalPart = (email: string): string => email.split('@')[0] ?? '';

// Resolve a public profile identity from a URL handle, against existing user
// data. Returns null when nothing matches. Public-safe: email is carried only
// for the aggregate session lookup, never rendered.
export async function resolveProfileUser(handle: string): Promise<PublicProfileIdentity | null> {
  const wanted = slugifyHandle(handle);
  const rows = await db.select({ id: user.id, name: user.name, email: user.email }).from(user);

  const match = rows.find(
    (row) =>
      slugifyHandle(row.name) === wanted ||
      slugifyHandle(emailLocalPart(row.email)) === wanted ||
      row.id === handle,
  );
  if (!match) return null;

  const displayName = match.name?.trim() || emailLocalPart(match.email) || match.id;
  return {
    handle: slugifyHandle(match.name) || slugifyHandle(emailLocalPart(match.email)) || match.id,
    displayName,
    userId: match.id,
    userEmail: match.email,
    avatarInitial: (displayName[0] ?? '?').toUpperCase(),
  };
}

const roundTo = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const TOKENS_PER_MILLION = 1_000_000;

// Estimated tokens for one session from its message count. Single swap point:
// replace the body with the real per-session token total once P7-2 captures it.
export const sessionTokenEstimate = (messageCount: number): number =>
  Math.max(messageCount, 0) * TOKENS_PER_MESSAGE;

// PRs shipped per million tokens. The headline number; 0 when not computable.
export const efficiencyScore = ({
  prsMerged,
  tokensSpent,
}: {
  prsMerged: number;
  tokensSpent: number;
}): number => (tokensSpent > 0 ? roundTo(prsMerged / (tokensSpent / TOKENS_PER_MILLION), 1) : 0);

const headlineModeFor = ({
  prsMerged,
  tokensSpent,
}: {
  prsMerged: number;
  tokensSpent: number;
}): HeadlineMode => {
  if (prsMerged <= 0 && tokensSpent <= 0) return 'empty';
  if (tokensSpent <= 0) return 'prs-only';
  if (prsMerged <= 0) return 'tokens-only';
  return 'efficiency';
};

// Compute the public, aggregate efficiency profile for a resolved identity.
// Batches into two parallel queries: a per-day activity roll-up (for the
// contribution graph) and a deduplicated profile-wide summary (commits +
// message count for the token estimate, kept off the commit-join fan-out).
// Sessions are matched on `user_id` OR `user_email` so legacy rows captured
// before accounts existed (email only, no user_id) still count.
export async function getPublicEfficiencyProfile(
  identity: PublicProfileIdentity,
): Promise<PublicEfficiencyProfile> {
  const ownsSession = identity.userEmail
    ? or(eq(orchidSession.userId, identity.userId), eq(orchidSession.userEmail, identity.userEmail))
    : eq(orchidSession.userId, identity.userId);

  const [dayRows, [summary]] = await Promise.all([
    // Per-day series: one row per active day with that day's session + commit
    // counts. Sessions bucketed by started_at in UTC for a stable heatmap.
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${orchidSession.startedAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        sessions: sql<string>`count(distinct ${orchidSession.id})`,
        commits: sql<string>`count(${sessionCommit.id})`,
      })
      .from(orchidSession)
      .leftJoin(sessionCommit, eq(sessionCommit.sessionId, orchidSession.id))
      .where(ownsSession)
      .groupBy(sql`date_trunc('day', ${orchidSession.startedAt} at time zone 'UTC')`)
      .orderBy(sql`date_trunc('day', ${orchidSession.startedAt} at time zone 'UTC')`),
    // Profile totals computed WITHOUT the commit join so message_count isn't
    // fanned out. Commits counted via a correlated subquery on the same scope.
    db
      .select({
        sessions: sql<string>`count(distinct ${orchidSession.id})`,
        messages: sql<string>`coalesce(sum(${orchidSession.messageCount}), 0)`,
        commits: sql<string>`(select count(*) from ${sessionCommit} where ${sessionCommit.sessionId} in (select ${orchidSession.id} from ${orchidSession} where ${ownsSession}))`,
      })
      .from(orchidSession)
      .where(ownsSession),
  ]);

  const days: readonly ProfileDayActivity[] = dayRows.map((row) => ({
    day: row.day,
    sessions: Number(row.sessions),
    commits: Number(row.commits),
  }));

  const totalSessions = Number(summary?.sessions ?? 0);
  const totalCommits = Number(summary?.commits ?? 0);
  const totalMessages = Number(summary?.messages ?? 0);

  // PRs merged ≈ commits shipped (swaps to real merged-PR count in P7-1).
  const prsMerged = totalCommits;
  // Tokens spent ≈ estimated from messages (swaps to real tokens in P7-2).
  const tokensSpent = sessionTokenEstimate(totalMessages);
  const score = efficiencyScore({ prsMerged, tokensSpent });

  return {
    identity,
    totalSessions,
    totalCommits,
    prsMerged,
    tokensSpent,
    tokensEstimated: true,
    activeDays: days.length,
    firstActiveDay: days[0]?.day ?? null,
    lastActiveDay: days[days.length - 1]?.day ?? null,
    headlineMode: headlineModeFor({ prsMerged, tokensSpent }),
    score,
    tier: efficiencyTierForScore(score),
    days,
  };
}
