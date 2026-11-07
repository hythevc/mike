// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import type { ProjectUsageReport } from "@mike/contracts";
import { getProjectUsage, projectUsageCsv } from "../projects.usage";

vi.mock("../../../lib/access", () => ({
    checkProjectAccess: vi.fn(),
}));
import { checkProjectAccess } from "../../../lib/access";
const accessMock = vi.mocked(checkProjectAccess);

const PRICE_TABLE = JSON.stringify({
    currency: "USD",
    models: { "test-model": { input: 1, output: 2, cached_input: 0.1 } },
});

type Result = { data: unknown; error?: unknown };
function fakeDb(handlers: Record<string, () => Result>): Db {
    const from = (table: string) => {
        const settle = () =>
            Promise.resolve(handlers[table]?.() ?? { data: null, error: null });
        const builder: Record<string, unknown> = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
            order: () => builder,
            range: () => builder,
            maybeSingle: settle,
            single: settle,
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                settle().then(resolve, reject),
        };
        return builder;
    };
    return { from } as unknown as Db;
}

const row = (over: Record<string, unknown> = {}) => ({
    created_at: "2026-11-01T00:00:00Z",
    user_id: "u1",
    surface: "project_chat",
    model: "test-model",
    provider: "anthropic",
    key_source: "env",
    input_tokens: 1000,
    output_tokens: 500,
    cached_tokens: 0,
    document_pages: 3,
    tokens_estimated: false,
    ...over,
});

afterEach(() => {
    accessMock.mockReset();
    delete process.env.USAGE_PRICE_TABLE_JSON;
});

describe("getProjectUsage", () => {
    it("returns 404 (not_found) when the caller cannot open the matter", async () => {
        accessMock.mockResolvedValue({ ok: false } as never);
        const result = await getProjectUsage(fakeDb({}), {
            projectId: "p1",
            userId: "u1",
        });
        expect(result).toEqual({ ok: false, kind: "not_found" });
    });

    it("returns the matter's rows with an estimated cost from the price table", async () => {
        process.env.USAGE_PRICE_TABLE_JSON = PRICE_TABLE;
        accessMock.mockResolvedValue({
            ok: true,
            projectRole: "viewer",
            isCreator: false,
            orgRole: null,
            project: { id: "p1", user_id: "u1", org_id: null },
        } as never);
        const db = fakeDb({
            usage_events: () => ({ data: [row()] }),
            user_profiles: () => ({ data: [{ user_id: "u1", email: "a@firm.example" }] }),
        });
        const result = await getProjectUsage(db, { projectId: "p1", userId: "u1" });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.report.estimates).toBe(true);
        expect(result.report.priced).toBe(true);
        expect(result.report.currency).toBe("USD");
        expect(result.report.rows).toHaveLength(1);
        const entry = result.report.rows[0];
        expect(entry.user_email).toBe("a@firm.example");
        // (1000 - 0) * 1 + 0 * 0.1 + 500 * 2 = 2000 per million tokens.
        expect(entry.estimated_cost).toBeCloseTo((1000 * 1 + 500 * 2) / 1_000_000, 10);
    });

    it("leaves cost null when no price table is configured", async () => {
        accessMock.mockResolvedValue({
            ok: true,
            projectRole: "owner",
            isCreator: true,
            orgRole: null,
            project: { id: "p1", user_id: "u1", org_id: null },
        } as never);
        const db = fakeDb({
            usage_events: () => ({ data: [row()] }),
            user_profiles: () => ({ data: [] }),
        });
        const result = await getProjectUsage(db, { projectId: "p1", userId: "u1" });
        if (!result.ok) throw new Error("expected ok");
        expect(result.report.priced).toBe(false);
        expect(result.report.currency).toBeNull();
        expect(result.report.rows[0].estimated_cost).toBeNull();
    });
});

describe("projectUsageCsv", () => {
    const report: ProjectUsageReport = {
        estimates: true,
        currency: "USD",
        priced: true,
        rows: [
            {
                created_at: "2026-11-01T00:00:00Z",
                user_id: "u1",
                user_email: "a@firm.example",
                surface: "project_chat",
                model: "test-model",
                provider: "anthropic",
                key_source: "env",
                input_tokens: 1000,
                output_tokens: 500,
                cached_tokens: 0,
                tokens_estimated: true,
                document_pages: 3,
                estimated_cost: 0.002,
            },
        ],
    };

    it("has the required columns, with the cost column labelled an estimate", () => {
        const header = projectUsageCsv(report).split("\r\n")[0];
        for (const col of ["Model", "Provider", "Key source", "Input tokens", "Output tokens"])
            expect(header).toContain(col);
        expect(header).toContain("Estimated cost (USD)");
    });

    it("writes the row's model, provider, key source, tokens and cost", () => {
        const line = projectUsageCsv(report).split("\r\n")[1];
        expect(line).toContain("test-model");
        expect(line).toContain("anthropic");
        expect(line).toContain("env");
        expect(line).toContain("1000");
        expect(line).toContain("0.002000");
        expect(line).toContain("yes"); // tokens estimated
    });

    it("leaves the cost blank when a model has no price", () => {
        const line = projectUsageCsv({
            ...report,
            rows: [{ ...report.rows[0], estimated_cost: null }],
        }).split("\r\n")[1];
        expect(line.endsWith(",")).toBe(true);
    });
});
