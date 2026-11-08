// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { Db } from "../supabase";
import type { UsageContext } from "../llm/usageContext";
import {
    blocksHostedModels,
    effectiveSeatLimit,
    planDeploymentAllowance,
    resolveOrgEntitlement,
    type SubscriptionRow,
} from "../entitlements";

const ORG = "00000000-0000-4000-8000-000000000010";
const USER = "00000000-0000-4000-8000-000000000020";
const PERSONAL_ORG = "00000000-0000-4000-8000-000000000011";

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
        display_price_text: "$199",
        provider_price_ref: "price_x",
    },
]);

function daysFromNow(days: number): string {
    return new Date(Date.now() + days * 86_400_000).toISOString();
}

function fakeDb(opts: {
    subscription?: SubscriptionRow | null;
    personalOrg?: string | null;
}): Db {
    const build = (table: string) => {
        const builder = {
            select: () => builder,
            eq: () => builder,
            maybeSingle: () => {
                if (table === "org_subscriptions")
                    return Promise.resolve({
                        data: opts.subscription ?? null,
                        error: null,
                    });
                if (table === "organizations")
                    return Promise.resolve({
                        data: opts.personalOrg ? { id: opts.personalOrg } : null,
                        error: null,
                    });
                return Promise.resolve({ data: null, error: null });
            },
        };
        return builder;
    };
    return { from: (table: string) => build(table) } as unknown as Db;
}

const sub = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
    org_id: ORG,
    plan_key: null,
    status: "trialing",
    seat_limit: null,
    trial_ends_at: null,
    current_period_end: null,
    ...over,
});

describe("blocksHostedModels", () => {
    it("blocks an expired trial, past due and canceled", () => {
        expect(blocksHostedModels(sub({ trial_ends_at: daysFromNow(-1) }))).toBe(true);
        expect(blocksHostedModels(sub({ status: "past_due" }))).toBe(true);
        expect(blocksHostedModels(sub({ status: "canceled" }))).toBe(true);
    });
    it("lets a running trial, active, none and no row through", () => {
        expect(blocksHostedModels(sub({ trial_ends_at: daysFromNow(5) }))).toBe(false);
        expect(blocksHostedModels(sub({ status: "trialing", trial_ends_at: null }))).toBe(false);
        expect(blocksHostedModels(sub({ status: "active", trial_ends_at: daysFromNow(-1) }))).toBe(false);
        expect(blocksHostedModels(sub({ status: "none" }))).toBe(false);
        expect(blocksHostedModels(null)).toBe(false);
    });
});

describe("effectiveSeatLimit", () => {
    it("is null with plans off and never reads the database", async () => {
        let touched = false;
        const db = { from: () => { touched = true; throw new Error("should not query"); } } as unknown as Db;
        expect(await effectiveSeatLimit(db, ORG, {})).toBeNull();
        expect(touched).toBe(false);
    });
    it("uses the override, then the plan, then null", async () => {
        const env = { PLANS_ENABLED: "true", PLANS_CATALOG_JSON: CATALOG };
        expect(
            await effectiveSeatLimit(
                fakeDb({ subscription: sub({ plan_key: "included", seat_limit: 3 }) }),
                ORG,
                env,
            ),
        ).toBe(3);
        expect(
            await effectiveSeatLimit(
                fakeDb({ subscription: sub({ plan_key: "included" }) }),
                ORG,
                env,
            ),
        ).toBe(25);
        expect(
            await effectiveSeatLimit(fakeDb({ subscription: sub() }), ORG, env),
        ).toBeNull();
        expect(await effectiveSeatLimit(fakeDb({ subscription: null }), ORG, env)).toBeNull();
    });
});

describe("resolveOrgEntitlement", () => {
    it("is unlimited and unblocked with plans off, without a plan read", async () => {
        const ent = await resolveOrgEntitlement(fakeDb({}), ORG, {});
        expect(ent).toMatchObject({
            plansEnabled: false,
            seatLimit: null,
            deploymentTokenAllowance: null,
            blocksHostedModels: false,
            plan: null,
            status: null,
        });
    });
    it("reads the plan and status with plans on", async () => {
        const env = { PLANS_ENABLED: "true", PLANS_CATALOG_JSON: CATALOG };
        const ent = await resolveOrgEntitlement(
            fakeDb({ subscription: sub({ plan_key: "included", status: "active" }) }),
            ORG,
            env,
        );
        expect(ent.plan?.name).toBe("Included AI");
        expect(ent.status).toBe("active");
        expect(ent.seatLimit).toBe(25);
        expect(ent.deploymentTokenAllowance).toBe(1_000_000);
        expect(ent.blocksHostedModels).toBe(false);
    });
});

describe("planDeploymentAllowance", () => {
    const env = {
        PLANS_ENABLED: "true",
        PLANS_CATALOG_JSON: CATALOG,
        DEPLOYMENT_KEY_MONTHLY_TOKEN_CAP: "500",
    };
    const ctx = (over: Partial<UsageContext> = {}): UsageContext =>
        ({ surface: "chat", orgId: ORG, userId: USER, ...over }) as UsageContext;

    it("keeps the deployment default for the person scope", async () => {
        const allowance = planDeploymentAllowance(env, () => fakeDb({}));
        expect(await allowance(ctx(), "person")).toBe(500);
    });

    it("blocks hosted-model use (zero) for an expired trial workspace", async () => {
        const allowance = planDeploymentAllowance(env, () =>
            fakeDb({ subscription: sub({ trial_ends_at: daysFromNow(-1) }) }),
        );
        // The W06 cap refuses a call once used >= the allowance, so a zero
        // allowance stops every hosted-model call before the provider is hit;
        // a person's own key is never consulted (keySource !== 'env').
        expect(await allowance(ctx(), "workspace")).toBe(0);
    });

    it("blocks a past-due and a canceled workspace", async () => {
        for (const status of ["past_due", "canceled"] as const) {
            const allowance = planDeploymentAllowance(env, () =>
                fakeDb({ subscription: sub({ status }) }),
            );
            expect(await allowance(ctx(), "workspace")).toBe(0);
        }
    });

    it("uses the plan's allowance for an active workspace", async () => {
        const allowance = planDeploymentAllowance(env, () =>
            fakeDb({ subscription: sub({ plan_key: "included", status: "active" }) }),
        );
        expect(await allowance(ctx(), "workspace")).toBe(1_000_000);
    });

    it("falls back to the deployment cap when the plan sets no allowance", async () => {
        const allowance = planDeploymentAllowance(env, () =>
            fakeDb({ subscription: sub({ status: "active" }) }),
        );
        expect(await allowance(ctx(), "workspace")).toBe(500);
    });

    it("resolves a personal workspace by its hidden organization", async () => {
        const allowance = planDeploymentAllowance(env, () =>
            fakeDb({
                personalOrg: PERSONAL_ORG,
                subscription: sub({ org_id: PERSONAL_ORG, trial_ends_at: daysFromNow(-1) }),
            }),
        );
        // orgId null => resolve the person's personal org, then its trial.
        expect(await allowance(ctx({ orgId: null }), "workspace")).toBe(0);
    });

    it("falls back to the cap for a workspace it cannot resolve", async () => {
        const allowance = planDeploymentAllowance(env, () =>
            fakeDb({ personalOrg: null }),
        );
        expect(await allowance(ctx({ orgId: null, userId: undefined }), "workspace")).toBe(500);
    });
});
