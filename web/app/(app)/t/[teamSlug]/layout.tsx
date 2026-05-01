import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import { resolveTeamId, getFirstTeamSlug, getUserTeams } from '@/app/lib/queries';
import { db } from '@/app/lib/db';
import { organization } from '@/app/lib/schema';
import { eq } from 'drizzle-orm';
import { Sidebar } from '@/app/components/sidebar';
import { MobileNav } from '@/app/components/mobile-nav';
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

  const teamId = await resolveTeamId(teamSlug, session.user.id);

  if (!teamId) {
    const firstSlug = await getFirstTeamSlug(session.user.id);
    if (firstSlug) {
      redirect(`/t/${firstSlug}/dashboard`);
    }
    redirect('/login');
  }

  const [team] = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, teamId));
  const allTeams = await getUserTeams(session.user.id);

  // Set active organization so client components (settings page) can read it
  await auth.api.setActiveOrganization({
    headers: await headers(),
    body: { organizationId: teamId },
  });

  const sidebarContent = (
    <Sidebar user={session.user} team={team} teams={allTeams} teamSlug={teamSlug} />
  );

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Desktop sidebar */}
      <div className="hidden md:block">{sidebarContent}</div>

      {/* Mobile nav + drawer */}
      <MobileNav>{sidebarContent}</MobileNav>

      <main className="flex-1 overflow-auto">
        <KeyboardNav />
        <CommandPalette teamSlug={teamSlug} />
        <TitleUpdater />
        {children}
      </main>
    </div>
  );
}
