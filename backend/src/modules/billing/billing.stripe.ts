// SPDX-License-Identifier: AGPL-3.0-only
//
// Stripe over its REST API, with fetch and node:crypto only: no SDK, so a
// feature that is off by default adds no dependency.
//
//   POST /v1/checkout/sessions        a hosted checkout page for one plan
//   POST /v1/billing_portal/sessions  the hosted portal: payment method,
//                                     invoices, cancellation
//   webhooks                          Stripe-Signature: t=<unix>,v1=<hex>,
//                                     v1 = HMAC-SHA256(secret, "<t>.<body>")
//
// Test mode only. A live-mode key (sk_live_, rk_live_) is refused here as
// well as at boot (lib/runtimeConfig.ts) unless BILLING_ALLOW_LIVE is set.
// Requests use the account's default API version; the readers below accept
// both the older and the newer shape of every field they use, so a version
// change on the account does not silently drop an event.
//
// The pure parts (form encoding, signatures, event normalization) are
// exported so the fake provider and the tests share them.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SubscriptionStatus } from "../../lib/entitlements";
import { isLiveBillingKey } from "../../lib/runtimeConfig";
import {
    BillingProviderError,
    BillingSignatureError,
    type BillingEvent,
    type BillingProvider,
    type CheckoutSessionInput,
    type HostedSession,
    type PortalSessionInput,
} from "./billing.provider";

const API_BASE = "https://api.stripe.com";
const REQUEST_TIMEOUT_MS = 15_000;

/** How far a delivery's timestamp may be from now before it is refused as a replay. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeProviderOptions = {
    secretKey: string;
    webhookSecret: string;
    /** BILLING_ALLOW_LIVE: a live-mode key may be used. */
    allowLive: boolean;
    /** The fetch to call the API with; tests pass a stub. */
    fetchImpl?: typeof fetch;
};

// ---------------------------------------------------------------------------
// Form encoding
// ---------------------------------------------------------------------------

export type FormValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | FormValue[]
    | { [key: string]: FormValue };

/**
 * Stripe's request encoding: application/x-www-form-urlencoded with nested
 * keys in brackets (`metadata[org_id]`) and arrays by index
 * (`line_items[0][price]`). Null and undefined values are left out.
 */
export function encodeForm(params: Record<string, FormValue>): string {
    const pairs: string[] = [];
    const add = (key: string, value: FormValue): void => {
        if (value === null || value === undefined) return;
        if (Array.isArray(value)) {
            value.forEach((item, index) => add(`${key}[${index}]`, item));
            return;
        }
        if (typeof value === "object") {
            for (const [child, item] of Object.entries(value))
                add(`${key}[${child}]`, item);
            return;
        }
        pairs.push(
            `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
        );
    };
    for (const [key, value] of Object.entries(params)) add(key, value);
    return pairs.join("&");
}

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

/** `t=<unix seconds>,v1=<hex>[,v1=<hex>…]`; other schemes are ignored. */
export function parseSignatureHeader(
    header: string,
): { timestamp: number; signatures: string[] } | null {
    let timestamp: number | null = null;
    const signatures: string[] = [];
    for (const part of header.split(",")) {
        const separator = part.indexOf("=");
        if (separator < 0) continue;
        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
        else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value))
            signatures.push(value.toLowerCase());
    }
    if (timestamp === null || signatures.length === 0) return null;
    return { timestamp, signatures };
}

/** The v1 signature of a payload at a timestamp. */
export function signStripePayload(
    payload: Buffer | string,
    secret: string,
    timestamp: number,
): string {
    return createHmac("sha256", secret)
        .update(`${timestamp}.`)
        .update(payload)
        .digest("hex");
}

/**
 * A Stripe-Signature header for a payload, signed now: what the fake
 * provider and the tests use to sign fixtures.
 */
export function stripeSignatureHeader(
    payload: Buffer | string,
    secret: string,
    now: Date = new Date(),
): string {
    const timestamp = Math.floor(now.getTime() / 1000);
    return `t=${timestamp},v1=${signStripePayload(payload, secret, timestamp)}`;
}

/**
 * Verify a delivery. The comparison is constant-time, any one of the v1
 * signatures may match (the provider sends two while a secret is being
 * rotated), and the timestamp must be within the tolerance window so a
 * captured delivery cannot be replayed later.
 */
export function verifyStripeSignature(input: {
    payload: Buffer | string;
    header: string | undefined;
    secret: string;
    now?: Date;
    toleranceSeconds?: number;
}): void {
    if (!input.secret)
        throw new BillingSignatureError("Webhook secret is not configured");
    if (!input.header) throw new BillingSignatureError("Missing signature header");
    const parsed = parseSignatureHeader(input.header);
    if (!parsed) throw new BillingSignatureError("Malformed signature header");

    const expected = Buffer.from(
        signStripePayload(input.payload, input.secret, parsed.timestamp),
        "hex",
    );
    const matches = parsed.signatures.some((candidate) => {
        const actual = Buffer.from(candidate, "hex");
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    });
    if (!matches) throw new BillingSignatureError("Signature does not match");

    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
    const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
    if (Math.abs(nowSeconds - parsed.timestamp) > tolerance)
        throw new BillingSignatureError("Signature timestamp is outside the tolerance");
}

// ---------------------------------------------------------------------------
// Event normalization
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as JsonRecord)
        : null;
}

/** A non-empty string of a sane length, or null. */
function asString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 && value.length <= 255
        ? value
        : null;
}

/** A reference field: the id as a string, or an expanded object carrying `id`. */
function refOf(value: unknown): string | null {
    if (typeof value === "string") return asString(value);
    const record = asRecord(value);
    return record ? asString(record.id) : null;
}

function isoFromUnixSeconds(value: unknown): string | null {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? new Date(value * 1000).toISOString()
        : null;
}

/**
 * The provider's subscription status in our vocabulary. `incomplete` (the
 * first payment has not been attempted) and anything unknown map to null,
 * which the handler treats as "no change" rather than guessing. `paused`
 * (a trial that ended without a payment method) holds hosted-model use the
 * way an unpaid invoice does.
 */
export function mapStripeSubscriptionStatus(
    status: unknown,
): SubscriptionStatus | null {
    switch (status) {
        case "active":
            return "active";
        case "trialing":
            return "trialing";
        case "past_due":
        case "unpaid":
        case "paused":
            return "past_due";
        case "canceled":
        case "incomplete_expired":
            return "canceled";
        default:
            return null;
    }
}

/** A verified event body, normalized. Throws BillingSignatureError for a body that is not an event. */
export function normalizeStripeEvent(raw: unknown): BillingEvent {
    const event = asRecord(raw);
    const id = event ? asString(event.id) : null;
    const type = event ? asString(event.type) : null;
    if (!event || !id || !type)
        throw new BillingSignatureError("Malformed event payload");

    const object = asRecord(asRecord(event.data)?.object) ?? {};
    const metadata = asRecord(object.metadata) ?? {};
    const base = { id, providerType: type };

    switch (type) {
        case "checkout.session.completed": {
            // Only a subscription checkout changes a plan; a one-off payment
            // session (not something this module creates) is noted and left.
            if (object.mode !== "subscription") return { ...base, type: "ignored" };
            return {
                ...base,
                type: "checkout_completed",
                orgId: asString(metadata.org_id) ?? asString(object.client_reference_id),
                planKey: asString(metadata.plan_key),
                customerRef: refOf(object.customer),
                subscriptionRef: refOf(object.subscription),
                paid:
                    object.payment_status === "paid" ||
                    object.payment_status === "no_payment_required",
            };
        }
        case "invoice.payment_failed": {
            // Newer API versions moved the invoice's subscription under
            // parent.subscription_details; older ones carry it at the top.
            const parent = asRecord(asRecord(object.parent)?.subscription_details);
            return {
                ...base,
                type: "payment_failed",
                customerRef: refOf(object.customer),
                subscriptionRef:
                    refOf(object.subscription) ?? refOf(parent?.subscription),
            };
        }
        case "customer.subscription.deleted":
            return {
                ...base,
                type: "subscription_deleted",
                orgId: asString(metadata.org_id),
                customerRef: refOf(object.customer),
                subscriptionRef: asString(object.id),
            };
        case "customer.subscription.updated": {
            // current_period_end moved from the subscription to its items in
            // newer API versions; read whichever is present. The item also
            // carries the price (older shapes mirror it as `plan`), which is
            // how a plan switch made in the portal reaches this deployment.
            const items = asRecord(object.items)?.data;
            const firstItem = asRecord(Array.isArray(items) ? items[0] : null);
            return {
                ...base,
                type: "subscription_updated",
                orgId: asString(metadata.org_id),
                customerRef: refOf(object.customer),
                subscriptionRef: asString(object.id),
                status: mapStripeSubscriptionStatus(object.status),
                currentPeriodEnd:
                    isoFromUnixSeconds(object.current_period_end) ??
                    isoFromUnixSeconds(firstItem?.current_period_end),
                trialEndsAt: isoFromUnixSeconds(object.trial_end),
                priceRef: refOf(firstItem?.price) ?? refOf(firstItem?.plan),
            };
        }
        default:
            return { ...base, type: "ignored" };
    }
}

/** Verify a delivery and normalize its event. */
export function parseStripeWebhook(input: {
    payload: Buffer;
    header: string | undefined;
    secret: string;
    now?: Date;
}): BillingEvent {
    verifyStripeSignature(input);
    let raw: unknown;
    try {
        raw = JSON.parse(input.payload.toString("utf8"));
    } catch {
        throw new BillingSignatureError("Malformed event payload");
    }
    return normalizeStripeEvent(raw);
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

function hostedSession(body: unknown): HostedSession {
    const url = asRecord(body)?.url;
    if (typeof url !== "string" || !/^https:\/\//i.test(url))
        throw new BillingProviderError("Billing provider returned no session URL");
    return { url };
}

/**
 * Construct the adapter. Throws BillingProviderError when the key is
 * missing or live-mode without BILLING_ALLOW_LIVE, so a request made before
 * boot validation could run (or on a build that skipped it) still cannot
 * reach a live account.
 */
export function createStripeBillingProvider(
    options: StripeProviderOptions,
): BillingProvider {
    const secretKey = options.secretKey.trim();
    if (!secretKey)
        throw new BillingProviderError("Billing provider key is not configured");
    if (isLiveBillingKey(secretKey) && !options.allowLive)
        throw new BillingProviderError(
            "A live-mode billing key is refused unless BILLING_ALLOW_LIVE is set",
        );
    const fetchImpl = options.fetchImpl ?? fetch;

    async function post(path: string, params: Record<string, FormValue>): Promise<unknown> {
        let response: Response;
        try {
            response = await fetchImpl(`${API_BASE}${path}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${secretKey}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                    // A retried request creates one session, not two.
                    "Idempotency-Key": randomUUID(),
                },
                body: encodeForm(params),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            throw new BillingProviderError(
                "Billing provider request failed (network)",
                null,
                { cause: error },
            );
        }
        if (!response.ok) {
            // The error body can describe the customer; the status is enough.
            throw new BillingProviderError(
                `Billing provider request failed (${response.status})`,
                response.status,
            );
        }
        try {
            return await response.json();
        } catch (error) {
            throw new BillingProviderError(
                "Billing provider returned an unreadable response",
                response.status,
                { cause: error },
            );
        }
    }

    return {
        kind: "stripe",

        async createCheckoutSession(input: CheckoutSessionInput): Promise<HostedSession> {
            const workspace = { org_id: input.orgId, plan_key: input.planKey };
            const body = await post("/v1/checkout/sessions", {
                mode: "subscription",
                line_items: [{ price: input.priceRef, quantity: 1 }],
                success_url: input.successUrl,
                cancel_url: input.cancelUrl,
                // Both references come back on the completed-checkout event
                // and on the subscription, so its later events find the
                // workspace without a lookup through the provider.
                client_reference_id: input.orgId,
                metadata: workspace,
                subscription_data: { metadata: workspace },
                ...(input.customerRef
                    ? { customer: input.customerRef }
                    : input.customerEmail
                      ? { customer_email: input.customerEmail }
                      : {}),
            });
            return hostedSession(body);
        },

        async createPortalSession(input: PortalSessionInput): Promise<HostedSession> {
            const body = await post("/v1/billing_portal/sessions", {
                customer: input.customerRef,
                return_url: input.returnUrl,
            });
            return hostedSession(body);
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
