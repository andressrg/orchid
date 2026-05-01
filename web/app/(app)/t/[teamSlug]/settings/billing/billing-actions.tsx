'use client';

import { useState } from 'react';
import { TEAM_BILLING_PLAN_NAME } from '@/app/lib/billing-config';

type BillingAction = 'monthly' | 'annual' | 'portal';

interface BillingActionsProps {
  readonly configured: boolean;
  readonly teamId: string;
  readonly teamSlug: string;
  readonly memberCount: number;
  readonly hasAnnualPrice: boolean;
  readonly hasSeatPrice: boolean;
  readonly hasSubscription: boolean;
}

interface StripeRedirectResponse {
  readonly url?: string | null;
  readonly error?: string;
  readonly message?: string;
}

interface StripeCheckoutRequestBodyParams {
  readonly action: Exclude<BillingAction, 'portal'>;
  readonly teamId: string;
  readonly teamSlug: string;
  readonly memberCount: number;
  readonly hasSeatPrice: boolean;
}

interface StripeCheckoutRequestBody {
  readonly plan: typeof TEAM_BILLING_PLAN_NAME;
  readonly annual: boolean;
  readonly referenceId: string;
  readonly customerType: 'organization';
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly disableRedirect: true;
  readonly seats?: number;
}

const parseStripeRedirectResponse = async (response: Response): Promise<StripeRedirectResponse> =>
  response.json() as Promise<StripeRedirectResponse>;

export const buildStripeCheckoutRequestBody = ({
  action,
  teamId,
  teamSlug,
  memberCount,
  hasSeatPrice,
}: StripeCheckoutRequestBodyParams): StripeCheckoutRequestBody => ({
  plan: TEAM_BILLING_PLAN_NAME,
  annual: action === 'annual',
  referenceId: teamId,
  customerType: 'organization',
  successUrl: `/t/${teamSlug}/settings/billing?checkout=success`,
  cancelUrl: `/t/${teamSlug}/settings/billing`,
  disableRedirect: true,
  ...(hasSeatPrice ? { seats: memberCount } : {}),
});

export function BillingActions({
  configured,
  teamId,
  teamSlug,
  memberCount,
  hasAnnualPrice,
  hasSeatPrice,
  hasSubscription,
}: BillingActionsProps) {
  const [pendingAction, setPendingAction] = useState<BillingAction | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const redirectToStripe = async ({
    action,
    path,
    body,
  }: {
    readonly action: BillingAction;
    readonly path: string;
    readonly body: object;
  }) => {
    setPendingAction(action);
    setErrorMessage('');

    try {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await parseStripeRedirectResponse(response);

      if (!response.ok || !payload.url) {
        setErrorMessage(payload.error || payload.message || 'Unable to start billing flow.');
        return;
      }

      window.location.assign(payload.url);
    } catch {
      setErrorMessage('Unable to reach billing service.');
    } finally {
      setPendingAction(null);
    }
  };

  const startCheckout = (action: Exclude<BillingAction, 'portal'>) =>
    redirectToStripe({
      action,
      path: '/api/auth/subscription/upgrade',
      body: buildStripeCheckoutRequestBody({ action, teamId, teamSlug, memberCount, hasSeatPrice }),
    });

  const openBillingPortal = () =>
    redirectToStripe({
      action: 'portal',
      path: '/api/auth/subscription/billing-portal',
      body: {
        referenceId: teamId,
        customerType: 'organization',
        returnUrl: `/t/${teamSlug}/settings/billing`,
        disableRedirect: true,
      },
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!configured || pendingAction !== null}
          onClick={() => startCheckout('monthly')}
          className="min-w-32 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingAction === 'monthly'
            ? 'Opening...'
            : hasSubscription
              ? 'Change plan'
              : 'Start monthly'}
        </button>
        <button
          type="button"
          disabled={!configured || !hasAnnualPrice || pendingAction !== null}
          onClick={() => startCheckout('annual')}
          className="min-w-32 rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingAction === 'annual' ? 'Opening...' : 'Start annual'}
        </button>
        <button
          type="button"
          disabled={!configured || !hasSubscription || pendingAction !== null}
          onClick={openBillingPortal}
          className="min-w-32 rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingAction === 'portal' ? 'Opening...' : 'Manage billing'}
        </button>
      </div>
      {errorMessage ? <p className="text-sm text-red-400">{errorMessage}</p> : null}
    </div>
  );
}
