'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function TitleUpdater() {
  const pathname = usePathname();

  useEffect(() => {
    const titles: Record<string, string> = {
      '/': 'Sessions — Orchid',
      '/search': 'Search — Orchid',
      '/activity': 'Activity — Orchid',
    };

    if (pathname.startsWith('/sessions/')) {
      const id = pathname.split('/sessions/')[1];
      document.title = `${decodeURIComponent(id)} — Orchid`;
    } else {
      document.title = titles[pathname] || 'Orchid';
    }
  }, [pathname]);

  return null;
}
