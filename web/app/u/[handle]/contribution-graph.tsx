import type { ProfileDayActivity } from '@/app/lib/queries';

// GitHub-style calendar heatmap. Pure render — derives the full grid from the
// activity series; no client JS, no effects. 53 weeks ending today, Sunday-first
// columns. Intensity is bucketed by that day's activity = sessions + commits
// (sessions alone light the grid until commit↔session linking is populated).

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 53;
const DAYS_IN_WEEK = 7;

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

// Start the grid on the Sunday on/before (today - 52 weeks), so the last column
// is the current week.
const gridStart = (today: Date): Date => {
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const start = new Date(todayUtc - (WEEKS * DAYS_IN_WEEK - 1) * DAY_MS);
  return new Date(start.getTime() - start.getUTCDay() * DAY_MS);
};

// A day's activity drives the heatmap intensity: sessions + commits, so the
// grid reflects work even before commits are linked to sessions.
const activityOf = (day: { readonly sessions: number; readonly commits: number }): number =>
  day.sessions + day.commits;

// Five-stop intensity ramp from "empty" to the orchid accent.
const intensityColor = (count: number, max: number): string => {
  if (count <= 0) return 'var(--bg-tertiary)';
  const ratio = max > 0 ? count / max : 0;
  const stop = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
  const ramp = [
    'rgba(124, 91, 245, 0.18)',
    'rgba(124, 91, 245, 0.38)',
    'rgba(124, 91, 245, 0.62)',
    'var(--accent)',
  ];
  return ramp[stop - 1];
};

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function ContributionGraph({ days }: { days: readonly ProfileDayActivity[] }) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const maxActivity = days.reduce((max, d) => Math.max(max, activityOf(d)), 0);
  const start = gridStart(new Date());

  // Build 53 weeks × 7 days as a flat, immutable grid.
  const weeks = Array.from({ length: WEEKS }, (_, week) =>
    Array.from({ length: DAYS_IN_WEEK }, (_, weekday) => {
      const date = new Date(start.getTime() + (week * DAYS_IN_WEEK + weekday) * DAY_MS);
      const key = isoDay(date);
      const activity = byDay.get(key);
      return {
        key,
        date,
        commits: activity?.commits ?? 0,
        sessions: activity?.sessions ?? 0,
        isFuture: date.getTime() > Date.now(),
      };
    }),
  );

  // Month labels above the columns: show a label on the first week whose first
  // row crosses into a new month.
  const monthMarkers = weeks.map((week, i) => {
    const firstOfWeek = week[0].date;
    const prevMonth = i > 0 ? weeks[i - 1][0].date.getUTCMonth() : -1;
    return firstOfWeek.getUTCMonth() !== prevMonth ? MONTH_LABELS[firstOfWeek.getUTCMonth()] : '';
  });

  return (
    <div className="profile-graph">
      <div className="profile-graph-scroll">
        <div className="profile-graph-months">
          {monthMarkers.map((label, i) => (
            <span key={i} className="profile-graph-month" style={{ gridColumn: i + 2 }}>
              {label}
            </span>
          ))}
        </div>
        <div className="profile-graph-body">
          <div className="profile-graph-weekdays">
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>
          <div className="profile-graph-grid">
            {weeks.map((week, wi) => (
              <div key={wi} className="profile-graph-week">
                {week.map((cell) => (
                  <div
                    key={cell.key}
                    className="profile-graph-cell"
                    style={{
                      background: cell.isFuture
                        ? 'transparent'
                        : intensityColor(cell.sessions + cell.commits, maxActivity),
                      opacity: cell.isFuture ? 0 : 1,
                    }}
                    title={
                      cell.isFuture
                        ? undefined
                        : `${cell.commits} commit${cell.commits === 1 ? '' : 's'} · ${cell.sessions} session${cell.sessions === 1 ? '' : 's'} on ${cell.key}`
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="profile-graph-legend">
        <span>Less</span>
        <span className="profile-graph-cell" style={{ background: 'var(--bg-tertiary)' }} />
        <span className="profile-graph-cell" style={{ background: 'rgba(124, 91, 245, 0.18)' }} />
        <span className="profile-graph-cell" style={{ background: 'rgba(124, 91, 245, 0.38)' }} />
        <span className="profile-graph-cell" style={{ background: 'rgba(124, 91, 245, 0.62)' }} />
        <span className="profile-graph-cell" style={{ background: 'var(--accent)' }} />
        <span>More</span>
      </div>
    </div>
  );
}
