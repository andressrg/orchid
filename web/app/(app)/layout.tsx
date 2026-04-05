import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect('/login');
  }

  // This layout only renders for non-team routes (e.g. /dashboard).
  // Team routes are handled by /t/[teamSlug]/layout.tsx.
  // Just render children — the individual pages handle their own redirects.
  return <>{children}</>;
}
