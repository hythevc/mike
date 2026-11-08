"use client";

import ExcelJS from "exceljs";
import type {
    ColumnConfig,
    TabularCell,
    TabularCellQuoteChecks,
    TabularQuoteCheck,
    TabularReviewRow,
} from "../shared/types";
import { preprocessCitations } from "./citation-utils";
import {
    NO_READABLE_TEXT_LABEL,
    QUOTE_EVIDENCE_DISCLAIMER,
    QUOTE_STATUS_EXPORT_LABELS,
    isUnansweredForLackOfText,
} from "./tabularQuoteLabels";

/** Strip a cell answer's citation and pill markers for a plain spreadsheet value. */
function cleanExportText(text: string): string {
    const { processed } = preprocessCitations(text);
    return processed
        .replace(/§\d+§/g, "")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/[ \t]+/g, " ")
        .trim();
}

export function formatCellForExport(cell: TabularCell | undefined): string {
    if (!cell) return "";
    if (cell.status === "pending" || cell.status === "generating") return "";
    if (cell.status === "error") return "Error";
    if (isUnansweredForLackOfText(cell)) return NO_READABLE_TEXT_LABEL;
    const summary = cell.content?.summary;
    if (!summary) return "";
    return cleanExportText(summary);
}

function sanitizeFilename(name: string): string {
    return (
        name
            .replace(/[\\/:*?"<>|]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || "Tabular Review"
    );
}

/** Where a quote says it is, for the Evidence sheet's "Page / cell" column. */
function quoteLocationLabel(check: TabularQuoteCheck): string {
    if (check.sheet && check.cell) return `${check.sheet}!${check.cell}`;
    if (check.cell) return check.cell;
    if (typeof check.page === "number") return `Page ${check.page}`;
    if (check.cited_reference) return check.cited_reference;
    return "";
}

function flagLabel(flag: string | undefined): string {
    if (!flag) return "";
    return flag.charAt(0).toUpperCase() + flag.slice(1);
}

type ExportParams = {
    reviewTitle: string;
    columns: ColumnConfig[];
    rows: TabularReviewRow[];
    cells: TabularCell[];
    /**
     * Every checked cell's quotes in full, from the quote-checks endpoint, so
     * the evidence keeps each quote beside the source passage it matched. The
     * endpoint returns only the passages the caller may read.
     */
    quoteChecks: TabularCellQuoteChecks[];
};

const EVIDENCE_HEADERS = [
    "Folder / document",
    "Column",
    "Quote",
    "Page / cell",
    "Status",
    "Flag",
    "Reasoning",
    "Source passage",
] as const;

/**
 * Build the review workbook: the grid, an Evidence sheet with one row per
 * quote (quote, page, status, flag and reasoning), a list of the rows without
 * readable text, and the standing disclaimer on each sheet. Pure, so the
 * worksheet contents can be asserted without writing a file.
 */
export function buildTabularReviewWorkbook(params: ExportParams): ExcelJS.Workbook {
    const { columns, rows, cells, quoteChecks } = params;

    const sortedCols = [...columns].sort((a, b) => a.index - b.index);
    const cellMap = new Map<string, TabularCell>();
    for (const cell of cells) {
        cellMap.set(`${cell.row_id}:${cell.column_index}`, cell);
    }
    const rowLabelById = new Map(rows.map((row) => [row.id, row.label]));
    const columnNameByIndex = new Map(
        columns.map((column) => [column.index, column.name]),
    );

    const wb = new ExcelJS.Workbook();

    // --- Review sheet: the grid of readable answers ---
    const grid = wb.addWorksheet("Review");
    grid.columns = [
        { header: "Folder / document", width: 40 },
        ...sortedCols.map((c) => ({ header: c.name, width: 40 })),
    ];
    const headerRow = grid.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle" };
    headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
    };
    for (const reviewRow of rows) {
        const row: string[] = [reviewRow.label];
        for (const col of sortedCols) {
            row.push(formatCellForExport(cellMap.get(`${reviewRow.id}:${col.index}`)));
        }
        const excelRow = grid.addRow(row);
        excelRow.alignment = { vertical: "top", wrapText: true };
    }
    grid.addRow([]);
    grid.addRow([QUOTE_EVIDENCE_DISCLAIMER]);

    // --- Evidence sheet: one row per quote with its source passage ---
    const evidence = wb.addWorksheet("Evidence");
    evidence.columns = EVIDENCE_HEADERS.map((header) => ({ header, width: 36 }));
    const evidenceHeader = evidence.getRow(1);
    evidenceHeader.font = { bold: true };
    evidenceHeader.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
    };
    for (const checkedCell of quoteChecks) {
        const cell = cellMap.get(
            `${checkedCell.row_id}:${checkedCell.column_index}`,
        );
        const rowLabel = rowLabelById.get(checkedCell.row_id) ?? "";
        const columnName =
            columnNameByIndex.get(checkedCell.column_index) ??
            `Column ${checkedCell.column_index + 1}`;
        const flag = flagLabel(cell?.content?.flag);
        const reasoning = cell?.content?.reasoning
            ? cleanExportText(cell.content.reasoning)
            : "";
        for (const check of checkedCell.quote_checks) {
            const excelRow = evidence.addRow([
                rowLabel,
                columnName,
                check.quote,
                quoteLocationLabel(check),
                QUOTE_STATUS_EXPORT_LABELS[check.status],
                flag,
                reasoning,
                check.source_excerpt ?? "",
            ]);
            excelRow.alignment = { vertical: "top", wrapText: true };
        }
    }
    evidence.addRow([]);
    evidence.addRow([QUOTE_EVIDENCE_DISCLAIMER]);

    // --- Rows without readable text: named apart from the quote counts ---
    const noTextRowIds = new Set<string>();
    for (const cell of cells) {
        if (cell.status === "done" && cell.quote_status === "no_text") {
            noTextRowIds.add(cell.row_id);
        }
    }
    const noText = wb.addWorksheet("Rows without readable text");
    noText.columns = [{ header: "Folder / document", width: 40 }];
    noText.getRow(1).font = { bold: true };
    const noTextLabels = rows
        .filter((row) => noTextRowIds.has(row.id))
        .map((row) => row.label);
    if (noTextLabels.length === 0) {
        noText.addRow(["None."]);
    } else {
        for (const label of noTextLabels) noText.addRow([label]);
    }
    noText.addRow([]);
    noText.addRow([QUOTE_EVIDENCE_DISCLAIMER]);

    return wb;
}

export async function exportTabularReviewToExcel(params: ExportParams) {
    const wb = buildTabularReviewWorkbook(params);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(params.reviewTitle)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
