// SPDX-License-Identifier: AGPL-3.0-only
//
// An in-memory stand-in for the Supabase client, covering the query shapes
// the billing module and the entitlement helpers use: select, insert, update,
// upsert and delete with eq/is/lt filters, limit, maybeSingle, and
// PostgREST-style `{ data, error }` results. Primary keys are enforced for the
// two tables billing writes, so a duplicate insert fails with 23505 exactly
// as Postgres would, which is what the webhook's idempotency rests on.
// Filters on a joined column (`organizations.deleted_at`) pass, as the fake
// holds no joins. Every write is logged so a test can assert what was
// written, or that nothing was.

import type { Db } from "../../lib/supabase";

export type Row = Record<string, unknown>;
export type FakeTables = Record<string, Row[]>;
export type FakeWrite = {
    table: string;
    op: "insert" | "update" | "upsert" | "delete";
    payload: unknown;
};

export type FakeDb = Db & {
    tables: FakeTables;
    writes: FakeWrite[];
    /** Tables whose writes fail with a generic database error. */
    failWrites: Set<string>;
};

const PRIMARY_KEYS: Record<string, string> = {
    billing_events: "event_id",
    org_subscriptions: "org_id",
};

const DEFAULTS: Record<string, () => Row> = {
    billing_events: () => ({
        received_at: new Date().toISOString(),
        processed_at: null,
    }),
    org_subscriptions: () => ({
        plan_key: null,
        status: "trialing",
        seat_limit: null,
        trial_ends_at: null,
        current_period_end: null,
        provider_customer_ref: null,
        provider_subscription_ref: null,
    }),
};

type Filter = (row: Row) => boolean;
type PgError = { code: string; message: string };
type Op = "select" | "insert" | "update" | "upsert" | "delete";

export function createFakeDb(initial: FakeTables = {}): FakeDb {
    const tables: FakeTables = {};
    for (const [name, rows] of Object.entries(initial))
        tables[name] = rows.map((row) => ({ ...row }));
    const writes: FakeWrite[] = [];
    const failWrites = new Set<string>();
    const rowsOf = (table: string): Row[] => (tables[table] ??= []);

    function from(table: string): Record<string, unknown> {
        let op: Op = "select";
        let payload: unknown;
        let onConflict: string | undefined;
        const filters: Filter[] = [];
        let limitN: number | null = null;
        let mode: "many" | "single" | "maybeSingle" = "many";
        let returning = false;

        const matches = (row: Row): boolean => filters.every((filter) => filter(row));
        const joined = (column: string): boolean => column.includes(".");

        function execute(): { data: unknown; error: PgError | null } {
            if (op !== "select" && failWrites.has(table))
                return {
                    data: null,
                    error: { code: "XX000", message: `write to ${table} failed` },
                };
            const rows = rowsOf(table);
            const key = PRIMARY_KEYS[table];
            let result: Row[] = [];
            switch (op) {
                case "select":
                    result = rows.filter(matches);
                    break;
                case "insert": {
                    const incoming = (Array.isArray(payload) ? payload : [payload]) as Row[];
                    for (const row of incoming) {
                        if (key && rows.some((existing) => existing[key] === row[key]))
                            return {
                                data: null,
                                error: {
                                    code: "23505",
                                    message: `duplicate key value violates unique constraint "${table}_pkey"`,
                                },
                            };
                    }
                    for (const row of incoming) {
                        const stored = { ...(DEFAULTS[table]?.() ?? {}), ...row };
                        rows.push(stored);
                        result.push(stored);
                    }
                    writes.push({ table, op, payload });
                    break;
                }
                case "upsert": {
                    const column = onConflict ?? key;
                    const incoming = (Array.isArray(payload) ? payload : [payload]) as Row[];
                    for (const row of incoming) {
                        const existing = column
                            ? rows.find((candidate) => candidate[column] === row[column])
                            : undefined;
                        if (existing) {
                            Object.assign(existing, row);
                            result.push(existing);
                        } else {
                            const stored = { ...(DEFAULTS[table]?.() ?? {}), ...row };
                            rows.push(stored);
                            result.push(stored);
                        }
                    }
                    writes.push({ table, op, payload });
                    break;
                }
                case "update":
                    for (const row of rows) {
                        if (!matches(row)) continue;
                        Object.assign(row, payload as Row);
                        result.push(row);
                    }
                    writes.push({ table, op, payload });
                    break;
                case "delete":
                    result = rows.filter(matches);
                    tables[table] = rows.filter((row) => !matches(row));
                    writes.push({ table, op, payload: null });
                    break;
            }
            if (limitN !== null) result = result.slice(0, limitN);
            const data = result.map((row) => ({ ...row }));
            if (mode === "many")
                return { data: op === "select" || returning ? data : null, error: null };
            if (data.length > 1)
                return {
                    data: null,
                    error: { code: "PGRST116", message: "more than one row returned" },
                };
            if (mode === "single" && data.length === 0)
                return { data: null, error: { code: "PGRST116", message: "no rows returned" } };
            return { data: data[0] ?? null, error: null };
        }

        const builder: Record<string, unknown> = {
            select: () => {
                if (op !== "select") returning = true;
                return builder;
            },
            insert: (rows: unknown) => {
                op = "insert";
                payload = rows;
                return builder;
            },
            upsert: (rows: unknown, options?: { onConflict?: string }) => {
                op = "upsert";
                payload = rows;
                onConflict = options?.onConflict;
                return builder;
            },
            update: (patch: unknown) => {
                op = "update";
                payload = patch;
                return builder;
            },
            delete: () => {
                op = "delete";
                return builder;
            },
            eq: (column: string, expected: unknown) => {
                filters.push((row) => joined(column) || row[column] === expected);
                return builder;
            },
            is: (column: string, expected: unknown) => {
                filters.push(
                    (row) => joined(column) || (row[column] ?? null) === expected,
                );
                return builder;
            },
            lt: (column: string, expected: unknown) => {
                filters.push((row) => {
                    const actual = row[column];
                    return (
                        typeof actual === "string" &&
                        typeof expected === "string" &&
                        actual < expected
                    );
                });
                return builder;
            },
            order: () => builder,
            limit: (count: number) => {
                limitN = count;
                return builder;
            },
            maybeSingle: () => {
                mode = "maybeSingle";
                return builder;
            },
            single: () => {
                mode = "single";
                return builder;
            },
            then: (
                resolve: (value: unknown) => unknown,
                reject?: (reason: unknown) => unknown,
            ) => Promise.resolve(execute()).then(resolve, reject),
        };
        return builder;
    }

    return {
        from,
        rpc: () => Promise.resolve({ data: [], error: null }),
        tables,
        writes,
        failWrites,
    } as unknown as FakeDb;
}
