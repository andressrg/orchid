import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import { getFirstTeamSlug } from '@/app/lib/queries';

export default async function DashboardRedirect() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect('/login');
  }

  const slug = await getFirstTeamSlug(session.user.id);
  if (slug) {
    redirect(`/t/${slug}/dashboard`);
  }

  redirect('/login');
}
