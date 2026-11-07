import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TabularCell as TabularCellData } from "../shared/types";
import { TabularCell } from "./TabularCell";

describe("TabularCell", () => {
    it("passes the cited source document through the click handler", () => {
        const onCitationClick = vi.fn();
        const cell = {
            id: "cell-1",
            status: "done",
            content: {
                summary:
                    "Answer [[document:doc-2||page:4||quote:Exact language]]",
                flag: "grey",
                reasoning: "",
            },
        } as TabularCellData;

        render(
            <TabularCell
                cell={cell}
                onExpand={vi.fn()}
                onCitationClick={onCitationClick}
            />,
        );

        fireEvent.click(screen.getByTitle('Page 4: "Exact language"'));

        expect(onCitationClick).toHaveBeenCalledWith(
            4,
            "Exact language",
            1,
            undefined,
            undefined,
            "doc-2",
        );
    });

    it("says why a cell of a row without readable text has no answer", () => {
        const cell = {
            id: "cell-1",
            status: "done",
            quote_status: "no_text",
            content: { summary: "", flag: "grey", reasoning: "" },
        } as TabularCellData;

        render(<TabularCell cell={cell} onExpand={vi.fn()} />);

        expect(screen.getByText("No readable text")).toHaveAttribute(
            "title",
            expect.stringContaining("no extractable text"),
        );
    });

    it("shows an answer over a stale no-text status", () => {
        const cell = {
            id: "cell-1",
            status: "done",
            quote_status: "no_text",
            content: { summary: "Five years", flag: "green", reasoning: "" },
        } as TabularCellData;

        render(<TabularCell cell={cell} onExpand={vi.fn()} />);

        expect(screen.getByText("Five years")).toBeInTheDocument();
        expect(screen.queryByText("No readable text")).not.toBeInTheDocument();
    });

    it("shows the quote-status marker on an answered cell", () => {
        const cell = {
            id: "cell-1",
            status: "done",
            quote_status: "not_found",
            content: { summary: "The term is five years", flag: "grey" },
        } as TabularCellData;

        render(<TabularCell cell={cell} onExpand={vi.fn()} />);

        const marker = screen.getByText("Quote not found - check source");
        expect(marker).toBeInTheDocument();
        expect(
            marker.closest("[data-quote-marker='not_found']"),
        ).toHaveAttribute("title");
    });
});
