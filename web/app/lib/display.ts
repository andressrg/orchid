// Display-only helpers for rendering session metadata. None of these affect
// ownership or scoping (that is keyed on user_id); they only make existing rows
// read nicely at render time, with no re-sync needed.

// Returns a friendly name for a session's user. Falls back to a title-cased
// email local-part when `user_name` is missing or a placeholder/garbage value
// ('unconfigured', 'unknown', or a config-key-like 'user.email'). When neither a
// usable name nor an email is available, returns 'Unknown'.
export const friendlyUserName = (
  name: string | null | undefined,
  email: string | null | undefined,
): string => {
  const n = (name ?? '').trim();
  const bad = n === '' || n === 'unconfigured' || n === 'unknown' || /^[a-z]+\.[a-z]+$/.test(n);
  if (!bad) return n;
  const local = (email ?? '').split('@')[0] ?? '';
  return local ? local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown';
};

// Which empty/locked state the team dashboard should render. Sessions are
// private by default (P1), so the scoped list a viewer sees can be empty even
// when the team has lots of activity. Distinguish the two so a new teammate
// isn't told "no sessions yet" when the team is busy but nothing is shared:
//   - 'list'   → the viewer has visible sessions; render them.
//   - 'locked' → the viewer sees none, but the team has sessions (private to
//                their owners). Show a "nothing shared with you" state.
//   - 'fresh'  → the team genuinely has no sessions; show the onboarding CTA.
// The team-wide counts on the stat cards stay aggregate by design (team
// activity metrics, not content); only the session LIST is owner/visibility-scoped.
export type DashboardListState = 'list' | 'locked' | 'fresh';

export const dashboardListState = ({
  visibleCount,
  totalTeamSessions,
}: {
  readonly visibleCount: number;
  readonly totalTeamSessions: number;
}): DashboardListState => {
  if (visibleCount > 0) return 'list';
  return totalTeamSessions > 0 ? 'locked' : 'fresh';
};
