// SPDX-License-Identifier: AGPL-3.0-only
//
// HTTP layer for the billing module, mounted at /billing. Every route
// answers 404 while BILLING_ENABLED is unset, before authentication, so a
// deployment that does not bill shows no billing surface at all.
//
//   POST /billing/orgs/:orgId/checkout-session   { plan_key } → { url }
//   POST /billing/orgs/:orgId/portal-session                  → { url }
//   POST /billing/webhook                         the provider's events
//
// The two owner routes carry requireMfaIfEnrolled, as the organization's
// other sensitive writes do (orgs.routes.ts): the portal reaches the payment
// method, the invoices and cancellation, so a session whose account has a
// second factor must have passed it. The web client answers the 403 with
// its step-up prompt and sends the request again.
//
// The webhook handler is exported on its own: app.ts registers it ahead of
// the global JSON parser with a raw body, because the provider's signature
// covers the exact bytes it sent and a parsed-and-reserialized body would
// never verify. requireBillingEnabled is exported with it so app.ts can
// answer 404 before the raw parser buffers a body on a deployment that
// does not bill.

import { Router, type NextFunction, type Request, type Response } from "express";
import { requireAuth, requireMfaIfEnrolled } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { sendServiceFailure } from "../../lib/serviceResult";
import { billingEnabled } from "../../lib/runtimeConfig";
import {
    createCheckoutSession,
    createPortalSession,
    handleBillingWebhook,
} from "./billing.service";

/** 404 while BILLING_ENABLED is unset: the surface does not exist. */
export function requireBillingEnabled(
    _req: Request,
    res: Response,
    next: NextFunction,
): void {
    if (!billingEnabled()) {
        res.status(404).json({ detail: "Not found" });
        return;
    }
    next();
}

export const billingRouter = Router();

billingRouter.use(requireBillingEnabled);

// POST /billing/orgs/:orgId/checkout-session — a hosted checkout for one plan
// (owners). The browser is sent to the returned URL.
billingRouter.post(
    "/orgs/:orgId/checkout-session",
    requireAuth,
    requireMfaIfEnrolled,
    asyncRoute(async (req, res) => {
        const result = await createCheckoutSession(createServerSupabase(), {
            orgId: req.params.orgId,
            userId: res.locals.userId as string,
            userEmail:
                typeof res.locals.userEmail === "string" ? res.locals.userEmail : null,
            planKey: req.body?.plan_key,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.json(result.data);
    }),
);

// POST /billing/orgs/:orgId/portal-session — the provider's billing portal
// for the organization's customer (owners).
billingRouter.post(
    "/orgs/:orgId/portal-session",
    requireAuth,
    requireMfaIfEnrolled,
    asyncRoute(async (req, res) => {
        const result = await createPortalSession(createServerSupabase(), {
            orgId: req.params.orgId,
            userId: res.locals.userId as string,
        });
        if (!result.ok) return void sendServiceFailure(res, result);
        res.json(result.data);
    }),
);

billingRouter.use(routerErrorHandler("[billing]"));

// POST /billing/webhook — unauthenticated by design: the provider signs each
// delivery, and the signature is the credential. Registered by app.ts behind
// requireBillingEnabled and express.raw, so req.body is the exact bytes; the
// check here is defence in depth for a mount that forgot the middleware.
export const billingWebhookHandler = asyncRoute(async (req, res) => {
    if (!billingEnabled()) {
        res.status(404).json({ detail: "Not found" });
        return;
    }
    const result = await handleBillingWebhook(createServerSupabase(), {
        payload: Buffer.isBuffer(req.body) ? req.body : null,
        signature: req.get("stripe-signature"),
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(200).json(result.data);
});
