import type { StripePlan } from '@better-auth/stripe';

export interface BillingPlanDisplay {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly monthlyPriceIdConfigured: boolean;
  readonly annualPriceIdConfigured: boolean;
  readonly seatPriceIdConfigured: boolean;
  readonly features: readonly string[];
}

const configuredValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const teamMonthlyPriceId = configuredValue(process.env.STRIPE_TEAM_PRICE_ID);
const teamAnnualPriceId = configuredValue(process.env.STRIPE_TEAM_ANNUAL_PRICE_ID);
const teamMonthlyLookupKey = configuredValue(process.env.STRIPE_TEAM_LOOKUP_KEY);
const teamAnnualLookupKey = configuredValue(process.env.STRIPE_TEAM_ANNUAL_LOOKUP_KEY);
const teamSeatPriceId = configuredValue(process.env.STRIPE_TEAM_SEAT_PRICE_ID);

export const TEAM_BILLING_PLAN_NAME = 'team';

export const isStripeSecretConfigured = Boolean(configuredValue(process.env.STRIPE_SECRET_KEY));
export const isStripeWebhookConfigured = Boolean(
  configuredValue(process.env.STRIPE_WEBHOOK_SECRET),
);
export const isBillingEnforcementEnabled = process.env.STRIPE_BILLING_ENFORCEMENT === 'true';

export const billingPlanDisplays: readonly BillingPlanDisplay[] = [
  {
    name: TEAM_BILLING_PLAN_NAME,
    label: 'Team',
    description:
      'Capture, search, and reason over AI coding sessions across a shared team workspace.',
    monthlyPriceIdConfigured: Boolean(teamMonthlyPriceId || teamMonthlyLookupKey),
    annualPriceIdConfigured: Boolean(teamAnnualPriceId || teamAnnualLookupKey),
    seatPriceIdConfigured: Boolean(teamSeatPriceId),
    features: [
      'Team-scoped conversation capture',
      'Session search, summaries, and Q&A',
      'Decision log extraction',
      'GitHub PR context workflows',
    ],
  },
];

export const getConfiguredStripePlans = (): StripePlan[] => [
  ...(teamMonthlyPriceId || teamMonthlyLookupKey || teamSeatPriceId
    ? [
        {
          name: TEAM_BILLING_PLAN_NAME,
          priceId: teamMonthlyPriceId,
          lookupKey: teamMonthlyLookupKey,
          annualDiscountPriceId: teamAnnualPriceId,
          annualDiscountLookupKey: teamAnnualLookupKey,
          seatPriceId: teamSeatPriceId,
        },
      ]
    : []),
];

export const isStripeBillingConfigured = (): boolean =>
  isStripeSecretConfigured && isStripeWebhookConfigured && getConfiguredStripePlans().length > 0;
