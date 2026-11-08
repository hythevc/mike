// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { TabularCell } from "../shared/types";
import {
    QUOTE_EVIDENCE_DISCLAIMER,
    QUOTE_MARKER_LABELS,
    cellNeedsChecking,
    quoteMarkerForCell,
    quotesFoundSummaryLabel,
    rowsWithoutTextLabel,
    summarizeCellQuotes,
} from "./tabularQuoteLabels";

const cell = (over: Partial<TabularCell>): TabularCell =>
    ({
        id: "c",
        review_id: "r",
        row_id: "row-1",
        document_id: null,
        column_index: 0,
        content: { summary: "Answer" },
        status: "done",
        created_at: "2026-10-31T00:00:00Z",
        ...over,
    }) as TabularCell;

describe("quoteMarkerForCell", () => {
    it("mirrors the quote status of a finished cell", () => {
        expect(quoteMarkerForCell(cell({ quote_status: "found" }))).toBe(
            "found",
        );
        expect(quoteMarkerForCell(cell({ quote_status: "not_found" }))).toBe(
            "not_found",
        );
        expect(quoteMarkerForCell(cell({ quote_status: "no_quote" }))).toBe(
            "no_quote",
        );
    });

    it("shows stale over a matched status when a source changed", () => {
        expect(
            quoteMarkerForCell(cell({ quote_status: "found", stale: true })),
        ).toBe("stale");
    });

    it("keeps no_text even when a source later changed", () => {
        expect(
            quoteMarkerForCell(cell({ quote_status: "no_text", stale: true })),
        ).toBe("no_text");
    });

    it("has no marker for an unfinished or unchecked cell", () => {
        expect(quoteMarkerForCell(cell({ status: "generating" }))).toBeNull();
        expect(
            quoteMarkerForCell(cell({ status: "done", quote_status: null })),
        ).toBeNull();
        expect(quoteMarkerForCell(undefined)).toBeNull();
    });
});

describe("cellNeedsChecking", () => {
    it("is true only for unmatched quotes or a changed source", () => {
        expect(cellNeedsChecking(cell({ quote_status: "not_found" }))).toBe(
            true,
        );
        expect(cellNeedsChecking(cell({ quote_status: "partly_found" }))).toBe(
            true,
        );
        expect(
            cellNeedsChecking(cell({ quote_status: "found", stale: true })),
        ).toBe(true);
    });

    it("is false for found, no_quote, no_text and unchecked cells", () => {
        expect(cellNeedsChecking(cell({ quote_status: "found" }))).toBe(false);
        expect(cellNeedsChecking(cell({ quote_status: "no_quote" }))).toBe(
            false,
        );
        expect(cellNeedsChecking(cell({ quote_status: "no_text" }))).toBe(
            false,
        );
        expect(cellNeedsChecking(cell({ quote_status: null }))).toBe(false);
    });
});

describe("summarizeCellQuotes", () => {
    it("counts quotes one by one and no-text rows separately", () => {
        const cells = [
            cell({
                row_id: "a",
                quote_status: "found",
                quote_outcomes: [
                    { field: "summary", status: "found" },
                    { field: "reasoning", status: "found" },
                ],
            }),
            cell({
                row_id: "b",
                quote_status: "partly_found",
                quote_outcomes: [
                    { field: "summary", status: "found" },
                    { field: "summary", status: "not_found" },
                ],
            }),
            cell({ row_id: "c", quote_status: "no_quote", quote_outcomes: [] }),
            cell({ row_id: "d", quote_status: "no_text", quote_outcomes: [] }),
            cell({
                row_id: "d",
                column_index: 1,
                quote_status: "no_text",
                quote_outcomes: [],
            }),
            cell({ row_id: "e", status: "generating" }),
        ];
        const summary = summarizeCellQuotes(cells);
        expect(summary.quotes).toBe(4);
        expect(summary.found).toBe(3);
        expect(summary.not_found).toBe(1);
        expect(summary.cells_without_quote).toBe(1);
        // Two no-text cells, but they are in one row, counted once.
        expect(summary.rows_without_text).toBe(1);
    });

    it("renders the header count and the separate no-text line", () => {
        const summary = summarizeCellQuotes([
            cell({
                row_id: "a",
                quote_status: "found",
                quote_outcomes: [{ field: "summary", status: "found" }],
            }),
            cell({
                row_id: "b",
                quote_status: "not_found",
                quote_outcomes: [{ field: "summary", status: "not_found" }],
            }),
            cell({ row_id: "c", quote_status: "no_text", quote_outcomes: [] }),
        ]);
        expect(quotesFoundSummaryLabel(summary)).toBe("1 of 2 quotes found");
        expect(rowsWithoutTextLabel(summary)).toBe("1 row without readable text");
    });

    it("omits the quote count when nothing has been checked", () => {
        const summary = summarizeCellQuotes([cell({ status: "generating" })]);
        expect(quotesFoundSummaryLabel(summary)).toBeNull();
        expect(rowsWithoutTextLabel(summary)).toBeNull();
    });
});

describe("labels", () => {
    it("uses the planned wording and the shared disclaimer", () => {
        expect(QUOTE_MARKER_LABELS.not_found).toBe(
            "Quote not found - check source",
        );
        expect(QUOTE_EVIDENCE_DISCLAIMER).toBe(
            "Legal information, not legal advice. Verify before relying.",
        );
    });
});
