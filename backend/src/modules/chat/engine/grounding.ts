// SPDX-License-Identifier: AGPL-3.0-only
//
// Classify a finished documents-only answer against the conversation's
// documents, for the `answer_grounding` event. The classification is pure: it
// reads the answer's visible text (the `<CITATIONS>` block already stripped)
// and the verified citations, never the model or the network.

import type { AnswerScope } from "@mike/contracts";
import { NOT_IN_DOCUMENTS_ANSWER } from "./prompts";

export type GroundingStatus = "not_found" | "cited" | "uncited";

export type AnswerGroundingEvent = {
  type: "answer_grounding";
  scope: AnswerScope;
  status: GroundingStatus;
};

function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Whether the answer is the fixed "Not in these documents." sentence, ignoring
 * surrounding whitespace and letter case (but not punctuation), so a model
 * that lower-cases it or pads it still reads as not-found.
 */
export function isNotInDocumentsAnswer(visibleText: string): boolean {
  return (
    normalizeForComparison(visibleText) ===
    normalizeForComparison(NOT_IN_DOCUMENTS_ANSWER)
  );
}

function hasDocumentCitation(citations: unknown[]): boolean {
  return citations.some((citation) => {
    if (!citation || typeof citation !== "object" || Array.isArray(citation)) {
      return false;
    }
    return (citation as { kind?: unknown }).kind === "document";
  });
}

/**
 * Classify a documents-only answer: `not_found` when it is the fixed sentence,
 * `cited` when it cites at least one document, and `uncited` otherwise.
 * `visibleText` must have the `<CITATIONS>` block removed already.
 */
export function classifyGrounding(
  visibleText: string,
  citations: unknown[],
): GroundingStatus {
  if (isNotInDocumentsAnswer(visibleText)) return "not_found";
  return hasDocumentCitation(citations) ? "cited" : "uncited";
}
