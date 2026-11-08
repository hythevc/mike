// SPDX-License-Identifier: AGPL-3.0-only
//
// HTTP layer for the plans module. GET /plans returns the public plans a
// deployment offers, with no provider price references and no plans at all
// until PLANS_ENABLED is set. A workspace's own plan, seats and usage is a
// separate, authorized endpoint on the orgs router (GET /orgs/:id/plan), so
// it can reuse the organization membership and role checks there.

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { createServerSupabase } from "../../lib/supabase";
import { personalOrgId } from "../../lib/entitlements";
import { plansEnabled } from "../../lib/planCatalog";
import { publicRateLimit } from "../../lib/rateLimitStore";
import { billingEnabled, envInt } from "../../lib/runtimeConfig";
import type { OrgPlanView } from "@mike/contracts";
import { buildOrgPlanView, buildPlansResponse } from "./plans.service";

export const plansRouter = Router();

function minutes(value: number): number {
    return value * 60 * 1000;
}

// GET /plans is anonymous: the web app's public /pricing page reads it for
// visitors who have no account yet. Like every anonymous public route it
// counts on its own lane in the shared store, keyed by client address, so the
// budget is the same on every replica and the lane refuses requests while the
// store cannot answer (lib/rateLimitStore.ts; the sign-in lanes in app.ts
// follow the same policy). The response is built from configuration alone,
// with no database or model work, so the budget is generous: it is there so
// that one address cannot keep a replica busy serving the catalog.
const plansPublicRateLimit = publicRateLimit({
    lane: "plans-public",
    windowMs: minutes(envInt("RATE_LIMIT_PLANS_PUBLIC_WINDOW_MINUTES", 15)),
    max: envInt("RATE_LIMIT_PLANS_PUBLIC_MAX", 120),
    message: "Too many requests. Please try again later.",
});

// GET /plans — the public plans on offer: only the plans marked public, their
// display price text and no provider reference.
plansRouter.get(
    "/",
    plansPublicRateLimit,
    asyncRoute(async (_req, res) => {
        res.json(buildPlansResponse());
    }),
);

// GET /plans/me — the caller's own (Personal) workspace plan, seats and usage,
// so the personal settings page can show its plan rather than a fixed tier.
plansRouter.get(
    "/me",
    requireAuth,
    asyncRoute(async (_req, res) => {
        const db = createServerSupabase();
        const orgId = await personalOrgId(db, res.locals.userId as string);
        if (!orgId) {
            // No personal workspace yet (it is made on sign-up): report the
            // empty view rather than fail.
            const empty: OrgPlanView = {
                plans_enabled: plansEnabled(),
                billing_enabled: billingEnabled(),
                has_billing_account: false,
                plan: null,
                status: null,
                seats_used: 0,
                pending_invites: 0,
                seat_limit: null,
                trial_ends_at: null,
                current_period_end: null,
                usage: [],
            };
            res.json(empty);
            return;
        }
        res.json(await buildOrgPlanView(db, orgId));
    }),
);

plansRouter.use(routerErrorHandler("[plans]"));
