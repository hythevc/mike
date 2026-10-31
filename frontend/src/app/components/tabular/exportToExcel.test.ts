// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { TabularCell } from "../shared/types";
import { formatCellForExport } from "./exportToExcel";

const cell = (over: Partial<TabularCell>): TabularCell =>
    ({
        id: "cell-1",
        review_id: "r1",
        row_id: "row-1",
        document_id: null,
        column_index: 0,
        content: null,
        status: "done",
        created_at: "2026-10-31T00:00:00Z",
        ...over,
    }) as TabularCell;

describe("formatCellForExport", () => {
    it("exports the answer without its citation markers", () => {
        expect(
            formatCellForExport(
                cell({
                    content: {
                        summary:
                            "Five years [[document:doc-1||page:2||quote:five years]]",
                        flag: "green",
                    },
                    quote_status: "found",
                }),
            ),
        ).toBe("Five years");
    });

    it("names a cell left unanswered because its row has no readable text", () => {
        expect(
            formatCellForExport(
                cell({
                    content: { summary: "", flag: "grey", reasoning: "" },
                    quote_status: "no_text",
                }),
            ),
        ).toBe("No readable text");
    });

    it("leaves an unfinished cell blank and marks a failed one", () => {
        expect(formatCellForExport(cell({ status: "pending" }))).toBe("");
        expect(formatCellForExport(cell({ status: "error" }))).toBe("Error");
        expect(formatCellForExport(undefined)).toBe("");
    });
});
