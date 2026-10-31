// SPDX-License-Identifier: AGPL-3.0-only
//
// A quote check that fails must not cost the cell its answer.

import { describe, it, expect, vi } from "vitest";

const queryTabularAllColumns = vi.fn();
vi.mock("../tabular.extract", () => ({
    queryTabularAllColumns: (...a: unknown[]) => queryTabularAllColumns(...a),
}));

vi.mock("../tabular.rows", () => ({
    loadRowDocumentText: async () => ({
        text: "## Source document: Contract.pdf\n\nThe term is five years.",
        sources: [
            {
                documentId: "doc-1",
                versionId: "ver-1",
                contentSha256: null,
                filename: "Contract.pdf",
                markdown: "The term is five years.",
            },
        ],
    }),
}));

vi.mock("../tabular.verify", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../tabular.verify")>()),
    createCellQuoteChecker: () => () => {
        throw new Error("checker bug");
    },
}));

import { extractRowColumns } from "../tabular.extractRow";
import { makeFakeDb } from "./fakeDb";

describe("extractRowColumns when the quote check fails", () => {
    it("saves the answer without a status, with its sources' versions, and finishes the cell", async () => {
        queryTabularAllColumns.mockImplementation(async (_m, _f, _t, _cols, onResult) => {
            await onResult(0, {
                summary: "Five years [[document:doc-1||page:1||quote:five years]]",
                flag: "green",
                reasoning: "",
            });
        });
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        const fake = makeFakeDb();
        const sink = { generating: vi.fn(), done: vi.fn() };
        try {
            const out = await extractRowColumns({
                db: fake.db,
                reviewId: "rev-1",
                row: {
                    id: "row-1",
                    review_id: "rev-1",
                    label: "Contract.pdf",
                    row_type: "document",
                    folder_id: null,
                    library_folder_id: null,
                    document_id: "doc-1",
                    sort_index: 0,
                    source_document_ids: ["doc-1"],
                },
                columns: [{ index: 0, name: "Term", prompt: "What is the term?" }],
                existingByColumn: new Map([[0, { id: "c0", status: "pending", content: null }]]),
                model: "m",
                apiKeys: {},
                sink,
                generationId: "gen-1",
            });
            expect(out.missing).toEqual([]);
        } finally {
            logged.mockRestore();
        }

        const done = fake.calls.find(
            (call) => (call.payload as { status?: string } | undefined)?.status === "done",
        );
        expect(done?.payload).toMatchObject({
            content: expect.stringContaining("Five years"),
            quote_status: null,
            quote_checks: null,
            // Kept so the cell can still report that its source changed.
            source_versions: {
                "doc-1": { version_id: "ver-1", content_sha256: null, has_text: true },
            },
        });
        expect(sink.done).toHaveBeenCalledWith("row-1", 0, expect.anything(), {
            quote_status: null,
            quote_outcomes: [],
        });
    });
});
