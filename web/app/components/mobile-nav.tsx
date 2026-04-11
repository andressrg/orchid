'use client';

import { useState } from 'react';

export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile header */}
      <div className="md:hidden flex items-center h-12 px-3 border-b border-night-750 bg-night-900">
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 rounded-md text-night-300"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <span className="ml-2 text-sm font-semibold text-night-100">
          Orchid
        </span>
      </div>

      {/* Backdrop */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-[260px] transform transition-transform duration-200 bg-night-900 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-full" onClick={() => setOpen(false)}>
          {children}
        </div>
      </div>
    </>
  );
}
