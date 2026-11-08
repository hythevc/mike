// SPDX-License-Identifier: AGPL-3.0-only
//
// The Stripe adapter without Stripe: form encoding, the signature scheme,
// event normalization across API-version shapes, and the REST calls against
// a stubbed fetch. No request leaves the process.
import { describe, expect, it, vi } from "vitest";
import {
    BillingProviderError,
    BillingSignatureError,
} from "../billing.provider";
import {
    SIGNATURE_TOLERANCE_SECONDS,
    createStripeBillingProvider,
    encodeForm,
    mapStripeSubscriptionStatus,
    normalizeStripeEvent,
    parseSignatureHeader,
    parseStripeWebhook,
    signStripePayload,
    stripeSignatureHeader,
    verifyStripeSignature,
} from "../billing.stripe";

const SECRET = "whsec_test_placeholder";
const ORG = "00000000-0000-4000-8000-000000000010";
const NOW = new Date("2026-11-08T12:00:00Z");

function event(type: string, object: Record<string, unknown>, id = "evt_test_1"): string {
    return JSON.stringify({ id, object: "event", type, data: { object } });
}

describe("encodeForm", () => {
    it("writes nested keys in brackets and arrays by index, skipping null and undefined", () => {
        const encoded = encodeForm({
            mode: "subscription",
            line_items: [{ price: "price_placeholder", quantity: 1 }],
            metadata: { org_id: ORG, empty: null },
            customer: undefined,
            allow: true,
        });
        expect(decodeURIComponent(encoded).split("&")).toEqual([
            "mode=subscription",
            "line_items[0][price]=price_placeholder",
            "line_items[0][quantity]=1",
            `metadata[org_id]=${ORG}`,
            "allow=true",
        ]);
        // Brackets are percent-encoded, as the form encoding requires.
        expect(encoded).toContain("line_items%5B0%5D%5Bprice%5D=price_placeholder");
    });
});

describe("signatures", () => {
    const payload = Buffer.from(event("invoice.payment_failed", { customer: "cus_1" }));

    it("parses the header and ignores other schemes", () => {
        expect(parseSignatureHeader(`t=1700000000,v1=${"a".repeat(64)},v0=junk`)).toEqual({
            timestamp: 1700000000,
            signatures: ["a".repeat(64)],
        });
        expect(parseSignatureHeader("t=abc,v1=zz")).toBeNull();
        expect(parseSignatureHeader("v1=" + "a".repeat(64))).toBeNull();
        expect(parseSignatureHeader("")).toBeNull();
    });

    it("accepts a delivery signed with the secret within the tolerance", () => {
        const header = stripeSignatureHeader(payload, SECRET, NOW);
        expect(() =>
            verifyStripeSignature({ payload, header, secret: SECRET, now: NOW }),
        ).not.toThrow();
        // Any one matching v1 is enough: the provider sends two while a
        // secret is being rotated.
        const timestamp = Math.floor(NOW.getTime() / 1000);
        const rotated = `t=${timestamp},v1=${"0".repeat(64)},v1=${signStripePayload(payload, SECRET, timestamp)}`;
        expect(() =>
            verifyStripeSignature({ payload, header: rotated, secret: SECRET, now: NOW }),
        ).not.toThrow();
    });

    it("refuses a tampered payload, another secret, a missing or malformed header", () => {
        const header = stripeSignatureHeader(payload, SECRET, NOW);
        const tampered = Buffer.from(payload.toString().replace("cus_1", "cus_2"));
        expect(() =>
            verifyStripeSignature({ payload: tampered, header, secret: SECRET, now: NOW }),
        ).toThrow(BillingSignatureError);
        expect(() =>
            verifyStripeSignature({ payload, header, secret: "whsec_other", now: NOW }),
        ).toThrow(BillingSignatureError);
        expect(() =>
            verifyStripeSignature({ payload, header: undefined, secret: SECRET, now: NOW }),
        ).toThrow(/Missing signature header/);
        expect(() =>
            verifyStripeSignature({ payload, header: "nonsense", secret: SECRET, now: NOW }),
        ).toThrow(/Malformed signature header/);
        expect(() =>
            verifyStripeSignature({ payload, header, secret: "", now: NOW }),
        ).toThrow(/not configured/);
    });

    it("refuses a replay outside the tolerance window", () => {
        const header = stripeSignatureHeader(payload, SECRET, NOW);
        const later = new Date(NOW.getTime() + (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000);
        expect(() =>
            verifyStripeSignature({ payload, header, secret: SECRET, now: later }),
        ).toThrow(/tolerance/);
        const withinWindow = new Date(NOW.getTime() + (SIGNATURE_TOLERANCE_SECONDS - 1) * 1000);
        expect(() =>
            verifyStripeSignature({ payload, header, secret: SECRET, now: withinWindow }),
        ).not.toThrow();
    });

    it("parses a verified delivery and rejects a body that is not an event", () => {
        const parsed = parseStripeWebhook({
            payload,
            header: stripeSignatureHeader(payload, SECRET, NOW),
            secret: SECRET,
            now: NOW,
        });
        expect(parsed.type).toBe("payment_failed");
        const junk = Buffer.from("not json");
        expect(() =>
            parseStripeWebhook({
                payload: junk,
                header: stripeSignatureHeader(junk, SECRET, NOW),
                secret: SECRET,
                now: NOW,
            }),
        ).toThrow(/Malformed event payload/);
    });
});

describe("normalizeStripeEvent", () => {
    it("reads a completed subscription checkout, with expanded references", () => {
        const normalized = normalizeStripeEvent(
            JSON.parse(
                event("checkout.session.completed", {
                    mode: "subscription",
                    payment_status: "paid",
                    client_reference_id: ORG,
                    customer: { id: "cus_1", object: "customer" },
                    subscription: "sub_1",
                    metadata: { org_id: ORG, plan_key: "included" },
                }),
            ),
        );
        expect(normalized).toEqual({
            id: "evt_test_1",
            providerType: "checkout.session.completed",
            type: "checkout_completed",
            orgId: ORG,
            planKey: "included",
            customerRef: "cus_1",
            subscriptionRef: "sub_1",
            paid: true,
        });
    });

    it("falls back to client_reference_id, treats no-payment-required as paid and unpaid as pending", () => {
        const base = { mode: "subscription", client_reference_id: ORG, customer: "cus_1" };
        const trial = normalizeStripeEvent(
            JSON.parse(event("checkout.session.completed", { ...base, payment_status: "no_payment_required" })),
        );
        expect(trial).toMatchObject({ type: "checkout_completed", orgId: ORG, planKey: null, paid: true });
        const unpaid = normalizeStripeEvent(
            JSON.parse(event("checkout.session.completed", { ...base, payment_status: "unpaid" })),
        );
        expect(unpaid).toMatchObject({ type: "checkout_completed", paid: false });
    });

    it("ignores a one-off payment checkout and an unknown type", () => {
        expect(
            normalizeStripeEvent(
                JSON.parse(event("checkout.session.completed", { mode: "payment", payment_status: "paid" })),
            ),
        ).toEqual({ id: "evt_test_1", providerType: "checkout.session.completed", type: "ignored" });
        expect(normalizeStripeEvent(JSON.parse(event("customer.created", { id: "cus_1" })))).toEqual({
            id: "evt_test_1",
            providerType: "customer.created",
            type: "ignored",
        });
    });

    it("reads a failed invoice in both the older and the newer shape", () => {
        const older = normalizeStripeEvent(
            JSON.parse(event("invoice.payment_failed", { customer: "cus_1", subscription: "sub_1" })),
        );
        expect(older).toMatchObject({ type: "payment_failed", customerRef: "cus_1", subscriptionRef: "sub_1" });
        const newer = normalizeStripeEvent(
            JSON.parse(
                event("invoice.payment_failed", {
                    customer: "cus_1",
                    parent: { type: "subscription_details", subscription_details: { subscription: "sub_2" } },
                }),
            ),
        );
        expect(newer).toMatchObject({ type: "payment_failed", customerRef: "cus_1", subscriptionRef: "sub_2" });
    });

    it("reads a deleted subscription with the workspace stamped on it", () => {
        expect(
            normalizeStripeEvent(
                JSON.parse(
                    event("customer.subscription.deleted", {
                        id: "sub_1",
                        customer: "cus_1",
                        metadata: { org_id: ORG },
                    }),
                ),
            ),
        ).toEqual({
            id: "evt_test_1",
            providerType: "customer.subscription.deleted",
            type: "subscription_deleted",
            orgId: ORG,
            customerRef: "cus_1",
            subscriptionRef: "sub_1",
        });
    });

    it("reads an updated subscription, with the period end on the subscription or on its item", () => {
        const onSubscription = normalizeStripeEvent(
            JSON.parse(
                event("customer.subscription.updated", {
                    id: "sub_1",
                    customer: "cus_1",
                    status: "active",
                    current_period_end: 1_800_000_000,
                    trial_end: null,
                }),
            ),
        );
        expect(onSubscription).toMatchObject({
            type: "subscription_updated",
            subscriptionRef: "sub_1",
            status: "active",
            currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
            trialEndsAt: null,
        });
        const onItem = normalizeStripeEvent(
            JSON.parse(
                event("customer.subscription.updated", {
                    id: "sub_1",
                    status: "trialing",
                    trial_end: 1_800_000_500,
                    items: { object: "list", data: [{ id: "si_1", current_period_end: 1_800_000_000 }] },
                }),
            ),
        );
        expect(onItem).toMatchObject({
            status: "trialing",
            currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
            trialEndsAt: new Date(1_800_000_500 * 1000).toISOString(),
        });
    });

    it("rejects a body without an id or type", () => {
        expect(() => normalizeStripeEvent({ type: "x" })).toThrow(BillingSignatureError);
        expect(() => normalizeStripeEvent({ id: "evt_1" })).toThrow(BillingSignatureError);
        expect(() => normalizeStripeEvent("string")).toThrow(BillingSignatureError);
    });
});

describe("mapStripeSubscriptionStatus", () => {
    it.each([
        ["active", "active"],
        ["trialing", "trialing"],
        ["past_due", "past_due"],
        ["unpaid", "past_due"],
        ["paused", "past_due"],
        ["canceled", "canceled"],
        ["incomplete_expired", "canceled"],
        ["incomplete", null],
        ["something_new", null],
        [undefined, null],
    ])("%s -> %s", (status, expected) => {
        expect(mapStripeSubscriptionStatus(status)).toBe(expected);
    });
});

describe("createStripeBillingProvider", () => {
    function provider(overrides: Partial<Parameters<typeof createStripeBillingProvider>[0]> = {}) {
        return createStripeBillingProvider({
            secretKey: "sk_test_placeholder",
            webhookSecret: SECRET,
            allowLive: false,
            ...overrides,
        });
    }

    it("refuses a live-mode key unless live mode is allowed, and refuses no key at all", () => {
        expect(() => provider({ secretKey: "sk_live_placeholder" })).toThrow(BillingProviderError);
        expect(() => provider({ secretKey: "rk_live_placeholder" })).toThrow(/live-mode/);
        expect(() => provider({ secretKey: "sk_live_placeholder", allowLive: true })).not.toThrow();
        expect(() => provider({ secretKey: "  " })).toThrow(/not configured/);
    });

    it("creates a checkout session with the plan, the workspace references and the return URLs", async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.example.test/cs_1" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const session = await provider({ fetchImpl: fetchImpl as unknown as typeof fetch }).createCheckoutSession({
            orgId: ORG,
            planKey: "included",
            priceRef: "price_placeholder",
            customerRef: null,
            customerEmail: "owner@firm.example",
            successUrl: "https://app.example.test/organizations/x/settings/plan?checkout=success",
            cancelUrl: "https://app.example.test/organizations/x/settings/plan?checkout=canceled",
        });
        expect(session).toEqual({ url: "https://checkout.example.test/cs_1" });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
        expect(init.method).toBe("POST");
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer sk_test_placeholder");
        expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
        expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
        const body = decodeURIComponent(String(init.body));
        expect(body).toContain("mode=subscription");
        expect(body).toContain("line_items[0][price]=price_placeholder");
        expect(body).toContain("line_items[0][quantity]=1");
        expect(body).toContain(`client_reference_id=${ORG}`);
        expect(body).toContain(`metadata[org_id]=${ORG}`);
        expect(body).toContain("metadata[plan_key]=included");
        expect(body).toContain(`subscription_data[metadata][org_id]=${ORG}`);
        expect(body).toContain("customer_email=owner@firm.example");
        expect(body).not.toContain("customer=");
        expect(body).toContain("success_url=https://app.example.test/organizations/x/settings/plan?checkout=success");
    });

    it("reuses an existing customer instead of an email", async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(JSON.stringify({ url: "https://checkout.example.test/cs_2" }), { status: 200 }),
        );
        await provider({ fetchImpl: fetchImpl as unknown as typeof fetch }).createCheckoutSession({
            orgId: ORG,
            planKey: "included",
            priceRef: "price_placeholder",
            customerRef: "cus_1",
            customerEmail: null,
            successUrl: "https://app.example.test/s",
            cancelUrl: "https://app.example.test/c",
        });
        const body = decodeURIComponent(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
        expect(body).toContain("customer=cus_1");
        expect(body).not.toContain("customer_email");
    });

    it("creates a portal session for the customer", async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(JSON.stringify({ url: "https://portal.example.test/ps_1" }), { status: 200 }),
        );
        const session = await provider({ fetchImpl: fetchImpl as unknown as typeof fetch }).createPortalSession({
            customerRef: "cus_1",
            returnUrl: "https://app.example.test/organizations/x/settings/plan",
        });
        expect(session).toEqual({ url: "https://portal.example.test/ps_1" });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
        expect(decodeURIComponent(String(init.body))).toBe(
            "customer=cus_1&return_url=https://app.example.test/organizations/x/settings/plan",
        );
    });

    it("turns a provider failure into a BillingProviderError that carries the status, never the body", async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(JSON.stringify({ error: { message: "No such price: PRIVATE-DETAIL" } }), { status: 400 }),
        );
        const failure = await provider({ fetchImpl: fetchImpl as unknown as typeof fetch })
            .createPortalSession({ customerRef: "cus_1", returnUrl: "https://app.example.test/x" })
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(BillingProviderError);
        expect((failure as BillingProviderError).status).toBe(400);
        expect(String((failure as Error).message)).not.toContain("PRIVATE");
    });

    it("treats a network failure and a response without a URL as provider failures", async () => {
        const down = vi.fn(async () => {
            throw new TypeError("fetch failed");
        });
        await expect(
            provider({ fetchImpl: down as unknown as typeof fetch }).createPortalSession({
                customerRef: "cus_1",
                returnUrl: "https://app.example.test/x",
            }),
        ).rejects.toBeInstanceOf(BillingProviderError);
        const noUrl = vi.fn(async () => new Response(JSON.stringify({ id: "cs_3" }), { status: 200 }));
        await expect(
            provider({ fetchImpl: noUrl as unknown as typeof fetch }).createPortalSession({
                customerRef: "cus_1",
                returnUrl: "https://app.example.test/x",
            }),
        ).rejects.toThrow(/no session URL/);
    });

    it("verifies and parses a webhook with the configured secret", () => {
        const payload = Buffer.from(event("invoice.payment_failed", { customer: "cus_1", subscription: "sub_1" }));
        const parsed = provider().parseWebhookEvent(payload, stripeSignatureHeader(payload, SECRET, NOW), NOW);
        expect(parsed).toMatchObject({ type: "payment_failed", subscriptionRef: "sub_1" });
        expect(() =>
            provider().parseWebhookEvent(payload, stripeSignatureHeader(payload, "whsec_other", NOW), NOW),
        ).toThrow(BillingSignatureError);
    });
});
