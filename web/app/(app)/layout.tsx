import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import pool from '@/app/lib/db';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect('/login');
  }

  // If we're at a non-team route, redirect to first team
  const firstTeam = await pool.query(
    `SELECT o.slug FROM organization o
     INNER JOIN member m ON m.organization_id = o.id
     WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 1`,
    [session.user.id],
  );

  if (firstTeam.rows.length > 0) {
    redirect(`/t/${firstTeam.rows[0].slug}/dashboard`);
  }

  return <>{children}</>;
}
