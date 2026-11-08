// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TabularQuoteSummary } from "../shared/types";
import { TabularQuoteSummaryBar } from "./TabularQuoteSummaryBar";

const summary = (over: Partial<TabularQuoteSummary> = {}): TabularQuoteSummary => ({
    quotes: 40,
    found: 37,
    partly_found: 2,
    not_found: 1,
    cells_without_quote: 0,
    cells_unchecked: 0,
    cells_stale: 0,
    rows_without_text: 2,
    ...over,
});

describe("TabularQuoteSummaryBar", () => {
    it("shows the quote count and the no-text rows counted separately", () => {
        render(
            <TabularQuoteSummaryBar
                summary={summary()}
                cellsToCheckCount={3}
                showCellsToCheck={false}
                onShowCellsToCheckChange={vi.fn()}
            />,
        );
        expect(screen.getByText("37 of 40 quotes found")).toBeInTheDocument();
        expect(
            screen.getByText("2 rows without readable text"),
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                "Legal information, not legal advice. Verify before relying.",
            ),
        ).toBeInTheDocument();
    });

    it("toggles the 'Show cells to check' filter", () => {
        const onChange = vi.fn();
        render(
            <TabularQuoteSummaryBar
                summary={summary()}
                cellsToCheckCount={3}
                showCellsToCheck={false}
                onShowCellsToCheckChange={onChange}
            />,
        );
        const toggle = screen.getByRole("checkbox", {
            name: /Show cells to check/,
        });
        expect(toggle).toBeEnabled();
        fireEvent.click(toggle);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it("disables the filter when nothing needs checking", () => {
        render(
            <TabularQuoteSummaryBar
                summary={summary({
                    found: 40,
                    partly_found: 0,
                    not_found: 0,
                    rows_without_text: 0,
                })}
                cellsToCheckCount={0}
                showCellsToCheck={false}
                onShowCellsToCheckChange={vi.fn()}
            />,
        );
        expect(
            screen.getByRole("checkbox", { name: /Show cells to check/ }),
        ).toBeDisabled();
        expect(
            screen.queryByText(/rows? without readable text/),
        ).not.toBeInTheDocument();
    });
});
