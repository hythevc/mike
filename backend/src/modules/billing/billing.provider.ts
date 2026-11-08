// SPDX-License-Identifier: AGPL-3.0-only
//
// The billing provider seam. The billing module talks to a payment provider
// through this interface alone: one adapter speaks to Stripe's REST API over
// fetch (billing.stripe.ts), and one is an in-process fake for tests and
// local stacks (billing.fake.ts). billing.registry.ts picks the one the
// deployment configured. Nothing here charges anyone; the adapters create
// hosted provider pages and read the provider's signed events.
//
// Events are normalized here so the rest of the module never reads a
// provider payload. A provider id (customer, subscription) is an opaque
// reference into the provider's account: it names the paying customer, so
// it is stored on org_subscriptions and never returned to a browser.

import type { SubscriptionStatus } from "../../lib/entitlements";
import type { BillingProviderKind } from "../../lib/runtimeConfig";

export type CheckoutSessionInput = {
    orgId: string;
    planKey: string;
    /** The provider's price id for the plan (`provider_price_ref` in the catalog). */
    priceRef: string;
    /** The provider's customer id when the workspace already has one. */
    customerRef: string | null;
    /** The buyer's email, used only to prefill a customer the provider creates. */
    customerEmail: string | null;
    /** Where the provider sends the browser after a completed checkout. */
    successUrl: string;
    /** Where the provider sends the browser when the checkout is abandoned. */
    cancelUrl: string;
};

export type PortalSessionInput = {
    customerRef: string;
    /** Where the provider's portal sends the browser back to. */
    returnUrl: string;
};

/** A hosted provider page the browser is sent to. */
export type HostedSession = { url: string };

/**
 * A provider event as the module acts on it. `id` is the provider's event
 * id, the idempotency key; `providerType` is the provider's own type string,
 * recorded in billing_events for the operator's benefit.
 */
export type BillingEvent =
    | {
          id: string;
          providerType: string;
          type: "checkout_completed";
          /** The workspace the checkout was started for (metadata), if any. */
          orgId: string | null;
          planKey: string | null;
          customerRef: string | null;
          subscriptionRef: string | null;
          /** The provider confirmed payment (or none was due yet, as on a trial). */
          paid: boolean;
      }
    | {
          id: string;
          providerType: string;
          type: "payment_failed";
          customerRef: string | null;
          subscriptionRef: string | null;
      }
    | {
          id: string;
          providerType: string;
          type: "subscription_deleted";
          orgId: string | null;
          customerRef: string | null;
          subscriptionRef: string | null;
      }
    | {
          id: string;
          providerType: string;
          type: "subscription_updated";
          orgId: string | null;
          customerRef: string | null;
          subscriptionRef: string | null;
          /** The provider's status mapped to ours, or null for one that changes nothing. */
          status: SubscriptionStatus | null;
          currentPeriodEnd: string | null;
          trialEndsAt: string | null;
          /**
           * The provider's price id on the subscription's item, so a plan
           * switch made in the provider's portal can be matched against the
           * catalog's `provider_price_ref`. Null when the report carries none.
           */
          priceRef: string | null;
      }
    | {
          id: string;
          providerType: string;
          type: "ignored";
      };

/** A webhook delivery whose signature does not check out, or is malformed. */
export class BillingSignatureError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BillingSignatureError";
    }
}

/**
 * A provider API call that failed. The message is fixed text plus the HTTP
 * status; the provider's own message can name the customer, so it is never
 * copied in.
 */
export class BillingProviderError extends Error {
    readonly status: number | null;

    constructor(
        message: string,
        status: number | null = null,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = "BillingProviderError";
        this.status = status;
    }
}

export interface BillingProvider {
    readonly kind: BillingProviderKind;
    createCheckoutSession(input: CheckoutSessionInput): Promise<HostedSession>;
    createPortalSession(input: PortalSessionInput): Promise<HostedSession>;
    /**
     * Verify a webhook delivery against its signature header and normalize
     * it. Throws BillingSignatureError when the delivery cannot be trusted.
     * `now` exists so tests can sign fixtures at a fixed time.
     */
    parseWebhookEvent(
        payload: Buffer,
        signatureHeader: string | undefined,
        now?: Date,
    ): BillingEvent;
}
