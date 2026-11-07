// SPDX-License-Identifier: AGPL-3.0-only
//
// Wording for tabular quote-check statuses (docs/tabular-quote-checks.md).
// Labels say what was checked; they never call an answer verified or accurate.
// W20's content lint reads the strings here.

import type {
    TabularCell,
    TabularQuoteOutcome,
    TabularQuoteSummary,
} from "../shared/types";

/** Shown in place of an answer for a row with a source that has no text. */
export const NO_READABLE_TEXT_LABEL = "No readable text";

/** Why such a cell has no answer. */
export const NO_READABLE_TEXT_DESCRIPTION =
    "Not answered: a source document for this row has no extractable text, for example a scanned file without a text layer.";

/**
 * The one line that must sit wherever tabular answers reach a reader: the grid
 * and the Excel export. The product drafts; the lawyer decides and verifies.
 */
export const QUOTE_EVIDENCE_DISCLAIMER =
    "Legal information, not legal advice. Verify before relying.";

/**
 * The marker a finished cell shows. The first five mirror the quote-check
 * status; `stale` is a cell whose source has changed since it was answered,
 * so even a quote that once matched may no longer hold.
 */
export type QuoteMarkerKind =
    | "found"
    | "partly_found"
    | "not_found"
    | "no_quote"
    | "no_text"
    | "stale";

/** The short, visible text of each marker. Plain words, never colour alone. */
export const QUOTE_MARKER_LABELS: Record<QuoteMarkerKind, string> = {
    found: "Quote found",
    partly_found: "Partly found",
    not_found: "Quote not found - check source",
    no_quote: "No quote",
    no_text: NO_READABLE_TEXT_LABEL,
    stale: "Stale",
};

/** The accessible name and tooltip of each marker: what the check means. */
export const QUOTE_MARKER_DESCRIPTIONS: Record<QuoteMarkerKind, string> = {
    found: "Every quote in this answer was found in the source text it cites.",
    partly_found:
        "Some of this answer's quoted text was found in the source and some was not. Check the source.",
    not_found:
        "This answer's quoted text was not found in the source. Check the source before relying on it.",
    no_quote:
        "This answer cites no quote, so there was no quoted text to match against a source.",
    no_text: NO_READABLE_TEXT_DESCRIPTION,
    stale: "A source document has changed since this answer was written. Re-run the cell to check it against the current text.",
};

/** What the plain-text status column of the Excel export says for each cell. */
export const QUOTE_STATUS_EXPORT_LABELS: Record<QuoteMarkerKind, string> =
    QUOTE_MARKER_LABELS;

type QuoteCellFields = Pick<TabularCell, "status" | "quote_status"> & {
    stale?: boolean | null;
};

/**
 * A finished cell left unanswered because a source of its row has no
 * extractable text. One that carries an answer is shown as that answer.
 */
export function isUnansweredForLackOfText(
    cell: Pick<TabularCell, "status" | "quote_status" | "content"> | undefined,
): boolean {
    return (
        cell?.status === "done" &&
        cell.quote_status === "no_text" &&
        !cell.content?.summary
    );
}

/**
 * The marker to show for a cell, or null when there is none: the cell has no
 * finished answer, or it was answered before quote checks existed and its
 * source has not changed. A row with no readable text keeps that marker even
 * when a source later changes; otherwise a changed source shows as stale.
 */
export function quoteMarkerForCell(
    cell: QuoteCellFields | undefined,
): QuoteMarkerKind | null {
    if (!cell || cell.status !== "done") return null;
    if (cell.quote_status === "no_text") return "no_text";
    if (cell.stale) return "stale";
    return cell.quote_status ?? null;
}

/**
 * Whether a reviewer still has to look at this cell: its quote was not fully
 * matched against the source, or a source has changed since it was answered.
 * Answers with no quote are a separate, neutral state and are not included.
 */
export function cellNeedsChecking(cell: QuoteCellFields | undefined): boolean {
    const marker = quoteMarkerForCell(cell);
    return (
        marker === "not_found" ||
        marker === "partly_found" ||
        marker === "stale"
    );
}

type SummaryCell = {
    row_id?: string | null;
    status?: TabularCell["status"];
    quote_status?: TabularCell["quote_status"];
    quote_outcomes?: TabularQuoteOutcome[] | null;
    stale?: boolean | null;
};

/**
 * Review-wide quote counts over the cells shown, mirroring the server's
 * `quote_summary`. Quotes are counted one by one across finished cells; rows
 * not answered because a source has no extractable text are counted
 * separately and add no quotes, found or not.
 */
export function summarizeCellQuotes(
    cells: ReadonlyArray<SummaryCell>,
): TabularQuoteSummary {
    const summary: TabularQuoteSummary = {
        quotes: 0,
        found: 0,
        partly_found: 0,
        not_found: 0,
        cells_without_quote: 0,
        cells_unchecked: 0,
        cells_stale: 0,
        rows_without_text: 0,
    };
    const rowsWithoutText = new Set<string>();
    for (const cell of cells) {
        if (cell.status !== "done") continue;
        if (cell.stale) summary.cells_stale += 1;
        if (!cell.quote_status) {
            summary.cells_unchecked += 1;
            continue;
        }
        if (cell.quote_status === "no_text") {
            rowsWithoutText.add(String(cell.row_id ?? ""));
            continue;
        }
        if (cell.quote_status === "no_quote") summary.cells_without_quote += 1;
        for (const outcome of cell.quote_outcomes ?? []) {
            summary.quotes += 1;
            summary[outcome.status] += 1;
        }
    }
    summary.rows_without_text = rowsWithoutText.size;
    return summary;
}

/**
 * The header count, e.g. "37 of 40 quotes found". Null when no quote has been
 * checked yet, so the header can omit the line rather than show "0 of 0".
 */
export function quotesFoundSummaryLabel(
    summary: TabularQuoteSummary,
): string | null {
    if (summary.quotes === 0) return null;
    return `${summary.found} of ${summary.quotes} quotes found`;
}

/**
 * The count of rows without readable text, shown apart from the quote count,
 * or null when there are none.
 */
export function rowsWithoutTextLabel(summary: TabularQuoteSummary): string | null {
    const count = summary.rows_without_text;
    if (count <= 0) return null;
    return `${count} ${count === 1 ? "row" : "rows"} without readable text`;
}
