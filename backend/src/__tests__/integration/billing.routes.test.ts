// SPDX-License-Identifier: AGPL-3.0-only
//
// The billing surface over HTTP. With BILLING_ENABLED unset every route is a
// 404 and no provider is ever constructed; with it set (and the fake
// provider installed) owners get hosted sessions, everyone else is refused,
// and the webhook applies signed deliveries to the subscription exactly once.
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../helpers/fakeBillingDb";
// vi.mock calls are hoisted above these imports, so the router and the
// facade below see the mocked auth, database and adapter constructor.
import {
    billingRouter,
    billingWebhookHandler,
} from "../../modules/billing/billing.routes";
import {
    createFakeBillingProvider,
    setBillingProviderForTests,
} from "../../modules/billing/billing.service";
import { BillingProviderError } from "../../modules/billing/billing.provider";
import { resolveOrgEntitlement } from "../../lib/entitlements";

const holder = vi.hoisted(() => ({ fake: null as FakeDb | null }));

const stripeConstructor = vi.hoisted(() => vi.fn());

// Sign in whoever x-test-user names; no header, no session.
vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        req: { get(name: string): string | undefined },
        res: {
            locals: Record<string, unknown>;
            status(code: number): { json(body: unknown): void };
        },
        next: () => void,
    ) => {
        const user = req.get("x-test-user");
        if (!user) {
            res.status(401).json({ detail: "Invalid or expired session" });
            return;
        }
        res.locals.userId = user;
        res.locals.userEmail = `${user.slice(-4)}@firm.example`;
        next();
    },
}));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => {
        if (!holder.fake) throw new Error("fake db not set");
        return holder.fake;
    },
}));

// The real adapter's constructor is replaced by a spy that fails loudly: the
// tests below either run with billing off (it must never be reached) or with
// the fake provider installed (it must not be needed).
vi.mock("../../modules/billing/billing.stripe", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/billing/billing.stripe")>()),
    createStripeBillingProvider: stripeConstructor,
}));

const ORG = "00000000-0000-4000-8000-000000000010";
const PERSONAL = "00000000-0000-4000-8000-000000000011";
const OWNER = "00000000-0000-4000-8000-00000000a001";
const MEMBER = "00000000-0000-4000-8000-00000000a002";
const STRANGER = "00000000-0000-4000-8000-00000000a003";
const SECRET = "whsec_test_placeholder";

const CATALOG = JSON.stringify([
    {
        key: "included",
        name: "Included AI",
        description: "A pooled allowance.",
        seat_limit: 25,
        features: [],
        deployment_token_allowance: 1_000_000,
        trial_days: 14,
        public: true,
        sort_order: 1,
        display_price_text: "$0 placeholder",
        provider_price_ref: "price_placeholder",
    },
    {
        key: "manual",
        name: "Arranged separately",
        description: "",
        features: [],
        public: true,
        sort_order: 2,
        display_price_text: "",
        provider_price_ref: null,
    },
    {
        key: "internal",
        name: "Internal",
        description: "",
        features: [],
        public: false,
        sort_order: 99,
        display_price_text: "",
        provider_price_ref: "price_internal",
    },
]);

const BILLING_ENV = {
    BILLING_ENABLED: "true",
    BILLING_PROVIDER: "fake",
    STRIPE_WEBHOOK_SECRET: SECRET,
    PLANS_ENABLED: "true",
    PLANS_CATALOG_JSON: CATALOG,
    FRONTEND_URL: "https://app.example.test",
} as const;

const ENV_KEYS = [
    "BILLING_ENABLED",
    "BILLING_PROVIDER",
    "BILLING_ALLOW_LIVE",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "PLANS_ENABLED",
    "PLANS_CATALOG_JSON",
    "FRONTEND_URL",
] as const;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function buildApp() {
    const app = express();
    // Mirrors app.ts: the webhook takes the raw body ahead of the JSON parser.
    app.post("/billing/webhook", express.raw({ type: () => true, limit: "1mb" }), billingWebhookHandler);
    app.use(express.json());
    app.use("/billing", billingRouter);
    return app;
}

function fakeDb(subscription: Record<string, unknown> | null = {}): FakeDb {
    return createFakeDb({
        organizations: [
            { id: ORG, name: "Firm", kind: "team" },
            { id: PERSONAL, name: "Personal", kind: "personal" },
        ],
        org_members: [
            { org_id: ORG, user_id: OWNER, role: "owner" },
            { org_id: ORG, user_id: MEMBER, role: "member" },
            { org_id: PERSONAL, user_id: OWNER, role: "owner" },
        ],
        org_subscriptions:
            subscription === null
                ? []
                : [
                      {
                          org_id: ORG,
                          plan_key: null,
                          status: "trialing",
                          seat_limit: null,
                          trial_ends_at: "2026-11-30T00:00:00.000Z",
                          current_period_end: null,
                          provider_customer_ref: null,
                          provider_subscription_ref: null,
                          ...subscription,
                      },
                  ],
        audit_events: [],
    });
}

function signed(provider: ReturnType<typeof createFakeBillingProvider>, body: unknown) {
    const payload = JSON.stringify(body);
    return { payload, signature: provider.sign(payload) };
}

beforeEach(() => {
    stripeConstructor.mockReset();
    stripeConstructor.mockImplementation(() => {
        throw new Error("the real provider must not be constructed in these tests");
    });
    holder.fake = fakeDb();
    setBillingProviderForTests(null);
});
afterEach(() => {
    setEnv({});
    holder.fake = null;
    setBillingProviderForTests(null);
});

describe("with BILLING_ENABLED unset", () => {
    beforeEach(() => setEnv({ PLANS_ENABLED: "true", PLANS_CATALOG_JSON: CATALOG }));

    it("answers 404 on every billing route, signed in or not, and constructs no provider", async () => {
        const app = buildApp();
        await request(app).post(`/billing/orgs/${ORG}/checkout-session`).send({ plan_key: "included" }).expect(404);
        await request(app)
            .post(`/billing/orgs/${ORG}/checkout-session`)
            .set("x-test-user", OWNER)
            .send({ plan_key: "included" })
            .expect(404);
        await request(app).post(`/billing/orgs/${ORG}/portal-session`).set("x-test-user", OWNER).expect(404);
        await request(app)
            .post("/billing/webhook")
            .set("Content-Type", "application/json")
            .set("Stripe-Signature", "t=1,v1=" + "0".repeat(64))
            .send(JSON.stringify({ id: "evt_1", type: "invoice.payment_failed", data: { object: {} } }))
            .expect(404);
        await request(app).get(`/billing/orgs/${ORG}/plan`).expect(404);
        expect(stripeConstructor).not.toHaveBeenCalled();
        expect(holder.fake!.writes).toEqual([]);
    });

    it("stays off for any value other than exactly true", async () => {
        setEnv({ BILLING_ENABLED: "1", PLANS_ENABLED: "true", PLANS_CATALOG_JSON: CATALOG });
        await request(buildApp())
            .post(`/billing/orgs/${ORG}/checkout-session`)
            .set("x-test-user", OWNER)
            .send({ plan_key: "included" })
            .expect(404);
        expect(stripeConstructor).not.toHaveBeenCalled();
    });
});

describe("checkout and portal sessions", () => {
    let provider: ReturnType<typeof createFakeBillingProvider>;
    beforeEach(() => {
        setEnv(BILLING_ENV);
        provider = createFakeBillingProvider({ webhookSecret: SECRET });
        setBillingProviderForTests(provider);
    });

    it("requires a session once billing is on", async () => {
        await request(buildApp()).post(`/billing/orgs/${ORG}/checkout-session`).send({ plan_key: "included" }).expect(401);
    });

    it("gives an owner a checkout for a plan on offer and records it in the audit trail", async () => {
        const res = await request(buildApp())
            .post(`/billing/orgs/${ORG}/checkout-session`)
            .set("x-test-user", OWNER)
            .send({ plan_key: "included" })
            .expect(200);
        expect(res.body).toEqual({ url: "https://billing.invalid/checkout/1" });
        expect(provider.calls).toHaveLength(1);
        expect(provider.calls[0]).toMatchObject({
            kind: "checkout",
            input: {
                orgId: ORG,
                planKey: "included",
                priceRef: "price_placeholder",
                customerRef: null,
                customerEmail: "a001@firm.example",
                successUrl: `https://app.example.test/organizations/${ORG}/settings/plan?checkout=success`,
                cancelUrl: `https://app.example.test/organizations/${ORG}/settings/plan?checkout=canceled`,
            },
        });
        expect(holder.fake!.tables.audit_events[0]).toMatchObject({
            user_id: OWNER,
            org_id: ORG,
            action: "billing.checkout_started",
            detail: { plan_key: "included" },
        });
        // Nothing is written to the subscription until the provider confirms.
        expect(holder.fake!.writes.filter((w) => w.table === "org_subscriptions")).toEqual([]);
        expect(stripeConstructor).not.toHaveBeenCalled();
    });

    it("refuses a member, a stranger and a personal workspace", async () => {
        const app = buildApp();
        const member = await request(app)
            .post(`/billing/orgs/${ORG}/checkout-session`)
            .set("x-test-user", MEMBER)
            .send({ plan_key: "included" })
            .expect(403);
        expect(member.body.detail).toMatch(/owner/);
        await request(app)
            .post(`/billing/orgs/${ORG}/checkout-session`)
            .set("x-test-user", STRANGER)
            .send({ plan_key: "included" })
            .expect(404);
        await request(app)
            .post(`/billing/orgs/${PERSONAL}/checkout-session`)
            .set("x-test-user", OWNER)
            .send({ plan_key: "included" })
            .expect(404);
        await request(app)
            .post(`/billing/orgs/not-a-uuid/checkout-session`)
            .set("x-test-user", OWNER)
            .send({ plan_key: "included" })
            .expect(404);
        expect(provider.calls).toEqual([]);
    });

    it("refuses a plan that is not on offer, has no provider price, or is missing", async () => {
        const app = buildApp();
        for (const body of [{ plan_key: "internal" }, { plan_key: "manual" }, { plan_key: "nope" }, {}]) {
            await request(app)
                .post(`/billing/orgs/${ORG}/checkout-session`)
                .set("x-test-user", OWNER)
                .send(body)
                .expect(400);
        }
        expect(provider.calls).toEqual([]);
    });

    it("refuses a second checkout while a subscription is live", async () => {
        holder.fake = fakeDb({ status: "active", plan_key: "included", provider_customer_ref: "cus_1", provider_subscription_ref: "sub_1" });
        const res = await request(buildApp())
            .post(`/billing/orgs/${ORG}/checkout-session`)
            .set("x-test-user", OWNER)
            .send({ plan_key: "included" })
            .expect(409);
        expect(res.body.detail).toMatch(/Manage billing/);
        expect(provider.calls).toEqual([]);
    });

    it("refuses a checkout while plans are off, even with billing on", async () => {
        setEnv({ ...BILLING_ENV, PLANS_ENABLED: undefined });
        await request(buildApp())
            .post(`/billing/orgs/${ORG}/checkout-session`)
            .set("x-test-user", OWNER)
            .send({ plan_key: "included" })
            .expect(409);
    });

    it("opens the portal only once a customer exists, and returns to the plan page", async () => {
        const app = buildApp();
        const none = await request(app).post(`/billing/orgs/${ORG}/portal-session`).set("x-test-user", OWNER).expect(409);
        expect(none.body.detail).toMatch(/no billing account yet/);

        holder.fake = fakeDb({ provider_customer_ref: "cus_1" });
        const res = await request(app).post(`/billing/orgs/${ORG}/portal-session`).set("x-test-user", OWNER).expect(200);
        expect(res.body).toEqual({ url: "https://billing.invalid/portal/1" });
        expect(provider.calls[0]).toMatchObject({
            kind: "portal",
            input: { customerRef: "cus_1", returnUrl: `https://app.example.test/organizations/${ORG}/settings/plan` },
        });
        await request(app).post(`/billing/orgs/${ORG}/portal-session`).set("x-test-user", MEMBER).expect(403);
    });

    it("answers 503 when the provider cannot be constructed from the configuration", async () => {
        setBillingProviderForTests(null);
        setEnv({ ...BILLING_ENV, BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: "" });
        holder.fake = fakeDb({ provider_customer_ref: "cus_1" });
        stripeConstructor.mockImplementation(() => {
            throw new BillingProviderError("Billing provider key is not configured");
        });
        await request(buildApp())
            .post(`/billing/orgs/${ORG}/portal-session`)
            .set("x-test-user", OWNER)
            .expect(503);
        expect(stripeConstructor).toHaveBeenCalledTimes(1);
    });
});

describe("POST /billing/webhook", () => {
    let provider: ReturnType<typeof createFakeBillingProvider>;
    beforeEach(() => {
        setEnv(BILLING_ENV);
        provider = createFakeBillingProvider({ webhookSecret: SECRET });
        setBillingProviderForTests(provider);
    });

    const post = (payload: string, signature?: string) => {
        const req = request(buildApp()).post("/billing/webhook").set("Content-Type", "application/json");
        return (signature ? req.set("Stripe-Signature", signature) : req).send(payload);
    };

    it("answers 400 to an invalid signature and to an unsigned delivery, applying nothing", async () => {
        const { payload } = signed(provider, {
            id: "evt_1",
            type: "invoice.payment_failed",
            data: { object: { customer: "cus_1", subscription: "sub_1" } },
        });
        const bad = await post(payload, "t=1700000000,v1=" + "0".repeat(64)).expect(400);
        expect(bad.body.detail).toBe("Invalid signature.");
        await post(payload).expect(400);
        const tampered = await post(payload.replace("sub_1", "sub_2"), provider.sign(payload)).expect(400);
        expect(tampered.body.detail).toBe("Invalid signature.");
        expect(holder.fake!.tables.billing_events ?? []).toEqual([]);
        expect(holder.fake!.tables.org_subscriptions[0].status).toBe("trialing");
    });

    it("answers 400 to an empty body", async () => {
        await request(buildApp()).post("/billing/webhook").set("Stripe-Signature", "t=1,v1=00").expect(400);
    });

    it("sets past_due on a payment failure and answers a duplicate event id with 200 without reprocessing", async () => {
        holder.fake = fakeDb({ status: "active", plan_key: "included", provider_customer_ref: "cus_1", provider_subscription_ref: "sub_1" });
        const { payload, signature } = signed(provider, {
            id: "evt_pf_1",
            type: "invoice.payment_failed",
            data: { object: { object: "invoice", customer: "cus_1", subscription: "sub_1" } },
        });
        const first = await post(payload, signature).expect(200);
        expect(first.body).toEqual({ received: true, duplicate: false, outcome: "past_due" });
        expect(holder.fake!.tables.org_subscriptions[0]).toMatchObject({ status: "past_due", plan_key: "included" });

        // The customer pays; a redelivery of the old failure must not hold them again.
        holder.fake!.tables.org_subscriptions[0].status = "active";
        const subscriptionWrites = () =>
            holder.fake!.writes.filter((write) => write.table === "org_subscriptions").length;
        const writes = subscriptionWrites();
        const again = await post(payload, provider.sign(payload)).expect(200);
        expect(again.body).toEqual({ received: true, duplicate: true, outcome: null });
        expect(holder.fake!.tables.org_subscriptions[0].status).toBe("active");
        expect(subscriptionWrites()).toBe(writes);
    });

    it("sets canceled on a subscription deletion and the entitlement falls back to the unpaid default", async () => {
        holder.fake = fakeDb({ status: "active", plan_key: "included", provider_customer_ref: "cus_1", provider_subscription_ref: "sub_1", current_period_end: "2026-12-01T00:00:00.000Z" });
        const { payload, signature } = signed(provider, {
            id: "evt_del_1",
            type: "customer.subscription.deleted",
            data: { object: { object: "subscription", id: "sub_1", customer: "cus_1", status: "canceled", metadata: { org_id: ORG } } },
        });
        const res = await post(payload, signature).expect(200);
        expect(res.body).toEqual({ received: true, duplicate: false, outcome: "canceled" });
        expect(holder.fake!.tables.org_subscriptions[0]).toMatchObject({
            status: "canceled",
            plan_key: null,
            provider_subscription_ref: null,
            current_period_end: null,
            provider_customer_ref: "cus_1",
        });
        const entitlement = await resolveOrgEntitlement(holder.fake!, ORG, process.env);
        expect(entitlement.plan).toBeNull();
        expect(entitlement.seatLimit).toBeNull();
        expect(entitlement.deploymentTokenAllowance).toBeNull();
        expect(entitlement.blocksHostedModels).toBe(true);
    });

    it("activates the workspace on a completed checkout", async () => {
        const { payload, signature } = signed(provider, {
            id: "evt_cs_1",
            type: "checkout.session.completed",
            data: {
                object: {
                    object: "checkout.session",
                    mode: "subscription",
                    payment_status: "paid",
                    client_reference_id: ORG,
                    customer: "cus_1",
                    subscription: "sub_1",
                    metadata: { org_id: ORG, plan_key: "included" },
                },
            },
        });
        const res = await post(payload, signature).expect(200);
        expect(res.body.outcome).toBe("activated");
        expect(holder.fake!.tables.org_subscriptions[0]).toMatchObject({
            status: "active",
            plan_key: "included",
            provider_customer_ref: "cus_1",
            provider_subscription_ref: "sub_1",
            trial_ends_at: null,
        });
        const entitlement = await resolveOrgEntitlement(holder.fake!, ORG, process.env);
        expect(entitlement.plan?.key).toBe("included");
        expect(entitlement.seatLimit).toBe(25);
        expect(entitlement.blocksHostedModels).toBe(false);
    });

    it("records an event it does not act on and answers 200", async () => {
        const { payload, signature } = signed(provider, { id: "evt_x", type: "customer.created", data: { object: { id: "cus_1" } } });
        const res = await post(payload, signature).expect(200);
        expect(res.body).toEqual({ received: true, duplicate: false, outcome: "ignored" });
        expect(holder.fake!.tables.billing_events[0]).toMatchObject({ event_id: "evt_x", type: "customer.created" });
    });

    it("never constructs the real provider while the fake is installed", () => {
        expect(stripeConstructor).not.toHaveBeenCalled();
    });
});
