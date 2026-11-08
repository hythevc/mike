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
import type { OrgPlanView } from "@mike/contracts";
import { buildOrgPlanView, buildPlansResponse } from "./plans.service";

export const plansRouter = Router();

// GET /plans — the public plans on offer. Signed in, because choosing a plan
// is something a member does; pricing for the public lives off the product.
plansRouter.get(
    "/",
    requireAuth,
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
                billing_enabled: false,
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
