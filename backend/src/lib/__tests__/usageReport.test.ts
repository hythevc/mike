// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
    buildUsageReport,
    formatUsageReport,
    loadUsageRows,
    parsePriceTable,
    PRICE_TABLE_VARIABLE,
    priceFor,
    runUsageReport,
    type UsageRow,
} from "../usageReport";

const PRICES = JSON.stringify({
    currency: "USD",
    models: {
        "model-a": { input: 2, output: 8 },
        "model-b*": { input: 1, output: 4, cached_input: 0.25 },
    },
});

const row = (overrides: Partial<UsageRow>): UsageRow => ({
    created_at: "2026-10-15T12:00:00Z",
    org_id: "org-1",
    user_id: "user-1",
    project_id: null,
    surface: "chat",
    model: "model-a",
    provider: "claude",
    key_source: "env",
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    document_pages: null,
    chat_id: null,
    review_id: null,
    run_id: null,
    document_id: null,
    ...overrides,
});

// A playbook run over a 10-page document, a two-row tabular generation over
// 4- and 6-page documents (one row mostly from the prompt cache), and a chat
// on a model the table does not price.
const FIXTURE: UsageRow[] = [
    row({
        surface: "playbook",
        run_id: "run-1",
        document_id: "doc-1",
        document_pages: 10,
        input_tokens: 100_000,
        output_tokens: 10_000,
    }),
    row({
        surface: "tabular",
        model: "model-b-large",
        review_id: "review-1",
        run_id: "run-2",
        document_id: "doc-2",
        document_pages: 4,
        input_tokens: 40_000,
        cached_tokens: 20_000,
        output_tokens: 2_000,
        key_source: "org",
    }),
    row({
        surface: "tabular",
        model: "model-b-large",
        review_id: "review-1",
        run_id: "run-2",
        document_id: "doc-3",
        document_pages: 6,
        input_tokens: 60_000,
        output_tokens: 3_000,
        key_source: "org",
    }),
    row({
        surface: "chat",
        model: "unpriced-model",
        chat_id: "chat-1",
        input_tokens: 5_000,
        output_tokens: 500,
        key_source: "user",
    }),
];

function table() {
    const parsed = parsePriceTable(PRICES);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.table;
}

describe("buildUsageReport", () => {
    const report = buildUsageReport(FIXTURE, table());

    it("prices each run and each run's pages", () => {
        const runs = Object.fromEntries(
            report.byRun.map((group) => [`${group.kind}:${group.id}`, group]),
        );
        // (100k × 2 + 10k × 8) / 1M
        expect(runs["run:run-1"].estimatedCost).toBeCloseTo(0.28, 10);
        expect(runs["run:run-1"].estimatedCostPerPage).toBeCloseTo(0.028, 10);
        // (20k × 1 + 20k × 0.25 + 2k × 4) / 1M + (60k × 1 + 3k × 4) / 1M
        expect(runs["run:run-2"]).toMatchObject({ calls: 2, pages: 10, surfaces: ["tabular"] });
        expect(runs["run:run-2"].estimatedCost).toBeCloseTo(0.105, 10);
        expect(runs["run:run-2"].estimatedCostPerPage).toBeCloseTo(0.0105, 10);
        // Tokens count; a model without a price adds no cost.
        expect(runs["chat:chat-1"]).toMatchObject({
            inputTokens: 5_000,
            estimatedCost: 0,
            estimatedCostPerPage: null,
            unpricedCalls: 1,
        });
        // Most expensive first.
        expect(report.byRun.map((group) => group.id)).toEqual(["run-1", "run-2", "chat-1"]);
    });

    it("prices each document and the month's pages", () => {
        const documents = Object.fromEntries(
            report.byDocument.map((group) => [group.id, group]),
        );
        expect(documents["doc-2"].estimatedCost).toBeCloseTo(0.033, 10);
        expect(documents["doc-2"].estimatedCostPerPage).toBeCloseTo(0.00825, 10);
        expect(documents["doc-3"].estimatedCostPerPage).toBeCloseTo(0.012, 10);
        expect(report.totals.pages).toBe(20);
        expect(report.totals.estimatedCost).toBeCloseTo(0.385, 10);
        expect(report.totals.estimatedCostPerPage).toBeCloseTo(0.01925, 10);
    });

    it("splits the month by whose key paid and names unpriced models", () => {
        expect(Object.keys(report.byKeySource)).toEqual(["env", "org", "user"]);
        expect(report.byKeySource.org.estimatedCost).toBeCloseTo(0.105, 10);
        expect(report.unpricedModels).toEqual([{ model: "unpriced-model", calls: 1 }]);
    });

    it("labels every cost as an estimate", () => {
        const text = formatUsageReport(report, {
            month: "2026-10",
            orgId: "org-1",
            projectId: null,
        });
        expect(text).toContain("AI usage for 2026-10 (UTC), organization org-1");
        expect(text).toContain(`Costs are estimates`);
        expect(text).toContain(PRICE_TABLE_VARIABLE);
        expect(text).toContain("est. cost (USD)");
        expect(text).toContain("est. per page (USD)");
        expect(text).toContain("20 pages read; estimated 0.0193 USD per page.");
        expect(text).toContain("unpriced-model (1 call)");
        // No cost column without its "est." label.
        expect(text).not.toMatch(/(?<!est\. )cost \(/);
    });
});

describe("parsePriceTable", () => {
    it("names the variable when it is missing or unusable", () => {
        for (const raw of [undefined, "", "  "]) {
            const parsed = parsePriceTable(raw);
            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.error).toMatch(/^USAGE_PRICE_TABLE_JSON is not set/);
        }
        expect(parsePriceTable("{not json")).toEqual({
            ok: false,
            error: "USAGE_PRICE_TABLE_JSON is not valid JSON.",
        });
        expect(parsePriceTable('{"models":{"m":{"input":-1,"output":2}}}')).toMatchObject({
            ok: false,
            error: expect.stringContaining('the price for "m"'),
        });
    });

    it("prices by exact id first, then the longest prefix", () => {
        const parsed = parsePriceTable(
            JSON.stringify({ models: { "m*": { input: 1, output: 1 }, "m-x*": { input: 2, output: 2 }, "m-x-1": { input: 3, output: 3 } } }),
        );
        if (!parsed.ok) throw new Error(parsed.error);
        expect(parsed.table.currency).toBe("USD");
        expect(priceFor(parsed.table, "m-x-1")?.input).toBe(3);
        expect(priceFor(parsed.table, "m-x-2")?.input).toBe(2);
        expect(priceFor(parsed.table, "m-y")?.input).toBe(1);
        expect(priceFor(parsed.table, "other")).toBeNull();
    });
});

describe("runUsageReport", () => {
    const io = () => ({ out: vi.fn(), err: vi.fn() });

    it("exits non-zero naming the missing variable, before reading the ledger", async () => {
        const output = io();
        const loadRows = vi.fn();
        await expect(
            runUsageReport({ argv: [], env: {}, loadRows, ...output }),
        ).resolves.toBe(1);
        expect(loadRows).not.toHaveBeenCalled();
        expect(output.err).toHaveBeenCalledWith(
            expect.stringContaining("USAGE_PRICE_TABLE_JSON is not set"),
        );
    });

    it("reads the month asked for and prints the report", async () => {
        const output = io();
        const loadRows = vi.fn(async () => FIXTURE);
        await expect(
            runUsageReport({
                argv: ["--month", "2026-02", "--org", "00000000-0000-4000-8000-000000000010", "--json"],
                env: { [PRICE_TABLE_VARIABLE]: PRICES },
                loadRows,
                ...output,
            }),
        ).resolves.toBe(0);
        expect(loadRows).toHaveBeenCalledWith({
            from: new Date("2026-02-01T00:00:00Z"),
            to: new Date("2026-03-01T00:00:00Z"),
            orgId: "00000000-0000-4000-8000-000000000010",
            projectId: null,
        });
        const printed = JSON.parse(output.out.mock.calls[0][0] as string);
        expect(printed).toMatchObject({ month: "2026-02", estimates: true, currency: "USD" });
        expect(printed.totals.estimatedCost).toBeCloseTo(0.385, 10);
    });

    it("defaults to the current month and refuses arguments it does not know", async () => {
        const output = io();
        const loadRows = vi.fn(async () => []);
        await runUsageReport({
            argv: [],
            env: { [PRICE_TABLE_VARIABLE]: PRICES },
            loadRows,
            now: new Date("2026-10-31T23:00:00Z"),
            ...output,
        });
        expect(loadRows).toHaveBeenCalledWith(
            expect.objectContaining({ from: new Date("2026-10-01T00:00:00Z") }),
        );
        await expect(
            runUsageReport({
                argv: ["--org", "not-a-uuid"],
                env: { [PRICE_TABLE_VARIABLE]: PRICES },
                loadRows,
                ...output,
            }),
        ).resolves.toBe(1);
        expect(output.err).toHaveBeenLastCalledWith(
            expect.stringMatching(/^--org needs a uuid\./),
        );
        await runUsageReport({
            argv: ["--month", "2026-13"],
            env: { [PRICE_TABLE_VARIABLE]: PRICES },
            loadRows,
            ...output,
        });
        expect(output.err).toHaveBeenLastCalledWith(
            expect.stringMatching(/^--month needs a month as YYYY-MM\./),
        );
        await runUsageReport({
            argv: ["--everything"],
            env: { [PRICE_TABLE_VARIABLE]: PRICES },
            loadRows,
            ...output,
        });
        expect(output.err).toHaveBeenLastCalledWith(
            expect.stringMatching(/^Unrecognised argument "--everything"/),
        );
        expect(loadRows).toHaveBeenCalledTimes(1);
    });
});

describe("loadUsageRows", () => {
    it("reads the month a page at a time, narrowed to the workspace and matter", async () => {
        const calls: Array<[string, ...unknown[]]> = [];
        const pages = [Array.from({ length: 1000 }, () => row({})), [row({})]];
        const db = {
            from: (table: string) => {
                calls.push(["from", table]);
                const query: Record<string, unknown> = {};
                for (const method of ["select", "gte", "lt", "eq", "order"]) {
                    query[method] = (...args: unknown[]) => {
                        calls.push([method, ...args]);
                        return query;
                    };
                }
                query.range = async (from: number, to: number) => {
                    calls.push(["range", from, to]);
                    return { data: pages.shift() ?? [], error: null };
                };
                return query;
            },
        };
        const rows = await loadUsageRows(db as never, {
            from: new Date("2026-10-01T00:00:00Z"),
            to: new Date("2026-11-01T00:00:00Z"),
            orgId: "org-1",
            projectId: "project-1",
        });
        expect(rows).toHaveLength(1001);
        expect(calls).toContainEqual(["gte", "created_at", "2026-10-01T00:00:00.000Z"]);
        expect(calls).toContainEqual(["lt", "created_at", "2026-11-01T00:00:00.000Z"]);
        expect(calls).toContainEqual(["eq", "org_id", "org-1"]);
        expect(calls).toContainEqual(["eq", "project_id", "project-1"]);
        expect(calls.filter(([method]) => method === "range")).toEqual([
            ["range", 0, 999],
            ["range", 1000, 1999],
        ]);
    });
});

describe("npm run report:usage", () => {
    it("exits with status 1 and names USAGE_PRICE_TABLE_JSON when it is not set", () => {
        const backend = path.resolve(__dirname, "../../..");
        const result = spawnSync(
            path.join(backend, "node_modules/.bin/tsx"),
            ["src/jobs/reportUsage.ts"],
            {
                cwd: backend,
                encoding: "utf8",
                env: {
                    ...process.env,
                    // Set and blank, so a developer's backend/.env cannot fill it.
                    [PRICE_TABLE_VARIABLE]: "",
                },
                timeout: 60_000,
            },
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("USAGE_PRICE_TABLE_JSON is not set");
        // Nothing but the report ever goes to stdout.
        expect(result.stdout).toBe("");
    }, 60_000);
});
