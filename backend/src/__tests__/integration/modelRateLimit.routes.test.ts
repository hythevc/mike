// SPDX-License-Identifier: AGPL-3.0-only
//
// The rate-limit lanes as the real app mounts them, counted in the shared
// store (an in-memory stand-in for its SQL functions). Every request comes
// from the same address, as it would from one office.
import { createHash } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRateLimitDb } from "../helpers/rateLimitRpc";

const holder = vi.hoisted(() => {
    // Read when the lanes are built, at import: before app.ts loads.
    process.env.RATE_LIMIT_STORE = "postgres";
    process.env.RATE_LIMIT_CHAT_MAX = "2";
    process.env.RATE_LIMIT_CHAT_CREATE_MAX = "1";
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = "2";
    process.env.FRONTEND_URL = "https://app.example.test";
    return { fake: null as null | ReturnType<typeof fakeRateLimitDb> };
});

// The shared store reaches the database through createServerSupabase; every
// request below is answered (or refused) before a handler would use it.
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => {
        if (!holder.fake) throw new Error("rate-limit fake not set");
        return holder.fake.db;
    },
}));

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
        res.locals.userEmail = `${user}@example.test`;
        next();
    },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) =>
        next(),
}));

import { app } from "../../app";

const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");

// An empty body fails each handler's validation with a 400, which proves the
// request got past the limiter without any database work.
const chatTurn = (user: string) =>
    request(app).post("/chat").set("x-test-user", user).send({});

const MODEL_ROUTES = [
    "/chat",
    "/projects/00000000-0000-4000-8000-000000000001/chat",
    "/word-chat",
    "/tabular-review/00000000-0000-4000-8000-000000000002/chat",
    "/tabular-review/00000000-0000-4000-8000-000000000002/generate",
    "/playbooks/00000000-0000-4000-8000-000000000003/review",
];

beforeEach(() => {
    holder.fake = fakeRateLimitDb();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe("model-calling lanes", () => {
    it("give each user behind one address a budget of their own", async () => {
        const first = await chatTurn("user-a");
        const second = await chatTurn("user-a");
        const over = await chatTurn("user-a");
        const colleague = await chatTurn("user-b");

        expect([first.status, second.status]).toEqual([400, 400]);
        expect(first.headers["ratelimit-limit"]).toBe("2");
        expect(first.headers["ratelimit-remaining"]).toBe("1");
        expect(second.headers["ratelimit-remaining"]).toBe("0");

        expect(over.status).toBe(429);
        expect(over.body).toEqual({
            code: "rate_limited",
            detail: "Too many chat requests. Please try again later.",
        });
        expect(over.headers["ratelimit-limit"]).toBe("2");
        expect(over.headers["ratelimit-remaining"]).toBe("0");
        expect(over.headers["ratelimit-reset"]).toBeDefined();
        expect(over.headers["retry-after"]).toBeDefined();

        expect(colleague.status).toBe(400);
        expect(colleague.headers["ratelimit-remaining"]).toBe("1");
    });

    it("count a digest of the user, not the address, in the shared store", async () => {
        await chatTurn("user-a");
        await chatTurn("user-b");
        expect(holder.fake!.counted().map((call) => call.args)).toEqual([
            { p_key: `model-calls:${digest("user:user-a")}`, p_window_ms: 900_000 },
            { p_key: `model-calls:${digest("user:user-b")}`, p_window_ms: 900_000 },
        ]);
    });

    it("share one budget across every model route, mounted after sign-in", async () => {
        await chatTurn("user-a");
        await chatTurn("user-a");
        for (const path of MODEL_ROUTES) {
            const response = await request(app)
                .post(path)
                .set("x-test-user", "user-a")
                .send({});
            expect(response.status, path).toBe(429);
            expect(response.body.code, path).toBe("rate_limited");
        }

        // A request without a session is turned away by requireAuth before
        // the lane runs, so it neither counts nor is counted.
        const counted = holder.fake!.counted().length;
        const anonymous = await request(app).post("/chat").send({});
        expect(anonymous.status).toBe(401);
        expect(holder.fake!.counted()).toHaveLength(counted);
    });

    it("limit starting chats per user too", async () => {
        const start = (user: string) =>
            request(app)
                .post("/chat/create")
                .set("x-test-user", user)
                .send({ project_id: 42 });

        expect((await start("user-a")).status).toBe(400);
        const over = await start("user-a");
        expect(over.status).toBe(429);
        expect(over.body.code).toBe("rate_limited");
        expect((await start("user-b")).status).toBe(400);
    });

    it("let the request through when the store cannot answer", async () => {
        holder.fake = fakeRateLimitDb({ throwOn: () => true });
        const response = await chatTurn("user-a");
        expect(response.status).toBe(400);
        // Only the in-memory general lane's headers remain: the model lane
        // could not count this request, so it states no budget.
        expect(response.headers["ratelimit-limit"]).not.toBe("2");
    });
});

describe("sign-in and verification lanes", () => {
    it("count failed sign-ins per address in the shared store", async () => {
        const attempt = () =>
            request(app)
                .post("/auth/login")
                .set("Origin", "https://app.example.test")
                .send({});

        expect((await attempt()).status).toBe(400);
        expect((await attempt()).status).toBe(400);
        const over = await attempt();
        expect(over.status).toBe(429);
        expect(over.body).toEqual({
            code: "rate_limited",
            detail: "Too many login attempts. Please try again later.",
        });
        const lanes = holder.fake!.counted().map((call) =>
            String(call.args.p_key).split(":")[0],
        );
        expect(new Set(lanes)).toEqual(
            new Set(["auth-login-address", "auth-login-account"]),
        );
    });

    it.each([
        ["/auth/login", { email: "someone@example.test", password: "x" }],
        ["/auth/signup", { email: "someone@example.test" }],
        ["/auth/password-reset", { email: "someone@example.test" }],
        ["/auth/exchange", {}],
        ["/auth/mfa/verify", {}],
    ])("refuse %s while the store cannot answer", async (path, body) => {
        holder.fake = fakeRateLimitDb({ throwOn: () => true });
        const response = await request(app)
            .post(path)
            .set("Origin", "https://app.example.test")
            .set("x-test-user", "user-a")
            .send(body);
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
            code: "internal_error",
            detail: "Something went wrong. Please try again.",
        });
        expect(JSON.stringify(response.body)).not.toContain("connection reset");
    });
});
