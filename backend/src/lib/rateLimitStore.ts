// SPDX-License-Identifier: AGPL-3.0-only
//
// Rate-limit lanes whose counts must hold across API replicas and restarts.
//
// express-rate-limit keeps its counters in process memory by default, so every
// replica has its own budget and a deploy resets them all. The lanes built
// here count in Postgres instead, through the check_rate_limit function
// (backend/schema.sql): one INSERT ... ON CONFLICT statement counts a request
// and opens a new window when the old one has ended, so any number of
// replicas share one count per key.
//
// Only lanes that need it use the shared store: the model-calling lanes
// (middleware/modelRateLimit.ts) and the sign-in, MFA, email and public lanes
// (app.ts). The general lane stays in memory, so ordinary requests take no
// extra round trip.
//
// Each lane chooses what happens when the store cannot answer. Model lanes
// let the request through ("allow"). Sign-in, MFA, email and public lanes
// refuse it with a 503 ("refuse"): whoever can slow the database must not
// also be able to switch off brute-force protection.
//
// Keys never reach the database in the clear. A key is a client address, a
// user id or an already hashed email; the store keeps an unsalted SHA-256
// digest of it behind the lane name. That is pseudonymisation, not
// anonymisation: hashing candidates (every IPv4 address, or the user ids and
// email addresses in the database) finds the value behind a digest, so the
// rows are personal data. A row is kept until its window ends and the next
// maintenance sweep deletes it (pruneExpiredRateLimitWindows).

import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { ParamsFlatDictionary } from "express-serve-static-core";
import rateLimit, {
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from "express-rate-limit";
import { AppError, withKind } from "./appError";
import {
  rateLimitedBody,
  schemaOutOfDateCode,
  sendInternalError,
} from "./httpError";
import { reportError } from "./observability/sentry";
import { safeError } from "./safeError";
import { createServerSupabase, type Db } from "./supabase";

/** What a lane does when the shared store cannot count a request. */
export type StoreFailurePolicy = "allow" | "refuse";

/** Where a lane keeps its counts; RATE_LIMIT_STORE picks it per process. */
export type RateLimitStoreKind = "postgres" | "memory";

/**
 * `postgres` unless RATE_LIMIT_STORE=memory. Memory keeps the counts in this
 * process only (one budget per replica, reset on restart): an opt-out for a
 * single-process install, and what the unit tests use.
 */
export function rateLimitStoreKind(
  env: NodeJS.ProcessEnv = process.env,
): RateLimitStoreKind {
  return env.RATE_LIMIT_STORE?.trim().toLowerCase() === "memory"
    ? "memory"
    : "postgres";
}

// p_window_ms is a Postgres integer; MemoryStore has the same ceiling.
const MAX_WINDOW_MS = 2_147_483_647;
// A store failure is logged locally at most once a minute per lane: an outage
// would otherwise write one line per request. Sentry has its own budget.
const LOCAL_LOG_INTERVAL_MS = 60_000;
// SQLSTATE and PostgREST codes are fixed vocabulary, safe to log.
const SAFE_CODE = /^[A-Za-z0-9_]{2,40}$/;

function failureCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    try {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && SAFE_CODE.test(code)) return code;
      current = (current as { cause?: unknown }).cause;
    } catch {
      return null;
    }
  }
  return null;
}

function readWindow(data: unknown): ClientRateLimitInfo | null {
  if (!data || typeof data !== "object") return null;
  const { hits, reset_at: resetAt } = data as {
    hits?: unknown;
    reset_at?: unknown;
  };
  if (typeof hits !== "number" || !Number.isInteger(hits) || hits < 1) {
    return null;
  }
  if (typeof resetAt !== "string") return null;
  const resetTime = new Date(resetAt);
  if (Number.isNaN(resetTime.getTime())) return null;
  return { totalHits: hits, resetTime };
}

/**
 * An express-rate-limit Store over the rate_limit_windows table. Give each
 * limiter its own instance; instances with the same lane name count together,
 * in this process or any other.
 */
export class SharedRateLimitStore implements Store {
  /** Keys counted here are visible to every replica. */
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  private lastLoggedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly lane: string,
    private readonly database: () => Db = createServerSupabase,
  ) {
    this.prefix = `${lane}:`;
  }

  init(options: Options): void {
    this.windowMs = Math.min(
      Math.max(Math.round(options.windowMs), 1),
      MAX_WINDOW_MS,
    );
  }

  /** The stored form of a key: the lane name and a digest of the key. */
  storedKey(key: string): string {
    return `${this.prefix}${createHash("sha256").update(key).digest("hex")}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    let result: { data: unknown; error: unknown };
    try {
      result = await this.database().rpc("check_rate_limit", {
        p_key: this.storedKey(key),
        p_window_ms: this.windowMs,
      });
    } catch (cause) {
      throw new AppError(
        "rate_limit.store_failed",
        "The rate-limit store could not count a request",
        { cause },
      );
    }
    if (result.error) {
      throw new AppError(
        "rate_limit.store_failed",
        "The rate-limit store could not count a request",
        { cause: result.error },
      );
    }
    const window = readWindow(result.data);
    if (!window) {
      throw new AppError(
        "rate_limit.store_invalid_response",
        "The rate-limit store returned an unreadable window",
      );
    }
    return window;
  }

  // express-rate-limit calls decrement after the response has finished, from
  // a promise nobody awaits: it must never reject.
  async decrement(key: string): Promise<void> {
    await this.quietly("decrement_rate_limit", key);
  }

  async resetKey(key: string): Promise<void> {
    await this.quietly("reset_rate_limit", key);
  }

  /** Report a store failure that the lane has decided to survive. */
  noteFailure(error: unknown): void {
    reportError(
      withKind(
        error,
        "rate_limit.store_failed",
        "The rate-limit store could not count a request",
      ),
      { level: "warning", tags: { component: "rate-limit" } },
    );
    const now = Date.now();
    if (now - this.lastLoggedAt < LOCAL_LOG_INTERVAL_MS) return;
    this.lastLoggedAt = now;
    // console.warn, not console.error: the error-level console bridge would
    // file the failure reported above a second time.
    console.warn("[rate-limit] shared store unavailable", {
      lane: this.lane,
      code: failureCode(error),
      ...safeError(error),
      ...(schemaOutOfDateCode(error)
        ? { hint: "apply the pending database migrations (migrate.sh up)" }
        : {}),
    });
  }

  private async quietly(
    fn: "decrement_rate_limit" | "reset_rate_limit",
    key: string,
  ): Promise<void> {
    try {
      const { error } = await this.database().rpc(fn, {
        p_key: this.storedKey(key),
      });
      if (error) throw error;
    } catch (cause) {
      this.noteFailure(cause);
    }
  }
}

/**
 * A lane as Express middleware. Typed with flat params, like requireAuth, so
 * mounting it first on a route keeps that route's params typed as strings.
 */
export type RateLimitLane = (
  req: Request<ParamsFlatDictionary>,
  res: Response,
  next: NextFunction,
) => void;

export type SharedRateLimitOptions = {
  /**
   * Static lane name, such as "auth-mfa". Lanes with the same name share
   * their counts, so give every distinct budget its own name.
   */
  lane: string;
  windowMs: number;
  max: number;
  /** The `detail` of the 429 body; its `code` is always rate_limited. */
  message: string;
  onStoreFailure: StoreFailurePolicy;
  /** Defaults to the client address, as express-rate-limit derives it. */
  keyGenerator?: (req: Request, res: Response) => string;
  skip?: (req: Request) => boolean;
  skipSuccessfulRequests?: boolean;
  /** Defaults to RATE_LIMIT_STORE. */
  store?: RateLimitStoreKind;
  /** The database the shared store calls; tests pass a fake. */
  database?: () => Db;
};

/**
 * A rate-limit lane with the standard RateLimit-* headers and the
 * rate_limited 429 body, counted in the shared store (or in this process when
 * RATE_LIMIT_STORE=memory), applying its store-failure policy. Build lanes at
 * module load, never inside a request handler.
 */
export function sharedRateLimit(
  options: SharedRateLimitOptions,
): RateLimitLane {
  const store =
    (options.store ?? rateLimitStoreKind()) === "postgres"
      ? new SharedRateLimitStore(options.lane, options.database)
      : undefined;
  const limiter = rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS" || options.skip?.(req) === true,
    keyGenerator: options.keyGenerator,
    skipSuccessfulRequests: options.skipSuccessfulRequests,
    message: rateLimitedBody(options.message),
    store,
    // A store error reaches the callback below, where the lane's policy
    // decides; express-rate-limit's own pass-through would only log it.
    passOnStoreError: false,
  });

  return function rateLimitLane(req, res, next): void {
    void limiter(req, res, (error?: unknown) => {
      if (error === undefined) return next();
      // Nothing more can be said once a response has started.
      if (res.headersSent) return;
      const failure = withKind(
        error,
        "rate_limit.lane_failed",
        "A rate-limit lane could not count a request",
      );
      if (options.onStoreFailure === "refuse") {
        sendInternalError(res, failure, 503);
        return;
      }
      if (store) {
        store.noteFailure(failure);
      } else {
        reportError(failure, {
          level: "warning",
          tags: { component: "rate-limit" },
        });
      }
      next();
    });
  };
}

export type PublicRateLimitOptions = Omit<
  SharedRateLimitOptions,
  "keyGenerator" | "onStoreFailure" | "skipSuccessfulRequests"
>;

/**
 * The lane for an anonymous public route, such as a form reached by a link or
 * the plan catalog: keyed by client address, counted in the shared store, and
 * refusing requests while the store cannot answer. Mount it ahead of the
 * route (in app.ts, or first on the route itself), so it runs before any
 * lookup the route makes.
 */
export function publicRateLimit(
  options: PublicRateLimitOptions,
): RateLimitLane {
  return sharedRateLimit({ ...options, onStoreFailure: "refuse" });
}

// Bounded batches keep each delete short. A sweep stops after
// PRUNE_MAX_BATCHES, so a large backlog (say, after an address-spraying
// attack) drains over a few sweeps instead of holding one.
const PRUNE_BATCH_SIZE = 5_000;
const PRUNE_MAX_BATCHES = 20;

/** Delete rate-limit windows that have ended; returns how many it deleted. */
export async function pruneExpiredRateLimitWindows(db: Db): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch += 1) {
    const { data, error } = await db.rpc("prune_rate_limit_windows", {
      p_limit: PRUNE_BATCH_SIZE,
    });
    if (error) {
      throw new AppError(
        "rate_limit.prune_failed",
        "Pruning ended rate-limit windows failed",
        { cause: error },
      );
    }
    const deleted = typeof data === "number" ? data : 0;
    total += deleted;
    if (deleted < PRUNE_BATCH_SIZE) break;
  }
  return total;
}
