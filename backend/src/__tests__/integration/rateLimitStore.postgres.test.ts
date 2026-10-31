// SPDX-License-Identifier: AGPL-3.0-only
//
// The shared rate-limit store against a real database with backend/schema.sql
// loaded. Part of `npm run test:stack` (and the Stack tests workflow); skipped
// without a database.
//
//   - With SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY the store
//     calls the functions through PostgREST with the service-role client,
//     exactly as the API does, and SUPABASE_TEST_ANON_KEY proves the browser
//     role cannot reach them.
//   - With only SUPABASE_TEST_DB_URL (any Postgres holding the schema) it
//     calls the same functions through psql.
//
// SUPABASE_TEST_DB_URL, when set, is also used to look at the stored rows.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import request from "supertest";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import {
    pruneExpiredRateLimitWindows,
    sharedRateLimit,
    SharedRateLimitStore,
} from "../../lib/rateLimitStore";
import type { Db } from "../../lib/supabase";

const run = promisify(execFile);
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const dbUrl = process.env.SUPABASE_TEST_DB_URL;
const viaPostgrest = Boolean(url && serviceKey);

async function psql(sql: string): Promise<string> {
    const { stdout } = await run("psql", [dbUrl!, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    return stdout.trim();
}

function sqlLiteral(value: unknown): string {
    if (typeof value === "number" && Number.isInteger(value)) return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
}

// The functions this suite may call through psql, and nothing else.
const RATE_LIMIT_FUNCTIONS = new Set([
    "check_rate_limit",
    "decrement_rate_limit",
    "reset_rate_limit",
    "prune_rate_limit_windows",
]);

/** A Db whose rpc runs the named function through psql. */
function psqlDb(): Db {
    return {
        rpc: async (fn: string, args: Record<string, unknown> = {}) => {
            if (!RATE_LIMIT_FUNCTIONS.has(fn)) throw new Error("unexpected function");
            const params = Object.entries(args)
                .map(([name, value]) => `${name} => ${sqlLiteral(value)}`)
                .join(", ");
            try {
                const out = await psql(`select public.${fn}(${params})`);
                return { data: out ? JSON.parse(out) : null, error: null };
            } catch (error) {
                return { data: null, error: { code: "psql_failed", cause: error } };
            }
        },
    } as unknown as Db;
}

const db: Db | null = viaPostgrest
    ? (createClient(url!, serviceKey!, {
          auth: { persistSession: false, autoRefreshToken: false },
      }) as Db)
    : dbUrl
      ? psqlDb()
      : null;

const lane = `stack-${process.pid}-${Date.now()}`;
const storedKeys = new Set<string>();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function check(key: string, windowMs: number) {
    storedKeys.add(key);
    const { data, error } = await db!.rpc("check_rate_limit", {
        p_key: key,
        p_window_ms: windowMs,
    });
    expect(error).toBeNull();
    return data as { hits: number; reset_at: string };
}

describe.skipIf(!db)("shared rate-limit store in PostgreSQL", () => {
    afterAll(async () => {
        for (const key of storedKeys) {
            await db!.rpc("reset_rate_limit", { p_key: key });
        }
    });

    it("counts two limiter instances that share the store together", async () => {
        const instance = () => {
            const app = express();
            app.post(
                "/work",
                sharedRateLimit({
                    lane,
                    windowMs: 60_000,
                    max: 3,
                    message: "Slow down.",
                    onStoreFailure: "refuse",
                    store: "postgres",
                    database: () => db!,
                    keyGenerator: () => "user:shared",
                }),
                (_req, res) => {
                    res.json({ ok: true });
                },
            );
            return app;
        };
        // Two replicas: separate limiters, separate store instances.
        const first = instance();
        const second = instance();
        storedKeys.add(new SharedRateLimitStore(lane).storedKey("user:shared"));

        const responses = [];
        for (const app of [first, second, first, second]) {
            responses.push(await request(app).post("/work"));
        }

        expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 429]);
        expect(responses.map((response) => response.headers["ratelimit-remaining"])).toEqual([
            "2", "1", "0", "0",
        ]);
        expect(responses[3].body).toEqual({ code: "rate_limited", detail: "Slow down." });
        expect(responses[3].headers["ratelimit-limit"]).toBe("3");
    });

    it.skipIf(!dbUrl)("stores only the lane name and a digest of the key", async () => {
        const stored = await psql(
            `select key from public.rate_limit_windows where key like ${sqlLiteral(`${lane}:%`)} order by key`,
        );
        expect(stored).toBe(`${lane}:${digest("user:shared")}`);
    });

    it("resets an ended window atomically under concurrent requests", async () => {
        const key = `${lane}:atomic`;
        const opened = await check(key, 1_000);
        expect(opened.hits).toBe(1);
        await sleep(1_200);

        // Every request arrives after the window ended. Exactly one of them
        // may open the next window; the rest must count inside it.
        const results = await Promise.all(
            Array.from({ length: 20 }, () => check(key, 60_000)),
        );

        expect(results.map((result) => result.hits).sort((a, b) => a - b)).toEqual(
            Array.from({ length: 20 }, (_, index) => index + 1),
        );
        const windowEnds = new Set(results.map((result) => Date.parse(result.reset_at)));
        expect(windowEnds.size).toBe(1);
        expect([...windowEnds][0]).toBeGreaterThan(Date.parse(opened.reset_at));
    });

    it("gives back requests only inside the current window", async () => {
        const key = `${lane}:giveback`;
        await check(key, 60_000);
        await check(key, 60_000);
        expect((await db!.rpc("decrement_rate_limit", { p_key: key })).error).toBeNull();
        expect((await check(key, 60_000)).hits).toBe(2);
    });

    it("prunes ended windows and keeps live ones", async () => {
        const ended = `${lane}:ended`;
        const live = `${lane}:live`;
        await check(ended, 1);
        await check(live, 60_000);
        await sleep(50);

        expect(await pruneExpiredRateLimitWindows(db!)).toBeGreaterThanOrEqual(1);

        // A pruned key starts afresh; the live one kept its count.
        expect((await check(live, 60_000)).hits).toBe(2);
        if (dbUrl) {
            expect(
                await psql(
                    `select count(*) from public.rate_limit_windows where key = ${sqlLiteral(ended)}`,
                ),
            ).toBe("0");
        }
        expect((await check(ended, 60_000)).hits).toBe(1);
    });

    it.skipIf(!viaPostgrest || !anonKey)("keeps the counters out of reach of the browser role", async () => {
        const anon = createClient(url!, anonKey!, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const called = await anon.rpc("check_rate_limit", {
            p_key: `${lane}:anon`,
            p_window_ms: 60_000,
        });
        expect(called.error).not.toBeNull();
        expect(called.data).toBeNull();
        const pruned = await anon.rpc("prune_rate_limit_windows", { p_limit: 1 });
        expect(pruned.error).not.toBeNull();
        const read = await anon.from("rate_limit_windows").select("key").limit(1);
        expect(read.data ?? []).toEqual([]);
    });
});
