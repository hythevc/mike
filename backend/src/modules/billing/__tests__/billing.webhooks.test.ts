// SPDX-License-Identifier: AGPL-3.0-only
//
// What each provider event does to org_subscriptions, and the claim that
// keeps a redelivered event from being applied twice. The database is the
// in-memory fake; the provider is the fake adapter, signing fixtures in the
// real wire format.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "../../../__tests__/helpers/fakeBillingDb";
import { resolveOrgEntitlement } from "../../../lib/entitlements";
import { createFakeBillingProvider } from "../billing.fake";
import type { BillingEvent } from "../billing.provider";
import { applyBillingEvent, handleBillingWebhook } from "../billing.webhooks";

const ORG = "00000000-0000-4000-8000-000000000010";
const OTHER_ORG = "00000000-0000-4000-8000-000000000011";
const SECRET = "whsec_test_placeholder";

const CATALOG = JSON.stringify([
    {
        key: "included",
        name: "Included AI",
        description: "",
        seat_limit: 25,
        features: [],
        deployment_token_allowance: 1_000_000,
        trial_days: 14,
        public: true,
        sort_order: 1,
        display_price_text: "$0 placeholder",
        provider_price_ref: "price_placeholder",
    },
]);

const ENV: NodeJS.ProcessEnv = {
    BILLING_ENABLED: "true",
    BILLING_PROVIDER: "fake",
    STRIPE_WEBHOOK_SECRET: SECRET,
    PLANS_ENABLED: "true",
    PLANS_CATALOG_JSON: CATALOG,
};

function subscription(over: Record<string, unknown> = {}) {
    return {
        org_id: ORG,
        plan_key: "included",
        status: "active",
        seat_limit: null,
        trial_ends_at: null,
        current_period_end: "2026-12-01T00:00:00.000Z",
        provider_customer_ref: "cus_1",
        provider_subscription_ref: "sub_1",
        ...over,
    };
}

const base = { id: "evt_1", providerType: "test" };

describe("applyBillingEvent", () => {
    let db: FakeDb;
    beforeEach(() => {
        db = createFakeDb({ org_subscriptions: [subscription()] });
    });

    it("activates the workspace on the plan it bought, with the provider references", async () => {
        db = createFakeDb({
            org_subscriptions: [subscription({ plan_key: null, status: "trialing", provider_customer_ref: null, provider_subscription_ref: null, current_period_end: null, trial_ends_at: "2026-11-20T00:00:00.000Z" })],
        });
        const outcome = await applyBillingEvent(
            db,
            { ...base, type: "checkout_completed", orgId: ORG, planKey: "included", customerRef: "cus_9", subscriptionRef: "sub_9", paid: true },
            ENV,
        );
        expect(outcome).toBe("activated");
        expect(db.tables.org_subscriptions[0]).toMatchObject({
            status: "active",
            plan_key: "included",
            provider_customer_ref: "cus_9",
            provider_subscription_ref: "sub_9",
            trial_ends_at: null,
        });
    });

    it("creates the row for an organization that predates the plans migration", async () => {
        db = createFakeDb({ org_subscriptions: [] });
        await applyBillingEvent(
            db,
            { ...base, type: "checkout_completed", orgId: ORG, planKey: "included", customerRef: "cus_9", subscriptionRef: "sub_9", paid: true },
            ENV,
        );
        expect(db.tables.org_subscriptions).toHaveLength(1);
        expect(db.tables.org_subscriptions[0]).toMatchObject({ org_id: ORG, status: "active", plan_key: "included" });
    });

    it("records the references but leaves the status alone while the payment is pending", async () => {
        db = createFakeDb({ org_subscriptions: [subscription({ status: "trialing", plan_key: null, provider_customer_ref: null, provider_subscription_ref: null })] });
        const outcome = await applyBillingEvent(
            db,
            { ...base, type: "checkout_completed", orgId: ORG, planKey: "included", customerRef: "cus_9", subscriptionRef: "sub_9", paid: false },
            ENV,
        );
        expect(outcome).toBe("payment_pending");
        expect(db.tables.org_subscriptions[0]).toMatchObject({
            status: "trialing",
            plan_key: null,
            provider_customer_ref: "cus_9",
            provider_subscription_ref: "sub_9",
        });
    });

    it("does nothing for a checkout that names no workspace, or not a real one", async () => {
        expect(
            await applyBillingEvent(db, { ...base, type: "checkout_completed", orgId: null, planKey: null, customerRef: "cus_1", subscriptionRef: "sub_1", paid: true }, ENV),
        ).toBe("unmatched");
        expect(
            await applyBillingEvent(db, { ...base, type: "checkout_completed", orgId: "not-a-uuid", planKey: null, customerRef: "cus_1", subscriptionRef: "sub_1", paid: true }, ENV),
        ).toBe("unmatched");
        expect(db.writes).toEqual([]);
    });

    it("holds a workspace past due on a failed payment, by subscription or by customer", async () => {
        expect(
            await applyBillingEvent(db, { ...base, type: "payment_failed", customerRef: null, subscriptionRef: "sub_1" }, ENV),
        ).toBe("past_due");
        expect(db.tables.org_subscriptions[0]).toMatchObject({ status: "past_due", plan_key: "included", provider_subscription_ref: "sub_1" });

        db = createFakeDb({ org_subscriptions: [subscription({ provider_subscription_ref: null })] });
        expect(
            await applyBillingEvent(db, { ...base, type: "payment_failed", customerRef: "cus_1", subscriptionRef: "sub_unknown" }, ENV),
        ).toBe("past_due");
        expect(db.tables.org_subscriptions[0].status).toBe("past_due");
    });

    it("leaves a failed payment for an unknown customer alone", async () => {
        expect(
            await applyBillingEvent(db, { ...base, type: "payment_failed", customerRef: "cus_other", subscriptionRef: "sub_other" }, ENV),
        ).toBe("unmatched");
        expect(db.tables.org_subscriptions[0].status).toBe("active");
    });

    it("cancels the workspace onto the unpaid default when its subscription is deleted", async () => {
        const outcome = await applyBillingEvent(
            db,
            { ...base, type: "subscription_deleted", orgId: ORG, customerRef: "cus_1", subscriptionRef: "sub_1" },
            ENV,
        );
        expect(outcome).toBe("canceled");
        expect(db.tables.org_subscriptions[0]).toMatchObject({
            status: "canceled",
            plan_key: null,
            provider_subscription_ref: null,
            current_period_end: null,
            // The customer stays, so the portal (invoices) still opens.
            provider_customer_ref: "cus_1",
        });
        const entitlement = await resolveOrgEntitlement(db, ORG, ENV);
        expect(entitlement.plan).toBeNull();
        expect(entitlement.planKey).toBeNull();
        expect(entitlement.seatLimit).toBeNull();
        expect(entitlement.blocksHostedModels).toBe(true);
    });

    it("ignores the deletion of a subscription the workspace has since replaced", async () => {
        db = createFakeDb({ org_subscriptions: [subscription({ provider_subscription_ref: "sub_2" })] });
        const outcome = await applyBillingEvent(
            db,
            { ...base, type: "subscription_deleted", orgId: ORG, customerRef: "cus_1", subscriptionRef: "sub_1" },
            ENV,
        );
        expect(outcome).toBe("stale");
        expect(db.tables.org_subscriptions[0]).toMatchObject({ status: "active", plan_key: "included", provider_subscription_ref: "sub_2" });
    });

    it("finds a deleted subscription by the workspace stamped on it when no reference was recorded", async () => {
        db = createFakeDb({ org_subscriptions: [subscription({ provider_subscription_ref: null, provider_customer_ref: null })] });
        expect(
            await applyBillingEvent(db, { ...base, type: "subscription_deleted", orgId: ORG, customerRef: "cus_1", subscriptionRef: "sub_1" }, ENV),
        ).toBe("canceled");
        expect(db.tables.org_subscriptions[0].status).toBe("canceled");
        expect(
            await applyBillingEvent(db, { ...base, type: "subscription_deleted", orgId: OTHER_ORG, customerRef: "cus_x", subscriptionRef: "sub_x" }, ENV),
        ).toBe("unmatched");
    });

    it("follows the provider's status report for the current subscription, never the plan", async () => {
        db = createFakeDb({ org_subscriptions: [subscription({ status: "past_due" })] });
        const outcome = await applyBillingEvent(
            db,
            { ...base, type: "subscription_updated", orgId: ORG, customerRef: "cus_1", subscriptionRef: "sub_1", status: "active", currentPeriodEnd: "2027-01-01T00:00:00.000Z", trialEndsAt: null },
            ENV,
        );
        expect(outcome).toBe("synced");
        expect(db.tables.org_subscriptions[0]).toMatchObject({ status: "active", plan_key: "included", current_period_end: "2027-01-01T00:00:00.000Z" });

        expect(
            await applyBillingEvent(db, { ...base, type: "subscription_updated", orgId: ORG, customerRef: "cus_1", subscriptionRef: "sub_1", status: "trialing", currentPeriodEnd: null, trialEndsAt: "2027-02-01T00:00:00.000Z" }, ENV),
        ).toBe("synced");
        expect(db.tables.org_subscriptions[0]).toMatchObject({ status: "trialing", trial_ends_at: "2027-02-01T00:00:00.000Z" });

        expect(
            await applyBillingEvent(db, { ...base, type: "subscription_updated", orgId: ORG, customerRef: "cus_1", subscriptionRef: "sub_1", status: null, currentPeriodEnd: null, trialEndsAt: null }, ENV),
        ).toBe("ignored");
    });

    it("cancels on a canceled status report", async () => {
        expect(
            await applyBillingEvent(db, { ...base, type: "subscription_updated", orgId: ORG, customerRef: "cus_1", subscriptionRef: "sub_1", status: "canceled", currentPeriodEnd: null, trialEndsAt: null }, ENV),
        ).toBe("canceled");
        expect(db.tables.org_subscriptions[0]).toMatchObject({ status: "canceled", plan_key: null });
    });

    it("never puts a canceled workspace back on a plan from a late status report", async () => {
        await applyBillingEvent(db, { ...base, type: "subscription_deleted", orgId: ORG, customerRef: "cus_1", subscriptionRef: "sub_1" }, ENV);
        const outcome = await applyBillingEvent(
            db,
            { ...base, id: "evt_late", type: "subscription_updated", orgId: ORG, customerRef: "cus_1", subscriptionRef: "sub_1", status: "active", currentPeriodEnd: "2027-01-01T00:00:00.000Z", trialEndsAt: null },
            ENV,
        );
        expect(outcome).toBe("unmatched");
        expect(db.tables.org_subscriptions[0]).toMatchObject({ status: "canceled", plan_key: null, provider_subscription_ref: null });
        expect((await resolveOrgEntitlement(db, ORG, ENV)).blocksHostedModels).toBe(true);
    });

    it("ignores an event type it does not act on", async () => {
        expect(await applyBillingEvent(db, { ...base, type: "ignored" }, ENV)).toBe("ignored");
        expect(db.writes).toEqual([]);
    });
});

describe("handleBillingWebhook", () => {
    const provider = createFakeBillingProvider({ webhookSecret: SECRET });
    const NOW = new Date("2026-11-08T12:00:00Z");
    let db: FakeDb;

    const failedInvoice = (id: string) =>
        Buffer.from(
            JSON.stringify({ id, type: "invoice.payment_failed", data: { object: { customer: "cus_1", subscription: "sub_1" } } }),
        );
    const deliver = (payload: Buffer, over: { signature?: string; now?: Date; env?: NodeJS.ProcessEnv } = {}) =>
        handleBillingWebhook(db, {
            payload,
            signature: over.signature ?? provider.sign(payload, over.now ?? NOW),
            env: over.env ?? ENV,
            provider,
            now: over.now ?? NOW,
        });

    beforeEach(() => {
        db = createFakeDb({ org_subscriptions: [subscription()] });
    });
    afterEach(() => {
        db.failWrites.clear();
    });

    it("answers not_found with billing off, before reading the body", async () => {
        const result = await deliver(failedInvoice("evt_1"), { env: { ...ENV, BILLING_ENABLED: "false" } });
        expect(result).toMatchObject({ ok: false, kind: "not_found" });
        expect(db.writes).toEqual([]);
    });

    it("refuses a missing body and a bad signature without touching the ledger", async () => {
        expect(await handleBillingWebhook(db, { payload: null, signature: undefined, env: ENV, provider, now: NOW })).toMatchObject({ ok: false, kind: "validation" });
        const payload = failedInvoice("evt_1");
        expect(await deliver(payload, { signature: "t=1,v1=" + "0".repeat(64) })).toMatchObject({ ok: false, kind: "validation" });
        expect(
            await handleBillingWebhook(db, { payload, signature: undefined, env: ENV, provider, now: NOW }),
        ).toMatchObject({ ok: false, kind: "validation" });
        expect(db.tables.billing_events ?? []).toEqual([]);
        expect(db.tables.org_subscriptions[0].status).toBe("active");
    });

    it("applies a signed event once and answers a redelivery as a duplicate", async () => {
        const payload = failedInvoice("evt_1");
        expect(await deliver(payload)).toEqual({ ok: true, data: { received: true, duplicate: false, outcome: "past_due" } });
        expect(db.tables.billing_events[0]).toMatchObject({ event_id: "evt_1", type: "invoice.payment_failed" });
        expect(db.tables.billing_events[0].processed_at).toBeTruthy();

        // The workspace recovers; the same event again must not hold it again.
        db.tables.org_subscriptions[0].status = "active";
        const subscriptionWrites = () =>
            db.writes.filter((write) => write.table === "org_subscriptions").length;
        const writesBefore = subscriptionWrites();
        expect(await deliver(payload)).toEqual({ ok: true, data: { received: true, duplicate: true, outcome: null } });
        expect(db.tables.org_subscriptions[0].status).toBe("active");
        expect(subscriptionWrites()).toBe(writesBefore);
    });

    it("asks the provider to retry while another delivery of the event is in flight, and takes over an abandoned one", async () => {
        const payload = failedInvoice("evt_2");
        db.tables.billing_events = [{ event_id: "evt_2", type: "invoice.payment_failed", received_at: new Date(NOW.getTime() - 60_000).toISOString(), processed_at: null }];
        expect(await deliver(payload)).toMatchObject({ ok: false, kind: "conflict" });
        expect(db.tables.org_subscriptions[0].status).toBe("active");

        db.tables.billing_events[0].received_at = new Date(NOW.getTime() - 10 * 60_000).toISOString();
        expect(await deliver(payload)).toEqual({ ok: true, data: { received: true, duplicate: false, outcome: "past_due" } });
        expect(db.tables.billing_events[0].processed_at).toBeTruthy();
    });

    it("releases the claim when applying fails, so the provider's retry is applied", async () => {
        const payload = failedInvoice("evt_3");
        db.failWrites.add("org_subscriptions");
        expect(await deliver(payload)).toMatchObject({ ok: false, kind: "error" });
        expect(db.tables.billing_events).toEqual([]);

        db.failWrites.clear();
        expect(await deliver(payload)).toMatchObject({ ok: true, data: { duplicate: false, outcome: "past_due" } });
        expect(db.tables.org_subscriptions[0].status).toBe("past_due");
    });

    it("records an event type it does not act on", async () => {
        const payload = Buffer.from(JSON.stringify({ id: "evt_4", type: "customer.created", data: { object: { id: "cus_1" } } }));
        expect(await deliver(payload)).toEqual({ ok: true, data: { received: true, duplicate: false, outcome: "ignored" } });
        expect(db.tables.billing_events[0]).toMatchObject({ event_id: "evt_4", type: "customer.created" });
    });

    it("rejects a replayed delivery whose timestamp is stale", async () => {
        const payload = failedInvoice("evt_5");
        const stale = provider.sign(payload, new Date(NOW.getTime() - 3_600_000));
        expect(await deliver(payload, { signature: stale })).toMatchObject({ ok: false, kind: "validation" });
    });

    it("is driven by normalized events the fake provider parses from the wire format", () => {
        const payload = failedInvoice("evt_6");
        const parsed: BillingEvent = provider.parseWebhookEvent(payload, provider.sign(payload, NOW), NOW);
        expect(parsed).toMatchObject({ id: "evt_6", providerType: "invoice.payment_failed", type: "payment_failed" });
    });
});
