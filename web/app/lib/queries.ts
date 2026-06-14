import { eq, and, or, desc, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { orchidSession, organization, member, user, sessionCommit, account } from './schema';
import { transcriptMatches, transcriptRank } from './fts';
import { fetchMergedPrCount, fetchGithubLogin, fetchContributionCalendar } from './github';

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
      // Count distinct people by email, not by display name — one person whose
      // user_name varies across rows must not inflate the member count.
      unique_users: sql<string>`count(distinct ${orchidSession.userEmail})`,
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

// ── GitHub account-linking state ──
//
// Whether a user has a GitHub login merged into their Orchid account, for the
// settings "Connected accounts" affordance. `linked` is read from the `account`
// table (the row Better Auth writes for providerId 'github' on BOTH the
// logged-out sign-in and the logged-in `/link-social` flows) — the
// authoritative signal. `githubLogin` is the handle mapped onto the user row at
// first GitHub sign-in (via `mapProfileToUser`); it can be null even when
// `linked` is true, because the logged-in link callback attaches the account
// row without re-running the profile mapping.
export interface GithubLinkState {
  readonly linked: boolean;
  readonly githubLogin: string | null;
}

export async function getGithubLinkState(userId: string): Promise<GithubLinkState> {
  const [githubAccount] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'github')))
    .limit(1);

  const [profile] = await db
    .select({ githubLogin: user.githubLogin })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return {
    linked: Boolean(githubAccount),
    githubLogin: profile?.githubLogin ?? null,
  };
}

// ── Public efficiency profile (P7-4) ──
//
// A PUBLIC, shareable `/u/<handle>` profile. Renders ONLY aggregate, public-safe
// stats — never transcript bodies or any private session content.
//
// Handle resolution: a GitHub login (`user.githubLogin`, captured on
// "Continue with GitHub" sign-in) is the PRIMARY public handle when present, so
// `/u/<github-login>` resolves and matches the profile's real merged-PR data.
// Falling back, a handle is resolved against existing `user` data, trying in
// order: the slugified display name (`julian-mazo`), the email local-part
// (`julian`), then the raw user id.
//
// Headline metric — the Orchid Efficiency Score: PRs merged ÷ tokens spent,
// expressed as "PRs shipped per million tokens" (PR/MTok) so the raw ratio
// reads as a postable, gamifiable number (e.g. `3.4`) instead of `0.0000034`.
// Higher = more shipped per token burned. The score carries a tier label
// (Warming up → Lean → Efficient → Elite → Legendary) for the brag.
//
// `prsMerged` is REAL for GitHub-linked users (P7-3): when the resolved user
// has a `githubLogin` + a GitHub `account.accessToken`, the count comes from
// the GitHub search API (`is:pr is:merged author:<login>`). When no GitHub
// account is linked — or the call times out / fails — it falls back to the
// commit-count proxy (a shipped commit ≈ a shipped PR). `tokensSpent` is still
// estimated from `message_count` (`TOKENS_PER_MESSAGE`), flagged
// `tokensEstimated: true`, until P7-2 captures real per-session token totals.
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
  // GitHub login when the user signed in with GitHub; drives the real merged-PR
  // count. null for email/password users (the profile uses the commit proxy).
  readonly githubLogin: string | null;
}

export interface ProfileDayActivity {
  readonly day: string; // YYYY-MM-DD
  readonly sessions: number;
  readonly commits: number;
  // Real GitHub contributions for the day (the green-graph count) when the user
  // has a linked GitHub account; 0 otherwise. The heatmap colors by
  // `sessions + commits + contributions`, so GitHub-linked profiles light up
  // across the full year while Orchid-only profiles still light up by sessions.
  readonly contributions: number;
}

export interface EfficiencyTier {
  readonly label: string;
  readonly min: number; // PR/MTok threshold (inclusive) to reach this tier.
}

export interface PublicEfficiencyProfile {
  readonly identity: PublicProfileIdentity;
  readonly totalSessions: number;
  readonly totalCommits: number;
  readonly prsMerged: number; // real merged PRs (GitHub) or commit-count proxy.
  readonly prsFromGithub: boolean; // true when prsMerged is the real GitHub count.
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
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      githubLogin: user.githubLogin,
    })
    .from(user);

  // GitHub login wins as the primary handle (so `/u/<github-login>` resolves),
  // then slugified name, then email local-part, then raw id.
  const match = rows.find(
    (row) =>
      slugifyHandle(row.githubLogin ?? '') === wanted ||
      slugifyHandle(row.name) === wanted ||
      slugifyHandle(emailLocalPart(row.email)) === wanted ||
      row.id === handle,
  );
  if (!match) return null;

  const displayName = match.name?.trim() || emailLocalPart(match.email) || match.id;
  return {
    handle:
      slugifyHandle(match.githubLogin ?? '') ||
      slugifyHandle(match.name) ||
      slugifyHandle(emailLocalPart(match.email)) ||
      match.id,
    displayName,
    userId: match.id,
    userEmail: match.email,
    avatarInitial: (displayName[0] ?? '?').toUpperCase(),
    githubLogin: match.githubLogin ?? null,
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

// Stored GitHub access token for a user, from the Better Auth `account` table
// (providerId 'github'). Returns null when the user has no linked GitHub
// account — the profile then uses the commit-count proxy for PRs. Public-safe:
// the token is only used server-side for the merged-PR count, never rendered.
const githubAccessTokenForUser = async (userId: string): Promise<string | null> => {
  const [row] = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'github')))
    .limit(1);
  return row?.accessToken ?? null;
};

// Recover a GitHub login when the user has a linked GitHub account but no
// stored `githubLogin` — which is the case for an account MERGED into an
// existing email/password user, since Better Auth runs `mapProfileToUser` only
// on user creation, not on link. We read the login from the account's token
// (GitHub /user) and backfill `user.githubLogin`/`githubId` so future reads and
// the `/u/<login>` handle work without another GitHub call. Best-effort: the
// backfill never blocks the public page. Returns the login, or null.
const resolveAndBackfillGithubLogin = async (
  userId: string,
  accessToken: string,
): Promise<string | null> => {
  const profile = await fetchGithubLogin({ accessToken });
  if (!profile) return null;
  await db
    .update(user)
    .set({ githubLogin: profile.login, githubId: profile.id || null })
    .where(eq(user.id, userId))
    .catch(() => undefined);
  return profile.login;
};

// Real merged-PR count for a GitHub-linked identity, or null to fall back to
// the commit proxy. Needs a stored GitHub access token; the login comes from
// `githubLogin` when present, else it's recovered from the token (merged
// account). The GitHub call is timeout-bounded and never throws (see ./github).
const realMergedPrCount = async (identity: PublicProfileIdentity): Promise<number | null> => {
  const accessToken = await githubAccessTokenForUser(identity.userId);
  if (!accessToken) return null;
  const login =
    identity.githubLogin ?? (await resolveAndBackfillGithubLogin(identity.userId, accessToken));
  if (!login) return null;
  return fetchMergedPrCount({ login, accessToken });
};

// Real GitHub contribution calendar (the green graph) for a GitHub-linked
// identity, or null to keep the Orchid-session heatmap. `viewer` is the token
// owner, so only a stored GitHub access token is needed — no login lookup. The
// call is timeout-bounded and never throws (see ./github), so the public page
// never blocks on it.
const realContributionCalendar = async (
  identity: PublicProfileIdentity,
): Promise<ReadonlyArray<{ readonly day: string; readonly count: number }> | null> => {
  const accessToken = await githubAccessTokenForUser(identity.userId);
  if (!accessToken) return null;
  const calendar = await fetchContributionCalendar({ accessToken });
  return calendar?.days ?? null;
};

// Compute the public, aggregate efficiency profile for a resolved identity.
// Batches into parallel queries: a per-day activity roll-up (the Orchid-session
// heatmap fallback), a deduplicated profile-wide summary (commits + message
// count for the token estimate, kept off the commit-join fan-out), and — for
// GitHub-linked users — the real merged-PR count plus the real GitHub
// contribution calendar. When the calendar is present it drives the heatmap
// (and activeDays/range) so the "Shipping activity" graph mirrors the user's
// full-year GitHub green graph; otherwise it falls back to Orchid sessions.
// `totalSessions` stays the Orchid session count regardless. Sessions are
// matched on `user_id` OR `user_email` so legacy rows captured before accounts
// existed (email only, no user_id) still count.
export async function getPublicEfficiencyProfile(
  identity: PublicProfileIdentity,
): Promise<PublicEfficiencyProfile> {
  const ownsSession = identity.userEmail
    ? or(eq(orchidSession.userId, identity.userId), eq(orchidSession.userEmail, identity.userEmail))
    : eq(orchidSession.userId, identity.userId);

  const [dayRows, [summary], githubPrCount, githubCalendar] = await Promise.all([
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
    // Real merged-PR count for GitHub-linked users; null otherwise (or on a
    // timeout/failure). Runs in parallel with the aggregate queries so it never
    // serializes the public page.
    realMergedPrCount(identity),
    // Real GitHub contribution calendar (the green graph) for the heatmap; null
    // when no GitHub link or the call fails. Also runs in parallel.
    realContributionCalendar(identity),
  ]);

  // Orchid-session per-day series (the fallback heatmap source). `contributions`
  // is 0 here — these days light up via sessions + commits.
  const sessionDays: readonly ProfileDayActivity[] = dayRows.map((row) => ({
    day: row.day,
    sessions: Number(row.sessions),
    commits: Number(row.commits),
    contributions: 0,
  }));

  // The heatmap reflects GitHub when the calendar is linked: one day per
  // calendar entry, with the GitHub `contributionCount` driving intensity. We
  // merge in any same-day Orchid sessions/commits so a linked user's grid shows
  // both, but GitHub contributions are the headline. When there's no GitHub
  // link or the fetch failed, we fall back to the Orchid-session series.
  const sessionsByDay = new Map(sessionDays.map((entry) => [entry.day, entry]));
  const days: readonly ProfileDayActivity[] =
    githubCalendar !== null
      ? githubCalendar.map((entry) => {
          const session = sessionsByDay.get(entry.day);
          return {
            day: entry.day,
            sessions: session?.sessions ?? 0,
            commits: session?.commits ?? 0,
            contributions: entry.count,
          };
        })
      : sessionDays;

  // Active days / range derive from whichever series drives the heatmap: GitHub
  // days with a contribution > 0 (so the header spans the full GitHub year), or
  // the Orchid active days when falling back.
  const activeDayList = days.filter(
    (entry) => entry.sessions + entry.commits + entry.contributions > 0,
  );
  const activeDayKeys = activeDayList.map((entry) => entry.day).sort();

  const totalSessions = Number(summary?.sessions ?? 0);
  const totalCommits = Number(summary?.commits ?? 0);
  const totalMessages = Number(summary?.messages ?? 0);

  // PRs merged: the REAL GitHub count when the user is linked and the call
  // succeeded; otherwise the commit-count proxy (a shipped commit ≈ a PR).
  const prsFromGithub = githubPrCount !== null;
  const prsMerged = prsFromGithub ? githubPrCount : totalCommits;
  // Tokens spent ≈ estimated from messages (swaps to real tokens in P7-2).
  const tokensSpent = sessionTokenEstimate(totalMessages);
  const score = efficiencyScore({ prsMerged, tokensSpent });

  return {
    identity,
    totalSessions,
    totalCommits,
    prsMerged,
    prsFromGithub,
    tokensSpent,
    tokensEstimated: true,
    activeDays: activeDayKeys.length,
    firstActiveDay: activeDayKeys[0] ?? null,
    lastActiveDay: activeDayKeys[activeDayKeys.length - 1] ?? null,
    headlineMode: headlineModeFor({ prsMerged, tokensSpent }),
    score,
    tier: efficiencyTierForScore(score),
    days,
  };
}
