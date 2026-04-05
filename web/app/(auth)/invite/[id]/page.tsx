'use client';

import { useState, use } from 'react';
import { authClient } from '@/app/lib/auth-client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AcceptInvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const router = useRouter();
  const session = authClient.useSession();

  async function acceptInvitation() {
    setStatus('loading');
    setError('');

    const result = await authClient.organization.acceptInvitation({
      invitationId: id,
    });

    if (result.error) {
      setError(result.error.message || 'Failed to accept invitation');
      setStatus('error');
    } else {
      setStatus('success');
      router.push('/dashboard');
    }
  }

  if (!session.data) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-semibold text-white">Team Invitation</h1>
        <p className="mb-6 text-sm text-neutral-400">
          You need to sign in or create an account to accept this invitation.
        </p>
        <div className="space-y-3">
          <Link
            href={`/login?redirect=/invite/${id}`}
            className="block w-full rounded-md bg-violet-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-violet-500"
          >
            Sign in
          </Link>
          <Link
            href={`/signup?redirect=/invite/${id}`}
            className="block w-full rounded-md border border-neutral-700 px-4 py-2 text-center text-sm font-medium text-white hover:bg-neutral-800"
          >
            Create account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-white">Team Invitation</h1>

      {status === 'idle' && (
        <>
          <p className="mb-6 text-sm text-neutral-400">
            You&apos;ve been invited to join a team on Orchid.
          </p>
          <button
            onClick={acceptInvitation}
            className="w-full rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          >
            Accept Invitation
          </button>
        </>
      )}

      {status === 'loading' && (
        <p className="text-sm text-neutral-400">Joining team...</p>
      )}

      {status === 'success' && (
        <p className="text-sm text-green-400">Joined! Redirecting to dashboard...</p>
      )}

      {status === 'error' && (
        <>
          <p className="mb-4 text-sm text-red-400">{error}</p>
          <button
            onClick={acceptInvitation}
            className="w-full rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          >
            Try Again
          </button>
        </>
      )}
    </div>
  );
}
