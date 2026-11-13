// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small in-memory stand-in for the Supabase client: named tables holding
 * rows, a query builder that honours the filters, and rows that writes
 * really change.
 *
 * supabaseMock.ts answers per table with a fixed result, which suits a route
 * that makes one read. It cannot tell two users apart, and a write changes
 * nothing. Suites that need the real access checks to reach a verdict from
 * what is stored (who is a member of which organization, who created which
 * project) and need to see what a write left behind use this instead.
 *
 * What it models: select / insert / update / delete with eq, neq, in and is
 * filters, `single` and `maybeSingle`, and awaiting the builder for a list.
 * What it does not: column projection (a select returns whole rows), joins
 * (a filter on an embedded resource, such as `organizations.deleted_at`, is
 * ignored), ordering and paging. Functions are whatever the suite supplies.
 */
import type { Db } from "../../lib/supabase";

export type Row = Record<string, unknown>;

export type MemoryDbCall = {
    table: string;
    op: "select" | "insert" | "update" | "delete";
    /** The column list of the last `select()`, as the code under test wrote it. */
    columns?: string;
    payload?: unknown;
    filters: [kind: string, column: string, value: unknown][];
};

type QueryResult = { data: unknown; error: unknown };

export type MemoryDbFunction = (
    args: Record<string, unknown>,
    tables: Record<string, Row[]>,
) => QueryResult;

export function memoryDb(
    options: {
        tables?: Record<string, Row[]>;
        functions?: Record<string, MemoryDbFunction>;
    } = {},
) {
    const tables: Record<string, Row[]> = structuredClone(options.tables ?? {});
    const functions = options.functions ?? {};
    const calls: MemoryDbCall[] = [];
    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    const failures: ((call: MemoryDbCall) => unknown)[] = [];
    let nextId = 1;

    const rowsOf = (table: string) => (tables[table] ??= []);

    function run(call: MemoryDbCall): QueryResult {
        calls.push(call);
        for (const failure of failures) {
            const error = failure(call);
            if (error) return { data: null, error };
        }
        const matches = (row: Row) =>
            call.filters.every(([kind, column, value]) => {
                // A filter on an embedded resource; joins are not modelled.
                if (column.includes(".")) return true;
                const actual = row[column] ?? null;
                if (kind === "eq") return actual === value;
                if (kind === "neq") return actual !== value;
                if (kind === "is") return actual === value;
                if (kind === "in")
                    return (value as unknown[]).includes(actual);
                return true;
            });
        const rows = rowsOf(call.table);
        if (call.op === "insert") {
            const added = (
                Array.isArray(call.payload) ? call.payload : [call.payload]
            ).map((row) => ({ id: `id-${nextId++}`, ...(row as Row) }));
            rows.push(...added);
            return { data: structuredClone(added), error: null };
        }
        const hit = rows.filter(matches);
        if (call.op === "update")
            for (const row of hit) Object.assign(row, call.payload as Row);
        if (call.op === "delete")
            tables[call.table] = rows.filter((row) => !hit.includes(row));
        return { data: structuredClone(hit), error: null };
    }

    function from(table: string) {
        const call: MemoryDbCall = { table, op: "select", filters: [] };
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        for (const method of [
            "order", "limit", "range", "or", "not", "ilike", "contains",
            "lt", "lte", "gt", "gte",
        ])
            builder[method] = chain;
        builder.select = (columns?: string) => {
            call.columns = columns;
            return builder;
        };
        for (const kind of ["eq", "neq", "in", "is"])
            builder[kind] = (column: string, value: unknown) => {
                call.filters.push([kind, column, value]);
                return builder;
            };
        for (const op of ["insert", "update", "delete"] as const)
            builder[op] = (payload?: unknown) => {
                call.op = op;
                call.payload = payload;
                return builder;
            };
        builder.maybeSingle = () => {
            const result = run(call);
            if (result.error) return Promise.resolve(result);
            return Promise.resolve({
                data: (result.data as Row[])[0] ?? null,
                error: null,
            });
        };
        builder.single = () => {
            const result = run(call);
            if (result.error) return Promise.resolve(result);
            const row = (result.data as Row[])[0];
            return Promise.resolve(
                row
                    ? { data: row, error: null }
                    : {
                          data: null,
                          error: { code: "PGRST116", message: "no rows" },
                      },
            );
        };
        builder.then = (
            resolve: (value: QueryResult) => unknown,
            reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(run(call)).then(resolve, reject);
        return builder;
    }

    function rpc(fn: string, args: Record<string, unknown> = {}) {
        rpcCalls.push({ fn, args });
        const handler = functions[fn];
        return Promise.resolve(
            handler ? handler(args, tables) : { data: null, error: null },
        );
    }

    return {
        db: { from, rpc } as unknown as Db,
        /** The live rows: what a write left behind. */
        tables,
        /** Every table query, in the order it ran. */
        calls,
        rpcCalls,
        /** Make matching queries fail: return the error, or nothing to pass. */
        failWhen(failure: (call: MemoryDbCall) => unknown) {
            failures.push(failure);
        },
        /** The queries of one kind against one table. */
        callsTo(table: string, op?: MemoryDbCall["op"]) {
            return calls.filter(
                (call) => call.table === table && (!op || call.op === op),
            );
        },
    };
}
