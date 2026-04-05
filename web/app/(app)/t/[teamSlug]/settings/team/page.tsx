'use client';

import { useState } from 'react';
import { authClient } from '@/app/lib/auth-client';

export default function TeamPage() {
  const org = authClient.useActiveOrganization();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  async function inviteMember(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !org.data?.id) return;
    setLoading(true);
    setMessage('');

    const result = await authClient.organization.inviteMember({
      organizationId: org.data.id,
      email: inviteEmail,
      role: inviteRole as 'member' | 'admin',
    });

    if (result.error) {
      setMessage(result.error.message || 'Failed to send invitation');
      setInviteLink('');
    } else {
      const invitation = result.data;
      const link = `${window.location.origin}/invite/${invitation?.id || ''}`;
      setMessage(`Invitation sent to ${inviteEmail}`);
      setInviteLink(link);
      setInviteEmail('');
    }
    setLoading(false);
  }

  const memberList = org.data?.members || [];

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1">Team</h1>
      <p className="text-sm text-neutral-400 mb-6">{org.data?.name || 'Loading...'}</p>

      <h2 className="text-sm font-medium text-neutral-300 mb-3">Members</h2>
      {memberList.length === 0 ? (
        <p className="text-sm text-neutral-500 mb-6">Loading members...</p>
      ) : (
        <div className="space-y-2 mb-8">
          {memberList.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium text-white">{m.user.name}</div>
                <div className="text-xs text-neutral-500">{m.user.email}</div>
              </div>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background:
                    m.role === 'owner' ? 'var(--orchid-pink-muted)' : 'var(--bg-tertiary)',
                  color: m.role === 'owner' ? 'var(--orchid-pink)' : 'var(--text-secondary)',
                }}
              >
                {m.role}
              </span>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-medium text-neutral-300 mb-3">Invite member</h2>
      <form onSubmit={inviteMember} className="flex gap-2">
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="colleague@example.com"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-violet-500 focus:outline-none"
          required
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Invite
        </button>
      </form>
      {message && <p className="mt-2 text-sm text-neutral-400">{message}</p>}
      {inviteLink && (
        <div className="mt-3 rounded-md border border-neutral-700 bg-neutral-900 p-3">
          <p className="text-xs text-neutral-400 mb-1">Share this invite link:</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 text-xs text-violet-400 break-all">{inviteLink}</code>
            <button
              onClick={() => navigator.clipboard.writeText(inviteLink)}
              className="text-xs text-neutral-400 hover:text-white shrink-0"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
