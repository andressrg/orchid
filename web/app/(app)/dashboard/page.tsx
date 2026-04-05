import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import pool from '@/app/lib/db';

export default async function DashboardRedirect() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect('/login');
  }

  const firstTeam = await pool.query(
    `SELECT o.slug FROM organization o
     INNER JOIN member m ON m."organizationId" = o.id
     WHERE m."userId" = $1 ORDER BY m."createdAt" LIMIT 1`,
    [session.user.id],
  );

  if (firstTeam.rows.length > 0) {
    redirect(`/t/${firstTeam.rows[0].slug}/dashboard`);
  }

  redirect('/login');
}
