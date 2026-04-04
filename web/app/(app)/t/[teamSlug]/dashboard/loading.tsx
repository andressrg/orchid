export default function SessionsLoading() {
  return (
    <div className="animate-fade-in">
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-6 h-[52px] border-b"
        style={{ background: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-3">
          <div className="h-3.5 w-16 rounded" style={{ background: "var(--bg-tertiary)" }} />
          <div className="h-4 w-6 rounded" style={{ background: "var(--bg-tertiary)" }} />
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3 px-6 py-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg p-3 border"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border-subtle)" }}
          >
            <div className="h-2 w-20 rounded mb-2" style={{ background: "var(--bg-tertiary)" }} />
            <div className="h-6 w-8 rounded" style={{ background: "var(--bg-tertiary)" }} />
          </div>
        ))}
      </div>

      <div className="px-6 space-y-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-3 py-3 rounded-lg"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <div className="w-7 h-7 rounded-full" style={{ background: "var(--bg-tertiary)" }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-40 rounded" style={{ background: "var(--bg-tertiary)" }} />
              <div className="h-2 w-56 rounded" style={{ background: "var(--bg-tertiary)", opacity: 0.5 }} />
            </div>
            <div className="h-2.5 w-12 rounded" style={{ background: "var(--bg-tertiary)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
