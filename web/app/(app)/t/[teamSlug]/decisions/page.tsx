import Link from 'next/link';
import { getDecisions, Decision } from '@/app/lib/api';

export const dynamic = "force-dynamic";

function DecisionCard({ decision, index, teamSlug }: { decision: Decision; index: number; teamSlug: string }) {
  const sessionShort = decision.session_id.slice(0, 8);
  const deepLink = `/t/${teamSlug}/sessions/${encodeURIComponent(decision.session_id)}?turn=${decision.turn_index + 1}`;

  return (
    <div
      className="rounded-lg p-5 border animate-fade-in"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
        animationDelay: `${index * 0.06}s`,
      }}
    >
      {/* Title row */}
      <div className="flex items-start gap-3 mb-3">
        <span
          className="text-[15px] shrink-0 mt-0.5"
          style={{ color: "var(--green)" }}
        >
          ✅
        </span>
        <h3
          className="text-[14px] font-semibold leading-snug"
          style={{ color: "var(--text-primary)" }}
        >
          {decision.title}
        </h3>
      </div>

      {/* Decision */}
      <p
        className="text-[13px] leading-relaxed mb-3 pl-7"
        style={{ color: "var(--text-secondary)" }}
      >
        {decision.decision}
      </p>

      {/* Alternatives */}
      {decision.alternatives && decision.alternatives.length > 0 && (
        <div className="pl-7 mb-3">
          <span
            className="text-[10px] uppercase tracking-wider font-medium mr-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            Alternatives considered
          </span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {decision.alternatives.map((alt, i) => (
              <span
                key={i}
                className="text-[11px] font-mono px-2 py-0.5 rounded"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-tertiary)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {alt}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reason */}
      <div className="pl-7 mb-4">
        <span
          className="text-[10px] uppercase tracking-wider font-medium"
          style={{ color: "var(--text-tertiary)" }}
        >
          Why
        </span>
        <p className="text-[12px] leading-relaxed mt-1" style={{ color: "var(--text-secondary)" }}>
          {decision.reason}
        </p>
      </div>

      {/* Footer: deep link */}
      <div
        className="pl-7 pt-3 flex items-center justify-between border-t"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>
          session {sessionShort}… · turn {decision.turn_index + 1}
        </span>
        <Link
          href={deepLink}
          className="flex items-center gap-1 text-[12px] font-medium transition-opacity hover:opacity-70"
          style={{ color: "var(--accent)" }}
        >
          See the moment
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

export default async function DecisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamSlug: string }>;
  searchParams: Promise<{ repo?: string }>;
}) {
  const { teamSlug } = await params;
  const { repo } = await searchParams;

  if (!repo) {
    return (
      <div className="animate-fade-in">
        <header
          className="sticky top-0 z-10 flex items-center gap-3 px-6 h-[52px] border-b backdrop-blur-sm"
          style={{ background: "rgba(10, 10, 15, 0.85)", borderColor: "var(--border-subtle)" }}
        >
          <Link
            href={`/t/${teamSlug}/dashboard`}
            className="flex items-center gap-1 text-[12px] font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--text-tertiary)" }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 4l-4 4 4 4" />
            </svg>
            Sessions
          </Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <span className="text-[13px] font-medium">Decision Log</span>
        </header>

        <div className="px-6 py-16 max-w-2xl mx-auto text-center">
          <div
            className="text-3xl mb-4"
            style={{ color: "var(--text-tertiary)" }}
          >
            🧠
          </div>
          <h1 className="text-[18px] font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            Decision Log
          </h1>
          <p className="text-[13px] mb-8 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            AI-extracted architectural decisions from your team&apos;s coding conversations.
            Each decision links back to the exact moment it was made.
          </p>
          <form method="GET" action={`/t/${teamSlug}/decisions`} className="flex gap-2 justify-center">
            <input
              name="repo"
              type="text"
              placeholder="e.g. orchid, my-project, auth-service"
              className="text-[13px] px-4 py-2 rounded-lg font-mono w-72 outline-none focus:ring-1"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-80"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Analyze
            </button>
          </form>
          <p className="text-[11px] mt-3" style={{ color: "var(--text-tertiary)" }}>
            Leave blank to analyze all sessions
          </p>
        </div>
      </div>
    );
  }

  let result;
  let error = "";
  try {
    result = await getDecisions(teamSlug, repo);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load decisions";
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center gap-3 px-6 h-[52px] border-b backdrop-blur-sm"
        style={{ background: "rgba(10, 10, 15, 0.85)", borderColor: "var(--border-subtle)" }}
      >
        <Link
          href={`/t/${teamSlug}/dashboard`}
          className="flex items-center gap-1 text-[12px] font-medium transition-colors hover:opacity-80"
          style={{ color: "var(--text-tertiary)" }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 4l-4 4 4 4" />
          </svg>
          Sessions
        </Link>
        <span style={{ color: "var(--border)" }}>/</span>
        <span className="text-[13px] font-medium">Decision Log</span>
        <span
          className="text-[11px] font-mono px-2 py-0.5 rounded"
          style={{ background: "var(--bg-tertiary)", color: "var(--accent)" }}
        >
          {repo}
        </span>
        {result && (
          <span className="text-[11px] ml-auto" style={{ color: "var(--text-tertiary)" }}>
            {result.decisions.length} decisions · {result.sessions_analyzed} sessions analyzed
          </span>
        )}
      </header>

      {/* Summary bar */}
      {result && (
        <div
          className="px-6 py-3 border-b flex items-center gap-4"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[22px] font-bold" style={{ color: "var(--text-primary)" }}>
              {result.decisions.length}
            </span>
            <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
              architectural decisions found
            </span>
          </div>
          <span style={{ color: "var(--border)" }}>·</span>
          <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            across {result.sessions_analyzed} conversation{result.sessions_analyzed !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="px-6 py-6 max-w-2xl mx-auto">
        {error && (
          <div
            className="text-[13px] px-4 py-3 rounded-lg"
            style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            {error}
          </div>
        )}

        {result && result.decisions.length === 0 && (
          <div className="text-center py-16" style={{ color: "var(--text-secondary)" }}>
            <p className="text-sm mb-2">No architectural decisions found for &quot;{repo}&quot;</p>
            <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              Try a broader repo name, or{" "}
              <Link href={`/t/${teamSlug}/decisions`} className="underline" style={{ color: "var(--accent)" }}>
                analyze all sessions
              </Link>
            </p>
          </div>
        )}

        {result && result.decisions.length > 0 && (
          <div className="space-y-4">
            {result.decisions.map((d, i) => (
              <DecisionCard key={i} decision={d} index={i} teamSlug={teamSlug} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
