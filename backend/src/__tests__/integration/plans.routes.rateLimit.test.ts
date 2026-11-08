// SPDX-License-Identifier: AGPL-3.0-only
//
// GET /plans counts on its own public lane (plans-public). The lane is built
// when the router module loads, so this file sets a small budget before
// importing it and, like every Vitest file, runs in its own module registry;
// the vitest config keeps every lane in memory (RATE_LIMIT_STORE=memory).
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

// GET /plans/me is not exercised here; a session is never present.
vi.mock("../../middleware/auth", () => ({
    requireAuth: (
        _req: unknown,
        res: { status(code: number): { json(body: unknown): void } },
    ) => {
        res.status(401).json({ detail: "Invalid or expired session" });
    },
}));

// The public route is configuration only: a database call would be a bug.
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => {
        throw new Error("GET /plans must not touch the database");
    },
}));

process.env.RATE_LIMIT_PLANS_PUBLIC_MAX = "2";
const { plansRouter } = await import("../../modules/plans/plans.routes");

afterAll(() => {
    delete process.env.RATE_LIMIT_PLANS_PUBLIC_MAX;
});

function buildApp() {
    const app = express();
    app.use("/plans", plansRouter);
    return app;
}

describe("GET /plans public lane", () => {
    it("serves the budget, then answers 429 with the rate_limited body", async () => {
        const app = buildApp();
        const first = await request(app).get("/plans").expect(200);
        expect(first.headers["ratelimit-limit"]).toBe("2");
        expect(first.headers["ratelimit-remaining"]).toBe("1");
        await request(app).get("/plans").expect(200);

        const over = await request(app).get("/plans");
        expect(over.status).toBe(429);
        expect(over.body).toEqual({
            code: "rate_limited",
            detail: "Too many requests. Please try again later.",
        });
        expect(over.headers["ratelimit-remaining"]).toBe("0");
        expect(over.headers["retry-after"]).toBeDefined();
    });
});
