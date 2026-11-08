// SPDX-License-Identifier: AGPL-3.0-only
//
// Facade of the billing module: hosted checkout and portal sessions for an
// organization's owners, and the provider's webhook. Everything sits behind
// BILLING_ENABLED (default off): with it unset, every function answers
// not_found before constructing a provider, and nothing here charges anyone.
// Subscription state is written only through the entitlements helpers
// (lib/entitlements.ts); the provider adapters are billing.stripe.ts (REST
// over fetch) and billing.fake.ts (tests and local stacks).

export { createCheckoutSession, createPortalSession, billingReturnUrls } from "./billing.sessions";
export {
    applyBillingEvent,
    handleBillingWebhook,
    type BillingOutcome,
    type WebhookReceipt,
} from "./billing.webhooks";
export { resolveBillingProvider, setBillingProviderForTests } from "./billing.registry";
export { createFakeBillingProvider, type FakeBillingProvider } from "./billing.fake";
export type { BillingEvent, BillingProvider } from "./billing.provider";
