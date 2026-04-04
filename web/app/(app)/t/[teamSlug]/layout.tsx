import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import pool from '@/app/lib/db';
import { Sidebar } from '@/app/components/sidebar';
import { KeyboardNav } from '@/app/components/keyboard-nav';
import { CommandPalette } from '@/app/components/command-palette';
import { TitleUpdater } from '@/app/components/title-updater';

export default async function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ teamSlug: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect('/login');
  }

  const { teamSlug } = await params;

  // Resolve team by slug and verify membership
  const teamResult = await pool.query(
    `SELECT o.id, o.name, o.slug FROM organization o
     INNER JOIN member m ON m.organization_id = o.id
     WHERE o.slug = $1 AND m.user_id = $2`,
    [teamSlug, session.user.id],
  );

  if (teamResult.rows.length === 0) {
    // User is not a member of this team — redirect to their first team
    const firstTeam = await pool.query(
      `SELECT o.slug FROM organization o
       INNER JOIN member m ON m.organization_id = o.id
       WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 1`,
      [session.user.id],
    );
    if (firstTeam.rows.length > 0) {
      redirect(`/t/${firstTeam.rows[0].slug}/dashboard`);
    }
    redirect('/login');
  }

  const team = teamResult.rows[0];

  // Get all teams for the team switcher
  const allTeams = await pool.query(
    `SELECT o.id, o.name, o.slug FROM organization o
     INNER JOIN member m ON m.organization_id = o.id
     WHERE m.user_id = $1 ORDER BY o.name`,
    [session.user.id],
  );

  return (
    <div className="flex h-full">
      <div className="hidden md:block">
        <Sidebar
          user={session.user}
          team={team}
          teams={allTeams.rows}
          teamSlug={teamSlug}
        />
      </div>
      <main className="flex-1 overflow-auto">
        <KeyboardNav />
        <CommandPalette teamSlug={teamSlug} />
        <TitleUpdater />
        {children}
      </main>
    </div>
  );
}
