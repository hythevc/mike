// SPDX-License-Identifier: AGPL-3.0-only
//
// A row's source text, one entry per source: a file that yields no text and a
// file whose extraction fails are told apart.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractDocumentMarkdown, reportError } = vi.hoisted(() => ({
    extractDocumentMarkdown: vi.fn(),
    reportError: vi.fn(),
}));
vi.mock("../tabular.extract", () => ({ extractDocumentMarkdown }));
vi.mock("../../../lib/storage", () => ({ downloadFile: vi.fn() }));
vi.mock("../../../lib/documentVersions", () => ({
    // Each document's active version lives at a path named after it.
    attachActiveVersionPaths: vi.fn(
        async (_db: unknown, docs: Record<string, unknown>[]) => {
            for (const doc of docs) {
                doc.storage_path = `files/${doc.id}`;
                doc.filename = `${doc.id}.pdf`;
                doc.file_type = "pdf";
            }
        },
    ),
}));
vi.mock("../../../lib/observability/sentry", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/observability/sentry")>()),
    reportError,
}));

import { loadRowDocumentText, type ReviewRow } from "../tabular.rows";
import { makeFakeDb } from "./fakeDb";

const ROW: ReviewRow = {
    id: "row-1",
    review_id: "rev-1",
    label: "Folder",
    row_type: "folder",
    folder_id: "folder-1",
    library_folder_id: null,
    document_id: null,
    sort_index: 0,
    source_document_ids: ["doc-text", "doc-scan", "doc-broken"],
};

beforeEach(() => {
    extractDocumentMarkdown.mockReset();
    reportError.mockReset();
});

describe("loadRowDocumentText", () => {
    it("marks a source whose extraction failed apart from one without text", async () => {
        extractDocumentMarkdown
            .mockResolvedValueOnce("The term is five years.")
            .mockResolvedValueOnce("")
            .mockRejectedValueOnce(new Error("conversion crashed"));
        const { db } = makeFakeDb({
            tables: {
                documents: {
                    data: [
                        { id: "doc-text", current_version_id: "v1" },
                        { id: "doc-scan", current_version_id: "v2" },
                        { id: "doc-broken", current_version_id: "v3" },
                    ],
                    error: null,
                },
            },
        });
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});

        let text;
        try {
            text = await loadRowDocumentText(db, ROW);
        } finally {
            logged.mockRestore();
        }

        expect(
            text.sources.map((source) => [
                source.documentId,
                source.markdown,
                source.extractionFailed,
            ]),
        ).toEqual([
            ["doc-text", "The term is five years.", undefined],
            ["doc-scan", "", undefined],
            ["doc-broken", "", true],
        ]);
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(reportError.mock.calls[0][0]).toMatchObject({ kind: "extraction.failed" });
    });
});
