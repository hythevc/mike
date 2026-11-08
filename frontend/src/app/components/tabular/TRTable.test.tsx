import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TRTable } from "./TRTable";
import type {
    ColumnConfig,
    Document,
    TabularCell,
    TabularReviewRow,
} from "../shared/types";

const row = {
    id: "row-1",
    label: "Contracts",
    row_type: "folder",
    document_id: null,
    source_document_ids: ["doc-1", "doc-2"],
} as TabularReviewRow;
const documents = [
    {
        id: "doc-1",
        filename: "Agreement.pdf",
        file_type: "pdf",
    },
    {
        id: "doc-2",
        filename: "Schedule.docx",
        file_type: "docx",
    },
] as Document[];

function renderTable(
    documentGrouping: "document" | "folder" = "folder",
    tableRows: TabularReviewRow[] = [row],
    onDocumentOpen = vi.fn(),
) {
    const renderResult = render(
        <TRTable
            loading={false}
            documentGrouping={documentGrouping}
            columns={[]}
            rows={tableRows}
            documents={documents}
            cells={[]}
            savingColumn={false}
            savingColumnsConfig={false}
            selectedRowIds={[]}
            onSelectionChange={vi.fn()}
            onDocumentOpen={onDocumentOpen}
            onExpand={vi.fn()}
            onCitationClick={vi.fn()}
            onUpdateColumn={vi.fn()}
            onDeleteColumn={vi.fn()}
            onAddColumn={vi.fn()}
            onAddDocuments={vi.fn()}
        />,
    );
    return { ...renderResult, onDocumentOpen };
}

describe("TRTable", () => {
    // The grid here is div-based (no table/columnheader/rowheader roles), so
    // this asserts on rendered content rather than ARIA table semantics.
    it("renders one table row for a grouped folder", () => {
        const { container } = renderTable();
        expect(screen.getByText("Folder / Document")).toBeInTheDocument();
        expect(screen.getByText("Folder / Document").parentElement).toHaveClass(
            "text-gray-700",
        );
        expect(screen.getByText("Contracts")).toBeInTheDocument();
        expect(container.querySelector(".table-surface")).toHaveClass(
            "tabular-review-table-surface",
        );
        expect(
            screen.getByText("Folder / Document").parentElement,
        ).toHaveClass("table-sticky-cell");
        expect(
            screen.getByText("Contracts").closest(".table-sticky-cell"),
        ).not.toBeNull();
        // One select-all checkbox in the header plus one per logical review row.
        expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    });

    it("uses Document as the header for document grouping", () => {
        renderTable("document");
        expect(screen.getByText("Document")).toBeInTheDocument();
        expect(
            screen.queryByText("Folder / Document"),
        ).not.toBeInTheDocument();
    });

    it("expands a folder row to list its source documents", () => {
        const { onDocumentOpen } = renderTable();
        fireEvent.click(screen.getByText("Contracts"));
        expect(screen.getByText("Agreement.pdf")).toBeInTheDocument();
        expect(screen.getByText("Schedule.docx")).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: "Open Agreement.pdf" }),
        );
        expect(onDocumentOpen).toHaveBeenCalledWith(row, documents[0]);
    });

    it("opens a standalone document row from its document name", () => {
        const documentRow = {
            ...row,
            label: "Agreement.pdf",
            row_type: "document",
            document_id: "doc-1",
            source_document_ids: ["doc-1"],
        } as TabularReviewRow;
        const { onDocumentOpen } = renderTable(
            "document",
            [documentRow],
        );

        fireEvent.click(
            screen.getByRole("button", { name: "Open Agreement.pdf" }),
        );

        expect(onDocumentOpen).toHaveBeenCalledWith(
            documentRow,
            documents[0],
        );
    });
});

/* ── Quote-status markers and the "Show cells to check" filter ───────────── */

const quoteColumns = [
    { index: 0, name: "Term", prompt: "" },
    { index: 1, name: "Liability", prompt: "" },
] as ColumnConfig[];

const quoteRows = [
    {
        id: "row-a",
        label: "Alpha.pdf",
        row_type: "document",
        document_id: "doc-a",
        source_document_ids: ["doc-a"],
    },
    {
        id: "row-b",
        label: "Beta.pdf",
        row_type: "document",
        document_id: "doc-b",
        source_document_ids: ["doc-b"],
    },
] as TabularReviewRow[];

const answered = (
    rowId: string,
    columnIndex: number,
    summary: string,
    quote_status: TabularCell["quote_status"],
): TabularCell =>
    ({
        id: `${rowId}-${columnIndex}`,
        review_id: "r1",
        row_id: rowId,
        document_id: null,
        column_index: columnIndex,
        content: { summary },
        status: "done",
        quote_status,
    }) as TabularCell;

const quoteCells = [
    answered("row-a", 0, "Alpha term answer", "found"),
    answered("row-a", 1, "Alpha liability answer", "not_found"),
    answered("row-b", 0, "Beta term answer", "found"),
    answered("row-b", 1, "Beta liability answer", "found"),
];

function renderQuoteTable(showCellsToCheck: boolean) {
    return render(
        <TRTable
            loading={false}
            documentGrouping="document"
            columns={quoteColumns}
            rows={quoteRows}
            documents={documents}
            cells={quoteCells}
            savingColumn={false}
            savingColumnsConfig={false}
            selectedRowIds={[]}
            showCellsToCheck={showCellsToCheck}
            onSelectionChange={vi.fn()}
            onDocumentOpen={vi.fn()}
            onExpand={vi.fn()}
            onCitationClick={vi.fn()}
            onUpdateColumn={vi.fn()}
            onDeleteColumn={vi.fn()}
            onAddColumn={vi.fn()}
            onAddDocuments={vi.fn()}
        />,
    );
}

describe("TRTable quote markers and filter", () => {
    it("shows a quote-status marker with visible text on each answered cell", () => {
        renderQuoteTable(false);
        // Three cells found, one not found: markers render as plain text.
        expect(screen.getAllByText("Quote found")).toHaveLength(3);
        const notFound = screen.getByText("Quote not found - check source");
        expect(notFound).toBeInTheDocument();
        // The marker's accessible description, never colour alone.
        expect(
            notFound.closest("[data-quote-marker='not_found']"),
        ).toHaveAttribute("title");
    });

    it("'Show cells to check' shows only the cells that need checking", () => {
        renderQuoteTable(true);
        // The one not-found cell stays.
        expect(screen.getByText("Alpha liability answer")).toBeInTheDocument();
        // The found cell in the same row is blanked out.
        expect(
            screen.queryByText("Alpha term answer"),
        ).not.toBeInTheDocument();
        // The all-found row disappears entirely.
        expect(screen.queryByText("Beta term answer")).not.toBeInTheDocument();
        expect(
            screen.queryByText("Beta liability answer"),
        ).not.toBeInTheDocument();
    });
});
