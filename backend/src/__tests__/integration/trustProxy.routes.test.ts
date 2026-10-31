// SPDX-License-Identifier: AGPL-3.0-only
//
// TRUST_PROXY_HOPS as the real app applies it: which X-Forwarded-For entry,
// if any, becomes the client address that the per-address lanes count. The
// app reads the setting when it is imported, so each case imports its own.
import { createHash } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { fakeRateLimitDb } from "../helpers/rateLimitRpc";

const holder = vi.hoisted(() => {
    // Read when the lanes are built, at import: before app.ts loads.
    process.env.RATE_LIMIT_STORE = "postgres";
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = "2";
    process.env.FRONTEND_URL = "https://app.example.test";
    return { fake: null as null | ReturnType<typeof fakeRateLimitDb> };
});

// The shared store reaches the database through createServerSupabase; a
// sign-in with an empty body is refused before anything else would use it.
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: () => {
        if (!holder.fake) throw new Error("rate-limit fake not set");
        return holder.fake.db;
    },
}));

// Importing the whole app can be slow on a busy machine.
const IMPORT_TIMEOUT_MS = 60_000;

async function importApp(trustProxyHops: string | undefined): Promise<Express> {
    if (trustProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = trustProxyHops;
    vi.resetModules();
    return (await import("../../app.js")).app;
}

const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");

// An empty body fails validation with a 400, which the sign-in lane counts.
const failedSignIn = (app: Express, forwardedFor: string) =>
    request(app)
        .post("/auth/login")
        .set("Origin", "https://app.example.test")
        .set("X-Forwarded-For", forwardedFor)
        .send({});

/** The stored keys the per-address sign-in lane counted, in order. */
function addressKeys(): string[] {
    const counted = holder.fake?.counted() ?? [];
    return counted
        .map((call) => String(call.args.p_key))
        .filter((key) => key.startsWith("auth-login-address:"));
}

beforeEach(() => {
    holder.fake = fakeRateLimitDb();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
});
afterAll(() => {
    delete process.env.TRUST_PROXY_HOPS;
});

describe("TRUST_PROXY_HOPS=0", () => {
    let app: Express;
    beforeAll(async () => {
        app = await importApp("0");
    }, IMPORT_TIMEOUT_MS);

    it("ignores X-Forwarded-For, so forged addresses share one budget", async () => {
        const first = await failedSignIn(app, "198.51.100.1");
        const second = await failedSignIn(app, "198.51.100.2");
        const third = await failedSignIn(app, "198.51.100.3");

        expect([first.status, second.status]).toEqual([400, 400]);
        expect(third.status).toBe(429);
        expect(third.body).toEqual({
            code: "rate_limited",
            detail: "Too many login attempts. Please try again later.",
        });
        // Every attempt counted against the address of the connection.
        expect(addressKeys()).toEqual(
            Array(3).fill(`auth-login-address:${digest("127.0.0.1")}`),
        );
        expect(app.get("trust proxy")).toBe(0);
    });
});

describe("TRUST_PROXY_HOPS unset", () => {
    let app: Express;
    beforeAll(async () => {
        app = await importApp(undefined);
    }, IMPORT_TIMEOUT_MS);

    it("keys on the right-most entry, the one the trusted proxy wrote", async () => {
        // Entries to the left of the last one are whatever the caller sent.
        const first = await failedSignIn(app, "203.0.113.9, 198.51.100.7");
        const second = await failedSignIn(app, "203.0.113.9, 198.51.100.8");

        expect([first.status, second.status]).toEqual([400, 400]);
        expect(addressKeys()).toEqual([
            `auth-login-address:${digest("198.51.100.7")}`,
            `auth-login-address:${digest("198.51.100.8")}`,
        ]);
        expect(app.get("trust proxy")).toBe(1);
    });
});
