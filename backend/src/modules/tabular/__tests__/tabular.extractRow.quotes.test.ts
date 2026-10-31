// SPDX-License-Identifier: AGPL-3.0-only
//
// Quote checks in the shared row-extraction core: every finished cell is
// written with its check, a row whose source yields no text is never sent to
// the model, and a row whose source could not be read is failed, not finished.

import { describe, it, expect, vi, beforeEach } from "vitest";

const queryTabularAllColumns = vi.fn();
vi.mock("../tabular.extract", () => ({
    queryTabularAllColumns: (...a: unknown[]) => queryTabularAllColumns(...a),
}));

const loadRowDocumentText = vi.fn();
vi.mock("../tabular.rows", () => ({
    loadRowDocumentText: (...a: unknown[]) => loadRowDocumentText(...a),
}));

import { extractRowColumns, finalizeCell } from "../tabular.extractRow";
import { streamTabularGenerateSync } from "../tabular.generateStream";
import type { ReviewRow, RowDocumentText } from "../tabular.rows";
import { callTo, makeFakeDb } from "./fakeDb";

const LEASE =
    "## Page 1\n\nThe Tenant shall pay rent of $10,000.00 on the first day of each month.";
const SCHEDULE = "## Page 1\n\nSchedule A describes the Premises at 10 Main Street.";

const FOLDER_ROW: ReviewRow = {
    id: "row-1",
    review_id: "rev-1",
    label: "Lease folder",
    row_type: "folder",
    folder_id: "folder-1",
    library_folder_id: null,
    document_id: null,
    sort_index: 0,
    source_document_ids: ["doc-a", "doc-b"],
};

function rowText(sources: { id: string; markdown: string }[]): RowDocumentText {
    return {
        text: sources.map((s) => `## Source document: ${s.id}\n\n${s.markdown}`).join("\n\n---\n\n"),
        sources: sources.map((s) => ({
            documentId: s.id,
            versionId: `${s.id}-v1`,
            contentSha256: null,
            filename: `${s.id}.pdf`,
            markdown: s.markdown,
        })),
    };
}

const COLUMNS = [
    { index: 0, name: "Rent", prompt: "What is the rent?" },
    { index: 1, name: "Premises", prompt: "Where are the premises?" },
];

const sinkSpy = () => ({ generating: vi.fn(), done: vi.fn() });

const doneWrites = (calls: ReturnType<typeof makeFakeDb>["calls"]) =>
    calls.filter(
        (call) =>
            call.table === "tabular_cells" &&
            call.op === "update" &&
            (call.payload as { status?: string }).status === "done",
    );

beforeEach(() => {
    queryTabularAllColumns.mockReset();
    loadRowDocumentText.mockReset();
});

describe("extractRowColumns quote checks", () => {
    it("checks each cell of a folder row against the documents its quotes cite", async () => {
        loadRowDocumentText.mockResolvedValue(
            rowText([
                { id: "doc-a", markdown: LEASE },
                { id: "doc-b", markdown: SCHEDULE },
            ]),
        );
        queryTabularAllColumns.mockImplementation(
            async (_m, _f, text: string, _cols, onResult) => {
                // The model reads the combined text of both sources.
                expect(text).toContain("10 Main Street");
                expect(text).toContain("$10,000.00");
                await onResult(0, {
                    summary:
                        "$10,000 a month [[document:doc-a||page:1||quote:pay rent of $10,000.00]]",
                    flag: "green",
                    reasoning: "",
                });
                // Right words, wrong document: doc-a does not say this.
                await onResult(1, {
                    summary:
                        "10 Main Street [[document:doc-a||page:1||quote:the Premises at 10 Main Street]]",
                    flag: "green",
                    reasoning: "",
                });
            },
        );
        const fake = makeFakeDb();
        const sink = sinkSpy();

        const out = await extractRowColumns({
            db: fake.db,
            reviewId: "rev-1",
            row: FOLDER_ROW,
            columns: COLUMNS,
            existingByColumn: new Map(),
            model: "m",
            apiKeys: {},
            sink,
            generationId: "gen-1",
        });

        expect(out.missing).toEqual([]);
        const writes = doneWrites(fake.calls);
        expect(writes).toHaveLength(2);
        expect(writes[0].payload).toMatchObject({
            quote_status: "found",
            quote_checks: [
                expect.objectContaining({ document_id: "doc-a", status: "found" }),
            ],
            source_versions: {
                "doc-a": { version_id: "doc-a-v1", content_sha256: null, has_text: true },
                "doc-b": { version_id: "doc-b-v1", content_sha256: null, has_text: true },
            },
        });
        expect(writes[0].filters).toMatchObject({ column_index: 0, generation_id: "gen-1" });
        expect(writes[1].payload).toMatchObject({
            quote_status: "not_found",
            quote_checks: [
                expect.objectContaining({ document_id: "doc-a", status: "not_found" }),
            ],
        });
        expect(sink.done).toHaveBeenCalledWith(
            "row-1",
            1,
            expect.objectContaining({ summary: expect.stringContaining("10 Main Street") }),
            { quote_status: "not_found", quote_outcomes: [{ field: "summary", status: "not_found" }] },
        );
    });

    it.each([
        ["a scanned single document", [{ id: "doc-a", markdown: "" }], ["doc-a"]],
        [
            "a folder with one unreadable file",
            [
                { id: "doc-a", markdown: LEASE },
                { id: "doc-b", markdown: " \n " },
            ],
            ["doc-b"],
        ],
    ])(
        "does not ask the model about %s and records no Not Found answers",
        async (_label, sources) => {
            loadRowDocumentText.mockResolvedValue(rowText(sources));
            const fake = makeFakeDb();
            const sink = sinkSpy();

            const out = await extractRowColumns({
                db: fake.db,
                reviewId: "rev-1",
                row: FOLDER_ROW,
                columns: COLUMNS,
                existingByColumn: new Map([
                    [0, { id: "c0", status: "pending", content: null }],
                    [1, { id: "c1", status: "pending", content: null }],
                ]),
                model: "m",
                apiKeys: {},
                sink,
                generationId: "gen-1",
            });

            expect(queryTabularAllColumns).not.toHaveBeenCalled();
            expect(out.missing).toEqual([]);
            expect([...out.received].sort()).toEqual([0, 1]);
            const writes = doneWrites(fake.calls);
            expect(writes).toHaveLength(2);
            for (const write of writes) {
                const payload = write.payload as Record<string, unknown>;
                expect(payload.quote_status).toBe("no_text");
                expect(payload.quote_checks).toEqual([]);
                expect(JSON.parse(payload.content as string)).toEqual({
                    summary: "",
                    flag: "grey",
                    reasoning: "",
                });
                expect(payload.content).not.toMatch(/not found/i);
                expect(write.filters).toMatchObject({ generation_id: "gen-1" });
            }
            expect(sink.done).toHaveBeenCalledTimes(2);
            expect(sink.done.mock.calls[0][3]).toEqual({
                quote_status: "no_text",
                quote_outcomes: [],
            });
        },
    );

    it("fails a row whose source could not be read, without asking the model", async () => {
        const text = rowText([
            { id: "doc-a", markdown: LEASE },
            { id: "doc-b", markdown: "" },
        ]);
        text.sources[1].extractionFailed = true;
        loadRowDocumentText.mockResolvedValue(text);
        const fake = makeFakeDb();
        const sink = sinkSpy();

        const out = await extractRowColumns({
            db: fake.db,
            reviewId: "rev-1",
            row: FOLDER_ROW,
            columns: COLUMNS,
            existingByColumn: new Map([
                [0, { id: "c0", status: "pending", content: null }],
                [1, { id: "c1", status: "pending", content: null }],
            ]),
            model: "m",
            apiKeys: {},
            sink,
            generationId: "gen-1",
        });

        // Not finished as no_text: reported missing, so the caller marks the
        // cells error (or retries the job) and a later run tries again.
        expect(queryTabularAllColumns).not.toHaveBeenCalled();
        expect(out.missing).toEqual([0, 1]);
        expect(out.received.size).toBe(0);
        expect(out.error).toMatchObject({ kind: "extraction.failed" });
        expect(doneWrites(fake.calls)).toHaveLength(0);
        expect(sink.done).not.toHaveBeenCalled();
    });

    it("clears an earlier check when a cell is marked generating or finalized", async () => {
        loadRowDocumentText.mockResolvedValue(rowText([{ id: "doc-a", markdown: LEASE }]));
        queryTabularAllColumns.mockImplementation(async () => {});
        const fake = makeFakeDb();

        await extractRowColumns({
            db: fake.db,
            reviewId: "rev-1",
            row: FOLDER_ROW,
            columns: [COLUMNS[0]],
            existingByColumn: new Map([[0, { id: "c0", status: "error", content: null }]]),
            model: "m",
            apiKeys: {},
            sink: sinkSpy(),
            generationId: "gen-1",
        });
        await finalizeCell(fake.db, {
            reviewId: "rev-1",
            rowId: "row-1",
            columnIndex: 0,
            status: "error",
            generationId: "gen-1",
        });

        const cleared = { quote_status: null, quote_checks: null, source_versions: null };
        expect(callTo(fake.calls, "tabular_cells", 0)?.payload).toMatchObject({
            status: "generating",
            ...cleared,
        });
        expect(callTo(fake.calls, "tabular_cells", 1)?.payload).toMatchObject({
            status: "error",
            ...cleared,
        });
    });
});

describe("streamTabularGenerateSync frames", () => {
    it("carries the quote status, without quote text or passages, on a finished cell's frame only", async () => {
        loadRowDocumentText.mockResolvedValue(rowText([{ id: "doc-a", markdown: LEASE }]));
        queryTabularAllColumns.mockImplementation(async (_m, _f, _t, _cols, onResult) => {
            await onResult(0, {
                summary: "Monthly [[document:doc-a||page:1||quote:first day of each month]]",
                flag: "green",
                reasoning: "",
            });
        });
        const frames: Record<string, unknown>[] = [];

        await streamTabularGenerateSync({
            write: (line) => {
                frames.push(JSON.parse(line.slice("data: ".length)));
                return true;
            },
            db: makeFakeDb().db,
            reviewId: "rev-1",
            columns: [COLUMNS[0]],
            rows: [FOLDER_ROW],
            cellMap: new Map(),
            model: "m",
            apiKeys: {},
            generationId: "gen-1",
            abortSignal: new AbortController().signal,
        });

        expect(frames.map((frame) => frame.status)).toEqual(["generating", "done"]);
        expect(Object.keys(frames[0]).sort()).toEqual(
            ["column_index", "content", "row_id", "status", "type"],
        );
        expect(frames[1]).toMatchObject({
            type: "cell_update",
            status: "done",
            quote_status: "found",
            quote_outcomes: [{ field: "summary", status: "found" }],
        });
        for (const key of ["quote_checks", "source_versions", "no_text_document_ids"]) {
            expect(frames[1]).not.toHaveProperty(key);
        }
    });
});
