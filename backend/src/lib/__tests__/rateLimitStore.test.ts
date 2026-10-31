// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import express from "express";
import type { Options } from "express-rate-limit";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRateLimitDb } from "../../__tests__/helpers/rateLimitRpc";
import type { Db } from "../supabase";

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../observability/sentry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../observability/sentry")>()),
  reportError,
}));

import { AppError } from "../appError";
import {
  publicRateLimit,
  pruneExpiredRateLimitWindows,
  rateLimitStoreKind,
  sharedRateLimit,
  SharedRateLimitStore,
  type RateLimitLane,
  type SharedRateLimitOptions,
} from "../rateLimitStore";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** One POST route behind `lane`; the handler answers `status`. */
function serve(lane: RateLimitLane, status = 200) {
  const handler = vi.fn((_req: express.Request, res: express.Response) => {
    res.status(status).json({ ok: status < 400 });
  });
  const app = express();
  app.set("trust proxy", 1);
  app.post("/work", lane, handler);
  return { app, handler };
}

const byUser = (req: express.Request) => `user:${req.get("x-user") ?? "none"}`;

function lane(
  overrides: Partial<SharedRateLimitOptions> & Pick<SharedRateLimitOptions, "database">,
): RateLimitLane {
  return sharedRateLimit({
    lane: "test-lane",
    windowMs: 60_000,
    max: 2,
    message: "Slow down.",
    onStoreFailure: "refuse",
    store: "postgres",
    ...overrides,
  });
}

let warnings: unknown[][];
beforeEach(() => {
  reportError.mockReset();
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args) => {
    warnings.push(args);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("rateLimitStoreKind", () => {
  it("counts in Postgres unless the process opts into memory", () => {
    expect(rateLimitStoreKind({})).toBe("postgres");
    expect(rateLimitStoreKind({ RATE_LIMIT_STORE: "" })).toBe("postgres");
    expect(rateLimitStoreKind({ RATE_LIMIT_STORE: "redis" })).toBe("postgres");
    expect(rateLimitStoreKind({ RATE_LIMIT_STORE: " Memory " })).toBe("memory");
  });
});

describe("SharedRateLimitStore", () => {
  it("counts a digest of the key under the lane name, never the key itself", async () => {
    const fake = fakeRateLimitDb();
    const store = new SharedRateLimitStore("model-calls", () => fake.db);
    store.init({ windowMs: 900_000 } as Options);

    const first = await store.increment("user:alice");
    const second = await store.increment("user:alice");

    expect(fake.counted()).toEqual([
      {
        fn: "check_rate_limit",
        args: { p_key: `model-calls:${digest("user:alice")}`, p_window_ms: 900_000 },
      },
      expect.anything(),
    ]);
    expect(JSON.stringify(fake.calls)).not.toContain("alice");
    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(second.resetTime).toEqual(first.resetTime);
    expect(store.localKeys).toBe(false);
    expect(store.prefix).toBe("model-calls:");
  });

  it("keeps the window inside what the database accepts", async () => {
    const fake = fakeRateLimitDb();
    const store = new SharedRateLimitStore("lane", () => fake.db);
    store.init({ windowMs: 9e12 } as Options);
    await store.increment("k");
    expect(fake.calls[0].args.p_window_ms).toBe(2_147_483_647);
  });

  it("reads the timestamp format Postgres returns for the window end", async () => {
    const db = {
      rpc: vi.fn(async () => ({
        data: { hits: 3, reset_at: "2026-10-31T15:48:56.4083+00:00" },
        error: null,
      })),
    } as unknown as Db;
    const store = new SharedRateLimitStore("lane", () => db);
    await expect(store.increment("k")).resolves.toEqual({
      totalHits: 3,
      resetTime: new Date("2026-10-31T15:48:56.408Z"),
    });
  });

  it.each([
    ["a database error", fakeRateLimitDb({ failWith: () => ({ code: "08006", message: "private" }) }).db, "rate_limit.store_failed"],
    ["a dropped connection", fakeRateLimitDb({ throwOn: () => true }).db, "rate_limit.store_failed"],
    ["an unreadable answer", { rpc: async () => ({ data: { hits: 0 }, error: null }) } as unknown as Db, "rate_limit.store_invalid_response"],
    ["no answer", { rpc: async () => ({ data: null, error: null }) } as unknown as Db, "rate_limit.store_invalid_response"],
  ])("fails to count on %s with a typed error", async (_case, db, kind) => {
    const store = new SharedRateLimitStore("lane", () => db);
    const failure = await store.increment("k").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).kind).toBe(kind);
    expect((failure as Error).message).not.toContain("private");
  });

  it("gives back and resets keys without ever rejecting", async () => {
    const working = fakeRateLimitDb();
    const store = new SharedRateLimitStore("lane", () => working.db);
    await store.increment("k");
    await store.increment("k");
    await store.decrement("k");
    expect(working.windows.get(store.storedKey("k"))?.hits).toBe(1);
    await store.resetKey("k");
    expect(working.windows.has(store.storedKey("k"))).toBe(false);

    const failing = new SharedRateLimitStore(
      "lane",
      () => fakeRateLimitDb({ throwOn: () => true }).db,
    );
    await expect(failing.decrement("k")).resolves.toBeUndefined();
    await expect(failing.resetKey("k")).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError.mock.calls[0][1]).toEqual({
      level: "warning",
      tags: { component: "rate-limit" },
    });
    // One local line per minute per lane, however many calls fail.
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain("connection reset");
  });
});

describe("sharedRateLimit", () => {
  it("counts two limiter instances with one lane together", async () => {
    const fake = fakeRateLimitDb();
    const first = serve(lane({ database: () => fake.db, keyGenerator: byUser }));
    const second = serve(lane({ database: () => fake.db, keyGenerator: byUser }));

    const a = await request(first.app).post("/work").set("x-user", "alice");
    const b = await request(second.app).post("/work").set("x-user", "alice");
    const c = await request(first.app).post("/work").set("x-user", "alice");

    expect([a.status, b.status, c.status]).toEqual([200, 200, 429]);
    expect(a.headers["ratelimit-remaining"]).toBe("1");
    expect(b.headers["ratelimit-remaining"]).toBe("0");
    expect(c.body).toEqual({ code: "rate_limited", detail: "Slow down." });
    expect(c.headers["ratelimit-limit"]).toBe("2");
    expect(c.headers["ratelimit-remaining"]).toBe("0");
    expect(Number(c.headers["ratelimit-reset"])).toBeGreaterThan(0);
    expect(c.headers["retry-after"]).toBeDefined();
    expect(c.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(first.handler).toHaveBeenCalledTimes(1);
  });

  it("keeps a separate budget per key", async () => {
    const fake = fakeRateLimitDb();
    const { app } = serve(lane({ database: () => fake.db, keyGenerator: byUser }));

    for (let i = 0; i < 2; i++) {
      expect((await request(app).post("/work").set("x-user", "alice")).status).toBe(200);
    }
    expect((await request(app).post("/work").set("x-user", "alice")).status).toBe(429);
    const bob = await request(app).post("/work").set("x-user", "bob");
    expect(bob.status).toBe(200);
    expect(bob.headers["ratelimit-remaining"]).toBe("1");
  });

  it("lets requests through an allow lane while the store fails, and reports it", async () => {
    const fake = fakeRateLimitDb({ failWith: () => ({ code: "57P01", message: "private detail" }) });
    const { app, handler } = serve(lane({ database: () => fake.db, onStoreFailure: "allow" }));

    const first = await request(app).post("/work");
    const second = await request(app).post("/work");

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(first.headers["ratelimit-limit"]).toBeUndefined();
    expect(reportError).toHaveBeenCalledTimes(2);
    const [reported, context] = reportError.mock.calls[0];
    expect(reported).toBeInstanceOf(AppError);
    expect((reported as AppError).kind).toBe("rate_limit.store_failed");
    expect(context).toEqual({ level: "warning", tags: { component: "rate-limit" } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0][1]).toMatchObject({ lane: "test-lane", code: "57P01" });
    expect(JSON.stringify(warnings)).not.toContain("private detail");
  });

  it.each([
    ["errors", fakeRateLimitDb({ failWith: () => ({ code: "57P01", message: "private detail" }) })],
    ["drops the connection", fakeRateLimitDb({ throwOn: () => true })],
  ])("refuses requests on a refuse lane while the store %s", async (_case, fake) => {
    const { app, handler } = serve(lane({ database: () => fake.db, onStoreFailure: "refuse" }));

    const response = await request(app).post("/work");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: "internal_error",
      detail: "Something went wrong. Please try again.",
    });
    expect(JSON.stringify(response.body)).not.toContain("private");
    expect(handler).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      expect.any(AppError),
      expect.objectContaining({
        tags: expect.objectContaining({ component: "http", http_status: 503 }),
      }),
    );
  });

  it("tells the operator to migrate when the counting function is missing", async () => {
    const fake = fakeRateLimitDb({ failWith: () => ({ code: "PGRST202", message: "not found" }) });
    const { app } = serve(lane({ database: () => fake.db, onStoreFailure: "refuse" }));

    const response = await request(app).post("/work");

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("schema_out_of_date");
  });

  it("gives successful requests back on a lane that only counts failures", async () => {
    const fake = fakeRateLimitDb();
    const succeeding = serve(lane({ database: () => fake.db, max: 1, skipSuccessfulRequests: true }));
    const failing = serve(lane({ database: () => fake.db, max: 1, skipSuccessfulRequests: true }), 401);

    expect((await request(succeeding.app).post("/work")).status).toBe(200);
    await vi.waitFor(() =>
      expect(fake.calls.map((call) => call.fn)).toContain("decrement_rate_limit"),
    );
    expect((await request(succeeding.app).post("/work")).status).toBe(200);
    await vi.waitFor(() =>
      expect(fake.calls.filter((call) => call.fn === "decrement_rate_limit")).toHaveLength(2),
    );

    expect((await request(failing.app).post("/work")).status).toBe(401);
    expect((await request(failing.app).post("/work")).status).toBe(429);
    expect(fake.calls.filter((call) => call.fn === "decrement_rate_limit")).toHaveLength(2);
  });

  it("counts in this process only when RATE_LIMIT_STORE is memory", async () => {
    const fake = fakeRateLimitDb();
    const { app } = serve(lane({ database: () => fake.db, store: "memory", max: 1 }));

    expect((await request(app).post("/work")).status).toBe(200);
    const limited = await request(app).post("/work");
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("rate_limited");
    expect(fake.calls).toEqual([]);
  });

  it("skips preflight requests", async () => {
    const fake = fakeRateLimitDb();
    const app = express();
    app.options("/work", lane({ database: () => fake.db }), (_req, res) => {
      res.sendStatus(204);
    });
    expect((await request(app).options("/work")).status).toBe(204);
    expect(fake.calls).toEqual([]);
  });
});

describe("publicRateLimit", () => {
  it("keys by client address and refuses requests while the store fails", async () => {
    const fake = fakeRateLimitDb();
    const { app } = serve(
      publicRateLimit({
        lane: "public-test",
        windowMs: 60_000,
        max: 1,
        message: "Too many submissions.",
        store: "postgres",
        database: () => fake.db,
      }),
    );

    const first = await request(app).post("/work").set("X-Forwarded-For", "203.0.113.7");
    const repeat = await request(app).post("/work").set("X-Forwarded-For", "203.0.113.7");
    const other = await request(app).post("/work").set("X-Forwarded-For", "198.51.100.4");
    expect([first.status, repeat.status, other.status]).toEqual([200, 429, 200]);
    expect(repeat.body).toEqual({ code: "rate_limited", detail: "Too many submissions." });
    expect(fake.counted().map((call) => call.args.p_key)).toEqual([
      `public-test:${digest("203.0.113.7")}`,
      `public-test:${digest("203.0.113.7")}`,
      `public-test:${digest("198.51.100.4")}`,
    ]);

    const broken = fakeRateLimitDb({ throwOn: () => true });
    const down = serve(
      publicRateLimit({
        lane: "public-test",
        windowMs: 60_000,
        max: 1,
        message: "Too many submissions.",
        store: "postgres",
        database: () => broken.db,
      }),
    );
    const refused = await request(down.app).post("/work");
    expect(refused.status).toBe(503);
    expect(down.handler).not.toHaveBeenCalled();
  });
});

describe("pruneExpiredRateLimitWindows", () => {
  it("deletes ended windows in bounded batches and keeps live ones", async () => {
    const fake = fakeRateLimitDb();
    const ended = Date.now() - 1_000;
    for (let i = 0; i < 12_000; i++) {
      fake.windows.set(`lane:ended-${i}`, { hits: 1, resetAt: ended });
    }
    fake.windows.set("lane:live", { hits: 4, resetAt: Date.now() + 60_000 });

    await expect(pruneExpiredRateLimitWindows(fake.db)).resolves.toBe(12_000);

    expect(fake.calls).toEqual([
      { fn: "prune_rate_limit_windows", args: { p_limit: 5_000 } },
      { fn: "prune_rate_limit_windows", args: { p_limit: 5_000 } },
      { fn: "prune_rate_limit_windows", args: { p_limit: 5_000 } },
    ]);
    expect([...fake.windows.keys()]).toEqual(["lane:live"]);
  });

  it("stops after its batch cap so one sweep stays bounded", async () => {
    const rpc = vi.fn(async () => ({ data: 5_000, error: null }));
    await expect(
      pruneExpiredRateLimitWindows({ rpc } as unknown as Db),
    ).resolves.toBe(100_000);
    expect(rpc).toHaveBeenCalledTimes(20);
  });

  it("fails with a typed error the sweep can report", async () => {
    const fake = fakeRateLimitDb({ failWith: () => ({ code: "42501", message: "private" }) });
    const failure = await pruneExpiredRateLimitWindows(fake.db).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).kind).toBe("rate_limit.prune_failed");
    expect((failure as Error).message).not.toContain("private");
  });
});
