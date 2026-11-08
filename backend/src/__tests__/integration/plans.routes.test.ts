// SPDX-License-Identifier: AGPL-3.0-only
//
// GET /plans and GET /plans/me as the plans router answers them: public plans
// only, never a provider price reference, and the caller's own workspace plan.
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../lib/supabase";

const holder = vi.hoisted(() => ({ fake: null as Db | null }));

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
        next();
    },
}));

vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => {
        if (!holder.fake) throw new Error("fake db not set");
        return holder.fake;
    },
}));

// Imported after the mocks are registered.
const { plansRouter } = await import("../../modules/plans/plans.routes");

const USER = "00000000-0000-4000-8000-000000000020";
const PERSONAL = "00000000-0000-4000-8000-000000000011";

const CATALOG = JSON.stringify([
    {
        key: "byok",
        name: "Bring your own key",
        description: "Your key.",
        seat_limit: 5,
        features: ["Your key"],
        deployment_token_allowance: null,
        trial_days: 14,
        public: true,
        sort_order: 1,
        display_price_text: "$12",
        provider_price_ref: "price_byok_SECRET",
    },
    {
        key: "internal",
        name: "Internal",
        description: "",
        features: [],
        public: false,
        sort_order: 99,
        display_price_text: "",
        provider_price_ref: "price_internal_SECRET",
    },
]);

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/plans", plansRouter);
    return app;
}

function fakeDb(opts: {
    personalOrg?: string | null;
    subscription?: Record<string, unknown> | null;
}): Db {
    const from = () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "is", "in", "order", "limit"])
            chain[m] = () => chain;
        chain.maybeSingle = () => {
            // organizations lookup carries a personal_user_id filter; the only
            // two tables read here are organizations and org_subscriptions.
            return Promise.resolve({ data: current.data, error: null });
        };
        let current: { data: unknown } = { data: null };
        chain.select = (cols?: string) => {
            current = {
                data: cols === "id"
                    ? opts.personalOrg
                        ? { id: opts.personalOrg }
                        : null
                    : opts.subscription ?? null,
            };
            return chain;
        };
        return chain;
    };
    return {
        from: () => from(),
        rpc: (fn: string) =>
            Promise.resolve({
                data:
                    fn === "org_seat_state"
                        ? [{ member_count: 1, pending_invite_count: 0 }]
                        : [],
                error: null,
            }),
    } as unknown as Db;
}

beforeEach(() => {
    delete process.env.PLANS_ENABLED;
    delete process.env.PLANS_CATALOG_JSON;
    holder.fake = fakeDb({});
});
afterEach(() => {
    delete process.env.PLANS_ENABLED;
    delete process.env.PLANS_CATALOG_JSON;
    holder.fake = null;
});

describe("GET /plans", () => {
    it("answers without a session, so the public pricing page can read it", async () => {
        const res = await request(buildApp()).get("/plans").expect(200);
        expect(res.body).toMatchObject({ plans_enabled: false, plans: [] });
        // Counted on its own public lane, whose standard headers the response
        // carries; plans.routes.rateLimit.test.ts spends the budget itself.
        expect(res.headers["ratelimit-limit"]).toBe("120");
    });

    it("reports plans off and no plans by default", async () => {
        const res = await request(buildApp())
            .get("/plans")
            .set("x-test-user", USER)
            .expect(200);
        expect(res.body).toMatchObject({
            plans_enabled: false,
            billing_enabled: false,
            plans: [],
        });
    });

    it("returns public plans only, never a provider reference", async () => {
        process.env.PLANS_ENABLED = "true";
        process.env.PLANS_CATALOG_JSON = CATALOG;
        const res = await request(buildApp())
            .get("/plans")
            .set("x-test-user", USER)
            .expect(200);
        expect(res.body.plans_enabled).toBe(true);
        expect(res.body.plans.map((p: { key: string }) => p.key)).toEqual(["byok"]);
        expect(JSON.stringify(res.body)).not.toContain("SECRET");
        expect(JSON.stringify(res.body)).not.toContain("provider_price_ref");
    });

    it("shows a signed-out visitor the same public plans, and nothing more", async () => {
        process.env.PLANS_ENABLED = "true";
        process.env.PLANS_CATALOG_JSON = CATALOG;
        const res = await request(buildApp()).get("/plans").expect(200);
        expect(res.body.plans.map((p: { key: string }) => p.key)).toEqual(["byok"]);
        expect(res.body.billing_enabled).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain("SECRET");
        expect(JSON.stringify(res.body)).not.toContain("provider_price_ref");
    });
});

describe("GET /plans/me", () => {
    it("still requires a session", async () => {
        await request(buildApp()).get("/plans/me").expect(401);
    });

    it("returns the caller's personal workspace plan view", async () => {
        process.env.PLANS_ENABLED = "true";
        process.env.PLANS_CATALOG_JSON = CATALOG;
        holder.fake = fakeDb({
            personalOrg: PERSONAL,
            subscription: {
                org_id: PERSONAL,
                plan_key: "byok",
                status: "trialing",
                seat_limit: null,
                trial_ends_at: null,
                current_period_end: null,
            },
        });
        const res = await request(buildApp())
            .get("/plans/me")
            .set("x-test-user", USER)
            .expect(200);
        expect(res.body.plans_enabled).toBe(true);
        expect(res.body.plan.key).toBe("byok");
        expect(res.body.status).toBe("trialing");
        expect(JSON.stringify(res.body)).not.toContain("SECRET");
    });

    it("returns an empty view when there is no personal workspace", async () => {
        holder.fake = fakeDb({ personalOrg: null });
        const res = await request(buildApp())
            .get("/plans/me")
            .set("x-test-user", USER)
            .expect(200);
        expect(res.body).toMatchObject({ plan: null, seats_used: 0, usage: [] });
    });
});
