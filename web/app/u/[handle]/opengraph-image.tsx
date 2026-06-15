import { ImageResponse } from 'next/og';
import {
  resolveProfileUser,
  getPublicEfficiencyProfile,
  type PublicEfficiencyProfile,
  type ProfileDayActivity,
  type PublicProfileIdentity,
} from '@/app/lib/queries';

// Auto-generated social card for the public efficiency profile (P7-5). Next
// wires this `opengraph-image` file into the page's openGraph.images + the
// twitter image automatically (file convention) — the page never hardcodes URLs.
//
// Node.js runtime is REQUIRED: this queries Postgres (pg driver) via
// getPublicEfficiencyProfile, which does NOT run on the Edge runtime.
//
// ImageResponse (Satori) supports a flexbox subset only — NO display:grid, NO
// CSS variables, NO external CSS. Every multi-child container sets display:flex,
// and all colors are LITERAL hex copied from globals.css. The card mirrors the
// live /u/<handle> profile: tier badge, the big gradient headline, the name +
// @handle, secondary stats, a compact contribution-graph strip, and the Orchid
// wordmark.

export const runtime = 'nodejs';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Orchid efficiency profile — PRs shipped per million tokens';

// ── Brand palette (literal hex from app/globals.css — Satori has no CSS vars) ──
const BG_PRIMARY = '#0a0a0f';
const BG_TERTIARY = '#1a1a24';
const BORDER_SUBTLE = '#1e1e2e';
const TEXT_PRIMARY = '#e8e8ed';
const TEXT_SECONDARY = '#8b8b9e';
const TEXT_TERTIARY = '#5c5c72';
const ACCENT = '#7c5bf5';
const ORCHID_PINK = '#da70d6';

// Contribution-strip intensity ramp — the same five stops the live graph uses.
const RAMP = [
  BG_TERTIARY,
  'rgba(124, 91, 245, 0.18)',
  'rgba(124, 91, 245, 0.38)',
  'rgba(124, 91, 245, 0.62)',
  ACCENT,
];

const numberFormat = new Intl.NumberFormat('en-US');

const displayTokens = (tokens: number): string => {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000).toLocaleString('en-US')}K`;
  return numberFormat.format(tokens);
};

const oneDecimal = (value: number): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const activityOf = (day: ProfileDayActivity): number =>
  day.sessions + day.commits + day.contributions;

// The headline shown on the card, derived per headlineMode exactly like the
// live profile's HeadlineCard (efficiency score → PRs-only → tokens-only).
interface CardHeadline {
  readonly tierLabel: string | null;
  readonly value: string;
  readonly unit: string;
  readonly sub: string;
}

const headlineFor = (profile: PublicEfficiencyProfile): CardHeadline => {
  const shipped = `${numberFormat.format(profile.prsMerged)} PR${profile.prsMerged === 1 ? '' : 's'} merged`;
  const burned = `${displayTokens(profile.tokensSpent)}${profile.tokensEstimated ? ' est.' : ''} tokens`;
  if (profile.headlineMode === 'efficiency')
    return {
      tierLabel: profile.tier.label,
      value: oneDecimal(profile.score),
      unit: 'PRs / million tokens',
      sub: `${shipped} · ${burned}`,
    };
  if (profile.headlineMode === 'prs-only')
    return {
      tierLabel: null,
      value: numberFormat.format(profile.prsMerged),
      unit: 'PRs merged',
      sub: 'Token capture coming soon',
    };
  return {
    tierLabel: null,
    value: displayTokens(profile.tokensSpent),
    unit: 'tokens spent',
    sub: `${numberFormat.format(profile.totalSessions)} sessions`,
  };
};

// Compact contribution strip: the most-recent COLUMNS weeks as columns of small
// rounded cells, intensity-colored from the series. Satori has no grid, so this
// is a flex row of flex columns. Kept small + legible at OG scale.
const STRIP_WEEKS = 30;
const DAYS_IN_WEEK = 7;

interface StripCell {
  readonly key: string;
  readonly color: string;
}

const contributionStrip = (
  days: readonly ProfileDayActivity[],
): readonly (readonly StripCell[])[] => {
  const maxActivity = days.reduce((max, day) => Math.max(max, activityOf(day)), 0);
  // Most-recent STRIP_WEEKS worth of active days, oldest→newest, padded to a
  // whole number of week-columns so the grid is rectangular.
  const recent = days.slice(Math.max(0, days.length - STRIP_WEEKS * DAYS_IN_WEEK));
  const padCount = (DAYS_IN_WEEK - (recent.length % DAYS_IN_WEEK)) % DAYS_IN_WEEK;
  const cells: readonly StripCell[] = [
    ...Array.from({ length: padCount }, (_, i) => ({ key: `pad-${i}`, color: BG_TERTIARY })),
    ...recent.map((day) => {
      const ratio = maxActivity > 0 ? activityOf(day) / maxActivity : 0;
      const stop =
        activityOf(day) <= 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
      return { key: day.day, color: RAMP[stop] };
    }),
  ];
  // Chunk the flat day list into week-columns (7 cells each).
  return Array.from({ length: Math.ceil(cells.length / DAYS_IN_WEEK) }, (_, week) =>
    cells.slice(week * DAYS_IN_WEEK, week * DAYS_IN_WEEK + DAYS_IN_WEEK),
  );
};

function OrchidWordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: 12,
          background: 'rgba(218, 112, 214, 0.15)',
          border: `1px solid ${ORCHID_PINK}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            width: 14,
            height: 14,
            borderRadius: 7,
            background: ORCHID_PINK,
          }}
        />
      </div>
      <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: TEXT_PRIMARY }}>
        Orchid
      </div>
    </div>
  );
}

// Branded fallback when the handle resolves to nobody — still 1200×630, 200.
const fallbackCard = () =>
  new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: 72,
        background: BG_PRIMARY,
        backgroundImage: `radial-gradient(circle at 78% 8%, rgba(124, 91, 245, 0.22), transparent 55%)`,
      }}
    >
      <OrchidWordmark />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            fontSize: 64,
            fontWeight: 750,
            letterSpacing: '-0.03em',
            color: TEXT_PRIMARY,
          }}
        >
          Orchid
        </div>
        <div style={{ display: 'flex', fontSize: 32, color: TEXT_SECONDARY }}>
          The repository of agents&apos; thoughts
        </div>
      </div>
      <div style={{ display: 'flex', fontSize: 22, color: TEXT_TERTIARY }}>orchidkeep.com</div>
    </div>,
    { ...size },
  );

// Empty-profile card — mirrors the live page's <EmptyProfile />, which renders
// when profile.activeDays === 0 (a just-registered user with no captured
// activity). It shows the person's avatar + name and the same "no shipping
// activity yet" message instead of the populated data card, so a pasted
// /u/<handle> link never shows a misleading "0 / tokens spent / 0 sessions"
// headline that contradicts the page. Still 1200×630, 200.
const emptyCard = (identity: PublicProfileIdentity) =>
  new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: 72,
        background: BG_PRIMARY,
        backgroundImage: `radial-gradient(circle at 82% -10%, rgba(124, 91, 245, 0.28), transparent 55%), radial-gradient(circle at 0% 110%, rgba(218, 112, 214, 0.12), transparent 45%)`,
      }}
    >
      {/* Top row: identity + wordmark — same header as the data card */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 72,
              borderRadius: 18,
              fontSize: 34,
              fontWeight: 700,
              color: ACCENT,
              background: 'rgba(124, 91, 245, 0.15)',
              border: `1px solid ${BORDER_SUBTLE}`,
            }}
          >
            {identity.avatarInitial}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: TEXT_PRIMARY }}>
              {identity.displayName}
            </div>
            <div style={{ display: 'flex', fontSize: 22, color: TEXT_TERTIARY }}>
              @{identity.handle}
            </div>
          </div>
        </div>
        <OrchidWordmark />
      </div>

      {/* Empty headline — mirrors EmptyProfile's title + sub copy */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            fontSize: 56,
            fontWeight: 750,
            letterSpacing: '-0.03em',
            color: TEXT_PRIMARY,
          }}
        >
          No shipping activity yet
        </div>
        <div style={{ display: 'flex', fontSize: 28, color: TEXT_SECONDARY }}>
          Run `orchid claude` to start the graph.
        </div>
      </div>

      <div style={{ display: 'flex', fontSize: 22, color: TEXT_TERTIARY }}>orchidkeep.com</div>
    </div>,
    { ...size },
  );

export default async function ProfileOgImage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const identity = await resolveProfileUser(handle);
  if (!identity) return fallbackCard();

  const profile = await getPublicEfficiencyProfile(identity);
  // Mirror the live page's empty-profile short-circuit: page.tsx renders
  // <EmptyProfile /> (no headline, no stats) when activeDays === 0, so the card
  // must too — otherwise a just-registered profile shows a misleading
  // "0 / tokens spent / 0 sessions" data card that contradicts the page.
  if (profile.activeDays === 0) return emptyCard(identity);

  const headline = headlineFor(profile);
  const weeks = contributionStrip(profile.days);

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: 64,
        background: BG_PRIMARY,
        backgroundImage: `radial-gradient(circle at 82% -10%, rgba(124, 91, 245, 0.28), transparent 55%), radial-gradient(circle at 0% 110%, rgba(218, 112, 214, 0.12), transparent 45%)`,
      }}
    >
      {/* Top row: identity + wordmark */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 72,
              borderRadius: 18,
              fontSize: 34,
              fontWeight: 700,
              color: ACCENT,
              background: 'rgba(124, 91, 245, 0.15)',
              border: `1px solid ${BORDER_SUBTLE}`,
            }}
          >
            {identity.avatarInitial}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: TEXT_PRIMARY }}>
              {identity.displayName}
            </div>
            <div style={{ display: 'flex', fontSize: 22, color: TEXT_TERTIARY }}>
              @{identity.handle}
            </div>
          </div>
        </div>
        <OrchidWordmark />
      </div>

      {/* Headline: tier badge + the big gradient number */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {headline.tierLabel ? (
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: ORCHID_PINK,
              background: 'rgba(218, 112, 214, 0.15)',
              border: '1px solid rgba(218, 112, 214, 0.3)',
              borderRadius: 100,
              padding: '8px 18px',
            }}
          >
            {headline.tierLabel}
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 132,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: '-0.04em',
              // Gradient-filled text: paint the gradient, clip it to the
              // glyphs, and make the fill transparent so the gradient shows.
              backgroundImage: `linear-gradient(135deg, ${ORCHID_PINK}, ${ACCENT})`,
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {headline.value}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 16 }}>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 600, color: TEXT_PRIMARY }}>
              {headline.unit}
            </div>
            <div style={{ display: 'flex', fontSize: 20, color: TEXT_SECONDARY }}>
              {headline.sub}
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: TEXT_TERTIARY,
          }}
        >
          Orchid Efficiency Score
        </div>
      </div>

      {/* Bottom row: contribution strip + secondary stats */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {week.map((cell) => (
                <div
                  key={cell.key}
                  style={{
                    display: 'flex',
                    width: 13,
                    height: 13,
                    borderRadius: 3,
                    background: cell.color,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 36 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: ACCENT }}>
              {numberFormat.format(profile.prsMerged)}
            </div>
            <div style={{ display: 'flex', fontSize: 16, color: TEXT_TERTIARY }}>PRs merged</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: TEXT_PRIMARY }}>
              {displayTokens(profile.tokensSpent)}
            </div>
            <div style={{ display: 'flex', fontSize: 16, color: TEXT_TERTIARY }}>
              {profile.tokensEstimated ? 'Tokens (est.)' : 'Tokens spent'}
            </div>
          </div>
        </div>
      </div>
    </div>,
    {
      ...size,
      headers: {
        // Cache the rendered card aggressively at the CDN; revalidate hourly.
        'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      },
    },
  );
}
