// SPDX-License-Identifier: AGPL-3.0-only
//
// The provider's webhook: the one place a subscription's state changes.
//
//   checkout completed        the workspace is active on the plan it bought
//   payment failed            the workspace is past due (hosted models held)
//   subscription deleted      the workspace is canceled, on no plan
//   subscription updated      the status and dates follow the provider's;
//                             the plan follows a plan switch made in the
//                             portal only onto a plan the catalog offers
//                             at the subscription's new price
//
// Two rules the handlers never bend: a canceled workspace lands on the
// unpaid default, never on a paid plan — only a new completed checkout puts
// it on one — and a failed payment is acted on, never only logged. An event
// about a subscription the workspace has since replaced (it canceled and
// bought again) is stale and changes nothing, whatever it reports.
//
// Deliveries arrive at least once and in no fixed order. Every accepted
// event id is claimed in billing_events before it is applied, so a
// redelivery is answered without being applied twice; a claim whose
// processing fails is released so the provider's retry is applied afresh.

import type { Db } from "../../lib/supabase";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import {
    activateSubscription,
    cancelSubscription,
    findSubscriptionByProviderRef,
    markSubscriptionPastDue,
    readSubscriptionRefs,
    recordSubscriptionRefs,
    syncSubscriptionStatus,
    type SubscriptionRefs,
} from "../../lib/entitlements";
import { planByKey, planByProviderPriceRef } from "../../lib/planCatalog";
import { billingConfiguration } from "../../lib/runtimeConfig";
import {
    BillingProviderError,
    BillingSignatureError,
    type BillingEvent,
    type BillingProvider,
} from "./billing.provider";
import { resolveBillingProvider } from "./billing.registry";

/** What applying an event did. */
export type BillingOutcome =
    | "activated"
    /** The checkout completed but its payment is still pending; references recorded. */
    | "payment_pending"
    | "past_due"
    | "canceled"
    /** Status and dates followed the provider's report. */
    | "synced"
    /** An event type the module does not act on, or a report that changes nothing. */
    | "ignored"
    /** The event names no workspace on this deployment. */
    | "unmatched"
    /** The event is about a subscription the workspace has since replaced. */
    | "stale";

export type WebhookReceipt = {
    received: true;
    /** The event had already been applied; nothing was done again. */
    duplicate: boolean;
    outcome: BillingOutcome | null;
};

/**
 * A claim older than this with no processed_at belongs to an attempt that
 * died mid-way (a crash between claiming and applying); the next delivery
 * takes it over. A younger one is another delivery still in flight.
 */
const ABANDONED_CLAIM_MS = 5 * 60_000;

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNIQUE_VIOLATION = "23505";

type Claim = "claimed" | "duplicate" | "in_progress";

async function claimBillingEvent(
    db: Db,
    event: BillingEvent,
    now: Date,
): Promise<Claim> {
    const { error } = await db.from("billing_events").insert({
        event_id: event.id,
        type: event.providerType,
        received_at: now.toISOString(),
    });
    if (!error) return "claimed";
    if (error.code !== UNIQUE_VIOLATION) throw error;

    // Seen before. Take over an abandoned claim atomically: the update only
    // matches while the row is unprocessed and old enough.
    const threshold = new Date(now.getTime() - ABANDONED_CLAIM_MS).toISOString();
    const takeover = await db
        .from("billing_events")
        .update({ received_at: now.toISOString() })
        .eq("event_id", event.id)
        .is("processed_at", null)
        .lt("received_at", threshold)
        .select("event_id");
    if (takeover.error) throw takeover.error;
    if (Array.isArray(takeover.data) && takeover.data.length > 0) return "claimed";

    const { data, error: readError } = await db
        .from("billing_events")
        .select("processed_at")
        .eq("event_id", event.id)
        .maybeSingle();
    if (readError) throw readError;
    const processedAt = (data as { processed_at?: string | null } | null)?.processed_at;
    return processedAt ? "duplicate" : "in_progress";
}

async function markBillingEventProcessed(db: Db, eventId: string, now: Date): Promise<void> {
    const { error } = await db
        .from("billing_events")
        .update({ processed_at: now.toISOString() })
        .eq("event_id", eventId);
    if (error) throw error;
}

async function releaseBillingEvent(db: Db, eventId: string): Promise<void> {
    const { error } = await db.from("billing_events").delete().eq("event_id", eventId);
    if (error) throw error;
}

/**
 * The subscription a deletion is about. The subscription id is the precise
 * match; the workspace id the checkout stamped on the subscription's
 * metadata and the customer id are the fallbacks for a subscription this
 * deployment never recorded (a checkout whose completion was missed).
 */
async function locateForDeletion(
    db: Db,
    event: Extract<BillingEvent, { type: "subscription_deleted" }>,
): Promise<SubscriptionRefs | null> {
    const bySubscription = await findSubscriptionByProviderRef(db, {
        subscriptionRef: event.subscriptionRef,
    });
    if (bySubscription) return bySubscription;
    const orgId = event.orgId && UUID_RE.test(event.orgId) ? event.orgId : null;
    if (orgId) {
        const byOrg = await readSubscriptionRefs(db, orgId);
        if (byOrg) return byOrg;
    }
    return findSubscriptionByProviderRef(db, { customerRef: event.customerRef });
}

async function applyCheckoutCompleted(
    db: Db,
    event: Extract<BillingEvent, { type: "checkout_completed" }>,
    env: NodeJS.ProcessEnv,
): Promise<BillingOutcome> {
    const orgId = event.orgId && UUID_RE.test(event.orgId) ? event.orgId : null;
    if (!orgId) {
        // A checkout this module did not start (no workspace reference).
        console.warn("[billing] checkout completed without a workspace reference", {
            eventId: event.id,
        });
        return "unmatched";
    }
    if (event.planKey && !planByKey(event.planKey, env)) {
        // The catalog changed between checkout and completion. The key is
        // still recorded, so the entitlement follows the catalog once the
        // plan is back; a plan key is configuration, not personal data.
        console.warn("[billing] checkout names a plan missing from the catalog", {
            eventId: event.id,
            planKey: event.planKey,
        });
    }
    if (!event.paid) {
        // The plan key goes on the row now: when the delayed payment
        // succeeds, the provider reports the subscription active without
        // naming a plan, and the workspace must land on the one it bought
        // rather than on no plan at all.
        await recordSubscriptionRefs(db, orgId, {
            customerRef: event.customerRef,
            subscriptionRef: event.subscriptionRef,
            planKey: event.planKey,
        });
        return "payment_pending";
    }
    await activateSubscription(db, {
        orgId,
        planKey: event.planKey,
        customerRef: event.customerRef,
        subscriptionRef: event.subscriptionRef,
        currentPeriodEnd: null,
    });
    return "activated";
}

/**
 * The event is about a subscription other than the one the workspace holds:
 * the workspace canceled and bought again, and this report concerns the old
 * subscription. Only an event that names a subscription can be stale; a row
 * without a subscription id (a checkout whose completion was missed) is
 * matched through the customer and is never stale.
 */
function isStale(
    subscription: SubscriptionRefs,
    event: { subscriptionRef: string | null },
): boolean {
    return Boolean(
        subscription.subscriptionRef &&
            event.subscriptionRef &&
            subscription.subscriptionRef !== event.subscriptionRef,
    );
}

/**
 * The plan a subscription's price names in the catalog, for a status report
 * that carries one. A plan switch made in the provider's portal arrives
 * this way; it moves the workspace only onto a plan on offer at that exact
 * price. Any other price (a plan not in the catalog, an internal plan, a
 * price the operator changed at the provider only) is logged and leaves the
 * plan alone, so nothing outside the catalog can grant an entitlement.
 */
function planKeyForPrice(
    event: Extract<BillingEvent, { type: "subscription_updated" }>,
    subscription: SubscriptionRefs,
    env: NodeJS.ProcessEnv,
): string | null {
    if (!event.priceRef) return null;
    const plan = planByProviderPriceRef(event.priceRef, env);
    if (plan?.public) return plan.key;
    // The row's own plan at this price (one the operator has since taken off
    // offer, which existing subscribers keep) is not a switch: nothing to say.
    if (plan && plan.key === subscription.planKey) return null;
    // A price this deployment does not sell. The price id is the operator's
    // own configuration at the provider, not personal data.
    console.warn("[billing] subscription price is not a plan on offer; plan left as is", {
        eventId: event.id,
        priceRef: event.priceRef,
        planKey: subscription.planKey,
    });
    return null;
}

/**
 * Apply one verified event to org_subscriptions, through the entitlements
 * helpers alone. Exported for the unit tests; the HTTP path goes through
 * handleBillingWebhook, which adds the signature check and the claim.
 */
export async function applyBillingEvent(
    db: Db,
    event: BillingEvent,
    env: NodeJS.ProcessEnv = process.env,
): Promise<BillingOutcome> {
    switch (event.type) {
        case "checkout_completed":
            return applyCheckoutCompleted(db, event, env);

        case "payment_failed": {
            const subscription = await findSubscriptionByProviderRef(db, event);
            if (!subscription) return "unmatched";
            // Matched through the customer because the subscription id is
            // not on the row: a failed invoice of a subscription the
            // workspace has since replaced must not hold the live one, just
            // as its deletion must not cancel it. (An invoice that names no
            // subscription still holds its customer's workspace.)
            if (isStale(subscription, event)) return "stale";
            // Held, not logged: the workspace stays past due until the
            // provider reports the subscription paid again.
            await markSubscriptionPastDue(db, subscription.orgId);
            return "past_due";
        }

        case "subscription_deleted": {
            const subscription = await locateForDeletion(db, event);
            if (!subscription) return "unmatched";
            // The deletion of a subscription the workspace has since replaced
            // (it bought again) must not cancel the live one.
            if (isStale(subscription, event)) return "stale";
            await cancelSubscription(db, subscription.orgId);
            return "canceled";
        }

        case "subscription_updated": {
            // Exact match only. A report about a subscription this deployment
            // never recorded — or one it has already canceled and cleared —
            // changes nothing, so a late report can never put a canceled
            // workspace back on a plan.
            const subscription = await findSubscriptionByProviderRef(db, {
                subscriptionRef: event.subscriptionRef,
            });
            if (!subscription) return "unmatched";
            if (!event.status || event.status === "none") return "ignored";
            if (event.status === "canceled") {
                await cancelSubscription(db, subscription.orgId);
                return "canceled";
            }
            await syncSubscriptionStatus(db, subscription.orgId, {
                status: event.status,
                currentPeriodEnd: event.currentPeriodEnd,
                trialEndsAt: event.status === "trialing" ? event.trialEndsAt : null,
                planKey: planKeyForPrice(event, subscription, env),
            });
            return "synced";
        }

        case "ignored":
            return "ignored";
    }
}

/**
 * Receive a webhook delivery: 404 with billing off, 400 for a missing body
 * or a signature that does not check out, 200 once the event is applied or
 * found already applied. A failure while applying releases the claim and
 * answers 500, so the provider retries and the retry is applied.
 */
export async function handleBillingWebhook(
    db: Db,
    input: {
        payload: Buffer | null;
        signature: string | undefined;
        env?: NodeJS.ProcessEnv;
        provider?: BillingProvider;
        now?: Date;
    },
): Promise<ServiceResult<WebhookReceipt>> {
    const env = input.env ?? process.env;
    const config = billingConfiguration(env);
    if (!config.enabled) return failure("not_found", "Not found");
    if (!input.payload || input.payload.length === 0)
        return failure("validation", "A signed event body is required.");

    let provider: BillingProvider;
    try {
        provider = input.provider ?? resolveBillingProvider(config);
    } catch (error) {
        if (error instanceof BillingProviderError)
            return failure("unavailable", "Billing is not configured on this deployment.");
        throw error;
    }

    const now = input.now ?? new Date();
    let event: BillingEvent;
    try {
        event = provider.parseWebhookEvent(input.payload, input.signature, now);
    } catch (error) {
        if (error instanceof BillingSignatureError) {
            // The reason is fixed text from the verifier, never payload content.
            console.warn("[billing] webhook refused", { reason: error.message });
            return failure("validation", "Invalid signature.");
        }
        throw error;
    }

    const claim = await claimBillingEvent(db, event, now);
    if (claim === "duplicate")
        return ok({ received: true, duplicate: true, outcome: null });
    if (claim === "in_progress")
        // Another delivery of this event is being applied right now; the
        // provider retries later, by which time it is a duplicate.
        return failure("conflict", "This event is being processed.");

    let outcome: BillingOutcome;
    try {
        outcome = await applyBillingEvent(db, event, env);
    } catch (error) {
        await releaseBillingEvent(db, event.id).catch((releaseError: unknown) => {
            console.error("[billing] could not release a failed event claim", {
                eventId: event.id,
                error: releaseError,
            });
        });
        return internalFailure(error);
    }
    await markBillingEventProcessed(db, event.id, now);
    console.info("[billing] webhook applied", {
        eventId: event.id,
        type: event.providerType,
        outcome,
    });
    return ok({ received: true, duplicate: false, outcome });
}
