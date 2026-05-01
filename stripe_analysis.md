# Stripe Billing Integration Analysis

This evaluates the current Stripe billing integration in this checkout, focused on whether Orchid should keep using the Better Auth Stripe plugin or replace it with a custom billing implementation.

## Executive Recommendation

Keep the Better Auth Stripe plugin, but wrap it with explicit guardrails instead of rolling a custom integration now.

That is the pragmatic choice for this codebase because Orchid currently needs a conventional team subscription flow: Better Auth already owns auth, organizations, sessions, and membership roles; the billing entity is the Better Auth organization; and the current app only needs Checkout, Customer Portal, subscription status sync, and feature gating. The plugin directly covers those pieces and keeps the hardest failure-prone billing code out of the app.

The recommendation is not "plugin forever." Roll custom when Orchid needs usage-based metering, credit ledgers, entitlements beyond plan/status/seats, custom invoice/payment recovery behavior, multiple independently managed subscriptions per team, non-standard seat semantics, or stronger operational guarantees around webhook replay, reconciliation, and audit trails than the plugin exposes.

## Current Local Integration

The project is on `codex/fix-stripe-billing-review`. Billing was introduced around `af055e4 implement stripe billing` and revised in `d83c6b6 fix stripe billing review issues`.

The dependency versions matter:

- `web/package.json` uses `better-auth` and `@better-auth/stripe` `^1.5.6`, with `stripe` `^20.4.1`.
- The current Better Auth docs are for v1.6/latest and show `stripe@^22.0.0` plus an explicit `apiVersion`. That is ahead of this branch and should not be assumed to match behavior exactly.

The implementation shape:

- `web/app/lib/auth.ts` mounts the Better Auth organization plugin and conditionally mounts the Stripe plugin only when Stripe secret, webhook secret, and at least one configured team plan exist.
- The plugin is configured for organization billing, with `referenceId` equal to the organization id. `authorizeReference` allows only `owner` and `admin` members to manage billing for that organization.
- Organization Stripe customers are created with `organizationId` and `organizationSlug` metadata.
- `web/app/lib/billing-config.ts` defines a single `team` plan from env vars for monthly price, annual price, lookup keys, and optional seat price.
- `web/app/(app)/t/[teamSlug]/settings/billing/` renders billing state and posts directly to Better Auth's `/api/auth/subscription/upgrade` and `/api/auth/subscription/billing-portal` endpoints.
- `web/app/lib/billing.ts` reads local subscription rows and treats only `active` and `trialing` as paid access.
- `web/app/lib/api-app.ts` enforces team subscription access for session ingest, session summary, session chat, and decision log routes. Read-only session list/search is not gated.
- `web/app/lib/schema.ts` and `web/drizzle/0001_small_norrin_radd.sql` add the Better Auth Stripe plugin fields: `user.stripe_customer_id`, `organization.stripe_customer_id`, and a `subscription` table.
- Tests cover local billing status/enforcement and the checkout request body. They do not currently exercise the Better Auth Stripe webhook handler or live Stripe API behavior.

## What the Plugin Gives Orchid

The plugin gives us a lot of billing plumbing that is easy to get subtly wrong:

- Authenticated billing endpoints under `/api/auth/subscription/*`.
- Stripe Checkout session creation for subscription mode.
- Billing Portal session creation.
- Customer creation/linking for users and organizations.
- Local subscription record creation and updates.
- Webhook signature verification with the raw request body.
- Handling for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
- Subscription lifecycle callbacks for completion, creation, update, cancellation, and deletion.
- Plan lookup by price id or lookup key.
- Support for annual plan changes, scheduled changes, and portal-based update confirmation.
- Organization authorization through `authorizeReference`.
- Organization customer support and organization deletion protection when active subscriptions exist.
- Seat quantity sync on organization member changes when `seatPriceId` is configured.
- Trial reuse prevention across plans when trials are configured.
- A schema contract aligned with Better Auth's adapter and plugin model.

For this app, the biggest benefit is that billing identity lines up with auth identity. Orchid already trusts Better Auth for organization membership, active organization id, and session cookies. Reusing that reference system means we do not need a second authorization model for billing.

## Constraints and Failure Modes

### Version Skew

The current Better Auth docs are v1.6/latest and recommend `stripe@^22.0.0` with an explicit API version. This repo uses plugin 1.5.6 and `stripe` 20.4.1. Stripe's docs say `stripe-node` v12+ aligns requests with the API version current when the library version was released, while webhook events use the endpoint API version or the account default unless configured otherwise.

Implication: when deploying, pin or document the Stripe webhook endpoint API version that matches the SDK/plugin version, and test before upgrading Better Auth or Stripe major versions.

### Webhook Dependence

Stripe says subscription activity is asynchronous and subscription integrations should use webhooks for status changes and payment failures. The plugin handles the four events Better Auth requires, and README instructs subscribing to those four events.

The current app gates access from the local `subscription` table. If webhooks are missing, misconfigured, blocked by preview deployment auth, delayed, or failing, the app state can drift from Stripe. The plugin has a checkout success fallback that retrieves Stripe state after redirect, but production correctness still depends on webhooks.

Missing today: a reconciliation job or admin repair path that compares local subscriptions with Stripe by `stripe_customer_id` / `stripe_subscription_id`.

### Webhook Work Is Synchronous

Stripe recommends returning a `2xx` quickly before complex work that might time out. The plugin processes DB updates and hook callbacks before returning success. That is fine while the hook work is small, but Orchid should keep any `onEvent` or lifecycle callbacks lightweight. If we add expensive work later, put it behind `after()` or a queue.

### Status Policy Is Stricter Than Stripe's "Active Subscription" Redirect Feature

Orchid grants access only for `active` and `trialing`. Stripe's subscription lifecycle docs say `trialing` can be provisioned and `active` is in good standing. They also say `unpaid` should revoke access, and `past_due` should usually trigger customer notification/payment recovery. The current strict policy blocks `past_due`, `unpaid`, `paused`, `incomplete`, `incomplete_expired`, and `canceled`.

This is defensible for a paid team feature gate, but it is a product decision. If we want a dunning grace period, `past_due` needs explicit handling rather than silently inheriting the current block.

### Portal Limitations

Stripe's Customer Portal is not an unconstrained subscription editor. Stripe documents limitations around updates for multiple products, usage-based billing, invoice collection methods, unsupported payment methods, scheduled updates, tax behavior differences, and iframe embedding. The portal update-confirm flow also has item constraints.

This matters because Better Auth leans on the portal for some existing-subscription changes and for general "Manage billing." That is a good fit for simple plan/seat/card management, less so for complex pricing.

### Seat Billing Semantics Are Plugin-Controlled

Stripe supports per-seat licensing by setting subscription item quantity for licensed recurring prices, and quantity changes can prorate. Better Auth's organization seat support counts Better Auth members and syncs that count to Stripe using `proration_behavior` from the plan, defaulting to Stripe prorations.

That means an Orchid team invite acceptance or member removal can become a billing quantity change. This is probably right for "members are seats," but it must be intentional. If Orchid later wants pending invites, inactive users, bot accounts, or free owner seats to be treated differently, the plugin's member-count model becomes a constraint.

There is also one concrete config edge case in this branch: `isStripeBillingConfigured()` returns true if only `STRIPE_TEAM_SEAT_PRICE_ID` is set, because `getConfiguredStripePlans()` will return a plan when `teamSeatPriceId` exists. But Better Auth still needs a base `priceId` or lookup key for checkout unless the seat price is also the selected plan price. With only a seat price configured, checkout can fail with "Price ID not found for the selected plan." The guardrail should require `STRIPE_TEAM_PRICE_ID` or `STRIPE_TEAM_LOOKUP_KEY` for this plan, or intentionally set `priceId` to the seat price for a seat-only plan.

### Duplicate and Drift Controls Are Thin

The schema has indexes on `reference_id`, `stripe_customer_id`, and `stripe_subscription_id`, but no uniqueness constraint. Better Auth can intentionally keep historical or incomplete subscription rows, so a naive unique `reference_id` is not automatically correct. Still, app reads should be explicit about which row wins.

`getCurrentTeamSubscription()` prefers active/trialing rows by latest `periodEnd`, then falls back to latest subscription by `periodEnd`. That is enough for UI display and gating, but it does not prove there is only one paid subscription per team in Stripe.

### Testing Is Not Yet Proving the Stripe Contract

Current tests prove:

- unconfigured billing allows access;
- configured/enforced/no subscription blocks team feature use;
- unscoped requests are blocked when billing is enforced;
- active local subscription allows access;
- checkout body includes organization reference and optional seats.

They do not prove:

- Better Auth plugin endpoints are mounted correctly end to end;
- `authorizeReference` blocks non-admin members;
- Stripe webhook signature verification works through the Hono/Next route;
- webhook events update `subscription` rows as expected;
- deleted/canceled/past_due/unpaid statuses change access as intended;
- Customer Portal opens only for the right team/customer;
- seat sync fires on membership changes;
- duplicate checkout retries do not create surprising local/Stripe state.

## If We Rolled Custom

Rolling custom means owning at least these surfaces:

- POST endpoint to create Checkout Sessions with `mode=subscription`, correct line items, success/cancel URLs, customer handling, metadata, `client_reference_id`, and idempotency keys.
- Customer lookup/creation for organizations, including dedupe by local organization id and safe metadata usage.
- Billing Portal session endpoint with authorization and return URL validation.
- Webhook endpoint that preserves raw body, verifies `Stripe-Signature`, handles endpoint-specific secrets, and processes replay/retry behavior.
- Event handling for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and likely invoice/payment events depending on access policy.
- Database schema for customers, subscriptions, subscription items, prices/plans, webhook events, and processed-event idempotency.
- Reconciliation from Stripe to local DB for missed events and manual Stripe Dashboard changes.
- Team authorization checks equivalent to `authorizeReference`.
- Seat quantity policy and sync logic, including proration choices and race handling around member changes.
- Tests with signed webhook fixtures and Stripe test-mode/CLI flows.
- Operational docs for webhook endpoint versions, secret rotation, retries, and incident repair.

The upside of custom is control: exact schema, exact status policy, event idempotency table, first-class audit logs, background queues, custom entitlements, usage metering, and a reconciliation job designed for Orchid. The downside is that this becomes a billing subsystem, not a thin integration.

## Better Auth Plugin vs Custom

| Area | Better Auth Stripe plugin | Custom billing |
| --- | --- | --- |
| Initial delivery | Already mostly implemented | Significant new work |
| Auth/organization fit | Strong; uses Better Auth session and org references | Must duplicate or wrap these checks |
| Checkout | Covered for conventional subscription plans | Full control over every parameter |
| Portal | Covered, but bounded by Stripe portal/plugin flows | Can mix portal with custom flows |
| Webhook verification | Covered by plugin | Must implement and test raw-body verification |
| Local schema | Plugin-shaped and simple | Can design richer billing/audit schema |
| Subscription state | Plugin syncs core status/period/seats | Can include events, invoices, entitlements, reconciliation |
| Seat billing | Auto member-count sync | Can implement custom seat definitions |
| Idempotency | Possible through plugin customization, not currently configured | Full processed-event and request idempotency model |
| Testing burden | Lower, but still needs integration tests | Higher; every Stripe edge case is ours |
| Future pricing complexity | Limited | Better for usage, credits, enterprise contracts |

## Recommended Guardrails

Keep the plugin and add guardrails before enabling enforcement in production:

1. Fix plan configuration validation.
   Require a monthly price id or monthly lookup key for the `team` plan, unless intentionally mapping `seatPriceId` as the primary price for a seat-only plan.

2. Pin the Stripe API version explicitly.
   The current code constructs `new Stripe(process.env.STRIPE_SECRET_KEY)` without an explicit `apiVersion`. Add one matching the installed Stripe SDK/plugin after confirming compatibility, and create the webhook endpoint with the same version.

3. Add a Stripe state reconciliation path.
   A lightweight admin-only or scheduled job that re-fetches subscriptions by stored customer/subscription id would mitigate missed webhook drift.

4. Decide the `past_due` policy.
   Either keep strict blocking or add an explicit grace rule. Do not leave it as an accidental consequence of `['active', 'trialing']`.

5. Add plugin endpoint/webhook tests.
   Test owner/admin vs member authorization, signed webhook request handling, status transitions, portal access, and the edge status matrix.

6. Keep plugin callbacks lightweight.
   If `onEvent` or lifecycle hooks are added, do not do slow work before the webhook response.

7. Document seat billing behavior.
   State that paid seats equal Better Auth organization members, and document the proration behavior for member changes.

## Decision Criteria

Stay with the plugin when all are true:

- Billing remains team subscription based.
- Products are flat monthly/annual plans, optionally with straightforward per-seat quantity.
- Stripe Checkout and Customer Portal are acceptable user-facing flows.
- Local app access can be derived from subscription status, period, plan, and seats.
- Billing changes are authorized by Better Auth organization owner/admin roles.
- Operational risk can be handled with tests, webhook monitoring, and reconciliation.

Wrap the plugin with guardrails when:

- We need stronger validation, better tests, explicit API versioning, reconciliation, or a clearer status policy.
- We need light Checkout customization such as tax collection, promotion codes, billing address collection, or idempotency keys through `getCheckoutSessionParams`.
- We need to expose a more product-specific billing UI while still letting the plugin own Stripe object sync.

Roll custom when:

- Orchid needs usage-based billing, credits, metered events, prepaid balances, or feature entitlements independent of plan status.
- Seat count is not equal to organization member count.
- We need a durable processed-webhook-event table, replay tools, audit logs, and reconciliation as first-class billing primitives.
- We need subscription item structures that the Customer Portal/plugin flow cannot update cleanly.
- We need multiple active subscriptions per team or enterprise contracts that do not fit Better Auth's single reference/plan model.

## Source Links Consulted

- Better Auth Stripe plugin docs: https://better-auth.com/docs/plugins/stripe
- Better Auth Stripe plugin source, v1.5.6 `index.ts`: https://raw.githubusercontent.com/better-auth/better-auth/v1.5.6/packages/stripe/src/index.ts
- Better Auth Stripe plugin source, v1.5.6 `routes.ts`: https://raw.githubusercontent.com/better-auth/better-auth/v1.5.6/packages/stripe/src/routes.ts
- Better Auth Stripe plugin source, v1.5.6 `hooks.ts`: https://raw.githubusercontent.com/better-auth/better-auth/v1.5.6/packages/stripe/src/hooks.ts
- Better Auth Stripe plugin source, v1.5.6 `types.ts`: https://raw.githubusercontent.com/better-auth/better-auth/v1.5.6/packages/stripe/src/types.ts
- Better Auth Stripe plugin source, v1.5.6 `schema.ts`: https://raw.githubusercontent.com/better-auth/better-auth/v1.5.6/packages/stripe/src/schema.ts
- Stripe Checkout subscriptions overview: https://docs.stripe.com/payments/subscriptions
- Stripe Checkout Session create API: https://docs.stripe.com/api/checkout/sessions/create
- Stripe Customer Portal session API: https://docs.stripe.com/api/customer_portal/sessions/object
- Stripe Customer Portal limitations: https://docs.stripe.com/customer-management
- Stripe subscription webhooks and lifecycle: https://docs.stripe.com/billing/subscriptions/webhooks
- Stripe webhook signature verification: https://docs.stripe.com/webhooks?lang=node
- Stripe subscription quantities and per-seat licensing: https://docs.stripe.com/billing/subscriptions/quantities?locale=en-GB
- Stripe subscription update/proration API: https://docs.stripe.com/api/subscriptions/update
- Stripe metadata: https://docs.stripe.com/metadata
- Stripe idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Stripe API versioning for SDKs and webhooks: https://docs.stripe.com/api/versioning?lang=node
- Stripe Checkout active-subscription redirect behavior: https://docs.stripe.com/payments/checkout/limit-subscriptions

## Local Files Reviewed

- `web/app/lib/auth.ts`
- `web/app/lib/auth-client.ts`
- `web/app/lib/billing.ts`
- `web/app/lib/billing-config.ts`
- `web/app/lib/api-app.ts`
- `web/app/(app)/t/[teamSlug]/settings/billing/page.tsx`
- `web/app/(app)/t/[teamSlug]/settings/billing/billing-actions.tsx`
- `web/app/lib/schema.ts`
- `web/app/lib/auth-schema.ts`
- `web/drizzle/0001_small_norrin_radd.sql`
- `web/__tests__/api/billing.test.ts`
- `web/__tests__/billing-actions.test.ts`
- `web/__tests__/migration.test.ts`
- `README.md`
- `web/README.md`
- `.env.example`
- `web/package.json`
- installed local package source for `@better-auth/stripe` 1.5.6
