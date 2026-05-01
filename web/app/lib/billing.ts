import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { member, organization, subscription } from './schema';
import { isBillingEnforcementEnabled, isStripeBillingConfigured } from './billing-config';

const paidSubscriptionStatuses = ['active', 'trialing'] as const;

export type PaidSubscriptionStatus = typeof paidSubscriptionStatuses[number];

export interface TeamBillingSubscription {
  readonly id: string;
  readonly plan: string;
  readonly status: string;
  readonly periodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly seats: number | null;
}

export interface TeamBillingState {
  readonly configured: boolean;
  readonly enforced: boolean;
  readonly allowed: boolean;
  readonly reason: 'not_configured' | 'not_enforced' | 'subscribed' | 'subscription_required';
  readonly subscription: TeamBillingSubscription | null;
  readonly teamSlug: string | null;
  readonly billingUrl: string | null;
}

export interface TeamMemberCount {
  readonly memberCount: number;
}

const serializeSubscription = (
  row: typeof subscription.$inferSelect,
): TeamBillingSubscription => ({
  id: row.id,
  plan: row.plan,
  status: row.status,
  periodEnd: row.periodEnd?.toISOString() || null,
  cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
  seats: row.seats,
});

export const subscriptionHasPaidAccess = (status: string): status is PaidSubscriptionStatus =>
  paidSubscriptionStatuses.includes(status as PaidSubscriptionStatus);

export async function getTeamMemberCount(teamId: string): Promise<number> {
  const [row] = await db
    .select({ memberCount: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.organizationId, teamId));

  return row?.memberCount || 0;
}

export async function getCurrentTeamSubscription(teamId: string): Promise<TeamBillingSubscription | null> {
  const [activeSubscription] = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.referenceId, teamId), inArray(subscription.status, paidSubscriptionStatuses)))
    .orderBy(desc(subscription.periodEnd))
    .limit(1);

  if (activeSubscription) {
    return serializeSubscription(activeSubscription);
  }

  const [latestSubscription] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.referenceId, teamId))
    .orderBy(desc(subscription.periodEnd))
    .limit(1);

  return latestSubscription ? serializeSubscription(latestSubscription) : null;
}

export async function getTeamBillingState(teamId: string): Promise<TeamBillingState> {
  const [[team], currentSubscription] = await Promise.all([
    db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, teamId))
      .limit(1),
    getCurrentTeamSubscription(teamId),
  ]);

  const configured = isStripeBillingConfigured();
  const subscribed = currentSubscription ? subscriptionHasPaidAccess(currentSubscription.status) : false;
  const allowed = !configured || !isBillingEnforcementEnabled || subscribed;
  const reason = !configured
    ? 'not_configured'
    : subscribed
      ? 'subscribed'
      : isBillingEnforcementEnabled
        ? 'subscription_required'
        : 'not_enforced';
  const teamSlug = team?.slug || null;

  return {
    configured,
    enforced: isBillingEnforcementEnabled,
    allowed,
    reason,
    subscription: currentSubscription,
    teamSlug,
    billingUrl: teamSlug ? `/t/${teamSlug}/settings/billing` : null,
  };
}
