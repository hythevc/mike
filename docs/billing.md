<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Billing

Billing is **off by default** and stays off until an operator turns it on. This
page covers the adapter that sits behind the switch, how it is kept in test
mode, what it does when it is on, and how to try it locally. Nothing in the
repository charges anyone; the plan catalog and every price live in deployment
configuration, never in source control (see
[Plans, seats and trials](deployment.md#plans-seats-and-trials)).

## The switches

| Variable | Default | Effect |
| --- | --- | --- |
| `BILLING_ENABLED` | unset (off) | Only the exact value `true` turns billing on. Off, every `/billing` route answers 404 before authentication, no provider adapter is constructed, and the plan surfaces report `billing_enabled: false`, so the web app shows no checkout or portal control. |
| `BILLING_PROVIDER` | `stripe` | `stripe` calls the provider's REST API over `fetch`. `fake` is an in-process adapter for tests and local stacks; the backend refuses to boot with it in production. |
| `STRIPE_SECRET_KEY` | unset | The provider's secret API key. **Test mode only** (`sk_test_…` or `rk_test_…`): a live-mode key (`sk_live_…`, `rk_live_…`) fails boot validation unless `BILLING_ALLOW_LIVE` is also set. Required when billing is on with the `stripe` provider. |
| `STRIPE_WEBHOOK_SECRET` | unset | The webhook endpoint's signing secret (`whsec_…`). Required when billing is on, for either provider. |
| `BILLING_ALLOW_LIVE` | unset | Only the exact value `true` lets a live-mode key boot. Leave it unset; this repository configures no live keys anywhere. |
| `RATE_LIMIT_BILLING_WEBHOOK_WINDOW_MINUTES`, `RATE_LIMIT_BILLING_WEBHOOK_MAX` | 15, 1000 | The webhook's own rate-limit lane (it is kept out of the shared per-address budget). |

The boot check lives in `backend/src/lib/runtimeConfig.ts` and runs in every
environment, so a copied production key is refused in a local run as firmly as
in production. The adapter constructor repeats the live-key check, so a request
cannot reach a live account even on a build that skipped boot validation.

Billing needs plans: a checkout buys a plan from `PLANS_CATALOG_JSON`, and the
plan's `provider_price_ref` is the provider's price id. With `PLANS_ENABLED`
unset a checkout is refused with 409 even when billing is on.

## What is on when it is on

The module is `backend/src/modules/billing/`:

| File | Role |
| --- | --- |
| `billing.routes.ts` | The HTTP layer, mounted at `/billing`, plus the webhook handler that `app.ts` registers with a raw body. |
| `billing.service.ts` | The facade. |
| `billing.sessions.ts` | Hosted checkout and portal sessions for an organization's owners. |
| `billing.webhooks.ts` | The provider's events, applied once each. |
| `billing.provider.ts` | The adapter interface and the normalized event shape. |
| `billing.stripe.ts` | The REST adapter: form-encoded `fetch` calls and HMAC signature checks with `node:crypto`. No SDK. |
| `billing.fake.ts` | The in-process adapter for tests and local stacks. |
| `billing.registry.ts` | Picks the configured adapter; tests install their own. |

### Routes

| Route | Who | Does |
| --- | --- | --- |
| `POST /billing/orgs/:orgId/checkout-session` with `{ "plan_key": "…" }` | organization owners | Returns `{ url }` of a hosted checkout for one plan on offer. The browser is sent there and comes back to the organization's Plan and usage page with `?checkout=success` or `?checkout=canceled`. Refused for a plan that is not public, has no provider price, or while the organization already has a live subscription (use the portal instead). |
| `POST /billing/orgs/:orgId/portal-session` | organization owners | Returns `{ url }` of the provider's billing portal (payment method, invoices, cancellation). Refused with 409 until a first checkout has created a customer. |
| `POST /billing/webhook` | the provider | Unauthenticated by design; the signature is the credential. |

Members and admins get 403 ("Only an organization owner can change its plan or
billing."); non-members and personal workspaces get 404, as elsewhere in the
organization API. Starting a checkout and opening the portal are recorded in
the organization's audit trail (`billing.checkout_started`,
`billing.portal_opened`). Payment details are entered on the provider's pages,
never in this app, and nothing about the card or the invoice is stored here.

`GET /orgs/:id/plan` and `GET /plans/me` report `billing_enabled` and
`has_billing_account` (a customer exists at the provider), which is all the
web app needs to decide whether to show **Choose a plan** and **Manage
billing**. Both controls appear only to owners, and only when billing is on.

### Webhook events

Every delivery is verified against `STRIPE_WEBHOOK_SECRET` (`Stripe-Signature:
t=…,v1=…`, HMAC-SHA256 over `t.body`, five-minute replay window, constant-time
comparison). A delivery that does not verify is answered 400 and nothing is
read from it. A verified event is then **claimed** in `billing_events` by its
id before it is applied:

- a redelivery of an event that was already applied answers 200 without being
  applied again;
- a delivery whose processing fails has its claim released and answers 500,
  so the provider's retry is applied afresh;
- a second delivery arriving while the first is still being applied answers
  409 and is retried by the provider, by which time it is a duplicate;
- a claim left unprocessed for five minutes (a crash mid-way) is taken over by
  the next delivery.

Only the event id and type are kept in `billing_events`, never the payload.

The events, and what they do to `org_subscriptions` (always through the
helpers in `backend/src/lib/entitlements.ts`):

| Event | Effect |
| --- | --- |
| `checkout.session.completed` (subscription mode) | The workspace named in the checkout's metadata becomes `active` on the plan it bought, with the provider's customer and subscription ids recorded and the trial window cleared. A checkout whose payment is still pending records the ids and leaves the status alone. |
| `invoice.payment_failed` | The workspace becomes `past_due`. It is acted on, never only logged: with plans on, a past-due workspace cannot use the deployment's hosted models until the provider reports the subscription paid again. The plan and the ids stay. |
| `customer.subscription.deleted` | The workspace becomes `canceled` on the unpaid default: no plan, no subscription id, no period. It never lands on another paid plan here; only a new completed checkout does that. The customer id is kept so the portal (invoices) still opens. A deletion of a subscription the workspace has since replaced changes nothing. |
| `customer.subscription.updated` | The status and dates follow the provider's report for the workspace's **current** subscription (`active`, `trialing`, `past_due`; `unpaid` and `paused` read as past due; `canceled` and `incomplete_expired` cancel as above). The plan is never changed by this event, and a report about a subscription this deployment never recorded, or has already canceled and cleared, changes nothing, so a late report cannot put a canceled workspace back on a plan. |
| anything else | Recorded as received and ignored. |

A failed payment therefore holds hosted-model use (`blocksHostedModels` in
entitlements) until the provider reports recovery, a person's own key is never
affected, and export and account or organization deletion are never blocked
(see [Plans, seats and trials](deployment.md#plans-seats-and-trials)).

## Turning it on in test mode

1. Set `PLANS_ENABLED=true` and a `PLANS_CATALOG_JSON` whose plans carry the
   provider's **test-mode** price ids in `provider_price_ref`.
2. Set `BILLING_ENABLED=true`, `STRIPE_SECRET_KEY` to a test-mode key and
   `STRIPE_WEBHOOK_SECRET` to the endpoint's signing secret. Leave
   `BILLING_ALLOW_LIVE` unset.
3. Register the webhook endpoint `https://<api>/billing/webhook` at the
   provider for the four event types above.
4. Apply `20261108_50_billing_events.sql` (Compose's `db-init` runs it). It is
   additive and safe to re-run.

Locally, the provider's CLI can forward test events to the API, for example
`stripe listen --forward-to localhost:3001/billing/webhook`, and prints the
signing secret to use as `STRIPE_WEBHOOK_SECRET`. Return URLs are built from
`FRONTEND_URL`.

For an automated stack without network access, set `BILLING_PROVIDER=fake`:
checkout and portal answer with placeholder URLs on a reserved domain and the
webhook accepts deliveries signed with `STRIPE_WEBHOOK_SECRET` in the real wire
format (`billing.fake.ts` exposes `sign()` for this). The fake is refused in
production.

## Not configured anywhere

This repository and its documentation describe test mode only. No live key is
set in any example, fixture, workflow or environment file, `BILLING_ALLOW_LIVE`
is documented only so an operator knows what it guards, and prices appear
nowhere in source: a plan's `display_price_text` and `provider_price_ref` come
from `PLANS_CATALOG_JSON` alone. Fixtures use obviously placeholder values.

## Tests

- `backend/src/__tests__/integration/billing.routes.test.ts`: every route is
  404 with billing off and the real adapter is never constructed; owner-only
  sessions; the webhook's signature, duplicate and state-change cases over
  HTTP.
- `backend/src/modules/billing/__tests__/billing.webhooks.test.ts`: what each
  event does, the claim, release and takeover.
- `backend/src/modules/billing/__tests__/billing.stripe.test.ts`: form
  encoding, signatures, event normalization across API-version shapes, and
  the REST calls against a stubbed `fetch`.
- `backend/src/lib/__tests__/runtimeConfig.test.ts`: the live-key refusal and
  the other boot rules.
- `frontend/src/app/components/organizations/OrganizationBillingActions.test.tsx`
  and `OrganizationPlanSettings.test.tsx`: no checkout or portal control while
  billing is off; owners alone see them when it is on.
