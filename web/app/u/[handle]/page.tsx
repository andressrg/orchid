import type { Metadata } from 'next';
import Link from 'next/link';
import {
  resolveProfileUser,
  getPublicEfficiencyProfile,
  type PublicEfficiencyProfile,
} from '@/app/lib/queries';
import { ContributionGraph } from './contribution-graph';

// Public, shareable efficiency profile. No auth — renders only aggregate,
// public-safe stats (the Efficiency Score, a contribution heatmap, counts). It
// never reads or renders transcript bodies or any private session content.
//
// Headline: the Orchid Efficiency Score = PRs merged ÷ tokens spent, shown as
// "PRs per million tokens" with a gamified tier. Degrades to PRs-only or
// tokens-only when one input is missing.
//
// Follow-ups: OG share image (P7-5), real token totals replacing the estimate
// (P7-2), real merged-PR counts + GitHub handle as primary lookup (P7-1).

export const dynamic = 'force-dynamic';

const numberFormat = new Intl.NumberFormat('en-US');

const monthDay = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

// Compact token display: 1_250_000 → "1.3M", 48_000 → "48K".
const displayTokens = (tokens: number): string => {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000).toLocaleString('en-US')}K`;
  return numberFormat.format(tokens);
};

const oneDecimal = (value: number): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface ProfilePageProps {
  readonly params: Promise<{ handle: string }>;
}

export async function generateMetadata(props: ProfilePageProps): Promise<Metadata> {
  const { handle } = await props.params;
  const identity = await resolveProfileUser(handle);
  if (!identity) return { title: 'Profile not found — Orchid' };
  const title = `${identity.displayName}'s Efficiency Score — Orchid`;
  return {
    title,
    description: `${identity.displayName} ships with Orchid. PRs merged per million tokens, with a full contribution graph.`,
    openGraph: { title, type: 'profile' },
  };
}

function OrchidMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="var(--orchid-pink)"
        strokeWidth="1.5"
        fill="var(--orchid-pink-muted)"
      />
      <path
        d="M12 6C12 6 8 9 8 13C8 15.2 9.8 17 12 17C14.2 17 16 15.2 16 13C16 9 12 6 12 6Z"
        fill="var(--orchid-pink)"
        opacity="0.7"
      />
      <circle cx="12" cy="12" r="2" fill="var(--bg-primary)" />
    </svg>
  );
}

function ProfileStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="profile-stat" style={accent ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="profile-stat-value" style={accent ? { color: 'var(--accent)' } : undefined}>
        {value}
      </div>
      <div className="profile-stat-label">{label}</div>
    </div>
  );
}

// The headline. Default is the Efficiency Score (PRs merged ÷ tokens spent,
// shown as PR per million tokens) with its gamified tier. Degrades gracefully
// to a PRs-only or tokens-only view when one input is missing.
function HeadlineCard({ profile }: { profile: PublicEfficiencyProfile }) {
  const shipped = `${numberFormat.format(profile.prsMerged)} PR${profile.prsMerged === 1 ? '' : 's'} merged`;
  const burned = `${displayTokens(profile.tokensSpent)}${profile.tokensEstimated ? ' est.' : ''} tokens`;

  const headline =
    profile.headlineMode === 'efficiency'
      ? {
          value: oneDecimal(profile.score),
          unit: 'PRs / million tokens',
          sub: `${shipped} · ${burned}`,
        }
      : profile.headlineMode === 'prs-only'
        ? {
            value: numberFormat.format(profile.prsMerged),
            unit: 'PRs merged',
            sub: 'Token capture coming soon',
          }
        : {
            value: displayTokens(profile.tokensSpent),
            unit: 'tokens spent',
            sub: `${profile.totalSessions} sessions, no PRs yet`,
          };

  return (
    <section className="profile-headline">
      {profile.headlineMode === 'efficiency' && (
        <span className="profile-tier">{profile.tier.label}</span>
      )}
      <div className="profile-headline-row">
        <div className="profile-headline-value">{headline.value}</div>
        <div className="profile-headline-meta">
          <span className="profile-headline-unit">{headline.unit}</span>
          <span className="profile-headline-sub">{headline.sub}</span>
        </div>
      </div>
      <span className="profile-headline-caption">Orchid Efficiency Score</span>
    </section>
  );
}

function ProfileNotFound({ handle }: { handle: string }) {
  return (
    <main className="profile-page">
      <div className="profile-glow" />
      <div className="profile-shell profile-empty">
        <OrchidMark size={32} />
        <h1 className="profile-empty-title">No profile for “{handle}”</h1>
        <p className="profile-empty-sub">
          This handle doesn’t match anyone shipping with Orchid yet.
        </p>
        <Link href="/" className="profile-cta">
          What is Orchid?
        </Link>
      </div>
    </main>
  );
}

function EmptyProfile({ profile }: { profile: PublicEfficiencyProfile }) {
  return (
    <main className="profile-page">
      <div className="profile-glow" />
      <div className="profile-shell profile-empty">
        <div className="profile-avatar" aria-hidden>
          {profile.identity.avatarInitial}
        </div>
        <h1 className="profile-empty-title">{profile.identity.displayName}</h1>
        <p className="profile-empty-sub">
          No shipping activity captured yet. Run <code className="profile-code">orchid claude</code>{' '}
          to start the graph.
        </p>
        <Link href="/" className="profile-cta">
          Get Orchid
        </Link>
      </div>
    </main>
  );
}

export default async function PublicProfilePage(props: ProfilePageProps) {
  const { handle } = await props.params;
  const identity = await resolveProfileUser(handle);
  if (!identity) return <ProfileNotFound handle={handle} />;

  const profile = await getPublicEfficiencyProfile(identity);
  if (profile.activeDays === 0) return <EmptyProfile profile={profile} />;

  return (
    <main className="profile-page">
      <div className="profile-glow" />
      <div className="profile-shell animate-fade-in">
        {/* Identity */}
        <header className="profile-header">
          <div className="profile-avatar" aria-hidden>
            {profile.identity.avatarInitial}
          </div>
          <div className="profile-id">
            <h1 className="profile-name">{profile.identity.displayName}</h1>
            <span className="profile-handle">@{profile.identity.handle}</span>
          </div>
          <Link href="/" className="profile-brand" aria-label="Orchid">
            <OrchidMark />
            <span>Orchid</span>
          </Link>
        </header>

        {/* Headline — the Efficiency Score */}
        <HeadlineCard profile={profile} />

        {/* Aggregate stats */}
        <section className="profile-stats">
          <ProfileStat label="PRs merged" value={numberFormat.format(profile.prsMerged)} accent />
          <ProfileStat
            label={profile.tokensEstimated ? 'Tokens spent (est.)' : 'Tokens spent'}
            value={displayTokens(profile.tokensSpent)}
          />
          <ProfileStat label="Sessions" value={numberFormat.format(profile.totalSessions)} />
          <ProfileStat label="Active days" value={numberFormat.format(profile.activeDays)} />
        </section>

        {/* Contribution graph */}
        <section className="profile-section">
          <div className="profile-section-head">
            <h2 className="profile-section-title">Shipping activity</h2>
            <span className="profile-section-range">
              {monthDay(profile.firstActiveDay)} – {monthDay(profile.lastActiveDay)}
            </span>
          </div>
          <ContributionGraph days={profile.days} />
        </section>

        <footer className="profile-footer">
          <span>Shipped with</span>
          <Link href="/" className="profile-footer-brand">
            <OrchidMark size={16} />
            Orchid
          </Link>
        </footer>
      </div>
    </main>
  );
}
