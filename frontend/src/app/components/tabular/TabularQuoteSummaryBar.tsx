// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Info } from "lucide-react";
import type { TabularQuoteSummary } from "../shared/types";
import { TABLE_CHECKBOX_CLASS } from "../shared/TablePrimitive";
import {
    QUOTE_EVIDENCE_DISCLAIMER,
    quotesFoundSummaryLabel,
    rowsWithoutTextLabel,
} from "./tabularQuoteLabels";

/**
 * The strip above the grid: the review-wide quote count, a filter that narrows
 * the grid to the cells still to check, and the standing disclaimer. Lives
 * wherever tabular answers reach a reader, as the copilot posture requires.
 */
export function TabularQuoteSummaryBar({
    summary,
    cellsToCheckCount,
    showCellsToCheck,
    onShowCellsToCheckChange,
}: {
    summary: TabularQuoteSummary;
    cellsToCheckCount: number;
    showCellsToCheck: boolean;
    onShowCellsToCheckChange: (value: boolean) => void;
}) {
    const quotesLabel = quotesFoundSummaryLabel(summary);
    const rowsLabel = rowsWithoutTextLabel(summary);

    return (
        <div className="shrink-0 border-b border-gray-200 px-3 py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-700">
                    {quotesLabel && <span>{quotesLabel}</span>}
                    {rowsLabel && (
                        <span className="text-gray-600">{rowsLabel}</span>
                    )}
                    {!quotesLabel && !rowsLabel && (
                        <span className="text-gray-600">
                            No quotes checked yet.
                        </span>
                    )}
                </div>
                <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-gray-700">
                    <input
                        type="checkbox"
                        className={TABLE_CHECKBOX_CLASS}
                        checked={showCellsToCheck}
                        disabled={cellsToCheckCount === 0}
                        onChange={(event) =>
                            onShowCellsToCheckChange(event.target.checked)
                        }
                    />
                    <span>
                        Show cells to check
                        {cellsToCheckCount > 0 ? ` (${cellsToCheckCount})` : ""}
                    </span>
                </label>
            </div>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-600">
                <Info aria-hidden="true" className="h-3 w-3 shrink-0" />
                {QUOTE_EVIDENCE_DISCLAIMER}
            </p>
        </div>
    );
}
