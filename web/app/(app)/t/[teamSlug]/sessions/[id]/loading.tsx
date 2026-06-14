// Instant loading state for the session detail route. The page is
// `force-dynamic` and reads a (potentially large) transcript, so without this a
// click would block on the full server render with zero feedback. This skeleton
// mirrors the detail layout (header + metadata grid + conversation) so the route
// paints immediately on navigation.
export default function SessionDetailLoading() {
  return (
    <div className="animate-fade-in">
      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center gap-3 px-6 h-[52px] border-b"
        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="h-3.5 w-20 rounded" style={{ background: 'var(--bg-tertiary)' }} />
        <span style={{ color: 'var(--border)' }}>/</span>
        <div className="h-3.5 w-48 rounded" style={{ background: 'var(--bg-tertiary)' }} />
        <div className="ml-auto h-3 w-16 rounded" style={{ background: 'var(--bg-tertiary)' }} />
      </header>

      {/* Metadata grid */}
      <div
        className="px-6 py-4 border-b grid grid-cols-2 md:grid-cols-4 gap-4"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-2 w-16 rounded" style={{ background: 'var(--bg-tertiary)' }} />
            <div className="h-3 w-28 rounded" style={{ background: 'var(--bg-tertiary)' }} />
          </div>
        ))}
      </div>

      {/* Conversation */}
      <div className="px-6 py-6 max-w-3xl mx-auto space-y-6" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="space-y-2 animate-fade-in"
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <div className="h-3 w-24 rounded" style={{ background: 'var(--bg-tertiary)' }} />
            <div
              className="h-20 rounded-lg border-l-2"
              style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
