'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '../lib/auth-client';

function OrchidLogo() {
  return (
    <svg
      width="20"
      height="20"
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

const navItems = [
  {
    label: 'Sessions',
    path: '/dashboard',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="2" width="12" height="12" rx="2" />
        <path d="M5 6h6M5 8.5h4" />
      </svg>
    ),
  },
  {
    label: 'Search',
    path: '/search',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="7" cy="7" r="4" />
        <path d="M10 10l3 3" />
      </svg>
    ),
  },
  {
    label: 'Activity',
    path: '/activity',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="8" cy="5" r="2.5" />
        <circle cx="4" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <path d="M6 7.5C4.5 8.5 4 10 4 10.5M10 7.5C11.5 8.5 12 10 12 10.5" />
      </svg>
    ),
  },
];

interface SidebarProps {
  user?: { name: string; email: string; image?: string | null };
  team?: { id: string; name: string; slug: string };
  teams?: Array<{ id: string; name: string; slug: string }>;
  teamSlug?: string;
}

export function Sidebar({ user, teams = [], teamSlug = '' }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/t/${teamSlug}`;

  return (
    <aside
      className="flex flex-col w-[220px] shrink-0 border-r h-full"
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 px-4 h-[52px] border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <OrchidLogo />
        <span
          className="text-sm font-semibold tracking-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          Orchid
        </span>
      </div>

      {/* Team switcher */}
      {teams.length > 0 && (
        <div className="px-2 pt-2 pb-1">
          <select
            value={teamSlug}
            onChange={(e) => router.push(`/t/${e.target.value}/dashboard`)}
            className="w-full rounded-md border px-2 py-1.5 text-[12px] font-medium"
            style={{
              background: 'var(--bg-tertiary)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          >
            {teams.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 p-2">
        {navItems.map((item) => {
          const href = `${base}${item.path}`;
          const active =
            item.path === '/dashboard'
              ? pathname === href
              : pathname.startsWith(href);
          return (
            <Link
              key={item.path}
              href={href}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors"
              style={{
                background: active ? 'var(--bg-active)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Command palette hint */}
      <div className="px-2 mb-1">
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] cursor-pointer transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
            );
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3 3" />
          </svg>
          <span>Quick Find</span>
          <kbd
            className="ml-auto text-[9px] px-1 py-0.5 rounded"
            style={{ background: 'var(--bg-tertiary)' }}
          >
            {'\u2318'}K
          </kbd>
        </div>
      </div>

      {/* How it works */}
      <div className="px-4 pt-2 pb-3 flex-1">
        <div
          className="text-[10px] uppercase font-medium tracking-wider mb-2"
          style={{ color: 'var(--text-tertiary)' }}
        >
          How it works
        </div>
        <div className="space-y-2">
          {[
            { step: '1', text: 'Capture', desc: 'orchid claude' },
            { step: '2', text: 'Store', desc: 'Auto-synced' },
            { step: '3', text: 'Review', desc: 'See the why' },
          ].map(({ step, text, desc }) => (
            <div key={step} className="flex items-center gap-2">
              <span
                className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0"
                style={{ background: 'var(--orchid-pink-muted)', color: 'var(--orchid-pink)' }}
              >
                {step}
              </span>
              <div>
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {text}
                </span>
                <span className="text-[10px] ml-1" style={{ color: 'var(--text-tertiary)' }}>
                  {desc}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CLI hint */}
      <div
        className="mx-3 mb-3 p-2.5 rounded-md border"
        style={{
          background: 'var(--bg-primary)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>
          Quick start
        </div>
        <code className="text-[11px] font-mono" style={{ color: 'var(--orchid-pink)' }}>
          $ orchid claude
        </code>
      </div>

      {/* Settings */}
      <Link
        href={`${base}/settings/team`}
        className="flex items-center gap-2.5 mx-2 mb-1 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors"
        style={{
          background: pathname.includes('/settings') ? 'var(--bg-active)' : 'transparent',
          color: pathname.includes('/settings') ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="2" />
          <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" />
        </svg>
        Settings
      </Link>

      {/* User */}
      {user && (
        <div
          className="flex items-center gap-2.5 px-4 py-3 border-t"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
            style={{ background: 'var(--orchid-pink-muted)', color: 'var(--orchid-pink)' }}
          >
            {user.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="text-[12px] font-medium truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {user.name}
            </div>
            <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
              {user.email}
            </div>
          </div>
          <button
            onClick={() => authClient.signOut().then(() => router.push('/login'))}
            title="Sign out"
            className="sign-out-btn p-1 rounded-md transition-colors shrink-0"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
              <path d="M10 12l4-4-4-4" />
              <path d="M14 8H6" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
}
