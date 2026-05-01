import { describe, expect, it } from 'vitest';
import { buildStripeCheckoutRequestBody } from '@/app/(app)/t/[teamSlug]/settings/billing/billing-actions';

describe('buildStripeCheckoutRequestBody', () => {
  it('omits seat quantity for flat team prices', () => {
    const body = buildStripeCheckoutRequestBody({
      action: 'monthly',
      teamId: 'team_123',
      teamSlug: 'engineering',
      memberCount: 5,
      hasSeatPrice: false,
    });

    expect(body).toMatchObject({
      plan: 'team',
      annual: false,
      referenceId: 'team_123',
      customerType: 'organization',
      successUrl: '/t/engineering/settings/billing?checkout=success',
      cancelUrl: '/t/engineering/settings/billing',
      disableRedirect: true,
    });
    expect(body).not.toHaveProperty('seats');
  });

  it('includes seat quantity when a per-seat Stripe price is configured', () => {
    const body = buildStripeCheckoutRequestBody({
      action: 'annual',
      teamId: 'team_123',
      teamSlug: 'engineering',
      memberCount: 5,
      hasSeatPrice: true,
    });

    expect(body).toMatchObject({
      annual: true,
      seats: 5,
    });
  });
});
