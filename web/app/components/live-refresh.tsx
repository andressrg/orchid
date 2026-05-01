'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function LiveRefresh({ interval = 10_000 }: { interval?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, interval);

    return () => clearInterval(id);
  }, [router, interval]);

  return null;
}
