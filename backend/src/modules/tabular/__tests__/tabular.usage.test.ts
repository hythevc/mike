// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";

// A row's extraction goes through the real tabular prompt and the real AI
// SDK adapter; only the provider is a scripted model, the row's text a
// fixture and the ledger an in-memory list.
const { streamWithProvider, loadRowDocumentText, inserts, reportError } = vi.hoisted(() => ({
    streamWithProvider: vi.fn(),
    loadRowDocumentText: vi.fn(),
    inserts: [] as Array<Record<string, unknown>>,
    reportError: vi.fn(),
}));

vi.mock("../../../lib/observability/sentry", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/observability/sentry")>()),
    reportError,
}));

vi.mock("../../../lib/llm/providers", () => ({
    streamWithProvider: (params: unknown) => streamWithProvider(params),
    completeWithProvider: vi.fn(),
}));
vi.mock("../tabular.rows", () => ({
    loadRowDocumentText: (...args: unknown[]) => loadRowDocumentText(...args),
}));
vi.mock("../../../lib/supabase", () => ({
    createServerSupabase: () => ({
        from: (table: string) => ({
            insert: async (row: Record<string, unknown>) => {
                if (table === "usage_events") inserts.push(row);
                return { error: null };
            },
        }),
    }),
}));

import { streamAiSdk } from "../../../lib/llm/aiSdk";
import type { StreamChatParams } from "../../../lib/llm/types";
import {
    config,
    makeModel,
    textStep,
} from "../../../lib/llm/__tests__/mockLanguageModel";
import { settleUsageWrites } from "../../../lib/usage";
import { extractRowColumns } from "../tabular.extractRow";
import { streamTabularGenerateSync } from "../tabular.generateStream";
import type { ReviewRow } from "../tabular.rows";

const USER = "00000000-0000-4000-8000-000000000001";
const ORG = "00000000-0000-4000-8000-000000000010";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const REVIEW = "00000000-0000-4000-8000-000000000040";
const GENERATION = "00000000-0000-4000-8000-000000000050";
const DOC = "00000000-0000-4000-8000-000000000060";

/** The grid's own writes: enough of a query builder to accept them. */
function cellDb() {
    const builder: Record<string, unknown> = {
        update: () => builder,
        eq: () => builder,
        insert: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return { from: () => builder } as never;
}

const COLUMNS = [{ index: 0, name: "Term", prompt: "What is the term?" }];
const row = (id: string, documentId: string): ReviewRow => ({
    id,
    review_id: REVIEW,
    label: "Lease.pdf",
    row_type: "document",
    folder_id: null,
    library_folder_id: null,
    document_id: documentId,
    sort_index: 0,
    source_document_ids: [documentId],
});

const cellLine = `{"column_index": 0, "summary": "Five years", "flag": "green", "reasoning": "Clause 2."}\n`;

beforeEach(async () => {
    inserts.length = 0;
    reportError.mockClear();
    loadRowDocumentText.mockReset();
    loadRowDocumentText.mockImplementation(
        async (_db: unknown, _row: unknown, onPageCount?: (pages: number | null) => void) => {
            onPageCount?.(12);
            return "## Source document: Lease.pdf\nThe term is five years.";
        },
    );
    streamWithProvider.mockReset();
    streamWithProvider.mockImplementation(async (params: StreamChatParams) =>
        streamAiSdk(params, {
            ...config(await makeModel([textStep(cellLine)])),
            keySource: "org",
        }),
    );
});

describe("a tabular row in the usage ledger", () => {
    it("is one row with the review, generation, document and its pages", async () => {
        const result = await extractRowColumns({
            db: cellDb(),
            reviewId: REVIEW,
            row: row("00000000-0000-4000-8000-000000000071", DOC),
            columns: COLUMNS,
            existingByColumn: new Map(),
            model: "mock-model",
            apiKeys: {},
            generationId: GENERATION,
            sink: { generating: vi.fn(), done: vi.fn() },
            usage: { userId: USER, orgId: ORG, projectId: PROJECT },
        });
        await settleUsageWrites();

        expect(result.missing).toEqual([]);
        expect(inserts).toEqual([
            expect.objectContaining({
                surface: "tabular",
                user_id: USER,
                org_id: ORG,
                project_id: PROJECT,
                review_id: REVIEW,
                run_id: GENERATION,
                document_id: DOC,
                document_pages: 12,
                key_source: "org",
            }),
        ]);
    });

    it("is one row per row of a synchronous generation", async () => {
        const write = vi.fn(() => true);
        await streamTabularGenerateSync({
            write,
            db: cellDb(),
            reviewId: REVIEW,
            columns: COLUMNS,
            rows: [
                row("00000000-0000-4000-8000-000000000072", DOC),
                row("00000000-0000-4000-8000-000000000073", "00000000-0000-4000-8000-000000000061"),
            ],
            cellMap: new Map(),
            model: "mock-model",
            apiKeys: {},
            generationId: GENERATION,
            abortSignal: new AbortController().signal,
            usage: { userId: USER, orgId: ORG, projectId: PROJECT },
        });
        await settleUsageWrites();

        expect(inserts).toHaveLength(2);
        expect(inserts.map((r) => [r.surface, r.run_id, r.project_id])).toEqual([
            ["tabular", GENERATION, PROJECT],
            ["tabular", GENERATION, PROJECT],
        ]);
        expect(new Set(inserts.map((r) => r.document_id)).size).toBe(2);
    });

    it("stops starting rows once one is refused for the allowance, and reports nothing", async () => {
        const { DeploymentQuotaExceededError } = await import("../../../lib/usage.js");
        streamWithProvider.mockReset();
        streamWithProvider.mockRejectedValue(new DeploymentQuotaExceededError("organization"));
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const onError = vi.fn();
        const write = vi.fn((_line: string) => true);
        const rows = Array.from({ length: 12 }, (_, index) =>
            row(`00000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`, DOC),
        );
        try {
            const finished = await streamTabularGenerateSync({
                write,
                db: cellDb(),
                reviewId: REVIEW,
                columns: COLUMNS,
                rows,
                cellMap: new Map(),
                model: "mock-model",
                apiKeys: {},
                generationId: GENERATION,
                abortSignal: new AbortController().signal,
                onError,
                usage: { userId: USER, orgId: ORG, projectId: PROJECT },
            });

            expect(finished).toBe(true);
            // Only the rows already running beside the first refusal (three
            // run at a time) asked; the other nine were never started.
            expect(streamWithProvider.mock.calls.length).toBeLessThanOrEqual(3);
            const started = new Set(
                write.mock.calls
                    .map(([line]) => JSON.parse(String(line).replace(/^data: /, "")))
                    .map((frame: { row_id: string }) => frame.row_id),
            );
            expect(started.size).toBeLessThanOrEqual(3);
            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({ code: "deployment_quota_exceeded" }),
            );
            expect(reportError).not.toHaveBeenCalled();
            expect(consoleError).not.toHaveBeenCalled();
            expect(consoleWarn).not.toHaveBeenCalled();
            expect(inserts).toEqual([]);
        } finally {
            consoleError.mockRestore();
            consoleWarn.mockRestore();
        }
    });
});
