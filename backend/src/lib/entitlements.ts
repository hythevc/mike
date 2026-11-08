// SPDX-License-Identifier: AGPL-3.0-only
//
// Entitlements: what an organization may do under its plan. The plan catalog
// (planCatalog.ts) describes the tiers; a row in org_subscriptions says which
// tier an organization is on and the state of its subscription; this module
// turns the two into the facts the rest of the backend enforces — a seat
// limit, a monthly token allowance on the deployment's own AI keys, and
// whether hosted-model use is blocked.
//
// With PLANS_ENABLED unset, nothing here limits anything: every organization
// is entitled and unlimited, exactly as before plans existed. Nothing in this
// module charges anyone; billing is its own switch (BILLING_ENABLED), off by
// default, and lives elsewhere.
//
// The deployment-key allowance hook (installPlanAllowance) plugs into the W06
// usage cap (lib/usage.ts): when plans are on, a workspace's monthly
// allowance on the deployment's keys comes from its plan, and an expired
// trial or a past-due or canceled subscription blocks hosted-model use by
// returning a zero allowance. A person's own key, export and deletion are
// never touched, because the cap only applies to the deployment's keys.

import { createServerSupabase, type Db } from "./supabase";
import {
    loadPlanCatalog,
    planByKey,
    plansEnabled,
    type Plan,
} from "./planCatalog";
import {
    deploymentKeyMonthlyTokenCap,
    setDeploymentAllowance,
    type AllowanceScope,
    type DeploymentAllowance,
} from "./usage";
import type { UsageContext } from "./llm/usageContext";

export type SubscriptionStatus =
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "none";

const SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set<SubscriptionStatus>([
    "trialing",
    "active",
    "past_due",
    "canceled",
    "none",
]);

/** One org_subscriptions row, as the backend reads it. */
export type SubscriptionRow = {
    org_id: string;
    plan_key: string | null;
    status: SubscriptionStatus;
    seat_limit: number | null;
    trial_ends_at: string | null;
    current_period_end: string | null;
};

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: string | null | undefined): string | null {
    return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

function asStatus(value: unknown): SubscriptionStatus {
    return typeof value === "string" && SUBSCRIPTION_STATUSES.has(value)
        ? (value as SubscriptionStatus)
        : "none";
}

/** The org_subscriptions row for an organization, or null when there is none. */
export async function readSubscription(
    db: Db,
    orgId: string,
): Promise<SubscriptionRow | null> {
    const { data, error } = await db
        .from("org_subscriptions")
        .select(
            "org_id, plan_key, status, seat_limit, trial_ends_at, current_period_end",
        )
        .eq("org_id", orgId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
        org_id: String(row.org_id),
        plan_key: typeof row.plan_key === "string" ? row.plan_key : null,
        status: asStatus(row.status),
        seat_limit:
            typeof row.seat_limit === "number" ? row.seat_limit : null,
        trial_ends_at:
            typeof row.trial_ends_at === "string" ? row.trial_ends_at : null,
        current_period_end:
            typeof row.current_period_end === "string"
                ? row.current_period_end
                : null,
    };
}

/** The id of the hidden personal organization belonging to `userId`, or null. */
export async function personalOrgId(
    db: Db,
    userId: string | null | undefined,
): Promise<string | null> {
    const id = asUuid(userId);
    if (!id) return null;
    const { data, error } = await db
        .from("organizations")
        .select("id")
        .eq("personal_user_id", id)
        .maybeSingle();
    if (error) throw error;
    const row = data as { id?: string } | null;
    return row?.id ? String(row.id) : null;
}

/**
 * Whether a subscription in this state stops the workspace using the
 * deployment's hosted models: an expired trial, or a past-due or canceled
 * subscription. An active subscription, a trial still running, a workspace on
 * no plan ('none') and a workspace with no row at all are all fine.
 */
export function blocksHostedModels(
    row: Pick<SubscriptionRow, "status" | "trial_ends_at"> | null,
    now: Date = new Date(),
): boolean {
    if (!row) return false;
    if (row.status === "past_due" || row.status === "canceled") return true;
    if (row.status === "trialing" && row.trial_ends_at) {
        const ends = Date.parse(row.trial_ends_at);
        if (Number.isFinite(ends) && ends <= now.getTime()) return true;
    }
    return false;
}

/** What an organization is entitled to, resolved from its subscription and plan. */
export type OrgEntitlement = {
    plansEnabled: boolean;
    status: SubscriptionStatus | null;
    planKey: string | null;
    plan: Plan | null;
    /** The seat limit in force (override, else the plan's), or null for none. */
    seatLimit: number | null;
    /** The monthly deployment-key token allowance in force, or null for the default. */
    deploymentTokenAllowance: number | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    /** Hosted-model use is blocked (expired trial, past due or canceled). */
    blocksHostedModels: boolean;
};

/**
 * Resolve an organization's entitlement. With plans off, everything is
 * unlimited and nothing is blocked, without reading the catalog. With plans
 * on, the subscription row and the plan decide.
 */
export async function resolveOrgEntitlement(
    db: Db,
    orgId: string,
    env: NodeJS.ProcessEnv = process.env,
    now: Date = new Date(),
): Promise<OrgEntitlement> {
    if (!plansEnabled(env)) {
        return {
            plansEnabled: false,
            status: null,
            planKey: null,
            plan: null,
            seatLimit: null,
            deploymentTokenAllowance: null,
            trialEndsAt: null,
            currentPeriodEnd: null,
            blocksHostedModels: false,
        };
    }
    const row = await readSubscription(db, orgId);
    const plan = planByKey(row?.plan_key, env);
    const override = row?.seat_limit ?? null;
    return {
        plansEnabled: true,
        status: row?.status ?? null,
        planKey: row?.plan_key ?? null,
        plan,
        seatLimit: override ?? plan?.seatLimit ?? null,
        deploymentTokenAllowance: plan?.deploymentTokenAllowance ?? null,
        trialEndsAt: row?.trial_ends_at ?? null,
        currentPeriodEnd: row?.current_period_end ?? null,
        blocksHostedModels: blocksHostedModels(row, now),
    };
}

/**
 * The seat limit in force for an organization, or null for no limit. Null the
 * moment plans are off, without a query, so invitation and acceptance keep
 * today's unlimited behaviour on a deployment that runs no plans.
 */
export async function effectiveSeatLimit(
    db: Db,
    orgId: string,
    env: NodeJS.ProcessEnv = process.env,
): Promise<number | null> {
    if (!plansEnabled(env)) return null;
    const row = await readSubscription(db, orgId);
    const plan = planByKey(row?.plan_key, env);
    return row?.seat_limit ?? plan?.seatLimit ?? null;
}

/**
 * The deployment-key allowance for a usage context, in the shape lib/usage.ts
 * expects. The person's across every workspace keeps the deployment default;
 * the workspace's comes from its plan, with a zero allowance when the
 * subscription blocks hosted-model use, so an expired trial stops hosted
 * models without touching a person's own key, export or deletion.
 */
export function planDeploymentAllowance(
    env: NodeJS.ProcessEnv = process.env,
    makeDb: () => Db = createServerSupabase,
): DeploymentAllowance {
    return async (
        context: UsageContext,
        scope: AllowanceScope,
    ): Promise<number | null> => {
        const envCap = deploymentKeyMonthlyTokenCap(env);
        // A person's allowance spans every workspace they work in, so no one
        // plan owns it; keep the deployment default.
        if (scope === "person") return envCap;

        const db = makeDb();
        const orgId =
            asUuid(context.orgId) ?? (await personalOrgId(db, context.userId));
        // A call we cannot attribute to a workspace falls back to the default.
        if (!orgId) return envCap;

        const entitlement = await resolveOrgEntitlement(db, orgId, env);
        if (entitlement.blocksHostedModels) return 0;
        return entitlement.deploymentTokenAllowance ?? envCap;
    };
}

/**
 * Install the plan allowance into the usage cap when plans are on, so model
 * calls on the deployment's keys are held to the plan. Reading the catalog
 * here means a malformed PLANS_CATALOG_JSON fails the process at startup
 * rather than on the first model call. With plans off, the deployment default
 * stays in place and nothing is installed.
 */
export function installPlanAllowance(
    env: NodeJS.ProcessEnv = process.env,
): void {
    if (!plansEnabled(env)) return;
    // Validate the catalog now: throws a PlanCatalogError naming the field at
    // fault, so a bad catalog is caught at boot.
    loadPlanCatalog(env);
    setDeploymentAllowance(planDeploymentAllowance(env));
}

// ---------------------------------------------------------------------------
// Subscription writes. The billing module (modules/billing) is the only
// caller: the payment provider's webhook tells it what happened to a
// workspace's subscription, and it records the fact through these helpers.
// Nothing else writes a subscription's status; the database trigger creates
// the trial row when an organization is created.
//
// Every write is an upsert on org_id, so an organization that predates the
// plans migration (and so has no row yet) gets one the first time billing
// reports on it. The provider references are opaque ids into the provider's
// account; they name the customer, so they never leave the backend.
// ---------------------------------------------------------------------------

/** The provider-facing facts of a subscription row. */
export type SubscriptionRefs = {
    orgId: string;
    status: SubscriptionStatus;
    planKey: string | null;
    /** The provider's customer id, or null before the first checkout. */
    customerRef: string | null;
    /** The provider's subscription id, or null when none is live. */
    subscriptionRef: string | null;
};

const REFS_COLUMNS =
    "org_id, plan_key, status, provider_customer_ref, provider_subscription_ref";

function toRefs(data: unknown): SubscriptionRefs | null {
    if (!data || typeof data !== "object") return null;
    const row = data as Record<string, unknown>;
    return {
        orgId: String(row.org_id),
        status: asStatus(row.status),
        planKey: typeof row.plan_key === "string" ? row.plan_key : null,
        customerRef:
            typeof row.provider_customer_ref === "string"
                ? row.provider_customer_ref
                : null,
        subscriptionRef:
            typeof row.provider_subscription_ref === "string"
                ? row.provider_subscription_ref
                : null,
    };
}

/** The provider references of an organization's subscription, or null for no row. */
export async function readSubscriptionRefs(
    db: Db,
    orgId: string,
): Promise<SubscriptionRefs | null> {
    const { data, error } = await db
        .from("org_subscriptions")
        .select(REFS_COLUMNS)
        .eq("org_id", orgId)
        .maybeSingle();
    if (error) throw error;
    return toRefs(data);
}

/**
 * The subscription a provider event is about. The subscription id is the
 * precise match; the customer id is the fallback for events that carry no
 * subscription (or one this deployment never recorded). Null when neither
 * names a workspace here: the event belongs to someone else's account, or to
 * a customer created outside the app.
 */
export async function findSubscriptionByProviderRef(
    db: Db,
    refs: { subscriptionRef?: string | null; customerRef?: string | null },
): Promise<SubscriptionRefs | null> {
    const lookups: Array<[column: string, value: string]> = [];
    if (refs.subscriptionRef)
        lookups.push(["provider_subscription_ref", refs.subscriptionRef]);
    if (refs.customerRef) lookups.push(["provider_customer_ref", refs.customerRef]);
    for (const [column, value] of lookups) {
        const { data, error } = await db
            .from("org_subscriptions")
            .select(REFS_COLUMNS)
            .eq(column, value)
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        const found = toRefs(data);
        if (found) return found;
    }
    return null;
}

async function upsertSubscription(
    db: Db,
    row: Record<string, unknown> & { org_id: string },
): Promise<void> {
    const { error } = await db
        .from("org_subscriptions")
        .upsert(row, { onConflict: "org_id" });
    if (error) throw error;
}

/**
 * A completed checkout: the workspace is on the plan it bought, with the
 * provider's customer and subscription ids recorded so later events find it.
 * The trial window is cleared; an active subscription is not on trial.
 */
export async function activateSubscription(
    db: Db,
    input: {
        orgId: string;
        planKey: string | null;
        customerRef: string | null;
        subscriptionRef: string | null;
        currentPeriodEnd: string | null;
    },
): Promise<void> {
    await upsertSubscription(db, {
        org_id: input.orgId,
        status: "active",
        // A checkout without a plan key in its metadata keeps whatever plan
        // the row already names rather than wiping it.
        ...(input.planKey ? { plan_key: input.planKey } : {}),
        ...(input.customerRef ? { provider_customer_ref: input.customerRef } : {}),
        ...(input.subscriptionRef
            ? { provider_subscription_ref: input.subscriptionRef }
            : {}),
        current_period_end: input.currentPeriodEnd,
        trial_ends_at: null,
    });
}

/**
 * A checkout that completed before its payment did: remember the provider's
 * references so the payment's own events find the workspace, and the plan it
 * bought so the workspace is on that plan the moment the provider reports
 * the subscription active (that report never names a plan). The status is
 * left alone until one of the payment's events reports the outcome.
 */
export async function recordSubscriptionRefs(
    db: Db,
    orgId: string,
    refs: {
        customerRef: string | null;
        subscriptionRef: string | null;
        planKey?: string | null;
    },
): Promise<void> {
    if (!refs.customerRef && !refs.subscriptionRef && !refs.planKey) return;
    await upsertSubscription(db, {
        org_id: orgId,
        ...(refs.customerRef ? { provider_customer_ref: refs.customerRef } : {}),
        ...(refs.subscriptionRef
            ? { provider_subscription_ref: refs.subscriptionRef }
            : {}),
        ...(refs.planKey ? { plan_key: refs.planKey } : {}),
    });
}

/**
 * A failed payment. The plan and the provider references stay as they are —
 * the subscription still exists and the provider will retry — but the
 * workspace's hosted-model use is held until it is paid (blocksHostedModels).
 */
export async function markSubscriptionPastDue(
    db: Db,
    orgId: string,
): Promise<void> {
    await upsertSubscription(db, { org_id: orgId, status: "past_due" });
}

/**
 * The subscription is gone. The workspace falls back to the unpaid default:
 * no plan, no live subscription id, no period. It never lands on another
 * paid plan here; only a new completed checkout does that. The customer id
 * is kept so the billing portal (invoices, receipts) still opens.
 */
export async function cancelSubscription(db: Db, orgId: string): Promise<void> {
    await upsertSubscription(db, {
        org_id: orgId,
        status: "canceled",
        plan_key: null,
        provider_subscription_ref: null,
        current_period_end: null,
        trial_ends_at: null,
    });
}

/**
 * The provider reports the subscription's current state (a payment that
 * recovered a past-due subscription, a renewal, a provider-side trial). The
 * status and its dates follow the report. The plan changes only when the
 * caller passes one it resolved from the subscription's price against the
 * catalog (a plan switch made in the provider's portal); the status alone
 * never moves a workspace onto a plan.
 */
export async function syncSubscriptionStatus(
    db: Db,
    orgId: string,
    input: {
        status: Exclude<SubscriptionStatus, "none" | "canceled">;
        currentPeriodEnd: string | null;
        trialEndsAt?: string | null;
        planKey?: string | null;
    },
): Promise<void> {
    await upsertSubscription(db, {
        org_id: orgId,
        status: input.status,
        current_period_end: input.currentPeriodEnd,
        ...(input.trialEndsAt !== undefined ? { trial_ends_at: input.trialEndsAt } : {}),
        ...(input.planKey ? { plan_key: input.planKey } : {}),
    });
}
