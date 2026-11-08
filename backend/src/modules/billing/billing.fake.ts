// SPDX-License-Identifier: AGPL-3.0-only
//
// An in-process billing provider for tests and local stacks
// (BILLING_PROVIDER=fake; lib/runtimeConfig.ts refuses it in production).
// It never calls out: checkout and portal sessions answer with placeholder
// URLs on a reserved domain, and every call is recorded so a test can assert
// what the module asked for. Webhooks keep the real provider's wire format
// and signature scheme, so the same signed fixtures exercise both adapters
// and an unsigned or tampered delivery is refused here too.

import type {
    BillingProvider,
    CheckoutSessionInput,
    HostedSession,
    PortalSessionInput,
} from "./billing.provider";
import { parseStripeWebhook, stripeSignatureHeader } from "./billing.stripe";

export type FakeBillingCall =
    | { kind: "checkout"; input: CheckoutSessionInput }
    | { kind: "portal"; input: PortalSessionInput };

export type FakeBillingProvider = BillingProvider & {
    /** Every session the module asked for, in order. */
    readonly calls: FakeBillingCall[];
    /** Sign a payload the way the provider would, for tests and local tooling. */
    sign(payload: Buffer | string, now?: Date): string;
};

export function createFakeBillingProvider(options: {
    webhookSecret: string;
}): FakeBillingProvider {
    const calls: FakeBillingCall[] = [];
    let sessions = 0;
    return {
        kind: "fake",
        calls,
        sign: (payload, now) => stripeSignatureHeader(payload, options.webhookSecret, now),

        async createCheckoutSession(input: CheckoutSessionInput): Promise<HostedSession> {
            calls.push({ kind: "checkout", input });
            sessions += 1;
            return { url: `https://billing.invalid/checkout/${sessions}` };
        },

        async createPortalSession(input: PortalSessionInput): Promise<HostedSession> {
            calls.push({ kind: "portal", input });
            sessions += 1;
            return { url: `https://billing.invalid/portal/${sessions}` };
        },

        parseWebhookEvent(payload, signatureHeader, now) {
            return parseStripeWebhook({
                payload,
                header: signatureHeader,
                secret: options.webhookSecret,
                now,
            });
        },
    };
}
