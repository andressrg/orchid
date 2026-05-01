import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center animate-fade-in">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: 'var(--orchid-pink-muted)' }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="var(--orchid-pink)"
              strokeWidth="1.5"
              fill="none"
            />
            <path
              d="M12 6C12 6 8 9 8 13C8 15.2 9.8 17 12 17C14.2 17 16 15.2 16 13C16 9 12 6 12 6Z"
              fill="var(--orchid-pink)"
              opacity="0.5"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
          Page not found
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
          The page you are looking for does not exist.
        </p>
        <Link
          href="/dashboard"
          className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          style={{
            background: 'var(--accent)',
            color: 'white',
          }}
        >
          Back to Sessions
        </Link>
      </div>
    </div>
  );
}
