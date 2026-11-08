// SPDX-License-Identifier: AGPL-3.0-only
//
// The subscription writes the billing module makes through entitlements:
// what each helper puts on the row, that every write is an upsert on org_id
// (so an organization without a row gets one), and how a provider event's
// references find their workspace.
import { describe, expect, it } from "vitest";
import { createFakeDb } from "../../__tests__/helpers/fakeBillingDb";
import {
    activateSubscription,
    cancelSubscription,
    findSubscriptionByProviderRef,
    markSubscriptionPastDue,
    readSubscriptionRefs,
    recordSubscriptionRefs,
    syncSubscriptionStatus,
} from "../entitlements";

const ORG = "00000000-0000-4000-8000-000000000010";
const OTHER = "00000000-0000-4000-8000-000000000011";

const row = (over: Record<string, unknown> = {}) => ({
    org_id: ORG,
    plan_key: "included",
    status: "active",
    seat_limit: 3,
    trial_ends_at: null,
    current_period_end: "2026-12-01T00:00:00.000Z",
    provider_customer_ref: "cus_1",
    provider_subscription_ref: "sub_1",
    ...over,
});

describe("readSubscriptionRefs and findSubscriptionByProviderRef", () => {
    it("reads the provider-facing facts, or null for no row", async () => {
        const db = createFakeDb({ org_subscriptions: [row()] });
        expect(await readSubscriptionRefs(db, ORG)).toEqual({
            orgId: ORG,
            status: "active",
            planKey: "included",
            customerRef: "cus_1",
            subscriptionRef: "sub_1",
        });
        expect(await readSubscriptionRefs(db, OTHER)).toBeNull();
    });

    it("matches the subscription id first, then the customer id, else nothing", async () => {
        const db = createFakeDb({
            org_subscriptions: [row(), row({ org_id: OTHER, provider_customer_ref: "cus_2", provider_subscription_ref: "sub_2" })],
        });
        expect((await findSubscriptionByProviderRef(db, { subscriptionRef: "sub_2", customerRef: "cus_1" }))?.orgId).toBe(OTHER);
        expect((await findSubscriptionByProviderRef(db, { subscriptionRef: "sub_none", customerRef: "cus_1" }))?.orgId).toBe(ORG);
        expect(await findSubscriptionByProviderRef(db, { subscriptionRef: "sub_none", customerRef: "cus_none" })).toBeNull();
        expect(await findSubscriptionByProviderRef(db, {})).toBeNull();
        expect(await findSubscriptionByProviderRef(db, { subscriptionRef: null, customerRef: null })).toBeNull();
    });
});

describe("subscription writes", () => {
    it("activates with the plan and references, clearing the trial, as an upsert on org_id", async () => {
        const db = createFakeDb({ org_subscriptions: [] });
        await activateSubscription(db, {
            orgId: ORG,
            planKey: "included",
            customerRef: "cus_1",
            subscriptionRef: "sub_1",
            currentPeriodEnd: "2026-12-01T00:00:00.000Z",
        });
        expect(db.writes).toEqual([
            {
                table: "org_subscriptions",
                op: "upsert",
                payload: {
                    org_id: ORG,
                    status: "active",
                    plan_key: "included",
                    provider_customer_ref: "cus_1",
                    provider_subscription_ref: "sub_1",
                    current_period_end: "2026-12-01T00:00:00.000Z",
                    trial_ends_at: null,
                },
            },
        ]);
        expect(db.tables.org_subscriptions).toHaveLength(1);
    });

    it("keeps the row's plan and references when a checkout carries none", async () => {
        const db = createFakeDb({ org_subscriptions: [row({ status: "past_due" })] });
        await activateSubscription(db, { orgId: ORG, planKey: null, customerRef: null, subscriptionRef: null, currentPeriodEnd: null });
        expect(db.tables.org_subscriptions[0]).toMatchObject({
            status: "active",
            plan_key: "included",
            provider_customer_ref: "cus_1",
            provider_subscription_ref: "sub_1",
        });
    });

    it("marks past due without touching the plan or the references", async () => {
        const db = createFakeDb({ org_subscriptions: [row()] });
        await markSubscriptionPastDue(db, ORG);
        expect(db.writes[0]).toEqual({ table: "org_subscriptions", op: "upsert", payload: { org_id: ORG, status: "past_due" } });
        expect(db.tables.org_subscriptions[0]).toMatchObject(row({ status: "past_due" }));
    });

    it("cancels onto the unpaid default, keeping only the customer", async () => {
        const db = createFakeDb({ org_subscriptions: [row()] });
        await cancelSubscription(db, ORG);
        expect(db.tables.org_subscriptions[0]).toEqual(
            row({
                status: "canceled",
                plan_key: null,
                provider_subscription_ref: null,
                current_period_end: null,
                trial_ends_at: null,
            }),
        );
    });

    it("syncs status and dates, and the plan only when the caller resolved one", async () => {
        const db = createFakeDb({ org_subscriptions: [row({ status: "past_due" })] });
        await syncSubscriptionStatus(db, ORG, { status: "active", currentPeriodEnd: "2027-01-01T00:00:00.000Z" });
        expect(db.writes[0]).toEqual({
            table: "org_subscriptions",
            op: "upsert",
            payload: { org_id: ORG, status: "active", current_period_end: "2027-01-01T00:00:00.000Z" },
        });
        await syncSubscriptionStatus(db, ORG, { status: "trialing", currentPeriodEnd: null, trialEndsAt: "2027-02-01T00:00:00.000Z" });
        expect(db.tables.org_subscriptions[0]).toMatchObject({
            status: "trialing",
            plan_key: "included",
            current_period_end: null,
            trial_ends_at: "2027-02-01T00:00:00.000Z",
        });
        // A plan switch the caller matched against the catalog.
        await syncSubscriptionStatus(db, ORG, { status: "active", currentPeriodEnd: "2027-03-01T00:00:00.000Z", planKey: "team" });
        expect(db.tables.org_subscriptions[0]).toMatchObject({ status: "active", plan_key: "team" });
        await syncSubscriptionStatus(db, ORG, { status: "active", currentPeriodEnd: "2027-03-01T00:00:00.000Z", planKey: null });
        expect(db.tables.org_subscriptions[0].plan_key).toBe("team");
    });

    it("records references, and the plan bought, without touching the status; writes nothing when there are none", async () => {
        const db = createFakeDb({ org_subscriptions: [row({ status: "trialing", plan_key: null, provider_customer_ref: null, provider_subscription_ref: null })] });
        await recordSubscriptionRefs(db, ORG, { customerRef: null, subscriptionRef: null });
        await recordSubscriptionRefs(db, ORG, { customerRef: null, subscriptionRef: null, planKey: null });
        expect(db.writes).toEqual([]);
        await recordSubscriptionRefs(db, ORG, { customerRef: "cus_9", subscriptionRef: null });
        expect(db.tables.org_subscriptions[0]).toMatchObject({ status: "trialing", plan_key: null, provider_customer_ref: "cus_9", provider_subscription_ref: null });
        await recordSubscriptionRefs(db, ORG, { customerRef: "cus_9", subscriptionRef: "sub_9", planKey: "included" });
        expect(db.tables.org_subscriptions[0]).toMatchObject({ status: "trialing", plan_key: "included", provider_customer_ref: "cus_9", provider_subscription_ref: "sub_9" });
    });

    it("surfaces a database error instead of swallowing it", async () => {
        const db = createFakeDb({ org_subscriptions: [row()] });
        db.failWrites.add("org_subscriptions");
        await expect(markSubscriptionPastDue(db, ORG)).rejects.toMatchObject({ code: "XX000" });
    });
});
