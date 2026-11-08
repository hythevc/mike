// SPDX-License-Identifier: AGPL-3.0-only
//
// Read models for the plans module: the public plan list (GET /plans) and a
// workspace's plan, seats and this month's usage (GET /orgs/:id/plan). The
// plan catalog is configuration (planCatalog.ts); entitlements turns a
// subscription into the facts shown here. Nothing here enforces anything — the
// enforcement is in entitlements.ts and lib/orgs.ts — and nothing charges.

import type { Db } from "../../lib/supabase";
import type {
    OrgPlanView,
    PlanUsageRow,
    PlansResponse,
    PublicPlan as WirePublicPlan,
} from "@mike/contracts";
import {
    plansEnabled,
    publicPlans,
    toPublicPlan,
    type PublicPlan,
} from "../../lib/planCatalog";
import {
    readSubscriptionRefs,
    resolveOrgEntitlement,
} from "../../lib/entitlements";
import { billingEnabled } from "../../lib/runtimeConfig";

// Billing sits behind BILLING_ENABLED (default off; modules/billing). The plan
// surfaces report the switch so the web app shows its checkout and portal
// controls only on a deployment that has turned it on.

function toWirePlan(plan: PublicPlan): WirePublicPlan {
    return {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        seat_limit: plan.seatLimit,
        features: plan.features,
        deployment_token_allowance: plan.deploymentTokenAllowance,
        trial_days: plan.trialDays,
        sort_order: plan.sortOrder,
        display_price_text: plan.displayPriceText,
    };
}

/** The public plans a deployment offers, or an empty list when plans are off. */
export function buildPlansResponse(
    env: NodeJS.ProcessEnv = process.env,
): PlansResponse {
    const enabled = plansEnabled(env);
    return {
        plans_enabled: enabled,
        billing_enabled: billingEnabled(env),
        plans: enabled ? publicPlans(env).map(toWirePlan) : [],
    };
}

async function fetchSeatState(
    db: Db,
    orgId: string,
): Promise<{ member_count: number; pending_invite_count: number }> {
    const { data, error } = await db.rpc("org_seat_state", { p_org_id: orgId });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as
        | { member_count?: number; pending_invite_count?: number }
        | null;
    return {
        member_count: Number(row?.member_count) || 0,
        pending_invite_count: Number(row?.pending_invite_count) || 0,
    };
}

const KEY_SOURCES: ReadonlySet<string> = new Set(["user", "org", "env"]);

async function fetchUsage(
    db: Db,
    orgId: string,
    now: Date,
): Promise<PlanUsageRow[]> {
    const { data, error } = await db.rpc("org_usage_month_summary", {
        p_org_id: orgId,
        p_month: now.toISOString(),
    });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map((raw): PlanUsageRow => {
        const row = raw as Record<string, unknown>;
        const keySource =
            typeof row.key_source === "string" && KEY_SOURCES.has(row.key_source)
                ? (row.key_source as PlanUsageRow["key_source"])
                : "env";
        return {
            model: typeof row.model === "string" ? row.model : "unknown",
            provider: typeof row.provider === "string" ? row.provider : "unknown",
            key_source: keySource,
            input_tokens: Number(row.input_tokens) || 0,
            output_tokens: Number(row.output_tokens) || 0,
            cached_tokens: Number(row.cached_tokens) || 0,
            calls: Number(row.calls) || 0,
            estimated: row.estimated === true,
        };
    });
}

/**
 * A workspace's plan, seats and this month's usage. Seats and usage are shown
 * whether or not plans are enabled; the plan, status and seat limit are null
 * until plans are on and a plan (or a seat-limit override) is set.
 */
export async function buildOrgPlanView(
    db: Db,
    orgId: string,
    env: NodeJS.ProcessEnv = process.env,
    now: Date = new Date(),
): Promise<OrgPlanView> {
    const billing = billingEnabled(env);
    const [entitlement, seats, usage, refs] = await Promise.all([
        resolveOrgEntitlement(db, orgId, env, now),
        fetchSeatState(db, orgId),
        fetchUsage(db, orgId, now),
        // The provider references are read only when billing is on: they
        // decide whether the portal has a customer to open for.
        billing ? readSubscriptionRefs(db, orgId) : Promise.resolve(null),
    ]);
    return {
        plans_enabled: entitlement.plansEnabled,
        billing_enabled: billing,
        has_billing_account: Boolean(refs?.customerRef),
        plan: entitlement.plan ? toWirePlan(toPublicPlan(entitlement.plan)) : null,
        status: entitlement.status,
        seats_used: seats.member_count,
        pending_invites: seats.pending_invite_count,
        seat_limit: entitlement.seatLimit,
        trial_ends_at: entitlement.trialEndsAt,
        current_period_end: entitlement.currentPeriodEnd,
        usage,
    };
}
