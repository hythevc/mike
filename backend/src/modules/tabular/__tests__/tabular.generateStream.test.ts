import { describe, it, expect, vi, afterEach } from "vitest";

const { redisEnabled, reportError, redisConnect } = vi.hoisted(() => ({
    redisEnabled: vi.fn(() => false),
    reportError: vi.fn(),
    redisConnect: vi.fn(),
}));
vi.mock("../../../lib/dbq/driver", () => ({
    redisEnabled: () => redisEnabled(),
}));
vi.mock("../../../lib/observability/sentry", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("../../../lib/observability/sentry")
    >()),
    reportError,
}));
// A subscriber whose connection fails the way a down or misconfigured Redis
// does: the constructor throws.
vi.mock("ioredis", () => ({
    default: class {
        constructor() {
            redisConnect();
        }
    },
}));

import { AppError } from "../../../lib/appError";
import {
    awaitCellTerminal,
    cellUpdateRowId,
    streamTabularRunView,
    targetPendingCells,
} from "../tabular.generateStream";

const COLUMNS = [
    { index: 0, name: "A", prompt: "a" },
    { index: 1, name: "B", prompt: "b" },
];
const ROWS = [{ id: "row-1" }, { id: "row-2" }];

function cellMapOf(entries: [string, Record<string, unknown>][]) {
    return new Map(entries);
}

describe("cellUpdateRowId", () => {
    it("names the row of a cell frame and nothing else", () => {
        expect(
            cellUpdateRowId(
                'id: 3\ndata: {"type":"cell_update","row_id":"row-1","column_index":0,"content":null,"status":"generating"}\n\n',
            ),
        ).toBe("row-1");
        expect(cellUpdateRowId('id: 4\ndata: {"type":"error","message":"x"}\n\n')).toBeNull();
        expect(cellUpdateRowId("id: 5\ndata: [DONE]\n\n")).toBeNull();
        expect(cellUpdateRowId(": keepalive\n\n")).toBeNull();
    });
});

describe("targetPendingCells", () => {
    it("treats every cell as pending when there are no cells yet", () => {
        const { rowIds, pending } = targetPendingCells(
            COLUMNS,
            ROWS,
            cellMapOf([]),
        );
        expect(rowIds).toEqual(["row-1", "row-2"]);
        expect([...pending].sort()).toEqual([
            "row-1:0",
            "row-1:1",
            "row-2:0",
            "row-2:1",
        ]);
    });

    it("excludes cells that are done with content, and drops fully-done rows", () => {
        const { rowIds, pending } = targetPendingCells(COLUMNS, ROWS, cellMapOf([
            ["row-1:0", { status: "done", content: "{}" }],
            ["row-1:1", { status: "done", content: "{}" }],
            ["row-2:0", { status: "done", content: "{}" }],
            // row-2:1 missing → still pending
        ]));
        // row-1 is fully done → not enqueued; row-2 has one outstanding column.
        expect(rowIds).toEqual(["row-2"]);
        expect([...pending]).toEqual(["row-2:1"]);
    });

    it("keeps a done-but-empty cell pending (content required, not just status)", () => {
        const { pending } = targetPendingCells(COLUMNS, [{ id: "row-1" }], cellMapOf([
            ["row-1:0", { status: "done", content: null }],
            ["row-1:1", { status: "error", content: null }],
        ]));
        expect([...pending].sort()).toEqual(["row-1:0", "row-1:1"]);
    });
});

// ---------------------------------------------------------------------------
// awaitCellTerminal — the "view" half of an async regenerate-cell.
// ---------------------------------------------------------------------------

// Read-only Supabase double: it records every call so the tests can assert the
// wait loop never writes (the worker owns the cell and its generation lease).
function makeCellDb(rows: Record<string, unknown>[]) {
    const calls: { op: string; filters: Record<string, unknown> }[] = [];
    let reads = 0;
    function from(_table: string) {
        const state = { op: "select", filters: {} as Record<string, unknown> };
        const b: Record<string, unknown> = {
            select() {
                return b;
            },
            update() {
                state.op = "update";
                return b;
            },
            eq(col: string, val: unknown) {
                state.filters[col] = val;
                return b;
            },
            maybeSingle() {
                calls.push({ op: state.op, filters: { ...state.filters } });
                // Successive polls walk `rows`, so a test can start "still
                // generating" and then go terminal.
                const row = rows[Math.min(reads, rows.length - 1)] ?? null;
                reads += 1;
                return Promise.resolve({ data: row, error: null });
            },
        };
        return b;
    }
    return { calls, from };
}

const WAIT_ARGS = {
    reviewId: "rev-1",
    rowId: "row-1",
    columnIndex: 1,
    log: console,
    pollMs: 1,
};

describe("awaitCellTerminal", () => {
    afterEach(() => {
        delete process.env.ASYNC_TABULAR_EXTRACTION;
        vi.restoreAllMocks();
    });

    it("resolves from the DB backstop once the worker writes 'done'", async () => {
        const db = makeCellDb([
            { status: "generating", content: null },
            { status: "done", content: JSON.stringify({ summary: "hi" }) },
        ]);

        const terminal = await awaitCellTerminal({
            db: db as never,
            ...WAIT_ARGS,
            timeoutMs: 1_000,
        });

        expect(terminal).toEqual({
            status: "done",
            content: { summary: "hi", flag: undefined, reasoning: "" },
        });
        // Never writes: the worker owns the cell's terminal state and its lease.
        expect(db.calls.every((c) => c.op === "select")).toBe(true);
    });

    it("resolves 'error' when the worker's failure handler wins", async () => {
        const db = makeCellDb([{ status: "error", content: null }]);

        const terminal = await awaitCellTerminal({
            db: db as never,
            ...WAIT_ARGS,
            timeoutMs: 1_000,
        });

        expect(terminal).toEqual({ status: "error" });
    });

    it("returns null when the wait budget elapses (route answers 202)", async () => {
        const db = makeCellDb([{ status: "generating", content: null }]);

        const terminal = await awaitCellTerminal({
            db: db as never,
            ...WAIT_ARGS,
            timeoutMs: 20,
        });

        // null == "still running": the job (and the lease it holds) outlives
        // this request, so nothing here may finish either.
        expect(terminal).toBeNull();
        expect(db.calls.every((c) => c.op === "select")).toBe(true);
    });

    it("falls back to the DB poll and reports a failed subscribe under its kind", async () => {
        process.env.ASYNC_TABULAR_EXTRACTION = "true";
        redisEnabled.mockReturnValue(true);
        const cause = Object.assign(new Error("connect refused"), {
            code: "ECONNREFUSED",
        });
        redisConnect.mockImplementation(() => {
            throw cause;
        });
        const log = { error: vi.fn() };
        const db = makeCellDb([
            { status: "done", content: JSON.stringify({ summary: "x" }) },
        ]);

        const terminal = await awaitCellTerminal({
            db: db as never,
            ...WAIT_ARGS,
            log,
            timeoutMs: 1_000,
        });

        // Degraded, not failed: the backstop still resolved the cell.
        expect(terminal).toEqual({
            status: "done",
            content: { summary: "x", flag: undefined, reasoning: "" },
        });
        expect(reportError).toHaveBeenCalledTimes(1);
        const [reported] = reportError.mock.calls[0];
        expect(reported).toBeInstanceOf(AppError);
        expect(reported.kind).toBe("tabular.stream_failed");
        expect(reported.cause).toBe(cause);
        // The log carries the reported object; the bridge files it once.
        expect(log.error).toHaveBeenCalledWith(
            "[tabular/regenerate-async] subscribe failed",
            expect.objectContaining({ err: reported }),
        );
        redisEnabled.mockReturnValue(false);
        redisConnect.mockReset();
    });

    it("does not dial Redis in synchronous deployments", async () => {
        const db = makeCellDb([
            { status: "done", content: JSON.stringify({ summary: "x" }) },
        ]);

        await awaitCellTerminal({
            db: db as never,
            ...WAIT_ARGS,
            timeoutMs: 1_000,
        });

        // Flag unset above — the DB poll alone resolved it.
        expect(process.env.ASYNC_TABULAR_EXTRACTION).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// The DB-poll backstop of a tailing view (no pub/sub here: the flag is off).
// ---------------------------------------------------------------------------

describe("the run view's database backstop", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    function makeResponse() {
        const chunks: string[] = [];
        const res = {
            writableEnded: false,
            setHeader: vi.fn(),
            flushHeaders: vi.fn(),
            on: vi.fn(),
            write(chunk: string) {
                chunks.push(chunk);
                return true;
            },
            end() {
                res.writableEnded = true;
            },
        };
        const frames = () =>
            chunks
                .filter((chunk) => chunk.startsWith("data: {"))
                .map((chunk) => JSON.parse(chunk.slice("data: ".length)));
        return { res, chunks, frames };
    }

    function makeCellsDb(cells: Record<string, unknown>[]) {
        const queries: { columns: string; filters: Record<string, unknown> }[] = [];
        const from = (_table: string) => {
            const query = { columns: "", filters: {} as Record<string, unknown> };
            const builder = {
                select(columns: string) {
                    query.columns = columns;
                    return builder;
                },
                eq(column: string, value: unknown) {
                    query.filters[column] = value;
                    return builder;
                },
                in(column: string, values: unknown[]) {
                    query.filters[column] = values;
                    queries.push(query);
                    return Promise.resolve({ data: cells, error: null });
                },
            };
            return builder;
        };
        return { db: { from } as never, queries };
    }

    it("resolves pending cells from the database, a done frame with its quote status only", async () => {
        vi.useFakeTimers();
        const { res, chunks, frames } = makeResponse();
        const { db, queries } = makeCellsDb([
            {
                row_id: "row-1",
                column_index: 0,
                status: "done",
                content: JSON.stringify({ summary: "Rent", flag: "green", reasoning: "" }),
                quote_status: "partly_found",
                quote_checks: [
                    {
                        field: "summary",
                        quote: "pay rent",
                        document_id: "doc-a",
                        status: "found",
                        source_excerpt: "pay rent",
                        context_before: "The Tenant shall",
                    },
                    {
                        field: "reasoning",
                        quote: "rent is waived",
                        document_id: "doc-a",
                        status: "not_found",
                    },
                ],
            },
            {
                row_id: "row-1",
                column_index: 1,
                status: "error",
                content: null,
                quote_status: null,
                quote_checks: null,
            },
            // A cell this view is not waiting for is not forwarded.
            { row_id: "row-1", column_index: 2, status: "done", content: "{}" },
        ]);

        const viewing = streamTabularRunView({
            res: res as never,
            db,
            reviewId: "rev-1",
            columns: [
                { index: 0, name: "Rent", prompt: "rent" },
                { index: 1, name: "Term", prompt: "term" },
            ],
            rows: [{ id: "row-1" } as never],
            cellMap: new Map([["row-1:2", { status: "done", content: "{}" }]]),
            log: console,
        });
        await viewing;
        await vi.advanceTimersByTimeAsync(3_000);

        // Only the rows with a pending cell are read, without source versions.
        expect(queries).toHaveLength(1);
        expect(queries[0].filters).toEqual({ review_id: "rev-1", row_id: ["row-1"] });
        expect(queries[0].columns).toContain("quote_status");
        expect(queries[0].columns).not.toContain("source_versions");

        const [done, failed] = frames();
        expect(done).toEqual({
            type: "cell_update",
            row_id: "row-1",
            column_index: 0,
            content: { summary: "Rent", flag: "green", reasoning: "" },
            status: "done",
            quote_status: "partly_found",
            quote_outcomes: [
                { field: "summary", status: "found" },
                { field: "reasoning", status: "not_found" },
            ],
        });
        expect(failed).toEqual({
            type: "cell_update",
            row_id: "row-1",
            column_index: 1,
            content: null,
            status: "error",
        });
        expect(frames()).toHaveLength(2);
        expect(chunks.at(-1)).toBe("data: [DONE]\n\n");
        expect(res.writableEnded).toBe(true);
    });
});
