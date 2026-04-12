import { headers } from 'next/headers';
import { auth } from './auth';
import { resolveTeamId } from './queries';

interface ServerAuth {
  readonly userId: string;
  readonly teamId: string;
}

export async function getServerAuth(teamSlug: string): Promise<ServerAuth | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const teamId = await resolveTeamId(teamSlug, session.user.id);
  if (!teamId) return null;

  return { userId: session.user.id, teamId };
}
