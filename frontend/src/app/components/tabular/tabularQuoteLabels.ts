// SPDX-License-Identifier: AGPL-3.0-only
//
// Wording for tabular quote-check statuses (docs/tabular-quote-checks.md).
// Labels say what was checked; they never call an answer verified or accurate.

import type { TabularCell } from "../shared/types";

/** Shown in place of an answer for a row with a source that has no text. */
export const NO_READABLE_TEXT_LABEL = "No readable text";

/** Why such a cell has no answer. */
export const NO_READABLE_TEXT_DESCRIPTION =
    "Not answered: a source document for this row has no extractable text, for example a scanned file without a text layer.";

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
