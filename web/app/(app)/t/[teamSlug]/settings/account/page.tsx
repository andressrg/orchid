import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/app/lib/auth';
import { getGithubLinkState } from '@/app/lib/queries';
import { ConnectedAccounts } from './connected-accounts';

// Server-rendered: read the GitHub link state for the logged-in user and hand
// it to the client button. See `getGithubLinkState` for why `linked` is read
// from the `account` table rather than the user's `githubLogin` handle.
export default async function AccountSettingsPage({
  params,
}: {
  params: Promise<{ teamSlug: string }>;
}) {
  const { teamSlug } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect('/login');
  }

  const github = await getGithubLinkState(session.user.id);

  return <ConnectedAccounts github={github} callbackPath={`/t/${teamSlug}/settings/account`} />;
}
