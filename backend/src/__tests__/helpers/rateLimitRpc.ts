// SPDX-License-Identifier: AGPL-3.0-only
//
// An in-memory stand-in for the rate-limit functions in backend/schema.sql
// (check_rate_limit, decrement_rate_limit, reset_rate_limit,
// prune_rate_limit_windows), with the same fixed-window semantics, for suites
// that exercise the shared store without a database. The SQL itself is
// covered by integration/rateLimitStore.postgres.test.ts.
import { vi } from "vitest";
import type { Db } from "../../lib/supabase";

export type RateLimitRpcCall = { fn: string; args: Record<string, unknown> };

export function fakeRateLimitDb(
    options: {
        /** Return a value to fail that call with it as the supabase error. */
        failWith?: (call: RateLimitRpcCall) => unknown;
        /** Throw instead of answering, as a dropped connection would. */
        throwOn?: (call: RateLimitRpcCall) => boolean;
    } = {},
) {
    const windows = new Map<string, { hits: number; resetAt: number }>();
    const calls: RateLimitRpcCall[] = [];
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
        const call = { fn, args };
        calls.push(call);
        if (options.throwOn?.(call)) throw new Error("connection reset");
        const failure = options.failWith?.(call);
        if (failure) return { data: null, error: failure };
        const key = String(args.p_key);
        const now = Date.now();
        switch (fn) {
            case "check_rate_limit": {
                const current = windows.get(key);
                const next =
                    !current || current.resetAt <= now
                        ? { hits: 1, resetAt: now + Number(args.p_window_ms) }
                        : { hits: current.hits + 1, resetAt: current.resetAt };
                windows.set(key, next);
                return {
                    data: { hits: next.hits, reset_at: new Date(next.resetAt).toISOString() },
                    error: null,
                };
            }
            case "decrement_rate_limit": {
                const current = windows.get(key);
                if (current && current.hits > 0 && current.resetAt > now) current.hits -= 1;
                return { data: null, error: null };
            }
            case "reset_rate_limit":
                windows.delete(key);
                return { data: null, error: null };
            case "prune_rate_limit_windows": {
                let deleted = 0;
                for (const [stored, window] of windows) {
                    if (deleted >= Number(args.p_limit)) break;
                    if (window.resetAt <= now) {
                        windows.delete(stored);
                        deleted += 1;
                    }
                }
                return { data: deleted, error: null };
            }
            default:
                return { data: null, error: { code: "PGRST202", message: `unknown ${fn}` } };
        }
    });
    return {
        db: { rpc } as unknown as Db,
        rpc,
        calls,
        windows,
        /** The calls that counted a request, in order. */
        counted: () => calls.filter((call) => call.fn === "check_rate_limit"),
    };
}
