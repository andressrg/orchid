import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import { Sidebar } from '../components/sidebar';
import { KeyboardNav } from '../components/keyboard-nav';
import { CommandPalette } from '../components/command-palette';
import { TitleUpdater } from '../components/title-updater';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="flex h-full">
      <div className="hidden md:block">
        <Sidebar user={session.user} />
      </div>
      <main className="flex-1 overflow-auto">
        <KeyboardNav />
        <CommandPalette />
        <TitleUpdater />
        {children}
      </main>
    </div>
  );
}
