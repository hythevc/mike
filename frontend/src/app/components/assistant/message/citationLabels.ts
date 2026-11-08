// SPDX-License-Identifier: AGPL-3.0-only
//
// Plain-text labels for a chat citation's quote and page status (W25). Every
// label says what the system checked, never that an answer is correct or
// trustworthy. A lint (W20) keeps this file's strings plain, so keep all
// user-facing citation wording here.

import type { QuoteVerification } from "../../shared/types";

/** A quote the matcher could not find anywhere in the source text. */
export const QUOTE_NOT_FOUND_LABEL = "Quote not found - check source";

/** Shown when the source has no reliable page markers to check against. */
export const PAGE_NOT_CHECKED_LABEL = "Page not checked";

/** Under an answer that cites nothing from the conversation's documents. */
export const UNCITED_ANSWER_LABEL =
  "No passage from your documents is cited. Check this answer before relying on it.";

/** The plain text shown in place of an answer that is not in the documents. */
export const NOT_IN_DOCUMENTS_LABEL = "Not in these documents";

/**
 * The label for a quote found on a page other than the one it was cited to,
 * e.g. "Quote is on p. 5, not p. 4". Returns null for any other status.
 */
export function otherPageLabel(
  verification: QuoteVerification | undefined,
): string | null {
  if (
    !verification ||
    verification.page_status !== "other_page" ||
    verification.found_page === undefined
  ) {
    return null;
  }
  const cited = verification.cited_page;
  return cited === null || cited === undefined
    ? `Quote is on p. ${verification.found_page}`
    : `Quote is on p. ${verification.found_page}, not p. ${cited}`;
}

/** Whether the source's page could not be checked for this quote. */
export function isPageNotChecked(
  verification: QuoteVerification | undefined,
): boolean {
  return verification?.page_status === "not_checked";
}
