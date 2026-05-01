import { redirect } from 'next/navigation';
import { getTeamBillingState, getTeamMemberCount } from '@/app/lib/billing';
import { billingPlanDisplays } from '@/app/lib/billing-config';
import { getServerAuth } from '@/app/lib/server-auth';
import { BillingActions } from './billing-actions';

export const dynamic = 'force-dynamic';

const displayBillingStatus = (status: string | null): string =>
  status
    ? status
        .split('_')
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ')
    : 'No subscription';

const displayDate = (value: string | null): string =>
  value ? new Date(value).toLocaleDateString() : 'Not set';

export default async function BillingPage({
  params,
}: {
  readonly params: Promise<{ teamSlug: string }>;
}) {
  const { teamSlug } = await params;
  const serverAuth = await getServerAuth(teamSlug);
  if (!serverAuth) redirect('/login');

  const [billingState, memberCount] = await Promise.all([
    getTeamBillingState(serverAuth.teamId),
    getTeamMemberCount(serverAuth.teamId),
  ]);
  const [teamPlan] = billingPlanDisplays;
  const currentSubscription = billingState.subscription;
  const hasSubscription = Boolean(currentSubscription);

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-1">Billing</h1>
      <p className="text-sm text-neutral-400 mb-6">
        Manage the subscription for this team workspace.
      </p>

      {!billingState.configured ? (
        <div className="mb-6 rounded-md border border-yellow-900 bg-yellow-950/40 p-4">
          <div className="text-sm font-medium text-yellow-200">Stripe is not configured</div>
          <p className="mt-1 text-sm text-yellow-100/80">
            Add Stripe keys and a team price in the deployment environment to enable checkout.
          </p>
        </div>
      ) : null}

      {!billingState.enforced ? (
        <div className="mb-6 rounded-md border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-sm font-medium text-white">Billing enforcement is off</div>
          <p className="mt-1 text-sm text-neutral-400">
            Set <code className="text-violet-300">STRIPE_BILLING_ENFORCEMENT=true</code> when paid access should gate capture and AI features.
          </p>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Status', value: displayBillingStatus(currentSubscription?.status || null) },
          { label: 'Seats', value: String(currentSubscription?.seats || memberCount) },
          { label: 'Renews', value: displayDate(currentSubscription?.periodEnd || null) },
        ].map((item) => (
          <div key={item.label} className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-3">
            <div className="text-xs text-neutral-500">{item.label}</div>
            <div className="mt-1 text-sm font-medium text-white">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-white">{teamPlan.label}</div>
            <p className="mt-1 max-w-xl text-sm text-neutral-400">{teamPlan.description}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {teamPlan.features.map((feature) => (
                <div key={feature} className="text-sm text-neutral-300">
                  {feature}
                </div>
              ))}
            </div>
          </div>
          <div
            className="rounded-md px-3 py-1 text-xs font-medium"
            style={{
              background: billingState.allowed ? 'var(--green-muted)' : 'var(--yellow-muted)',
              color: billingState.allowed ? 'var(--green)' : 'var(--yellow)',
            }}
          >
            {billingState.allowed ? 'Access enabled' : 'Subscription required'}
          </div>
        </div>

        <div className="mt-5 border-t border-neutral-800 pt-5">
          <BillingActions
            configured={billingState.configured}
            teamId={serverAuth.teamId}
            teamSlug={teamSlug}
            memberCount={memberCount}
            hasAnnualPrice={teamPlan.annualPriceIdConfigured}
            hasSubscription={hasSubscription}
          />
        </div>
      </div>
    </div>
  );
}
