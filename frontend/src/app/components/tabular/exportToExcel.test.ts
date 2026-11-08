// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type {
    ColumnConfig,
    TabularCell,
    TabularCellQuoteChecks,
    TabularReviewRow,
} from "../shared/types";
import { QUOTE_EVIDENCE_DISCLAIMER } from "./tabularQuoteLabels";
import {
    buildTabularReviewWorkbook,
    formatCellForExport,
} from "./exportToExcel";
import type ExcelJS from "exceljs";

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

const columns = [{ index: 0, name: "Term", prompt: "" }] as ColumnConfig[];
const rows = [
    {
        id: "row-1",
        label: "Agreement.pdf",
        row_type: "document",
        document_id: "doc-1",
        source_document_ids: ["doc-1"],
    },
    {
        id: "row-2",
        label: "Scan.pdf",
        row_type: "document",
        document_id: "doc-2",
        source_document_ids: ["doc-2"],
    },
] as TabularReviewRow[];
const exportCells = [
    cell({
        row_id: "row-1",
        column_index: 0,
        content: {
            summary: "Five years [[document:doc-1||page:2||quote:five years]]",
            flag: "green",
            reasoning: "Clause 3 sets it [[document:doc-1||page:2||quote:five years]]",
        },
        quote_status: "found",
    }),
    cell({
        row_id: "row-2",
        column_index: 0,
        content: { summary: "", flag: "grey" },
        quote_status: "no_text",
    }),
];
const quoteChecks: TabularCellQuoteChecks[] = [
    {
        row_id: "row-1",
        column_index: 0,
        quote_status: "found",
        quote_checks: [
            {
                field: "summary",
                quote: "five years",
                document_id: "doc-1",
                page: 2,
                status: "found",
                source_excerpt: "the term is five years",
                context_before: "In which case ",
                context_after: " from the effective date.",
            },
        ],
        no_text_document_ids: [],
    },
    {
        row_id: "row-2",
        column_index: 0,
        quote_status: "no_text",
        quote_checks: [],
        no_text_document_ids: ["doc-2"],
    },
];

function sheetHasText(ws: ExcelJS.Worksheet, text: string): boolean {
    let found = false;
    ws.eachRow((row) => {
        (row.values as unknown[]).forEach((value) => {
            if (value === text) found = true;
        });
    });
    return found;
}

describe("buildTabularReviewWorkbook", () => {
    const wb = buildTabularReviewWorkbook({
        reviewTitle: "Review",
        columns,
        rows,
        cells: exportCells,
        quoteChecks,
    });

    it("adds an Evidence sheet with quote, page, status, flag and reasoning columns", () => {
        const evidence = wb.getWorksheet("Evidence");
        expect(evidence).toBeDefined();
        const header = (evidence!.getRow(1).values as string[]).filter(Boolean);
        for (const column of ["Quote", "Page / cell", "Status", "Flag", "Reasoning"]) {
            expect(header).toContain(column);
        }
    });

    it("writes one Evidence row per quote, keeping the source passage", () => {
        const evidence = wb.getWorksheet("Evidence")!;
        // Header on row 1, one quote on row 2 (row-2 has no quotes).
        expect(evidence.getCell("C2").value).toBe("five years");
        expect(evidence.getCell("D2").value).toBe("Page 2");
        expect(evidence.getCell("E2").value).toBe("Quote found");
        expect(evidence.getCell("F2").value).toBe("Green");
        // Reasoning keeps its words but drops the citation markers.
        expect(evidence.getCell("G2").value).toBe("Clause 3 sets it");
        expect(evidence.getCell("H2").value).toBe("the term is five years");
    });

    it("lists the rows without readable text on their own sheet", () => {
        const noText = wb.getWorksheet("Rows without readable text");
        expect(noText).toBeDefined();
        expect(sheetHasText(noText!, "Scan.pdf")).toBe(true);
        expect(sheetHasText(noText!, "Agreement.pdf")).toBe(false);
    });

    it("carries the disclaimer on the grid and the evidence", () => {
        expect(sheetHasText(wb.getWorksheet("Review")!, QUOTE_EVIDENCE_DISCLAIMER)).toBe(
            true,
        );
        expect(
            sheetHasText(wb.getWorksheet("Evidence")!, QUOTE_EVIDENCE_DISCLAIMER),
        ).toBe(true);
    });
});
