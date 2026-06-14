'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { label: 'Team', segment: 'team' },
  { label: 'Tokens', segment: 'tokens' },
  { label: 'Account', segment: 'account' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Extract /t/<slug>/settings base from pathname
  const base = pathname.replace(/\/settings\/.*$/, '/settings');

  return (
    <div className="max-w-2xl mx-auto p-8">
      <nav className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {tabs.map((tab) => {
          const href = `${base}/${tab.segment}`;
          const active = pathname.includes(`/settings/${tab.segment}`);
          return (
            <Link
              key={tab.segment}
              href={href}
              className="px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors"
              style={{
                borderColor: active ? 'var(--orchid-pink)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
