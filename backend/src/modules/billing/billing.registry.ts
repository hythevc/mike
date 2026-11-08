// SPDX-License-Identifier: AGPL-3.0-only
//
// Which billing adapter a request uses. Nothing is constructed at import
// time or while billing is off: the service asks for a provider only after
// it has seen BILLING_ENABLED, so a deployment that never bills never builds
// one. Tests install a provider through setBillingProviderForTests.

import {
    billingConfiguration,
    type BillingConfiguration,
} from "../../lib/runtimeConfig";
import type { BillingProvider } from "./billing.provider";
import { createFakeBillingProvider } from "./billing.fake";
import { createStripeBillingProvider } from "./billing.stripe";

let override: BillingProvider | null = null;

/** Install a provider for tests; null goes back to the configured one. */
export function setBillingProviderForTests(provider: BillingProvider | null): void {
    override = provider;
}

/**
 * The configured adapter. Call only once billing is known to be enabled.
 * Throws BillingProviderError when the configuration cannot make one (a
 * missing or live-mode key).
 */
export function resolveBillingProvider(
    config: BillingConfiguration = billingConfiguration(),
): BillingProvider {
    if (override) return override;
    if (config.provider === "fake")
        return createFakeBillingProvider({ webhookSecret: config.webhookSecret });
    return createStripeBillingProvider({
        secretKey: config.secretKey,
        webhookSecret: config.webhookSecret,
        allowLive: config.allowLive,
    });
}
